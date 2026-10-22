const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compile existing TypeScript in memory; SDKs are replaced before loading routes.
function harness({ effectsEnabled = false, storageValues = new Map() } = {}) {
  const state = { evaluations: [], generations: [], calls: [], user: { id: 'user-a', email: 'user@example.test' } };
  const db = {
    auth: { getSession: async () => ({ data: { session: state.user ? { access_token: 'valid' } : null } }), getUser: async token => token === 'invalid' ? { error: true } : { data: { user: state.user } } },
    rpc: async () => ({ data: [{ readiness_checks_used: 1, drafts_used: 1 }] }),
    from(table) {
      let inserted; const filters = []; let count = false;
      const result = () => {
        const rows = table === 'demo_usage' ? [] : state[table];
        if (inserted) {
          if (table === 'evaluations' && rows.some(row => row.demo_import_id === inserted.demo_import_id)) return { error: { code: '23505' } };
          const row = { id: `saved-${rows.length}`, ...inserted }; rows.push(row); inserted = null;
          return { data: row };
        }
        const matches = rows.filter(row => filters.every(([key, value]) => row[key] === value));
        return count ? { count: matches.length } : { data: matches[0] ?? null };
      };
      const query = {
        select(_fields, options) { count = !!options?.count; return this; },
        eq(key, value) { filters.push([key, value]); return this; },
        insert(row) { inserted = row; return this; },
        single: async () => result(), maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      }; return query;
    },
  };
  const environment = { NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only', DEMO_USAGE_SALT: 'test-only-signing-secret-at-least-32-characters', ADMIN_EMAILS: '', OPENAI_API_KEY: 'test-only' };
  const storageWindow = { localStorage: {
    getItem(key) { if (state.storageFailure === 'read') throw new Error('Storage read blocked'); return storageValues.get(key) ?? null; },
    setItem(key, value) { if (state.storageFailure === 'write') throw new Error('Storage write blocked'); storageValues.set(key, value); },
    removeItem(key) { if (state.storageFailure === 'remove') throw new Error('Storage removal blocked'); storageValues.delete(key); },
  } };
  const effects = []; const effectDeps = []; const effectCleanups = []; let effectIndex = 0;
  const hooks = []; let hookIndex = 0;
  const react = {
    useState(initial) { const index = hookIndex++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }]; },
    useRef(initial) { const index = hookIndex++; return hooks[index] ?? (hooks[index] = { current: initial }); },
    useEffect(callback, deps) {
      if (!effectsEnabled) return;
      const index = effectIndex++;
      if (!effectDeps[index] || deps.some((value, i) => !Object.is(value, effectDeps[index][i]))) {
        effectDeps[index] = deps;
        effects.push(() => { effectCleanups[index]?.(); effectCleanups[index] = callback(); });
      }
    },
  };
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const localRequire = name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' };
      if (name === 'next/head') return () => null;
      if (name === '@supabase/supabase-js') return { createClient: () => db };
      if (name === 'openai') return class { chat = { completions: { create: async request => {
        state.calls.push(request);
        return { choices: [{ message: { content: request.messages[0].content.includes('primary responsibility') ? JSON.stringify(state.modelEvaluation ?? evaluation) : 'A legitimate draft.' } }] };
      } } }; };
      if (name.startsWith('.')) { const target = path.resolve(path.dirname(filename), name); return load(target + (fs.existsSync(target + '.ts') ? '.ts' : '.tsx')); }
      return require(name);
    };
    vm.runInNewContext('(function(require,module,exports,process,Buffer,console){' + code + '\n})', { window: storageWindow, fetch: (...args) => state.fetch(...args), alert: message => { state.alert = message; } })(localRequire, module, module.exports, { env: environment }, Buffer, { info() {}, error() {} });
    return module.exports;
  }
  async function request(route, body, authenticated = true, ip = '192.0.2.1') {
    const req = { method: 'POST', body, headers: { ...(authenticated ? { authorization: 'Bearer valid' } : {}), 'x-forwarded-for': ip }, socket: {} };
    const res = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await load(`pages/api/${route}.ts`).default(req, res); return res;
  }
  function renderHome() {
    const Home = load('pages/index.tsx').default;
    hooks[2] = state.user; hooks[3] = true; hookIndex = 0; effectIndex = 0;
    return Home();
  }
  async function flushEffects() {
    for (const effect of effects.splice(0)) effect();
    await new Promise(resolve => setImmediate(resolve));
  }
  return { state, request, load, environment, renderHome, flushEffects, storageValues };

}
const evaluation = { verdict: 'GO', risk_score: 15, risk_breakdown: { external_validation: 3, beneficiary_clarity: 3, explainability: 3, third_party_support: 3, impact_vs_activity: 3 }, primary_failure_modes: [], journalist_reaction: 'A concrete story.', recommendation: { summary: 'Proceed with PR.', next_actions: [] } };
const context = { market: 'Technology', partners: 'Named customer', funding: 'Bootstrapped' };
function saved(verdict = 'GO', user = 'user-a') { return { id: 'evaluation-a', user_id: user, announcement: 'Evaluated announcement', verdict, source: 'authenticated' }; }
function receipt(h, verdict = 'GO') { return h.load('lib/server/demoProvenance.ts').createDemoResult('Evaluated announcement', context, { ...evaluation, verdict }); }

