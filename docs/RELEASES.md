# Releases: daily promotion from development to main

Production (Render) deploys from `main` only. `development` is the integration branch. Every day at 02:00 Europe/Berlin, the
**Daily release** workflow (`.github/workflows/daily-release.yml`, logic in `scripts/release/promote.js`) promotes eligible
changes from `development` to `main`.

## How a day works

1. The workflow runs in the 02:xx Berlin slot (GitHub cron is UTC, so it is scheduled at 00:00 and 01:00 UTC and acts in the
   right one). On the autumn rollback day both slots are 02:xx, so the second run finds today's release tag and does nothing:
   **one release per Berlin day**. GitHub may start a scheduled run late; the release still happens in the 02:xx slot or on the
   next manual run.
2. If there is no content difference between `main` and `development` (compared by tree, not commits), it stops. **No empty
   PR is created.**
3. If there are changes, it opens one release PR from `development` to `main`, or reuses the open one. Never two.
4. It checks every gate (below) on the PR head. If all pass, it squash-merges the PR, pinned to the exact commit it checked,
   checks that the new `main` has the same content as the checked `development`, tags the release
   `release-YYYY-MM-DD-<sha>` (Berlin date), and checks production health. A content mismatch is reported as `RELEASE MISMATCH`
   and no tag is written.
5. Otherwise it leaves the PR open, writes the reasons to the run summary and as warnings, and stops. The next day tries again.

The merge is a squash merge through the GitHub API (the default; see *Squash history* below). GitHub still enforces the rulesets (five required checks, the Copilot
rule, conversation resolution). The workflow never uses an admin bypass, never force-pushes, and never approves its own PR.

## The gates

A release proceeds only when all of these hold on the PR head:

| Gate | Source | Blocks when |
|---|---|---|
| Release freeze off | repository variable `RELEASE_FREEZE` | it is `true` |
| Same slot | schedule | a scheduled run is outside 02:xx Berlin |
| main has nothing development lacks | `git merge-tree` of main and development | main has changes that development does not (a hotfix not synced yet) |
| No conflicts | `git merge-tree` and the PR `mergeable` field | either reports a conflict |
| Five required checks green | check runs on the head commit | any missing, pending or failed |
| Copilot review finished | check run `copilot-pull-request-reviewer` | missing, running or not successful |
| Newest run decides | every page of check runs, newest run per name | an older green run can never stand in for a newer red or running one |
| Production target set | repository variable `PRODUCTION_URL` | it is not set (checked before the merge, so nothing is merged) |
| Conversations resolved | GraphQL `reviewThreads` | any unresolved (lists over 100 are blocked) |
| Rules as expected | `GET /rules/branches/{main,development}` | a required rule type is missing |
| One release PR | open PRs | more than one |

A successful CI run alone is not enough: the workflow checks the Copilot review and the conversations separately.

## Squash history (owner decision needed)

A squash merge puts one new commit on `main`. That commit is **not** an ancestor of `development`, so Git's three-way merge
does not know that the released lines are already in `main`. In practice:

- The first release works. A later edit on `development` to a line that the last release changed conflicts with `main` when the
  next release is computed. The gate then **blocks** (it never forces a release), and GitHub would show the same conflict on the
  PR.
- Resolving it needs a person: the conflict is between two valid versions of a line.

The fix that avoids this entirely is to let releases keep history: allow **merge commits** in the repository settings
(Settings → General → Pull Requests) and set the repository variable `RELEASE_MERGE_METHOD=merge`. Then `main` contains
`development`'s commits and every later release merges cleanly. **This changes the approved squash policy and needs your decision.**
Until then, the default stays squash and a conflict is reported in the run summary.

## Owner settings

These cannot be set from the repository, and the workflow depends on them:

1. **Settings → Actions → General → Workflow permissions**: allow *"Allow GitHub Actions to create and approve pull requests"*.
   Without it, the release PR cannot be opened.
2. **Settings → Secrets and variables → Actions → Variables**: add `PRODUCTION_URL` (the Render service URL, for example
   `https://tableverse.example.com`, with no trailing slash). The post-release health check needs it.
3. **Squash history:** decide between squash (default, conflicts can block a later release; see above) and merge commits
   (`RELEASE_MERGE_METHOD=merge`, requires merge commits to be allowed in the repository settings).
4. **Copilot review on bot PRs (verify once):** Copilot's review runs on pull requests, but a PR opened by the workflow's
   `GITHUB_TOKEN` may not trigger it. If the Copilot check never appears on the release PR, every release is blocked with the
   message "Copilot review has not run on this PR head". Check the first release PR: if Copilot does not run, the owner decides
   between requesting Copilot review by hand on that PR each day or adding a GitHub App token. No personal access token is used or
   added by this workflow.

