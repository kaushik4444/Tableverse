'use strict';
// Sign in with Google in the page: the button appears only when the server offers it, a new person finishes a short sign-up step,
// and a refused Google address is shown as an alert. Google's script is replaced by a stub: no network.
const assert = require('node:assert/strict');
const { serve, scriptedPage, loadPlaywright, sessionOk } = require('./harness');
const { chromium } = loadPlaywright();
let failed = 0;
const test = async (name, fn) => { try { await fn(); console.log('  ok  ' + name); } catch (e) { failed++; console.error('FAIL  ' + name + '\n' + (e.stack || e)); } };

const GIS_STUB = `window.google={accounts:{id:{initialize(o){window.__g=o;},renderButton(el){const b=document.createElement('button');b.id='fakeGoogleBtn';b.textContent='Continue with Google';b.onclick=()=>window.__g.callback({credential:'cred-1'});el.appendChild(b);}}}};`;
async function stubGoogle(page, hits) {
  await page.route('https://accounts.google.com/**', (route) => { hits.push(route.request().url()); route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB }); });
}

(async () => {
  const browser = await chromium.launch();

  await test('when the server does not offer it, there is no Google button and nothing is requested from Google', async () => {
    const srv = await serve({ 'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }), 'GET /api/auth/google/config': () => ({ ok: true, enabled: false }) });
    const hits = [];
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await stubGoogle(page, hits);
    await page.goto(srv.url + '/');
    await page.waitForSelector('#loginForm', { timeout: 8000 });
    await page.waitForTimeout(400);
    assert.equal(await page.isVisible('#googleSlot'), false);
    assert.equal(hits.length, 0, 'no request to Google: ' + hits.join());
    await ctx.close(); srv.server.close();
  });

  await test('a new person: button, then the sign-up step with the address, the 18+ box and a username, then they are signed in', async () => {
    const seen = {};
    const srv = await serve({
      'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }),
      'GET /api/auth/google/config': () => ({ ok: true, enabled: true, clientId: 'x.apps.googleusercontent.com', nonce: 'n'.repeat(64) }),
      'POST /api/auth/google': ({ body }) => { seen.first = JSON.parse(body); return { ok: true, needsSignup: true, email: 'gina@example.com', suggestedName: 'Gina G' }; },
      'POST /api/auth/google/complete': ({ body }) => { seen.complete = JSON.parse(body); return { ok: true, csrfToken: 'c2', player: { id: 'p1', username: 'gina_g', display_name: 'Gina G', avatar: '🧙', email_verified: true }, requiresVerification: false }; },
      'GET /api/auth/username-available': () => ({ available: true }),
    });
    const hits = [];
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await stubGoogle(page, hits);
    await page.goto(srv.url + '/');
    await page.waitForSelector('#fakeGoogleBtn', { timeout: 8000 });
    assert.ok(await page.isVisible('#googleSlot'));
    await page.click('#fakeGoogleBtn');
    await page.waitForSelector('#googleSignupForm', { timeout: 8000 });
    assert.deepEqual(seen.first, { credential: 'cred-1' });
    assert.match(await page.textContent('#auth-overlay'), /gina@example\.com/);
    assert.equal(await page.inputValue('#googleName'), 'Gina G');
    await page.fill('#googleUsername', 'gina_g');
    // the 18+ box is required: the browser refuses the submit until it is ticked
    await page.click('#googleSignupForm button[type="submit"]');
    assert.equal(seen.complete, undefined, 'not sent without the 18+ confirmation');
    await page.check('#googleAdult');
    await page.click('#googleSignupForm button[type="submit"]');
    await page.waitForSelector('#auth-overlay', { state: 'detached', timeout: 8000 });
    assert.deepEqual({ ...seen.complete, avatar: undefined }, { credential: 'cred-1', username: 'gina_g', displayName: 'Gina G', avatar: undefined, adultConfirmed: true });
    await ctx.close(); srv.server.close();
  });

  await test('a refused Google address is shown as an alert on the auth sheet', async () => {
    const srv = await serve({
      'GET /api/auth/session': () => sessionOk(), 'GET /api/auth/csrf': () => ({ csrfToken: 'c' }),
      'GET /api/auth/google/config': () => ({ ok: true, enabled: true, clientId: 'x.apps.googleusercontent.com', nonce: 'n'.repeat(64) }),
      'POST /api/auth/google': () => ({ __status: 409, body: { ok: false, error: 'That email already has a Tableverse account. Sign in with your email and password instead.' } }),
    });
    const { page, ctx } = await scriptedPage(browser, { messages: [{ t: 'authRequired', message: 'Log in to play.' }] });
    await stubGoogle(page, []);
    await page.goto(srv.url + '/');
    await page.waitForSelector('#fakeGoogleBtn', { timeout: 8000 });
    await page.click('#fakeGoogleBtn');
    await page.waitForSelector('#auth-overlay .auth-msg[role="alert"]', { timeout: 8000 });
    assert.match(await page.textContent('#auth-overlay .auth-msg'), /already has a Tableverse account/);
    await ctx.close(); srv.server.close();
  });

  await browser.close();
  if (failed) process.exit(1);
})();
