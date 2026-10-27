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

type Tone = 'neutral' | 'accent' | 'ok' | 'danger' | 'warn';

const RISK_LABEL: Record<KycStatus, string> = {
  not_initiated: 'Not started',
  pending: 'Queued',
  in_progress: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  incomplete: 'Incomplete',
};
const RISK_ICON: Record<string, string> = { hunter: 'search', ixsite: 'flow', crif_cibil: 'chart' };

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

const prettyStage = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** The headline for the Digi KYC state: icon, tone, title and one short line. */
function digiState(d: KycSummary): { icon: string; tone: Tone; title: string; line: string } {
  const { digi, signatory, ready } = d;
  switch (digi.status) {
    case 'in_progress':
      return {
        icon: 'clock',
        tone: 'accent',
        title: 'Waiting for the vendor',
        line: `Sent to ${signatory.email} · ${when(digi.initiatedAt)}`,
      };
    case 'passed':
      return {
        icon: 'check',
        tone: 'ok',
        title: 'Digi KYC completed',
        line: `Verified · ${when(digi.updatedAt)}`,
      };
    case 'failed':
      return {
        icon: 'x',
        tone: 'danger',
        title: 'Digi KYC rejected',
        line: 'The case is marked for review.',
      };
    case 'incomplete':
      return {
        icon: 'alert',
        tone: 'warn',
        title: 'Not completed',
        line: 'Send the request again.',
      };
    default:
      return {
        icon: 'mail',
        tone: 'neutral',
        title: 'Ready to send',
        line: !ready
          ? "Add the signatory's name and PAN first."
          : !signatory.email
            ? "Add the signatory's email first."
            : `The signatory gets an email to verify at ${signatory.email}.`,
      };
  }
}

