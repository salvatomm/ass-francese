#!/usr/bin/env python3
"""Coaching-agent CLI for the French trainer (stdlib only).

  fr_agent.py pull [--from-export FILE]
  fr_agent.py stats [--days N]
  fr_agent.py push PACK.json [--dry-run]
  fr_agent.py retire ID [ID...]
  fr_agent.py report FILE.md --title T [--focus c1,c2]

Env: FR_SUPABASE_URL, FR_SUPABASE_KEY, FR_SYNC_KEY
"""
import argparse, json, os, re, statistics, sys, urllib.error, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = HERE / "data"
PACKS = HERE / "packs"
TABLES = {"attempts": ("fr_attempts", "ts,id"), "progress": ("fr_progress", "ex_id"),
          "meta": ("fr_meta", "k"), "exercises": ("fr_exercises", "id"),
          "reports": ("fr_reports", "id")}
PAGE = 1000
TYPED = {"write", "cloze", "dictation", "order"}


def die(msg):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(1)


def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def parse_ts(s):
    if isinstance(s, datetime):
        return s
    s = str(s).replace("Z", "+00:00")
    s = re.sub(r"(\.\d{1,6})\d*", lambda m: m.group(1).ljust(7, "0")[:7], s)
    dt = datetime.fromisoformat(s)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- HTTP

def config():
    env = {k: os.environ.get(k, "") for k in ("FR_SUPABASE_URL", "FR_SUPABASE_KEY", "FR_SYNC_KEY")}
    missing = [k for k, v in env.items() if not v]
    if missing:
        die("missing env var(s): " + ", ".join(missing) +
            " (or use `pull --from-export FILE`)")
    return env["FR_SUPABASE_URL"].rstrip("/"), env["FR_SUPABASE_KEY"], env["FR_SYNC_KEY"]


def http(method, path, body=None, extra=None):
    url, key, sync = config()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "x-sync-key": sync,
               "Content-Type": "application/json"}
    headers.update(extra or {})
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f"HTTP {e.code} on {method} {path.split('?')[0]}: {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        die(f"network error on {method} {path.split('?')[0]}: {e.reason}")


def fetch_all(table, order):
    rows, offset = [], 0
    while True:
        page = http("GET", f"{table}?select=*&order={order}&limit={PAGE}&offset={offset}") or []
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE


# ---------------------------------------------------------------- pull

