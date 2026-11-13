// Europe/Budapest time helpers. No dependencies, uses Intl.
//
// Service dates are 'YYYYMMDD' strings (GTFS format). A GTFS stop time is
// seconds after "noon minus 12h" of the service date, which equals local
// midnight except on DST change days. serviceDayStart() returns that instant,
// so times past 24:00 and DST days come out right.

export const TZ = 'Europe/Budapest';

const DTF = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsOf(ms: number): Parts {
  const p: Record<string, number> = {};
  for (const { type, value } of DTF.formatToParts(ms)) if (type !== 'literal') p[type] = Number(value);
  return {
    year: p.year ?? 0,
    month: p.month ?? 0,
    day: p.day ?? 0,
    hour: p.hour ?? 0,
    minute: p.minute ?? 0,
    second: p.second ?? 0,
  };
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

function splitDate(date: string): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(4, 6)), Number(date.slice(6, 8))];
}

/** Budapest UTC offset in minutes at an instant (+60 in winter, +120 in summer). */
export function offsetMinutes(ms: number): number {
  const p = partsOf(ms);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - (ms - (((ms % 1000) + 1000) % 1000))) / 60000);
}

/** Budapest calendar date of an instant, 'YYYYMMDD'. */
export function localDate(ms: number): string {
  const p = partsOf(ms);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
}

/** Accepts 'YYYYMMDD' or 'YYYY-MM-DD'; returns 'YYYYMMDD' or null if not a real date. */
export function parseServiceDate(input: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = splitDate(date);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = splitDate(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Instant of a Budapest wall-clock time: date + seconds after local midnight. */
export function localToEpoch(date: string, seconds: number): number {
  const [y, m, d] = splitDate(date);
  const wall = Date.UTC(y, m - 1, d) + seconds * 1000;
  let t = wall - offsetMinutes(wall) * 60000;
  t = wall - offsetMinutes(t) * 60000;
  return t;
}

/** Instant that GTFS time 00:00:00 refers to on a service date (noon minus 12h). */
export function serviceDayStart(date: string): number {
  return localToEpoch(date, 12 * 3600) - 12 * 3600 * 1000;
}

/** ISO 8601 with Budapest offset, e.g. '2026-11-12T23:30:00+01:00'. */
export function toIso(ms: number): string {
  const p = partsOf(ms);
  const off = offsetMinutes(ms);
  const sign = off < 0 ? '-' : '+';
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/**
 * Parse a user-supplied time:
 *   'HH:MM'              today in Budapest
 *   'YYYY-MM-DDTHH:MM'   Budapest local
 *   full ISO with Z or offset
 */
export function parseUserTime(input: string, now: number): number | null {
  const s = input.trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return localToEpoch(localDate(now), h * 3600 + mi * 60);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) {
    const date = parseServiceDate(`${m[1]}${m[2]}${m[3]}`);
    if (!date) return null;
    return localToEpoch(date, Number(m[4]) * 3600 + Number(m[5]) * 60 + Number(m[6] ?? 0));
  }
  if (/(Z|[+-]\d{2}:\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
