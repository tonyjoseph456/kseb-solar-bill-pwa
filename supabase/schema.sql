-- ============================================================
-- KSEB Solar Prosumer PWA - Free Supabase Cloud Sync Schema
-- Run this once in your Supabase Project -> SQL Editor
-- ============================================================

create table if not exists public.bill_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('official_bill', 'meter_estimate')),
  billing_month text not null,
  consumer_no text not null default '',
  payload jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_bill_records_user_month
  on public.bill_records (user_id, billing_month desc);

alter table public.bill_records enable row level security;

revoke all on public.bill_records from anon;
grant select, insert, update, delete on public.bill_records to authenticated;

drop policy if exists "Users read own bill records" on public.bill_records;
create policy "Users read own bill records"
  on public.bill_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own bill records" on public.bill_records;
create policy "Users insert own bill records"
  on public.bill_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own bill records" on public.bill_records;
create policy "Users update own bill records"
  on public.bill_records for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own bill records" on public.bill_records;
create policy "Users delete own bill records"
  on public.bill_records for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Solar inverter daily generation records (per month)
create table if not exists public.solar_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  billing_month text not null,
  payload jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_solar_records_user_month
  on public.solar_records (user_id, billing_month desc);

alter table public.solar_records enable row level security;

revoke all on public.solar_records from anon;
grant select, insert, update, delete on public.solar_records to authenticated;

drop policy if exists "Users read own solar records" on public.solar_records;
create policy "Users read own solar records"
  on public.solar_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users insert own solar records" on public.solar_records;
create policy "Users insert own solar records"
  on public.solar_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own solar records" on public.solar_records;
create policy "Users update own solar records"
  on public.solar_records for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users delete own solar records" on public.solar_records;
create policy "Users delete own solar records"
  on public.solar_records for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- User settings / baseline preferences
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

revoke all on public.user_settings from anon;
grant select, insert, update, delete on public.user_settings to authenticated;

drop policy if exists "Users manage own settings" on public.user_settings;
create policy "Users manage own settings"
  on public.user_settings for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Private Storage bucket for original KSEB PDF bills (1 GB free tier)
insert into storage.buckets (id, name, public)
values ('bill-pdfs', 'bill-pdfs', false)
on conflict (id) do nothing;

drop policy if exists "Users upload own bill PDFs" on storage.objects;
create policy "Users upload own bill PDFs"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'bill-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users read own bill PDFs" on storage.objects;
create policy "Users read own bill PDFs"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bill-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users update own bill PDFs" on storage.objects;
create policy "Users update own bill PDFs"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'bill-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'bill-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete own bill PDFs" on storage.objects;
create policy "Users delete own bill PDFs"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'bill-pdfs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
