// Zero-downtime deploys for one Pelican allocation (adapted from the F1-Calendar project).
//
// This process owns the public port and proxies every request to the live release on a private
// loopback port. On a push to GIT_BRANCH (GitHub webhook, or polling as a fallback) it builds and
// tests the new commit in releases/<sha>, starts it next to the live one and switches traffic only
// once it answers; the old release is then stopped. If anything fails, the old release stays live.
//
// Mávy specifics:
// - Data lives in DATA_DIR (default ./data), outside the releases: the timetable databases and
//   gtfs/ (the GTFS zip, uploaded by hand). When the zip is newer than the timetable, it is imported
//   into a new file, mavy-<time>.db, and a new process on that file replaces the live one, also
//   without downtime; the old file is deleted once nothing uses it. A file is never replaced under
//   a running process (Windows does not allow that). Checked at start and every minute.
// - MÁV's badge font (not in git, see CLAUDE.md) is downloaded once into DATA_DIR/fonts and copied
//   into each release before its build; without it the app shows text badges.
// - A private repository is fetched with GITHUB_TOKEN, sent as a one-off git header (never stored).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { createReporter, type Reporter } from './github.ts';
import {
  failureSummary,
  gitAuthConfig,
  parseGithubRepo,
  pushedCommit,
  releasesToPrune,
  SHA_PATTERN,
  timetableOutdated,
  upstreamHeaders,
  verifySignature,
} from './lib.ts';

const ROOT = resolve(import.meta.dir, '..');
const RELEASES_DIR = join(ROOT, 'releases');
const CURRENT_FILE = join(RELEASES_DIR, 'current');
const READY_MARKER = '.release-ready';

const { env } = process;
const PORT = Number(env.SERVER_PORT || env.PORT || 3000);
const BRANCH = env.GIT_BRANCH || 'main';
const SECRET = (env.DEPLOY_WEBHOOK_SECRET || '').trim();
const POLL_SECONDS = env.DEPLOY_POLL_SECONDS === undefined || env.DEPLOY_POLL_SECONDS === '' ? 120 : Number(env.DEPLOY_POLL_SECONDS);
const AUTO_DEPLOY = env.AUTO_DEPLOY !== 'false';
const GITHUB_TOKEN = (env.GITHUB_TOKEN || '').trim();
const GITHUB_STATUS = env.GITHUB_STATUS !== 'false';
const DATA_DIR = resolve(ROOT, env.DATA_DIR || './data');
/** Timetable databases: mavy-<ms>.db (newest is current); a plain mavy.db is used when there is no other. */
const DB_PATTERN = /^mavy(-\d+)?\.db$/;
const GTFS_DIR = join(DATA_DIR, 'gtfs');
const FONT_FILE = join(DATA_DIR, 'fonts', 'MNR2007.ttf');
const KEEP_RELEASES = 3;
const HEALTH_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
const TIMETABLE_CHECK_MS = 60_000;
// The installer runs as root, so the checkout may belong to another user than this process.
const GIT = ['git', '-c', 'safe.directory=*', ...gitAuthConfig(GITHUB_TOKEN)];

/** What every release gets: its data in DATA_DIR, loopback only (the supervisor is the public side). */
const appEnv = (dbFile: string) => ({ MAVY_DB: dbFile, MAVY_GTFS_DIR: GTFS_DIR, HOST: '127.0.0.1' });

const log = (...parts: unknown[]) => console.log('[deploy]', ...parts);
const logError = (...parts: unknown[]) => console.error('[deploy]', ...parts);
const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : 'none');
const releaseDir = (sha: string) => join(RELEASES_DIR, sha);

interface App {
  sha: string;
  /** The timetable database this process has open. */
  dbFile: string;
  port: number;
  proc: ReturnType<typeof Bun.spawn>;
  healthy: boolean;
  exited: boolean;
  stopping: boolean;
}

let active: App | null = null;
const supervisorInfo = { version: 1, startedAt: new Date().toISOString(), startedFromCommit: null as string | null };
let reporter: Reporter = createReporter({});
let shuttingDown = false;

// ---------- child processes ----------

async function pipeLines(stream: ReadableStream<Uint8Array>, prefix: string, target: NodeJS.WriteStream) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      target.write(`${prefix} ${buffer.slice(0, index).replace(/\r$/, '')}\n`);
      buffer = buffer.slice(index + 1);
    }
  }
  if (buffer) target.write(`${prefix} ${buffer}\n`);
}

