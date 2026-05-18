create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text default '',
  avatar_url text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.deelnemers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  naam text not null,
  kleur text not null default '#7A8446',
  created_at timestamptz not null default now()
);

create table if not exists public.extra_inleg (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  participant_id uuid references public.deelnemers(id) on delete set null,
  omschrijving text default '',
  bedrag numeric not null check (bedrag >= 0),
  type text not null default 'topup' check (type in ('initial', 'topup')),
  is_raming boolean not null default false,
  datum timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.uitgaven (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  participant_id uuid references public.deelnemers(id) on delete set null,
  omschrijving text not null,
  bedrag numeric not null check (bedrag >= 0),
  categorie text not null default 'overig',
  betaald_door text default '',
  is_raming boolean not null default false,
  is_gecontroleerd boolean not null default false,
  datum timestamptz not null default now(),
  notitie text default '',
  bon_path text default '',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update
    set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.deelnemers enable row level security;
alter table public.extra_inleg enable row level security;
alter table public.uitgaven enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "deelnemers_all_own" on public.deelnemers;
create policy "deelnemers_all_own" on public.deelnemers
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "extra_inleg_all_own" on public.extra_inleg;
create policy "extra_inleg_all_own" on public.extra_inleg
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "uitgaven_all_own" on public.uitgaven;
create policy "uitgaven_all_own" on public.uitgaven
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.deelnemers to authenticated;
grant select, insert, update, delete on public.extra_inleg to authenticated;
grant select, insert, update, delete on public.uitgaven to authenticated;

create index if not exists idx_deelnemers_user_id on public.deelnemers(user_id);
create index if not exists idx_extra_inleg_user_id on public.extra_inleg(user_id);
create index if not exists idx_uitgaven_user_id on public.uitgaven(user_id);
create index if not exists idx_extra_inleg_participant_id on public.extra_inleg(participant_id);
create index if not exists idx_uitgaven_participant_id on public.uitgaven(participant_id);
