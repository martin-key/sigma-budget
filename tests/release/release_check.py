#!/usr/bin/env python3
"""The acceptance checks of stage C (docs/approach-specification.md, section 11) against the Worker on a local registry.

    python -m tests.release.release_check                  synthetic releases (no raw files needed: this is what CI runs)
    python -m tests.release.release_check --real DIR       also publish the release of `budget build` in DIR and reproduce it from the Worker

It builds the site (react-router build: the Worker of apps/web/workers/app.ts and the static files, docs/adr/0002-react-router-ssr.md) and starts
`wrangler dev` on it (node_modules, pnpm-lock.yaml) with a fresh local D1 and R2, applies migrations/, and signs Cloudflare Access
tokens with an RSA key made for the run (openssl; the Worker gets the public key as ACCESS_JWKS). Then:
  9  operator: no token, a foreign key, a wrong audience, an expired token and a person who is not an operator are refused
  3  damaged upload: wrong bytes, an object missing, an unsafe path, a too large object: nothing becomes current
  —  `budget upload` and `budget publish` publish a candidate with one command and read it back
  4  interruption: the same publish again answers the first result without a second event; a new request on an old revision is refused
  5  two operators publish at the same moment on the same revision: one succeeds, the other gets 409 and nothing is overwritten
  —  `budget rollback` makes an earlier release current with a new revision; a release that never was current cannot be rolled back to
  —  the public API: the pointer, the journal without operator names, the manifest bytes, the files by the manifest only, ETag/304, Range,
     originals in HTML as a download, unknown and unpublished releases 404, and no public route that writes
  6  one release: a screen is drawn from the current release and names it with its data base; the stable /data/<file> follows it;
     the edge cache keys a screen on the query it reads only and never keeps the 404 screen
Exit code 0 only when every check passes.
"""


from pathlib import Path as _Path
import argparse
import base64
import gzip
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ISSUER, AUD = "https://sigma-budget-test.cloudflareaccess.com", "sigma-budget-test-aud"
OPERATORS = "alice@example.org,bob@example.org"
RESULTS = []


def ok(cond, msg):
    RESULTS.append((bool(cond), msg))
    print(("  ok    " if cond else "  FAIL  ") + msg, flush=True)
    return bool(cond)


def b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def canonical(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


class Keys:
    """an RSA key for the run (openssl): the JWKS for the Worker, and RS256 tokens"""

    def __init__(self, tmp, kid):
        self.kid, self.pem = kid, tmp / ("%s.pem" % kid)
        subprocess.run(["openssl", "genrsa", "-out", str(self.pem), "2048"], check=True, capture_output=True)
        mod = subprocess.run(["openssl", "rsa", "-in", str(self.pem), "-noout", "-modulus"], check=True, capture_output=True, text=True).stdout
        n = bytes.fromhex(mod.strip().split("=", 1)[1])
        self.jwk = {"kty": "RSA", "kid": kid, "alg": "RS256", "use": "sig", "n": b64(n), "e": b64((65537).to_bytes(3, "big"))}

    def token(self, email=None, aud=AUD, iss=ISSUER, exp_in=600, common_name=None):
        head = b64(json.dumps({"alg": "RS256", "kid": self.kid, "typ": "JWT"}).encode())
        now = int(time.time())
        claims = {"iss": iss, "aud": [aud], "iat": now, "nbf": now, "exp": now + exp_in}
        if email:
            claims["email"] = email
        if common_name:
            claims["common_name"] = common_name
        body = b64(json.dumps(claims).encode())
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(self.pem)], input=(head + "." + body).encode(),
                             check=True, capture_output=True).stdout
        return head + "." + body + "." + b64(sig)


def req(method, url, body=None, headers=None):
    r = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def jbody(b):
    try:
        return json.loads(b.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}


def free_port():
    return int(os.environ.get('BUDGET_TEST_PORT', '8816'))


