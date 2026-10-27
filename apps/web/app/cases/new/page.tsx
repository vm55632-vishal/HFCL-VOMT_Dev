'use client';
import Link from 'next/link';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, apiUpload, ApiError } from '../../../lib/api';
import {
  validatePan,
  validateGstin,
  validateIfsc,
  rcLimitsFromVehicles,
  categoryHasRcLimits,
  RC_LIMIT_PER_VEHICLE,
  CONSTITUTIONS,
  CONSTITUTION_LABELS,
  MANAGEMENT,
  managementRole,
  personPhotoDocType,
  constitutionFromGst,
  constitutionFromPan,
  isConstitution,
} from '@vop/shared';
import KycPanel from '../../../components/KycPanel';
import ManagementPeople, {
  EMPTY_PERSON,
  type PersonRow,
} from '../../../components/ManagementPeople';
import { lookupIfsc } from '../../../lib/ifsc';
import { LookupProgress } from '../../../components/LookupProgress';
import {
  TeamStructureEditor,
  type ProposerOption,
  type TeamInfo,
} from '../../../components/TeamStructureEditor';
import { explainValidation } from '../../../lib/validation-errors';
import { Icon } from '../../../components/icons';

interface SubCategory {
  key: string;
  name: string;
}
interface Category {
  key: string;
  name: string;
  enhancedDueDiligence: boolean;
  subCategories: SubCategory[];
}
interface Duplicate {
  field: string;
  ref: string;
  legalName: string;
}
interface CreateResult {
  id: string;
  ref: string;
  tier: string;
  riskScore?: number;
  duplicates: Duplicate[];
}
interface PanFields {
  name?: string;
  fatherName?: string;
  category?: string;
  panStatus?: string;
  aadhaarLinked?: boolean;
  aadhaarStatus?: string;
  maskedAadhaar?: string;
  dob?: string;
  gender?: string;
}
interface GstinEntry {
  gstin: string;
  authStatus?: string;
}
interface PanResult {
  verified: boolean;
  name?: string;
  status?: string;
  message?: string;
  fields?: PanFields;
  gstins?: GstinEntry[];
}
interface GstFiling {
  filingYear?: string;
  monthOfFiling?: string;
  methodOfFilling?: string;
  dateOfFiling?: string;
  gstType?: string;
  gstStatus?: string;
}
interface GstDetails {
  gstin: string;
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
  latestFiling?: GstFiling;
  filings?: GstFiling[];
}
interface GstResult {
  verified: boolean;
  gstin: string;
  message?: string;
  details?: GstDetails;
}
interface BankNameMatch {
  score: number;
  matched: boolean;
  matchedAgainst?: string;
  bestName?: string;
}
interface BankDetails {
  accountNumber?: string;
  ifsc?: string;
  active?: boolean;
  activeStatus?: string;
  holderName?: string;
  bankRRN?: string;
  reason?: string;
  message?: string;
}
interface BankResult {
  verified: boolean;
  active?: boolean;
  details?: BankDetails;
  nameMatch?: BankNameMatch;
  message?: string;
}
interface MsmeDetails {
  udyamNumber?: string;
  registrationDate?: string;
  organizationType?: string;
  enterpriseType?: string;
  officialName?: string;
  majorActivity?: string;
}
interface MsmeResult {
  verified: boolean;
  pan: string;
  message?: string;
  details?: MsmeDetails;
}

type PartnerRow = PersonRow;

interface RefRow {
  contactName: string;
  businessName: string;
  registeredAddress: string;
  contactNumber: string;
  email: string;
}
const EMPTY_REF: RefRow = {
  contactName: '',
  businessName: '',
  registeredAddress: '',
  contactNumber: '',
  email: '',
};
const MIN_REFERENCES = 2;
interface RcRow {
  financerName: string;
  rcLimit: string;
  numberOfVehicles: string;
  remarks: string;
}
const EMPTY_RC: RcRow = { financerName: '', rcLimit: '', numberOfVehicles: '', remarks: '' };

// Always show at least the minimum number of reference rows.
const padRefs = (rows: RefRow[]): RefRow[] =>
  rows.length >= MIN_REFERENCES
    ? rows
    : [...rows, ...Array.from({ length: MIN_REFERENCES - rows.length }, () => ({ ...EMPTY_REF }))];

