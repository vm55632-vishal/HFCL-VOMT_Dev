'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { Icon } from './icons';
import { useModalBehavior } from './useModalBehavior';

/** The fields of a case-list row that bulk actions and the export need. */
export interface BulkRow {
  id: string;
  ref: string;
  legalName: string;
  tradeName?: string;
  categoryKey: string;
  subCategoryName: string | null;
  stage: string;
  tier: string;
  onHold: boolean;
  createdAt: string;
  dueAt: string | null;
}

export type ServerAction = 'hold' | 'resume' | 'cancel' | 'reopen' | 'delete';
type MenuAction = ServerAction | 'export';

const FINISHED = ['approved', 'rejected', 'cancelled'];

/** Which selected cases each action can apply to. The server re-checks every case. */
const APPLIES: Record<ServerAction, (r: BulkRow) => boolean> = {
  cancel: (r) => ['review', 'l1', 'l2', 'l3', 'sap'].includes(r.stage),
  reopen: (r) => r.stage === 'rejected' || r.stage === 'cancelled',
  hold: (r) => r.stage !== 'draft' && !FINISHED.includes(r.stage) && !r.onHold,
  resume: (r) => r.onHold && !FINISHED.includes(r.stage),
  delete: () => true,
};

const ITEMS: { action: MenuAction; label: string; hint: string; danger?: boolean }[] = [
  {
    action: 'export',
    label: 'Export & download',
    hint: 'Download the selected cases as a CSV file',
  },
  {
    action: 'cancel',
    label: 'Cancel',
    hint: 'Only cases under review can be cancelled',
    danger: true,
  },
  { action: 'reopen', label: 'Reopen', hint: 'Only cancelled or rejected cases can be reopened' },
  { action: 'hold', label: 'On hold', hint: 'Only open, submitted cases can be put on hold' },
  { action: 'resume', label: 'Resume from hold', hint: 'Only cases on hold can be resumed' },
  {
    action: 'delete',
    label: 'Delete',
    hint: 'Permanently deletes the selected cases',
    danger: true,
  },
];

const COPY: Record<
  ServerAction,
  {
    title: string;
    button: string;
    /** Extra explanation shown under the summary line. */
    note?: string;
    /** Short consequences, shown as a compact list. */
    facts?: string[];
    verb: string;
    done: string;
    needsReason: boolean;
    reasonLabel?: string;
    danger?: boolean;
  }
> = {
  hold: {
    title: 'Put on hold',
    button: 'Put on hold',
    verb: 'put on hold',
    done: 'put on hold',
    needsReason: true,
    reasonLabel: 'Reason for putting on hold',
  },
  resume: {
    title: 'Resume from hold',
    button: 'Resume',
    verb: 'resume',
    done: 'resumed',
    needsReason: false,
  },
  cancel: {
    title: 'Cancel cases',
    button: 'Cancel cases',
    note: 'A cancelled case is taken out of every reviewer queue straight away. It can be reopened later.',
    verb: 'cancel',
    done: 'cancelled',
    needsReason: true,
    reasonLabel: 'Reason for cancelling',
    danger: true,
  },
  reopen: {
    title: 'Reopen cases',
    button: 'Reopen',
    verb: 'reopen',
    done: 'reopened',
    needsReason: true,
    reasonLabel: 'Reason for reopening',
  },
  delete: {
    title: 'Delete cases permanently',
    button: 'Delete permanently',
    facts: [
      'Removed for everyone, from every queue and screen',
      'Its documents, comments and history are erased',
      'The audit log keeps a record that it was deleted',
    ],
    verb: 'permanently delete',
    done: 'deleted',
    needsReason: false,
    danger: true,
  },
};

// ---------------------------------------------------------------- CSV export

