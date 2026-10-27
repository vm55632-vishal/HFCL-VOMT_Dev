import { RoleKey } from './roles';
import type { WorkflowDefinition } from './workflow';

/** A configurable vendor category (master data). Seeded, then editable by an admin. */
export interface VendorCategoryDef {
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  /** Triggers enhanced due diligence (e.g. related party). */
  enhancedDueDiligence: boolean;
  /** Document types this category requires (keys; Phase 3 collects the files). */
  requiredDocuments: string[];
  /** Statutory checks this category requires (Phase 4 runs them). */
  requiredValidations: string[];
  /** Workflow key this category routes through. */
  workflowKey: string;
  /** Offered on the intake form. Inactive categories stay for existing cases and can be re-enabled. */
  active: boolean;
}

export const DEFAULT_WORKFLOW_KEY = 'standard-vendor';

const STD_DOCS = ['pan_card', 'gst_certificate', 'cancelled_cheque'];
const STD_CHECKS = ['pan', 'gstin', 'bank'];
const INACTIVE = { active: false } as const;

/** A sub-category (VOMT account group) under a parent vendor category. */
export interface SubCategoryDef {
  key: string;
  name: string;
  categoryKey: string;
  sortOrder: number;
}

/**
 * Vendor categories = SAP `Vendor_AccountGroupName`. Each may have one or more sub-categories
 * (`DEFAULT_SUBCATEGORIES` below) = the `VOMT_VendorAccountGroupName` mappings. All route through
 * the standard workflow; admins can re-point, flag EDD, or edit docs/checks per category.
 */
// Offered on the intake form, in this order (user decision 2026-10-27). The rest are kept inactive:
// earlier cases still reference some of them, and an admin can re-enable one on the categories page.
export const DEFAULT_CATEGORIES: VendorCategoryDef[] = [
  cat('vendor_others_domestic', 'Vendor Others Domestic', 10),
  cat('vendor_collection', 'Vendor Collection', 20),
  cat('vendor_dealer_twl', 'Vendor Dealer TWL', 30),
  cat('vendor_dealer_ucl', 'Vendor Dealer UCL', 40),
  cat('vendor_foreign_creditor', 'Vendor Foreign', 50, {
    enhancedDueDiligence: true,
    requiredDocuments: ['tax_residency_certificate', 'bank_details'],
    requiredValidations: ['bank'],
  }),
  cat('vendor_dealer_ecv', 'Vendor Dealer ECV', 60),
  cat('vendor_dealer_ncl', 'Vendor Dealer NCL', 70),
  // inactive
  cat('plant_vendor', 'Plant Vendor', 110, INACTIVE),
  cat('onetime_vendor', 'One time Vendor', 120, {
    ...INACTIVE,
    requiredDocuments: ['pan_card', 'cancelled_cheque'],
    requiredValidations: ['pan', 'bank'],
  }),
  cat('gst_partner', 'GST partner', 130, INACTIVE),
  cat('vendor_rent', 'Vendor Rent', 140, INACTIVE),
  cat('vendor_legal_professional', 'Vendor Legal & Professional', 150, INACTIVE),
  cat('vendor_dsa', 'Vendor DSA', 160, INACTIVE),
  cat('vendor_employees_on_roll', 'Vendor Employees On Roll', 170, INACTIVE),
  cat('vendor_employees_off_roll', 'Vendor Employees off Roll', 180, INACTIVE),
  cat('vendor_intercompany', 'Vendor Intercompany', 190, INACTIVE),
  cat('vendor_employees_joining_bonus', 'Vendor Employees Joining Bonus', 200, INACTIVE),
];

