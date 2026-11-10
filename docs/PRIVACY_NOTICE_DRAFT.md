# Tableverse privacy notice — BETA DRAFT

**Status: DRAFT for the limited beta. Not approved for publication. Requires legal review before any public launch (see the list at the end).**

This draft is written from what the Tableverse code does today (`main`, 2026-11-10). Where a fact is not verified, the text says so, or leaves a placeholder in square brackets for the owner to complete. Details of retention and deletion are in `docs/ACCOUNT_DELETION_AND_RETENTION.md`.

## Who we are

Tableverse is a free, beta multiplayer card and board game service, run by [OWNER: name of the person or company responsible]. Contact for privacy questions: [OWNER: privacy contact address — not yet provided; see docs/SUPPORT_AND_REPORTING.md].

## What we collect

**If you create an account:**
- Your e-mail address, used to sign in and to send verification and password-reset messages.
- A password. It is stored only as a one-way hash.
- A username, a display name and an avatar. The username and display name are visible to other players.
- The date you joined and the last time you were seen online.
- Your match results: the games you finished, your seat, your score and your position. You can see your full history. Your public profile shows only your username, display name, avatar, join date and games played, wins and win rate.
- Your friends, friend requests, blocks, and tables you have recently visited.
- Chat messages you send at a table. Chat is kept in memory while a table is open and is not stored as a history, except when a message is reported (see below).

**Guests:** you cannot play without signing in. Browsing the public home screen and table list does not create an account or a record. [OWNER: confirm there are no guest records in the database; see docs/ACCOUNT_DELETION_AND_RETENTION.md.]

**Technical and security data (all users):**
- Your network address is recorded for rate limiting, for a short time (deleted after one day).
- A login session cookie. A "keep me signed in" device cookie, only if you choose it.
- Counts of usage (for example, how many players were active on a day). These counts are kept without names, addresses or messages. Active players are counted from a keyed hash, not from your account ID.
- Error and operational logs held by the hosting provider.

**Reports and feedback you send:**
- A chat report includes the reported message (up to 200 characters), the reason and, optionally, a short note. Reports are kept until a decision is made, with no automatic deletion yet (see below).
- Feedback you send through the in-app form is kept with your account link. The form asks you not to include personal details.

**Voice chat:** Voice is set up directly between players. When a direct connection is not possible, the audio is relayed through Metered's TURN servers. Tableverse does not record or store voice audio.

## Why we use it

To run the service you asked for: signing you in, keeping your games and results, letting you play with friends, keeping chat and voice working, keeping the service secure, and handling reports. [OWNER / LEGAL: confirm the legal basis for each purpose, for example for EU and UK users.]

## Who receives your data (service providers)

- **Render**: hosts the application and its logs.
- **Neon**: hosts the PostgreSQL database that holds account and game data.
- **GitHub**: holds the source code and runs a scheduled cleanup workflow with database access (see `docs/ACCOUNT_DELETION_AND_RETENTION.md`).
- **Resend**: delivers verification and password-reset e-mail, and owner-approved announcement e-mail.
- **Metered**: relays voice traffic when a direct connection cannot be made.
- **Google and Cloudflare**: STUN servers used during voice setup. They receive your network address.

[LEGAL: confirm the processor agreements and data locations with each provider before publication.]

We do not sell your data. The game page loads no third-party advertising or analytics scripts (checked in `public/`). If you choose to share a table link through the share button, the text is opened in WhatsApp and is sent only where you send it.

## Promotional e-mail

We may send occasional promotional e-mail, such as news or offers. It is sent only to verified accounts that have not opted out. E-mail the owner sends in the "account" category (service notices, not promotion) is not promotional: it can reach every registered account, including accounts whose address is not yet verified. [LEGAL: confirm whether non-promotional mail may reach unverified accounts.] Every promotional message has an unsubscribe link, and you can opt out at any time with that link. Account messages (verification, password reset, important notices about your account) are not affected by this choice. [OWNER: confirm whether an in-app opt-out will be offered; at present the opt-out is only the e-mail link.]

## How long we keep data

The retention periods that apply now are listed in `docs/ACCOUNT_DELETION_AND_RETENTION.md`. In summary:
- Login sessions last 30 days from sign-in by default.
- Verification links are valid for 24 hours; password-reset links for 30 minutes.
- Network-address rate-limit records are deleted after one day.
- Feedback is kept for 180 days; admin audit records for 365 days.
- Finished match results are kept for as long as the game history is kept (no fixed period yet).
- Chat reports and broadcast history have **no fixed period yet**. [OWNER: decide and state these.]

## Your choices and rights

- **Delete your account**: in the app, open your profile and choose Delete account. You will be asked for your password. Deletion removes your account, sign-in details, sessions, friends, blocks and recent tables. Your past match results remain, but are shown under the name "Deleted player". Chat messages you sent while a table was open are not removed by deletion; they stay in that table's memory until the table closes or the server restarts.
- **Access or a copy of your data**: there is no self-service export yet. [OWNER / LEGAL: state how requests are handled and the response time.]
- **Correct your profile**: change your display name and avatar in the app. Your username cannot be changed in the app. [OWNER: confirm.]
- **Opt out of promotional e-mail**: use the unsubscribe link in any promotional message.

## Children

Tableverse is not designed for children. [LEGAL: state the minimum age and what happens if a child creates an account.]

## Security

Passwords are stored as one-way hashes. Sign-in sessions are stored as hashes and expire. The database connection uses verified TLS in production. [OWNER: state who has access to production data and how that access is controlled; this is not documented in the code.] No system is perfectly secure; if we learn of a breach affecting your data, we will tell you as required by law. [LEGAL: confirm the notification commitments.]

## Changes to this notice

We will update this notice when our practices change and state the date of the change at the top of the page.

Last updated: [OWNER: date].

---

## Legal review required before publication (not verified in code)

1. Lawful basis for each purpose, and the controller/processor roles with each provider.
2. Processor agreements and data-transfer terms (Render, Neon, Resend, Metered, Google, Cloudflare).
3. Retention decisions for chat reports and broadcast history (no automatic deletion yet), and for any legacy guest records.
4. Whether a self-service data export, and a response time for access requests, must be offered.
5. Minimum age and handling of children's accounts.
6. Breach-notification commitments and the regulator to contact.
7. Cookies: the session and device cookies are strictly necessary; confirm no other cookie is set.
8. Whether any in-app opt-out for promotional e-mail is needed, beyond the e-mail link.
9. The provider list must match the live configuration at launch.
