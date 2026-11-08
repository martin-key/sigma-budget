#!/usr/bin/env python3
"""Rebuild the current release from pinned inputs. The sequence is extraction, dataset builders, terminology from the historical mock-v2/mock-v4 tags, active dataset selection, source records and catalog refresh. budget build executes this sequence in its isolated release environment. --versions-ready uses terminology inputs already exported by the release builder."""
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


def tag_files(env):
    """The wording pairs of wording.py come from the data of the tags mock-v2 (old wording) and mock-v4 (new wording)."""
    for tag in ("v2", "v4"):
        out = ROOT / "tmp" / "versions" / ("site-" + tag) / "data"
        out.mkdir(parents=True, exist_ok=True)
        for f in WORDING_FILES:
            data = subprocess.run(["git", "show", "mock-%s:%s/%s" % (tag, "site" + "/data", f)], cwd=str(ROOT), capture_output=True, env=env)
            if data.returncode:
                sys.exit("rebuild: missing historical tag %s file %s (git fetch --tags)" % (tag, f))
            (out / f).write_bytes(data.stdout)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-date", help="YYYY-MM-DD for meta.retrieved and build.dataVersion (else BUILD_DATE or the data_io.py default)")
    ap.add_argument("--versions-ready", action="store_true",
                    help="tmp/versions/site-v2|v4/data are already in place (pipeline/budget_pipeline/cli.py writes them from the tags before a build without git)")
    args = ap.parse_args(argv)
    env = dict(os.environ)
    if args.build_date:
        env["BUILD_DATE"] = args.build_date
    if args.versions_ready:
        missing = [str(p) for t in ("v2", "v4") for f in WORDING_FILES
                   for p in [ROOT / "tmp" / "versions" / ("site-" + t) / "data" / f] if not p.is_file()]
        if missing:
            sys.exit("rebuild: --versions-ready, but missing: " + ", ".join(missing))
    else:
        tag_files(env)
    run(["-m", "budget_pipeline.extract.kfp_full"], env)
    os.environ.update({k: v for k, v in env.items() if k == "BUILD_DATE"})
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
