#!/usr/bin/env python3
"""Rebuild the current release from pinned inputs. The sequence is extraction, dataset builders, frozen terminology, active dataset selection, source records and catalog refresh. budget build executes this sequence in its isolated release environment."""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WORDING_FILES = ["catalog.json", "core.json", "search-index.json"]


def run(args, env):
    print("== " + " ".join(args), flush=True)
    rc = subprocess.run([sys.executable] + args, cwd=str(ROOT), env=env).returncode
    if rc:
        sys.exit("rebuild: failed (exit %d): %s" % (rc, " ".join(args)))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-date", help="YYYY-MM-DD for meta.retrieved and build.dataVersion (else BUILD_DATE or the data_io.py default)")
    args = ap.parse_args(argv)
    env = dict(os.environ)
    if args.build_date:
        env["BUILD_DATE"] = args.build_date
    run(["-m", "budget_pipeline.extract.kfp_full"], env)
    os.environ.update({k: v for k, v in env.items() if k == "BUILD_DATE"})
    run(["-m", "budget_pipeline.build.frozen_editorial"], env)
    run(["-m", "budget_pipeline.build.budget_plan"], env)
    from budget_pipeline.build import datasets
    result = datasets.build([])
    if result:
        return result
    for f in WORDING_FILES:
        run(["-m", "budget_pipeline.build.wording", f, "data/release"], env)
    run(["-m", "budget_pipeline.build.active_data", "data/release", "--apply"], env)
    run(["-m", "budget_pipeline.build.apply_sources"], env)
    run(["-m", "budget_pipeline.build.catalog_refresh"], env)
    print("rebuild: done; check with datasets.py and review `git diff --stat data/release`")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
