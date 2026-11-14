#!/usr/bin/env python3
"""Build: validate lessons → content/bundle.json → docs/CURRICULUM.md → stamp sw.js VERSION.

Run after any content or app change:  python3 tools/build.py
"""
import hashlib, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from validate import main as validate  # noqa: E402

APP_FILES = ["index.html", "app.js", "core.js", "db.js", "sync.js", "style.css", "manifest.webmanifest"]
TYPE_IT = {"mcq": "scelta multipla", "order": "riordina", "cloze": "completa", "write": "scrivi",
           "dictation": "dettato", "flash": "flashcard"}


def first(ans: str) -> str:
    """First variant of the [a|b] syntax (what the app shows as the solution)."""
    return re.sub(r"\s+", " ", re.sub(r"\[([^\[\]]*)\]", lambda m: m[1].split("|")[0], ans)).strip()


def solution(e: dict) -> str:
    t = e["type"]
    if t == "mcq":
        return e["options"][e["correct"]]
    if t == "flash":
        return e["back"]
    if t == "cloze":
        return e["text"].replace("___", f"**{first(e['answers'][0])}**")
    if t == "dictation":
        return e["text"]
    return first(e["answers"][0])


def question(e: dict) -> str:
    t = e["type"]
    if t == "cloze":
        return e["text"] + (f" {e['hint']}" if e.get("hint") else "")
    if t == "dictation":
        return "(dettato)"
    if t == "flash":
        return e["front"]
    ask = e.get("ask")
    return (f"{ask}: " if ask and t == "write" else "") + e["prompt"]


def cell(s: str) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def curriculum(lessons: list[dict]) -> str:
    total = sum(len(L["exercises"]) for L in lessons)
    out = [
        "# Il francese (Assimil) — schede delle 100 lezioni",
        "",
        f"Generato da `tools/build.py` a partire da `content/lessons/`. {len(lessons)} lezioni, {total} esercizi scritti a mano "
        "(più flashcard e drill di vocabolario generati automaticamente dall'app).",
        "",
        "Ogni scheda riassume la lezione del libro: situazione, regole spiegate in italiano, vocabolario, espressioni, "
        "note, e l'elenco degli esercizi per livello. I dialoghi completi sono nel libro.",
        "",
        "## Indice",
        "",
    ]
    for L in lessons:
        out.append(f"- [{L['n']}. {L['title_fr']}](#lezione-{L['n']}) — {L['title_it']}")
    for L in lessons:
        ex = L["exercises"]
        lv, ty = Counter(e["level"] for e in ex), Counter(e["type"] for e in ex)
        out += ["", "---", "", f'<a id="lezione-{L["n"]}"></a>', f"## Lezione {L['n']} — {L['title_fr']}", "",
                f"*{L['title_it']}*" + ("" if L["status"] == "verified" else " · ⚠️ da verificare sul libro"), "",
                L["theme_it"], ""]
        if L["grammar"]:
            out += ["### Grammatica", ""]
            for g in L["grammar"]:
                out += [f"**{g['title_it']}** (`{g['id']}`)", "", g["explain_it"], ""]
                out += [f"- *{e['fr']}* — {e['it']}" for e in g.get("examples", [])]
                out.append("")
        if L["vocab"]:
            out += ["### Vocabolario", "", "| francese | italiano | note |", "|---|---|---|"]
            out += [f"| {cell(v['fr'])} | {cell(v['it'])} | {cell(v.get('note', ''))} |" for v in L["vocab"]]
            out.append("")
        if L["expressions"]:
            out += ["### Espressioni", "", "| francese | italiano | note |", "|---|---|---|"]
            out += [f"| {cell(x['fr'])} | {cell(x['it'])} | {cell(x.get('note', ''))} |" for x in L["expressions"]]
            out.append("")
        if L.get("notes_it"):
            out += ["### Note", ""] + [f"- {t}" for t in L["notes_it"]] + [""]
        out += ["### Esercizi", "",
                f"{len(ex)} esercizi — facile {lv[1]}, medio {lv[2]}, difficile {lv[3]} · "
                + ", ".join(f"{TYPE_IT[t]} {n}" for t, n in sorted(ty.items())), ""]
        for level, name in ((1, "Facile"), (2, "Medio"), (3, "Difficile")):
            items = [e for e in ex if e["level"] == level]
            if not items:
                continue
            out += [f"<details><summary>{name} ({len(items)})</summary>", "",
                    "| # | tipo | domanda | soluzione | argomento |", "|---|---|---|---|---|"]
            out += [f"| {e['id'][-3:]} | {TYPE_IT[e['type']]} | {cell(question(e))} | {cell(solution(e))} | `{e['concept']}` |"
                    for e in items]
            out += ["", "</details>", ""]
    return "\n".join(out) + "\n"


def main() -> int:
    if validate([]) != 0:
        print("build aborted: fix validation errors first")
        return 1
    lessons = [json.loads(p.read_text()) for p in sorted((ROOT / "content" / "lessons").glob("L*.json"))]
    bundle = json.dumps({"lessons": lessons}, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "content" / "bundle.json").write_text(bundle)
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs" / "CURRICULUM.md").write_text(curriculum(lessons))

    digest = hashlib.sha256(bundle.encode())
    for f in APP_FILES:
        digest.update((ROOT / f).read_bytes())
    version = digest.hexdigest()[:12]
    sw = ROOT / "sw.js"
    sw.write_text(re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{version}';", sw.read_text(), count=1))
    n_ex = sum(len(L["exercises"]) for L in lessons)
    print(f"built {len(lessons)} lessons, {n_ex} exercises, bundle {len(bundle) // 1024} KB, version {version}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
