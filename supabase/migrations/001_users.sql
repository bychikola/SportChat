-- ═══════════════════════════════════════════════════════════════
-- SportChat · Supabase: схема хранения данных пользователей
-- Миграция 001 (этап 5/Фаза B+ плана профилей)
--
-- Сервер ходит с service_role ключом (RLS обходится) — это бэкенд,
-- не браузер. RLS включаем как страховку: без политик таблицы
-- недоступны никому, кроме service_role.
-- ═══════════════════════════════════════════════════════════════

-- ── Пользователи ────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'email',      -- email | phone | telegram
  login         text not null,                      -- email или телефон (уникален)
  pass_hash     text,                               -- scrypt hex; null для telegram
  salt          text,
  name          text not null default '',
  avatar_color  text not null default 'a',          -- a|b|c|d (градиент аватара)
  premium       boolean not null default false,
  xp            integer not null default 0,         -- Фаза C
  level         integer not null default 1,         -- Фаза C
  created_at    timestamptz not null default now()
);
create unique index if not exists users_login_idx on public.users (login);

-- ── Сессии (Bearer-токены) ─────────────────────────────────────
create table if not exists public.auth_sessions (
  token      text primary key,
  user_id    uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists auth_sessions_user_idx on public.auth_sessions (user_id);

-- ── Избранное (команда / лига) ─────────────────────────────────
create table if not exists public.favorites (
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null check (kind in ('team', 'league')),
  ref_id     text not null,                         -- id команды или ключ лиги
  name       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

-- ── Сигналы (этап 4 — на будущее, чтобы не мигрировать дважды) ─
create table if not exists public.signals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.users (id) on delete cascade,
  game_id     bigint not null,
  match       text not null default '',
  league      text not null default '',
  market      text not null default '',
  key         text not null,                        -- 1|X|2|tb15|tm15|tb25|…|btts_yes|btts_no
  pick        text not null,
  odds        numeric,
  confidence  text not null default '',
  match_ts    timestamptz,
  status      text not null default 'pending'
              check (status in ('pending', 'won', 'lost', 'void')),
  result_score text,
  checked_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists signals_user_idx on public.signals (user_id, created_at desc);
create index if not exists signals_game_idx on public.signals (game_id);

-- ── RLS: доступ только через service_role (сервер) ─────────────
alter table public.users         enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.favorites     enable row level security;
alter table public.signals       enable row level security;
-- политик нет: anon/authenticated не имеют доступа, service_role — имеет.
