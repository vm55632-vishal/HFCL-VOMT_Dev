import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('loads once and serves the cached value until the TTL expires', async () => {
    jest.useFakeTimers();
    const cache = new TtlCache<number>(1000);
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get('k', load)).toBe(1);
    expect(await cache.get('k', load)).toBe(1); // cached
    expect(load).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1001);
    expect(await cache.get('k', load)).toBe(2); // expired -> reloaded
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = new TtlCache<string>(1000);
    let resolve!: (v: string) => void;
    const load = jest.fn(() => new Promise<string>((r) => (resolve = r)));

    const a = cache.get('k', load);
    const b = cache.get('k', load);
    resolve('v');
    expect(await Promise.all([a, b])).toEqual(['v', 'v']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache<number>(1000);
    const load = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(7);

    await expect(cache.get('k', load)).rejects.toThrow('boom');
    expect(await cache.get('k', load)).toBe(7);
  });

  it('clear() forces a reload', async () => {
    const cache = new TtlCache<number>(60_000);
    const load = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    expect(await cache.get('k', load)).toBe(1);
    cache.clear();
    expect(await cache.get('k', load)).toBe(2);
  });
});
