// Favourites preload: the same cache keys the screens use, at most 5 favourites.
import { describe, expect, test } from 'bun:test';
import { MAX, prefetchPlan } from '../web/src/lib/prefetch-favorites.ts';
import { boardRequest, routeRequest } from '../web/src/lib/screen-requests.ts';

describe('favourites preload', () => {
  test('stations load their board, routes their results for now, under the screens\' keys', () => {
    const plan = prefetchPlan([
      { type: 'station', id: '3639', name: 'Budapest-Déli' },
      { type: 'route', from: { id: '3648', name: 'Alsógalla' }, to: { id: '3661', name: 'Győr' } },
    ]);
    expect(plan.map((r) => r.key)).toEqual([boardRequest('3639').key, routeRequest('3648', '3661', null).key]);
    expect(plan.map((r) => r.key)).toEqual(['board:3639', 'route:3648:3661:null']);
  });

  test('at most 5, in the saved order', () => {
    const favs = Array.from({ length: 8 }, (_, i) => ({ type: 'station' as const, id: `S${i}`, name: `S${i}` }));
    expect(MAX).toBe(5);
    expect(prefetchPlan(favs).map((r) => r.key)).toEqual(['board:S0', 'board:S1', 'board:S2', 'board:S3', 'board:S4']);
  });
});
