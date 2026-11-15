#!/usr/bin/env python3
"""Checks data/sources.yaml and data/datasets.yaml against the repository (stage A of docs/approach-specification.md,
section 11: a clean checkout describes every input, no hidden absolute paths, every mock and pending set is marked).

  python -m budget_pipeline.validate.registry check          errors make the exit code 1; the report also lists the datasets whose chain
                                                to the originals has a gap (known backlog, spec section 4), which is not an error
  python -m budget_pipeline.validate.registry check --json   the same as JSON

What it checks, without the raw files (they are not in the repository):
  * sources: unique ids; every source key of data/release (core.sources, catalog.json) is registered; every file pinned in
    data/originals.sha256 belongs to exactly one source file or intermediate, and every registered file under
    data/originals is pinned; a file elsewhere has its own sha256 or says `pinned: false`
  * intermediates: unique paths; the producer exists; the inputs are known
  * datasets: every file of data/release belongs to exactly one dataset; every catalog.json dataset is registered with the same
    id, status, screens, period and unit, and nothing else claims to be in the catalog; producers, layers and inputs exist;
    a pending set has a reason and no file; meta.status of every JSON file equals its status
  * the tracked production code (pipeline/, apps/, tests/, .github/) has no absolute path of a machine
Needs PyYAML (tests/requirements-dev.txt, pipeline/requirements.txt).
"""

import argparse
import hashlib
import fnmatch
import json
import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
SOURCES = ROOT / "data" / "sources.yaml"
DATASETS = ROOT / "data" / "datasets.yaml"
SUMS = ROOT / "data" / "originals.sha256"
DATA = ROOT / "data" / "release"
ACCESS = {"auto", "auto-bg", "browser-only", "supplied", "reference", "generated"}
ACQUISITION = {"auto", "fetch", "fetch-bg", "import", "supplied", "reference", "generated"}
STATUS = {"real", "mock", "pending"}
OTHER_INPUTS = re.compile(r"^(network|git tag mock-v\d+|every output of the release)$")
ABSOLUTE = re.compile(r"(?<![\w.])(/Users/[^/\s'\"]+/|/home/[a-z][\w-]*/|[A-Za-z]:\\(?:Users|home)\\)")
CODE = ("pipeline/", "apps/", "tests/", ".github/")


class Report:
    def __init__(self):
        self.errors, self.facts = [], []

    def err(self, msg):
        self.errors.append(msg)

    def ok(self, cond, msg):
        if not cond:
            self.err(msg)
        return cond


def script(entry):
    """Resolve a registered package command to its source file."""
    import shlex
    if not entry:
        return entry
    if entry in {
        'packages/ingest/src/production/taxes-reader.ts',
        'packages/ingest/src/production/taxes.ts',
        'packages/ingest/src/production/debt-issues.ts',
      'packages/ingest/src/production/programmes.ts',
    }:
        return entry
    parts = shlex.split(entry)
    if len(parts) < 3 or parts[:2] != ['python', '-m']:
        raise ValueError('producer must be a python -m command: ' + entry)
    module = parts[2]
    return 'pipeline/' + module.replace('.', '/') + '.py'


def pinned():
    out = {}
    for ln in SUMS.read_text(encoding="utf-8").splitlines():
        h, _, p = ln.partition("  ")
        if p:
            out[p] = h
    return out


