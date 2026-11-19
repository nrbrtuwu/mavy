// Deploy supervisor helpers and GitHub reporting (deploy/), ported from F1-Calendar's tests.
import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { CONTEXT, createReporter } from '../deploy/github.ts';
import {
  failureSummary,
  gitAuthConfig,
  parseGithubRepo,
  pushedCommit,
  releasesToPrune,
  statusText,
  timetableOutdated,
  upstreamHeaders,
  verifySignature,
} from '../deploy/lib.ts';

const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const sha = (char: string) => char.repeat(40);
const SHA = sha('a');
const repo = { owner: 'owner', name: 'repo' };

describe('webhook', () => {
  test('a correctly signed body is accepted', () => {
    const body = '{"ref":"refs/heads/main"}';
    expect(verifySignature('secret', body, sign('secret', body))).toBe(true);
  });

  test('a wrong secret, a changed body or a missing header is rejected', () => {
    const body = '{"ref":"refs/heads/main"}';
    expect(verifySignature('secret', body, sign('other', body))).toBe(false);
    expect(verifySignature('secret', `${body} `, sign('secret', body))).toBe(false);
    expect(verifySignature('secret', body, undefined)).toBe(false);
    expect(verifySignature('secret', body, 'sha1=abc')).toBe(false);
    expect(verifySignature('', body, sign('', body))).toBe(false);
  });

  test('only a push to the deploy branch triggers a deploy', () => {
    const push = { ref: 'refs/heads/main', after: sha('a') };
    expect(pushedCommit('push', push, 'main')).toBe(sha('a'));
    expect(pushedCommit('push', { ...push, ref: 'refs/heads/feature' }, 'main')).toBeNull();
    expect(pushedCommit('push', { ...push, ref: 'refs/tags/main' }, 'main')).toBeNull();
    expect(pushedCommit('push', { ...push, deleted: true }, 'main')).toBeNull();
    expect(pushedCommit('ping', push, 'main')).toBeNull();
    expect(pushedCommit('push', { ...push, after: 'not-a-sha' }, 'main')).toBeNull();
  });
});

