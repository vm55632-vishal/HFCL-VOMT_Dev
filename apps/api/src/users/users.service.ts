import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoleKey, UserStatus } from '@vop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { principalCache } from '../auth/principal-cache';

const SAFE_SELECT = {
  id: true,
  email: true,
  name: true,
  status: true,
  employeeId: true,
  department: true,
  designation: true,
  managerId: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { key: true, label: true } },
} satisfies Prisma.UserSelect;

export interface UserFilter {
  q?: string;
  role?: string;
  status?: string;
  skip?: number;
  take?: number;
}

export interface UserChanges {
  name?: string;
  roleKeys?: string[];
  status?: UserStatus;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  async list(filter: UserFilter) {
    const where: Prisma.UserWhereInput = {};
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { email: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    if (filter.role) where.roles = { some: { key: filter.role } };
    if (filter.status) where.status = filter.status as UserStatus;

    const take = Math.min(filter.take ?? 50, 200);
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip ?? 0,
        take,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows, total };
  }

  async getOne(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
  }

  /** Count active Super Admins — used to block removing the last one. */
  private async activeSuperAdminCount(): Promise<number> {
    return this.prisma.user.count({
      where: { status: UserStatus.Active, roles: { some: { key: RoleKey.SuperAdmin } } },
    });
  }

  async update(targetId: string, changes: UserChanges, actorId: string) {
    const before = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetId },
      select: SAFE_SELECT,
    });

    const changingRoles = changes.roleKeys !== undefined;
    const deactivating =
      changes.status !== undefined &&
      changes.status !== UserStatus.Active &&
      before.status === UserStatus.Active;

    // Self-protection guards.
    if (actorId === targetId && changingRoles) {
      throw new ForbiddenException('You cannot change your own roles.');
    }
    if (actorId === targetId && deactivating) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    // Never remove the last active Super Admin.
    const wasActiveSuperAdmin =
      before.status === UserStatus.Active && before.roles.some((r) => r.key === RoleKey.SuperAdmin);
    const losesSuperAdmin = changingRoles && !(changes.roleKeys ?? []).includes(RoleKey.SuperAdmin);
    if (wasActiveSuperAdmin && (deactivating || losesSuperAdmin)) {
      if ((await this.activeSuperAdminCount()) <= 1) {
        throw new BadRequestException('Cannot remove the last active Super Admin.');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (changes.name !== undefined) data.name = changes.name;
    if (changes.status !== undefined) data.status = changes.status;
    if (changingRoles) data.roles = { set: (changes.roleKeys ?? []).map((key) => ({ key })) };

    const after = await this.prisma.user.update({
      where: { id: targetId },
      data,
      select: SAFE_SELECT,
    });

    // Revoke sessions when authorization changed (role change or deactivation).
    principalCache.invalidateUser(targetId);
    if (changingRoles || deactivating) {
      await this.sessions.revokeAllForUser(targetId);
    }

    await this.audit.append({
      action: 'user.update',
      entityType: 'User',
      entityId: targetId,
      actorId,
      detail: {
        before: { status: before.status, roles: before.roles.map((r) => r.key) },
        after: { status: after.status, roles: after.roles.map((r) => r.key) },
      },
    });
    return after;
  }

  async forceLogout(targetId: string, actorId: string): Promise<{ revoked: number }> {
    principalCache.invalidateUser(targetId);
    const revoked = await this.sessions.revokeAllForUser(targetId);
    await this.audit.append({
      action: 'user.force_logout',
      entityType: 'User',
      entityId: targetId,
      actorId,
      detail: { revoked },
    });
    return { revoked };
  }
}