test('owned GO and CONDITIONAL use saved announcement; trim remains compatible', async () => {
  for (const verdict of ['GO', 'CONDITIONAL']) {
    const h = harness(); h.state.evaluations.push(saved(verdict));
    const response = await h.request('generate', { prompt: ' Evaluated announcement ', evaluation_id: 'evaluation-a' });
    assert.equal(response.code, 200);
    assert.ok(h.state.calls[0].messages[1].content.endsWith('Evaluated announcement'));
    assert.equal(h.state.generations[0].prompt, 'Evaluated announcement');
    assert.equal(h.state.generations[0].evaluation_id, 'evaluation-a');
  }
});
test('changed, missing, foreign and disallowed evaluations never call OpenAI', async () => {
  for (const [row, prompt, id] of [[saved(), 'Different', 'evaluation-a'], [saved('NO-GO'), 'Evaluated announcement', 'evaluation-a'], [saved('UNKNOWN'), 'Evaluated announcement', 'evaluation-a'], [saved('GO', 'user-b'), 'Evaluated announcement', 'evaluation-a'], [saved(), 'Evaluated announcement', undefined]]) {
    const h = harness(); h.state.evaluations.push(row);
    assert.notEqual((await h.request('generate', { prompt, evaluation_id: id })).code, 200);
    assert.equal(h.state.calls.length, 0);
  }
});
test('admin cannot bypass NO-GO', async () => {
  const h = harness(); h.environment.ADMIN_EMAILS = 'user@example.test'; h.state.evaluations.push(saved('NO-GO'));
  assert.equal((await h.request('generate', { prompt: 'Evaluated announcement', evaluation_id: 'evaluation-a' })).code, 403);
  assert.equal(h.state.calls.length, 0);
});
test('imports authenticate every assessment field and reject unsigned legacy payloads', async () => {
  for (const mutate of [r => delete r.evaluationReceipt, r => r.announcement += ' changed', r => r.market += ' changed', r => r.partners += ' changed', r => r.funding += ' changed', r => r.importId += 'changed', r => r.evaluation.verdict = 'CONDITIONAL', r => r.evaluation.risk_score = 0, r => r.evaluationReceipt += 'x', r => r.timestamp = '2020-01-01']) {
    const h = harness(); const result = receipt(h); mutate(result);
    assert.equal((await h.request('import-demo', result)).code, 400);
    assert.equal(h.state.evaluations.length, 0);
  }
});
test('anonymous evaluation issues provenance, draft survives OAuth/IP change, import retries are idempotent', async () => {
  const h = harness();
  const assessed = await h.request('evaluate', { announcement: 'Evaluated announcement', ...context }, false);
  assert.equal(assessed.code, 200);
  const generated = await h.request('generate', { prompt: 'Evaluated announcement', demoEvaluationToken: assessed.data.demoEvaluationToken, evaluationReceipt: assessed.data.demoResult.evaluationReceipt }, false);
  assert.equal(generated.code, 200);
  const pending = { ...assessed.data.demoResult, draft: generated.data.response, draftReceipt: generated.data.draftReceipt };
  const imported = await h.request('import-demo', pending, true, '192.0.2.2');
  assert.equal(imported.code, 200);
  assert.equal((await h.request('import-demo', pending)).code, 200);
  assert.equal(h.state.evaluations.length, 1); assert.equal(h.state.generations.length, 1);
  const draft = await h.request('generate', { prompt: pending.announcement, evaluation_id: imported.data.evaluation_id });
  assert.equal(draft.code, 200);
  h.state.user = { id: 'user-b', email: 'other@example.test' };
  assert.equal((await h.request('import-demo', pending)).code, 409);
});
test('unsigned or altered imported drafts are rejected', async () => {
  for (const alter of [r => delete r.draftReceipt, r => r.draft += ' changed']) {
    const h = harness(); const result = receipt(h); result.draft = 'Legitimate draft';
    result.draftReceipt = h.load('lib/server/demoProvenance.ts').createDraftReceipt(result.evaluationReceipt, result.draft);
    alter(result); assert.equal((await h.request('import-demo', result)).code, 400);
    assert.equal(h.state.generations.length, 0);
  }
});
test('legacy or altered imported evaluations cannot authorise generation', async () => {
  for (const altered of [false, true]) {
    const h = harness(); const original = receipt(h, 'NO-GO');
    h.state.evaluations.push({ ...saved(), source: 'anonymous_demo', demo_import_id: original.importId, evaluation_json: altered ? { evaluationReceipt: original.evaluationReceipt } : {} });
    assert.equal((await h.request('generate', { prompt: original.announcement, evaluation_id: 'evaluation-a' })).code, 403);
    assert.equal(h.state.calls.length, 0);
  }
});
test('NO-GO anonymous assessment cannot generate or import a draft', async () => {
  const h = harness(); const result = receipt(h, 'NO-GO');
  const token = h.load('lib/server/demoUsage.ts').createDemoEvaluationToken(h.load('lib/server/demoUsage.ts').getDemoVisitorHash({ headers: { 'x-forwarded-for': '192.0.2.1' }, socket: {} }), result.announcement, 'NO-GO');
  assert.equal((await h.request('generate', { prompt: result.announcement, demoEvaluationToken: token, evaluationReceipt: result.evaluationReceipt }, false)).code, 403);
  assert.equal(h.state.calls.length, 0);
  assert.equal((await h.request('import-demo', result)).code, 200);
  assert.equal((await h.request('generate', { prompt: result.announcement, evaluation_id: h.state.evaluations[0].id })).code, 403);
});
test('receipt expiry blocks import but does not invalidate saved history', () => {
  const h = harness(); const provenance = h.load('lib/server/demoProvenance.ts'); const result = receipt(h);
  const crypto = require('node:crypto'); const payload = JSON.parse(Buffer.from(result.evaluationReceipt.split('.')[0], 'base64url'));
  payload.expiresAt = Date.now() - 1; const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = body + '.' + crypto.createHmac('sha256', h.environment.DEMO_USAGE_SALT).update(body).digest('base64url');
  assert.equal(provenance.verifyDemoResult(token), null);
  assert.equal(provenance.verifyDemoResult(token, false).importId, result.importId);
});

