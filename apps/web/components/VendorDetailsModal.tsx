'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { Icon } from './icons';
import { useModalBehavior } from './useModalBehavior';
import { Card, Field, Group, titleCase, toneOf, type VendorDetailsData } from './DetailParts';
import { TEAM_GROUPS } from '../lib/team-structure';
import {
  CONSTITUTION_LABELS,
  MANAGEMENT,
  PERSON_FIELD_LABELS,
  isConstitution,
  type ManagementRole,
} from '@vop/shared';

// Re-exported so existing imports (`import VendorDetailsModal, { type VendorDetailsData }`) keep working.
export type { VendorDetailsData };

export interface ModalDoc {
  id: string;
  docType: string;
  filename: string;
  status: string;
  version: number;
  createdAt: string;
  sizeBytes: number;
  /** Absolute download URL (the caller knows the API base + case id). */
  href?: string;
}
export interface ModalActivity {
  at: string;
  action: string;
  fromStage: string | null;
  toStage: string | null;
  note: string | null;
}

const ISEC: [keyof VendorDetailsData, string][] = [
  ['isecItHardware', 'IT — Hardware'],
  ['isecItSoftware', 'IT — Software'],
  ['isecAccessSystem', "Access to HFCL's systems"],
  ['isecAccessNetwork', "Access to HFCL's IT network"],
  ['isecAccessApps', "Access to HFCL's applications"],
  ['isecAccessPii', 'Access to PII (customer / employee / partner)'],
];

type TabId = 'overview' | 'tax' | 'bank' | 'documents' | 'activity';

function bytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}
function prettyDocType(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function VendorDetailsModal({
  data,
  docs,
  activity,
  onClose,
}: {
  data: VendorDetailsData;
  docs?: ModalDoc[];
  activity?: ModalActivity[];
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalBehavior({ panelRef, initialFocusRef: closeRef, onClose });

  const r = data.registry ?? {};
  const gst = r.gst?.details;
  const msme = r.msme?.details;
  const bank = r.bank?.details;
  const pan = r.pan?.fields;
  const panStatus = pan?.panStatus ?? r.pan?.status ?? undefined;
  const gstVerified = !!(r.gst?.verified || /active|verified/i.test(gst?.gstStatus ?? ''));
  // Columns follow the people asked about (proprietor / partner / director / Karta).
  const mgmtRole = data.partners?.[0]?.role as ManagementRole | undefined;
  const mgmt = MANAGEMENT[mgmtRole && mgmtRole in MANAGEMENT ? mgmtRole : 'partner'];

  const tabs = useMemo<{ id: TabId; label: string; count?: number }[]>(
    () => [
      { id: 'overview', label: 'Overview' },
      { id: 'tax', label: 'Tax Details' },
      { id: 'bank', label: 'Bank Details' },
    ],
    [],
  );
  const [tab, setTab] = useState<TabId>('overview');

  return (
    <div
      className="vdm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="vdm__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vd-title"
      >
        <div className="vdm__grab" aria-hidden="true" />

        <header className="vdm__head">
          <span className="vdm__headicon" aria-hidden="true">
            <Icon name="building" size={22} />
          </span>
          <div className="vdm__title">
            <h2 id="vd-title">Vendor Details</h2>
            <p className="vdm__subtitle">View complete vendor information and documents</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="vdm__close"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={20} />
          </button>
        </header>

        {/* Summary card — always visible */}
        <div className="vdm__summary">
          <div className="vdm__sumhead">
            <div className="vdm__sumname">
              <strong title={data.legalName}>{data.legalName ?? 'Vendor'}</strong>
              {data.tradeName && <span className="vdm__sumtrade">{data.tradeName}</span>}
            </div>
            <div className="vdm__badges">
              {gstVerified && (
                <span className="vdm__pbadge vdm__pbadge--ok">
                  <Icon name="check" size={14} /> GST Verified
                </span>
              )}
            </div>
          </div>
          <div className="vdm__sumrows">
            {data.contactEmail && (
              <span className="vdm__sumcontact">
                <Icon name="inbox" size={15} /> {data.contactEmail}
              </span>
            )}
            {data.contactPhone && (
              <span className="vdm__sumcontact">
                <Icon name="user" size={15} /> {data.contactPhone}
              </span>
            )}
            {data.businessAddress && (
              <span className="vdm__sumcontact vdm__sumcontact--wide">
                <Icon name="tag" size={15} /> {data.businessAddress}
              </span>
            )}
          </div>
          <div className="vdm__sumgrid">
            <div>
              <dt>Trade Name</dt>
              <dd>{data.tradeName ?? '—'}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{data.categoryKey ?? '—'}</dd>
            </div>
          </div>
        </div>

        <nav className="vdm__nav" aria-label="Vendor detail sections" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`vdtab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`vdpanel-${t.id}`}
              className={`vdm__navbtn${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.count != null && <span className="vdm__tabcount">{t.count}</span>}
            </button>
          ))}
        </nav>

        <div className="vdm__body">
          {/* OVERVIEW */}
          <div role="tabpanel" id="vdpanel-overview" hidden={tab !== 'overview'}>
            <Card title="Vendor identity" icon="user">
              <Field label="Legal name" value={data.legalName} />
              <Field label="Trade name" value={data.tradeName} />
              <Field label="Business address" value={data.businessAddress} wide />
              <Field label="City" value={data.addressCity} />
              <Field label="State" value={data.addressState} />
              <Field label="Postal code" value={data.addressPostalCode} />
              <Field label="Country" value={data.addressCountry} />
              <Group>Business SPOC</Group>
              <Field label="Contact person" value={data.contactName} />
              <Field label="Email" value={data.contactEmail} />
              <Field label="Phone" value={data.contactPhone} />
              <Group>Authorised signatory</Group>
              <Field label="Name (as per Aadhaar)" value={data.signatoryName} />
              <Field label="PAN" value={data.signatoryPan} mono />
              <Field label="Mobile" value={data.signatoryMobile} />
              <Field label="Email" value={data.signatoryEmail} />
            </Card>

            {data.partners && data.partners.length > 0 && (
              <Card
                title={
                  mgmt.single
                    ? `Management structure — ${mgmt.noun}`
                    : `Management structure — ${mgmt.noun}s (${data.partners.length})`
                }
                icon="user"
              >
                {data.constitution && isConstitution(data.constitution) && (
                  <Field
                    label="Type of constitution"
                    value={CONSTITUTION_LABELS[data.constitution]}
                  />
                )}
                {mgmt.single ? (
                  // One proprietor / Karta: field by field, as in the questionnaire.
                  mgmt.fields.map((k) => (
                    <Field
                      key={k}
                      label={PERSON_FIELD_LABELS[k]}
                      value={data.partners?.[0]?.[k]}
                      mono={k === 'pan'}
                      wide={/address/i.test(k)}
                    />
                  ))
                ) : (
                  <div style={{ gridColumn: '1 / -1', overflowX: 'auto' }}>
                    <table className="partners__tbl" style={{ minWidth: 1100 }}>
                      <thead>
                        <tr>
                          {mgmt.fields.map((k) => (
                            <th key={k}>{PERSON_FIELD_LABELS[k]}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.partners.map((p, i) => (
                          <tr key={p.id ?? i}>
                            {mgmt.fields.map((k) => (
                              <td key={k}>
                                {k === 'pan' ? <code>{p.pan ?? '—'}</code> : p[k] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}

            {data.references && data.references.length > 0 && (
              <Card title={`References (${data.references.length})`} icon="user">
                <div style={{ gridColumn: '1 / -1', overflowX: 'auto' }}>
                  <table className="partners__tbl" style={{ minWidth: 800 }}>
                    <thead>
                      <tr>
                        <th>Contact name</th>
                        <th>Legal name of the business</th>
                        <th>Registered address</th>
                        <th>Contact number</th>
                        <th>Email ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.references.map((r, i) => (
                        <tr key={r.id ?? i}>
                          <td>{r.contactName}</td>
                          <td>{r.businessName}</td>
                          <td>{r.registeredAddress}</td>
                          <td>{r.contactNumber}</td>
                          <td>{r.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {data.rcLimits && data.rcLimits.length > 0 && (
              <Card title={`RC limit (${data.rcLimits.length})`} icon="bank">
                <div style={{ gridColumn: '1 / -1', overflowX: 'auto' }}>
                  <table className="partners__tbl" style={{ minWidth: 1000 }}>
                    <thead>
                      <tr>
                        <th>Name of the financer</th>
                        <th>RC limit (INR)</th>
                        <th>Number of vehicles</th>
                        <th>Sanction loan limit</th>
                        <th>Credit limit (figures)</th>
                        <th>Credit limit (words)</th>
                        <th>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rcLimits.map((r, i) => (
                        <tr key={r.id ?? i}>
                          <td>{r.financerName}</td>
                          <td>{r.rcLimit ? Number(r.rcLimit).toLocaleString('en-IN') : '—'}</td>
                          <td>{r.numberOfVehicles || '—'}</td>
                          <td>
                            {r.sanctionLoanLimit
                              ? Number(r.sanctionLoanLimit).toLocaleString('en-IN')
                              : '—'}
                          </td>
                          <td>
                            {r.creditLimitFigures
                              ? Number(r.creditLimitFigures).toLocaleString('en-IN')
                              : '—'}
                          </td>
                          <td>{r.creditLimitWords || '—'}</td>
                          <td>{r.remarks || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {data.teamStructure && (
              <Card title="Team structure" icon="user">
                {TEAM_GROUPS.map((g) => (
                  <Fragment key={g.title}>
                    <Group>{g.title}</Group>
                    {g.fields.map((fd) => (
                      <Field key={fd.key} label={fd.label} value={data.teamStructure?.[fd.key]} />
                    ))}
                  </Fragment>
                ))}
              </Card>
            )}

            <Card title="Information security questionnaire" icon="lock">
              {ISEC.map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={data[key] === undefined ? undefined : data[key] ? 'Yes' : 'No'}
                  badge
                  invert
                />
              ))}
            </Card>
          </div>

          {/* TAX DETAILS */}
          <div role="tabpanel" id="vdpanel-tax" hidden={tab !== 'tax'}>
            <Card
              title="PAN"
              icon="receipt"
              aside={panStatus ? <StatusPill value={panStatus} /> : undefined}
            >
              <Field label="PAN" value={data.pan} mono />
              <Field label="Name as per PAN" value={pan?.name} />
              <Field label="PAN category" value={pan?.category} title />
              <Field label="PAN–Aadhaar link" value={pan?.aadhaarStatus} badge />
            </Card>

            <Card
              title="GST registration"
              icon="receipt"
              aside={gst?.gstStatus ? <StatusPill value={gst.gstStatus} /> : undefined}
            >
              <Field label="GSTIN" value={data.gstin} mono />
              <Field label="GST legal name" value={gst?.legalName} />
              <Field label="GST trade name" value={gst?.tradeName} />
              <Field label="Constitution of business" value={gst?.constitutionOfBusiness} title />
              <Field label="Taxpayer type" value={gst?.taxPayerType} title />
              <Field label="Registration date" value={gst?.registrationDate} />
              <Field label="Principal place of business" value={gst?.principalAddress} wide />
              <Field
                label="State / city / pincode"
                value={[gst?.state, gst?.city, gst?.pincode].filter(Boolean).join(' · ')}
              />
              <Field
                label="Latest filing"
                value={
                  gst?.latestFiling
                    ? [
                        gst.latestFiling.gstType,
                        gst.latestFiling.monthOfFiling,
                        gst.latestFiling.filingYear,
                        gst.latestFiling.dateOfFiling && `filed ${gst.latestFiling.dateOfFiling}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : undefined
                }
                wide
              />
            </Card>

            {msme && (
              <Card title="MSME / Udyam registration" icon="factory">
                <Field label="Udyam number" value={msme.udyamNumber} mono />
                <Field label="Registration date" value={msme.registrationDate} />
                <Field label="Enterprise type" value={msme.enterpriseType} title />
                <Field label="Organisation type" value={msme.organizationType} title />
                <Field label="Enterprise name" value={msme.officialName} />
                <Field label="Major activity" value={msme.majorActivity} title />
              </Card>
            )}
          </div>

          {/* BANK DETAILS */}
          <div role="tabpanel" id="vdpanel-bank" hidden={tab !== 'bank'}>
            <Card
              title="Bank account"
              icon="bank"
              aside={
                bank?.active !== undefined ? (
                  <StatusPill value={bank.active ? 'Active' : 'Inactive'} />
                ) : undefined
              }
            >
              <Field label="Bank" value={data.bankName} />
              <Field label="Branch" value={data.branch} />
              <Field label="IFSC" value={data.ifsc} mono />
              <Field label="Account number" value={data.bankAccount} mono />
              <Field
                label={bank?.holderName ? 'Account holder (verified)' : 'Account holder'}
                value={bank?.holderName ?? data.legalName}
              />
            </Card>
          </div>

          {/* DOCUMENTS */}
          {docs && (
            <div role="tabpanel" id="vdpanel-documents" hidden={tab !== 'documents'}>
              <Card title={`Documents (${docs.length})`} icon="folder">
                <div className="vdm__docs">
                  {docs.map((d) => {
                    const clean = d.status === 'CLEAN';
                    return (
                      <div key={d.id} className="vdm__doc">
                        <span className="vdm__docico">
                          <Icon name="doc" size={18} />
                        </span>
                        <div className="vdm__docmain">
                          <div className="vdm__docname">{prettyDocType(d.docType)}</div>
                          <div className="vdm__docmeta">
                            {d.filename} · v{d.version} · {bytes(d.sizeBytes)} ·{' '}
                            {fmtDate(d.createdAt)}
                          </div>
                        </div>
                        <span className={`vdm__badge vdm__badge--${clean ? 'ok' : 'bad'}`}>
                          <span className="vdm__dot" />
                          {clean ? 'Verified' : d.status}
                        </span>
                        {d.href && (
                          <a className="btn btn--sm btn--ghost" href={d.href}>
                            <Icon name="download" size={14} /> Download
                          </a>
                        )}
                      </div>
                    );
                  })}
                  {docs.length === 0 && <p className="vdm__empty">No documents uploaded.</p>}
                </div>
              </Card>
            </div>
          )}

          {/* ACTIVITY */}
          {activity && (
            <div role="tabpanel" id="vdpanel-activity" hidden={tab !== 'activity'}>
              <Card title="Activity log" icon="clock">
                <ul className="timeline" style={{ margin: 0 }}>
                  {activity.map((a, i) => (
                    <li key={i}>
                      <span className="muted">{new Date(a.at).toLocaleString()}</span>
                      {' · '}
                      <strong>{a.action.replace(/_/g, ' ')}</strong>
                      {a.fromStage && a.toStage && a.fromStage !== a.toStage && (
                        <>
                          {' '}
                          ({a.fromStage} → {a.toStage})
                        </>
                      )}
                      {a.note && <> · {a.note}</>}
                    </li>
                  ))}
                  {activity.length === 0 && <li className="muted">No activity recorded yet.</li>}
                </ul>
              </Card>
            </div>
          )}

          <div className="vdm__secure">
            <span className="vdm__secureico">
              <Icon name="shield" size={18} />
            </span>
            <div>
              <strong>Your data is secure</strong>
              <p>
                Sensitive information like PAN, bank details and other personal data is encrypted
                and only shown to authorised users (masked otherwise).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small coloured status pill used in a card header (e.g. "Verified"/"Active"). */
function StatusPill({ value }: { value: string }) {
  const tone = toneOf(value);
  return (
    <span className={`vdm__badge vdm__badge--${tone}`}>
      <span className="vdm__dot" />
      {titleCase(value)}
    </span>
  );
}
