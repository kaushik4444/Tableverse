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

/** The calendar date (YYYY-MM-DD) in Europe/Berlin at the given instant. */
function berlinDate(date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

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
      const deadline = () => AbortSignal.timeout(10000); // covers the response body too
      const live = await fetchFn(`${baseUrl}/healthz`, { signal: deadline() });
      const ready = await fetchFn(`${baseUrl}/readyz`, { signal: deadline() });
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

/** One run per check name: the newest (highest id). An older green run must never stand in for a newer red or running one. */
function latestRuns(runs) {
  const newest = new Map();
  for (const r of runs) {
    const seen = newest.get(r.name);
    if (!seen || r.id > seen.id) newest.set(r.name, r);
  }
  return [...newest.values()];
}

async function prState(client, owner, name, number) {
  const pr = (await client.call('GET', `/pulls/${number}`)).data;
  const all = [];
  for (let page = 1; ; page += 1) {
    const got = (await client.call('GET', `/commits/${pr.head.sha}/check-runs?per_page=100&page=${page}`)).data;
    all.push(...got.check_runs);
    if (got.check_runs.length < 100 || all.length >= got.total_count) break; // a short page is the last one
  }
  const runs = latestRuns(all);
  const checks = runs.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
  const copilot = runs.find((r) => r.name === COPILOT_CHECK);
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

// Release PRs merged to main from this repository's development branch on the given Berlin date. Scoped by head owner
// (as gather() does), filtered to this repository's own head, and paginated to the last page. If the scan limit is
// reached the run stops: an incomplete scan must never be read as "no release today".
const MAX_RELEASE_SCAN_PAGES = 50;
async function releasesMergedOn(client, repo, day) {
  const [owner] = repo.split('/');
  const found = [];
  for (let page = 1; ; page += 1) {
    if (page > MAX_RELEASE_SCAN_PAGES) {
      throw new Error(`Release lookup stopped after ${MAX_RELEASE_SCAN_PAGES} pages; refusing to release without a complete scan.`);
    }
    const batch = (await client.call('GET', `/pulls?state=closed&base=main&head=${encodeURIComponent(owner)}:development&per_page=100&page=${page}`)).data;
    found.push(...batch.filter((p) => p.merged_at && p.head.ref === 'development' && p.head.repo && p.head.repo.full_name === repo
      && berlinDate(new Date(p.merged_at)) === day));
    if (batch.length < 100) return found;
  }
}

async function main({ env = process.env, fetchFn = fetch, now = new Date(), git = { mergeTreeOf, gitOutput }, sleep } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const dryRun = env.DRY_RUN === 'true';
  const today = berlinDate(now);
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
  const mainSha = git.gitOutput(['rev-parse', 'origin/main']);
  const mergeTree = git.mergeTreeOf('origin/main', 'origin/development');
  // One release per Berlin day. Two signs count: a release tag for today, or a release PR merged today. The second still
  // counts if the tag write failed after the merge.
  const done = (await client.call('GET', `/git/matching-refs/tags/release-${today}-`)).data;
  const mergedToday = await releasesMergedOn(client, repo, today);
  if (done.length > 0 || mergedToday.length > 0) {
    const what = done.length ? done.map((t) => t.ref.replace('refs/tags/', '')).join(', ') : `PR #${mergedToday[0].number}`;
    say(`Skipped: today's release already happened (${what}). One release per Berlin day.`);
    return finish('skip', summary, { action: 'skip', reasons: [] });
  }
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
  // The gates used the snapshot of both branches taken at the start. Merge only if neither branch moved since then,
  // and the PR head is that same development commit.
  const liveDev = (await client.call('GET', '/git/ref/heads/development')).data.object.sha;
  const liveMain = (await client.call('GET', '/git/ref/heads/main')).data.object.sha;
  const snapshotMoved = liveDev !== devSha || liveMain !== mainSha || fresh.head_sha !== devSha;
  if (snapshotMoved || fresh.head_sha !== lastState.head_sha || again.action !== 'merge') {
    say(`Blocked: a branch or the PR moved while the gates were checked (development ${String(devSha).slice(0, 7)} -> ${liveDev.slice(0, 7)}, main ${String(mainSha).slice(0, 7)} -> ${liveMain.slice(0, 7)}, PR head ${fresh.head_sha.slice(0, 7)}). Nothing was merged; the next run checks again.`);
    return finish('block', summary, again);
  }
  if (!env.PRODUCTION_URL) {
    say('Blocked: the PRODUCTION_URL repository variable is not set, so the health check has no target. Nothing was merged (checked in dry runs too).');
    return finish('block', summary, decision);
  }
  if (dryRun) {
    say(`DRY RUN: all gates pass on PR #${prNumber}; would ${mergeMethod} ${fresh.head_sha.slice(0, 7)}.`);
    return finish('dry-run', summary, decision);
  }
  const merged = (await client.call('PUT', `/pulls/${prNumber}/merge`, { merge_method: mergeMethod, sha: fresh.head_sha, commit_title: 'Daily release: development to main' })).data;
  say(`Merged PR #${prNumber} as ${merged.sha.slice(0, 7)}.`);
  const tag = `release-${today}-${merged.sha.slice(0, 7)}`;
  const mergedTree = (await client.call('GET', `/git/commits/${merged.sha}`)).data.tree.sha;
  if (mergedTree !== devTree) {
    say(`RELEASE MISMATCH: main is now ${merged.sha.slice(0, 7)}, whose tree differs from the checked development tree. Something else changed main during the run. Investigate before the next release (docs/RELEASES.md).`);
    log(`::error::Release ${merged.sha.slice(0, 7)} does not match the checked development tree`);
    return finish('mismatch', summary, decision, 1);
  }
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

module.exports = { decide, berlinHour, checkHealth, makeClient, main, latestRuns, REQUIRED_CHECKS, COPILOT_CHECK, RELEASE_HOUR };
