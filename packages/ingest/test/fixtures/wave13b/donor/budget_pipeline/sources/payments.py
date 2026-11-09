#!/usr/bin/env python3
"""D24 inputs: the two other daily SEBRA summaries that the МИДТ page lists next to the one in data/originals/sebra.

The page https://midt.gov.bg/bg/transparency/sebra/2026 lists three files for August 2026 (27.08, 28.08, 31.08). The frozen input archive
holds only 31.08; this script downloads the other two (about 12 KB each) into data/cache/ so that sebra.json can show three days.
The build reads only the cache, so it runs offline once the files exist; a missing cache just means fewer days (never invented ones).
`--refresh` forces a new download. A network failure is a warning, not an error (exit 0).
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import hashlib
import sys
import urllib.request

from budget_pipeline.build.data_io import CACHE, say

UA = "budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)"
BASE = "https://midt.gov.bg/upload/"
FILES = {  # cache name -> (url path, expected content)
    "sebra_27.08.2026.xlsx": "3789/27.08..2026.xlsx",
    "sebra_28.08.2026.xlsx": "3790/28.08..2026.xlsx",
}
MAX_BYTES = 200_000


def fetch(name, path, refresh):
    dest = CACHE / name
    if dest.exists() and not refresh:
        say("cache hit %s" % name)
        return True
    try:
        req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
        data = urllib.request.urlopen(req, timeout=60).read(MAX_BYTES + 1)
    except Exception as e:          # offline or blocked: the build copes without the file
        say("WARNING: %s not downloaded (%s)" % (name, e))
        return False
    if len(data) > MAX_BYTES or data[:2] != b"PK":
        say("WARNING: %s is not a small xlsx file (%d bytes); ignored" % (name, len(data)))
        return False
    CACHE.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    say("downloaded %s: %d bytes, sha256 %s" % (name, len(data), hashlib.sha256(data).hexdigest()[:16]))
    return True


def main(argv):
    refresh = "--refresh" in argv
    for name, path in FILES.items():
        fetch(name, path, refresh)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
