import json, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent"))
import fr_agent  # noqa: E402

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def att(i, days_ago, concept, score, **kw):
    r = {"id": f"u{i}", "ex_id": kw.pop("ex_id", f"L001-e{i:02d}"), "lesson": 1, "type": "write",
         "level": 2, "concept": concept, "score": score, "given": "x", "expected": "y",
         "mode": "review", "ms": 1000, "override": False, "flag": None,
         "ts": (NOW - timedelta(days=days_ago)).isoformat().replace("+00:00", "Z")}
    r.update(kw)
    return r


def export():
    a = []
    # partitif: bad and getting worse (first half fine, second half bad)
    for i in range(4): a.append(att(len(a), 25, "partitif", 1))
    for i in range(4): a.append(att(len(a), 3, "partitif", 0, given="du pain", expected="de pain"))
    # etre: solid
    for i in range(6): a.append(att(len(a), 5, "etre", 1))
    a.append(att(len(a), 2, "spelling-accents", 0.5, given="ete", expected="été"))
    a.append(att(len(a), 1, "etre", 0, ex_id="L001-e90", override=True, flag="key too narrow"))
    return {"app": "francese", "version": 1, "exported_at": "2026-11-14T12:00:00Z",
            "meta": {"current_lesson": 12},
            "progress": [{"ex_id": "L001-e00", "state": {"mistake": True, "lapses": 3}, "updated_at": "2026-11-14T00:00:00Z"}],
            "attempts": a, "agent_exercises": []}


class Stats(unittest.TestCase):
    def setUp(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "exp.json"
            p.write_text(json.dumps(export()))
            self.data = fr_agent.tables_from_export(p)

    def test_report(self):
        out = fr_agent.compute_stats(self.data, 30, NOW)
        self.assertIn("current_lesson: 12", out)
        lines = out.splitlines()
        concept_lines = [l for l in lines if l.startswith(("partitif", "etre ", "spelling"))]
        self.assertTrue(concept_lines[0].startswith("partitif"))  # weakest first
        self.assertIn("err= 50%", concept_lines[0])
        self.assertIn("100%->0%", concept_lines[0])
        self.assertIn("mistake_items=1", concept_lines[0])
        self.assertIn("Accent-only errors (score 0.5, typed): 1", out)
        self.assertIn("ete -> été", out)
        self.assertIn("L001-e00 lapses=3", out)
        self.assertIn("Overrides 'I was right' (answer key may be wrong): 1", out)
        self.assertIn("key too narrow", out)
        self.assertIn("du pain -> de pain", out)
        self.assertLess(len(lines), 150)

    def test_window_excludes_old(self):
        out = fr_agent.compute_stats(self.data, 10, NOW)
        self.assertNotIn("100%->0%", out)


class Push(unittest.TestCase):
    def run_dry(self, pack):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "p.json"
            p.write_text(json.dumps(pack))
            try:
                fr_agent.main(["push", str(p), "--dry-run"])
                return 0
            except SystemExit as e:
                return e.code

    good = {"id": "A-20261114-1", "lesson": 5, "type": "cloze", "level": 1, "concept": "partitif",
            "text": "Je veux ___ pain.", "answers": ["du"], "reason": "3 errori su partitif"}

    def test_good(self):
        self.assertEqual(self.run_dry({"exercises": [self.good]}), 0)

    def test_bad(self):
        bad = dict(self.good, text="no blank here", id="X-1")
        self.assertNotEqual(self.run_dry({"exercises": [bad]}), 0)
        self.assertNotEqual(self.run_dry({"exercises": []}), 0)
        nore = {k: v for k, v in self.good.items() if k != "reason"}
        self.assertNotEqual(self.run_dry({"exercises": [nore]}), 0)


if __name__ == "__main__":
    unittest.main()
