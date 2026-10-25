import { Inject, Injectable, Logger } from '@nestjs/common';
import { validatePan, validateIfsc, nameMatchScore } from '@vop/shared';
import type { AppConfig } from '@vop/config';
import { APP_CONFIG } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationCacheService } from './verification-cache.service';

/** Key for the EY Nexus PAN token row in the integration_token table. */
export const EY_PAN_PROVIDER = 'ey-nexus-pan';

export interface PanDetails {
  name?: string;
  fatherName?: string;
  category?: string;
  panStatus?: string;
  aadhaarLinked?: boolean;
  /** Human-readable Aadhaar-seeding status, always set so the UI can show "Linked"/"Not linked". */
  aadhaarStatus?: string;
  maskedAadhaar?: string;
  dob?: string;
  gender?: string;
}

export interface GstinEntry {
  gstin: string;
  authStatus?: string;
}

/** A single GST return-filing record (latest-first when listed). */
export interface GstFiling {
  filingYear?: string;
  monthOfFiling?: string;
  methodOfFilling?: string;
  dateOfFiling?: string;
  gstType?: string;
  gstStatus?: string;
}

/** Full GSTIN profile from the registry (EY serviceTypeId 30). */
export interface GstDetails {
  gstin: string;
  legalName?: string;
  tradeName?: string;
  constitutionOfBusiness?: string;
  taxPayerType?: string;
  gstStatus?: string;
  registrationDate?: string;
  principalAddress?: string;
  state?: string;
  city?: string;
  pincode?: string;
  latestFiling?: GstFiling;
  filings?: GstFiling[];
}

export interface GstVerificationResult {
  gstin: string;
  verified: boolean;
  details?: GstDetails;
  message?: string;
  cached?: boolean;
}

/** Candidate names the bank-account holder is matched against. */
export interface BankNameCandidates {
  panName?: string;
  legalName?: string;
  tradeName?: string;
}

/** Result of matching the bank-account holder name against the vendor's known names. */
export interface BankNameMatch {
  /** Best similarity as a percentage (0–100). */
  score: number;
  /** True when the best score meets the required threshold (default 80%). */
  matched: boolean;
  /** Which candidate produced the best score ("PAN name" / "legal name" / "trade name"). */
  matchedAgainst?: string;
  /** The candidate value that matched best. */
  bestName?: string;
}

/** Penny-less bank-account verification profile (EY serviceTypeId 27). */
export interface BankDetails {
  accountNumber?: string;
  ifsc?: string;
  active?: boolean;
  activeStatus?: string;
  holderName?: string;
  bankRRN?: string;
  reason?: string;
  message?: string;
}

export interface BankVerificationResult {
  verified: boolean;
  active?: boolean;
  details?: BankDetails;
  nameMatch?: BankNameMatch;
  message?: string;
  cached?: boolean;
}

/** Minimum holder-name similarity (%) required to treat the account as name-matched. */
export const BANK_NAME_MATCH_THRESHOLD = 80;

/** MSME (Udyam) registration profile from the registry (EY serviceTypeId 92). */
export interface MsmeDetails {
  udyamNumber?: string;
  registrationDate?: string;
  organizationType?: string;
  enterpriseType?: string;
  officialName?: string;
  majorActivity?: string;
}

export interface MsmeVerificationResult {
  pan: string;
  verified: boolean;
  details?: MsmeDetails;
  message?: string;
  cached?: boolean;
}

export interface PanVerificationResult {
  pan: string;
  verified: boolean;
  name?: string;
  status?: string;
  fields?: PanDetails;
  gstins?: GstinEntry[];
  message?: string;
  /** True when served from the same-day cache instead of a fresh provider call. */
  cached?: boolean;
}

/**
 * Real PAN verification adapter for the EY Nexus CVR-API.
 *
 *   1. POST {base}/api/eic/v1/eic/signin           -> auth token (cached until expiry)
 *   2. POST {base}/api/eic/v1/central-verification/getCentralService
 *          header x-access-token: <token>
 *          body   {"serviceTypeId": "<id>", "IDNumber": "<PAN>"}
 *
 * Credentials come only from config (env/SecretsProvider) — never hardcoded or sent to the browser.
 * All calls are server-side; the web app only ever calls our own /verification/pan endpoint.
 */