def make_release(root, name, text, commit="a" * 40):
    """a small release folder and its originals: one data file per dataset, validation.json, an xls-like and an HTML original"""
    rel, orig = root / ("rel-" + name), root / ("orig-" + name)
    feed = ('<rss version="2.0"><channel><title>%s</title><link>https://budget-na-svetlo.example/</link>'
            '<item><link>https://budget-na-svetlo.example/#/izpalnenie?mesec=9</link></item></channel></rss>\n' % text).encode()
    files = {"data/x.json": json.dumps({"meta": {"status": "real"}, "value": text}).encode(), "data/feed.xml": feed,
             "validation.json": b'{"passed":true}\n'}
    originals = {"data/originals/kfp_2026/report.xls": b"\xd0\xcf\x11\xe0" + text.encode() * 8,
                 "data/originals/dv/law.html": ("<html><script>alert(1)</script>%s</html>" % text).encode()}
    for p, b in files.items():
        (rel / p).parent.mkdir(parents=True, exist_ok=True)
        (rel / p).write_bytes(b)
    for p, b in originals.items():
        (orig / p).parent.mkdir(parents=True, exist_ok=True)
        (orig / p).write_bytes(b)
    mime = {".json": "application/json", ".xls": "application/vnd.ms-excel", ".html": "text/html", ".xml": "application/rss+xml"}
    m = {"manifest_schema": "budget-release/1", "data_schema": {"execution": "execution/2"}, "provenance_format": "provenance/1",
         "processing": {"code": {"commit": commit, "repository": "https://github.com/midt-bg/sigma-budget"}, "parameters": {"build_date": "2026-11-05"}},
         "inputs": [{"path": p, "kind": "source", "source": "test", "acquisition": "fetch", "mime": mime[Path(p).suffix], "bytes": len(b), "sha256": sha(b)}
                    for p, b in originals.items()],
         "outputs": [dict({"path": p, "mime": mime[Path(p).suffix], "bytes": len(b), "sha256": sha(b)}, **({"dataset": "x"} if p.startswith("data/") else {"role": "validation"}))
                     for p, b in files.items()],
         "coverage": {}, "compatibility": {}}
    mb = canonical(m)
    (rel / "manifest.json").write_bytes(mb)
    return rel, orig, sha(mb), m


