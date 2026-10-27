import { createSchema, partnerSchema, rcLimitSchema, referenceSchema } from './cases.controller';

const partner = {
  name: 'Anil Sharma',
  dob: '1980-04-15',
  maritalStatus: 'Single',
  gender: 'Male',
  fatherName: 'Ram Sharma',
  pan: 'ABCDE1234F',
  address: '12 MG Road, Mumbai',
  mobile: '9819349395',
  pincode: '400101',
};

const messages = (
  schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } },
  v: unknown,
) => {
  const r = schema.safeParse(v) as { success: boolean; error?: { issues: { message: string }[] } };
  return r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);
};

describe('partnerSchema', () => {
  it('accepts a complete, valid partner', () => {
    expect(partnerSchema.safeParse(partner).success).toBe(true);
  });
  it('accepts a married partner with a spouse name', () => {
    expect(
      partnerSchema.safeParse({ ...partner, maritalStatus: 'Married', spouseName: 'Sita' }).success,
    ).toBe(true);
  });
  it('rejects a malformed date of birth, mobile and pin code', () => {
    expect(messages(partnerSchema, { ...partner, dob: '15-04-1980' })).toContain(
      'Date of birth must be a valid date.',
    );
    expect(messages(partnerSchema, { ...partner, mobile: '12345' })).toContain(
      'Mobile must be a 10-digit Indian number.',
    );
    expect(messages(partnerSchema, { ...partner, pincode: '4001' })).toContain(
      'Pin code must be 6 digits.',
    );
  });
  it('rejects a future date of birth', () => {
    expect(messages(partnerSchema, { ...partner, dob: '2999-01-01' })).toContain(
      'Date of birth must be a past date.',
    );
  });
  it('requires a spouse name when married', () => {
    expect(messages(partnerSchema, { ...partner, maritalStatus: 'Married' })).toContain(
      'Spouse name is required when married.',
    );
  });
  it('rejects an invalid PAN', () => {
    expect(messages(partnerSchema, { ...partner, pan: 'BAD' })).toContain('Enter a valid PAN.');
  });
});

describe('management structure by type of constitution', () => {
  const base = {
    categoryKey: 'vendor_others_domestic',
    legalName: 'Acme Traders',
    businessAddress: '1 Main Road',
    addressCountry: 'India',
    addressState: 'Delhi',
    addressCity: 'Delhi',
    addressPostalCode: '110001',
    references: [
      {
        contactName: 'A',
        businessName: 'B',
        registeredAddress: 'C',
        contactNumber: '9819349395',
        email: 'a@b.com',
      },
      {
        contactName: 'D',
        businessName: 'E',
        registeredAddress: 'F',
        contactNumber: '9819349396',
        email: 'd@e.com',
      },
    ],
    isecItHardware: false,
    isecItSoftware: false,
    isecAccessSystem: false,
    isecAccessNetwork: false,
    isecAccessApps: false,
    isecAccessPii: false,
  };
  const { mobile: _mobile, ...person } = partner;
  const paths = (v: unknown) => {
    const r = createSchema.safeParse(v);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };

  it('requires the type of constitution', () => {
    expect(paths({ ...base, partners: [] })).toContain('constitution');
  });
  it('asks the proprietor for a residence phone, not a mobile', () => {
    const proprietor = { ...base, constitution: 'sole_proprietorship' };
    expect(paths({ ...proprietor, partners: [person] })).toEqual(['partners.0.residencePhone']);
    expect(
      paths({ ...proprietor, partners: [{ ...person, residencePhone: '01342255667' }] }),
    ).toEqual([]);
  });
  it('needs the partners of a firm, with their mobile numbers', () => {
    const firm = { ...base, constitution: 'partnership' };
    expect(paths({ ...firm, partners: [] })).toEqual(['partners']);
    expect(paths({ ...firm, partners: [person] })).toEqual(['partners.0.mobile']);
    expect(paths({ ...firm, partners: [partner, partner] })).toEqual([]);
  });
  it("asks each director for the director's contact and address too", () => {
    const company = { ...base, constitution: 'private_limited' };
    expect(paths({ ...company, partners: [partner] })).toEqual([
      'partners.0.residencePhone',
      'partners.0.contact',
      'partners.0.officeAddress',
    ]);
  });
  it('takes exactly one Karta for an HUF', () => {
    const karta = { ...person, residencePhone: '01342255667' };
    const huf = { ...base, constitution: 'huf' };
    expect(paths({ ...huf, partners: [karta] })).toEqual([]);
    expect(paths({ ...huf, partners: [karta, karta] })).toEqual(['partners']);
  });
  it('asks for no people for other constitutions', () => {
    expect(paths({ ...base, constitution: 'charitable_trust', partners: [] })).toEqual([]);
  });
});

describe('referenceSchema', () => {
  const ref = {
    contactName: 'Ravi Kumar',
    businessName: 'Kumar Motors',
    registeredAddress: '5 Link Road, Pune',
    contactNumber: '+91 98765 43210',
    email: 'ravi@kumarmotors.example.com',
  };
  it('accepts a valid reference', () => {
    expect(referenceSchema.safeParse(ref).success).toBe(true);
  });
  it('rejects a bad email and a bad contact number', () => {
    expect(messages(referenceSchema, { ...ref, email: 'nope' })).toContain(
      'Enter a valid email address.',
    );
    expect(messages(referenceSchema, { ...ref, contactNumber: 'abc' })).toContain(
      'Enter a valid contact number.',
    );
  });
});

describe('rcLimitSchema', () => {
  it('accepts a valid RC limit row', () => {
    expect(
      rcLimitSchema.safeParse({
        financerName: 'ABC Finance',
        rcLimit: 1500000,
        numberOfVehicles: 3,
      }).success,
    ).toBe(true);
  });
  it('requires a whole number of vehicles of at least 1', () => {
    expect(
      rcLimitSchema.safeParse({ financerName: 'X', rcLimit: 1, numberOfVehicles: 0 }).success,
    ).toBe(false);
    expect(
      rcLimitSchema.safeParse({ financerName: 'X', rcLimit: 1, numberOfVehicles: 1.5 }).success,
    ).toBe(false);
  });
});
