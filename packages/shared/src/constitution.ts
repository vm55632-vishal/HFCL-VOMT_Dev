/**
 * Type of constitution of the vendor, and which people the intake form asks about for it
 * (management structure): the proprietor of a sole proprietorship, the partners of a firm, the
 * directors of a company, or the Karta of a Hindu Undivided Family.
 */
export const CONSTITUTIONS = [
  'charitable_trust',
  'huf',
  'joint_venture',
  'llp',
  'non_profit',
  'one_person_company',
  'partnership',
  'private_limited',
  'public_limited',
  'sole_proprietorship',
  'other',
] as const;
export type Constitution = (typeof CONSTITUTIONS)[number];

export const CONSTITUTION_LABELS: Record<Constitution, string> = {
  charitable_trust: 'Charitable Trust',
  huf: 'Hindu Undivided Family',
  joint_venture: 'Joint Venture Company',
  llp: 'Limited Liability Partnership',
  non_profit: 'Non profit organization',
  one_person_company: 'One person Company',
  partnership: 'Partnership',
  private_limited: 'Private Limited Company',
  public_limited: 'Public Limited Company',
  sole_proprietorship: 'Sole Proprietorship',
  other: 'Others',
};

export const isConstitution = (v: unknown): v is Constitution =>
  typeof v === 'string' && (CONSTITUTIONS as readonly string[]).includes(v);

export type ManagementRole = 'proprietor' | 'partner' | 'director' | 'karta';

/** The people asked about for a constitution, or null when none are asked for. */
export function managementRole(c: string | null | undefined): ManagementRole | null {
  switch (c) {
    case 'sole_proprietorship':
      return 'proprietor';
    case 'partnership':
    case 'llp':
      return 'partner';
    case 'private_limited':
    case 'public_limited':
    case 'one_person_company':
    case 'joint_venture':
      return 'director';
    case 'huf':
      return 'karta';
    default:
      return null;
  }
}

/** A field of one person in the management structure. */
export type PersonField =
  | 'name'
  | 'dob'
  | 'maritalStatus'
  | 'gender'
  | 'fatherName'
  | 'spouseName'
  | 'pan'
  | 'address'
  | 'mobile'
  | 'residencePhone'
  | 'pincode'
  | 'contact'
  | 'officeAddress';

export const PERSON_FIELD_LABELS: Record<PersonField, string> = {
  name: 'Name',
  dob: 'Date of birth',
  maritalStatus: 'Marital status',
  gender: 'Gender',
  fatherName: "Father's name",
  spouseName: "Spouse's name",
  pan: 'PAN',
  address: 'Residence address',
  mobile: 'Personal mobile no.',
  residencePhone: 'Residence phone',
  pincode: 'Residence pin code',
  contact: "Director's contact no.",
  officeAddress: "Director's address",
};

export interface ManagementDef {
  /** "Proprietor", "Partner"… */
  noun: string;
  /** Exactly one person (proprietor, Karta) rather than a list. */
  single: boolean;
  /** Fields asked, in display order. Spouse name is only required when married. */
  fields: readonly PersonField[];
  /** A photograph must be uploaded (document type `<role>_photo`). */
  photo?: boolean;
}

export const MANAGEMENT: Record<ManagementRole, ManagementDef> = {
  proprietor: {
    noun: 'Proprietor',
    single: true,
    fields: [
      'name',
      'dob',
      'gender',
      'fatherName',
      'maritalStatus',
      'spouseName',
      'pan',
      'pincode',
      'residencePhone',
      'address',
    ],
  },
  partner: {
    noun: 'Partner',
    single: false,
    fields: [
      'name',
      'dob',
      'maritalStatus',
      'gender',
      'fatherName',
      'spouseName',
      'pan',
      'address',
      'mobile',
      'pincode',
    ],
  },
  director: {
    noun: 'Director',
    single: false,
    fields: [
      'name',
      'dob',
      'maritalStatus',
      'gender',
      'fatherName',
      'spouseName',
      'pan',
      'mobile',
      'address',
      'pincode',
      'residencePhone',
      'contact',
      'officeAddress',
    ],
  },
  karta: {
    noun: 'Karta',
    single: true,
    photo: true,
    fields: [
      'name',
      'spouseName',
      'pan',
      'dob',
      'address',
      'fatherName',
      'pincode',
      'gender',
      'maritalStatus',
      'residencePhone',
    ],
  },
};

