const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, evaluation, context, saved } = require('./secure-generation.test.cjs');
const body = { announcement: 'Evaluated announcement', ...context };

test('normal authenticated usage returns fresh evaluation balance and bounded SDK settings', async () => {
  const h = harness();
  const r = await h.request('evaluate', body);
  assert.equal(r.code, 200); assert.equal(r.data.remaining_evaluations, 4);
  assert.equal(r.data.remaining_generations, 5);
  assert.equal(h.state.globalAttempts, 1);
  assert.equal(h.state.openaiOptions.timeout, 25000); assert.equal(h.state.openaiOptions.maxRetries, 0);
  assert.equal(h.state.calls[0].model, 'gpt-4o-mini'); assert.equal(h.state.calls[0].max_completion_tokens, 2000);
  assert.equal(h.load('pages/api/evaluate.ts').config.maxDuration, 45);
  assert.equal(h.load('pages/api/generate.ts').config.maxDuration, 45);
  assert.deepEqual(h.state.rpcCalls.map(r => r.name), ['reserve_api_usage','dispatch_api_usage','complete_api_usage']);
});
test('free evaluation and generation quota cannot be exceeded', async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) assert.equal((await h.request('evaluate', body)).code, 200);
  assert.equal((await h.request('evaluate', body)).code, 403); assert.equal(h.state.calls.length, 5);
  h.state.evaluations.push(saved());
  for (let i = 0; i < 5; i++) assert.equal((await h.request('generate', { prompt: body.announcement, evaluation_id: 'evaluation-a' })).code, 200);
  assert.equal(h.state.calls.at(-1).max_completion_tokens, 1500);
  assert.equal((await h.request('generate', { prompt: body.announcement, evaluation_id: 'evaluation-a' })).code, 403);
  assert.equal(h.state.calls.length, 10);
});
test('anonymous allowance is reserved before dispatch and stays durable across repeated requests', async () => {
  const h = harness();
  assert.equal((await h.request('evaluate', body, false)).data.remainingChecks, 1);
  assert.equal((await h.request('evaluate', body, false)).data.remainingChecks, 0);
  assert.equal((await h.request('evaluate', body, false)).code, 403);
  assert.equal(h.state.calls.length, 2);
});
test('parallel requests for one actor cannot both dispatch', async () => {
  const h = harness(); let finish; h.state.modelGate = new Promise(resolve => { finish = resolve; });
  const first = h.request('evaluate', body); await new Promise(resolve => setImmediate(resolve));
  const second = await h.request('evaluate', body);
  assert.equal(second.code, 429); assert.equal(h.state.calls.length, 1);
  finish(); assert.equal((await first).code, 200);
});
test('failed and timed-out calls release user quota but retain dispatched global attempt', async () => {
  for (const name of ['APIConnectionError', 'APIConnectionTimeoutError']) {
    const h = harness(); h.state.modelError = Object.assign(new Error('Mock failure'), { name });
    assert.notEqual((await h.request('evaluate', body)).code, 200);
    const reservation = [...h.state.reservations.values()][0];
    assert.equal(reservation.state, 'released'); assert.equal(reservation.account.evals, 0);
    assert.equal(h.state.globalAttempts, 1); assert.equal(h.state.calls.length, 1);
  }
});
test('malformed, incomplete, empty and truncated model output are rejected and refunded', async () => {
  for (const fixture of [{modelContent:'bad json'}, {modelContent:'{}'}, {modelContent:' '}, {finishReason:'length'}, {modelEvaluation:{...evaluation,recommendation:{summary:'',next_actions:[]}}}]) {
    const h = harness(); Object.assign(h.state, fixture);
    assert.equal((await h.request('evaluate', body)).code, 502);
    assert.equal(h.state.evaluations.length, 0); assert.equal(h.state.globalAttempts, 1);
    assert.equal([...h.state.reservations.values()][0].state, 'released');
  }
});
test('global ceiling includes refunded failures and administrators', async () => {
  const h = harness(); h.state.dailyLimit = 2; h.environment.ADMIN_EMAILS = 'user@example.test';
  h.state.modelError = new Error('Mock provider failure');
  await h.request('evaluate', body); await h.request('evaluate', body);
  assert.equal((await h.request('evaluate', body)).code, 503);
  assert.equal(h.state.calls.length, 2); assert.equal(h.state.globalAttempts, 2);
});
test('admin bypasses lifetime quotas but still goes through reservation and dispatch', async () => {
  const h = harness(); h.environment.ADMIN_EMAILS = 'user@example.test';
  for (let i=0;i<6;i++) assert.equal((await h.request('evaluate', body)).code, 200);
  assert.equal(h.state.calls.length, 6); assert.equal(h.state.globalAttempts, 6);
});
test('deployment scope validates Vercel environment and fails before paid calls', async () => {
  const cases = [
    [{}, 'development'],
    [{NODE_ENV:'development', VERCEL_ENV:'development'}, 'development'],
    [{NODE_ENV:'production'}, null],
    [{VERCEL:'1'}, null],
    [{VERCEL:'1', NODE_ENV:'production'}, null],
    [{VERCEL_ENV:'invalid'}, null],
    [{NODE_ENV:'production', VERCEL_ENV:'development'}, null],
    [{VERCEL:'1', VERCEL_ENV:'invalid'}, null],
    [{VERCEL_ENV:'production'}, null],
    [{VERCEL_ENV:'preview'}, null],
    ...['production','preview','development'].map(scope => [{VERCEL:'1', VERCEL_ENV:scope, NODE_ENV:'production'}, scope]),
  ];
  for (const [env, expected] of cases) {
    const h = harness(); Object.assign(h.environment, env);
    if (expected) assert.equal(h.load('lib/server/apiUsage.ts').usageScope(), expected);
    else {
      assert.throws(() => h.load('lib/server/apiUsage.ts').usageScope(), /Invalid usage environment/);
      assert.equal((await h.request('evaluate', body)).code, 503);
      assert.equal(h.state.calls.length, 0);
    }
  }
});
test('application cannot supply a higher database daily ceiling', async () => {
  const h = harness(); h.state.dailyLimit = 1;
  h.environment.OPENAI_DAILY_ATTEMPT_LIMIT = '999999';
  assert.equal((await h.request('evaluate', body)).code, 200);
  assert.equal((await h.request('evaluate', body)).code, 503);
  assert.equal(h.state.calls.length, 1);
  const dispatch = h.state.rpcCalls.find(r => r.name === 'dispatch_api_usage');
  assert.deepEqual(Object.keys(dispatch.args), ['p_request_id']);
});
test('reservation failure cannot call OpenAI', async () => {
  const h = harness(); h.state.rpcError = 'reserve_api_usage';
  assert.equal((await h.request('evaluate', body)).code, 503); assert.equal(h.state.calls.length, 0);
});
test('failed finalization never reports success or refunds the global attempt', async () => {
  const h = harness(); h.state.rpcError = 'complete_api_usage';
  assert.equal((await h.request('evaluate', body)).code, 503);
  assert.equal(h.state.evaluations.length, 0); assert.equal(h.state.globalAttempts, 1);
  assert.equal([...h.state.reservations.values()][0].state, 'released');
});
test('failure before dispatch does not consume a paid attempt; failed release stays reserved for expiry', async () => {
  const h = harness(); h.state.rpcError = 'dispatch_api_usage';
  assert.equal((await h.request('evaluate', body)).code, 503);
  assert.equal(h.state.globalAttempts || 0, 0); assert.equal(h.state.calls.length, 0);
  const h2 = harness(); h2.state.modelError = new Error('Provider failure'); h2.state.rpcError = 'release_api_usage';
  assert.notEqual((await h2.request('evaluate', body)).code, 200);
  assert.equal([...h2.state.reservations.values()][0].state, 'dispatched'); assert.equal(h2.state.globalAttempts, 1);
});
test('prompt size bounds and Vercel IP handling fail closed', () => {
  const h = harness(); const helpers = h.load('lib/server/apiUsage.ts');
  assert.throws(() => helpers.validatePromptSize('x'.repeat(64001), ''), /too long/);
  h.environment.VERCEL = '1'; const visitor = h.load('lib/server/demoUsage.ts');
  assert.throws(() => visitor.getVisitorIp({headers:{'x-real-ip':'192.0.2.1'},socket:{remoteAddress:'192.0.2.2'}}), /identify/);
});
test('usage endpoint reads durable balances for accounts, demos and admins', async () => {
  const h = harness(); await h.request('evaluate', body);
  assert.equal((await h.request('usage')).data.remaining_evaluations, 4);
  h.environment.ADMIN_EMAILS = 'user@example.test';
  const admin = await h.request('usage'); assert.equal(admin.data.remaining_evaluations, -1); assert.equal(admin.data.isAdmin, true);
  assert.equal((await h.request('usage', undefined, false)).data.remainingChecks, 2);
  h.state.rpcError = 'get_api_usage'; assert.equal((await h.request('usage')).code, 503);
});
test('bounded numeric model values still clamp without flattening the evaluation', async () => {
  const h = harness(); h.state.modelEvaluation = { ...evaluation, risk_score: 999, risk_breakdown: { ...evaluation.risk_breakdown, impact_vs_activity: 100 } };
  const r = await h.request('evaluate', body); assert.equal(r.code, 200);
  assert.equal(r.data.risk_score, 100); assert.equal(r.data.risk_breakdown.impact_vs_activity, 15);
  assert.ok(r.data.recommendation); assert.ok(r.data.journalist_reaction);
});
test('workspace shows authoritative evaluation balance and disables exhausted free checks', async () => {
  const h = harness({ effectsEnabled: true });
  h.state.fetch = async (url, options) => {
    if (url === '/api/history') return { ok: true, json: async () => ({ history: [] }) };
    const route = url === '/api/usage' ? 'usage' : 'evaluate';
    const r = await h.request(route, options?.body ? JSON.parse(options.body) : undefined);
    return { ok: r.code === 200, json: async () => r.data };
  };
  const find = (tree, predicate) => {
    if (!tree || typeof tree !== 'object') return null;
    if (predicate(tree)) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
    return null;
  };
  h.renderHome(); await h.flushEffects(); let tree = h.renderHome();
  assert.ok(find(tree, node => node.props?.children === '5 of 5 free checks remaining'));
  find(tree, node => node.type === 'textarea').props.onChange({ target: { value: body.announcement } });
  tree = h.renderHome(); await find(tree, node => node.props?.children === 'Run PR Readiness Check').props.onClick();
  tree = h.renderHome(); assert.ok(find(tree, node => node.props?.children === '4 of 5 free checks remaining'));
  for(let i=0;i<4;i++) await h.request('evaluate', body);
  h.state.user = { ...h.state.user }; h.renderHome(); await h.flushEffects(); tree = h.renderHome();
  assert.ok(find(tree, node => node.props?.children === '0 of 5 free checks remaining'));
  assert.equal(find(tree, node => node.props?.children === 'Run PR Readiness Check').props.disabled, true);
});
