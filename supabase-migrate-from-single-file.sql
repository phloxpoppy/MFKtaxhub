-- MyTax Hub v2.4: migrasi daripada struktur single-file lama.
-- Jalankan seluruh fail ini sekali dalam Supabase SQL Editor.
-- Skrip ini tidak memadam resit atau profil lama.
create extension if not exists pgcrypto;

alter table public.receipts add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.receipts add column if not exists profile_key text;
alter table public.receipts add column if not exists image_paths text[] not null default '{}';
alter table public.receipts add column if not exists needs_review boolean not null default false;
alter table public.receipts add column if not exists created_at timestamptz not null default now();
alter table public.receipts add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='receipts' and column_name='user_profile') then
    execute 'update public.receipts set profile_key=coalesce(profile_key,user_profile) where profile_key is null';
  end if;
end $$;
update public.receipts set profile_key='Faisal' where profile_key is null or trim(profile_key)='';

-- Tetapkan pemilik rekod lama secara automatik jika hanya ada satu akaun Auth.
do $$
declare only_user uuid; user_count integer;
begin
  select count(*),min(id::text)::uuid into user_count,only_user from auth.users;
  if user_count=1 then update public.receipts set owner_id=only_user where owner_id is null; end if;
end $$;
alter table public.receipts alter column owner_id set default auth.uid();

create table if not exists public.tax_profiles(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_key text not null,
  name text not null,
  ic text default '', tin text default '', reference text default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists tax_profiles_owner_profile_uidx on public.tax_profiles(owner_id,profile_key);

-- Pindahkan profil lama apabila hanya ada satu akaun Auth.
do $$
declare only_user uuid; user_count integer;
begin
  select count(*),min(id::text)::uuid into user_count,only_user from auth.users;
  if user_count=1 and to_regclass('public.profiles') is not null then
    execute format('insert into public.tax_profiles(owner_id,profile_key,name,ic,tin,reference) select %L::uuid,id,name,coalesce(ic,'''') ,coalesce(tin,'''') ,coalesce(ref,'''') from public.profiles on conflict(owner_id,profile_key) do update set name=excluded.name,ic=excluded.ic,tin=excluded.tin,reference=excluded.reference',only_user);
  end if;
end $$;

alter table public.receipts enable row level security;
alter table public.tax_profiles enable row level security;
drop policy if exists "Own receipts only" on public.receipts;
create policy "Own receipts only" on public.receipts for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);
drop policy if exists "Own tax profiles only" on public.tax_profiles;
create policy "Own tax profiles only" on public.tax_profiles for all to authenticated using(auth.uid()=owner_id) with check(auth.uid()=owner_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('receipts','receipts',false,7340032,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=7340032,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists "Users upload own receipts" on storage.objects;
create policy "Users upload own receipts" on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users update own receipts" on storage.objects;
create policy "Users update own receipts" on storage.objects for update to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users read own receipts" on storage.objects;
create policy "Users read own receipts" on storage.objects for select to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "Users delete own receipts" on storage.objects;
create policy "Users delete own receipts" on storage.objects for delete to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);

create index if not exists receipts_owner_date_idx on public.receipts(owner_id,date desc);
notify pgrst,'reload schema';
select count(*) as jumlah_resit,count(owner_id) as resit_ada_pemilik from public.receipts;
