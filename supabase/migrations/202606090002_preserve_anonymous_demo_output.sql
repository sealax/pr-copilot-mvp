alter table public.evaluations
  add column if not exists source text not null default 'authenticated',
  add column if not exists demo_import_id text;

create unique index if not exists evaluations_demo_import_id_key
  on public.evaluations (demo_import_id)
  where demo_import_id is not null;
