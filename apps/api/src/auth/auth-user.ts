import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { EntitySummary, Permission } from '@vop/shared';

/** The authenticated principal attached to a request by the SessionGuard. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  status: string;
  /** Effective roles: group-wide roles plus the roles held in the active company. */
  roles: string[];
  /** Permissions granted by {@link roles}. */
  permissions: Set<Permission>;
  managerId: string | null;
  sessionId: string;
  /** ADR-0008: the company this request works in, or null when the user has none. */
  entityId: string | null;
  entityCode: string | null;
  /** Every company the user may switch to. */
  entities: EntitySummary[];
  /** Holds a group-wide role (Super Admin, Platform Admin, Auditor). */
  groupWide: boolean;
}

/** A request that has passed authentication. */
export interface AuthedRequest {
  user?: AuthUser;
}

/** Inject the current authenticated user into a controller handler. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);
