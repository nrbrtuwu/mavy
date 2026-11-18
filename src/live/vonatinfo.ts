// Live source: vonatinfo.mav.hu, MÁV's public train map (no login, no captcha).
//
// Unofficial: it is the JSON endpoint the map page itself calls, undocumented and
// may change without notice. Findings: docs/live-api/FINDINGS.md.
//
// Two requests, both for what a user is looking at right now:
//   TRAIN   { vsz: '55' + number }  one train: stops, planned/actual/predicted times,
//                                    platform, current delay, delay reason (HTML)
//   STATION { a: station name }     one station's board for today (HTML)
// The whole-country TRAINS list is never used.
//
// Both answers are HTML fragments. Parsing is tolerant: a page without the
// expected table means "this source does not know it" (null), not an error.

import { z } from 'zod';
import { localDate, localToEpoch, toIso } from '../time.ts';
import { LiveCache } from './cache.ts';
import type { LiveArrival, LiveBoard, LiveDeparture, LiveResult, LiveSource, LiveStatus, LiveStop, LiveTrain, StationRef, TrainRef } from './types.ts';

export const VONATINFO_URL = 'https://vonatinfo.mav.hu/map.aspx/getData';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- HTML helpers

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
function text(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

interface Row {
  attrs: string;
  cells: string[];
  html: string;
}

function rows(html: string): Row[] {
  const out: Row[] = [];
  for (const m of html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const inner = m[2]!;
    const cells = [...inner.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => c[1]!);
    out.push({ attrs: m[1]!, cells, html: inner });
  }
  return out;
}

/** "09:25" -> minutes after midnight. */
function hhmm(s: string): number | null {
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** A time cell: planned time, then optionally `<br><span style="color:red">actual or predicted</span>`. */
function timeCell(cell: string | undefined): { planned: number | null; expected: number | null } {
  if (!cell) return { planned: null, expected: null };
  const [first = '', ...rest] = cell.split(/<br\s*\/?>/i);
  return { planned: hhmm(text(first)), expected: hhmm(text(rest.join(' '))) };
}

/** Notices on a red background. Only delay or cancellation reasons are kept, not service notes. */
function reasons(html: string): string | null {
  const found: string[] = [];
  for (const m of html.matchAll(/<(span|th|td)\b[^>]*background-color:\s*red[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = text(m[2]!);
    if (/késés|késik|töröl|nem közlekedik|kimarad/i.test(t) && !found.includes(t)) found.push(t);
  }
  return found.length ? found.join('; ') : null;
}

const minutesBetween = (planned: string, expected: string) => Math.round((Date.parse(expected) - Date.parse(planned)) / 60000);

/** "A pillanatnyi késés N perc": the train's delay right now (shown as "+N perc"). */
function currentDelay(html: string): number | null {
  const m = /A pillanatnyi késés (\d+) perc/i.exec(text(html));
  return m ? Number(m[1]) : null;
}

/** "2026.11.18." -> "20261118". */
function dottedDate(s: string): string | null {
  const m = /(\d{4})\.(\d{2})\.(\d{2})\./.exec(s);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** Instant for minutes after midnight on a Budapest calendar date (minutes may exceed 24 h). */
function at(date: string, minutes: number): string {
  return toIso(localToEpoch(date, minutes * 60));
}

/** The expected clock time placed on the day nearest to the planned time (handles midnight). */
function nearest(planned: number, expectedClock: number): number {
  let best = expectedClock;
  for (const k of [-1, 0, 1]) {
    const c = expectedClock + k * 1440;
    if (Math.abs(c - planned) < Math.abs(best - planned)) best = c;
  }
  return best;
}

function platform(cell: string | undefined): string | null {
  const t = cell === undefined ? '' : text(cell);
  return t === '' || t === '-' ? null : t;
}

// ---------------------------------------------------------------- TRAIN

/** The TRAIN answer's HTML -> LiveTrain. null if it has no timetable table. */
export function parseTrainHtml(html: string): LiveTrain | null {
  const titleMatch = /<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i.exec(html);
  if (!titleMatch) return null;
  const title = text(titleMatch[1]!);
  const trainNumber = /^\d+/.exec(title)?.[0];
  const serviceDate = dottedDate(title);
  if (!trainNumber || !serviceDate) return null;

  // Stop rows: a station link in the second cell. Hidden detail rows have an id and no link.
  const stopRows = rows(html).filter((r) => r.cells.length >= 5 && /getData\('STATION'/.test(r.cells[1]!));
  if (stopRows.length === 0) return null;

  // Rows the train has passed are styled row_past_*; any stop before such a row is passed too
  // (foreign stops carry no live data and no past styling).
  let lastPast = -1;
  stopRows.forEach((r, i) => {
    if (/row_past/.test(r.attrs)) lastPast = i;
  });

  let dayOffset = 0;
  let prev: number | null = null;
  const abs = (clock: number | null): number | null => {
    if (clock === null) return null;
    if (prev !== null && clock + dayOffset * 1440 < prev - 6 * 60) dayOffset++;
    const v = clock + dayOffset * 1440;
    prev = v;
    return v;
  };

  const stops = stopRows.map((r, i): LiveStop => {
    const arr = timeCell(r.cells[2]);
    const dep = timeCell(r.cells[3]);
    const plannedArr = abs(arr.planned);
    const plannedDep = abs(dep.planned);
    const exp = (planned: number | null, clock: number | null) =>
      planned === null || clock === null ? null : at(serviceDate, nearest(planned, clock));
    return {
      stationCode: null,
      stationName: text(r.cells[1]!),
      plannedArrival: plannedArr === null ? null : at(serviceDate, plannedArr),
      plannedDeparture: plannedDep === null ? null : at(serviceDate, plannedDep),
      expectedArrival: exp(plannedArr, arr.expected),
      expectedDeparture: exp(plannedDep, dep.expected),
      platform: platform(r.cells[4]),
      // Not seen yet in captures; left false until a cancelled train's markup is known.
      cancelled: false,
      passed: i <= lastPast,
    };
  });

  // Header part (before the column headings) carries the delay and its reason.
  const headEnd = html.search(/<th>\s*Km\s*<\/th>/i);
  const head = headEnd > 0 ? html.slice(0, headEnd) : html;
  return {
    tripId: null,
    trainNumber,
    serviceDate,
    cancelled: false,
    delayMin: currentDelay(head),
    reason: reasons(head),
    stops,
  };
}

// ---------------------------------------------------------------- STATION

/** The STATION answer's HTML -> departures and arrivals. null if no board. */
export function parseStationHtml(html: string): LiveBoard | null {
  const titleMatch = /<th\b[^>]*class="title"[^>]*>([\s\S]*?)<\/th>/i.exec(html);
  if (!titleMatch) return null;
  const titleHtml = titleMatch[1]!;
  const date = dottedDate(text(titleHtml));
  if (!date) return null;
  const stationName = text(titleHtml.split(/<br\s*\/?>/i)[0] ?? '');

  const all = rows(html);
  const departures: LiveDeparture[] = [];
  const arrivals: LiveArrival[] = [];
  all.forEach((r, i) => {
    if (r.cells.length < 4 || !/getData\('TRAIN'/.test(r.cells[3]!)) return;
    const trainCell = r.cells[3]!;
    const link = /v:\s*'(\d+)_(\d{6})'[^>]*>\s*(\d+)\s*<\/a>/.exec(trainCell);
    if (!link) return;

    const arr = timeCell(r.cells[0]);
    if (arr.planned !== null) {
      arrivals.push({
        trainNumber: link[3]!,
        serviceDate: `20${link[2]}`,
        plannedArrival: at(date, arr.planned),
        expectedArrival: arr.expected === null ? null : at(date, nearest(arr.planned, arr.expected)),
        platform: platform(r.cells[2]),
      });
    }

    const dep = timeCell(r.cells[1]);
    if (dep.planned === null) return; // terminates here

    // The hidden row right after holds the delay text and reason.
    const detail = all[i + 1] && /\bid="tr/.test(all[i + 1]!.attrs) ? all[i + 1]!.html : '';
    const plannedDeparture = at(date, dep.planned);
    const expectedDeparture = dep.expected === null ? null : at(date, nearest(dep.planned, dep.expected));
    // The time shown is this station's own prediction (no time here = no estimate);
    // "+N perc" is the train's delay right now from the hidden detail row.
    const delayMin = expectedDeparture !== null ? minutesBetween(plannedDeparture, expectedDeparture) : null;
    const currentDelayMin = currentDelay(detail);

    // "TOKAJ IC <br> -- Budapest-Nyugati 11:51": text after "--" is the destination.
    const after = text(trainCell.split(/<\/a>/i)[1] ?? '').split('--')[1];
    const destination = after?.replace(/\s*\d{1,2}:\d{2}\s*$/, '').trim() || null;

    departures.push({
      tripId: null,
      trainNumber: link[3]!,
      serviceDate: `20${link[2]}`,
      destination,
      plannedDeparture,
      expectedDeparture,
      delayMin,
      currentDelayMin,
      platform: platform(r.cells[2]),
      cancelled: false,
      reason: reasons(detail),
    });
  });
  return { stationCode: null, stationName, departures, arrivals };
}

// ---------------------------------------------------------------- client

const Envelope = z.object({ d: z.object({ result: z.unknown() }) });
const TrainResult = z.object({ html: z.string() });

export interface VonatinfoOptions {
  cache?: LiveCache;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

export class VonatinfoSource implements LiveSource {
  private readonly cache: LiveCache;
  private readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => number;

  constructor(opts: VonatinfoOptions = {}) {
    this.cache = opts.cache ?? new LiveCache({ ttlMs: 45_000, minIntervalMs: 1000 });
    this.fetch = opts.fetch ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? Date.now;
  }

  async train(ref: TrainRef): Promise<LiveResult<LiveTrain | null>> {
    const num = ref.trainNumber?.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (!num) return { data: null, fetchedAt: toIso(this.now()), stale: false };
    // vonatinfo prefixes train numbers with 55 and always answers with today's run
    // (a date parameter is ignored), so another service date means "unknown".
    const res = await this.cache.get(`train:${num}`, async () => {
      const result = TrainResult.safeParse(await this.post('TRAIN', { vsz: `55${num}` }));
      return result.success ? parseTrainHtml(result.data.html) : null;
    });
    const data = res.value && res.value.serviceDate === ref.serviceDate ? { ...res.value, tripId: ref.tripId } : null;
    return { data, fetchedAt: toIso(res.fetchedAt), stale: res.stale };
  }

  async departures(station: StationRef): Promise<LiveResult<LiveBoard | null>> {
    const date = localDate(this.now());
    const d = `${date.slice(2, 4)}.${date.slice(4, 6)}.${date.slice(6, 8)}`;
    const res = await this.cache.get(`station:${station.name}:${date}`, async () => {
      const result = await this.post('STATION', { a: station.name, d });
      return typeof result === 'string' ? parseStationHtml(result) : null;
    });
    return { data: res.value, fetchedAt: toIso(res.fetchedAt), stale: res.stale };
  }

  status(): LiveStatus {
    return this.cache.status();
  }

  /** One upstream request. Throws on HTTP or shape errors (the cache then backs off). */
  private async post(action: 'TRAIN' | 'STATION', jo: Record<string, string>): Promise<unknown> {
    const res = await this.fetch(VONATINFO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'User-Agent': USER_AGENT,
        Referer: 'https://vonatinfo.mav.hu/',
        Origin: 'https://vonatinfo.mav.hu',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ a: action, jo: { ...jo, language: '1' } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`vonatinfo ${action}: HTTP ${res.status}`);
    const parsed = Envelope.safeParse(await res.json());
    if (!parsed.success) throw new Error(`vonatinfo ${action}: unexpected response shape`);
    return parsed.data.d.result;
  }
}
