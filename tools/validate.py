#!/usr/bin/env python3
"""Validate lesson files and agent exercise packs against agent/CONTENT_SPEC.md.

usage: validate.py [FILES...]   (default: all content/lessons/L*.json)
       validate.py --pack pack.json
Exit code 1 if any error. Warnings (counts below minimum) don't fail.
"""
import itertools, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = (ROOT / "agent" / "CONTENT_SPEC.md").read_text()
CONCEPTS = set(SPEC.split("## Concept keys")[1].split("```")[1].split())
TYPES = {"mcq", "order", "cloze", "write", "dictation", "flash"}
POS = {"n", "v", "adj", "adv", "prep", "conj", "pron", "expr", "num", "interj"}
ALT = re.compile(r"\[([^\[\]]*)\]")
LABEL = re.compile(r"\s*\((?:m|f|pl|m\./f|m\. ?pl|f\. ?pl)\.?\)")
LOWER = "a-zà-öø-ÿœæ"


def entry_answers(fr: str) -> list[str]:
    """Typed answers of a vocab/expression fr. Mirrors core.js entryAnswers()."""
    out = []
    for f in re.split(r"\s+/\s+", LABEL.sub("", fr)):
        f = re.sub(rf"(?<=[^\W\d_])\(([{LOWER}]+)\)", r"[|\1]", f.strip())
        out.append(re.sub(r"\s+\(([^)]+)\)", r"[ \1|]", f))
    return out


def check_entry(fr: str, where: str, err, warn, vocab: bool = True) -> None:
    """fr format (CONTENT_SPEC): forms split by " / ", "x(e)" endings, "(m.)"-style labels,
    " (complement)" optional parts. Anything else would turn into an untypeable drill answer."""
    if any(c in fr for c in "[]|"):
        err(f"{where}: {fr!r} must not use answer syntax [a|b]")
        return
    for a in entry_answers(fr):
        if re.search(r"[()/]", a) or not a:
            err(f"{where}: {fr!r} doesn't parse (gender pairs: 'grand / grande'; labels only (m.) (f.) (m./f.) (m. pl.) (f. pl.); 'désolé(e)'; optional complement 'réussir (à)'; plural or other info goes in note)")
            return
        expand(a)
    if vocab and re.fullmatch(r"[^,]+, [^,]+", fr) and len(fr.split()) <= 4:
        warn(f"{where}: {fr!r} looks like a gender pair: write 'a / b'")


def expand(ans: str, cap: int = 256) -> list[str]:
    """'s'il [vous|te] plaît' -> both sentences. Mirrors core.js expand()."""
    if "[" in ans.replace("[", "", 1) and re.search(r"\[[^\]]*\[", ans):
        raise ValueError("nested brackets")
    parts = ALT.split(ans)  # even idx = literal, odd idx = alternatives
    if any(c in p for p in parts[::2] for c in "[]"):
        raise ValueError("unbalanced brackets")
    opts = [p.split("|") if i % 2 else [p] for i, p in enumerate(parts)]
    n = 1
    for o in opts:
        n *= len(o)
    if n > cap:
        raise ValueError(f"{n} expansions > {cap}")
    return [re.sub(r"\s+", " ", "".join(c)).strip() for c in itertools.product(*opts)]


