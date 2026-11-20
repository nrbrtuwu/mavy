// Frontend routing and the start page setting (pure parts, no DOM).
import { describe, expect, test } from 'bun:test';
import { backAction, entryState, href, parentHref, parseHash, replacesEntry, resolveStart } from '../web/src/lib/router.ts';
import { DEFAULT_SETTINGS, parseSettings } from '../web/src/lib/settings.ts';

describe('parseHash', () => {
  test('start page, favorites, settings', () => {
    expect(parseHash('')).toEqual({ name: 'start' });
    expect(parseHash('#/')).toEqual({ name: 'start' });
    expect(parseHash('#/kedvencek')).toEqual({ name: 'favorites' });
    expect(parseHash('#/beallitasok')).toEqual({ name: 'settings' });
  });

  test('screens with parameters round-trip through href', () => {
    expect(parseHash(href.board('267'))).toEqual({ name: 'board', id: '267' });
    expect(parseHash(href.route('267', 'DEB', '08:30'))).toEqual({ name: 'route', from: '267', to: 'DEB', time: '08:30' });
    expect(parseHash(href.route('267', 'DEB'))).toEqual({ name: 'route', from: '267', to: 'DEB', time: null });
    expect(parseHash(href.train('36321470_2547.', '20261112'))).toEqual({
      name: 'train',
      tripId: '36321470_2547.',
      date: '20261112',
      on: null,
      off: null,
    });
    expect(parseHash(href.train('T1', '20261112', '3652', '2850'))).toMatchObject({ name: 'train', tripId: 'T1', on: '3652', off: '2850' });
    expect(parseHash(href.train('T1', '20261112', '3652'))).toMatchObject({ on: '3652', off: null });
    expect(parseHash('#/nope')).toEqual({ name: 'notFound' });
  });
});

describe('start page', () => {
  test('defaults to route search', () => {
    expect(DEFAULT_SETTINGS.startPage).toBe('route');
    expect(resolveStart({ name: 'start' }, DEFAULT_SETTINGS.startPage)).toEqual({ name: 'routeForm' });
  });

  test('follows the setting, other routes are untouched', () => {
    expect(resolveStart({ name: 'start' }, 'station')).toEqual({ name: 'stations' });
    expect(resolveStart({ name: 'start' }, 'favorites')).toEqual({ name: 'favorites' });
    expect(resolveStart({ name: 'board', id: '267' }, 'favorites')).toEqual({ name: 'board', id: '267' });
  });

  test('stored settings: valid values kept, anything else falls back to the default', () => {
    const on = { animatedBackground: true, frequentStations: true, fullScreen: false };
    expect(parseSettings('{"startPage":"favorites"}')).toEqual({ startPage: 'favorites', ...on });
    expect(parseSettings('{"startPage":"station"}')).toEqual({ startPage: 'station', ...on });
    expect(parseSettings(null)).toEqual({ startPage: 'route', ...on });
    expect(parseSettings('{"startPage":"map"}')).toEqual({ startPage: 'route', ...on });
    expect(parseSettings('not json')).toEqual({ startPage: 'route', ...on });
    expect(parseSettings('null')).toEqual({ startPage: 'route', ...on });
  });
});

describe('animated background setting', () => {
  test('on by default, can be turned off, junk means on', () => {
    expect(DEFAULT_SETTINGS.animatedBackground).toBe(true);
    expect(parseSettings('{"animatedBackground":false}')).toEqual({ startPage: 'route', animatedBackground: false, frequentStations: true, fullScreen: false });
    expect(parseSettings('{"startPage":"station","animatedBackground":false}')).toEqual({
      startPage: 'station',
      animatedBackground: false,
      frequentStations: true,
      fullScreen: false,
    });
    expect(parseSettings('{"animatedBackground":"no"}').animatedBackground).toBe(true);
  });
});

describe('frequent stations setting', () => {
  test('on by default, can be turned off, junk means on', () => {
    expect(DEFAULT_SETTINGS.frequentStations).toBe(true);
    expect(parseSettings('{"frequentStations":false}').frequentStations).toBe(false);
    expect(parseSettings('{"frequentStations":0}').frequentStations).toBe(true);
  });
});

