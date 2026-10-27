/**
 * KYC & risk checks run against a case's authorised signatory. They run one after another, starting
 * with Digi KYC. Labels and wording live here so the API and the web UI describe them identically.
 */
export const KYC_CHECKS = ['digi_kyc', 'hunter', 'ixsite', 'crif_cibil'] as const;
export type KycCheckKey = (typeof KYC_CHECKS)[number];

export interface KycCheckMeta {
  label: string;
  /** One line under the check's name. */
  description: string;
  /** What the check looks at. */
  scope: string;
  /** Typical turnaround with a live provider (indicative only). */
  turnaround: string;
}

export const KYC_CHECK_META: Record<KycCheckKey, KycCheckMeta> = {
  digi_kyc: {
    label: 'Digi KYC',
    description: 'Identity verification and KYC workflow',
    scope: 'Identity verification',
    turnaround: '~ 15 mins',
  },
  hunter: {
    label: 'Hunter Check',
    description: 'Screening against sanctions, watchlists and PEP databases',
    scope: 'Watchlist & PEP screening',
    turnaround: '~ 30 mins',
  },
  ixsite: {
    label: 'IXSite Check',
    description: 'Verification / screening against global databases',
    scope: 'Global database screening',
    turnaround: '~ 30 mins',
  },
  crif_cibil: {
    label: 'CRIF / CIBIL Check',
    description: 'Credit check for the authorised signatory',
    scope: 'Credit bureau report',
    turnaround: '~ 1 hour',
  },
};

/**
 * not_initiated = nothing started; pending = waiting its turn; in_progress / passed / failed;
 * incomplete = the vendor did not finish (e.g. the Digi KYC link expired), with the reason.
 */
export type KycStatus =
  'not_initiated' | 'pending' | 'in_progress' | 'passed' | 'failed' | 'incomplete';

/**
 * Digi KYC runs on its own: the proposer starts it from the intake form and the vendor completes it.
 * The risk checks (Hunter, IXSite, CRIF / CIBIL) are for the FCU team only, who start them from the
 * case and see their results; nobody else is shown them.
 */
export const DIGI_KYC_CHECKS: readonly KycCheckKey[] = ['digi_kyc'];
export const RISK_CHECKS: readonly KycCheckKey[] = ['hunter', 'ixsite', 'crif_cibil'];
export type KycGroup = 'digi' | 'risk';
export const kycGroupOf = (check: KycCheckKey): KycGroup =>
  DIGI_KYC_CHECKS.includes(check) ? 'digi' : 'risk';
export const KYC_GROUP_CHECKS: Record<KycGroup, readonly KycCheckKey[]> = {
  digi: DIGI_KYC_CHECKS,
  risk: RISK_CHECKS,
};
