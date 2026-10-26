import { nextAfterApproval, normaliseApprovalLevels } from './stages';

describe('approval levels', () => {
  it('keeps known levels only, without repeats, in L1 -> L2 -> L3 order', () => {
    expect(normaliseApprovalLevels(['l3', 'l1', 'l3', 'x', 7])).toEqual(['l1', 'l3']);
    expect(normaliseApprovalLevels(null)).toEqual([]);
  });

  it('goes from the reviews to the first level the case uses, then on to SAP', () => {
    expect(nextAfterApproval(['l1', 'l2', 'l3'])).toBe('l1');
    expect(nextAfterApproval(['l1', 'l2', 'l3'], 'l1')).toBe('l2');
    expect(nextAfterApproval(['l1', 'l2', 'l3'], 'l3')).toBe('sap');
    expect(nextAfterApproval(['l2'])).toBe('l2');
    expect(nextAfterApproval(['l1', 'l3'], 'l1')).toBe('l3');
  });

  it('goes straight to SAP when the case uses no levels', () => {
    expect(nextAfterApproval([])).toBe('sap');
  });
});
