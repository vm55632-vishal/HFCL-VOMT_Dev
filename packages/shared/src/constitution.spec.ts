import {
  constitutionFromGst,
  constitutionFromPan,
  managementRole,
  vendorDisplayName,
} from './constitution';

describe('constitution', () => {
  it('asks about the right people for each constitution', () => {
    expect(managementRole('sole_proprietorship')).toBe('proprietor');
    expect(managementRole('partnership')).toBe('partner');
    expect(managementRole('llp')).toBe('partner');
    expect(managementRole('private_limited')).toBe('director');
    expect(managementRole('one_person_company')).toBe('director');
    expect(managementRole('huf')).toBe('karta');
    expect(managementRole('charitable_trust')).toBeNull();
    expect(managementRole(undefined)).toBeNull();
  });

  it('maps the GST constitution of business', () => {
    expect(constitutionFromGst('Proprietorship')).toBe('sole_proprietorship');
    expect(constitutionFromGst('Sole Proprietorship')).toBe('sole_proprietorship');
    expect(constitutionFromGst('Private Limited Company')).toBe('private_limited');
    expect(constitutionFromGst('Public Limited Company')).toBe('public_limited');
    expect(constitutionFromGst('Limited Liability Partnership')).toBe('llp');
    expect(constitutionFromGst('Partnership')).toBe('partnership');
    expect(constitutionFromGst('Hindu Undivided Family')).toBe('huf');
    expect(constitutionFromGst('One Person Company')).toBe('one_person_company');
    expect(constitutionFromGst('Trust')).toBe('charitable_trust');
    expect(constitutionFromGst('Society/ Club/ Trust/ AOP')).toBe('other');
    expect(constitutionFromGst('Government Department')).toBe('other');
  });

  it('suggests the constitution from the PAN holder category', () => {
    expect(constitutionFromPan('ABCPE1234F')?.value).toBe('sole_proprietorship');
    expect(constitutionFromPan('ABCHE1234F')?.value).toBe('huf');
    expect(constitutionFromPan('ABCFE1234F')).toMatchObject({ value: 'partnership' });
    expect(constitutionFromPan('ABCCE1234F')?.note).toMatch(/company/);
    expect(constitutionFromPan('ABCTE1234F')?.value).toBe('charitable_trust');
    expect(constitutionFromPan('ABCGE1234F')?.value).toBe('other');
    expect(constitutionFromPan('')).toBeUndefined();
  });
});

describe('vendorDisplayName', () => {
  const v = { legalName: 'INDRAMANI MISHRA', tradeName: 'KINE INFOTECH' };
  it('shows a sole proprietorship under its trade name', () => {
    expect(vendorDisplayName({ ...v, constitution: 'sole_proprietorship' })).toBe('KINE INFOTECH');
  });
  it('falls back to the legal name when the trade name is NA or blank', () => {
    for (const tradeName of ['NA', 'n/a', 'N.A.', '-', '  ', null]) {
      expect(vendorDisplayName({ ...v, tradeName, constitution: 'sole_proprietorship' })).toBe(
        'INDRAMANI MISHRA',
      );
    }
  });
  it('shows every other constitution under its legal name', () => {
    expect(vendorDisplayName({ ...v, constitution: 'private_limited' })).toBe('INDRAMANI MISHRA');
    expect(vendorDisplayName({ ...v, constitution: null })).toBe('INDRAMANI MISHRA');
  });
});
