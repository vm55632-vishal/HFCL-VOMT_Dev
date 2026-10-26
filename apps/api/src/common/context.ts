import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request ambient context, propagated via AsyncLocalStorage for logs and audit. */
export interface RequestContext {
  correlationId: string;
  userId?: string;
  role?: string;
  ip?: string;
  userAgent?: string;
  /**
   * ADR-0008: the company the request is scoped to. Set for every authenticated request. When the
   * user has no company, it is {@link NO_ENTITY}, which matches nothing. Undefined (no scoping)
   * only outside authenticated requests: background jobs, seeds, maintenance scripts.
   */
  entityScope?: string;
  /** The active company's code, recorded on audit entries. */
  entityCode?: string;
}

/** Scope value for an authenticated user with no company: every scoped query returns nothing. */
export const NO_ENTITY = '-';

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request context, if any. */
export function currentContext(): RequestContext | undefined {
  return requestContext.getStore();
}
