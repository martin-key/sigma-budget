#!/usr/bin/env python3
"""catalog_refresh_v5.py - bring site/data/catalog.json back in line with the files of site/data (version v5: check out the tag mock-v5) (pure standard library).

The V5 pass edited several data files after tools/v5_data_active.py had refreshed the catalog (core, feed, guide, search-index). The catalog states
their sizes, their top-level schema, their meta.source and the screens that read them, and the CATALOG group of validate_data prints each drift.
This script recomputes exactly what the validator compares and nothing else:

  * bytes / gzipBytes of every dataset file (and of the parts of the multi-file set), schema from the top-level keys (the validator's own rule),
    source := meta.source when the file says something else;
  * screens: for every active page whose `export const needs = [...]` is a non-empty list, a dataset lists the page if and only if the page's
    needs name it (the same rule the validator warns about); a page without a readable needs list (S11 computes its own, S27/S28 load lazily)
    keeps the entries it had; the pending sets keep core.pending's screens; ids that are no route are dropped;
  * counts: datasets, listed files, real / mock / pending, primary sources.
data/sebra.json stays on disk, unreferenced, and is not listed (so counts.files is 64 while the folder holds 65).

  python3 tools/mock/catalog_refresh_v5.py          rewrite catalog.json when something differs
  python3 tools/mock/catalog_refresh_v5.py --check   write nothing; exit 1 when the catalog is stale
"""
import glob
import gzip
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # repository root
SITE = os.path.join(ROOT, "site")                  # the Mock application (run this at the tag mock-v5)
DATA = os.path.join(SITE, "data")
UNLISTED = {"sebra.json"}


def gz_size(raw):
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=9) as fh:
        fh.write(raw)
    return len(buf.getvalue())


def schema(obj):
    out = []
    for key, v in obj.items():
        if key == "meta":
            continue
        t = "boolean" if isinstance(v, bool) else "number" if isinstance(v, (int, float)) else "string" if isinstance(v, str) else \
            "array" if isinstance(v, list) else "object" if isinstance(v, dict) else "null"
        row = {"key": key, "type": t}
        if isinstance(v, (list, dict)):
            row["length"] = len(v)
        out.append(row)
    return out


def active_routes():
    src = open(os.path.join(SITE, "js", "routes.js"), encoding="utf-8").read()
    return set(re.findall(r"^\s*R\(\s*'(S\d\d)'", src, re.M))


def page_needs():
    out = {}
    for path in sorted(glob.glob(os.path.join(SITE, "js", "pages", "s[0-9][0-9]-*.js"))):
        rid = os.path.basename(path)[:3].upper()
        m = re.search(r"export const needs\s*=\s*\[([^\]]*)\]", open(path, encoding="utf-8").read())
        if m:
            out[rid] = [x.strip().strip("'\"").rstrip("?") for x in m.group(1).split(",") if x.strip()]
    return out


def refresh(cat):
    changes = []
    routes = active_routes()
    needs = {k: v for k, v in page_needs().items() if k in routes and v}
    for d in cat["datasets"]:
        if d["status"] == "pending":
            continue
        slug = d["slug"]
        if d.get("parts"):
            tot = gz = 0
            for pp in d["parts"]:
                raw = open(os.path.join(SITE, pp["file"]), "rb").read()
                if (pp["bytes"], pp["gzipBytes"]) != (len(raw), gz_size(raw)):
                    pp["bytes"], pp["gzipBytes"] = len(raw), gz_size(raw)
                    changes.append("%s part %s: size" % (slug, pp["code"]))
                tot += len(raw)
                gz += gz_size(raw)
            if (d["bytes"], d["gzipBytes"]) != (tot, gz):
                d["bytes"], d["gzipBytes"] = tot, gz
                changes.append("%s: summed size" % slug)
            continue
        if not d.get("file"):
            continue
        raw = open(os.path.join(SITE, d["file"]), "rb").read()
        if d["id"] != "D25" and (d.get("bytes"), d.get("gzipBytes")) != (len(raw), gz_size(raw)):
            d["bytes"], d["gzipBytes"] = len(raw), gz_size(raw)
            changes.append("%s: size" % slug)
        if d["format"] in ("JSON", "GeoJSON"):
            doc = json.loads(raw.decode("utf-8"))
            if d.get("schema") != schema(doc):
                d["schema"] = schema(doc)
                changes.append("%s: schema" % slug)
            msrc = doc.get("meta", {}).get("source")
            if msrc is not None and set(d["source"]) != set(msrc):
                d["source"] = list(msrc)
                changes.append("%s: source %s" % (slug, msrc))
    # the screens of the datasets, by the pages' needs
    file_ds = {}
    for d in cat["datasets"]:
        if d.get("file"):
            file_ds[d["file"]] = d
        for pp in d.get("parts", []):
            file_ds[pp["file"]] = d
    want = {}                                          # id(dataset) -> set of screens named by a needs list
    for rid, lst in needs.items():
        for nm in lst:
            d = file_ds.get("data/%s.json" % nm)
            if d is not None:
                want.setdefault(id(d), set()).add(rid)
    for d in cat["datasets"]:
        if d["status"] == "pending" or d["id"] == "core":
            continue
        keep = [r for r in d["screens"] if r in routes and r not in needs]       # pages without a readable needs keep their entries
        new = sorted(set(keep) | want.get(id(d), set()))
        if not new:                                    # a file that a page only links to (feed.xml from S16) keeps its screen
            new = [r for r in d["screens"] if r in routes]
        if new != d["screens"]:
            changes.append("%s: screens %s -> %s" % (d["slug"], ",".join(d["screens"]), ",".join(new)))
            d["screens"] = new
    # core.json is read by every page that names it; the validator does not compare it, keep only real routes
    for d in cat["datasets"]:
        if d["id"] == "core":
            new = sorted(r for r in set(d["screens"]) | {k for k, v in needs.items() if "core" in v} if r in routes)
            if new != d["screens"]:
                changes.append("core: screens %s -> %s" % (",".join(d["screens"]), ",".join(new)))
                d["screens"] = new
    counts = {
        "datasets": len(cat["datasets"]),
        "files": sum(len(d["parts"]) if d.get("parts") else (1 if d.get("file") else 0) for d in cat["datasets"]),
        "real": sum(1 for d in cat["datasets"] if d["status"] == "real"),
        "mock": sum(1 for d in cat["datasets"] if d["status"] == "mock"),
        "pending": sum(1 for d in cat["datasets"] if d["status"] == "pending"),
        "primarySources": len(cat["files"]),
    }
    if counts != cat["counts"]:
        changes.append("counts %s -> %s" % (cat["counts"], counts))
        cat["counts"] = counts
    return changes


def main():
    only = "--check" in sys.argv
    path = os.path.join(DATA, "catalog.json")
    cat = json.load(open(path, encoding="utf-8"))
    changes = refresh(cat)
    print("catalog_refresh_v5: %d change(s)" % len(changes))
    for c in changes:
        print("  " + c)
    if changes and not only:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(cat, ensure_ascii=False, separators=(",", ":")))
        print("  catalog.json written")
    sys.exit(1 if (changes and only) else 0)


if __name__ == "__main__":
    main()
