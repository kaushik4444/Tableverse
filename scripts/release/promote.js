#!/usr/bin/env node
'use strict';
// Daily promotion of development to main (see docs/RELEASES.md).
//
// decide() is pure: it turns the observed repository state into one action and the reasons for it, so every gate can be tested
// without GitHub. main() gathers that state through the GitHub API, acts on the decision, and writes a summary.
// Nothing here bypasses a branch rule: the final merge is a normal squash merge pinned to the verified head, and GitHub still
// enforces every required check, review rule and conversation rule on that merge.

const { execFileSync } = require('node:child_process');

const REQUIRED_CHECKS = [
  'Build and test (Node 20)',
  'Build and test (Node 22)',
  'Browser layout and interaction checks',
  'Production dependency audit',
  'Build production Docker image',
];
const COPILOT_CHECK = 'copilot-pull-request-reviewer';
const RELEASE_HOUR = 2; // 02:00 Europe/Berlin
const REQUIRED_RULE_TYPES = ['required_status_checks', 'pull_request', 'non_fast_forward', 'deletion', 'copilot_code_review'];
const GOOD_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

/** The hour (0-23) in Europe/Berlin at the given instant. */
function berlinHour(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((p) => p.type === 'hour').value);
}

/**
 * state = {
 *   frozen: boolean, scheduled: boolean, berlinHour: number,
 *   devTree, mainTree, mergeTree: string|null (null when the merge would conflict),
 *   openPrs: [{ number, head: 'development', base: 'main' }],
 *   rules: { main: string[], development: string[] },        // rule types present on each branch
 *   pr: null | { number, base, head, head_sha, mergeable: boolean|null, checks: {name, status, conclusion}[],
 *                copilotConclusion: string|undefined, threads: { unresolved: number, hasNextPage: boolean } }
 * }
 * Returns { action: 'skip' | 'block' | 'create' | 'merge', reasons: string[] }.
 * 'create' means: open the release PR, then call decide() again with its state to evaluate the gates.
 */
function decide(state) {
  if (state.frozen) return { action: 'skip', reasons: ['Release freeze is on (repository variable RELEASE_FREEZE=true).'] };
  if (state.scheduled && state.berlinHour !== RELEASE_HOUR) {
    return { action: 'skip', reasons: [`Scheduled run at ${String(state.berlinHour).padStart(2, '0')}:xx Berlin time; releases run in the 02:xx slot only.`] };
  }
  if (state.mergeTree === null) {
    return { action: 'block', reasons: ['main and development conflict. Squash releases leave main out of development\'s history, so an edit to a line the last release changed conflicts. This needs an owner decision (docs/RELEASES.md, "Squash history"); the release is not forced.'] };
  }
  if (state.mergeTree !== state.devTree) {
    return { action: 'block', reasons: ['main has changes that development does not have. Bring them into development first (docs/RELEASES.md, hotfix procedure); a release now would undo them.'] };
  }
  if (state.devTree === state.mainTree) return { action: 'skip', reasons: ['No changes: main and development have the same content. No PR is created.'] };
  if (state.openPrs.length > 1) {
    return { action: 'block', reasons: [`${state.openPrs.length} open release PRs from development to main (#${state.openPrs.map((p) => p.number).join(', #')}). Close all but one.`] };
  }
  for (const branch of ['main', 'development']) {
    const missing = REQUIRED_RULE_TYPES.filter((t) => !(state.rules[branch] || []).includes(t));
    if (missing.length) return { action: 'block', reasons: [`Branch ${branch} is missing expected rules: ${missing.join(', ')}.`] };
  }
  if (!state.pr) return { action: 'create', reasons: ['Changes are ready: a release PR from development to main is needed.'] };

  const pr = state.pr;
  const blockers = [];
  if (pr.base !== 'main' || pr.head !== 'development') blockers.push(`PR #${pr.number} must go from development to main.`);
  if (pr.mergeable === false) blockers.push('Merge conflict on the release PR.');
  if (pr.mergeable === null) blockers.push('GitHub has not computed mergeability yet; the next run will check again.');
  const byName = new Map(pr.checks.map((c) => [c.name, c]));
  for (const name of REQUIRED_CHECKS) {
    const c = byName.get(name);
    if (!c) blockers.push(`Required check missing: "${name}".`);
    else if (c.status !== 'completed') blockers.push(`Required check still running: "${name}".`);
    else if (!GOOD_CONCLUSIONS.has(c.conclusion)) blockers.push(`Required check failed: "${name}" (${c.conclusion}).`);
  }
  for (const c of pr.checks) {
    if (c.status === 'completed' && !GOOD_CONCLUSIONS.has(c.conclusion) && !REQUIRED_CHECKS.includes(c.name)) {
      blockers.push(`Check failed: "${c.name}" (${c.conclusion}).`);
    }
  }
  if (pr.copilotConclusion !== 'success') {
    blockers.push(pr.copilotConclusion ? `Copilot review did not succeed (${pr.copilotConclusion}).` : 'Copilot review has not run on this PR head. Owner action may be needed (docs/RELEASES.md).');
  }
  if (pr.threads.hasNextPage) blockers.push('More than 100 review conversations; the gate cannot confirm all are resolved.');
  if (pr.threads.unresolved > 0) blockers.push(`${pr.threads.unresolved} review conversation(s) still open.`);
  if (blockers.length) return { action: 'block', reasons: blockers };
  return { action: 'merge', reasons: [`All gates passed on PR #${pr.number} at ${pr.head_sha.slice(0, 7)}.`] };
}

