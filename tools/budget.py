#!/usr/bin/env python3
"""budget: build, check and reproduce a data release (docs/approach-specification.md, sections 5, 6.3, 6.4 and 8; docs/release.md).

Public operations, no credentials:
  budget collect        [--out work/acquisition]               download every source the registry can fetch; snapshot.json lists them
  budget import-source  --source kfp --file F [--url U]         a file downloaded by a person (tools/data/raw_sources.py import)
  budget build          [--commit REV] [--inputs DIR] [--out work/candidate] [--build-date YYYY-MM-DD] [--site]
                        the release of one commit: the code of that commit, the inputs of DIR (default: this checkout), the pinned image;
                        writes data/, validation.json and manifest.json; --site also puts the outputs and the manifest into site/data
  budget validate       (--release DIR | --site)                the manifest, the bytes and sha256 of every output, the data checks;
                        --site: the release published in site/data, as CI checks it
  budget reproduce      (--manifest PATH|URL | --current SITE) [--originals DIR]
                        rebuild the release from its commit and its originals and compare every output byte for byte
  budget refetch        (--manifest PATH|URL | --current SITE) [--out DIR]
                        download the originals again from their official addresses and compare them with the release

Every command prints a readable report, or JSON with --json. Exit codes (section 8.3):
  0 checked, nothing differs   1 differences   2 invalid data or usage   3 missing input or unavailable source (unverified)
  (4 auth, 5 revision conflict and 6 unconfirmed publish belong to `publish`, stage C)
The build runs in the image of tools/data/Dockerfile (--env docker, the default when docker answers) or in .venv-data (--env local).
"""
import argparse
import hashlib
import io
import json
import os
import shutil
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from fnmatch import fnmatchcase
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SCHEMA = "budget-release/1"
INPUT_DIRS = ("prototype/data/raw", "tools/mock/cache", "tmp/research")          # inputs that are not in git (sources/registry.yaml)
WORDING_TAGS = ("mock-v2", "mock-v4")
WORDING_FILES = ("catalog.json", "core.json", "search-index.json")
RELEASES = "releases"                                                            # site/data/releases/: the manifests, not outputs
UA = "budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)"
MIME = {".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".zip": "application/zip", ".7z": "application/x-7z-compressed", ".json": "application/json", ".jsonld": "application/ld+json",
        ".xml": "application/xml", ".html": "text/html", ".txt": "text/plain", ".csv": "text/csv"}
MAGIC = {".pdf": b"%PDF", ".zip": b"PK", ".docx": b"PK", ".xlsx": b"PK", ".xls": b"\xd0\xcf\x11\xe0", ".7z": b"7z\xbc\xaf"}
EXIT_OK, EXIT_DIFF, EXIT_INVALID, EXIT_MISSING = 0, 1, 2, 3


class Fail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


# ------------------------------------------------------------------------------------------------------------------------ helpers
def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_json(obj):
    """the exact bytes of a manifest: UTF-8, sorted keys, no spaces, one final newline"""
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def git(*args, cwd=ROOT, binary=False):
    r = subprocess.run(["git"] + list(args), cwd=str(cwd), capture_output=True)
    if r.returncode:
        raise Fail(EXIT_INVALID, "git %s: %s" % (" ".join(args), r.stderr.decode("utf-8", "replace").strip()))
    return r.stdout if binary else r.stdout.decode("utf-8").strip()


def yaml_load(path):
    try:
        import yaml
    except ImportError:
        raise Fail(EXIT_INVALID, "PyYAML is needed (requirements-dev.lock or tools/data/requirements.lock)")
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))


def tls_context():
    """certifi's bundle when it is installed (tools/data/requirements.txt: the Python of uv does not accept the chain of ec.europa.eu)"""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def fetch(url, timeout=60, tries=3):
    """bytes of a public URL; a plain HTTP client with retries (section 5.1). Raises Fail(EXIT_MISSING) when it cannot."""
    last = None
    ctx = tls_context()
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
                return res.read()
        except (urllib.error.URLError, OSError) as e:          # HTTPError is a URLError
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (401, 403, 404):
                break
            time.sleep(2 * (i + 1))
    raise Fail(EXIT_MISSING, "%s: %s" % (url, last))


