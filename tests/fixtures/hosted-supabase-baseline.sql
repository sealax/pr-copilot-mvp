-- TEST ONLY: apply solely to the empty pr-copilot-integration-test project
-- dciueccfgsltdrzufjvp. Never apply to production csbavsfpzdtjlvowbwti.
-- The connection target MUST be verified by the runner before executing SQL.
-- Core migrations are absent from this repository. These definitions reproduce
-- only owner-verified column types, nullability, keys and RLS information.
-- Unverified defaults, extra indexes and auth-user foreign keys are not invented.
-- Run before the repository migrations, in chronological order.
-- No IF NOT EXISTS: a nonempty/incompatible target must fail, not be reused.
begin;
create table public.evaluations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  announcement text not null,
  market text,
  partners text,
  funding text,
  verdict text,
  risk_score integer,
  evaluation_json jsonb
);
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  evaluation_id uuid references public.evaluations(id) on delete set null,
  user_id uuid,
  prompt text not null,
  output text,
  model text
);
alter table public.evaluations owner to postgres;
alter table public.generations owner to postgres;
alter table public.evaluations enable row level security;
alter table public.generations enable row level security;
-- Reproduce the supplied pre-cutover grants, including the TRUNCATE weakness.
-- No RLS policies: browser roles cannot read/write rows despite these grants.
grant all on public.evaluations, public.generations to anon, authenticated;
grant select, insert on public.evaluations, public.generations to service_role;
commit;
