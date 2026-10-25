'use client';

// Building blocks shared by the "full vendor details" popup and the reviewer screens, so both use
// the same cards, fields, status badges and verification chips.

import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/** The slice of a case the detail views read. Everything is optional — blank values render as "—". */
export interface VendorDetailsData {
  ref?: string;
  categoryKey?: string;
  tier?: string;
  riskScore?: number;
  createdAt?: string;
  legalName?: string;
  tradeName?: string | null;
  businessAddress?: string | null;
  // tax / bank
  pan?: string | null;
  gstin?: string | null;
  ifsc?: string | null;
  bankName?: string | null;
  branch?: string | null;
  bankAccount?: string | null;
  // team structure snapshot (from the master table at submission)
  teamStructure?: Record<string, string> | null;
  // RC (revolving credit) limits
  rcLimits?: {
    id?: string;
    financerName: string;
    rcLimit: string;
    numberOfVehicles?: string;
    sanctionLoanLimit?: string;
    creditLimitFigures?: string;
    creditLimitWords?: string;
    remarks: string;
  }[];
  // trade references
  references?: {
    id?: string;
    contactName: string;
    businessName: string;
    registeredAddress: string;
    contactNumber: string;
    email: string;
  }[];
  // management structure
  partners?: {
    id?: string;
    name: string;
    dob?: string;
    maritalStatus?: string;
    gender?: string;
    fatherName?: string;
    spouseName?: string | null;
    pan?: string;
    address?: string;
    mobile?: string;
    pincode?: string;
  }[];
  // authorised signatory + SPOC
  signatoryName?: string | null;
  signatoryPan?: string | null;
  signatoryMobile?: string | null;
  signatoryEmail?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  // engagement
  businessUnit?: string | null;
  costCentre?: string | null;
  spend?: number;
  contractMonths?: number | null;
  natureOfService?: string | null;
  justification?: string;
  // information security
  isecItHardware?: boolean;
  isecItSoftware?: boolean;
  isecAccessSystem?: boolean;
  isecAccessNetwork?: boolean;
  isecAccessApps?: boolean;
  isecAccessPii?: boolean;
  // registry results captured when the vendor was entered
  registry?: {
    pan?: {
      verified?: boolean;
      status?: string | null;
      fields?: {
        name?: string;
        fatherName?: string;
        category?: string;
        panStatus?: string;
        aadhaarStatus?: string;
      };
    };
    gst?: {
      verified?: boolean;
      details?: {
        legalName?: string;
        tradeName?: string;
        constitutionOfBusiness?: string;
        taxPayerType?: string;
        gstStatus?: string;
        registrationDate?: string;
        principalAddress?: string;
        state?: string;
        city?: string;
        pincode?: string;
        latestFiling?: {
          filingYear?: string;
          monthOfFiling?: string;
          gstType?: string;
          dateOfFiling?: string;
          gstStatus?: string;
        };
      };
    };
    bank?: {
      verified?: boolean;
      details?: { holderName?: string; active?: boolean; accountNumber?: string; ifsc?: string };
    };
    msme?: {
      verified?: boolean;
      details?: {
        udyamNumber?: string;
        registrationDate?: string;
        organizationType?: string;
        enterpriseType?: string;
        officialName?: string;
        majorActivity?: string;
      };
    };
  };
}

export type Tone = 'ok' | 'bad' | 'neutral';

/** Colour a status word: green when good, red when bad, grey when unknown. */
export function toneOf(v?: string | null): Tone {
  if (!v) return 'neutral';
  const s = v.trim().toLowerCase();
  if (/^(active|valid|verified|registered|linked|yes|positive|approved|completed)$/.test(s)) {
    return 'ok';
  }
  if (/(inactive|invalid|cancel|suspend|not linked|rejected|negative|^no$)/.test(s)) return 'bad';
  return 'neutral';
}

