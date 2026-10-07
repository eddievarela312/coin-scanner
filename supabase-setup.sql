-- Run once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tester text,
  hints text,
  coin_name text,
  confidence text,
  server_ms integer,
  error text,
  photo_paths text[],
  result jsonb,
  correct text,          -- 'yes' / 'no' from the "Correct ID?" buttons
  corrected_to text      -- what the tester says it really was
);

-- Only the app's server (service key) can read or write. No public access.
alter table public.scans enable row level security;

-- Private bucket for scan photos.
insert into storage.buckets (id, name, public)
values ('scan-photos', 'scan-photos', false)
on conflict (id) do nothing;
