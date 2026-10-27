'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError, API_BASE } from '../../../lib/api';
import { SkeletonLines } from '../../../components/Skeleton';
import ParallelReview from '../../../components/ParallelReview';
import VendorDetailsModal from '../../../components/VendorDetailsModal';
import DecisionDialog from '../../../components/DecisionDialog';
import {
  Card,
  Field,
  Group,
  initials,
  type VendorDetailsData,
} from '../../../components/DetailParts';
import { Dropzone, Meter, Question, Segmented, formatBytes } from '../../../components/ReviewForm';
import { Icon } from '../../../components/icons';
import SectionNav, { type NavSection } from '../../../components/SectionNav';

interface ChecklistItem {
  id: string;
  itemId: string;
  label: string;
  role: string | null;
  done: boolean;
}
interface Comment {
  id: string;
  authorId: string;
  body: string;
  at: string;
}
interface Activity {
  at: string;
  action: string;
  fromStage: string | null;
  toStage: string | null;
  note: string | null;
}
interface Doc {
  id: string;
  docType: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  version: number;
  createdAt: string;
}
interface CaseDetail {
  id: string;
  ref: string;
  createdById: string;
  legalName: string;
  tradeName: string | null;
  businessAddress: string | null;
  stage: string;
  tier: string;
  onHold: boolean;
  infosecRequired: boolean;
  isecItHardware: boolean;
  isecItSoftware: boolean;
  isecAccessSystem: boolean;
  isecAccessNetwork: boolean;
  isecAccessApps: boolean;
  isecAccessPii: boolean;
  riskScore: number;
  categoryKey: string;
  vendorCode: string | null;
  vendorStatus: string;
  pan: string | null;
  gstin: string | null;
  ifsc: string | null;
  bankAccount: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  spend: number;
  justification: string;
  checklist: ChecklistItem[];
  comments: Comment[];
  activity: Activity[];
  stages?: Record<string, StageRow | null>;
  reviewStages?: string[];
  /** Approval levels (l1/l2/l3) the case runs after its reviews, in order. */
  approvalLevels?: string[];
}
interface FcuPayload {
  residentialAddressCheck: boolean;
  officeAddressCheck: boolean;
  overallFinding: 'positive' | 'negative';
  comment?: string;
}
interface StageRow {
  status: string;
  decision: string | null;
  remark: string | null;
  actionedById: string | null;
  actionedByName?: string | null;
  enteredAt: string | null;
  completedAt: string | null;
  data?: {
    agreement?: string;
    residentialAddressCheck?: boolean;
    officeAddressCheck?: boolean;
    overallFinding?: 'positive' | 'negative';
    comment?: string | null;
  } | null;
}

// The FCU reviewer's page is split into these sections; the sticky bar at the top scrolls to each.
const FCU_SECTIONS: readonly NavSection[] = [
  { id: 'vendor', label: 'Vendor details', icon: 'building' },
  { id: 'automated', label: 'FCU DD automated check', icon: 'shield' },
  { id: 'findings', label: 'Overall findings', icon: 'check' },
];

const NEEDS_NOTE = new Set(['return', 'reject', 'hold', 'reopen']);

