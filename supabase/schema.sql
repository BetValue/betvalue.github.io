-- BetValue: konton, favoriter och boostar i Supabase.
-- Körs i Supabase > SQL Editor. Kan köras flera gånger.

-- ---------- Profiler (användarnamn) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));
alter table public.profiles enable row level security;
drop policy if exists "Alla kan se användarnamn" on public.profiles;
create policy "Alla kan se användarnamn" on public.profiles for select using (true);

-- Profilen skapas automatiskt när kontot skapas (användarnamnet skickas med vid registreringen).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Är användarnamnet upptaget? (kollas innan registrering)
create or replace function public.username_taken(name text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where lower(username) = lower(name));
$$;

-- Inloggning med användarnamn: slår upp mejlen som hör till namnet.
create or replace function public.email_for_login(login text) returns text
language sql security definer set search_path = '' as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where lower(p.username) = lower(login) limit 1;
$$;

revoke all on function public.username_taken(text) from public;
revoke all on function public.email_for_login(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;
grant execute on function public.email_for_login(text) to anon, authenticated;

-- ---------- Favoriter (lag och spelare) ----------
create table if not exists public.favorites (
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  kind text not null check (kind in ('team', 'player')),
  ref text not null,             -- lag: "PL:62", spelare: "eng.1:253989"
  label text not null,
  extra jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.favorites enable row level security;
drop policy if exists "Egna favoriter" on public.favorites;
create policy "Egna favoriter" on public.favorites for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Boostar (läggs in av inloggade, syns för alla) ----------
create table if not exists public.boosts (
  id bigint generated always as identity primary key,
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  book text not null check (length(book) between 2 and 40),
  match_id text not null,
  pick text not null,
  title text,
  odds numeric(6, 2) not null check (odds > 1 and odds < 1000),
  was numeric(6, 2) check (was is null or (was > 1 and was < 1000)),
  ends timestamptz,
  created_at timestamptz not null default now()
);
alter table public.boosts enable row level security;
drop policy if exists "Alla ser boostar" on public.boosts;
drop policy if exists "Inloggade lägger in boostar" on public.boosts;
drop policy if exists "Egna boostar kan tas bort" on public.boosts;
create policy "Alla ser boostar" on public.boosts for select using (true);
create policy "Inloggade lägger in boostar" on public.boosts for insert to authenticated with check (auth.uid() = created_by);
create policy "Egna boostar kan tas bort" on public.boosts for delete to authenticated using (auth.uid() = created_by);

create or replace view public.boosts_public with (security_invoker = true) as
  select b.id, b.book, b.match_id, b.pick, b.title, b.odds, b.was, b.ends, b.created_at, b.created_by, p.username
  from public.boosts b left join public.profiles p on p.id = b.created_by;
grant select on public.boosts_public to anon, authenticated;

-- ---------- Sparade bets (syns bara för den som sparat dem) ----------
create table if not exists public.saved_bets (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  match_id text not null,
  pick text not null,               -- samma nycklar som marketsFor() i common.js
  label text not null,
  match_label text not null,
  kickoff timestamptz,
  comp text,
  p numeric(5, 3),                  -- vår sannolikhet när betet sparades
  odds numeric(7, 2) check (odds is null or (odds > 1 and odds < 10000)),
  book text,
  result text check (result in ('won', 'lost', 'void')),  -- sätts när matchen är spelad
  created_at timestamptz not null default now(),
  unique (user_id, match_id, pick)
);
alter table public.saved_bets enable row level security;
drop policy if exists "Egna sparade bets" on public.saved_bets;
create policy "Egna sparade bets" on public.saved_bets for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter table public.saved_bets add column if not exists result text check (result in ('won', 'lost', 'void'));

-- ---------- Vänner ----------
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references auth.users on delete cascade default auth.uid(),
  addressee uuid not null references auth.users on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- Bara en relation per par, oavsett vem som frågade.
create unique index if not exists friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
alter table public.friendships enable row level security;
drop policy if exists "Se egna vänrelationer" on public.friendships;
drop policy if exists "Skicka vänförfrågan" on public.friendships;
drop policy if exists "Acceptera förfrågan" on public.friendships;
drop policy if exists "Ta bort vän eller förfrågan" on public.friendships;
create policy "Se egna vänrelationer" on public.friendships for select to authenticated using (auth.uid() in (requester, addressee));
create policy "Skicka vänförfrågan" on public.friendships for insert to authenticated with check (auth.uid() = requester and status = 'pending');
create policy "Acceptera förfrågan" on public.friendships for update to authenticated using (auth.uid() = addressee) with check (auth.uid() = addressee);
create policy "Ta bort vän eller förfrågan" on public.friendships for delete to authenticated using (auth.uid() in (requester, addressee));

-- Vänner kan se varandras sparade bets.
create or replace function public.is_friend(other uuid) returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester = auth.uid() and f.addressee = other) or (f.addressee = auth.uid() and f.requester = other)));
$$;
grant execute on function public.is_friend(uuid) to authenticated;
drop policy if exists "Vänner ser varandras bets" on public.saved_bets;
create policy "Vänner ser varandras bets" on public.saved_bets for select to authenticated using (public.is_friend(user_id));