/** Runs a command to completion, streaming its output. Throws "<step> failed (exit n)" on failure. */
async function run(step: string, cmd: string[], { cwd = ROOT, quiet = false, extraEnv = {} as Record<string, string> } = {}) {
  const proc = Bun.spawn(cmd, { cwd, env: { ...env, FORCE_COLOR: '0', ...extraEnv }, stdout: 'pipe', stderr: 'pipe' });
  const chunks: string[] = [];
  const collect = async (stream: ReadableStream<Uint8Array>, target: NodeJS.WriteStream) => {
    if (!quiet) return pipeLines(stream, `[${step}]`, target);
    chunks.push(await new Response(stream).text());
  };
  await Promise.all([collect(proc.stdout, process.stdout), collect(proc.stderr, process.stderr), proc.exited]);
  if (proc.exitCode !== 0) {
    // Quiet steps are git commands: their output may echo the auth header, so it is never shown.
    throw new Error(`${step} failed (exit ${proc.exitCode})${quiet && !GITHUB_TOKEN ? `: ${chunks.join('').trim().slice(-500)}` : ''}`);
  }
}

async function output(cmd: string[], cwd = ROOT): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (proc.exitCode !== 0) throw new Error(`${cmd[0]} ${cmd.at(-1)} failed: ${(stderr.trim() || stdout.trim()).slice(0, 300)}`);
  return stdout.trim();
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

async function startApp(sha: string): Promise<App> {
  const port = await freePort();
  const dbFile = currentDb() ?? join(DATA_DIR, 'mavy.db');
  const app = { sha, dbFile, port, healthy: false, exited: false, stopping: false } as App;
  app.proc = Bun.spawn([process.execPath, 'src/server.ts'], {
    cwd: releaseDir(sha),
    env: { ...env, ...appEnv(dbFile), PORT: String(port) },
    stdout: 'pipe',
    stderr: 'pipe',
    ipc() {},
    onExit(_proc, exitCode) {
      app.exited = true;
      onAppExit(app, exitCode);
    },
  });
  void pipeLines(app.proc.stdout as ReadableStream<Uint8Array>, `[app ${short(sha)}]`, process.stdout);
  void pipeLines(app.proc.stderr as ReadableStream<Uint8Array>, `[app ${short(sha)}]`, process.stderr);
  log(`started ${short(sha)} on 127.0.0.1:${port}`);
  return app;
}

/**
 * Healthy: the API answers (401 counts: the shared password gate is on) and the built UI is
 * there (the manifest is public even behind the password).
 */
async function waitHealthy(app: App): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const base = `http://127.0.0.1:${app.port}`;
  while (Date.now() < deadline && !app.exited) {
    try {
      const [api, manifest] = await Promise.all([
        fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) }),
        fetch(`${base}/manifest.webmanifest`, { signal: AbortSignal.timeout(3000) }),
      ]);
      if (api.status < 500 && manifest.ok) {
        app.healthy = true;
        return true;
      }
    } catch {
      // not listening yet
    }
    await Bun.sleep(500);
  }
  return false;
}

async function stopApp(app: App | null) {
  if (!app || app.exited) return;
  app.stopping = true;
  try {
    app.proc.send({ type: 'shutdown' });
  } catch {
    app.proc.kill();
  }
  const exitedInTime = await Promise.race([app.proc.exited.then(() => true), Bun.sleep(STOP_TIMEOUT_MS).then(() => false)]);
  if (!exitedInTime) {
    logError(`${short(app.sha)} did not stop in time, killing it`);
    app.proc.kill(9);
    await app.proc.exited;
  }
}

/** Traffic moves to the new release first, then the old one is stopped. */
async function promote(candidate: App) {
  const previous = active;
  active = candidate;
  if (previous) await stopApp(previous);
  writeFileSync(CURRENT_FILE, `${candidate.sha}\n`);
  pruneTimetables(candidate.dbFile);
}

/** A healthy new process of `sha` takes over from the live one (same code, e.g. a new timetable). */
async function replaceWith(sha: string): Promise<boolean> {
  const app = await startApp(sha);
  if (await waitHealthy(app)) {
    await promote(app);
    return true;
  }
  await stopApp(app);
  return false;
}

// ---------- crash recovery ----------

let restartDelay = 1000;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

function onAppExit(app: App, exitCode: number | null) {
  if (app !== active || app.stopping || shuttingDown) return;
  logError(`${short(app.sha)} exited unexpectedly (code ${exitCode}), restarting in ${restartDelay / 1000}s`);
  scheduleRestart(app.sha);
}