/** "PRIVATE LIMITED COMPANY" / "company" → "Private Limited Company". */
export function titleCase(v: string): string {
  return v.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function initials(name?: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'V') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Verification summary chips — only for checks we actually have a result for. */
export function verificationChips(
  data: VendorDetailsData,
): { label: string; value: string; tone: Tone }[] {
  const r = data.registry ?? {};
  const chips: { label: string; value: string; tone: Tone }[] = [];
  const panStatus = r.pan?.fields?.panStatus ?? r.pan?.status ?? undefined;
  if (panStatus) chips.push({ label: 'PAN', value: titleCase(panStatus), tone: toneOf(panStatus) });
  const gstStatus = r.gst?.details?.gstStatus;
  if (gstStatus) chips.push({ label: 'GST', value: titleCase(gstStatus), tone: toneOf(gstStatus) });
  const bank = r.bank?.details;
  if (bank?.active !== undefined) {
    chips.push({
      label: 'Bank',
      value: bank.active ? 'Active' : 'Inactive',
      tone: bank.active ? 'ok' : 'bad',
    });
  }
  const msme = r.msme?.details?.enterpriseType;
  if (msme) chips.push({ label: 'MSME', value: titleCase(msme), tone: 'ok' });
  return chips;
}

export function Chips({ chips }: { chips: ReturnType<typeof verificationChips> }) {
  if (chips.length === 0) return null;
  return (
    <div className="vdm__chips" aria-label="Verification summary">
      {chips.map((c) => (
        <span key={c.label} className={`vdm__chip vdm__chip--${c.tone}`}>
          <span className="vdm__dot" />
          {c.label} · {c.value}
        </span>
      ))}
    </div>
  );
}

/** A titled card with an icon badge. `id` makes it an in-page anchor; `aside` sits on the right. */
export function Card({
  id,
  title,
  icon,
  aside,
  children,
}: {
  id?: string;
  title: string;
  icon: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const heading = (
    <h3 className="vdm__cardtitle">
      <span className="vdm__ico">
        <Icon name={icon} size={16} />
      </span>
      {title}
    </h3>
  );
  return (
    <section id={id ? `vd-${id}` : undefined} className="vdm__card">
      {aside ? (
        <div className="vdm__cardhead">
          {heading}
          {aside}
        </div>
      ) : (
        heading
      )}
      <dl className="vdm__grid">{children}</dl>
    </section>
  );
}

export function Group({ children }: { children: ReactNode }) {
  return <div className="vdm__group">{children}</div>;
}

export function Field({
  label,
  value,
  wide,
  mono,
  badge,
  title,
  invert,
}: {
  label: string;
  value?: string | number | null;
  wide?: boolean;
  mono?: boolean;
  /** Render as a coloured status pill. */
  badge?: boolean;
  /** Normalise SHOUTING / lowercase registry text to Title Case. */
  title?: boolean;
  /** For questionnaire answers: "Yes" (access requested) is the attention state, not "No". */
  invert?: boolean;
}) {
  const empty = value === undefined || value === null || value === '';
  const text = empty ? '' : title ? titleCase(String(value)) : String(value);
  // Questionnaire: "Yes" means access is requested → amber; "No" → calm green.
  const tone: Tone = invert ? (text === 'Yes' ? 'bad' : 'ok') : toneOf(text);
  return (
    <div className={`vdm__item${wide ? ' vdm__item--wide' : ''}`}>
      <dt>{label}</dt>
      <dd>
        {empty ? (
          <span className="vdm__empty">—</span>
        ) : badge ? (
          <span className={`vdm__badge vdm__badge--${tone}${invert ? ' vdm__badge--attn' : ''}`}>
            <span className="vdm__dot" />
            {title ? text : titleCase(text)}
          </span>
        ) : mono ? (
          <span className="vdm__monorow">
            <span className="vdm__mono">{text}</span>
            {!text.includes('•') && <CopyButton text={text} label={label} />}
          </span>
        ) : (
          text
        )}
      </dd>
    </div>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="vdm__copy"
      aria-label={`Copy ${label}`}
      title={copied ? 'Copied' : 'Copy'}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={14} />
    </button>
  );
}