// The proposer / full case view is organised into tabs.
type CaseTab = 'overview' | 'files' | 'audit';
const CASE_TABS: { id: CaseTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'layers' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'audit', label: 'Audit trail', icon: 'list' },
];

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<CaseDetail | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docType, setDocType] = useState('pan_card');
  const [msg, setMsg] = useState<string | null>(null);
  const [perms, setPerms] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [meId, setMeId] = useState<string>('');
  const [agreement, setAgreement] = useState('');
  // "View full details" popup + the FCU findings form.
  const [showDetails, setShowDetails] = useState(false);
  const [fcuResidential, setFcuResidential] = useState<'' | 'yes' | 'no'>('');
  const [fcuOffice, setFcuOffice] = useState<'' | 'yes' | 'no'>('');
  const [fcuFinding, setFcuFinding] = useState<'' | 'positive' | 'negative'>('');
  const [fcuComment, setFcuComment] = useState('');
  const [uploading, setUploading] = useState(false);
  // Set when the reviewer tries to approve with items missing, so each one is flagged in place.
  const [fcuTried, setFcuTried] = useState(false);
  const [tab, setTab] = useState<CaseTab>('overview');
  // The send-back / reject dialog (a remark is required for both). "sap" = the SAP stage's reject.
  const [dialog, setDialog] = useState<{
    kind: 'sendback' | 'reject';
    scope: 'stage' | 'sap';
  } | null>(null);

  const load = useCallback(async () => {
    try {
      // Fire all three requests at once (they were awaited one after another, so the page waited
      // for the sum of three network round trips). Only the case itself is essential; the rest
      // degrade gracefully. Everything is applied together so the view never flashes the wrong
      // role's layout while the profile is still loading.
      const [caseRes, docsRes, me] = await Promise.all([
        apiFetch<CaseDetail>(`/cases/${id}`),
        apiFetch<Doc[]>(`/cases/${id}/documents`).catch(() => [] as Doc[]),
        apiFetch<{ id: string; permissions: string[]; roles: string[] }>('/auth/me').catch(
          () => null,
        ),
      ]);
      if (me) {
        setPerms(me.permissions);
        setRoles(me.roles ?? []);
        setMeId(me.id);
      }
      setDocs(docsRes);
      setC(caseRes);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to load.');
    }
  }, [id]);

  async function uploadDoc(file: File, type: string = docType) {
    setMsg(null);
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('docType', type);
    const res = await fetch(`${API_BASE}/cases/${id}/documents`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(b.error ?? `Upload failed (${res.status})`);
    } else {
      setMsg('Document uploaded (scanned clean).');
    }
    setUploading(false);
    await load();
  }
  useEffect(() => {
    void load();
  }, [load]);

  // A proposer opening their own case that needs their changes (a fresh draft, or a stage sent back
  // to them) goes straight to the editable form pre-filled with what they entered.
  useEffect(() => {
    if (!c || !meId || meId !== c.createdById) return;
    const hasSentBack = [...(c.reviewStages ?? []), ...(c.approvalLevels ?? [])].some(
      (s) => c.stages?.[s]?.status === 'sent_back',
    );
    if (c.stage === 'draft' || hasSentBack) {
      router.replace(`/cases/new?id=${c.id}`);
    }
  }, [c, meId, router]);

  async function act(action: string) {
    setMsg(null);
    let note: string | undefined;
    if (NEEDS_NOTE.has(action)) {
      note = window.prompt(`Reason for "${action}":`) ?? undefined;
      if (!note) return;
    }
    try {
      await apiFetch(`/cases/${id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, note }),
      });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed.');
    }
  }
  // Reviewer decisions. They return an error message (or null on success) instead of setting the
  // page alert, so the decision dialog can show a failure inside itself and stay open.
  async function stageDecision(
    stage: string,
    decision: 'approve' | 'reject' | 'sendback',
    opts: { note?: string; agreement?: string; fcu?: FcuPayload } = {},
  ): Promise<string | null> {
    try {
      await apiFetch(`/cases/${id}/stage/${stage}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, ...opts }),
      });
      await load();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Action failed.';
    }
  }
  async function sapDecision(
    decision: 'approve' | 'reject',
    note?: string,
  ): Promise<string | null> {
    try {
      await apiFetch(`/cases/${id}/sap-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      await load();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Action failed.';
    }
  }
  /** Run an approve (no dialog): a failure goes to the page alert, success clears it. */
  async function approve(run: () => Promise<string | null>) {
    setMsg(await run());
  }
  function confirmSap() {
    if (!window.confirm('Confirm this vendor into SAP/ERP and activate it?')) return;
    void approve(() => sapDecision('approve'));
  }
  async function lifecycle(path: 'block' | 'reactivate') {
    const reason = window.prompt(`Reason to ${path}:`);
    if (!reason) return;
    try {
      await apiFetch(`/cases/${id}/${path}`, { method: 'POST', body: JSON.stringify({ reason }) });
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Action failed.');
    }
  }

  if (!c)
    return (
      <main className="wrap">
        {msg ? (
          <p className="error">{msg}</p>
        ) : (
          <div className="card">
            <SkeletonLines count={5} />
          </div>
        )}
      </main>
    );

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
  const REVIEW_ROLES = ['infosec', 'fcu', 'operation', 'legal', 'l1', 'l2', 'l3'];
  const approvalLevels = c.approvalLevels ?? [];
  // The one stage this viewer owns and which is awaiting them: a parallel review, or the approval
  // level the case is currently on (levels run one after another).
  const myStage = [...(c.reviewStages ?? []), ...approvalLevels].find(
    (s) =>
      REVIEW_ROLES.includes(s) &&
      roles.includes(s) &&
      c.stages?.[s]?.status === 'pending' &&
      (!approvalLevels.includes(s) || c.stage === s),
  );
  const isLevelApprover = !!myStage && approvalLevels.includes(myStage);
  const isSapReviewer = roles.includes('sap');
  const detail = c as unknown as VendorDetailsData;
  // Documents shaped for the Vendor Details modal (download URL resolved here).
  const docFiles = docs.map((d) => ({
    id: d.id,
    docType: d.docType,
    filename: d.filename,
    status: d.status,
    version: d.version,
    createdAt: d.createdAt,
    sizeBytes: d.sizeBytes,
    href: `${API_BASE}/cases/${id}/documents/${d.id}/download`,
  }));
  const vendorModal = showDetails && (
    <VendorDetailsModal
      data={detail}
      docs={docFiles}
      activity={c.activity}
      caseId={c.id}
      onClose={() => setShowDetails(false)}
    />
  );
  const vendorCard = (
    <>
      <Card
        id="vendor"
        title="Vendor details"
        icon="building"
        aside={
          <div className="req__actions">
            {roles.includes('fcu') && (
              <Link className="btn btn--sm btn--ghost" href={`/cases/${c.id}/kyc`}>
                Digi KYC & risk checks
              </Link>
            )}
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => setShowDetails(true)}
            >
              View full details
            </button>
          </div>
        }
      >
        <Field label="Legal name" value={c.legalName} />
        <Field label="Trade name" value={c.tradeName} />
        <Field label="Business address" value={c.businessAddress} wide />
        <Field label="GSTIN" value={c.gstin} mono />
        <Field label="Contact" value={c.contactEmail} />
        <Field label="Category" value={c.categoryKey} />
      </Card>
      {vendorModal}
    </>
  );

  // Shared look for the reviewer screens: avatar header with the decision buttons, and one alert box.
  const reviewHeader = (pill: ReactNode, actions: ReactNode) => (
    <div className="rv-head">
      <span className="vdm__avatar" aria-hidden="true">
        {initials(c.legalName)}
      </span>
      <div className="rv-head__text">
        <h1>{c.legalName}</h1>
        <div className="vdm__meta">
          <code>{c.ref}</code>
          {pill}
          <span className={`pill tier--${c.tier}`}>{c.tier} risk</span>
        </div>
      </div>
      {actions}
    </div>
  );
  const infoMsg = !!msg && /^(Document uploaded|Verification run)/.test(msg);
  const alertBox = msg ? (
    <div
      className={`rv-alert rv-alert--${infoMsg ? 'info' : 'warn'}`}
      role={infoMsg ? 'status' : 'alert'}
    >
      <Icon name={infoMsg ? 'check' : 'alert'} size={18} />
      <span>{msg}</span>
    </div>
  ) : null;

  // FCU: the findings form is complete once both checks, the overall finding and the report are in.
  const fcuReports = docs.filter((d) => d.docType === 'fcu_dd_report' && d.status === 'CLEAN');
  const fcuPayload = (): FcuPayload | null =>
    fcuResidential && fcuOffice && fcuFinding
      ? {
          residentialAddressCheck: fcuResidential === 'yes',
          officeAddressCheck: fcuOffice === 'yes',
          overallFinding: fcuFinding,
          comment: fcuComment.trim() || undefined,
        }
      : null;
  const fcuDone =
    [fcuResidential, fcuOffice, fcuFinding].filter(Boolean).length +
    (fcuReports.length > 0 ? 1 : 0);
  function approveFcu() {
    setFcuTried(true); // highlight whatever is still missing, right next to the field
    const payload = fcuPayload();
    if (!payload || fcuReports.length === 0) {
      setMsg('Complete the highlighted items before approving.');
      return;
    }
    setMsg(null);
    void approve(() => stageDecision('fcu', 'approve', { fcu: payload }));
  }

  // Submit from the send-back / reject dialog. Resolves to an error to show in the dialog, or null.
  async function submitDialog(note: string): Promise<string | null> {
    if (!dialog) return null;
    const error =
      dialog.scope === 'sap'
        ? await sapDecision('reject', note)
        : await stageDecision(myStage!, dialog.kind, {
            note,
            // Keep whatever FCU findings were filled in alongside the decision.
            fcu: myStage === 'fcu' ? (fcuPayload() ?? undefined) : undefined,
          });
    if (!error) {
      setDialog(null);
      setMsg(null);
    }
    return error;
  }
  const decisionDialog = dialog ? (
    <DecisionDialog
      kind={dialog.kind}
      vendor={c.legalName}
      team={dialog.scope === 'stage' && myStage ? STAGE_LABELS[myStage] : undefined}
      onCancel={() => setDialog(null)}
      onSubmit={submitDialog}
    />
  ) : null;

  // A parallel reviewer (InfoSec/FCU/Operation/Legal) gets a clean, focused review screen.
  if (myStage) {
    const answers: [string, boolean][] = [
      ['Information Technology — Hardware', c.isecItHardware],
      ['Information Technology — Software', c.isecItSoftware],
      ["Access to HFCL's systems", c.isecAccessSystem],
      ["Access to HFCL's IT network", c.isecAccessNetwork],
      ["Access to HFCL's applications", c.isecAccessApps],
      ['Access to PII (customer / employee / partner)', c.isecAccessPii],
    ];
    return (
      <main className="wrap rv-page">
        <p className="crumbs">
          <Link href={`/stages/${myStage}`}>{STAGE_LABELS[myStage]} queue</Link>
        </p>
        {reviewHeader(
          <span className="pill pill--warn">
            {STAGE_LABELS[myStage]}
            {isLevelApprover ? '' : ' review'}
          </span>,
          <div className="rv-actions">
            <button
              className="btn"
              onClick={() =>
                myStage === 'fcu'
                  ? approveFcu()
                  : void approve(() =>
                      stageDecision(myStage, 'approve', {
                        agreement: myStage === 'legal' ? agreement : undefined,
                      }),
                    )
              }
            >
              Approve
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => setDialog({ kind: 'sendback', scope: 'stage' })}
            >
              Send back
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => setDialog({ kind: 'reject', scope: 'stage' })}
            >
              Reject
            </button>
          </div>,
        )}
        {alertBox}

        <div className="rv-stack">
          {myStage === 'fcu' && <SectionNav sections={FCU_SECTIONS} />}
          {vendorCard}

          {isLevelApprover && (
            <ParallelReview
              stages={c.stages ?? {}}
              reviewStages={c.reviewStages ?? []}
              caseStage={c.stage}
              approvalLevels={approvalLevels}
            />
          )}

          {myStage === 'infosec' && (
            <Card title="Access requested" icon="lock">
              <Group>Why this case was routed to InfoSec</Group>
              {answers.map(([label, val]) => (
                <Field key={label} label={label} value={val ? 'Yes' : 'No'} badge invert />
              ))}
            </Card>
          )}

          {myStage === 'fcu' && (
            <>
              <section id="vd-automated" className="vdm__card rv-card--form">
                <h3 className="vdm__cardtitle">
                  <span className="vdm__ico">
                    <Icon name="shield" size={16} />
                  </span>
                  FCU DD automated check
                </h3>
                {/* Intentionally empty for now — automated check fields will be mapped here later. */}
                <div className="rv-empty">Automated check results will appear here.</div>
              </section>

              <section id="vd-findings" className="vdm__card rv-card--form">
                <h3 className="vdm__cardtitle">
                  <span className="vdm__ico">
                    <Icon name="check" size={16} />
                  </span>
                  Overall findings
                </h3>
                <p className="rv-lead">
                  Record what you verified. Everything except the comment is required to approve.
                </p>
                <Meter done={fcuDone} total={4} />

                <Question
                  title="Residential address check conducted?"
                  done={!!fcuResidential}
                  invalid={fcuTried && !fcuResidential}
                >
                  <Segmented
                    name="fcu-residential"
                    label="Residential address check conducted"
                    value={fcuResidential}
                    onChange={setFcuResidential}
                    options={[
                      { value: 'yes', label: 'Yes', tone: 'ok' },
                      { value: 'no', label: 'No', tone: 'warn' },
                    ]}
                  />
                </Question>
                <Question
                  title="Office address check conducted?"
                  done={!!fcuOffice}
                  invalid={fcuTried && !fcuOffice}
                >
                  <Segmented
                    name="fcu-office"
                    label="Office address check conducted"
                    value={fcuOffice}
                    onChange={setFcuOffice}
                    options={[
                      { value: 'yes', label: 'Yes', tone: 'ok' },
                      { value: 'no', label: 'No', tone: 'warn' },
                    ]}
                  />
                </Question>
                <Question
                  title="Overall finding"
                  hint="Your overall conclusion from the due diligence"
                  done={!!fcuFinding}
                  invalid={fcuTried && !fcuFinding}
                >
                  <Segmented
                    name="fcu-finding"
                    label="Overall finding"
                    value={fcuFinding}
                    onChange={setFcuFinding}
                    options={[
                      { value: 'positive', label: 'Positive', tone: 'ok' },
                      { value: 'negative', label: 'Negative', tone: 'bad' },
                    ]}
                  />
                </Question>

                <div className="rv-sub">
                  <h4>Final FCU due-diligence report</h4>
                  <span className="rv-tag rv-tag--req">Required</span>
                </div>
                <Dropzone
                  accept=".pdf,.jpg,.jpeg,.png"
                  busy={uploading}
                  invalid={fcuTried && fcuReports.length === 0}
                  hint="PDF, JPG or PNG · checked by content and scanned for malware"
                  onFile={(file) => void uploadDoc(file, 'fcu_dd_report')}
                />
                {fcuTried && fcuReports.length === 0 && (
                  <p className="fcu-q__err" role="alert" style={{ marginTop: 8 }}>
                    Required — upload the final report to approve.
                  </p>
                )}
                {fcuReports.length > 0 && (
                  <ul className="fcu-files">
                    {fcuReports.map((d) => (
                      <li key={d.id} className="fcu-file">
                        <span className="fcu-file__ico">
                          <Icon name="doc" size={18} />
                        </span>
                        <div className="fcu-file__main">
                          <div className="fcu-file__name">{d.filename}</div>
                          <div className="fcu-file__meta">
                            Version {d.version} · {formatBytes(d.sizeBytes)}
                          </div>
                        </div>
                        <span className="pill pill--ok">Uploaded</span>
                        <a
                          className="btn btn--sm btn--ghost"
                          href={`${API_BASE}/cases/${id}/documents/${d.id}/download`}
                        >
                          Download
                        </a>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="rv-sub">
                  <h4>Comment</h4>
                  <span className="rv-tag">Optional</span>
                </div>
                <textarea
                  className="rv-text"
                  aria-label="Comment"
                  value={fcuComment}
                  onChange={(e) => setFcuComment(e.target.value)}
                  placeholder="Anything the next reviewers should know…"
                  rows={4}
                  maxLength={4000}
                />
                <div className="rv-count">{fcuComment.length} / 4000</div>
              </section>
            </>
          )}

          {myStage === 'legal' && (
            <section className="vdm__card rv-card--form">
              <h3 className="vdm__cardtitle">
                <span className="vdm__ico">
                  <Icon name="doc" size={16} />
                </span>
                Draft the agreement
              </h3>
              <p className="rv-lead">
                Draft the vendor agreement text below. It is saved with your approval.
              </p>
              <textarea
                className="rv-text"
                aria-label="Agreement text"
                value={agreement}
                onChange={(e) => setAgreement(e.target.value)}
                placeholder="Agreement clauses, terms, special conditions…"
                rows={10}
              />
            </section>
          )}
        </div>
        {decisionDialog}
      </main>
    );
  }

  // SAP confirmation — final stage. Shows every parallel stage's completion, then confirms.
  if (isSapReviewer && (c.stage === 'sap' || c.stage === 'approved' || c.stage === 'rejected')) {
    const active = c.reviewStages ?? [];
    const allDone = [...active, ...approvalLevels].every(
      (s) => c.stages?.[s]?.status === 'approved',
    );
    const fcuData = c.stages?.fcu?.data;
    return (
      <main className="wrap rv-page">
        <p className="crumbs">
          <Link href="/stages/sap">SAP confirmation queue</Link>
        </p>
        {reviewHeader(
          <span
            className={`pill ${c.stage === 'approved' ? 'pill--ok' : c.stage === 'rejected' ? 'pill--danger' : 'pill--warn'}`}
          >
            {STAGE_LABELS.sap}: {c.stage}
          </span>,
          c.stage === 'sap' ? (
            <div className="rv-actions">
              <button className="btn" disabled={!allDone} onClick={confirmSap}>
                Confirm &amp; activate
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => setDialog({ kind: 'reject', scope: 'sap' })}
              >
                Reject
              </button>
            </div>
          ) : null,
        )}
        {alertBox}

        <div className="rv-stack">
          {vendorCard}

          <ParallelReview
            stages={c.stages ?? {}}
            reviewStages={active}
            caseStage={c.stage}
            approvalLevels={approvalLevels}
            canConfirmSap
            onConfirmSap={confirmSap}
          />

          {fcuData?.overallFinding && (
            <Card title="FCU findings" icon="search">
              <Field
                label="Residential address check conducted"
                value={fcuData.residentialAddressCheck ? 'Yes' : 'No'}
                badge
              />
              <Field
                label="Office address check conducted"
                value={fcuData.officeAddressCheck ? 'Yes' : 'No'}
                badge
              />
              <Field label="Overall finding" value={fcuData.overallFinding} badge />
              <Field label="Comment" value={fcuData.comment} wide />
            </Card>
          )}

          {c.stages?.legal?.data?.agreement && (
            <section className="vdm__card rv-card--form">
              <h3 className="vdm__cardtitle">
                <span className="vdm__ico">
                  <Icon name="doc" size={16} />
                </span>
                Legal agreement
              </h3>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {c.stages.legal.data.agreement}
              </pre>
            </section>
          )}
        </div>
        {decisionDialog}
      </main>
    );
  }

  const terminal = c.stage === 'approved' || c.stage === 'rejected' || c.stage === 'cancelled';
  const reviewStages = c.reviewStages ?? [];
  // Parallel review is driven by the per-stage review screens, so the sequential workflow buttons
  // are only relevant for a legacy/sequential case (not in the review/sap/draft phases).
  const parallelPhase = ['review', 'sap', 'draft', ...approvalLevels].includes(c.stage);
  const actions = parallelPhase
    ? []
    : terminal
      ? c.stage === 'rejected'
        ? ['reopen']
        : []
      : c.onHold
        ? ['resume']
        : ['advance', 'return', 'reject', 'hold'];
  const isOwner = meId !== '' && meId === c.createdById;
  // Stages that a reviewer sent back to the proposer (they need to edit & resubmit those).
  const sentBackStages = [...reviewStages, ...approvalLevels].filter(
    (s) => c.stages?.[s]?.status === 'sent_back',
  );
  const sentBack = sentBackStages.length > 0;
  const lastReturn = [...c.activity]
    .reverse()
    .find((a) => /_sendback$|^return$|infosec_returned/.test(a.action));
  const canEditDraft = isOwner && (c.stage === 'draft' || sentBack);

  return (
    <main className="wrap">
      <p className="crumbs">
        <Link href="/cases">Cases</Link>
      </p>
      <div className="topbar">
        <div>
          <h1>{c.legalName}</h1>
          <p className="lead">
            <code>{c.ref}</code> · <span className={`pill tier--${c.tier}`}>{c.tier}</span> · stage{' '}
            <span className="pill">
              {c.stage}
              {c.onHold ? ' · hold' : ''}
            </span>
            {c.vendorCode && (
              <>
                {' '}
                · vendor <code>{c.vendorCode}</code>
              </>
            )}
          </p>
        </div>
        <div className="req__actions">
          {canEditDraft && (
            <Link className="btn btn--sm" href={`/cases/new?id=${c.id}`}>
              Edit &amp; resubmit
            </Link>
          )}
          {actions.map((a) => (
            <button
              key={a}
              className={`btn btn--sm${a === 'reject' ? ' btn--ghost' : ''}`}
              onClick={() => void act(a)}
            >
              {a}
            </button>
          ))}
          {c.stage === 'approved' && c.vendorStatus === 'ACTIVE' && (
            <button className="btn btn--sm btn--ghost" onClick={() => void lifecycle('block')}>
              block vendor
            </button>
          )}
          {c.stage === 'approved' && c.vendorStatus === 'BLOCKED' && (
            <button className="btn btn--sm" onClick={() => void lifecycle('reactivate')}>
              reactivate
            </button>
          )}
        </div>
      </div>
      {sentBack && (
        <div className="namematch namematch--warn">
          <strong>Changes requested</strong>
          <ul className="rv-remarks">
            {sentBackStages.map((st) => (
              <li key={st}>
                <strong>{STAGE_LABELS[st] ?? st}:</strong>{' '}
                {c.stages?.[st]?.remark || 'A reviewer asked for changes before this can proceed.'}
              </li>
            ))}
          </ul>
          {canEditDraft && (
            <>
              {' '}
              <Link href={`/cases/new?id=${c.id}`}>Edit the case</Link> and resubmit.
            </>
          )}
        </div>
      )}
      {c.stage === 'approved' && (
        <p className="note">
          Vendor status:{' '}
          <span className={`pill ${c.vendorStatus === 'ACTIVE' ? 'pill--ok' : 'tier--critical'}`}>
            {c.vendorStatus}
          </span>
        </p>
      )}
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}

      <div className="tabs" role="tablist" aria-label="Case sections">
        {CASE_TABS.map((t) => {
          const count =
            t.id === 'files' ? docs.length : t.id === 'audit' ? c.activity.length : undefined;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`casetab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`casepanel-${t.id}`}
              className={`tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} size={16} />
              {t.label}
              {count != null && <span className="tab__count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="casepanel-overview"
        aria-labelledby="casetab-overview"
        hidden={tab !== 'overview'}
      >
        {(c.stage === 'review' ||
          approvalLevels.includes(c.stage) ||
          c.stage === 'sap' ||
          c.stage === 'approved' ||
          c.stage === 'rejected' ||
          c.stage === 'cancelled') &&
          reviewStages.length > 0 && (
            <ParallelReview
              stages={c.stages ?? {}}
              reviewStages={reviewStages}
              caseStage={c.stage}
              approvalLevels={approvalLevels}
            />
          )}

        <section className="card">
          <div className="card__head">
            <h2>Vendor details</h2>
            <div className="req__actions">
              {roles.includes('fcu') && (
                <Link className="btn btn--sm btn--ghost" href={`/cases/${c.id}/kyc`}>
                  Digi KYC & risk checks
                </Link>
              )}
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => setShowDetails(true)}
              >
                View full details
              </button>
            </div>
          </div>
          {vendorModal}
          <div className="grid2">
            <div>
              Legal name <strong>{c.legalName}</strong>
            </div>
            <div>Trade name {c.tradeName ?? '-'}</div>
            <div className="span2">Business address {c.businessAddress ?? '-'}</div>
            <div>
              GSTIN <code>{c.gstin ?? '-'}</code>
            </div>
            <div>Contact {c.contactEmail ?? '-'}</div>
            <div>
              PAN <code>{c.pan ?? '-'}</code>
            </div>
            <div>
              IFSC <code>{c.ifsc ?? '-'}</code>
            </div>
            <div>
              Bank a/c <code>{c.bankAccount ?? '-'}</code>
            </div>
            <div>Spend USD {c.spend.toLocaleString()}</div>
          </div>
          <p className="muted">
            Category: {c.categoryKey} · risk score {c.riskScore}
          </p>
          {c.justification && <p>{c.justification}</p>}
        </section>
      </div>

      <div
        role="tabpanel"
        id="casepanel-files"
        aria-labelledby="casetab-files"
        hidden={tab !== 'files'}
      >
        <section className="card">
          <h2>Documents ({docs.length})</h2>
          <div className="req__actions">
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {[
                'pan_card',
                'gst_certificate',
                'cancelled_cheque',
                'insurance',
                'tax_residency_certificate',
                'related_party_declaration',
                'other',
              ].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadDoc(file);
                e.currentTarget.value = '';
              }}
            />
          </div>
          <p className="muted tiny">PDF/JPG/PNG only · validated by content and malware-scanned.</p>
          <div className="scroll-area">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>SHA-256</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.docType} <span className="muted tiny">v{d.version}</span>
                    </td>
                    <td>{d.filename}</td>
                    <td className="muted">{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td className="muted tiny">{d.sha256.slice(0, 12)}…</td>
                    <td>
                      <span className={d.status === 'CLEAN' ? 'pill pill--ok' : 'pill'}>
                        {d.status}
                      </span>
                    </td>
                    <td>
                      <a
                        className="btn btn--sm btn--ghost"
                        href={`${API_BASE}/cases/${id}/documents/${d.id}/download`}
                      >
                        Download
                      </a>
                    </td>
                  </tr>
                ))}
                {docs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No documents.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div
        role="tabpanel"
        id="casepanel-audit"
        aria-labelledby="casetab-audit"
        hidden={tab !== 'audit'}
      >
        <section className="card">
          <h2>Audit trail</h2>
          <p className="section-intro">Every action taken on this case, most recent last.</p>
          <ul className="timeline">
            {c.activity.map((a2, i) => (
              <li key={i}>
                <span className="muted">{new Date(a2.at).toLocaleString()}</span>
                {' · '}
                <strong>{a2.action.replace(/_/g, ' ')}</strong>
                {a2.fromStage && a2.toStage && a2.fromStage !== a2.toStage && (
                  <>
                    {' '}
                    ({a2.fromStage} → {a2.toStage})
                  </>
                )}
                {a2.note && <> · {a2.note}</>}
              </li>
            ))}
            {c.activity.length === 0 && <li className="muted">No activity recorded yet.</li>}
          </ul>
        </section>
      </div>
    </main>
  );
}
