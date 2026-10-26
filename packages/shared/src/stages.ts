/**
 * Parallel review model (layered over the sequential workflow engine). When a proposer submits a
 * case it fans out to independent reviewers — FCU, Operation and Legal always, plus InfoSec when
 * the IT/PII questionnaire flagged it — who each act on their own per-stage record in parallel.
 * Once every active review stage is approved the case reaches the SAP confirmation gate, where the
 * SAP role sees each stage's completion and confirms the vendor into SAP/ERP (the final stage).
 *
 * Optional sequential approval levels (L1 -> L2 -> L3) sit between the parallel reviews and SAP.
 * Each vendor category chooses which levels it needs (none by default); a case keeps the levels it
 * was submitted with. While a level is current, `case.stage` holds its key.
 */

/** The parallel review stages a case can carry (each has its own table + owning role). */
export const REVIEW_STAGES = ['infosec', 'fcu', 'operation', 'legal'] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];

/** Sequential approval levels, in the order they run. Each has its own table + owning role. */
export const APPROVAL_LEVELS = ['l1', 'l2', 'l3'] as const;
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number];

export function isApprovalLevel(v: unknown): v is ApprovalLevel {
  return typeof v === 'string' && (APPROVAL_LEVELS as readonly string[]).includes(v);
}

/** Clean a configured list of levels: known levels only, no repeats, in L1 -> L2 -> L3 order. */
export function normaliseApprovalLevels(
  levels: readonly unknown[] | null | undefined,
): ApprovalLevel[] {
  const set = new Set((levels ?? []).filter(isApprovalLevel));
  return APPROVAL_LEVELS.filter((l) => set.has(l));
}

/**
 * Where a case goes once the step it is on is approved: the next approval level the case uses,
 * or SAP confirmation. `after` is the level just approved (omit it when the reviews just finished).
 */
export function nextAfterApproval(
  levels: readonly ApprovalLevel[],
  after?: ApprovalLevel,
): ApprovalLevel | typeof SAP_STAGE {
  const from = after ? levels.indexOf(after) + 1 : 0;
  return levels[from] ?? SAP_STAGE;
}

/** The final confirmation stage key. */
export const SAP_STAGE = 'sap';

/** High-level case phases held on `case.stage`. */
export const CASE_PHASES = [
  'draft',
  'review',
  'l1',
  'l2',
  'l3',
  'sap',
  'approved',
  'rejected',
] as const;
export type CasePhase = (typeof CASE_PHASES)[number];

/** Per-stage review record status. */
export const STAGE_STATUSES = ['pending', 'approved', 'rejected', 'sent_back'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** The role that owns each review stage / approval level (role key === stage key here). */
export const STAGE_ROLE: Record<ReviewStage | ApprovalLevel, string> = {
  infosec: 'infosec',
  fcu: 'fcu',
  operation: 'operation',
  legal: 'legal',
  l1: 'l1',
  l2: 'l2',
  l3: 'l3',
};

/** Human labels for stages/phases shown in the UI. */
export const STAGE_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In review',
  infosec: 'InfoSec',
  fcu: 'FCU',
  operation: 'Operation',
  legal: 'Legal',
  l1: 'L1 approval',
  l2: 'L2 approval',
  l3: 'L3 approval',
  sap: 'SAP confirmation',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** The review stages that are active for a case: FCU/Operation/Legal always, InfoSec if flagged. */
export function activeReviewStages(infosecRequired: boolean): ReviewStage[] {
  return REVIEW_STAGES.filter((s) => s !== 'infosec' || infosecRequired);
}
