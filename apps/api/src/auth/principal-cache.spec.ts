import type { AuthUser } from './auth-user';
import { principalCache } from './principal-cache';

const user = (id: string): AuthUser =>
  ({
    id,
    email: `${id}@x.test`,
    name: id,
    status: 'ACTIVE',
    roles: ['proposer'],
    permissions: new Set(['vendor:create']),
    managerId: null,
    sessionId: 's',
  }) as unknown as AuthUser;

describe('principalCache', () => {
  beforeEach(() => principalCache.clear());
  afterEach(() => jest.useRealTimers());

  it('returns the principal for the same token and nothing for another token', () => {
    principalCache.set('token-a', user('u1'));
    expect(principalCache.get('token-a')?.id).toBe('u1');
    expect(principalCache.get('token-b')).toBeNull();
  });

  it('expires entries after the TTL', () => {
    jest.useFakeTimers();
    principalCache.set('token-a', user('u1'));
    jest.advanceTimersByTime(19_000);
    expect(principalCache.get('token-a')).not.toBeNull();
    jest.advanceTimersByTime(2_000);
    expect(principalCache.get('token-a')).toBeNull();
  });

  it('invalidateUser drops every cached token for that user only', () => {
    principalCache.set('t1', user('u1'));
    principalCache.set('t2', user('u1'));
    principalCache.set('t3', user('u2'));
    principalCache.invalidateUser('u1'); // e.g. deactivated or roles changed
    expect(principalCache.get('t1')).toBeNull();
    expect(principalCache.get('t2')).toBeNull();
    expect(principalCache.get('t3')?.id).toBe('u2');
  });

  it('clear() empties the cache', () => {
    principalCache.set('t1', user('u1'));
    principalCache.clear();
    expect(principalCache.get('t1')).toBeNull();
  });
});
