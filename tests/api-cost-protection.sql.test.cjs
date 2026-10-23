const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { randomUUID, randomBytes } = require('node:crypto');
const execute = promisify(execFile);
let bin;
try { bin = process.env.TEST_POSTGRES_BIN || path.dirname(fs.realpathSync(execFileSync('which', ['initdb'], {encoding:'utf8'}).trim())); } catch {}
if ((!bin || !fs.existsSync(path.join(bin,'postgres'))) && fs.existsSync('/opt/homebrew/opt/postgresql@15/bin/postgres')) bin = '/opt/homebrew/opt/postgresql@15/bin';
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const ip = () => randomBytes(32).toString('hex');

test('isolated PostgreSQL migration, permissions and concurrency', { skip: !bin || !fs.existsSync(path.join(bin,'postgres')), timeout: 90000 }, async t => {
  // This suite creates its own cluster and uses a Unix socket only. It NEVER reads
  // DATABASE_URL, production credentials, or an existing PostgreSQL cluster.
  const dir = fs.mkdtempSync('/private/tmp/prcp-');
  const data = path.join(dir,'data'); let started = false;
  const args = ['-X','-h',dir,'-p','55439','-U',os.userInfo().username,'-d','postgres','-v','ON_ERROR_STOP=1','-At'];
  const sql = statement => execFileSync(path.join(bin,'psql'), [...args,'-c',statement], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const parallelSql = async statement => (await execute(path.join(bin,'psql'), [...args,'-c',statement], {encoding:'utf8'})).stdout.trim();
  const json = statement => JSON.parse(sql(statement));
  const scope = 'production';
  function reserve(user, operation='evaluate', request=randomUUID(), hash=ip(), demo=null, admin=false) {
    return { id:request, statement:`select public.reserve_api_usage(${q(scope)},${user ? q(user)+'::uuid' : 'null'},${demo ? q(demo) : 'null'},${admin},${q(operation)},${q(request)}::uuid,${q(hash)})` };
  }
  const dispatch = id => json(`select public.dispatch_api_usage(${q(id)})`);
  const setLimit = limit => sql(`update public.api_usage_config set daily_attempt_limit=${limit} where singleton`);
  const release = id => sql(`select public.release_api_usage(${q(id)})`);
  const usage = (user,demo=null,admin=false) => json(`select public.get_api_usage('production',${user ? q(user)+'::uuid' : 'null'},${demo ? q(demo) : 'null'},${admin})`);
  const result = {announcement:'A verified announcement', market:'Technology',partners:'A named customer',funding:'Bootstrapped',verdict:'GO',risk_score:12,evaluation_json:{recommendation:{summary:'Proceed with PR.',next_actions:[]}}};
  const complete = (id, payload=result) => json(`select public.complete_api_usage(${q(id)},${q(JSON.stringify(payload))}::jsonb,false)`);
  const globalCount = () => Number(sql("select coalesce(sum(used),0) from public.api_usage_buckets where kind='global'"));
  try {
    execFileSync(path.join(bin,'initdb'), ['-D',data,'--auth=trust','--no-locale','--encoding=UTF8'], {stdio:'pipe'});
    execFileSync(path.join(bin,'pg_ctl'), ['-D',data,'-l',path.join(dir,'server.log'),'-o',`-c listen_addresses='' -k ${dir} -p 55439`,'-w','start'], {stdio:'pipe'}); started = true;
    sql(`create role anon; create role authenticated; create role service_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create table public.evaluations(id uuid primary key,created_at timestamptz,user_id uuid,announcement text not null,market text,partners text,funding text,verdict text,risk_score integer,evaluation_json jsonb);
      create table public.generations(id uuid primary key,created_at timestamptz,evaluation_id uuid references public.evaluations(id) on delete set null,user_id uuid,prompt text not null,output text,model text);
      alter table public.evaluations enable row level security; alter table public.generations enable row level security;
      grant all on public.evaluations,public.generations to anon,authenticated,service_role;`);
    for (const file of fs.readdirSync('supabase/migrations').sort()) {
      execFileSync(path.join(bin,'psql'), [...args,'-f',path.resolve('supabase/migrations',file)], {stdio:'pipe'});
    }
    await t.test('migration revokes browser SELECT/INSERT/TRUNCATE and privileged RPCs', () => {
      for (const role of ['anon','authenticated']) {
        for (const table of ['evaluations','generations','demo_usage','api_usage_accounts','api_usage_reservations','api_usage_buckets','api_usage_config']) {
          for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) assert.equal(sql(`select has_table_privilege(${q(role)},${q('public.'+table)},${q(privilege)})`),'f');
        }
        assert.throws(() => sql(`set role ${role}; select public.get_api_usage('production',${q(randomUUID())},null,false)`));
        assert.throws(() => sql(`set role ${role}; truncate public.evaluations`));
      }
      assert.equal(sql("select count(*) from pg_class where relnamespace='public'::regnamespace and relname like 'api_usage_%' and relkind='r' and relrowsecurity"),'4');
      const output=sql(`set role service_role; select public.get_api_usage('production',${q(randomUUID())},null,false)`);
      assert.ok(output.includes('remaining_evaluations'));
    });
    await t.test('default Supabase grants cannot expose helpers or safety configuration', () => {
      assert.equal(sql('select daily_attempt_limit from public.api_usage_config'), '200');
      for (const role of ['anon','authenticated','service_role']) {
        for (const signature of ['api_usage_account(text,uuid,text)', 'api_usage_snapshot(public.api_usage_accounts,boolean)']) {
          assert.equal(sql(`select has_function_privilege(${q(role)},${q('public.'+signature)},'EXECUTE')`),'f');
        }
        assert.throws(()=>sql(`set role ${role}; update public.api_usage_config set daily_attempt_limit=999999`));
        assert.throws(()=>sql(`set role ${role}; truncate public.api_usage_config`));
        assert.throws(()=>sql(`set role ${role}; select * from public.api_usage_config`));
      }
      for (const signature of ['get_api_usage(text,uuid,text,boolean)', 'reserve_api_usage(text,uuid,text,boolean,text,uuid,text)', 'dispatch_api_usage(uuid)', 'release_api_usage(uuid)', 'complete_api_usage(uuid,jsonb,boolean)', 'import_demo_draft(text,uuid,uuid,text,timestamptz)']) {
        assert.equal(sql(`select has_function_privilege('service_role',${q('public.'+signature)},'EXECUTE')`),'t');
        for(const role of ['anon','authenticated']) assert.equal(sql(`select has_function_privilege(${q(role)},${q('public.'+signature)},'EXECUTE')`),'f');
      }
      setLimit(201); assert.equal(sql('select daily_attempt_limit from public.api_usage_config'),'201');setLimit(200);
    });
    await t.test('existing evaluations do not consume beta quota; all historical drafts still count', () => {
      const user=randomUUID();
      for(let i=0;i<8;i++) sql(`insert into public.evaluations(id,user_id,announcement) values(${q(randomUUID())},${q(user)},'Historical evaluation')`);
      for(let i=0;i<3;i++) sql(`insert into public.generations(id,user_id,prompt,model) values(${q(randomUUID())},${q(user)},'Historical draft',${q(i===0?'anonymous_demo_import':'gpt-4o-mini')})`);
      const a=usage(user); assert.equal(a.remaining_evaluations,5); assert.equal(a.remaining_generations,2);
      const demo=ip(); sql(`insert into public.demo_usage(ip_hash,readiness_checks_used,drafts_used) values(${q(demo)},2,1)`);
      assert.equal(usage(null,demo).remaining_evaluations,0); assert.equal(usage(null,demo).remaining_generations,0);
      const preview=json(`select public.get_api_usage('preview',${q(user)},null,false)`); assert.equal(preview.remaining_generations,5);
    });
    await t.test('independent database connections race for one remaining evaluation', async () => {
      const user=randomUUID(); usage(user);
      sql(`update public.api_usage_accounts set evaluations_used=4 where actor=${q('user:'+user)}`);
      const attempts=Array.from({length:12},()=>reserve(user));
      const responses=await Promise.all(attempts.map(r=>parallelSql(r.statement).then(JSON.parse)));
      assert.equal(responses.filter(r=>r.allowed).length,1);
      const winner=attempts[responses.findIndex(r=>r.allowed)]; assert.equal(dispatch(winner.id).allowed,true);
      const saved=complete(winner.id); assert.equal(saved.remaining_evaluations,0);
      assert.equal(json(reserve(user).statement).allowed,false);
    });
    await t.test('independent connections compete for the last authenticated draft', async () => {
      const user=randomUUID(),evaluation=randomUUID();
      sql(`insert into public.evaluations(id,user_id,announcement,verdict) values(${q(evaluation)},${q(user)},'Canonical brief','GO')`);
      usage(user);sql(`update public.api_usage_accounts set drafts_used=4 where actor=${q('user:'+user)}`);
      const requests=Array.from({length:8},()=>reserve(user,'generate'));
      const responses=await Promise.all(requests.map(r=>parallelSql(r.statement).then(JSON.parse)));
      assert.equal(responses.filter(r=>r.allowed).length,1);
      const winner=requests[responses.findIndex(r=>r.allowed)];dispatch(winner.id);
      assert.equal(complete(winner.id,{evaluation_id:evaluation,prompt:'Canonical brief',output:'Draft'}).remaining_generations,0);
      assert.equal(json(reserve(user,'generate').statement).allowed,false);
    });
    await t.test('anonymous last allowance cannot be raced or exceeded', async () => {
      const demo=ip(); usage(null,demo); sql(`update public.api_usage_accounts set evaluations_used=1 where actor=${q('demo:'+demo)}`);
      const requests=Array.from({length:8},()=>reserve(null,'evaluate',randomUUID(),demo,demo));
      const responses=await Promise.all(requests.map(r=>parallelSql(r.statement).then(JSON.parse)));
      assert.equal(responses.filter(r=>r.allowed).length,1);
      const winner=requests[responses.findIndex(r=>r.allowed)]; dispatch(winner.id); complete(winner.id,{});
      assert.equal(usage(null,demo).remaining_evaluations,0);
    });
    await t.test('duplicate finalization/release is idempotent and double dispatch is denied', async () => {
      const user=randomUUID(),r=reserve(user); assert.equal(json(r.statement).allowed,true);
      const responses=await Promise.all([parallelSql(`select public.dispatch_api_usage(${q(r.id)})`),parallelSql(`select public.dispatch_api_usage(${q(r.id)})`)]);
      assert.equal(responses.map(JSON.parse).filter(r=>r.allowed).length,1);
      const first=complete(r.id),second=complete(r.id); release(r.id); release(r.id);
      assert.equal(first.result_id,second.result_id); assert.equal(usage(user).evaluations_used,1);
      assert.equal(sql(`select count(*) from public.evaluations where user_id=${q(user)}`),'1');
    });
    await t.test('pre-dispatch release costs nothing; dispatched failure never refunds global attempts', () => {
      const before=globalCount(); const user=randomUUID(); const r=reserve(user); json(r.statement);release(r.id);release(r.id);
      assert.equal(globalCount(),before); assert.equal(usage(user).remaining_evaluations,5);
      const r2=reserve(user); json(r2.statement);dispatch(r2.id);release(r2.id);release(r2.id);
      assert.equal(globalCount(),before+1); assert.equal(usage(user).remaining_evaluations,5);
    });
    await t.test('interrupted/expired requests release user allowance, retain cost and reject late completion', () => {
      for(const dispatched of [false,true]) {
        const user=randomUUID(),r=reserve(user),before=globalCount();json(r.statement);if(dispatched)dispatch(r.id);
        sql(`update public.api_usage_reservations set expires_at=clock_timestamp()-interval '1 second' where id=${q(r.id)}`);
        assert.equal(usage(user).remaining_evaluations,5);
        assert.equal(sql(`select state from public.api_usage_reservations where id=${q(r.id)}`),'expired');
        assert.throws(()=>complete(r.id)); assert.equal(globalCount(),before+(dispatched?1:0));
        const next=reserve(user);assert.equal(json(next.statement).allowed,true);release(next.id);
      }
    });
    await t.test('concurrent anonymous, free and admin actors cannot exceed the database ceiling', async () => {
      const before=globalCount(),limit=before+1;setLimit(limit);
      const requests=Array.from({length:12},(_,i)=> {
        const hash=ip();
        return reserve(i%3===0 ? null : randomUUID(),'evaluate',randomUUID(),hash,i%3===0 ? hash : null,i%3===2);
      });
      requests.forEach(r=>assert.equal(json(r.statement).allowed,true));
      const responses=await Promise.all(requests.map(r=>parallelSql(`select public.dispatch_api_usage(${q(r.id)})`).then(JSON.parse)));
      assert.equal(responses.filter(r=>r.allowed).length,1);requests.forEach(r=>release(r.id));assert.equal(globalCount(),limit);
      const next=reserve(randomUUID());json(next.statement);assert.equal(dispatch(next.id).allowed,false);
      const raised=reserve(randomUUID());json(raised.statement);assert.throws(()=>sql(`set role service_role; select public.dispatch_api_usage(${q(raised.id)},999999)`));
      assert.equal(dispatch(raised.id).allowed,false);release(raised.id);
      setLimit(200);
    });
    await t.test('daily safety ceiling is shared across production and preview scopes', () => {
      const before=globalCount(),r=reserve(randomUUID());json(r.statement);setLimit(before+1);dispatch(r.id);release(r.id);
      const id=randomUUID();
      assert.equal(json(`select public.reserve_api_usage('preview',${q(randomUUID())},null,true,'evaluate',${q(id)},${q(ip())})`).allowed,true);
      assert.equal(dispatch(id).allowed,false);
      assert.equal(globalCount(),before+1);setLimit(200);
    });
    await t.test('admins have no lifetime quota but retain shared account and IP throttles', () => {
      const user=randomUUID(),hash=ip();usage(user);
      sql(`update public.api_usage_accounts set evaluations_used=100,drafts_used=100 where actor=${q('user:'+user)}`);
      assert.equal(usage(user,null,true).remaining_evaluations,-1);
      for(let i=0;i<10;i++) {const r=reserve(user,'evaluate',randomUUID(),hash,null,true);assert.equal(json(r.statement).allowed,true);release(r.id);}
      assert.equal(json(reserve(user,'evaluate',randomUUID(),hash,null,true).statement).status,429);
      const network=ip();
      for(let i=0;i<30;i++){const r=reserve(randomUUID(),'evaluate',randomUUID(),network);assert.equal(json(r.statement).allowed,true);release(r.id);}
      assert.equal(json(reserve(randomUUID(),'evaluate',randomUUID(),network).statement).status,429);
    });
    await t.test('imported-draft debit is atomic, idempotent and does not count as OpenAI', async () => {
      const user=randomUUID(),evaluation=randomUUID(),before=globalCount();
      sql(`insert into public.evaluations(id,user_id,announcement,source,verdict) values(${q(evaluation)},${q(user)},'Imported announcement','anonymous_demo','GO')`);
      const statement=`select public.import_demo_draft('production',${q(user)},${q(evaluation)},'Verified draft',clock_timestamp())`;
      await Promise.all(Array.from({length:8},()=>parallelSql(statement)));
      assert.equal(sql(`select count(*) from public.generations where evaluation_id=${q(evaluation)}`),'1');
      assert.equal(usage(user).remaining_generations,4);assert.equal(globalCount(),before);
      assert.equal(usage(user).remaining_evaluations,5);
    });
    await t.test('persistence failure rolls back usage and output, retaining dispatched attempt', () => {
      const user=randomUUID(),r=reserve(user),before=globalCount();json(r.statement);dispatch(r.id);
      assert.throws(()=>complete(r.id,{...result,announcement:''}));
      assert.equal(sql(`select count(*) from public.evaluations where user_id=${q(user)}`),'0');
      assert.equal(sql(`select state from public.api_usage_reservations where id=${q(r.id)}`),'dispatched');
      release(r.id);assert.equal(usage(user).remaining_evaluations,5);assert.equal(globalCount(),before+1);
    });
    await t.test('draft finalization preserves ownership, allowed verdict and canonical announcement', () => {
      const user=randomUUID(),e=randomUUID();sql(`insert into public.evaluations(id,user_id,announcement,verdict) values(${q(e)},${q(user)},'Canonical brief','NO-GO')`);
      const r=reserve(user,'generate');json(r.statement);dispatch(r.id);
      assert.throws(()=>complete(r.id,{evaluation_id:e,prompt:'Canonical brief',output:'Draft'}));
      sql(`update public.evaluations set verdict='GO' where id=${q(e)}`);
      assert.throws(()=>complete(r.id,{evaluation_id:e,prompt:'Different brief',output:'Draft'}));
      const saved=complete(r.id,{evaluation_id:e,prompt:'Canonical brief',output:'Draft'});assert.equal(saved.remaining_generations,4);
      assert.equal(sql(`select prompt from public.generations where id=${q(saved.result_id)}`),'Canonical brief');
    });
  } finally {
    if(started) execFileSync(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop'],{stdio:'pipe'});
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