def read_location(loc):
    """a manifest from a path or a URL -> (bytes, base): `base` resolves the outputs listed in it"""
    if urllib.parse.urlparse(loc).scheme in ("http", "https"):
        return fetch(loc), loc.rsplit("/", 1)[0] + "/"
    p = Path(loc).resolve()
    if not p.is_file():
        raise Fail(EXIT_MISSING, "no manifest at %s" % loc)
    return p.read_bytes(), str(p.parent) + "/"


def current_manifest(site):
    """--current SITE: resolve the public pointer once (section 6.4) and keep to that release"""
    site = site.rstrip("/")
    cur = json.loads(fetch(site + "/data/%s/current.json" % RELEASES).decode("utf-8"))
    return site + "/data/" + cur["manifest"].split("data/", 1)[-1], cur["release_id"]


def kind_ok(path, head):
    ext = Path(path).suffix.lower()
    if ext in MAGIC:
        return head.startswith(MAGIC[ext])
    low = head[:512].lower().lstrip()
    if ext in (".json", ".jsonld"):
        return low[:1] in (b"{", b"[")
    if ext == ".xml":
        return low.startswith(b"<?xml") and b"<html" not in low
    return True


# ------------------------------------------------------------------------------------------------------------------------ inputs
def registry_inputs(root, inputs_dir):
    """the files the build reads, from the registries: path -> {kind, source, datasets, entry}; and the declared ones that are missing"""
    sreg = yaml_load(root / "sources" / "registry.yaml")
    dreg = yaml_load(root / "datasets" / "registry.yaml")
    sources = {s["id"]: s for s in sreg["sources"]}
    inter = {i["path"]: i for i in sreg.get("intermediates", [])}
    found, missing = {}, {}
    for d in dreg["datasets"]:
        if d["status"] == "pending":
            continue
        for x in d.get("inputs", []):
            if x in sources:
                s = sources[x]
                if s["acquisition"] in ("reference", "generated"):
                    continue
                pats = [(f["path"], f) for f in s.get("files", [])]
                kind, sid = "source", x
            elif x in inter:
                pats, kind, sid = [(x, inter[x])], "intermediate", None
            else:
                continue                                       # another dataset: an output of the same build
            for pat, entry in pats:
                if not pat.startswith(INPUT_DIRS):
                    continue                                   # in git at the commit (prototype/src) or not read by the build
                hits = sorted(p.relative_to(inputs_dir).as_posix() for p in inputs_dir.glob(pat) if p.is_file())
                if not hits:
                    missing.setdefault(pat, set()).add(d["id"])
                for h in hits:
                    rec = found.setdefault(h, {"kind": kind, "source": sid, "datasets": set(), "entry": entry})
                    rec["datasets"].add(d["id"])
    return found, {k: sorted(v) for k, v in missing.items()}, sources


def acquisition_records(inputs_dir):
    """retrieved dates: the log of fetch_sources.py and the records of raw_sources.py import"""
    out = {}
    m = inputs_dir / "prototype" / "data" / "raw" / "MANIFEST.json"
    if m.is_file():
        for rel, e in json.loads(m.read_text(encoding="utf-8")).items():
            out["prototype/data/raw/" + rel] = {"retrieved": e.get("retrieved"), "url": e.get("url"), "method": "fetch"}
    log = inputs_dir / "tmp" / "sources" / "ACQUISITIONS.jsonl"
    if log.is_file():
        for ln in log.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                e = json.loads(ln)
                out["prototype/data/raw/" + e["file"]] = {"retrieved": e.get("retrieved"), "url": e.get("url") or e.get("page"),
                                                          "method": e.get("mode", "import")}
    return out


def pins(root):
    out = {}
    for ln in (root / "tools" / "mock" / "prototype.sha256").read_text(encoding="utf-8").splitlines():
        h, _, p = ln.partition("  ")
        if p:
            out[p] = h
    return out


