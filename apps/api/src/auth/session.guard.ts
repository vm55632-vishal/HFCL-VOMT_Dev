import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserStatus, type Permission } from '@vop/shared';
import type { AppConfig } from '@vop/config';
import { IS_PUBLIC_KEY } from '../authz/public.decorator';
import { SessionService } from './session.service';
import { SupabaseAuthService } from './supabase.service';
import { PrismaService } from '../prisma/prisma.service';
import { APP_CONFIG } from '../config/config.module';
import { Inject } from '@nestjs/common';
import { requestContext } from '../common/context';
import { principalCache } from './principal-cache';
import type { AuthUser, AuthedRequest } from './auth-user';

/**
 * Global authentication guard (deny-by-default). Every route requires a valid session unless
 * marked @Public. Loads the user with roles, computes the effective permission set from the
 * (editable) role definitions, blocks deactivated/suspended users, and attaches the principal to
 * the request and the ambient log/audit context.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & AuthedRequest>();

    // Resolve the authenticated principal id + session id from the active auth driver.
    let userId: string;
    let sessionId: string;

    let cacheToken: string | null = null;
    if (this.config.auth.driver === 'supabase') {
      const token = bearerToken(req.headers.authorization);
      if (!token) throw new UnauthorizedException('Authentication required.');

      // Fast path: a recently resolved principal for this exact token (see principal-cache.ts).
      const cached = principalCache.get(token);
      if (cached) {
        req.user = cached;
        this.enrichContext(cached);
        return true;
      }
      cacheToken = token;
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

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user) throw new UnauthorizedException('Session invalid or expired.');
    if (user.status === UserStatus.Deactivated || user.status === UserStatus.Suspended) {
      throw new ForbiddenException('Account is not active.');
    }

    const permissions = new Set<Permission>();
    for (const role of user.roles) {
      for (const p of role.permissions) permissions.add(p as Permission);
    }

    const principal: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.roles.map((r) => r.key),
      permissions,
      managerId: user.managerId,
      sessionId,
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
    }
  }
}

/** Extract a bearer token from an Authorization header. */
function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
