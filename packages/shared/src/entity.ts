import { RoleKey } from './roles';

/**
 * Multi-entity (ADR-0008). Every case belongs to one company in the group. People hold roles per
 * company; a few roles apply across the whole group.
 */

/** Request header the web app uses to say which company the user is working in (an entity code). */
export const ENTITY_HEADER = 'x-vop-entity';

/** Roles that apply across every company in the group. All other roles are held per company. */
export const GROUP_ROLES: readonly RoleKey[] = [
  RoleKey.SuperAdmin,
  RoleKey.PlatformAdmin,
  RoleKey.Auditor,
];

export const isGroupRole = (key: string): boolean =>
  (GROUP_ROLES as readonly string[]).includes(key);

/** An entity as the API returns it to the browser. */
export interface EntitySummary {
  id: string;
  code: string;
  name: string;
}

/** Entity codes: 2–12 upper-case letters or digits, e.g. HFCL. */
export const ENTITY_CODE_PATTERN = /^[A-Z0-9]{2,12}$/;

/**
 * Returned (403) when a request names a company the user cannot work in. The web app recognises it,
 * forgets its saved company choice and asks the server for the default one.
 */
export const ENTITY_FORBIDDEN_MESSAGE = 'You do not have access to that company.';
