# Tableverse privacy notice — BETA DRAFT

**Status: DRAFT for the limited beta. Not approved for publication, and not shown in the app. Requires the owner's written approval of each open question listed at the end before publication (no lawyer review is planned; see the list at the end). The beta decisions it reflects are in `docs/STAGE_20_6_BETA_READINESS.md`.**

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

**Guests:** the beta is for signed-in players only. Browsing the public home screen and table list does not create an account or a record. [OWNER: confirm there are no guest records in the database; see docs/ACCOUNT_DELETION_AND_RETENTION.md.]

**Technical and security data (all users):**
- Your network address is recorded for rate limiting, for a short time (deleted after one day).
- A login session cookie. A "keep me signed in" device cookie, only if you choose it.
- Counts of usage (for example, how many players were active on a day). These counts are kept without names, addresses or messages. Active players are counted from a keyed hash, not from your account ID.
- Error and operational logs held by the hosting provider.

**Reports and feedback you send:**
- A chat report includes the reported message (up to 200 characters), the reason and, optionally, a short note. Reports are kept until a decision is made, with no automatic deletion yet (see below).
- Feedback you send through the in-app form is kept with your account link. The form asks you not to include personal details.

**Voice chat:** voice is not available during the beta. [OWNER: this paragraph applies only if voice is switched on later.] When voice is available, it is set up directly between players. When a direct connection is not possible, the audio is relayed through Metered's TURN servers. Tableverse does not record or store voice audio.

## Why we use it

To run the service you asked for: signing you in, keeping your games and results, letting you play with friends, keeping table chat working (voice is withheld in the beta), keeping the service secure, and handling reports. [OWNER / LEGAL: confirm the legal basis for each purpose, for example for EU and UK users.]

## Who receives your data (service providers)

- **Render**: hosts the application and its logs.
- **Neon**: hosts the PostgreSQL database that holds account and game data.
- **GitHub**: holds the source code and runs a scheduled cleanup workflow with database access (see `docs/ACCOUNT_DELETION_AND_RETENTION.md`).
- **Resend**: delivers verification and password-reset e-mail, and owner-approved announcement e-mail.
- **Metered**: relays voice traffic when a direct connection cannot be made.
- **Google and Cloudflare**: STUN servers used during voice setup. They receive your network address.

[OWNER: confirm the processor terms and data locations of each provider before publication; see question 7 at the end.]

We do not sell your data. The game page loads no third-party advertising or analytics scripts (checked in `public/`). If you choose to share a table link through the share button, the text is opened in WhatsApp and is sent only where you send it.

## Promotional e-mail

We do not send promotional e-mail during the beta. [OWNER: confirm.] Account e-mail (the verification and password-reset messages) is sent to the address you gave, whether or not it is verified, because it is needed to create and recover the account. The owner's broadcast e-mail is not used in the beta (Wave 1 sends none). If broadcasts are used later, they will go only to verified accounts, once the change proposed in the readiness document is approved and built. Any such message will have an unsubscribe link.

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
- **Access or a copy of your data**: there is no self-service export yet. [OWNER: state how requests are handled and the response time.]
- **Correct your profile**: change your display name and avatar in the app. Your username cannot be changed in the app. [OWNER: confirm.]
- **Opt out of promotional e-mail**: use the unsubscribe link in any promotional message.

## Children

Tableverse is for adults aged 18 and over during the beta. Once approved and built, registration will ask you to confirm that you are 18 or over. We do not collect a date of birth, so this is a self-declaration and not a check of your age. [LEGAL: confirm whether this approach is adequate for each country where users are, and what applies to children who register anyway.]

## Security

Passwords are stored as one-way hashes. Sign-in sessions are stored as hashes and expire. The database connection uses verified TLS in production. [OWNER: state who has access to production data and how that access is controlled; this is not documented in the code.] No system is perfectly secure; if we learn of a breach affecting your data, we will tell you as required by law. [LEGAL: confirm the notification commitments.]

