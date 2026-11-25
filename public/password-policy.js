/* The password rule for new passwords (sign-up and reset). One file for the browser and the server so they cannot drift.
   A password needs: 8 to 200 characters (code points, so an emoji counts once). There is no required mix of upper and
   lower case, digits or symbols: a long passphrase or a simple word with a number works. It may not be an obvious word such
   as "password", and it may not contain the username or the first part of the e-mail address.
   Exceptions, on purpose: the username is only matched when it has at least 3 characters and the e-mail part only when it
   has at least 4, so a short name does not refuse ordinary passwords. Existing passwords still work to sign in: the rule
   applies only when a password is chosen.
   Input fields must allow up to 2 UTF-16 units per character (maxlength="400"), since the browser counts UTF-16 units. */
(function (root) {
  const MIN = 8;
  const MAX = 200;
  const OBVIOUS = ['password', 'passw0rd', 'qwerty', 'letmein', 'iloveyou', 'welcome', 'tableverse', '123456', 'abc123', 'admin123'];

  /** What the password still needs, as a list of short phrases (empty when the length is enough). */
  function missing(pw) {
    const s = typeof pw === 'string' ? pw : '';
    const out = [];
    if ([...s].length < MIN) out.push(`at least ${MIN} characters`);
    return out;
  }

  /** null when the password is acceptable, otherwise a message that says what to change. */
  function check(pw, { email = '', username = '' } = {}) {
    if (typeof pw !== 'string') return 'Enter a password.';
    if ([...pw].length > MAX) return `Use at most ${MAX} characters.`;
    const need = missing(pw);
    if (need.length) return `Your password needs ${need.join(', ')}.`;
    const low = pw.toLowerCase();
    if (OBVIOUS.some((w) => low.includes(w))) return 'Avoid obvious words such as "password" or "qwerty".';
    const u = String(username || '').toLowerCase();
    if (u.length >= 3 && low.includes(u)) return 'Your password must not contain your username.';
    const local = String(email || '').toLowerCase().split('@')[0];
    if (local.length >= 4 && low.includes(local)) return 'Your password must not contain the first part of your e-mail address.';
    return null;
  }

  /** What the sign-up sheet shows under the password field, from the password and the identity typed so far.
   *  { text, bad }: "Looks good." only when check() accepts the password, so the hint never approves a password the server would refuse. */
  function hint(pw, { email = '', username = '' } = {}) {
    if (!pw) return { text: `Use at least ${MIN} characters. Avoid obvious words such as "password".`, bad: false };
    const need = missing(pw);
    if (need.length) return { text: `Still needed: ${need.join(', ')}.`, bad: false };
    const problem = check(pw, { email, username });
    if (problem) return { text: problem, bad: true };
    return { text: 'Looks good.', bad: false };
  }

  const api = { MIN, MAX, missing, check, hint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TvPassword = api;
})(typeof window !== 'undefined' ? window : globalThis);