// States and union territories, for the address of a vendor without GST registration.
const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];
/** The registry's gender ("M", "male", "F"…) as a form option, or '' when unknown. */
function panGender(g?: string): string {
  const v = (g ?? '').trim().toLowerCase();
  if (v === 'm' || v === 'male') return 'Male';
  if (v === 'f' || v === 'female') return 'Female';
  if (v === 't' || v === 'o' || v === 'other' || v === 'transgender') return 'Other';
  return '';
}
/** The registry's date of birth (YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY) as YYYY-MM-DD, or ''. */
function panDob(d?: string): string {
  const v = (d ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(v);
  const out = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : '';
  return out && !Number.isNaN(Date.parse(out)) && new Date(out) < new Date() ? out : '';
}
const isIndia = (country: string) => !country.trim() || /^india$/i.test(country.trim());

const initial = {
  references: padRefs([]),
  rcLimits: [] as RcRow[],
  partners: [] as PartnerRow[],
  categoryKey: '',
  subCategoryKey: '',
  legalName: '',
  tradeName: '',
  businessAddress: '',
  addressCountry: 'India',
  addressState: '',
  addressCity: '',
  addressPostalCode: '',
  constitution: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  signatoryName: '',
  signatoryEmail: '',
  signatoryMobile: '',
  signatoryPan: '',
  pan: '',
  gstin: '',
  ifsc: '',
  bankAccount: '',
  bankName: '',
  branch: '',
  businessUnit: '',
  costCentre: '',
  spend: '',
  contractMonths: '',
  natureOfService: '',
  justification: '',
  coiDeclared: false,
  coiDetails: '',
  dataAccess: 'No firm or client data',
  systemAccess: 'None',
  subcontract: 'No',
  delivery: 'Onshore',
  screening: 'Clear',
  conflict: 'No',
  litigation: 'None',
  insurance: 'Adequate',
  certifications: 'None',
  // information security questionnaire ('' = unanswered, 'yes' | 'no')
  isecItHardware: '',
  isecItSoftware: '',
  isecAccessSystem: '',
  isecAccessNetwork: '',
  isecAccessApps: '',
  isecAccessPii: '',
};

// The form is split into steps so no page is a long scroll. Add a step here (and a matching
// `<div hidden={step !== n}>` panel) when more questions are introduced.
const STEPS = [
  { title: 'Vendor & tax' },
  { title: 'Team structure' },
  { title: 'Questionnaire' },
  { title: 'Management & references' },
  { title: 'Digi KYC' },
];

// InfoSec questionnaire — any "yes" routes the case to InfoSec review.
const INFOSEC_QUESTIONS: { key: string; label: string }[] = [
  { key: 'isecItHardware', label: 'Information Technology — Hardware' },
  { key: 'isecItSoftware', label: 'Information Technology — Software' },
  { key: 'isecAccessSystem', label: "Does the entity require access to HFCL's systems?" },
  { key: 'isecAccessNetwork', label: "Does the vendor require access to HFCL's IT network?" },
  { key: 'isecAccessApps', label: "Does the vendor require access to any of HFCL's applications?" },
  {
    key: 'isecAccessPii',
    label:
      "Does the entity require access to HFCL's customer, employee (on/off roll), partner, etc. Personally Identifiable Information (PII)?",
  },
];

export default function NewCase() {
  return (
    <Suspense fallback={<main className="wrap" />}>
      <NewCaseInner />
    </Suspense>
  );
}

function NewCaseInner() {
  const editId = useSearchParams()?.get('id') ?? '';
  const [cats, setCats] = useState<Category[]>([]);
  const [f, setF] = useState({ ...initial });
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // When on, the SPOC details mirror the authorised signatory.
  const [spocSame, setSpocSame] = useState(false);
  // Edit mode (proposer amending a sent-back draft): the PAN was verified earlier, so the form is
  // unlocked without re-verifying, and masked identifiers are left untouched unless re-entered.
  const [panLocked, setPanLocked] = useState(false);
  // Why the case was sent back: one entry per team whose review is waiting on the proposer.
  const [remarks, setRemarks] = useState<{ team: string; note: string; by?: string }[]>([]);
  const editLoaded = useRef(false);

  // --- Draft autosave: the form is saved to the server as a draft case, so it shows up in the case
  // list and can be reopened from there with every detail intact. ---
  // new = blank form · draft = continuing a saved draft · resubmit = amending a sent-back case.
  const [kind, setKind] = useState<'loading' | 'new' | 'draft' | 'resubmit'>(
    editId ? 'loading' : 'new',
  );
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const submittedRef = useRef(false);
  // A reopened draft keeps its GSTIN: choosing a PAN normally clears the GST selection.
  const pendingGstinRef = useRef<string | null>(null);
  // Values whose registry results were restored from a saved draft. While a field still holds its
  // restored value, its lookup is not re-run and its result is not cleared.
  const restoredRef = useRef<{ pan?: string; gstin?: string; bank?: string }>({});
  // The PAN the current PAN result belongs to. MSME is only looked up for that exact PAN.
  const panResultFor = useRef<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const c = await apiFetch<Category[]>('/categories');
      setCats(c);
      setF((prev) => ({ ...prev, categoryKey: prev.categoryKey || (c[0]?.key ?? '') }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load categories.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // Edit mode: pre-fill the form from an existing (sent-back) draft and show the reviewer's remark.
  useEffect(() => {
    if (!editId || editLoaded.current) return;
    editLoaded.current = true;
    void apiFetch<Record<string, unknown>>(`/cases/${editId}`)
      .then((c) => {
        const str = (v: unknown) => (v == null ? '' : String(v));
        const isDraft = c.stage === 'draft';
        // A draft cannot tell "answered No" from "not answered yet", so false stays blank there.
        const bs = (b: boolean) => (b ? 'yes' : isDraft ? '' : 'no');
        const changed = Array.isArray(c.teamOverriddenFields)
          ? (c.teamOverriddenFields as string[])
          : [];
        const savedTeam = (c.teamStructure ?? {}) as Record<string, string>;
        setTeamOv(Object.fromEntries(changed.map((k) => [k, savedTeam[k] ?? ''])));
        const forId = (c.onBehalfOfId as string | null) ?? (c.createdById as string | undefined);
        if (forId) setProposerId(forId);
        setF((prev) => ({
          ...prev,
          categoryKey: str(c.categoryKey),
          subCategoryKey: str(c.subCategoryKey),
          legalName: str(c.legalName),
          constitution: str(c.constitution),
          partners: Array.isArray(c.partners)
            ? (c.partners as Record<string, unknown>[]).map((p) => ({
                name: str(p.name),
                dob: str(p.dob),
                maritalStatus: str(p.maritalStatus),
                gender: str(p.gender),
                fatherName: str(p.fatherName),
                spouseName: str(p.spouseName),
                pan: str(p.pan),
                address: str(p.address),
                mobile: str(p.mobile),
                residencePhone: str(p.residencePhone),
                pincode: str(p.pincode),
                contact: str(p.contact),
                officeAddress: str(p.officeAddress),
              }))
            : [],
          references: padRefs(
            Array.isArray(c.references)
              ? (c.references as Record<string, unknown>[]).map((r) => ({
                  contactName: str(r.contactName),
                  businessName: str(r.businessName),
                  registeredAddress: str(r.registeredAddress),
                  contactNumber: str(r.contactNumber),
                  email: str(r.email),
                }))
              : [],
          ),
          rcLimits: Array.isArray(c.rcLimits)
            ? (c.rcLimits as Record<string, unknown>[]).map((r) => ({
                financerName: str(r.financerName),
                rcLimit: str(r.rcLimit),
                numberOfVehicles: str(r.numberOfVehicles),
                remarks: str(r.remarks),
              }))
            : [],
          tradeName: str(c.tradeName),
          businessAddress: str(c.businessAddress),
          addressCountry: str(c.addressCountry) || 'India',
          addressState: str(c.addressState),
          addressCity: str(c.addressCity),
          addressPostalCode: str(c.addressPostalCode),
          contactName: str(c.contactName),
          contactEmail: str(c.contactEmail),
          contactPhone: str(c.contactPhone),
          signatoryName: str(c.signatoryName),
          signatoryEmail: str(c.signatoryEmail),
          signatoryMobile: str(c.signatoryMobile),
          signatoryPan: str(c.signatoryPan),
          pan: str(c.pan),
          gstin: str(c.gstin),
          ifsc: str(c.ifsc),
          bankAccount: str(c.bankAccount),
          bankName: str(c.bankName),
          branch: str(c.branch),
          businessUnit: str(c.businessUnit),
          costCentre: str(c.costCentre),
          spend: c.spend ? String(c.spend) : '',
          contractMonths: c.contractMonths ? String(c.contractMonths) : '',
          natureOfService: str(c.natureOfService),
          justification: str(c.justification),
          coiDeclared: Boolean(c.coiDeclared),
          coiDetails: str(c.coiDetails),
          isecItHardware: bs(Boolean(c.isecItHardware)),
          isecItSoftware: bs(Boolean(c.isecItSoftware)),
          isecAccessSystem: bs(Boolean(c.isecAccessSystem)),
          isecAccessNetwork: bs(Boolean(c.isecAccessNetwork)),
          isecAccessApps: bs(Boolean(c.isecAccessApps)),
          isecAccessPii: bs(Boolean(c.isecAccessPii)),
        }));
        if (isDraft) {
          setKind('draft');
          draftIdRef.current = editId;
          setDraftId(editId);
          pendingGstinRef.current = str(c.gstin);
          // Show the registry results saved with the draft instead of calling the registries again.
          // Only results captured for the numbers now on the draft are used.
          type Saved = Record<string, unknown> & { current?: boolean };
          const reg = (c.registry ?? {}) as Record<string, Saved | undefined>;
          const cur = (k: string): Saved | undefined => (reg[k]?.current ? reg[k] : undefined);
          const panNow = str(c.pan).trim().toUpperCase();
          const savedPan = cur('pan');
          let restoredPan = false;
          if (savedPan && validatePan(panNow).valid) {
            restoredPan = true;
            restoredRef.current.pan = panNow;
            panResultFor.current = panNow;
            pendingGstinRef.current = null; // the GSTIN on the draft stays selected
            setPanChk({ loading: false, result: savedPan as unknown as PanResult });
            const gstinNow = str(c.gstin);
            const listed = ((savedPan.gstins as { gstin?: string }[] | undefined) ?? []).some(
              (g) => g.gstin === gstinNow,
            );
            if (gstinNow && !listed) setGstOther(true);
            const savedMsme = cur('msme');
            if (savedMsme) {
              msmeFetchedFor.current = panNow; // restored: no need to ask again
              setMsmeChk({
                loading: false,
                result: { ...savedMsme, pan: panNow } as unknown as MsmeResult,
              });
            }
          }
          const savedGst = cur('gst');
          if (savedGst && c.gstin) {
            restoredRef.current.gstin = str(c.gstin);
            setGstChk({ loading: false, result: savedGst as unknown as GstResult });
          }
          const savedBank = cur('bank');
          const acctNow = str(c.bankAccount).replace(/\s+/g, '');
          const ifscNow = str(c.ifsc).trim().toUpperCase();
          if (savedBank && acctNow && ifscNow && !acctNow.includes('\u2022')) {
            restoredRef.current.bank = `${acctNow}|${ifscNow}`;
            setBankChk({ loading: false, result: savedBank as unknown as BankResult });
          }
          // Reopen on the page the proposer was on (later pages need the PAN to be verified).
          if (restoredPan) {
            try {
              const saved = Number(localStorage.getItem(`vop.draft-step.${editId}`));
              if (saved > 0 && saved < STEPS.length) setStep(saved);
            } catch {
              /* storage blocked: start on the first page */
            }
          }
          return;
        }
        setKind('resubmit');
        setPanLocked(true);
        // Each team that sent the case back leaves its remark on its own stage record.
        const TEAMS: [string, string][] = [
          ['infosec', 'InfoSec'],
          ['fcu', 'FCU'],
          ['operation', 'Operation'],
          ['legal', 'Legal'],
          ['l1', 'L1 approver'],
          ['l2', 'L2 approver'],
          ['l3', 'L3 approver'],
        ];
        const stages = (c.stages ?? {}) as Record<
          string,
          { status?: string; remark?: string | null; actionedByName?: string | null } | null
        >;
        const found = TEAMS.flatMap(([key, team]) => {
          const st = stages[key];
          return st?.status === 'sent_back' && st.remark
            ? [{ team, note: st.remark, by: st.actionedByName ?? undefined }]
            : [];
        });
        // Cases sent back before per-team remarks existed: fall back to the activity log.
        const activity = (c.activity as { action: string; note: string | null }[]) ?? [];
        const legacy = [...activity]
          .reverse()
          .find((a) => a.action === 'return' || a.action === 'infosec_returned');
        setRemarks(
          found.length > 0 ? found : legacy?.note ? [{ team: 'Reviewer', note: legacy.note }] : [],
        );
      })
      .catch((err) => {
        setKind('new');
        setError(err instanceof ApiError ? err.message : 'Failed to load the case.');
      });
  }, [editId]);

  const set = (k: keyof typeof initial, v: string | boolean) =>
    setF((prev) => ({ ...prev, [k]: v }));

  // Changing the category resets the dependent sub-category.
  const setCategory = (key: string) =>
    setF((prev) => ({ ...prev, categoryKey: key, subCategoryKey: '' }));

  const selectedCat = cats.find((c) => c.key === f.categoryKey);
  const subs = selectedCat?.subCategories ?? [];

  // Masked values echoed back from the server in edit mode (contain bullets) are left as-is and
  // must not be treated as invalid input.
  const masked = (v: string) => v.includes('•');
  // --- statutory validation (shared validators; same rules run again server-side) ---
  const panErr =
    f.pan && !masked(f.pan) && !validatePan(f.pan).valid ? validatePan(f.pan).errors[0] : null;
  // In edit mode the PAN is masked (••••) for proposers — comparing against it would raise a
  // false "GSTIN does not belong to the vendor PAN" error, so only cross-check a real PAN.
  const gstRes =
    f.gstin && !masked(f.gstin)
      ? validateGstin(f.gstin, f.pan && !masked(f.pan) ? f.pan : undefined)
      : null;
  const gstErr = gstRes && !gstRes.valid ? gstRes.errors[0] : null;
  const ifscErr = f.ifsc && !validateIfsc(f.ifsc).valid ? validateIfsc(f.ifsc).errors[0] : null;
  // --- authorized signatory validation ---
  const sigPanErr =
    f.signatoryPan && !masked(f.signatoryPan) && !validatePan(f.signatoryPan).valid
      ? validatePan(f.signatoryPan).errors[0]
      : null;
  const sigMobileErr =
    f.signatoryMobile && !/^[6-9]\d{9}$/.test(f.signatoryMobile.trim())
      ? 'Enter a valid 10-digit Indian mobile number.'
      : null;
  const sigEmailErr =
    f.signatoryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.signatoryEmail.trim())
      ? 'Enter a valid email address.'
      : null;
  // Keep SPOC in sync with the authorised signatory while "same as" is ticked.
  useEffect(() => {
    if (!spocSame) return;
    setF((prev) => ({
      ...prev,
      contactName: prev.signatoryName,
      contactEmail: prev.signatoryEmail,
      contactPhone: prev.signatoryMobile,
    }));
  }, [spocSame, f.signatoryName, f.signatoryEmail, f.signatoryMobile]);

  // --- InfoSec questionnaire ---
  const isecAnswered = INFOSEC_QUESTIONS.every(
    (q) => (f as unknown as Record<string, string>)[q.key] !== '',
  );
  const infosecWillRoute = INFOSEC_QUESTIONS.some(
    (q) => (f as unknown as Record<string, string>)[q.key] === 'yes',
  );

  // --- IFSC -> bank/branch via Razorpay, when the IFSC is well-formed ---
  const [ifscBusy, setIfscBusy] = useState(false);
  const [ifscNote, setIfscNote] = useState<string | null>(null);
  useEffect(() => {
    const code = f.ifsc.trim().toUpperCase();
    if (!validateIfsc(code).valid) {
      setIfscNote(null);
      return;
    }
    let cancelled = false;
    setIfscBusy(true);
    setIfscNote(null);
    void lookupIfsc(code).then((d) => {
      if (cancelled) return;
      setIfscBusy(false);
      if (d) {
        setF((prev) => ({ ...prev, bankName: d.bank, branch: d.branch }));
        setIfscNote(`Bank details fetched from Razorpay for ${code}.`);
      } else {
        setIfscNote('No bank found for this IFSC. Enter the bank and branch manually.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [f.ifsc]);

  // --- PAN -> registry verification (EY Nexus), auto when the PAN format is correct ---
  const [panChk, setPanChk] = useState<{ loading: boolean; result: PanResult | null }>({
    loading: false,
    result: null,
  });
  const [gstOther, setGstOther] = useState(false); // "Other" chosen -> manual GST entry
  const gstList = panChk.result?.gstins ?? [];
  // The PAN gates the rest of the form: nothing below it shows until the PAN is verified. In edit
  // mode the PAN was already verified when the case was raised, so the form is unlocked.
  const panVerified = panChk.result?.verified === true || panLocked;
  // The PAN has no GST registration: the address can't come from the GST registry, so ask for it.
  const noGst =
    panVerified &&
    !panChk.loading &&
    !gstOther &&
    (panLocked ? !f.gstin.trim() : gstList.length === 0);
  // --- GST -> full registry profile (EY serviceTypeId 30), on an explicit "Verify" click ---
  const [gstChk, setGstChk] = useState<{ loading: boolean; result: GstResult | null }>({
    loading: false,
    result: null,
  });
  // Drop any fetched profile when the selected GSTIN changes.
  useEffect(() => {
    if (restoredRef.current.gstin !== undefined) {
      if (restoredRef.current.gstin === f.gstin) return; // restored result, still current
      restoredRef.current.gstin = undefined;
    }
    setGstChk({ loading: false, result: null });
  }, [f.gstin]);

  const verifyGst = useCallback(() => {
    const g = f.gstin.trim().toUpperCase();
    if (!/^[0-9A-Z]{15}$/.test(g)) {
      setGstChk({
        loading: false,
        result: {
          verified: false,
          gstin: g,
          message: 'Select or enter a valid 15-character GSTIN.',
        },
      });
      return;
    }
    setGstChk({ loading: true, result: null });
    void apiFetch<GstResult>('/verification/gst', {
      method: 'POST',
      body: JSON.stringify({ gstin: g }),
    })
      .then((r) => {
        setGstChk({ loading: false, result: r });
        // The legal/trade name fields are not shown; take the authoritative names from the GST
        // registry so the case carries the correct vendor identity.
        if (r.verified && r.details) {
          const addr = [
            r.details.principalAddress,
            [r.details.city, r.details.state, r.details.pincode].filter(Boolean).join(', '),
          ]
            .filter(Boolean)
            .join(' — ');
          setF((prev) => ({
            ...prev,
            legalName: r.details?.legalName || prev.legalName,
            tradeName: r.details?.tradeName || prev.tradeName,
            businessAddress: addr || prev.businessAddress,
            addressCountry: 'India',
            addressState: r.details?.state || prev.addressState,
            addressCity: r.details?.city || prev.addressCity,
            addressPostalCode: r.details?.pincode || prev.addressPostalCode,
          }));
        }
      })
      .catch((e) =>
        setGstChk({
          loading: false,
          result: {
            verified: false,
            gstin: g,
            message: e instanceof Error ? e.message : 'Failed.',
          },
        }),
      );
  }, [f.gstin]);

  // --- MSME / Udyam lookup against the PAN (EY serviceTypeId 92), on an explicit "Verify" click ---
  const [msmeChk, setMsmeChk] = useState<{ loading: boolean; result: MsmeResult | null }>({
    loading: false,
    result: null,
  });
  // Tracks the PAN we've already auto-fetched MSME for, so a re-render never re-fetches (which
  // would briefly clear the panel) or clobbers a good result if a retry fails.
  const msmeFetchedFor = useRef<string | null>(null);
  // Drop any fetched MSME profile when the PAN changes.
  useEffect(() => {
    if (
      restoredRef.current.pan !== undefined &&
      restoredRef.current.pan === f.pan.trim().toUpperCase()
    ) {
      return; // restored result, still current
    }
    setMsmeChk({ loading: false, result: null });
    msmeFetchedFor.current = null;
  }, [f.pan]);

  const verifyMsme = useCallback(() => {
    const p = f.pan.trim().toUpperCase();
    if (!validatePan(p).valid) {
      setMsmeChk({
        loading: false,
        result: { verified: false, pan: p, message: 'Enter a valid PAN first.' },
      });
      return;
    }
    setMsmeChk({ loading: true, result: null });
    void apiFetch<MsmeResult>('/verification/msme', {
      method: 'POST',
      body: JSON.stringify({ pan: p }),
    })
      .then((r) => setMsmeChk({ loading: false, result: r }))
      .catch((e) =>
        setMsmeChk({
          loading: false,
          result: { verified: false, pan: p, message: e instanceof Error ? e.message : 'Failed.' },
        }),
      );
  }, [f.pan]);

  // Fetch MSME automatically ONLY after the PAN is successfully verified — one less button for the
  // user to find. If the PAN lookup is still running, errored, or returned no record, the MSME API
  // (and the PAN→GST list, which the server gates the same way) is never called. The ref guard
  // ensures exactly one fetch per verified PAN, so later re-renders never clear or re-request it.
  useEffect(() => {
    const p = f.pan.trim().toUpperCase();
    if (!panVerified || panChk.loading || panErr) return;
    // In edit mode the PAN comes back masked — don't auto-fetch MSME against a masked value.
    if (!validatePan(p).valid) return;
    if (msmeFetchedFor.current === p) return;
    // The verified result on screen may still be for the previous PAN while the new one is checked.
    if (panResultFor.current !== p) return;
    msmeFetchedFor.current = p;
    verifyMsme();
  }, [panVerified, panChk.loading, panErr, f.pan, verifyMsme]);

  // --- Bank account -> penny-less verification (EY serviceTypeId 27) + holder-name match ---
  const [bankChk, setBankChk] = useState<{ loading: boolean; result: BankResult | null }>({
    loading: false,
    result: null,
  });
  // Drop any fetched profile when the account or IFSC changes.
  useEffect(() => {
    const key = `${f.bankAccount.replace(/\s+/g, '')}|${f.ifsc.trim().toUpperCase()}`;
    if (restoredRef.current.bank !== undefined) {
      if (restoredRef.current.bank === key) return; // restored result, still current
      restoredRef.current.bank = undefined;
    }
    setBankChk({ loading: false, result: null });
  }, [f.bankAccount, f.ifsc]);

  const verifyBank = useCallback(() => {
    const acct = f.bankAccount.replace(/\s+/g, '');
    const ifsc = f.ifsc.trim().toUpperCase();
    if (!/^\d{5,20}$/.test(acct) || !validateIfsc(ifsc).valid) {
      setBankChk({
        loading: false,
        result: { verified: false, message: 'Enter a valid account number and IFSC first.' },
      });
      return;
    }
    setBankChk({ loading: true, result: null });
    void apiFetch<BankResult>('/verification/bank', {
      method: 'POST',
      body: JSON.stringify({
        accountNumber: acct,
        ifsc,
        // Names the holder is matched against (≥80% required).
        panName: panChk.result?.fields?.name,
        legalName: gstChk.result?.details?.legalName ?? f.legalName,
        tradeName: gstChk.result?.details?.tradeName ?? f.tradeName,
      }),
    })
      .then((r) => setBankChk({ loading: false, result: r }))
      .catch((e) =>
        setBankChk({
          loading: false,
          result: { verified: false, message: e instanceof Error ? e.message : 'Failed.' },
        }),
      );
  }, [
    f.bankAccount,
    f.ifsc,
    f.legalName,
    f.tradeName,
    panChk.result?.fields?.name,
    gstChk.result?.details?.legalName,
    gstChk.result?.details?.tradeName,
  ]);
  useEffect(() => {
    const p = f.pan.trim().toUpperCase();
    if (!validatePan(p).valid) {
      setPanChk({ loading: false, result: null });
      return;
    }
    if (restoredRef.current.pan !== undefined) {
      if (restoredRef.current.pan === p) return; // restored from the draft: no new lookup
      restoredRef.current.pan = undefined;
    }
    let cancelled = false;
    setPanChk({ loading: true, result: null });
    // New PAN -> reset any previous GST selection; the list is re-fetched for this PAN.
    setGstOther(false);
    setF((prev) => ({ ...prev, gstin: pendingGstinRef.current ?? '' }));
    pendingGstinRef.current = null;
    const timer = setTimeout(() => {
      void apiFetch<PanResult>('/verification/pan', {
        method: 'POST',
        body: JSON.stringify({ pan: p }),
      })
        .then((r) => {
          if (cancelled) return;
          panResultFor.current = p;
          setPanChk({ loading: false, result: r });
          // Pre-fill legal name from the registry when the proposer hasn't typed one.
          if (r.name) setF((prev) => (prev.legalName ? prev : { ...prev, legalName: r.name! }));
        })
        .catch((e) => {
          if (!cancelled)
            setPanChk({
              loading: false,
              result: { verified: false, message: e instanceof Error ? e.message : 'Failed.' },
            });
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [f.pan]);

  // Changes the proposer made to their team structure for this case (field -> value).
  const [teamOv, setTeamOv] = useState<Record<string, string>>({});
  const teamOvRef = useRef(teamOv);
  teamOvRef.current = teamOv;

  // Team structure comes from a master table, looked up for the signed-in proposer.
  const [teamInfo, setTeamInfo] = useState<TeamInfo | null>(null);
  // Who the case is for. Empty = the signed-in person; another proposer = raising on their behalf.
  const [proposerId, setProposerId] = useState('');
  const proposerIdRef = useRef(proposerId);
  proposerIdRef.current = proposerId;
  const [proposers, setProposers] = useState<ProposerOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void apiFetch<ProposerOption[]>('/team-structure/proposers')
      .then((r) => {
        if (!cancelled) setProposers(r);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setTeamInfo(null);
    const q = proposerId ? `?proposerId=${encodeURIComponent(proposerId)}` : '';
    void apiFetch<TeamInfo>(`/team-structure/me${q}`)
      .then((r) => {
        if (cancelled) return;
        setTeamInfo(r);
        // Show the proposer's real id in the dropdown, even for "me".
        if (!proposerId && r.proposer) setProposerId(r.proposer.id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [proposerId]);

  const fRef = useRef(f);
  fRef.current = f;

  const draftBody = useCallback(() => {
    const cur = fRef.current as unknown as Record<string, unknown>;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cur)) {
      if (k === 'partners' || k.startsWith('isec')) continue;
      if (k === 'spend' || k === 'contractMonths') {
        if (v) body[k] = Number(v);
        continue;
      }
      // A masked value (••••) is display-only; leaving it out keeps the stored value untouched.
      if (typeof v === 'string' && v.includes('•')) continue;
      body[k] = v;
    }
    for (const q of INFOSEC_QUESTIONS) body[q.key] = cur[q.key] === 'yes';
    body.partners = cur.partners;
    body.references = cur.references;
    body.teamOverrides = teamOvRef.current;
    if (proposerIdRef.current) body.proposerId = proposerIdRef.current;
    body.rcLimits = (cur.rcLimits as RcRow[]).map((r) => ({
      financerName: r.financerName,
      rcLimit: r.rcLimit === '' ? null : Number(r.rcLimit),
      numberOfVehicles: r.numberOfVehicles === '' ? null : Number(r.numberOfVehicles),
      remarks: r.remarks,
    }));
    return body;
  }, []);

  // Single-flight save: edits made while a save is running are sent right after it, in order.
  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (submittedRef.current || !fRef.current.categoryKey) return false;
    if (savingRef.current) {
      dirtyRef.current = true;
      return true;
    }
    savingRef.current = true;
    setDraftSaving(true);
    try {
      do {
        dirtyRef.current = false;
        const body = JSON.stringify(draftBody());
        if (!draftIdRef.current) {
          const r = await apiFetch<{ id: string }>('/cases/drafts', { method: 'POST', body });
          draftIdRef.current = r.id;
          setDraftId(r.id);
        } else {
          await apiFetch(`/cases/${draftIdRef.current}/draft`, { method: 'PUT', body });
        }
        setDraftSavedAt(new Date());
        setDraftError(null);
      } while (dirtyRef.current && !submittedRef.current);
      return true;
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Could not save the draft.');
      return false;
    } finally {
      savingRef.current = false;
      setDraftSaving(false);
    }
  }, [draftBody]);

  // Autosave about a second after the proposer stops typing, once there is something to keep.
  useEffect(() => {
    if (kind === 'loading' || kind === 'resubmit' || result || submittedRef.current) return;
    if (!f.categoryKey) return;
    const initialMap = initial as Record<string, unknown>;
    const hasContent = Object.entries(f).some(([k, v]) =>
      k === 'categoryKey'
        ? false
        : Array.isArray(v)
          ? v.some((row) =>
              Object.values(row as unknown as Record<string, string>).some((x) => String(x).trim()),
            )
          : v !== initialMap[k],
    );
    if (!hasContent && !draftIdRef.current) return;
    const t = setTimeout(() => void flushDraft(), 1000);
    return () => clearTimeout(t);
  }, [kind, f, spocSame, teamOv, proposerId, result, flushDraft]);

  async function discardDraft() {
    const id = draftIdRef.current;
    if (!id) {
      router.push('/cases');
      return;
    }
    if (!window.confirm('Discard this draft? It will be removed from your cases.')) return;
    submittedRef.current = true; // stop autosave from recreating it
    try {
      await apiFetch(`/cases/${id}/draft`, { method: 'DELETE' });
      router.push('/cases');
    } catch (err) {
      submittedRef.current = false;
      setError(err instanceof Error ? err.message : 'Could not discard the draft.');
    }
  }

  // --- Management structure: proprietor / partners / directors / Karta, by constitution ---
  const mgmtRole = managementRole(f.constitution);
  const photoDocType = mgmtRole && MANAGEMENT[mgmtRole].photo ? personPhotoDocType(mgmtRole) : null;
  // Type of constitution: taken from the GST registration when the vendor has one (not editable);
  // otherwise the proposer selects it on page 1, pre-selected from the PAN's holder category.
  const gstConstitution = gstChk.result?.details?.constitutionOfBusiness;
  const hasGst = !!f.gstin.trim() && !noGst;
  const gstFetchFailed = !!gstChk.result && !gstChk.result.verified;
  const constitutionEditable = panVerified && !gstConstitution && (!hasGst || gstFetchFailed);
  const panSuggestion = constitutionFromPan(f.pan);
  // The PAN the last pre-selection was made for, and the value it picked.
  const lastAuto = useRef<{ pan?: string; value?: string }>({});
  useEffect(() => {
    if (gstConstitution) {
      const v = constitutionFromGst(gstConstitution);
      if (f.constitution !== v) setConstitution(v);
      return;
    }
    if (!panVerified || lastAuto.current.pan === f.pan) return;
    const prevAuto = lastAuto.current.value;
    lastAuto.current = { pan: f.pan, value: panSuggestion?.value };
    // Keep a choice the proposer made (or a restored draft's); replace only an earlier pre-selection.
    if (panSuggestion && (!f.constitution || f.constitution === prevAuto)) {
      setConstitution(panSuggestion.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gstConstitution, panVerified, f.pan, f.constitution, panSuggestion?.value]);
  function setConstitution(value: string) {
    setF((prev) => {
      const role = managementRole(value);
      // A proprietor or Karta is one person: keep the first row (or start one).
      const partners = !role
        ? []
        : MANAGEMENT[role].single
          ? [prev.partners[0] ?? { ...EMPTY_PERSON }]
          : prev.partners;
      return { ...prev, constitution: value, partners };
    });
  }
  // A sole proprietor is the PAN holder: fill the proprietor's name, father's name, gender, date of
  // birth and PAN from the verified PAN. A value the registry doesn't return stays blank, and only
  // empty fields are filled, so anything the proposer typed or a restored draft holds is kept.
  const panFields = panChk.result?.verified ? panChk.result.fields : undefined;
  const panName = panFields?.name ?? panChk.result?.name;
  useEffect(() => {
    if (mgmtRole !== 'proprietor' || !panChk.result?.verified) return;
    const pan = f.pan.includes('•') ? '' : f.pan.trim().toUpperCase();
    const fromPan: Partial<PartnerRow> = {
      name: panName ?? '',
      fatherName: panFields?.fatherName?.trim() ?? '',
      gender: panGender(panFields?.gender),
      dob: panDob(panFields?.dob),
      pan,
    };
    setF((prev) => {
      const row = prev.partners[0] ?? { ...EMPTY_PERSON };
      const patch: Partial<PartnerRow> = {};
      for (const [k, v] of Object.entries(fromPan) as [keyof PartnerRow, string][]) {
        if (v && !row[k].trim()) patch[k] = v;
      }
      if (Object.keys(patch).length === 0) return prev;
      return { ...prev, partners: [{ ...row, ...patch }, ...prev.partners.slice(1)] };
    });
  }, [
    mgmtRole,
    panChk.result,
    panName,
    panFields?.fatherName,
    panFields?.gender,
    panFields?.dob,
    f.pan,
  ]);

  // The photograph (Karta of an HUF) is uploaded to the draft and malware-scanned by the API.
  const [photo, setPhoto] = useState<{ name?: string; busy: boolean; error?: string }>({
    busy: false,
  });
  useEffect(() => {
    if (!draftId || !photoDocType) return;
    let cancelled = false;
    void apiFetch<{ docType: string; filename: string }[]>(`/cases/${draftId}/documents`)
      .then((docs) => {
        const d = docs.filter((x) => x.docType === photoDocType).pop();
        if (!cancelled && d) setPhoto((p) => ({ ...p, name: d.filename }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draftId, photoDocType]);
  async function uploadPhoto(file: File) {
    if (!photoDocType) return;
    setPhoto((p) => ({ ...p, busy: true, error: undefined }));
    try {
      // The photo belongs to the case, so the draft is saved first.
      if (!draftIdRef.current) await flushDraft();
      const id = draftIdRef.current;
      if (!id) throw new Error('Save the draft first (choose a vendor category).');
      const form = new FormData();
      form.append('file', file);
      form.append('docType', photoDocType);
      await apiUpload(`/cases/${id}/documents`, form);
      setPhoto({ name: file.name, busy: false });
    } catch (err) {
      setPhoto((p) => ({
        ...p,
        busy: false,
        error: err instanceof Error ? err.message : 'Upload failed.',
      }));
    }
  }

  function addPartner() {
    setF((prev) => ({ ...prev, partners: [...prev.partners, { ...EMPTY_PERSON }] }));
  }
  function removePartner(i: number) {
    setF((prev) => ({ ...prev, partners: prev.partners.filter((_, j) => j !== i) }));
  }
  function setPartner(i: number, patch: Partial<PartnerRow>) {
    setF((prev) => {
      // The single proprietor / Karta form shows an empty person before any row exists.
      const rows =
        i < prev.partners.length ? prev.partners : [...prev.partners, { ...EMPTY_PERSON }];
      return { ...prev, partners: rows.map((p, j) => (j === i ? { ...p, ...patch } : p)) };
    });
  }

  // --- References (at least two) ---
  function addReference() {
    setF((prev) => ({ ...prev, references: [...prev.references, { ...EMPTY_REF }] }));
  }
  function removeReference(i: number) {
    setF((prev) =>
      prev.references.length <= MIN_REFERENCES
        ? prev
        : { ...prev, references: prev.references.filter((_, j) => j !== i) },
    );
  }
  function setReference(i: number, patch: Partial<RefRow>) {
    setF((prev) => ({
      ...prev,
      references: prev.references.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  }

  // --- RC limits (optional) ---
  function addRcLimit() {
    setF((prev) => ({ ...prev, rcLimits: [...prev.rcLimits, { ...EMPTY_RC }] }));
  }
  function removeRcLimit(i: number) {
    setF((prev) => ({ ...prev, rcLimits: prev.rcLimits.filter((_, j) => j !== i) }));
  }
  function setRcLimit(i: number, patch: Partial<RcRow>) {
    setF((prev) => ({
      ...prev,
      rcLimits: prev.rcLimits.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    }));
  }

  // --- Multi-step form ---
  const [step, setStep] = useState(0);
  // Digi KYC (last step) runs on the saved case: the draft, or the case being amended.
  const kycCaseId = editId || draftId;
  useEffect(() => {
    if (step === 4 && !kycCaseId && kind !== 'resubmit') void flushDraft();
  }, [step, kycCaseId, kind, flushDraft]);

  // Remember the page per draft, so reopening a draft returns to it.
  useEffect(() => {
    if (!draftId) return;
    try {
      localStorage.setItem(`vop.draft-step.${draftId}`, String(step));
    } catch {
      /* storage blocked: the draft reopens on the first page */
    }
  }, [draftId, step]);
  const formRef = useRef<HTMLFormElement>(null);

  // Problems that must be fixed before leaving a step (beyond the browser's own required checks).
  function stepProblem(n: number): string | null {
    if (n === 0) {
      if (!panVerified) return "Enter and verify the vendor's PAN before continuing.";
      if (panErr || gstErr || ifscErr) {
        return 'Fix the highlighted PAN / GST / IFSC fields before continuing.';
      }
      if (gstList.length > 0 && !f.gstin.trim()) {
        return "Select the vendor's GSTIN, or choose Other to enter one.";
      }
      if (!f.constitution) {
        return hasGst && !constitutionEditable
          ? 'Fetch the GST details to fill in the type of constitution.'
          : 'Select the type of constitution.';
      }
    }
    if (n === 2) {
      if (sigPanErr || sigMobileErr || sigEmailErr) {
        return 'Fix the highlighted signatory fields before continuing.';
      }
      if (!isecAnswered) return 'Answer all Information security questions before continuing.';
    }
    return null;
  }

  // Moving forward validates the step being left, so errors surface where the field is.
  function goTo(target: number) {
    if (target > step) {
      const problem = stepProblem(step);
      if (problem) {
        setError(problem);
        return;
      }
      const sel = `[data-step="${step}"]`;
      const fields = formRef.current?.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >(`${sel} input, ${sel} select, ${sel} textarea`);
      const bad = Array.from(fields ?? []).find((el) => !el.checkValidity());
      if (bad) {
        bad.reportValidity();
        return;
      }
    }
    setError(null);
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const draftControls = kind !== 'resubmit' && (
    <>
      <button
        className="btn btn--ghost"
        type="button"
        disabled={busy || draftSaving}
        onClick={() => void flushDraft()}
      >
        {draftSaving ? 'Saving…' : 'Save draft'}
      </button>
      {draftId && (
        <button
          className="btn btn--ghost"
          type="button"
          disabled={busy}
          onClick={() => void discardDraft()}
        >
          Discard draft
        </button>
      )}
      <span className={draftError ? 'error tiny' : 'muted tiny'} role="status" aria-live="polite">
        {draftError
          ? `Couldn't save the draft: ${draftError}`
          : draftSavedAt
            ? `Draft saved ${draftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · find it in Cases · autosaves as you type`
            : 'Autosaves as you type and appears in your case list'}
      </span>
    </>
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (panErr || gstErr || ifscErr || sigPanErr || sigMobileErr || sigEmailErr) {
      setError('Fix the highlighted PAN / GST / IFSC / signatory fields before submitting.');
      return;
    }
    if (!isecAnswered) {
      setError('Answer all Information security questions before submitting.');
      return;
    }
    if (f.references.length < MIN_REFERENCES) {
      setError('Add at least two references before submitting.');
      return;
    }
    if (!f.constitution) {
      setError('Select the type of constitution on the Vendor & tax page.');
      setStep(0);
      return;
    }
    if (mgmtRole && photoDocType && !photo.name) {
      setError(`Upload the photograph of the ${MANAGEMENT[mgmtRole].noun}.`);
      setStep(3);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...f };
      // Only the fields asked for this constitution are sent (e.g. no mobile for a proprietor).
      const asked = mgmtRole ? MANAGEMENT[mgmtRole].fields : [];
      payload.partners = (mgmtRole ? f.partners : []).map((p) => {
        const row: Record<string, string> = {};
        for (const k of asked) {
          const v = k === 'pan' ? p.pan.trim().toUpperCase() : p[k].trim();
          if (k === 'spouseName' && p.maritalStatus !== 'Married') continue;
          if (v) row[k] = v;
        }
        return row;
      });
      payload.teamOverrides = teamOv;
      if (proposerId) payload.proposerId = proposerId;
      payload.references = f.references.map((r) => ({
        contactName: r.contactName.trim(),
        businessName: r.businessName.trim(),
        registeredAddress: r.registeredAddress.trim(),
        contactNumber: r.contactNumber.trim(),
        email: r.email.trim(),
      }));
      payload.rcLimits = (categoryHasRcLimits(f.categoryKey) ? f.rcLimits : []).map((r) => ({
        financerName: r.financerName.trim(),
        rcLimit: Number(r.rcLimit),
        numberOfVehicles: Number(r.numberOfVehicles),
        ...(r.remarks.trim() ? { remarks: r.remarks.trim() } : {}),
      }));
      payload.spend = f.spend ? Number(f.spend) : undefined;
      payload.contractMonths = f.contractMonths ? Number(f.contractMonths) : undefined;
      for (const k of [
        'tradeName',
        'businessAddress',
        'addressState',
        'addressCity',
        'addressPostalCode',
        'contactName',
        'contactEmail',
        'contactPhone',
        'signatoryName',
        'signatoryEmail',
        'signatoryMobile',
        'signatoryPan',
        'pan',
        'gstin',
        'ifsc',
        'bankAccount',
        'bankName',
        'branch',
        'businessUnit',
        'costCentre',
        'natureOfService',
        'coiDetails',
        'subCategoryKey',
      ])
        if (!payload[k]) delete payload[k];
      // Masked values (••••) are display-only. Sending them back would be rejected as an invalid
      // PAN; leaving them out keeps the stored encrypted value untouched.
      for (const k of ['pan', 'bankAccount', 'signatoryPan']) {
        const v = payload[k];
        if (typeof v === 'string' && v.includes('•')) delete payload[k];
      }
      // Convert the InfoSec questionnaire answers to booleans the API expects.
      for (const q of INFOSEC_QUESTIONS)
        payload[q.key] = (f as unknown as Record<string, string>)[q.key] === 'yes';
      // Stop autosave and let any save in flight finish, so a stale save cannot land after submit.
      submittedRef.current = true;
      for (let i = 0; i < 100 && savingRef.current; i++)
        await new Promise((r) => setTimeout(r, 50));
      const target = editId || draftIdRef.current;
      const res = target
        ? await apiFetch<CreateResult>(`/cases/${target}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiFetch<CreateResult>('/cases', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setResult({ ...res, duplicates: res.duplicates ?? [] });
    } catch (err) {
      submittedRef.current = false; // let autosave resume so edits are not lost
      // Field errors from the server are shown as plain lines, on the page that holds the problem.
      const friendly =
        err instanceof ApiError && err.status === 400 ? explainValidation(err.message) : null;
      if (friendly) {
        setError(friendly.text);
        setStep(friendly.step);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(err instanceof Error ? err.message : 'Submit failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main className="wrap narrow">
        <h1>{kind === 'resubmit' ? 'Case updated & resubmitted' : 'Case raised'}</h1>
        <p className="lead">
          <strong>{result.ref}</strong> · risk tier <span className="pill">{result.tier}</span>
          {result.riskScore != null && <> (score {result.riskScore})</>}
        </p>
        {result.duplicates.length > 0 && (
          <div className="card">
            <strong>Possible duplicates ({result.duplicates.length})</strong>
            <ul>
              {result.duplicates.map((d, i) => (
                <li key={i}>
                  {d.field} matches <code>{d.ref}</code> · {d.legalName}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="req__actions">
          <Link className="btn" href={`/cases/${result.id}`}>
            Open case
          </Link>
          <Link className="btn btn--ghost" href="/cases">
            All cases
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="wrap">
      <p className="crumbs">
        <Link href="/cases">Cases</Link>
      </p>
      <h1>
        {kind === 'resubmit'
          ? 'Edit & resubmit case'
          : kind === 'draft'
            ? 'Continue your draft'
            : 'Raise a vendor onboarding case'}
      </h1>
      <p className="lead">
        {kind === 'resubmit'
          ? 'Amend the details below and resubmit. The case is re-tiered and re-routed on submit.'
          : kind === 'draft'
            ? 'Pick up where you left off. Your changes save automatically; raise the case when it is complete.'
            : 'Enter the vendor details on their behalf. The risk tier is computed on submit.'}
      </p>
      {remarks.length > 0 && (
        <div className="rv-alert rv-alert--warn" role="status">
          <Icon name="undo" size={18} />
          <div>
            <strong>Sent back for changes</strong>
            <ul className="rv-remarks">
              {remarks.map((r) => (
                <li key={r.team}>
                  <strong>
                    {r.team}
                    {r.by ? ` (${r.by})` : ''}:
                  </strong>{' '}
                  {r.note}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert" style={{ whiteSpace: 'pre-line' }}>
          {error}
        </p>
      )}

      <p className="step-label" aria-live="polite">
        Step {step + 1} of {STEPS.length} · <strong>{STEPS[step].title}</strong>
      </p>

      <form
        ref={formRef}
        onSubmit={submit}
        onKeyDown={(e) => {
          // Enter in a text box must advance the step, not submit a half-filled case.
          if (
            e.key === 'Enter' &&
            step < STEPS.length - 1 &&
            (e.target as HTMLElement).tagName === 'INPUT'
          ) {
            e.preventDefault();
            goTo(step + 1);
          }
        }}
      >
        <div data-step="0" hidden={step !== 0}>
          <section className="card">
            <h2>Vendor</h2>
            <div className="grid2">
              <label>
                Vendor category
                <select
                  value={f.categoryKey}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                >
                  {cats.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sub vendor category
                <select
                  value={f.subCategoryKey}
                  onChange={(e) => set('subCategoryKey', e.target.value)}
                  disabled={subs.length === 0}
                >
                  <option value="">
                    {subs.length === 0 ? 'None for this category' : 'Select a sub-category…'}
                  </option>
                  {subs.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Tax identifiers</h2>
            <p className="section-intro">
              Enter the PAN — its registry details and any MSME / Udyam registration load
              automatically. Then pick a GSTIN and fetch its details to add GST information.
            </p>
            <div className="grid2">
              <label>
                PAN No.
                <input
                  value={f.pan}
                  onChange={(e) => set('pan', e.target.value.toUpperCase())}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  readOnly={panLocked}
                  className={panErr ? 'is-invalid' : ''}
                />
                {panLocked ? (
                  <span className="field-ok">PAN verified when this case was raised.</span>
                ) : panErr ? (
                  <span className="field-err">{panErr}</span>
                ) : panChk.loading ? (
                  <LookupProgress
                    label="Checking the PAN with the income-tax registry"
                    steps={[
                      'Connecting to the income-tax registry…',
                      'Fetching PAN holder details…',
                      'Checking PAN–Aadhaar link status…',
                      'Looking up GSTINs linked to this PAN…',
                      'Almost done…',
                    ]}
                  />
                ) : panChk.result?.verified ? (
                  <span className="field-ok">
                    Verified{panChk.result.name ? `: ${panChk.result.name}` : ''}
                    {panChk.result.status ? ` (${panChk.result.status})` : ''}
                  </span>
                ) : panChk.result?.message ? (
                  <span className="field-hint">{panChk.result.message}</span>
                ) : (
                  <span className="field-cap">
                    Checked automatically against the income-tax registry.
                  </span>
                )}
                {panVerified && msmeChk.loading ? (
                  <span className="field-cap">Checking MSME / Udyam registration…</span>
                ) : panVerified && msmeChk.result && !msmeChk.result.verified ? (
                  <span className="field-cap">
                    {msmeChk.result.message ?? 'No MSME / Udyam registration for this PAN.'}
                  </span>
                ) : null}
              </label>
              {panVerified && panLocked && (
                <label>
                  GST No.
                  <input
                    value={f.gstin}
                    onChange={(e) => set('gstin', e.target.value.toUpperCase())}
                    placeholder="27ABCDE1234F1Z5"
                    maxLength={15}
                    className={gstErr ? 'is-invalid' : ''}
                  />
                  {gstErr ? (
                    <span className="field-err">{gstErr}</span>
                  ) : (
                    <span className="field-cap">
                      Edit the GSTIN if needed, then fetch its details.
                    </span>
                  )}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={verifyGst}
                      disabled={
                        gstChk.loading || !/^[0-9A-Z]{15}$/.test(f.gstin.trim().toUpperCase())
                      }
                    >
                      {gstChk.loading ? 'Fetching GST details…' : 'Fetch GST details'}
                    </button>
                    {gstChk.result && !gstChk.result.verified && gstChk.result.message ? (
                      <span className="field-hint">{gstChk.result.message}</span>
                    ) : null}
                  </div>
                </label>
              )}
              {panVerified && !panLocked && (
                <label>
                  GST No.
                  <select
                    value={gstOther ? '__other__' : f.gstin}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__other__') {
                        setGstOther(true);
                        set('gstin', '');
                      } else {
                        setGstOther(false);
                        set('gstin', v);
                      }
                    }}
                  >
                    <option value="">
                      {panChk.loading
                        ? 'Fetching GSTINs…'
                        : gstList.length
                          ? 'Select GSTIN…'
                          : 'No GSTINs found for this PAN'}
                    </option>
                    {gstList.map((g) => (
                      <option key={g.gstin} value={g.gstin}>
                        {g.gstin}
                        {g.authStatus ? ` (${g.authStatus})` : ''}
                      </option>
                    ))}
                    <option value="__other__">Other (enter manually)</option>
                  </select>
                  {gstOther && (
                    <input
                      value={f.gstin}
                      onChange={(e) => set('gstin', e.target.value.toUpperCase())}
                      placeholder="27ABCDE1234F1Z5"
                      maxLength={15}
                      className={gstErr ? 'is-invalid' : ''}
                      style={{ marginTop: 6 }}
                    />
                  )}
                  {gstErr ? (
                    <span className="field-err">{gstErr}</span>
                  ) : gstRes?.valid && f.pan ? (
                    <span className="field-ok">GSTIN valid and matches PAN.</span>
                  ) : (
                    <span className="field-cap">
                      GSTINs linked to the PAN load automatically. Pick one (or add another), then
                      fetch its registration details.
                    </span>
                  )}
                  <div className="row-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={verifyGst}
                      disabled={
                        gstChk.loading || !/^[0-9A-Z]{15}$/.test(f.gstin.trim().toUpperCase())
                      }
                    >
                      {gstChk.loading ? 'Fetching GST details…' : 'Fetch GST details'}
                    </button>
                    {gstChk.result && !gstChk.result.verified && gstChk.result.message ? (
                      <span className="field-hint">{gstChk.result.message}</span>
                    ) : null}
                  </div>
                </label>
              )}

              {/* With a GST registration the type comes from the GST details below; only a vendor
                  without one (or whose GST lookup failed) has it selected here. */}
              {constitutionEditable && (
                <label className="span2">
                  Type of constitution
                  <select
                    value={f.constitution}
                    required
                    onChange={(e) => setConstitution(e.target.value)}
                  >
                    <option value="">Select</option>
                    {CONSTITUTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONSTITUTION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    {panSuggestion && f.constitution === panSuggestion.value
                      ? (panSuggestion.note ?? 'Selected from the PAN.') + ' Change it if needed.'
                      : "Select the vendor's type of constitution."}
                  </span>
                </label>
              )}

              {noGst && (
                <fieldset className="span2 noGst">
                  <legend>Vendor address</legend>
                  <p className="field-cap noGst__note">
                    This PAN has no GST registration, so the address can&apos;t be fetched. Enter it
                    as on the vendor&apos;s records.
                  </p>
                  <div className="grid2">
                    <label className="span2">
                      Legal name
                      <input
                        required
                        maxLength={200}
                        value={f.legalName}
                        onChange={(e) => set('legalName', e.target.value)}
                        autoComplete="organization"
                      />
                    </label>
                    <label className="span2">
                      Full address
                      <textarea
                        required
                        maxLength={500}
                        rows={2}
                        value={f.businessAddress}
                        onChange={(e) => set('businessAddress', e.target.value)}
                        placeholder="Building, street, area"
                        autoComplete="street-address"
                      />
                    </label>
                    <label>
                      Country
                      <input
                        required
                        maxLength={100}
                        value={f.addressCountry}
                        onChange={(e) => set('addressCountry', e.target.value)}
                        autoComplete="country-name"
                      />
                    </label>
                    <label>
                      State
                      {isIndia(f.addressCountry) ? (
                        <select
                          required
                          value={f.addressState}
                          onChange={(e) => set('addressState', e.target.value)}
                        >
                          <option value="">Select state…</option>
                          {f.addressState && !INDIAN_STATES.includes(f.addressState) && (
                            <option value={f.addressState}>{f.addressState}</option>
                          )}
                          {INDIAN_STATES.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          required
                          maxLength={100}
                          value={f.addressState}
                          onChange={(e) => set('addressState', e.target.value)}
                          autoComplete="address-level1"
                        />
                      )}
                    </label>
                    <label>
                      City
                      <input
                        required
                        maxLength={100}
                        value={f.addressCity}
                        onChange={(e) => set('addressCity', e.target.value)}
                        autoComplete="address-level2"
                      />
                    </label>
                    <label>
                      {isIndia(f.addressCountry) ? 'PIN code' : 'Postal code'}
                      <input
                        required
                        value={f.addressPostalCode}
                        onChange={(e) =>
                          set(
                            'addressPostalCode',
                            isIndia(f.addressCountry)
                              ? e.target.value.replace(/\D/g, '').slice(0, 6)
                              : e.target.value.slice(0, 12),
                          )
                        }
                        {...(isIndia(f.addressCountry)
                          ? {
                              inputMode: 'numeric' as const,
                              pattern: '[1-9][0-9]{5}',
                              title: 'PIN code must be 6 digits.',
                            }
                          : { pattern: '[A-Za-z0-9][A-Za-z0-9 \\-]{1,10}' })}
                        autoComplete="postal-code"
                      />
                    </label>
                  </div>
                </fieldset>
              )}

              {panChk.result?.verified && panChk.result.fields && (
                <div className="span2 panbox">
                  <div className="panbox__head">
                    <strong className="panbox__title">PAN details</strong>
                    <span className="pill pill--ok">Verified</span>
                    <span className="muted">income-tax registry</span>
                  </div>
                  <dl className="panbox__grid">
                    <Detail label="Name" value={panChk.result.fields.name} />
                    <Detail label="Father's name" value={panChk.result.fields.fatherName} />
                    <Detail label="Category" value={panChk.result.fields.category} />
                    <Detail label="PAN status" value={panChk.result.fields.panStatus} />
                    <Detail
                      label="Aadhaar link status"
                      value={
                        panChk.result.fields.aadhaarLinked === true
                          ? `Linked${panChk.result.fields.maskedAadhaar ? ` (${panChk.result.fields.maskedAadhaar})` : ''}`
                          : panChk.result.fields.aadhaarLinked === false
                            ? 'PAN not linked with Aadhaar'
                            : (panChk.result.fields.aadhaarStatus ?? 'Not available')
                      }
                    />
                  </dl>
                </div>
              )}

              {gstChk.result?.verified && gstChk.result.details && (
                <div className="span2 panbox">
                  <div className="panbox__head">
                    <strong className="panbox__title">GST registration</strong>
                    <span
                      className={`pill ${
                        /active/i.test(gstChk.result.details.gstStatus ?? '')
                          ? 'pill--ok'
                          : 'pill--warn'
                      }`}
                    >
                      {gstChk.result.details.gstStatus ?? 'status unknown'}
                    </span>
                    <span className="muted">{gstChk.result.details.gstin}</span>
                  </div>
                  <dl className="panbox__grid">
                    <Detail label="Legal name" value={gstChk.result.details.legalName} />
                    <Detail label="Trade name" value={gstChk.result.details.tradeName} />
                    <Detail
                      label="Constitution of business"
                      value={gstChk.result.details.constitutionOfBusiness}
                    />
                    <Detail label="Taxpayer type" value={gstChk.result.details.taxPayerType} />
                    <Detail label="GST status" value={gstChk.result.details.gstStatus} />
                    <Detail
                      label="Registration date"
                      value={gstChk.result.details.registrationDate}
                    />
                    <Detail
                      label="Principal place of business"
                      value={gstChk.result.details.principalAddress}
                    />
                    <Detail label="State" value={gstChk.result.details.state} />
                    <Detail label="City" value={gstChk.result.details.city} />
                    <Detail label="Pincode" value={gstChk.result.details.pincode} />
                  </dl>
                  {gstChk.result.details.latestFiling && (
                    <div className="panbox__sub">
                      <h3>Latest filing</h3>
                      <dl className="panbox__grid">
                        <Detail
                          label="Filing year"
                          value={gstChk.result.details.latestFiling.filingYear}
                        />
                        <Detail
                          label="Period"
                          value={gstChk.result.details.latestFiling.monthOfFiling}
                        />
                        <Detail
                          label="Return type"
                          value={gstChk.result.details.latestFiling.gstType}
                        />
                        <Detail
                          label="Mode"
                          value={gstChk.result.details.latestFiling.methodOfFilling}
                        />
                        <Detail
                          label="Filed on"
                          value={gstChk.result.details.latestFiling.dateOfFiling}
                        />
                        <Detail
                          label="Status"
                          value={gstChk.result.details.latestFiling.gstStatus}
                        />
                      </dl>
                    </div>
                  )}
                </div>
              )}

              {msmeChk.result?.verified && msmeChk.result.details && (
                <div className="span2 panbox">
                  <div className="panbox__head">
                    <strong className="panbox__title">MSME / Udyam registration</strong>
                    <span className="pill pill--ok">
                      {msmeChk.result.details.enterpriseType ?? 'Registered'}
                    </span>
                    <span className="muted">{msmeChk.result.pan}</span>
                  </div>
                  <dl className="panbox__grid">
                    <Detail
                      label="Udyam / MSME number"
                      value={msmeChk.result.details.udyamNumber}
                    />
                    <Detail
                      label="Registration date"
                      value={msmeChk.result.details.registrationDate}
                    />
                    <Detail
                      label="Organization type"
                      value={msmeChk.result.details.organizationType}
                    />
                    <Detail label="Enterprise type" value={msmeChk.result.details.enterpriseType} />
                    <Detail label="Enterprise name" value={msmeChk.result.details.officialName} />
                    <Detail label="Major activity" value={msmeChk.result.details.majorActivity} />
                  </dl>
                </div>
              )}
            </div>
          </section>

          {!panVerified && (
            <p className="note">Verify the vendor&apos;s PAN above to continue filling the case.</p>
          )}

          {panVerified && (
            <>
              <section className="card">
                <h2>Bank details</h2>
                <div className="grid2">
                  <label>
                    Bank account no.
                    <input
                      value={f.bankAccount}
                      onChange={(e) => set('bankAccount', e.target.value)}
                    />
                  </label>
                  <label>
                    IFSC code
                    <input
                      value={f.ifsc}
                      onChange={(e) => set('ifsc', e.target.value.toUpperCase())}
                      placeholder="HDFC0001234"
                      maxLength={11}
                      className={ifscErr ? 'is-invalid' : ''}
                    />
                    {ifscErr ? (
                      <span className="field-err">{ifscErr}</span>
                    ) : ifscBusy ? (
                      <span className="field-hint">Looking up bank…</span>
                    ) : ifscNote ? (
                      <span className="field-hint">{ifscNote}</span>
                    ) : null}
                  </label>
                  <label>
                    Bank name
                    <input
                      value={f.bankName}
                      onChange={(e) => set('bankName', e.target.value)}
                      placeholder="Auto-filled from IFSC"
                    />
                  </label>
                  <label>
                    Branch
                    <input
                      value={f.branch}
                      onChange={(e) => set('branch', e.target.value)}
                      placeholder="Auto-filled from IFSC"
                    />
                  </label>

                  <div className="span2 row-actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={verifyBank}
                      disabled={
                        bankChk.loading ||
                        !/^\d{5,20}$/.test(f.bankAccount.replace(/\s+/g, '')) ||
                        !validateIfsc(f.ifsc.trim().toUpperCase()).valid
                      }
                    >
                      {bankChk.loading ? 'Verifying account…' : 'Verify account'}
                    </button>
                  </div>

                  {bankChk.result && !bankChk.result.verified && bankChk.result.message ? (
                    <div className="span2 namematch namematch--warn">{bankChk.result.message}</div>
                  ) : null}

                  {bankChk.result?.verified && bankChk.result.details && (
                    <div className="span2 panbox">
                      <div className="panbox__head">
                        <span
                          className={`pill ${bankChk.result.details.active ? 'pill--ok' : 'pill--warn'}`}
                        >
                          Account {bankChk.result.details.active ? 'active' : 'inactive'}
                        </span>
                        <span className="muted">
                          {bankChk.result.details.ifsc} · penny-less verification
                        </span>
                      </div>
                      <dl className="panbox__grid">
                        <Detail
                          label="Account holder name"
                          value={bankChk.result.details.holderName}
                        />
                        <Detail
                          label="Account number"
                          value={
                            bankChk.result.details.accountNumber?.includes('\u2022')
                              ? f.bankAccount
                              : bankChk.result.details.accountNumber
                          }
                        />
                        <Detail label="IFSC" value={bankChk.result.details.ifsc} />
                        <Detail
                          label="Active status"
                          value={
                            bankChk.result.details.active === true
                              ? 'Active'
                              : bankChk.result.details.active === false
                                ? 'Inactive'
                                : (bankChk.result.details.activeStatus ?? 'Unknown')
                          }
                        />
                      </dl>
                      {bankChk.result.nameMatch && (
                        <div
                          className={`namematch ${bankChk.result.nameMatch.matched ? 'namematch--ok' : 'namematch--warn'}`}
                        >
                          {bankChk.result.nameMatch.matched ? (
                            <>
                              Holder name matches the {bankChk.result.nameMatch.matchedAgainst} (
                              {bankChk.result.nameMatch.score}%).
                            </>
                          ) : (
                            <>
                              Holder name does <strong>not</strong> match (best{' '}
                              {bankChk.result.nameMatch.score}% vs{' '}
                              {bankChk.result.nameMatch.matchedAgainst ?? 'PAN/legal/trade name'}).
                              At least 80% is required — confirm the account belongs to the vendor.
                            </>
                          )}
                        </div>
                      )}
                      {bankChk.result.nameMatch === undefined && (
                        <div className="namematch namematch--warn">
                          Verify the PAN or GST first so the holder name can be matched against the
                          vendor&apos;s name.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <div className="req__actions">
                <button className="btn" type="button" onClick={() => goTo(1)}>
                  Next
                </button>
                {draftControls}
              </div>
            </>
          )}
        </div>

        <div data-step="1" hidden={step !== 1}>
          {panVerified && (
            <>
              <section className="card">
                <h2>Team structure</h2>
                <p className="section-intro">
                  These are the people who support and approve this vendor. Each line is filled in
                  from the team structure master for the proposer. To raise the case on a
                  colleague&apos;s behalf, pick them as the proposer and their team loads. To use
                  someone else for one role, pick their email and their name fills in. The master
                  itself is not changed.
                </p>
                <TeamStructureEditor
                  info={teamInfo}
                  overrides={teamOv}
                  onChange={setTeamOv}
                  proposers={kind === 'resubmit' ? undefined : proposers}
                  proposerId={proposerId}
                  onProposerChange={(id) => {
                    // A different proposer has a different team, so earlier changes no longer apply.
                    setTeamOv({});
                    setProposerId(id);
                  }}
                />
              </section>

              <div className="req__actions">
                <button className="btn btn--ghost" type="button" onClick={() => goTo(0)}>
                  Back
                </button>
                <button className="btn" type="button" onClick={() => goTo(2)}>
                  Next
                </button>
                {draftControls}
              </div>
            </>
          )}
        </div>
        <div data-step="2" hidden={step !== 2}>
          {panVerified && (
            <>
              <section className="card">
                <h2>Information security</h2>
                <p className="section-intro">
                  If the vendor needs any IT access or access to systems, network, applications or
                  PII, the case is routed to InfoSec for review before it proceeds.
                </p>
                <div className="qlist">
                  {INFOSEC_QUESTIONS.map((q) => {
                    const val = (f as unknown as Record<string, string>)[q.key];
                    return (
                      <div key={q.key} className="qrow">
                        <span className="qrow__label">{q.label}</span>
                        <div className="qrow__opts">
                          <label className="radio">
                            <input
                              type="radio"
                              name={q.key}
                              checked={val === 'yes'}
                              onChange={() => set(q.key as keyof typeof f, 'yes')}
                            />
                            Yes
                          </label>
                          <label className="radio">
                            <input
                              type="radio"
                              name={q.key}
                              checked={val === 'no'}
                              onChange={() => set(q.key as keyof typeof f, 'no')}
                            />
                            No
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {infosecWillRoute && (
                  <div className="namematch namematch--warn" style={{ marginTop: 14 }}>
                    Based on these answers, this case will be routed to{' '}
                    <strong>InfoSec review</strong> and held until they sign off.
                  </div>
                )}
              </section>

              <section className="card">
                <h2>Authorized signatory</h2>
                <p className="section-intro">
                  The person legally authorised to sign on behalf of the vendor.
                </p>
                <div className="grid2">
                  <label>
                    Name (as per Aadhaar)
                    <input
                      value={f.signatoryName}
                      onChange={(e) => set('signatoryName', e.target.value)}
                      placeholder="Full name as on Aadhaar"
                    />
                  </label>
                  <label>
                    PAN No.
                    <input
                      value={f.signatoryPan}
                      onChange={(e) => set('signatoryPan', e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      className={sigPanErr ? 'is-invalid' : ''}
                    />
                    {sigPanErr ? <span className="field-err">{sigPanErr}</span> : null}
                  </label>
                  <label>
                    Mobile No.
                    <input
                      value={f.signatoryMobile}
                      onChange={(e) =>
                        set('signatoryMobile', e.target.value.replace(/\D/g, '').slice(0, 10))
                      }
                      placeholder="9876543210"
                      inputMode="numeric"
                      maxLength={10}
                      className={sigMobileErr ? 'is-invalid' : ''}
                    />
                    {sigMobileErr ? <span className="field-err">{sigMobileErr}</span> : null}
                  </label>
                  <label>
                    Email ID
                    <input
                      type="email"
                      value={f.signatoryEmail}
                      onChange={(e) => set('signatoryEmail', e.target.value)}
                      placeholder="name@company.com"
                      className={sigEmailErr ? 'is-invalid' : ''}
                    />
                    {sigEmailErr ? <span className="field-err">{sigEmailErr}</span> : null}
                  </label>
                </div>
              </section>

              <section className="card">
                <h2>Business SPOC</h2>
                <p className="section-intro">
                  Single point of contact at the vendor for this onboarding.
                </p>
                <label className="checkbox" style={{ marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={spocSame}
                    onChange={(e) => setSpocSame(e.target.checked)}
                  />
                  Same as authorised signatory
                </label>
                <div className="grid2">
                  <label>
                    SPOC name
                    <input
                      value={f.contactName}
                      disabled={spocSame}
                      onChange={(e) => set('contactName', e.target.value)}
                    />
                  </label>
                  <label>
                    SPOC email
                    <input
                      type="email"
                      value={f.contactEmail}
                      disabled={spocSame}
                      onChange={(e) => set('contactEmail', e.target.value)}
                    />
                  </label>
                  <label>
                    SPOC phone
                    <input
                      value={f.contactPhone}
                      disabled={spocSame}
                      onChange={(e) => set('contactPhone', e.target.value)}
                    />
                  </label>
                </div>
              </section>

              <div className="req__actions">
                <button className="btn btn--ghost" type="button" onClick={() => goTo(1)}>
                  Back
                </button>
                <button className="btn" type="button" onClick={() => goTo(3)}>
                  Next
                </button>
                {draftControls}
              </div>
            </>
          )}
        </div>

        <div data-step="3" hidden={step !== 3}>
          {panVerified && (
            <>
              <section className="card">
                <h2>Management structure</h2>
                <p className="section-intro">
                  {isConstitution(f.constitution) ? (
                    <>
                      Type of constitution: <strong>{CONSTITUTION_LABELS[f.constitution]}</strong>.
                      The details asked depend on it.
                    </>
                  ) : (
                    <>Select the type of constitution on the Vendor &amp; tax page first.</>
                  )}{' '}
                  Personal details are encrypted when saved.
                </p>
                {mgmtRole && (
                  <>
                    <h3>{MANAGEMENT[mgmtRole].noun} details</h3>
                    <ManagementPeople
                      role={mgmtRole}
                      rows={f.partners}
                      onChange={setPartner}
                      onAdd={addPartner}
                      onRemove={removePartner}
                      photo={
                        photoDocType && (
                          <label className="span2">
                            Photograph of the {MANAGEMENT[mgmtRole].noun} (JPG or PNG)
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              disabled={photo.busy}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void uploadPhoto(file);
                                e.target.value = '';
                              }}
                            />
                            {photo.busy ? (
                              <span className="muted">Uploading and scanning…</span>
                            ) : photo.name ? (
                              <span className="muted">Uploaded: {photo.name}</span>
                            ) : null}
                            {photo.error ? <span className="field-err">{photo.error}</span> : null}
                          </label>
                        )
                      }
                    />
                  </>
                )}
                {f.constitution && !mgmtRole && (
                  <p className="muted">No management details are needed for this constitution.</p>
                )}
              </section>

              <section className="card">
                <h2>References</h2>
                <p className="section-intro">
                  Give at least two references for the vendor. Every field is required.
                </p>
                <div className="partners__scroll">
                  <table className="partners__tbl partners__tbl--refs">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Contact name</th>
                        <th>Legal name of the business</th>
                        <th>Registered address</th>
                        <th>Contact number</th>
                        <th>Email ID</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {f.references.map((r, i) => (
                        <tr key={i}>
                          <td className="partners__n">{i + 1}</td>
                          <td>
                            <input
                              aria-label={`Reference ${i + 1} contact name`}
                              value={r.contactName}
                              maxLength={200}
                              required
                              onChange={(e) => setReference(i, { contactName: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`Reference ${i + 1} legal name of the business`}
                              value={r.businessName}
                              maxLength={200}
                              required
                              onChange={(e) => setReference(i, { businessName: e.target.value })}
                            />
                          </td>
                          <td>
                            <textarea
                              aria-label={`Reference ${i + 1} registered address`}
                              value={r.registeredAddress}
                              rows={2}
                              maxLength={500}
                              required
                              onChange={(e) =>
                                setReference(i, { registeredAddress: e.target.value })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="tel"
                              aria-label={`Reference ${i + 1} contact number`}
                              value={r.contactNumber}
                              maxLength={15}
                              pattern="[0-9+\-\s()]{7,15}"
                              title="Enter a valid contact number"
                              required
                              onChange={(e) =>
                                setReference(i, {
                                  contactNumber: e.target.value.replace(/[^0-9+\-\s()]/g, ''),
                                })
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="email"
                              aria-label={`Reference ${i + 1} email ID`}
                              value={r.email}
                              maxLength={200}
                              required
                              onChange={(e) => setReference(i, { email: e.target.value })}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn btn--sm btn--ghost"
                              aria-label={`Remove reference ${i + 1}`}
                              disabled={f.references.length <= MIN_REFERENCES}
                              title={
                                f.references.length <= MIN_REFERENCES
                                  ? 'At least two references are required'
                                  : undefined
                              }
                              onClick={() => removeReference(i)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="req__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    disabled={f.references.length >= 10}
                    onClick={addReference}
                  >
                    + Add reference
                  </button>
                  <span className="muted tiny">{f.references.length} added · minimum 2</span>
                </div>
              </section>
              {/* RC limits are only asked for a used-car-loan dealer (Vendor Dealer UCL). */}
              {categoryHasRcLimits(f.categoryKey) && (
                <section className="card">
                  <h2>RC limit</h2>
                  <p className="section-intro">
                    List the revolving credit (RC) limits the vendor holds with its financers. The
                    sanction loan limit and the credit limit are worked out for you as the number of
                    vehicles × {'\u20B9'}
                    {RC_LIMIT_PER_VEHICLE.toLocaleString('en-IN')}. Leave this empty if there are
                    none.
                  </p>
                  {f.rcLimits.length > 0 && (
                    <div className="partners__scroll">
                      <table className="partners__tbl partners__tbl--rc">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>Name of the financer</th>
                            <th>RC limit (INR)</th>
                            <th>Number of vehicles</th>
                            <th>Sanction loan limit amount</th>
                            <th>Credit limit amount (figures)</th>
                            <th>Credit limit amount (words)</th>
                            <th>Remarks</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {f.rcLimits.map((r, i) => {
                            const d = rcLimitsFromVehicles(
                              r.numberOfVehicles === '' ? null : Number(r.numberOfVehicles),
                            );
                            const inr = (n: number | null) =>
                              n == null ? '\u2014' : `\u20B9 ${n.toLocaleString('en-IN')}`;
                            return (
                              <tr key={i}>
                                <td className="partners__n">{i + 1}</td>
                                <td>
                                  <input
                                    aria-label={`RC limit ${i + 1} name of the financer`}
                                    value={r.financerName}
                                    maxLength={200}
                                    required
                                    onChange={(e) =>
                                      setRcLimit(i, { financerName: e.target.value })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    inputMode="decimal"
                                    aria-label={`RC limit ${i + 1} amount in rupees`}
                                    value={r.rcLimit}
                                    maxLength={16}
                                    pattern="[0-9]{1,13}(\.[0-9]{1,2})?"
                                    title="Amount in rupees, up to two decimal places"
                                    required
                                    onChange={(e) =>
                                      setRcLimit(i, {
                                        rcLimit: e.target.value.replace(/[^0-9.]/g, ''),
                                      })
                                    }
                                  />
                                </td>
                                <td>
                                  <input
                                    inputMode="numeric"
                                    aria-label={`RC limit ${i + 1} number of vehicles`}
                                    value={r.numberOfVehicles}
                                    maxLength={6}
                                    pattern="[1-9][0-9]{0,5}"
                                    title="Whole number of vehicles, 1 or more"
                                    required
                                    onChange={(e) =>
                                      setRcLimit(i, {
                                        numberOfVehicles: e.target.value.replace(/\D/g, ''),
                                      })
                                    }
                                  />
                                </td>
                                <td className="partners__calc" aria-live="polite">
                                  {inr(d.sanctionLoanLimit)}
                                </td>
                                <td className="partners__calc" aria-live="polite">
                                  {inr(d.creditLimitFigures)}
                                </td>
                                <td className="partners__words" aria-live="polite">
                                  {d.creditLimitWords ?? '\u2014'}
                                </td>
                                <td>
                                  <textarea
                                    aria-label={`RC limit ${i + 1} remarks`}
                                    value={r.remarks}
                                    rows={2}
                                    maxLength={500}
                                    onChange={(e) => setRcLimit(i, { remarks: e.target.value })}
                                  />
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btn btn--sm btn--ghost"
                                    aria-label={`Remove RC limit ${i + 1}`}
                                    onClick={() => removeRcLimit(i)}
                                  >
                                    Remove
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {f.rcLimits.length === 0 && <p className="muted">No RC limits added yet.</p>}
                  <div className="req__actions">
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={f.rcLimits.length >= 20}
                      onClick={addRcLimit}
                    >
                      + Add RC limit
                    </button>
                    {f.rcLimits.length > 0 && (
                      <span className="muted tiny">
                        Total RC limit: {'\u20B9'}
                        {f.rcLimits
                          .reduce((n, r) => n + (Number(r.rcLimit) || 0), 0)
                          .toLocaleString('en-IN')}
                      </span>
                    )}
                  </div>
                </section>
              )}

              <div className="req__actions">
                <button className="btn btn--ghost" type="button" onClick={() => goTo(2)}>
                  Back
                </button>
                <button className="btn" type="button" onClick={() => goTo(4)}>
                  Next
                </button>
                {draftControls}
              </div>
            </>
          )}
        </div>

        <div data-step="4" hidden={step !== 4}>
          {panVerified && step === 4 && (
            <>
              <div className="dk-step-head">
                <h2>Digi KYC</h2>
                <p className="muted">You can raise the case while the vendor completes it.</p>
              </div>
              {kycCaseId ? (
                <KycPanel
                  caseId={kycCaseId}
                  embedded
                  beforeInitiate={
                    kind === 'resubmit'
                      ? undefined
                      : async () => {
                          await flushDraft();
                        }
                  }
                />
              ) : (
                <p className="muted">{draftError ?? 'Saving the draft…'}</p>
              )}

              <div className="req__actions">
                <button className="btn btn--ghost" type="button" onClick={() => goTo(3)}>
                  Back
                </button>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Submitting…' : kind === 'resubmit' ? 'Resubmit case' : 'Raise case'}
                </button>
                {draftControls}
              </div>
            </>
          )}
        </div>
      </form>
    </main>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="panbox__item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
