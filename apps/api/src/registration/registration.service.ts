import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { isGroupRole, newId } from '@vop/shared';
import { EntitiesService } from '../entities/entities.service';
import { homeEntityFor } from '../auth/entity-access';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { evaluateRegistrationApproval } from '../authz/sod';
import { principalCache } from '../auth/principal-cache';

const EXPIRY_DAYS = 7;
const daysFromNow = (d: number, from = Date.now()): Date => new Date(from + d * 86_400_000);

export interface SelfRegistrationInput {
  requestedRoles: string[];
  /** ADR-0008: the company the access is for. Defaults to the one matching the email domain. */
  entityCode?: string;
  justification: string;
  department?: string;
  designation?: string;
  employeeId?: string;
}

export interface Approver {
  id: string;
  isPlatformAdmin: boolean;
}

export type Decision = 'approve' | 'reject' | 'request-info';

@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entities: EntitiesService,
  ) {}

  /** The company an access request is for: the one asked for, else the email domain's. */
  private async targetEntity(email: string, entityCode?: string): Promise<string | null> {
    if (entityCode) {
      const e = await this.entities.byCode(entityCode);
      if (!e.active) throw new BadRequestException(`${e.name} is not accepting access requests.`);
      return e.id;
    }
    return homeEntityFor(email, await this.entities.active())?.id ?? null;
  }

  /** The requester's reporting chain, upward — for SoD conflict checks. */
  private async reportingChainUp(userId: string): Promise<string[]> {
    const chain: string[] = [];
    const seen = new Set<string>([userId]);
    let cursor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { managerId: true },
    });
    while (cursor?.managerId && !seen.has(cursor.managerId)) {
      chain.push(cursor.managerId);
      seen.add(cursor.managerId);
      cursor = await this.prisma.user.findUnique({
        where: { id: cursor.managerId },
        select: { managerId: true },
      });
    }
    return chain;
  }

  private async existingOpenRequest(userId: string): Promise<{ id: string } | null> {
    return this.prisma.registrationRequest.findFirst({
      where: { userId, status: { in: ['PENDING', 'INFO_REQUESTED', 'ESCALATED'] } },
      select: { id: true },
    });
  }

  /** A user (PENDING after JIT/self-register) requests access; routed to their manager. */
  async selfRegister(userId: string, input: SelfRegistrationInput): Promise<{ id: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        department: input.department ?? user.department,
        designation: input.designation ?? user.designation,
        employeeId: input.employeeId ?? user.employeeId,
      },
    });

    const open = await this.existingOpenRequest(userId);
    if (open) throw new BadRequestException('You already have a pending access request.');

    if (input.requestedRoles.some(isGroupRole)) {
      throw new BadRequestException(
        'Group-wide roles are granted by an administrator, not through an access request.',
      );
    }
    const entityId = await this.targetEntity(user.email, input.entityCode);
    if (!entityId) {
      throw new BadRequestException('Choose the company you need access to.');
    }

    const req = await this.prisma.registrationRequest.create({
      data: {
        id: newId(),
        userId,
        requestedRoles: input.requestedRoles,
        justification: input.justification,
        entityId,
        status: 'PENDING',
        managerId: user.managerId,
        expiresAt: daysFromNow(EXPIRY_DAYS),
      },
    });
    await this.audit.append({
      action: 'registration.submit',
      entityType: 'RegistrationRequest',
      entityId: req.id,
      actorId: userId,
      detail: { requestedRoles: input.requestedRoles, entityId },
    });
    return { id: req.id };
  }

  /** Seed an access request for a user newly created by JIT SSO provisioning. */
  async createFromJit(
    userId: string,
    roleKeys: string[],
    profile: { department?: string; designation?: string },
  ): Promise<void> {
    if (await this.existingOpenRequest(userId)) return;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const req = await this.prisma.registrationRequest.create({
      data: {
        id: newId(),
        userId,
        requestedRoles: roleKeys.filter((k) => !isGroupRole(k)),
        justification: 'Auto-created on first SSO login (JIT).',
        entityId: await this.targetEntity(user.email),
        status: 'PENDING',
        managerId: user.managerId,
        expiresAt: daysFromNow(EXPIRY_DAYS),
      },
    });
    await this.audit.append({
      action: 'registration.jit_created',
      entityType: 'RegistrationRequest',
      entityId: req.id,
      actorId: userId,
      detail: { mappedRoles: roleKeys, department: profile.department },
    });
  }

  /** Requests awaiting a given manager (their direct reports' open requests). */
  async pendingForManager(managerId: string) {
    return this.prisma.registrationRequest.findMany({
      where: { managerId, status: { in: ['PENDING', 'INFO_REQUESTED', 'ESCALATED'] } },
      include: {
        user: { select: { id: true, name: true, email: true, department: true } },
        entity: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Manager decision on a request, enforcing Segregation of Duties. */
  async decide(
    requestId: string,
    approver: Approver,
    decision: Decision,
    note?: string,
    rolesOverride?: string[],
  ): Promise<void> {
    const req = await this.prisma.registrationRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (!['PENDING', 'INFO_REQUESTED', 'ESCALATED'].includes(req.status)) {
      throw new BadRequestException('This request has already been decided.');
    }

    const sod = evaluateRegistrationApproval({
      approverId: approver.id,
      requesterId: req.userId,
      requesterManagerId: req.managerId,
      approverIsPlatformAdmin: approver.isPlatformAdmin,
      approverReportingChainUp: await this.reportingChainUp(approver.id),
    });
    if (!sod.allowed) throw new ForbiddenException(sod.reason);

    if (decision === 'approve') {
      // ADR-0008: the roles are granted in the request's company only. Group-wide roles are never
      // granted through a request; an administrator assigns them.
      const roleKeys = (rolesOverride ?? req.requestedRoles).filter((k) => !isGroupRole(k));
      const requester = await this.prisma.user.findUniqueOrThrow({
        where: { id: req.userId },
        select: { email: true },
      });
      const entityId = req.entityId ?? (await this.targetEntity(requester.email));
      if (!entityId) {
        throw new BadRequestException(
          'This request does not say which company it is for. Ask the requester to submit it again.',
        );
      }
      await this.prisma.$transaction([
        this.prisma.userEntityRole.deleteMany({ where: { userId: req.userId, entityId } }),
        this.prisma.userEntityRole.createMany({
          data: roleKeys.map((roleKey) => ({ id: newId(), userId: req.userId, entityId, roleKey })),
          skipDuplicates: true,
        }),
        this.prisma.user.update({ where: { id: req.userId }, data: { status: 'ACTIVE' } }),
      ]);
      principalCache.invalidateUser(req.userId);
      await this.prisma.registrationRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          decidedById: approver.id,
          decidedAt: new Date(),
          decisionNote: note ?? null,
        },
      });
      await this.audit.append({
        action: 'registration.approve',
        entityType: 'RegistrationRequest',
        entityId: requestId,
        actorId: approver.id,
        detail: { grantedRoles: roleKeys, requester: req.userId, entityId },
      });
      return;
    }

    const status = decision === 'reject' ? 'REJECTED' : 'INFO_REQUESTED';
    await this.prisma.registrationRequest.update({
      where: { id: requestId },
      data: {
        status,
        decidedById: decision === 'reject' ? approver.id : null,
        decidedAt: decision === 'reject' ? new Date() : null,
        decisionNote: note ?? null,
      },
    });
    await this.audit.append({
      action: decision === 'reject' ? 'registration.reject' : 'registration.request_info',
      entityType: 'RegistrationRequest',
      entityId: requestId,
      actorId: approver.id,
      detail: { note },
    });
  }

  /**
   * Expire stale requests and escalate to the manager's manager. Run by a scheduled job
   * (BullMQ) in production; callable directly for tests. Returns the number processed.
   */
  async expireStale(now = new Date()): Promise<number> {
    const stale = await this.prisma.registrationRequest.findMany({
      where: { status: { in: ['PENDING', 'INFO_REQUESTED'] }, expiresAt: { lt: now } },
    });
    for (const req of stale) {
      const grandManagerId = req.managerId
        ? ((
            await this.prisma.user.findUnique({
              where: { id: req.managerId },
              select: { managerId: true },
            })
          )?.managerId ?? null)
        : null;

      if (grandManagerId) {
        await this.prisma.registrationRequest.update({
          where: { id: req.id },
          data: {
            status: 'ESCALATED',
            managerId: grandManagerId,
            expiresAt: daysFromNow(EXPIRY_DAYS, now.getTime()),
          },
        });
        await this.audit.append({
          action: 'registration.escalate',
          entityType: 'RegistrationRequest',
          entityId: req.id,
          detail: { to: grandManagerId },
        });
      } else {
        await this.prisma.registrationRequest.update({
          where: { id: req.id },
          data: { status: 'EXPIRED' },
        });
        await this.audit.append({
          action: 'registration.expire',
          entityType: 'RegistrationRequest',
          entityId: req.id,
        });
      }
    }
    return stale.length;
  }
}