@Injectable()
export class PanVerificationService {
  private readonly logger = new Logger(PanVerificationService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly cache: VerificationCacheService,
  ) {}

  get enabled(): boolean {
    return this.config.panVerify.enabled;
  }

  /** Upsert the integration token (admin). The token is generated out-of-band. */
  async setToken(token: string, expiresAt?: Date): Promise<void> {
    const trimmed = token.trim();
    // Default the stored expiry to the token's own JWT `exp` when the caller didn't supply one.
    const exp = expiresAt ?? jwtExpDate(trimmed);
    await this.prisma.integrationToken.upsert({
      where: { provider: EY_PAN_PROVIDER },
      create: { provider: EY_PAN_PROVIDER, token: trimmed, expiresAt: exp },
      update: { token: trimmed, expiresAt: exp },
    });
  }

  /**
   * Read the stored token. The token's own JWT `exp` is the source of truth for expiry, so a
   * freshly pasted token works even if the `expires_at` column was edited by hand (or left stale).
   * Falls back to VOP_EY_NEXUS_TOKEN env if no usable DB token.
   */
  private async getToken(): Promise<string | null> {
    const row = await this.prisma.integrationToken.findUnique({
      where: { provider: EY_PAN_PROVIDER },
    });
    const stored = row?.token?.trim();
    if (stored && !isTokenExpired(stored)) return stored;
    const envToken = this.config.panVerify.token?.trim();
    if (envToken && !isTokenExpired(envToken)) return envToken;
    return null;
  }

  async verify(panInput: string, scope?: string): Promise<PanVerificationResult> {
    const result = validatePan(panInput);
    if (!result.valid || !result.pan) {
      return { pan: panInput, verified: false, message: result.errors[0] ?? 'Invalid PAN.' };
    }
    const pan = result.pan;
    if (!this.enabled) {
      return { pan, verified: false, message: 'PAN verification is not configured.' };
    }

    // Same-day cache: an unchanged PAN in this scope is looked up once per day.
    if (scope) {
      const hit = await this.cache.get<PanVerificationResult>(scope, 'pan', pan);
      // Only reuse a real result: an earlier empty "verified" answer must be looked up again.
      if (hit?.verified && hit.name) return { ...hit, cached: true };
    }

    const token = await this.getToken();
    if (!token) {
      return {
        pan,
        verified: false,
        message: 'PAN verification token is missing or expired. Store a fresh token.',
      };
    }

    const { serviceTypeId, gstServiceTypeId } = this.config.panVerify;

    // 1) PAN details (serviceTypeId 66).
    const panCall = await this.callService(token, serviceTypeId, pan);
    if (panCall.error) return { pan, verified: false, message: panCall.error };
    const record = extractPanRecord(panCall.payload);
    if (!record) {
      return {
        pan,
        verified: false,
        message: extractMessage(panCall.payload) ?? 'No PAN record found.',
      };
    }
    const fields = mapPanFields(record);
    // A record with no holder name is not a verification (it is usually an error object in disguise).
    if (!fields.name) {
      return { pan, verified: false, message: 'No PAN record found.' };
    }

    // 2) GSTINs linked to the PAN (serviceTypeId 12) — best-effort; never blocks PAN verification.
    let gstins: GstinEntry[] | undefined;
    try {
      const gstCall = await this.callService(token, gstServiceTypeId, pan);
      if (!gstCall.error) gstins = extractGstList(gstCall.payload);
    } catch (err) {
      this.logger.debug(`GST-by-PAN lookup failed: ${(err as Error).message}`);
    }

    const out: PanVerificationResult = {
      pan,
      verified: true,
      name: fields.name,
      status: fields.panStatus,
      fields,
      gstins,
    };
    if (scope) await this.cache.set(scope, 'pan', pan, out);
    return out;
  }