# ------------------------------------------------------------------------------------------------------------------------ build
def export_commit(commit, dest):
    """the files of the commit, without .git (git archive): the build cannot see uncommitted changes or other branches"""
    data = git("archive", "--format=tar", commit, binary=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        tf.extractall(dest, filter="data") if hasattr(tarfile, "data_filter") else tf.extractall(dest)
    for tag in WORDING_TAGS:
        out = dest / "tmp" / "versions" / ("site-" + tag.split("-")[1]) / "data"
        out.mkdir(parents=True, exist_ok=True)
        for f in WORDING_FILES:
            (out / f).write_bytes(git("show", "%s:site/data/%s" % (tag, f), binary=True))


def docker_ready():
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def run_in_env(env, src, inputs_dir, cmd, extra_env=None):
    """run a python command of the exported tree, with the inputs read-only; returns (returncode, output)"""
    extra_env = dict(extra_env or {})
    if env == "docker":
        image = "sigma-budget-data:" + sha256_file(src / "tools" / "data" / "requirements.lock")[:12]
        b = subprocess.run(["docker", "build", "-q", "-t", image, str(src / "tools" / "data")], capture_output=True)
        if b.returncode:
            raise Fail(EXIT_INVALID, "docker build: " + b.stderr.decode("utf-8", "replace")[-400:])
        args = ["docker", "run", "--rm", "-v", "%s:/repo" % src]
        for d in INPUT_DIRS:
            if (inputs_dir / d).is_dir():
                args += ["-v", "%s:/repo/%s:ro" % ((inputs_dir / d).resolve(), d)]
        for k, v in extra_env.items():
            args += ["-e", "%s=%s" % (k, v)]
        args += [image, "python"] + cmd
        r = subprocess.run(args, capture_output=True)
    else:
        py = ROOT / ".venv-data" / "bin" / "python"
        if not py.is_file():
            raise Fail(EXIT_INVALID, "--env local needs .venv-data (tools/data/requirements.lock)")
        for d in INPUT_DIRS:
            target = src / d
            if (inputs_dir / d).is_dir() and not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to((inputs_dir / d).resolve())
        r = subprocess.run([str(py)] + cmd, cwd=str(src), capture_output=True, env=dict(os.environ, **extra_env))
    return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")


def validation_report(output):
    """the lines of validate_data_v6.py as data, without the timing (the report is an output and must be the same on every run)"""
    groups = []
    for ln in output.splitlines():
        parts = ln.split(None, 2)
        if len(parts) == 3 and parts[0] in ("OK", "FAIL", "SKIP") and parts[1].isupper():
            groups.append({"group": parts[1], "status": parts[0], "summary": parts[2]})
    result = [ln for ln in output.splitlines() if ln.startswith("RESULT")]
    res = result[-1].rsplit(",", 1)[0] if result else "RESULT missing"
    return {"tool": "tools/mock/validate_data_v6.py", "result": res, "groups": groups}


def build_release(commit, inputs_dir, out, build_date, env, log=print):
    commit = git("rev-parse", commit)
    inputs_dir = inputs_dir.resolve()
    out = out.resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    work = Path(tempfile.mkdtemp(prefix="budget-build-", dir=str(ROOT / "tmp") if (ROOT / "tmp").is_dir() else None))
    src = work / "src"
    try:
        log("build: commit %s, inputs %s, env %s" % (commit[:12], inputs_dir, env))
        export_commit(commit, src)
        found, missing, sources = registry_inputs(src, inputs_dir)
        pinned = pins(src)
        acq = acquisition_records(inputs_dir)
        inputs, bad = [], []
        for path, rec in sorted(found.items()):
            p = inputs_dir / path
            h = sha256_file(p)
            pin = pinned.get(path) or rec["entry"].get("sha256")
            if pin and pin != h:
                bad.append("%s: sha256 %s…, pinned %s…" % (path, h[:12], pin[:12]))
            elif not pin and rec["entry"].get("pinned") is not False:
                bad.append("%s: not pinned in the commit (commit its line of prototype.sha256 first)" % path)
            s = sources.get(rec["source"]) if rec["source"] else None
            a = acq.get(path, {})
            item = {"path": path, "kind": rec["kind"], "datasets": sorted(rec["datasets"]), "mime": MIME.get(p.suffix.lower(), "application/octet-stream"),
                    "bytes": p.stat().st_size, "sha256": h}
            if s:
                item.update({"source": s["id"], "acquisition": s["acquisition"], "period": s.get("period"), "page": s.get("page"),
                             "url": rec["entry"].get("url") or (a.get("url") if a.get("method") == "fetch" else None),
                             "via": rec["entry"].get("via")})
            else:
                item.update({"producer": rec["entry"].get("producer"), "reproducible": rec["entry"].get("reproducible")})
            if a.get("retrieved"):
                item["retrieved"] = a["retrieved"]
            inputs.append({k: v for k, v in item.items() if v is not None})
        if bad:
            raise Fail(EXIT_INVALID, "inputs differ from their pins (tools/mock/prototype.sha256, sources/registry.yaml):\n  " + "\n  ".join(bad))
        args = ["tools/mock/rebuild_v6.py", "--versions-ready"] + (["--build-date", build_date] if build_date else [])
        rc, output = run_in_env(env, src, inputs_dir, args)
        (work / "build.log").write_text(output, encoding="utf-8")
        if rc:
            raise Fail(EXIT_INVALID, "the build failed (exit %d):\n%s" % (rc, output[-1500:]))
        data = src / "site" / "data"
        shutil.copytree(data, out / "data", ignore=shutil.ignore_patterns(RELEASES))
        rc, voutput = run_in_env(env, src, inputs_dir, ["tools/mock/validate_data_v6.py"], {"BUILD_DATE": build_date} if build_date else None)
        report = validation_report(voutput)
        report["passed"] = rc == 0
        (out / "validation.json").write_bytes(canonical_json(report))
        if rc:
            raise Fail(EXIT_INVALID, "the validation of the build failed:\n" + "\n".join(g["group"] + " " + g["summary"] for g in report["groups"] if g["status"] == "FAIL"))
        manifest = make_manifest(src, commit, inputs, missing, out, build_date)
        mbytes = canonical_json(manifest)
        (out / "manifest.json").write_bytes(mbytes)
        rid = sha256_bytes(mbytes)
        receipt = {"release_id": rid, "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "env": env,
                   "command": "budget build --commit %s --build-date %s" % (commit[:12], build_date or "")}
        (out / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        return rid, manifest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def make_manifest(src, commit, inputs, missing, out, build_date):
    dreg = yaml_load(src / "datasets" / "registry.yaml")
    exe = json.loads((out / "data" / "execution.json").read_text(encoding="utf-8"))
    prov = json.loads((out / "data" / exe["contract"]["provenance"]).read_text(encoding="utf-8"))
    outputs = []
    by_file = {}
    for d in dreg["datasets"]:
        for pat in d.get("files") or []:
            by_file[pat] = d["id"]
    for p in sorted(x for x in out.rglob("*") if x.is_file() and x.name not in ("manifest.json", "receipt.json")):
        rel = p.relative_to(out).as_posix()
        ds = next((v for k, v in by_file.items() if fnmatchcase("site/" + rel, k)), None)
        item = {"path": rel, "mime": MIME.get(p.suffix.lower(), "application/octet-stream"), "bytes": p.stat().st_size, "sha256": sha256_file(p)}
        if ds:
            item["dataset"] = ds
        elif rel == "validation.json":
            item["role"] = "validation"
        outputs.append(item)
    coverage = []
    for d in dreg["datasets"]:
        e = {"dataset": d["id"], "status": d["status"]}
        for k in ("period", "unit", "scope"):
            if d.get(k):
                e[k] = d[k]
        if d["status"] != "pending":
            e["rebuiltByThisRelease"] = bool(d.get("rebuild") and "rebuild_v6.py" in d["rebuild"])
        if d.get("limitations"):
            e["limitations"] = d["limitations"]
        if d["status"] == "pending":
            e["reason"] = d.get("reason")
        coverage.append(e)
    tags = {t: git("rev-parse", t + "^{commit}") for t in WORDING_TAGS}
    return {
        "manifest_schema": MANIFEST_SCHEMA,
        "data_schema": {"execution": exe["meta"]["schema"], "execution-provenance": prov["schema"], "other": "docs/data-spec.md"},
        "provenance_format": prov["schema"],
        "processing": {
            "code": {"repository": "https://github.com/midt-bg/sigma-budget", "commit": commit, "tags": tags},
            "environment": {"dockerfile": "tools/data/Dockerfile", "dockerfile_sha256": sha256_file(src / "tools" / "data" / "Dockerfile"),
                            "lock": "tools/data/requirements.lock", "lock_sha256": sha256_file(src / "tools" / "data" / "requirements.lock")},
            "command": "tools/mock/rebuild_v6.py --versions-ready" + (" --build-date " + build_date if build_date else ""),
            "parameters": {"build_date": build_date},
            "registries": {"sources/registry.yaml": sha256_file(src / "sources" / "registry.yaml"),
                           "datasets/registry.yaml": sha256_file(src / "datasets" / "registry.yaml")},
        },
        "inputs": inputs,
        "outputs": outputs,
        "coverage": {"datasets": coverage, "missingInputs": [{"path": k, "datasets": v} for k, v in sorted(missing.items())],
                     "latest": {"execution": exe["latest"]["asOf"]}},
        "compatibility": {"execution": ["execution/1", "execution/2"],
                          "readers": "site/js/data.js and tools/mock/exec_contract.py read both versions"},
    }


def publish_to_site(out, rid):
    """--site: the outputs into site/data, the manifest under site/data/releases/<id>/ and the pointer current.json"""
    data = ROOT / "site" / "data"
    for p in (out / "data").rglob("*"):
        if p.is_file():
            t = data / p.relative_to(out / "data")
            t.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, t)
    rel = data / RELEASES / rid
    rel.mkdir(parents=True, exist_ok=True)
    shutil.copy2(out / "manifest.json", rel / "manifest.json")
    shutil.copy2(out / "validation.json", rel / "validation.json")
    receipt = json.loads((out / "receipt.json").read_text(encoding="utf-8"))
    pointer = {"release_id": rid, "manifest": "data/%s/%s/manifest.json" % (RELEASES, rid), "built": receipt["built"][:10]}
    (data / RELEASES / "current.json").write_text(json.dumps(pointer, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ------------------------------------------------------------------------------------------------------------------------ checks
def site_release():
    """the release published in site/data: (manifest path, path of an output -> file)"""
    data = ROOT / "site" / "data"
    cur = json.loads((data / RELEASES / "current.json").read_text(encoding="utf-8"))
    folder = data / RELEASES / cur["release_id"]
    where = lambda rel: folder / rel if rel == "validation.json" else ROOT / "site" / rel      # noqa: E731
    return folder / "manifest.json", where, cur["release_id"]


def check_release_dir(release, manifest=None, where=None):
    """the manifest against the files of a release folder (or of site/data with site_release()): [(path, problem)]"""
    where = where or (lambda rel: release / rel)
    mbytes = (manifest or release / "manifest.json").read_bytes()
    m = json.loads(mbytes)
    probs = []
    if canonical_json(m) != mbytes:
        probs.append(("manifest.json", "not in canonical form (sorted keys, no spaces, one final newline)"))
    if m.get("manifest_schema") != MANIFEST_SCHEMA:
        probs.append(("manifest.json", "manifest_schema %r" % m.get("manifest_schema")))
    for o in m["outputs"]:
        p = where(o["path"])
        if not p.is_file():
            probs.append((o["path"], "missing"))
        elif p.stat().st_size != o["bytes"] or sha256_file(p) != o["sha256"]:
            probs.append((o["path"], "bytes or sha256 differ from the manifest"))
    listed = {o["path"] for o in m["outputs"]}
    data = release / "data"
    for p in data.rglob("*"):
        rel = "data/" + p.relative_to(data).as_posix()
        if p.is_file() and rel not in listed and not rel.startswith("data/%s/" % RELEASES):
            probs.append((rel, "not listed in the manifest"))
    return sha256_bytes(mbytes), m, probs


def compare_outputs(m, folder):
    """outputs of a rebuild against the manifest: [(path, problem)] and the first differing value of a JSON file"""
    diffs = []
    for o in m["outputs"]:
        p = folder / o["path"]
        if not p.is_file():
            diffs.append((o["path"], "not produced"))
            continue
        h = sha256_file(p)
        if h != o["sha256"]:
            diffs.append((o["path"], "sha256 %s…, the release says %s…" % (h[:12], o["sha256"][:12])))
    return diffs


# ------------------------------------------------------------------------------------------------------------------------ commands
def cmd_build(a):
    env = a.env or ("docker" if docker_ready() else "local")
    rid, m = build_release(a.commit, Path(a.inputs), Path(a.out), a.build_date, env, log=(lambda *_: None) if a.json else print)
    if a.site:
        publish_to_site(Path(a.out).resolve(), rid)
    return EXIT_OK, {"release_id": rid, "out": str(Path(a.out).resolve()), "outputs": len(m["outputs"]), "inputs": len(m["inputs"]),
                     "missingInputs": m["coverage"]["missingInputs"], "site": bool(a.site)}


def cmd_validate(a):
    if a.site:
        release = ROOT / "site"
        manifest, where, pointer = site_release()
        rid, m, probs = check_release_dir(release, manifest, where)
        if rid != pointer:
            probs.append(("data/%s/current.json" % RELEASES, "points to %s…, the manifest hashes to %s…" % (pointer[:12], rid[:12])))
    else:
        release = Path(a.release).resolve()
        rid, m, probs = check_release_dir(release)
    env = dict(os.environ, BUDGET_DATA_DIR=str(release / "data"))
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "mock" / "validate_data_v6.py")], capture_output=True, env=env)
    report = validation_report((r.stdout + r.stderr).decode("utf-8", "replace"))
    if r.returncode:
        probs.append(("data", report["result"]))
    return (EXIT_INVALID if probs else EXIT_OK), {"release_id": rid, "problems": [{"path": p, "problem": x} for p, x in probs],
                                                  "validation": report["result"]}


