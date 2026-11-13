import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { COOKIE, makeToken, verifyToken } from '../src/auth.ts';
import { buildServer } from '../src/server.ts';
import { makePublicDir } from './helpers.ts';

const PASSWORD = 'vonat-teszt-jelszo';
const NOW = Date.parse('2026-11-12T08:00:00Z');
const NO_DB = join(import.meta.dir, 'no-such.db');
let app: FastifyInstance;

beforeAll(() => {
  app = buildServer({ dbPath: NO_DB, password: PASSWORD, now: () => NOW, publicDir: makePublicDir(), logger: false });
});
afterAll(() => app.close());

const form = (password: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    payload: new URLSearchParams({ password }).toString(),
  });

function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
  return raw.split(';')[0]!;
}

describe('tokens', () => {
  it('verify only with the same password and before expiry', () => {
    const token = makeToken(PASSWORD, NOW + 1000);
    expect(verifyToken(PASSWORD, token, NOW)).toBe(true);
    expect(verifyToken(PASSWORD, token, NOW + 1000)).toBe(false); // expired
    expect(verifyToken('other', token, NOW)).toBe(false); // password changed
    expect(verifyToken(PASSWORD, token.slice(0, -2) + 'xx', NOW)).toBe(false); // tampered
    expect(verifyToken(PASSWORD, `v1.${NOW + 999999}.${token.split('.')[2]}`, NOW)).toBe(false); // other expiry
    expect(verifyToken(PASSWORD, undefined, NOW)).toBe(false);
    expect(verifyToken(PASSWORD, 'garbage', NOW)).toBe(false);
  });
});

describe('password gate', () => {
  it('without login: pages redirect to /login, API answers 401', async () => {
    const page = await app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(302);
    expect(page.headers.location).toBe('/login');
    const api = await app.inject({ method: 'GET', url: '/api/health' });
    expect(api.statusCode).toBe(401);
    expect(api.json()).toEqual({ error: 'unauthorized' });
    expect((await app.inject({ method: 'GET', url: '/sw.js' })).statusCode).toBe(302);
  });

  it('login page and install files are public', async () => {
    const login = await app.inject({ method: 'GET', url: '/login' });
    expect(login.statusCode).toBe(200);
    expect(login.body).toContain('type="password"');
    for (const url of ['/manifest.webmanifest', '/icons/icon-192.png']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'GET', url: '/icons/../app.js' })).statusCode).not.toBe(200);
  });

  it('wrong password goes back to the login page with an error', async () => {
    const res = await form('nope', { 'x-forwarded-for': '203.0.113.1' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/login?hiba=1');
    expect(res.headers['set-cookie']).toBeUndefined();
    const page = await app.inject({ method: 'GET', url: '/login?hiba=1' });
    expect(page.body).toContain('Hibás jelszó.');
  });

  it('correct password sets an HttpOnly cookie that unlocks everything', async () => {
    const res = await form(PASSWORD);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${COOKIE}=v1.`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain(`Max-Age=${180 * 24 * 3600}`);
    expect(setCookie).not.toContain('Secure'); // plain http in this test

    const cookie = cookieFrom(res.headers['set-cookie']);
    expect((await app.inject({ method: 'GET', url: '/', headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: { cookie } })).statusCode).toBe(200);
  });

  it('cookie is Secure behind an https proxy on this machine', async () => {
    const res = await form(PASSWORD, { 'x-forwarded-proto': 'https' });
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });

  it('blocks an address after 10 failed attempts', async () => {
    const ip = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 10; i++) expect((await form('wrong', ip)).statusCode).toBe(303);
    const blocked = await form(PASSWORD, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['set-cookie']).toBeUndefined();
    // Other addresses are not affected.
    expect((await form(PASSWORD, { 'x-forwarded-for': '198.51.100.8' })).statusCode).toBe(303);
  });
});

describe('without a password', () => {
  it('everything is open', async () => {
    const open = buildServer({ dbPath: NO_DB, password: null, logger: false });
    expect((await open.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await open.inject({ method: 'GET', url: '/login' })).statusCode).toBe(404);
    await open.close();
  });
});
