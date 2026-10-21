const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, console: { error() {} } });
  return exports;
}
let actor, target, queries, tasks, failInsert, failNotify, failAudit, mailCalls;
const routes = load('app/api/messages/route.ts', {
  'next/server': {
    NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) },
    after: (task) => tasks.push(task),
  },
  '@/lib/auth': { getCurrentUser: async () => actor },
  '@/lib/db': {
    getDb: async () => ({ query: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT id,name')) return { rows: target ? [target] : [] };
      if (sql.startsWith('INSERT INTO messages')) {
        if (failInsert) throw new Error('Database offline');
        return { rows: [{ id: '12', createdAt: '2026-10-21T12:00:00Z' }] };
      }
      if (sql.startsWith('UPDATE messages')) return { rows: [{ id: 12, readAt: '2026-10-21T12:01:00Z' }] };
      return { rows: [] };
    } }),
    logActivity: async () => { if (failAudit) throw new Error('Audit unavailable'); },
  },
  '@/lib/notifications': { notifyMessage: async () => { mailCalls++; if (failNotify) throw new Error('Mail unavailable'); } },
});
function reset() {
  actor = { id: 1, name: 'Sender', role: 'staff' };
  target = { id: 2, name: 'Recipient', email: 'recipient@example.com', active: true };
  queries = []; tasks = []; failInsert = false; failNotify = false; failAudit = false; mailCalls = 0;
}
const post = (body) => routes.POST({ json: async () => body });
(async () => {
  reset(); actor = null; assert.equal((await post({ recipientId: 2, content: 'Hello' })).status, 401);
  reset(); assert.equal((await routes.POST({ json: async () => { throw new Error('Invalid JSON'); } })).status, 400);
  for (const body of [null, {}, { recipientId: 2, content: ' ' }, { recipientId: 2, content: 123 }, { recipientId: 2, content: 'x'.repeat(5001) }, { recipientId: 1, content: 'Self' }, { recipientId: -1, content: 'Hello' }]) {
    reset(); assert.equal((await post(body)).status, 400);
    assert.ok(!queries.some(({ sql }) => sql.startsWith('INSERT')));
  }
  reset(); target.active = false; assert.equal((await post({ recipientId: 2, content: 'Hello' })).status, 404);
  reset(); target = null; assert.equal((await post({ recipientId: 2, content: 'Hello' })).status, 404);
  reset();
  const sent = await post({ recipientId: 2, content: '  Hello teammate  ' });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.content, 'Hello teammate');
  assert.equal(sent.body.message.id, 12);
  assert.equal(sent.body.message.readAt, null);
  assert.equal(queries.filter(({ sql }) => sql.startsWith('INSERT')).length, 1);
  assert.equal(mailCalls, 0, 'Email work must not delay the send response');
  assert.equal(tasks.length, 1);
  await tasks[0](); assert.equal(mailCalls, 1);
  reset(); failNotify = true; failAudit = true;
  assert.equal((await post({ recipientId: 2, content: 'Saved despite follow-up outage' })).status, 201);
  await tasks[0](); // Both failures are handled after successful delivery.
  reset(); failInsert = true;
  const failed = await post({ recipientId: 2, content: 'Not saved' });
  assert.equal(failed.status, 500); assert.ok(failed.body.error); assert.equal(tasks.length, 0);
  reset();
  const read = await routes.PATCH({ json: async () => ({ senderId: 2, throughId: 12 }) });
  assert.equal(read.status, 200);
  const update = queries.find(({ sql }) => sql.startsWith('UPDATE messages'));
  assert.match(update.sql, /recipient_id=\$1 AND sender_id=\$2 AND id<=\$3/);
  assert.equal(update.values[0], actor.id, 'Only the recipient can mark their messages read');
  assert.equal(read.body.ids[0], 12);
  const { mergeMessages } = load('app/messages-workspace.tsx', { './alerts': {} });
  const old = { id: 11, senderId: 2, recipientId: 1, readAt: null };
  const fresh = { id: 12, senderId: 1, recipientId: 2, readAt: null };
  const merged = mergeMessages([{ ...old, readAt: '2026-10-21T12:01:00Z' }, fresh], [old]);
  assert.equal(merged[0].id, 12, 'An older poll cannot erase a newly sent message');
  assert.ok(merged[1].readAt, 'An older poll cannot undo a read receipt');
  assert.equal(mergeMessages(merged, [fresh, old]).length, 2, 'Refreshed messages are deduplicated');
  console.log('Chat send, validation, delivery, read permissions, notification failure, and polling race checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
