const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');

function load(file, mocks, env = process.env) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, {
    exports, require: (name) => mocks[name] || require(name),
    process: { env }, TextEncoder, URL,
  });
  return exports;
}

(async () => {
  const jose = await import('jose');
  for (const production of [false, true]) {
    const stored = new Map();
    let lastCookie;
    const jar = {
      set(name, value, options) {
        lastCookie = { name, value, ...options };
        if (options.maxAge === 0) stored.delete(name);
        else stored.set(name, value);
      },
      get(name) { return stored.has(name) ? { value: stored.get(name) } : undefined; },
    };
    const user = { id: 7, name: 'Test', email: 'test@example.com', role: 'staff', active: true };
    let dbCalls = 0;
    const auth = load('lib/auth.ts', {
      jose,
      'next/headers': { cookies: async () => jar },
      '@/lib/db': {
        getDb: async () => ({ query: async () => { dbCalls++; return { rows: [user] }; } }),
        asUser: (row) => row,
      },
    }, { NODE_ENV: production ? 'production' : 'development', SESSION_SECRET: 'test-secret-with-at-least-thirty-two-characters' });
    assert.equal(await auth.getCurrentUser(), null);
    assert.equal(dbCalls, 0);
    await auth.createSession(user);
    assert.equal(lastCookie.httpOnly, true);
    assert.equal(lastCookie.secure, production);
    assert.equal(lastCookie.partitioned, production);
    assert.equal(lastCookie.sameSite, production ? 'none' : 'lax');
    assert.equal(lastCookie.path, '/');
    assert.equal(lastCookie.maxAge, 43200);
    const response = new NextResponse();
    response.cookies.set(lastCookie);
    const serialized = response.headers.get('set-cookie');
    assert.match(serialized, /HttpOnly/i);
    if (production) {
      assert.match(serialized, /^__Host-lumeo_session=/);
      assert.match(serialized, /SameSite=none/i);
      assert.match(serialized, /Secure/);
      assert.match(serialized, /Partitioned/);
    } else {
      assert.match(serialized, /SameSite=lax/i);
      assert.doesNotMatch(serialized, /Secure|Partitioned/);
    }
    assert.equal((await auth.getCurrentUser()).id, user.id);
    user.active = false;
    assert.equal(await auth.getCurrentUser(), null);
    user.active = true;
    const sessionName = lastCookie.name;
    stored.set(sessionName, 'invalid-token');
    assert.equal(await auth.getCurrentUser(), null);
    await auth.createSession(user);
    await auth.destroySession();
    assert.equal(lastCookie.maxAge, 0);
    assert.equal(lastCookie.partitioned, production);
    assert.equal(lastCookie.secure, production);
    assert.equal(await auth.getCurrentUser(), null);
  }

  const { proxy } = load('proxy.ts', {});
  function request(method, headers = {}) {
    return new NextRequest('https://support.example.com/api/tickets', { method, headers });
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    // The iframe's fetch origin is the portal, even when GHL is the top-level site.
    assert.equal(proxy(request(method, { origin: 'https://support.example.com', 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal(proxy(request(method, { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal(proxy(request(method, { origin: 'https://attacker.example' })).status, 403);
    assert.equal(proxy(request(method, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal(proxy(request(method, { origin: 'null' })).status, 403);
    assert.equal(proxy(request(method)).status, 200);
  }
  assert.equal(proxy(request('GET', { 'sec-fetch-site': 'cross-site' })).status, 200);
  const { proxy: deployedProxy } = load('proxy.ts', {}, { APP_URL: 'https://support.example.com/workspace/' });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    function deployedRequest(headers) {
      return new NextRequest('http://localhost:3000/api/auth/login', { method, headers });
    }
    assert.equal(deployedProxy(deployedRequest({ origin: 'https://support.example.com', 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal(proxy(deployedRequest({ origin: 'http://support.example.com', host: 'support.example.com', 'sec-fetch-site': 'same-origin' })).status, 200);
    for (const origin of ['https://attacker.example', 'https://support.example.com.attacker.example', 'https://app.gohighlevel.com', 'null', 'invalid']) {
      assert.equal(deployedProxy(deployedRequest({ origin, 'sec-fetch-site': 'same-origin', 'x-forwarded-host': 'attacker.example' })).status, 403);
    }
    assert.equal(deployedProxy(deployedRequest({ origin: 'https://support.example.com', 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal(deployedProxy(deployedRequest({ 'sec-fetch-site': 'cross-site' })).status, 403);
  }
  for (const APP_URL of ['invalid', 'file:///tmp/portal', '']) {
    const { proxy: invalidConfigProxy } = load('proxy.ts', {}, { APP_URL });
    assert.equal(invalidConfigProxy(request('POST', { origin: 'null' })).status, 403);
    assert.equal(invalidConfigProxy(request('POST', { origin: 'https://support.example.com' })).status, 200);
  }
  console.log('Embedded/standalone cookie, signed-session, logout, and cross-origin protection checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
