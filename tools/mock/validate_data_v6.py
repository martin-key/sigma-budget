#!/usr/bin/env python3
"""validate_data_v6.py - validate_data.py for the version v6 (site/data at the tag mock-v6) (a thin wrapper; the donor validator and its vd_*.py modules are NOT edited).

Run:  .venv/bin/python tools/mock/validate_data_v6.py [--only GROUP,...] [-v] [--list] [--no-accepted]

What differs from validate_data.py (each point is a deliberate V5 decision, see docs/plan.md):
  * DATA / SITE of vd_lib are the checked-out site/ (the validators read the paths through the vd_lib module, so nothing else changes).
  * REBUILD and MOCK are skipped: they run build_data.py --check / validate_mock.py against the v1 donor tree and the
    donor builders know nothing of the V5 active layer (the generated "C" sets and the daily СЕБРА set are taken out by tools/v5_data_active.py).
    The same question for V5 is answered by `diff_json_v5.py tmp/versions/site-v1/data site/data` (every differing leaf is classified).
  * The SEARCH group is run with empty stand-ins for the three mock sets V5 removed (mock/projects, activities, payments); it crashed on them.
  * Problems that follow ONLY from what V5 removed on purpose are moved out of the failure count into an explicit list (ACCEPTED below: group,
    pattern, reason). They are printed with the reason at the end - nothing is hidden - and a problem not matched by a pattern stays a failure.
    --no-accepted turns the list off and shows the donor's raw verdict.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import vd_lib as L                                    # noqa: E402

# vd_lib.SITE / DATA already point at site/ (the checked-out version; run this at the tag mock-v6)

import validate_data as V                             # noqa: E402
import vd_contract                                    # noqa: E402  contract v2 of execution.json (stage B)

GONE_SEBRA = "СЕБРА (daily payments) was taken out of the active interface and of core.sources; data/sebra.json stays on disk, unreferenced, for phase 2"
GONE_SEARCH = "search shows only active real sets; the 7 pending and 2 mock datasets have no search row (docs/plan.md, search)"
V6_SRC = "V6 (screen S34): four sources were added to core.sources (dbp2027, ec-edp-bg, ec-fiscal-bg, ec-dbp) that the donor registry does not list"

def _feed_counts():
    """The donor expects 18 feed events plus one per 2026 report; the feed holds exactly one fewer (the СЕБРА event)."""
    with open(os.path.join(L.DATA, "execution.json"), encoding="utf-8") as fh:
        n = 18 + int(json.load(fh)["data"]["2026"]["months"])
    return n, n - 1


FEED_WANT, FEED_HAVE = _feed_counts()
V6_GLOSS = "V6 (screen S34): five glossary terms (65-69) were added; the donor plan still says 64 terms"
ACCEPTED = (
    ("ENVELOPE", r"^core\.sources keys differ from the registry: \['dbp2027', 'ec-dbp', 'ec-edp-bg', 'ec-fiscal-bg', 'sebra'\]$", GONE_SEBRA + "; " + V6_SRC),
    ("GLOSSARY", r"^glossary has 69 terms \(the plan says 64\)$", V6_GLOSS),
    ("ENVELOPE", r"^sebra\.json: meta\.source 'sebra' is not in core\.sources$", GONE_SEBRA),
    ("CORE", r"^sources: keys \[", GONE_SEBRA + " (the donor expects the 'sebra' source key)"),
    ("FEED", r"^expected %d events, found %d$" % (FEED_WANT, FEED_HAVE), "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^event sebra-2026-09-23 is missing$", "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^events: %d, the datasets explain %d$" % (FEED_HAVE, FEED_WANT), "the single СЕБРА event of the feed was removed with the daily set"),
    ("FEED", r"^kinds \[.*\] must be exactly the kinds used by the events$", "the donor derives the 'sebra' kind from sebra.json; V5 feed has no such event"),
    ("CATALOG", r"^files on disk but not in the catalog: \['dbp2027\.json', 'sebra\.json'\]; in the catalog but not on disk: \[\]$", GONE_SEBRA + "; V6: dbp2027.json is not listed in catalog.json (S24 would change)"),
    ("CATALOG", r"^counts \{'datasets': \d+, 'files': \d+, .*'files': \d+, ", GONE_SEBRA + " (the catalog counts the listed files, the folder holds one more: sebra.json)"),
    ("SEARCH", r"^datasets: \d+ rows, the catalog and the mock sets hold \d+$", GONE_SEARCH),
    ("SEARCH", r"^mock rows: 0, expected \d+$", GONE_SEARCH),
    ("SEARCH", r"^datasets: [\w-]+ has no row or a different status$", GONE_SEARCH),
)


class StubCtx(object):
    """The donor context, with the three mock files V5 removed answered by empty lists (the SEARCH group sums their rows)."""
    EMPTY = {"mock/projects.json": {"items": []}, "mock/activities.json": {"items": []}, "mock/payments.json": {"recipients": []}}

    def __init__(self, ctx):
        self._ctx = ctx

    def get(self, rel, *a, **k):
        if rel in self.EMPTY and not L.exists(rel):
            return self.EMPTY[rel]
        return self._ctx.get(rel, *a, **k)

    def __getattr__(self, name):
        return getattr(self._ctx, name)


_used = []                                            # [(group, message, reason)]
_hit = set()


def wrap(name, fn, use_accepted):
    def run(ctx):
        chk = fn(StubCtx(ctx) if name == "SEARCH" else ctx)
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
            chk.fact("%d accepted V5 divergence(s)" % (len(chk.problems) - len(keep)))
        chk.problems = keep
        return chk
    return run


def main(argv):
    use_accepted = "--no-accepted" not in argv
    argv = [a for a in argv if a != "--no-accepted"]
    if "--list" not in argv:
        for flag in ("--no-rebuild", "--no-mock"):
            if flag not in argv:
                argv.append(flag)                      # see the docstring: they test the donor tree
    orig = V.all_groups
    V.all_groups = lambda: [(n, wrap(n, fn, use_accepted), d) for n, fn, d in list(orig()) + list(vd_contract.GROUPS)]
    code = V.main(argv)
    if use_accepted and _used:
        print("\nACCEPTED V5 DIVERGENCES (%d problems the donor reports; each follows from a deliberate removal, see the docstring):" % len(_used))
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
