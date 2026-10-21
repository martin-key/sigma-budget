#!/usr/bin/env python3
"""V5: take the generated "C" sets and the daily СЕБРА set out of the ACTIVE data layer of the v5 tree (pass the tree as the first argument).

Usage: python3 tools/v5_data_active.py SITE_DIR [--apply]

What it does (idempotent; only touches <SITE_DIR>/data):
  catalog.json   drops D24 (СЕБРА) and M01..M05 (generated activities, indicators, municipal finance, payments,
                 projects), the СЕБРА primary-file rows, the dangling `related` slugs; recounts; recomputes
                 bytes/gzipBytes for every entry that has a file (the screens print them).
  feed.json/.xml drops the СЕБРА event, the СЕБРА source and wording.
  search-index   drops entries that lead to removed screens or that are mock/pending; keeps real ones.
  core.json      drops the sebra source row.
  files          deletes data/mock/{activities,indicators,municipal-finance,payments,projects}.json from the tree
                 (the generated originals stay in the tags mock-v1 and mock-v4); data/sebra.json stays on disk,
                 unreferenced (phase 2).
Without --apply it only prints what would change.
"""
import gzip, json, re, sys
from pathlib import Path

DROP_IDS = {"D24", "M01", "M02", "M03", "M04", "M05"}
DROP_SLUGS = {"sebra", "mock-activities", "mock-indicators", "mock-municipal-finance", "mock-payments", "mock-projects"}
DROP_FILES = ["mock/activities.json", "mock/indicators.json", "mock/municipal-finance.json", "mock/payments.json", "mock/projects.json"]
GONE_ROUTES = ("#/plashtania", "#/proekti", "#/moyat-byudzhet")
J = dict(separators=(",", ":"), ensure_ascii=False)


def dump(o):
    return json.dumps(o, **J)


def main():
    site = Path(sys.argv[1]).resolve()
    apply = "--apply" in sys.argv
    data = site / "data"
    out = {}

    # ---- catalog
    cat = json.load(open(data / "catalog.json", encoding="utf8"))
    n0 = len(cat["datasets"])
    cat["datasets"] = [d for d in cat["datasets"] if d.get("id") not in DROP_IDS and d.get("slug") not in DROP_SLUGS]
    cat["files"] = [f for f in cat["files"] if "sebra" not in (f.get("source") or []) and "sebra" not in (f.get("usedBy") or [])]
    for d in cat["datasets"]:
        d["source"] = [s for s in d.get("source", []) if s != "sebra"]
    for coll in (cat.get("traps", []), cat.get("methodology", [])):
        for t in coll:
            if "related" in t:
                t["related"] = [r for r in t["related"] if r not in DROP_SLUGS]
            if "СЕБРА" in t.get("text", ""):
                t["text"] = t["text"].replace(", плащанията по СЕБРА — в евро", "")
    for d in cat["datasets"]:
        if d.get("file") and not d.get("parts"):
            p = data / d["file"][len("data/"):]
            if p.exists() and d["id"] != "D25":
                b = p.read_bytes()
                d["bytes"] = len(b)
                d["gzipBytes"] = len(gzip.compress(b, 9, mtime=0))
    cat["groups"] = [g for g in cat["groups"] if any(d["group"] == g["id"] for d in cat["datasets"])]
    cat["counts"] = {
        "datasets": len(cat["datasets"]),
        "files": sum(len(d["parts"]) if "parts" in d else (1 if d.get("file") else 0) for d in cat["datasets"]),
        "real": sum(1 for d in cat["datasets"] if d["status"] == "real"),
        "mock": sum(1 for d in cat["datasets"] if d["status"] == "mock"),
        "pending": sum(1 for d in cat["datasets"] if d["status"] == "pending"),
        "primarySources": len(cat["files"]),
    }
    out["catalog.json"] = dump(cat)
    print("catalog: datasets %d -> %d, files rows %d, counts %s" % (n0, len(cat["datasets"]), len(cat["files"]), cat["counts"]))

    # ---- feed
    feed = json.load(open(data / "feed.json", encoding="utf8"))
    ev0 = len(feed["events"])
    gone_ids = {e["id"] for e in feed["events"] if "sebra" in (e.get("source") or [])}
    feed["events"] = [e for e in feed["events"] if e["id"] not in gone_ids]
    feed["meta"]["source"] = [s for s in feed["meta"]["source"] if s != "sebra"]
    feed["meta"]["sourceNote"] = feed["meta"]["sourceNote"].replace(", Евростат, СЕБРА)", ", Евростат)")
    for k in ("expected", "highlights", "sentences"):
        v = feed.get(k)
        if isinstance(v, list):
            feed[k] = [x for x in v if "СЕБРА" not in dump(x)]
    out["feed.json"] = dump(feed)
    xml = (data / "feed.xml").read_text(encoding="utf8")
    for gid in gone_ids:
        xml = re.sub(r"<item>\n(?:(?!</item>).)*?<guid[^>]*>%s</guid>(?:(?!</item>).)*?</item>\n?" % re.escape(gid), "", xml, flags=re.S)
    out["feed.xml"] = xml
    print("feed: events %d -> %d" % (ev0, len(feed["events"])))

    # ---- search index
    si = json.load(open(data / "search-index.json", encoding="utf8"))
    n = len(si["items"])
    si["items"] = [i for i in si["items"] if i[5] == "real" and not i[6].startswith(GONE_ROUTES) and "СЕБРА" not in i[1]]
    si["meta"]["source"] = [s for s in si["meta"]["source"] if s not in ("mockgen",)]
    si["meta"]["sourceNote"] = si["meta"]["sourceNote"].replace(
        "Редовете с примерни данни са отбелязани и се скриват при „Само официални данни“. ", "")
    out["search-index.json"] = dump(si)
    print("search-index: items %d -> %d" % (n, len(si["items"])))

    # ---- core
    core = json.load(open(data / "core.json", encoding="utf8"))
    core["sources"].pop("sebra", None)
    out["core.json"] = dump(core)

    if not apply:
        print("dry run; pass --apply to write")
        return
    for name, text in out.items():
        (data / name).write_text(text, encoding="utf8")
    for rel in DROP_FILES:
        p = data / rel
        if p.exists():
            p.unlink()
    print("written:", ", ".join(out), "| deleted:", ", ".join(DROP_FILES))


if __name__ == "__main__":
    main()
