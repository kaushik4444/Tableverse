'use strict';
// The daily release decision (scripts/release/promote.js): every gate, the Berlin time slot, the health check and one full flow.
const assert = require('node:assert/strict');
const { decide, berlinHour, checkHealth, main, REQUIRED_CHECKS, COPILOT_CHECK } = require('../scripts/release/promote');
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; console.log('  ok  ' + name); } catch (e) { console.error('  FAIL  ' + name + '\n' + (e && e.stack)); process.exitCode = 1; }
};

const RULES = ['required_status_checks', 'pull_request', 'non_fast_forward', 'deletion', 'copilot_code_review'];
const greenChecks = () => [...REQUIRED_CHECKS.map((name) => ({ name, status: 'completed', conclusion: 'success' })), { name: COPILOT_CHECK, status: 'completed', conclusion: 'success' }];
const goodPr = (over = {}) => ({
  number: 130, base: 'main', head: 'development', head_sha: 'abc1234', mergeable: true,
  checks: greenChecks(), copilotConclusion: 'success', threads: { unresolved: 0, hasNextPage: false }, ...over,
});
const base = (over = {}) => ({
  frozen: false, scheduled: true, berlinHour: 2, devTree: 'T1', mainTree: 'T0', mergeTree: 'T1',
  openPrs: [], rules: { main: RULES, development: RULES }, pr: null, ...over,
});