/** A spreadsheet treats a cell starting with = + - @ as a formula, so those are defused. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const pretty = (key: string) =>
  key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function statusLabel(r: BulkRow): string {
  if (r.stage === 'draft') return 'Draft';
  if (r.stage === 'approved') return 'Closed (approved)';
  if (r.stage === 'rejected') return 'Closed (rejected)';
  if (r.stage === 'cancelled') return 'Cancelled';
  return r.onHold ? 'On hold' : 'Open';
}

export function exportCasesCsv(rows: BulkRow[]) {
  const header = [
    'Case ID',
    'Legal name of the business',
    'Trade name',
    'Category',
    'Sub-category',
    'Status',
    'Stage',
    'Tier',
    'Created on',
    'Due',
  ];
  const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');
  const lines = [
    header,
    ...rows.map((r) => [
      r.ref,
      r.legalName,
      r.tradeName ?? '',
      pretty(r.categoryKey),
      r.subCategoryName ?? '',
      statusLabel(r),
      r.stage,
      r.stage === 'draft' ? '' : r.tier,
      day(r.createdAt),
      day(r.dueAt),
    ]),
  ].map((cols) => cols.map(csvCell).join(','));
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cases-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------- toolbar

/**
 * "Select all" with a count, and a ⋯ More menu of actions for the selected cases. An action is
 * available when at least one selected case can take it; it then applies to those cases only.
 */
