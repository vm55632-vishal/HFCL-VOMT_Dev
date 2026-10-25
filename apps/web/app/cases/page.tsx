'use client';
import Link from 'next/link';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { apiFetchSwr, ApiError } from '../../lib/api';
import { Icon } from '../../components/icons';
import {
  BulkDialog,
  CaseBulkBar,
  exportCasesCsv,
  type ServerAction,
} from '../../components/CaseBulkActions';

interface CaseRow {
  id: string;
  ref: string;
  legalName: string;
  tradeName?: string;
  categoryKey: string;
  subCategoryKey: string | null;
  subCategoryName: string | null;
  stage: string;
  tier: string;
  onHold: boolean;
  infosecRequired: boolean;
  dueAt: string | null;
  createdAt: string;
}

type StatusFilter = 'all' | 'open' | 'closed' | 'cancelled' | 'hold';
const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All cases' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'hold', label: 'On hold' },
];

/** "dealer_twl" → "Dealer Twl" — only used when a sub-category has no display name. */
function prettyKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function Cases() {
  return (
    <Suspense fallback={<main className="wrap" />}>
      <CasesInner />
    </Suspense>
  );
}

function CasesInner() {
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const stageFilter = useSearchParams()?.get('stage') ?? '';
  // Open cases by default; clearing the filter (or choosing "All cases") shows everything. A stage
  // queue link (e.g. the InfoSec queue) is already specific, so it starts unfiltered.
  const [status, setStatus] = useState<StatusFilter>(stageFilter ? 'all' : 'open');
  const statusActive = status !== 'all';
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === status)?.label ?? '';

  // Case ID filter: what's typed, and the debounced value that actually drives the request.
  const [refInput, setRefInput] = useState('');
  const [ref, setRef] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setRef(refInput.trim()), 300);
    return () => clearTimeout(t);
  }, [refInput]);

  // Only the latest request may update the list (a slow earlier search must not overwrite it).
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    const params = new URLSearchParams();
    if (stageFilter) params.set('stage', stageFilter);
    if (ref) params.set('ref', ref);
    if (status !== 'all') params.set('status', status);
    const qs = params.toString();
    try {
      const data = await apiFetchSwr<CaseRow[]>(`/cases${qs ? `?${qs}` : ''}`, (cached) => {
        // Show the last answer straight away; the fresh one replaces it a moment later.
        if (mine === latest.current) {
          setRows(cached);
          setLoaded(true);
        }
      });
      if (mine !== latest.current) return;
      setRows(data);
      setMsg(null);
    } catch (err) {
      if (mine !== latest.current) return;
      setMsg(err instanceof ApiError ? err.message : 'Failed to load.');
    } finally {
      if (mine === latest.current) setLoaded(true);
    }
  }, [stageFilter, ref, status]);
  useEffect(() => {
    void load();
  }, [load]);

  // Selection for bulk actions. It follows the rows on screen: a case that drops out of the list
  // (filtered away, or changed by an action) is no longer selected.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<ServerAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const chosen = rows.filter((r) => selected.has(r.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const filtering = ref !== '';
  const searching = refInput.trim() !== ref; // typed but not yet applied

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>{stageFilter === 'infosec' ? 'InfoSec queue' : 'Cases'}</h1>
          <p className="lead">
            {stageFilter === 'infosec'
              ? `Cases awaiting InfoSec review · ${rows.length}.`
              : `Vendor onboarding cases · ${rows.length}.`}
          </p>
        </div>
        {stageFilter !== 'infosec' && (
          <Link className="btn" href="/cases/new">
            + Raise a case
          </Link>
        )}
      </div>
      {msg && <p className="note">{msg}</p>}
      {notice && (
        <p className="note" role="status">
          {notice}{' '}
          <button type="button" className="linkbtn" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="filterbar">
        <label className="filter">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            placeholder="Filter by case ID, e.g. VOMT-000004"
            aria-label="Filter by case ID"
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
          {refInput && (
            <button
              type="button"
              className="filter__clear"
              aria-label="Clear filter"
              onClick={() => setRefInput('')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <label className="filter filter--select">
          <span className="filter__label">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {statusActive && (
            <button
              type="button"
              className="filter__clear"
              aria-label="Clear status filter and show all cases"
              onClick={() => setStatus('all')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
        <span className="filterbar__count" aria-live="polite">
          {searching
            ? 'Searching…'
            : filtering || statusActive
              ? `${rows.length} ${statusActive ? statusLabel.toLowerCase() + ' ' : ''}${filtering ? 'matching ' : ''}case${rows.length === 1 ? '' : 's'}`
              : ''}
        </span>
      </div>

      <section className="card">
        <CaseBulkBar
          rows={rows}
          selected={selected}
          onSelectAll={(all) => setSelected(all ? new Set(rows.map((r) => r.id)) : new Set())}
          onClear={() => setSelected(new Set())}
          onExport={() => exportCasesCsv(chosen)}
          onAction={(a) => setDialog(a)}
        />
        <div className="scroll-area scroll-area--x">
          <table className="tbl tbl--inline">
            <thead>
              <tr>
                <th className="sel">
                  <input
                    type="checkbox"
                    aria-label="Select all cases"
                    checked={rows.length > 0 && chosen.length === rows.length}
                    disabled={rows.length === 0}
                    onChange={(e) =>
                      setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
                <th>Case ID</th>
                <th>Legal name of the business</th>
                <th>Trade name</th>
                <th>Category</th>
                <th>Stage</th>
                <th>Tier</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={selected.has(c.id) ? 'is-selected' : undefined}>
                  <td className="sel">
                    <input
                      type="checkbox"
                      aria-label={`Select case ${c.ref}`}
                      checked={selected.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                  </td>
                  <td>
                    <Link href={`/cases/${c.id}`}>
                      <code className="caseid">{c.ref}</code>
                    </Link>
                  </td>
                  <td>
                    {c.legalName ||
                      (c.stage === 'draft' ? <span className="muted">Untitled draft</span> : '')}
                  </td>
                  <td>{c.tradeName || <span className="muted">{'—'}</span>}</td>
                  <td className="muted">
                    {c.subCategoryName ?? (c.subCategoryKey ? prettyKey(c.subCategoryKey) : '—')}
                  </td>
                  <td>
                    <span
                      className={
                        c.stage === 'draft' || c.stage === 'cancelled' ? 'pill pill--draft' : 'pill'
                      }
                    >
                      {c.stage === 'draft'
                        ? 'Draft'
                        : c.stage === 'cancelled'
                          ? 'Cancelled'
                          : c.stage}
                      {c.onHold ? ' · hold' : ''}
                    </span>
                    {c.infosecRequired && (
                      <span className="pill pill--warn" style={{ marginLeft: 6 }}>
                        InfoSec
                      </span>
                    )}
                  </td>
                  <td>
                    {c.stage === 'draft' ? (
                      <span className="muted">—</span>
                    ) : (
                      <span className={`pill tier--${c.tier}`}>{c.tier}</span>
                    )}
                  </td>
                  <td className="muted">
                    {c.dueAt ? new Date(c.dueAt).toLocaleDateString() : '-'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {!loaded ? (
                      'Loading…'
                    ) : filtering ? (
                      <>
                        No cases match “{ref}”.{' '}
                        <button type="button" className="linkbtn" onClick={() => setRefInput('')}>
                          Clear filter
                        </button>
                      </>
                    ) : statusActive ? (
                      <>
                        No {statusLabel.toLowerCase()} cases.{' '}
                        <button type="button" className="linkbtn" onClick={() => setStatus('all')}>
                          Show all cases
                        </button>
                      </>
                    ) : (
                      'No cases yet.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {dialog && (
        <BulkDialog
          action={dialog}
          selected={chosen}
          onClose={() => setDialog(null)}
          onFinished={(summary, doneIds) => {
            setNotice(summary);
            setSelected((prev) => new Set([...prev].filter((id) => !doneIds.includes(id))));
            void load();
          }}
        />
      )}
    </main>
  );
}