  /** Fetch the full profile for one GSTIN (EY serviceTypeId 30). */
  async verifyGstin(gstinInput: string, scope?: string): Promise<GstVerificationResult> {
    const gstin = (gstinInput ?? '').trim().toUpperCase();
    if (!/^[0-9A-Z]{15}$/.test(gstin)) {
      return { gstin, verified: false, message: 'Enter a valid 15-character GSTIN.' };
    }
    if (!this.enabled) {
      return { gstin, verified: false, message: 'GST verification is not configured.' };
    }

    if (scope) {
      const hit = await this.cache.get<GstVerificationResult>(scope, 'gst', gstin);
      if (hit) return { ...hit, cached: true };
    }

    const token = await this.getToken();
    if (!token) {
      return {
        gstin,
        verified: false,
        message: 'Verification token is missing or expired. Store a fresh token.',
      };
    }

    const call = await this.callService(token, this.config.panVerify.gstVerifyServiceTypeId, gstin);
    if (call.error) return { gstin, verified: false, message: call.error };
    const record = extractGstDetailRecord(call.payload);
    if (!record) {
      return {
        gstin,
        verified: false,
        message: extractMessage(call.payload) ?? 'No GST record found.',
      };
    }
    const out: GstVerificationResult = {
      gstin,
      verified: true,
      details: mapGstDetails(gstin, record),
    };
    if (scope) await this.cache.set(scope, 'gst', gstin, out);
    return out;
  }

  /**
   * Penny-less bank-account verification (EY serviceTypeId 27). Confirms the account is active
   * and returns the registered holder name, then matches that name against the vendor's PAN /
   * legal / trade names (≥80% required).
   */
  async verifyBank(
    accountNumberInput: string,
    ifscInput: string,
    names: BankNameCandidates = {},
    scope?: string,
  ): Promise<BankVerificationResult> {
    const accountNumber = (accountNumberInput ?? '').replace(/\s+/g, '');
    const ifsc = (ifscInput ?? '').trim().toUpperCase();
    if (!/^\d{5,20}$/.test(accountNumber)) {
      return { verified: false, message: 'Enter a valid bank account number.' };
    }
    if (!validateIfsc(ifsc).valid) {
      return { verified: false, message: 'Enter a valid IFSC code.' };
    }
    if (!this.enabled) {
      return { verified: false, message: 'Bank verification is not configured.' };
    }

    // Cache only the provider-derived profile (active + holder). The name match is recomputed
    // against the current PAN/legal/trade names each time, so edits take effect without a re-call.
    const cacheKey = `${accountNumber}|${ifsc}`;
    let details: BankDetails | null = scope
      ? await this.cache.get<BankDetails>(scope, 'bank', cacheKey)
      : null;
    const cached = details !== null;

    if (!details) {
      const token = await this.getToken();
      if (!token) {
        return {
          verified: false,
          message: 'Verification token is missing or expired. Store a fresh token.',
        };
      }
      const call = await this.callService(
        token,
        this.config.panVerify.bankVerifyServiceTypeId,
        accountNumber,
        { ifsc },
      );
      if (call.error) return { verified: false, message: call.error };
      const record = extractBankRecord(call.payload);
      if (!record) {
        return {
          verified: false,
          message: extractMessage(call.payload) ?? 'No bank record found.',
        };
      }
      details = mapBankDetails(record, accountNumber, ifsc);
      // Cache the definitive provider answer (active or inactive); never transient errors.
      if (scope) await this.cache.set(scope, 'bank', cacheKey, details);
    }

    // Account not active (or the bank rejected the check) — surface the provider's reason clearly.
    if (details.active !== true) {
      const reason = details.reason ?? details.message;
      return {
        verified: false,
        active: details.active,
        details,
        cached,
        message: `Bank account validation failed${reason ? `: ${reason}` : '.'}`,
      };
    }

    const nameMatch = details.holderName ? matchHolderName(details.holderName, names) : undefined;
    return { verified: true, active: details.active, details, nameMatch, cached };
  }

