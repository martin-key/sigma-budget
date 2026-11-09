"""Build, validate, reproduce and operate budget data releases."""
import argparse
import hashlib
import json
import ssl
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import io
import os
import shutil
import sys
import tarfile
import tempfile
from fnmatch import fnmatchcase

ROOT = Path(__file__).resolve().parents[2]
MANIFEST_SCHEMA = "budget-release/1"
INPUT_DIRS = ("data/originals", "data/cache")
RELEASES = "releases"
UA = "budget-na-svetlo-data-pipeline/1.0 (+public data; contact: working group)"
MIME = {".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".zip": "application/zip", ".7z": "application/x-7z-compressed", ".json": "application/json", ".jsonld": "application/ld+json",
        ".xml": "application/xml", ".html": "text/html", ".txt": "text/plain", ".csv": "text/csv"}
HEX = __import__("re").compile(r"^[0-9a-f]{64}$")
MAGIC = {".pdf": b"%PDF", ".zip": b"PK", ".docx": b"PK", ".xlsx": b"PK", ".xls": b"\xd0\xcf\x11\xe0", ".7z": b"7z\xbc\xaf"}
EXIT_OK, EXIT_DIFF, EXIT_INVALID, EXIT_MISSING, EXIT_AUTH, EXIT_CONFLICT, EXIT_UNCONFIRMED = 0, 1, 2, 3, 4, 5, 6
RECEIPTS = ROOT / "work" / "receipts"

class Fail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code

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
        raise Fail(EXIT_INVALID, "PyYAML is needed (tests/requirements-dev.lock or pipeline/requirements.lock)")
    return yaml.safe_load(Path(path).read_text(encoding="utf-8"))

def tls_context():
    """certifi's bundle when it is installed (pipeline/requirements.txt: the Python of uv does not accept the chain of ec.europa.eu)"""
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
    """--current SITE: resolve the public pointer once (section 6.4) and keep to that release. The registry (/api/releases/current) when the
    site has one, else the pointer published with the static site (data/releases/current.json)"""
    site = site.rstrip("/")
    try:
        cur = json.loads(fetch(site + "/api/releases/current", tries=1).decode("utf-8"))
        return site + cur["manifest"], cur["release_id"]
    except (Fail, ValueError, KeyError):
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

def registry_inputs(root, inputs_dir):
    """the files the build reads, from the registries: path -> {kind, source, datasets, entry}; and the declared ones that are missing"""
    sreg = yaml_load(root / "data" / "sources.yaml")
    dreg = yaml_load(root / "data" / "datasets.yaml")
    sources = {s["id"]: s for s in sreg["sources"]}
    inter = {i["path"]: i for i in sreg.get("intermediates", [])}
    found, missing = {}, {}
    for d in dreg["datasets"]:
        if d["status"] == "pending":
            continue
        todo, seen = list(d.get("inputs", [])), set()
        datasets = {item["id"]: item for item in dreg["datasets"]}
        while todo:
            x = todo.pop()
            if x in seen:
                continue
            seen.add(x)
            if x in datasets:
                todo.extend(datasets[x].get("inputs", []))
            if x in inter:
                todo.extend(inter[x].get("inputs", []))
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
                    continue                                   # in git at the commit (data/inputs) or not read by the build
                hits = sorted(p.relative_to(inputs_dir).as_posix() for p in inputs_dir.glob(pat) if p.is_file())
                if not hits:
                    missing.setdefault(pat, set()).add(d["id"])
                for h in hits:
                    rec = found.setdefault(h, {"kind": kind, "source": sid, "datasets": set(), "entry": entry})
                    rec["datasets"].add(d["id"])
    return found, {k: sorted(v) for k, v in missing.items()}, sources

def acquisition_records(inputs_dir):
    """retrieved dates: the log of download.py and the records of originals.py import"""
    out = {}
    m = inputs_dir / "data" / "originals" / "MANIFEST.json"
    if m.is_file():
        for rel, e in json.loads(m.read_text(encoding="utf-8")).items():
            out["data/originals/" + rel] = {"retrieved": e.get("retrieved"), "url": e.get("url"), "method": "fetch"}
    snapshot = inputs_dir / "snapshot.json"
    if snapshot.is_file():
        for entry in json.loads(snapshot.read_text(encoding="utf-8"))["collected"]:
            if entry.get("status") == "ok":
                out[entry["path"]] = {"retrieved": entry.get("retrieved"), "url": entry.get("url"), "method": "fetch"}
    log = inputs_dir / "tmp" / "sources" / "ACQUISITIONS.jsonl"
    if log.is_file():
        for ln in log.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                e = json.loads(ln)
                out["data/originals/" + e["file"]] = {"retrieved": e.get("retrieved"), "url": e.get("url") or e.get("page"),
                                                          "method": e.get("mode", "import")}
    return out

