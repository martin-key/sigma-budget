#!/usr/bin/env python3
"""The restore drill of acceptance scenario 10 (docs/approach-specification.md, section 11) on a test environment: the built Worker
with a local D1 and R2, as tests/release/release_check.py runs it.

    python -m tests.release.restore_drill            (pnpm install --frozen-lockfile first; the Worker is built with react-router build)

  1  releases A and B are published; B is current at revision 2
  2  backup: the registry as an SQL dump (schema, triggers and rows: what `wrangler d1 export --remote` gives in Cloudflare; locally
     the dump of the D1 database file, because `wrangler d1 export` has no --persist-to) and the objects as they are (R2 is
     content-addressed and the operator API never overwrites or deletes an object, so the bucket is its own history)
  3  the registry moves on: C is published (revision 3), then A is made current again (revision 4)
  4  loss: the registry database is gone
  5  restore: a new database from the export, the objects from their copy, and the Worker started on them
  6  checks: B is current at revision 2; the journal holds the two events of the backup with their request IDs; the manifest of B hashes
     to its release_id and every file of B is served with its SHA-256; A stays public, C does not (it was published after the backup);
     a new publish continues at revision 3 and journals itself (the trigger came back with the schema); `budget rollback` then takes
     the environment to the older release A, the registry's way to go back to a chosen release
In Cloudflare the same backup is D1 Time Travel (any minute of the last 30 days) or `wrangler d1 export`, and the bucket: docs/operator-guide.md.
Exit code 0 only when every check passes.
"""


from pathlib import Path as _Path
import json
import os
import sqlite3
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from tests.release.release_check import (AUD, ISSUER, OPERATORS, RESULTS, ROOT, Keys, budget, free_port, jbody, make_release, ok, req,  # noqa: E402
                           sha)

WRANGLER = ROOT / "node_modules" / ".bin" / "wrangler"
BUILT = ROOT / "apps" / "web" / "build" / "server" / "wrangler.json"


def dump_registry(state, out):
    """the SQL of the local registry: schema, rows and triggers (the triggers last, so that restoring the rows fires none); without the
    tables of the runtime (_cf_*) and the transaction lines, which D1 does not take in a file"""
    db = next(f for f in (state / "v3" / "d1").rglob("*.sqlite") if f.name != "metadata.sqlite")
    con = sqlite3.connect(db)
    keep = [ln for ln in con.iterdump() if ln not in ("BEGIN TRANSACTION;", "COMMIT;") and "_cf_" not in ln.split("(")[0]]
    con.close()
    # every table first, then the rows, then indexes and triggers: a row may name a row of a table later in the alphabet (D1 checks
    # foreign keys), and a trigger restored before the rows would fire on them
    tables = [ln for ln in keep if ln.startswith("CREATE TABLE")]
    rows = [ln for ln in keep if ln.startswith(("INSERT", "DELETE FROM"))]
    rest = [ln for ln in keep if ln not in tables and ln not in rows]
    out.write_text("\n".join(["PRAGMA defer_foreign_keys = true;"] + tables + rows + rest) + "\n", encoding="utf-8")


def wrangler(*args, **kw):
    return subprocess.run([str(WRANGLER), *args], cwd=ROOT, capture_output=True, text=True, **kw)


