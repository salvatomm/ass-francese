// Supabase sync over plain fetch (PostgREST). Local IndexedDB is the source of truth;
// the outbox is flushed when online, then remote changes are pulled.
import * as db from './db.js';

const TABLE_KEY = { fr_attempts: 'id', fr_progress: 'ex_id', fr_meta: 'k' };

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

/** GET every row matching `query`, 1000 at a time (PostgREST caps responses). */
async function getAllRows(c, table, query) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await api(c, `${table}?${query}&limit=1000&offset=${off}`);
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
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
  const since = await db.kvGet('pulledAt', '1970-01-01T00:00:00Z');
  const started = new Date().toISOString();
  const q = `select=*&updated_at=gt.${encodeURIComponent(since)}&order=updated_at`;

  const local = Object.fromEntries((await db.getAll('progress')).map(p => [p.ex_id, p]));
  const remoteProg = (await getAllRows(c, 'fr_progress', q)).filter(r => !local[r.ex_id] || r.updated_at > local[r.ex_id].updated_at);
  await db.putMany('progress', remoteProg);

  const ex = await getAllRows(c, 'fr_exercises', q);
  await db.putMany('agentEx', ex.map(r => ({ ...r.payload, id: r.id, lesson: r.lesson, reason: r.reason,
    parent: r.parent, active: r.active, agent: true })));

  const reports = await getAllRows(c, 'fr_reports', `select=*&created_at=gt.${encodeURIComponent(since)}`);
  await db.putMany('reports', reports);

  const meta = await getAllRows(c, 'fr_meta', q);
  const cur = meta.find(m => m.k === 'current_lesson');
  if (cur && cur.updated_at > (await db.kvGet('current_lesson_at', ''))) {
    await db.kvSet('current_lesson', cur.v);
    await db.kvSet('current_lesson_at', cur.updated_at);
  }
  await db.kvSet('pulledAt', started);
  return { progress: remoteProg.length, exercises: ex.length, reports: reports.length };
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
