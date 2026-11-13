import { describe, expect, test } from 'bun:test';
import { LiveCache } from '../src/live/cache.ts';
import { LiveUnavailableError } from '../src/live/types.ts';

/** Cache on a fake clock. sleep() advances the clock instead of waiting. */
function setup(opts: { random?: number } = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const cache = new LiveCache({
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => opts.random ?? 0.5, // jitter factor 1.0
  });
  return { cache, sleeps, advance: (ms: number) => (clock += ms), now: () => clock };
}

function counter<T>(value: T) {
  const fn = Object.assign(async () => {
    fn.calls++;
    return value;
  }, { calls: 0 });
  return fn;
}

const failing = async (): Promise<never> => {
  throw new Error('HTTP 503');
};

describe('LiveCache', () => {
  test('serves from cache within ttl, refetches after', async () => {
    const { cache, advance } = setup();
    const load = counter('a');
    expect((await cache.get('k', load)).value).toBe('a');
    advance(44_000);
    expect(await cache.get('k', load)).toMatchObject({ value: 'a', stale: false });
    expect(load.calls).toBe(1);
    advance(2_000);
    await cache.get('k', load);
    expect(load.calls).toBe(2);
  });

  test('concurrent requests for the same key share one upstream call', async () => {
    const { cache } = setup();
    const load = counter('a');
    const results = await Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
    expect(results.map((r) => r.value)).toEqual(['a', 'a', 'a']);
    expect(load.calls).toBe(1);
  });

  test('null results are cached too (unknown train is not an error)', async () => {
    const { cache } = setup();
    const load = counter(null);
    await cache.get('k', load);
    await cache.get('k', load);
    expect(load.calls).toBe(1);
  });

  test('upstream requests are spaced out', async () => {
    const { cache, sleeps } = setup();
    await Promise.all([cache.get('a', counter(1)), cache.get('b', counter(2)), cache.get('c', counter(3))]);
    expect(sleeps).toEqual([300, 300]);
  });

  test('failure: throws without cache, then backs off without calling upstream', async () => {
    const { cache, advance } = setup();
    await expect(cache.get('k', failing)).rejects.toBeInstanceOf(LiveUnavailableError);
    expect(cache.status()).toMatchObject({ state: 'backoff', lastError: 'HTTP 503' });

    const load = counter('a');
    await expect(cache.get('other', load)).rejects.toBeInstanceOf(LiveUnavailableError);
    expect(load.calls).toBe(0); // backoff is upstream-wide

    advance(5_001);
    expect((await cache.get('other', load)).value).toBe('a');
    expect(cache.status().state).toBe('ok');
  });

  test('backoff doubles and is capped at 5 minutes', async () => {
    const { cache, advance, now } = setup();
    const waits: number[] = [];
    for (let i = 0; i < 9; i++) {
      await cache.get('k', failing).catch(() => {});
      const retryAt = Date.parse(cache.status().retryAt!);
      waits.push(retryAt - now());
      advance(retryAt - now() + 1);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
  });

  test('jitter never exceeds the cap', async () => {
    const { cache, advance, now } = setup({ random: 0.999 });
    for (let i = 0; i < 10; i++) {
      await cache.get('k', failing).catch(() => {});
      const wait = Date.parse(cache.status().retryAt!) - now();
      expect(wait).toBeLessThanOrEqual(300_000);
      advance(wait + 1);
    }
  });

  test('serves the last good copy marked stale when upstream fails', async () => {
    const { cache, advance } = setup();
    const first = await cache.get('k', counter('old'));
    advance(60_000);
    expect(await cache.get<string>('k', failing)).toEqual({ value: 'old', fetchedAt: first.fetchedAt, stale: true });
    // still in backoff: stale copy again, no upstream call
    const load = counter('new');
    expect((await cache.get('k', load)).stale).toBe(true);
    expect(load.calls).toBe(0);
  });

  test('a stale copy older than 15 minutes is not served', async () => {
    const { cache, advance } = setup();
    await cache.get('k', counter('old'));
    advance(16 * 60_000);
    await expect(cache.get('k', failing)).rejects.toBeInstanceOf(LiveUnavailableError);
  });

  test('evicts the oldest entries beyond maxEntries', async () => {
    const cache = new LiveCache({ maxEntries: 2, minIntervalMs: 0, now: () => 0, sleep: async () => {} });
    for (const k of ['a', 'b', 'c']) await cache.get(k, counter(k));
    expect(cache.status().cachedEntries).toBe(2);
    const load = counter('a2');
    await cache.get('a', load);
    expect(load.calls).toBe(1); // 'a' was evicted
  });

  test('status before any request is unknown', () => {
    expect(setup().cache.status()).toMatchObject({ state: 'unknown', lastSuccessAt: null, retryAt: null });
  });
});
