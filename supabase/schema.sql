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

-- ---------- Chatt: enskilda chattar (dm) och grupper ----------
create table if not exists public.conversations (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('dm', 'group')),
  name text check (name is null or length(name) between 1 and 40),
  created_by uuid not null references auth.users on delete cascade default auth.uid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id bigint not null references public.conversations on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations on delete cascade,
  sender uuid not null references auth.users on delete cascade default auth.uid(),
  body text check (body is null or length(body) between 1 and 1000),
  bet jsonb,                         -- delat bet (samma fält som saved_bets)
  created_at timestamptz not null default now(),
  check (body is not null or bet is not null)
);
create index if not exists messages_conv_time on public.messages (conversation_id, created_at);

create or replace function public.is_member(conv bigint) returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.conversation_members m where m.conversation_id = conv and m.user_id = auth.uid());
$$;

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
drop policy if exists "Medlemmar ser chatten" on public.conversations;
drop policy if exists "Medlemmar ser medlemmarna" on public.conversation_members;
drop policy if exists "Markera som läst" on public.conversation_members;
drop policy if exists "Lämna chatt" on public.conversation_members;
drop policy if exists "Medlemmar läser meddelanden" on public.messages;
drop policy if exists "Medlemmar skriver" on public.messages;
drop policy if exists "Ta bort eget meddelande" on public.messages;
create policy "Medlemmar ser chatten" on public.conversations for select to authenticated using (public.is_member(id));
create policy "Medlemmar ser medlemmarna" on public.conversation_members for select to authenticated using (public.is_member(conversation_id));
create policy "Markera som läst" on public.conversation_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Lämna chatt" on public.conversation_members for delete to authenticated using (user_id = auth.uid());
create policy "Medlemmar läser meddelanden" on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "Medlemmar skriver" on public.messages for insert to authenticated with check (sender = auth.uid() and public.is_member(conversation_id));
create policy "Ta bort eget meddelande" on public.messages for delete to authenticated using (sender = auth.uid());

-- Senaste aktivitet, för att sortera chattlistan.
create or replace function public.bump_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists on_message_bump on public.messages;
create trigger on_message_bump after insert on public.messages for each row execute function public.bump_conversation();

-- Öppna (eller skapa) en enskild chatt med en vän.
create or replace function public.open_dm(other uuid) returns bigint
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  if not public.is_friend(other) then raise exception 'Ni måste vara vänner för att chatta'; end if;
  select c.id into cid from public.conversations c
   where c.kind = 'dm'
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = auth.uid())
     and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = other)
   limit 1;
  if cid is null then
    insert into public.conversations (kind, created_by) values ('dm', auth.uid()) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, auth.uid()), (cid, other);
  end if;
  return cid;
end $$;

-- Skapa en grupp med vänner.
create or replace function public.create_group(group_name text, members uuid[]) returns bigint
language plpgsql security definer set search_path = '' as $$
declare cid bigint;
begin
  if length(trim(coalesce(group_name, ''))) not between 1 and 40 then raise exception 'Gruppnamnet ska vara 1–40 tecken'; end if;
  if exists (select 1 from unnest(members) x where not public.is_friend(x)) then raise exception 'Du kan bara lägga till vänner'; end if;
  insert into public.conversations (kind, name, created_by) values ('group', trim(group_name), auth.uid()) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id)
    select cid, u from (select auth.uid() as u union select distinct x from unnest(members) x) s;
  return cid;
end $$;