def budget(args, env):
    r = subprocess.run([sys.executable, "-m", "budget_pipeline.cli", "--json"] + args, capture_output=True, text=True, env=env)
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        return r.returncode, {"stdout": r.stdout[-400:], "stderr": r.stderr[-400:]}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--real", help="a release folder of `budget build` to publish and reproduce as well")
    ap.add_argument("--keep", action="store_true", help="keep the temporary folder")
    a = ap.parse_args(argv)
    wrangler = ROOT / "node_modules" / ".bin" / "wrangler"
    if not wrangler.exists():
        sys.exit("release_check: run `pnpm install --frozen-lockfile` first (wrangler from pnpm-lock.yaml)")
    tmp = Path(tempfile.mkdtemp(prefix="release-check-"))
    state = tmp / "state"
    built = ROOT / "apps" / "web" / "build" / "server" / "wrangler.json"
    b = subprocess.run([str(ROOT / "node_modules" / ".bin" / "react-router"), "build"], cwd=ROOT / "apps/web", capture_output=True, text=True)
    if b.returncode != 0 or not built.exists():
        sys.exit("release_check: react-router build failed:\n" + (b.stdout + b.stderr)[-2000:])
    key, foreign = Keys(tmp, "test-key"), Keys(tmp, "foreign-key")
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    subprocess.run([str(wrangler), "d1", "migrations", "apply", "DB", "--local", "-c", str(built), "--persist-to", str(state)], cwd=ROOT, check=True, capture_output=True)
    dev = subprocess.Popen([str(wrangler), "dev", "-c", str(built), "--ip", "127.0.0.1", "--port", str(port), "--persist-to", str(state),
                            "--var", "ACCESS_ISSUER:" + ISSUER, "--var", "ACCESS_AUD:" + AUD, "--var", "OPERATORS:" + OPERATORS,
                            "--var", "SERVICE_TOKENS:ci-publisher", "--var", "ACCESS_JWKS:" + json.dumps({"keys": [key.jwk]}),
                            "--var", "MAX_OBJECT_BYTES:%d" % (64 * 1024 * 1024 if a.real else 4096)], cwd=ROOT, stdout=open(tmp / "wrangler.log", "w"), stderr=subprocess.STDOUT)
    try:
        for _ in range(90):
            try:
                if req("GET", base + "/api/releases/current")[0] in (200, 404):
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            sys.exit("release_check: wrangler dev did not start (%s)" % (tmp / "wrangler.log"))
        alice = {"Cf-Access-Jwt-Assertion": key.token("alice@example.org")}
        bob = {"Cf-Access-Jwt-Assertion": key.token("bob@example.org")}
        env = dict(os.environ, BUDGET_LOCAL_URL=base, BUDGET_ACCESS_TOKEN=alice["Cf-Access-Jwt-Assertion"])
        A = make_release(tmp, "A", "first")
        B = make_release(tmp, "B", "second")
        C = make_release(tmp, "C", "third")
        D = make_release(tmp, "D", "fourth")

        print("empty environment")
        s, _h, b = req("GET", base + "/api/releases/current")
        ok(s == 404 and jbody(b).get("message") == "няма публикувано издание", "no release yet: 404 with „няма публикувано издание“, no fallback")

        print("9 operator access")
        s, _h, _b = req("POST", base + "/admin/operations", b"{}")
        ok(s == 401, "no token: 401")
        s, _h, _b = req("POST", base + "/admin/operations", b"{}", {"Cf-Access-Jwt-Assertion": foreign.token("alice@example.org")})
        ok(s == 401, "a token of another key: 401")
        s, _h, _b = req("POST", base + "/admin/operations", b"{}", {"Cf-Access-Jwt-Assertion": key.token("alice@example.org", aud="other-app")})
        ok(s == 401, "a token for another Access application (audience): 401")
        s, _h, _b = req("POST", base + "/admin/operations", b"{}", {"Cf-Access-Jwt-Assertion": key.token("alice@example.org", exp_in=-3600)})
        ok(s == 401, "an expired token: 401")
        s, _h, _b = req("POST", base + "/admin/operations", b"{}", {"Cf-Access-Jwt-Assertion": key.token("carol@example.org")})
        ok(s == 403, "a valid login of a person who is not an operator here: 403")
        s, _h, _b = req("GET", base + "/admin/operations/00000000-0000-0000-0000-000000000000", headers={"Cf-Access-Jwt-Assertion": key.token(common_name="ci-publisher")})
        ok(s == 404, "a service token in SERVICE_TOKENS is an operator (unknown operation: 404, not 401/403)")

        print("3 damaged upload")
        bad = json.loads(A[0].joinpath("manifest.json").read_bytes())
        bad["outputs"][0]["path"] = "../escape.json"
        s, _h, b = req("POST", base + "/admin/operations", canonical(bad), dict(alice, **{"Content-Type": "application/json"}))
        ok(s == 422 and any("unsafe path" in p for p in jbody(b).get("problems", [])), "a manifest with ../ in a path: 422")
        s, _h, b = req("POST", base + "/admin/operations", B[0].joinpath("manifest.json").read_bytes(), dict(alice, **{"Content-Type": "application/json"}))
        op = jbody(b).get("operation_id")
        ok(s == 201 and jbody(b).get("release_id") == B[2], "an operation for B, the manifest stored and checked at once")
        target = B[3]["outputs"][0]
        s, _h, b = req("PUT", base + "/admin/operations/%s/objects/%s" % (op, target["sha256"]), b"not the bytes of the manifest", alice)
        ok(s == 422, "wrong bytes for a listed sha256: 422, the key is not taken")
        s, _h, b = req("PUT", base + "/admin/operations/%s/objects/%s" % (op, "0" * 64), b"x", alice)
        ok(s == 404, "an object the manifest does not list: 404")
        if not a.real:                                       # with --real the limit is 64 MB: the real originals are larger than 4 KB
            s, _h, b = req("PUT", base + "/admin/operations/%s/objects/%s" % (op, target["sha256"]), b"x" * 5000, alice)
            ok(s == 413, "an object over MAX_OBJECT_BYTES: 413")
        s, _h, b = req("POST", base + "/admin/operations/%s/seal" % op, b"{}", alice)
        ok(s == 409 and jbody(b).get("needed"), "seal with objects missing: 409, no candidate")
        s, _h, b = req("PUT", base + "/admin/operations/%s/objects/%s" % (op, target["sha256"]), B[0].joinpath(target["path"]).read_bytes(), bob)
        ok(s == 403, "another operator cannot write into this operation: 403")
        s, _h, b = req("POST", base + "/admin/publish", json.dumps({"release_id": B[2], "expected_revision": 0, "request_id": "r-b-unsealed-0000001"}).encode(),
                       dict(alice, **{"Content-Type": "application/json"}))
        ok(s == 404, "publish of a candidate that was never sealed: 404")
        s, _h, b = req("GET", base + "/api/releases/current")
        ok(s == 404, "nothing became current")

        print("publish with one command")
        code, r = budget(["publish", "--release", str(A[0]), "--originals", str(A[1]), "--environment", "local", "--yes"], env)
        ok(code == 0 and r.get("release_id") == A[2] and r.get("revision") == 1, "budget publish A: uploaded, sealed, current at revision 1, read back (%s)" % json.dumps(r)[:300])
        code, r = budget(["status", "--environment", "local"], env)
        ok(code == 0 and r.get("release_id") == A[2] and len(r.get("journal", [])) == 1, "budget status: A at revision 1, one journal entry")
        for X in (B, C, D):
            code, r = budget(["upload", "--release", str(X[0]), "--originals", str(X[1]), "--environment", "local", "--yes"], env)
            ok(code == 0 and r.get("release_id") == X[2], "budget upload %s: a sealed candidate" % X[2][:8])
        code, r = budget(["upload", "--release", str(B[0]), "--originals", str(B[1]), "--environment", "local", "--yes"], env)
        ok(code == 0 and r.get("objects") == 0, "budget upload again: resumed from the receipt, nothing sent twice")

        print("4 interruption")
        pub = lambda rid, rev, rq, hdr=alice, kind="publish": req("POST", base + "/admin/publish",  # noqa: E731
                                                                  json.dumps({"release_id": rid, "expected_revision": rev, "request_id": rq, "kind": kind}).encode(),
                                                                  dict(hdr, **{"Content-Type": "application/json"}))
        s1, _h, b1 = pub(B[2], 1, "r-b-0000000000000001")
        s2, _h, b2 = pub(B[2], 1, "r-b-0000000000000001")
        ok(s1 == 200 and jbody(b1).get("revision") == 2, "publish B on revision 1: revision 2")
        ok(s2 == 200 and jbody(b2).get("replay") and jbody(b2).get("revision") == 2, "the same request again: the first result, replay, no new revision")
        s, _h, b = pub(C[2], 1, "r-b-0000000000000001")
        ok(s == 422, "the same request_id with another payload: 422")
        s, _h, b = pub(C[2], 1, "r-c-0000000000000002")
        ok(s == 409 and jbody(b).get("current_release_id") == B[2], "a new request on the old revision: 409, the current release is named, B stays")
        s, _h, b = req("GET", base + "/api/releases?limit=50")
        ok(s == 200 and len(jbody(b).get("items", [])) == 2, "two journal events, not three")

        print("5 two operators at the same moment")
        out = {}

        def race(name, rid, hdr):
            out[name] = pub(rid, 2, "r-race-%s-000000000" % name, hdr)
        ts = [threading.Thread(target=race, args=("alice", C[2], alice)), threading.Thread(target=race, args=("bob", D[2], bob))]
        [t.start() for t in ts]
        [t.join() for t in ts]
        codes = sorted(v[0] for v in out.values())
        ok(codes == [200, 409], "one publish succeeds and the other gets 409 (%s)" % codes)
        winner = [k for k, v in out.items() if v[0] == 200]
        s, _h, b = req("GET", base + "/api/releases/current")
        cur = jbody(b)
        ok(cur.get("revision") == 3 and cur.get("release_id") == {"alice": C[2], "bob": D[2]}[winner[0]] if winner else False,
           "the pointer holds the winner at revision 3; the loser overwrote nothing")

        print("rollback")
        env_b = dict(env, BUDGET_ACCESS_TOKEN=bob["Cf-Access-Jwt-Assertion"])
        code, r = budget(["rollback", "--release-id", A[2], "--environment", "local", "--yes"], env_b)
        ok(code == 0 and r.get("revision") == 4 and r.get("release_id") == A[2], "budget rollback to A: revision 4, read back (%s)" % json.dumps(r)[:300])
        loser = D if winner and winner[0] == "alice" else C
        code, r = budget(["rollback", "--release-id", loser[2], "--environment", "local", "--yes"], env_b)
        ok(code == 5 or (code != 0 and "current before" in json.dumps(r)), "rollback to a release that was never current: refused")
        code, r = budget(["publish", "--release", str(B[0]), "--originals", str(B[1]), "--environment", "local", "--yes", "--dry-run"], env)
        ok(code == 0 and r.get("dryRun") and r.get("expected_revision") == 4, "publish --dry-run reads the revision and writes nothing (%s)" % json.dumps(r)[:300])
        s, _h, b = req("GET", base + "/api/releases/current")
        ok(jbody(b).get("revision") == 4, "after the dry run the revision is still 4")

        print("public API")
        s, h, b = req("GET", base + "/api/releases/current")
        ok(s == 200 and h.get("Cache-Control") == "no-store" and jbody(b).get("manifest") == "/data/releases/%s/manifest.json" % A[2], "the pointer: no-store, the manifest URL")
        s, _h, b = req("GET", base + "/api/releases?limit=2")
        j = jbody(b)
        ok(s == 200 and len(j["items"]) == 2 and j.get("next") and "@" not in b.decode(), "the journal is paged and names no operator (%d bytes)" % len(b))
        s, h, b = req("GET", base + "/data/releases/%s/manifest.json" % A[2])
        ok(s == 200 and sha(b) == A[2] and "immutable" in h.get("Cache-Control", ""), "the manifest bytes hash to the release_id; immutable")
        out0 = A[3]["outputs"][0]
        s, h, b = req("GET", base + "/data/releases/%s/%s" % (A[2], out0["path"]))
        ok(s == 200 and sha(b) == out0["sha256"] and h.get("ETag") == '"%s"' % out0["sha256"], "an output: its bytes and the ETag of its sha256")
        s, h, b = req("GET", base + "/data/releases/%s/%s" % (A[2], out0["path"]), headers={"Accept-Encoding": "gzip"})
        ok(s == 200 and h.get("Content-Encoding") == "gzip" and sha(gzip.decompress(b)) == out0["sha256"] and h.get("ETag") == 'W/"%s"' % out0["sha256"]
           and "no-transform" in h.get("Cache-Control", ""), "compressed by the Worker (no-transform keeps the edge from it): it decodes to the bytes of the sha256 (%s, %s, %d bytes)"
           % (h.get("Content-Encoding"), h.get("ETag"), len(b)))
        s, _h, _b = req("GET", base + "/data/releases/%s/%s" % (A[2], out0["path"]), headers={"If-None-Match": '"%s"' % out0["sha256"]})
        ok(s == 304, "If-None-Match: 304")
        s, h, b = req("GET", base + "/data/releases/%s/%s" % (A[2], out0["path"]), headers={"Range": "bytes=0-9"})
        ok(s == 206 and len(b) == 10 and h.get("Content-Range", "").startswith("bytes 0-9/"), "Range: 206 with ten bytes")
        s, h, _b = req("GET", base + "/data/releases/%s/data/originals/dv/law.html" % A[2])
        ok(s == 200 and "attachment" in h.get("Content-Disposition", "") and h.get("Content-Security-Policy") == "sandbox",
           "an HTML original is a download in a sandbox, not a page of this origin")
        ok("no-transform" in h.get("Cache-Control", ""), "release files are no-transform: the edge may not edit their bytes (a Web Analytics beacon)")
        s, _h, _b = req("GET", base + "/data/releases/%s/data/not-listed.json" % A[2])
        ok(s == 404, "a file the manifest does not list: 404")
        s, _h, _b = req("GET", base + "/data/releases/%s/%%2e%%2e/%%2e%%2e/secret" % A[2])
        ok(s == 404, "an encoded ../ path: 404")
        never = (C if winner and winner[0] == "bob" else D)[2]
        s, _h, _b = req("GET", base + "/data/releases/%s/manifest.json" % never)
        ok(s == 404, "a candidate that never was current is not public: 404")
        s, _h, b = req("GET", base + "/api/releases/%s/datasets/x" % A[2])
        ok(s == 200 and jbody(b).get("release_id") == A[2] and jbody(b).get("files"), "a dataset of the release carries the release ID and the schema")
        for m_, path in (("POST", "/api/releases/current"), ("PUT", "/data/releases/%s/data/x.json" % A[2]), ("DELETE", "/data/releases/%s/manifest.json" % A[2])):
            s, _h, _b = req(m_, base + path, b"x")
            ok(s == 405, "%s %s: 405, no public route writes" % (m_, path.split("/")[1]))

        print("one release on the screen (scenario 6)")
        cur = jbody(req("GET", base + "/api/releases/current")[2])
        rid = cur.get("release_id", "")
        files = {"A": A, "B": B, "C": C, "D": D}
        x = next((r for r in files.values() if r[2] == rid), None)
        s, h, b = req("GET", base + "/izpalnenie")
        page = b.decode("utf-8", "replace")
        ok(s == 200 and h.get("X-Release-Id") == rid and ('<meta name="release-id" content="%s"/>' % rid) in page
           and ('<meta name="data-base" content="/data/releases/%s/data/"/>' % rid) in page,
           "a screen is drawn from the current release and names it, with the data base of that release")
        ok("no-transform" in h.get("Cache-Control", "") and h.get("Content-Security-Policy", "").startswith("default-src 'self'"),
           "the document is no-transform and carries the content security policy")
        time.sleep(1)                                          # the copy is stored after the response (ctx.waitUntil)
        s2, h2, b2 = req("GET", base + "/izpalnenie")
        ok(s2 == 200 and h2.get("X-Screen-Cache") == "HIT" and h2.get("X-Release-Id") == rid and b2 == b and "max-age=0" in h2.get("Cache-Control", ""),
           "the screen again comes from the edge cache: the same bytes, the same release, revalidated by the visitor")
        s3, h3, b3 = req("GET", base + "/izpalnenie", headers={"Accept-Encoding": "gzip"})
        ok(s3 == 200 and h3.get("Content-Encoding") == "gzip" and gzip.decompress(b3) == b and "no-transform" in h3.get("Cache-Control", ""),
           "the document is compressed by the Worker for a visitor that accepts gzip (no-transform keeps the edge from it), the same bytes")
        s4, h4, b4 = req("GET", base + "/izpalnenie?x=junk&utm_source=feed")
        ok(s4 == 200 and h4.get("X-Screen-Cache") == "HIT" and b4 == b,
           "a key the screen does not read (?x=, ?utm_source=) lands on the same cache entry: the same bytes, no new render")
        s5, h5, _b5 = req("GET", base + "/izpalnenie?mesec=1")
        ok(s5 == 200 and h5.get("X-Screen-Cache") == "MISS", "a key the screen reads (?mesec=) is an entry of its own")
        s6, h6, _b6 = req("GET", base + "/ne-e-ekran")
        time.sleep(1)
        s7, h7, _b7 = req("GET", base + "/ne-e-ekran")
        ok(s6 == 404 and s7 == 404 and h7.get("X-Screen-Cache") == "BYPASS", "the 404 screen is never kept in the edge cache")
        s, h, b = req("GET", base + "/data/x.json")
        ok(s == 200 and x is not None and sha(b) == next(o["sha256"] for o in x[3]["outputs"] if o["path"] == "data/x.json") and h.get("X-Release-Id") == rid,
           "the stable address /data/x.json serves the file of the current release")
        s, h, b = req("GET", base + "/data/feed.xml")
        feed = b.decode("utf-8", "replace")
        ok(s == 200 and h.get("X-Release-Id") == rid and "budget-na-svetlo.example" not in feed and "#/" not in feed
           and "/izpalnenie?mesec=9</link>" in feed, "the stable /data/feed.xml of a registry release links to the site, not to the placeholder host")
        s, _h, b = req("GET", base + "/data/releases/%s/data/feed.xml" % rid)
        ok(s == 200 and x is not None and sha(b) == next(o["sha256"] for o in x[3]["outputs"] if o["path"] == "data/feed.xml"),
           "the feed.xml of the release itself keeps its bytes (its SHA-256 is in the manifest)")
        s, h, b = req("GET", base + "/proverka")
        page = b.decode("utf-8", "replace")
        revs = [e["revision"] for e in jbody(req("GET", base + "/api/releases?limit=50")[2]).get("items", [])]
        ok(s == 200 and 'data-view="ready"' in page and rid in page and 'id="s35-journal' in page and all(">%d<" % r in page for r in revs),
           "„Данни и проверка“ (section 9.1) is drawn from the current release, with its files and the registry's journal (%d revisions)" % len(revs))

        if a.real:
            print("the release of budget build, published and reproduced from the Worker")
            rel = Path(a.real).resolve()
            code, r = budget(["publish", "--release", str(rel), "--environment", "local", "--yes"], env)
            ok(code == 0, "budget publish of %s (%s)" % (rel.name, r.get("error", r.get("release_id"))))
            rid = r.get("release_id", "")
            s, _h, b = req("GET", base + "/api/releases/%s/provenance/data/2026-09/kfp/rev" % rid)
            pj = jbody(b)
            ok(s == 200 and pj.get("cell") == "B11" and pj.get("value") == "33898.456" and pj.get("original", {}).get("download"),
               "provenance of data/2026-09/kfp/rev: B11 of the September report, 33898.456, with the original to download")
            time.sleep(11)                                     # the Worker reads the pointer at most every ten seconds (apps/web/workers/release-data.ts)
            s, h, b = req("GET", base + "/izpalnenie")
            page = b.decode("utf-8", "replace")
            ok(s == 200 and h.get("X-Release-Id") == rid and 'data-view="ready"' in page and "/data/releases/%s/data/execution-provenance.json" % rid in page,
               "the monthly screen is drawn from the published release, and its provenance link is the file of that release")
            code, r = budget(["reproduce", "--current", base], dict(env))
            ok(code == 0 and r.get("verdict") == "reproduced byte for byte",
               "budget reproduce --current: the originals downloaded from the release, rebuilt byte for byte (%s)" % (r.get("verdict") or json.dumps(r)[:400]))
    finally:
        dev.terminate()
        try:
            dev.wait(timeout=20)
        except subprocess.TimeoutExpired:
            dev.kill()
        if not a.keep:
            shutil.rmtree(tmp, ignore_errors=True)
        shutil.rmtree(ROOT / "work" / "receipts", ignore_errors=True)
    failed = [m for good, m in RESULTS if not good]
    print("RESULT: %s · %d checks, %d failed" % ("PASS" if not failed else "FAIL", len(RESULTS), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
