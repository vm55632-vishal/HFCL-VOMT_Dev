import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS, type Permission } from '@vop/shared';
import { PermissionsGuard } from './permissions.guard';
import type { AuthUser } from '../auth/auth-user';

function user(perms: Permission[]): AuthUser {
  return {
    id: '1',
    email: 'a@b.local',
    name: 'A',
    status: 'ACTIVE',
    roles: [],
    permissions: new Set(perms),
    managerId: null,
    entityId: null,
    entityCode: null,
    entities: [],
    groupWide: false,
    sessionId: 's1',
  };
}

function ctxWith(u: AuthUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
    getHandler: () => null,
    getClass: () => null,
  } as unknown as ExecutionContext;
}

function guardRequiring(required: Permission[] | undefined): PermissionsGuard {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard (deny-by-default)', () => {
  it('allows a route with no declared permissions for any authenticated user', () => {
    expect(guardRequiring(undefined).canActivate(ctxWith(user([])))).toBe(true);
    expect(guardRequiring([]).canActivate(ctxWith(user([])))).toBe(true);
  });

  it('allows when the user holds every required permission', () => {
    const g = guardRequiring([PERMISSIONS.UserRead, PERMISSIONS.AuditRead]);
    expect(g.canActivate(ctxWith(user([PERMISSIONS.UserRead, PERMISSIONS.AuditRead])))).toBe(true);
  });

  // --- negative cases ---
  it('denies when the user is missing a required permission', () => {
    const g = guardRequiring([PERMISSIONS.UserManage]);
    expect(() => g.canActivate(ctxWith(user([PERMISSIONS.UserRead])))).toThrow(ForbiddenException);
  });

  it('denies when the user holds none of the required permissions', () => {
    const g = guardRequiring([PERMISSIONS.SettingsManage]);
    expect(() => g.canActivate(ctxWith(user([])))).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user but permissions are required', () => {
    const g = guardRequiring([PERMISSIONS.UserRead]);
    expect(() => g.canActivate(ctxWith(undefined))).toThrow(ForbiddenException);
  });
});
