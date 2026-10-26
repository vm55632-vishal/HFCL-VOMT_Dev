import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RoleKey, UserStatus, isGroupRole, newId } from '@vop/shared';
import { EntitiesService } from '../entities/entities.service';
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
  // Group-wide roles (ADR-0008)
  roles: { select: { key: true, label: true } },
  // Roles held in each company
  entityRoles: {
    select: {
      roleKey: true,
      role: { select: { label: true } },
      entity: { select: { code: true, name: true } },
    },
    orderBy: { entity: { sortOrder: 'asc' } },
  },
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
  /** Group-wide roles: Super Admin, Platform Admin, Auditor. */
  groupRoleKeys?: string[];
  /** The full set of roles the user holds in one company (replaces that company's roles). */
  entityRoles?: { entityCode: string; roleKeys: string[] };
  status?: UserStatus;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly entities: EntitiesService,
  ) {}

  async list(filter: UserFilter) {
    const where: Prisma.UserWhereInput = {};
    if (filter.q) {
      where.OR = [
        { name: { contains: filter.q, mode: 'insensitive' } },
        { email: { contains: filter.q, mode: 'insensitive' } },
      ];
    }
    if (filter.role) {
      where.AND = [
        {
          OR: [
            { roles: { some: { key: filter.role } } },
            { entityRoles: { some: { roleKey: filter.role } } },
          ],
        },
      ];
    }
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

    const changingGroupRoles = changes.groupRoleKeys !== undefined;
    const changingRoles = changingGroupRoles || changes.entityRoles !== undefined;

    if (changes.groupRoleKeys?.some((k) => !isGroupRole(k))) {
      throw new BadRequestException(
        'Only Super Admin, Platform Admin and Auditor apply across the group. Assign other roles per company.',
      );
    }
    if (changes.entityRoles?.roleKeys.some(isGroupRole)) {
      throw new BadRequestException('Group-wide roles cannot be assigned to a single company.');
    }
    const entity = changes.entityRoles
      ? await this.entities.byCode(changes.entityRoles.entityCode)
      : null;
    if (changes.entityRoles?.roleKeys.length) {
      const known = await this.prisma.role.count({
        where: { key: { in: changes.entityRoles.roleKeys } },
      });
      if (known !== new Set(changes.entityRoles.roleKeys).size) {
        throw new BadRequestException('One of the roles does not exist.');
      }
    }
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
    const losesSuperAdmin =
      changingGroupRoles && !(changes.groupRoleKeys ?? []).includes(RoleKey.SuperAdmin);
    if (wasActiveSuperAdmin && (deactivating || losesSuperAdmin)) {
      if ((await this.activeSuperAdminCount()) <= 1) {
        throw new BadRequestException('Cannot remove the last active Super Admin.');
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (changes.name !== undefined) data.name = changes.name;
    if (changes.status !== undefined) data.status = changes.status;
    if (changingGroupRoles) {
      data.roles = { set: (changes.groupRoleKeys ?? []).map((key) => ({ key })) };
    }
    const company = entity && changes.entityRoles;
    const after = company
      ? (
          await this.prisma.$transaction([
            this.prisma.userEntityRole.deleteMany({
              where: { userId: targetId, entityId: entity.id },
            }),
            this.prisma.userEntityRole.createMany({
              data: [...new Set(company.roleKeys)].map((roleKey) => ({
                id: newId(),
                userId: targetId,
                entityId: entity.id,
                roleKey,
              })),
            }),
            this.prisma.user.update({ where: { id: targetId }, data, select: SAFE_SELECT }),
          ])
        )[2]
      : await this.prisma.user.update({ where: { id: targetId }, data, select: SAFE_SELECT });

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
        before: {
          status: before.status,
          roles: before.roles.map((r) => r.key),
          entityRoles: before.entityRoles.map((r) => `${r.entity.code}:${r.roleKey}`),
        },
        after: {
          status: after.status,
          roles: after.roles.map((r) => r.key),
          entityRoles: after.entityRoles.map((r) => `${r.entity.code}:${r.roleKey}`),
        },
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