function scheduleRestart(sha: string) {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    if (shuttingDown || (active && !active.exited)) return;
    if (await replaceWith(sha)) {
      restartDelay = 1000;
      log(`${short(sha)} is back up`);
    } else {
      restartDelay = Math.min(restartDelay * 2, 30_000);
      scheduleRestart(sha);
    }
  }, restartDelay);
}

// ---------- timetable ----------

function newestMtime(dir: string): number | null {
  if (!existsSync(dir)) return null;
  const times = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(zip|txt)$/i.test(e.name))
    .map((e) => statSync(join(dir, e.name)).mtimeMs);
  return times.length ? Math.max(...times) : null;
}

const mtimeOf = (file: string | null) => (file && existsSync(file) ? statSync(file).mtimeMs : null);

function timetableFiles(): string[] {
  return existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((f) => DB_PATTERN.test(f)).map((f) => join(DATA_DIR, f)) : [];
}

/** The newest timetable database, or null before the first import. */
function currentDb(): string | null {
  const files = timetableFiles();
  if (!files.length) return null;
  return files.reduce((a, b) => (statSync(b).mtimeMs > statSync(a).mtimeMs ? b : a));
}

/** Older timetable files nothing uses any more (the live process keeps `inUse`). */
function pruneTimetables(inUse: string) {
  for (const file of timetableFiles()) {
    if (file === inUse || file === currentDb()) continue;
    try {
      rmSync(file, { force: true });
      log(`removed old timetable ${file}`);
    } catch {
      // still open somewhere: next time
    }
  }
}

/** Imports the GTFS upload into DATA_DIR/mavy.db with the code of release `sha`, when it is newer. */
async function importTimetableIfNeeded(sha: string): Promise<boolean> {
  if (!timetableOutdated(newestMtime(GTFS_DIR), mtimeOf(currentDb()))) return false;
  log('the GTFS upload is newer than the timetable database: importing');
  // A new file: the live process keeps reading its own until it is replaced.
  const dbFile = join(DATA_DIR, `mavy-${Date.now()}.db`);
  await run('import', [process.execPath, 'src/gtfs/import.ts'], { cwd: releaseDir(sha), extraEnv: appEnv(dbFile) });
  return true;
}

let timetableBusy = false;

/** Every minute: a new GTFS upload is imported and the live release restarted to load it. */
async function checkTimetable() {
  if (timetableBusy || deploying || shuttingDown || !active || active.exited) return;
  timetableBusy = true;
  const sha = active.sha;
  try {
    if (await importTimetableIfNeeded(sha)) {
      log((await replaceWith(sha)) ? 'new timetable is live' : 'restart after the import failed; the old process stays live');
    }
  } catch (error) {
    logError(`timetable import failed: ${(error as Error).message}. The previous timetable stays live.`);
  } finally {
    timetableBusy = false;
  }
}

// ---------- building releases ----------

const isReady = (sha: string | null | undefined) => !!sha && SHA_PATTERN.test(sha) && existsSync(join(releaseDir(sha), READY_MARKER));

/** The build number is the commit count, which a shallow clone cannot give. */
async function ensureFullHistory() {
  if ((await output([...GIT, 'rev-parse', '--is-shallow-repository'])) === 'true') {
    log('fetching the full git history for build numbers');
    await run('fetch', [...GIT, 'fetch', '--quiet', '--unshallow', 'origin'], { quiet: true });
  }
}

async function buildNumber(sha: string): Promise<number | null> {
  await ensureFullHistory().catch(() => {});
  return Number(await output([...GIT, 'rev-list', '--count', sha]).catch(() => '')) || null;
}

/** MÁV's badge font into the release (downloaded once into DATA_DIR/fonts). Never fails a build. */
async function provideFont(dir: string) {
  const target = join(dir, 'web', 'public', 'fonts', 'MNR2007.ttf');
  try {
    if (!existsSync(FONT_FILE)) {
      await run('font', [process.execPath, 'scripts/fetch-font.ts'], { cwd: dir, quiet: true });
      mkdirSync(join(DATA_DIR, 'fonts'), { recursive: true });
      copyFileSync(target, FONT_FILE);
    } else {
      mkdirSync(join(dir, 'web', 'public', 'fonts'), { recursive: true });
      copyFileSync(FONT_FILE, target);
    }
  } catch (error) {
    logError(`badge font not available (${(error as Error).message}); the app shows text badges`);
  }
}