function findNode(tree, predicate) {
  if (!tree || typeof tree !== 'object') return null;
  if (predicate(tree)) return tree;
  for (const child of [tree.props?.children].flat(Infinity)) {
    const found = findNode(child, predicate); if (found) return found;
  }
  return null;
}
const button = (tree, text) => findNode(tree, node => node.props?.children === text);
test('editing the brief invalidates assessment; stale assessment cannot unlock generation', async () => {
  const h = harness(); let respond;
  h.state.fetch = () => new Promise(resolve => { respond = resolve; });
  let tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Evaluated announcement' } });
  tree = h.renderHome();
  const pending = button(tree, 'Run PR Readiness Check').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Changed announcement' } });
  respond({ ok: true, json: async () => ({ ...evaluation, id: 'evaluation-a' }) });
  await pending; tree = h.renderHome();
  assert.equal(button(tree, 'Generate Press Release').props.disabled, true);
});
test('successful assessment unlocks drafting, context edits require reassessment', async () => {
  const h = harness();
  h.state.fetch = async url => ({ ok: true, json: async () => url === '/api/evaluate' ? { ...evaluation, id: 'evaluation-a' } : { history: [] } });
  let tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Evaluated announcement' } });
  tree = h.renderHome(); await button(tree, 'Run PR Readiness Check').props.onClick();
  tree = h.renderHome(); assert.equal(button(tree, 'Generate Press Release').props.disabled, false);
  findNode(tree, node => node.type === 'input').props.onChange({ target: { value: 'Changed market' } });
  tree = h.renderHome(); assert.equal(button(tree, 'Generate Press Release').props.disabled, true);
});
test('editing while drafting ignores the old draft response', async () => {
  const h = harness(); let respond;
  h.state.fetch = async url => url === '/api/generate' ? new Promise(resolve => { respond = resolve; }) :
    ({ ok: true, json: async () => url === '/api/evaluate' ? { ...evaluation, id: 'evaluation-a' } : { history: [] } });
  let tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Evaluated announcement' } });
  tree = h.renderHome(); await button(tree, 'Run PR Readiness Check').props.onClick();
  tree = h.renderHome(); const pending = button(tree, 'Generate Press Release').props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Another announcement' } });
  respond({ ok: true, json: async () => ({ response: 'Old draft must not appear' }) });
  await pending; tree = h.renderHome();
  assert.equal(findNode(tree, node => node.type === 'pre'), null);
  assert.equal(button(tree, 'Generate Press Release').props.disabled, true);
});
test('saved history restores its own brief, verdict and draft', async () => {
  const h = harness();
  h.state.fetch = async url => ({ ok: true, json: async () => url === '/api/evaluate' ? { ...evaluation, id: 'evaluation-a' } :
    { history: [{ ...saved(), evaluation_json: evaluation, latest_generation: { output: 'Saved draft' } }] } });
  let tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: 'Evaluated announcement' } });
  tree = h.renderHome(); await button(tree, 'Run PR Readiness Check').props.onClick();
  await new Promise(resolve => setImmediate(resolve)); tree = h.renderHome();
  await findNode(tree, node => node.props?.className === 'history-item').props.onClick();
  tree = h.renderHome();
  assert.equal(findNode(tree, node => node.type === 'textarea').props.value, 'Evaluated announcement');
  assert.equal(findNode(tree, node => node.type === 'pre').props.children, 'Saved draft');
  assert.equal(button(tree, 'Generate Press Release').props.disabled, false);
});

