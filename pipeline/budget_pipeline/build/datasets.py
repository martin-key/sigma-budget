#!/usr/bin/env python3
"""Orchestrator: builds every dataset DATA owns into data/release/ (core.json last).

  python -m budget_pipeline.build.datasets            build + write (only files whose content changed are rewritten)
  python -m budget_pipeline.build.datasets --check    build in memory and compare with disk (exit 1 on any difference)
  python -m budget_pipeline.build.datasets --dry      build in memory, print the size table, write nothing

A builder module that does not exist yet is skipped with a notice, so datasets can land one by one and the script can be
re-run. It never writes DATA2's files (glossary.json, guide.json, mock/*.json); the catalog and the search index read
them from disk when they exist.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import argparse
import gzip
import importlib
import sys
import time
import traceback


import budget_pipeline.build.data_io as data_io                        # noqa: E402
from budget_pipeline.build.definitions import set_kfp_pending  # noqa: E402
from budget_pipeline.build.context import Ctx             # noqa: E402

# (module, function): order = the order the screens need the data; every function puts its files into ctx.out.
STEPS = [
    ("fiscal", "build_outlook"),
    ("fiscal", "build_revenue"),
    ("fiscal", "build_expenditure"),
    ("measures", "build_measures"),
    ("budgets", "build_budgets"),            # ministries.json, ministries/<code>.json, programs.json
    ("debt", "build_debt"),
    ("rates", "build_rates"),
    ("municipalities", "build_municipalities"),   # municipalities.json, geo/obshtini.json
    ("law", "build_law"),
    ("components", "build_components"),
    ("payments", "build_sebra"),
    ("feed", "build_feed"),                  # feed.json, feed.xml
    ("core", "build_core"),                  # core.json (copies numbers from the files above)
    ("search", "search"),           # search-index.json
    ("catalog", "catalog"),         # catalog.json (reads every file, incl. DATA2's)
]
OWNED_DIRS = ["ministries", "geo"]             # sub-directories of data/release that this script owns (stale files are pruned)


def run_steps(ctx):
    errors, skipped = [], []
    for mod_name, fn_name in STEPS:
        try:
            mod = importlib.import_module("budget_pipeline.build." + mod_name)
        except ModuleNotFoundError as exc:
            if exc.name == "budget_pipeline.build." + mod_name:
                skipped.append(mod_name + "." + fn_name)
                continue
            raise
        fn = getattr(mod, fn_name, None)
        if fn is None:
            skipped.append(mod_name + "." + fn_name)
            continue
        t0 = time.time()
        try:
            fn(ctx)
        except Exception as exc:                      # noqa: BLE001 - report, keep building the independent files
            errors.append("%s.%s: %s" % (mod_name, fn_name, exc))
            traceback.print_exc()
            continue
        data_io.say("  built %-34s %5.1fs" % (mod_name + "." + fn_name, time.time() - t0))
    return errors, skipped


def serialise(ctx):
    """rel -> bytes exactly as they are written to disk."""
    out = {}
    for rel, obj in ctx.out.items():
        out[rel] = (data_io.jdumps(obj) + "\n").encode("utf-8")
    for rel, text in ctx.texts.items():
        out[rel] = text.encode("utf-8")
    return out


def build(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="compare with disk, write nothing, exit 1 on a difference")
    ap.add_argument("--dry", action="store_true", help="build and print sizes, write nothing")
    args = ap.parse_args(argv)
    if not data_io.RAW.is_dir():
        sys.exit("datasets: data/originals is missing: the MF reports and the ASBP PDF come with the repository, the other raw "
                 "files are fetched with pipeline/budget_pipeline/sources/originals.py status (docs/data-sources.md); data/cache/ is filled by "
                 "boundaries.py, payments.py and bill.py")

    ctx = Ctx()
    set_kfp_pending(ctx.execution)
    errors, skipped = run_steps(ctx)
    blobs = serialise(ctx)

    rows, diffs = [], []
    for rel in sorted(blobs, key=lambda r: (r != "core.json", r)):
        data = blobs[rel]
        path = data_io.DATA / rel
        if args.check:
            same = path.exists() and path.read_bytes() == data
            if not same:
                diffs.append(rel)
            state = "same" if same else "DIFF"
        elif args.dry:
            state = "dry"
        else:
            changed = data_io.write_text(path, data.decode("utf-8"))
            state = "written" if changed else "same"
        rows.append((rel, len(data), len(gzip.compress(data, compresslevel=9, mtime=0)), state))

    if not args.check and not args.dry:
        for sub in OWNED_DIRS:
            d = data_io.DATA / sub
            if d.is_dir():
                for f in sorted(d.glob("*.json")):
                    rel = sub + "/" + f.name
                    if rel not in blobs and (sub != "geo" or "geo/obshtini.json" in blobs):
                        f.unlink()
                        data_io.say("  pruned stale " + rel)

    width = max([len(r[0]) for r in rows] + [10])
    data_io.say("%-*s %10s %9s  %s" % (width, "file", "raw B", "gzip B", "state"))
    for rel, raw, gz, state in rows:
        data_io.say("%-*s %10d %9d  %s" % (width, rel, raw, gz, state))
    data_io.say("%d file(s), %d B raw, %d B gzip" % (len(rows), sum(r[1] for r in rows), sum(r[2] for r in rows)))
    for note in ctx.notes:
        data_io.say("note: " + note)
    if skipped:
        data_io.say("skipped (not written yet): " + ", ".join(skipped))
    if diffs:
        data_io.say("DIFFERENT FROM DISK: " + ", ".join(diffs))
    if errors:
        for e in errors:
            print("ERROR " + e, file=sys.stderr)
    return 1 if (errors or diffs) else 0


def main():
    import subprocess
    return subprocess.call([sys.executable, "-m", "budget_pipeline.build.rebuild", *sys.argv[1:]])


if __name__ == "__main__":
    sys.exit(main())
