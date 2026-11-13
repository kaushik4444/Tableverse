# Making the repository private: readiness assessment and checklist

Status of this document: assessment only. **Nothing in the repository, GitHub or Render settings was changed to prepare it.**
The owner changes the visibility by hand (section 5). Each statement below says how it was checked:

- **Verified in the repo**: read from files in this repository.
- **Verified via GitHub API**: read from `kaushik4444/Tableverse` while preparing this document.
- **From provider documentation**: read from the cited page; settings that only the owner can see are marked **Owner must check**.
- **Not verified**: could not be checked from here; do not assume.

## 1. Summary

Making the repository private does **not** touch the running production service: Render serves a built copy of the code, so the
site keeps running. What can break is everything that *reads the repository afterwards*: Render's next deploy, GitHub Actions
(minutes become metered), the branch rulesets (plan-dependent), and the AI integrations (Copilot review, Claude Code).

| Area | Expected effect | Risk |
|---|---|---|
| Running production site | None | none |
| Render auto-deploy from `main` | Should continue, **if** the Render GitHub app can see the repository; Render documents that a repo that changes from public to private can leave the connection misconfigured | **Medium: test it (section 6)** |
| GitHub Actions (CI) | Keeps working, but private repositories use the plan's included compute allowance instead of being free | **Medium: cost and quota** |
| Required checks and branch rulesets | **Rulesets are available for private repositories only on GitHub Pro, Team or Enterprise Cloud**; on GitHub Free they stop being enforced | **High if the owner is on GitHub Free** |
| Copilot code review (requested automatically by both rulesets) | Needs a Copilot plan that covers private repositories; without it, review coverage is lost (it does not by itself block merges) | **Owner must check** |
| Claude Code (this agent) | Needs authorized access to the private repository | Low if the GitHub connection is authorized |
| Public forks, Pages, public links | None found for forks and Pages; the application has no GitHub links, but the issue template and beta guide do (section 2.3) | Low; **check the tester access route** |
| Already-published history | Stays exposed (see section 4) | Informational |

## 2. What was checked

### 2.1 Repository facts (verified via GitHub API)

- `kaushik4444/Tableverse` is owned by a **personal account** (not an organization), visibility `public`, default branch `main`.
- 0 forks, GitHub Pages off, wiki and issues on, no Discussions.
- Security features enabled: Dependabot security updates, secret scanning, secret-scanning push protection.
- Branches `main` and `development` were identical when this was first written. Since then `development` has moved ahead through PR #125 and the CI trigger fix (#128, #129, both merged).
- Two **rulesets** are active: `Protect-Main` (default branch) and `Protect-Development`. Each has the same rules: no deletion, no
  non-fast-forward (no force-push), pull request required, **five required status checks** (`Build and test (Node 20)`,
  `Build and test (Node 22)`, `Build production Docker image`, `Browser layout and interaction checks`,
  `Production dependency audit`) and the `copilot_code_review` rule, which requests a review automatically.
- The repository's installed-apps, webhooks, Actions settings and billing plan are **not readable from the agent environment**
  (the API proxy refuses those paths): **Owner must check** items are listed in section 3.

### 2.2 Workflows (verified in the repo)