/** onStep(name) runs before each step, for progress reporting. */
async function buildRelease(sha: string, number: number | null, onStep: (step: string) => void = () => {}) {
  if (isReady(sha)) {
    log(`${short(sha)} is already built`);
    return;
  }
  log(`building #${number ?? '?'} (${short(sha)})`);
  const dir = releaseDir(sha);
  const archive = join(RELEASES_DIR, `${sha}.tar`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    await run('archive', [...GIT, 'archive', '--format=tar', '-o', archive, sha], { quiet: true });
    // A relative archive path keeps GNU tar from reading "C:" in Windows paths as a remote host.
    await run('extract', ['tar', '-xf', relative(dir, archive)], { cwd: dir, quiet: true });
    onStep('install');
    // Dev dependencies too: the UI build needs Vite and TypeScript (postinstall installs web/).
    await run('install', [process.execPath, 'install', '--frozen-lockfile'], { cwd: dir });
    await provideFont(dir);
    onStep('build');
    await run('build', [process.execPath, 'run', 'build'], { cwd: dir });
    onStep('test');
    await run('test', [process.execPath, 'test'], { cwd: dir });
    // The server only needs the root dependencies and the built UI.
    rmSync(join(dir, 'web', 'node_modules'), { recursive: true, force: true });
    writeFileSync(join(dir, READY_MARKER), JSON.stringify({ builtAt: new Date().toISOString(), number }));
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(archive, { force: true });
  }
}

function pruneReleases(keepShas: string[]) {
  const releases = readdirSync(RELEASES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, mtimeMs: statSync(join(RELEASES_DIR, e.name)).mtimeMs }));
  for (const sha of releasesToPrune(releases, keepShas, KEEP_RELEASES)) {
    rmSync(releaseDir(sha), { recursive: true, force: true });
    log(`removed old release ${short(sha)}`);
  }
}

// ---------- deploying ----------

let deploying = false;
let deployAgain = false;
let lastFailedSha: string | null = null;
interface DeployState {
  commit: string;
  number: number | null;
  state: 'building' | 'live' | 'failed';
  step: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
let lastDeploy: DeployState | null = null; // shown on /__deploy/status, where GitHub's "Details" link points
const queuedShas = new Set<string>(); // pushes announced by webhook, reported as skipped if a newer one wins

const STEP_LABELS: Record<string, string> = {
  install: 'Installing dependencies…',
  build: 'Building…',
  test: 'Running tests…',
  import: 'Importing the timetable…',
  start: 'Starting…',
};

function trackStep(sha: string, step: string) {
  if (lastDeploy?.commit === sha) lastDeploy.step = step;
  void reporter.step(sha, STEP_LABELS[step] ?? step);
}

function requestDeploy(reason: string, { retryFailed = false } = {}) {
  if (deploying) {
    deployAgain = true;
    return;
  }
  deploying = true;
  void (async () => {
    try {
      do {
        deployAgain = false;
        await deployLatest(reason, retryFailed);
        reason = 'queued push';
      } while (deployAgain && !shuttingDown);
    } finally {
      deploying = false;
    }
  })();
}

async function deployLatest(reason: string, retryFailed: boolean) {
  const started = Date.now();
  let sha: string | undefined;
  let reported = false;
  try {
    await run('fetch', [...GIT, 'fetch', '--quiet', 'origin', BRANCH], { quiet: true });
    sha = await output([...GIT, 'rev-parse', 'FETCH_HEAD']);
    if (active && !active.exited && sha === active.sha) return;
    if (sha === lastFailedSha && !retryFailed) return;
    log(`deploying ${short(sha)} (${reason}), live is ${short(active?.sha)}`);

    // Never throw away work: the checkout is only moved when it has no local edits.
    if (await output([...GIT, 'status', '--porcelain', '--untracked-files=no'])) {
      throw new Error('the checkout has local changes; commit or discard them first');
    }
    const previousHead = await output([...GIT, 'rev-parse', 'HEAD']);
    const supervisorChanged = await output([...GIT, 'diff', '--name-only', previousHead, sha, '--', 'deploy']);
    await run('checkout', [...GIT, 'reset', '--quiet', '--hard', sha], { quiet: true });

    const number = await buildNumber(sha);
    lastDeploy = { commit: sha, number, state: 'building', step: 'prepare', error: null, startedAt: new Date(started).toISOString(), finishedAt: null };
    // This is the newest commit on the branch, so any other announced push is superseded.
    queuedShas.delete(sha);
    for (const skipped of queuedShas) void reporter.skipped(skipped);
    queuedShas.clear();
    void reporter.started(sha, number);
    reported = true;

    const target = sha;
    await buildRelease(target, number, (step) => trackStep(target, step));
    trackStep(sha, 'import');
    await importTimetableIfNeeded(sha);
    trackStep(sha, 'start');
    const candidate = await startApp(sha);
    if (!(await waitHealthy(candidate))) {
      await stopApp(candidate);
      throw new Error('health check failed: the new release did not answer on /api/health and /manifest.webmanifest');
    }
    await promote(candidate);
    lastFailedSha = null;
    pruneReleases([sha]);
    const seconds = Math.round((Date.now() - started) / 1000);
    Object.assign(lastDeploy, { state: 'live', step: null, finishedAt: new Date().toISOString() });
    void reporter.live(sha, number, seconds);
    log(`${short(sha)} is live (${seconds}s)`);
    if (supervisorChanged) log('this commit changed deploy/; restart the server in Pelican to run the new supervisor');
  } catch (error) {
    lastFailedSha = sha ?? lastFailedSha;
    logError(`deploy of ${short(sha)} failed: ${(error as Error).message}. ${short(active?.sha)} stays live.`);
    if (lastDeploy && lastDeploy.commit === sha) {
      // The status page is public: keep the step and exit code, drop any command output after the colon.
      Object.assign(lastDeploy, { state: 'failed', error: (error as Error).message.replace(/:[\s\S]*$/, ''), finishedAt: new Date().toISOString() });
    }
    if (reported && sha) void reporter.failed(sha, failureSummary(error));
  }
}

async function pollRemote() {
  if (deploying || shuttingDown) return;
  try {
    const line = await output([...GIT, 'ls-remote', 'origin', `refs/heads/${BRANCH}`]);
    const sha = line.split(/\s+/)[0] ?? '';
    if (SHA_PATTERN.test(sha) && sha !== active?.sha && sha !== lastFailedSha) requestDeploy('poll');
  } catch (error) {
    logError(`poll failed: ${(error as Error).message}`);
  }
}

// ---------- HTTP ----------

const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } });

