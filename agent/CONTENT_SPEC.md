# Content spec — lesson files and exercise packs

Single source of truth for everything the app shows. Used by the seed-content
authors and by the coaching agent (see `AGENT.md`). Validate with
`python3 tools/validate.py` (exit code 0 = OK).

## Ground rules

- **Extract, don't transcribe.** From the book take the vocabulary, the grammar
  (re-explained in your own words, in Italian), short idiomatic expressions
  (≤ 8 words each) and the cultural/pronunciation points. Never copy whole dialogue
  lines, the book's exercise sentences or its notes verbatim; the learner has the book.
  Every exercise sentence is original, built from the lesson's vocabulary and grammar.
- The source PDF is the English-base edition (*French*, Assimil 2020): same French
  lessons as *Il francese*. All glosses and explanations must be in **Italian**.
- **Progression.** An exercise of lesson *n* may only use grammar introduced in
  lessons ≤ *n* (see `book_outline.md`) plus very common words. Hard items
  should recycle material from earlier lessons.
- **French must be impeccable**: accents, elision (`l'`, `j'`, `qu'`), agreement,
  French typography spacing is NOT required (`?`, `!` without space is fine).
  Use straight apostrophes `'`.
- Italian is the UI/explanation language (`*_it` fields, prompts).

## Lesson file: `content/lessons/L{nnn}.json`

```jsonc
{
  "n": 12,                              // 1..100
  "title_fr": "Au marché (Deuxième partie)",
  "title_it": "Al mercato (seconda parte)",
  "review": false,                      // true for 7, 14, ..., 98
  "status": "verified",                 // "verified" = extracted from the book;
                                        // "outline" = only from the public TOC
  "source": "529edcbd p17-19",          // pdf id + pages actually used (optional)
  "theme_it": "Situazione della lezione in 1–3 frasi.",
  "grammar": [                          // one per book note that teaches grammar/usage
                                        // (usually 2–6; review lessons: each recap section)
    {
      "id": "partitif",                 // a concept key (see list below)
      "title_it": "L'articolo partitivo",
      "explain_it": "Spiegazione chiara e breve, con il confronto con l'italiano.",
      "examples": [{ "fr": "Je voudrais du pain.", "it": "Vorrei del pane." }]
    }
  ],
  "vocab": [                            // 15–30 items (review lessons: may be [])
    { "fr": "le marché", "it": "il mercato", "pos": "n" },   // nouns WITH article; l' → add " (m.)"/" (f.)"
    { "fr": "peser", "it": "pesare", "pos": "v", "note": "je pèse" }
  ],
  "expressions": [                      // 4–12 idiomatic chunks used in the lesson (≤ 8 words)
    { "fr": "Ça fait combien ?", "it": "Quanto fa?", "note": "registro colloquiale" }
  ],
  "notes_it": ["Note culturali, falsi amici, pronuncia (2–5 voci)."],
  "exercises": [ /* see below */ ]
}
```

`pos` ∈ `n v adj adv prep conj pron expr num interj`.

## Exercises

Common fields:

| field | | |
|---|---|---|
| `id` | required | `L{nnn}-{tag}` unique, e.g. `L012-e07`. Agent items: `A-{yyyymmdd}-{k}` |
| `type` | required | `mcq` `order` `cloze` `write` `dictation` `flash` |
| `level` | required | 1 easy, 2 medium, 3 hard |
| `concept` | required | one key from the list below (kebab-case; add a new one only if none fits) |
| `explain_it` | recommended | 1–2 sentences shown after answering: *why* |
| `tags` | optional | free strings, e.g. `["false-friend"]` |

Per type:

- **mcq** — `prompt` (string), `options` (3–4 strings), `correct` (index).
- **order** (word tiles) — `prompt` (Italian sentence), `answers` (French; tiles are
  the words of `answers[0]` with the alternation syntax resolved to its first option),
  `distractors` (0–3 wrong words, optional). Keep ≤ 12 words.
- **cloze** — `text` (French with exactly one `___`), `answers` (strings that fill the
  blank), `hint` (optional, e.g. `"(aller, presente)"`), `prompt` (optional Italian translation).
- **write** — `prompt` (what to transform/translate), `answers` (accepted French
  answers), `ask` (optional instruction; default “Traduci in francese”). Use `ask` for
  transformations: `"Volgi al passé composé"`, `"Rispondi negativamente"`, …
- **dictation** — `text` (French, read by TTS), `answers` (optional; defaults to `[text]`).
- **flash** (self-graded) — `front`, `back`, `note` (optional). Use for grammar rules,
  conjugation tables, contrasts. Vocabulary/expression cards are generated
  automatically from `vocab`/`expressions`: don't duplicate them.

### Answer syntax (`answers` of order/cloze/write/dictation)

- List every genuinely different accepted answer.
- `[a|b]` = alternatives inside a sentence; `[a|]` = optional part. No nesting.
  `"Je voudrais un café, s'il [vous|te] plaît."` accepts both forms.
- Accept tu/vous variants when the Italian is ambiguous; accept common synonyms.
- The checker ignores case, punctuation, apostrophe/quote styles, hyphen vs space and
  extra spaces. Accents count (a pure accent error scores "quasi").

### Levels

| level | aim | typical types |
|---|---|---|
| 1 easy | recognition | mcq, order, cloze with hint |
| 2 medium | controlled production | cloze, short `write` (≤ 8 words), short dictation, rule flash |
| 3 hard | free production | long `write` (combine with earlier lessons), transformations, long dictation |

Minimums per normal lesson: **≥ 8 level-1, ≥ 10 level-2, ≥ 8 level-3**, with at
least 3 mcq, 3 order, 4 cloze, 8 write, 2 dictation, 2 flash.
Review lessons: **≥ 32 exercises**, mostly level 2–3, mixing the previous six lessons.

Variations: give 2–3 exercises the **same `concept`** with different sentences — the app
serves a sibling when you fail one, so the mistake is re-tested in a new form.

## Concept keys

```
pronunciation liaison spelling-accents
articles-definite articles-indefinite partitif de-after-negation contractions-au-du
gender plural adjective-agreement adjective-position adjectives-irregular
possessives demonstratives numbers time-date ce-cest-il-est tout indefinites
etre avoir aller faire venir modals present-er present-ir present-re present-irregular
imperative futur-proche passe-recent passe-compose-avoir passe-compose-etre
participle-agreement pronominal-verbs imparfait imparfait-vs-pc futur-simple
conditionnel si-clauses subjonctif plus-que-parfait passe-simple gerondif passive
negation negation-other questions interrogatives exclamatives
pronoun-cod pronoun-coi pronoun-y pronoun-en pronoun-order stressed-pronouns
relative-pronouns emphasis prepositions-place prepositions depuis-il-y-a
comparatives superlatives adverbs il-faut il-y-a
register idioms false-friends connectors vocab
```

## Agent exercise packs (`fr_exercises` table / import file)

Same exercise objects plus: `lesson` (int, the lesson whose material it targets),
`reason` (why it was created, e.g. "3 errori su partitif dopo negazione"),
`parent` (optional id of the failed item it varies). Import file format:
`{"exercises": [ ... ]}`.