def resolve_manifest(a):
    if getattr(a, "current", None):
        url, rid = current_manifest(a.current)
        mbytes, base = read_location(url)
        if sha256_bytes(mbytes) != rid:
            raise Fail(EXIT_INVALID, "the manifest at %s does not hash to the current release_id %s" % (url, rid))
        return mbytes, base
    return read_location(a.manifest)


def cmd_reproduce(a):
    mbytes, base = resolve_manifest(a)
    rid = sha256_bytes(mbytes)
    m = json.loads(mbytes)
    originals = Path(a.originals).resolve()
    missing, differ = [], []
    for i in m["inputs"]:
        p = originals / i["path"]
        if not p.is_file():
            missing.append(i["path"])
        elif sha256_file(p) != i["sha256"]:
            differ.append(i["path"])
    result = {"release_id": rid, "commit": m["processing"]["code"]["commit"], "inputs": len(m["inputs"])}
    if missing or differ:
        result.update({"missingInputs": missing, "differentInputs": differ,
                       "verdict": "unverified: the originals of the release are not all available"})
        return EXIT_MISSING, result
    env = a.env or ("docker" if docker_ready() else "local")
    with tempfile.TemporaryDirectory(prefix="budget-reproduce-") as tmp:
        build_release(m["processing"]["code"]["commit"], originals, Path(tmp) / "out", m["processing"]["parameters"]["build_date"], env,
                      log=(lambda *_: None) if a.json else print)
        diffs = compare_outputs(m, Path(tmp) / "out")
    published = []
    if base.startswith("http") and not a.skip_published:
        for o in m["outputs"]:
            try:
                if sha256_bytes(fetch(base.rsplit("/data/", 1)[0] + "/" + o["path"] if "/data/releases/" in base else base + o["path"])) != o["sha256"]:
                    published.append(o["path"])
            except Fail:
                published.append(o["path"] + " (unavailable)")
    result.update({"differences": [{"path": p, "problem": x} for p, x in diffs], "publishedDiffer": published,
                   "verdict": "reproduced byte for byte" if not diffs and not published else "differs"})
    return (EXIT_DIFF if diffs or published else EXIT_OK), result


