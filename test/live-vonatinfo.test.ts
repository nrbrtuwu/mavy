// vonatinfo.mav.hu parsing, against answers captured on 2026-11-18 around 10:10 Budapest time.
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { LiveCache } from '../src/live/cache.ts';
import { parseStationHtml, parseTrainHtml, VONATINFO_URL, VonatinfoSource } from '../src/live/vonatinfo.ts';

const DIR = join(import.meta.dir, 'fixtures', 'vonatinfo');
const trainHtml = await Bun.file(join(DIR, 'train-141.html')).text();
const stationHtml = await Bun.file(join(DIR, 'station-keleti.html')).text();
const NOW = Date.parse('2026-11-18T10:10:00+01:00');

describe('parseTrainHtml', () => {
  const train = parseTrainHtml(trainHtml)!;

  it('reads number, date, delay and reason', () => {
    expect(train.trainNumber).toBe('141');
    expect(train.serviceDate).toBe('20261118');
    expect(train.delayMin).toBe(23); // "A pillanatnyi késés 23 perc"
    expect(train.reason).toBe('Társvasúttól átvett késés');
    expect(train.cancelled).toBe(false);
  });

  it('reads every stop with planned and expected times and platforms', () => {
    expect(train.stops.map((s) => s.stationName)).toEqual([
      'Wien Westbf',
      'Wien Meidling',
      'Wien Hbf',
      'Hegyeshalom',
      'Mosonmagyaróvár',
      'Győr',
      'Tatabánya',
      'Budapest-Kelenföld',
      'Budapest-Keleti',
    ]);
    const kelenfold = train.stops[7]!;
    expect(kelenfold).toMatchObject({
      plannedArrival: '2026-11-18T11:02:00+01:00',
      expectedArrival: '2026-11-18T11:25:00+01:00',
      plannedDeparture: '2026-11-18T11:11:00+01:00',
      expectedDeparture: '2026-11-18T11:26:00+01:00',
      platform: '15',
      passed: false,
    });
    const westbf = train.stops[0]!;
    expect(westbf).toMatchObject({
      plannedArrival: null,
      plannedDeparture: '2026-11-18T08:00:00+01:00',
      expectedDeparture: null,
      platform: null,
    });
  });

  it('marks stops up to the last passed row as passed', () => {
    expect(train.stops.map((s) => s.passed)).toEqual([true, true, true, true, true, false, false, false, false]);
  });

  it('returns null for a page without a timetable', () => {
    expect(parseTrainHtml('<div>Nincs adat</div>')).toBeNull();
  });
});

describe('parseStationHtml', () => {
  const board = parseStationHtml(stationHtml)!;
  const byNumber = (n: string) => board.departures.find((d) => d.trainNumber === n);

  it('reads the station and skips trains that end here', () => {
    expect(board.stationName).toBe('Budapest-Keleti');
    expect(board.departures.map((d) => d.trainNumber).sort()).toEqual(['3068', '3110', '367', '582']);
    expect(byNumber('3319')).toBeUndefined();
  });

  it('uses the red time as expected departure, with delay reason', () => {
    expect(byNumber('582')).toMatchObject({
      serviceDate: '20261118',
      destination: 'Budapest-Nyugati',
      plannedDeparture: '2026-11-18T04:45:00+01:00',
      expectedDeparture: '2026-11-18T04:46:00+01:00',
      delayMin: 1,
      currentDelayMin: 9,
      platform: '4',
      reason: 'Pálya állapota miatti késés',
    });
  });

  it('gives no time estimate without a time at this station, but keeps the current delay', () => {
    expect(byNumber('367')).toMatchObject({ expectedDeparture: null, delayMin: null, currentDelayMin: 15, destination: 'Braşov' });
  });

  it('does not treat service notes as delay reasons', () => {
    expect(byNumber('3110')?.reason).toBeNull();
  });
});

describe('VonatinfoSource', () => {
  function source(answer: (body: any) => unknown) {
    const calls: any[] = [];
    const src = new VonatinfoSource({
      now: () => NOW,
      cache: new LiveCache({ now: () => NOW, sleep: async () => {} }),
      fetch: async (url, init) => {
        expect(url).toBe(VONATINFO_URL);
        const body = JSON.parse(String(init.body));
        calls.push(body);
        return Response.json({ d: { result: answer(body) } });
      },
    });
    return { src, calls };
  }

  it('asks for one train by its 55-prefixed number and caches it', async () => {
    const { src, calls } = source(() => ({ html: trainHtml, line: [] }));
    const ref = { tripId: 'T141', trainNumber: '141', serviceDate: '20261118' };
    const first = await src.train(ref);
    await src.train(ref);
    expect(calls).toEqual([{ a: 'TRAIN', jo: { vsz: '55141', language: '1' } }]);
    expect(first.data).toMatchObject({ tripId: 'T141', delayMin: 23 });
  });

  it('gives no data for another service date', async () => {
    const { src } = source(() => ({ html: trainHtml }));
    const res = await src.train({ tripId: 'T141', trainNumber: '141', serviceDate: '20261117' });
    expect(res.data).toBeNull();
  });

  it('asks for a station board by name and today', async () => {
    const { src, calls } = source(() => stationHtml);
    const res = await src.departures({ gtfsStopId: 'BPK', name: 'Budapest-Keleti' });
    expect(calls).toEqual([{ a: 'STATION', jo: { a: 'Budapest-Keleti', d: '26.11.18', language: '1' } }]);
    expect(res.data?.departures).toHaveLength(4);
  });

  it('turns HTTP errors into backoff', async () => {
    const src = new VonatinfoSource({
      now: () => NOW,
      cache: new LiveCache({ now: () => NOW, sleep: async () => {} }),
      fetch: async () => new Response('busy', { status: 503 }),
    });
    await expect(src.departures({ gtfsStopId: 'BPK', name: 'Budapest-Keleti' })).rejects.toThrow();
    expect(src.status().state).toBe('backoff');
  });
});


describe('station board arrivals', () => {
  const board = parseStationHtml(stationHtml)!;
  it('lists arriving trains, including ones that end here', () => {
    const ending = board.arrivals!.find((a) => a.trainNumber === '3319');
    expect(ending).toMatchObject({ serviceDate: '20261118', plannedArrival: '2026-11-18T04:45:00+01:00', platform: '7' });
    expect(board.arrivals!.some((a) => a.trainNumber === '3110')).toBe(false); // starts here
  });
});