/**
 * Digi KYC on a case's authorised signatory: initiating it emails the vendor to complete it, and its
 * outcome (completed, rejected or incomplete with the reason) shows here. The FCU team also sees
 * and runs the risk checks (Hunter, IXSite, CRIF / CIBIL); nobody else is shown them. Used on the
 * case's KYC page and as the last step of the intake form (`embedded`: the page has its own heading).
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
  const [preparing, setPreparing] = useState(false);
  const [riskBusy, setRiskBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<KycSummary>(`/cases/${caseId}/kyc`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Digi KYC.');
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
      setPreparing(true);
      try {
        await beforeInitiate();
        await load();
      } finally {
        setPreparing(false);
      }
    }
    setConfirming(true);
  }

  async function startRisk() {
    if (!window.confirm('Run Hunter, IXSite and CRIF / CIBIL on the signatory?')) return;
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
      <div className="dk-card dk-skeleton" aria-busy="true">
        <span />
        <span />
      </div>
    );
  }

  const { signatory, case: c, digi, risk } = data;
  const state = digiState(data);
  const sent = digi.status !== 'not_initiated';
  const finished = ['passed', 'failed', 'incomplete'].includes(digi.status);
  const resultTone: Tone =
    digi.status === 'passed' ? 'ok' : digi.status === 'failed' ? 'danger' : 'warn';
  const steps: { label: string; sub: string; state: 'done' | 'active' | 'todo'; tone?: Tone }[] = [
    {
      label: 'Request sent',
      sub: when(digi.initiatedAt),
      state: sent ? 'done' : 'todo',
    },
    {
      label: 'Vendor verifies',
      sub: digi.status === 'in_progress' ? 'In progress' : '',
      state: finished ? 'done' : digi.status === 'in_progress' ? 'active' : 'todo',
    },
    {
      label: finished
        ? state.title.replace('Digi KYC ', '').replace(/^./, (x) => x.toUpperCase())
        : 'Result',
      sub: finished ? when(digi.updatedAt) : '',
      state: finished ? 'done' : 'todo',
      tone: finished ? resultTone : undefined,
    },
  ];

  return (
    <div className="dk">
      {!embedded && (
        <header className="dk-head">
          <span className="dk-head__icon" aria-hidden="true">
            <Icon name="shield" size={22} />
          </span>
          <div>
            <h1>Digi KYC</h1>
            <p className="muted">
              {c.ref} · {c.legalName || 'Vendor'} ·{' '}
              <span className="pill pill--warn">{prettyStage(c.stage)}</span>
            </p>
          </div>
        </header>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="dk-card">
        <div className="dk-person">
          <span className="dk-avatar" aria-hidden="true">
            {initials(signatory.name) || '?'}
          </span>
          <div className="dk-person__who">
            <strong>{signatory.name || 'Signatory not provided'}</strong>
            <span className="muted">Authorised signatory</span>
          </div>
          <ul className="dk-chips" aria-label="Signatory contact">
            <li title="Email">
              <Icon name="mail" size={14} /> {signatory.email || '—'}
            </li>
            <li title="Mobile">
              <Icon name="user" size={14} /> {signatory.mobile ? `+91 ${signatory.mobile}` : '—'}
            </li>
            <li title="PAN">
              <Icon name="key" size={14} /> {signatory.pan || '—'}
            </li>
          </ul>
        </div>

        <div className={`dk-status dk-status--${state.tone}`} aria-live="polite">
          <span className="dk-status__icon" aria-hidden="true">
            <Icon name={state.icon} size={22} />
          </span>
          <div className="dk-status__text">
            <strong>{state.title}</strong>
            <span>{state.line}</span>
          </div>
          {digi.canInitiate && (
            <button
              type="button"
              className="btn"
              disabled={preparing}
              onClick={() => void confirm()}
            >
              <Icon name="mail" size={16} />
              {preparing
                ? 'Saving…'
                : digi.status === 'incomplete'
                  ? 'Resend request'
                  : 'Send Digi KYC request'}
            </button>
          )}
        </div>

        <ol className="dk-steps">
          {steps.map((s, i) => (
            <li
              key={i}
              className={`dk-step dk-step--${s.state}${s.tone ? ` dk-step--${s.tone}` : ''}`}
            >
              <span className="dk-step__dot" aria-hidden="true">
                {s.state === 'done' ? (
                  <Icon
                    name={s.tone === 'danger' ? 'close' : s.tone === 'warn' ? 'alert' : 'tick'}
                    size={16}
                  />
                ) : (
                  i + 1
                )}
              </span>
              <span className="dk-step__label">
                {s.label}
                {s.sub && <small>{s.sub}</small>}
              </span>
            </li>
          ))}
        </ol>

        {digi.summary && digi.status !== 'passed' && (
          <p className={`dk-reason dk-reason--${resultTone}`}>{digi.summary}</p>
        )}
      </section>

      {risk && (
        <section className="dk-card">
          <div className="dk-card__head">
            <h2>
              Risk checks <span className="dk-tag">FCU</span>
            </h2>
            {risk.overall === 'not_initiated' && (
              <button
                type="button"
                className="btn btn--sm"
                disabled={!risk.canInitiate || riskBusy}
                title={risk.canInitiate ? undefined : 'Available once the case is raised, for FCU.'}
                onClick={() => void startRisk()}
              >
                {riskBusy ? 'Starting…' : 'Run checks'}
              </button>
            )}
          </div>
          <ul className="dk-risk">
            {risk.checks.map((k) => (
              <li key={k.key}>
                <span className="dk-risk__icon" aria-hidden="true">
                  <Icon name={RISK_ICON[k.key] ?? 'shield'} size={16} />
                </span>
                <span className="dk-risk__name">
                  <strong>{k.label}</strong>
                  <small>{k.summary ?? k.scope}</small>
                </span>
                <span className="dk-risk__when">{when(k.updatedAt ?? k.initiatedAt)}</span>
                <span className={`kyc-pill kyc-pill--${k.status}`}>{RISK_LABEL[k.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

/** Confirm sending the Digi KYC request: shows exactly who receives it. */
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
  const sendRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useModalBehavior({ panelRef, initialFocusRef: sendRef, onClose: onCancel, blocked: busy });

  async function start() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      onDone(await apiFetch<KycSummary>(`/cases/${data.case.id}/kyc/initiate`, { method: 'POST' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not send the request.');
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
          <span className="dlg__icon" aria-hidden="true">
            <Icon name="mail" size={24} />
          </span>
          <h2 id="kyc-title">Send Digi KYC request?</h2>
          <div className="dk-person dk-person--compact">
            <span className="dk-avatar" aria-hidden="true">
              {initials(data.signatory.name) || '?'}
            </span>
            <div className="dk-person__who">
              <strong>{data.signatory.name}</strong>
              <span className="muted">{data.signatory.email}</span>
            </div>
          </div>
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
            ref={sendRef}
            type="button"
            className="btn"
            onClick={() => void start()}
            disabled={busy}
          >
            {busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </div>
  );
}
