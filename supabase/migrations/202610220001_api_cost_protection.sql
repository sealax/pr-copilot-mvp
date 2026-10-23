-- Additive accounting. Authenticated evaluations start at zero; existing drafts
-- and anonymous counters are seeded lazily under a per-account lock.
begin;

create table public.api_usage_accounts (
  scope text not null check (scope in ('production', 'preview', 'development')),
  actor text not null,
  user_id uuid,
  evaluations_used bigint not null default 0 check (evaluations_used >= 0),
  drafts_used bigint not null default 0 check (drafts_used >= 0),
  minute_start timestamptz not null default '-infinity',
  evaluation_attempts integer not null default 0,
  draft_attempts integer not null default 0,
  primary key (scope, actor)
);
create table public.api_usage_reservations (
  id uuid primary key,
  scope text not null,
  actor text not null,
  operation text not null check (operation in ('evaluate', 'generate')),
  state text not null default 'reserved' check (state in ('reserved', 'dispatched', 'succeeded', 'released', 'expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '90 seconds',
  dispatched_at timestamptz,
  result_id uuid,
  foreign key (scope, actor) references public.api_usage_accounts(scope, actor)
);
create unique index api_usage_one_active on public.api_usage_reservations(scope, actor)
  where state in ('reserved', 'dispatched');
create table public.api_usage_buckets (
  scope text not null,
  kind text not null check (kind in ('ip', 'global')),
  bucket_key text not null,
  window_start timestamptz not null,
  used bigint not null default 0 check (used >= 0),
  primary key (scope, kind, bucket_key, window_start)
);

-- Only the migration owner can change this singleton safety configuration.
-- Application/service-role requests cannot raise the shared ceiling.
create table public.api_usage_config (
  singleton boolean primary key default true check (singleton),
  daily_attempt_limit integer not null check (daily_attempt_limit > 0)
);
insert into public.api_usage_config values (true, 200);
alter table public.api_usage_config enable row level security;
revoke all on table public.api_usage_config from public,anon,authenticated,service_role;

alter table public.api_usage_accounts enable row level security;
alter table public.api_usage_reservations enable row level security;
alter table public.api_usage_buckets enable row level security;

-- Internal helper: lock order is always account, reservation, then shared bucket.
create function public.api_usage_account(p_scope text, p_user_id uuid, p_demo_hash text)
returns public.api_usage_accounts language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare a public.api_usage_accounts; actor_key text; checks bigint := 0; drafts bigint := 0;
begin
  if p_scope not in ('production','preview','development') or p_scope is null or
    (p_user_id is null) = (p_demo_hash is null) then raise exception 'Invalid usage identity'; end if;
  if p_demo_hash is not null and p_demo_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid demo identity'; end if;
  actor_key := case when p_user_id is not null then 'user:' || p_user_id::text else 'demo:' || p_demo_hash end;
  -- Non-production accounting never consumes or seeds production demo allowance.
  if p_scope = 'production' and not exists(select 1 from public.api_usage_accounts where scope=p_scope and actor=actor_key) then
    if p_user_id is not null then
      select count(*) into drafts from public.generations where user_id = p_user_id;
    else
      select readiness_checks_used, drafts_used into checks, drafts from public.demo_usage where ip_hash = p_demo_hash;
    end if;
  end if;
  insert into public.api_usage_accounts(scope, actor, user_id, evaluations_used, drafts_used)
    values (p_scope, actor_key, p_user_id, coalesce(checks,0), coalesce(drafts,0)) on conflict do nothing;
  select * into strict a from public.api_usage_accounts where scope = p_scope and actor = actor_key for update;
  update public.api_usage_reservations set state = 'expired'
    where scope = p_scope and actor = actor_key and state in ('reserved','dispatched') and expires_at <= clock_timestamp();
  return a;
end $$;

create function public.api_usage_snapshot(a public.api_usage_accounts, p_admin boolean)
returns jsonb language sql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
  select jsonb_build_object(
    'evaluations_used', a.evaluations_used,
    'generations_used', a.drafts_used,
    'evaluation_limit', case when p_admin then -1 when a.user_id is null then 2 else 5 end,
    'generation_limit', case when p_admin then -1 when a.user_id is null then 1 else 5 end,
    'remaining_evaluations', case when p_admin then -1 else greatest(0,
      (case when a.user_id is null then 2 else 5 end) - a.evaluations_used -
      (select count(*) from public.api_usage_reservations where scope=a.scope and actor=a.actor and operation='evaluate' and state in ('reserved','dispatched'))) end,
    'remaining_generations', case when p_admin then -1 else greatest(0,
      (case when a.user_id is null then 1 else 5 end) - a.drafts_used -
      (select count(*) from public.api_usage_reservations where scope=a.scope and actor=a.actor and operation='generate' and state in ('reserved','dispatched'))) end
  );
$$;

create function public.get_api_usage(p_scope text, p_user_id uuid, p_demo_hash text, p_admin boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare a public.api_usage_accounts;
begin
  a := public.api_usage_account(p_scope,p_user_id,p_demo_hash);
  return public.api_usage_snapshot(a, p_admin and p_user_id is not null);
end $$;

create function public.reserve_api_usage(p_scope text, p_user_id uuid, p_demo_hash text, p_admin boolean,
  p_operation text, p_request_id uuid, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare a public.api_usage_accounts; current_minute timestamptz := date_trunc('minute',clock_timestamp()); ip_used bigint;
  r public.api_usage_reservations; snapshot jsonb;
begin
  if p_operation not in ('evaluate','generate') or p_operation is null or p_request_id is null or
    p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid reservation'; end if;
  a := public.api_usage_account(p_scope,p_user_id,p_demo_hash);
  snapshot := public.api_usage_snapshot(a, p_admin and p_user_id is not null);
  select * into r from public.api_usage_reservations where id=p_request_id;
  if found then
    if r.scope <> p_scope or r.actor <> a.actor or r.operation <> p_operation then raise exception 'Reservation identity mismatch'; end if;
    return snapshot || jsonb_build_object('allowed',r.state='reserved','reservation_id',r.id,'status',409,'error','Request already processed');
  end if;
  if exists(select 1 from public.api_usage_reservations where scope=p_scope and actor=a.actor and state in ('reserved','dispatched')) then
    return snapshot || '{"allowed":false,"status":429,"error":"Another AI request is in progress. Try again shortly."}'::jsonb;
  end if;
  if not (p_admin and p_user_id is not null) and
    (snapshot->>case when p_operation='evaluate' then 'remaining_evaluations' else 'remaining_generations' end)::bigint <= 0 then
    return snapshot || '{"allowed":false,"status":403,"error":"Free usage allowance exhausted"}'::jsonb;
  end if;
  if a.minute_start <> current_minute then
    a.minute_start := current_minute; a.evaluation_attempts := 0; a.draft_attempts := 0;
  end if;
  if (p_operation='evaluate' and a.evaluation_attempts>=10) or (p_operation='generate' and a.draft_attempts>=5) then
    return snapshot || '{"allowed":false,"status":429,"error":"Too many requests. Try again next minute."}'::jsonb;
  end if;
  insert into public.api_usage_buckets values(p_scope,'ip',p_ip_hash,current_minute,0) on conflict do nothing;
  select used into ip_used from public.api_usage_buckets where scope=p_scope and kind='ip' and bucket_key=p_ip_hash and window_start=current_minute for update;
  if ip_used>=30 then return snapshot || '{"allowed":false,"status":429,"error":"Too many requests from this network. Try again next minute."}'::jsonb; end if;
  update public.api_usage_buckets set used=used+1 where scope=p_scope and kind='ip' and bucket_key=p_ip_hash and window_start=current_minute;
  update public.api_usage_accounts set minute_start=current_minute,
    evaluation_attempts=a.evaluation_attempts + case when p_operation='evaluate' then 1 else 0 end,
    draft_attempts=a.draft_attempts + case when p_operation='generate' then 1 else 0 end
    where scope=p_scope and actor=a.actor;
  insert into public.api_usage_reservations(id,scope,actor,operation) values(p_request_id,p_scope,a.actor,p_operation);
  return public.api_usage_snapshot(a,p_admin and p_user_id is not null) || jsonb_build_object('allowed',true,'reservation_id',p_request_id);
end $$;

-- Count an attempt BEFORE contacting OpenAI. No post-dispatch path refunds it.
-- Using dispatch time (not reservation time) also handles UTC midnight correctly.
-- The shared bucket covers ALL scopes using this database, including previews.
create function public.dispatch_api_usage(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare r public.api_usage_reservations; attempts bigint; daily_limit integer; today timestamptz := date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
  select daily_attempt_limit into strict daily_limit from public.api_usage_config where singleton for share;
  select * into strict r from public.api_usage_reservations where id=p_request_id;
  perform 1 from public.api_usage_accounts where scope=r.scope and actor=r.actor for update;
  select * into strict r from public.api_usage_reservations where id=p_request_id for update;
  if r.state<>'reserved' then return '{"allowed":false,"status":409,"error":"Request already dispatched or finished"}'::jsonb; end if;
  if r.expires_at<=clock_timestamp() then
    update public.api_usage_reservations set state='expired' where id=r.id;
    return '{"allowed":false,"status":409,"error":"Request reservation expired"}'::jsonb;
  end if;
  insert into public.api_usage_buckets values('shared','global','openai',today,0) on conflict do nothing;
  select used into attempts from public.api_usage_buckets where scope='shared' and kind='global' and bucket_key='openai' and window_start=today for update;
  if attempts>=daily_limit then
    update public.api_usage_reservations set state='released' where id=r.id;
    return '{"allowed":false,"status":503,"error":"Daily AI safety limit reached. Please try again tomorrow."}'::jsonb;
  end if;
  update public.api_usage_buckets set used=used+1 where scope='shared' and kind='global' and bucket_key='openai' and window_start=today;
  update public.api_usage_reservations set state='dispatched',dispatched_at=clock_timestamp() where id=r.id;
  return '{"allowed":true}'::jsonb;
end $$;

create function public.release_api_usage(p_request_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare r public.api_usage_reservations;
begin
  select * into r from public.api_usage_reservations where id=p_request_id;
  if not found then return; end if;
  perform 1 from public.api_usage_accounts where scope=r.scope and actor=r.actor for update;
  update public.api_usage_reservations set state='released' where id=r.id and state in ('reserved','dispatched');
end $$;

-- Persist authenticated output and charge committed usage in the SAME transaction.
create function public.complete_api_usage(p_request_id uuid, p_result jsonb, p_admin boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare r public.api_usage_reservations; a public.api_usage_accounts; v_result_id uuid; e public.evaluations;
begin
  select * into strict r from public.api_usage_reservations where id=p_request_id;
  select * into strict a from public.api_usage_accounts where scope=r.scope and actor=r.actor for update;
  select * into strict r from public.api_usage_reservations where id=p_request_id for update;
  if r.state='succeeded' then return public.api_usage_snapshot(a,p_admin and a.user_id is not null) || jsonb_build_object('result_id',r.result_id); end if;
  if r.state<>'dispatched' or r.expires_at<=clock_timestamp() then raise exception 'Reservation is not active'; end if;
  if a.user_id is not null then
    v_result_id := gen_random_uuid();
    if r.operation='evaluate' then
      if p_result->>'verdict' is null or p_result->>'verdict' not in ('GO','CONDITIONAL','NO-GO') or nullif(btrim(p_result->>'announcement'),'') is null then raise exception 'Invalid evaluation'; end if;
      insert into public.evaluations(id,created_at,user_id,announcement,market,partners,funding,verdict,risk_score,evaluation_json,source)
        values(v_result_id,clock_timestamp(),a.user_id,p_result->>'announcement',p_result->>'market',p_result->>'partners',p_result->>'funding',p_result->>'verdict',(p_result->>'risk_score')::integer,p_result->'evaluation_json','authenticated');
    else
      select * into e from public.evaluations where id=(p_result->>'evaluation_id')::uuid and user_id=a.user_id;
      if not found or e.verdict is null or e.verdict not in ('GO','CONDITIONAL') or e.announcement is distinct from p_result->>'prompt' or nullif(btrim(p_result->>'output'),'') is null then raise exception 'Invalid draft evaluation'; end if;
      insert into public.generations(id,created_at,user_id,evaluation_id,prompt,output,model)
        values(v_result_id,clock_timestamp(),a.user_id,e.id,e.announcement,p_result->>'output','gpt-4o-mini');
    end if;
  end if;
  update public.api_usage_reservations set state='succeeded',result_id=v_result_id where id=r.id;
  update public.api_usage_accounts set evaluations_used=evaluations_used+case when r.operation='evaluate' then 1 else 0 end,
    drafts_used=drafts_used+case when r.operation='generate' then 1 else 0 end where scope=a.scope and actor=a.actor returning * into a;
  return public.api_usage_snapshot(a,p_admin and a.user_id is not null) || jsonb_build_object('result_id',v_result_id);
end $$;

-- Imported drafts still count toward the existing five-draft product allowance,
-- but do not consume a global OpenAI attempt. The account lock serializes imports
-- with reservations; retries cannot duplicate the imported draft or its debit.
create function public.import_demo_draft(p_scope text, p_user_id uuid, p_evaluation_id uuid, p_draft text, p_created_at timestamptz)
returns void language plpgsql security definer set search_path = pg_catalog, public set lock_timeout = '3s' as $$
declare a public.api_usage_accounts; e public.evaluations;
begin
  if p_user_id is null or nullif(btrim(p_draft),'') is null then raise exception 'Invalid imported draft'; end if;
  a := public.api_usage_account(p_scope,p_user_id,null);
  select * into e from public.evaluations where id=p_evaluation_id and user_id=p_user_id;
  if not found or e.source is distinct from 'anonymous_demo' or e.verdict is null or e.verdict not in ('GO','CONDITIONAL') then raise exception 'Invalid imported evaluation'; end if;
  if not exists(select 1 from public.generations where evaluation_id=e.id and user_id=p_user_id) then
    insert into public.generations(id,created_at,user_id,evaluation_id,prompt,output,model)
      values(gen_random_uuid(),p_created_at,p_user_id,e.id,e.announcement,p_draft,'anonymous_demo_import');
    update public.api_usage_accounts set drafts_used=drafts_used+1 where scope=a.scope and actor=a.actor;
  end if;
end $$;

-- Browser access inspection: the application uses browser Supabase for auth only;
-- all table access is through service-role API routes. TRUNCATE bypasses RLS.
revoke all on table public.evaluations,public.generations,public.demo_usage,
  public.api_usage_accounts,public.api_usage_reservations,public.api_usage_buckets from public,anon,authenticated;
grant select,insert on public.evaluations,public.generations to service_role;
revoke all on function public.api_usage_account(text,uuid,text),public.api_usage_snapshot(public.api_usage_accounts,boolean),
  public.get_api_usage(text,uuid,text,boolean),public.reserve_api_usage(text,uuid,text,boolean,text,uuid,text),
  public.dispatch_api_usage(uuid),public.release_api_usage(uuid),public.complete_api_usage(uuid,jsonb,boolean),
  public.import_demo_draft(text,uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.get_api_usage(text,uuid,text,boolean),public.reserve_api_usage(text,uuid,text,boolean,text,uuid,text),
  public.dispatch_api_usage(uuid),public.release_api_usage(uuid),public.complete_api_usage(uuid,jsonb,boolean),
  public.import_demo_draft(text,uuid,uuid,text,timestamptz) to service_role;
-- Supabase may grant service_role EXECUTE by default: remove direct grants too.
revoke all on function public.api_usage_account(text,uuid,text),
  public.api_usage_snapshot(public.api_usage_accounts,boolean) from service_role;
notify pgrst, 'reload schema';
commit;