/** Document type of the photograph uploaded for a role that needs one. */
export const personPhotoDocType = (role: ManagementRole) => `${role}_photo`;

/**
 * The constitution from the GST registry's "constitution of business" (e.g. "Proprietorship",
 * "Private Limited Company"). A value that does not match a listed type is "Others".
 */
export function constitutionFromGst(gstConstitution: string): Constitution {
  const g = gstConstitution.toLowerCase().replace(/\s+/g, ' ').trim();
  if (g.includes('proprietor')) return 'sole_proprietorship';
  if (g.includes('limited liability')) return 'llp';
  if (g.includes('partnership')) return 'partnership';
  if (g.includes('hindu undivided') || /\bhuf\b/.test(g)) return 'huf';
  if (g.includes('one person')) return 'one_person_company';
  if (g.includes('joint venture')) return 'joint_venture';
  if (g.includes('private limited') || /\bpvt\.? ltd\b/.test(g)) return 'private_limited';
  if (g.includes('public limited') || g.includes('public sector undertaking')) {
    return 'public_limited';
  }
  if (g.includes('non profit') || g.includes('non-profit') || g.includes('section 8')) {
    return 'non_profit';
  }
  // A plain trust; the combined "Society / Club / Trust / AOP" needs a closer look, so it is Others.
  if (g.includes('trust') && !/society|club|aop/.test(g)) return 'charitable_trust';
  return 'other';
}

/**
 * The constitution suggested by the PAN's 4th character (holder category), and a note when the
 * holder category covers more than one type and the proposer should check it.
 */
export function constitutionFromPan(
  pan: string | undefined,
): { value: Constitution; note?: string } | undefined {
  switch ((pan ?? '').trim().toUpperCase().charAt(3)) {
    case 'P':
      return { value: 'sole_proprietorship' };
    case 'C':
      return {
        value: 'private_limited',
        note: 'The PAN is of a company: check whether it is private, public, one person or a joint venture.',
      };
    case 'F':
      return {
        value: 'partnership',
        note: 'The PAN is of a firm: check whether it is a partnership or an LLP.',
      };
    case 'H':
      return { value: 'huf' };
    case 'T':
      return {
        value: 'charitable_trust',
        note: 'The PAN is of a trust: check whether it is a charitable trust.',
      };
    case 'A':
    case 'B':
      return { value: 'other', note: 'The PAN is of an AOP / BOI: verify the legal structure.' };
    case 'L':
    case 'J':
      return { value: 'other' };
    case 'G':
      return { value: 'other', note: 'The PAN is of a government entity.' };
    default:
      return undefined;
  }
}

/** "NA", "N/A", "-" and blanks mean no trade name was given. */
const NO_TRADE_NAME = /^(n\.?\s*\/?\s*a\.?|nil|none|-+)?$/i;

/**
 * The name a case is shown under: a sole proprietorship trades under its trade name (the legal
 * name is the proprietor's own name), so that is shown unless none was given (blank or "NA").
 * Every other constitution is shown under its legal name.
 */
export function vendorDisplayName(v: {
  legalName?: string | null;
  tradeName?: string | null;
  constitution?: string | null;
}): string {
  const trade = (v.tradeName ?? '').trim();
  if (v.constitution === 'sole_proprietorship' && !NO_TRADE_NAME.test(trade)) return trade;
  return v.legalName ?? '';
}
