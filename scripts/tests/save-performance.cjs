const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, console: { error() {} }, ...globals });
  return exports;
}
const constants = load('lib/constants.ts', {});
let calls, tasks, notificationCalls, auditCalls, released, failWrite, rejectAudit, finishMail;
const actor = { id: 1, name: 'Requester' };
const db = {
  async query(sql) {
    calls.push(sql);
    if (sql.startsWith('INSERT INTO tickets')) {
      if (failWrite) throw new Error('Write failed');
      return { rows: [{ id: 7 }] };
    }
    if (sql.startsWith('UPDATE tickets')) return { rows: [{ id: 7, ticket_code: 'LUM-7', subject: 'Test request' }] };
    return { rows: [] };
  },
  async connect() { return { query: db.query.bind(db), release: () => { released = true; } }; },
};
const routes = load('app/api/tickets/route.ts', {
  'next/server': { after: (task) => tasks.push(task), NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
  '@/lib/constants': constants,
  '@/lib/auth': { getCurrentUser: async () => actor },
  '@/lib/db': {
    getDb: async () => db, asTicket: (row) => ({ id: row.id, ticketCode: row.ticket_code, subject: row.subject }),
    logActivity: async () => { auditCalls++; if (rejectAudit) throw new Error('Audit offline'); },
  },
  '@/lib/notifications': { notifyTicketCreated: () => { notificationCalls++; return new Promise((resolve) => { finishMail = resolve; }); } },
}, { File });
function reset() {
  calls = []; tasks = []; notificationCalls = 0; auditCalls = 0; released = false; failWrite = false; rejectAudit = false;
}
const values = { fullName: 'Test Requester', workEmail: 'requester@example.com', department: 'IT', jobTitle: 'Tester', location: 'Office', requestType: 'Incident', requestSubtype: constants.REQUEST_OPTIONS.Incident[0], category: constants.CATEGORIES[0], priority: 'Medium', subject: 'Test request', description: 'Test description' };
const request = { formData: async () => ({ get: (key) => values[key] ?? null }) };
(async () => {
  reset();
  const saved = await routes.POST(request);
  assert.equal(saved.status, 201);
  assert.ok(calls.includes('COMMIT'), 'Success follows the transaction commit');
  assert.ok(released, 'Database connection is returned before the save response');
  assert.equal(notificationCalls, 0, 'SMTP does not run on the critical save path');
  assert.equal(auditCalls, 0, 'Audit runs after the save response');
  assert.equal(calls.filter((sql) => sql.startsWith('SELECT')).length, 0, 'Creation reuses UPDATE RETURNING instead of reloading the ticket');
  assert.equal(tasks.length, 1);
  const background = tasks[0]();
  assert.equal(notificationCalls, 1);
  assert.equal(auditCalls, 1);
  // The response has already succeeded while the simulated slow mail is still pending.
  assert.equal(saved.body.ticket.id, 7);
  finishMail(); await background;

  reset(); rejectAudit = true;
  assert.equal((await routes.POST(request)).status, 201);
  const failedAudit = tasks[0]();
  assert.equal(notificationCalls, 1, 'An audit outage must not skip the email workflow');
  finishMail(); await failedAudit;

  reset(); failWrite = true;
  assert.equal((await routes.POST(request)).status, 500);
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(tasks.length, 0, 'Failed saves do not schedule notifications');
  assert.ok(released);
  console.log('Fast-save checks passed: commit before response, background email/audit, fewer queries, and rollback on failure.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
