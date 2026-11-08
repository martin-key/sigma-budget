"""REBUILD and MOCK groups of base.py: two other programs are run as child processes and a non-zero exit is a violation.

REBUILD  datasets.py --check: every file of data/release (except DATA2's mock sets, glossary and guide) is rebuilt in memory and
         compared with the disk, so a file edited by hand, stale or missing is caught (about 30 s).
MOCK     validate_mock.py (DATA2's validator): the mock sets M01-M07, the glossary and the guide.
Pure standard library; nothing here writes a file."""


from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import os
import subprocess
import sys

from budget_pipeline.validate.checks import Check

HERE = os.path.dirname(os.path.abspath(__file__))


def _child(c, script, args, what, timeout):
    try:
        p = subprocess.run([sys.executable, os.path.join(ROOT, "pipeline/budget_pipeline/build" if script == "datasets.py" else "reference/mock", script)] + list(args), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        c.fail("%s did not finish in %d s" % (script, timeout))
        return
    lines = [x for x in p.stdout.splitlines() if x.strip() and "deprecat" not in x.lower() and "pymupdf_layout" not in x.lower()]
    c.ok(p.returncode == 0, "%s exit %d: %s" % (script, p.returncode, " | ".join(x.strip() for x in lines[-6:])))
    if p.returncode == 0:
        c.fact("%s: %s" % (what, (lines[-1].strip() if lines else "no output")[:110]))


def g_rebuild(ctx):
    c = Check("REBUILD")
    _child(c, "datasets.py", ["--check"], "datasets.py --check, every file equals its builder's output", 600)
    return c


def g_mock(ctx):
    c = Check("MOCK")
    _child(c, "validate_mock.py", [], "validate_mock.py", 600)
    return c


GROUPS = (("REBUILD", g_rebuild, "datasets.py --check as a child process: every generated file equals what its builder produces"),
          ("MOCK", g_mock, "validate_mock.py (DATA2) as a child process: mock sets M01-M07, glossary, guide"))