const pendingKey = 'pr_copilot_pending_demo_result';
const jsonResponse = (data, ok = true) => ({ ok, json: async () => data });
const settle = () => new Promise(resolve => setImmediate(resolve));
function connectFrontend(h) {
  h.state.requests = [];
  h.state.fetch = async (url, options) => {
    h.state.requests.push(url);
    if (url === '/api/usage') return jsonResponse(h.state.user ? { isAdmin: !!h.state.admin, remaining_generations: 5, generation_limit: 5 } : { demo: true, remainingChecks: 2, remainingDrafts: 1 });
    if (url === '/api/history') return jsonResponse({ history: h.state.evaluations.slice() });
    const route = url === '/api/evaluate' ? 'evaluate' : 'import-demo';
    const response = await h.request(route, JSON.parse(options.body), !!h.state.user);
    return jsonResponse(response.data, response.code === 200);
  };
}
async function anonymousNoGo(h, text = 'Evaluated announcement') {
  h.state.user = null;
  h.state.modelEvaluation = { ...evaluation, verdict: 'NO-GO' };
  let tree = h.renderHome(); await h.flushEffects(); tree = h.renderHome();
  findNode(tree, node => node.type === 'textarea').props.onChange({ target: { value: text } });
  tree = h.renderHome(); await button(tree, 'Run PR Readiness Check').props.onClick();
  return h.renderHome();
}
function notice(tree) {
  return findNode(tree, node => node.props?.role === 'status' && node.props?.className?.includes('demo-save-notice'))?.props.children[0].props.children;
}