def cmd_refetch(a):
    mbytes, _base = resolve_manifest(a)
    m = json.loads(mbytes)
    out = Path(a.out).resolve() if a.out else None
    rows = []
    for i in m["inputs"]:
        if i.get("kind") != "source":
            continue
        row = {"path": i["path"], "source": i.get("source")}
        url = i.get("url")
        if i.get("via"):
            row["result"] = "derived: %s reduces the answer; rerun it to compare" % i["via"]
        elif i.get("acquisition") not in ("fetch", "fetch-bg") or not url:
            row["result"] = "manual: %s, not refetched" % i.get("acquisition")
        else:
            try:
                b = fetch(url)
                if not kind_ok(i["path"], b[:4096]):
                    row["result"] = "unverified: the answer is not a %s file" % Path(i["path"]).suffix
                elif sha256_bytes(b) == i["sha256"]:
                    row["result"] = "same"
                else:
                    row["result"] = "changed"
                    if out:
                        t = out / i["path"]
                        t.parent.mkdir(parents=True, exist_ok=True)
                        t.write_bytes(b)
            except Fail as e:
                row["result"] = "unverified: %s" % e
        rows.append(row)
    changed = [r for r in rows if r["result"] == "changed"]
    unverified = [r for r in rows if r["result"].startswith("unverified")]
    code = EXIT_DIFF if changed else (EXIT_MISSING if unverified else EXIT_OK)
    return code, {"release_id": sha256_bytes(mbytes), "sources": rows, "changed": len(changed), "unverified": len(unverified)}


