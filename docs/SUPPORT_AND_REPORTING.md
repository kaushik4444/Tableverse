# Support, bug reports, deletion requests and safety reports

Status: **draft for the limited beta. Not published in the app.** The support address below is a placeholder until the owner provides it. Nothing in this page is a legal commitment until the owner approves the final wording.

## Routes to the owner

For the Wave 1 and 2 beta there is **one** support address, used for manual bug reports, account deletion requests and safety reports:

**[SUPPORT EMAIL: to be provided by the owner]**

The in-app routes also reach the owner, and they stay in place:

| Route | Who can use it | What it does | Limits |
|---|---|---|---|
| **Feedback form** (in the app, `POST /api/feedback`) | anyone, signed in or not | Sends a bug report, an idea or other feedback. Stored with the account link if signed in. | 1,000 characters; per address 6 an hour (`RL_FEEDBACK_IP_LIMIT`); per signed-in player 10 a day (`RL_FEEDBACK_PLAYER_LIMIT`). |
| **Chat report** (report button on a chat message) | signed-in players at a table | Records the reported message, the reason and an optional note. | One report per person per message. Nothing is hidden or sanctioned automatically. |
| **Player report** (Report player, on a table card or a profile page) | signed-in players | Records the reported player and the reason. No message text. | One report per reporter and player. Shares the daily limit with chat reports. Nothing is hidden or sanctioned automatically. |
| **Block** (block button on a chat message) | signed-in players | Hides a player's table chat, and stops you inviting each other. Details in `docs/CHAT_MODERATION.md`. | Chat is one-way and voice is two-way (see the terms). |
| **Account deletion** (Profile > Delete account) | signed-in players | Deletes the account after the password is confirmed. | Final. See `docs/ACCOUNT_DELETION_AND_RETENTION.md`. |

**Where the owner reads each route:**
- Feedback: the admin console's **Feedback** tab (`feedback` rows only).
- Chat and player reports: **not** shown in the Feedback tab. The admin console's **Reports** tab lists both kinds (read-only, newest first) and the Overview counts them. The owner reviews every report at least once a day while the beta is running. Resolving a report is still a manual step; the console does not change or hide anything.

## Manual process (beta)

1. **Bug reports and feedback:** read in the Feedback tab; mark each item new, read or resolved.
2. **Chat reports (safety):** the owner reviews every report, not only the newest. Each day, read the reports created after the checkpoint (the `created_at` and `id` of the last report reviewed, kept in the owner's private notes), oldest first, in pages of 50 with `ORDER BY created_at, id` and a keyset condition on that checkpoint. Decide each one, record the decision, and move the checkpoint to the last report reviewed. The query in `docs/CHAT_MODERATION.md` returns only the newest 50 and must not be used as the review. Suspensions go through the console (reason required).
3. **Account deletion requests that cannot be done in the app** (for example, the account holder has lost the password): the owner replies from the support address, confirms the request came from the registered address, and then deletes the account only after taking a database backup and with the approval recorded in the runbook ("Decisions that always need explicit owner approval"). The owner account is never deleted this way.
4. **Security or privacy reports:** handled in the same inbox, as a priority. Suspected compromise of an account: the owner follows "Suspected account compromise" in the runbook.

## How to report a bug (for beta users)

Use the feedback form in the app, with the category "bug". Please include:

- what you were doing, step by step;
- what you expected and what happened;
- the screen (lobby, table, profile, settings);
- the browser and device, and whether you were on Wi-Fi or mobile data;
- the time, with your time zone;
- any message the app showed, copied exactly.

Do **not** include your password, your e-mail address, a verification or reset link, or screenshots that show them.

## How to report a security or privacy problem

Report it privately, to the support address above. Do not post it in chat, in a public issue or in a feedback message, and do not test it on other people's accounts.

- **Suspected compromise of your account:** change your password, then use **Log out everywhere** in the account menu (or **Sessions** in Settings) to sign out of every device. Then write to the support address.
- **Someone's personal information visible in the app:** report the message with the chat report button, and write to the support address.
- **A possible vulnerability:** write to the support address with what you found and how to reproduce it, without accessing data that is not yours.

## Response expectations (proposed, owner to confirm)

Nothing in the code sets a response time, and one person runs the beta. The proposed wording, which the owner must approve before any tester sees it:

> We read reports ourselves, on a best-effort basis. We aim to reply within 3 working days. Safety and account-security reports are read as soon as we see them, but we cannot promise a reply time or a fix date during the beta.

**Owner decisions before publishing this page:** approve the wording above; the support address; whether the 3-working-day target is kept.