async function handleWebhook(req: Request): Promise<Response> {
  if (!SECRET) return text('Not found', 404);
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const rawBody = await req.text();
  if (!verifySignature(SECRET, rawBody, req.headers.get('x-hub-signature-256'))) {
    logError('rejected a webhook with a bad signature');
    return text('Bad signature', 401);
  }
  const event = req.headers.get('x-github-event');
  if (event === 'ping') return text('pong', 200);
  let payload: { ref?: string; after?: string; deleted?: boolean };
  try {
    // GitHub sends either application/json or a form field named payload.
    const json = rawBody.startsWith('payload=') ? new URLSearchParams(rawBody).get('payload') : rawBody;
    payload = JSON.parse(json ?? '');
  } catch {
    return text('Invalid payload', 400);
  }
  const sha = pushedCommit(event, payload, BRANCH);
  if (!sha) return text('Ignored', 202);
  if (!AUTO_DEPLOY) return text('Automatic deploys are off', 202);
  log(`webhook: push of ${short(sha)} to ${BRANCH}`);
  if (sha !== active?.sha) {
    queuedShas.add(sha);
    void reporter.queued(sha);
  }
  requestDeploy('webhook', { retryFailed: true });
  return text('Deploy queued', 202);
}

async function proxy(req: Request, server: Bun.Server<unknown>): Promise<Response> {
  const url = new URL(req.url);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const headers = upstreamHeaders(req.headers, server.requestIP(req)?.address);
  // A GET that lands on a release in the middle of shutting down is retried once on its successor.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const target = active;
    if (!target || !target.healthy) return text('A Mávy frissül, próbáld újra egy pillanat múlva.', 503, { 'retry-after': '5' });
    try {
      // Bun extras: duplex for a streamed request body, decompress: false to pass bytes through as they are.
      const init = { method: req.method, headers, body: hasBody ? req.body : undefined, redirect: 'manual', decompress: false, duplex: 'half' };
      const upstream = await fetch(`http://127.0.0.1:${target.port}${url.pathname}${url.search}`, init as RequestInit);
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
    } catch (error) {
      if (hasBody || active === target) {
        logError(`proxy error: ${(error as Error).message}`);
        return text('Bad gateway', 502);
      }
    }
  }
  return text('Bad gateway', 502);
}

// ---------- startup and shutdown ----------

