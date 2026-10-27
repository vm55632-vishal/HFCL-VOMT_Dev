import { managementRole, suggestConstitution } from './constitution';

describe('constitution', () => {
  it('asks about the right people for each constitution', () => {
    expect(managementRole('sole_proprietorship')).toBe('proprietor');
    expect(managementRole('partnership')).toBe('partner');
    expect(managementRole('private_limited')).toBe('director');
    expect(managementRole('huf')).toBe('karta');
    expect(managementRole('trust_society')).toBeNull();
    expect(managementRole(undefined)).toBeNull();
  });

  it('suggests the constitution from GST first, then the PAN holder type', () => {
    expect(suggestConstitution('ABCPE1234F', 'Proprietorship')).toBe('sole_proprietorship');
    expect(suggestConstitution('ABCPE1234F', 'Private Limited Company')).toBe('private_limited');
    expect(suggestConstitution('ABCFE1234F', 'Limited Liability Partnership')).toBe('llp');
    expect(suggestConstitution('ABCHE1234F')).toBe('huf');
    expect(suggestConstitution('ABCFE1234F')).toBe('partnership');
    expect(suggestConstitution('')).toBeUndefined();
  });
});