class Worker:
    """the built Worker under wrangler dev on a persisted state folder"""

    def __init__(self, state, key, tmp):
        self.state, self.key, self.tmp = state, key, tmp

    def __enter__(self):
        port = free_port()
        self.base = "http://127.0.0.1:%d" % port
        self.proc = subprocess.Popen([str(WRANGLER), "dev", "-c", str(BUILT), "--ip", "127.0.0.1", "--port", str(port), "--persist-to", str(self.state),
                                      "--var", "ACCESS_ISSUER:" + ISSUER, "--var", "ACCESS_AUD:" + AUD, "--var", "OPERATORS:" + OPERATORS,
                                      "--var", "ACCESS_JWKS:" + json.dumps({"keys": [self.key.jwk]}), "--var", "MAX_OBJECT_BYTES:4096"],
                                     cwd=ROOT, stdout=open(self.tmp / ("wrangler-%d.log" % port), "w"), stderr=subprocess.STDOUT)
        for _ in range(90):
            try:
                if req("GET", self.base + "/api/releases/current")[0] in (200, 404):
                    return self
            except OSError:
                pass
            time.sleep(1)
        self.__exit__()
        sys.exit("restore_drill: wrangler dev did not start")

    def __exit__(self, *exc):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def main():
    if not WRANGLER.exists():
        sys.exit("restore_drill: run `pnpm install --frozen-lockfile` first")
    b = subprocess.run([str(ROOT / "node_modules" / ".bin" / "react-router"), "build"], cwd=ROOT / "apps/web", capture_output=True, text=True)
    if b.returncode != 0 or not BUILT.exists():
        sys.exit("restore_drill: react-router build failed:\n" + (b.stdout + b.stderr)[-2000:])
    tmp = Path(tempfile.mkdtemp(prefix="restore-drill-"))
    state, restored, backup = tmp / "state", tmp / "restored", tmp / "registry.sql"
    key = Keys(tmp, "drill-key")
    A, B, C = (make_release(tmp, n, t) for n, t in (("A", "first"), ("B", "second"), ("C", "third")))
    r = wrangler("d1", "migrations", "apply", "DB", "--local", "-c", str(BUILT), "--persist-to", str(state))
    if r.returncode:
        sys.exit("restore_drill: migrations failed: " + r.stderr[-500:])
    try:
        print("1  A and B published")
        with Worker(state, key, tmp) as w:
            env = dict(os.environ, BUDGET_LOCAL_URL=w.base, BUDGET_ACCESS_TOKEN=key.token("alice@example.org"))
            for rel in (A, B):
                code, out = budget(["publish", "--release", str(rel[0]), "--originals", str(rel[1]), "--environment", "local", "--yes"], env)
                ok(code == 0, "publish %s (%s)" % (rel[2][:12], out.get("error") or out.get("revision")))
            before = jbody(req("GET", w.base + "/api/releases")[2]).get("items", [])
            cur = jbody(req("GET", w.base + "/api/releases/current")[2])
            ok(cur.get("release_id") == B[2] and cur.get("revision") == 2, "B is current at revision 2")

        print("2  backup")
        dump_registry(state, backup)
        sql = backup.read_text(encoding="utf-8")
        ok("CREATE TABLE" in sql and "CREATE TRIGGER" in sql and "INSERT INTO" in sql,
           "the registry dumped: its schema, triggers and rows (%d bytes of SQL)" % len(sql))
        shutil.copytree(state / "v3" / "r2", tmp / "objects-backup")
        ok(any((tmp / "objects-backup").rglob("*")), "a copy of the objects")

        print("3  the registry moves on")
        with Worker(state, key, tmp) as w:
            env = dict(os.environ, BUDGET_LOCAL_URL=w.base, BUDGET_ACCESS_TOKEN=key.token("alice@example.org"))
            code, out = budget(["publish", "--release", str(C[0]), "--originals", str(C[1]), "--environment", "local", "--yes"], env)
            ok(code == 0 and out.get("revision") == 3, "C published at revision 3")
            code, out = budget(["rollback", "--release-id", A[2], "--environment", "local", "--yes"], env)
            ok(code == 0 and out.get("revision") == 4, "A current again at revision 4")

        print("4  loss of the registry")
        shutil.rmtree(state / "v3" / "d1")
        ok(not (state / "v3" / "d1").exists(), "the registry database is gone")

        print("5  restore")
        r = wrangler("d1", "execute", "DB", "--local", "-c", str(BUILT), "--persist-to", str(restored), "--file", str(backup), "--yes")
        ok(r.returncode == 0, "the registry restored from the export into a new database" + ("" if r.returncode == 0 else ": " + r.stderr[-300:]))
        shutil.copytree(tmp / "objects-backup", restored / "v3" / "r2")

        print("6  checks")
        with Worker(restored, key, tmp) as w:
            cur = jbody(req("GET", w.base + "/api/releases/current")[2])
            ok(cur.get("release_id") == B[2] and cur.get("revision") == 2, "B is current at revision 2, as at the backup")
            after = jbody(req("GET", w.base + "/api/releases")[2]).get("items", [])
            ok(after == before and len(after) == 2, "the journal is the two events of the backup, unchanged")
            s, _h, mb = req("GET", w.base + "/data/releases/%s/manifest.json" % B[2])
            ok(s == 200 and sha(mb) == B[2], "the manifest of B hashes to its release_id")
            files = [o for o in B[3]["outputs"]] + [i for i in B[3]["inputs"]]
            good = sum(1 for f in files if (lambda x: x[0] == 200 and sha(x[2]) == f["sha256"])(req("GET", w.base + "/data/releases/%s/%s" % (B[2], f["path"]))))
            ok(good == len(files), "every file of B is served with its SHA-256 (%d of %d)" % (good, len(files)))
            ok(req("GET", w.base + "/data/releases/%s/manifest.json" % A[2])[0] == 200, "A is still public (it is in the journal)")
            ok(req("GET", w.base + "/data/releases/%s/manifest.json" % C[2])[0] == 404, "C is not public: it was published after the backup")
            env = dict(os.environ, BUDGET_LOCAL_URL=w.base, BUDGET_ACCESS_TOKEN=key.token("alice@example.org"))
            code, out = budget(["publish", "--release", str(C[0]), "--originals", str(C[1]), "--environment", "local", "--yes"], env)
            journal = jbody(req("GET", w.base + "/api/releases")[2]).get("items", [])
            ok(code == 0 and out.get("revision") == 3 and len(journal) == 3, "a new publish continues at revision 3 and is journaled")
            code, out = budget(["rollback", "--release-id", A[2], "--environment", "local", "--yes"], env)
            cur = jbody(req("GET", w.base + "/api/releases/current")[2])
            ok(code == 0 and cur.get("release_id") == A[2] and cur.get("revision") == 4, "budget rollback takes the environment to the older release A")
    finally:
        if "--keep" not in sys.argv:
            shutil.rmtree(tmp, ignore_errors=True)
    failed = [m for good, m in RESULTS if not good]
    print("RESULT: %s · %d checks, %d failed" % ("FAIL" if failed else "PASS", len(RESULTS), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
