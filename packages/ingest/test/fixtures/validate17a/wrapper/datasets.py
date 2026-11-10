#!/usr/bin/env python3
"""Validate the current published datasets. The base contract is supplemented by execution checks and an explicit list of documented compatibility exceptions. Every unmatched problem remains a failure; --no-accepted reports the underlying contract without exceptions."""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

import budget_pipeline.validate.checks as L                                    # noqa: E402

# checks.SITE / DATA already point at the site assets/ (the checked-out version; current site)

import budget_pipeline.validate.base as V                             # noqa: E402
import budget_pipeline.validate.execution as execution                                    # noqa: E402  contract v2 of execution.json (stage B)

GONE_SEBRA = "СЕБРА (daily payments) was taken out of the active interface and of core.sources; data/sebra.json stays on disk, unreferenced, for phase 2"
SOURCE_EXTENSION = "Screen S34: four sources were added to core.sources (dbp2027, ec-edp-bg, ec-fiscal-bg, ec-dbp) that the donor registry does not list"

def _feed_counts():
    """The donor expects 18 feed events plus one per 2026 report; the feed holds exactly one fewer (the СЕБРА event)."""
    with open(os.path.join(L.DATA, "execution.json"), encoding="utf-8") as fh:
        n = 18 + int(json.load(fh)["data"]["2026"]["months"])
    return n, n - 1


FEED_WANT, FEED_HAVE = _feed_counts()
GLOSSARY_EXTENSION = "Screen S34: five glossary terms (65-69) were added; the donor plan still says 64 terms"
ACCEPTED = (
    ("ENVELOPE", r"^core\.sources keys differ from the registry: \['dbp2027', 'ec-dbp', 'ec-edp-bg', 'ec-fiscal-bg', 'sebra'\]$", GONE_SEBRA + "; " + SOURCE_EXTENSION),
    ("GLOSSARY", r"^glossary has 69 terms \(the plan says 64\)$", GLOSSARY_EXTENSION),
    ("ENVELOPE", r"^sebra\.json: meta\.source 'sebra' is not in core\.sources$", GONE_SEBRA),
    ("CORE", r"^sources: keys \[", GONE_SEBRA + " (the donor expects the 'sebra' source key)"),
    ("FEED", r"^expected %d events, found %d$" % (FEED_WANT, FEED_HAVE), "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^event sebra-2026-09-23 is missing$", "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^events: %d, the datasets explain %d$" % (FEED_HAVE, FEED_WANT), "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^kinds \[.*\] must be exactly the kinds used by the events$", "the donor derives the 'sebra' kind from sebra.json; V5 feed has no such event"),
    ("CATALOG", r"^files on disk but not in the catalog: \['dbp2027\.json', 'sebra\.json'\]; in the catalog but not on disk: \[\]$", GONE_SEBRA + "; Screen S34: dbp2027.json is not listed in catalog.json (S24 would change)"),
    ("CATALOG", r"^counts \{'datasets': \d+, 'files': \d+, .*'files': \d+, ", GONE_SEBRA + " (the catalog counts the listed files, the folder holds one more: sebra.json)"),
)



_used = []                                            # [(group, message, reason)]
_hit = set()


def wrap(name, fn, use_accepted):
    def run(ctx):
        chk = fn(ctx)
        if not use_accepted:
            return chk
        keep = []
        for p in chk.problems:
            for i, (g, pat, why) in enumerate(ACCEPTED):
                if g == name and re.search(pat, p):
                    _used.append((name, p, why))
                    _hit.add(i)
                    break
            else:
                keep.append(p)
        if len(keep) != len(chk.problems):
            chk.fact("%d accepted documented contract exception(s)" % (len(chk.problems) - len(keep)))
        chk.problems = keep
        return chk
    return run


def main(argv):
    use_accepted = "--no-accepted" not in argv
    argv = [a for a in argv if a != "--no-accepted"]
    orig = V.all_groups
    V.all_groups = lambda: [(n, wrap(n, fn, use_accepted), d) for n, fn, d in list(orig()) + list(execution.GROUPS)]
    code = V.main(argv)
    if use_accepted and _used:
        print("\nDOCUMENTED CONTRACT EXCEPTIONS (%d problems the donor reports; each follows from a deliberate removal, see the docstring):" % len(_used))
        seen = {}
        for g, p, why in _used:
            seen.setdefault((g, why), []).append(p)
        for (g, why), ps in seen.items():
            print("  %-9s %d x  %s" % (g, len(ps), why))
            for p in ps[:4]:
                print("             - " + p[:200])
        stale = [ACCEPTED[i] for i in range(len(ACCEPTED)) if i not in _hit]
        for g, pat, _why in stale:
            print("  note: pattern for %s matched nothing (%s)" % (g, pat[:70]))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
