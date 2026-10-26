import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENTITY_FORBIDDEN_MESSAGE, ENTITY_HEADER, UserStatus, type Permission } from '@vop/shared';
import type { AppConfig } from '@vop/config';
import { IS_PUBLIC_KEY } from '../authz/public.decorator';
import { SessionService } from './session.service';
import { SupabaseAuthService } from './supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.module';
import { Inject } from '@nestjs/common';
import { NO_ENTITY, requestContext } from '../common/context';
import { EntitiesService } from '../entities/entities.service';
import { resolveEntityAccess } from './entity-access';
import { principalCache } from './principal-cache';
import type { AuthUser, AuthedRequest } from './auth-user';

/**
 * Global authentication guard (deny-by-default). Every route requires a valid session unless
 * marked @Public. Loads the user with roles, resolves the company the request works in (ADR-0008),
 * computes the effective permission set for that company from the (editable) role definitions,
 * blocks deactivated/suspended users, and attaches the principal and company to the request and
 * the ambient log/audit/query-scoping context.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAuthService,
    private readonly entities: EntitiesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & AuthedRequest>();
    // ADR-0008: the company the browser is working in. Validated against the user's access below.
    const rawEntity = req.headers[ENTITY_HEADER];
    const requestedEntity =
      typeof rawEntity === 'string' && rawEntity.trim() ? rawEntity.trim().toUpperCase() : null;

    // Resolve the authenticated principal id + session id from the active auth driver.
    let userId: string;
    let sessionId: string;

    let cacheToken: string | null = null;
    if (this.config.auth.driver === 'supabase') {
      const token = bearerToken(req.headers.authorization);
      if (!token) throw new UnauthorizedException('Authentication required.');

      // Fast path: a recently resolved principal for this exact token (see principal-cache.ts).
      const cached = principalCache.get(`${token}|${requestedEntity ?? ''}`);
      if (cached) {
        req.user = cached;
        this.enrichContext(cached);
        return true;
      }
      cacheToken = `${token}|${requestedEntity ?? ''}`;
      const resolved = await this.supabase.verifyAndResolve(token);
      if (!resolved) throw new UnauthorizedException('Session invalid or expired.');
      userId = resolved.userId;
      sessionId = resolved.sessionId;
    } else {
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
      const raw = cookies[this.sessions.cookieName];
      if (!raw) throw new UnauthorizedException('Authentication required.');
      const validated = await this.sessions.authenticate(raw);
      if (!validated) throw new UnauthorizedException('Session invalid or expired.');
      userId = validated.userId;
      sessionId = validated.sessionId;
    }

    const [user, activeEntities] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: true,
          entityRoles: {
            select: { entityId: true, roleKey: true, role: { select: { permissions: true } } },
          },
        },
      }),
      this.entities.active(),
    ]);
    if (!user) throw new UnauthorizedException('Session invalid or expired.');
    if (user.status === UserStatus.Deactivated || user.status === UserStatus.Suspended) {
      throw new ForbiddenException('Account is not active.');
    }

    const access = resolveEntityAccess({
      email: user.email,
      groupRoleKeys: user.roles.map((r) => r.key),
      entityRoles: user.entityRoles,
      activeEntities,
      requested: requestedEntity,
    });
    if (!access.ok) throw new ForbiddenException(ENTITY_FORBIDDEN_MESSAGE);

    // Permissions come from the effective roles only: group-wide ones plus this company's.
    const effective = new Set(access.roles);
    const permissions = new Set<Permission>();
    for (const role of user.roles) {
      if (effective.has(role.key))
        for (const p of role.permissions) permissions.add(p as Permission);
    }
    for (const r of user.entityRoles) {
      if (r.entityId === access.active?.id && effective.has(r.roleKey)) {
        for (const p of r.role.permissions) permissions.add(p as Permission);
      }
    }

    const principal: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: access.roles,
      permissions,
      managerId: user.managerId,
      sessionId,
      entityId: access.active?.id ?? null,
      entityCode: access.active?.code ?? null,
      entities: access.entities,
      groupWide: access.groupWide,
    };
    req.user = principal;
    if (cacheToken) principalCache.set(cacheToken, principal);
    this.enrichContext(principal);
    return true;
  }

  /** Enrich the ambient context so logs and audit entries carry the actor. */
  private enrichContext(principal: AuthUser): void {
    const ctx = requestContext.getStore();
    if (ctx) {
      ctx.userId = principal.id;
      ctx.role = principal.roles.join(',');
      // Every scoped query in this request is limited to this company (prisma/entity-scope.ts).
      ctx.entityScope = principal.entityId ?? NO_ENTITY;
      ctx.entityCode = principal.entityCode ?? undefined;
    }
  }
}

/** Extract a bearer token from an Authorization header. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
