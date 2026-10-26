/**
 * ADR-0008 central company scoping. Every database query made while handling an authenticated
 * request is limited to the request's company, in one place, so a service cannot forget it.
 *
 * - Models that carry `entityId` themselves get `entityId = <company>`.
 * - Models that belong to a case get `case: { entityId: <company> }`.
 * - Creating a company-owned row fills `entityId` in, and refuses a different company.
 *
 * Creating a row that belongs to a case is not checked here (it would cost a query); the services
 * load and check the case first, and the case lookup is itself scoped.
 */

/** Models with their own `entityId` column. */
export const ENTITY_MODELS = new Set(['Case', 'TeamStructureMaster', 'TeamDirectory']);

/** Models that belong to a case through a `case` relation. */
export const CASE_OWNED_MODELS = new Set([
  'CaseActivity',
  'CaseChecklistItem',
  'CaseComment',
  'CaseDraft',
  'CaseFcu',
  'CaseGeneral',
  'CaseInfosec',
  'CaseKycCheck',
  'CaseL1',
  'CaseL2',
  'CaseL3',
  'CaseLegal',
  'CaseOperation',
  'CaseSap',
  'CaseTeamStructure',
  'CaseVerification',
  'CaseVerificationResponse',
  'Document',
  'PartnerDetail',
  'RcLimit',
  'VendorReference',
]);

/** Operations that read or change existing rows, and so take a `where`. */
const WHERE_ACTIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

export class CrossEntityWriteError extends Error {
  constructor(model: string) {
    super(`Blocked a ${model} write for a different company than the request's.`);
  }
}

export interface ScopableParams {
  model?: string;
  action: string;
  args?: Record<string, unknown>;
}

type Where = Record<string, unknown>;

/** Add one more condition to a `where`, keeping every condition already there (unique keys too). */
function addCondition(where: Where | undefined, condition: Where): Where {
  const w = where ?? {};
  const existing = w.AND === undefined ? [] : Array.isArray(w.AND) ? w.AND : [w.AND];
  return { ...w, AND: [...existing, condition] };
}

function fillEntity(model: string, data: unknown, entityId: string): unknown {
  if (!data || typeof data !== 'object') return data;
  const row = data as Record<string, unknown>;
  if (row.entityId === undefined) return { ...row, entityId };
  if (row.entityId !== entityId) throw new CrossEntityWriteError(model);
  return row;
}

/**
 * Returns the query arguments limited to `entityId`. Models outside the two sets, and raw queries,
 * are returned unchanged.
 */
export function scopeParams<P extends ScopableParams>(
  params: P,
  entityId: string,
): Omit<P, 'args'> & { args?: Record<string, unknown> } {
  const model = params.model;
  if (!model) return params;
  const direct = ENTITY_MODELS.has(model);
  const owned = CASE_OWNED_MODELS.has(model);
  if (!direct && !owned) return params;

  const args = { ...(params.args ?? {}) };
  const condition: Where = direct ? { entityId } : { case: { entityId } };

  if (WHERE_ACTIONS.has(params.action)) {
    args.where = addCondition(args.where as Where | undefined, condition);
  }
  if (direct) {
    if (params.action === 'create') args.data = fillEntity(model, args.data, entityId);
    if (params.action === 'upsert') args.create = fillEntity(model, args.create, entityId);
    if (params.action === 'createMany') {
      const rows = args.data;
      args.data = Array.isArray(rows)
        ? rows.map((r) => fillEntity(model, r, entityId))
        : fillEntity(model, rows, entityId);
    }
    // Moving a row to another company is never allowed through an update.
    if ((params.action === 'update' || params.action === 'updateMany') && args.data) {
      const d = args.data as Record<string, unknown>;
      if (d.entityId !== undefined && d.entityId !== entityId)
        throw new CrossEntityWriteError(model);
    }
  }
  return { ...params, args };
}