describe('releases and proxying', () => {
  test('pruning keeps the newest releases and never the live or new one', () => {
    const releases = ['a', 'b', 'c', 'd', 'e'].map((char, index) => ({ name: sha(char), mtimeMs: index }));
    const pruned = releasesToPrune([...releases, { name: 'current', mtimeMs: 99 }], [sha('a'), sha('e')], 3);
    expect(pruned.sort()).toEqual([sha('b'), sha('c')]);
  });

  test('the forwarded client address from the reverse proxy is kept', () => {
    const kept = upstreamHeaders({ 'x-forwarded-for': '203.0.113.7', host: 'mavy.example' }, '10.0.0.2');
    expect(kept.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(kept.get('host')).toBe('mavy.example');
    const direct = upstreamHeaders({}, '198.51.100.4');
    expect(direct.get('x-forwarded-for')).toBe('198.51.100.4');
    expect(direct.get('x-forwarded-proto')).toBe('http');
  });

  test('a private repository gets the token as a one-off git header, nothing without one', () => {
    expect(gitAuthConfig('')).toEqual([]);
    expect(gitAuthConfig(undefined)).toEqual([]);
    const [flag, value] = gitAuthConfig(' tok ');
    expect(flag).toBe('-c');
    expect(value).toBe(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from('x-access-token:tok').toString('base64')}`);
  });

  test('the timetable is imported when the GTFS file is newer than the database, or there is none', () => {
    expect(timetableOutdated(null, null)).toBe(false); // nothing uploaded
    expect(timetableOutdated(100, null)).toBe(true);
    expect(timetableOutdated(200, 100)).toBe(true);
    expect(timetableOutdated(100, 200)).toBe(false);
  });
});

// A fake GitHub API that records every request and answers like the real one.
function fakeGithub({ status = 201 } = {}) {
  const calls: { method: string; path: string; body: any; auth: string }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ method: init.method!, path: url.replace('https://api.github.com/repos/owner/repo', ''), body: JSON.parse(String(init.body)), auth: headers.Authorization! });
    return new Response(JSON.stringify(url.endsWith('/deployments') ? { id: 77 } : {}), { status });
  };
  return { calls, fetchImpl };
}

describe('GitHub reporting', () => {
  test('a successful deploy creates a deployment and ends with success statuses', async () => {
    const github = fakeGithub();
    const reporter = createReporter({ token: 't0ken', repo, publicUrl: 'https://mavy.example/', fetchImpl: github.fetchImpl, log: () => {} });
    reporter.started(SHA, 46);
    reporter.step(SHA, 'Testing…');
    reporter.live(SHA, 46, 52);
    await reporter.idle();

    expect(github.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /deployments',
      'POST /deployments/77/statuses',
      `POST /statuses/${SHA}`,
      `POST /statuses/${SHA}`,
      'POST /deployments/77/statuses',
      `POST /statuses/${SHA}`,
    ]);
    const [deployment, inProgress, building, testing, success, live] = github.calls.map((c) => c.body);
    expect(deployment.ref).toBe(SHA);
    expect(deployment.environment).toBe('production');
    expect(inProgress.state).toBe('in_progress');
    expect(building.description).toBe('Building #46…');
    expect(testing.description).toBe('Testing…');
    expect(success).toMatchObject({ state: 'success', environment_url: 'https://mavy.example', auto_inactive: true });
    expect([live.state, live.description, live.context, live.target_url]).toEqual(['success', 'Live as #46 in 52s', CONTEXT, 'https://mavy.example']);
    expect(github.calls.every((c) => c.auth === 'Bearer t0ken')).toBe(true);
  });

  test('a failed deploy points GitHub at the status page', async () => {
    const github = fakeGithub();
    const reporter = createReporter({ token: 't', repo, publicUrl: 'https://mavy.example', fetchImpl: github.fetchImpl, log: () => {} });
    reporter.started(SHA, 47);
    reporter.failed(SHA, 'Tests failed');
    await reporter.idle();
    const deploymentFailure = github.calls.find((c) => c.path === '/deployments/77/statuses' && c.body.state === 'failure');
    const commitFailure = github.calls.at(-1)!.body;
    expect(deploymentFailure?.body.log_url).toBe('https://mavy.example/__deploy/status');
    expect(commitFailure.state).toBe('failure');
    expect(commitFailure.description).toMatch(/^Tests failed/);
  });

  test('queued and skipped commits get a commit status only', async () => {
    const github = fakeGithub();
    const reporter = createReporter({ token: 't', repo, fetchImpl: github.fetchImpl, log: () => {} });
    reporter.queued(SHA);
    reporter.skipped(SHA);
    await reporter.idle();
    expect(github.calls.map((c) => [c.path, c.body.state])).toEqual([
      [`/statuses/${SHA}`, 'pending'],
      [`/statuses/${SHA}`, 'error'],
    ]);
  });

  test('without a token nothing is sent', async () => {
    const github = fakeGithub();
    const reporter = createReporter({ token: '', repo, fetchImpl: github.fetchImpl });
    reporter.started(SHA, 1);
    reporter.live(SHA, 1, 1);
    await reporter.idle();
    expect(reporter.enabled).toBe(false);
    expect(github.calls).toHaveLength(0);
  });

  test('API errors and network failures are logged, never thrown, without the token', async () => {
    const logged: string[] = [];
    const failing = createReporter({ token: 'secret-token', repo, fetchImpl: fakeGithub({ status: 401 }).fetchImpl, log: (l) => logged.push(l) });
    failing.started(SHA, 1);
    failing.live(SHA, 1, 1);
    await failing.idle();
    const offline = createReporter({ token: 'secret-token', repo, fetchImpl: async () => { throw new Error('offline'); }, log: (l) => logged.push(l) });
    offline.failed(SHA, 'Build failed');
    await offline.idle();
    expect(logged.some((l) => l.includes('401'))).toBe(true);
    expect(logged.some((l) => l.includes('offline'))).toBe(true);
    expect(logged.every((l) => !l.includes('secret-token'))).toBe(true);
  });

  test('GitHub remotes are recognised in every form', () => {
    expect(parseGithubRepo('https://github.com/nrbrtuwu/mavy.git')).toEqual({ owner: 'nrbrtuwu', name: 'mavy' });
    expect(parseGithubRepo('https://github.com/nrbrtuwu/mavy/')).toEqual({ owner: 'nrbrtuwu', name: 'mavy' });
    expect(parseGithubRepo('git@github.com:nrbrtuwu/mavy.git\n')).toEqual({ owner: 'nrbrtuwu', name: 'mavy' });
    expect(parseGithubRepo('file:///tmp/origin.git')).toBeNull();
  });

  test('status texts fit GitHub limits and failures get a short reason', () => {
    expect(statusText('x'.repeat(200)).length).toBe(140);
    expect(failureSummary(new Error('test failed (exit 1)'))).toBe('Tests failed');
    expect(failureSummary(new Error('build failed (exit 2)'))).toBe('Build failed');
    expect(failureSummary(new Error('import failed (exit 1)'))).toBe('Timetable import failed');
    expect(failureSummary(new Error('health check failed: no answer'))).toBe('Health check failed');
    expect(failureSummary(new Error('the checkout has local changes'))).toBe('Deploy failed');
  });
});
