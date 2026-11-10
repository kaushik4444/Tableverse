# Support, bug reports and security or privacy reports

Status: **describes what exists today.** No support e-mail address or security contact has been set up by the repository, and none is invented here. The owner must provide the contact details before the limited beta; the placeholders below must be filled in and this page reviewed.

## What exists in the product today

| Route | Who can use it | What it does | Limits |
|---|---|---|---|
| **Feedback form** (in the app, `POST /api/feedback`) | anyone, signed in or not | Sends a bug report, an idea or other feedback. Stored with the account link if signed in. | 1,000 characters; per address 6 an hour (`RL_FEEDBACK_IP_LIMIT`); per signed-in player 10 a day (`RL_FEEDBACK_PLAYER_LIMIT`). The form asks people not to include passwords or personal details. |
| **Chat report** (report button on a chat message) | signed-in players at a table | Records the reported message, the reason and an optional note for the moderation record. | One report per person per message. Nothing is hidden or sanctioned automatically. There is no review queue in the product yet. |
| **Block** (block button on a chat message) | players | Hides a player's table chat and voice from you, and stops you inviting each other. | Details in `docs/CHAT_MODERATION.md`. |

For this beta the owner is the only person who reads feedback and reports. The owner reads them in the admin console's **Feedback** tab and moves each item between new, read and resolved. The overview counts new feedback and reports.

**There is no support e-mail address, no help page and no public contact in the app today.** Within the product, the feedback form and the chat report are the only routes to the owner.

## How to report a bug (for beta users)

Use the feedback form in the app with the category "bug". Please include:

- what you were doing, step by step;
- what you expected and what happened;
- the page or screen (lobby, table, profile, settings);
- the browser and device, and whether you were on Wi-Fi or mobile data (this matters for voice);
- the time (with your time zone), so the owner can find it in the logs;
- any message the app showed, copied exactly.

Do **not** include your password, your e-mail address, a verification or reset link, or screenshots that show them. If a bug involves voice, say whether the other person could hear you and whether you could hear them.

## How to report a security or privacy problem

Report it privately. Do not post it in chat, in a public issue or in a public feedback message, and do not test it on other people's accounts.

- Suspected compromise of your account: change your password, then use **Sessions** in settings to sign out of every device. Then tell the owner through [OWNER: private contact address — not yet provided].
- Someone else's personal information visible in the app: report the message with the chat report button, and tell the owner through [OWNER: private contact address].
- A possible vulnerability in the service: tell the owner through [OWNER: private contact address]. Say what you found and how to reproduce it, without accessing data that is not yours.

## What response to expect

Nothing in the code sets a response time, and the beta is run by one person. Until the owner decides otherwise, the only honest promise is:

- Bug and feedback reports are read by the owner, not automatically; there is no guaranteed reply time.
- Security and privacy reports are handled as soon as the owner sees them. [OWNER: state a realistic target, for example "acknowledged within N working days".]
- Urgent problems that affect everyone are shown in the in-app announcement banner when one is published.

## Owner actions before the beta

1. Set up a private contact address for support, security and privacy. Put it in this page, in `docs/PRIVACY_NOTICE_DRAFT.md` and in `docs/BETA_TERMS_DRAFT.md`.
2. Decide the response targets above.
3. Decide who reads the feedback and report queue, and how often.
4. Decide whether the feedback form should carry a short line saying that reports are read by a person, not by an automated system.
