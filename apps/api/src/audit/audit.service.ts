import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { newId, redact } from '@vop/shared';
import { PrismaService } from '../prisma/prisma.service';
import { currentContext } from '../common/context';
import {
  GENESIS_HASH,
  computeRowHash,
  verifyChain,
  type AuditPayload,
  type ChainRow,
  type ChainVerification,
} from './audit-hash';

export type AuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface AuditInput {
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  outcome?: AuditOutcome;
  /** Business detail / before-after diff. Redacted before storage. */
  detail?: unknown;
  actorId?: string | null;
  actorRole?: string | null;
}

// Advisory-lock key that serialises appends so the hash chain has no races.
const CHAIN_LOCK = 4242;

/**
 * Writes the append-only, hash-chained audit trail (ADR-0005). Every sensitive action calls
 * {@link append}. Appends are serialised with a transaction-scoped Postgres advisory lock so two
 * concurrent writers cannot fork the chain.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an audit entry. `opts.after` lets a caller start the entry (take the chain lock and read
   * the previous hash) in parallel with the action it records, and have the row written only once
   * that action has succeeded — if it rejects, the audit transaction rolls back and nothing is
   * written. This overlaps the audit's round trips with the action's, without weakening ordering.
   */
  async append(
    input: AuditInput,
    opts: { after?: Promise<unknown> } = {},
  ): Promise<{ id: string; rowHash: string }> {
    const ctx = currentContext();
    const id = newId();
    const at = new Date().toISOString();

    const payload: AuditPayload = {
      id,
      at,
      actorId: input.actorId ?? ctx?.userId ?? null,
      actorRole: input.actorRole ?? ctx?.role ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      detail: input.detail === undefined ? null : redact(input.detail),
      correlationId: ctx?.correlationId ?? null,
    };

    // The gating promise may reject before we await it below; mark it handled so Node doesn't flag
    // an unhandled rejection (the rejection still propagates when we await it inside the tx).
    opts.after?.catch(() => undefined);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
        const last = await tx.auditLog.findFirst({
          orderBy: { seq: 'desc' },
          select: { rowHash: true },
        });
        const prevHash = last?.rowHash ?? GENESIS_HASH;
        const rowHash = computeRowHash(payload, prevHash);

        // Hold the chain position, but only commit the row if the recorded action succeeded.
        if (opts.after) await opts.after;

        const detailData: Prisma.InputJsonValue | typeof Prisma.JsonNull =
          payload.detail === null ? Prisma.JsonNull : (payload.detail as Prisma.InputJsonValue);

        await tx.auditLog.create({
          data: {
            id,
            at: new Date(at),
            actorId: payload.actorId,
            actorRole: payload.actorRole,
            ip: ctx?.ip ?? null,
            userAgent: ctx?.userAgent ?? null,
            action: payload.action,
            entityType: payload.entityType,
            entityId: payload.entityId,
            outcome: payload.outcome as AuditOutcome,
            detail: detailData,
            correlationId: payload.correlationId,
            prevHash,
            rowHash,
          },
        });
        return { id, rowHash };
      },
      // The transaction may stay open while the gated action runs; allow for slow networks.
      { maxWait: 15_000, timeout: 60_000 },
    );
  }

  /** Recompute and verify the whole chain. Auditor-facing integrity check (ADR-0005). */
  async verify(): Promise<ChainVerification> {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
    const chain: ChainRow[] = rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      actorId: r.actorId,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      outcome: r.outcome,
      detail: r.detail ?? null,
      correlationId: r.correlationId,
      prevHash: r.prevHash,
      rowHash: r.rowHash,
    }));
    return verifyChain(chain);
  }

  /** Auditor search over the trail. Filters by actor, entity, action and date; newest first. */
  async query(filters: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: string;
    to?: string;
    skip?: number;
    take?: number;
  }): Promise<{ rows: AuditRow[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.action) where.action = { contains: filters.action };
    if (filters.from || filters.to) {
      where.at = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }
    const take = Math.min(filters.take ?? 100, 500);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip: filters.skip ?? 0,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    // seq is BigInt — serialise as string so the JSON response is valid.
    return {
      rows: rows.map((r) => ({
        seq: r.seq.toString(),
        id: r.id,
        at: r.at.toISOString(),
        actorId: r.actorId,
        actorRole: r.actorRole,
        ip: r.ip,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        outcome: r.outcome,
        correlationId: r.correlationId,
        detail: r.detail ?? null,
      })),
      total,
    };
  }
}

export interface AuditRow {
  seq: string;
  id: string;
  at: string;
  actorId: string | null;
  actorRole: string | null;
  ip: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  outcome: string;
  correlationId: string | null;
  detail: unknown;
}

/** Render audit rows as CSV (values quoted/escaped). The export action is itself audited. */
export function auditRowsToCsv(rows: AuditRow[]): string {
  const cols = [
    'seq',
    'at',
    'actorId',
    'actorRole',
    'ip',
    'action',
    'entityType',
    'entityId',
    'outcome',
    'correlationId',
  ] as const;
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = cols.join(',');
  const lines = rows.map((r) => cols.map((c) => esc(r[c])).join(','));
  return [header, ...lines].join('\r\n');
}
