# Francese · Assimil trainer

Offline-first PWA (no build step, no dependencies) for the Assimil course *Il francese*:
100 lessons, each with a theory/vocab page, flashcards, and easy/medium/hard exercises.
Every answer is logged; mistakes come back until you get them right on 3 different days,
together with variants on the same grammar point.

## Run / deploy

Any static HTTPS host works (Netlify, Vercel, GitHub Pages, Cloudflare Pages); paths are relative.
On the phone: open the URL → browser menu → *Add to home screen*. After the first load it works offline.

After changing content or app files: `python3 tools/build.py` (validates lessons, builds
`content/bundle.json` and `docs/CURRICULUM.md`, bumps the service-worker version so phones update).

## Sync + coaching agent (optional)

1. Supabase → SQL editor → run `supabase/schema.sql`, then `insert into fr_secret values ('<passphrase>');`
2. App → Impostazioni → project URL, anon key, passphrase.
3. Agent session in this repo: follow `agent/AGENT.md` (`agent/fr_agent.py pull | stats | push | report`).
   Without Supabase: *Esporta dati* in the app → `fr_agent.py pull --from-export file.json`, and import
   the agent's pack (`agent/packs/*.json`) with *Importa file*.

## Layout

| path | |
|---|---|
| `content/lessons/LNNN.json` | one lesson: vocab, grammar (Italian), expressions, exercises — format in `agent/CONTENT_SPEC.md` |
| `core.js` | answer checking, spaced repetition, session building (tests: `node --test tests/core.test.mjs`) |
| `app.js` `db.js` `sync.js` | UI, IndexedDB storage + outbox, Supabase sync |
| `agent/` | coaching-agent CLI and playbook, book outline |
| `tools/` | `validate.py`, `build.py` |

The book PDFs are never committed (`source/` is git-ignored).
