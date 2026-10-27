import { MockKycProvider, NotImplementedKyc } from './kyc.adapters';

describe('MockKycProvider', () => {
  const provider = new MockKycProvider();
  const subject = { name: 'Rahul Sharma', pan: 'ABCDE1234F' };

  afterEach(() => jest.useRealTimers());

  it('runs a check for a few seconds, then passes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T10:00:00Z'));
    const { ref } = await provider.start('digi_kyc', subject);
    expect((await provider.poll('digi_kyc', ref)).status).toBe('in_progress');
    jest.setSystemTime(new Date('2026-10-24T10:00:09Z'));
    const done = await provider.poll('digi_kyc', ref);
    expect(done.status).toBe('passed');
    expect(done.summary).toMatch(/verified/i);
  });

  it('fails only the check whose marker appears in the signatory name', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T10:00:00Z'));
    const bad = { ...subject, name: 'Test Fraud Kumar' };
    const hunter = await provider.start('hunter', bad);
    const digi = await provider.start('digi_kyc', bad);
    jest.setSystemTime(new Date('2026-10-24T10:00:10Z'));
    expect((await provider.poll('hunter', hunter.ref)).status).toBe('failed');
    expect((await provider.poll('digi_kyc', digi.ref)).status).toBe('passed');
  });

  it('leaves Digi KYC incomplete, with the reason, when the vendor never finishes it', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-24T10:00:00Z'));
    const { ref } = await provider.start('digi_kyc', { ...subject, name: 'Noshow Kumar' });
    jest.setSystemTime(new Date('2026-10-24T10:00:10Z'));
    const done = await provider.poll('digi_kyc', ref);
    expect(done.status).toBe('incomplete');
    expect(done.summary).toMatch(/did not complete/);
  });

  it('treats a malformed reference as still running rather than crashing', async () => {
    expect((await provider.poll('ixsite', 'garbage')).status).toBe('in_progress');
  });
});

describe('NotImplementedKyc', () => {
  it('refuses to run until a live provider is configured', async () => {
    await expect(new NotImplementedKyc().start()).rejects.toThrow(/not configured/);
  });
});