def pins(root):
    out = {}
    for ln in (root / "data" / "originals.sha256").read_text(encoding="utf-8").splitlines():
        h, _, p = ln.partition("  ")
        if p:
            out[p] = h
    return out

def export_commit(commit, dest):
    """the files of the commit, without .git (git archive): the build cannot see uncommitted changes or other branches"""
    data = git("archive", "--format=tar", commit, binary=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as tf:
        tf.extractall(dest, filter="data") if hasattr(tarfile, "data_filter") else tf.extractall(dest)

def stage_inputs(found, inputs_dir, view):
    """only the inputs the registries declare, linked (or copied) into a view the build sees: an input that the registry forgets makes the
    build fail at once, so the inputs of the manifest are all the build read"""
    for path in found:
        src, dst = inputs_dir / found[path].get("file", path), view / path
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(src, dst)
        except OSError:
            shutil.copy2(src, dst)

def docker_ready():
    try:
        return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

def run_in_env(env, src, inputs_dir, cmd, extra_env=None):
    """run a python command of the exported tree, with the inputs read-only; returns (returncode, output)"""
    extra_env = dict(extra_env or {})
    if env == "docker":
        image = "sigma-budget-data:" + sha256_file(src / "pipeline" / "requirements.lock")[:12]
        b = subprocess.run(["docker", "build", "-q", "-t", image, str(src / "pipeline")], capture_output=True)
        if b.returncode:
            raise Fail(EXIT_INVALID, "docker build: " + b.stderr.decode("utf-8", "replace")[-400:])
        args = ["docker", "run", "--rm", "--network", "none", "-v", "%s:/repo" % src]
        for d in INPUT_DIRS:
            if (inputs_dir / d).is_dir():
                args += ["-v", "%s:/repo/%s:ro" % ((inputs_dir / d).resolve(), d)]
        for k, v in extra_env.items():
            args += ["-e", "%s=%s" % (k, v)]
        args += [image, "python"] + cmd
        r = subprocess.run(args, capture_output=True)
    else:
        py = ROOT / "tmp/venv-data" / "bin" / "python"
        if not py.is_file():
            raise Fail(EXIT_INVALID, "--env local needs tmp/venv-data (pipeline/requirements.lock)")
        for d in INPUT_DIRS:
            target = src / d
            if (inputs_dir / d).is_dir():
                if target.is_symlink():
                    target.unlink()
                elif target.exists():
                    shutil.rmtree(target)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to((inputs_dir / d).resolve())
        r = subprocess.run([str(py)] + cmd, cwd=str(src), capture_output=True, env=dict(os.environ, PYTHONPATH=str(src / "pipeline"), **extra_env))
    return r.returncode, (r.stdout + r.stderr).decode("utf-8", "replace")

def validation_report(output):
    """the lines of datasets.py as data, without the timing (the report is an output and must be the same on every run)"""
    groups = []
    for ln in output.splitlines():
        parts = ln.split(None, 2)
        if len(parts) == 3 and parts[0] in ("OK", "FAIL", "SKIP") and parts[1].isupper():
            groups.append({"group": parts[1], "status": parts[0], "summary": parts[2]})
    result = [ln for ln in output.splitlines() if ln.startswith("RESULT")]
    res = result[-1].rsplit(",", 1)[0] if result else "RESULT missing"
    return {"tool": "python -m budget_pipeline.validate.datasets", "result": res, "groups": groups}

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
        snapshot = inputs_dir / "snapshot.json"
        if snapshot.is_file():
            for row in json.loads(snapshot.read_text(encoding="utf-8"))["collected"]:
                if row["status"] != "ok":
                    raise Fail(EXIT_MISSING, "snapshot acquisition failed: " + row["path"])
                if row["path"] in found:
                    found[row["path"]]["file"] = row.get("file", row["path"])
        pinned = pins(src)
        acq = acquisition_records(inputs_dir)
        inputs, bad = [], []
        for path, rec in sorted(found.items()):
            p = inputs_dir / rec.get("file", path)
            h = sha256_file(p)
            pin = pinned.get(path) or rec["entry"].get("sha256")
            if pin and pin != h:
                bad.append("%s: sha256 %s…, pinned %s…" % (path, h[:12], pin[:12]))
            elif not pin and rec["entry"].get("pinned") is not False:
                bad.append("%s: not pinned in the commit (commit its line of originals.sha256 first)" % path)
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
            raise Fail(EXIT_INVALID, "inputs differ from their pins (data/originals.sha256, data/sources.yaml):\n  " + "\n  ".join(bad))
        view = work / "inputs"
        stage_inputs(found, inputs_dir, view)
        args = ["-m", "budget_pipeline.offline", "budget_pipeline.build.rebuild"] + (["--build-date", build_date] if build_date else [])
        rc, output = run_in_env(env, src, view, args)
        (work / "build.log").write_text(output, encoding="utf-8")
        if rc:
            keep = ROOT / "tmp" / "budget-last-build.log"
            keep.parent.mkdir(parents=True, exist_ok=True)
            keep.write_text(output, encoding="utf-8")
            raise Fail(EXIT_INVALID, "the build failed (exit %d), the whole log is in %s:\n%s" % (rc, keep.relative_to(ROOT), output[-1500:]))
        data = src / "data" / "release"
        shutil.copytree(data, out / "data", ignore=shutil.ignore_patterns(RELEASES))
        rc, voutput = run_in_env(env, src, view, ["-m", "budget_pipeline.validate.datasets"], {"BUILD_DATE": build_date} if build_date else None)
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
    dreg = yaml_load(src / "data" / "datasets.yaml")
    exe = json.loads((out / "data" / "execution.json").read_text(encoding="utf-8"))
    prov = json.loads((out / "data" / exe["contract"]["provenance"]).read_text(encoding="utf-8"))
    outputs = []
    by_file = {}
    for d in dreg["datasets"]:
        for pat in d.get("files") or []:
            by_file[pat] = d["id"]
    for p in sorted(x for x in out.rglob("*") if x.is_file() and x.name not in ("manifest.json", "receipt.json")):
        rel = p.relative_to(out).as_posix()
        ds = next((v for k, v in by_file.items() if fnmatchcase("data/release/" + rel.removeprefix("data/"), k)), None)
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
            e["rebuiltByThisRelease"] = bool(d.get("rebuild") and "budget_pipeline.build.rebuild" in d["rebuild"])
        if d.get("limitations"):
            e["limitations"] = d["limitations"]
        if d["status"] == "pending":
            e["reason"] = d.get("reason")
        coverage.append(e)
    return {
        "manifest_schema": MANIFEST_SCHEMA,
        "data_schema": {"execution": exe["meta"]["schema"], "execution-provenance": prov["schema"], "other": "docs/data-spec.md"},
        "provenance_format": prov["schema"],
        "processing": {
            "code": {"repository": "https://github.com/midt-bg/sigma-budget", "commit": commit},
            "environment": {"dockerfile": "pipeline/Dockerfile", "dockerfile_sha256": sha256_file(src / "pipeline" / "Dockerfile"),
                            "lock": "pipeline/requirements.lock", "lock_sha256": sha256_file(src / "pipeline" / "requirements.lock")},
            "command": "python -m budget_pipeline.build.rebuild" + (" --build-date " + build_date if build_date else ""),
            "parameters": {"build_date": build_date},
            "registries": {"data/sources.yaml": sha256_file(src / "data" / "sources.yaml"),
                           "data/datasets.yaml": sha256_file(src / "data" / "datasets.yaml")},
        },
        "inputs": inputs,
        "outputs": outputs,
        "coverage": {"datasets": coverage, "missingInputs": [{"path": k, "datasets": v} for k, v in sorted(missing.items())],
                     "latest": {"execution": exe["latest"]["asOf"]}},
        "compatibility": {"execution": ["execution/1", "execution/2"],
                          "readers": "apps/web/client/data.js and pipeline/budget_pipeline/validate/execution_contract.py read both versions"},
    }

def publish_to_site(out, rid):
    """--site: the outputs into data/release, the manifest under data/release/releases/<id>/ and the pointer current.json"""
    data = ROOT / "data" / "release"
    # The exported build retires these files; --site must also remove copies left
    # by an older checkout, rather than only overlaying the new package.
    for name in ("measure-labels.json", "tax-assumptions.json"):
        (data / "mock" / name).unlink(missing_ok=True)
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

def site_release():
    """the release published in data/release: (manifest path, path of an output -> file)"""
    data = ROOT / "data" / "release"
    cur = json.loads((data / RELEASES / "current.json").read_text(encoding="utf-8"))
    folder = data / RELEASES / cur["release_id"]
    where = lambda rel: folder / rel if rel == "validation.json" else data / rel.removeprefix("data/")      # noqa: E731
    return folder / "manifest.json", where, cur["release_id"]

def check_release_dir(release, manifest=None, where=None):
    """the manifest against the files of a release folder (or of data/release with site_release()): [(path, problem)]"""
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

def cmd_build(a):
    env = a.env or ("docker" if docker_ready() else "local")
    rid, m = build_release(a.commit, Path(a.inputs), Path(a.out), a.build_date, env, log=(lambda *_: None) if a.json else print)
    if a.site:
        publish_to_site(Path(a.out).resolve(), rid)
    return EXIT_OK, {"release_id": rid, "out": str(Path(a.out).resolve()), "outputs": len(m["outputs"]), "inputs": len(m["inputs"]),
                     "missingInputs": m["coverage"]["missingInputs"], "site": bool(a.site)}

def cmd_validate(a):
    if a.site:
        release = ROOT / "apps" / "web" / "public"
        manifest, where, pointer = site_release()
        rid, m, probs = check_release_dir(release, manifest, where)
        if rid != pointer:
            probs.append(("data/%s/current.json" % RELEASES, "points to %s…, the manifest hashes to %s…" % (pointer[:12], rid[:12])))
    else:
        release = Path(a.release).resolve()
        rid, m, probs = check_release_dir(release)
    env = dict(os.environ, BUDGET_DATA_DIR=str(ROOT / "data/release" if a.site else release / "data"))
    r = subprocess.run([sys.executable, "-m", "budget_pipeline.validate.datasets"], capture_output=True, env=env)
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
    fetched = None
    if a.originals is None and base.startswith("http"):
        fetched = tempfile.mkdtemp(prefix="budget-originals-")                   # the originals of the release, from the release itself
        for i in m["inputs"]:
            try:
                b = fetch(base + urllib.parse.quote(i["path"]))
            except Fail:
                continue
            if sha256_bytes(b) == i["sha256"]:
                t = Path(fetched) / i["path"]
                t.parent.mkdir(parents=True, exist_ok=True)
                t.write_bytes(b)
    originals = Path(fetched or a.originals or ROOT).resolve()
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
        site = base.rsplit("/data/releases/", 1)[0] + "/" if "/data/releases/" in base else None
        for o in m["outputs"]:
            got = None
            q = urllib.parse.quote(o["path"])
            for url in [base + q] + ([site + q] if site and o["path"].startswith("data/") else []):
                try:                                    # the release address (registry), else the file of the static site (stage B)
                    got = fetch(url, tries=1)
                    break
                except Fail:
                    continue
            if got is None:
                published.append(o["path"] + " (unavailable)")
            elif sha256_bytes(got) != o["sha256"]:
                published.append(o["path"])
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
        elif i.get("acquisition") not in ("auto", "fetch", "fetch-bg") or not url:
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
    from budget_pipeline.sources.collect import collect
    rows = collect(ROOT, Path(a.out), Path(getattr(a, "seed", ROOT)), fetch, kind_ok, sha256_file, sha256_bytes, yaml_load)
    bad = [r for r in rows if r["status"] != "ok"]
    changed = [r for r in rows if r.get("drift") != "same" and r["status"] == "ok"]
    if getattr(a, "summary", None):
        lines = ["| Source | File | Result | SHA-256 | Expected | Detail |", "|---|---|---|---|---|---|"]
        for r in rows:
            lines.append("| %s | %s | %s | %s | %s | %s |" % (r["source"], r["path"], r.get("drift", r["status"]), r.get("sha256", "—"), r.get("expected", "—"), r.get("error", "").replace("|", "/").replace("\n", " ")))
        Path(a.summary).write_text("\n".join(lines) + "\n", encoding="utf-8")
    code = EXIT_MISSING if bad else EXIT_DIFF if getattr(a, "check_drift", False) and changed else EXIT_OK
    return code, {"out": str(a.out), "ok": len(rows)-len(bad), "changed": len(changed), "notOk": bad}


def cmd_import_source(a):
    if a.source != "kfp":
        raise Fail(EXIT_INVALID, "import-source handles the monthly КФП reports (--source kfp); other files go by sha256 with "
                                 "pipeline/budget_pipeline/sources/originals.py import")
    args = [sys.executable, "-m", "budget_pipeline.sources.originals", "import", a.file] + (["--url", a.url] if a.url else [])
    r = subprocess.run(args)
    return (EXIT_OK if r.returncode == 0 else EXIT_INVALID), {"imported": a.file, "exit": r.returncode}

def environment(name):
    envs = json.loads((ROOT / "pipeline" / "environments.json").read_text(encoding="utf-8"))
    local = ROOT / "pipeline" / "environments.local.json"  # your own account's environments, not in git
    if local.exists():
        envs.update(json.loads(local.read_text(encoding="utf-8")))
    if name not in envs or name.startswith("_"):
        raise Fail(EXIT_INVALID, "no environment %r in pipeline/environments.json or pipeline/environments.local.json" % name)
    url = os.environ.get("BUDGET_%s_URL" % name.upper()) or envs[name].get("url")
    if not url:
        raise Fail(EXIT_INVALID, "%s is not provisioned yet: %s" % (name, envs[name].get("note")))
    return url.rstrip("/")

def credentials(url):
    """the Access credentials, never printed: a token (BUDGET_ACCESS_TOKEN, or `cloudflared access token`), or a service token pair"""
    if os.environ.get("CF_ACCESS_CLIENT_ID") and os.environ.get("CF_ACCESS_CLIENT_SECRET"):
        return {"CF-Access-Client-Id": os.environ["CF_ACCESS_CLIENT_ID"], "CF-Access-Client-Secret": os.environ["CF_ACCESS_CLIENT_SECRET"]}
    app = url + "/admin/operations"  # the Access application covers /admin/* only; cloudflared finds it by that redirect
    tok = os.environ.get("BUDGET_ACCESS_TOKEN")
    if not tok and shutil.which("cloudflared"):
        r = subprocess.run(["cloudflared", "access", "token", "-app=" + app], capture_output=True, text=True)
        tok = r.stdout.strip() if r.returncode == 0 else None
    if not tok:
        raise Fail(EXIT_AUTH, "no Access credentials: `cloudflared access login %s`, or BUDGET_ACCESS_TOKEN, or a service token "
                              "(CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET)" % app)
    # Cf-Access-Token is what the Access edge reads from a client; it hands the Worker Cf-Access-Jwt-Assertion. `wrangler dev` has no
    # edge, so the Worker gets that header directly. Either way the Worker checks the signature, iss, aud and exp itself.
    return {"Cf-Access-Token": tok, "Cf-Access-Jwt-Assertion": tok}

def http(method, url, body=None, headers=None, timeout=120, raw=False):
    """(status, parsed JSON, or the bytes with raw=True); network errors raise Fail(EXIT_MISSING): the caller decides whether a retry is safe"""
    req = urllib.request.Request(url, data=body, method=method, headers=dict({"User-Agent": UA}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=tls_context()) as res:
            status, data = res.status, res.read()
    except urllib.error.HTTPError as e:
        status, data = e.code, e.read()
    except (urllib.error.URLError, OSError) as e:
        raise Fail(EXIT_MISSING, "%s %s: %s" % (method, url, e))
    if raw:
        return status, data
    try:
        return status, json.loads(data.decode("utf-8")) if data else {}
    except (UnicodeDecodeError, ValueError):
        return status, data

def admin(method, base, path, body=None, creds=None, ctype="application/json"):
    status, data = http(method, base + path, body, dict(creds or {}, **({"Content-Type": ctype} if body is not None else {})))
    if status in (401, 403):
        raise Fail(EXIT_AUTH, "%s %s: %s" % (method, path, data.get("error") if isinstance(data, dict) else status))
    return status, data

def remote_current(base):
    status, data = http("GET", base + "/api/releases/current", headers={"Cache-Control": "no-cache"})
    if status == 404 and isinstance(data, dict) and "revision" in data:
        return {"release_id": None, "revision": data["revision"]}
    if status != 200:
        raise Fail(EXIT_MISSING, "GET /api/releases/current: %s %s" % (status, data))
    return data

def object_file(release, originals, m, sha):
    """the local file of an object of the manifest: the manifest, an output of the release folder, an original"""
    rid = sha256_bytes((release / "manifest.json").read_bytes())
    if sha == rid:
        return release / "manifest.json"
    for o in m["outputs"]:
        if o["sha256"] == sha and (release / o["path"]).is_file():
            return release / o["path"]
    for i in m["inputs"]:
        if i["sha256"] == sha and (originals / i["path"]).is_file():
            return originals / i["path"]
    return None

def receipt_path(rid):
    return RECEIPTS / ("%s.json" % rid)

def load_receipt(rid):
    p = receipt_path(rid)
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"release_id": rid}

def save_receipt(r):
    RECEIPTS.mkdir(parents=True, exist_ok=True)
    receipt_path(r["release_id"]).write_text(json.dumps(r, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

def upload_release(release, originals, base, creds, dry_run=False, log=print):
    """resumable: an open operation of this release (the receipt) is continued; objects the server has are not sent again"""
    mbytes = (release / "manifest.json").read_bytes()
    rid = sha256_bytes(mbytes)
    m = json.loads(mbytes)
    r = load_receipt(rid)
    need = None
    if r.get("operation") and r.get("environment") == base:
        status, data = admin("GET", base, "/admin/operations/" + r["operation"], creds=creds)
        if status == 200 and data.get("state") == "open":
            need = data["needed"]
            log("upload: continuing operation %s (%d objects left)" % (r["operation"], len(need)))
        elif status == 200 and data.get("state") == "sealed":
            return rid, r["operation"], 0
    if need is None:
        if dry_run:
            objs = {o["sha256"]: o["bytes"] for o in m["inputs"] + m["outputs"]}
            return rid, None, len(objs) + 1
        status, data = admin("POST", base, "/admin/operations", mbytes, creds)
        if status != 201:
            raise Fail(EXIT_INVALID, "the server refused the manifest: %s" % json.dumps(data, ensure_ascii=False)[:600])
        r.update({"operation": data["operation_id"], "environment": base})
        save_receipt(r)
        need = data["needed"]
        log("upload: operation %s, %d of %d objects to send" % (data["operation_id"], len(need), data["objects"]))
    for o in need:
        f = object_file(release, originals, m, o["sha256"])
        if not f:
            raise Fail(EXIT_MISSING, "no local file for %s (an original? --originals)" % o["sha256"])
        b = f.read_bytes()
        if sha256_bytes(b) != o["sha256"]:
            raise Fail(EXIT_INVALID, "%s does not hash to the manifest" % f)
        for attempt in range(3):
            try:
                status, data = admin("PUT", base, "/admin/operations/%s/objects/%s" % (r["operation"], o["sha256"]), b, creds, "application/octet-stream")
                break
            except Fail as e:
                if e.code != EXIT_MISSING or attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        if status != 200:
            raise Fail(EXIT_INVALID, "%s: %s" % (f, data))
    status, data = admin("POST", base, "/admin/operations/%s/seal" % r["operation"], b"{}", creds)
    if status not in (200,):
        raise Fail(EXIT_INVALID, "seal: %s" % json.dumps(data, ensure_ascii=False)[:600])
    return rid, r["operation"], len(need)

def confirm(a, lines):
    """what will change, on stderr (stdout carries the result, JSON with --json), and a question unless --yes or --dry-run"""
    for ln in lines:
        print(ln, file=sys.stderr)
    if a.yes or a.dry_run:
        return
    if not sys.stdin.isatty():
        raise Fail(EXIT_INVALID, "not confirmed: run in a terminal or add --yes")
    print("Продължи? [y/N] ", end="", file=sys.stderr, flush=True)
    if input().strip().lower() not in ("y", "yes", "д", "да"):
        raise Fail(EXIT_INVALID, "stopped by the operator")

def publish_request(base, creds, r, rid, kind, expected):
    """POST /admin/publish once per request_id; a lost response is answered by GET /admin/requests/:id, never by a new request"""
    key = "%s:%s:%d" % (kind, base, expected)
    reqs = r.setdefault("requests", {})
    if key not in reqs:
        reqs[key] = {"request_id": str(__import__("uuid").uuid4()), "state": "sent"}
        save_receipt(r)
    req_id = reqs[key]["request_id"]
    body = json.dumps({"release_id": rid, "expected_revision": expected, "request_id": req_id, "kind": kind}).encode("utf-8")
    try:
        status, data = admin("POST", base, "/admin/publish", body, creds)
    except Fail as e:
        if e.code != EXIT_MISSING:
            raise
        status, data = admin("GET", base, "/admin/requests/" + req_id, creds=creds)
        if status == 404:
            raise Fail(EXIT_UNCONFIRMED, "the publish request %s was not answered and is not in the journal: run the same command again" % req_id)
    if status == 409:
        raise Fail(EXIT_CONFLICT, "revision conflict: %s" % json.dumps(data, ensure_ascii=False))
    if status != 200:
        raise Fail(EXIT_INVALID, "publish: %s %s" % (status, json.dumps(data, ensure_ascii=False)[:600]))
    reqs[key].update({"state": "applied", "revision": data["revision"], "at": data["at"]})
    save_receipt(r)
    return data

def read_back(base, rid, m):
    """the public view after the change, without cache: the pointer, the manifest bytes and one output (section 7.2, step 7)"""
    cur = remote_current(base)
    if cur.get("release_id") != rid:
        raise Fail(EXIT_UNCONFIRMED, "the current release is %s, not %s" % (cur.get("release_id"), rid))
    status, data = http("GET", base + "/data/releases/%s/manifest.json" % rid, raw=True)
    if status != 200 or sha256_bytes(data) != rid:
        raise Fail(EXIT_UNCONFIRMED, "the published manifest does not hash to the release_id (HTTP %s)" % status)
    o = m["outputs"][0]
    status, data = http("GET", base + "/data/releases/%s/%s" % (rid, urllib.parse.quote(o["path"])), raw=True)
    if status != 200 or sha256_bytes(data) != o["sha256"]:
        raise Fail(EXIT_UNCONFIRMED, "%s does not read back as in the manifest (HTTP %s)" % (o["path"], status))
    return cur

def cmd_status(a):
    base = environment(a.environment)
    cur = remote_current(base)
    status, data = http("GET", base + "/api/releases?limit=5")
    return EXIT_OK, {"environment": a.environment, "url": base, "release_id": cur.get("release_id"), "revision": cur.get("revision"),
                     "journal": data.get("items", []) if isinstance(data, dict) else []}

def cmd_upload(a):
    base = environment(a.environment)
    release = Path(a.release).resolve()
    rid, _m, probs = check_release_dir(release)
    if probs:
        raise Fail(EXIT_INVALID, "the release folder fails its manifest: %s" % probs[:3])
    creds = {} if a.dry_run else credentials(base)
    rid, op, sent = upload_release(release, Path(a.originals).resolve(), base, creds, a.dry_run, log=(lambda *_: None) if a.json else print)
    return EXIT_OK, {"environment": a.environment, "release_id": rid, "operation": op, "objects": sent, "dryRun": a.dry_run,
                     "state": "would upload" if a.dry_run else "sealed: a candidate, not current"}

def cmd_publish(a):
    base = environment(a.environment)
    release = Path(a.release).resolve()
    rid, m, probs = check_release_dir(release)                # every byte as the manifest says (section 7.2, step 1)
    vrep = next((o for o in m["outputs"] if o.get("role") == "validation"), None)
    if not vrep:
        probs.append(("validation.json", "the release has no validation report"))
    elif not probs and not json.loads((release / vrep["path"]).read_bytes()).get("passed"):
        probs.append(("validation.json", "the validation of the build did not pass"))
    if probs:
        raise Fail(EXIT_INVALID, "the local checks fail: %s" % probs[:3])
    cur = remote_current(base)
    confirm(a, ["environment: %s (%s)" % (a.environment, base), "current:     %s (revision %s)" % (cur.get("release_id"), cur.get("revision")),
                "new:         %s (commit %s, %d outputs)" % (rid, m["processing"]["code"]["commit"][:12], len(m["outputs"]))])
    if a.dry_run:
        return EXIT_OK, {"environment": a.environment, "release_id": rid, "expected_revision": cur.get("revision"), "dryRun": True}
    creds = credentials(base)
    upload_release(release, Path(a.originals).resolve(), base, creds, log=(lambda *_: None) if a.json else print)
    r = load_receipt(rid)
    done = publish_request(base, creds, r, rid, "publish", cur.get("revision"))
    after = read_back(base, rid, m)
    return EXIT_OK, {"environment": a.environment, "release_id": rid, "revision": after["revision"], "previous_release_id": done.get("previous_release_id"),
                     "replay": bool(done.get("replay")), "receipt": str(receipt_path(rid))}

def cmd_rollback(a):
    base = environment(a.environment)
    if not HEX.match(a.release_id or ""):
        raise Fail(EXIT_INVALID, "--release-id is a sha256")
    cur = remote_current(base)
    confirm(a, ["environment: %s (%s)" % (a.environment, base), "current:     %s (revision %s)" % (cur.get("release_id"), cur.get("revision")),
                "back to:     %s" % a.release_id])
    if a.dry_run:
        return EXIT_OK, {"environment": a.environment, "release_id": a.release_id, "expected_revision": cur.get("revision"), "dryRun": True}
    creds = credentials(base)
    r = load_receipt(a.release_id)
    done = publish_request(base, creds, r, a.release_id, "rollback", cur.get("revision"))
    status, raw = http("GET", base + "/data/releases/%s/manifest.json" % a.release_id, raw=True)
    if status != 200:
        raise Fail(EXIT_UNCONFIRMED, "the manifest of %s does not read back (HTTP %s)" % (a.release_id, status))
    after = read_back(base, a.release_id, json.loads(raw))
    return EXIT_OK, {"environment": a.environment, "release_id": a.release_id, "revision": after["revision"],
                     "previous_release_id": done.get("previous_release_id"), "replay": bool(done.get("replay"))}

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
    b.add_argument("--site", action="store_true", help="also put the outputs and the manifest into data/release")
    v = sub.add_parser("validate")
    vg = v.add_mutually_exclusive_group(required=True)
    vg.add_argument("--release", help="a release folder (budget build --out)")
    vg.add_argument("--site", action="store_true", help="the release published in data/release (releases/current.json)")
    for name in ("reproduce", "refetch"):
        p = sub.add_parser(name)
        g = p.add_mutually_exclusive_group(required=True)
        g.add_argument("--manifest")
        g.add_argument("--current", metavar="SITE")
        if name == "reproduce":
            p.add_argument("--originals", help="a folder with the originals at their paths (default: downloaded from the release when it is "
                                                 "a URL, else this checkout)")
            p.add_argument("--env", choices=["docker", "local"])
            p.add_argument("--skip-published", action="store_true", help="do not download the published outputs")
        else:
            p.add_argument("--out", help="keep the changed originals here")
    c = sub.add_parser("collect")
    c.add_argument("--seed", default=str(ROOT), help="release input tree supplying manual and historical inputs")
    c.add_argument("--check-drift", action="store_true")
    c.add_argument("--summary", help="Markdown drift report")
    c.add_argument("--out", default=str(ROOT / "work" / "acquisition"))
    i = sub.add_parser("import-source")
    i.add_argument("--source", required=True)
    i.add_argument("--file", required=True)
    i.add_argument("--url")
    st = sub.add_parser("status")
    st.add_argument("--environment", required=True)
    for name in ("upload", "publish", "rollback"):
        p = sub.add_parser(name)
        p.add_argument("--environment", required=True, help="pipeline/environments.json; no default, production is always named")
        if name == "rollback":
            p.add_argument("--release-id", required=True)
        else:
            p.add_argument("--release", required=True, help="a release folder (budget build --out)")
            p.add_argument("--originals", default=str(ROOT), help="where the originals are (default: this checkout)")
        p.add_argument("--yes", action="store_true", help="do not ask before the change")
        p.add_argument("--dry-run", action="store_true", help="read only: no upload, no publish")
    for p in (b, v) + tuple(sub.choices[n] for n in ("reproduce", "refetch", "collect", "import-source", "status", "upload", "publish", "rollback")):
        p.add_argument("--json", action="store_true", default=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    fn = {"build": cmd_build, "validate": cmd_validate, "reproduce": cmd_reproduce, "refetch": cmd_refetch, "collect": cmd_collect,
          "import-source": cmd_import_source, "status": cmd_status, "upload": cmd_upload, "publish": cmd_publish,
          "rollback": cmd_rollback}[a.cmd]
    try:
        code, result = fn(a)
    except Fail as e:
        code, result = e.code, {"error": str(e)}
    report(dict(result, exit=code), a.json)
    return code

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
