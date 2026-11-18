// Frontend routing and the start page setting (pure parts, no DOM).
import { describe, expect, test } from 'bun:test';
import { href, parentHref, parseHash, resolveStart } from '../web/src/lib/router.ts';
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
    });
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
    const on = { animatedBackground: true };
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
    expect(parseSettings('{"animatedBackground":false}')).toEqual({ startPage: 'route', animatedBackground: false });
    expect(parseSettings('{"startPage":"station","animatedBackground":false}')).toEqual({
      startPage: 'station',
      animatedBackground: false,
    });
    expect(parseSettings('{"animatedBackground":"no"}').animatedBackground).toBe(true);
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
