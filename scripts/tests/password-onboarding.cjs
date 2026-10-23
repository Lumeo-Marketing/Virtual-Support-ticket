const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const bcrypt = require('bcryptjs');
function load(file, mocks = {}, extra = '', globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8') + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, console: { error() {}, info() {} }, TextEncoder, URL, URLSearchParams, ...globals });
  return exports;
}
const secrets = load('lib/password-reset.ts');
const passwords = load('lib/passwords.ts');
let actor, user, reset, queries, tasks, sent, failTokenInsert, failPasswordUpdate, snapshot, released;
const db = {
  async query(sql, values = []) {
    queries.push({ sql, values });
    if (sql === 'BEGIN') snapshot = { user: user ? { ...user } : null, reset: reset ? { ...reset } : null };
    if (sql === 'ROLLBACK') { user = snapshot.user; reset = snapshot.reset; }
    if (sql.startsWith('INSERT INTO users')) {
      user = { id: 7, name: values[0], email: values[1], password_hash: values[2], role: values[3], active: true, session_version: 0 };
      return { rows: [{ id: 7 }] };
    }
    if (sql.startsWith('INSERT INTO password_reset_tokens')) {
      if (failTokenInsert) throw new Error('Token insert failed');
      reset = { hash: values[0], userId: values[1], email: values[2], passwordHash: values[3], expires: values[4] };
    }
    if (sql.startsWith('SELECT u.* FROM password_reset_tokens')) {
      assert.match(sql, /p.expires_at>NOW\(\)/);
      assert.match(sql, /u.active=TRUE/);
      assert.match(sql, /p.password_hash_at_issue=u.password_hash/);
      assert.match(sql, /p.email_at_issue=u.email/);
      assert.match(sql, /FOR UPDATE OF p,u/);
      const valid = reset && user && reset.hash === values[0] && new Date(reset.expires) > new Date() && user.active && reset.email === user.email && reset.passwordHash === user.password_hash;
      return { rows: valid ? [{ ...user }] : [] };
    }
    if (sql.startsWith('UPDATE users SET password_hash')) {
      if (failPasswordUpdate) throw new Error('Password write failed');
      user.password_hash = values[0]; user.session_version++;
    }
    if (sql.startsWith('DELETE FROM password_reset_tokens')) reset = null;
    return { rows: [] };
  },
  async connect() { return { query: db.query.bind(db), release() { released = true; } }; },
};
const mocks = {
  'next/server': { after: (task) => tasks.push(task), NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
  '@/lib/auth': { getCurrentUser: async () => actor },
  '@/lib/db': { getDb: async () => db, logActivity: async () => {}, asUser: (row) => ({ ...row }) },
  '@/lib/password-reset': secrets, '@/lib/passwords': passwords,
  '@/lib/notifications': { notifyUserCreated: async (details) => sent.push(details) },
};
const create = load('app/api/admin/users/route.ts', mocks);
const change = load('app/api/auth/reset-password/route.ts', mocks);
const details = { name: 'Test Staff', email: 'staff@example.com', role: 'staff' };
function init() {
  actor = { id: 1, role: 'admin', isSuperAdmin: false }; user = null; reset = null; queries = []; tasks = []; sent = [];
  failTokenInsert = false; failPasswordUpdate = false; released = false;
}
const post = (body) => create.POST({ json: async () => body });
const submit = (body) => change.POST({ json: async () => body });
const flush = async () => { for (const task of tasks.splice(0)) await task(); };
function fixture() {
  init();
  const link = secrets.newPasswordReset();
  user = { id: 7, name: 'Test Staff', email: 'staff@example.com', role: 'staff', active: true, password_hash: bcrypt.hashSync('TemporaryPassword123!', 4), session_version: 0 };
  reset = { hash: link.tokenHash, userId: 7, email: user.email, passwordHash: user.password_hash, expires: link.expiresAt };
  return { token: link.token, password: 'MyNewPassword456!', confirmPassword: 'MyNewPassword456!' };
}
(async () => {
  const unique = new Set(Array.from({ length: 30 }, () => secrets.newPasswordReset().token));
  assert.equal(unique.size, 30);
  const link = secrets.newPasswordReset();
  assert.match(link.token, /^[a-f0-9]{64}$/);
  assert.notEqual(link.token, link.tokenHash);
  assert.equal(secrets.hashResetToken(link.token), link.tokenHash);
  assert.ok(new Date(link.expiresAt).getTime() - Date.now() <= 86400000);
  assert.equal(passwords.passwordValidationError(secrets.newTemporaryPassword()), '');
  assert.ok(passwords.passwordValidationError('short'));
  assert.ok(passwords.passwordValidationError('🙂'.repeat(20)));

  init(); actor = null; assert.equal((await post(details)).status, 403);
  init(); assert.equal((await post({ ...details, password: 'short' })).status, 400);
  init(); assert.equal((await post({ ...details, role: 'superadmin' })).status, 403);
  init();
  const created = await post(details);
  assert.equal(created.status, 201);
  assert.ok(queries.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(released);
  assert.equal(sent.length, 0, 'Welcome emails must not delay creation');
  assert.ok(reset && reset.hash !== user.password_hash);
  assert.equal(created.body.user.password, undefined);
  assert.equal(created.body.user.token, undefined);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, details.email);
  assert.ok(await bcrypt.compare(sent[0].temporaryPassword, user.password_hash));
  assert.equal(secrets.hashResetToken(sent[0].resetToken), reset.hash, 'Only a hash of the emailed token is stored');

  init(); failTokenInsert = true;
  assert.equal((await post({ ...details, password: 'TemporaryPassword123!' })).status, 500);
  assert.equal(user, null, 'User creation rolls back if its reset token cannot be saved');
  assert.equal(tasks.length, 0);

  let body = fixture();
  assert.equal((await submit({ ...body, confirmPassword: 'DoesNotMatch123!' })).status, 400);
  assert.equal((await submit({ ...body, password: 'short', confirmPassword: 'short' })).status, 400);
  assert.equal((await submit({ ...body, token: 'bad' })).status, 400);
  assert.equal(queries.length, 0, 'Invalid form submissions are rejected before touching the database');
  const changed = await submit(body);
  assert.equal(changed.status, 200);
  assert.ok(await bcrypt.compare(body.password, user.password_hash));
  assert.ok(!(await bcrypt.compare('TemporaryPassword123!', user.password_hash)));
  assert.equal(user.session_version, 1, 'Changing the password revokes prior sign-in sessions');
  assert.equal(reset, null);
  assert.equal((await submit(body)).status, 400, 'A link cannot be reused');
  await flush();
  body = fixture(); reset.expires = '2000-01-01T00:00:00Z'; assert.equal((await submit(body)).status, 400);
  body = fixture(); user.active = false; assert.equal((await submit(body)).status, 400);
  body = fixture(); user.email = 'changed@example.com'; assert.equal((await submit(body)).status, 400);
  body = fixture(); user.password_hash = bcrypt.hashSync('AdminChangedPassword!', 4); assert.equal((await submit(body)).status, 400);
  body = fixture();
  assert.equal((await submit({ ...body, password: 'TemporaryPassword123!', confirmPassword: 'TemporaryPassword123!' })).status, 400, 'A user must replace the temporary password');
  assert.ok(reset, 'Choosing the same password does not consume the link');
  body = fixture(); failPasswordUpdate = true;
  assert.equal((await submit(body)).status, 500);
  assert.ok(reset, 'Failed writes retain the reset token for retry');
  assert.equal(user.session_version, 0);

  const emails = [];
  const mail = load('lib/notifications.ts', {
    nodemailer: { createTransport: () => ({ sendMail: async (message) => { emails.push(message); return {}; } }) },
    '@/lib/db': {},
  }, '', { process: { env: { SMTP_HOST: 'mail.example.com', SMTP_USER: 'sender@example.com', SMTP_PASSWORD: 'test', RAILWAY_PUBLIC_DOMAIN: 'virtual-support-ticket-production.up.railway.app' } } });
  await mail.notifyUserCreated({ name: 'Test <Staff>', email: 'staff@example.com', temporaryPassword: 'TemporaryPassword123!', resetToken: link.token });
  assert.ok(emails[0].html.includes(`https://virtual-support-ticket-production.up.railway.app/reset-password#token=${link.token}`));
  assert.ok(emails[0].text.includes('TemporaryPassword123!'));
  assert.ok(emails[0].text.includes('24 hours'));
  assert.ok(!emails[0].html.includes('<Staff>'), 'Welcome messages escape account names');
  const React = require('react');
  function formHarness(values, ok = true) {
    let index = 0, requestBody, urlAfterSuccess;
    const form = load('app/reset-password/reset-password-form.tsx', {
      react: { ...React, useEffect() {}, useState(initial) {
        const slot = index++;
        if (!(slot in values)) values[slot] = initial;
        return [values[slot], (value) => { values[slot] = typeof value === 'function' ? value(values[slot]) : value; }];
      } },
      'next/image': { __esModule: true, default: 'img' }, 'next/link': { __esModule: true, default: 'a' },
      '../alerts': { Spinner: () => null }, '@/lib/passwords': passwords,
    }, '', {
      window: { location: { pathname: '/reset-password' }, history: { replaceState: (_state, _title, path) => { urlAfterSuccess = path; } } },
      fetch: async (_url, options) => { requestBody = JSON.parse(options.body); return { ok, json: async () => ok ? { ok: true } : { error: 'Link expired' } }; },
    });
    return { render() { index = 0; return form.default(); }, values, request: () => requestBody, location: () => urlAfterSuccess };
  }
  function find(element, predicate, result = []) {
    if (!element || typeof element !== 'object') return result;
    if (predicate(element)) result.push(element);
    for (const child of React.Children.toArray(element.props?.children)) find(child, predicate, result);
    return result;
  }
  const mismatchForm = formHarness([link.token, true, 'MyNewPassword456!', 'DifferentPassword456!', false, false, '', false]);
  let tree = mismatchForm.render();
  assert.equal(find(tree, (node) => node.type === 'input').length, 2, 'Reset form has password and confirmation inputs');
  assert.equal(find(tree, (node) => node.type === 'button' && node.props.type === 'submit')[0].props.disabled, true);
  await find(tree, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(mismatchForm.request(), undefined, 'Mismatched passwords are not submitted');
  const matchingForm = formHarness([link.token, true, 'MyNewPassword456!', 'MyNewPassword456!', false, false, '', false]);
  tree = matchingForm.render();
  assert.equal(find(tree, (node) => node.type === 'button' && node.props.type === 'submit')[0].props.disabled, false);
  await find(tree, (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(matchingForm.request().password, matchingForm.request().confirmPassword);
  assert.equal(matchingForm.values[7], true, 'Successful reset shows completion');
  assert.equal(matchingForm.values[2], '', 'Successful reset clears the password fields');
  assert.equal(matchingForm.values[0], '', 'Successful reset removes the secret from state');
  assert.equal(matchingForm.location(), '/reset-password', 'Successful reset removes the token from the URL');
  assert.equal(find(matchingForm.render(), (node) => node.type === 'form').length, 0);
  const failedForm = formHarness([link.token, true, 'MyNewPassword456!', 'MyNewPassword456!', false, false, '', false], false);
  await find(failedForm.render(), (node) => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(failedForm.values[7], false);
  assert.equal(failedForm.values[6], 'Link expired');
  assert.equal(failedForm.values[5], false, 'Failed resets allow retry');
  console.log('Onboarding checks passed: welcome email, generated password, two-field form, mismatch, token expiry/replay, session revocation, permissions, and rollback.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