def cmd_collect(a):
    sreg = yaml_load(ROOT / "sources" / "registry.yaml")
    out = Path(a.out).resolve()
    rows = []
    for s in sreg["sources"]:
        for f in s.get("files", []):
            url = f.get("url")
            if s["acquisition"] not in ("fetch", "fetch-bg") or not url or "*" in f["path"] or f.get("via"):
                continue
            row = {"source": s["id"], "path": f["path"], "url": url}
            try:
                b = fetch(url)
                if not kind_ok(f["path"], b[:4096]):
                    row["status"] = "invalid: the answer is not a %s file" % Path(f["path"]).suffix
                else:
                    t = out / f["path"]
                    if t.exists() and sha256_file(t) != sha256_bytes(b):
                        t = t.with_name(t.name + "." + sha256_bytes(b)[:12])      # never overwrite an earlier download
                    t.parent.mkdir(parents=True, exist_ok=True)
                    t.write_bytes(b)
                    row.update({"status": "ok", "file": t.relative_to(out).as_posix(), "bytes": len(b), "sha256": sha256_bytes(b),
                                "retrieved": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            except Fail as e:
                row["status"] = "unavailable: %s" % e
            rows.append(row)
    out.mkdir(parents=True, exist_ok=True)
    (out / "snapshot.json").write_text(json.dumps({"collected": rows}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    bad = [r for r in rows if r["status"] != "ok"]
    return (EXIT_MISSING if bad else EXIT_OK), {"out": str(out), "ok": len(rows) - len(bad), "notOk": [r["path"] + ": " + r["status"] for r in bad]}


def cmd_import_source(a):
    if a.source != "kfp":
        raise Fail(EXIT_INVALID, "import-source handles the monthly КФП reports (--source kfp); other files go by sha256 with "
                                 "tools/data/raw_sources.py import")
    args = [sys.executable, str(ROOT / "tools" / "data" / "raw_sources.py"), "import", a.file] + (["--url", a.url] if a.url else [])
    r = subprocess.run(args)
    return (EXIT_OK if r.returncode == 0 else EXIT_INVALID), {"imported": a.file, "exit": r.returncode}


def report(result, as_json):
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
        return
    for k, v in result.items():
        if isinstance(v, list):
            print("%s: %d" % (k, len(v)))
            for x in v[:25]:
                print("  - " + (", ".join("%s=%s" % kv for kv in x.items()) if isinstance(x, dict) else str(x)))
        else:
            print("%s: %s" % (k, v))


def main(argv):
    ap = argparse.ArgumentParser(prog="budget", description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json", action="store_true", help="machine-readable result")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--commit", default="HEAD")
    b.add_argument("--inputs", default=str(ROOT))
    b.add_argument("--out", default=str(ROOT / "work" / "candidate"))
    b.add_argument("--build-date")
    b.add_argument("--env", choices=["docker", "local"])
    b.add_argument("--site", action="store_true", help="also put the outputs and the manifest into site/data")
    v = sub.add_parser("validate")
    vg = v.add_mutually_exclusive_group(required=True)
    vg.add_argument("--release", help="a release folder (budget build --out)")
    vg.add_argument("--site", action="store_true", help="the release published in site/data (releases/current.json)")
    for name in ("reproduce", "refetch"):
        p = sub.add_parser(name)
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument("--manifest")
        g.add_argument("--current", metavar="SITE")
        if name == "reproduce":
            p.add_argument("--originals", default=str(ROOT), help="a folder with the originals at their paths (default: this checkout)")
            p.add_argument("--env", choices=["docker", "local"])
            p.add_argument("--skip-published", action="store_true", help="do not download the published outputs")
        else:
            p.add_argument("--out", help="keep the changed originals here")
    c = sub.add_parser("collect")
    c.add_argument("--out", default=str(ROOT / "work" / "acquisition"))
    i = sub.add_parser("import-source")
    i.add_argument("--source", required=True)
    i.add_argument("--file", required=True)
    i.add_argument("--url")
    for p in (b, v) + tuple(sub.choices[n] for n in ("reproduce", "refetch", "collect", "import-source")):
        p.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    fn = {"build": cmd_build, "validate": cmd_validate, "reproduce": cmd_reproduce, "refetch": cmd_refetch, "collect": cmd_collect,
          "import-source": cmd_import_source}[a.cmd]
    try:
        code, result = fn(a)
    except Fail as e:
        code, result = e.code, {"error": str(e)}
    report(dict(result, exit=code), a.json)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
