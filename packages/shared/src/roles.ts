import { PERMISSIONS as P, type Permission, ALL_PERMISSIONS } from './permissions';

/** Stable machine keys for the seeded roles (prompt §3.1). Admin can add more at runtime. */
export enum RoleKey {
  SuperAdmin = 'super_admin',
  PlatformAdmin = 'platform_admin',
  Proposer = 'proposer',
  Approver = 'approver',
  Procurement = 'procurement',
  Finance = 'finance',
  Compliance = 'compliance',
  InfoSec = 'infosec',
  Fcu = 'fcu',
  Operation = 'operation',
  Legal = 'legal',
  Sap = 'sap',
  Auditor = 'auditor',
  Vendor = 'vendor',
}

export interface RoleDefinition {
  key: RoleKey;
  label: string;
  description: string;
  /** Built-in roles can be re-permissioned but not deleted. */
  builtIn: true;
  permissions: readonly Permission[];
}

// Common review-stage permissions shared by the functional reviewer roles.
const REVIEW: readonly Permission[] = [
  P.VendorReadAll,
  P.WorkflowStageView,
  P.WorkflowStageApprove,
  P.WorkflowStageReject,
];

/** The default role model, seeded on first run. Editable via the admin surface (Phase 1). */
export const ROLES: Record<RoleKey, RoleDefinition> = {
  [RoleKey.SuperAdmin]: {
    key: RoleKey.SuperAdmin,
    label: 'Super Admin',
    description: 'Platform configuration, IdP settings, break-glass. Kept to the fewest holders.',
    builtIn: true,
    permissions: ALL_PERMISSIONS,
  },
  [RoleKey.PlatformAdmin]: {
    key: RoleKey.PlatformAdmin,
    label: 'Platform Admin',
    description: 'User, role, workflow and category management.',
    builtIn: true,
    permissions: [
      P.UserRead,
      P.UserManage,
      P.UserForceLogout,
      P.RoleRead,
      P.RoleManage,
      P.SettingsRead,
      P.SettingsManage,
      P.AccessReviewRun,
      P.RegistrationApprove,
      P.DelegationManage,
      P.AuditRead,
      P.WorkflowManage,
      P.VendorReadAll,
    ],
  },
  [RoleKey.Proposer]: {
    key: RoleKey.Proposer,
    label: 'Proposer',
    description: 'Initiates vendor requests and tracks their status. Sees only own requests.',
    builtIn: true,
    permissions: [
      P.VendorCreate,
      P.VendorRead,
      P.VendorEdit,
      P.VendorViewSensitive,
      P.DocumentUpload,
      P.KycInitiate,
    ],
  },
  [RoleKey.Approver]: {
    key: RoleKey.Approver,
    label: 'Reviewer / Approver',
    description: 'Acts on assigned workflow stages.',
    builtIn: true,
    permissions: [...REVIEW, P.WorkflowStageReassign],
  },
  [RoleKey.Procurement]: {
    key: RoleKey.Procurement,
    label: 'Procurement',
    description: 'Commercial review stage.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorEdit, P.DocumentDownload],
  },
  [RoleKey.Finance]: {
    key: RoleKey.Finance,
    label: 'Finance & Treasury',
    description: 'Bank and tax validation stage.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive, P.DocumentDownload],
  },
  [RoleKey.Compliance]: {
    key: RoleKey.Compliance,
    label: 'Compliance / Legal',
    description: 'KYC, sanctions and conflict-of-interest stage.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive, P.DocumentDownload, P.KycInitiate],
  },
  [RoleKey.InfoSec]: {
    key: RoleKey.InfoSec,
    label: 'Information Security',
    description:
      'Reviews cases needing IT / network / application / PII access and approves, rejects or returns them before onboarding proceeds.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive],
  },
  [RoleKey.Fcu]: {
    key: RoleKey.Fcu,
    label: 'FCU (Fraud Control Unit)',
    description:
      'Parallel fraud-control review of a submitted case. Records address-check findings, uploads the final FCU due-diligence report, and approves, rejects or returns its FCU stage.',
    builtIn: true,
    permissions: [
      ...REVIEW,
      P.VendorViewSensitive,
      P.DocumentUpload,
      P.DocumentDownload,
      P.KycInitiate,
    ],
  },
  [RoleKey.Operation]: {
    key: RoleKey.Operation,
    label: 'Operation',
    description:
      'Parallel operations review of a submitted case. Approves, rejects or returns its Operation stage.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive, P.DocumentDownload],
  },
  [RoleKey.Legal]: {
    key: RoleKey.Legal,
    label: 'Legal',
    description:
      'Parallel legal review; drafts the vendor agreement and approves, rejects or returns its Legal stage.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive, P.DocumentUpload, P.DocumentDownload],
  },
  [RoleKey.Sap]: {
    key: RoleKey.Sap,
    label: 'SAP Confirmation',
    description:
      'Final confirmation stage. Sees every parallel stage’s completion and confirms the vendor into SAP/ERP once all are approved.',
    builtIn: true,
    permissions: [...REVIEW, P.VendorViewSensitive, P.DocumentDownload],
  },
  [RoleKey.Auditor]: {
    key: RoleKey.Auditor,
    label: 'Auditor',
    description: 'Full read access to records and audit logs. No edits.',
    builtIn: true,
    permissions: [
      P.VendorReadAll,
      P.WorkflowStageView,
      P.AuditRead,
      P.AuditExport,
      P.UserRead,
      P.RoleRead,
      P.SettingsRead,
    ],
  },
  [RoleKey.Vendor]: {
    key: RoleKey.Vendor,
    label: 'Vendor',
    description: 'External vendor. Access strictly scoped to their own record.',
    builtIn: true,
    permissions: [P.VendorRead, P.VendorEdit, P.DocumentUpload],
  },
};

/** The permissions an admin role must never lose, or the platform becomes unmanageable. */
export const ADMIN_REQUIRED_PERMISSIONS: readonly Permission[] = [P.UserManage, P.SettingsManage];

/** Resolve the effective permission set for a set of role keys. */
export function permissionsForRoles(
  keys: readonly RoleKey[],
  roles: Record<RoleKey, RoleDefinition> = ROLES,
): Set<Permission> {
  const out = new Set<Permission>();
  for (const key of keys) {
    const def = roles[key];
    if (!def) continue;
    for (const p of def.permissions) out.add(p);
  }
  return out;
}
