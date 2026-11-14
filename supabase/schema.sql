-- French trainer — Supabase schema. Run once: Dashboard → SQL Editor → paste → Run.
-- Then set your sync passphrase (same string you type in the app's Settings):
--   insert into fr_secret values ('choose-a-long-random-passphrase');
-- Access needs the header  x-sync-key: <passphrase>  (the app and agent/fr_agent.py send it).

create table if not exists fr_attempts (       -- append-only answer log
  id        uuid primary key,                  -- generated on the device → idempotent re-sync
  ex_id     text not null,
  lesson    int  not null,
  type      text not null,                     -- mcq | order | cloze | write | dictation | flash
  level     int  not null,
  concept   text not null,
  score     real not null,                     -- 0 wrong, 0.5 almost (accent / "quasi"), 1 right
  given     text,                              -- what the learner typed / chose
  expected  text,                              -- canonical answer shown
  mode      text not null,                     -- lesson | review | mistakes | flash | wave
  ms        int,                               -- time to answer
  override  boolean not null default false,    -- learner pressed "Avevo ragione"
  flag      text,                              -- learner's problem report, if any
  ts        timestamptz not null,
  device    text
);
create index if not exists fr_attempts_ts on fr_attempts (ts);

create table if not exists fr_progress (       -- spaced-repetition state, one row per exercise
  ex_id      text primary key,
  state      jsonb not null,                   -- {box, due, seen, lapses, streak, mistake, last, extra}
  updated_at timestamptz not null,             -- device clock: last write wins
  synced_at  timestamptz not null default now() -- server clock: the app's pull cursor (trigger below)
);

create table if not exists fr_meta (           -- small key/value: current_lesson, settings
  k          text primary key,
  v          jsonb not null,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now()
);

create table if not exists fr_exercises (      -- exercises written by the coaching agent
  id         text primary key,                 -- A-YYYYMMDD-k
  lesson     int  not null,
  payload    jsonb not null,                   -- exercise object (agent/CONTENT_SPEC.md)
  reason     text,
  parent     text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now()
);

create table if not exists fr_reports (        -- coach notes shown on the app's home screen
  id         text primary key,
  title      text not null,
  body       text not null,
  focus      text[] not null default '{}',
  created_at timestamptz not null default now(),
  synced_at  timestamptz not null default now()
);

-- synced_at is always the server's clock, on insert and on every upsert, so a device pulling
-- "synced_at > last value I saw" never misses rows stamped by another device's (skewed) clock.
create or replace function fr_touch() returns trigger language plpgsql as $$
begin new.synced_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['fr_progress','fr_meta','fr_exercises','fr_reports'] loop
    execute format('drop trigger if exists fr_touch on %I', t);
    execute format('create trigger fr_touch before insert or update on %I for each row execute function fr_touch()', t);
  end loop;
end $$;

-- Passphrase gate: rows are visible only to requests carrying the right x-sync-key header.
create table if not exists fr_secret (k text primary key);
alter table fr_secret enable row level security;      -- no policies → unreadable via the API

create or replace function fr_key_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from fr_secret
    where k = coalesce(current_setting('request.headers', true)::json ->> 'x-sync-key', '')
  );
$$;

do $$
declare t text;
begin
  foreach t in array array['fr_attempts','fr_progress','fr_meta','fr_exercises','fr_reports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists fr_gate on %I', t);
    execute format('create policy fr_gate on %I for all using (fr_key_ok()) with check (fr_key_ok())', t);
  end loop;
end $$;