| File | Trigger | Permissions | Secrets | Notes |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | pull requests and pushes to `main` and `development` (both since #128/#129) | `contents: read` | none | 4 job groups: Build and test on Node 20 and 22 (with a throw-away `postgres:16` service container), browser checks, dependency audit, Docker build. Uses only GitHub-owned actions (`actions/checkout@v5`, `actions/setup-node@v5`). |
| `.github/workflows/cleanup-unverified.yml` | daily schedule (03:17 UTC) and manual | per file | `CLEANUP_DRYRUN_DATABASE_URL` (read-only role), `CLEANUP_DATABASE_URL` (manual, approval-gated) | The execute job needs the `CLEANUP_EXECUTE` repository variable and manual approval. It never runs on the schedule. |

Visibility does not change workflow permissions or repository-level secrets and variables: they carry over unchanged.

**Environment protection needs checking.** The execute job of `cleanup-unverified.yml` runs in the `production-cleanup` environment,
and a required reviewer must approve it before it starts. Environment protection rules and environment-scoped secrets depend on the
plan for private repositories; GitHub's plan documentation should be read for the current position. **Owner must check** that
`production-cleanup` still has its required reviewer and that `CLEANUP_DATABASE_URL` is still available after the change. Until
both are confirmed, keep the `CLEANUP_EXECUTE` repository variable set to `false`: a dry run cannot test the deletion gate.

**Resolved: CI trigger mismatch.** `ci.yml` previously ran only for `main`, so pull requests into `development` could never satisfy
`Protect-Development`. It now runs for both branches (#128 on `main`, #129 on `development`).

### 2.3 Hosting and integrations

- **Render** (from `render.yaml`, verified in the repo): a Blueprint with a free web service `tableverse`, `runtime: node`,
  `buildCommand: npm ci`, `startCommand: npm start`, `healthCheckPath: /healthz`, secrets set with `sync: false`.
  Deploys are pulled by Render from GitHub through its GitHub app; GitHub does not push to Render and no deploy hook or token is stored in
  this repository (verified by search: no Render credentials appear anywhere in the repo or workflows).
  Provider documentation ([Render: connect GitHub](https://render.com/docs/github)): Render uses its GitHub app; the app can be
  limited to selected repositories, so the repository must be in its "Repository access" list; and a repository that was public and
  became private may leave the connection misconfigured and disrupt GitHub deploys, in which case the service's Git credentials are
  re-selected in the service settings.
- The application itself calls Render's API at run time for the admin console's log history (`lib/renderLogs.js`, with `RENDER_API_KEY`,
  `RENDER_SERVICE_ID`, `RENDER_OWNER_ID` set on Render). That is a Render-to-Render call and does not involve GitHub, so repository
  visibility does not affect it.
- **Neon** and **Resend**: not connected to GitHub in the repository (no workflow or file refers to them except through runtime
  environment variables on Render). Unaffected.
- **Copilot code review**: configured by the rulesets, not by a file in the repository. Both rulesets request a review automatically.
  **Owner must check** that the Copilot plan covers private repositories before the change: without it, automatic review stops.
- **Claude Code**: works through an authorized GitHub connection. It reads the repository over that connection; a private
  repository needs the connection to have access to it.
- **Public links to GitHub**: the application's own pages do not link to GitHub, and no file refers to `raw.githubusercontent.com`
  or a Pages address. Two things do point to the public repository: the issue template contact links
  (`.github/ISSUE_TEMPLATE/config.yml`: beta guide and support guide) and `docs/BETA_ONBOARDING.md` (testers are directed to the public
  issue forms). After privatization these are unavailable to testers without repository access. **Owner must decide** how testers
  reach the guides and reporting route before the change.

## 3. Provider facts that decide the outcome

1. **Rulesets and branch protection on private repositories.** GitHub's documentation
   ([About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets))
   states that rulesets are available in public repositories with GitHub Free, and in public **and private** repositories with GitHub Pro,
   GitHub Team and GitHub Enterprise Cloud. If the account is on GitHub Free, the two rulesets would no longer be enforced once
   the repository is private: pull requests, required checks and force-push protection stop being guaranteed. **Owner must check the
   plan** (GitHub → Settings → Billing and plans). Options: keep the repository public, move to GitHub Pro (paid), or accept
   no enforced protection and rely on discipline. This is a cost decision for the owner.
2. **Actions usage.** Standard GitHub-hosted runners are free in public repositories. For private repositories GitHub Free
   includes a monthly compute allowance, expressed as an amount of money ($12 at the time of writing, billing page
   [About billing for GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)) and billed per
   minute (Linux 2-core: $0.006 per minute, i.e. roughly 2,000 minutes). One pull-request run here starts about five jobs (two
   Node versions with PostgreSQL, browser checks, audit, Docker build), so a busy day of pushes can use a large share of the
   allowance. The nightly cleanup dry-run adds a little. **Owner must check** the usage in Settings → Billing before and after.
   When the included allowance is used up, GitHub bills further usage if a valid payment method is on the account; usage stops only
   when there is no payment method or a spending limit prevents overage. Owner must confirm that policy before the change. If jobs stop,
   **required checks cannot pass, which blocks merging**. Possible mitigations (none applied here): fewer pushes per PR. Dropping the
   Node 20 job removes a required check, so it requires updating both rulesets first. Path filters that skip the required workflow
   leave required checks pending, so avoid them unless an always-running required gate replaces them.
3. **Secret scanning and push protection** are enabled today. Their availability on private repositories depends on the plan
   (GitHub Secret Protection is a separate offering). **Owner must check** Settings → Code security after the change; Dependabot
   alerts and updates are free for private repositories.

## 4. History exposure (important, and not undone by going private)

The repository has been public, so everything ever committed has been readable and may have been cloned or cached. Making it
private stops new access but cannot recall copies. Before the change:

- Confirm no secret was ever committed (the repo ignores `.env`, `.env.local`, `.neon/`, `neon.ts`, `backups/`). If there is any
  doubt, rotate that secret: the owner decides this; do **not** rotate as part of this task.
- Secrets used by the workflows stay in GitHub Actions secrets, not in the repository.

## 5. Checklists

### 5.1 Before changing visibility (owner)

- [ ] Note the GitHub plan (Settings → Billing and plans). If it is **Free**, decide about rulesets (section 3, point 1) first.
- [ ] Confirm the Copilot plan covers private repositories (both rulesets request Copilot review automatically).
- [ ] Note the current Actions usage (Settings → Billing → Usage) so the change in consumption is visible afterwards.
- [ ] In Render: open the service → Settings → Build & Deploy, write down the connected repository, branch (`main`) and "Auto-Deploy"
      setting. Open GitHub → Settings → Applications → Installed GitHub Apps → Render → Configure, and write down its repository access
      ("All repositories" or the selected list).
- [ ] Make sure no pull request is mid-merge and `main` is green (a clean starting point makes any later failure attributable).
- [ ] Optional: take a screenshot of `Protect-Main` / `Protect-Development` (Settings → Rules) for comparison afterwards.
- [ ] Confirm nobody needs the public URL (no links to the repository are used inside the app).
- [ ] Do **not** change Render environment variables, rotate credentials or edit rulesets as part of this step.

### 5.2 The change (owner, by hand)

GitHub → repository → Settings → General → Danger Zone → **Change repository visibility** → **Make private**, then confirm.
(GitHub warns that forks, stars, watchers and Pages are affected; there are none here.)

### 5.3 After changing visibility (owner, in this order)

1. [ ] **Repository still opens when signed in; signed out it shows 404.**
2. [ ] **Render access**: GitHub → Settings → Applications → Render → Configure: the repository is in the allowed list (add it if the
      app is limited to selected repositories). Render → service → Settings: the repository is still listed with no error banner.
3. [ ] **Render deploy test**: Render → Manual Deploy → "Deploy latest commit" (or merge a harmless docs change). Expect: build `npm ci`,
      start `npm start`, health check `/healthz` passing, deploy "Live". If it fails to fetch the repository: Render → Settings →
      Build & Deploy → re-select the Git credentials/repository (Render's documented fix).
4. [ ] **Auto-deploy**: after the next merge to `main`, a new deploy starts by itself within a minute or two.
5. [ ] **Production check** (no login needed): open `https://<your-service>/healthz` (body `ok`) and `/readyz` (body starts with `ready`; both return HTTP 200 when healthy), the home page loads, a guest can create
      a table, and a registered player can sign in. (Cookie and database behaviour are unchanged by repository visibility.)
6. [ ] **CI**: open a pull request (a docs-only change is enough). All five required checks appear and pass; Copilot review runs.
7. [ ] **Rulesets**: Settings → Rules shows `Protect-Main` and `Protect-Development` as **Active** (not "not enforced"). Try the
      protection: a direct push to `main` is refused.
8. [ ] **Actions usage**: Settings → Billing → Usage shows the included allowance being consumed; set a spending limit of $0 if you
      do not want to be billed beyond it.
9. [ ] **Scheduled cleanup dry-run**: Actions → "Unverified account cleanup" → run workflow (dry-run). It still finds
      `CLEANUP_DRYRUN_DATABASE_URL` and reports a count. (Never run the execute job as a test.)
10. [ ] **Claude Code and Copilot**: a new pull request receives a Copilot review; Claude Code can fetch and push a branch.
11. [ ] **Code security**: Settings → Code security shows Dependabot alerts on; note whether secret scanning / push protection are
      still active on the private repository.

### 5.4 If something breaks

| Symptom | Likely cause | Action |
|---|---|---|
| Render deploy fails with a repository or authorization error | Render's GitHub app lost the repository | Add it under the app's repository access, then re-select the repository/credentials in the service settings. |
| CI jobs do not start or show "queued" for a long time | Actions allowance used up | Check Billing → Usage; wait for the reset, raise the limit, or reduce jobs. Merging is blocked until checks pass. |
| Rulesets show as not enforced | Free plan with a private repository | Upgrade the plan or switch visibility back (below). |
| Copilot review never arrives | Copilot plan does not cover private repositories | Check the Copilot plan. Missing automatic review is not a merge block by itself, but restore the review coverage before relying on the rules. |
| Anything else unexpected | | **Switch the repository back to public** (same Danger Zone setting). This is not a full rollback: once public again, the code and Actions logs are readable, including anything added while private. Do a disclosure review before republishing. Stars and watchers are not recovered. The running site is unaffected either way. |

## 6. What this change does not affect

- The running production site, its database (Neon), e-mail (Resend) and voice (Metered) services.
- Stored secrets (Render environment variables, GitHub Actions secrets and variables).
- The application code, the build, and the tests.

## 7. Items for the owner to decide or confirm

1. GitHub plan, and whether to pay for rulesets on a private repository (the biggest open question).
2. Copilot access for the private repository.
3. Actions allowance and whether to trim the CI matrix.
4. ~~Whether to merge the small CI trigger fix~~ Done (#128, #129): pull requests into `development` run the checks.
5. How testers reach the beta guide and reporting route after privatization (section 2.3).
6. Whether `production-cleanup` keeps its required reviewer and `CLEANUP_DATABASE_URL` after privatization (section 2.2).
