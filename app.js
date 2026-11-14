import * as db from './db.js';
import { sync, pending } from './sync.js';
import * as C from './core.js';

// ── state ───────────────────────────────────────────────────────────────────
const S = {
  lessons: [], byN: {}, items: [], byId: {}, states: {}, current: 1, days: {}, reports: [],
  device: '', session: null, settings: { rate: 0.9, goal: 30, theme: 'auto' },
};
const today = () => C.localDay();
const main = document.getElementById('main');
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(3, '0');
const LEVELS = { 1: 'Facile', 2: 'Medio', 3: 'Difficile' };

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ── speech (offline on most phones once a French voice is installed) ───────
let frVoice = null;
const pickVoice = () => { frVoice = speechSynthesis.getVoices().find(v => /^fr(-|_|$)/i.test(v.lang)) || null; };
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text, slow = false) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  if (frVoice) u.voice = frVoice;
  u.rate = S.settings.rate * (slow ? 0.6 : 1);
  speechSynthesis.speak(u);
}
const sp = (text, cls = '') => `<button class="say ${cls}" data-act="say" data-text="${h(text)}" aria-label="Ascolta">🔊</button>`;

// ── data loading ────────────────────────────────────────────────────────────
async function load() {
  const bundle = await (await fetch('content/bundle.json')).json();
  S.lessons = bundle.lessons;
  S.byN = Object.fromEntries(S.lessons.map(L => [L.n, L]));
  const agent = (await db.getAll('agentEx')).filter(x => x.active !== false);
  S.items = [...S.lessons.flatMap(C.lessonItems), ...agent];
  S.byId = Object.fromEntries(S.items.map(x => [x.id, x]));
  S.states = Object.fromEntries((await db.getAll('progress')).map(p => [p.ex_id, p.state]));
  S.current = await db.kvGet('current_lesson', 1);
  S.days = await db.kvGet('days', {});
  S.settings = { ...S.settings, ...(await db.kvGet('settings', {})) };
  S.reports = (await db.getAll('reports')).sort((a, b) => b.created_at.localeCompare(a.created_at));
  S.device = await db.kvGet('device', '') || (await db.kvSet('device', crypto.randomUUID()), await db.kvGet('device'));
  applyTheme();
}

