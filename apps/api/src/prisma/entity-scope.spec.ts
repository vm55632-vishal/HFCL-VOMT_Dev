import { CrossEntityWriteError, scopeParams } from './entity-scope';

const E = 'ENTITY_A';

describe('scopeParams', () => {
  it('adds the company to case reads, keeping existing conditions', () => {
    const p = scopeParams(
      { model: 'Case', action: 'findMany', args: { where: { stage: 'review' } } },
      E,
    );
    expect(p.args?.where).toEqual({ stage: 'review', AND: [{ entityId: E }] });
  });

  it('keeps the unique key at the top level for findUnique', () => {
    const p = scopeParams(
      { model: 'Case', action: 'findUnique', args: { where: { id: 'C1' } } },
      E,
    );
    expect(p.args?.where).toEqual({ id: 'C1', AND: [{ entityId: E }] });
  });

  it('appends to an existing AND list or single AND object', () => {
    const list = scopeParams(
      { model: 'Case', action: 'count', args: { where: { AND: [{ onHold: true }] } } },
      E,
    );
    expect(list.args?.where).toEqual({ AND: [{ onHold: true }, { entityId: E }] });
    const single = scopeParams(
      { model: 'Case', action: 'count', args: { where: { AND: { onHold: true } } } },
      E,
    );
    expect(single.args?.where).toEqual({ AND: [{ onHold: true }, { entityId: E }] });
  });

  it('scopes reads and bulk changes on case-owned tables through the case', () => {
    for (const action of [
      'findMany',
      'findFirst',
      'count',
      'updateMany',
      'deleteMany',
      'findUnique',
    ]) {
      const p = scopeParams({ model: 'Document', action, args: { where: { caseId: 'C1' } } }, E);
      expect(p.args?.where).toEqual({ caseId: 'C1', AND: [{ case: { entityId: E } }] });
    }
  });

  it('scopes every operation that targets existing rows, including no-where calls', () => {
    const p = scopeParams({ model: 'Case', action: 'count', args: {} }, E);
    expect(p.args?.where).toEqual({ AND: [{ entityId: E }] });
    const g = scopeParams({ model: 'Case', action: 'groupBy', args: { by: ['stage'] } }, E);
    expect(g.args?.where).toEqual({ AND: [{ entityId: E }] });
  });

  it('fills the company on create and refuses a different one', () => {
    const p = scopeParams({ model: 'Case', action: 'create', args: { data: { ref: 'X' } } }, E);
    expect(p.args?.data).toEqual({ ref: 'X', entityId: E });
    expect(() =>
      scopeParams({ model: 'Case', action: 'create', args: { data: { entityId: 'OTHER' } } }, E),
    ).toThrow(CrossEntityWriteError);
  });

  it('checks every row of createMany and the create half of upsert', () => {
    const many = scopeParams(
      {
        model: 'TeamDirectory',
        action: 'createMany',
        args: { data: [{ email: 'a' }, { email: 'b', entityId: E }] },
      },
      E,
    );
    expect(many.args?.data).toEqual([
      { email: 'a', entityId: E },
      { email: 'b', entityId: E },
    ]);
    expect(() =>
      scopeParams(
        {
          model: 'TeamStructureMaster',
          action: 'upsert',
          args: { where: { id: '1' }, create: { entityId: 'OTHER' } },
        },
        E,
      ),
    ).toThrow(CrossEntityWriteError);
  });

  it('refuses moving a row to another company in an update', () => {
    expect(() =>
      scopeParams(
        {
          model: 'Case',
          action: 'update',
          args: { where: { id: 'C1' }, data: { entityId: 'OTHER' } },
        },
        E,
      ),
    ).toThrow(CrossEntityWriteError);
  });

  it('leaves other models and raw queries alone', () => {
    const u = { model: 'User', action: 'findMany', args: { where: { email: 'x' } } };
    expect(scopeParams(u, E)).toBe(u);
    const raw = { action: 'queryRaw', args: {} };
    expect(scopeParams(raw, E)).toBe(raw);
    const audit = { model: 'AuditLog', action: 'findMany', args: { where: { entityId: 'C1' } } };
    expect(scopeParams(audit, E)).toBe(audit);
  });
});