/** Sub-categories (VOMT account groups) keyed to their parent category. */
export const DEFAULT_SUBCATEGORIES: SubCategoryDef[] = [
  sub('onetime_vendor', 'Onetime Vendors', 10),
  sub('vendor_rent', 'Vendor Rent', 10),
  sub('vendor_collection', 'Collection Agency', 10),
  sub('vendor_collection', 'Vendor Collection', 20),
  sub('vendor_legal_professional', 'Vendor Legal & Professional', 10),
  sub('vendor_dsa', 'Dealer Sales Manager', 10),
  sub('vendor_dealer_twl', 'Used Two Wheeler Dealer or Multi Brand Outlet', 10),
  sub('vendor_dealer_twl', 'Two Wheeler Dealer - New Two Wheeler Loan', 20),
  sub('vendor_dealer_twl', 'Electric Two Wheeler Dealer - Electric Two Wheeler Loan', 30),
  sub('vendor_dealer_ucl', 'Used Car Loan - DSA or Dealer', 10),
  sub('vendor_dealer_ucl', 'Used Car Loan Dealer (OEM backed dealer)', 20),
  sub('vendor_foreign_creditor', 'Foreign Vendors', 10),
  sub(
    'vendor_others_domestic',
    'Utility Vendors (Inclusive of Central or State Govt or Local Bodies or Regulators or Statutory Authority or Judiciary etc.)',
    10,
  ),
  sub('vendor_others_domestic', 'Vendor Others Domestic', 20),
  sub('vendor_dealer_ecv', 'Vendor Dealer ECV', 10),
  sub('vendor_dealer_ncl', 'New Car Loan Dealer', 10),
  sub('vendor_dealer_ncl', 'New Car Loan DSA', 20),
];

/** Build a category def with standard defaults. */
function cat(
  key: string,
  name: string,
  sortOrder: number,
  overrides: Partial<VendorCategoryDef> = {},
): VendorCategoryDef {
  return {
    key,
    name,
    description: '',
    sortOrder,
    enhancedDueDiligence: false,
    requiredDocuments: STD_DOCS,
    requiredValidations: STD_CHECKS,
    workflowKey: DEFAULT_WORKFLOW_KEY,
    active: true,
    ...overrides,
  };
}

/** Build a sub-category def; key = `<categoryKey>__<slug(name)>`. */
function sub(categoryKey: string, name: string, sortOrder: number): SubCategoryDef {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return { key: `${categoryKey}__${slug}`, name, categoryKey, sortOrder };
}

/**
 * The default workflow, version 1, PUBLISHED. Mirrors the reference prototype's spine but as a
 * data-driven, versioned definition: Risk applies to medium+; Partner approval to high+; the
 * Procurement stage is an evidence gate.
 */
export const DEFAULT_WORKFLOW: WorkflowDefinition = {
  key: DEFAULT_WORKFLOW_KEY,
  name: 'Standard vendor onboarding',
  version: 1,
  status: 'PUBLISHED',
  rejectStageKey: 'rejected',
  stages: [
    {
      key: 'draft',
      name: 'Draft',
      shortName: 'Draft',
      order: 0,
      ownerRole: RoleKey.Proposer,
      slaBusinessDays: 0,
      terminal: false,
    },
    {
      key: 'procurement',
      name: 'Procurement verification',
      shortName: 'Procurement',
      order: 10,
      ownerRole: RoleKey.Procurement,
      slaBusinessDays: 3,
      terminal: false,
      evidenceGate: true,
    },
    {
      key: 'risk',
      name: 'Risk & compliance review',
      shortName: 'Risk',
      order: 20,
      ownerRole: RoleKey.Compliance,
      slaBusinessDays: 5,
      terminal: false,
      applicableTiers: ['medium', 'high', 'critical'],
    },
    {
      key: 'finance',
      name: 'Bank & payment setup',
      shortName: 'Finance',
      order: 30,
      ownerRole: RoleKey.Finance,
      slaBusinessDays: 2,
      terminal: false,
    },
    {
      key: 'approval',
      name: 'Partner approval',
      shortName: 'Approval',
      order: 40,
      ownerRole: RoleKey.Approver,
      slaBusinessDays: 3,
      terminal: false,
      applicableTiers: ['high', 'critical'],
    },
    {
      key: 'approved',
      name: 'Approved — onboarded',
      shortName: 'Approved',
      order: 50,
      ownerRole: null,
      slaBusinessDays: 0,
      terminal: true,
    },
    {
      key: 'rejected',
      name: 'Rejected',
      shortName: 'Rejected',
      order: 60,
      ownerRole: null,
      slaBusinessDays: 0,
      terminal: true,
    },
  ],
};
