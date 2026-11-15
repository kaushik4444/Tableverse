# Sign in with Google

Status: server side implemented on a branch; the sign-in button is a separate change. Off unless `GOOGLE_CLIENT_ID` is set. Not configured or verified in production.

## Cost
Free. Sign in with Google (Google Identity Services) has no usage charge and needs no billing account. It needs a Google Cloud project with an OAuth consent screen and one **Web** OAuth client ID. Only the basic `openid`, `email` and `profile` information is used, which does not require Google's app verification. There is no client secret in this flow, so there is nothing secret to store: `GOOGLE_CLIENT_ID` is public.

## One-time setup (the owner, in Google Cloud Console)
1. Create a project (or use an existing one) at console.cloud.google.com.
2. APIs & Services > OAuth consent screen: User type External. App name Tableverse, support email, the privacy policy and terms links, and the authorised domain. Publish it (status "In production") so people who are not listed as test users can sign in.
3. Credentials > Create credentials > OAuth client ID > Web application. Under **Authorised JavaScript origins** add the production origin (https://playtableverse.com) and any other origin that should offer it, such as the Render URL. No redirect URIs are needed.
4. Copy the client ID into the Render dashboard as `GOOGLE_CLIENT_ID` and redeploy. Leave it unset on development environments that should not offer it, or create a separate client ID with `http://localhost:3000` as an origin for local tests.

## How it works
1. The page asks `GET /api/auth/google/config` for the client ID and a **nonce**: a hash of the browser's CSRF cookie value. Google puts the nonce into the ID token.
2. The page sends the ID token to `POST /api/auth/google`. The server checks, with no extra dependency: the RS256 signature against Google's published keys (cached, refetched at most once a minute when the key id is unknown), the issuer, that the audience is our client ID, expiry, the nonce, and that Google reports the email as **verified**. A token minted for a different browser, a different app, or an unverified address is refused.
3. A known Google identity signs in (the earlier session ends, like after a password login). A suspended account is refused.
4. A new person gets `needsSignup`. The page asks for a username and the 18+ confirmation, then calls `POST /api/auth/google/complete` with the same token. The token is verified again, the account is created with the address already verified, and a session starts. No verification email is sent.
5. A Google address that already belongs to an email-and-password account is **refused with a clear message**, never linked automatically. Linking by address would let anyone who controls that mailbox at Google take over the account. Signing in the way the person registered keeps working. Linking from account settings can be added later.

## Limits and known gaps
- Google-only accounts have no password. Login, password reset and verification emails look only at the email identity, so they do nothing for these accounts. **Deleting such an account is not possible yet** (the deletion flow asks for the password): that needs a re-authentication with Google and is the next change.
- Sign-in does not offer "remember this device" yet.
- The ID token is bound to the browser by the nonce and expires after about an hour; it is not stored.
- Privacy: Google learns that the person signs in to Tableverse. `docs/PRIVACY_NOTICE_DRAFT.md` still needs the owner's review for this processor.
- Rate limits: `RL_GOOGLE_IP_LIMIT` and `RL_GOOGLE_SIGNUP_IP_LIMIT`.

## Tests
`tests/google-auth.test.js` (token checks with a local key pair, no network) and `tests/google-signin.pg.test.js` (the full flow on PostgreSQL, including the refused-link, suspension and race cases; runs in the PostgreSQL CI step).
