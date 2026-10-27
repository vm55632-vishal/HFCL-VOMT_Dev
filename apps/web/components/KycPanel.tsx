'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { Icon } from './icons';
import { initials } from './DetailParts';
import { useModalBehavior } from './useModalBehavior';

type KycStatus = 'not_initiated' | 'pending' | 'in_progress' | 'passed' | 'failed';

interface KycCheck {
  key: string;
  label: string;
  description: string;
  scope: string;
  turnaround: string;
  status: KycStatus;
  initiatedAt: string | null;
  updatedAt: string | null;
  summary: string | null;
}
interface KycSummary {
  case: { id: string; ref: string; legalName: string; stage: string };
  signatory: { name: string; mobile: string; email: string; pan: string };
  overall: 'not_initiated' | 'in_progress' | 'passed' | 'failed';
  ready: boolean;
  canInitiate: boolean;
  checks: KycCheck[];
}

const STATUS_LABEL: Record<KycStatus, string> = {
  not_initiated: 'Not Initiated',
  pending: 'Pending',
  in_progress: 'In Progress',
  passed: 'Passed',
  failed: 'Failed',
};
const CHECK_ICON: Record<string, string> = {
  digi_kyc: 'user',
  hunter: 'search',
  ixsite: 'flow',
  crif_cibil: 'chart',
};
const CHECK_TONE: Record<string, string> = {
  digi_kyc: 'indigo',
  hunter: 'blue',
  ixsite: 'green',
  crif_cibil: 'red',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const prettyStage = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/**
 * Digi KYC & risk checks on a case's authorised signatory: the signatory, the "Initiate Digi KYC"
 * action and the checklist. Used on the case's KYC page and as the last step of the intake form
 * (`embedded`, where the case is still a draft and the page has its own heading).
 */
export default function KycPanel({
  caseId,
  embedded = false,
  beforeInitiate,
}: {
  caseId: string;
  embedded?: boolean;
  /** Runs before the confirmation opens, e.g. to save the draft so the signatory is current. */
  beforeInitiate?: () => Promise<void>;
}) {
  const [data, setData] = useState<KycSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<KycSummary>(`/cases/${caseId}/kyc`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the KYC checks.');
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a run is in progress, refresh every few seconds; the server moves the run forward on read.
  const running = data?.overall === 'in_progress';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [running, load]);

  async function confirm() {
    if (beforeInitiate) {
      await beforeInitiate();
      await load();
    }
    setConfirming(true);
  }

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Loading KYC checks…</p>
    );
  }

  const { signatory, case: c } = data;
  const verification: { label: string; tone: string } =
    data.overall === 'passed'
      ? { label: 'Verified', tone: 'passed' }
      : data.overall === 'failed'
        ? { label: 'Review required', tone: 'failed' }
        : data.overall === 'in_progress'
          ? { label: 'In Progress', tone: 'in_progress' }
          : { label: 'Not Initiated', tone: 'not_initiated' };

  const hint = !data.ready
    ? "The authorised signatory's name and PAN are missing on this case."
    : data.overall === 'in_progress'
      ? 'Verification is in progress. You cannot start it again until it finishes.'
      : data.overall !== 'not_initiated'
        ? 'The checks have finished for this case.'
        : data.canInitiate
          ? 'This will trigger Digi KYC and the configured verification workflow for the authorised signatory.'
          : 'You do not have permission to start these checks.';

  return (
    <div className="kyc">
      {!embedded && (
        <header className="kyc__head">
          <div className="kyc__title">
            <span className="kyc__titleicon" aria-hidden="true">
              <Icon name="shield" size={26} />
            </span>
            <div>
              <h1>Digi KYC &amp; Risk Checks</h1>
              <p className="lead">
                Verification of the authorised signatory against multiple data sources
              </p>
            </div>
          </div>
          <dl className="kyc__case">
            <div>
              <dt>Case ID</dt>
              <dd>{c.ref}</dd>
            </div>
            <div>
              <dt>Vendor Name</dt>
              <dd>{c.legalName || '—'}</dd>
            </div>
            <div>
              <dt>Current Stage</dt>
              <dd>
                <span className="pill pill--warn">{prettyStage(c.stage)}</span>
              </dd>
            </div>
          </dl>
        </header>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div>
        <div className="kyc__main">
          <section className="card kyc__card">
            <h2 className="kyc__h2">
              <Icon name="user" size={18} /> Authorised Signatory Details
            </h2>
            <div className="kyc__person">
              <span className="kyc__avatar" aria-hidden="true">
                {initials(signatory.name) || '?'}
              </span>
              <div className="kyc__who">
                <strong>{signatory.name || 'Not provided'}</strong>
                <span className="muted">Authorised Signatory</span>
              </div>
              <dl className="kyc__facts">
                <div>
                  <dt>Email</dt>
                  <dd>{signatory.email || '—'}</dd>
                </div>
                <div>
                  <dt>Mobile</dt>
                  <dd>{signatory.mobile ? `+91 ${signatory.mobile}` : '—'}</dd>
                </div>
                <div>
                  <dt>PAN</dt>
                  <dd>{signatory.pan || '—'}</dd>
                </div>
                <div>
                  <dt>Vendor Name</dt>
                  <dd>{c.legalName || '—'}</dd>
                </div>
              </dl>
              <div className="kyc__verif">
                <small>Verification Status</small>
                <span className={`kyc-pill kyc-pill--${verification.tone}`}>
                  {verification.label}
                </span>
              </div>
            </div>
          </section>

          <div className="kyc__info" role="note">
            <Icon name="alert" size={18} />
            <div>
              <strong>Before you begin</strong>
              <p>
                Please verify that the authorised signatory details are correct before initiating
                Digi KYC and the associated checks.
              </p>
              <small>
                All checks below relate to the authorised signatory, not the vendor entity itself.
              </small>
            </div>
          </div>

          <div className="kyc__action">
            <button
              type="button"
              className="btn kyc__go"
              disabled={!data.canInitiate}
              onClick={() => void confirm()}
            >
              {data.overall === 'in_progress' ? 'Verification in progress…' : 'Initiate Digi KYC'}
              <Icon name="chevron" size={16} />
            </button>
            <p className="muted tiny">{hint}</p>
          </div>

          <section className="card kyc__card">
            <h2 className="kyc__h2">
              <Icon name="list" size={18} /> Verification Checklist
            </h2>
            <p className="muted">
              Track the status of each check below. Each check is performed against the authorised
              signatory person.
            </p>
            <ul className="kyc__checks">
              {data.checks.map((k) => {
                const expandable = !!k.summary;
                return (
                  <li key={k.key} className="kyc__check">
                    <button
                      type="button"
                      className="kyc__row"
                      aria-expanded={open === k.key}
                      disabled={!expandable}
                      onClick={() => setOpen(open === k.key ? null : k.key)}
                    >
                      <span
                        className={`kyc__ico kyc__ico--${CHECK_TONE[k.key] ?? 'blue'}`}
                        aria-hidden="true"
                      >
                        <Icon name={CHECK_ICON[k.key] ?? 'shield'} size={20} />
                      </span>
                      <span className="kyc__name">
                        <strong>{k.label}</strong>
                        <small>{k.description}</small>
                      </span>
                      <span className={`kyc-pill kyc-pill--${k.status}`}>
                        {STATUS_LABEL[k.status]}
                      </span>
                      <span className="kyc__when">
                        <small>Initiated On</small>
                        {when(k.initiatedAt)}
                      </span>
                      <span className="kyc__when">
                        <small>Last Updated</small>
                        {when(k.updatedAt)}
                      </span>
                      <span
                        className={`kyc__chev${open === k.key ? ' is-open' : ''}`}
                        aria-hidden="true"
                      >
                        {expandable && <Icon name="chevron" size={16} />}
                      </span>
                    </button>
                    {open === k.key && k.summary && <p className="kyc__summary">{k.summary}</p>}
                  </li>
                );
              })}
            </ul>
          </section>

          <aside className="kyc__important" aria-label="Important">
            <Icon name="shield" size={20} />
            <div>
              <strong>Important</strong>
              <ul>
                <li>The verification is triggered for the current authorised signatory only.</li>
                <li>You cannot initiate Digi KYC again while a verification is in progress.</li>
                <li>If any check fails, the case is marked for review as per policy.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          data={data}
          onCancel={() => setConfirming(false)}
          onDone={(next) => {
            setData(next);
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
/** "Confirm Digi KYC Initiation": the proposer ticks that the signatory details are correct first. */
function ConfirmDialog({
  data,
  onCancel,
  onDone,
}: {
  data: KycSummary;
  onCancel: () => void;
  onDone: (next: KycSummary) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useModalBehavior({ panelRef, initialFocusRef: boxRef, onClose: onCancel, blocked: busy });

  async function start() {
    if (!agreed || busy) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await apiFetch<KycSummary>(`/cases/${data.case.id}/kyc/initiate`, { method: 'POST' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the checks.');
      setBusy(false);
    }
  }

  return (
    <div
      className="vdm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="vdm__panel dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kyc-title"
      >
        <div className="vdm__grab" aria-hidden="true" />
        <div className="dlg__body">
          <span className="dlg__icon dlg__icon--warn" aria-hidden="true">
            <Icon name="shield" size={24} />
          </span>
          <h2 id="kyc-title">Confirm Digi KYC Initiation</h2>
          <p className="dlg__text">
            You are about to initiate Digi KYC and the following checks for the authorised
            signatory:
          </p>
          <div className="kyc__confirm">
            <span className="kyc__avatar" aria-hidden="true">
              {initials(data.signatory.name) || '?'}
            </span>
            <div>
              <strong>{data.signatory.name}</strong>
              <small>Authorised Signatory</small>
            </div>
            <div>
              <small>Vendor</small>
              <strong>{data.case.legalName}</strong>
              <small>Case ID: {data.case.ref}</small>
            </div>
          </div>
          <ul className="kyc__ticks">
            {data.checks.map((k) => (
              <li key={k.key}>
                <Icon name="check" size={14} /> <strong>{k.label}</strong> <span>({k.scope})</span>
              </li>
            ))}
          </ul>
          <label className="checkbox kyc__agree">
            <input
              ref={boxRef}
              type="checkbox"
              checked={agreed}
              disabled={busy}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I confirm that the signatory details are correct and I agree to proceed with the
              verification process.
            </span>
          </label>
          {err && (
            <div className="rv-alert rv-alert--warn" role="alert" style={{ marginTop: 12 }}>
              <Icon name="alert" size={18} />
              <span>{err}</span>
            </div>
          )}
        </div>
        <div className="dlg__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void start()}
            disabled={!agreed || busy}
          >
            {busy ? 'Starting…' : 'Initiate Digi KYC'}
          </button>
        </div>
      </div>
    </div>
  );
}
