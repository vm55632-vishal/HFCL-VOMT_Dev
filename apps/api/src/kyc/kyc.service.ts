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
  KYC_GROUP_CHECKS,
  PERMISSIONS,
  RoleKey,
  kycGroupOf,
  maskPan,
  newId,
  type KycCheckKey,
  type KycGroup,
  type KycStatus,
} from '@vop/shared';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';
import { PinoLoggerService } from '../common/logging/logger.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { isCaseOwner } from '../cases/case-ownership';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  KYC_PROVIDER,
  type EmailProvider,
  type KycProvider,
  type KycSubject,
} from '../providers/contracts';

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

/** A check that has finished: it is no longer polled. */
const isFinal = (s: string) => s === 'passed' || s === 'failed' || s === 'incomplete';

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Only the FCU team sees and runs the risk checks (Hunter, IXSite, CRIF / CIBIL). */
const isFcu = (actor: AuthUser) => actor.roles.includes(RoleKey.Fcu);

/**
 * KYC & risk checks on a case's authorised signatory, in two independent groups:
 * - Digi KYC: started by the proposer (also on a draft, from the intake form). The vendor is
 *   emailed to complete it; the result is completed, rejected or incomplete (with the reason).
 *   An incomplete Digi KYC can be sent again.
 * - Risk checks: Hunter, IXSite and CRIF / CIBIL, one after another, started and seen only by FCU.
 * State is advanced whenever the status is read, so no background worker is needed. A failed check
 * marks the case for manual review.
 */
