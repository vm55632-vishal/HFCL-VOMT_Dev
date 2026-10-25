import { createHash } from 'node:crypto';
import type { AuthUser } from './auth-user';

/**
 * Short-lived in-process cache of the resolved principal (user + roles + permissions), keyed by a
 * hash of the bearer token. Without it every API call re-verified the token with Supabase and ran
 * several database queries before doing any real work; with a remote database each of those is a
 * full network round trip, so a single page load paid that cost 4-5 times.
 *
 * Safety: entries live for {@link TTL_MS} only, are never shared across tokens, and are dropped
 * immediately (`invalidateUser` / `clear`) whenever a user's status or roles — or a role's
 * permissions — change, so a deactivation or role change still takes effect right away.
 */
const TTL_MS = 20_000;
const MAX_ENTRIES = 500;

interface Entry {
  principal: AuthUser;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function key(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const principalCache = {
  get(token: string): AuthUser | null {
    const k = key(token);
    const hit = entries.get(k);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      entries.delete(k);
      return null;
    }
    return hit.principal;
  },

  set(token: string, principal: AuthUser): void {
    if (entries.size >= MAX_ENTRIES) {
      // Drop the oldest entry (Map preserves insertion order).
      const oldest = entries.keys().next().value;
      if (oldest !== undefined) entries.delete(oldest);
    }
    entries.set(key(token), { principal, expiresAt: Date.now() + TTL_MS });
  },

  /** Forget every cached principal for one user (status/role change, forced logout). */
  invalidateUser(userId: string): void {
    for (const [k, v] of entries) if (v.principal.id === userId) entries.delete(k);
  },

  /** Forget everything (e.g. a role's permission set was edited). */
  clear(): void {
    entries.clear();
  },
};
