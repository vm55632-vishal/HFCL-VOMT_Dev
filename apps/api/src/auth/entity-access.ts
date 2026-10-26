import { isGroupRole, type EntitySummary } from '@vop/shared';

/** An entity with the domains used to pick a user's home company. */
export interface EntityRecord extends EntitySummary {
  emailDomains: string[];
}

export interface EntityAccessInput {
  /** The user's email, used to find their home company. */
  email: string;
  /** Group-wide role keys the user holds (users.roles). */
  groupRoleKeys: string[];
  /** Per-company role assignments. */
  entityRoles: { entityId: string; roleKey: string }[];
  /** Every active company. */
  activeEntities: EntityRecord[];
  /** The company code the browser asked for, if any. */
  requested: string | null;
}

export type EntityAccess =
  | {
      ok: true;
      /** Companies the user may work in, in display order. */
      entities: EntitySummary[];
      /** The company for this request, or null when the user has none. */
      active: EntitySummary | null;
      /** Group-wide roles plus the roles held in the active company. */
      roles: string[];
      groupWide: boolean;
    }
  | { ok: false };

const domainOf = (email: string) => email.split('@')[1]?.toLowerCase() ?? '';

/**
 * Decide which companies a user may work in and which one this request uses (ADR-0008).
 *
 * - Group-wide users may use any active company; others only companies where they hold a role.
 * - A requested company the user may not use is refused (`ok: false`); it is never silently
 *   replaced, so an action is never applied to a company the user did not choose.
 * - With nothing requested: the home company (its email domain matches the user's), else the first.
 */
export function resolveEntityAccess(input: EntityAccessInput): EntityAccess {
  const groupRoles = input.groupRoleKeys.filter(isGroupRole);
  const groupWide = groupRoles.length > 0;
  const assigned = new Set(input.entityRoles.map((r) => r.entityId));
  const allowed = input.activeEntities.filter((e) => groupWide || assigned.has(e.id));
  const entities = allowed.map(({ id, code, name }) => ({ id, code, name }));

  let active: EntitySummary | null = null;
  const requested = input.requested?.trim().toUpperCase() || null;
  if (requested) {
    active = entities.find((e) => e.code === requested) ?? null;
    if (!active) return { ok: false };
  } else {
    const domain = domainOf(input.email);
    const home = allowed.find(
      (e) => domain && e.emailDomains.map((d) => d.toLowerCase()).includes(domain),
    );
    active = home ? (entities.find((e) => e.id === home.id) ?? null) : (entities[0] ?? null);
  }

  // Group-wide roles never come from the per-company table, and per-company roles never from users.roles.
  const entityRoleKeys = active
    ? input.entityRoles
        .filter((r) => r.entityId === active.id && !isGroupRole(r.roleKey))
        .map((r) => r.roleKey)
    : [];
  return {
    ok: true,
    entities,
    active,
    roles: [...new Set([...groupRoles, ...entityRoleKeys])],
    groupWide,
  };
}

/** The company whose email domain matches this address, if any. */
export function homeEntityFor(email: string, entities: EntityRecord[]): EntityRecord | null {
  const domain = domainOf(email);
  if (!domain) return null;
  return entities.find((e) => e.emailDomains.map((d) => d.toLowerCase()).includes(domain)) ?? null;
}
