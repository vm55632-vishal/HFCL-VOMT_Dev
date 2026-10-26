import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTION_NEEDS_NOTE,
  assessRisk,
  dueDate,
  dueDiligencePack,
  evaluateTransition,
  getStage,
  maskAccount,
  maskPan,
  rcLimitsFromVehicles,
  newId,
  PERMISSIONS,
  activeReviewStages,
  isApprovalLevel,
  nextAfterApproval,
  normaliseApprovalLevels,
  REVIEW_STAGES,
  SAP_STAGE,
  STAGE_LABELS,
  STAGE_ROLE,
  type ApprovalLevel,
  type ReviewStage,
  type RiskInput,
  type TierKey,
  type WorkflowAction,
} from '@vop/shared';
import { Prisma } from '@prisma/client';
import { TtlCache } from '../common/ttl-cache';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldEncryptionService } from '../crypto/field-encryption.service';
import { BlindIndexService } from '../crypto/blind-index.service';
import { WorkflowsService } from '../workflow/workflows.service';
import { CategoriesService } from '../master-data/categories.service';
import { ErpService } from '../lifecycle/erp.service';
import { NotificationsService } from '../lifecycle/notifications.service';
import {
  VerificationCacheService,
  type VerificationKind,
} from '../verification/verification-cache.service';
import type { AuthUser } from '../auth/auth-user';
import { TeamStructureService, TEAM_FIELDS, type TeamOverrides } from './team-structure.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/contracts';
import { caseOwnerIds, isCaseOwner, ownedBy } from './case-ownership';

/** Workflow stage keys that have their own per-stage reporting table. */
type StageTable = 'draft' | 'infosec' | 'fcu' | 'operation' | 'sap' | 'legal' | 'l1' | 'l2' | 'l3';

/**
 * Prisma's `contains` does not escape SQL LIKE wildcards, so a typed `%` or `_` would match
 * everything / any character. Escape them (and the escape character) so search text is literal.
 */
