import { describe, expect, test } from 'bun:test';
import { parseLastRoute } from '../web/src/lib/last-route.ts';

describe('last route stored on the device', () => {
  test('reads both stations back', () => {
    const raw = JSON.stringify({ from: { id: '267', name: 'Budapest-Keleti' }, to: { id: '3652', name: 'Tata' } });
    expect(parseLastRoute(raw)).toEqual({
      from: { id: '267', name: 'Budapest-Keleti' },
      to: { id: '3652', name: 'Tata' },
    });
  });

  test('one side empty is kept empty', () => {
    expect(parseLastRoute('{"from":{"id":"267","name":"Budapest-Keleti"},"to":null}')).toEqual({
      from: { id: '267', name: 'Budapest-Keleti' },
      to: null,
    });
  });

  test('nothing stored, broken JSON or wrong shapes give empty fields', () => {
    const empty = { from: null, to: null };
    expect(parseLastRoute(null)).toEqual(empty);
    expect(parseLastRoute('not json')).toEqual(empty);
    expect(parseLastRoute('{"from":{"id":5},"to":"Tata"}')).toEqual(empty);
    // Extra fields are dropped.
    expect(parseLastRoute('{"from":{"id":"1","name":"A","x":1},"to":null}').from).toEqual({ id: '1', name: 'A' });
  });
});
