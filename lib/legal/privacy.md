# Tableverse privacy notice

## Who we are

Tableverse is a free, beta multiplayer card and board game service, run by {{IMPRESSUM_NAME}}, {{IMPRESSUM_ADDRESS}}. Contact for privacy questions: {{IMPRESSUM_EMAIL}}.

## What we collect

**If you create an account with an e-mail address and password:**
- Your e-mail address, used to sign in and to send verification and password-reset messages.
- A password. It is stored only as a one-way hash.
- A username, a display name and an avatar. The username and display name are visible to other players.
- The date you joined and the last time you were seen online.
- Your confirmation that you are 18 or over, and when you gave it.

**If you sign in with Google:**
- Your Google account identifier and the e-mail address Google reports as verified. We store these to recognise your account.
- Your display name. If you do not choose one, we use the name from your Google account; you can change it in the app.
- We do not store your Google password, the sign-in token Google gives us, or your Google profile picture.
- Your username and avatar are chosen in Tableverse, as for any account.
- Your confirmation that you are 18 or over, and when you gave it.

**For all signed-in accounts:**
- Your match results: the games you finished, your seat, your score and your position. You can see your full history. Your public profile shows only your username, display name, avatar, join date and win totals.
- Your friends, friend requests, blocks, and tables you have recently visited.
- Chat messages you send at a table. Chat is kept in memory while a table is open and is not stored as a history, except when a message is reported (see below).

**Guests:** guest accounts cannot be created in the current version. Browsing the public pages does not create a record.

**Technical and security data:**
- Your network address, used for rate limiting. [OWNER: retention period for rate-limit records and hosting logs.]
- A login session cookie. A "keep me signed in" device cookie, only if you choose it.
- Aggregate usage statistics, such as how many players were active on a day. [OWNER: confirm that these counts contain no names, addresses or messages.]

**Reports and feedback you send:**
- A chat report includes the reported message (up to 200 characters), the reason and, optionally, a short note. Reports you file are removed when your account is deleted. Reports made against your account are kept, with the link to your account cleared. [OWNER: retention period for reports.]
- Feedback you send through the in-app form is kept with your account link. The form asks you not to include personal details.

**Voice chat** is switched off in the beta. While it is off, no voice connection details are handed out and voice messages are refused. When voice is switched on, audio is set up directly between players where possible, and relayed through Metered's TURN servers when a direct connection is not possible. Tableverse does not record or store voice audio.

## Why we use it

To run the service you asked for: signing you in, keeping your games and results, letting you play with friends, keeping table chat working, keeping the service secure, and handling reports. [LEGAL: legal basis for each purpose, for example for EU and UK users.]

## Who receives your data (service providers)

- **Render**: hosts the application and its logs.
- **Neon**: hosts the PostgreSQL database that holds account and game data.
- **GitHub**: holds the source code and runs maintenance workflows, including a cleanup job with database access (see `docs/ACCOUNT_DELETION_AND_RETENTION.md`).
- **Resend**: delivers verification and password-reset e-mail.
- **Google**: if you sign in with Google, or confirm an account deletion with Google, Google receives the request needed for that step and returns your Google account details to us. Google's own privacy policy applies to Google's handling of your data.
- **Metered**: relays voice traffic when a direct connection cannot be made. Used only when voice is switched on.
- **Google and Cloudflare**: STUN servers used during voice setup. They receive your network address. Used only when voice is switched on.

[OWNER: hosting and database regions, and confirmation of processor terms with each provider above.]

We do not sell your data. The game pages do not load advertising or analytics scripts. The page loads Google's sign-in script only when you sign in with Google or confirm an account deletion with Google. If you choose to share a table link through the share button, the text is opened in WhatsApp and is sent only where you send it.

## Promotional e-mail

We do not send promotional e-mail during the beta. The e-mails we send are account e-mails: the verification e-mail, sent to the address you give when you register (and when you ask for it again), and the password-reset e-mail, sent only to a verified address. These are not marketing and carry no unsubscribe link. Owner announcement e-mails are not sent during the beta.

## How long we keep data

- Login sessions last 30 days from sign-in by default.
- Verification links are valid for 24 hours; password-reset links for 30 minutes.
- Feedback is kept for 180 days; admin audit records for 365 days.
- Accounts that never verify their e-mail address may be removed by a cleanup job. The job runs only when the owner starts it.
- Finished match results are kept for as long as the game history is kept. [OWNER: fixed period for match history.]
- Chat reports and owner broadcast history have no fixed period yet. [OWNER: fixed period for both.]

## Your choices and rights

- **Delete your account**: in the app, open your profile and choose Delete account. If you have a password, you confirm with your password. If you only use Google sign-in, you confirm by signing in with Google again. Deletion removes your account, sign-in details, sessions, devices, friends, blocks and recent tables. Your past match results remain, but are shown under the name "Deleted player". Your name is also removed from open-table chat, in memory, when you delete your account. Tables are held in memory, so this does not reach any copy that has already left the server.
- **Access or a copy of your data**: there is no self-service export yet. [OWNER: how requests are handled, and the response time.]
- **Correct your profile**: change your display name and avatar in the app. Usernames cannot be changed in the app.
- **Opt out of promotional e-mail**: none is sent during the beta.

## Children

Tableverse is for adults aged 18 and over during the beta. Registration, and Google sign-up, ask you to confirm that you are 18 or over. We do not collect a date of birth, so this is a self-declaration and not a check of your age.

## Security

Passwords are stored as one-way hashes. Sign-in sessions are stored as hashes and expire. The database connection uses verified TLS in production. [OWNER: who has access to production data, and how that access is controlled.] No system is perfectly secure; if we learn of a breach affecting your data, we will tell you as required by law.

## Changes to this notice

We will update this notice when our practices change and state the date of the change at the top of the page.

Last updated: [OWNER: date].
