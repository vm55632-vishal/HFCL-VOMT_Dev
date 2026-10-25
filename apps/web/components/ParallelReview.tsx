'use client';

import { Icon } from './icons';

export interface StageRow {
  status: string;
  decision: string | null;
  remark: string | null;
  actionedById: string | null;
  actionedByName?: string | null;
  enteredAt: string | null;
  completedAt: string | null;
  data?: { agreement?: string } | null;
}

const LABELS: Record<string, string> = {
  infosec: 'InfoSec',
  fcu: 'FCU',
  operation: 'Operations',
  legal: 'Legal',
};

function tone(status: string): 'ok' | 'pending' | 'danger' | 'warn' {
  if (status === 'approved') return 'ok';
  if (status === 'rejected') return 'danger';
  if (status === 'sent_back') return 'warn';
  return 'pending';
}
function statusLabel(status: string): string {
  return status === 'approved'
    ? 'Approved'
    : status === 'rejected'
      ? 'Rejected'
      : status === 'sent_back'
        ? 'Sent back'
        : 'In review';
}
function iconFor(t: ReturnType<typeof tone>): string {
  return t === 'ok' ? 'check' : t === 'danger' ? 'x' : 'clock';
}
function fmt(dt: string | null): string | null {
  if (!dt) return null;
  const d = new Date(dt);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function ParallelReview({
  stages,
  reviewStages,
  caseStage,
  onConfirmSap,
  canConfirmSap = false,
}: {
  stages: Record<string, StageRow | null>;
  reviewStages: string[];
  caseStage: string;
  onConfirmSap?: () => void;
  canConfirmSap?: boolean;
}) {
  const active = reviewStages.filter((s) => LABELS[s]);
  const done = active.filter((s) => stages[s]?.status === 'approved').length;
  const total = active.length;
  const allDone = total > 0 && done === total;
  const anyRejected = active.some((s) => stages[s]?.status === 'rejected');

  const sapStatus =
    caseStage === 'approved'
      ? 'confirmed'
      : caseStage === 'rejected'
        ? 'rejected'
        : caseStage === 'cancelled'
          ? 'cancelled'
          : caseStage === 'sap'
            ? 'ready'
            : 'waiting';
  const sapBadge =
    sapStatus === 'confirmed'
      ? { box: 'ok', pill: 'ok', text: 'Confirmed' }
      : sapStatus === 'rejected'
        ? { box: 'danger', pill: 'danger', text: 'Rejected' }
        : sapStatus === 'cancelled'
          ? { box: 'muted', pill: 'draft', text: 'Cancelled' }
          : sapStatus === 'ready'
            ? { box: 'amber', pill: 'warn', text: 'Ready to Confirm' }
            : { box: 'muted', pill: 'draft', text: 'Waiting' };
  const sapText =
    sapStatus === 'confirmed'
      ? 'The vendor has been confirmed in SAP and activated.'
      : sapStatus === 'rejected'
        ? 'The case was rejected at SAP confirmation.'
        : sapStatus === 'cancelled'
          ? 'This case was cancelled, so no further reviews or confirmation are needed.'
          : sapStatus === 'ready'
            ? 'All parallel reviews are completed. Confirm with SAP to proceed further.'
            : anyRejected
              ? 'A review was rejected — SAP confirmation will not proceed.'
              : 'SAP confirmation unlocks once every parallel review is approved.';

  return (
    <section className="prv">
      <div className="prv__head">
        <span className="prv__headicon">
          <Icon name="flow" size={22} />
        </span>
        <div className="prv__headtext">
          <h2>Parallel Review</h2>
          <p className="prv__count">
            {done} of {total} reviews completed
          </p>
          <p className="prv__sub">
            {active.map((s) => LABELS[s]).join(', ')}{' '}
            {active.length > 1 ? 'reviews are' : 'review is'} running in parallel
            {allDone ? ' and have been completed.' : '.'}
          </p>
        </div>
        <span className={`prv__pill prv__pill--${allDone ? 'ok' : 'muted'}`}>
          <Icon name={allDone ? 'check' : 'clock'} size={15} />
          {done} of {total} completed
        </span>
      </div>

      <div className="prv__flow">
        <div className="prv__stages">
          {active.map((s) => {
            const row = stages[s];
            const st = row?.status ?? 'pending';
            const t = tone(st);
            const when = fmt(row?.completedAt ?? null);
            return (
              <div key={s} className="prv__card">
                <div className="prv__cardhead">
                  <span className={`prv__badgeicon prv__badgeicon--${t}`}>
                    <Icon name={iconFor(t)} size={20} />
                  </span>
                  <div>
                    <div className="prv__cardtitle">{LABELS[s]}</div>
                    <span className={`pill pill--${t === 'pending' ? 'draft' : t}`}>
                      {statusLabel(st)}
                    </span>
                  </div>
                </div>
                {row?.actionedByName ? (
                  <div className="prv__meta">
                    <Icon name="user" size={15} />
                    <span>
                      Reviewed by
                      <strong>{row.actionedByName}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="prv__meta prv__meta--muted">
                    <Icon name="user" size={15} />
                    <span>Awaiting reviewer</span>
                  </div>
                )}
                {when ? (
                  <div className="prv__meta">
                    <Icon name="clock" size={15} />
                    <span>
                      Completed at
                      <strong>{when}</strong>
                    </span>
                  </div>
                ) : (
                  <div className="prv__meta prv__meta--muted">
                    <Icon name="clock" size={15} />
                    <span>{st === 'sent_back' ? 'Returned for changes' : 'In progress'}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="prv__arrow" aria-hidden="true">
          <Icon name="arrow" size={22} />
        </div>

        <div className={`prv__sap prv__sap--${sapBadge.box}`}>
          <div className="prv__cardhead">
            <span className="prv__badgeicon prv__badgeicon--amber">
              <Icon name="clock" size={20} />
            </span>
            <div>
              <div className="prv__cardtitle">SAP Confirmation</div>
              <span className={`pill pill--${sapBadge.pill}`}>{sapBadge.text}</span>
            </div>
          </div>
          <p className="prv__saptext">{sapText}</p>
          {canConfirmSap && sapStatus === 'ready' && onConfirmSap && (
            <button className="btn prv__sapbtn" onClick={onConfirmSap}>
              Confirm SAP <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
