#!/usr/bin/env python3
"""validate_data.py: the data contract of the Mock prototype (DATA_SPEC section 5). Pure standard library.

Run from anywhere:  .venv/bin/python tools/mock/validate_data.py [--only GROUP,...] [-v] [--no-rebuild] [--no-mock] [--list]

  --only     comma separated group names (see --list); default: all
  -v         print every problem, warning and fact in full
  --no-rebuild  skip the REBUILD group (an in-process `build_data.py --check`)
  --no-mock  skip the MOCK group (`python3 tools/mock/validate_mock.py`, DATA2's validator)
Exit code: 0 all checks passed, 1 at least one violation, 2 usage error.
Each group prints one line: OK|FAIL, name, number of checks and the key facts it established.
"""
import argparse
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import vd_lib as L                                       # noqa: E402
import vd_core, vd_fiscal, vd_budget, vd_other           # noqa: E402,E401

MODULES = (vd_core, vd_fiscal, vd_budget, vd_other)


# Run order of the groups (a group missing here still runs, after these): foundations, then the data in the order of the plan,
# the catalog (which describes everything) near the end, and the two groups that run other programs last.
ORDER = ("PROTO", "ENVELOPE", "NUMBERS", "SIZES", "PRIVACY", "GLOSSARY", "CORE", "KFP", "ANNEX3", "REVENUE", "EXPENDITURE", "MEASURES",
         "LAW", "BUDGETS", "PROGRAMS", "DEBT", "MUNIC", "SEBRA", "COMPONENTS", "RATES", "SEARCH", "FEED", "CATALOG", "REBUILD", "MOCK")


def all_groups():
    out = []
    for m in MODULES:
        out.extend(m.GROUPS)
    names = [g[0] for g in out]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise SystemExit("validate_data: group registered twice: %s" % ", ".join(dup))
    rank = dict((n, i) for i, n in enumerate(ORDER))
    return sorted(out, key=lambda g: rank.get(g[0], len(ORDER)))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], add_help=True)
    ap.add_argument("--only", default="", help="comma separated group names")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--no-rebuild", action="store_true")
    ap.add_argument("--no-mock", action="store_true")
    ap.add_argument("--list", action="store_true", help="list the groups and exit")
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    groups = all_groups()
    names = [g[0] for g in groups]
    if a.list:
        for n, _f, doc in groups:
            print("%-11s %s" % (n, doc))
        return 0
    wanted = [x.strip().upper() for x in a.only.split(",") if x.strip()]
    for w in wanted:
        if w not in names:
            print("unknown group %r (try --list)" % w, file=sys.stderr)
            return 2
    ctx = L.Ctx({"no_rebuild": a.no_rebuild, "no_mock": a.no_mock, "verbose": a.verbose})
    t0 = time.time()
    n_files = len(L.data_files())
    print("validate_data: site/data, %d files, build date %s" % (n_files, L.BUILD_DATE))
    n_checks = n_problems = n_warnings = 0
    failed = []
    for name, fn, _doc in groups:
        if wanted and name not in wanted:
            continue
        if name == "REBUILD" and a.no_rebuild and not wanted:
            print("skip  %-11s (--no-rebuild)" % name)
            continue
        if name == "MOCK" and a.no_mock and not wanted:
            print("skip  %-11s (--no-mock)" % name)
            continue
        t1 = time.time()
        try:
            chk = fn(ctx)
        except Exception as e:                           # a crashed group is a failed group, never a silent pass
            chk = L.Check(name)
            chk.fail("group crashed: %s: %s" % (type(e).__name__, e))
            if a.verbose:
                traceback.print_exc()
        n_checks += chk.n
        n_problems += len(chk.problems)
        n_warnings += len(chk.warnings)
        status = "FAIL" if chk.problems else "OK  "
        if chk.problems:
            failed.append(name)
        facts = "; ".join(chk.facts)
        print("%s  %-11s %5d checks%s" % (status, name, chk.n, (" · " + facts) if facts else ""))
        cap = None if a.verbose else 6
        for p in chk.problems[:cap]:
            print("        - " + p)
        if cap and len(chk.problems) > cap:
            print("        - … %d more (-v for all)" % (len(chk.problems) - cap))
        wcap = None if a.verbose else 3
        for w in chk.warnings[:wcap]:
            print("        ! " + w)
        if wcap and len(chk.warnings) > wcap:
            print("        ! … %d more warnings (-v for all)" % (len(chk.warnings) - wcap))
    verdict = "FAILED" if n_problems else "OK"
    print("RESULT %s: %d checks, %d problems, %d warnings, %.1f s%s" % (
        verdict, n_checks, n_problems, n_warnings, time.time() - t0, (" (failed: %s)" % ", ".join(failed)) if failed else ""))
    return 1 if n_problems else 0


if __name__ == "__main__":
    sys.exit(main())