@Injectable()
export class KycService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryptionService,
    private readonly logger: PinoLoggerService,
    @Inject(KYC_PROVIDER) private readonly provider: KycProvider,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
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

  /** Move each group forward: poll a running check, and start the next one once the last is done. */
  private async advance(c: CaseForKyc, rows: CheckRow[]): Promise<CheckRow[]> {
    let subject: KycSubject | null = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] as CheckRow;
      const key = r.checkKey as KycCheckKey;
      if (isFinal(r.status)) continue;
      const group = kycGroupOf(key);

      if (r.status === 'pending') {
        // Within a group the checks run one after another.
        const prev = rows[i - 1];
        if (prev && kycGroupOf(prev.checkKey as KycCheckKey) === group && !isFinal(prev.status)) {
          continue;
        }
        // Claim the start so two overlapping reads cannot both start the same check.
        const claimed = await this.prisma.caseKycCheck.updateMany({
          where: { id: r.id, status: 'pending' },
          data: { status: 'in_progress', initiatedAt: new Date() },
        });
        if (claimed.count === 0) continue;
        subject ??= await this.subjectFor(c);
        const { ref } = await this.provider.start(key, subject);
        await this.prisma.caseKycCheck.update({ where: { id: r.id }, data: { providerRef: ref } });
        r.status = 'in_progress';
        r.providerRef = ref;
        r.initiatedAt = new Date();
      }

      if (r.status === 'in_progress') {
        if (!r.providerRef) continue; // another request is still starting it
        const res = await this.provider.poll(key, r.providerRef);
        if (res.status === 'in_progress') continue;
        const done = await this.prisma.caseKycCheck.updateMany({
          where: { id: r.id, status: 'in_progress' },
          data: { status: res.status, summary: res.summary ?? null },
        });
        if (done.count === 0) continue;
        r.status = res.status;
        r.summary = res.summary ?? null;
        const groupRows = rows.filter((x) => kycGroupOf(x.checkKey as KycCheckKey) === group);
        if (groupRows.every((x) => isFinal(x.status))) await this.onComplete(c, group, groupRows);
      }
    }
    return this.rows(c.id);
  }

  /** Runs once per group, by the request that finishes its last check. */
  private async onComplete(c: CaseForKyc, group: KycGroup, rows: CheckRow[]) {
    const failed = rows.filter((r) => r.status === 'failed');
    const actorId = rows[0]?.initiatedById ?? c.createdById;
    await this.audit.append({
      action: group === 'digi' ? 'kyc.digi_complete' : 'kyc.complete',
      entityType: 'Case',
      entityId: c.id,
      actorId,
      detail: {
        ref: c.ref,
        outcome: failed.length
          ? 'failed'
          : rows.some((r) => r.status === 'incomplete')
            ? 'incomplete'
            : 'passed',
        failedChecks: failed.map((r) => r.checkKey),
      },
    });
    if (failed.length === 0) return;
    // Policy: any failed check sends the case to manual review.
    const flagKey = group === 'digi' ? 'digi_kyc_failed' : 'kyc_failed';
    const flag = {
      key: flagKey,
      severity: 'high',
      message: `KYC / risk check failed: ${failed.map((r) => KYC_CHECK_META[r.checkKey as KycCheckKey].label).join(', ')}.`,
    };
    const existing = await this.prisma.caseVerification.findUnique({ where: { caseId: c.id } });
    const flags = Array.isArray(existing?.redFlags) ? (existing.redFlags as Prisma.JsonArray) : [];
    const merged = [...flags.filter((f) => (f as { key?: string })?.key !== flagKey), flag];
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

  private checkView(key: KycCheckKey, row: CheckRow | undefined, first: boolean) {
    // Before a run, the first check of a group shows "Not initiated" and the rest "Pending".
    const status: KycStatus = row ? (row.status as KycStatus) : first ? 'not_initiated' : 'pending';
    return {
      key,
      ...KYC_CHECK_META[key],
      status,
      initiatedAt: row?.initiatedAt ?? null,
      updatedAt: row && row.status !== 'pending' ? row.updatedAt : null,
      summary: row?.summary ?? null,
    };
  }

  private async view(actor: AuthUser, c: CaseForKyc, rows: CheckRow[]) {
    const g = c.general;
    // The signatory's PAN: in full for the case's own proposer (who entered it), masked for others.
    const pan = g?.signatoryPanEnc ? await this.crypto.decryptFromString(g.signatoryPanEnc) : '';
    const ready = !!(g?.signatoryName && g.signatoryPanEnc);
    const mayInitiate = actor.permissions.has(PERMISSIONS.KycInitiate);

    const digiRow = rows.find((r) => r.checkKey === 'digi_kyc');
    const out: Record<string, unknown> = {
      case: { id: c.id, ref: c.ref, legalName: g?.legalName ?? '', stage: c.stage },
      signatory: {
        name: g?.signatoryName ?? '',
        mobile: g?.signatoryMobile ?? '',
        email: g?.signatoryEmail ?? '',
        pan: isCaseOwner(c, actor.id) ? pan : maskPan(pan),
      },
      ready,
      digi: {
        ...this.checkView('digi_kyc', digiRow, true),
        // The vendor is emailed to complete Digi KYC; an incomplete one can be sent again.
        canInitiate:
          mayInitiate &&
          ready &&
          !!g?.signatoryEmail &&
          (!digiRow || digiRow.status === 'incomplete'),
      },
    };

    // Risk checks: only the FCU team sees them (the response carries nothing for anyone else).
    if (isFcu(actor)) {
      const riskRows = rows.filter((r) => kycGroupOf(r.checkKey as KycCheckKey) === 'risk');
      out.risk = {
        overall:
          riskRows.length === 0
            ? 'not_initiated'
            : riskRows.some((r) => !isFinal(r.status))
              ? 'in_progress'
              : riskRows.some((r) => r.status === 'failed')
                ? 'failed'
                : 'passed',
        canInitiate: mayInitiate && ready && c.stage !== 'draft' && riskRows.length === 0,
        checks: KYC_GROUP_CHECKS.risk.map((key, i) =>
          this.checkView(
            key,
            riskRows.find((r) => r.checkKey === key),
            i === 0,
          ),
        ),
      };
    }
    return out;
  }

  async summary(actor: AuthUser, id: string) {
    const c = await this.loadCase(actor, id);
    let rows = await this.rows(id);
    if (rows.some((r) => !isFinal(r.status))) rows = await this.advance(c, rows);
    return this.view(actor, c, rows);
  }

  /**
   * Start Digi KYC: the provider is asked to verify the signatory, and the vendor (the authorised
   * signatory's email) is sent the request to complete it. Allowed again when the last one was
   * left incomplete.
   */
  async initiateDigi(actor: AuthUser, id: string) {
    const c = await this.loadCase(actor, id);
    const subject = await this.subjectFor(c);
    const to = c.general?.signatoryEmail?.trim();
    if (!to) {
      throw new BadRequestException(
        "Enter the authorised signatory's email: the Digi KYC request is sent there.",
      );
    }
    const existing = await this.prisma.caseKycCheck.findFirst({
      where: { caseId: id, checkKey: 'digi_kyc' },
    });
    if (existing && existing.status !== 'incomplete') {
      throw new ConflictException('Digi KYC has already been started for this case.');
    }
    const { ref, link } = await this.provider.start('digi_kyc', subject);
    const data = {
      status: 'in_progress',
      providerRef: ref,
      summary: null,
      initiatedById: actor.id,
      initiatedAt: new Date(),
    };
    let claimed: boolean;
    if (existing) {
      // Sending again: only from the incomplete state, so two clicks cannot both resend.
      const r = await this.prisma.caseKycCheck.updateMany({
        where: { id: existing.id, status: 'incomplete' },
        data,
      });
      claimed = r.count === 1;
    } else {
      try {
        await this.prisma.caseKycCheck.create({
          data: { id: newId(), caseId: id, checkKey: 'digi_kyc', ...data },
        });
        claimed = true;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        claimed = false;
      }
    }
    if (!claimed) {
      throw new ConflictException('Digi KYC has already been started for this case.');
    }

    const sent = await this.sendDigiKycEmail(c, to, link);
    // The mock provider completes on its own, so a dev machine without a mail server can still test.
    if (!sent && this.provider.name !== 'mock') {
      // Nobody can complete a request that never arrived: leave it incomplete so it can be resent.
      await this.prisma.caseKycCheck.updateMany({
        where: { caseId: id, checkKey: 'digi_kyc' },
        data: {
          status: 'incomplete',
          summary: 'The Digi KYC email could not be sent to the vendor. Send it again.',
        },
      });
    }
    await this.audit.append({
      action: existing ? 'kyc.digi_resend' : 'kyc.initiate',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref: c.ref, checks: ['digi_kyc'], provider: this.provider.name, emailSent: sent },
    });
    return this.view(actor, c, await this.rows(id));
  }

  /** The vendor's request to complete Digi KYC. No PAN or other identifiers in the body. */
  private async sendDigiKycEmail(c: CaseForKyc, to: string, link?: string): Promise<boolean> {
    const name = c.general?.signatoryName || 'Sir / Madam';
    const vendor = c.general?.legalName ?? '';
    const intro = `${vendor ? `As part of onboarding ${vendor}, ` : ''}we need to verify your identity as the authorised signatory through Digi KYC.`;
    const how = link
      ? 'Please complete your Digi KYC using this secure link:'
      : 'Our KYC partner will contact you on this email address and your registered mobile number with the steps to complete it.';
    const text = [
      `Dear ${name},`,
      intro,
      link ? `${how} ${link}` : how,
      `Reference: ${c.ref}`,
    ].join('\n\n');
    const html = [
      `<p>Dear ${esc(name)},</p>`,
      `<p>${esc(intro)}</p>`,
      link ? `<p>${esc(how)} <a href="${esc(link)}">${esc(link)}</a></p>` : `<p>${esc(how)}</p>`,
      `<p>Reference: ${esc(c.ref)}</p>`,
    ].join('');
    try {
      await this.email.send({ to, subject: `Complete your Digi KYC (${c.ref})`, html, text });
      return true;
    } catch (err) {
      this.logger.warn(`Digi KYC email failed: ${(err as Error).message}`, 'KycService');
      return false;
    }
  }

  /** Start Hunter, IXSite and CRIF / CIBIL, one after another. FCU only, on a raised case. */
  async initiateRisk(actor: AuthUser, id: string) {
    if (!isFcu(actor)) {
      throw new ForbiddenException('Only the FCU team can run the risk checks.');
    }
    const c = await this.loadCase(actor, id);
    if (c.stage === 'draft') {
      throw new BadRequestException('Raise the case before running the risk checks.');
    }
    await this.subjectFor(c); // signatory name + PAN must be present
    try {
      await this.prisma.caseKycCheck.createMany({
        data: KYC_GROUP_CHECKS.risk.map((checkKey) => ({
          id: newId(),
          caseId: id,
          checkKey,
          status: 'pending',
          initiatedById: actor.id,
        })),
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('The risk checks have already been started for this case.');
      }
      throw e;
    }
    await this.audit.append({
      action: 'kyc.risk_initiate',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref: c.ref, checks: [...KYC_GROUP_CHECKS.risk], provider: this.provider.name },
    });
    const rows = await this.advance(c, await this.rows(id)); // starts Hunter straight away
    return this.view(actor, c, rows);
  }
}