def save_data(tables):
    DATA.mkdir(parents=True, exist_ok=True)
    for name, rows in tables.items():
        (DATA / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
        print(f"{name}: {len(rows)} rows")


def tables_from_export(path):
    try:
        exp = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        die(f"cannot read export {path}: {e}")
    if exp.get("app") != "francese":
        die("not a francese export (app != 'francese')")
    ts = exp.get("exported_at") or iso(now_utc())
    return {
        "attempts": exp.get("attempts", []),
        "progress": exp.get("progress", []),
        "meta": [{"k": k, "v": v, "updated_at": ts} for k, v in (exp.get("meta") or {}).items()],
        "exercises": exp.get("agent_exercises", []),
        "reports": [],
    }


def cmd_pull(a):
    if a.from_export:
        save_data(tables_from_export(a.from_export))
    else:
        save_data({name: fetch_all(t, o) for name, (t, o) in TABLES.items()})


# ---------------------------------------------------------------- stats

def load_data():
    out = {}
    for name in TABLES:
        p = DATA / f"{name}.json"
        out[name] = json.loads(p.read_text()) if p.exists() else []
    if not (DATA / "attempts.json").exists():
        die("no data in agent/data: run `pull` first")
    return out


def acc(rows):
    return statistics.mean(r["score"] for r in rows) if rows else None


def pct(x):
    return "  n/a" if x is None else f"{x * 100:4.0f}%"


def summ(rows):
    n = len(rows)
    wrong = sum(1 for r in rows if r["score"] == 0)
    almost = sum(1 for r in rows if r["score"] == 0.5)
    return n, wrong, almost, acc(rows)


def weak_key(rows):
    n, w, h, _ = summ(rows)
    return ((w + 0.5 * h) / n, n)


def group(rows, key):
    g = defaultdict(list)
    for r in rows:
        g[key(r)].append(r)
    return g


def sline(label, rows, width=22):
    n, w, h, a = summ(rows)
    return f"{str(label):<{width}} n={n:<4} acc={pct(a)} wrong={w:<3} quasi={h}"


def compute_stats(data, days=30, now=None):
    now = now or now_utc()
    att = [dict(r, _t=parse_ts(r["ts"])) for r in data["attempts"]]
    att.sort(key=lambda r: r["_t"])
    meta = {m["k"]: m["v"] for m in data["meta"]}
    prog = {p["ex_id"]: p["state"] for p in data["progress"]}
    concept_of = {}
    for e in data["exercises"]:
        concept_of[e["id"]] = (e.get("payload") or {}).get("concept")
    for r in att:
        concept_of[r["ex_id"]] = r["concept"]
    win = [r for r in att if r["_t"] >= now - timedelta(days=days)]
    wk = [r for r in att if r["_t"] >= now - timedelta(days=7)]
    mid = now - timedelta(days=days / 2)
    L = [f"== FR coaching stats (now {iso(now)[:16]}Z, window {days}d) ==",
         f"current_lesson: {meta.get('current_lesson', '?')}",
         f"progress items: {len(prog)}; agent exercises active: "
         f"{sum(1 for e in data['exercises'] if e.get('active'))}/{len(data['exercises'])}",
         "", "-- Totals --",
         sline("all time", att), sline("last 7d", wk), sline(f"last {days}d", win)]

    mistakes = defaultdict(int)
    for ex, st in prog.items():
        if st.get("mistake"):
            mistakes[concept_of.get(ex, "?")] += 1
    byc = group(win, lambda r: r["concept"])
    order = sorted(byc, key=lambda c: weak_key(byc[c]), reverse=True)
    L += ["", f"-- Concepts in window (weakest first; err = wrong+0.5*quasi; trend = acc 1st half -> 2nd half) --"]
    for c in order:
        rows = byc[c]
        n, w, h, a = summ(rows)
        a1 = [r for r in rows if r["_t"] < mid]
        a2 = [r for r in rows if r["_t"] >= mid]
        trend = (f"{pct(acc(a1)).strip()}->{pct(acc(a2)).strip()}"
                 if len(a1) >= 3 and len(a2) >= 3 else "n/a")
        L.append(f"{c:<24} n={n:<4} err={(w + 0.5 * h) / n * 100:3.0f}% trend={trend:<9} "
                 f"mistake_items={mistakes.get(c, 0)}")
    byl = group(win, lambda r: r["lesson"])
    L += ["", "-- Lessons in window --"]
    L += [sline(f"L{k:03d}", byl[k], 8) for k in sorted(byl, key=lambda k: weak_key(byl[k]), reverse=True)]
    L += ["", "-- Type / level in window --"]
    for key, name in ((lambda r: r["type"], "type"), (lambda r: f"level {r['level']}", "level")):
        g = group(win, key)
        L += [sline(k, g[k], 10) for k in sorted(g, key=lambda k: weak_key(g[k]), reverse=True)]

    acc_only = [r for r in win if r["score"] == 0.5 and r["type"] in TYPED]
    L += ["", f"-- Accent-only errors (score 0.5, typed): {len(acc_only)} --"]
    cnt = defaultdict(int)
    for r in acc_only:
        cnt[r["concept"]] += 1
    L.append(", ".join(f"{c}:{n}" for c, n in sorted(cnt.items(), key=lambda x: -x[1])[:10]) or "none")
    for r in acc_only[-5:]:
        L.append(f"  {r['ex_id']}: {r.get('given')} -> {r.get('expected')}")

    leeches = sorted(((ex, st) for ex, st in prog.items() if st.get("lapses", 0) >= 3),
                     key=lambda x: -x[1]["lapses"])
    L += ["", f"-- Leeches (lapses>=3): {len(leeches)} --"]
    L += [f"  {ex} lapses={st['lapses']} [{concept_of.get(ex, '?')}]" for ex, st in leeches[:15]]

    ov = [r for r in win if r.get("override")]
    L += ["", f"-- Overrides 'I was right' (answer key may be wrong): {len(ov)} --"]
    L += [f"  {r['ex_id']} [{r['concept']}] given={r.get('given')!r} expected={r.get('expected')!r}" for r in ov[-15:]]
    fl = [r for r in win if r.get("flag")]
    L += ["", f"-- Flags (learner reports): {len(fl)} --"]
    L += [f"  {r['ex_id']} [{r['concept']}] flag={r['flag']!r} given={r.get('given')!r} expected={r.get('expected')!r}"
          for r in fl[-15:]]

    L += ["", "-- Wrong examples, 10 weakest concepts (given -> expected) --"]
    for c in order[:10]:
        bad = [r for r in byc[c] if r["score"] < 1][-5:][::-1]
        if bad:
            L.append(f"{c}:")
            L += [f"  {r['ex_id']} L{r['lesson']:03d}: {r.get('given')} -> {r.get('expected')}" for r in bad]
    return "\n".join(L)


def cmd_stats(a):
    print(compute_stats(load_data(), a.days))


# ---------------------------------------------------------------- push / retire / report

def validate_pack(path):
    """Validate with tools/validate.py's pack rules; return number of errors."""
    sys.path.insert(0, str(ROOT / "tools"))
    import validate
    try:
        pack = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        print(f"ERROR cannot read pack: {e}")
        return 1, None
    exs = pack.get("exercises") if isinstance(pack, dict) else None
    if not isinstance(exs, list) or not exs:
        print('ERROR pack must be {"exercises": [ ...non-empty... ]}')
        return 1, None
    problems = 0
    for i, ex in enumerate(exs):
        if not isinstance(ex, dict):
            print(f"ERROR pack[{i}]: not an object")
            problems += 1
        elif not str(ex.get("reason", "")).strip():
            print(f"ERROR pack[{i}]:{ex.get('id')}: 'reason' (evidence) is required")
            problems += 1
    if problems:
        return problems, None
    rc = validate.main(["--pack", str(path)])
    return rc, exs


def to_row(ex, now):
    return {"id": ex["id"], "lesson": ex["lesson"], "payload": ex,
            "reason": ex.get("reason"), "parent": ex.get("parent"),
            "active": True, "updated_at": iso(now)}


def cmd_push(a):
    bad, exs = validate_pack(a.pack)
    if bad:
        die("pack validation failed")
    if a.dry_run:
        print(f"dry-run OK: {len(exs)} exercises")
        return
    PACKS.mkdir(parents=True, exist_ok=True)
    copy = PACKS / Path(a.pack).name
    if copy.resolve() != Path(a.pack).resolve():
        copy.write_text(json.dumps({"exercises": exs}, ensure_ascii=False, indent=1))
    print(f"copy saved: {copy}")
    now = now_utc()
    rows = [to_row(e, now) for e in exs]
    for i in range(0, len(rows), 200):
        http("POST", "fr_exercises?on_conflict=id", rows[i:i + 200],
             {"Prefer": "resolution=merge-duplicates,return=minimal"})
    print(f"upserted {len(rows)} exercises")


def cmd_retire(a):
    ids = ",".join(a.ids)
    http("PATCH", "fr_exercises?id=in.(" + urllib.parse.quote(ids, safe=",-") + ")",
         {"active": False, "updated_at": iso(now_utc())}, {"Prefer": "return=minimal"})
    print(f"retired {len(a.ids)} exercises")


def cmd_report(a):
    try:
        body = Path(a.file).read_text()
    except OSError as e:
        die(f"cannot read {a.file}: {e}")
    rid = "R-" + now_utc().strftime("%Y%m%d-%H%M%S")
    focus = [c.strip() for c in (a.focus or "").split(",") if c.strip()]
    http("POST", "fr_reports", {"id": rid, "title": a.title, "body": body, "focus": focus},
         {"Prefer": "return=minimal"})
    print(f"report {rid} inserted")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("pull"); s.add_argument("--from-export", metavar="FILE"); s.set_defaults(f=cmd_pull)
    s = sub.add_parser("stats"); s.add_argument("--days", type=int, default=30); s.set_defaults(f=cmd_stats)
    s = sub.add_parser("push"); s.add_argument("pack"); s.add_argument("--dry-run", action="store_true")
    s.set_defaults(f=cmd_push)
    s = sub.add_parser("retire"); s.add_argument("ids", nargs="+", metavar="ID"); s.set_defaults(f=cmd_retire)
    s = sub.add_parser("report"); s.add_argument("file"); s.add_argument("--title", required=True)
    s.add_argument("--focus"); s.set_defaults(f=cmd_report)
    a = p.parse_args(argv)
    a.f(a)


if __name__ == "__main__":
    main()
