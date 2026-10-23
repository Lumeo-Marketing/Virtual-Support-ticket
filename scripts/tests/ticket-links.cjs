const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
function load(file, mocks, suffix = '', globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8') + suffix, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: (name) => mocks[name] || require(name), process, console, URL, URLSearchParams, ...globals });
  return exports;
}
function find(element, predicate) {
  if (!element || typeof element !== 'object') return;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const result = find(child, predicate); if (result) return result;
  }
}
const constants = load('lib/constants.ts', {});
function harness(initialPath, search, signedIn = true) {
  let index, effects, pathname = initialPath;
  const states = [], requests = [], errors = [];
  const admin = { id: 1, name: 'Test Admin', email: 'admin@example.com', role: 'admin' };
  states[0] = signedIn ? admin : null; states[1] = false;
  const notify = (...args) => errors.push(args);
  const hooks = { ...React,
    useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], (value) => { states[slot] = typeof value === 'function' ? value(states[slot]) : value; }];
    },
    useEffect(fn, deps) { effects.push({ fn, deps }); },
    useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: () => ({ current: null }),
  };
  const page = load('app/workspace.tsx', {
    react: hooks, 'next/navigation': { usePathname: () => pathname }, 'next/image': {},
    '@/lib/constants': constants, './alerts': { useAlerts: () => ({ show: notify, confirm() {} }) },
    './messages-workspace': {}, '@/app/reports': {}, '@/app/knowledge-base': {},
  }, '', {
    window: { location: { search } },
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({ ticket: { id: Number(url.split('/').at(-1)), ticketCode: 'LUM-7' } }) };
    },
  });
  function render() { index = 0; effects = []; return page.default(); }
  async function openLink() {
    render();
    const effect = effects.find(({ deps }) => deps?.[1] === pathname);
    assert.ok(effect, 'Ticket opening subscribes to the current path');
    effect.fn();
    await new Promise(setImmediate);
    return render();
  }
  return { requests, errors, states, admin, openLink, navigate: (path) => { pathname = path; } };
}
(async () => {
  const direct = harness('/tickets/7', '');
  let tree = await direct.openLink();
  assert.equal(direct.requests[0], '/api/tickets/7');
  assert.equal(find(tree, (node) => node.type?.name === 'TicketModal').props.ticket.id, 7);
  assert.equal(direct.states[2], 'tickets', 'Direct links open the ticket queue behind the dialog');
  assert.equal(direct.errors.length, 0);
  direct.navigate('/tickets/8');
  tree = await direct.openLink();
  assert.equal(find(tree, (node) => node.type?.name === 'TicketModal').props.ticket.id, 8, 'Navigating to another ticket opens the new ticket');

  const legacy = harness('/', '?ticket=7');
  tree = await legacy.openLink();
  assert.equal(find(tree, (node) => node.type?.name === 'TicketModal').props.ticket.id, 7, 'Previously sent query links still work');

  const login = harness('/tickets/7', '', false);
  tree = await login.openLink();
  assert.equal(login.requests.length, 0, 'Signed-out visitors must sign in before fetching a ticket');
  assert.equal(tree.type.name, 'LoginScreen');
  login.states[0] = login.admin;
  tree = await login.openLink();
  assert.equal(find(tree, (node) => node.type?.name === 'TicketModal').props.ticket.id, 7, 'After sign-in the same requested ticket opens');

  const normal = harness('/', '');
  tree = await normal.openLink();
  assert.equal(normal.requests.length, 0, 'Ordinary dashboard navigation does not open a ticket');

  for (const env of [
    { APP_URL: 'https://virtual-support-ticket-production.up.railway.app/' },
    { RAILWAY_PUBLIC_DOMAIN: 'virtual-support-ticket-production.up.railway.app' },
    { APP_URL: 'http://localhost:3000', RAILWAY_PUBLIC_DOMAIN: 'virtual-support-ticket-production.up.railway.app' },
  ]) {
    const { ticketUrl } = load('lib/notifications.ts', { '@/lib/db': {} }, '\nexport { ticketUrl };', { process: { env } });
    assert.equal(ticketUrl(7), 'https://virtual-support-ticket-production.up.railway.app/tickets/7');
  }
  const custom = load('lib/notifications.ts', { '@/lib/db': {} }, '\nexport { ticketUrl };', { process: { env: { APP_URL: 'https://support.example.com/?old=home', RAILWAY_PUBLIC_DOMAIN: 'virtual-support-ticket-production.up.railway.app' } } });
  assert.equal(custom.ticketUrl(7), 'https://support.example.com/tickets/7', 'A configured custom portal domain takes precedence');
  console.log('Ticket links passed: signed-in admin, sign-in return, ticket navigation, legacy URLs, Railway fallback, and custom domains.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
