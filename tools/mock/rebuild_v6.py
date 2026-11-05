#!/usr/bin/env python3
"""rebuild_v6.py - rebuild site/data of the current site (v6) from the raw inputs: the donor builders, then the v5/v6 layer.

The files of site/data are not the plain output of build_data.py: v5 renamed «реални данни» to «официални данни», took СЕБРА and the
generated sets out of the active layer, and v6 added the sources of the screen S34. Run alone, build_data.py writes the donor (v1)
form and removes all of that. This script runs the steps in the order that gives the published files:

  1. extract_kfp_full.py          site/data/execution.json from prototype/data/raw/kfp_*/
  2. build_data.py                every other dataset of the builders (core.json last)
  3. v5_wording.py                the v3/v4 wording on catalog.json, core.json and search-index.json (pairs from the tags mock-v2, mock-v4)
  4. v5_data_active.py site       СЕБРА and the generated sets out of catalog, feed, search-index and core
  5. apply_v6_glue.py             the four sources of S34 and counts.terms in core.json (the rest of the glue is already in site/)
  6. catalog_refresh_v5.py        sizes, schemas, screens and counts of catalog.json against the files

Checked on 2026-11-05: with the inputs of the published site (the August 2026 report) the result equals site/data byte for byte, apart
from the files whose inputs changed since (parliament API, Eurostat, BNB, the access probes) and gzipBytes in catalog.json, which depend
on the zlib of the machine.

  .venv-data/bin/python tools/mock/rebuild_v6.py --build-date 2026-11-05     the build date goes into meta.retrieved of every file
  .venv-data/bin/python tools/mock/rebuild_v6.py                             BUILD_DATE from the environment, else the default of dlib.py

Writes site/data/ and tmp/versions/site-v2|site-v4/data/ (the wording pairs). Glossary, guide and the mock sets are not rebuilt
(build_text.py, build_mock.py). Stops at the first failing step.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
T = "tools/mock/"
WORDING_FILES = ["catalog.json", "core.json", "search-index.json"]


def run(args, env):
    print("== " + " ".join(args), flush=True)
    rc = subprocess.run([sys.executable] + args, cwd=str(ROOT), env=env).returncode
    if rc:
        sys.exit("rebuild_v6: failed (exit %d): %s" % (rc, " ".join(args)))


def tag_files(env):
    """The wording pairs of v5_wording.py come from the data of the tags mock-v2 (old wording) and mock-v4 (new wording)."""
    for tag in ("v2", "v4"):
        out = ROOT / "tmp" / "versions" / ("site-" + tag) / "data"
        out.mkdir(parents=True, exist_ok=True)
        for f in WORDING_FILES:
            data = subprocess.run(["git", "show", "mock-%s:site/data/%s" % (tag, f)], cwd=str(ROOT), capture_output=True, env=env)
            if data.returncode:
                sys.exit("rebuild_v6: no mock-%s:site/data/%s (git fetch --tags)" % (tag, f))
            (out / f).write_bytes(data.stdout)


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-date", help="YYYY-MM-DD for meta.retrieved and build.dataVersion (else BUILD_DATE or the dlib.py default)")
    ap.add_argument("--versions-ready", action="store_true",
                    help="tmp/versions/site-v2|v4/data are already in place (tools/budget.py writes them from the tags before a build without git)")
    args = ap.parse_args(argv)
    env = dict(os.environ)
    if args.build_date:
        env["BUILD_DATE"] = args.build_date
    if args.versions_ready:
        missing = [str(p) for t in ("v2", "v4") for f in WORDING_FILES
                   for p in [ROOT / "tmp" / "versions" / ("site-" + t) / "data" / f] if not p.is_file()]
        if missing:
            sys.exit("rebuild_v6: --versions-ready, but missing: " + ", ".join(missing))
    else:
        tag_files(env)
    run([T + "extract_kfp_full.py"], env)
    run([T + "build_data.py"], env)
    for f in WORDING_FILES:
        run([T + "v5_wording.py", f, "site/data"], env)
    run([T + "v5_data_active.py", "site", "--apply"], env)
    run([T + "apply_v6_glue.py"], env)
    run([T + "catalog_refresh_v5.py"], env)
    print("rebuild_v6: done; check with validate_data_v6.py and review `git diff --stat site/data`")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