export function likeEscape(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Document type for the final FCU due-diligence report (uploaded through the documents API). */
export const FCU_REPORT_DOC_TYPE = 'fcu_dd_report';

/** What the FCU records on its review screen. */
export interface FcuFindings {
  residentialAddressCheck: boolean;
  officeAddressCheck: boolean;
  overallFinding: 'positive' | 'negative';
  comment?: string;
}

/** Stage-specific data stored in the per-stage table's JSON column. */
function stageData(
  stageKey: string,
  extra?: { agreement?: string; fcu?: FcuFindings },
): Prisma.InputJsonValue | undefined {
  if (stageKey === 'legal' && extra?.agreement) return { agreement: extra.agreement.trim() };
  if (stageKey === 'fcu' && extra?.fcu) {
    return {
      residentialAddressCheck: extra.fcu.residentialAddressCheck,
      officeAddressCheck: extra.fcu.officeAddressCheck,
      overallFinding: extra.fcu.overallFinding,
      comment: extra.fcu.comment?.trim() || null,
    };
  }
  return undefined;
}

interface CapturedResponse {
  kind: string;
  payloadEnc: string;
  verified: boolean;
  status: string | null;
  identifierBlindIndex?: string | null;
}

/** Strip identifiers a reviewer doesn't need from a captured registry response. */
export function sanitiseRegistry(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  delete out.pan; // never expose the full PAN number
  delete out.cached;
  const details = payload.details as Record<string, unknown> | undefined;
  if (kind === 'bank' && details) {
    const acct = String(details.accountNumber ?? '');
    const { bankRRN: _rrn, message: _msg, accountNumber: _acct, ...rest } = details;
    void _rrn;
    void _msg;
    void _acct;
    out.details = { ...rest, accountNumber: acct ? '••••' + acct.slice(-4) : undefined };
  }
  if (kind === 'pan' && payload.fields) {
    const {
      dob: _d,
      gender: _g,
      maskedAadhaar: _m,
      ...fields
    } = payload.fields as Record<string, unknown>;
    void _d;
    void _g;
    void _m;
    out.fields = fields;
  }
  return out;
}

interface PartnerRow {
  id: string;
  name: string;
  dobEnc: string;
  maritalStatus: string;
  gender: string;
  fatherName: string;
  spouseName: string | null;
  panEnc: string;
  residenceAddressEnc: string;
  mobileEnc: string;
  pincode: string;
}

/** Stages a case ends in. It leaves every queue once it reaches one of these. */
const CLOSED_STAGES = ['approved', 'rejected', 'cancelled'];

export const BULK_ACTIONS = ['hold', 'resume', 'cancel', 'reopen', 'delete'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** The human-readable message inside a Nest HTTP exception (string, or { message: string | string[] }). */
function httpMessage(e: HttpException): string {
  const r = e.getResponse();
  if (typeof r === 'string') return r;
  const m = (r as { message?: unknown }).message;
  return Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : e.message;
}

export interface PartnerInput {
  name: string;
  dob: string; // YYYY-MM-DD
  maritalStatus: string;
  gender: string;
  fatherName: string;
  spouseName?: string;
  pan: string;
  address: string;
  mobile: string;
  pincode: string;
}

export interface ReferenceInput {
  contactName: string;
  businessName: string;
  registeredAddress: string;
  contactNumber: string;
  email: string;
}
interface ReferenceRow extends ReferenceInput {
  id: string;
}

export interface RcLimitInput {
  financerName: string;
  rcLimit: number | null;
  numberOfVehicles: number | null;
  remarks?: string;
}
interface RcLimitRow {
  id: string;
  financerName: string;
  rcLimit: { toString(): string } | null;
  numberOfVehicles: number | null;
  sanctionLoanLimit: { toString(): string } | null;
  creditLimitFigures: { toString(): string } | null;
  creditLimitWords: string | null;
  remarks: string | null;
}

export type DraftPartnerInput = Partial<PartnerInput>;
/** A work-in-progress case: only the category is required; everything else may be blank or partial. */
export type DraftInput = Omit<Partial<CaseCreateInput>, 'partners' | 'references' | 'rcLimits'> & {
  categoryKey: string;
  partners?: DraftPartnerInput[];
  references?: Partial<ReferenceInput>[];
  rcLimits?: Partial<RcLimitInput>[];
};

export interface CaseCreateInput {
  categoryKey: string;
  partners?: PartnerInput[];
  references?: ReferenceInput[];
  rcLimits?: RcLimitInput[];
  /** Team-structure fields the proposer changed from the master (applied on the server). */
  teamOverrides?: TeamOverrides;
  /** Raise the case for this proposer (same company). Defaults to the signed-in person. */
  proposerId?: string;
  subCategoryKey?: string;
  legalName: string;
  tradeName?: string;
  businessAddress?: string;
  addressCountry?: string;
  addressState?: string;
  addressCity?: string;
  addressPostalCode?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  signatoryName?: string;
  signatoryEmail?: string;
  signatoryMobile?: string;
  signatoryPan?: string;
  pan?: string;
  gstin?: string;
  ifsc?: string;
  bankAccount?: string;
  bankName?: string;
  branch?: string;
  businessUnit?: string;
  costCentre?: string;
  spend?: number;
  contractMonths?: number;
  natureOfService?: string;
  justification?: string;
  coiDeclared?: boolean;
  coiDetails?: string;
  // risk inputs
  dataAccess?: string;
  systemAccess?: string;
  subcontract?: string;
  delivery?: string;
  screening?: string;
  conflict?: string;
  litigation?: string;
  insurance?: string;
  certifications?: string;
  // information-security questionnaire
  isecItHardware?: boolean;
  isecItSoftware?: boolean;
  isecAccessSystem?: boolean;
  isecAccessNetwork?: boolean;
  isecAccessApps?: boolean;
  isecAccessPii?: boolean;
}

export interface DuplicateFlag {
  field: string;
  ref: string;
  legalName: string;
}

@Injectable()
export class CasesService {
  // Sub-category display names (a tiny, slow-changing table) for the case list, cached briefly so
  // listing cases doesn't pay an extra database round trip.
  private readonly subCategoryNames = new TtlCache<Map<string, string>>(30_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryptionService,
    private readonly blind: BlindIndexService,
    private readonly workflows: WorkflowsService,
    private readonly categories: CategoriesService,
    private readonly erp: ErpService,
    private readonly notifications: NotificationsService,
    private readonly verificationCache: VerificationCacheService,
    private readonly team: TeamStructureService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private readonly logger = new Logger(CasesService.name);

  // ---------- helpers ----------

  private riskInputFrom(c: CaseCreateInput, enhancedDueDiligence: boolean): RiskInput {
    return {
      spend: c.spend,
      dataAccess: c.dataAccess,
      systemAccess: c.systemAccess,
      subcontract: c.subcontract,
      delivery: c.delivery,
      screening: c.screening,
      conflict: c.conflict,
      litigation: c.litigation,
      insurance: c.insurance,
      certifications: c.certifications,
      enhancedDueDiligence,
    };
  }

  /**
   * Next case reference: VOMT- plus a six-digit running number (VOMT-000001, VOMT-000002, ...). The
   * number comes from a database sequence, so it is never handed out twice, even when the newest
   * case has been deleted (the audit log would otherwise show one ID for two different cases).
   */
  private async nextRef(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('case_ref_seq') AS n`;
    return `VOMT-${String(Number(rows[0]?.n ?? 1)).padStart(6, '0')}`;
  }

  private canSeeAll(actor: AuthUser): boolean {
    return actor.permissions.has(PERMISSIONS.VendorReadAll);
  }

  /** ADR-0008: the company a new case belongs to, which is always the request's company. */
  private requireEntity(actor: AuthUser): string {
    if (!actor.entityId) {
      throw new ForbiddenException(
        'You do not have access to any company, so you cannot raise a case.',
      );
    }
    return actor.entityId;
  }

  private assertCanSee(
    actor: AuthUser,
    c: { createdById: string; assigneeId: string | null; onBehalfOfId?: string | null },
  ): void {
    if (this.canSeeAll(actor)) return;
    if (isCaseOwner(c, actor.id) || c.assigneeId === actor.id) return;
    throw new ForbiddenException('Not authorized to view this case.');
  }

  /** Reject a sub-category that doesn't belong to the chosen category (no-op when none given). */
  private async assertSubCategory(input: { categoryKey: string; subCategoryKey?: string }) {
    if (!input.subCategoryKey) return;
    const sc = await this.prisma.vendorSubCategory.findUnique({
      where: { key: input.subCategoryKey },
    });
    if (!sc || sc.categoryKey !== input.categoryKey) {
      throw new BadRequestException('Invalid sub-category for the selected category.');
    }
  }

  /** Rows for rc_limits (nested under the case). */
  private buildRcLimitRows(rows?: Partial<RcLimitInput>[]) {
    return (rows ?? []).map((r, i) => {
      // The sanction / credit limits are derived from the vehicle count, never trusted from the client.
      const d = rcLimitsFromVehicles(r.numberOfVehicles);
      return {
        id: newId(),
        position: i,
        financerName: (r.financerName ?? '').trim(),
        rcLimit: r.rcLimit ?? null,
        numberOfVehicles: r.numberOfVehicles ?? null,
        sanctionLoanLimit: d.sanctionLoanLimit,
        creditLimitFigures: d.creditLimitFigures,
        creditLimitWords: d.creditLimitWords,
        remarks: r.remarks?.trim() || null,
      };
    });
  }

  /** Rows for vendor_references (nested under the case). Plain text, like the other contact details. */
  private buildReferenceRows(refs?: Partial<ReferenceInput>[]) {
    return (refs ?? []).map((r, i) => ({
      id: newId(),
      position: i,
      contactName: (r.contactName ?? '').trim(),
      businessName: (r.businessName ?? '').trim(),
      registeredAddress: (r.registeredAddress ?? '').trim(),
      contactNumber: (r.contactNumber ?? '').trim(),
      email: (r.email ?? '').trim(),
    }));
  }

  /** Rows for partner_details (nested under the case). DOB, PAN, address and mobile are encrypted. */
  private async buildPartnerRows(partners?: DraftPartnerInput[]) {
    return Promise.all(
      (partners ?? []).map(async (p, i) => {
        const pan = (p.pan ?? '').trim().toUpperCase();
        return {
          id: newId(),
          position: i,
          name: (p.name ?? '').trim(),
          maritalStatus: p.maritalStatus ?? '',
          gender: p.gender ?? '',
          fatherName: (p.fatherName ?? '').trim(),
          spouseName: p.spouseName?.trim() || null,
          pincode: p.pincode ?? '',
          dobEnc: await this.crypto.encryptToString(p.dob ?? ''),
          panEnc: await this.crypto.encryptToString(pan),
          panBlindIndex: pan ? this.blind.index(pan) : '',
          residenceAddressEnc: await this.crypto.encryptToString((p.address ?? '').trim()),
          mobileEnc: await this.crypto.encryptToString(p.mobile ?? ''),
        };
      }),
    );
  }

  /** Build the vendor master-detail row (case_general) from intake input, encrypting identifiers. */
  private async buildGeneralData(input: CaseCreateInput): Promise<Record<string, unknown>> {
    return {
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      businessAddress: input.businessAddress ?? null,
      addressCountry: input.addressCountry?.trim() || null,
      addressState: input.addressState?.trim() || null,
      addressCity: input.addressCity?.trim() || null,
      addressPostalCode: input.addressPostalCode?.trim() || null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      signatoryName: input.signatoryName ?? null,
      signatoryEmail: input.signatoryEmail ?? null,
      signatoryMobile: input.signatoryMobile ?? null,
      signatoryPanEnc: input.signatoryPan
        ? await this.crypto.encryptToString(input.signatoryPan)
        : null,
      signatoryPanBlindIndex: input.signatoryPan ? this.blind.index(input.signatoryPan) : null,
      panEnc: input.pan ? await this.crypto.encryptToString(input.pan) : null,
      panBlindIndex: input.pan ? this.blind.index(input.pan) : null,
      gstin: input.gstin ?? null,
      gstinBlindIndex: input.gstin ? this.blind.index(input.gstin) : null,
      ifsc: input.ifsc ?? null,
      bankName: input.bankName ?? null,
      branch: input.branch ?? null,
      bankAccountEnc: input.bankAccount
        ? await this.crypto.encryptToString(input.bankAccount)
        : null,
      bankBlindIndex: input.bankAccount ? this.blind.index(input.bankAccount) : null,
      businessUnit: input.businessUnit ?? null,
      costCentre: input.costCentre ?? null,
      spend: input.spend ?? 0,
      contractMonths: input.contractMonths ?? null,
      natureOfService: input.natureOfService ?? null,
      justification: input.justification ?? '',
      coiDeclared: input.coiDeclared ?? false,
      coiDetails: input.coiDetails ?? null,
      dataAccess: input.dataAccess ?? null,
      systemAccess: input.systemAccess ?? null,
      subcontract: input.subcontract ?? null,
      delivery: input.delivery ?? null,
      screening: input.screening ?? null,
      conflict: input.conflict ?? null,
      litigation: input.litigation ?? null,
      insurance: input.insurance ?? null,
      certifications: input.certifications ?? null,
      isecItHardware: input.isecItHardware ?? false,
      isecItSoftware: input.isecItSoftware ?? false,
      isecAccessSystem: input.isecAccessSystem ?? false,
      isecAccessNetwork: input.isecAccessNetwork ?? false,
      isecAccessApps: input.isecAccessApps ?? false,
      isecAccessPii: input.isecAccessPii ?? false,
    };
  }

  /**
   * Upsert the per-stage reporting row for a case. `patch` carries whatever changed — pass
   * `enteredAt`/status:'pending' on entry, or status/decision/remark/completedAt on completion.
   * Stages without a dedicated table (procurement/risk/finance/approval) are a no-op.
   */
  private async writeStage(
    caseId: string,
    stageKey: string,
    patch: {
      status?: string;
      decision?: string | null;
      remark?: string | null;
      actionedById?: string | null;
      enteredAt?: Date;
      completedAt?: Date;
      data?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    const args = {
      where: { caseId },
      create: {
        id: newId(),
        caseId,
        status: patch.status ?? 'pending',
        decision: patch.decision ?? null,
        remark: patch.remark ?? null,
        actionedById: patch.actionedById ?? null,
        enteredAt: patch.enteredAt ?? new Date(),
        completedAt: patch.completedAt ?? null,
        ...(patch.data !== undefined ? { data: patch.data } : {}),
      },
      update: patch,
    };
    switch (stageKey as StageTable) {
      case 'draft':
        await this.prisma.caseDraft.upsert(args);
        break;
      case 'infosec':
        await this.prisma.caseInfosec.upsert(args);
        break;
      case 'fcu':
        await this.prisma.caseFcu.upsert(args);
        break;
      case 'operation':
        await this.prisma.caseOperation.upsert(args);
        break;
      case 'sap':
        await this.prisma.caseSap.upsert(args);
        break;
      case 'legal':
        await this.prisma.caseLegal.upsert(args);
        break;
      case 'l1':
        await this.prisma.caseL1.upsert(args);
        break;
      case 'l2':
        await this.prisma.caseL2.upsert(args);
        break;
      case 'l3':
        await this.prisma.caseL3.upsert(args);
        break;
      default:
        break; // no dedicated table for this stage
    }
  }

  /**
   * Persist the PAN/GST/bank/MSME responses that were shown on the form into case_verification_response.
   * Reuses the same-day verification cache (already populated during data entry) so no extra external
   * calls are made. Payloads are envelope-encrypted; the identifier is kept only as a blind index.
   */
  private async captureResponses(
    caseId: string,
    actor: AuthUser,
    ids: {
      pan?: string | null;
      gstin?: string | null;
      bankAccount?: string | null;
      ifsc?: string | null;
    },
    opts: { skipUnchanged?: boolean } = {},
  ): Promise<void> {
    const scope = `user:${actor.id}`;
    // Autosave calls this on every save: skip what is already stored for the same number.
    const stored = opts.skipUnchanged
      ? new Map(
          (
            await this.prisma.caseVerificationResponse.findMany({
              where: { caseId },
              select: { kind: true, identifierBlindIndex: true },
            })
          ).map((r) => [r.kind, r.identifierBlindIndex]),
        )
      : null;
    const save = async (kind: VerificationKind, identifier: string, cacheKey: string) => {
      if (stored && stored.get(kind) === this.blind.index(identifier)) return;
      try {
        const hit = await this.verificationCache.get<Record<string, unknown>>(
          scope,
          kind,
          cacheKey,
        );
        if (!hit) return;
        const verified = kind === 'bank' ? hit.active === true : hit.verified === true;
        const details = (hit.details ?? {}) as Record<string, unknown>;
        const status =
          kind === 'bank'
            ? ((hit.activeStatus as string) ?? null)
            : kind === 'gst'
              ? ((details.gstStatus as string) ?? null)
              : kind === 'pan'
                ? ((hit.status as string) ?? null)
                : verified
                  ? 'registered'
                  : null;
        const payloadEnc = await this.crypto.encryptToString(JSON.stringify(hit));
        const identifierBlindIndex = this.blind.index(identifier);
        await this.prisma.caseVerificationResponse.upsert({
          where: { caseId_kind: { caseId, kind } },
          create: {
            id: newId(),
            caseId,
            kind,
            identifierBlindIndex,
            status,
            verified,
            payloadEnc,
            capturedById: actor.id,
          },
          update: {
            identifierBlindIndex,
            status,
            verified,
            payloadEnc,
            capturedById: actor.id,
            capturedAt: new Date(),
          },
        });
      } catch {
        /* best-effort capture; never blocks case creation */
      }
    };
    // Independent lookups + upserts: run them concurrently instead of one after another.
    const jobs: Promise<void>[] = [];
    if (ids.pan) {
      jobs.push(save('pan', ids.pan, ids.pan), save('msme', ids.pan, ids.pan));
    }
    if (ids.gstin) jobs.push(save('gst', ids.gstin, ids.gstin));
    if (ids.bankAccount && ids.ifsc) {
      const acct = ids.bankAccount.replace(/\s+/g, '');
      const ifsc = ids.ifsc.trim().toUpperCase();
      jobs.push(save('bank', ids.bankAccount, `${acct}|${ifsc}`));
    }
    await Promise.all(jobs);
  }

  /**
   * Present a case with PAN/bank masked unless the actor may view sensitive data (audited). The
   * vendor detail lives in the `general` relation; it is flattened onto the top level so the API
   * response shape is unchanged for callers (the web app reads `c.legalName`, `c.pan`, …).
   */
  private async present(
    c: Record<string, unknown>,
    actor: AuthUser,
  ): Promise<Record<string, unknown>> {
    const reveal = actor.permissions.has(PERMISSIONS.VendorViewSensitive);
    const g = (c.general ?? {}) as Record<string, unknown>;
    const partnerRows = (c.partners as PartnerRow[] | undefined) ?? [];
    // Revealing sensitive fields is audited, but the write is not on the page's critical path: it is
    // five database round trips, and a viewer should not wait for them. It finishes in the
    // background (failures are logged, and the next open tries again). Every change to a case is
    // still audited before it completes.
    if (reveal && g.panEnc) {
      void this.auditSensitiveView(actor, c.id as string, partnerRows.length > 0).catch(
        (e: unknown) =>
          this.logger.error(
            `Could not record a sensitive view of case ${String(c.ref)}: ${(e as Error).message}`,
          ),
      );
    }
    // Flatten general under the case: case fields (id/createdAt/updatedAt/stage/…) win over
    // general's own id/timestamps.
    const out: Record<string, unknown> = { ...g, ...c };
    delete out.general;
    delete out.caseId;

    // Collapse the per-stage relation rows into a `stages` map + the active review set, so the UI
    // can render each parallel stage's status and the SAP completion indicators.
    const stageRel: Record<string, string> = {
      draft: 'draftStage',
      infosec: 'infosecStage',
      fcu: 'fcuStage',
      operation: 'operationStage',
      legal: 'legalStage',
      l1: 'l1Stage',
      l2: 'l2Stage',
      l3: 'l3Stage',
      sap: 'sapStage',
    };
    const stages: Record<string, Record<string, unknown> | null> = {};
    for (const [key, rel] of Object.entries(stageRel)) {
      stages[key] = (c[rel] as Record<string, unknown> | null) ?? null;
      delete out[rel];
    }
    // Resolve the reviewer name for each actioned stage, so the UI can show "Reviewed by …".
    const actorIds = [
      ...new Set(
        Object.values(stages)
          .map((s) => s?.actionedById as string | undefined)
          .filter((v): v is string => !!v),
      ),
    ];
    const namesDone: Promise<void> = actorIds.length
      ? this.prisma.user
          .findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
          .then((users) => {
            const nameById = new Map(users.map((u) => [u.id, u.name]));
            for (const s of Object.values(stages)) {
              if (s?.actionedById) {
                s.actionedByName = nameById.get(s.actionedById as string) ?? null;
              }
            }
          })
      : Promise.resolve();
    namesDone.catch(() => undefined);
    out.stages = stages;
    out.reviewStages = activeReviewStages(Boolean(c.infosecRequired));
    out.approvalLevels = normaliseApprovalLevels(c.approvalLevels as string[] | undefined);

    // Registry results captured when the vendor was entered (PAN / GST / bank / MSME), decrypted
    // for the "full details" view. Data minimisation: the full PAN number, Aadhaar details and the
    // bank reference are dropped, and the bank account number is masked.
    const captured = (c.responses as CapturedResponse[] | undefined) ?? [];
    const registry: Record<string, unknown> = {};
    await Promise.all(
      captured.map(async (r) => {
        try {
          const payload = JSON.parse(await this.crypto.decryptFromString(r.payloadEnc)) as Record<
            string,
            unknown
          >;
          const currentIndex =
            r.kind === 'gst'
              ? g.gstinBlindIndex
              : r.kind === 'bank'
                ? g.bankBlindIndex
                : g.panBlindIndex;
          registry[r.kind] = {
            verified: r.verified,
            status: r.status,
            ...sanitiseRegistry(r.kind, payload),
            // False when the PAN / GSTIN / account changed after this result was captured.
            current: !!r.identifierBlindIndex && r.identifierBlindIndex === currentIndex,
          };
        } catch {
          /* an undecryptable payload is simply omitted */
        }
      }),
    );
    delete out.responses;
    out.registry = registry;
    delete out.panEnc;
    delete out.panBlindIndex;
    delete out.bankAccountEnc;
    delete out.bankBlindIndex;
    delete out.gstinBlindIndex;
    delete out.signatoryPanEnc;
    delete out.signatoryPanBlindIndex;

    // PAN, bank account and signatory PAN are revealed only to viewers holding VendorViewSensitive
    // (granted to the proposer and the review roles); everyone else sees the masked form. Every
    // reveal is audited. Values stay encrypted at rest and masked in logs/exports regardless.
    if (reveal && g.panEnc) {
      const pan = await this.crypto.decryptFromString(g.panEnc as string);
      out.pan = pan;
      out.panMasked = maskPan(pan);
    } else {
      out.pan = g.panEnc ? '••••••••••' : null;
    }
    if (reveal && g.bankAccountEnc) {
      out.bankAccount = await this.crypto.decryptFromString(g.bankAccountEnc as string);
    } else {
      out.bankAccount = g.bankAccountEnc ? maskAccount('0000') : null;
    }
    // Management structure: full details only for viewers allowed to see sensitive data; everyone
    // else gets just name / gender / marital status with the PAN masked (the rest is personal data).
    out.partners = await Promise.all(
      partnerRows.map(async (p) =>
        reveal
          ? {
              id: p.id,
              name: p.name,
              dob: await this.crypto.decryptFromString(p.dobEnc),
              maritalStatus: p.maritalStatus,
              gender: p.gender,
              fatherName: p.fatherName,
              spouseName: p.spouseName,
              pan: await this.crypto.decryptFromString(p.panEnc),
              address: await this.crypto.decryptFromString(p.residenceAddressEnc),
              mobile: await this.crypto.decryptFromString(p.mobileEnc),
              pincode: p.pincode,
            }
          : {
              id: p.id,
              name: p.name,
              gender: p.gender,
              maritalStatus: p.maritalStatus,
              pan: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022',
            },
      ),
    );
    out.references = ((c.vendorReferences as ReferenceRow[] | undefined) ?? []).map((r) => ({
      id: r.id,
      contactName: r.contactName,
      businessName: r.businessName,
      registeredAddress: r.registeredAddress,
      contactNumber: r.contactNumber,
      email: r.email,
    }));
    delete out.vendorReferences;
    const ts = c.teamStructure as Record<string, unknown> | null | undefined;
    out.teamStructure = ts ? Object.fromEntries(TEAM_FIELDS.map((k) => [k, ts[k] ?? ''])) : null;
    out.teamOverriddenFields = (ts?.overriddenFields as string[] | null | undefined) ?? [];
    out.rcLimits = ((c.rcLimits as RcLimitRow[] | undefined) ?? []).map((r) => ({
      id: r.id,
      financerName: r.financerName,
      rcLimit: r.rcLimit == null ? '' : r.rcLimit.toString(),
      numberOfVehicles: r.numberOfVehicles == null ? '' : String(r.numberOfVehicles),
      sanctionLoanLimit: r.sanctionLoanLimit == null ? '' : r.sanctionLoanLimit.toString(),
      creditLimitFigures: r.creditLimitFigures == null ? '' : r.creditLimitFigures.toString(),
      creditLimitWords: r.creditLimitWords ?? '',
      remarks: r.remarks ?? '',
    }));
    if (reveal && g.signatoryPanEnc) {
      const sp = await this.crypto.decryptFromString(g.signatoryPanEnc as string);
      out.signatoryPan = sp;
      out.signatoryPanMasked = maskPan(sp);
    } else {
      out.signatoryPan = g.signatoryPanEnc ? '••••••••••' : null;
    }
    await namesDone;
    return out;
  }

  /**
   * Record that a viewer saw a case's sensitive fields. One entry per viewer and case in any five
   * minutes: opening the same case again, or moving between its tabs, is the same viewing session.
   */
  private readonly sensitiveViews = new Map<string, number>();
  private async auditSensitiveView(actor: AuthUser, caseId: string, partners: boolean) {
    const key = `${actor.id}:${caseId}`;
    const now = Date.now();
    const seen = this.sensitiveViews.get(key);
    if (seen !== undefined && now - seen < 5 * 60_000) return;
    this.sensitiveViews.set(key, now); // set first, so two overlapping opens write one entry
    if (this.sensitiveViews.size > 5000) {
      for (const [k, t] of this.sensitiveViews)
        if (now - t >= 5 * 60_000) this.sensitiveViews.delete(k);
    }
    try {
      await this.audit.append({
        action: 'case.view_sensitive',
        entityType: 'Case',
        entityId: caseId,
        actorId: actor.id,
        detail: { field: 'pan', ...(partners ? { partners: true } : {}) },
      });
    } catch (e) {
      this.sensitiveViews.delete(key); // not recorded, so the next open must try again
      throw e;
    }
  }

  /** Find existing cases sharing PAN / GSTIN / bank / email / phone (flag, never block). */
  private async detectDuplicates(
    idx: {
      pan?: string | null;
      gstin?: string | null;
      bank?: string | null;
      email?: string | null;
      phone?: string | null;
    },
    excludeId?: string,
  ): Promise<DuplicateFlag[]> {
    const or: Record<string, unknown>[] = [];
    if (idx.pan) or.push({ panBlindIndex: idx.pan });
    if (idx.gstin) or.push({ gstinBlindIndex: idx.gstin });
    if (idx.bank) or.push({ bankBlindIndex: idx.bank });
    if (idx.email) or.push({ contactEmail: idx.email });
    if (idx.phone) or.push({ contactPhone: idx.phone });
    if (!or.length) return [];
    // Vendor identifiers now live on case_general; join back to the case for its ref.
    const rows = await this.prisma.caseGeneral.findMany({
      where: { OR: or, ...(excludeId ? { caseId: { not: excludeId } } : {}) },
      select: {
        legalName: true,
        panBlindIndex: true,
        gstinBlindIndex: true,
        bankBlindIndex: true,
        contactEmail: true,
        contactPhone: true,
        case: { select: { ref: true } },
      },
    });
    const flags: DuplicateFlag[] = [];
    for (const r of rows) {
      const ref = r.case.ref;
      if (idx.pan && r.panBlindIndex === idx.pan)
        flags.push({ field: 'PAN', ref, legalName: r.legalName });
      else if (idx.gstin && r.gstinBlindIndex === idx.gstin)
        flags.push({ field: 'GSTIN', ref, legalName: r.legalName });
      else if (idx.bank && r.bankBlindIndex === idx.bank)
        flags.push({ field: 'bank account', ref, legalName: r.legalName });
      else if (idx.email && r.contactEmail === idx.email)
        flags.push({ field: 'email', ref, legalName: r.legalName });
      else if (idx.phone && r.contactPhone === idx.phone)
        flags.push({ field: 'phone', ref, legalName: r.legalName });
    }
    return flags;
  }

  // ---------- lifecycle ----------

  async create(actor: AuthUser, input: CaseCreateInput) {
    const entityId = this.requireEntity(actor);
    const proposer = await this.team.proposerFor(actor, input.proposerId);
    const onBehalfOfId = proposer.id === actor.id ? null : proposer.id;
    const panIdx = input.pan ? this.blind.index(input.pan) : null;
    const gstIdx = input.gstin ? this.blind.index(input.gstin) : null;
    const bankIdx = input.bankAccount ? this.blind.index(input.bankAccount) : null;
    const id = newId();

    // Phase A — independent lookups run in parallel. Against a remote database every query is a
    // network round trip, so doing these one after another was the main cause of slow submits.
    const [category, , ref, generalData, partnerRows, teamRow, duplicates] = await Promise.all([
      this.categories.get(input.categoryKey),
      this.assertSubCategory(input),
      this.nextRef(),
      this.buildGeneralData(input),
      this.buildPartnerRows(input.partners),
      this.team.resolve(proposer, input.teamOverrides),
      // The new case doesn't exist yet, so it can't match itself — no exclusion needed.
      this.detectDuplicates({
        pan: panIdx,
        gstin: gstIdx,
        bank: bankIdx,
        email: input.contactEmail,
        phone: input.contactPhone,
      }),
    ]);
    const published = await this.workflows.getPublished(category.workflowKey);

    const risk = assessRisk(this.riskInputFrom(input, category.enhancedDueDiligence));
    const tier = risk.tier;
    const pack = dueDiligencePack(risk, this.riskInputFrom(input, category.enhancedDueDiligence));

    // Information-security questionnaire: any "yes" adds InfoSec to the parallel review set.
    const isec = {
      isecItHardware: input.isecItHardware ?? false,
      isecItSoftware: input.isecItSoftware ?? false,
      isecAccessSystem: input.isecAccessSystem ?? false,
      isecAccessNetwork: input.isecAccessNetwork ?? false,
      isecAccessApps: input.isecAccessApps ?? false,
      isecAccessPii: input.isecAccessPii ?? false,
    };
    const infosecRequired = Object.values(isec).some(Boolean);
    // Submitting the case fans it out to the parallel reviewers (FCU/Operation/Legal, + InfoSec
    // when flagged). The case sits in the "review" phase until every active stage is approved.
    const stages = activeReviewStages(infosecRequired);
    // Approval levels (L1/L2/L3) the category uses; the case keeps them even if the category changes.
    const approvalLevels = normaliseApprovalLevels(category.approvalLevels);

    // Phase B — the case, its vendor detail, checklist and activity in one atomic transaction.
    // The audit entry starts in parallel (lock + previous hash) and is written only once this
    // commits, so its round trips overlap the insert instead of following it.
    const caseCreated = Promise.resolve(
      this.prisma.case.create({
        data: {
          id,
          ref,
          entityId,
          onBehalfOfId,
          categoryKey: input.categoryKey,
          subCategoryKey: input.subCategoryKey ?? null,
          workflowKey: published.key,
          workflowVersion: published.version,
          stage: 'review',
          tier,
          riskScore: risk.score,
          createdById: actor.id,
          lastUpdatedById: actor.id,
          infosecRequired,
          approvalLevels,
          general: {
            create: { id: newId(), ...generalData } as Prisma.CaseGeneralCreateWithoutCaseInput,
          },
          partners: { create: partnerRows },
          vendorReferences: { create: this.buildReferenceRows(input.references) },
          rcLimits: { create: this.buildRcLimitRows(input.rcLimits) },
          ...(teamRow ? { teamStructure: { create: { id: newId(), ...teamRow } } } : {}),
          checklist: {
            create: pack.map((it) => ({
              id: newId(),
              itemId: it.id,
              label: it.label,
              role: it.role,
            })),
          },
          activity: {
            create: [
              { id: newId(), actorId: actor.id, action: 'created', toStage: 'review' },
              {
                id: newId(),
                actorId: actor.id,
                action: 'submitted_for_review',
                toStage: 'review',
                note: `Parallel review opened: ${stages.join(', ')}.${
                  approvalLevels.length
                    ? ` Then approval by ${approvalLevels.map((l) => l.toUpperCase()).join(' → ')}.`
                    : ''
                }`,
              },
            ],
          },
        },
      }),
    );

    const auditWritten = this.audit.append(
      {
        action: 'case.create',
        entityType: 'Case',
        entityId: id,
        actorId: actor.id,
        detail: {
          ref,
          tier,
          category: input.categoryKey,
          duplicateFlags: duplicates.length,
          infosecRequired,
          approvalLevels,
          teamOverridden: teamRow.overriddenFields,
          ...(onBehalfOfId ? { onBehalfOf: proposer.email } : {}),
        },
      },
      { after: caseCreated },
    );
    auditWritten.catch(() => undefined); // surfaced below if the case itself succeeded
    await caseCreated;

    // Phase C — open each active parallel stage, seed the (gated) SAP row, and persist the
    // PAN/GST/bank/MSME responses shown on the form, in parallel with finishing the audit entry.
    const openedAt = new Date();
    await Promise.all([
      ...stages.map((s) => this.writeStage(id, s, { status: 'pending', enteredAt: openedAt })),
      ...approvalLevels.map((l) => this.writeStage(id, l, { status: 'waiting' })),
      this.writeStage(id, SAP_STAGE, { status: 'waiting' }),
      this.captureResponses(id, actor, {
        pan: input.pan,
        gstin: input.gstin,
        bankAccount: input.bankAccount,
        ifsc: input.ifsc,
      }),
      auditWritten,
    ]);

    return {
      id,
      ref,
      tier,
      riskScore: risk.score,
      drivers: risk.drivers,
      duplicates,
      infosecRequired,
    };
  }

  /** The parallel review stages that are active for a case (InfoSec only when flagged). */
  private activeStagesFor(c: { infosecRequired: boolean }): ReviewStage[] {
    return activeReviewStages(c.infosecRequired);
  }

  /** Read the per-stage status rows for the active review stages of a case. */
  private async stageStatuses(
    caseId: string,
    stages: ReviewStage[],
  ): Promise<Record<string, string>> {
    const rows = await Promise.all(
      stages.map(async (s) => [s, await this.readStage(caseId, s)] as const),
    );
    const out: Record<string, string> = {};
    for (const [s, row] of rows) out[s] = row?.status ?? 'pending';
    return out;
  }

  private async readStage(caseId: string, stageKey: string): Promise<{ status: string } | null> {
    switch (stageKey as ReviewStage | ApprovalLevel | typeof SAP_STAGE) {
      case 'infosec':
        return this.prisma.caseInfosec.findUnique({ where: { caseId } });
      case 'fcu':
        return this.prisma.caseFcu.findUnique({ where: { caseId } });
      case 'operation':
        return this.prisma.caseOperation.findUnique({ where: { caseId } });
      case 'legal':
        return this.prisma.caseLegal.findUnique({ where: { caseId } });
      case 'sap':
        return this.prisma.caseSap.findUnique({ where: { caseId } });
      case 'l1':
        return this.prisma.caseL1.findUnique({ where: { caseId } });
      case 'l2':
        return this.prisma.caseL2.findUnique({ where: { caseId } });
      case 'l3':
        return this.prisma.caseL3.findUnique({ where: { caseId } });
      default:
        return null;
    }
  }

  /**
   * A parallel reviewer (InfoSec/FCU/Operation/Legal) acts on their own stage. Send-back reopens
   * only that stage for the proposer; reject fails the whole case; when every active stage is
   * approved the case moves to its first approval level (L1/L2/L3), or to the SAP confirmation gate
   * when it uses none. An approval level acts the same way once it is current; approving it moves
   * the case to its next level, then to SAP. `extra.agreement` is stored for Legal.
   */
  async stageDecision(
    actor: AuthUser,
    id: string,
    stageKey: ReviewStage | ApprovalLevel,
    decision: 'approve' | 'reject' | 'sendback',
    note?: string,
    extra?: { agreement?: string; fcu?: FcuFindings },
  ) {
    const isLevel = isApprovalLevel(stageKey);
    if (!isLevel && !REVIEW_STAGES.includes(stageKey)) {
      throw new BadRequestException('Unknown review stage.');
    }
    // The case, this stage's row and (for FCU) the uploaded report are independent reads.
    const [c, current, fcuReports] = await Promise.all([
      this.prisma.case.findUnique({ where: { id } }),
      this.readStage(id, stageKey),
      stageKey === 'fcu' && decision === 'approve'
        ? this.prisma.document.count({
            where: { caseId: id, docType: FCU_REPORT_DOC_TYPE, status: 'CLEAN' },
          })
        : Promise.resolve(0),
    ]);
    if (!c) throw new NotFoundException('Case not found.');

    const owns =
      actor.roles.includes(STAGE_ROLE[stageKey]) ||
      actor.permissions.has(PERMISSIONS.WorkflowManage);
    if (!owns) {
      throw new ForbiddenException(
        `Only the ${STAGE_LABELS[stageKey] ?? stageKey} reviewer can act on this stage.`,
      );
    }

    if (CLOSED_STAGES.includes(c.stage)) {
      throw new BadRequestException('This case is closed, so it can no longer be reviewed.');
    }
    if (c.onHold) {
      throw new BadRequestException(
        'This case is on hold. It has to be resumed before it can be reviewed.',
      );
    }
    const active = this.activeStagesFor(c);
    const levels = normaliseApprovalLevels(c.approvalLevels);
    if (isLevel ? !levels.includes(stageKey) : !active.includes(stageKey as ReviewStage)) {
      throw new BadRequestException('This stage is not part of this case’s review.');
    }
    // Approval levels run one after another: only the level the case is on can act.
    if (!current || current.status !== 'pending' || (isLevel && c.stage !== stageKey)) {
      throw new BadRequestException('This stage is not awaiting your review.');
    }
    if ((decision === 'reject' || decision === 'sendback') && !note?.trim()) {
      throw new BadRequestException('A remark is required to reject or send back a stage.');
    }
    // FCU can only be approved with its findings recorded and the final DD report uploaded.
    if (stageKey === 'fcu' && decision === 'approve') {
      if (!extra?.fcu) {
        throw new BadRequestException(
          'Record the FCU findings (address checks and overall finding) before approving.',
        );
      }
      if (fcuReports === 0) {
        throw new BadRequestException(
          'Upload the final FCU due-diligence report before approving.',
        );
      }
    }

    const status =
      decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'sent_back';
    // Record the decision and the activity entry together.
    await Promise.all([
      this.writeStage(id, stageKey, {
        status,
        decision,
        remark: note?.trim() || null,
        actionedById: actor.id,
        completedAt: new Date(),
        ...(stageData(stageKey, extra) ? { data: stageData(stageKey, extra) } : {}),
      }),
      this.prisma.caseActivity.create({
        data: {
          id: newId(),
          caseId: id,
          actorId: actor.id,
          action: `${stageKey}_${decision}`,
          fromStage: stageKey,
          toStage:
            decision === 'sendback'
              ? 'draft'
              : isLevel
                ? decision === 'approve'
                  ? nextAfterApproval(levels, stageKey)
                  : 'rejected'
                : 'review',
          note: note?.trim() || null,
        },
      }),
    ]);

    // Recompute the overall phase from the active stages. This must read AFTER our own write
    // (above): if two reviewers act at once, the later reader then sees both decisions, so the case
    // can never stall in "review" with every stage approved.
    let phase: string = c.stage;
    if (isLevel) {
      // Sequential: approve hands the case to the next level (or SAP); send-back waits for the
      // proposer, who resubmits straight back to this level.
      phase =
        decision === 'approve'
          ? nextAfterApproval(levels, stageKey)
          : decision === 'reject'
            ? 'rejected'
            : 'review';
    } else {
      const statuses = await this.stageStatuses(id, active);
      if (Object.values(statuses).some((s) => s === 'rejected')) {
        phase = 'rejected';
      } else if (Object.values(statuses).some((s) => s === 'sent_back')) {
        // One or more stages need the proposer; surface the case to them while others hold.
        phase = 'review';
      } else if (active.every((s) => statuses[s] === 'approved')) {
        // All reviews done -> the first approval level, or the SAP confirmation gate.
        phase = nextAfterApproval(levels);
      } else {
        phase = 'review';
      }
    }
    // The stage the case moves into (an approval level or SAP) opens for its owner.
    const opens = phase !== c.stage && (phase === SAP_STAGE || isApprovalLevel(phase));

    // Move the case, open the SAP row (if now due) and write the audit entry together; the audit
    // transaction starts alongside and is committed only once the case update succeeds.
    const caseUpdated = Promise.resolve(
      this.prisma.case.update({
        where: { id },
        data: { stage: phase, lastUpdatedById: actor.id },
      }),
    );
    const audited = this.audit.append(
      {
        action: `case.stage_${decision}`,
        entityType: 'Case',
        entityId: id,
        actorId: actor.id,
        detail: { ref: c.ref, stage: stageKey, decision, phase },
      },
      { after: caseUpdated },
    );
    audited.catch(() => undefined);
    await Promise.all([
      caseUpdated,
      opens
        ? this.writeStage(id, phase, { status: 'pending', enteredAt: new Date() })
        : Promise.resolve(),
      audited,
    ]);
    return { ok: true, stage: stageKey, status, phase };
  }

  /** Backwards-compatible alias for the existing InfoSec endpoint. */
  async infosecDecision(
    actor: AuthUser,
    id: string,
    decision: 'approve' | 'reject' | 'sendback',
    note?: string,
  ) {
    return this.stageDecision(actor, id, 'infosec', decision, note);
  }

  /**
   * SAP confirmation — the final stage. Only reachable once every active review stage is approved.
   * Confirming activates the vendor (ERP push + notify); rejecting closes the case.
   */
  async sapDecision(actor: AuthUser, id: string, decision: 'approve' | 'reject', note?: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      include: { general: { select: { legalName: true } } },
    });
    if (!c) throw new NotFoundException('Case not found.');
    const owns = actor.roles.includes('sap') || actor.permissions.has(PERMISSIONS.WorkflowManage);
    if (!owns) throw new ForbiddenException('Only the SAP confirmation role can act here.');
    if (c.stage !== SAP_STAGE) {
      throw new BadRequestException('This case has not reached SAP confirmation.');
    }
    if (c.onHold) {
      throw new BadRequestException(
        'This case is on hold. It has to be resumed before it can be confirmed.',
      );
    }
    if (decision === 'reject' && !note?.trim()) {
      throw new BadRequestException('A remark is required to reject at SAP confirmation.');
    }

    const phase = decision === 'approve' ? 'approved' : 'rejected';
    await this.writeStage(id, SAP_STAGE, {
      status: phase,
      decision,
      remark: note?.trim() || null,
      actionedById: actor.id,
      completedAt: new Date(),
    });
    await this.prisma.case.update({
      where: { id },
      data: {
        stage: phase,
        lastUpdatedById: actor.id,
        ...(phase === 'approved' ? { vendorCode: `V${Date.now().toString().slice(-8)}` } : {}),
        activity: {
          create: {
            id: newId(),
            actorId: actor.id,
            action: `sap_${decision}`,
            fromStage: SAP_STAGE,
            toStage: phase,
            note: note?.trim() || null,
          },
        },
      },
    });

    if (phase === 'approved') {
      await this.erp.activate(id);
      for (const owner of caseOwnerIds(c)) {
        await this.notifications.notify(
          owner,
          'case.approved',
          `Vendor ${c.general?.legalName ?? c.ref} (${c.ref}) has been confirmed in SAP and activated.`,
          `/cases/${id}`,
        );
      }
    }
    await this.audit.append({
      action: `case.sap_${decision}`,
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref: c.ref, decision },
    });
    return { ok: true, phase };
  }

  // ---------- bulk actions from the case list ----------

  /**
   * Apply one action to several cases. Each case is checked and changed on its own, so one refusal
   * never blocks the rest; the result says which cases changed and why any did not. Done one at a
   * time because every change writes an audit entry and the audit log is a hash chain.
   */
  async bulk(actor: AuthUser, action: BulkAction, ids: string[], note?: string) {
    const results: { id: string; ref: string | null; ok: boolean; message?: string }[] = [];
    for (const id of [...new Set(ids)]) {
      try {
        results.push({ id, ref: await this.bulkOne(actor, action, id, note), ok: true });
      } catch (e) {
        results.push({
          id,
          ref: null,
          ok: false,
          message: e instanceof HttpException ? httpMessage(e) : 'This case could not be updated.',
        });
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    return { action, results, succeeded, failed: results.length - succeeded };
  }

  private async bulkOne(actor: AuthUser, action: BulkAction, id: string, note?: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      select: {
        id: true,
        ref: true,
        stage: true,
        onHold: true,
        createdById: true,
        onBehalfOfId: true,
        assigneeId: true,
        infosecRequired: true,
        approvalLevels: true,
        erpRef: true,
      },
    });
    // A draft is private to its proposer.
    if (!c || (c.stage === 'draft' && !isCaseOwner(c, actor.id))) {
      throw new NotFoundException('Case not found.');
    }
    this.assertCanSee(actor, c);

    const isAdmin = actor.permissions.has(PERMISSIONS.WorkflowManage);
    const mayManage = isCaseOwner(c, actor.id) || isAdmin;
    const mayPause = mayManage || actor.permissions.has(PERMISSIONS.WorkflowStageApprove);
    const finished = CLOSED_STAGES.includes(c.stage);
    const reason = note?.trim() ?? '';
    const log = (act: string, toStage: string | null) =>
      this.prisma.caseActivity.create({
        data: {
          id: newId(),
          caseId: id,
          actorId: actor.id,
          action: act,
          fromStage: c.stage,
          toStage,
          note: reason || null,
        },
      });
    const audit = (act: string, detail: Record<string, unknown> = {}, after?: Promise<unknown>) =>
      this.audit.append(
        {
          action: act,
          entityType: 'Case',
          entityId: id,
          actorId: actor.id,
          detail: { ref: c.ref, ...detail },
        },
        after ? { after } : {},
      );
    // Apply the change, write its history entry and its audit entry together. The audit row is only
    // committed once the change itself has succeeded.
    const apply = async (
      data: Record<string, unknown>,
      activity: string,
      toStage: string | null,
      auditAction: string,
      detail: Record<string, unknown> = {},
    ) => {
      const changed = Promise.all([
        this.prisma.case.update({ where: { id }, data: { ...data, lastUpdatedById: actor.id } }),
        log(activity, toStage),
      ]);
      changed.catch(() => undefined);
      await Promise.all([changed, audit(auditAction, detail, changed)]);
    };

    switch (action) {
      case 'delete':
        if (!mayManage) {
          throw new ForbiddenException(
            'Only the proposer who raised this case, or an administrator, can delete it.',
          );
        }
        // A vendor already created in the ERP cannot simply disappear from this side.
        if (c.erpRef) {
          throw new BadRequestException(
            'This vendor has already been created in the ERP, so the case cannot be deleted. Block the vendor instead.',
          );
        }
        await this.permanentDelete(actor, c);
        return c.ref;

      case 'hold':
        if (!mayPause)
          throw new ForbiddenException('You are not allowed to put this case on hold.');
        if (c.stage === 'draft') throw new BadRequestException('A draft cannot be put on hold.');
        if (finished) throw new BadRequestException('A closed case cannot be put on hold.');
        if (c.onHold) throw new BadRequestException('This case is already on hold.');
        if (!reason) throw new BadRequestException('A reason is required to put a case on hold.');
        await apply({ onHold: true }, 'hold', c.stage, 'case.hold');
        return c.ref;

      case 'resume':
        if (!mayPause) throw new ForbiddenException('You are not allowed to resume this case.');
        if (!c.onHold) throw new BadRequestException('This case is not on hold.');
        await apply({ onHold: false }, 'resume', c.stage, 'case.resume');
        return c.ref;

      case 'cancel':
        if (!mayManage) {
          throw new ForbiddenException(
            'Only the proposer who raised this case, or an administrator, can cancel it.',
          );
        }
        if (c.stage === 'draft') {
          throw new BadRequestException('A draft can be deleted instead of cancelled.');
        }
        if (finished) {
          throw new BadRequestException(
            c.stage === 'approved'
              ? 'An approved case cannot be cancelled.'
              : c.stage === 'cancelled'
                ? 'This case is already cancelled.'
                : 'This case is already closed.',
          );
        }
        if (!reason) throw new BadRequestException('A reason is required to cancel a case.');
        await apply(
          { stage: 'cancelled', onHold: false },
          'cancelled',
          'cancelled',
          'case.cancel',
          { fromStage: c.stage },
        );
        return c.ref;

      case 'reopen': {
        if (!mayManage) {
          throw new ForbiddenException(
            'Only the proposer who raised this case, or an administrator, can reopen it.',
          );
        }
        if (c.stage !== 'rejected' && c.stage !== 'cancelled') {
          throw new BadRequestException('Only a cancelled or rejected case can be reopened.');
        }
        if (!reason) throw new BadRequestException('A reason is required to reopen a case.');
        // Stages a reviewer rejected go back to waiting for review; approved ones stay approved.
        const active = this.activeStagesFor(c);
        const before = await this.stageStatuses(id, active);
        for (const s of active) {
          if (before[s] === 'rejected') {
            await this.writeStage(id, s, {
              status: 'pending',
              decision: null,
              enteredAt: new Date(),
            });
          }
        }
        const sap = await this.readStage(id, SAP_STAGE);
        const after = await this.stageStatuses(id, active);
        // Approval levels: a rejected level reopens; the case resumes at the first one not approved.
        const levels = normaliseApprovalLevels(c.approvalLevels);
        const levelRows = await Promise.all(levels.map((l) => this.readStage(id, l)));
        const resumeLevel = levels.find((_, i) => levelRows[i]?.status !== 'approved');
        let phase: string = 'review';
        if (sap?.status === 'rejected') {
          await this.writeStage(id, SAP_STAGE, {
            status: 'pending',
            decision: null,
            enteredAt: new Date(),
          });
          phase = SAP_STAGE;
        } else if (active.every((s) => after[s] === 'approved')) {
          phase = resumeLevel ?? SAP_STAGE;
          const row = resumeLevel ? levelRows[levels.indexOf(resumeLevel)] : sap;
          if (!row || row.status !== 'pending') {
            await this.writeStage(id, phase, {
              status: 'pending',
              decision: null,
              enteredAt: new Date(),
            });
          }
        }
        await this.prisma.case.update({
          where: { id },
          data: { stage: phase, onHold: false, lastUpdatedById: actor.id },
        });
        await log('reopened', phase);
        await audit('case.reopen', { toStage: phase });
        return c.ref;
      }
    }
  }

  /**
   * Permanently remove a case: its rows (every table linked to a case is set to delete with it),
   * the notifications that point at it, and the uploaded files in object storage. Because the case
   * row is gone it disappears from every queue and screen. The audit log is append-only and keeps a
   * record that the case was deleted, by whom, and what it was.
   */
  private async permanentDelete(actor: AuthUser, c: { id: string; ref: string; stage: string }) {
    const [docs, general] = await Promise.all([
      this.prisma.document.findMany({ where: { caseId: c.id }, select: { storageKey: true } }),
      this.prisma.caseGeneral.findUnique({
        where: { caseId: c.id },
        select: { legalName: true },
      }),
    ]);
    await this.prisma.$transaction([
      this.prisma.notification.deleteMany({ where: { link: { contains: c.id } } }),
      this.prisma.case.delete({ where: { id: c.id } }),
    ]);
    let filesRemoved = 0;
    let filesNotRemoved = 0;
    for (const d of docs) {
      try {
        await this.storage.remove(d.storageKey);
        filesRemoved += 1;
      } catch (e) {
        filesNotRemoved += 1;
        this.logger.warn(
          `Stored file not removed after deleting ${c.ref}: ${(e as Error).message}`,
        );
      }
    }
    await this.audit.append({
      action: 'case.delete',
      entityType: 'Case',
      entityId: c.id,
      actorId: actor.id,
      detail: {
        ref: c.ref,
        stage: c.stage,
        vendor: general?.legalName || null,
        filesRemoved,
        filesNotRemoved,
      },
    });
  }

  // ---------- drafts (autosaved work in progress) ----------

  /** Vendor detail row for a draft: everything optional; blank values clear the column. */
  private async draftGeneral(input: DraftInput): Promise<Record<string, unknown>> {
    const t = (v?: string) => (v?.trim() ? v.trim() : null);
    const g: Record<string, unknown> = {
      legalName: input.legalName?.trim() ?? '',
      tradeName: t(input.tradeName),
      businessAddress: t(input.businessAddress),
      addressCountry: t(input.addressCountry),
      addressState: t(input.addressState),
      addressCity: t(input.addressCity),
      addressPostalCode: t(input.addressPostalCode),
      contactName: t(input.contactName),
      contactEmail: t(input.contactEmail),
      contactPhone: t(input.contactPhone),
      signatoryName: t(input.signatoryName),
      signatoryEmail: t(input.signatoryEmail),
      signatoryMobile: t(input.signatoryMobile),
      gstin: t(input.gstin),
      gstinBlindIndex: t(input.gstin) ? this.blind.index(input.gstin!.trim()) : null,
      ifsc: t(input.ifsc),
      bankName: t(input.bankName),
      branch: t(input.branch),
      businessUnit: t(input.businessUnit),
      costCentre: t(input.costCentre),
      spend: input.spend ?? 0,
      contractMonths: input.contractMonths ?? null,
      natureOfService: t(input.natureOfService),
      justification: input.justification ?? '',
      coiDeclared: input.coiDeclared ?? false,
      coiDetails: t(input.coiDetails),
      dataAccess: t(input.dataAccess),
      systemAccess: t(input.systemAccess),
      subcontract: t(input.subcontract),
      delivery: t(input.delivery),
      screening: t(input.screening),
      conflict: t(input.conflict),
      litigation: t(input.litigation),
      insurance: t(input.insurance),
      certifications: t(input.certifications),
      isecItHardware: input.isecItHardware ?? false,
      isecItSoftware: input.isecItSoftware ?? false,
      isecAccessSystem: input.isecAccessSystem ?? false,
      isecAccessNetwork: input.isecAccessNetwork ?? false,
      isecAccessApps: input.isecAccessApps ?? false,
      isecAccessPii: input.isecAccessPii ?? false,
    };
    // Sensitive identifiers: encrypted when supplied, cleared when blank, left alone when omitted
    // or when a masked echo (••••) comes back from a view without the sensitive permission.
    const sensitive: [keyof DraftInput, string, string][] = [
      ['pan', 'panEnc', 'panBlindIndex'],
      ['bankAccount', 'bankAccountEnc', 'bankBlindIndex'],
      ['signatoryPan', 'signatoryPanEnc', 'signatoryPanBlindIndex'],
    ];
    for (const [key, encCol, idxCol] of sensitive) {
      const v = input[key] as string | undefined;
      if (v === undefined || v.includes('\u2022')) continue;
      if (!v.trim()) {
        g[encCol] = null;
        g[idxCol] = null;
      } else {
        g[encCol] = await this.crypto.encryptToString(v.trim());
        g[idxCol] = this.blind.index(v.trim());
      }
    }
    return g;
  }

  /** Create a draft case (stage "draft"). Visible only to its proposer until it is submitted. */
  async createDraft(actor: AuthUser, input: DraftInput) {
    const entityId = this.requireEntity(actor);
    const proposer = await this.team.proposerFor(actor, input.proposerId);
    await this.assertSubCategory(input);
    const [category, ref, general, partnerRows, teamRow] = await Promise.all([
      this.categories.get(input.categoryKey),
      this.nextRef(),
      this.draftGeneral(input),
      this.buildPartnerRows(input.partners),
      this.team.resolve(proposer, input.teamOverrides),
    ]);
    const published = await this.workflows.getPublished(category.workflowKey);
    const id = newId();
    await this.prisma.case.create({
      data: {
        id,
        ref,
        entityId,
        onBehalfOfId: proposer.id === actor.id ? null : proposer.id,
        categoryKey: input.categoryKey,
        subCategoryKey: input.subCategoryKey || null,
        workflowKey: published.key,
        workflowVersion: published.version,
        stage: 'draft',
        tier: 'low',
        riskScore: 0,
        createdById: actor.id,
        lastUpdatedById: actor.id,
        infosecRequired: false,
        general: {
          create: { id: newId(), ...general } as Prisma.CaseGeneralCreateWithoutCaseInput,
        },
        partners: { create: partnerRows },
        vendorReferences: { create: this.buildReferenceRows(input.references) },
        rcLimits: { create: this.buildRcLimitRows(input.rcLimits) },
        teamStructure: { create: { id: newId(), ...teamRow } },
        activity: {
          create: { id: newId(), actorId: actor.id, action: 'draft_created', toStage: 'draft' },
        },
      },
    });
    await this.captureDraftLookups(id, actor, input);
    await this.audit.append({
      action: 'case.draft_create',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref },
    });
    return { id, ref, savedAt: new Date().toISOString() };
  }

  private async ownDraft(actor: AuthUser, id: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      select: { id: true, ref: true, stage: true, createdById: true, onBehalfOfId: true },
    });
    // A draft is private to its owners, so anyone else is told it does not exist.
    if (!c || !isCaseOwner(c, actor.id)) throw new NotFoundException('Case not found.');
    if (c.stage !== 'draft') {
      throw new BadRequestException('Only a draft can be saved this way. Submit changes instead.');
    }
    return c;
  }

  /** Autosave: overwrite the draft's contents with the form as it stands. */
  async updateDraftContent(actor: AuthUser, id: string, input: DraftInput) {
    const c = await this.ownDraft(actor, id);
    await this.assertSubCategory(input);
    // Keep the draft's proposer unless the form chose a different one.
    const proposer = await this.team.proposerFor(
      actor,
      input.proposerId ?? c.onBehalfOfId ?? c.createdById,
    );
    const [category, general, partnerRows, teamRow] = await Promise.all([
      this.categories.get(input.categoryKey),
      this.draftGeneral(input),
      this.buildPartnerRows(input.partners),
      this.team.resolve(proposer, input.teamOverrides),
    ]);
    const published = await this.workflows.getPublished(category.workflowKey);
    await this.prisma.case.update({
      where: { id },
      data: {
        categoryKey: input.categoryKey,
        subCategoryKey: input.subCategoryKey || null,
        workflowKey: published.key,
        workflowVersion: published.version,
        lastUpdatedById: actor.id,
        onBehalfOfId: proposer.id === c.createdById ? null : proposer.id,
        partners: { deleteMany: {}, create: partnerRows },
        vendorReferences: { deleteMany: {}, create: this.buildReferenceRows(input.references) },
        rcLimits: { deleteMany: {}, create: this.buildRcLimitRows(input.rcLimits) },
        teamStructure: {
          upsert: { create: { id: newId(), ...teamRow }, update: teamRow },
        },
        general: {
          upsert: {
            create: { id: newId(), ...general } as Prisma.CaseGeneralCreateWithoutCaseInput,
            update: general as Prisma.CaseGeneralUpdateWithoutCaseInput,
          },
        },
      },
    });
    await this.captureDraftLookups(id, actor, input);
    return { id, ref: c.ref, savedAt: new Date().toISOString() };
  }

  /** Keep the PAN / GST / bank / MSME results shown on the form with the draft (never masked echoes). */
  private captureDraftLookups(id: string, actor: AuthUser, input: DraftInput): Promise<void> {
    const real = (v?: string) => (v && !v.includes('\u2022') ? v.trim() : null);
    return this.captureResponses(
      id,
      actor,
      {
        pan: real(input.pan),
        gstin: real(input.gstin),
        bankAccount: real(input.bankAccount),
        ifsc: real(input.ifsc),
      },
      { skipUnchanged: true },
    );
  }

  /** Discard a draft the proposer no longer wants (drafts only; submitted cases are never deleted). */
  async deleteDraft(actor: AuthUser, id: string) {
    const c = await this.ownDraft(actor, id);
    await this.prisma.case.delete({ where: { id } });
    await this.audit.append({
      action: 'case.draft_discard',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { ref: c.ref },
    });
    return { ok: true };
  }

  /**
   * Proposer edits their own case and resubmits. Allowed while it is a fresh draft, or when one or
   * more parallel review stages were sent back to them. On resubmit only the stage(s) that were
   * sent back (plus InfoSec if newly flagged) reopen for review — approved stages keep their sign-off.
   */
  async updateDraft(actor: AuthUser, id: string, input: CaseCreateInput) {
    const c = await this.prisma.case.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Case not found.');
    if (!isCaseOwner(c, actor.id)) {
      throw new ForbiddenException('Only the proposer of this case can edit it.');
    }
    if (CLOSED_STAGES.includes(c.stage)) {
      throw new BadRequestException('This case is closed and can no longer be edited.');
    }

    const isec = {
      isecItHardware: input.isecItHardware ?? false,
      isecItSoftware: input.isecItSoftware ?? false,
      isecAccessSystem: input.isecAccessSystem ?? false,
      isecAccessNetwork: input.isecAccessNetwork ?? false,
      isecAccessApps: input.isecAccessApps ?? false,
      isecAccessPii: input.isecAccessPii ?? false,
    };
    const infosecRequired = Object.values(isec).some(Boolean);
    const active = activeReviewStages(infosecRequired);

    // Decide which stages to (re)open. A fresh draft opens the whole active set; otherwise only the
    // stages that were sent back, plus any newly-active stage with no row yet (e.g. InfoSec toggled on).
    const isDraft = c.stage === 'draft';
    const reopen: ReviewStage[] = [];
    // An approval level that sent the case back; on resubmit the case returns straight to it.
    let returnToLevel: ApprovalLevel | undefined;
    if (isDraft) {
      reopen.push(...active);
    } else {
      const caseLevels = normaliseApprovalLevels(c.approvalLevels);
      const [rows, levelRows] = await Promise.all([
        Promise.all(active.map((s) => this.readStage(id, s))),
        Promise.all(caseLevels.map((l) => this.readStage(id, l))),
      ]);
      active.forEach((s, i) => {
        const row = rows[i];
        if (!row || row.status === 'sent_back') reopen.push(s);
      });
      returnToLevel = caseLevels.find((_, i) => levelRows[i]?.status === 'sent_back');
      if (reopen.length === 0 && !returnToLevel) {
        throw new BadRequestException('This case has no stage awaiting your changes.');
      }
    }

    const [category] = await Promise.all([
      this.categories.get(input.categoryKey),
      this.assertSubCategory(input),
    ]);
    const def = await this.workflows.publishedDefinition(category.workflowKey);
    // First submission takes the category's approval levels; a resubmitted case keeps its own.
    const approvalLevels = isDraft
      ? normaliseApprovalLevels(category.approvalLevels)
      : normaliseApprovalLevels(c.approvalLevels);
    // A review stage that was sent back runs first; otherwise the case goes back to the level.
    const nextStage: string = reopen.length === 0 && returnToLevel ? returnToLevel : 'review';
    const risk = assessRisk(this.riskInputFrom(input, category.enhancedDueDiligence));
    const tier = risk.tier;

    // First submission of a draft does what create() does for a new case: due-diligence checklist,
    // duplicate detection and the `case.create` audit event.
    const pack = isDraft
      ? dueDiligencePack(risk, this.riskInputFrom(input, category.enhancedDueDiligence))
      : [];
    const unmasked = (v?: string) => (v && !v.includes('\u2022') ? v : null);
    const duplicates = isDraft
      ? await this.detectDuplicates(
          {
            pan: unmasked(input.pan) ? this.blind.index(input.pan as string) : null,
            gstin: input.gstin ? this.blind.index(input.gstin) : null,
            bank: unmasked(input.bankAccount)
              ? this.blind.index(input.bankAccount as string)
              : null,
            email: input.contactEmail,
            phone: input.contactPhone,
          },
          id,
        )
      : [];

    // Sensitive identifiers (PAN / bank / signatory PAN) are only rewritten when a fresh, unmasked
    // value is supplied — the detail form shows masked values, so a masked echo is ignored.
    const isMasked = (v?: string) => !v || v.includes('•');

    // The vendor master detail (case_general) is updated; the case row keeps only tracking state.
    const general: Record<string, unknown> = {
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      businessAddress: input.businessAddress ?? null,
      addressCountry: input.addressCountry?.trim() || null,
      addressState: input.addressState?.trim() || null,
      addressCity: input.addressCity?.trim() || null,
      addressPostalCode: input.addressPostalCode?.trim() || null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      signatoryName: input.signatoryName ?? null,
      signatoryEmail: input.signatoryEmail ?? null,
      signatoryMobile: input.signatoryMobile ?? null,
      gstin: input.gstin ?? null,
      gstinBlindIndex: input.gstin ? this.blind.index(input.gstin) : null,
      ifsc: input.ifsc ?? null,
      bankName: input.bankName ?? null,
      branch: input.branch ?? null,
      businessUnit: input.businessUnit ?? null,
      costCentre: input.costCentre ?? null,
      spend: input.spend ?? 0,
      contractMonths: input.contractMonths ?? null,
      natureOfService: input.natureOfService ?? null,
      justification: input.justification ?? '',
      coiDeclared: input.coiDeclared ?? false,
      coiDetails: input.coiDetails ?? null,
      dataAccess: input.dataAccess ?? null,
      systemAccess: input.systemAccess ?? null,
      subcontract: input.subcontract ?? null,
      delivery: input.delivery ?? null,
      screening: input.screening ?? null,
      conflict: input.conflict ?? null,
      litigation: input.litigation ?? null,
      insurance: input.insurance ?? null,
      certifications: input.certifications ?? null,
      ...isec,
    };
    if (!isMasked(input.pan)) {
      general.panEnc = await this.crypto.encryptToString(input.pan as string);
      general.panBlindIndex = this.blind.index(input.pan as string);
    }
    if (!isMasked(input.bankAccount)) {
      general.bankAccountEnc = await this.crypto.encryptToString(input.bankAccount as string);
      general.bankBlindIndex = this.blind.index(input.bankAccount as string);
    }
    if (!isMasked(input.signatoryPan)) {
      general.signatoryPanEnc = await this.crypto.encryptToString(input.signatoryPan as string);
      general.signatoryPanBlindIndex = this.blind.index(input.signatoryPan as string);
    }

    // Keep the case's proposer unless the form chose a different one.
    const proposer = await this.team.proposerFor(
      actor,
      input.proposerId ?? c.onBehalfOfId ?? c.createdById,
    );
    const teamRow = await this.team.resolve(proposer, input.teamOverrides);

    // The case may have been created before case_general existed; upsert to be safe.
    await this.prisma.case.update({
      where: { id },
      data: {
        categoryKey: input.categoryKey,
        subCategoryKey: input.subCategoryKey ?? null,
        workflowKey: def.key,
        workflowVersion: def.version,
        stage: nextStage,
        tier,
        riskScore: risk.score,
        infosecRequired,
        approvalLevels,
        lastUpdatedById: actor.id,
        onBehalfOfId: proposer.id === c.createdById ? null : proposer.id,
        ...(isDraft
          ? {
              submittedAt: new Date(),
              checklist: {
                create: pack.map((it) => ({
                  id: newId(),
                  itemId: it.id,
                  label: it.label,
                  role: it.role,
                })),
              },
            }
          : {}),
        partners: { deleteMany: {}, create: await this.buildPartnerRows(input.partners) },
        vendorReferences: { deleteMany: {}, create: this.buildReferenceRows(input.references) },
        rcLimits: { deleteMany: {}, create: this.buildRcLimitRows(input.rcLimits) },
        ...(teamRow
          ? {
              teamStructure: {
                upsert: { create: { id: newId(), ...teamRow }, update: teamRow },
              },
            }
          : {}),
        general: {
          upsert: {
            create: { id: newId(), ...general } as Prisma.CaseGeneralCreateWithoutCaseInput,
            update: general as Prisma.CaseGeneralUpdateWithoutCaseInput,
          },
        },
        activity: {
          create: {
            id: newId(),
            actorId: actor.id,
            action: isDraft ? 'submitted_for_review' : 'resubmitted',
            toStage: nextStage,
            note: isDraft
              ? `Parallel review opened: ${reopen.join(', ')}.`
              : `Amended and resubmitted; reopened for review: ${[
                  ...reopen,
                  ...(returnToLevel ? [returnToLevel] : []),
                ].join(', ')}.`,
          },
        },
      },
    });

    // Reopen the chosen stages for review; ensure a (gated) SAP row exists.
    const reopenedAt = new Date();
    await Promise.all([
      ...reopen.map((s) => this.writeStage(id, s, { status: 'pending', enteredAt: reopenedAt })),
      // A fresh submission seeds its approval levels; a level that sent the case back reopens.
      ...(isDraft ? approvalLevels.map((l) => this.writeStage(id, l, { status: 'waiting' })) : []),
      ...(returnToLevel
        ? [
            this.writeStage(id, returnToLevel, {
              status: reopen.length === 0 ? 'pending' : 'waiting',
              decision: null,
              enteredAt: reopenedAt,
            }),
          ]
        : []),
      this.writeStage(id, SAP_STAGE, { status: 'waiting' }),
      this.captureResponses(id, actor, {
        pan: isMasked(input.pan) ? null : input.pan,
        gstin: input.gstin,
        bankAccount: isMasked(input.bankAccount) ? null : input.bankAccount,
        ifsc: input.ifsc,
      }),
      this.audit.append({
        action: isDraft ? 'case.create' : 'case.update',
        entityType: 'Case',
        entityId: id,
        actorId: actor.id,
        detail: isDraft
          ? {
              ref: c.ref,
              tier,
              category: input.categoryKey,
              duplicateFlags: duplicates.length,
              infosecRequired,
              teamOverridden: teamRow.overriddenFields,
            }
          : {
              ref: c.ref,
              tier,
              reopened: [...reopen, ...(returnToLevel ? [returnToLevel] : [])],
              infosecRequired,
            },
      }),
    ]);
    return {
      id,
      ref: c.ref,
      tier,
      riskScore: risk.score,
      drivers: risk.drivers,
      duplicates,
      stage: nextStage,
      infosecRequired,
      reopened: [...reopen, ...(returnToLevel ? [returnToLevel] : [])],
    };
  }

  async list(
    actor: AuthUser,
    filters: {
      stage?: string;
      tier?: string;
      q?: string;
      queue?: string;
      ref?: string;
      status?: string;
    },
  ) {
    const where: Record<string, unknown> = {
      // Drafts are private work in progress: only the proposer who started one sees it.
      AND: [{ OR: [{ stage: { not: 'draft' } }, ...ownedBy(actor.id)] }],
    };
    if (!this.canSeeAll(actor)) where.OR = [...ownedBy(actor.id), { assigneeId: actor.id }];
    // A stage queue (?queue=fcu|operation|legal|infosec) lists cases awaiting that parallel review;
    // ?queue=sap lists cases at the SAP confirmation gate.
    if (filters.queue) {
      const rel: Record<string, string> = {
        infosec: 'infosecStage',
        fcu: 'fcuStage',
        operation: 'operationStage',
        legal: 'legalStage',
      };
      const relKey = rel[filters.queue];
      if (filters.queue === 'sap' || isApprovalLevel(filters.queue)) {
        // SAP and the approval levels are sequential: the case's stage says whose turn it is.
        where.stage = filters.queue;
      } else if (relKey) {
        where[relKey] = { status: 'pending' };
        where.stage = 'review';
      }
    } else if (filters.stage) {
      where.stage = filters.stage;
    }
    // Status: open = still being worked on, hold = paused, closed = decided (approved or rejected),
    // cancelled = withdrawn by the proposer or an administrator.
    // Drafts count as open. Anything else (or "all") applies no status filter.
    const finished = CLOSED_STAGES;
    const and = where.AND as Record<string, unknown>[];
    if (filters.status === 'open') and.push({ stage: { notIn: finished }, onHold: false });
    else if (filters.status === 'hold') and.push({ stage: { notIn: finished }, onHold: true });
    else if (filters.status === 'closed') and.push({ stage: { in: ['approved', 'rejected'] } });
    else if (filters.status === 'cancelled') and.push({ stage: 'cancelled' });
    if (filters.tier) where.tier = filters.tier;
    // Case ID filter: partial, case-insensitive match on the reference (e.g. "0004" or "vom-2026").
    const refQuery = filters.ref?.trim().slice(0, 40);
    if (refQuery) where.ref = { contains: likeEscape(refQuery), mode: 'insensitive' };
    // The vendor name lives on case_general now.
    if (filters.q) {
      where.general = { legalName: { contains: likeEscape(filters.q), mode: 'insensitive' } };
    }
    const [rows, names] = await Promise.all([
      this.listRows(where),
      this.subCategoryNames.get('all', async () => {
        const subs = await this.prisma.vendorSubCategory.findMany({
          select: { key: true, name: true },
        });
        return new Map(subs.map((s) => [s.key, s.name]));
      }),
    ]);
    // Flatten legalName and resolve the sub-category's display name for the list.
    return rows.map(({ general, ...r }) => ({
      ...r,
      legalName: general?.legalName ?? '',
      tradeName: general?.tradeName ?? '',
      subCategoryName: r.subCategoryKey ? (names.get(r.subCategoryKey) ?? null) : null,
    }));
  }

  private listRows(where: Record<string, unknown>) {
    return this.prisma.case.findMany({
      where,
      relationLoadStrategy: 'join',
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        ref: true,
        categoryKey: true,
        subCategoryKey: true,
        stage: true,
        tier: true,
        onHold: true,
        infosecRequired: true,
        dueAt: true,
        assigneeId: true,
        createdById: true,
        createdAt: true,
        general: { select: { legalName: true, tradeName: true } },
      },
    });
  }

  async get(actor: AuthUser, id: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      // One SQL statement with joins instead of a query per relation (each is a network round trip).
      relationLoadStrategy: 'join',
      include: {
        general: true,
        partners: { orderBy: { position: 'asc' } },
        vendorReferences: { orderBy: { position: 'asc' } },
        rcLimits: { orderBy: { position: 'asc' } },
        teamStructure: true,
        checklist: { orderBy: { itemId: 'asc' } },
        comments: { orderBy: { at: 'asc' } },
        activity: { orderBy: { at: 'asc' } },
        draftStage: true,
        infosecStage: true,
        fcuStage: true,
        operationStage: true,
        legalStage: true,
        l1Stage: true,
        l2Stage: true,
        l3Stage: true,
        sapStage: true,
        responses: {
          select: {
            kind: true,
            payloadEnc: true,
            verified: true,
            status: true,
            capturedAt: true,
            identifierBlindIndex: true,
          },
        },
      },
    });
    if (!c || (c.stage === 'draft' && !isCaseOwner(c, actor.id))) {
      throw new NotFoundException('Case not found.');
    }
    this.assertCanSee(actor, c);
    return this.present(c as unknown as Record<string, unknown>, actor);
  }

  async action(actor: AuthUser, id: string, action: WorkflowAction, note?: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      include: { checklist: true, general: { select: { legalName: true } } },
    });
    if (!c) throw new NotFoundException('Case not found.');
    this.assertCanSee(actor, c);
    if (ACTION_NEEDS_NOTE[action] && !note?.trim()) {
      throw new BadRequestException('A reason is required for this action.');
    }

    const def = await this.workflows.definitionFor(c.workflowKey, c.workflowVersion);
    const stage = getStage(def, c.stage);
    if (!stage) throw new BadRequestException('Case stage is not in its workflow.');

    const isStageOwner =
      (stage.ownerRole !== null && actor.roles.includes(stage.ownerRole)) ||
      actor.permissions.has(PERMISSIONS.WorkflowManage);
    const outstanding = c.checklist.filter((i) => !i.done).length;

    const result = evaluateTransition(def, c.stage, action, {
      tier: c.tier as TierKey,
      isStageOwner,
      isCaseOwner: isCaseOwner(c, actor.id),
      onHold: c.onHold,
      checklistOutstanding: outstanding,
    });
    if (!result.allowed) throw new ForbiddenException(result.reason);

    const data: Record<string, unknown> = {};
    let toStage = c.stage;
    if (action === 'hold') data.onHold = true;
    else if (action === 'resume') data.onHold = false;
    else if (action === 'assign') {
      /* assignee change handled by a dedicated endpoint; no-op transition here */
    } else if (result.toStageKey && result.toStageKey !== c.stage) {
      toStage = result.toStageKey;
      const dest = getStage(def, toStage);
      data.stage = toStage;
      data.onHold = false;
      data.dueAt = dest ? dueDate(dest) : null;
      if (action === 'submit') data.submittedAt = new Date();
      if (toStage === 'approved') data.vendorCode = `V${Date.now().toString().slice(-8)}`;
    }

    data.lastUpdatedById = actor.id;
    await this.prisma.$transaction([
      this.prisma.case.update({ where: { id }, data }),
      this.prisma.caseActivity.create({
        data: {
          id: newId(),
          caseId: id,
          actorId: actor.id,
          action,
          fromStage: c.stage,
          toStage,
          note: note ?? null,
        },
      }),
    ]);

    // Keep the per-stage reporting rows in step with the transition.
    if (toStage !== c.stage) {
      const outStatus =
        action === 'reject' ? 'rejected' : action === 'return' ? 'sent_back' : 'completed';
      await this.writeStage(id, c.stage, {
        status: outStatus,
        decision: action,
        remark: note?.trim() || null,
        actionedById: actor.id,
        completedAt: new Date(),
      });
      await this.writeStage(id, toStage, { status: 'pending', enteredAt: new Date() });
    }

    await this.audit.append({
      action: `case.${action}`,
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { from: c.stage, to: toStage, note: note ? 'provided' : undefined },
    });

    // On activation: push to ERP (idempotent stub) and notify the proposer.
    if (toStage === 'approved' && c.stage !== 'approved') {
      await this.erp.activate(id);
      for (const owner of caseOwnerIds(c)) {
        await this.notifications.notify(
          owner,
          'case.approved',
          `Vendor ${c.general?.legalName ?? c.ref} (${c.ref}) has been approved and activated.`,
          `/cases/${id}`,
        );
      }
    }
    return { id, stage: toStage, onHold: data.onHold ?? c.onHold };
  }

  async comment(actor: AuthUser, id: string, body: string) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      select: { createdById: true, onBehalfOfId: true, assigneeId: true },
    });
    if (!c) throw new NotFoundException('Case not found.');
    this.assertCanSee(actor, c);
    const comment = await this.prisma.caseComment.create({
      data: { id: newId(), caseId: id, authorId: actor.id, body },
    });
    await this.audit.append({
      action: 'case.comment',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
    });
    return comment;
  }

  async tickChecklist(actor: AuthUser, id: string, itemId: string, done: boolean) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      select: { createdById: true, onBehalfOfId: true, assigneeId: true },
    });
    if (!c) throw new NotFoundException('Case not found.');
    this.assertCanSee(actor, c);
    await this.prisma.caseChecklistItem.update({
      where: { caseId_itemId: { caseId: id, itemId } },
      data: { done, doneById: done ? actor.id : null, doneAt: done ? new Date() : null },
    });
    await this.audit.append({
      action: 'case.checklist',
      entityType: 'Case',
      entityId: id,
      actorId: actor.id,
      detail: { itemId, done },
    });
    return { itemId, done };
  }
}
