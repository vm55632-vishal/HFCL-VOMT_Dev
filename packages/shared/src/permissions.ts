/**
 * Permission catalogue. Permissions are `resource:action` strings and are the unit of
 * authorization — the central policy guard checks these server-side on every request
 * (deny-by-default). Roles are collections of permissions; see roles.ts.
 *
 * Phase 0/1 uses the identity/access/admin/audit permissions. Vendor/workflow/document
 * permissions are declared now so later phases slot in without renaming.
 */
export const PERMISSIONS = {
  // user & access administration
  UserRead: 'user:read',
  UserManage: 'user:manage',
  UserForceLogout: 'user:force_logout',
  RoleRead: 'role:read',
  RoleManage: 'role:manage',
  SettingsRead: 'settings:read',
  SettingsManage: 'settings:manage',
  IdpConfigManage: 'idp_config:manage',
  AccessReviewRun: 'access_review:run',

  // registration / approvals
  RegistrationApprove: 'registration:approve',
  DelegationManage: 'delegation:manage',

  // audit & reporting
  AuditRead: 'audit_log:read',
  AuditExport: 'audit_log:export',

  // vendor lifecycle (later phases)
  VendorCreate: 'vendor:create',
  VendorRead: 'vendor:read',
  VendorReadAll: 'vendor:read_all',
  VendorEdit: 'vendor:edit',
  VendorViewSensitive: 'vendor:view_sensitive', // unmask PAN/bank — audited on use
  VendorActivate: 'vendor:activate',

  // workflow (later phases)
  WorkflowStageView: 'workflow_stage:view',
  WorkflowStageApprove: 'workflow_stage:approve',
  WorkflowStageReject: 'workflow_stage:reject',
  WorkflowStageReassign: 'workflow_stage:reassign',
  WorkflowManage: 'workflow:manage',

  // documents (later phases)
  DocumentUpload: 'document:upload',
  DocumentDownload: 'document:download',

  // KYC & risk checks on the authorised signatory (Digi KYC, Hunter, IXSite, CRIF / CIBIL)
  KycInitiate: 'kyc:initiate',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permission strings, for validation and admin UIs. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/** True if `value` is a known permission. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value);
}
