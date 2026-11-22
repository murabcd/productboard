/** Bounded recent results. Reading promotes an entry without extending its freshness. */

export const READ_CACHE_MS = 60_000;

export class RecentCache<K, V> {
  private entries: { key: K; value: V; updated: number }[] = [];

  constructor(
    private readonly capacity: number,
    private readonly equal: (a: K, b: K) => boolean = Object.is,
  ) {}

  get(key: K): { value: V; updated: number } | undefined {
    const at = this.entries.findIndex((entry) => this.equal(entry.key, key));
    const entry = this.entries[at];
    if (!entry) return;
    this.entries.splice(at, 1);
    this.entries.push(entry);
    return entry;
  }

  set(key: K, value: V, updated: number): void {
    this.entries = this.entries.filter((entry) => !this.equal(entry.key, key));
    this.entries.push({ key, value, updated });
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }
}