def check_sources(reg, r):
    ids = [s["id"] for s in reg["sources"]]
    r.ok(len(ids) == len(set(ids)), "sources: duplicate ids %s" % sorted({i for i in ids if ids.count(i) > 1}))
    patterns = []                                    # (pattern, owner, entry)
    for s in reg["sources"]:
        for k in ("id", "title", "access", "acquisition", "files"):
            r.ok(k in s, "source %s: no %s" % (s.get("id"), k))
        r.ok(s.get("access") in ACCESS, "source %s: access %r" % (s["id"], s.get("access")))
        r.ok(s.get("acquisition") in ACQUISITION, "source %s: acquisition %r" % (s["id"], s.get("acquisition")))
        for p in (s.get("parser") or "").split(", "):
            if p:
                r.ok((ROOT / script(p)).is_file(), "source %s: parser %s does not exist" % (s["id"], p))
        for f in s.get("files", []):
            patterns.append((f["path"], "source " + s["id"], f))
    inter = reg.get("intermediates", [])
    paths = [i["path"] for i in inter]
    r.ok(len(paths) == len(set(paths)), "intermediates: duplicate paths")
    known = set(ids) | set(paths)
    for i in inter:
        patterns.append((i["path"], "intermediate", i))
        if i.get("category") is not None:
            r.ok(i["category"] == "described-input", "unknown intermediate category: " + i["path"])
            r.ok(i["path"] in {"data/inputs/editorial/guide.json", "data/inputs/editorial/glossary.json"},
                 "described inputs must be explicitly reviewed editorial text: " + i["path"])
            r.ok(i.get("decision") and (ROOT / i["decision"]).is_file(), "missing described-input decision: " + i["path"])
            path = ROOT / i["path"]
            r.ok(path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == i.get("sha256"),
                 "described-input hash mismatch: " + i["path"])
            r.ok(bool(i.get("provenance")) and not i.get("producer") and not i.get("inputs"),
                 "described-input requires provenance and no producer/dependencies: " + i["path"])
        prod = i.get("producer")
        r.ok(prod is None or (ROOT / script(prod)).is_file(), "intermediate %s: producer %s does not exist" % (i["path"], prod))
        r.ok(isinstance(i.get("reproducible"), bool), "intermediate %s: reproducible must be true or false" % i["path"])
        r.ok(prod is not None or not i.get("reproducible"), "intermediate %s: reproducible without a producer" % i["path"])
        for x in i.get("inputs", []):
            r.ok(x in known or OTHER_INPUTS.match(x), "intermediate %s: unknown input %s" % (i["path"], x))

    pins = pinned()
    for p in pins:
        owners = [o for pat, o, _e in patterns if fnmatch.fnmatchcase(p, pat)]
        r.ok(len(owners) == 1, "%s is pinned in originals.sha256 but %s" % (p, "registered nowhere" if not owners else
                                                                           "registered %d times (%s)" % (len(owners), ", ".join(owners))))
    for pat, owner, e in patterns:
        hits = [p for p in pins if fnmatch.fnmatchcase(p, pat)]
        if pat.startswith(("data/originals/", "data/inputs/")):
            r.ok(hits or e.get("pinned") is False, "%s: %s matches no line of originals.sha256" % (owner, pat))
        else:
            r.ok("sha256" in e or e.get("pinned") is False, "%s: %s has no sha256 and does not say `pinned: false`" % (owner, pat))
    return set(ids), inter


def catalog_index():
    cat = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
    out = {}
    for d in cat["datasets"]:
        files = [d["file"]] if d.get("file") else [p["file"] for p in d.get("parts", [])]
        out[d["slug"]] = (d, ["data/release/" + f.removeprefix("data/") for f in files])
    return out


def data_files():
    return sorted(p.relative_to(ROOT).as_posix() for p in DATA.rglob("*") if p.is_file())


def check_datasets(reg, source_ids, inter, r):
    ds = reg["datasets"]
    ids = [d["id"] for d in ds]
    r.ok(len(ids) == len(set(ids)), "datasets: duplicate ids %s" % sorted({i for i in ids if ids.count(i) > 1}))
    inter_paths = {i["path"] for i in inter}
    known = source_ids | inter_paths | set(ids)
    cat = catalog_index()
    files = data_files()
    owner = {f: [] for f in files}
    for d in ds:
        did = d["id"]
        r.ok(d.get("status") in STATUS, "dataset %s: status %r" % (did, d.get("status")))
        pats = d.get("files") or []
        for pat in pats:
            hits = [f for f in files if fnmatch.fnmatchcase(f, pat)]
            r.ok(hits or d["status"] == "pending", "dataset %s: no file matches %s" % (did, pat))
            for f in hits:
                owner[f].append(did)
        if d["status"] == "pending":
            r.ok(d.get("reason") and d.get("expected"), "dataset %s: a pending set needs reason and expected" % did)
            r.ok(not [f for p in pats for f in files if fnmatch.fnmatchcase(f, p)], "dataset %s: pending but has files" % did)
        else:
            r.ok((ROOT / script(d.get("producer", ""))).is_file(), "dataset %s: producer %s does not exist" % (did, d.get("producer")))
            for layer in d.get("layers", []):
                r.ok((ROOT / script(layer)).is_file(), "dataset %s: layer %s does not exist" % (did, layer))
            r.ok(d.get("rebuild") or d.get("notRebuilt"), "dataset %s: neither rebuild nor notRebuilt" % did)
            r.ok(d.get("inputs"), "dataset %s: no inputs" % did)
            for x in d.get("inputs", []):
                r.ok(x in known or OTHER_INPUTS.match(x), "dataset %s: unknown input %s" % (did, x))
            for k in ("schema", "scope"):
                r.ok(d.get(k), "dataset %s: no %s" % (did, k))
            if d.get("schema"):
                r.ok((ROOT / d["schema"]).is_file(), "dataset %s: schema %s does not exist" % (did, d["schema"]))
        for s in d.get("sources", []):
            r.ok(s in source_ids, "dataset %s: unknown source %s" % (did, s))
        # the catalog
        if d.get("catalogId"):
            if not r.ok(did in cat, "dataset %s claims catalog id %s but catalog.json has no slug %s" % (did, d["catalogId"], did)):
                continue
            c, cfiles = cat[did]
            r.ok(c["id"] == d["catalogId"], "dataset %s: catalog id %s, catalog.json says %s" % (did, d["catalogId"], c["id"]))
            r.ok(c["status"] == d["status"], "dataset %s: status %s, catalog.json says %s" % (did, d["status"], c["status"]))
            r.ok((c.get("screens") or []) == (d.get("screens") or []), "dataset %s: screens differ from catalog.json" % did)
            for k in ("period", "unit"):
                if c.get(k):
                    r.ok(c[k] == d.get(k), "dataset %s: %s %r, catalog.json says %r" % (did, k, d.get(k), c[k]))
            mine = sorted(f for p in pats for f in files if fnmatch.fnmatchcase(f, p))
            r.ok(sorted(cfiles) == mine, "dataset %s: files differ from catalog.json" % did)
        else:
            r.ok(did not in cat, "dataset %s is in catalog.json but has no catalogId" % did)
        # the marking inside the files
        for f in (f for p in pats for f in files if fnmatch.fnmatchcase(f, p) and f.endswith(".json")):
            meta = json.loads((ROOT / f).read_text(encoding="utf-8")).get("meta")
            if isinstance(meta, dict) and "status" in meta:
                r.ok(meta["status"] == d["status"], "%s: meta.status %s, the registry says %s" % (f, meta["status"], d["status"]))
    for slug in cat:
        r.ok(slug in ids, "catalog.json dataset %s is not registered" % slug)
    for f, o in owner.items():
        r.ok(len(o) == 1, "%s belongs to %s" % (f, "no dataset" if not o else "%d datasets (%s)" % (len(o), ", ".join(o))))
    return ds


