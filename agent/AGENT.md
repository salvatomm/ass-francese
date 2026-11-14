# Coaching agent playbook

You analyse the learner's results (Italian speaker, Assimil French) and push targeted
exercises back to the app. Exercise format and concept keys: `agent/CONTENT_SPEC.md`
(do not restate it; follow it). Never touch `content/lessons/` except to fix a wrong key.

## 1. Setup
- Supabase: `export FR_SUPABASE_URL=... FR_SUPABASE_KEY=... FR_SYNC_KEY=...`, then
  `python3 agent/fr_agent.py pull`.
- No Supabase: ask the user for the app's backup export, then
  `python3 agent/fr_agent.py pull --from-export FILE`. Packs are then delivered as
  files in `agent/packs/` for manual import in the app (Settings -> import).

## 2. Loop
1. `pull`
2. `python3 agent/fr_agent.py stats --days 30` (also try `--days 14` for recent shifts)
3. Diagnose (section 3)
4. Write a pack `agent/packs/A-YYYYMMDD.json` = `{"exercises": [...]}`
5. `python3 agent/fr_agent.py push PACK --dry-run`, fix errors, then `push PACK`
6. Retire mastered agent exercises (section 5)
7. Write the report and send it with `report` (section 6)

## 3. Diagnose
- Rank concepts by error rate, but ignore ones with fewer than ~5 attempts.
- Persistence: a weak concept with a flat or worsening trend (1st half -> 2nd half)
  needs new exercises; an improving one only needs a light touch.
- Accent vs real errors: `quasi` / accent-only counts are spelling-accents work
  (dictation, write with accents), not grammar failure. Do not conflate them.
- Read the `given -> expected` pairs: look for confusions (avoir for être, du vs de la,
  missing de after negation, false friends, gender guessed from Italian).
- Overrides ("I was right") and flags mean the answer key may be wrong or too narrow.
  Check the exercise in `content/lessons/` or the agent pack. If the learner is right:
  retire the agent exercise and re-issue a corrected one, or edit the lesson file
  (add the accepted answer) and tell the user in the report. Never ignore them.
- Leeches (lapses >= 3): rephrase, split into smaller steps, or add a flash with the rule.
- Mind `current_lesson`: only judge material the learner has actually reached.

## 4. Write targeted exercises
- Material only up to `current_lesson`, with at most a slight stretch (+1/+2 lessons).
  Original sentences; Italian explanations; impeccable French.
- 3-5 variants per weak concept, in different forms: `mcq` for recognition, `cloze`
  for controlled production, `write` for free production, optional `flash` for the rule.
- Prefer contrastive pairs exploiting Italian interference: auxiliary être/avoir,
  partitive vs article, de after negation, false friends, gender mismatches
  (le/la vs il/la), prepositions.
- If a variant targets a specific failed item, set `parent` to its ex_id.
- `reason` must cite the evidence, e.g. "5 errori su partitif in 30 gg, soprattutto
  `du pain -> de pain` dopo negazione (L012-e07)".
- `lesson` = the lesson whose material is targeted. Ids `A-YYYYMMDD-k` (k = 1, 2, ...);
  never reuse an id from an earlier pack unless you mean to replace it.
- Typically 15-40 exercises per session; fewer if the data is thin. Mix levels 1-3.
- Accepted answers: list synonyms and tu/vous variants so correct answers are not marked
  wrong (see the answer syntax in CONTENT_SPEC.md).

## 5. Retire
Agent exercises (ids `A-...`) are mastered when their progress state shows
`streak >= 4` or `box` at the top, and their concept's recent error rate is < 10%.
Also retire wrong or obsolete ones. Run `python3 agent/fr_agent.py retire A-... A-...`.
Inspect `agent/data/exercises.json` and `progress.json` to decide.

## 6. Report
Write a short Markdown file in Italian (<= 25 lines), then:
`python3 agent/fr_agent.py report FILE.md --title "Titolo" --focus concept1,concept2`
Sections, in this order:
- **Punti forti** - 2-3 bullets with numbers.
- **Punti deboli** - 2-4 bullets: concept, evidence, typical confusion.
- **Cosa ho aggiunto** - n. esercizi, per quali concetti; what was retired or fixed.
- **Consiglio per la settimana** - one concrete suggestion (e.g. 10 minuti al giorno
  in modalita errori, rileggere la nota sul partitivo della lezione N).
Tone: encouraging, specific, no jargon. Never invent numbers; use the stats output.

## 7. Rules
- Always validate before pushing; fix every ERROR.
- Never put secrets in files or the report. `agent/data/` is git-ignored.
- Do not run `push` twice for the same unchanged pack unnecessarily (upsert is idempotent,
  but it bumps `updated_at`).
