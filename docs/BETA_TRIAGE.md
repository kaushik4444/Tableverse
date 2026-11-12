# Beta issue tracking and bug priority

Status: **draft for the Wave 1 friends-and-family beta.** Free tools only: GitHub Issues, labels and saved searches. One person (the owner) runs the beta, so the process is small on purpose. The response targets below are **proposed; the owner confirms them.**

## The flow

```
report  ->  needs-triage  ->  priority label  ->  fix (PR "Fixes #N")  ->  check on the live site  ->  close
```

1. **Intake.** Testers report in one of three ways (see `docs/BETA_ONBOARDING.md`):
   - **GitHub forms** (bug report or feedback). These arrive with the labels `beta` and `needs-triage`.
   - **In-app Send feedback.** The owner reads these in the admin console's Feedback tab and, for anything that needs work, opens a GitHub issue with the same form, in their own words. **Do not paste an email address or a link from a message into a public issue.**
   - **Private safety or security report** to the support address. These never become public issues. Handle them first (see "Safety and security" below).
2. **Triage** (daily, about 10 minutes): open the `needs-triage` list, give each issue one priority label (P0 to P3), add a topic label if it fits, and remove `needs-triage`. If you cannot tell what happened, add `needs-info`, ask one clear question, and come back in two days.
3. **Fix.** Fix P0 and P1 first. Name the pull request "Fixes #N" so the issue closes on merge.
4. **Verify.** After the deploy, repeat the reporter's steps on the live site, then close the issue with one line saying what was checked. Ask the reporter to confirm if it was a P0 or P1.
5. **Weekly review** (about 15 minutes): see "Weekly check".

## Labels

| Label | Meaning |
|---|---|
| `beta` | Reported during the beta (set by the forms) |
| `needs-triage` | Not yet read and prioritised (set by the forms) |
| `needs-info` | Waiting for details from the reporter |
| `bug`, `feedback` | Something broken, or an opinion or idea |
| `P0-critical`, `P1-high`, `P2-medium`, `P3-low` | Priority (exactly one per open issue) |
| `usability`, `mobile`, `fairness`, `performance`, `reliability` | Topic, matching the feedback form |

## Priority: how to recognise a critical bug

Ask these in order. The first "yes" decides the priority.

| Priority | It is this if... | Examples | Target (proposed) |
|---|---|---|---|
| **P0 critical** | Any of: a player's **private information is exposed** (hidden cards, tiles or another person's details); **account or security** problem; **data or results are lost or wrong** for real players; **nobody can sign up, log in or play**; a game gives an **unfair or impossible result** (wrong winner, a rule broken in someone's favour, a turn skipped); the site is **down**. | One player can see another's hand. Verified players cannot log in. Two tokens win on the same roll. A finished game is not saved. | Look the same day. Stop inviting new testers until it is fixed or ruled out. |
| **P1 high** | A main flow is broken for **many** players and there is **no workaround**: creating or joining a table, finishing a game, mobile layout so broken that buttons cannot be tapped, frequent disconnects that end games. | Join by code fails on iPhones. A game freezes when a bot plays. | Fix within about a week. |
| **P2 medium** | Something is wrong, but there is a **workaround** or only **some** players or screens are affected. | A button hides under the keyboard on a small phone. Reload fixes a stuck lobby. | Fix when planned. |
| **P3 low** | Cosmetic, wording, small polish, or an idea. | A label is clipped. A colour is hard to read. | Collect. Do when convenient. |

Notes for the call:
- **When unsure between two levels, pick the higher one** and lower it after you have reproduced the problem.
- **Count the reporters.** Two unrelated testers describing the same problem raises its priority by one level.
- **Fairness reports need evidence.** Streaks of bad luck are normal in dice and card games. Ask for the game, the table code and the time, and check the game records and logs. Treat it as P0 only if the rules were broken or the result cannot be explained by chance.
- **The reporter's own severity** (in the bug form) only helps to sort. The owner decides.
- **The ticked boxes in the bug form** (unfair result, saw something private, could not get in, lost a result) are the quickest signs of a P0. Read those issues first.

## When a P0 is open

1. **Pause new invitations.** Do not add testers.
2. **Reproduce and contain.** Use the runbook (`docs/OPERATIONS_RUNBOOK.md`). If a recent release caused it, **roll back** in the Render dashboard (Events or Deploys, pick the last good deploy, Rollback), or revert the merge commit through a pull request.
3. **Tell the testers directly** (the message group you already use) in one short line: what is wrong, whether to keep playing, and when you will update them. Do not use an in-app broadcast to unverified accounts.
4. **Fix, verify on the live site, close,** then resume invitations.
5. **Write two lines** in the issue: what happened, what changed. This is your record for the weekly check.

## Safety and security

Reports about account compromise, someone's private information, abuse in chat or a possible vulnerability arrive by **private** email or as a **chat report**, not as a public issue (`docs/SUPPORT_AND_REPORTING.md`). They are read first. They are P0 until you have decided otherwise. If a tester posts personal details in a public issue by mistake, **edit the text out of the issue and its edit history** (the "..." menu on the issue, then "Edit", then delete the earlier versions from "edited") and tell them. Never copy such details into another place.

Chat reports have their own daily review in `docs/CHAT_MODERATION.md`. They are not a replacement for this list.

## Saved searches

Bookmark these (they work in the browser):

- Critical, open: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+is%3Aopen+label%3Abeta+label%3AP0-critical>
- Waiting to be read: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-triage>
- High, open: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+is%3Aopen+label%3Abeta+label%3AP1-high>
- Waiting for the reporter: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+is%3Aopen+label%3Aneeds-info>
- Fairness reports: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+label%3Abeta+label%3Afairness>
- All beta feedback: <https://github.com/kaushik4444/tableverse/issues?q=is%3Aissue+label%3Abeta+label%3Afeedback>

## Weekly check

Once a week, look at the list for 15 minutes and write down:

- open P0 and P1 issues, and how old the oldest is;
- the issues closed this week;
- the feedback scores (the five topics) and the most repeated complaint;
- anything several testers hit.

**Suggested rule for letting in more testers (owner to confirm):** no open P0, and no P1 older than seven days.

## Before the beta starts

- [ ] The labels above exist (created on 12 November 2026).
- [ ] The beta guide has the real beta link and support address filled in (placeholders today).
- [ ] The owner confirmed the response targets and the rule for letting in more testers.
- [ ] The owner has read the Feedback tab, the saved searches and the P0 steps once.
- [ ] The policy documents are approved. Wave 1 stays NO-GO until then (`docs/WAVE_1_LAUNCH_READINESS.md`).
