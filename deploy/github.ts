// Reports deploys back to GitHub the way Vercel does: a commit status next to each commit and a
// "production" deployment in the repository sidebar. Reporting never fails or delays a deploy.
// Ported from the F1-Calendar project's deploy/github.js.

import { statusText } from './lib.ts';

export const CONTEXT = 'Mávy';
export const ENVIRONMENT = 'production';

export interface Reporter {
  enabled: boolean;
  queued(sha: string): Promise<unknown>;
  started(sha: string, number: number | null): Promise<unknown>;
  step(sha: string, label: string): Promise<unknown>;
  live(sha: string, number: number | null, seconds: number): Promise<unknown>;
  failed(sha: string, summary: string): Promise<unknown>;
  skipped(sha: string): Promise<unknown>;
  /** Resolves once every report sent so far has been answered (tests). */
  idle(): Promise<unknown>;
}

function noopReporter(): Reporter {
  const noop = () => Promise.resolve();
  return { enabled: false, queued: noop, started: noop, step: noop, live: noop, failed: noop, skipped: noop, idle: noop };
}

export function createReporter({
  token,
  repo,
  publicUrl,
  apiUrl = 'https://api.github.com',
  fetchImpl = fetch,
  log = console.error,
}: {
  token?: string | null;
  repo?: { owner: string; name: string } | null;
  publicUrl?: string | null;
  apiUrl?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  log?: (message: string) => void;
}): Reporter {
  if (!token || !repo) return noopReporter();

  const base = `${apiUrl.replace(/\/+$/, '')}/repos/${repo.owner}/${repo.name}`;
  const siteUrl = (publicUrl ?? '').replace(/\/+$/, '');
  const statusPageUrl = siteUrl ? `${siteUrl}/__deploy/status` : undefined;
  const deployments = new Map<string, number>(); // sha -> deployment id
  let queue: Promise<unknown> = Promise.resolve();

  async function call(method: string, path: string, body: unknown): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          'User-Agent': 'mavy-deploy',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        log(`[github] ${method} ${path.split('/').slice(0, 2).join('/')} answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
        return null;
      }
      return (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (error) {
      log(`[github] ${method} request failed: ${(error as Error).message}`);
      return null;
    }
  }

  // One after another, so GitHub sees them in order, without the deploy waiting for them.
  function enqueue(task: () => Promise<unknown>): Promise<unknown> {
    queue = queue.then(task, task);
    return queue;
  }

  const commitStatus = (sha: string, state: string, description: string, targetUrl?: string) =>
    call('POST', `/statuses/${sha}`, { state, context: CONTEXT, description: statusText(description), target_url: targetUrl });

  const deploymentStatus = (sha: string, state: string, description: string, extra: Record<string, unknown> = {}) => {
    const id = deployments.get(sha);
    if (!id) return null;
    return call('POST', `/deployments/${id}/statuses`, {
      state,
      description: statusText(description),
      environment: ENVIRONMENT,
      log_url: statusPageUrl,
      ...extra,
    });
  };

  return {
    enabled: true,
    queued: (sha) => enqueue(() => commitStatus(sha, 'pending', 'Queued', statusPageUrl)),
    started: (sha, number) =>
      enqueue(async () => {
        const label = number ? `Building #${number}…` : 'Building…';
        const deployment = await call('POST', '/deployments', {
          ref: sha,
          environment: ENVIRONMENT,
          description: statusText(label),
          auto_merge: false,
          required_contexts: [],
          production_environment: true,
          transient_environment: false,
        });
        if (typeof deployment?.id === 'number') deployments.set(sha, deployment.id);
        await deploymentStatus(sha, 'in_progress', label);
        await commitStatus(sha, 'pending', label, statusPageUrl);
      }),
    step: (sha, label) => enqueue(() => commitStatus(sha, 'pending', label, statusPageUrl)),
    live: (sha, number, seconds) =>
      enqueue(async () => {
        const label = `Live${number ? ` as #${number}` : ''}${seconds ? ` in ${seconds}s` : ''}`;
        // auto_inactive marks the previous production deployment inactive.
        await deploymentStatus(sha, 'success', label, { environment_url: siteUrl || undefined, auto_inactive: true });
        await commitStatus(sha, 'success', label, siteUrl || statusPageUrl);
        deployments.delete(sha);
      }),
    failed: (sha, summary) =>
      enqueue(async () => {
        await deploymentStatus(sha, 'failure', summary);
        await commitStatus(sha, 'failure', `${summary}; the previous build stays live`, statusPageUrl);
        deployments.delete(sha);
      }),
    skipped: (sha) => enqueue(() => commitStatus(sha, 'error', 'Skipped: a newer commit was deployed', statusPageUrl)),
    idle: () => queue,
  };
}
