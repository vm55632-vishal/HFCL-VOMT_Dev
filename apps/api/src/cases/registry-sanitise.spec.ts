import { sanitiseRegistry } from './cases.service';

describe('sanitiseRegistry (data minimisation for reviewers)', () => {
  it('never exposes the full PAN number', () => {
    const pan = sanitiseRegistry('pan', { pan: 'ABCDE1234F', verified: true });
    expect(pan).not.toHaveProperty('pan');
    const msme = sanitiseRegistry('msme', {
      pan: 'ABCDE1234F',
      details: { udyamNumber: 'UDYAM-X' },
    });
    expect(msme).not.toHaveProperty('pan');
    expect(msme.details).toEqual({ udyamNumber: 'UDYAM-X' });
  });

  it('drops Aadhaar / DOB / gender from the PAN result but keeps the name and status', () => {
    const out = sanitiseRegistry('pan', {
      fields: {
        name: 'ACME LTD',
        panStatus: 'Active',
        aadhaarStatus: 'Linked',
        maskedAadhaar: 'XXXX XXXX 1234',
        dob: '01/01/1990',
        gender: 'M',
      },
    });
    expect(out.fields).toEqual({ name: 'ACME LTD', panStatus: 'Active', aadhaarStatus: 'Linked' });
  });

  it('masks the bank account and drops the bank reference / provider message', () => {
    const out = sanitiseRegistry('bank', {
      active: true,
      details: {
        accountNumber: '123456789012',
        holderName: 'ACME LTD',
        bankRRN: '99887766',
        message: 'raw provider response',
        ifsc: 'SBIN0001234',
      },
    });
    const details = out.details as Record<string, unknown>;
    expect(details.accountNumber).toBe('••••9012');
    expect(details).not.toHaveProperty('bankRRN');
    expect(details).not.toHaveProperty('message');
    expect(details.holderName).toBe('ACME LTD');
  });

  it('leaves GST results intact', () => {
    const out = sanitiseRegistry('gst', { details: { gstStatus: 'Active', legalName: 'ACME' } });
    expect(out.details).toEqual({ gstStatus: 'Active', legalName: 'ACME' });
  });
});
