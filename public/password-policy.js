/* The password rule for new passwords (sign-up and reset). One file for the browser and the server so they cannot drift.
   A password needs: 10 to 200 characters, an uppercase letter, a lowercase letter, a number and a symbol; it may not contain
   the username, the first part of the e-mail address, or an obvious word such as "password". Existing passwords still work to
   sign in: the rule applies only when a password is chosen. */
(function (root) {
  const MIN = 10;
  const MAX = 200;
  const OBVIOUS = ['password', 'passw0rd', 'qwerty', 'letmein', 'iloveyou', 'welcome', 'tableverse', '123456', 'abc123', 'admin123'];
  const has = {
    upper: (s) => /\p{Lu}/u.test(s),
    lower: (s) => /\p{Ll}/u.test(s),
    number: (s) => /\p{Nd}/u.test(s),
    symbol: (s) => /[^\p{L}\p{Nd}]/u.test(s), // anything that is not a letter or digit: punctuation, space, emoji
  };
  const NAMES = { upper: 'an uppercase letter', lower: 'a lowercase letter', number: 'a number', symbol: 'a symbol such as ! ? # or a space' };

  /** What the password still needs, as a list of short phrases (empty when it is acceptable on length and character kinds). */
  function missing(pw) {
    const s = typeof pw === 'string' ? pw : '';
    const out = [];
    if ([...s].length < MIN) out.push(`at least ${MIN} characters`);
    for (const k of ['upper', 'lower', 'number', 'symbol']) if (!has[k](s)) out.push(NAMES[k]);
    return out;
  }

  /** null when the password is acceptable, otherwise a message that says what to change. */
  function check(pw, { email = '', username = '' } = {}) {
    if (typeof pw !== 'string') return 'Enter a password.';
    if (pw.length > MAX) return `Use at most ${MAX} characters.`;
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
    if (!pw) return { text: 'Use an uppercase letter, a lowercase letter, a number and a symbol.', bad: false };
    const need = missing(pw);
    if (need.length) return { text: `Still needed: ${need.join(', ')}.`, bad: false };
    const problem = check(pw, { email, username });
    if (problem) return { text: problem, bad: true };
    return { text: 'Looks good.', bad: false };
  }

  const api = { MIN, MAX, missing, check, hint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TvPassword = api;
})(typeof window !== 'undefined' ? window : globalThis);
