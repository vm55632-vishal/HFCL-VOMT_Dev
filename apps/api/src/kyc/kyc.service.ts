import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  KYC_CHECKS,
  KYC_CHECK_META,
  PERMISSIONS,
  maskPan,
  newId,
  type KycCheckKey,
  type KycStatus,
} from '@vop/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { isCaseOwner } from '../cases/case-ownership';
import { PrismaService } from '../prisma/prisma.service';
import { KYC_PROVIDER, type KycProvider, type KycSubject } from '../providers/contracts';

interface CaseForKyc {
  id: string;
  ref: string;
  stage: string;
  createdById: string;
  onBehalfOfId: string | null;
  assigneeId: string | null;
  general: {
    legalName: string;
    signatoryName: string | null;
    signatoryMobile: string | null;
    signatoryEmail: string | null;
    signatoryPanEnc: string | null;
  } | null;
}

interface CheckRow {
  id: string;
  checkKey: string;
  status: string;
  providerRef: string | null;
  summary: string | null;
  initiatedById: string | null;
  initiatedAt: Date | null;
  updatedAt: Date;
}

const isFinal = (s: string) => s === 'passed' || s === 'failed';

/**
 * KYC & risk checks on a case's authorised signatory: Digi KYC, then Hunter, IXSite and
 * CRIF / CIBIL, one after another. Initiating starts Digi KYC; each later check starts when the one
 * before it finishes. State is advanced whenever the status is read, so no background worker is
 * needed. A failed check marks the case for manual review.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryptionService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
  ) {}

  private async loadCase(actor: AuthUser, id: string): Promise<CaseForKyc> {
    const c = await this.prisma.case.findUnique({
      where: { id },
      select: {
        id: true,
        ref: true,
        stage: true,
        createdById: true,
        onBehalfOfId: true,
        assigneeId: true,
        general: {
          select: {
            legalName: true,
            signatoryName: true,
            signatoryMobile: true,
            signatoryEmail: true,
            signatoryPanEnc: true,
          },
        },
      },
    });
    // A draft is private to its proposer.
    if (!c || (c.stage === 'draft' && !isCaseOwner(c, actor.id))) {
      throw new NotFoundException('Case not found.');
    }
    const seeAll = actor.permissions.has(PERMISSIONS.VendorReadAll);
    if (!seeAll && !isCaseOwner(c, actor.id) && c.assigneeId !== actor.id) {
      throw new ForbiddenException('Not authorized to view this case.');
    }
    return c;
  }

  private async subjectFor(c: CaseForKyc): Promise<KycSubject> {
    const g = c.general;
    if (!g?.signatoryName || !g.signatoryPanEnc) {
      throw new BadRequestException(
        "The authorised signatory's name and PAN are required before KYC can run.",
      );
    }
    return {
      name: g.signatoryName,
      pan: await this.crypto.decryptFromString(g.signatoryPanEnc),
      mobile: g.signatoryMobile ?? undefined,
      email: g.signatoryEmail ?? undefined,
    };
  }

  private async rows(caseId: string): Promise<CheckRow[]> {
    const found = await this.prisma.caseKycCheck.findMany({ where: { caseId } });
    return KYC_CHECKS.flatMap((k) => found.filter((r) => r.checkKey === k));
  }

  /** Move the run forward: poll the running check, and start the next one once the last is done. */
  private async advance(c: CaseForKyc, rows: CheckRow[]): Promise<CheckRow[]> {
    let subject: KycSubject | null = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as CheckRow;
      const key = r.checkKey as KycCheckKey;
      if (isFinal(r.status)) continue;

      if (r.status === 'pending') {
        const prev = rows[i - 1];
        if (prev && !isFinal(prev.status)) break; // wait for the previous check
        // Claim the start so two overlapping reads cannot both start the same check.
        const claimed = await this.prisma.caseKycCheck.updateMany({
          where: { id: r.id, status: 'pending' },
          data: { status: 'in_progress', initiatedAt: new Date() },
        });
        if (claimed.count === 0) break;
        subject ??= await this.subjectFor(c);
        const { ref } = await this.provider.start(key, subject);
        await this.prisma.caseKycCheck.update({ where: { id: r.id }, data: { providerRef: ref } });
        r.status = 'in_progress';
        r.providerRef = ref;
        r.initiatedAt = new Date();
      }

      if (r.status === 'in_progress') {
        if (!r.providerRef) break; // another request is still starting it
        const res = await this.provider.poll(key, r.providerRef);
        if (res.status === 'in_progress') break;
        const done = await this.prisma.caseKycCheck.updateMany({
          where: { id: r.id, status: 'in_progress' },
          data: { status: res.status, summary: res.summary ?? null },
        });
        if (done.count === 0) break;
        r.status = res.status;
        r.summary = res.summary ?? null;
        if (rows.every((x) => isFinal(x.status))) await this.onComplete(c, rows);
      }
    }
    return this.rows(c.id);
  }

  /** Runs once, by the request that finishes the last check. */
  private async onComplete(c: CaseForKyc, rows: CheckRow[]) {
    const failed = rows.filter((r) => r.status === 'failed');
    const actorId = rows[0]?.initiatedById ?? c.createdById;
    await this.audit.append({
      action: 'kyc.complete',
      entityType: 'Case',
      entityId: c.id,
      actorId,
      detail: {
        ref: c.ref,
        outcome: failed.length ? 'failed' : 'passed',
        failedChecks: failed.map((r) => r.checkKey),
      },
    });
    if (failed.length === 0) return;
    // Policy: any failed check sends the case to manual review.
    const flag = {
      key: 'kyc_failed',
      severity: 'high',
      message: `KYC / risk check failed: ${failed.map((r) => KYC_CHECK_META[r.checkKey as KycCheckKey].label).join(', ')}.`,
    };
    const existing = await this.prisma.caseVerification.findUnique({ where: { caseId: c.id } });
    const flags = Array.isArray(existing?.redFlags) ? (existing.redFlags as Prisma.JsonArray) : [];
    const merged = [...flags.filter((f) => (f as { key?: string })?.key !== 'kyc_failed'), flag];
    if (existing) {
      await this.prisma.caseVerification.update({
        where: { caseId: c.id },
        data: { reviewRequired: true, redFlags: merged as Prisma.InputJsonValue },
      });
    } else {
      await this.prisma.caseVerification.create({
        data: {
          id: newId(),
          caseId: c.id,
          reviewRequired: true,
          redFlags: merged as Prisma.InputJsonValue,
        },
      });
    }
  }

  private async view(actor: AuthUser, c: CaseForKyc, rows: CheckRow[]) {
    const g = c.general;
    // The signatory's PAN: in full for the case's own proposer (who entered it), masked for others.
    const pan = g?.signatoryPanEnc ? await this.crypto.decryptFromString(g.signatoryPanEnc) : '';
    const started = rows.length > 0;
    const overall: 'not_initiated' | 'in_progress' | 'passed' | 'failed' = !started
      ? 'not_initiated'
      : rows.some((r) => !isFinal(r.status))
        ? 'in_progress'
        : rows.some((r) => r.status === 'failed')
          ? 'failed'
          : 'passed';
    const ready = !!(g?.signatoryName && g.signatoryPanEnc);
    return {
      case: { id: c.id, ref: c.ref, legalName: g?.legalName ?? '', stage: c.stage },
      signatory: {
        name: g?.signatoryName ?? '',
        mobile: g?.signatoryMobile ?? '',
        email: g?.signatoryEmail ?? '',
        pan: isCaseOwner(c, actor.id) ? pan : maskPan(pan),
      },
      overall,
      ready,
      canInitiate:
        overall === 'not_initiated' && ready && actor.permissions.has(PERMISSIONS.KycInitiate),
      checks: KYC_CHECKS.map((key, i) => {
        const row = rows.find((r) => r.checkKey === key);
        // Before the run, Digi KYC shows "Not initiated" and the rest "Pending", as the run starts there.
        const status: KycStatus = row
          ? (row.status as KycStatus)
          : i === 0
            ? 'not_initiated'
            : 'pending';
        return {
          key,
          ...KYC_CHECK_META[key],
          status,
          initiatedAt: row?.initiatedAt ?? null,
          updatedAt: row && row.status !== 'pending' ? row.updatedAt : null,
          summary: row?.summary ?? null,
        };
      }),
    };
  }

  async summary(actor: AuthUser, id: string) {
    const c = await this.loadCase(actor, id);
    let rows = await this.rows(id);
    if (rows.some((r) => !isFinal(r.status))) rows = await this.advance(c, rows);
    return this.view(actor, c, rows);
  }

  async initiate(actor: AuthUser, id: string) {
    // A draft can be checked too: the intake form's last step runs Digi KYC before the case is
    // raised (loadCase only lets the draft's own proposer see it).
    const c = await this.loadCase(actor, id);
    await this.subjectFor(c); // signatory name + PAN must be present
    try {
      await this.prisma.caseKycCheck.createMany({
        data: KYC_CHECKS.map((checkKey) => ({
          id: newId(),
          caseId: id,
          checkKey,
          status: 'pending',
          initiatedById: actor.id,
        })),
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('KYC checks have already been started for this case.');
      }
      throw e;
    }
    await this.audit.append({
      action: 'kyc.initiate',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref: c.ref, checks: [...KYC_CHECKS], provider: this.provider.name },
    });
    const rows = await this.advance(c, await this.rows(id)); // starts Digi KYC straight away
    return this.view(actor, c, rows);
  }
}
