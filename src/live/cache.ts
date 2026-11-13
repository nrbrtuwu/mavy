// Shared cache, request pacing and error backoff for an upstream live API.
// Knows nothing about MÁV; the live client (e.g. a future GTFS-RT client) uses it.
//
// - Fresh hit (age < ttl): served from memory, no upstream request.
// - Concurrent misses for the same key share one upstream request.
// - Upstream requests are serialized with a minimum gap (no bursts).
// - Any failure puts the whole upstream into exponential backoff (max 5 min).
//   During backoff, and when a request fails, the last good copy is served
//   marked stale (if not older than staleMs); otherwise LiveUnavailableError.

import { LiveUnavailableError, type LiveStatus } from './types.ts';

export interface CacheOptions {
  /** How long a response is fresh. CLAUDE.md: 30 to 60 s. */
  ttlMs?: number;
  /** How long an old copy may still be served while upstream fails. */
  staleMs?: number;
  maxEntries?: number;
  /** Minimum gap between two upstream requests. */
  minIntervalMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface Cached<T> {
  value: T;
  fetchedAt: number;
  stale: boolean;
}

interface Entry {
  value: unknown;
  fetchedAt: number;
}

export class LiveCache {
  readonly ttlMs: number;
  private readonly staleMs: number;
  private readonly maxEntries: number;
  private readonly minIntervalMs: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  private readonly entries = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>();
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  private failures = 0;
  private backoffUntil = 0;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastError: string | null = null;

  constructor(opts: CacheOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 45_000;
    this.staleMs = opts.staleMs ?? 15 * 60_000;
    this.maxEntries = opts.maxEntries ?? 500;
    this.minIntervalMs = opts.minIntervalMs ?? 300;
    this.baseBackoffMs = opts.baseBackoffMs ?? 5_000;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5 * 60_000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /** Cached value for key, calling loader at most once per ttl across all callers. */
  async get<T>(key: string, loader: () => Promise<T>): Promise<Cached<T>> {
    const now = this.now();
    const hit = this.entries.get(key);
    if (hit && now - hit.fetchedAt < this.ttlMs) return { value: hit.value as T, fetchedAt: hit.fetchedAt, stale: false };

    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<Cached<T>>;

    if (now < this.backoffUntil) return this.staleOrThrow<T>(key, now);

    const p = this.load(key, loader).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  status(): LiveStatus {
    const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
    const inBackoff = this.now() < this.backoffUntil;
    return {
      state: inBackoff ? 'backoff' : this.lastSuccessAt === null && this.lastErrorAt === null ? 'unknown' : this.failures > 0 ? 'backoff' : 'ok',
      lastSuccessAt: iso(this.lastSuccessAt),
      lastErrorAt: iso(this.lastErrorAt),
      lastError: this.lastError,
      retryAt: inBackoff ? iso(this.backoffUntil) : null,
      cachedEntries: this.entries.size,
    };
  }

  private async load<T>(key: string, loader: () => Promise<T>): Promise<Cached<T>> {
    await this.throttle();
    // Another request may have failed while this one waited in the queue.
    if (this.now() < this.backoffUntil) return this.staleOrThrow<T>(key, this.now());
    try {
      const value = await loader();
      const t = this.now();
      this.entries.delete(key); // re-insert so Map order = age, for eviction
      this.entries.set(key, { value, fetchedAt: t });
      while (this.entries.size > this.maxEntries) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.entries.delete(oldest);
      }
      this.failures = 0;
      this.backoffUntil = 0;
      this.lastSuccessAt = t;
      return { value, fetchedAt: t, stale: false };
    } catch (err) {
      const t = this.now();
      this.failures++;
      const exp = this.baseBackoffMs * 2 ** Math.min(this.failures - 1, 20);
      const jitter = 0.8 + 0.4 * this.random();
      this.backoffUntil = t + Math.min(this.maxBackoffMs, exp * jitter);
      this.lastErrorAt = t;
      this.lastError = err instanceof Error ? err.message : String(err);
      return this.staleOrThrow<T>(key, t);
    }
  }

  private throttle(): Promise<void> {
    const run = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  private staleOrThrow<T>(key: string, now: number): Cached<T> {
    const hit = this.entries.get(key);
    if (hit && now - hit.fetchedAt < this.staleMs) return { value: hit.value as T, fetchedAt: hit.fetchedAt, stale: true };
    throw new LiveUnavailableError(this.lastError ?? 'live API unavailable', this.backoffUntil || null);
  }
}