## Changes to this notice

We will update this notice when our practices change and state the date of the change at the top of the page.

Last updated: [OWNER: date].

---

## Open legal questions (owner approval required; no lawyer review planned)

This draft was prepared from the official texts: the GDPR (Regulation (EU) 2016/679, https://eur-lex.europa.eu/eli/reg/2016/679/oj), the German TDDDG (https://www.gesetze-im-internet.de/ttdsg/) and the German DDG (https://www.gesetze-im-internet.de/ddg/), checked 2026-11-10. It is not legal advice and does not claim compliance or any exemption. Each question below needs the owner's written approval before the wording is published. Nothing here is decided.

1. **Controller and contact details (GDPR Art. 4(7), Art. 13(1)(a)–(b)).** Who is the controller, and which name, postal address and contact to publish. [OWNER: approve. Nothing is invented; the address is not published.]
2. **Provider identification (DDG § 5).** § 5 applies to digital services offered "geschäftsmäßig, in der Regel gegen Entgelt". Tableverse is free in the beta, so it is unclear whether § 5 applies. [OWNER: decide whether to publish the § 5 information anyway, using placeholders until the details are provided.]
3. **Legal basis per purpose (GDPR Art. 6(1)).** Proposed: account, sessions and games under Art. 6(1)(b); security, rate limiting and logs under Art. 6(1)(f); any optional device sign-in under Art. 6(1)(a). [OWNER: approve each basis.]
4. **Storage on the device (TDDDG § 25).** The session and device cookies, and the browser storage used for announcement dismissals, are proposed as "strictly necessary" under § 25(2) Nr. 2 and so need no consent banner. The device cookie exists only when the user ticks "keep me signed in". [OWNER: approve this classification. If it is not accepted, a consent step is needed before those cookies are set.]
5. **Data subject rights (GDPR Art. 12–21).** Access, rectification, erasure, restriction, portability and objection. Art. 12(3) gives one month to answer, extendable in some cases. There is no self-service data export. [OWNER: decide how requests are received and answered, and whether a copy of the data is offered by hand.]
6. **Complaints (GDPR Art. 77).** Users must be told they may complain to a supervisory authority. The competent authority depends on the owner's Land. [OWNER: name the authority once the Land is confirmed.]
7. **Processors and transfers (GDPR Art. 28, Art. 44–49).** Render, Neon, Resend, Metered, Google and Cloudflare (STUN) are processors or recipients. Their contract terms, data locations and any transfer outside the EU/EEA have not been checked. [OWNER: check each provider's data processing terms and data location before publication.]
8. **Age (GDPR Art. 8).** Art. 8 covers consent for information society services offered directly to children. The beta is 18+ with a self-declaration and no date of birth. [OWNER: approve relying on the self-declaration, and accept that it is not an age check.]
9. **Retention (GDPR Art. 5(1)(e)).** Chat reports, broadcast history and any legacy guest records have no automatic deletion yet. [OWNER: set periods or accept indefinite retention for the beta.]
10. **Live chat after deletion (GDPR Art. 17).** Table chat stays in server memory after the author deletes the account, with the author shown as "Deleted player". [OWNER: accept and disclose, or change the code.]
11. **Breach notification (GDPR Art. 33–34).** Notice to the supervisory authority within 72 hours of awareness where required, and to users where the risk is high. [OWNER: approve the procedure in the runbook.]
12. **Voice relay (Metered).** Voice audio passes through Metered when a direct connection fails. In the beta, voice is withheld. [OWNER: confirm voice stays withheld until Metered is verified and the processor terms are checked.]
13. **Pre-sign-up display.** The approved text must be shown before registration (planned change C-B). [OWNER: approve the change.]
14. **Provider list.** The list must match the live configuration at launch, including the GitHub cleanup workflow. [OWNER: confirm at launch.]
