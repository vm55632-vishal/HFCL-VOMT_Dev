'use client';
import Link from 'next/link';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../lib/api';

interface CaseRow {
  id: string;
  ref: string;
  legalName: string;
  categoryKey: string;
  stage: string;
  tier: string;
  createdAt: string;
}

const STAGE_LABELS: Record<string, string> = {
  infosec: 'InfoSec',
  fcu: 'FCU',
  operation: 'Operation',
  legal: 'Legal',
  l1: 'L1 approval',
  l2: 'L2 approval',
  l3: 'L3 approval',
  sap: 'SAP confirmation',
};

const STAGE_BLURB: Record<string, string> = {
  infosec: 'Cases needing IT / network / application / PII access, awaiting your security review.',
  fcu: 'Submitted cases awaiting your fraud-control review.',
  operation: 'Submitted cases awaiting your operations review.',
  legal: 'Submitted cases awaiting your legal review and agreement drafting.',
  l1: 'Cases whose reviews are complete, awaiting your L1 approval.',
  l2: 'Cases awaiting your L2 approval (after L1, where the category uses it).',
  l3: 'Cases awaiting your L3 approval, the last step before SAP confirmation.',
  sap: 'Cases where every review and approval is complete — confirm them into SAP/ERP.',
};

export default function StageQueue() {
  const { stage } = useParams<{ stage: string }>();
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const label = STAGE_LABELS[stage] ?? stage;

  const load = useCallback(async () => {
    try {
      setRows(await apiFetch<CaseRow[]>(`/cases?queue=${encodeURIComponent(stage)}`));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to load.');
    }
  }, [stage]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="wrap">
      <div className="topbar">
        <div>
          <h1>{label} queue</h1>
          <p className="lead">
            {STAGE_BLURB[stage] ?? 'Cases awaiting this stage.'} · {rows.length}
          </p>
        </div>
      </div>
      {msg && <p className="note">{msg}</p>}

      <section className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Vendor</th>
              <th>Category</th>
              <th>Tier</th>
              <th>Raised</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/cases/${c.id}`}>
                    <code>{c.ref}</code>
                  </Link>
                </td>
                <td>{c.legalName}</td>
                <td className="muted">{c.categoryKey}</td>
                <td>
                  <span className={`pill tier--${c.tier}`}>{c.tier}</span>
                </td>
                <td className="muted">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing awaiting {label} right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
