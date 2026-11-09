#!/usr/bin/env python3
"""Refresh catalog sizes, schemas, source links, screens and counts from the current release files."""

from pathlib import Path as _Path
import glob
import gzip
import io
import json
import os
import re
import sys
import yaml

from budget_pipeline.routes import load_routes

ROOT = str(_Path(__file__).resolve().parents[3])   # repository root
SITE = os.path.join(ROOT, "apps", "web", "public")                  # the site (run this at the tag mock-previous)
DATA = os.path.join(ROOT, "data", "release")
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
    return {route["id"] for route in load_routes()}


def page_needs():
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "apps", "web", "client", "pages", "s[0-9][0-9]-*.js"))):
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
                raw = open(os.path.join(DATA, pp["file"].removeprefix("data/")), "rb").read()
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
        raw = open(os.path.join(DATA, d["file"].removeprefix("data/")), "rb").read()
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
    # Conditional readers and linked provenance files cannot be inferred from a static needs regex.
    # The audited dataset registry declares the complete consumer list.
    registry = yaml.safe_load(open(os.path.join(ROOT, "data", "datasets.yaml"), encoding="utf-8"))
    consumers = {entry["id"]: entry.get("screens", []) for entry in registry["datasets"]}
    for d in cat["datasets"]:
        if d["slug"] in consumers:
            new = [rid for rid in consumers[d["slug"]] if rid in routes]
            if new != d["screens"]:
                changes.append("%s: screens %s -> %s" % (d["slug"], ",".join(d["screens"]), ",".join(new)))
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
    print("catalog_refresh: %d change(s)" % len(changes))
    for c in changes:
        print("  " + c)
    if changes and not only:
        with open(path, "w", encoding="utf-8") as f:
            f.write(json.dumps(cat, ensure_ascii=False, separators=(",", ":")))
        print("  catalog.json written")
    sys.exit(1 if (changes and only) else 0)


if __name__ == "__main__":
    main()