  /** Fetch MSME / Udyam registration details for a PAN (EY serviceTypeId 92). */
  async verifyMsme(panInput: string, scope?: string): Promise<MsmeVerificationResult> {
    const result = validatePan(panInput);
    if (!result.valid || !result.pan) {
      return { pan: panInput, verified: false, message: result.errors[0] ?? 'Invalid PAN.' };
    }
    const pan = result.pan;
    if (!this.enabled) {
      return { pan, verified: false, message: 'MSME verification is not configured.' };
    }

    if (scope) {
      const hit = await this.cache.get<MsmeVerificationResult>(scope, 'msme', pan);
      if (hit) return { ...hit, cached: true };
    }

    const token = await this.getToken();
    if (!token) {
      return {
        pan,
        verified: false,
        message: 'Verification token is missing or expired. Store a fresh token.',
      };
    }

    const call = await this.callService(token, this.config.panVerify.msmeServiceTypeId, pan);
    if (call.error) return { pan, verified: false, message: call.error };
    const record = extractMsmeRecord(call.payload);
    if (!record) {
      return {
        pan,
        verified: false,
        message: extractMessage(call.payload) ?? 'No MSME / Udyam registration found for this PAN.',
      };
    }

    const out: MsmeVerificationResult = { pan, verified: true, details: mapMsmeDetails(record) };
    if (scope) await this.cache.set(scope, 'msme', pan, out);
    return out;
  }

  /** Call the EY central-verification service for a given serviceTypeId + ID number. */
  private async callService(
    token: string,
    serviceTypeId: string,
    idNumber: string,
    extra?: Record<string, string>,
  ): Promise<{ payload?: unknown; error?: string }> {
    const { baseUrl } = this.config.panVerify;
    let res: Response;
    try {
      res = await fetch(`${trim(baseUrl)}/api/eic/v1/central-verification/getCentralService`, {
        method: 'POST',
        headers: { 'x-access-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceTypeId, IDNumber: idNumber, ...extra }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      this.logger.warn(`Verification request failed: ${(err as Error).message}`);
      return { error: 'Verification provider is unavailable.' };
    }
    if (res.status === 401 || res.status === 403) {
      return { error: 'Token was rejected (expired?). Store a fresh token.' };
    }
    const payload = await safeJson(res);
    const providerMsg = extractMessage(payload);
    if (!res.ok || /invalid token|unauthor|expired/i.test(providerMsg ?? '')) {
      const tokenProblem = /invalid token|unauthor|expired/i.test(providerMsg ?? '');
      return {
        error: tokenProblem
          ? 'Stored token was rejected (invalid or expired). Store a fresh token.'
          : (providerMsg ?? `Provider returned ${res.status}.`),
      };
    }
    // The provider can answer HTTP 200 and still report a failure inside the body, for example
    // statusCode 425 with { code: 401, message: "IP not whitelisted" }. That is an error, not a record.
    const failure = providerFailure(payload);
    if (failure) {
      return {
        error: /ip not whitelisted/i.test(failure)
          ? "The verification provider rejected this server's IP address (not whitelisted). Ask the provider to whitelist the server's current public IP, then try again."
          : failure,
      };
    }
    return { payload };
  }
}

/** A failure reported inside a provider response body, or undefined when the body reports success. */
function providerFailure(payload: unknown): string | undefined {
  const root = payload as { response?: { body?: unknown }; body?: unknown } | undefined;
  const body = (root?.response?.body ?? root?.body) as
    { statusCode?: unknown; statusMsg?: unknown; data?: { message?: unknown } } | undefined;
  if (!body || typeof body.statusCode !== 'number' || body.statusCode < 400) return undefined;
  const first = Array.isArray(body.data?.message)
    ? (body.data.message[0] as { message?: unknown } | undefined)
    : undefined;
  if (typeof first?.message === 'string' && first.message) return first.message;
  if (typeof body.statusMsg === 'string' && body.statusMsg) return body.statusMsg;
  return `The provider returned status ${body.statusCode}.`;
}

function trim(u: string): string {
  return u.replace(/\/$/, '');
}

/**
 * True only when a JWT's own `exp` claim is in the past. The EY token is a JWT, so its embedded
 * expiry is authoritative — this avoids depending on the hand-managed `expires_at` DB column.
 * A token that isn't a decodable JWT is treated as usable (the provider will reject it if invalid).
 */
function isTokenExpired(token: string): boolean {
  const exp = jwtExpDate(token);
  return exp ? exp.getTime() <= Date.now() : false;
}

/** The `exp` of a JWT as a Date, or null if the token isn't a decodable JWT with an exp. */
function jwtExpDate(token: string): Date | null {
  const body = token.split('.')[1];
  if (!body) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof payload.exp === 'number') return new Date(payload.exp * 1000);
  } catch {
    /* not a decodable JWT */
  }
  return null;
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Locate the PAN record in the provider payload. Observed shape:
 *   { body: { statusCode, statusMsg, data: { message: [ { pan_number, full_name, ... } ] } } }
 * Falls back across a couple of nesting variants and returns the first record object.
 */
function extractPanRecord(payload: unknown): Record<string, unknown> | null {
  const asObj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

  // Search for a `message` (or `data`) array of records anywhere in the tree.
  const find = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 6 || !node || typeof node !== 'object') return null;
    const o = node as Record<string, unknown>;
    for (const key of ['message', 'records', 'data']) {
      const v = o[key];
      if (Array.isArray(v) && v.length && asObj(v[0])) return asObj(v[0])!;
    }
    for (const v of Object.values(o)) {
      const found = find(v, depth + 1);
      if (found) return found;
    }
    return null;
  };

