import type { AppConfig } from '@vop/config';
import { PanVerificationService } from './pan-verification.service';

const config = {
  panVerify: {
    enabled: true,
    baseUrl: 'https://provider.example.test',
    serviceTypeId: '66',
    gstServiceTypeId: '12',
    token: undefined,
  },
} as unknown as AppConfig;

const prisma = { integrationToken: { findUnique: async () => ({ token: 'stored-token' }) } };

function service(cache?: { get: () => Promise<unknown>; set: () => Promise<void> }) {
  const noCache = { get: async () => null, set: async () => undefined };
  return new PanVerificationService(config, prisma as never, (cache ?? noCache) as never);
}

const reply = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe('PanVerificationService.verify', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reports a provider error that arrives inside an HTTP 200, instead of calling it a record', async () => {
    global.fetch = (() =>
      reply({
        response: {
          body: {
            statusCode: 425,
            statusMsg: 'Something went wrong',
            data: { message: [{ code: 401, message: 'IP not whitelisted' }] },
          },
        },
      })) as typeof fetch;
    const r = await service().verify('ABCDE1234F');
    expect(r.verified).toBe(false);
    expect(r.message).toMatch(/not whitelisted/i);
    expect(r.fields).toBeUndefined();
  });

  it('does not treat a record with no holder name as verified', async () => {
    global.fetch = (() =>
      reply({
        response: { body: { statusCode: 200, data: { message: [{ pan_number: 'ABCDE1234F' }] } } },
      })) as typeof fetch;
    const r = await service().verify('ABCDE1234F');
    expect(r.verified).toBe(false);
  });

  it('verifies a normal record and maps the holder name', async () => {
    global.fetch = (() =>
      reply({
        response: {
          body: {
            statusCode: 200,
            data: {
              message: [{ pan_number: 'ABCDE1234F', full_name: 'TEST PERSON', category: 'person' }],
            },
          },
        },
      })) as typeof fetch;
    const r = await service().verify('ABCDE1234F');
    expect(r.verified).toBe(true);
    expect(r.name).toBe('TEST PERSON');
  });

  it('ignores an earlier cached "verified" answer that has no name', async () => {
    const stale = { pan: 'ABCDE1234F', verified: true, fields: { aadhaarStatus: 'Not available' } };
    let calls = 0;
    global.fetch = (() => {
      calls += 1;
      return reply({
        response: {
          body: {
            statusCode: 200,
            data: { message: [{ pan_number: 'ABCDE1234F', full_name: 'TEST PERSON' }] },
          },
        },
      });
    }) as typeof fetch;
    const r = await service({ get: async () => stale, set: async () => undefined }).verify(
      'ABCDE1234F',
      'scope-1',
    );
    expect(calls).toBeGreaterThan(0);
    expect(r.name).toBe('TEST PERSON');
  });
});
