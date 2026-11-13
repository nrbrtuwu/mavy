import { describe, expect, test } from 'bun:test';
import {
  clock,
  delayStatus,
  durationText,
  liveText,
  platformText,
  savedLabel,
  serviceDateLabel,
  shiftDate,
  timeParts,
  today,
} from '../web/src/lib/format.ts';

const NOW = Date.parse('2026-11-12T23:30:00+01:00');

describe('format', () => {
  test('dates', () => {
    expect(today(NOW)).toBe('2026-11-12');
    expect(today(Date.parse('2026-11-12T23:30:00Z'))).toBe('2026-11-13'); // 00:30 in Budapest
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('timeParts adds a day word when not today', () => {
    expect(timeParts('2026-11-12T23:45:00+01:00', NOW)).toEqual({ time: '23:45', day: '' });
    expect(timeParts('2026-11-13T00:52:00+01:00', NOW)).toEqual({ time: '00:52', day: 'holnap' });
    expect(timeParts('2026-11-11T22:00:00+01:00', NOW)).toEqual({ time: '22:00', day: 'tegnap' });
    expect(timeParts('2026-11-20T08:00:00+01:00', NOW)).toEqual({ time: '08:00', day: 'nov. 20.' });
    expect(timeParts(null, NOW)).toEqual({ time: '', day: '' });
  });

  test('serviceDateLabel', () => {
    expect(serviceDateLabel('20261112', NOW)).toBe('ma');
    expect(serviceDateLabel('20261111', NOW)).toBe('tegnap');
    expect(serviceDateLabel('20261120', NOW)).toBe('2026. nov. 20.');
  });

  test('savedLabel', () => {
    expect(savedLabel(Date.parse('2026-11-12T08:57:00+01:00'), NOW)).toBe('08:57');
    expect(savedLabel(Date.parse('2026-11-11T22:10:00+01:00'), NOW)).toBe('tegnap 22:10');
    expect(savedLabel(Date.parse('2026-11-03T18:00:00+01:00'), NOW)).toBe('nov. 3. 18:00');
  });

  test('clock shows Budapest time', () => {
    expect(clock('2026-11-12T05:54:40.000Z')).toBe('06:54');
    expect(clock(Date.parse('2026-07-01T06:05:00Z'))).toBe('08:05');
  });

  test('delayStatus: late/cancelled (shown red), bold from 5 minutes', () => {
    expect(delayStatus({ delayMin: 12 }, false)).toEqual({ kind: 'late', text: '+12 perc', strong: true });
    expect(delayStatus({ delayMin: 4 }, false)).toEqual({ kind: 'late', text: '+4 perc', strong: false });
    expect(delayStatus({ delayMin: 5 }, false).strong).toBe(true);
    expect(delayStatus({ delayMin: 0 }, false).text).toBe('időben');
    expect(delayStatus({ delayMin: -1 }, false).text).toBe('időben');
    expect(delayStatus({ delayMin: null }, false)).toEqual({ kind: 'unknown', text: 'nincs adat', strong: false });
    expect(delayStatus({ delayMin: 30 }, true)).toEqual({ kind: 'cancelled', text: 'törölve', strong: true });
  });

  test('small texts', () => {
    expect(durationText(45)).toBe('45 p');
    expect(durationText(170)).toBe('2 ó 50 p');
    expect(durationText(120)).toBe('2 ó');
    expect(platformText('4')).toBe('4. vágány');
    expect(platformText('4a')).toBe('4a vágány');
    expect(platformText(null)).toBe('');
    expect(liveText({ state: 'none', fetchedAt: null })).toContain('Nincs élő késésadat');
    expect(liveText({ state: 'stale', fetchedAt: '2026-11-12T05:54:40.000Z' })).toBe('Az élő adat nem friss (utoljára 06:54)');
  });
});