  // If the record itself has pan fields at some object level, accept it directly.
  const direct = (node: unknown, depth = 0): Record<string, unknown> | null => {
    const o = asObj(node);
    if (!o) return null;
    if ('pan_number' in o || 'full_name' in o || 'pan' in o) return o;
    if (depth > 6) return null;
    for (const v of Object.values(o)) {
      const found = direct(v, depth + 1);
      if (found) return found;
    }
    return null;
  };

  return find(payload) ?? direct(payload);
}

/**
 * Extract the GSTIN list from the PAN-to-GST payload. Observed shape:
 *   { response: { body: { data: [ { gstin, authStatus, Gstineinvoicestatus } ] } } }
 * Deep-search for the first array whose elements carry a `gstin`.
 */
function extractGstList(payload: unknown): GstinEntry[] {
  const find = (node: unknown, depth = 0): Record<string, unknown>[] | null => {
    if (depth > 7 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      const first = node[0];
      if (first && typeof first === 'object' && 'gstin' in (first as object)) {
        return node as Record<string, unknown>[];
      }
      return null;
    }
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = find(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const arr = find(payload) ?? [];
  return arr
    .map((x) => ({
      gstin: (str(x.gstin) ?? '').toUpperCase(),
      authStatus: str(x.authStatus) ?? str(x.status),
    }))
    .filter((x) => /^[0-9A-Z]{15}$/.test(x.gstin));
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Locate the bank-verification record. Observed shape:
 *   { response: { body: { data: { active, beneName, beneIFSC, Account_No, ... } } } }
 * Deep-search for the first object carrying bank fields.
 */
function extractBankRecord(payload: unknown): Record<string, unknown> | null {
  const hasBank = (o: Record<string, unknown>): boolean =>
    'beneName' in o || 'Account_No' in o || 'bankRRN' in o || 'beneIFSC' in o;
  const find = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 8 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = find(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    if (hasBank(o)) return o;
    for (const v of Object.values(o)) {
      const found = find(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return find(payload);
}

/** Map a bank-verification record to our normalized details. */
function mapBankDetails(
  r: Record<string, unknown>,
  accountInput: string,
  ifscInput: string,
): BankDetails {
  const activeRaw = str(r.active);
  const active = activeRaw === undefined ? undefined : /^(yes|y|true|active)$/i.test(activeRaw);
  return {
    accountNumber: str(r.Account_No) ?? accountInput,
    ifsc: str(r.beneIFSC) ?? ifscInput,
    active,
    activeStatus: activeRaw ?? str(r.reason),
    holderName: str(r.beneName),
    bankRRN: str(r.bankRRN),
    reason: str(r.reason),
    message: str(r.response) ?? str(r.reason),
  };
}

/**
 * Locate the MSME record. Observed shape:
 *   { response: { body: { data: { message: [ { enterprise_data: { udyam_reg_no, ... } } ] } } } }
 * Deep-search for the first object carrying `enterprise_data`.
 */
function extractMsmeRecord(payload: unknown): Record<string, unknown> | null {
  const asObj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  const find = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 8 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = find(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    const ed = asObj(o.enterprise_data);
    if (ed && ('udyam_reg_no' in ed || 'enterprise_type' in ed || 'organization_type' in ed)) {
      return ed;
    }
    for (const v of Object.values(o)) {
      const found = find(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return find(payload);
}

/** Map an MSME enterprise_data record to our normalized fields. */
function mapMsmeDetails(r: Record<string, unknown>): MsmeDetails {
  return {
    udyamNumber: str(r.udyam_reg_no),
    registrationDate: str(r.date_of_udyam_registration),
    organizationType: str(r.organization_type),
    enterpriseType: str(r.enterprise_type),
    officialName: str(r.official_name),
    majorActivity: str(r.major_activity),
  };
}

/** Best similarity of the holder name against the PAN / legal / trade names (percentage). */
function matchHolderName(holder: string, names: BankNameCandidates): BankNameMatch {
  const candidates: Array<{ label: string; value?: string }> = [
    { label: 'PAN name', value: names.panName },
    { label: 'legal name', value: names.legalName },
    { label: 'trade name', value: names.tradeName },
  ];
  let best: BankNameMatch = { score: 0, matched: false };
  for (const c of candidates) {
    if (!c.value) continue;
    const score = Math.round(nameMatchScore(holder, c.value) * 100);
    if (score > best.score) {
      best = { score, matched: false, matchedAgainst: c.label, bestName: c.value };
    }
  }
  best.matched = best.score >= BANK_NAME_MATCH_THRESHOLD;
  return best;
}

/** Map a provider PAN record to our normalized fields. */
function mapPanFields(r: Record<string, unknown>): PanDetails {
  const aadhaar = resolveAadhaarSeeding(r);
  return {
    name: str(r.full_name) ?? str(r.name) ?? str(r.pan_holder_name),
    fatherName: str(r.father_name) ?? str(r.fathers_name) ?? str(r.father),
    category: str(r.category) ?? str(r.pan_type),
    panStatus: str(r.status) ?? str(r.pan_status),
    aadhaarLinked: aadhaar.linked,
    aadhaarStatus: aadhaar.status,
    maskedAadhaar: str(r.masked_aadhaar) ?? str(r.aadhaar),
    dob: str(r.dob),
    gender: str(r.gender),
  };
}

/**
 * Resolve PAN–Aadhaar seeding into a boolean (when known) plus an always-present label.
 * Providers report this as a boolean or as strings like "Y"/"N"/"Linked"/"Not Linked".
 */
function resolveAadhaarSeeding(r: Record<string, unknown>): {
  linked?: boolean;
  status: string;
} {
  if (typeof r.aadhaar_linked === 'boolean') {
    return { linked: r.aadhaar_linked, status: r.aadhaar_linked ? 'Linked' : 'Not linked' };
  }
  const raw =
    str(r.aadhaar_seeding_status) ??
    str(r.aadhaarSeedingStatus) ??
    str(r.seeding_status) ??
    str(r.aadhaar_status) ??
    str(r.aadhaarStatus) ??
    str(r.aadhaar_link_status);
  if (raw) {
    const v = raw.toLowerCase();
    const notLinked =
      /^(n|no|false)$/.test(v) ||
      v.includes('not linked') ||
      v.includes('not-linked') ||
      v.includes('not seeded');
    if (notLinked) return { linked: false, status: 'Not linked' };
    if (/^(y|yes|true|linked|seeded)$/.test(v) || v.includes('linked') || v.includes('seeded')) {
      return { linked: true, status: 'Linked' };
    }
    return { status: raw };
  }
  return { status: 'Not available' };
}

/**
 * Locate the detailed GST record in a serviceTypeId-30 payload. Observed shape:
 *   { response: { body: { data: { message: [ { gstnDetailed?, legalNameOfBusiness, ... } ] } } } }
 * Deep-search for the first object carrying GST profile fields.
 */
function extractGstDetailRecord(payload: unknown): Record<string, unknown> | null {
  const asObj = (v: unknown): Record<string, unknown> | undefined =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  const hasProfile = (o: Record<string, unknown>): boolean =>
    'legalNameOfBusiness' in o || 'gstinStatus' in o || 'constitutionOfBusiness' in o;

  const find = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 8 || !node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = find(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const o = node as Record<string, unknown>;
    // Prefer the richer gstnDetailed block when present.
    const detailed = asObj(o.gstnDetailed);
    if (detailed && hasProfile(detailed)) return { ...o, ...detailed };
    if (hasProfile(o)) return o;
    for (const v of Object.values(o)) {
      const found = find(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return find(payload);
}

/** Map a GST profile record to our normalized details, including the latest filing. */
function mapGstDetails(gstin: string, r: Record<string, unknown>): GstDetails {
  const ppa = (r.principalPlaceAddress ?? {}) as Record<string, unknown>;
  const split = (ppa.splitAddress ?? {}) as Record<string, unknown>;
  const filings = extractFilings(r.filingStatus);
  return {
    gstin,
    legalName: str(r.legalNameOfBusiness),
    tradeName: str(r.tradeNameOfBusiness),
    constitutionOfBusiness: str(r.constitutionOfBusiness),
    taxPayerType: str(r.taxPayerType),
    gstStatus: str(r.gstinStatus),
    registrationDate: str(r.registrationDate),
    principalAddress: str(ppa.address),
    state: firstNested(split.state),
    city: firstNested(split.city),
    pincode: str(split.pincode),
    latestFiling: filings[0],
    filings: filings.slice(0, 8),
  };
}

/** splitAddress fields are arrays, sometimes nested (state: [["DELHI","DL"]], city: ["NEW DELHI"]). */
function firstNested(v: unknown): string | undefined {
  if (Array.isArray(v)) {
    const first = v[0];
    if (Array.isArray(first)) return str(first[0]);
    return str(first);
  }
  return str(v);
}

/** Normalize and sort the filing list newest-first by dd/mm/yyyy date. */
function extractFilings(v: unknown): GstFiling[] {
  if (!Array.isArray(v)) return [];
  const toTs = (d?: string): number => {
    const m = d?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : 0;
  };
  return v
    .map((x) => x as Record<string, unknown>)
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      filingYear: str(x.filingYear),
      monthOfFiling: str(x.monthOfFiling),
      methodOfFilling: str(x.methodOfFilling),
      dateOfFiling: str(x.dateOfFiling),
      gstType: str(x.gstType),
      gstStatus: str(x.gstStatus),
    }))
    .sort((a, b) => toTs(b.dateOfFiling) - toTs(a.dateOfFiling));
}

function extractMessage(payload: unknown): string | undefined {
  const pick = (o: Record<string, unknown>): string | undefined => {
    for (const k of Object.keys(o)) {
      if (['message', 'error', 'errormessage', 'msg', 'statusmsg'].includes(k.toLowerCase())) {
        if (typeof o[k] === 'string' && o[k]) return o[k] as string;
      }
    }
    return undefined;
  };
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;
    return pick(o) ?? (o.body ? extractMessage(o.body) : undefined);
  }
  return undefined;
}
