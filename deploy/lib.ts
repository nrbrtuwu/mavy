// Pure helpers for the deploy supervisor (supervisor.ts), kept apart so they can be tested.
// Ported from the F1-Calendar project's deploy/lib.js.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** GitHub signs the raw request body with HMAC-SHA256 and sends `sha256=<hex>`. */
export function verifySignature(secret: string, rawBody: string, header: string | null | undefined): boolean {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** The pushed commit when the webhook is a push to the deploy branch, otherwise null. */
export function pushedCommit(
  event: string | null,
  payload: { ref?: string; after?: string; deleted?: boolean } | null,
  branch: string,
): string | null {
  if (event !== 'push' || !payload || payload.ref !== `refs/heads/${branch}` || payload.deleted) return null;
  return SHA_PATTERN.test(payload.after ?? '') ? payload.after! : null;
}

/** Release folders to delete: all but the newest `keep` by mtime, never the protected (live, new) ones. */
export function releasesToPrune(releases: { name: string; mtimeMs: number }[], protectedShas: (string | null | undefined)[], keep = 3): string[] {
  const candidates = releases.filter((r) => SHA_PATTERN.test(r.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Set(protectedShas.filter((s): s is string => !!s));
  for (const r of candidates) {
    if (kept.size >= keep) break;
    kept.add(r.name);
  }
  return candidates.filter((r) => !kept.has(r.name)).map((r) => r.name);
}

/** Headers for the request to the app: the reverse proxy's X-Forwarded-For is kept as it is. */
export function upstreamHeaders(headers: HeadersInit, clientIp: string | null | undefined): Headers {
  const result = new Headers(headers);
  if (!result.has('x-forwarded-for') && clientIp) result.set('x-forwarded-for', clientIp);
  if (!result.has('x-forwarded-proto')) result.set('x-forwarded-proto', 'http');
  return result;
}

/** { owner, name } for a GitHub remote in https or ssh form, otherwise null. */
export function parseGithubRepo(remote: string | null | undefined): { owner: string; name: string } | null {
  const m = String(remote ?? '').trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, name: m[2]! } : null;
}

/** GitHub rejects commit status descriptions longer than 140 characters. */
export function statusText(text: string | null | undefined): string {
  const value = String(text ?? '').trim();
  return value.length > 140 ? `${value.slice(0, 139)}…` : value;
}

const STEP_FAILURES: Record<string, string> = {
  install: 'Install failed',
  build: 'Build failed',
  test: 'Tests failed',
  import: 'Timetable import failed',
  health: 'Health check failed',
};

/** A short reason for GitHub from the supervisor's error messages, such as "test failed (exit 1)". */
export function failureSummary(error: unknown): string {
  const message = String((error as Error)?.message ?? error ?? '');
  if (message.startsWith('health check failed')) return STEP_FAILURES.health!;
  const step = message.match(/^(\w+) failed/)?.[1];
  return (step && STEP_FAILURES[step]) || 'Deploy failed';
}

/**
 * git -c option that sends a GitHub token with every https request (clone, fetch, ls-remote),
 * so a private repository works without writing the token into the checkout's config.
 */
export function gitAuthConfig(token: string | null | undefined): string[] {
  const t = (token ?? '').trim();
  if (!t) return [];
  const basic = Buffer.from(`x-access-token:${t}`).toString('base64');
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

/** The timetable needs (re)importing: a GTFS zip or folder newer than the database, or no database. */
export function timetableOutdated(newestGtfsMtimeMs: number | null, dbMtimeMs: number | null): boolean {
  if (newestGtfsMtimeMs === null) return false; // nothing to import
  return dbMtimeMs === null || newestGtfsMtimeMs > dbMtimeMs;
}