def gaps(ds, inter):
    """dataset -> unresolved intermediate and source/reproduction exceptions, including dependencies."""
    by_id = {d["id"]: d for d in ds}
    by_path = {i["path"]: i for i in inter}
    out = {}
    for d in ds:
        if d["status"] == "pending":
            continue
        seen, todo, found = set(), [d["id"]] + list(d.get("inputs", [])), []
        while todo:
            x = todo.pop()
            if x in seen:
                continue
            seen.add(x)
            if x in by_path:
                i = by_path[x]
                if not i.get("reproducible") and i.get("category") != "described-input":
                    found.append(x)
                todo.extend(i.get("inputs", []))
            elif x in by_id:
                dependency = by_id[x]
                if dependency.get("notRebuilt") and not dependency.get("rebuild"):
                    found.append("source-exception:" + x)
                todo.extend(dependency.get("inputs", []))
        out[d["id"]] = sorted(set(found))
    return out


def check_paths(r):
    try:
        tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, check=True).stdout.decode().split("\0")
    except (OSError, subprocess.CalledProcessError):
        r.err("git ls-files failed: the absolute-path check needs a git checkout")
        return
    for rel in tracked:
        if not rel.startswith(CODE) or rel.startswith("data/release/") or rel == "pipeline/budget_pipeline/validate/registry.py":   # this file holds the pattern
            continue
        try:
            text = (ROOT / rel).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if ABSOLUTE.search(line):
                r.err("%s:%d: an absolute path of a machine: %s" % (rel, n, line.strip()[:120]))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["check"])
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    r = Report()
    sreg = yaml.safe_load(SOURCES.read_text(encoding="utf-8"))
    dreg = yaml.safe_load(DATASETS.read_text(encoding="utf-8"))
    source_ids, inter = check_sources(sreg, r)
    ds = check_datasets(dreg, source_ids, inter, r)
    check_paths(r)
    g = gaps(ds, inter)
    described = [i["path"] for i in inter if i.get("category") == "described-input"]
    if a.json:
        print(json.dumps({"errors": r.errors, "gaps": g, "describedInputs": described,
                          "sourceExceptions": {d["id"]: d["notRebuilt"] for d in ds
                                               if d["status"] != "pending" and d.get("notRebuilt") and not d.get("rebuild")}}, ensure_ascii=False, indent=1))
    else:
        real = [d for d in ds if d["status"] != "pending"]
        print("registry: %d sources, %d intermediates, %d datasets (%d pending), %d files in data/release"
              % (len(sreg["sources"]), len(inter), len(ds), len(ds) - len(real), len(data_files())))
        print("\nrebuilt from the pinned inputs: %d of %d datasets" % (sum(1 for d in real if d.get("rebuild")), len(real)))
        for d in real:
            if not d.get("rebuild"):
                print("  %-22s %s" % (d["id"], d.get("notRebuilt")))
        print("\nchain to the originals has a gap (intermediate or source-level exception): %d of %d"
              % (sum(1 for v in g.values() if v), len(g)))
        for k, v in g.items():
            if v:
                print("  %-22s %s" % (k, ", ".join(x.split("/")[-1] for x in v)))
        print("\ndescribed editorial inputs: %d (see docs/reproducibility.md)" % len(described))
        print("chains closed: %d of %d" % (sum(not v for v in g.values()), len(g)))
        for e in r.errors:
            print("ERROR " + e)
        print("\nRESULT: %s · %d error(s)" % ("OK" if not r.errors else "FAIL", len(r.errors)))
    return 1 if r.errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
