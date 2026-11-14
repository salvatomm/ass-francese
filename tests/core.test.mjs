import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expand, normalize, check, grade, newState, buildSession, deriveItems, addDays, wordDiff,
  streakDays, requeue, FIX_DAYS } from '../core.js';

test('expand alternatives and optional parts', () => {
  assert.deepEqual(expand("s'il [vous|te] plaît"), ["s'il vous plaît", "s'il te plaît"]);
  assert.deepEqual(expand('Il est [très |]content.'), ['Il est très content.', 'Il est content.']);
  assert.deepEqual(expand('[a|b] [c|d]').length, 4);
});

test('normalize ignores case, punctuation, apostrophe and hyphen styles', () => {
  assert.equal(normalize('  Qu’est-ce que   C\'EST ? '), "qu'est ce que c'est");
  assert.equal(normalize("l' homme"), "l'homme");
  assert.equal(normalize('Œuf'), 'oeuf');
});

test('check: exact, accent-only, wrong', () => {
  const ans = ["Je voudrais un café, s'il [vous|te] plaît."];
  assert.equal(check("je voudrais un café s'il te plait", ans).score, 0.5);
  assert.equal(check("Je voudrais un café, s'il te plaît", ans).score, 1);
  const w = check('je veux un café', ans);
  assert.equal(w.score, 0);
  assert.equal(w.kind, 'wrong');
  assert.equal(check('', ans).kind, 'empty');
  assert.equal(check('je veux un cafe', ans, ['je veux un café']).score, 0.5); // learner override list
});

test('wordDiff marks wrong and missing words', () => {
  const d = wordDiff('je mange une pomme', 'je mange la pomme');
  assert.deepEqual(d.given.map(x => x.ok), [true, true, false, true]);
  assert.deepEqual(d.expected.map(x => x.ok), [true, true, false, true]);
});

test('grade: wrong resets to box 0 due today; mistake clears after FIX_DAYS different days', () => {
  const t = '2026-11-14';
  let s = grade(newState(), 1, t);
  assert.equal(s.box, 1); assert.equal(s.due, '2026-11-15');
  s = grade(s, 0, t);
  assert.equal(s.box, 0); assert.equal(s.due, t); assert.equal(s.mistake, true); assert.equal(s.lapses, 1);
  s = grade(s, 1, t); s = grade(s, 1, t);            // same day twice counts once
  assert.equal(s.fixDays, 1); assert.equal(s.mistake, true);
  for (let i = 1; i < FIX_DAYS; i++) s = grade(s, 1, addDays(t, i));
  assert.equal(s.mistake, false);
  const a = grade({ ...newState(), box: 4 }, 0.5, t);
  assert.equal(a.box, 3); assert.equal(a.mistake, true); assert.equal(a.lapses, 0);
});

test('addDays crosses month and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('deriveItems: stable ids, article kept, annotation stripped', () => {
  const L = { n: 6, vocab: [{ fr: "l'hôtel (m.)", it: "l'albergo", pos: 'n' }],
    expressions: [{ fr: 'Ça fait combien ?', it: 'Quanto fa?' }],
    grammar: [{ id: 'avoir', title_it: 'Il verbo avoir', explain_it: '...' }] };
  const items = deriveItems(L);
  assert.deepEqual(items.map(i => i.id), ['L006-v-l-hotel-m-fi', 'L006-v-l-hotel-m-w', 'L006-x-ca-fait-combien', 'L006-g-il-verbo-avoir']);
  assert.deepEqual(items[1].answers, ["l'hôtel"]);
  assert.ok(items.every(i => i.lesson === 6));
});

const pool = [
  { id: 'a', lesson: 1, level: 1, type: 'mcq', concept: 'etre' },
  { id: 'b', lesson: 1, level: 1, type: 'order', concept: 'etre' },
  { id: 'c', lesson: 1, level: 2, type: 'write', concept: 'avoir' },
  { id: 'd', lesson: 2, level: 2, type: 'write', concept: 'etre' },
  { id: 'e', lesson: 2, level: 1, type: 'mcq', concept: 'vocab' },
  { id: 'z', lesson: 2, level: 2, type: 'write', concept: 'etre', agent: true },
];

test('review: mistakes first, agent items included, nothing beyond pool', () => {
  const today = '2026-11-14';
  const states = { c: { ...newState(), box: 0, due: today, mistake: true, lapses: 2 },
    a: { ...newState(), box: 2, due: today }, b: { ...newState(), box: 3, due: '2026-12-01' } };
  const s = buildSession({ mode: 'review', pool, states, today, lesson: 2, size: 10 });
  assert.equal(s[0].id, 'c');
  assert.ok(s.some(x => x.id === 'z'));
  assert.ok(!s.some(x => x.id === 'b'));
});

test('mistakes mode pairs each mistake with a same-concept variant', () => {
  const today = '2026-11-14';
  const states = { a: { ...newState(), mistake: true, lapses: 1, due: today } };
  const s = buildSession({ mode: 'mistakes', pool, states, today, size: 10 });
  assert.equal(s[0].id, 'a');
  assert.equal(s[1].concept, 'etre');
  assert.notEqual(s[1].id, 'a');
});

test('requeue re-inserts failed item and a variant, at most twice', () => {
  const q = pool.slice(0, 3);
  const r = requeue(q, 0, pool[0], pool, {}, {});
  assert.equal(r.filter(x => x.id === 'a').length, 2);
  assert.equal(r.length, 5);
  const r2 = requeue(q, 0, pool[0], pool, {}, { a: 2 });
  assert.equal(r2.filter(x => x.id === 'a').length, 1);
});

test('streak counts consecutive days up to today or yesterday', () => {
  const days = { '2026-11-12': 5, '2026-11-13': 3 };
  assert.equal(streakDays(days, '2026-11-14'), 2);
  assert.equal(streakDays({ ...days, '2026-11-14': 1 }, '2026-11-14'), 3);
  assert.equal(streakDays(days, '2026-11-16'), 0);
});
