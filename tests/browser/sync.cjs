// sync.js against an in-memory PostgREST mock (only the request shapes sync.js uses): keyset paging,
// rows changed mid-pull, clock-skewed agent writes, push of answers, wrong passphrase.
// usage: node tests/browser/sync.cjs
const { chromium, devices } = require('playwright');
const { serveRepo, check: assert, URL: U } = require('./serve.cjs');
const KEY = 'pass-phrase';
const PK = { fr_attempts: 'id', fr_progress: 'ex_id', fr_meta: 'k', fr_exercises: 'id', fr_reports: 'id' };
const db = Object.fromEntries(Object.keys(PK).map(t => [t, new Map()]));
let tick = 0;   // server clock: one value per write request (like now() in a transaction) → ties
const now = () => new Date(Date.UTC(2026, 10, 14, 12) + (++tick) * 1000).toISOString().replace('Z', '000+00:00');
const upsert = (t, rows) => { const ts = now(); for (const r of rows) db[t].set(r[PK[t]], { ...db[t].get(r[PK[t]]), ...r, synced_at: ts }); };
const seen = { gets: 0, mutated: false };
function rest(req) {
  if (req.headers()['x-sync-key'] !== KEY) return { status: 401, body: '{"message":"bad key"}' };
  const u = new URL(req.url()), t = u.pathname.split('/').pop();
  if (req.method() === 'POST') { upsert(t, JSON.parse(req.postData())); return { status: 201, body: '' }; }
  const m = decodeURIComponent(u.searchParams.get('or')).match(/^\(synced_at\.gt\."(.*)",and\(synced_at\.eq\."(.*)",(\w+)\.gt\."(.*)"\)\)$/);
  if (!m) return { status: 400, body: 'unsupported query ' + u.search };
  const [, ts, ts2, key, id] = m, lim = +u.searchParams.get('limit');
  if (ts !== ts2 || key !== PK[t] || u.searchParams.get('order') !== `synced_at,${key}`) return { status: 400, body: 'bad cursor' };
  const all = [...db[t].values()].sort((a, b) => a.synced_at < b.synced_at ? -1 : a.synced_at > b.synced_at ? 1 : a[key] < b[key] ? -1 : 1);
  const page = all.filter(r => r.synced_at > ts || (r.synced_at === ts && r[key] > id)).slice(0, lim);
  // a second device writes while we page: a row already returned changes → must still arrive, nothing skipped
  if (t === 'fr_progress' && !seen.mutated && page.length === lim) { seen.mutated = true;
    upsert(t, [{ ex_id: page[3].ex_id, state: { box: 7 }, updated_at: '2026-11-14T13:00:00.000Z' }]); }
  seen.gets++;
  return { status: 200, body: JSON.stringify(page) };
}
(async () => {
  // another device: 2500 progress rows in 3 writes (tie groups straddle the 1000-row pages)
  const prog = n => Array.from({ length: n }, (_, i) => ({ ex_id: `L0${String(i % 99 + 1).padStart(2, '0')}-x${n}-${i}`, state: { box: 2 }, updated_at: '2026-11-13T10:00:00.000Z' }));
  upsert('fr_progress', prog(700)); upsert('fr_progress', prog(1200)); upsert('fr_progress', prog(600));
  // the agent's machine clock is a day behind: its updated_at is old, but synced_at is the server's
  upsert('fr_exercises', [1, 2].map(k => ({ id: `A-20261113-${k}`, lesson: 3, active: true, reason: 'test', parent: null,
    payload: { type: 'write', level: 2, concept: 'etre', prompt: 'Sono qui.', answers: ['Je suis ici.'] }, updated_at: '2026-11-13T00:00:00.000Z' })));
  upsert('fr_reports', [{ id: 'r1', title: 'Settimana 1', body: 'Bene così.', focus: ['etre'], created_at: '2026-11-13T00:00:00.000Z' }]);
  upsert('fr_meta', [{ k: 'current_lesson', v: 4, updated_at: '2026-11-14T11:00:00.000Z' }]);

  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
  await serveRepo(ctx);
  await ctx.route('https://mock.supabase.test/**', r => r.fulfill({ ...rest(r.request()), contentType: 'application/json' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => assert(false, `page error: ${e.message}`));
  await p.goto(U + '#/settings'); await p.waitForSelector('#surl');
  await p.fill('#surl', 'https://mock.supabase.test'); await p.fill('#skey', 'anon'); await p.fill('#ssk', KEY);
  await p.click('[data-act=saveSync]'); await p.waitForTimeout(1500);
  const local = () => p.evaluate(async () => { const d = await import('/db.js');
    const pr = await d.getAll('progress'); return { progress: pr.length, box7: pr.filter(x => x.state.box === 7).length,
      agent: (await d.getAll('agentEx')).length, reports: (await d.getAll('reports')).length, cur: await d.kvGet('current_lesson'),
      cursors: await d.kvGet('cursors'), outbox: (await d.outbox()).length }; });
  let L = await local();
  assert(L.progress === 2500, `first pull got all 2500 progress rows over ${seen.gets} requests (got ${L.progress})`);
  assert(L.box7 === 1, 'row changed by another device mid-paging arrived with its new state');
  assert(L.agent === 2 && L.reports === 1 && L.cur === 4, 'agent exercises, report and current lesson pulled');
  // agent pushes after our pull, with its clock still a day behind → the old client-clock cursor would miss it
  upsert('fr_exercises', [{ id: 'A-20261113-3', lesson: 3, active: true, reason: 'late', parent: null,
    payload: { type: 'write', level: 2, concept: 'etre', prompt: 'Sei qui.', answers: ['Tu es ici.'] }, updated_at: '2026-11-13T00:00:01.000Z' }]);
  // and retires exercise 1
  upsert('fr_exercises', [{ ...db.fr_exercises.get('A-20261113-1'), active: false, updated_at: '2026-11-13T00:00:02.000Z' }]);
  const r = await p.evaluate(async () => (await import('/sync.js')).sync());
  L = await local();
  assert(r.ok && L.agent === 3, `late agent exercise from a skewed clock pulled (${r.msg})`);
  assert(await p.evaluate(async () => (await (await import('/db.js')).get('agentEx', 'A-20261113-1')).active === false), 'retired exercise deactivated locally');
  // learner answers one exercise → outbox → push
  await p.goto(U + '#/lesson/1'); await p.waitForSelector('.tile');
  await p.click('button[data-level="1"]'); await p.waitForSelector('section.ex');
  const type = await p.getAttribute('section.ex', 'data-type');
  if (type === 'flash') { await p.click('[data-act=reveal]'); await p.click('[data-act=self][data-s="1"]'); }
  else if (type === 'mcq') await p.click('.opt >> nth=0');
  else if (type === 'order') { const n = await p.locator('.bank .tilew').count(); for (let k = 0; k < n; k++) await p.locator('.bank .tilew').first().click(); await p.click('[data-act=check]'); }
  else { await p.fill('#ans', 'bonjour'); await p.click('[data-act=check]'); }
  await p.waitForTimeout(300);
  const before = (await local()).outbox;
  const r2 = await p.evaluate(async () => (await import('/sync.js')).sync());
  L = await local();
  assert(before >= 2 && L.outbox === 0 && db.fr_attempts.size === 1, `answer pushed (${type}; outbox ${before} → 0, server attempts ${db.fr_attempts.size}, ${r2.msg})`);
  const mine = [...db.fr_progress.values()].filter(x => !/-x\d+-/.test(x.ex_id));
  assert(mine.length === 1 && L.progress === 2501, 'own progress row on server; pulling it back did not duplicate locally');
  // wrong passphrase: sync reports the error and keeps the outbox
  await p.evaluate(async () => { const d = await import('/db.js'); const c = await d.kvGet('sync'); await d.kvSet('sync', { ...c, syncKey: 'nope' }); });
  const r3 = await p.evaluate(async () => (await import('/sync.js')).sync());
  assert(!r3.ok && /401/.test(r3.msg), `wrong passphrase → "${r3.msg}"`);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