async function startInitialRelease() {
  const recorded = existsSync(CURRENT_FILE) ? readFileSync(CURRENT_FILE, 'utf8').trim() : null;
  const candidates = [...new Set([recorded, await output([...GIT, 'rev-parse', 'HEAD'])])].filter((s): s is string => !!s);
  for (const sha of candidates) {
    // A restart reuses a built release silently; only a real build (a fresh install) is reported.
    const building = !isReady(sha);
    const started = Date.now();
    let number: number | null = null;
    try {
      if (building) {
        number = await buildNumber(sha);
        void reporter.started(sha, number);
        await buildRelease(sha, number, (step) => void reporter.step(sha, STEP_LABELS[step] ?? step));
      }
      await importTimetableIfNeeded(sha).catch((error: Error) => logError(`timetable import failed: ${error.message}`));
      const app = await startApp(sha);
      if (await waitHealthy(app)) {
        await promote(app);
        if (building) void reporter.live(sha, number, Math.round((Date.now() - started) / 1000));
        return;
      }
      await stopApp(app);
      logError(`${short(sha)} did not become healthy`);
      if (building) void reporter.failed(sha, 'Health check failed');
    } catch (error) {
      logError(`could not start ${short(sha)}: ${(error as Error).message}`);
      if (building) void reporter.failed(sha, failureSummary(error));
    }
  }
  throw new Error('no release could be started');
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, stopping`);
  clearTimeout(restartTimer);
  await stopApp(active);
  process.exit(0);
}

/** Public, read-only: which supervisor runs and what it serves. */
async function handleStatus(): Promise<Response> {
  let release: unknown = null;
  try {
    release = active ? JSON.parse(readFileSync(join(releaseDir(active.sha), READY_MARKER), 'utf8')) : null;
  } catch {
    release = null;
  }
  return Response.json(
    {
      supervisor: supervisorInfo,
      live: active ? { commit: active.sha, healthy: active.healthy, ...(release as object) } : null,
      deploying,
      lastDeploy,
      lastFailedCommit: lastFailedSha,
      githubStatus: reporter.enabled,
      branch: BRANCH,
      autoDeploy: AUTO_DEPLOY,
      webhook: Boolean(SECRET),
      pollSeconds: AUTO_DEPLOY ? POLL_SECONDS : 0,
      timetable: active ? { file: active.dbFile.slice(DATA_DIR.length + 1), updatedAt: new Date(mtimeOf(active.dbFile) ?? 0).toISOString() } : null,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

async function main() {
  mkdirSync(RELEASES_DIR, { recursive: true });
  mkdirSync(GTFS_DIR, { recursive: true });
  supervisorInfo.startedFromCommit = await output([...GIT, 'rev-parse', 'HEAD']).catch(() => null);
  // The configured URL, before any url.insteadOf rewriting.
  const githubRepo = parseGithubRepo(await output([...GIT, 'config', '--get', 'remote.origin.url']).catch(() => ''));
  reporter = createReporter({
    token: GITHUB_STATUS ? GITHUB_TOKEN : '',
    repo: githubRepo,
    publicUrl: env.PUBLIC_URL,
    apiUrl: env.GITHUB_API_URL || undefined,
  });
  if (GITHUB_TOKEN && GITHUB_STATUS && !githubRepo) logError('origin is not a GitHub repository; GitHub status is off');
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  Bun.serve({
    port: PORT,
    idleTimeout: 120,
    fetch(req, server) {
      const { pathname } = new URL(req.url);
      if (pathname === '/__deploy/github') return handleWebhook(req);
      if (pathname === '/__deploy/status') return handleStatus();
      return proxy(req, server);
    },
  });
  log(
    `proxy on port ${PORT}, branch ${BRANCH}, auto deploy ${AUTO_DEPLOY ? 'on' : 'off'}, webhook ${SECRET ? 'on' : 'off'}, ` +
      `poll ${AUTO_DEPLOY && POLL_SECONDS > 0 ? `${POLL_SECONDS}s` : 'off'}, github status ${reporter.enabled ? 'on' : 'off'}, data ${DATA_DIR}`,
  );

  await startInitialRelease();
  console.log(`Server running on port ${PORT}`);
  pruneReleases([active!.sha]);
  setInterval(() => void checkTimetable(), TIMETABLE_CHECK_MS);

  if (AUTO_DEPLOY) {
    requestDeploy('startup check');
    if (POLL_SECONDS > 0) setInterval(() => void pollRemote(), POLL_SECONDS * 1000);
  }
}

main().catch((error) => {
  logError(`fatal: ${(error as Error).message}`);
  process.exit(1);
});
