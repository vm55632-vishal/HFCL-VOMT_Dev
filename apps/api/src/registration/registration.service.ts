import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { newId } from '@vop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { evaluateRegistrationApproval } from '../authz/sod';
import { principalCache } from '../auth/principal-cache';

const EXPIRY_DAYS = 7;
const daysFromNow = (d: number, from = Date.now()): Date => new Date(from + d * 86_400_000);

export interface SelfRegistrationInput {
  requestedRoles: string[];
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
  ) {}

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

    const req = await this.prisma.registrationRequest.create({
      data: {
        id: newId(),
        userId,
        requestedRoles: input.requestedRoles,
        justification: input.justification,
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
      detail: { requestedRoles: input.requestedRoles },
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
        requestedRoles: roleKeys,
        justification: 'Auto-created on first SSO login (JIT).',
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
      include: { user: { select: { id: true, name: true, email: true, department: true } } },
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
      const roleKeys = rolesOverride ?? req.requestedRoles;
      await this.prisma.user.update({
        where: { id: req.userId },
        data: {
          status: 'ACTIVE',
          roles: { set: roleKeys.map((key) => ({ key })) },
        },
      });
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
        detail: { grantedRoles: roleKeys, requester: req.userId },
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