def check_ex(ex: dict, where: str, err, lesson_n=None) -> None:
    def need(k, typ=str):
        v = ex.get(k)
        if not isinstance(v, typ) or (typ in (str, list) and not v):
            err(f"{where}: '{k}' missing or not a non-empty {typ.__name__}")
            return False
        return True

    t = ex.get("type")
    if t not in TYPES:
        return err(f"{where}: bad type {t!r}")
    if ex.get("level") not in (1, 2, 3):
        err(f"{where}: level must be 1, 2 or 3")
    c = ex.get("concept")
    if not isinstance(c, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", c):
        err(f"{where}: concept must be kebab-case, got {c!r}")
    if t == "mcq":
        if need("prompt") and need("options", list):
            if not 2 <= len(ex["options"]) <= 5 or not all(isinstance(o, str) and o for o in ex["options"]):
                err(f"{where}: options must be 2-5 non-empty strings")
            if len(set(ex["options"])) != len(ex["options"]):
                err(f"{where}: duplicate options")
            if not isinstance(ex.get("correct"), int) or not 0 <= ex["correct"] < len(ex["options"]):
                err(f"{where}: 'correct' must index options")
    elif t == "flash":
        need("front"); need("back")
    else:
        if t in ("order", "write"):
            need("prompt")
        if t == "cloze" and need("text") and ex["text"].count("___") != 1:
            err(f"{where}: cloze text needs exactly one ___")
        if t == "dictation":
            need("text")
        answers = ex.get("answers", [ex.get("text")] if t == "dictation" else None)
        if not isinstance(answers, list) or not answers or not all(isinstance(a, str) and a.strip() for a in answers):
            return err(f"{where}: 'answers' must be a non-empty list of strings")
        for a in answers:
            try:
                expand(a)
            except ValueError as e:
                err(f"{where}: answer {a!r}: {e}")
        if t == "order":
            words = expand(answers[0])[0].split()
            if len(words) > 14:
                err(f"{where}: order sentence too long ({len(words)} words)")
            if not isinstance(ex.get("distractors", []), list):
                err(f"{where}: distractors must be a list")


def validate_lesson(path: Path, err, warn, seen_ids: set) -> None:
    try:
        L = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return err(f"{path.name}: invalid JSON: {e}")
    n = L.get("n")
    if path.name != f"L{n:03d}.json" if isinstance(n, int) else True:
        return err(f"{path.name}: 'n' does not match file name")
    w = path.name
    for k in ("title_fr", "title_it", "theme_it"):
        if not isinstance(L.get(k), str) or not L[k]:
            err(f"{w}: missing {k}")
    if L.get("review") is not (n % 7 == 0):
        err(f"{w}: review must be {n % 7 == 0}")
    if L.get("status") not in ("outline", "verified"):
        err(f"{w}: status must be outline|verified")
    for i, g in enumerate(L.get("grammar") or []):
        if not all(isinstance(g.get(k), str) and g[k] for k in ("id", "title_it", "explain_it")):
            err(f"{w}: grammar[{i}] needs id/title_it/explain_it")
        for e in g.get("examples", []):
            if not (e.get("fr") and e.get("it")):
                err(f"{w}: grammar[{i}] example needs fr+it")
    if not L.get("grammar"):
        err(f"{w}: grammar is empty")
    fr_seen = set()
    for i, v in enumerate(L.get("vocab", [])):
        if not (v.get("fr") and v.get("it")):
            err(f"{w}: vocab[{i}] needs fr+it")
        if v.get("pos") not in POS:
            err(f"{w}: vocab[{i}] bad pos {v.get('pos')!r}")
        if v.get("fr") in fr_seen:
            err(f"{w}: duplicate vocab {v.get('fr')!r}")
        fr_seen.add(v.get("fr"))
        if v.get("fr"):
            check_entry(v["fr"], f"{w}: vocab[{i}]", err, warn)
    for i, x in enumerate(L.get("expressions", [])):
        if not (x.get("fr") and x.get("it")):
            err(f"{w}: expressions[{i}] needs fr+it")
        elif "/" in x["fr"] or "(" in x["fr"]:
            check_entry(x["fr"], f"{w}: expressions[{i}]", err, warn, vocab=False)
    exs = L.get("exercises", [])
    for i, ex in enumerate(exs):
        eid = ex.get("id", "")
        if not re.fullmatch(rf"L{n:03d}-[a-z0-9-]+", eid):
            err(f"{w}: exercise[{i}] id {eid!r} must look like L{n:03d}-e01")
        if eid in seen_ids:
            err(f"{w}: duplicate id {eid}")
        seen_ids.add(eid)
        check_ex(ex, f"{w}:{eid}", err, n)
    lv, ty = Counter(e.get("level") for e in exs), Counter(e.get("type") for e in exs)
    if L.get("review"):
        if len(exs) < 32:
            warn(f"{w}: review lesson has {len(exs)} exercises (< 32)")
    else:
        mins = {"level 1": (lv[1], 8), "level 2": (lv[2], 10), "level 3": (lv[3], 8),
                "mcq": (ty["mcq"], 3), "order": (ty["order"], 3), "cloze": (ty["cloze"], 4),
                "write": (ty["write"], 8), "dictation": (ty["dictation"], 2), "flash": (ty["flash"], 2),
                "vocab": (len(L.get("vocab", [])), 15), "expressions": (len(L.get("expressions", [])), 4)}
        for k, (have, want) in mins.items():
            if have < want:
                warn(f"{w}: {k} = {have} (< {want})")
    unknown = {e.get("concept") for e in exs} - CONCEPTS
    if unknown:
        warn(f"{w}: non-standard concepts {sorted(unknown)}")


def main(argv: list[str]) -> int:
    errors, warnings = [], []
    seen: set = set()
    if argv[:1] == ["--pack"]:
        pack = json.loads(Path(argv[1]).read_text())
        for i, ex in enumerate(pack.get("exercises", [])):
            where = f"pack[{i}]:{ex.get('id')}"
            if not re.fullmatch(r"A-\d{8}-[a-z0-9-]+", str(ex.get("id"))):
                errors.append(f"{where}: agent id must look like A-20261114-1")
            if ex.get("id") in seen:
                errors.append(f"{where}: duplicate id")
            seen.add(ex.get("id"))
            if not isinstance(ex.get("lesson"), int) or not 1 <= ex["lesson"] <= 100:
                errors.append(f"{where}: lesson must be 1..100")
            check_ex(ex, where, errors.append)
    else:
        files = [Path(a) for a in argv] or sorted((ROOT / "content" / "lessons").glob("L*.json"))
        for f in files:
            validate_lesson(f, errors.append, warnings.append, seen)
    for m in warnings:
        print("WARN ", m)
    for m in errors:
        print("ERROR", m)
    print(f"{len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
