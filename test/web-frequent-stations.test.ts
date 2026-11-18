// Most picked stations (route form and station search), stored on the device.
import { describe, expect, test } from 'bun:test';
import { addPick, frequentFirst, parseCounts, topStations } from '../web/src/lib/frequent-stations.ts';

const A = { id: 'A', name: 'Alsógalla' };
const B = { id: 'B', name: 'Budapest-Déli' };
const C = { id: 'C', name: 'Győr' };

describe('frequent stations', () => {
  test('most picked first, ties broken by the latest pick', () => {
    let c = addPick({}, A, 1);
    c = addPick(c, B, 2);
    c = addPick(c, B, 3);
    c = addPick(c, C, 4);
    expect(topStations(c).map((s) => s.id)).toEqual(['B', 'C', 'A']);
    expect(topStations(c, 1)).toEqual([B]);
  });

  test('top 5 only, and at most 50 stations remembered', () => {
    let c = {};
    for (let i = 0; i < 60; i++) c = addPick(c, { id: `S${i}`, name: `S${i}` }, i);
    expect(Object.keys(c)).toHaveLength(50);
    expect(topStations(c)).toHaveLength(5);
    expect(topStations(c)[0]!.id).toBe('S59');
  });

  test('a renamed station keeps its count with the new name', () => {
    const c = addPick(addPick({}, A, 1), { id: 'A', name: 'Alsógalla mh.' }, 2);
    expect(c.A).toEqual({ name: 'Alsógalla mh.', count: 2, last: 2 });
  });

  test('search results: top stations first, in top order, the rest unchanged', () => {
    const results = [A, B, C, { id: 'D', name: 'Debrecen' }];
    expect(frequentFirst(results, [C, A]).map((s) => s.id)).toEqual(['C', 'A', 'B', 'D']);
    expect(frequentFirst(results, []).map((s) => s.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  test('broken storage gives no counts, broken entries are skipped', () => {
    expect(parseCounts(null)).toEqual({});
    expect(parseCounts('not json')).toEqual({});
    expect(parseCounts('[1]')).toEqual({});
    expect(parseCounts('{"A":{"name":"Alsógalla","count":2,"last":5},"B":{"count":"x"},"C":null}')).toEqual({
      A: { name: 'Alsógalla', count: 2, last: 5 },
    });
  });
});