const applyTheme = () => {
  if (S.settings.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.settings.theme;
};

const poolUpTo = n => S.items.filter(x => x.lesson <= n);
const lessonItemsOf = n => S.items.filter(x => x.lesson === n && !x.agent);
const mastery = n => {
  const its = lessonItemsOf(n).filter(x => !(x.derived && x.type === 'flash'));
  return its.length ? its.filter(x => C.isMastered(S.states[x.id])).length / its.length : 0;
};
const started = n => lessonItemsOf(n).some(x => S.states[x.id]);
const dueCount = () => poolUpTo(S.current).filter(x => C.isDue(S.states[x.id], today())).length;
const mistakeItems = () => S.items.filter(x => S.states[x.id]?.mistake);

// ── screens ─────────────────────────────────────────────────────────────────
function header(title, back = '#/') {
  return `<header class="bar"><a class="back" href="${back}" aria-label="Indietro">‹</a><h1>${title}</h1></header>`;
}

function ring(frac, label) {
  const deg = Math.round(frac * 360);
  return `<span class="ring" style="--deg:${deg}deg"><span>${label}</span></span>`;
}

function homeScreen() {
  const t = today(), done = S.days[t] || 0, goal = S.settings.goal;
  const streak = C.streakDays(S.days, t), due = dueCount(), mis = mistakeItems().length;
  const rep = S.reports[0];
  const weeks = [];
  for (let w = 0; w < Math.ceil(S.lessons.length / 7); w++) weeks.push(S.lessons.slice(w * 7, w * 7 + 7));
  return `
  <header class="top">
    <div><h1>Francese</h1><p class="muted">Assimil · lezione ${S.current}</p></div>
    <div class="chips"><span class="chip" title="Giorni di fila">🔥 ${streak}</span>
      <span class="chip" title="Risposte oggi">${done}/${goal}</span><span id="syncdot" class="dot"></span></div>
  </header>
  <div class="progress"><i style="width:${Math.min(100, done / goal * 100)}%"></i></div>
  <section class="cards">
    <button class="card primary" data-act="start" data-mode="review">
      <b>Ripasso di oggi</b><span>${due ? `${due} da ripassare` : 'Tutto in pari: nuove frasi della lezione ' + S.current}</span></button>
    <button class="card ${mis ? 'warn' : ''}" data-act="go" data-to="#/mistakes">
      <b>Errori</b><span>${mis ? `${mis} da sistemare` : 'Nessun errore aperto'}</span></button>
    ${S.current >= 50 ? `<button class="card" data-act="start" data-mode="wave" data-lesson="${S.current - 49}">
      <b>Seconda ondata</b><span>Traduci attivamente la lezione ${S.current - 49}</span></button>` : ''}
  </section>
  ${rep ? `<section class="coach"><b>Nota del coach · ${h(rep.title)}</b>${md(rep.body)}</section>` : ''}
  <section class="path">
    ${weeks.map((ws, w) => `<h2>Settimana ${w + 1}</h2>` + ws.map(L => {
      const m = mastery(L.n);
      return `<a class="lesson ${L.n === S.current ? 'current' : ''} ${L.n > S.current ? 'ahead' : ''}" href="#/lesson/${L.n}">
        ${ring(m, L.n)}<span class="lt"><b>${h(L.review ? 'Révision' : L.title_fr)}</b>
        <small>${h(L.title_it)}${started(L.n) ? ` · ${Math.round(m * 100)}%` : ''}</small></span></a>`;
    }).join('')).join('')}
  </section>`;
}

function lessonScreen(n) {
  const L = S.byN[n];
  if (!L) return header('Lezione non trovata');
  const its = lessonItemsOf(n);
  const count = lv => its.filter(x => x.level === lv && !(x.type === 'flash' && x.derived)).length;
  const flash = its.filter(x => x.front).length;
  const done = lv => {
    const xs = its.filter(x => x.level === lv && !(x.type === 'flash' && x.derived));
    return xs.length ? Math.round(xs.filter(x => S.states[x.id]).length / xs.length * 100) : 0;
  };
  return `${header(`Lezione ${n}`)}
  <section class="lhead"><h2>${h(L.title_fr)}</h2><p class="muted">${h(L.title_it)}</p><p>${h(L.theme_it)}</p>
    ${L.status !== 'verified' ? '<p class="note">Contenuto da verificare sul libro.</p>' : ''}
    ${n === S.current ? '<span class="chip">Lezione attuale</span>'
      : `<button class="ghost" data-act="setcur" data-n="${n}">Imposta come lezione attuale</button>`}</section>
  <section class="grid">
    <a class="tile" href="#/theory/${n}"><b>📖 Teoria</b><span>${L.grammar.length} regole · ${L.vocab.length} parole</span></a>
    <button class="tile" data-act="start" data-mode="lesson" data-lesson="${n}" data-level="flash"><b>🃏 Flashcard</b><span>${flash} carte</span></button>
    ${[1, 2, 3].map(lv => `<button class="tile lv${lv}" data-act="start" data-mode="lesson" data-lesson="${n}" data-level="${lv}">
      <b>${LEVELS[lv]}</b><span>${count(lv)} esercizi · ${done(lv)}% visti</span></button>`).join('')}
    <button class="tile" data-act="start" data-mode="mistakes" data-lesson="${n}"><b>Errori della lezione</b>
      <span>${its.filter(x => S.states[x.id]?.mistake).length} aperti</span></button>
  </section>`;
}

function theoryScreen(n) {
  const L = S.byN[n];
  if (!L) return header('Lezione non trovata');
  return `${header(`Teoria · ${n}`, `#/lesson/${n}`)}
  <article class="theory">
    <h2>${h(L.title_fr)}</h2>
    ${L.grammar.length ? '<h3>Grammatica</h3>' : ''}
    ${L.grammar.map(g => `<div class="rule"><b>${h(g.title_it)}</b><p>${h(g.explain_it)}</p>
      ${(g.examples || []).map(e => `<p class="ex">${sp(e.fr)}<span lang="fr">${h(e.fr)}</span><small>${h(e.it)}</small></p>`).join('')}</div>`).join('')}
    ${L.vocab.length ? `<h3>Vocabolario</h3><table class="vocab">${L.vocab.map(v =>
      `<tr><td>${sp(v.fr.replace(/\s*\([^)]*\)/g, ''))}</td><td lang="fr">${h(v.fr)}</td><td>${h(v.it)}${v.note ? `<small>${h(v.note)}</small>` : ''}</td></tr>`).join('')}</table>` : ''}
    ${L.expressions.length ? `<h3>Espressioni</h3><table class="vocab">${L.expressions.map(x =>
      `<tr><td>${sp(x.fr)}</td><td lang="fr">${h(x.fr)}</td><td>${h(x.it)}${x.note ? `<small>${h(x.note)}</small>` : ''}</td></tr>`).join('')}</table>` : ''}
    ${(L.notes_it || []).length ? `<h3>Note</h3><ul>${L.notes_it.map(t => `<li>${h(t)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

function lastWrong(id) {
  return S.lastWrong?.[id];
}

function mistakesScreen() {
  const mis = mistakeItems();
  const concepts = [...new Set(mis.map(x => x.concept))].sort();
  const f = S.mistakeFilter || '';
  const shown = mis.filter(x => !f || x.concept === f)
    .sort((a, b) => (S.states[b.id].lapses - S.states[a.id].lapses) || a.lesson - b.lesson);
  return `${header('Errori')}
  <section class="lhead"><p>Ogni errore torna finché non rispondi giusto in <b>${C.FIX_DAYS} giorni diversi</b>.
    Quando sbagli, ricevi anche una variante sullo stesso argomento.</p>
    <div class="row"><button class="primary" data-act="start" data-mode="mistakes" ${mis.length ? '' : 'disabled'}>Allena errori (${mis.length})</button>
    <select data-act="filter">${['', ...concepts].map(c => `<option value="${h(c)}" ${c === f ? 'selected' : ''}>${c ? h(c) : 'Tutti gli argomenti'}</option>`).join('')}</select></div></section>
  <ul class="mlist">${shown.map(x => {
    const st = S.states[x.id], w = lastWrong(x.id);
    return `<li><div class="mtop"><span class="chip">L${x.lesson}</span><span class="chip">${h(x.concept)}</span>
      <span class="fix">${'●'.repeat(st.fixDays)}${'○'.repeat(C.FIX_DAYS - st.fixDays)}</span></div>
      <p>${h(promptText(x))}</p><p class="ok" lang="fr">✓ ${h(answerText(x))}</p>
      ${w ? `<p class="bad" lang="fr">✗ ${h(w)}</p>` : ''}</li>`;
  }).join('') || '<li class="muted">Nessun errore aperto. Ottimo lavoro!</li>'}</ul>`;
}

function statsScreen() {
  const atts = S.attempts || [];
  const since = C.addDays(today(), -6);
  const week = atts.filter(a => a.ts.slice(0, 10) >= since);
  const acc = xs => xs.length ? Math.round(xs.reduce((s, a) => s + a.score, 0) / xs.length * 100) : 0;
  const byC = {};
  for (const a of atts) (byC[a.concept] ||= []).push(a);
  const concepts = Object.entries(byC).filter(([, xs]) => xs.length >= 3)
    .map(([c, xs]) => [c, acc(xs.slice(-30)), xs.length]).sort((a, b) => a[1] - b[1]);
  const days = [...Array(14)].map((_, i) => C.addDays(today(), i - 13));
  const max = Math.max(1, ...days.map(d => S.days[d] || 0));
  return `${header('Statistiche')}
  <section class="stats">
    <div class="kpis"><div><b>${week.length}</b><span>risposte (7 gg)</span></div>
      <div><b>${acc(week)}%</b><span>precisione (7 gg)</span></div>
      <div><b>${Object.values(S.states).filter(C.isMastered).length}</b><span>elementi consolidati</span></div></div>
    <h3>Ultimi 14 giorni</h3>
    <div class="bars">${days.map(d => `<i title="${d}: ${S.days[d] || 0}" style="height:${(S.days[d] || 0) / max * 100}%"></i>`).join('')}</div>
    <h3>Argomenti (dal più debole)</h3>
    <table class="vocab">${concepts.map(([c, p, n]) => `<tr><td>${h(c)}</td><td><div class="meter"><i style="width:${p}%"></i></div></td><td>${p}% · ${n}</td></tr>`).join('')
      || '<tr><td class="muted">Servono almeno 3 risposte per argomento.</td></tr>'}</table>
    <h3>Padronanza per lezione</h3>
    <div class="mastery">${S.lessons.filter(L => L.n <= S.current).map(L =>
      `<a href="#/lesson/${L.n}" title="Lezione ${L.n}" style="--m:${mastery(L.n)}">${L.n}</a>`).join('')}</div>
  </section>`;
}

function settingsScreen(sync = {}) {
  return `${header('Impostazioni')}
  <section class="form">
    <label>Lezione attuale (1–${S.lessons.length})<input type="number" min="1" max="${S.lessons.length}" id="cur" value="${S.current}"></label>
    <label>Obiettivo giornaliero (risposte)<input type="number" min="5" max="300" id="goal" value="${S.settings.goal}"></label>
    <label>Velocità voce<input type="range" min="0.5" max="1.2" step="0.05" id="rate" value="${S.settings.rate}"></label>
    <label>Tema<select id="theme">${['auto', 'light', 'dark'].map(t => `<option ${S.settings.theme === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <button class="primary" data-act="saveSettings">Salva</button>
    <h3>Sincronizzazione (Supabase)</h3>
    <p class="muted">Facoltativa. Serve al tuo agente per analizzare i risultati e mandarti esercizi mirati.</p>
    <label>URL progetto<input id="surl" placeholder="https://xxxx.supabase.co" value="${h(sync.url)}"></label>
    <label>Chiave pubblica (anon)<input id="skey" value="${h(sync.key)}"></label>
    <label>Passphrase di sync<input id="ssk" type="password" value="${h(sync.syncKey)}"></label>
    <div class="row"><button data-act="saveSync">Salva e sincronizza</button><span class="muted" id="syncinfo"></span></div>
    <h3>Backup e scambio con l'agente</h3>
    <div class="row"><button data-act="export">Esporta dati</button>
      <label class="button">Importa file<input type="file" accept=".json,application/json" id="imp" hidden></label></div>
    <p class="muted">Importa un backup oppure un pacchetto di esercizi preparato dall'agente ({"exercises": [...]}).</p>
    <h3>Zona pericolosa</h3>
    <button class="danger" data-act="reset">Azzera i progressi su questo telefono</button>
  </section>`;
}

const md = s => `<div class="md">${h(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')}</div>`;

// ── exercise text helpers ───────────────────────────────────────────────────
function promptText(x) {
  if (x.type === 'cloze') return x.text.replace('___', '____');
  if (x.type === 'dictation') return 'Dettato';
  return x.prompt || x.front || '';
}
function answerText(x) {
  if (x.type === 'mcq') return x.options[x.correct];
  if (x.type === 'flash') return x.back;
  if (x.type === 'cloze') return x.text.replace('___', C.canonical(x.answers));
  if (x.type === 'dictation') return x.text;
  return C.canonical(x.answers);
}

// ── session ─────────────────────────────────────────────────────────────────
function startSession({ mode, lesson, level }) {
  const n = lesson ? Number(lesson) : S.current;
  const lv = level === 'flash' ? 'flash' : Number(level);
  const pool = mode === 'lesson' || mode === 'wave' ? S.items.filter(x => !x.agent || x.lesson === n)
    : mode === 'mistakes' && lesson ? S.items.filter(x => x.lesson === n) : poolUpTo(S.current);
  const queue = C.buildSession({ mode, pool, states: S.states, today: today(), lesson: n, level: lv,
    size: lv === 'flash' ? 20 : 15 });
  if (!queue.length) return toast(mode === 'mistakes' ? 'Nessun errore da allenare 🎉' : 'Niente da fare qui per ora');
  S.session = { mode, lesson: n, flash: lv === 'flash', pool, queue, pos: 0, tries: {}, results: [], fb: null };
  location.hash = '#/session';
}

function renderSession() {
  const s = S.session;
  if (!s) { location.hash = '#/'; return ''; }
  if (s.pos >= s.queue.length) return resultScreen();
  const x = s.queue[s.pos];
  s.shownAt = performance.now();
  const asFlash = x.type === 'flash' || (s.flash && x.front);
  const body = asFlash ? flashView(x) : ({ mcq: mcqView, order: orderView, cloze: clozeView, write: writeView, dictation: dictView })[x.type](x);
  return `<header class="bar"><a class="back" href="#/" data-act="quit" aria-label="Esci">✕</a>
    <div class="progress"><i style="width:${s.pos / s.queue.length * 100}%"></i></div>
    <span class="chip">${x.agent ? '🎯 ' : ''}L${x.lesson}</span></header>
    <section class="ex" data-type="${asFlash ? 'flash' : x.type}">${body}</section>
    <section id="fb" class="fb" hidden></section>`;
}

const KEYS = ['é', 'è', 'ê', 'à', 'â', 'ç', 'ù', 'û', 'ô', 'î', 'ï', 'ë', 'œ', "'"];
const accentBar = () => `<div class="accents">${KEYS.map(k => `<button data-act="key" data-k="${k}" tabindex="-1">${k}</button>`).join('')}</div>`;
const input = (ph = 'Scrivi in francese…') =>
  `<textarea id="ans" rows="2" lang="fr" placeholder="${ph}" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>${accentBar()}`;
const checkBtn = `<button class="primary wide" data-act="check">Controlla</button>`;

function flashView(x) {
  const ex = (x.examples || []).map(e => `<p class="ex">${sp(e.fr)}<span lang="fr">${h(e.fr)}</span><small>${h(e.it)}</small></p>`).join('');
  const frontFr = x.kind === 'vocab' && x.speak;
  return `<p class="ask">${x.kind === 'rule' ? 'Ricordi la regola?' : 'Ricordi la risposta?'}</p>
    <div class="flash"><div class="front">${frontFr ? sp(x.speak) : ''}<span ${frontFr ? 'lang="fr"' : ''}>${h(x.front)}</span></div>
    <div class="back" hidden><p>${x.kind === 'vocab' && !frontFr ? sp(x.back.replace(/\s*\([^)]*\)/g, '')) : ''}<b>${h(x.back)}</b></p>
      ${x.note ? `<p class="muted">${h(x.note)}</p>` : ''}${ex}</div></div>
    <button class="primary wide" data-act="reveal">Mostra</button>
    <div class="grade" hidden><button class="bad" data-act="self" data-s="0">No</button>
      <button class="almost" data-act="self" data-s="0.5">Quasi</button><button class="ok" data-act="self" data-s="1">Sì</button></div>`;
}

function mcqView(x) {
  const order = C.shuffle(x.options.map((_, i) => i));
  return `<p class="ask">Scegli la risposta giusta</p><p class="prompt">${h(x.prompt)}</p>
    <div class="opts">${order.map(i => `<button class="opt" data-act="pick" data-i="${i}" lang="fr">${h(x.options[i])}</button>`).join('')}</div>`;
}

const tileWords = s => s.split(' ').map(w => w.replace(/^[«"“(]+|[.,!?;:»"”)]+$/g, '')).filter(Boolean);
function orderView(x) {
  const words = tileWords(C.canonical(x.answers));
  let tiles = C.shuffle([...words, ...(x.distractors || [])]);
  if (tiles.join(' ') === words.join(' ') && tiles.length > 1) tiles = [...tiles.slice(1), tiles[0]];
  return `<p class="ask">Componi la frase in francese</p><p class="prompt">${h(x.prompt)}</p>
    <div class="built" id="built"></div>
    <div class="bank">${tiles.map((w, i) => `<button class="tilew" data-act="tile" data-i="${i}" lang="fr">${h(w)}</button>`).join('')}</div>${checkBtn}`;
}

function clozeView(x) {
  const [a, b] = x.text.split('___');
  return `<p class="ask">Completa${x.hint ? ` <span class="muted">${h(x.hint)}</span>` : ''}</p>
    ${x.prompt ? `<p class="muted">${h(x.prompt)}</p>` : ''}
    <p class="prompt cloze" lang="fr">${h(a)}<input id="ans" lang="fr" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false">${h(b)}</p>
    ${accentBar()}${checkBtn}`;
}

function writeView(x) {
  return `<p class="ask">${h(x.ask || 'Traduci in francese')}</p><p class="prompt">${h(x.prompt)}</p>${input()}${checkBtn}`;
}

function dictView(x) {
  setTimeout(() => speak(x.text), 300);
  return `<p class="ask">Scrivi quello che senti</p>
    <div class="row center">${sp(x.text, 'big')}<button class="say big" data-act="slow" data-text="${h(x.text)}" aria-label="Lento">🐢</button></div>
    ${input('Scrivi in francese…')}${checkBtn}`;
}

// grading ---------------------------------------------------------------------
function gradeTyped(x, given) {
  const st = S.states[x.id];
  if (x.type === 'dictation') return C.check(given, x.answers || [x.text], st?.extra);
  return C.check(given, x.answers, st?.extra);
}

async function commit(x, score, given, expected, { override = false } = {}) {
  const s = S.session, t = today(), now = new Date().toISOString();
  const prev = override ? s.fb.prev : S.states[x.id];
  const st = C.grade(prev, score, t);
  if (override) st.extra = [...new Set([...(prev?.extra || []), given])];
  S.states[x.id] = st;
  const att = { id: crypto.randomUUID(), ex_id: x.id, lesson: x.lesson, type: x.type, level: x.level, concept: x.concept,
    score, given, expected, mode: s.mode, ms: Math.round(performance.now() - s.shownAt), override, flag: null, ts: now, device: S.device };
  if (!override) S.days[t] = (S.days[t] || 0) + 1;
  await db.record([
    { store: 'progress', value: { ex_id: x.id, state: st, updated_at: now }, table: 'fr_progress' },
    { store: 'attempts', value: att, table: 'fr_attempts' },
  ]);
  await db.kvSet('days', S.days);
  (S.attempts ||= []).push(att);
  if (score < 1) (S.lastWrong ||= {})[x.id] = given;
  return { att, prev };
}

async function finish(x, score, given, expected, best) {
  const s = S.session;
  const { att, prev } = await commit(x, score, given, expected);
  s.fb = { x, score, given, best, att, prev, overridden: false };
  s.results.push({ x, score, given });
  showFeedback();
}

function showFeedback() {
  const { x, score, given, best } = S.session.fb;
  const fb = document.getElementById('fb');
  const typed = ['write', 'cloze', 'dictation', 'order'].includes(x.type) && !(S.session.flash && x.front);
  const cls = score >= 1 ? 'ok' : score > 0 ? 'almost' : 'bad';
  const title = score >= 1 ? 'Corretto!' : score > 0 ? (typed ? 'Quasi: attenzione agli accenti' : 'Quasi') : 'Non ancora';
  const full = x.type === 'cloze' ? x.text.replace('___', best) : best;
  let diff = '';
  if (typed && score < 1 && given) {
    const d = C.wordDiff(given, full);
    diff = `<p class="diff" lang="fr">${d.given.map(w => `<span class="${w.ok ? '' : 'x'}">${h(w.w)}</span>`).join(' ')}</p>`;
  }
  fb.className = `fb ${cls}`;
  fb.innerHTML = `<b>${title}</b>
    ${score < 1 || typed ? `<p class="sol" lang="fr">${sp(x.type === 'flash' ? '' : full)}${h(x.type === 'flash' || (S.session.flash && x.front) ? x.back : full)}</p>` : ''}
    ${diff}${x.explain_it ? `<p class="why">${h(x.explain_it)}</p>` : ''}
    <div class="row">${typed && score < 1 && given ? '<button class="ghost" data-act="override">Avevo ragione</button>' : ''}
      <button class="ghost" data-act="flag">⚑ Segnala</button>
      <button class="primary" data-act="next" id="next">Continua</button></div>`;
  fb.hidden = false;
  document.querySelectorAll('.ex button, .ex textarea, .ex input').forEach(e => { if (!e.classList.contains('say')) e.disabled = true; });
  document.getElementById('next').focus();
}

function next() {
  const s = S.session, { x, score, overridden } = s.fb;
  if (score < 1 && !overridden) {
    s.queue = C.requeue(s.queue, s.pos, x, s.pool, S.states, s.tries);
    s.tries[x.id] = (s.tries[x.id] || 0) + 1;
  }
  s.pos += 1;
  s.fb = null;
  render();
}

function resultScreen() {
  const s = S.session, r = s.results;
  const firstTry = new Map();
  for (const x of r) if (!firstTry.has(x.x.id)) firstTry.set(x.x.id, x);
  const ok = [...firstTry.values()].filter(x => x.score >= 1).length;
  const wrong = [...firstTry.values()].filter(x => x.score < 1);
  sync().then(updateDot);
  return `${header('Fine sessione')}
  <section class="result"><div class="big">${ok}/${firstTry.size}</div><p>giuste al primo tentativo</p>
    ${wrong.length ? `<h3>Da rivedere</h3><ul class="mlist">${wrong.map(w => `<li><p>${h(promptText(w.x))}</p>
      <p class="ok" lang="fr">✓ ${h(answerText(w.x))}</p>${w.given ? `<p class="bad" lang="fr">✗ ${h(w.given)}</p>` : ''}</li>`).join('')}</ul>` : '<p>Perfetto! 🎉</p>'}
    <div class="row"><a class="button primary" href="#/">Home</a>
    ${s.mode === 'lesson' ? `<a class="button" href="#/lesson/${s.lesson}">Torna alla lezione</a>` : ''}</div></section>`;
}

// ── actions ─────────────────────────────────────────────────────────────────
const A = {
  go: d => { location.hash = d.to; },
  say: d => speak(d.text),
  slow: d => speak(d.text, true),
  start: d => startSession(d),
  quit: (d, e) => { e.preventDefault(); if (!S.session?.results.length || confirm('Uscire dalla sessione?')) { S.session = null; location.hash = '#/'; } },
  setcur: async d => { await setCurrent(Number(d.n)); render(); },
  filter: (d, e) => { S.mistakeFilter = e.target.value; render(); },
  key: d => {
    const el = document.getElementById('ans');
    if (!el || el.disabled) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    el.value = el.value.slice(0, a) + d.k + el.value.slice(b);
    el.focus();
    el.setSelectionRange(a + d.k.length, a + d.k.length);
  },
  reveal: (d, e) => {
    document.querySelector('.flash .back').hidden = false;
    document.querySelector('.grade').hidden = false;
    e.target.closest('button').hidden = true;
    const x = S.session.queue[S.session.pos];
    if (x.kind === 'vocab' && !x.speak) speak(x.back.replace(/\s*\([^)]*\)/g, ''));
  },
  self: async d => {
    const x = S.session.queue[S.session.pos], score = Number(d.s);
    await commit(x, score, ['no', 'quasi', 'sì'][score * 2], x.back);
    S.session.results.push({ x, score });
    S.session.fb = { x, score, overridden: score >= 1 };
    next();
  },
  pick: async (d, e) => {
    const x = S.session.queue[S.session.pos], i = Number(d.i), score = i === x.correct ? 1 : 0;
    e.target.closest('button').classList.add(score ? 'ok' : 'bad');
    document.querySelector(`.opt[data-i="${x.correct}"]`).classList.add('ok');
    await finish(x, score, x.options[i], x.options[x.correct], x.options[x.correct]);
  },
  tile: (d, e) => {
    const b = e.target.closest('button'), built = document.getElementById('built');
    (b.parentElement === built ? document.querySelector('.bank') : built).appendChild(b);
  },
  check: async () => {
    const x = S.session.queue[S.session.pos];
    const given = x.type === 'order'
      ? [...document.querySelectorAll('#built .tilew')].map(b => b.textContent).join(' ')
      : document.getElementById('ans').value.trim();
    if (!given) return toast('Scrivi una risposta (o premi Continua dopo aver sbagliato apposta 😉)');
    const r = gradeTyped(x, given);
    await finish(x, r.score, given, x.type === 'cloze' ? x.text.replace('___', r.best) : r.best, r.best);
  },
  override: async () => {
    const s = S.session, { x, given, best } = s.fb;
    await commit(x, 1, given, best, { override: true });
    s.fb.overridden = true;
    s.results.push({ x, score: 1, given });
    toast('Ok, risposta accettata: la segnalo al tuo agente');
    next();
  },
  flag: async () => {
    const note = prompt('Cosa non va in questo esercizio?');
    if (!note) return;
    const att = { ...S.session.fb.att, flag: note };
    await db.record([{ store: 'attempts', value: att, table: 'fr_attempts' }]);
    toast('Segnalazione salvata');
  },
  next: () => next(),
  saveSettings: async () => {
    S.settings = { ...S.settings, goal: Number(document.getElementById('goal').value) || 30,
      rate: Number(document.getElementById('rate').value), theme: document.getElementById('theme').value };
    await db.kvSet('settings', S.settings);
    applyTheme();
    await setCurrent(Math.min(S.lessons.length, Math.max(1, Number(document.getElementById('cur').value) || 1)));
    toast('Salvato');
  },
  saveSync: async () => {
    await db.kvSet('sync', { url: document.getElementById('surl').value.trim(),
      key: document.getElementById('skey').value.trim(), syncKey: document.getElementById('ssk').value });
    await db.kvSet('pulledAt', '1970-01-01T00:00:00Z');
    const r = await sync();
    toast(r.msg, 4000);
    if (r.ok) await reload();
  },
  export: async () => {
    const data = { app: 'francese', version: 1, exported_at: new Date().toISOString(),
      meta: { current_lesson: S.current }, progress: await db.getAll('progress'), attempts: await db.getAll('attempts'),
      agent_exercises: (await db.getAll('agentEx')).map(({ id, lesson, reason, parent, active, agent, ...payload }) =>
        ({ id, lesson, payload: { id, lesson, ...payload }, reason, parent, active })) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    a.download = `francese-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  reset: async () => {
    if (!confirm('Azzerare tutti i progressi su questo telefono?') || !confirm('Sicuro? Non si può annullare.')) return;
    for (const st of ['progress', 'attempts', 'outbox']) await db.clear(st);
    await db.kvSet('days', {});
    await reload();
    toast('Progressi azzerati');
  },
};

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (Array.isArray(data.exercises)) {
      const ok = data.exercises.filter(x => x.id && x.type && Number.isInteger(x.lesson) && x.concept && [1, 2, 3].includes(x.level));
      await db.putMany('agentEx', ok.map(x => ({ ...x, agent: true, active: x.active !== false })));
      toast(`Importati ${ok.length} esercizi${ok.length < data.exercises.length ? ` (${data.exercises.length - ok.length} scartati)` : ''}`, 4000);
    } else if (data.app === 'francese') {
      if (!confirm('Ripristinare questo backup? I progressi locali più vecchi verranno sostituiti.')) return;
      await db.putMany('progress', data.progress || []);
      await db.putMany('attempts', data.attempts || []);
      await db.putMany('agentEx', (data.agent_exercises || []).map(r => ({ ...r.payload, id: r.id, lesson: r.lesson,
        reason: r.reason, parent: r.parent, active: r.active, agent: true })));
      if (data.meta?.current_lesson) await db.kvSet('current_lesson', data.meta.current_lesson);
      toast('Backup ripristinato');
    } else throw new Error('formato sconosciuto');
    await reload();
  } catch (e) { toast(`Import fallito: ${e.message}`, 4000); }
}

async function setCurrent(n) {
  S.current = n;
  const now = new Date().toISOString();
  await db.record([{ store: 'kv', value: { k: 'current_lesson', v: n }, table: 'fr_meta', row: { k: 'current_lesson', v: n, updated_at: now } }]);
  await db.kvSet('current_lesson_at', now);
  sync().then(updateDot);
}

async function reload() { await load(); S.attempts = await db.getAll('attempts'); render(); }

// ── routing & events ────────────────────────────────────────────────────────
async function render() {
  const [r, arg] = location.hash.replace(/^#\/?/, '').split('/');
  window.scrollTo(0, 0);
  if (r !== 'session' && S.session && S.session.pos < S.session.queue.length && S.session.results.length) S.session = null;
  main.innerHTML = r === 'lesson' ? lessonScreen(Number(arg))
    : r === 'theory' ? theoryScreen(Number(arg))
    : r === 'session' ? renderSession()
    : r === 'mistakes' ? mistakesScreen()
    : r === 'stats' ? statsScreen()
    : r === 'settings' ? settingsScreen(await db.kvGet('sync', {}))
    : homeScreen();
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#/${r || ''}`));
  document.querySelector('nav').hidden = r === 'session';
  document.getElementById('ans')?.focus({ preventScroll: true });
  updateDot();
}

async function updateDot() {
  const dot = document.getElementById('syncdot');
  if (!dot) return;
  const c = await db.kvGet('sync', {}), n = await pending();
  dot.className = `dot ${!c.url ? '' : n ? 'wait' : 'ok'}`;
  dot.title = !c.url ? 'Sync non configurato' : n ? `${n} modifiche da inviare` : 'Sincronizzato';
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (el && el.tagName !== 'SELECT' && A[el.dataset.act]) A[el.dataset.act](el.dataset, e);
});
document.addEventListener('change', e => {
  if (e.target.matches('select[data-act]')) A[e.target.dataset.act](e.target.dataset, e);
  if (e.target.id === 'imp' && e.target.files[0]) importFile(e.target.files[0]);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || !S.session) return;
  const nextBtn = document.getElementById('next');
  if (nextBtn && !document.getElementById('fb').hidden) { e.preventDefault(); nextBtn.click(); }
  else if (e.target.id === 'ans') { e.preventDefault(); document.querySelector('[data-act="check"]')?.click(); }
});
window.addEventListener('hashchange', render);
window.addEventListener('online', () => sync().then(updateDot));

// service worker: precache everything, offer reload when a new version is installed
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (!reg) return;
    const offer = w => {
      const b = document.getElementById('update');
      b.hidden = false;
      b.onclick = () => w.postMessage('skipWaiting');
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(e => console.warn('service worker not registered:', e));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
}

(async () => {
  try {
    await load();
    S.attempts = await db.getAll('attempts');
    S.lastWrong = {};
    for (const a of S.attempts.sort((x, y) => x.ts.localeCompare(y.ts))) if (a.score < 1 && !a.override) S.lastWrong[a.ex_id] = a.given;
    if (location.hash === '#/session') location.hash = '#/';
    render();
    sync().then(async r => { if (r.ok && (r.got.exercises || r.got.reports || r.got.progress)) await reload(); else updateDot(); });
  } catch (e) {
    main.innerHTML = `<p class="note">Errore di caricamento: ${h(e.message)}</p>`;
  }
})();
