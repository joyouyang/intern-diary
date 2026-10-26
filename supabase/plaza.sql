-- 广场（纸船漂流瓶）数据库结构。在 Supabase 控制台的 SQL Editor 里整段运行一次即可。
--
-- 规则：
--   * 每个人用匿名身份登录（Authentication → Sign In / Providers → 打开 Allow anonymous sign-ins）。
--   * 放出几只纸船，就能捞几只；同一天的待办、日记各算一只，重复放会更新内容，不会多算。
--   * 只能看到自己放的和自己捞到的纸船；留言只在纸船作者和捞到它的人之间往来。
--   * 表本身对浏览器完全不开放，所有读写都走下面的函数，函数里检查身份和次数限制。

create table if not exists public.boats (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('todo', 'diary')),
  body jsonb not null,
  signature text not null default '',
  boat_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  report_count int not null default 0,
  hidden boolean not null default false,
  unique (author, kind, boat_date)
);

create table if not exists public.catches (
  catcher uuid not null references auth.users (id) on delete cascade,
  boat_id uuid not null references public.boats (id) on delete cascade,
  caught_at timestamptz not null default now(),
  primary key (catcher, boat_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  boat_id uuid not null references public.boats (id) on delete cascade,
  sender uuid not null references auth.users (id) on delete cascade,
  recipient uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_recipient_idx on public.messages (recipient, created_at desc);
create index if not exists messages_boat_idx on public.messages (boat_id);

create table if not exists public.reports (
  reporter uuid not null references auth.users (id) on delete cascade,
  boat_id uuid not null references public.boats (id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (reporter, boat_id)
);

-- No direct table access from the browser: RLS on, no policies, no grants.
alter table public.boats enable row level security;
alter table public.catches enable row level security;
alter table public.messages enable row level security;
alter table public.reports enable row level security;
revoke all on public.boats, public.catches, public.messages, public.reports from anon, authenticated;

create or replace function public.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not_signed_in'; end if;
  return me;
end $$;

-- How many boats I have released and caught, and how many unread messages wait for me.
create or replace function public.plaza_stats() returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  return json_build_object(
    'released', (select count(*) from public.boats where author = me),
    'caught', (select count(*) from public.catches where catcher = me),
    'unread', (select count(*) from public.messages where recipient = me and read_at is null));
end $$;

-- Release (or refresh) today's boat of the given kind.
create or replace function public.release_boat(p_kind text, p_body jsonb, p_signature text, p_date date) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.require_user();
  today date := (now() at time zone 'Asia/Shanghai')::date;
  existed boolean;
  b public.boats;
begin
  if p_kind not in ('todo', 'diary') then raise exception 'bad_kind'; end if;
  if p_date is null or abs(p_date - today) > 1 then raise exception 'bad_date'; end if;
  if p_body is null or octet_length(p_body::text) > 6000 then raise exception 'too_long'; end if;
  existed := exists (select 1 from public.boats where author = me and kind = p_kind and boat_date = p_date);
  insert into public.boats (author, kind, body, signature, boat_date)
  values (me, p_kind, p_body, left(coalesce(btrim(p_signature), ''), 60), p_date)
  on conflict (author, kind, boat_date)
  do update set body = excluded.body, signature = excluded.signature, updated_at = now()
  returning * into b;
  return json_build_object('id', b.id, 'kind', b.kind, 'boat_date', b.boat_date, 'is_new', not existed);
end $$;

-- Catch one random boat from someone else. Allowed only while caught < released.
create or replace function public.fish_boat() returns json
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.require_user();
  b public.boats;
begin
  if (select count(*) from public.catches where catcher = me) >= (select count(*) from public.boats where author = me) then
    raise exception 'no_quota';
  end if;
  select * into b from public.boats x
  where x.author <> me and not x.hidden
    and not exists (select 1 from public.catches c where c.catcher = me and c.boat_id = x.id)
  order by random() limit 1;
  if b.id is null then raise exception 'sea_empty'; end if;
  insert into public.catches (catcher, boat_id) values (me, b.id);
  return json_build_object('id', b.id, 'kind', b.kind, 'body', b.body, 'signature', b.signature,
    'boat_date', b.boat_date, 'author', b.author, 'caught_at', now(), 'unread', 0);
end $$;

-- Boats I released, newest first, with the people who wrote to me about each one.
create or replace function public.my_boats() returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select json_agg(x order by x.boat_date desc, x.kind) from (
      select b.id, b.kind, b.body, b.signature, b.boat_date, b.hidden,
        (select count(*) from public.messages m where m.boat_id = b.id and m.recipient = me and m.read_at is null) as unread,
        coalesce((select json_agg(p.sender order by p.first_at) from (
          select m.sender, min(m.created_at) as first_at from public.messages m
          where m.boat_id = b.id and m.sender <> me group by m.sender) p), '[]'::json) as people
      from public.boats b where b.author = me
    ) x), '[]'::json);
end $$;

-- Boats I caught, newest first.
create or replace function public.caught_boats() returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select json_agg(x order by x.caught_at desc) from (
      select b.id, b.kind, b.body, b.signature, b.boat_date, b.author, c.caught_at,
        (select count(*) from public.messages m where m.boat_id = b.id and m.recipient = me and m.read_at is null) as unread
      from public.catches c join public.boats b on b.id = c.boat_id
      where c.catcher = me and not b.hidden
    ) x), '[]'::json);
