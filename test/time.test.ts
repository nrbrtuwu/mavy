import { describe, expect, test } from 'bun:test';
import {
  addDays,
  localDate,
  localToEpoch,
  offsetMinutes,
  parseServiceDate,
  parseUserTime,
  serviceDayStart,
  toIso,
  weekdayIndex,
} from '../src/time.ts';

describe('time', () => {
  test('winter and summer offsets', () => {
    expect(offsetMinutes(Date.parse('2026-01-15T12:00:00Z'))).toBe(60);
    expect(offsetMinutes(Date.parse('2026-07-15T12:00:00Z'))).toBe(120);
    expect(toIso(localToEpoch('20260701', 8 * 3600))).toBe('2026-07-01T08:00:00+02:00');
    expect(toIso(localToEpoch('20261112', 23 * 3600 + 30 * 60))).toBe('2026-11-12T23:30:00+01:00');
  });

  test('local date near midnight', () => {
    expect(localDate(Date.parse('2026-11-12T23:30:00Z'))).toBe('20261113'); // 00:30 in Budapest
  });

  test('GTFS times past 24:00 land on the next day', () => {
    expect(toIso(serviceDayStart('20261112') + (24 * 3600 + 50 * 60) * 1000)).toBe('2026-11-13T00:50:00+01:00');
  });

  test('service day start follows GTFS "noon minus 12h" on DST change day', () => {
    // 2026-10-25: clocks go back 03:00 CEST -> 02:00 CET.
    expect(toIso(serviceDayStart('20261025'))).toBe('2026-10-25T01:00:00+02:00');
    expect(toIso(serviceDayStart('20261025') + 10 * 3600 * 1000)).toBe('2026-10-25T10:00:00+01:00');
  });

  test('date helpers', () => {
    expect(addDays('20261231', 1)).toBe('20270101');
    expect(addDays('20260301', -1)).toBe('20260228');
    expect(weekdayIndex('20261112')).toBe(3); // Thursday
    expect(parseServiceDate('2026-11-12')).toBe('20261112');
    expect(parseServiceDate('20260230')).toBeNull();
    expect(parseServiceDate('tomorrow')).toBeNull();
  });

  test('parseUserTime', () => {
    const now = Date.parse('2026-11-12T05:00:00Z'); // 06:00 Budapest
    expect(toIso(parseUserTime('14:05', now)!)).toBe('2026-11-12T14:05:00+01:00');
    expect(toIso(parseUserTime('2026-07-01T08:00', now)!)).toBe('2026-07-01T08:00:00+02:00');
    expect(parseUserTime('2026-11-12T10:00:00Z', now)).toBe(Date.parse('2026-11-12T10:00:00Z'));
    expect(parseUserTime('25:00', now)).toBeNull();
    expect(parseUserTime('soon', now)).toBeNull();
  });
});