-- Lägg till vänner i en grupp man själv är med i.
create or replace function public.add_to_group(conv bigint, members uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_member(conv) or not exists (select 1 from public.conversations where id = conv and kind = 'group') then
    raise exception 'Du är inte med i gruppen'; end if;
  if exists (select 1 from unnest(members) x where not public.is_friend(x)) then raise exception 'Du kan bara lägga till vänner'; end if;
  insert into public.conversation_members (conversation_id, user_id) select conv, x from unnest(members) x on conflict do nothing;
end $$;

-- Olästa meddelanden per chatt.
create or replace function public.unread_counts() returns table (conversation_id bigint, unread bigint)
language sql security definer set search_path = '' stable as $$
  select m.conversation_id, count(msg.id)
  from public.conversation_members m
  left join public.messages msg on msg.conversation_id = m.conversation_id and msg.created_at > m.last_read_at and msg.sender <> auth.uid()
  where m.user_id = auth.uid()
  group by m.conversation_id;
$$;

revoke all on function public.open_dm(uuid), public.create_group(text, uuid[]), public.add_to_group(bigint, uuid[]), public.unread_counts(), public.is_member(bigint) from public;
grant execute on function public.open_dm(uuid), public.create_group(text, uuid[]), public.add_to_group(bigint, uuid[]), public.unread_counts(), public.is_member(bigint) to authenticated;

-- Nya meddelanden skickas direkt till öppna chattar (Supabase Realtime, följer reglerna ovan).
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------- Medlemskap (9 kr/mån via Stripe) ----------
-- Raderna skrivs av Stripe-webhooken (supabase/functions/stripe-webhook) med service-nyckeln.
-- Användaren kan bara läsa sin egen rad.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'owner')),
  current_period_end timestamptz,
  stripe_customer text,
  stripe_subscription text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
drop policy if exists "Se eget medlemskap" on public.subscriptions;
create policy "Se eget medlemskap" on public.subscriptions for select to authenticated using (user_id = auth.uid());

create or replace function public.is_premium() returns boolean
language sql security definer set search_path = '' stable as $$
  select exists (select 1 from public.subscriptions s where s.user_id = auth.uid()
    and (s.status = 'owner' or (s.status in ('active', 'trialing', 'past_due') and (s.current_period_end is null or s.current_period_end > now() - interval '3 days'))));
$$;
revoke all on function public.is_premium() from public;
grant execute on function public.is_premium() to authenticated;

-- De rekommenderade spelen (värdebets, bet builders, målskyttar) per match.
-- Skrivs av datahämtningen (GitHub Actions) med service-nyckeln, läses bara av medlemmar.
create table if not exists public.premium_matches (
  match_id text primary key,
  comp text not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.premium_matches enable row level security;
drop policy if exists "Medlemmar läser premium" on public.premium_matches;
create policy "Medlemmar läser premium" on public.premium_matches for select to authenticated using (public.is_premium());

-- Ägarna har gratis medlemskap.
insert into public.subscriptions (user_id, status)
select id, 'owner' from auth.users where email in ('simonjonhed@gmail.com', 'casperalbertnilsson@gmail.com')
on conflict (user_id) do update set status = 'owner', updated_at = now();

-- ---------- Testbetalning (inga riktiga pengar) ----------
-- Så länge payments_test_mode är true kan en inloggad användare "betala" i testkassan och få
-- ett medlemskap i 30 dagar. Sätt till false när Stripe tar över:
--   update public.app_settings set value = 'false' where key = 'payments_test_mode';
create table if not exists public.app_settings (key text primary key, value jsonb not null);
alter table public.app_settings enable row level security;
drop policy if exists "Alla läser inställningar" on public.app_settings;
create policy "Alla läser inställningar" on public.app_settings for select using (true);
insert into public.app_settings (key, value) values ('payments_test_mode', 'true') on conflict (key) do nothing;

create or replace function public.activate_test_subscription() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare ends timestamptz := now() + interval '30 days';
begin
  if auth.uid() is null then raise exception 'Du måste vara inloggad'; end if;
  if coalesce((select value::text from public.app_settings where key = 'payments_test_mode'), 'false') <> 'true' then
    raise exception 'Testbetalning är avstängd'; end if;
  insert into public.subscriptions (user_id, status, current_period_end, updated_at)
  values (auth.uid(), 'active', ends, now())
  on conflict (user_id) do update set status = case when public.subscriptions.status = 'owner' then 'owner' else 'active' end,
    current_period_end = case when public.subscriptions.status = 'owner' then null else ends end, updated_at = now();
  return ends;
end $$;

create or replace function public.cancel_test_subscription() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select value::text from public.app_settings where key = 'payments_test_mode'), 'false') <> 'true' then
    raise exception 'Testbetalning är avstängd'; end if;
  update public.subscriptions set status = 'canceled', current_period_end = now(), updated_at = now()
  where user_id = auth.uid() and status <> 'owner';
end $$;

revoke all on function public.activate_test_subscription(), public.cancel_test_subscription() from public;
grant execute on function public.activate_test_subscription(), public.cancel_test_subscription() to authenticated;
