const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const bcrypt = require('bcryptjs');

let actor, target, calls, failDelete;
const db = {
  async query(sql, values) {
    calls.push({ sql, values });
    if (failDelete && sql.startsWith('DELETE FROM users')) throw new Error('delete failed');
    return { rows: sql.startsWith('SELECT') && target ? [target] : [] };
  },
  async connect() { return { query: this.query.bind(this), release() {} }; },
};
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, TextEncoder });
  return exports;
}
const routes = load('app/api/admin/users/[id]/route.ts', {
  'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
  '@/lib/auth': { getCurrentUser: async () => actor },
  '@/lib/db': { getDb: async () => db, logActivity: async () => {} },
});
const context = { params: Promise.resolve({ id: '2' }) };
function reset(isSuperAdmin = true) {
  actor = { id: 1, name: 'Manager', email: 'manager@example.com', role: isSuperAdmin ? 'superadmin' : 'admin', isSuperAdmin };
  target = { id: 2, name: 'Owner', email: 'owner@example.com', role: 'admin', isSuperAdmin: true, active: true, department: null, jobTitle: null, location: null };
  calls = []; failDelete = false;
}
async function patch(body) { return routes.PATCH({ json: async () => body }, context); }
(async () => {
  reset();
  assert.equal((await patch({ name: 'New Owner', email: 'new@example.com', password: 'NewPassword123!', department: 'IT', jobTitle: 'Lead', location: 'Lagos' })).status, 200);
  const update = calls.find(({ sql }) => sql.startsWith('UPDATE users'));
  assert.match(update.sql, /name=\$.*email=\$.*department=\$.*job_title=\$.*location=\$.*password_hash=\$/);
  assert.ok(update.values.some((value) => typeof value === 'string' && value.startsWith('$2') && bcrypt.compareSync('NewPassword123!', value)));
  reset(); assert.equal((await patch({ role: 'staff', active: false })).status, 200);
  assert.match(calls.find(({ sql }) => sql.startsWith('UPDATE users')).sql, /is_super_admin=/);
  reset(false); assert.equal((await patch({ name: 'Changed' })).status, 409);
  assert.equal((await routes.DELETE({}, context)).status, 403);
  reset(false); target.isSuperAdmin = false;
  assert.equal((await patch({ email: 'godwin@lumeomarketing.com' })).status, 403);
  assert.equal((await patch({ role: 'superadmin' })).status, 403);
  assert.equal((await patch({ name: 'Updated Teammate' })).status, 200);
  reset(); assert.equal((await patch({ password: 'short' })).status, 400);
  reset(); assert.equal((await routes.DELETE({}, context)).status, 200);
  assert.ok(calls.some(({ sql }) => sql === 'COMMIT'));
  assert.ok(calls.some(({ sql }) => sql.startsWith('UPDATE tickets SET user_id=NULL')));
  assert.ok(calls.some(({ sql }) => sql.startsWith('UPDATE knowledge_base SET created_by=NULL')));
  reset(); failDelete = true;
  assert.equal((await routes.DELETE({}, context)).status, 500);
  assert.ok(calls.some(({ sql }) => sql === 'ROLLBACK'));
  reset(); target = null; assert.equal((await routes.DELETE({}, context)).status, 404);
  const { asUser } = load('lib/db.ts', {});
  assert.equal(asUser({ id: 3, name: 'Godwin', email: 'GODWIN@LUMEOMARKETING.COM', role: 'staff', is_super_admin: false }).isSuperAdmin, true);
  assert.equal(asUser({ id: 4, name: 'Staff', email: 'staff@example.com', role: 'staff', is_super_admin: false }).isSuperAdmin, false);
  console.log('User management permission, password, deletion, and rollback checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
