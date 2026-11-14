// Pure logic: answer checking, spaced repetition, session building. No DOM, no storage.

export const BOX_DAYS = [0, 1, 3, 7, 14, 30, 60, 120]; // box → days until next review
export const MASTERED_BOX = 3;
export const FIX_DAYS = 3; // a mistake leaves the list after being right on 3 different days

// ── dates (always the device's local calendar day) ──────────────────────────
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(day, n) {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

// ── text ────────────────────────────────────────────────────────────────────
export const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export const slug = s =>
  stripAccents(s.toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export function normalize(s) {
  return String(s ?? '').normalize('NFC').toLowerCase()
    .replace(/[’‘`´]/g, "'").replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .replace(/[«»"“”.,!?;:…()\[\]]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s*'\s*/g, "'")
    .replace(/\s+/g, ' ').trim();
}

/** "s'il [vous|te] plaît" → both sentences; "[très |]bien" → optional word. Mirrors tools/validate.py. */
export function expand(ans) {
  const parts = ans.split(/\[([^\[\]]*)\]/);
  let out = [''];
  parts.forEach((p, i) => {
    const opts = i % 2 ? p.split('|') : [p];
    out = out.flatMap(o => opts.map(x => o + x));
  });
  return out.map(s => s.replace(/\s+/g, ' ').trim());
}

/** First variant of the first answer: what we show as "the" correct answer. */
export const canonical = answers => expand(answers[0])[0];

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Grade a typed answer. score: 1 exact (after normalization), 0.5 only accents differ, 0 wrong.
 * `best` is the accepted answer closest to what was typed (for feedback and diff).
 */
export function check(given, answers, extra = []) {
  const cands = [...answers.flatMap(expand), ...extra];
  const g = normalize(given);
  if (!g) return { score: 0, kind: 'empty', best: cands[0] };
  const exact = cands.find(c => normalize(c) === g);
  if (exact) return { score: 1, kind: 'exact', best: exact };
  const ga = stripAccents(g);
  const acc = cands.find(c => stripAccents(normalize(c)) === ga);
  if (acc) return { score: 0.5, kind: 'accent', best: acc };
  let best = cands[0], bd = Infinity;
  for (const c of cands) {
    const d = levenshtein(stripAccents(normalize(c)), ga);
    if (d < bd) [best, bd] = [c, d];
  }
  return { score: 0, kind: 'wrong', best };
}

/** Word-level diff: marks typed words that are not in the expected answer, and missing expected words. */
export function wordDiff(given, expected) {
  const a = normalize(given).split(' ').filter(Boolean);
  const b = normalize(expected).split(' ').filter(Boolean);
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const gotOk = new Array(a.length).fill(false), expOk = new Array(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { gotOk[i++] = expOk[j++] = true; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return { given: a.map((w, i) => ({ w, ok: gotOk[i] })), expected: b.map((w, j) => ({ w, ok: expOk[j] })) };
}

// ── content → items ─────────────────────────────────────────────────────────
const bare = fr => fr.replace(/\s*\([^)]*\)/g, '').trim(); // "l'hôtel (m.)" → "l'hôtel"

/** Flashcards + typed vocab drills generated from a lesson's vocab/expressions/grammar. Stable ids. */
export function deriveItems(L) {
  const p = `L${String(L.n).padStart(3, '0')}`, used = new Set(), out = [];
  const uid = id => { let k = id, i = 2; while (used.has(k)) k = `${id}-${i++}`; used.add(k); return k; };
  for (const v of L.vocab || []) {
    const s = slug(v.fr), note = [v.note, v.pos && `(${v.pos})`].filter(Boolean).join(' ');
    out.push({ id: uid(`${p}-v-${s}-fi`), type: 'flash', level: 1, concept: 'vocab', kind: 'vocab',
      front: v.fr, back: v.it, note, speak: bare(v.fr) });
    out.push({ id: uid(`${p}-v-${s}-w`), type: 'write', level: 2, concept: 'vocab', kind: 'vocab',
      prompt: v.it, answers: [bare(v.fr)], front: v.it, back: v.fr, note, ask: 'Scrivi in francese' });
  }
  for (const x of L.expressions || [])
    out.push({ id: uid(`${p}-x-${slug(x.fr)}`), type: 'write', level: 2, concept: 'idioms', kind: 'expr',
      prompt: x.it, answers: [bare(x.fr)], front: x.it, back: x.fr, note: x.note || '', ask: 'Come si dice in francese?' });
  for (const g of L.grammar || [])
    out.push({ id: uid(`${p}-g-${slug(g.title_it)}`), type: 'flash', level: 2, concept: g.id, kind: 'rule',
      front: g.title_it, back: g.explain_it, examples: g.examples || [] });
  return out.map(it => ({ ...it, lesson: L.n, derived: true }));
}

export function lessonItems(L) {
  return [...(L.exercises || []).map(e => ({ ...e, lesson: L.n })), ...deriveItems(L)];
}

// ── spaced repetition ───────────────────────────────────────────────────────
export const newState = () =>
  ({ box: 0, due: null, seen: 0, lapses: 0, streak: 0, mistake: false, fixDays: 0, fixLast: null, last: null, extra: [] });

export function grade(prev, score, today) {
  const s = { ...newState(), ...prev, seen: (prev?.seen || 0) + 1, last: today };
  if (score >= 1) {
    s.box = Math.min(s.box + 1, BOX_DAYS.length - 1);
    s.streak += 1;
    if (s.mistake && s.fixLast !== today) {
      s.fixDays += 1;
      s.fixLast = today;
      if (s.fixDays >= FIX_DAYS) s.mistake = false;
    }
  } else {
    s.streak = 0;
    s.mistake = true;
    s.fixDays = 0;
    s.fixLast = null;
    if (score > 0) s.box = Math.max(1, s.box - 1);   // "almost": step back, not to zero
    else { s.box = 0; s.lapses += 1; }               // wrong: relearn today
  }
  s.due = addDays(today, BOX_DAYS[s.box]);
  return s;
}

export const isDue = (st, today) => !!st && !!st.due && st.due <= today;
export const isMastered = st => !!st && st.box >= MASTERED_BOX && !st.mistake;

// ── sessions ────────────────────────────────────────────────────────────────
export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Other items testing the same concept (never for plain vocab), same lesson first, unseen/weak first. */
export function siblings(item, pool, states, exclude = new Set()) {
  if (!item.concept || item.concept === 'vocab') return [];
  const st = id => states[id];
  return pool
    .filter(x => x.concept === item.concept && x.id !== item.id && !exclude.has(x.id) && x.type !== 'flash')
    .map(x => [x, (x.lesson === item.lesson ? 0 : 2) + (st(x.id) ? (isMastered(st(x.id)) ? 2 : 1) : 0) + Math.random()])
    .sort((a, b) => a[1] - b[1])
    .map(([x]) => x);
}

const byUrgency = states => (a, b) => {
  const sa = states[a.id], sb = states[b.id];
  return (sb.lapses - sa.lapses) || (sa.box - sb.box) || String(sa.due).localeCompare(String(sb.due));
};

/**
 * Pick the items of a session.
 * mode: 'lesson' (lesson+level, or level 'flash'), 'review' (daily), 'mistakes', 'wave' (second wave).
 */
export function buildSession({ mode, pool, states, today, lesson, level, size = 15 }) {
  const st = id => states[id];
  if (mode === 'lesson') {
    const inLesson = pool.filter(x => x.lesson === lesson &&
      (level === 'flash' ? !!x.front : x.level === level && !(x.type === 'flash' && x.derived)));
    const ordered = xs => {
      const due = xs.filter(x => isDue(st(x.id), today)).sort(byUrgency(states));
      const fresh = shuffle(xs.filter(x => !st(x.id)));
      const rest = xs.filter(x => st(x.id) && !isDue(st(x.id), today))
        .sort((a, b) => String(st(a.id).last).localeCompare(String(st(b.id).last)) || st(a.id).box - st(b.id).box);
      return [...due, ...fresh, ...rest];
    };
    if (level === 'flash') return ordered(inLesson).slice(0, size);
    // generated vocab drills fill at most a third of an exercise session
    const authored = ordered(inLesson.filter(x => !x.derived));
    const drills = ordered(inLesson.filter(x => x.derived));
    const k = Math.min(drills.length, Math.max(size - authored.length, Math.floor(size / 3)));
    return interleave(shuffle([...authored.slice(0, size - k), ...drills.slice(0, k)]));
  }
  if (mode === 'mistakes') {
    const wrong = pool.filter(x => st(x.id)?.mistake).sort(byUrgency(states)).slice(0, Math.ceil(size * 0.7));
    const chosen = new Set(wrong.map(x => x.id)), out = [];
    for (const x of wrong) {
      out.push(x);
      const sib = siblings(x, pool, states, chosen)[0];
      if (sib && out.length < size) { out.push(sib); chosen.add(sib.id); }
    }
    return out.slice(0, size);
  }
  if (mode === 'wave') {
    return shuffle(pool.filter(x => x.lesson === lesson && (x.type === 'write' || x.kind === 'expr') && x.level >= 2))
      .slice(0, size);
  }
  // review: mistakes due → agent items never seen → everything due (weakest first) → new from current lesson
  const due = pool.filter(x => isDue(st(x.id), today));
  const mistakes = due.filter(x => st(x.id).mistake).sort(byUrgency(states));
  const agent = pool.filter(x => x.agent && !st(x.id));
  const other = due.filter(x => !st(x.id).mistake).sort(byUrgency(states));
  const fresh = pool.filter(x => x.lesson === lesson && !st(x.id) && !x.agent).sort((a, b) => a.level - b.level);
  const seen = new Set(), out = [];
  for (const x of [...mistakes, ...agent.slice(0, 8), ...other, ...fresh]) {
    if (out.length >= size) break;
    if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  return interleave(out);
}

/** Avoid two items of the same type in a row when possible (keeps sessions varied). */
export function interleave(items) {
  const left = [...items], out = [];
  while (left.length) {
    const prev = out[out.length - 1]?.type;
    const i = left.findIndex(x => x.type !== prev);
    out.push(left.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

/** Where to re-insert a failed item and which variant to add, inside a running session. */
export function requeue(queue, pos, item, pool, states, tries) {
  const q = [...queue];
  if ((tries[item.id] || 0) < 2) q.splice(Math.min(pos + 4, q.length), 0, item);
  const inQ = new Set(q.map(x => x.id));
  const sib = siblings(item, pool, states, inQ)[0];
  if (sib) q.splice(Math.min(pos + 2, q.length), 0, sib);
  return q;
}

// ── statistics ──────────────────────────────────────────────────────────────
export function streakDays(days, today) {
  let n = 0, d = days[today] ? today : addDays(today, -1);
  while (days[d]) { n++; d = addDays(d, -1); }
  return n;
}