end $$;

-- Messages sent to me, newest first.
create or replace function public.inbox() returns json
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  return coalesce((
    select json_agg(x order by x.created_at desc) from (
      select m.id, m.boat_id, m.sender as other, m.body, m.created_at, m.read_at is null as unread,
        b.kind, b.body as boat_body, b.boat_date, b.author = me as my_boat
      from public.messages m join public.boats b on b.id = m.boat_id
      where m.recipient = me
      order by m.created_at desc limit 100
    ) x), '[]'::json);
end $$;

-- The conversation between me and one other person about one boat. Opening it marks their messages read.
create or replace function public.open_thread(p_boat uuid, p_other uuid) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.require_user();
  b public.boats;
  allowed boolean;
begin
  select * into b from public.boats where id = p_boat;
  if b.id is null then raise exception 'no_boat'; end if;
  if b.author = me then
    allowed := exists (select 1 from public.messages where boat_id = p_boat and sender = p_other);
  else
    allowed := p_other = b.author and exists (select 1 from public.catches where catcher = me and boat_id = p_boat);
  end if;
  if not allowed then raise exception 'no_access'; end if;
  update public.messages set read_at = now()
  where boat_id = p_boat and recipient = me and sender = p_other and read_at is null;
  return json_build_object(
    'boat', json_build_object('id', b.id, 'kind', b.kind, 'body', b.body, 'signature', b.signature,
      'boat_date', b.boat_date, 'mine', b.author = me),
    'other', p_other,
    'messages', coalesce((
      select json_agg(json_build_object('id', m.id, 'body', m.body, 'mine', m.sender = me, 'created_at', m.created_at) order by m.created_at)
      from public.messages m
      where m.boat_id = p_boat and ((m.sender = me and m.recipient = p_other) or (m.sender = p_other and m.recipient = me))
    ), '[]'::json));
end $$;

-- Leave a message. A catcher writes to the boat's author; the author replies to someone who wrote first.
create or replace function public.send_message(p_boat uuid, p_body text, p_to uuid default null) returns json
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.require_user();
  b public.boats;
  target uuid;
  clean text := btrim(coalesce(p_body, ''));
  m public.messages;
begin
  select * into b from public.boats where id = p_boat;
  if b.id is null then raise exception 'no_boat'; end if;
  if b.author = me then
    if p_to is null or not exists (select 1 from public.messages where boat_id = p_boat and sender = p_to) then
      raise exception 'no_access';
    end if;
    target := p_to;
  else
    if not exists (select 1 from public.catches where catcher = me and boat_id = p_boat) then raise exception 'no_access'; end if;
    target := b.author;
  end if;
  if char_length(clean) < 1 or char_length(clean) > 300 then raise exception 'bad_length'; end if;
  if (select count(*) from public.messages where sender = me and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many';
  end if;
  insert into public.messages (boat_id, sender, recipient, body) values (p_boat, me, target, clean) returning * into m;
  return json_build_object('id', m.id, 'body', m.body, 'mine', true, 'created_at', m.created_at);
end $$;

-- Report a caught boat. Three reports hide it from everyone who has not caught it yet.
create or replace function public.report_boat(p_boat uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  if not exists (select 1 from public.catches where catcher = me and boat_id = p_boat) then raise exception 'no_access'; end if;
  insert into public.reports (reporter, boat_id, reason) values (me, p_boat, left(coalesce(p_reason, ''), 200))
  on conflict do nothing;
  if found then
    update public.boats set report_count = report_count + 1, hidden = report_count + 1 >= 3 where id = p_boat;
  end if;
end $$;

create or replace function public.delete_boat(p_boat uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := public.require_user();
begin
  delete from public.boats where id = p_boat and author = me;
end $$;

-- Only signed-in users (anonymous sign-ins count) may call these.
do $$
declare f text;
begin
  foreach f in array array[
    'require_user()', 'plaza_stats()', 'release_boat(text, jsonb, text, date)', 'fish_boat()', 'my_boats()',
    'caught_boats()', 'inbox()', 'open_thread(uuid, uuid)', 'send_message(uuid, text, uuid)',
    'report_boat(uuid, text)', 'delete_boat(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
