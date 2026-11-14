// Supabase sync over plain fetch (PostgREST). Local IndexedDB is the source of truth;
// the outbox is flushed when online, then remote changes are pulled.
import * as db from './db.js';

const TABLE_KEY = { fr_attempts: 'id', fr_progress: 'ex_id', fr_meta: 'k' };          // pushed
const PULL_KEY = { fr_progress: 'ex_id', fr_exercises: 'id', fr_reports: 'id', fr_meta: 'k' }; // pulled

async function cfg() {
  const c = await db.kvGet('sync', {});
  return c.url && c.key && c.syncKey ? c : null;
}

function headers(c, extra = {}) {
  return { apikey: c.key, Authorization: `Bearer ${c.key}`, 'x-sync-key': c.syncKey,
    'Content-Type': 'application/json', ...extra };
}

async function api(c, path, opts = {}) {
  const r = await fetch(`${c.url.replace(/\/$/, '')}/rest/v1/${path}`, { ...opts, headers: headers(c, opts.headers) });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || opts.method === 'POST' ? null : r.json();
}

const quoted = v => encodeURIComponent(`"${v}"`);

/** Rows of `table` changed on the server since this device last looked. The cursor is the
 *  server-stamped (synced_at, primary key) of the last row seen, so other devices' clocks don't
 *  matter, and keyset paging neither skips nor repeats rows written while we page (1000/request). */
async function changed(c, table, cursors) {
  const key = PULL_KEY[table];
  let [ts, id] = cursors[table] ?? ['1970-01-01T00:00:00Z', ''];
  const rows = [];
  for (;;) {
    const after = `or=(synced_at.gt.${quoted(ts)},and(synced_at.eq.${quoted(ts)},${key}.gt.${quoted(id)}))`;
    const page = await api(c, `${table}?select=*&${after}&order=synced_at,${key}&limit=1000`);
    rows.push(...page);
    if (page.length) [ts, id] = [page.at(-1).synced_at, page.at(-1)[key]];
    if (page.length < 1000) break;
  }
  cursors[table] = [ts, id];
  return rows;
}

async function push(c) {
  const box = await db.outbox();
  for (const table of Object.keys(TABLE_KEY)) {
    const entries = box.filter(e => e.table === table);
    for (let i = 0; i < entries.length; i += 500) {
      const batch = entries.slice(i, i + 500);
      // last write wins inside a batch: keep only the newest row per primary key
      const rows = [...new Map(batch.map(e => [e.row[TABLE_KEY[table]], e.row])).values()];
      await api(c, table, { method: 'POST', body: JSON.stringify(rows),
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      await db.dropOutbox(batch.map(e => e.key));
    }
  }
}

async function pull(c) {
  const cursors = await db.kvGet('cursors', {});
  const newer = (a, b) => !b || Date.parse(a) > Date.parse(b);   // device clocks: last write wins

  const local = Object.fromEntries((await db.getAll('progress')).map(p => [p.ex_id, p]));
  const progress = (await changed(c, 'fr_progress', cursors)).filter(r => newer(r.updated_at, local[r.ex_id]?.updated_at));
  await db.putMany('progress', progress.map(r => ({ ex_id: r.ex_id, state: r.state, updated_at: r.updated_at })));

  const ex = await changed(c, 'fr_exercises', cursors);
  await db.putMany('agentEx', ex.map(r => ({ ...r.payload, id: r.id, lesson: r.lesson, reason: r.reason,
    parent: r.parent, active: r.active, agent: true })));

  const reports = await changed(c, 'fr_reports', cursors);
  await db.putMany('reports', reports);

  const cur = (await changed(c, 'fr_meta', cursors)).find(m => m.k === 'current_lesson');
  if (cur && newer(cur.updated_at, await db.kvGet('current_lesson_at', ''))) {
    await db.kvSet('current_lesson', cur.v);
    await db.kvSet('current_lesson_at', cur.updated_at);
  }
  await db.kvSet('cursors', cursors);   // only after everything is stored: a failed pull is simply redone
  return { progress: progress.length, exercises: ex.length, reports: reports.length };
}

let running = null;
/** Push then pull. Returns {ok, msg}. Never throws: offline is a normal state. */
export function sync() {
  return running ??= (async () => {
    const c = await cfg();
    if (!c) return { ok: false, msg: 'Sync non configurato' };
    if (!navigator.onLine) return { ok: false, msg: 'Offline' };
    try {
      await push(c);
      const got = await pull(c);
      await db.kvSet('syncedAt', new Date().toISOString());
      return { ok: true, msg: `Sincronizzato (${got.exercises} esercizi coach, ${got.reports} note)`, got };
    } catch (e) {
      return { ok: false, msg: `Errore sync: ${e.message}` };
    }
  })().finally(() => { running = null; });
}

export const pending = async () => (await db.outbox()).length;