export function CaseBulkBar({
  rows,
  selected,
  onSelectAll,
  onClear,
  onExport,
  onAction,
}: {
  rows: BulkRow[];
  selected: Set<string>;
  onSelectAll: (all: boolean) => void;
  onClear: () => void;
  onExport: () => void;
  onAction: (action: ServerAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const allRef = useRef<HTMLInputElement>(null);

  const chosen = rows.filter((r) => selected.has(r.id));
  const all = rows.length > 0 && chosen.length === rows.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = chosen.length > 0 && !all;
  }, [chosen.length, all]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="bulk" role="toolbar" aria-label="Bulk actions for selected cases">
      <label className="bulk__all">
        <input
          ref={allRef}
          type="checkbox"
          checked={all}
          disabled={rows.length === 0}
          onChange={(e) => onSelectAll(e.target.checked)}
        />
        <span>Select all</span>
      </label>
      <span className="bulk__count" aria-live="polite">
        {chosen.length > 0 ? `${chosen.length} selected` : 'None selected'}
      </span>
      {chosen.length > 0 && (
        <button type="button" className="linkbtn" onClick={onClear}>
          Clear selection
        </button>
      )}

      <div className="bulk__more" ref={wrapRef}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={chosen.length === 0}
          title={chosen.length === 0 ? 'Select one or more cases first' : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">{'⋯'}</span> More
        </button>
        {open && (
          <div className="bulk__menu" role="menu">
            {ITEMS.map((it) => {
              const n =
                it.action === 'export' ? chosen.length : chosen.filter(APPLIES[it.action]).length;
              return (
                <button
                  key={it.action}
                  type="button"
                  role="menuitem"
                  className={`bulk__item${it.danger ? ' bulk__item--danger' : ''}`}
                  disabled={n === 0}
                  title={n === 0 ? it.hint : undefined}
                  onClick={() => {
                    setOpen(false);
                    if (it.action === 'export') onExport();
                    else onAction(it.action);
                  }}
                >
                  <span>{it.label}</span>
                  <small>{n === 0 ? 'Not available' : `${n} case${n === 1 ? '' : 's'}`}</small>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- dialog

interface BulkResult {
  succeeded: number;
  failed: number;
  results: { id: string; ref: string | null; ok: boolean; message?: string }[];
}

/** Confirms one bulk action, asks for a reason where the server needs one, and reports the outcome. */
export function BulkDialog({
  action,
  selected,
  onClose,
  onFinished,
}: {
  action: ServerAction;
  selected: BulkRow[];
  onClose: () => void;
  /** Called once the action has run, so the page can reload the list. */
  onFinished: (summary: string, doneIds: string[]) => void;
}) {
  const copy = COPY[action];
  const targets = selected.filter(APPLIES[action]);
  const skipped = selected.length - targets.length;
  const panelRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [missing, setMissing] = useState(false);
  // Deleting submitted cases is permanent, so it has to be confirmed by typing a word.
  const needsTyped = action === 'delete' && targets.some((t) => t.stage !== 'draft');
  const [typed, setTyped] = useState('');
  const typedOk = !needsTyped || typed.trim().toUpperCase() === 'DELETE';

  useModalBehavior({ panelRef, initialFocusRef: focusRef, onClose, blocked: busy });

  async function run() {
    if (busy) return;
    if (copy.needsReason && !reason.trim()) {
      setMissing(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<BulkResult>('/cases/bulk', {
        method: 'POST',
        body: JSON.stringify({
          action,
          ids: targets.map((t) => t.id),
          ...(reason.trim() ? { note: reason.trim() } : {}),
        }),
      });
      setResult(res);
      onFinished(
        `${res.succeeded} case${res.succeeded === 1 ? '' : 's'} ${copy.done}${res.failed ? `, ${res.failed} could not be changed` : ''}.`,
        res.results.filter((r) => r.ok).map((r) => r.id),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  const refOf = (id: string) => selected.find((s) => s.id === id)?.ref ?? id;

  return (
    <div
      className="vdm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="vdm__panel dlg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
      >
        <div className="vdm__grab" aria-hidden="true" />
        <div className="dlg__body">
          <div className="bulk__dlghead">
            <span
              className={`dlg__icon dlg__icon--${copy.danger ? 'bad' : 'warn'}`}
              aria-hidden="true"
            >
              <Icon name={copy.danger ? 'alert' : 'flow'} size={22} />
            </span>
            <div>
              <h2 id="bulk-title">{copy.title}</h2>
              {!result && (
                <p className="bulk__sub">
                  {targets.length} case{targets.length === 1 ? '' : 's'} will be {copy.done}
                  {skipped > 0 && ` · ${skipped} skipped (not eligible)`}
                </p>
              )}
            </div>
          </div>

          {!result ? (
            <>
              {copy.facts && (
                <ul className="bulk__facts">
                  {copy.facts.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  <li className="bulk__facts-strong">This cannot be undone.</li>
                </ul>
              )}
              {copy.note && <p className="bulk__note">{copy.note}</p>}
              <ul className="bulk__refs">
                {targets.slice(0, 6).map((t) => (
                  <li key={t.id}>
                    <code className="caseid">{t.ref}</code> {t.legalName || 'Untitled draft'}
                  </li>
                ))}
                {targets.length > 6 && <li className="muted">…and {targets.length - 6} more</li>}
              </ul>
              {needsTyped && (
                <div className="bulk__typed">
                  <label htmlFor="bulk-typed">
                    Type <strong>DELETE</strong> to confirm
                  </label>
                  <input
                    id="bulk-typed"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={10}
                    value={typed}
                    disabled={busy}
                    aria-invalid={typed !== '' && !typedOk}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && typedOk && !busy) void run();
                    }}
                  />
                  {typedOk && (
                    <span className="bulk__ok" aria-hidden="true">
                      <Icon name="check" size={16} />
                    </span>
                  )}
                </div>
              )}
              {copy.needsReason && (
                <>
                  <label htmlFor="bulk-reason" className="dlg__label">
                    {copy.reasonLabel}
                    <span className="rv-tag rv-tag--req">Required</span>
                  </label>
                  <textarea
                    id="bulk-reason"
                    className="rv-text"
                    rows={3}
                    maxLength={2000}
                    value={reason}
                    disabled={busy}
                    aria-invalid={missing}
                    onChange={(e) => {
                      setReason(e.target.value);
                      if (e.target.value.trim()) setMissing(false);
                    }}
                  />
                  {missing && (
                    <span className="fcu-q__err" role="alert">
                      Please enter a reason first.
                    </span>
                  )}
                </>
              )}
              {error && (
                <div className="rv-alert rv-alert--warn" role="alert" style={{ marginTop: 12 }}>
                  <Icon name="alert" size={18} />
                  <span>{error}</span>
                </div>
              )}
            </>
          ) : (
            <div role="status">
              <p className="dlg__text">
                <strong>{result.succeeded}</strong> case{result.succeeded === 1 ? '' : 's'}{' '}
                {copy.done}
                {result.failed > 0 && (
                  <>
                    ; <strong>{result.failed}</strong> could not be changed:
                  </>
                )}
              </p>
              {result.failed > 0 && (
                <ul className="bulk__refs">
                  {result.results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li key={r.id}>
                        <code className="caseid">{refOf(r.id)}</code> {r.message}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="dlg__foot">
          {!result ? (
            <>
              <button
                ref={focusRef}
                type="button"
                className="btn btn--ghost"
                onClick={onClose}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${copy.danger ? 'btn--destructive' : ''}`}
                onClick={() => void run()}
                disabled={busy || targets.length === 0 || !typedOk}
              >
                {busy ? 'Working…' : `${copy.button} (${targets.length})`}
              </button>
            </>
          ) : (
            <button ref={focusRef} type="button" className="btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
