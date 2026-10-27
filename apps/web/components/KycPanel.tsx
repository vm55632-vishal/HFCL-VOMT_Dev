'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import { Icon } from './icons';
import { initials } from './DetailParts';
import { useModalBehavior } from './useModalBehavior';

type KycStatus = 'not_initiated' | 'pending' | 'in_progress' | 'passed' | 'failed' | 'incomplete';

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
  ready: boolean;
  /** Digi KYC: the vendor completes it from the emailed request. */
  digi: KycCheck & { canInitiate: boolean };
  /** Hunter, IXSite and CRIF / CIBIL: only sent to the FCU team. */
  risk?: {
    overall: 'not_initiated' | 'in_progress' | 'passed' | 'failed';
    canInitiate: boolean;
    checks: KycCheck[];
  };
}

// Digi KYC is done by the vendor, so its outcomes read as completed / rejected / incomplete.
const DIGI_LABEL: Record<KycStatus, string> = {
  not_initiated: 'Not Initiated',
  pending: 'Pending',
  in_progress: 'Awaiting vendor',
  passed: 'Completed',
  failed: 'Rejected',
  incomplete: 'Incomplete',
};
const RISK_LABEL: Record<KycStatus, string> = {
  not_initiated: 'Not Initiated',
  pending: 'Pending',
  in_progress: 'In Progress',
  passed: 'Passed',
  failed: 'Failed',
  incomplete: 'Incomplete',
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

/** One check as a row: name, status, when it started and last changed, and its result. */
function CheckRow({ k, labels }: { k: KycCheck; labels: Record<KycStatus, string> }) {
  return (
    <li className="kyc__check">
      <div className="kyc__row">
        <span className={`kyc__ico kyc__ico--${CHECK_TONE[k.key] ?? 'blue'}`} aria-hidden="true">
          <Icon name={CHECK_ICON[k.key] ?? 'shield'} size={20} />
        </span>
        <span className="kyc__name">
          <strong>{k.label}</strong>
          <small>{k.description}</small>
        </span>
        <span className={`kyc-pill kyc-pill--${k.status}`}>{labels[k.status]}</span>
        <span className="kyc__when">
          <small>Initiated On</small>
          {when(k.initiatedAt)}
        </span>
        <span className="kyc__when">
          <small>Last Updated</small>
          {when(k.updatedAt)}
        </span>
        <span />
      </div>
      {k.summary && (
        <p className="kyc__reason">
          <strong>{k.status === 'passed' ? 'Result' : 'Reason'}:</strong> {k.summary}
        </p>
      )}
    </li>
  );
}

/**
 * Digi KYC on a case's authorised signatory: initiating it emails the vendor to complete it, and its
 * outcome (completed, rejected or incomplete with the reason) shows here. The FCU team also sees
 * and runs the risk checks (Hunter, IXSite, CRIF / CIBIL); nobody else is shown them. Used on the
 * case's KYC page and as the last step of the intake form (`embedded`: the case is still a draft
 * and the page has its own heading).
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
  const [riskBusy, setRiskBusy] = useState(false);

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

  // While anything runs, refresh every few seconds; the server moves the run forward on read.
  const running = data?.digi.status === 'in_progress' || data?.risk?.overall === 'in_progress';
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

  async function startRisk() {
    if (!window.confirm('Run the Hunter, IXSite and CRIF / CIBIL checks on the signatory?')) return;
    setRiskBusy(true);
    try {
      setData(await apiFetch<KycSummary>(`/cases/${caseId}/kyc/risk/initiate`, { method: 'POST' }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the risk checks.');
    } finally {
      setRiskBusy(false);
    }
  }

  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Loading Digi KYC…</p>
    );
  }

  const { signatory, case: c, digi, risk } = data;
  const resend = digi.status === 'incomplete';
  const hint = !data.ready
    ? "The authorised signatory's name and PAN are missing on this case."
    : !signatory.email
      ? "Enter the authorised signatory's email: the Digi KYC request is sent there."
      : digi.status === 'in_progress'
        ? `The request was emailed to ${signatory.email}. Waiting for the vendor to complete Digi KYC.`
        : digi.status === 'passed'
          ? 'The vendor has completed Digi KYC.'
          : digi.status === 'failed'
            ? 'Digi KYC was rejected. The case is marked for review.'
            : !digi.canInitiate
              ? 'You do not have permission to start Digi KYC.'
              : resend
                ? `Digi KYC was not completed. Send the request to ${signatory.email} again.`
                : `The vendor's authorised signatory will be emailed at ${signatory.email} to complete Digi KYC.`;

  return (
    <div className="kyc">
      {!embedded && (
        <header className="kyc__head">
          <div className="kyc__title">
            <span className="kyc__titleicon" aria-hidden="true">
              <Icon name="shield" size={26} />
            </span>
            <div>
              <h1>{risk ? 'Digi KYC & Risk Checks' : 'Digi KYC'}</h1>
              <p className="lead">Verification of the vendor&apos;s authorised signatory</p>
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
              <small>Digi KYC Status</small>
              <span className={`kyc-pill kyc-pill--${digi.status}`}>{DIGI_LABEL[digi.status]}</span>
            </div>
          </div>
        </section>

        <div className="kyc__info" role="note">
          <Icon name="alert" size={18} />
          <div>
            <strong>Before you begin</strong>
            <p>
              Check that the authorised signatory&apos;s details, especially the email, are correct.
              Initiating Digi KYC emails the signatory a request to complete it.
            </p>
          </div>
        </div>

        <div className="kyc__action">
          <button
            type="button"
            className="btn kyc__go"
            disabled={!digi.canInitiate}
            onClick={() => void confirm()}
          >
            {digi.status === 'in_progress'
              ? 'Waiting for the vendor…'
              : resend
                ? 'Send Digi KYC again'
                : 'Initiate Digi KYC'}
            <Icon name="chevron" size={16} />
          </button>
          <p className="muted tiny">{hint}</p>
        </div>

        <section className="card kyc__card">
          <h2 className="kyc__h2">
            <Icon name="list" size={18} /> Digi KYC Status
          </h2>
          <ul className="kyc__checks">
            <CheckRow k={digi} labels={DIGI_LABEL} />
          </ul>
        </section>

        {risk && (
          <section className="card kyc__card">
            <h2 className="kyc__h2">
              <Icon name="shield" size={18} /> Risk Checks (FCU)
            </h2>
            <p className="muted">
              Hunter, IXSite and CRIF / CIBIL on the authorised signatory, run one after another.
              Only the FCU team sees these checks.
            </p>
            <ul className="kyc__checks">
              {risk.checks.map((k) => (
                <CheckRow key={k.key} k={k} labels={RISK_LABEL} />
              ))}
            </ul>
            {risk.overall === 'not_initiated' && (
              <div className="kyc__action">
                <button
                  type="button"
                  className="btn"
                  disabled={!risk.canInitiate || riskBusy}
                  onClick={() => void startRisk()}
                >
                  {riskBusy ? 'Starting…' : 'Run risk checks'}
                </button>
                {!risk.canInitiate && (
                  <p className="muted tiny">
                    {c.stage === 'draft'
                      ? 'The risk checks run once the case is raised.'
                      : 'You do not have permission to start these checks.'}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <aside className="kyc__important" aria-label="Important">
          <Icon name="shield" size={20} />
          <div>
            <strong>Important</strong>
            <ul>
              <li>Digi KYC is done by the vendor&apos;s authorised signatory from the email.</li>
              <li>If it is not completed, you can send the request again.</li>
              <li>If Digi KYC is rejected, the case is marked for review as per policy.</li>
            </ul>
          </div>
        </aside>
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
      setErr(e instanceof Error ? e.message : 'Could not start Digi KYC.');
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
            A request to complete Digi KYC will be emailed to the authorised signatory at{' '}
            <strong>{data.signatory.email}</strong>.
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
          <label className="checkbox kyc__agree">
            <input
              ref={boxRef}
              type="checkbox"
              checked={agreed}
              disabled={busy}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>
              I confirm that the signatory details are correct and I agree to send the Digi KYC
              request.
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
            {busy ? 'Sending…' : 'Send Digi KYC request'}
          </button>
        </div>
      </div>
    </div>
  );
}
