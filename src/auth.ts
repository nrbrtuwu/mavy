// Optional shared password (fallback when Tailscale / Cloudflare Access is not used).
//
// Enabled when MAVY_PASSWORD is set. Visitors get a small login page; a correct
// password sets a signed cookie valid for 180 days. The cookie is an HMAC of
// its expiry keyed with the password, so changing the password logs everyone out.
// Only use it over HTTPS, otherwise the password travels in clear text.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'mavy_auth';
const MAX_AGE_SEC = 180 * 24 * 3600;
const MAX_FAILS = 10;
const FAIL_WINDOW_MS = 15 * 60_000;

/** Reachable without logging in: the login page and what installing the app needs. */
const PUBLIC = [/^\/login$/, /^\/manifest\.webmanifest$/, /^\/icons\/[\w.-]+$/];

// The login page is served before the app is unlocked, so it carries its own
// small stylesheet in the app's look (shadcn neutral card, red error).
const LOGIN_CSS = `
:root { color-scheme: light dark; --bg:#fff; --fg:#0a0a0a; --muted:#737373; --border:#e5e5e5; --card:#fff; --red:#dc2626; }
@media (prefers-color-scheme: dark) { :root { --bg:#0a0a0a; --fg:#fafafa; --muted:#a3a3a3; --border:#262626; --card:#171717; --red:#f87171; } }
* { box-sizing: border-box; }
body { margin:0; min-height:100svh; display:grid; place-items:center; padding:16px; background:var(--bg); color:var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { width:100%; max-width:360px; background:var(--card); border:1px solid var(--border); border-radius:14px; padding:24px; }
h1 { margin:0 0 4px; font-size:20px; font-weight:600; }
p.sub { margin:0 0 20px; color:var(--muted); font-size:14px; }
label { display:block; margin-bottom:6px; font-size:14px; font-weight:500; }
input { width:100%; height:44px; padding:0 12px; font:inherit; color:inherit; background:transparent; border:1px solid var(--border); border-radius:8px; }
input:focus { outline:2px solid var(--muted); outline-offset:1px; }
button { width:100%; height:44px; margin-top:16px; font:inherit; font-weight:500; color:var(--bg); background:var(--fg); border:0; border-radius:8px; cursor:pointer; }
.error { margin:0 0 16px; padding:10px 12px; color:var(--red); border:1px solid currentColor; border-radius:8px; font-size:14px; }
`;

export interface AuthOptions {
  password: string;
  now?: () => number;
}

function sign(password: string, expiresAt: number): string {
  return createHmac('sha256', password).update(`mavy:${expiresAt}`).digest('base64url');
}

export function makeToken(password: string, expiresAt: number): string {
  return `v1.${expiresAt}.${sign(password, expiresAt)}`;
}

export function verifyToken(password: string, token: string | undefined, now: number): boolean {
  if (!token) return false;
  const [version, exp, mac] = token.split('.');
  const expiresAt = Number(exp);
  if (version !== 'v1' || !Number.isSafeInteger(expiresAt) || !mac || expiresAt <= now) return false;
  const expected = Buffer.from(sign(password, expiresAt));
  const given = Buffer.from(mac);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function passwordMatches(password: string, given: string): boolean {
  const a = createHmac('sha256', 'mavy-compare').update(password).digest();
  const b = createHmac('sha256', 'mavy-compare').update(given).digest();
  return timingSafeEqual(a, b);
}

function loginPage(message: string | null): string {
  return `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Mávy – belépés</title>
  <style>${LOGIN_CSS}</style>
  <link rel="manifest" href="manifest.webmanifest" crossorigin="use-credentials">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
</head>
<body>
  <main>
    <h1>Mávy</h1>
    <p class="sub">Add meg a közös jelszót.</p>
    ${message ? `<p class="error" role="alert">${message}</p>` : ''}
    <form method="post" action="login">
      <label for="password">Jelszó</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
      <button type="submit">Belépés</button>
    </form>
  </main>
</body>
</html>
`;
}

export function registerPasswordAuth(app: FastifyInstance, opts: AuthOptions): void {
  const now = opts.now ?? Date.now;
  const fails = new Map<string, { count: number; resetAt: number }>();

  // HTML forms post urlencoded bodies; parse them without an extra dependency.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (PUBLIC.some((p) => p.test(path))) return;
    if (verifyToken(opts.password, readCookie(req, COOKIE), now())) return;
    if (path.startsWith('/api/')) return reply.code(401).send({ error: 'unauthorized' });
    return reply.redirect('/login', 302);
  });

  app.get('/login', async (req, reply) => {
    const failed = (req.query as Record<string, string>).hiba === '1';
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(loginPage(failed ? 'Hibás jelszó.' : null));
  });

  app.post('/login', async (req, reply) => {
    const t = now();
    const entry = fails.get(req.ip);
    if (entry && entry.resetAt > t && entry.count >= MAX_FAILS) {
      return reply
        .code(429)
        .type('text/html; charset=utf-8')
        .send(loginPage('Túl sok sikertelen próbálkozás. Próbáld újra 15 perc múlva.'));
    }
    const given = String((req.body as Record<string, unknown> | undefined)?.password ?? '');
    if (!passwordMatches(opts.password, given)) {
      const current = entry && entry.resetAt > t ? entry : { count: 0, resetAt: t + FAIL_WINDOW_MS };
      current.count++;
      fails.set(req.ip, current);
      return reply.redirect('/login?hiba=1', 303);
    }
    fails.delete(req.ip);
    const expiresAt = t + MAX_AGE_SEC * 1000;
    const secure = req.protocol === 'https' ? '; Secure' : '';
    reply.header(
      'set-cookie',
      `${COOKIE}=${makeToken(opts.password, expiresAt)}; Max-Age=${MAX_AGE_SEC}; Path=/; HttpOnly; SameSite=Lax${secure}`,
    );
    return reply.redirect('/', 303);
  });
}