test('anonymous NO-GO assessments preserve signed provenance and only the latest result', async () => {
  const h = harness({ effectsEnabled: true }); connectFrontend(h);
  await anonymousNoGo(h, 'First NO-GO announcement');
  const first = JSON.parse(h.storageValues.get(pendingKey));
  assert.equal(first.evaluation.verdict, 'NO-GO'); assert.ok(first.evaluationReceipt);
  const tree = await anonymousNoGo(h, 'Second NO-GO announcement');
  const second = JSON.parse(h.storageValues.get(pendingKey));
  assert.equal(second.announcement, 'Second NO-GO announcement');
  assert.notEqual(second.importId, first.importId);
  assert.equal(h.storageValues.size, 1);
  assert.equal(button(tree, 'Generate Press Release').props.disabled, true);
});
for (const admin of [false, true]) {
  test(`post-authentication effect imports NO-GO, clears storage and refreshes archive${admin ? ' while Admin Mode is active' : ''}`, async () => {
    const h = harness({ effectsEnabled: true }); connectFrontend(h);
    await anonymousNoGo(h);
    const pending = JSON.parse(h.storageValues.get(pendingKey));
    const fetch = h.state.fetch; let releaseImport;
    const gate = new Promise(resolve => { releaseImport = resolve; });
    h.state.fetch = async (url, options) => { if (url === '/api/import-demo') await gate; return fetch(url, options); };
    h.state.user = { id: 'user-a', email: 'user@example.test' }; h.state.admin = admin;
    h.renderHome(); await h.flushEffects();
    let tree = h.renderHome();
    if (admin) assert.ok(findNode(tree, node => node.props?.children === 'Admin mode — Unlimited testing'));
    assert.ok(h.storageValues.has(pendingKey));
    releaseImport(); await settle(); tree = h.renderHome();
    assert.equal(h.state.evaluations.length, 1);
    assert.equal(h.state.evaluations[0].demo_import_id, pending.importId);
    assert.equal(h.state.evaluations[0].verdict, 'NO-GO');
    assert.equal(h.storageValues.has(pendingKey), false);
    assert.match(notice(tree), /saved to your account/);
    assert.ok(findNode(tree, node => node.props?.className === 'history-item'));
    assert.equal(h.state.requests.filter(url => url === '/api/history').length, 2);
    await h.flushEffects(); assert.equal(h.state.requests.filter(url => url === '/api/import-demo').length, 1);
  });
}
test('missing provenance warns instead of silently skipping anonymous preservation', async () => {
  const h = harness(); h.state.user = null;
  h.state.fetch = async () => jsonResponse({ ...evaluation, verdict: 'NO-GO' });
  const tree = await anonymousNoGo(h);
  assert.match(notice(tree), /cannot be transferred.*receipt is missing/);
  assert.equal(h.storageValues.has(pendingKey), false);
});
test('storage write failure warns and does not hide the anonymous verdict', async () => {
  const h = harness(); connectFrontend(h); h.state.storageFailure = 'write';
  const tree = await anonymousNoGo(h);
  assert.match(notice(tree), /could not save your evaluation/);
  assert.ok(findNode(tree, node => node.props?.children === 'NO-GO'));
  assert.equal(h.storageValues.has(pendingKey), false);
});
test('storage read failure on authentication displays recovery warning and skips import', async () => {
  const h = harness({ effectsEnabled: true }); connectFrontend(h);
  const original = receipt(h, 'NO-GO'); h.storageValues.set(pendingKey, JSON.stringify(original));
  h.state.storageFailure = 'read'; h.renderHome(); await h.flushEffects();
  assert.match(notice(h.renderHome()), /could not read your saved demo result/);
  assert.equal(h.state.requests.includes('/api/import-demo'), false);
  assert.equal(h.storageValues.has(pendingKey), true);
});
test('malformed or unsupported pending storage warns without deleting it', async () => {
  for (const value of ['{bad-json', JSON.stringify({ version: 99 })]) {
    const h = harness({ effectsEnabled: true }); connectFrontend(h); h.storageValues.set(pendingKey, value);
    h.renderHome(); await h.flushEffects();
    assert.match(notice(h.renderHome()), /could not read your saved demo result/);
    assert.equal(h.storageValues.get(pendingKey), value);
    assert.equal(h.state.requests.includes('/api/import-demo'), false);
  }
});
test('failed imports retain pending storage and show retry warning', async () => {
  for (const failure of ['rejected', 'network']) {
    const h = harness({ effectsEnabled: true }); connectFrontend(h);
    const original = receipt(h, 'NO-GO'); const raw = JSON.stringify(original); h.storageValues.set(pendingKey, raw);
    const fetch = h.state.fetch;
    h.state.fetch = async (url, options) => {
      if (url === '/api/import-demo') {
        if (failure === 'network') throw new Error('Network unavailable');
        return jsonResponse({ error: 'Import rejected' }, false);
      }
      return fetch(url, options);
    };
    h.renderHome(); await h.flushEffects();
    assert.equal(h.storageValues.get(pendingKey), raw);
    assert.match(notice(h.renderHome()), /could not save your demo result yet/);
    assert.equal(h.state.evaluations.length, 0);
  }
});
test('successful import refreshes history even if removing pending storage fails', async () => {
  const h = harness({ effectsEnabled: true }); connectFrontend(h);
  h.storageValues.set(pendingKey, JSON.stringify(receipt(h, 'NO-GO'))); h.state.storageFailure = 'remove';
  h.renderHome(); await h.flushEffects();
  const tree = h.renderHome();
  assert.equal(h.state.evaluations.length, 1); assert.ok(h.storageValues.has(pendingKey));
  assert.match(notice(tree), /saved to your account.*could not clear/);
  assert.ok(findNode(tree, node => node.props?.className === 'history-item'));
});
test('history failure after successful import reports saved state, not import failure', async () => {
  const h = harness({ effectsEnabled: true }); connectFrontend(h);
  h.storageValues.set(pendingKey, JSON.stringify(receipt(h, 'NO-GO')));
  const fetch = h.state.fetch;
  h.state.fetch = async (url, options) => url === '/api/history' ? jsonResponse({ error: 'Unavailable' }, false) : fetch(url, options);
  h.renderHome(); await h.flushEffects();
  assert.equal(h.storageValues.has(pendingKey), false);
  assert.equal(h.state.evaluations.length, 1);
  assert.match(notice(h.renderHome()), /was saved.*archive could not refresh/);
});
test('older history response cannot overwrite post-import archive', async () => {
  const h = harness({ effectsEnabled: true }); connectFrontend(h);
  h.storageValues.set(pendingKey, JSON.stringify(receipt(h, 'NO-GO')));
  const fetch = h.state.fetch; let finishOldHistory; let historyCount = 0;
  h.state.fetch = async (url, options) => {
    if (url === '/api/history' && ++historyCount === 1) return new Promise(resolve => { finishOldHistory = resolve; });
    return fetch(url, options);
  };
  h.renderHome(); await h.flushEffects();
  assert.ok(findNode(h.renderHome(), node => node.props?.className === 'history-item'));
  finishOldHistory(jsonResponse({ history: [] })); await settle();
  assert.ok(findNode(h.renderHome(), node => node.props?.className === 'history-item'));
});
