/**
 * Type of constitution of the vendor, and which people the intake form asks about for it
 * (management structure): the proprietor of a sole proprietorship, the partners of a firm, the
 * directors of a company, or the Karta of a Hindu Undivided Family.
 */
export const CONSTITUTIONS = [
  'sole_proprietorship',
  'partnership',
  'llp',
  'private_limited',
  'public_limited',
  'huf',
  'trust_society',
  'government',
  'other',
] as const;
export type Constitution = (typeof CONSTITUTIONS)[number];

export const CONSTITUTION_LABELS: Record<Constitution, string> = {
  sole_proprietorship: 'Sole proprietorship',
  partnership: 'Partnership firm',
  llp: 'Limited liability partnership (LLP)',
  private_limited: 'Private limited company',
  public_limited: 'Public limited company',
  huf: 'Hindu Undivided Family (HUF)',
  trust_society: 'Trust / society / association',
  government: 'Government body',
  other: 'Other',
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
 * Best guess at the constitution from the GST registry's "constitution of business", falling back
 * to the PAN holder type (4th character). The proposer can always change it.
 */
export function suggestConstitution(
  pan: string | undefined,
  gstConstitution?: string,
): Constitution | undefined {
  const g = (gstConstitution ?? '').toLowerCase();
  if (g) {
    if (g.includes('proprietor')) return 'sole_proprietorship';
    if (g.includes('limited liability')) return 'llp';
    if (g.includes('partnership')) return 'partnership';
    if (g.includes('hindu') || g.includes('huf')) return 'huf';
    if (g.includes('private limited')) return 'private_limited';
    if (g.includes('public limited')) return 'public_limited';
    if (g.includes('trust') || g.includes('society') || g.includes('association')) {
      return 'trust_society';
    }
    if (g.includes('government') || g.includes('local authority')) return 'government';
  }
  switch ((pan ?? '').trim().toUpperCase().charAt(3)) {
    case 'P':
      return 'sole_proprietorship';
    case 'F':
      return 'partnership';
    case 'C':
      return 'private_limited';
    case 'H':
      return 'huf';
    case 'T':
    case 'A':
    case 'B':
      return 'trust_society';
    case 'G':
    case 'J':
    case 'L':
      return 'government';
    default:
      return undefined;
  }
}