describe('full screen setting', () => {
  test('off by default, can be turned on, junk means off', () => {
    expect(DEFAULT_SETTINGS.fullScreen).toBe(false);
    expect(parseSettings('{"fullScreen":true}').fullScreen).toBe(true);
    expect(parseSettings('{"fullScreen":"yes"}').fullScreen).toBe(false);
  });
});

describe('parentHref (Back without an earlier app page)', () => {
  test('detail screens go to their parent, top-level pages have no Back', () => {
    expect(parentHref(parseHash('#/tabla/267'))).toBe('#/allomas');
    expect(parentHref(parseHash('#/utvonal/1/2'))).toBe('#/utvonal');
    expect(parentHref(parseHash('#/vonat/abc/20261114'))).toBe('#/');
    expect(parentHref(parseHash('#/nincs-ilyen'))).toBe('#/');
    for (const top of ['#/', '#/utvonal', '#/allomas', '#/kedvencek', '#/beallitasok']) {
      expect(parentHref(parseHash(top))).toBeNull();
    }
  });
});

describe('Back navigation (backAction, entryState, replacesEntry)', () => {
  const r = parseHash;
  // Simulates the app's history: push / replace with the states the router would store.
  function walk(steps: Array<[hash: string, mode: 'push' | 'replace']>) {
    const stack: { hash: string; state: ReturnType<typeof entryState> }[] = [];
    for (const [hash, mode] of steps) {
      const prev = stack[stack.length - 1]?.state ?? { mavyDepth: -1, mavyTop: -1 };
      if (mode === 'push') stack.push({ hash, state: entryState(r(hash), prev.mavyDepth + 1, prev.mavyTop) });
      else stack[stack.length - 1] = { hash, state: entryState(r(hash), prev.mavyDepth, prev.mavyTop) };
    }
    return stack[stack.length - 1]!;
  }

  test('list to list replaces, everything else pushes', () => {
    expect(replacesEntry(r('#/utvonal/1/2'), r('#/utvonal/2/1'))).toBe(true);
    expect(replacesEntry(r('#/tabla/1'), r('#/tabla/2'))).toBe(true);
    expect(replacesEntry(r('#/utvonal'), r('#/utvonal/1/2'))).toBe(false);
    expect(replacesEntry(r('#/utvonal/1/2'), r('#/vonat/t/20261120'))).toBe(false);
    expect(replacesEntry(r('#/vonat/t/20261120'), r('#/tabla/1'))).toBe(false);
  });

  test('results go back to the search form, past Visszaút', () => {
    const now = walk([['#/utvonal', 'push'], ['#/utvonal/1/2', 'push'], ['#/utvonal/2/1', 'replace']]);
    expect(backAction(r(now.hash), now.state)).toEqual({ go: -1 });
  });

  test('a list goes back to favourites even after a train and another list', () => {
    const now = walk([
      ['#/kedvencek', 'push'],
      ['#/utvonal/1/2', 'push'],
      ['#/vonat/t/20261120', 'push'],
      ['#/tabla/9', 'push'],
    ]);
    expect(backAction(r(now.hash), now.state)).toEqual({ go: -3 });
  });

  test('a train goes back one step, to the list it came from', () => {
    const now = walk([['#/allomas', 'push'], ['#/tabla/9', 'push'], ['#/vonat/t/20261120', 'push']]);
    expect(backAction(r(now.hash), now.state)).toEqual({ go: -1 });
  });

  test('without a search page in this tab: the parent screen', () => {
    const list = walk([['#/utvonal/1/2', 'push']]);
    expect(backAction(r(list.hash), list.state)).toEqual({ replace: '#/utvonal' });
    const board = walk([['#/tabla/9', 'push']]);
    expect(backAction(r(board.hash), board.state)).toEqual({ replace: '#/allomas' });
    const train = walk([['#/vonat/t/20261120', 'push']]);
    expect(backAction(r(train.hash), train.state)).toEqual({ replace: '#/' });
    // Entries from the previous app version have no mavyTop.
    expect(backAction(r('#/utvonal/1/2'), { mavyDepth: 3, mavyTop: -1 })).toEqual({ replace: '#/utvonal' });
  });

  test('navbar pages have no Back', () => {
    for (const top of ['#/', '#/utvonal', '#/allomas', '#/kedvencek', '#/beallitasok']) {
      expect(backAction(r(top), { mavyDepth: 4, mavyTop: 2 })).toBeNull();
    }
  });
});
