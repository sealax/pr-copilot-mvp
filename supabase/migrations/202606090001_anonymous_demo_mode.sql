create table if not exists public.demo_usage (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null unique,
  readiness_checks_used integer not null default 0 check (readiness_checks_used between 0 and 2),
  drafts_used integer not null default 0 check (drafts_used between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.demo_usage enable row level security;

create or replace function public.consume_demo_readiness_check(visitor_ip_hash text)
returns table (readiness_checks_used integer, drafts_used integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.demo_usage (ip_hash)
  values (visitor_ip_hash)
  on conflict (ip_hash) do nothing;

  return query
  update public.demo_usage
  set
    readiness_checks_used = demo_usage.readiness_checks_used + 1,
    updated_at = now()
  where
    demo_usage.ip_hash = visitor_ip_hash
    and demo_usage.readiness_checks_used < 2
  returning demo_usage.readiness_checks_used, demo_usage.drafts_used;
end;
$$;

create or replace function public.consume_demo_draft(visitor_ip_hash text)
returns table (readiness_checks_used integer, drafts_used integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.demo_usage (ip_hash)
  values (visitor_ip_hash)
  on conflict (ip_hash) do nothing;

  return query
  update public.demo_usage
  set
    drafts_used = demo_usage.drafts_used + 1,
    updated_at = now()
  where
    demo_usage.ip_hash = visitor_ip_hash
    and demo_usage.readiness_checks_used > 0
    and demo_usage.drafts_used < 1
  returning demo_usage.readiness_checks_used, demo_usage.drafts_used;
end;
$$;

revoke all on table public.demo_usage from anon, authenticated;
revoke all on function public.consume_demo_readiness_check(text) from public, anon, authenticated;
revoke all on function public.consume_demo_draft(text) from public, anon, authenticated;
grant execute on function public.consume_demo_readiness_check(text) to service_role;
grant execute on function public.consume_demo_draft(text) to service_role;
