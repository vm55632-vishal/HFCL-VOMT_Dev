import { homeEntityFor, resolveEntityAccess, type EntityRecord } from './entity-access';

const HFCL: EntityRecord = {
  id: 'E1',
  code: 'HFCL',
  name: 'Hero FinCorp',
  emailDomains: ['herofincorp.example'],
};
const HHFL: EntityRecord = {
  id: 'E2',
  code: 'HHFL',
  name: 'Hero Housing',
  emailDomains: ['herohousing.example'],
};
const all = [HFCL, HHFL];

const base = {
  email: 'asha@herofincorp.example',
  groupRoleKeys: [] as string[],
  entityRoles: [] as { entityId: string; roleKey: string }[],
  activeEntities: all,
  requested: null as string | null,
};

describe('resolveEntityAccess', () => {
  it('limits a normal user to the companies where they hold a role', () => {
    const r = resolveEntityAccess({
      ...base,
      entityRoles: [{ entityId: 'E2', roleKey: 'proposer' }],
    });
    expect(r.ok && r.entities.map((e) => e.code)).toEqual(['HHFL']);
    expect(r.ok && r.active?.code).toBe('HHFL');
    expect(r.ok && r.roles).toEqual(['proposer']);
  });

  it('refuses a requested company the user has no role in (never falls back silently)', () => {
    const r = resolveEntityAccess({
      ...base,
      entityRoles: [{ entityId: 'E1', roleKey: 'proposer' }],
      requested: 'HHFL',
    });
    expect(r.ok).toBe(false);
  });

  it('refuses an unknown or inactive company code', () => {
    const r = resolveEntityAccess({
      ...base,
      entityRoles: [{ entityId: 'E1', roleKey: 'proposer' }],
      requested: 'NOPE',
    });
    expect(r.ok).toBe(false);
    const inactive = resolveEntityAccess({
      ...base,
      activeEntities: [HFCL],
      entityRoles: [{ entityId: 'E2', roleKey: 'proposer' }],
      requested: 'HHFL',
    });
    expect(inactive.ok).toBe(false);
  });

  it('gives each company its own roles', () => {
    const roles = [
      { entityId: 'E1', roleKey: 'proposer' },
      { entityId: 'E2', roleKey: 'fcu' },
    ];
    const inHfcl = resolveEntityAccess({ ...base, entityRoles: roles, requested: 'HFCL' });
    const inHhfl = resolveEntityAccess({ ...base, entityRoles: roles, requested: 'hhfl' });
    expect(inHfcl.ok && inHfcl.roles).toEqual(['proposer']);
    expect(inHhfl.ok && inHhfl.roles).toEqual(['fcu']);
  });

  it('picks the home company by email domain when nothing is requested', () => {
    const roles = [
      { entityId: 'E2', roleKey: 'proposer' },
      { entityId: 'E1', roleKey: 'proposer' },
    ];
    const r = resolveEntityAccess({ ...base, entityRoles: roles });
    expect(r.ok && r.active?.code).toBe('HFCL');
  });

  it('lets a group-wide user work in any active company with only their group roles', () => {
    const r = resolveEntityAccess({ ...base, groupRoleKeys: ['auditor'], requested: 'HHFL' });
    expect(r.ok && r.groupWide).toBe(true);
    expect(r.ok && r.entities.map((e) => e.code)).toEqual(['HFCL', 'HHFL']);
    expect(r.ok && r.roles).toEqual(['auditor']);
  });

  it('ignores non-group roles stored on the user and group roles stored per company', () => {
    const r = resolveEntityAccess({
      ...base,
      groupRoleKeys: ['proposer'],
      entityRoles: [{ entityId: 'E1', roleKey: 'super_admin' }],
    });
    expect(r.ok && r.groupWide).toBe(false);
    expect(r.ok && r.roles).toEqual([]);
  });

  it('returns no active company for a user with no access anywhere', () => {
    const r = resolveEntityAccess(base);
    expect(r.ok && r.active).toBeNull();
    expect(r.ok && r.entities).toEqual([]);
  });
});

describe('homeEntityFor', () => {
  it('matches the email domain case-insensitively', () => {
    expect(homeEntityFor('X@HeroHousing.Example', all)?.code).toBe('HHFL');
    expect(homeEntityFor('x@gmail.com', all)).toBeNull();
  });
});
