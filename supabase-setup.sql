-- Jalankan sekali dalam Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.tax_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  name text not null,
  ic text default '',
  tin text default '',
  reference text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, profile_key)
);

create table if not exists public.receipts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  date date not null,
  store text not null,
  category text not null,
  items text not null,
  amount numeric(12,2) not null check (amount > 0),
  image_url text default '',
  image_paths text[] not null default '{}',
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.receipts add column if not exists image_paths text[] not null default '{}';

alter table public.tax_profiles enable row level security;
alter table public.receipts enable row level security;

drop policy if exists "Own tax profiles only" on public.tax_profiles;
create policy "Own tax profiles only" on public.tax_profiles for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Own receipts only" on public.receipts;
create policy "Own receipts only" on public.receipts for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts','receipts',false,7340032,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit=7340032, allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists "Users upload own receipts" on storage.objects;
create policy "Users upload own receipts" on storage.objects for insert to authenticated
  with check (bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users update own receipts" on storage.objects;
create policy "Users update own receipts" on storage.objects for update to authenticated
  using (bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users delete own receipts" on storage.objects;
create policy "Users delete own receipts" on storage.objects for delete to authenticated
  using (bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users read own receipts" on storage.objects;
create policy "Users read own receipts" on storage.objects for select to authenticated
  using (bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);

create index if not exists receipts_owner_date_idx on public.receipts(owner_id,date desc);

-- ================================================================
-- Audit Hub v3: CP500 receipts and monthly bank statements
-- Run this section once after the original setup above.
-- ================================================================
create table if not exists public.audit_documents (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  document_type text not null check (document_type in ('cp500','bank_statement')),
  document_date date not null,
  title text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  notes text not null default '',
  statement_month text,
  bank_name text not null default '',
  account_last4 text not null default '',
  cp500_installment text,
  cp500_reference text not null default '',
  file_path text not null,
  mime_type text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.audit_documents enable row level security;
drop policy if exists "Own audit documents only" on public.audit_documents;
create policy "Own audit documents only" on public.audit_documents for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audit-documents','audit-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit=10485760, allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp'];

drop policy if exists "Users upload own audit documents" on storage.objects;
create policy "Users upload own audit documents" on storage.objects for insert to authenticated
  with check (bucket_id='audit-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users update own audit documents" on storage.objects;
create policy "Users update own audit documents" on storage.objects for update to authenticated
  using (bucket_id='audit-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users delete own audit documents" on storage.objects;
create policy "Users delete own audit documents" on storage.objects for delete to authenticated
  using (bucket_id='audit-documents' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users read own audit documents" on storage.objects;
create policy "Users read own audit documents" on storage.objects for select to authenticated
  using (bucket_id='audit-documents' and (storage.foldername(name))[1]=auth.uid()::text);

create index if not exists audit_documents_owner_date_idx on public.audit_documents(owner_id,document_date desc);
