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
    rc = subprocess.run([sys.executable, "-m", "budget_pipeline.offline", args[1]] + args[2:], cwd=str(ROOT), env=env).returncode
    if rc:
        sys.exit("rebuild: failed (exit %d): %s" % (rc, " ".join(args)))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-date", help="YYYY-MM-DD for meta.retrieved and build.dataVersion (else BUILD_DATE or the data_io.py default)")
    args = ap.parse_args(argv)
    env = dict(os.environ)
    if args.build_date:
        env["BUILD_DATE"] = args.build_date
    for name in ("measure-labels", "tax-assumptions"):
        (ROOT / "data/release/mock" / (name + ".json")).unlink(missing_ok=True)
    run(["-m", "budget_pipeline.extract.legacy_inputs", "municipal", "--check"], env)
    run(["-m", "budget_pipeline.extract.legacy_inputs", "functions", "--check"], env)
    run(["-m", "budget_pipeline.extract.kfp_full"], env)
    os.environ.update({k: v for k, v in env.items() if k == "BUILD_DATE"})
    run(["-m", "budget_pipeline.build.frozen_editorial"], env)
    run(["-m", "budget_pipeline.build.budget_plan"], env)
    # datasets.STEPS runs annual_periods then budget_2027 after the legacy fiscal builders.
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
