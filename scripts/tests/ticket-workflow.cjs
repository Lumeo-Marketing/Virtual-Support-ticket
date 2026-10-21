const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks, suffix = '', globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8') + suffix, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, console, ...globals });
  return exports;
}
const constants = load('lib/constants.ts', {});
let actor, ticket, calls, activeAssignee, mailFailure, followups, notificationCalls;
const db = { async query(sql, values) {
  calls.push({ sql, values });
  if (sql.startsWith('SELECT id FROM users')) return { rows: activeAssignee ? [{ id: 3 }] : [] };
  if (sql.startsWith('SELECT name FROM users')) return { rows: [{ name: 'Escalation teammate' }] };
  if (sql.startsWith('UPDATE tickets')) {
    [ticket.status, ticket.resolution, ticket.updated_at, ticket.resolved_at, ticket.assigned_to] = values;
    ticket.assignee_name = ticket.assigned_to == null ? null : "Escalation teammate";
    return { rows: [ticket] };
  }
  return { rows: sql.startsWith('SELECT') ? [{ ...ticket }] : [] };
} };
const mocks = {
  'next/server': { after: (task) => followups.push(task), NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
  '@/lib/auth': { getCurrentUser: async () => actor },
  '@/lib/db': { getDb: async () => db, asTicket: (row) => ({ ...row, id: row.id, ticketCode: row.ticket_code, assignedTo: row.assigned_to, assigneeName: row.assignee_name }), logActivity: async (...args) => calls.push({ activity: args }) },
  '@/lib/notifications': { notifyTicketUpdate: async () => { notificationCalls++; if (mailFailure) throw new Error('Notification outage'); } },
  '@/lib/constants': constants,
};
const routes = load('app/api/tickets/[id]/route.ts', mocks);
const context = { params: Promise.resolve({ id: '7' }) };
function reset() {
  actor = { id: 1, role: 'admin', name: 'IT Admin' };
  ticket = { id: 7, ticket_code: 'LUM-7', user_id: 2, assigned_to: 3, status: 'Open', resolution: 'Previous saved note', subject: 'Help', resolved_at: null };
  calls = []; activeAssignee = true; mailFailure = false; followups = []; notificationCalls = 0;
}
const patch = async (body) => {
  const response = await routes.PATCH({ json: async () => body }, context);
  for (const task of followups.splice(0)) await task();
  return response;
};
(async () => {
  reset();
  assert.equal((await patch({ status: 'InProgress' })).status, 200);
  assert.equal(ticket.assigned_to, 3, 'Saving status must preserve the selected owner');
  assert.equal(ticket.resolution, 'Previous saved note', 'An omitted note must preserve saved resolution');
  reset(); ticket.assigned_to = null;
  const escalation = await patch({ status: 'Escalated', assignedTo: 3 });
  assert.equal(escalation.status, 200);
  assert.equal(escalation.body.ticket.assigneeName, 'Escalation teammate');
  assert.ok(calls.some(({ sql, values }) => sql?.startsWith('INSERT INTO notifications') && values[0] === 3));
  assert.ok(calls.some(({ activity }) => activity?.[4].includes('assigned to Escalation teammate')));
  reset(); activeAssignee = false;
  assert.equal((await patch({ assignedTo: 4 })).status, 400);
  reset(); assert.equal((await patch({ assignedTo: '3' })).status, 400);
  reset(); assert.equal((await patch({ assignedTo: null, status: 'Escalated' })).status, 400);
  reset(); assert.equal((await patch({ assignedTo: null })).status, 200); assert.equal(ticket.assigned_to, null);
  reset(); ticket.resolution = '';
  assert.equal((await patch({ status: 'Resolved' })).status, 400);
  assert.equal((await patch({ status: 'Resolved', resolution: 'Fixed the issue' })).status, 200);
  reset(); actor = { id: 3, role: 'staff' };
  assert.equal((await routes.GET({}, context)).status, 200, 'Assigned staff can open the ticket');
  assert.equal((await patch({ status: 'Closed' })).status, 403, 'Staff cannot perform admin updates');
  actor.id = 4; assert.equal((await routes.GET({}, context)).status, 404, 'Unrelated staff cannot open ticket');
  actor = null; assert.equal((await routes.GET({}, context)).status, 401);
  reset(); mailFailure = true;
  assert.equal((await patch({ status: 'InProgress' })).status, 200, 'Notification outages must not hide saved changes');

  reset();
  const fastSave = await routes.PATCH({ json: async () => ({ status: 'InProgress' }) }, context);
  assert.equal(fastSave.status, 200);
  assert.equal(ticket.status, 'InProgress', 'Save response follows database persistence');
  assert.equal(notificationCalls, 0, 'Saving does not wait for email');
  assert.equal(calls.filter(({ sql }) => sql?.startsWith('SELECT')).length, 1, 'Save only reads the prior ticket once');
  assert.equal(followups.length, 1);
  await followups[0]();
  assert.equal(notificationCalls, 1, 'Notifications still run after saving');

  const sent = [];
  const env = { APP_URL: 'https://support.example.com/', SMTP_HOST: 'smtp.example.com', SMTP_USER: 'sender@example.com', SMTP_PASSWORD: 'test' };
  const mail = load('lib/notifications.ts', {
    nodemailer: { createTransport: () => ({ sendMail: async (message) => { sent.push(message); return { messageId: 'test', response: 'accepted' }; } }) },
    '@/lib/db': { getDb: async () => ({ query: async () => ({ rows: [] }) }) },
  }, '', { process: { env }, console: { info() {}, error() {} } });
  const details = { id: 7, ticketCode: 'LUM-7', fullName: 'Test Requester', workEmail: 'requester@example.com', subject: 'Test ticket', priority: 'Medium', requestType: 'Incident', status: 'Open', description: 'Test description' };
  await mail.notifyTicketCreated({ userId: 2, ticket: details });
  await mail.notifyTicketUpdate({ userId: 2, ticket: { ...details, status: 'Resolved', resolution: 'Fixed' }, previousStatus: 'Open', actor: { name: 'Admin', role: 'admin' } });
  await mail.notifyTicketUpdate({ userId: 2, ticket: { ...details, status: 'InProgress' }, previousStatus: 'Open', actor: { name: 'Admin', role: 'admin' } });
  assert.equal(sent.length, 4);
  for (const message of sent) {
    assert.ok(message.html.includes('href="https://support.example.com/?ticket=7"'), 'Every ticket email button opens its ticket');
    assert.ok(message.text.includes('https://support.example.com/?ticket=7'), 'Plain text emails contain the same ticket link');
  }
  await mail.notifyMessage({ recipientId: 2, recipientEmail: 'requester@example.com', senderName: 'Admin', senderRole: 'admin', content: 'Hello' });
  assert.ok(sent.at(-1).html.includes('href="https://support.example.com/messages"'));

  // Render the actual ticket dialog with existing saved notes: the editor starts empty.
  const { renderToStaticMarkup } = require('react-dom/server');
  const ui = load('app/workspace.tsx', {
    '@/lib/constants': constants,
    'next/image': { __esModule: true, default: () => null },
    './alerts': { ErrorAlert: () => null, Spinner: () => null },
    './messages-workspace': {}, '@/app/reports': {}, '@/app/knowledge-base': {},
  }, '\nexport { TicketModal, Overview, TicketProgress };');
  const html = renderToStaticMarkup(require('react').createElement(ui.TicketModal, {
    user: { role: 'admin' }, accounts: [], ticket: { ...details, resolution: 'Existing saved resolution', createdAt: '2026-10-21', assignedTo: null },
    onClose() {}, onCreated() {}, onUpdated() {},
  }));
  assert.ok(html.includes('Existing saved resolution'), 'Saved resolution remains visible');
  assert.match(html, /<textarea[^>]*><\/textarea>/, 'Resolution editor starts blank on reopening');
  assert.ok(html.includes('In progress'));
  for (const status of constants.STATUSES) {
    const tracker = renderToStaticMarkup(require('react').createElement(ui.TicketProgress, { ticket: { ...details, status } }));
    assert.equal((tracker.match(/aria-current="step"/g) || []).length, 1, `${status} has exactly one current step`);
    const currentStep = tracker.match(/<li[^>]*aria-current="step"[^>]*>(.*?)<\/li>/s)[1];
    assert.ok(currentStep.includes(status === 'Open' ? 'Received' : constants.statusLabel(status)), `${status} is reflected in the current step`);
  }

  const dashboard = renderToStaticMarkup(require('react').createElement(ui.Overview, {
    user: { role: 'admin' }, tickets: [{ ...details, status: 'InProgress' }, { ...details, id: 8, status: 'Escalated' }],
    openCount: 2, resolvedCount: 0, activeStaffCount: 2, loading: false,
    onCreate() {}, onViewTickets() {}, onOpenKnowledgeBase() {}, onSelectTicket() {},
  }));
  assert.match(dashboard, /In progress<\/div><div class="metric-value">1/);
  assert.match(dashboard, /Escalated<\/div><div class="metric-value">1/);
  const messaging = load('app/messages-workspace.tsx', { './alerts': { DismissibleErrorAlert: () => null, ErrorAlert: () => null } });
  const inbox = renderToStaticMarkup(require('react').createElement(messaging.MessagesWorkspace, {
    user: { id: 1 }, messages: [], recipients: [], loadError: '', onSent() {}, onRead() {},
  }));
  assert.ok(inbox.includes('Team messages'));
  // Exercise the resolution save handler and message sender with controlled hook state.
  const React = require('react');
  function hookRenderer(file, moduleMocks, suffix, states, globals = {}) {
    let index = 0;
    const setters = [];
    const hooks = { ...React, useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: () => ({ current: null }),
      useState(initial) { const slot = index++; const value = slot in states ? states[slot] : initial;
        setters[slot] = (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; };
        return [value, setters[slot]];
      } };
    const loaded = load(file, { ...moduleMocks, react: hooks }, suffix, globals);
    index = 0;
    return loaded;
  }
  function find(element, predicate) {
    if (!element || typeof element !== 'object') return undefined;
    if (predicate(element)) return element;
    for (const child of React.Children.toArray(element.props?.children)) {
      const result = find(child, predicate); if (result) return result;
    }
  }
  const noteState = ['Incident', 'Network Issue', 'Resolved', 'New resolution', '3', '', false];
  let submitted, saved;
  const editor = hookRenderer('app/workspace.tsx', {
    '@/lib/constants': constants, 'next/image': {}, './alerts': {}, './messages-workspace': {}, '@/app/reports': {}, '@/app/knowledge-base': {},
  }, '\nexport { TicketModal };', noteState, { fetch: async (_url, options) => {
    submitted = JSON.parse(options.body); return { ok: true, json: async () => ({ ticket: details }) };
  } });
  const formTree = editor.TicketModal({ user: { role: 'admin' }, accounts: [], ticket: { ...details, createdAt: '2026-10-21', assignedTo: 3 }, onUpdated: (value) => { saved = value; } });
  await find(formTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(submitted.resolution, 'New resolution');
  assert.equal(noteState[3], '', 'Saving clears the note editor');
  assert.equal(saved.id, 7);
  const messageState = [null, 3, '', false, { 3: 'Hello teammate' }, '', false, 0];
  let appended;
  const messenger = hookRenderer('app/messages-workspace.tsx', { './alerts': {} }, '', messageState, {
    fetch: async () => ({ ok: true, json: async () => ({ message: { id: 12, senderId: 1, recipientId: 3 } }) }),
  });
  const messageTree = messenger.MessagesWorkspace({ user: { id: 1, name: 'Admin' }, messages: [], recipients: [{ id: 3, name: 'Teammate', active: true }], loadError: '', onSent: (value) => { appended = value; } });
  await find(messageTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(appended.content, 'Hello teammate');
  assert.equal(messageState[4][3], '', 'Sending clears only that conversation draft');
  assert.equal(messageState[0].recipientId, 3, 'Sending triggers the local inline confirmation');
  assert.equal(messageState[5], '', 'Successful sends leave no chat error');
  assert.equal(messageState[6], false, 'Send button becomes available after success');
  const failedState = [null, 3, '', false, { 3: 'Keep this draft' }, '', false, 0];
  const failedMessenger = hookRenderer('app/messages-workspace.tsx', { './alerts': {} }, '', failedState, {
    fetch: async () => ({ ok: false, json: async () => ({ error: 'Recipient is unavailable' }) }),
  });
  const failedTree = failedMessenger.MessagesWorkspace({ user: { id: 1, name: 'Admin' }, messages: [], recipients: [{ id: 3, name: 'Teammate', active: true }], loadError: '', onSent: () => assert.fail('Failed messages must not appear delivered') });
  await find(failedTree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(failedState[4][3], 'Keep this draft');
  assert.equal(failedState[5], 'Recipient is unavailable');
  assert.equal(failedState[6], false);
  const rootState = [];
  rootState[0] = { id: 1, name: 'Test Admin', role: 'admin' };
  rootState[1] = false;
  rootState[3] = [];
  rootState[13] = details;
  let blockingAlerts = 0;
  const home = hookRenderer('app/workspace.tsx', {
    '@/lib/constants': constants, 'next/image': {}, 'next/navigation': { usePathname: () => '/' },
    './alerts': { useAlerts: () => ({ show: () => blockingAlerts++, confirm() {} }) },
    './messages-workspace': {}, '@/app/reports': {}, '@/app/knowledge-base': {},
  }, '', rootState, { fetch: () => new Promise(() => {}) });
  const homeTree = home.default();
  const ticketDialog = find(homeTree, (node) => node.type?.name === 'TicketModal');
  ticketDialog.props.onUpdated(details);
  assert.equal(rootState[13], null, 'Successful resolution saves close the ticket dialog');
  assert.ok(rootState[12].includes('was updated'), 'Saved update shows a nonblocking confirmation');
  rootState[13] = 'new';
  ticketDialog.props.onCreated(details);
  assert.equal(rootState[13], null, 'Successful ticket creation closes the ticket dialog');
  assert.equal(blockingAlerts, 0, 'Successful saves do not open another confirmation dialog');
  console.log('Ticket saves close dialogs; note reset, status, permissions, message success/failure, and email checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