/** Post-merge health: /readyz must answer 200 with a body starting "ready" on three checks in a row, and /healthz 200. */
async function checkHealth(baseUrl, fetchFn, { attempts = 10, intervalMs = 30000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let streak = 0;
  let last = 'no check ran';
  for (let i = 0; i < attempts; i += 1) {
    try {
      const live = await fetchFn(`${baseUrl}/healthz`);
      const ready = await fetchFn(`${baseUrl}/readyz`);
      const readyBody = (await ready.text()).trim();
      const ok = live.status === 200 && ready.status === 200 && readyBody.startsWith('ready');
      last = `healthz ${live.status}, readyz ${ready.status} "${readyBody.slice(0, 20)}"`;
      streak = ok ? streak + 1 : 0;
      if (streak >= 3) return { ok: true, detail: last };
    } catch (err) {
      streak = 0;
      last = `request failed: ${err.code || err.name}`;
    }
    if (i < attempts - 1) await sleep(intervalMs);
  }
  return { ok: false, detail: last };
}

function gitOutput(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (err) { return null; }
}

/** The tree a three-way merge of development into main produces, or null when it conflicts. */
function mergeTreeOf(mainRef, devRef) {
  const out = gitOutput(['merge-tree', '--write-tree', mainRef, devRef]);
  return out ? out.split('\n')[0] : null;
}

function makeClient({ token, repo, fetchFn = fetch }) {
  const base = `https://api.github.com/repos/${repo}`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  async function call(method, url, body, expectOk = true) {
    const res = await fetchFn(url.startsWith('http') ? url : base + url, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (expectOk && !res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${data && data.message ? data.message : text.slice(0, 200)}`);
    return { status: res.status, data };
  }
  async function graphql(query, variables) {
    const res = await fetchFn('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    const data = await res.json();
    if (data.errors) throw new Error(`GraphQL: ${data.errors[0].message}`);
    return data.data;
  }
  return { call, graphql, base, fetchFn };
}

async function gather(client, { repo, git }) {
  const [owner, name] = repo.split('/');
  const rulesOf = async (branch) => (await client.call('GET', `/rules/branches/${branch}?per_page=100`)).data.map((r) => r.type);
  const rules = { main: await rulesOf('main'), development: await rulesOf('development') };
  const openPrs = (await client.call('GET', `/pulls?state=open&base=main&head=${encodeURIComponent(owner)}:development&per_page=100`)).data
    .filter((p) => p.head.ref === 'development' && p.head.repo && p.head.repo.full_name === repo)
    .map((p) => ({ number: p.number, head: p.head.ref, base: p.base.ref }));
  return { rules, openPrs, owner, name, git };
}

async function prState(client, owner, name, number) {
  const pr = (await client.call('GET', `/pulls/${number}`)).data;
  const runs = (await client.call('GET', `/commits/${pr.head.sha}/check-runs?per_page=100`)).data.check_runs;
  const checks = runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
  const copilot = runs.filter((r) => r.name === COPILOT_CHECK).pop();
  const threadsData = (await client.graphql(
    'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}',
    { owner, name, number }
  )).repository.pullRequest.reviewThreads;
  return {
    number, base: pr.base.ref, head: pr.head.ref, head_sha: pr.head.sha, mergeable: pr.mergeable,
    checks, copilotConclusion: copilot ? (copilot.status === 'completed' ? copilot.conclusion : 'in_progress') : undefined,
    threads: { unresolved: threadsData.nodes.filter((n) => !n.isResolved).length, hasNextPage: threadsData.pageInfo.hasNextPage },
  };
}

async function main({ env = process.env, fetchFn = fetch, now = new Date(), git = { mergeTreeOf, gitOutput }, sleep } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const dryRun = env.DRY_RUN === 'true';
  // squash is the default. 'merge' keeps development's history in main; see docs/RELEASES.md "Squash history".
  const mergeMethod = env.RELEASE_MERGE_METHOD === 'merge' ? 'merge' : 'squash';
  const scheduled = env.GITHUB_EVENT_NAME === 'schedule';
  const client = makeClient({ token: env.GITHUB_TOKEN, repo, fetchFn });
  const log = (msg) => console.log(msg);
  const summary = [];
  const say = (line) => { log(line); summary.push(line); };

  const devTree = git.gitOutput(['rev-parse', 'origin/development^{tree}']);
  const mainTree = git.gitOutput(['rev-parse', 'origin/main^{tree}']);
  const devSha = git.gitOutput(['rev-parse', 'origin/development']);
  const mergeTree = git.mergeTreeOf('origin/main', 'origin/development');
  const g = await gather(client, { repo, git });
  const base = { frozen: env.RELEASE_FREEZE === 'true', scheduled, berlinHour: berlinHour(now), devTree, mainTree, mergeTree, openPrs: g.openPrs, rules: g.rules, pr: null };

  let prNumber = g.openPrs.length === 1 ? g.openPrs[0].number : null;
  let lastState = prNumber ? await prState(client, g.owner, g.name, prNumber) : null;
  let decision = decide({ ...base, pr: lastState });
  if (decision.action === 'create') {
    if (dryRun) {
      say('DRY RUN: would open a release PR from development to main.');
      return finish('dry-run', summary, decision);
    }
    const created = (await client.call('POST', '/pulls', { title: 'Daily release: development to main', head: 'development', base: 'main', body: 'Opened by the daily release workflow. Merged automatically once every gate passes (docs/RELEASES.md).' })).data;
    prNumber = created.number;
    say(`Opened release PR #${prNumber}.`);
    lastState = await prState(client, g.owner, g.name, prNumber);
    decision = decide({ ...base, openPrs: [{ number: prNumber, head: 'development', base: 'main' }], pr: lastState });
  }
  if (decision.action !== 'merge') {
    for (const r of decision.reasons) {
      say(`${decision.action === 'skip' ? 'Skipped' : 'Blocked'}: ${r}`);
      if (decision.action === 'block') log(`::warning::${r}`);
    }
    return finish(decision.action, summary, decision);
  }
  // Every gate passed on lastState. Read the PR again: the merge goes ahead only if the same head still passes.
  const fresh = await prState(client, g.owner, g.name, prNumber);
  const again = decide({ ...base, openPrs: [{ number: prNumber, head: 'development', base: 'main' }], pr: fresh });
  if (fresh.head_sha !== lastState.head_sha || again.action !== 'merge') {
    say(`Blocked: PR #${prNumber} changed while the gates were checked (${lastState.head_sha.slice(0, 7)} -> ${fresh.head_sha.slice(0, 7)}). The next run checks again.`);
    return finish('block', summary, again);
  }
  if (dryRun) {
    say(`DRY RUN: all gates pass on PR #${prNumber}; would ${mergeMethod} ${fresh.head_sha.slice(0, 7)}.`);
    return finish('dry-run', summary, decision);
  }
  const merged = (await client.call('PUT', `/pulls/${prNumber}/merge`, { merge_method: mergeMethod, sha: fresh.head_sha, commit_title: 'Daily release: development to main' })).data;
  say(`Merged PR #${prNumber} as ${merged.sha.slice(0, 7)}.`);
  const tag = `release-${now.toISOString().slice(0, 10)}-${merged.sha.slice(0, 7)}`;
  await client.call('POST', '/git/refs', { ref: `refs/tags/${tag}`, sha: merged.sha });
  say(`Tagged ${tag}.`);
  const health = await checkHealth(env.PRODUCTION_URL, fetchFn, sleep ? { sleep } : {});
  if (!health.ok) {
    say(`PRODUCTION HEALTH FAILED after the release: ${health.detail}. Do not roll back the database. See "Recover from a failed release" in docs/RELEASES.md.`);
    log(`::error::Production health failed after release ${tag}: ${health.detail}`);
    return finish('health-failed', summary, decision, 1);
  }
  say(`Production healthy after the release: ${health.detail}.`);
  return finish('released', summary, decision);
}

function finish(outcome, summary, decision, code = 0) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (out) {
    try { require('node:fs').appendFileSync(out, `## Daily release: ${outcome}\n\n${summary.map((l) => `- ${l}`).join('\n')}\n`); } catch (_) { /* summary is best effort */ }
  }
  console.log(`outcome=${outcome}`);
  return { outcome, code, decision };
}

if (require.main === module) {
  main().then((r) => { process.exitCode = r.code; }, (err) => { console.error(`::error::${err.message}`); process.exitCode = 1; });
}

module.exports = { decide, berlinHour, checkHealth, makeClient, main, REQUIRED_CHECKS, COPILOT_CHECK, RELEASE_HOUR };
