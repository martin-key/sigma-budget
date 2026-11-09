# Wave 17a validation evidence

The corpus and unchanged donor files are copied from Git revision `8b68ae1bd5617152dc45c6ed168f788345a27ec5`. `provenance.json` pins each byte, the original 37 cases and their oracle. The corpus includes the release dataset files, population input, route catalogue and page JavaScript read by CORE and CATALOG. Release manifests are excluded from the donor's file inventory. The separately pinned overlay supplies `releases/current.json`, which page needs nevertheless consult; it comes from the same Git revision. Captured bytes do not prove historical original acquisition.

With Python 3.12, run `PYTHONDONTWRITEBYTECODE=1 python generate_oracle.py --check`, `python generate_oracle.py --extra --check`, and `python wrapper/generate.py --check`. These regenerate the full raw observations and exercise the unmodified production wrapper and registration declarations. Each scenario runs in an isolated copy, with no live release, cache, registry or source reads. The additional cases and their hashes are kept separately from the original 37 results. The original capture omitted the dynamic release pointer and is preserved as received; the supplemental cases use the complete corpus and pointer.

The raw complete-corpus baseline has one CORE problem, two CATALOG problems and 15 CATALOG warnings. The original 37-case capture has 17 warnings because it lacks the dynamic pointer. Production's existing broad compatibility patterns accept the three baseline findings. The scoped TypeScript runner accepts only these exact findings, retains the raw result and warnings, and rejects new drift that the older broad patterns could also match. `--no-accepted` reports all raw problems. The report is explicitly incomplete: SEARCH, FEED and other unported groups remain outside this scope.

The frozen `search_feed.py` retains its original trailing blank line byte for byte, including the whitespace flagged by `git diff --check` on a newly copied file.

`integer/generate_oracle.py --check` independently captures 148 population-year
integer scenarios from the unchanged Python 3.12 donor. It covers numeric
whitespace, underscore/sign grammar, every Unicode 15.0 decimal digit block,
later Unicode digits and invalid nonprintable characters. Its separately pinned
Unicode data supplies the decimal and diagnostic repertoire; direct and compiled
CORE checks compare complete outcomes. Numeric whitespace deliberately differs
from Python `str.strip` and JavaScript `trim`. Earlier captures remain immutable.

`integer-limit/generate_oracle.py --check` adds fourteen complete donor outcomes at
the pinned Python 3.12 default limit of 4,300 decimal digits. Plain, signed,
underscored, fullwidth and whitespace variants preserve both the accepted
4,300-digit control and the rejected 4,301-digit case, including leading zeroes.
Four invalid-literal controls preserve Python's 200-codepoint diagnostic bound.
