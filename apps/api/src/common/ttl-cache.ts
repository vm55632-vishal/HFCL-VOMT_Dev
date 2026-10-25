/**
 * Tiny in-process TTL cache with in-flight de-duplication, for slow-changing master data
 * (categories, published workflow definitions) that is read on almost every request. With a remote
 * database each read is a full network round trip, so caching these cuts a lot of latency.
 *
 * Writers must call {@link clear} after changing the underlying data so admins see edits at once.
 * (Single API instance: the TTL bounds staleness if you later run several instances.)
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(private readonly ttlMs: number) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const p = load()
      .then((value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  clear(): void {
    this.entries.clear();
  }
}