(async () => {
  console.log('daily release');
  await test('a scheduled run outside the 02:xx Berlin slot does nothing', async () => {
    assert.equal(decide(base({ berlinHour: 1 })).action, 'skip');
    assert.equal(decide(base({ berlinHour: 3 })).action, 'skip');
  });
  await test('a release freeze stops every run, scheduled or manual', async () => {
    assert.equal(decide(base({ frozen: true })).action, 'skip');
    assert.equal(decide(base({ frozen: true, scheduled: false })).action, 'skip');
  });
  await test('no changes: main and development have the same content, so no PR is created', async () => {
    const d = decide(base({ mainTree: 'T1' }));
    assert.equal(d.action, 'skip');
    assert.match(d.reasons[0], /No changes/);
  });
  await test('main with changes development lacks blocks the release (it would undo them)', async () => {
    const d = decide(base({ mergeTree: 'T9' }));
    assert.equal(d.action, 'block');
    assert.match(d.reasons[0], /main has changes/);
  });
  await test('a merge conflict blocks the release', async () => {
    assert.equal(decide(base({ mergeTree: null })).action, 'block');
  });
  await test('two open release PRs block, so duplicates are never merged', async () => {
    const d = decide(base({ openPrs: [{ number: 1 }, { number: 2 }] }));
    assert.equal(d.action, 'block');
    assert.match(d.reasons[0], /2 open release PRs/);
  });
  await test('missing expected branch rules block the release', async () => {
    const d = decide(base({ rules: { main: RULES.slice(1), development: RULES } }));
    assert.equal(d.action, 'block');
    assert.match(d.reasons[0], /missing expected rules: required_status_checks/);
  });
  await test('changes and no PR yet: the decision is to create the PR', async () => {
    assert.equal(decide(base()).action, 'create');
  });
  await test('an eligible PR with every gate green is merged', async () => {
    assert.equal(decide(base({ openPrs: [{ number: 130 }], pr: goodPr() })).action, 'merge');
  });
  await test('a failed required check blocks', async () => {
    const checks = greenChecks().map((c) => (c.name === 'Build and test (Node 22)' ? { ...c, conclusion: 'failure' } : c));
    const d = decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ checks }) }));
    assert.equal(d.action, 'block');
    assert.match(d.reasons.join(' '), /Required check failed: "Build and test \(Node 22\)"/);
  });
  await test('a required check still running blocks, and a missing one blocks', async () => {
    const running = greenChecks().map((c) => (c.name === 'Production dependency audit' ? { ...c, status: 'in_progress', conclusion: null } : c));
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ checks: running }) })).reasons.join(' '), /still running: "Production dependency audit"/);
    const missing = greenChecks().filter((c) => c.name !== 'Browser layout and interaction checks');
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ checks: missing }) })).reasons.join(' '), /missing: "Browser layout/);
  });
  await test('an incomplete Copilot review blocks, with the owner note', async () => {
    const d = decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ copilotConclusion: undefined }) }));
    assert.equal(d.action, 'block');
    assert.match(d.reasons.join(' '), /Copilot review has not run/);
    assert.equal(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ copilotConclusion: 'in_progress' }) })).action, 'block');
  });
  await test('an unresolved conversation blocks, and so does a list too long to confirm', async () => {
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ threads: { unresolved: 1, hasNextPage: false } }) })).reasons.join(' '), /1 review conversation/);
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ threads: { unresolved: 0, hasNextPage: true } }) })).reasons.join(' '), /More than 100/);
  });
  await test('a merge conflict on the PR blocks; mergeability not yet computed blocks too', async () => {
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ mergeable: false }) })).reasons.join(' '), /Merge conflict/);
    assert.match(decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ mergeable: null }) })).reasons.join(' '), /not computed/);
  });
  await test('a manual run is not limited to the 02:xx slot', async () => {
    assert.equal(decide(base({ scheduled: false, berlinHour: 15, openPrs: [{ number: 130 }], pr: goodPr() })).action, 'merge');
  });
  await test('Berlin hour follows daylight saving: 02:xx in both summer and winter time', async () => {
    assert.equal(berlinHour(new Date('2026-07-01T00:30:00Z')), 2, 'summer: 00:30 UTC is 02:30 Berlin');
    assert.equal(berlinHour(new Date('2026-12-01T01:30:00Z')), 2, 'winter: 01:30 UTC is 02:30 Berlin');
    assert.equal(berlinHour(new Date('2026-12-01T00:30:00Z')), 1, 'winter: 00:30 UTC is 01:30 Berlin, so the 00:00 UTC slot skips');
  });
  await test('health passes only after three good readings in a row; a failure resets the streak', async () => {
    const replies = [];
    const fakeFetch = async (url) => {
      if (url.endsWith('/healthz')) return { status: 200, text: async () => 'ok' };
      const next = replies.shift();
      if (next === 'boom') throw Object.assign(new Error('x'), { code: 'ECONNRESET' });
      return { status: next, text: async () => (next === 200 ? 'ready' : 'not ready') };
    };
    replies.push(200, 503, 200, 200, 200); // readyz readings: a failure resets the streak, three in a row pass
    const r = await checkHealth('https://example.test', fakeFetch, { attempts: 6, sleep: async () => {} });
    assert.equal(r.ok, true);
    const bad = await checkHealth('https://example.test', async (url) => ({ status: url.endsWith('/healthz') ? 200 : 503, text: async () => 'not ready' }), { attempts: 3, sleep: async () => {} });
    assert.equal(bad.ok, false);
  });
  await test('a full run merges the PR pinned to its verified head, tags it, and reports healthy', async () => {
    const calls = [];
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      if (url.includes('/git/matching-refs/')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      calls.push(`${method} ${url}`);
      const json = (data, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(data), json: async () => data });
      if (url.endsWith('/rules/branches/main?per_page=100') || url.endsWith('/rules/branches/development?per_page=100')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([{ ...pr, number: 130 }]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/commits/abc1234/check-runs?per_page=100')) return json({ check_runs: greenChecks().map((c) => ({ ...c, status: c.status, conclusion: c.conclusion })) });
      if (url.endsWith('/git/ref/heads/development')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'abc1234' } }) };
      if (url.endsWith('/git/ref/heads/main')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'M0' } }) };
      if (url.endsWith('/pulls/130/merge') && method === 'PUT') { assert.equal(JSON.parse(opts.body).sha, 'abc1234', 'the merge is pinned to the verified head'); return json({ sha: 'fff0001' }); }
      if (url.includes('/git/commits/')) return json({ tree: { sha: 'T1' } });
      if (url.endsWith('/git/refs')) return json({}, 201);
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/healthz')) return { status: 200, ok: true, text: async () => 'ok' };
      if (url.endsWith('/readyz')) return { status: 200, ok: true, text: async () => 'ready' };
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = {
      gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null,
      mergeTreeOf: () => 'T1',
    };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'released');
    assert.ok(calls.some((c) => c.startsWith('POST https://api.github.com/repos/kaushik4444/Tableverse/git/refs') || c.includes('/git/refs')));
  });
  await test('a head that moves between the gate check and the merge is not merged', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    let prReads = 0;
    const merges = [];
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      if (url.includes('/git/matching-refs/')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([{ ...pr }]);
      if (url.endsWith('/pulls/130') && method === 'GET') { prReads += 1; return json(prReads === 1 ? pr : { ...pr, head: { ...pr.head, sha: 'newpush9' } }); }
      if (url.includes('/commits/abc1234/check-runs?per_page=100') || url.includes('/commits/newpush9/check-runs?per_page=100')) return json({ check_runs: greenChecks() });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'abc1234' } }) };
      if (url.endsWith('/git/ref/heads/main')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'M0' } }) };
      if (url.endsWith('/merge') && method === 'PUT') { merges.push(url); return json({ sha: 'x' }); }
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'block');
    assert.equal(merges.length, 0, 'nothing is merged when the head moved');
  });
  await test('development moving after the gates were read, but before the merge, blocks the merge', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const merges = [];
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      if (url.includes('/git/matching-refs/')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([pr]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/check-runs?per_page=100')) return json({ check_runs: greenChecks() });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return json({ object: { sha: 'def5678' } });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'M0' } });
      if (url.endsWith('/merge') && method === 'PUT') { merges.push(url); return json({ sha: 'x' }); }
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'block');
    assert.equal(merges.length, 0, 'nothing is merged when development moved');
  });
  await test('a dry run also reports a missing PRODUCTION_URL, so the blocker shows before a real release', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([pr]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/check-runs?per_page=100')) return json({ total_count: 6, check_runs: greenChecks() });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return json({ object: { sha: 'abc1234' } });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'M0' } });
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: 'true' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'block');
  });
  await test('a second scheduled run on the same Berlin day does nothing (the autumn rollback has two 02:xx slots)', async () => {
    const fakeFetch = async (url, opts = {}) => {
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/tags/release-2026-10-25-')) return json([{ ref: 'refs/tags/release-2026-10-25-fff0001' }]);
      if (url.includes('/pulls?state=closed')) return json([]);
      throw new Error('unexpected ' + (opts.method || 'GET') + ' ' + url);
    };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-10-25T01:30:00Z'), git: { gitOutput: () => 'T1', mergeTreeOf: () => 'T1' }, sleep: async () => {} });
    assert.equal(r.outcome, 'skip');
  });
  await test('a release PR merged today counts even when its tag was never written', async () => {
    const fakeFetch = async (url, opts = {}) => {
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return json([{ number: 130, merged_at: '2026-10-25T00:20:00Z', head: { ref: 'development', repo: { full_name: 'kaushik4444/Tableverse' } } }]);
      throw new Error('unexpected ' + (opts.method || 'GET') + ' ' + url);
    };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-10-25T01:30:00Z'), git: { gitOutput: () => 'T1', mergeTreeOf: () => 'T1' }, sleep: async () => {} });
    assert.equal(r.outcome, 'skip');
  });
  await test('a fork PR from a branch named development does not count as today\'s release', async () => {
    const fakeFetch = async (url, opts = {}) => {
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return json([{ number: 99, merged_at: '2026-10-25T00:20:00Z', head: { ref: 'development', repo: { full_name: 'someone/Tableverse' } } }]);
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([]);
      throw new Error('unexpected ' + (opts.method || 'GET') + ' ' + url);
    };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test', DRY_RUN: 'true' };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-10-25T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'dry-run');
  });
  await test('an endless closed-PR list stops the run instead of reading an incomplete scan as no release', async () => {
    let calls = 0;
    const fakeFetch = async (url, opts = {}) => {
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) {
        calls += 1;
        return json(Array.from({ length: 100 }, (_, i) => ({ number: i, merged_at: null, head: { ref: 'feature', repo: { full_name: 'kaushik4444/Tableverse' } } })));
      }
      throw new Error('unexpected ' + (opts.method || 'GET') + ' ' + url);
    };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' };
    await assert.rejects(
      main({ env, fetchFn: fakeFetch, now: new Date('2026-10-25T01:30:00Z'), git: { gitOutput: () => 'T1', mergeTreeOf: () => 'T1' }, sleep: async () => {} }),
      /refusing to release without a complete scan/,
    );
    assert.equal(calls, 50);
  });
  await test('no PRODUCTION_URL: the release is blocked before anything is merged', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const merges = [];
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([pr]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/check-runs?per_page=100')) return json({ total_count: 6, check_runs: greenChecks() });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return json({ object: { sha: 'abc1234' } });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'M0' } });
      if (url.endsWith('/merge') && method === 'PUT') { merges.push(url); return json({ sha: 'x' }); }
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'block');
    assert.equal(merges.length, 0);
  });
  await test('main that does not match the checked tree after the merge is reported as a mismatch, and no tag is written', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const tags = [];
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([pr]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/check-runs?per_page=100')) return json({ total_count: 6, check_runs: greenChecks() });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return json({ object: { sha: 'abc1234' } });
      if (url.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'M0' } });
      if (url.endsWith('/merge') && method === 'PUT') return json({ sha: 'fff0001' });
      if (url.includes('/git/commits/')) return json({ tree: { sha: 'OTHER' } });
      if (url.endsWith('/git/refs')) { tags.push(url); return json({}, 201); }
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'mismatch');
    assert.equal(r.code, 1);
    assert.equal(tags.length, 0, 'no release tag for a release that does not match');
  });
  await test('check runs beyond the first page are read, so a failure on page two blocks the release', async () => {
    const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: 'extra ' + i, status: 'completed', conclusion: 'success' }));
    const fakeFetch = async (url, opts = {}) => {
      const method = opts.method || 'GET';
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data), json: async () => data });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([pr]);
      if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
      if (url.includes('/check-runs?per_page=100&page=1')) return json({ total_count: 107, check_runs: [...greenChecks().map((c, i) => ({ ...c, id: i + 1 })), ...many.slice(0, 100 - greenChecks().length)] });
      if (url.includes('/check-runs?per_page=100&page=2')) return json({ total_count: 107, check_runs: [{ id: 999, name: 'Production dependency audit', status: 'completed', conclusion: 'failure' }] });
      if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      throw new Error('unexpected ' + method + ' ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const r = await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'block');
  });
  await test('the open release PR is looked up by head and base, so a later page cannot hide it', async () => {
    const seen = [];
    const fakeFetch = async (url) => {
      seen.push(url);
      if (url.includes('/git/matching-refs/')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data) });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([]);
      throw new Error('unexpected ' + url);
    };
    const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', DRY_RUN: 'true' };
    await main({ env, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.ok(seen.some((u) => u.includes('head=kaushik4444%3Adevelopment') || u.includes('head=kaushik4444:development')), 'the request filters by head');
  });
  await test('the merge method is a merge commit by default, and squash only when the owner sets RELEASE_MERGE_METHOD=squash', async () => {
    const methods = [];
    for (const extra of [{}, { RELEASE_MERGE_METHOD: 'merge' }, { RELEASE_MERGE_METHOD: 'squash' }]) {
      const pr = { number: 130, base: { ref: 'main' }, head: { ref: 'development', sha: 'abc1234', repo: { full_name: 'kaushik4444/Tableverse' } }, mergeable: true };
      const fakeFetch = async (url, opts = {}) => {
        const method = opts.method || 'GET';
      if (url.includes('/git/matching-refs/')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
        const json = (data, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(data), json: async () => data });
        if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
        if (url.includes('/pulls?state=open')) return json([pr]);
        if (url.endsWith('/pulls/130') && method === 'GET') return json(pr);
        if (url.includes('/check-runs?per_page=100')) return json({ check_runs: greenChecks() });
        if (url.startsWith('https://api.github.com/graphql')) return json({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } });
      if (url.endsWith('/git/ref/heads/development')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'abc1234' } }) };
      if (url.endsWith('/git/ref/heads/main')) return { status: 200, ok: true, text: async () => JSON.stringify({ object: { sha: 'M0' } }) };
        if (url.endsWith('/merge') && method === 'PUT') { methods.push(JSON.parse(opts.body).merge_method); return json({ sha: 'fff0001' }); }
        if (url.includes('/git/commits/')) return json({ tree: { sha: 'T1' } });
      if (url.endsWith('/git/refs')) return json({}, 201);
        if (url.endsWith('/healthz')) return { status: 200, ok: true, text: async () => 'ok' };
        if (url.endsWith('/readyz')) return { status: 200, ok: true, text: async () => 'ready' };
        throw new Error('unexpected ' + method + ' ' + url);
      };
      const git = { gitOutput: (args) => ({ 'rev-parse,origin/development^{tree}': 'T1', 'rev-parse,origin/main^{tree}': 'T0', 'rev-parse,origin/development': 'abc1234', 'rev-parse,origin/main': 'M0' })[args.join(',')] || null, mergeTreeOf: () => 'T1' };
      await main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test', ...extra }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    }
    assert.deepEqual(methods, ['merge', 'merge', 'squash']);
  });
  await test('an unknown RELEASE_MERGE_METHOD stops the run before any GitHub call', async () => {
    let calls = 0;
    const fakeFetch = async () => { calls += 1; throw new Error('no GitHub call expected'); };
    await assert.rejects(
      main({ env: { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule', PRODUCTION_URL: 'https://example.test', RELEASE_MERGE_METHOD: 'rebase' }, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git: { gitOutput: () => 'T1', mergeTreeOf: () => 'T1' }, sleep: async () => {} }),
      /RELEASE_MERGE_METHOD must be "merge"/,
    );
    assert.equal(calls, 0);
  });
  await test('only the newest run per check name counts: an older green run cannot pass a newer running one', async () => {
    const { latestRuns } = require('../scripts/release/promote');
    const runs = [
      { id: 10, name: COPILOT_CHECK, status: 'completed', conclusion: 'success' },
      { id: 42, name: COPILOT_CHECK, status: 'in_progress', conclusion: null },
      { id: 7, name: 'Build and test (Node 20)', status: 'completed', conclusion: 'success' },
      { id: 8, name: 'Build and test (Node 20)', status: 'completed', conclusion: 'failure' },
    ];
    const newest = latestRuns(runs);
    assert.equal(newest.length, 2);
    assert.equal(newest.find((r) => r.name === COPILOT_CHECK).status, 'in_progress');
    assert.equal(newest.find((r) => r.name === 'Build and test (Node 20)').conclusion, 'failure');
    const checks = newest.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion }));
    const d = decide(base({ openPrs: [{ number: 130 }], pr: goodPr({ checks, copilotConclusion: 'in_progress' }) }));
    assert.equal(d.action, 'block');
  });
  await test('a duplicate run after the release finds no changes and does nothing', async () => {
    const env = { GITHUB_REPOSITORY: 'kaushik4444/Tableverse', GITHUB_TOKEN: 't', GITHUB_EVENT_NAME: 'schedule' };
    const fakeFetch = async (url) => {
      const json = (data) => ({ status: 200, ok: true, text: async () => JSON.stringify(data) });
      if (url.includes('/git/matching-refs/')) return json([]);
      if (url.includes('/pulls?state=closed')) return { status: 200, ok: true, text: async () => '[]', json: async () => [] };
      if (url.includes('/rules/branches/')) return json(RULES.map((type) => ({ type })));
      if (url.includes('/pulls?state=open')) return json([]);
      throw new Error('unexpected ' + url);
    };
    const git = { gitOutput: (args) => (args[1].includes('main') ? 'T1' : 'T1'), mergeTreeOf: () => 'T1' };
    const r = await main({ env, fetchFn: fakeFetch, now: new Date('2026-12-01T01:30:00Z'), git, sleep: async () => {} });
    assert.equal(r.outcome, 'skip');
    console.log(`${passed} daily release tests passed`);
  });
})();