## Dry run (manual, safe)

Actions → **Daily release** → **Run workflow** → keep `dry_run` ticked (the default). The run evaluates every gate and writes the
result to its summary. It opens and merges nothing. Use it after any change to the rules or the workflow.

A manual run with `dry_run` unticked is a real release when the gates pass. Do not use it just to test.

## Release freeze

To stop releases (for example during an incident or a launch):

```sh
gh variable set RELEASE_FREEZE --body true --repo kaushik4444/Tableverse
```

To end the freeze: `gh variable delete RELEASE_FREEZE --repo kaushik4444/Tableverse`. While frozen, every run (scheduled or manual)
stops with the freeze reason. A frozen run does not close or change the open release PR.

## What happens when a gate fails

- **Blocked (CI red, Copilot not finished, conversation open, conflict):** the release PR stays open, the reason appears in the
  run summary and as a warning. Fix the cause on `development` (or resolve the conversation); the next run, or a manual run,
  proceeds. Nothing is merged, so nothing reaches production.
- **Blocked because main has changes development lacks:** see *Hotfixes* below. The release waits until development has them.
- **Failed run (health check failed after a merge):** the run fails and GitHub emails the repository's notification recipients.

## Recover from a failed release

If the post-release health check fails (`PRODUCTION HEALTH FAILED` in the run summary), production has a new commit that is not
serving correctly:

1. **Do not roll back the database.** Never reverse a migration automatically or by hand during an incident. Migrations are
   forward-only; a rollback of code that has already run a migration must keep working with the new schema.
2. **Restore the previous app version on Render** (dashboard → the service → Deploys → redeploy the last successful deploy). This
   is the only rollback the workflow relies on, and it is manual.
3. **Fix forward.** Put the fix on `development` (or, if it must go out now, use the hotfix procedure). Check `/healthz` and
   `/readyz` after each deploy.
4. Set `RELEASE_FREEZE=true` while you investigate so the next scheduled release does not run.

The release tag (`release-YYYY-MM-DD-<sha>`) marks the bad commit; use it to find what to revert or redeploy.

## Hotfixes and the release window

Do not merge anything to `main` while the **Daily release** workflow is queued or running (Actions tab). A scheduled run can start
late in the 02:xx slot, a manual run can start at any hour, and one run can take up to 30 minutes. The workflow pins the merge to the
checked `development` commit and then checks that `main` has that content. If another change reached `main` in the meantime, the
run reports `RELEASE MISMATCH` and writes no tag: investigate `main` and the release before the next run. Preventing the window
completely needs serialized writes to `main` (for example a merge queue), which is an owner decision.

## Hotfixes

1. Branch from `main`, make the smallest fix, and open a PR **to `main`** (the only exception to "features target development").
   CI and Copilot must pass as usual.
2. Merge it, then **immediately open the same change as a PR to `development`** (a cherry-pick or a branch from `main`). Merge it.
3. The release gate blocks any release until development contains everything on main. Once step 2 is done, the next release
   proceeds normally.

Never leave a hotfix only on `main` for longer than it takes to merge it to `development`: the next release would otherwise be
blocked, and a manual merge that ignores the gate would undo the hotfix.

## Post-release health

After the merge, the workflow polls `PRODUCTION_URL/healthz` and `/readyz` every 30 seconds for up to 10 attempts. Each request
has a 10-second deadline, body included, so a stalled probe counts as a failed attempt. It passes after
three readings in a row where `/healthz` returns 200 and `/readyz` returns 200 with a body starting `ready` (`/readyz` checks the
database with `SELECT 1`). This confirms the site answers and the database is reachable. It does **not** prove the new commit is the
one serving: `/healthz` has no version field. Adding the build commit to `/healthz` is the next improvement.

## Testing

`npm test` runs `tests/daily-release.test.js` (28 cases): no changes, eligible, failed CI, incomplete Copilot review, unresolved
conversations, conflict, freeze, duplicate PRs, missing rules, the 02:xx slot across summer and winter time, health streaks, the
full flow with the merge pinned to the verified head, a head or branch that moves before the merge (checked against the start-of-run snapshot), the head-filtered PR lookup, the merge
method switch, a duplicate run after a release, the second scheduled run on the same Berlin day, a missing `PRODUCTION_URL`
(blocked before the merge), a content mismatch after the merge (no tag), and check runs beyond the first page.
