import type { KycCheckKey } from '@vop/shared';
import type { KycCheckResult, KycProvider, KycSubject } from './contracts';

/** How long each simulated check takes. A live provider is minutes to an hour; the mock is seconds. */
const MOCK_CHECK_MS = 8_000;

/**
 * Words in the authorised signatory's name that make a mock check fail, so the failure path can be
 * exercised end to end. Everything else passes. For example, a signatory named "Test Fraud Kumar"
 * fails the Hunter check. "noshow" leaves Digi KYC incomplete (the vendor never finished it).
 */
const MOCK_INCOMPLETE_MARKER = 'noshow';
const MOCK_INCOMPLETE_SUMMARY =
  'The vendor did not complete Digi KYC before the link expired (mock result).';

const MOCK_FAIL_MARKER: Record<KycCheckKey, string> = {
  digi_kyc: 'fakeid',
  hunter: 'fraud',
  ixsite: 'blocked',
  crif_cibil: 'default',
};

const MOCK_FAIL_SUMMARY: Record<KycCheckKey, string> = {
  digi_kyc: 'Identity could not be verified (mock result).',
  hunter: 'Possible watchlist / PEP match found (mock result).',
  ixsite: 'Adverse match on a global database (mock result).',
  crif_cibil: 'Adverse credit history reported (mock result).',
};

const MOCK_PASS_SUMMARY: Record<KycCheckKey, string> = {
  digi_kyc: 'Identity verified (mock result).',
  hunter: 'No sanctions, watchlist or PEP match (mock result).',
  ixsite: 'No adverse match on global databases (mock result).',
  crif_cibil: 'No adverse credit history (mock result).',
};

/**
 * Deterministic stand-in for the KYC provider: no network, no real data. A check "runs" for a few
 * seconds and then passes, unless the signatory's name carries one of the fail markers above.
 */
export class MockKycProvider implements KycProvider {
  readonly name = 'mock';

  start(check: KycCheckKey, subject: KycSubject): Promise<{ ref: string }> {
    const name = subject.name.toLowerCase();
    const outcome =
      check === 'digi_kyc' && name.includes(MOCK_INCOMPLETE_MARKER)
        ? 'incomplete'
        : name.includes(MOCK_FAIL_MARKER[check])
          ? 'fail'
          : 'pass';
    // No link: the mock has no vendor-facing journey.
    return Promise.resolve({ ref: `mock:${check}:${Date.now()}:${outcome}` });
  }

  poll(check: KycCheckKey, ref: string): Promise<KycCheckResult> {
    const [, , startedAt, outcome] = ref.split(':');
    const elapsed = Date.now() - Number(startedAt);
    if (!Number.isFinite(elapsed) || elapsed < MOCK_CHECK_MS) {
      return Promise.resolve({ status: 'in_progress' });
    }
    if (outcome === 'incomplete') {
      return Promise.resolve({ status: 'incomplete', summary: MOCK_INCOMPLETE_SUMMARY });
    }
    return Promise.resolve(
      outcome === 'fail'
        ? { status: 'failed', summary: MOCK_FAIL_SUMMARY[check] }
        : { status: 'passed', summary: MOCK_PASS_SUMMARY[check] },
    );
  }
}

/**
 * Placeholder for the live KYC provider.
 * TODO: implement against the provider's documented API once the provider and sandbox credentials
 * are confirmed. Do not invent the contract.
 */
export class NotImplementedKyc implements KycProvider {
  readonly name = 'aggregator (not implemented)';
  start(): Promise<{ ref: string }> {
    return Promise.reject(new Error('The KYC provider is not configured yet (stub).'));
  }
  poll(): Promise<KycCheckResult> {
    return Promise.reject(new Error('The KYC provider is not configured yet (stub).'));
  }
}
