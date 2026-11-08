"""Restore the published editorial snapshots; the original supplied texts are unavailable."""
from pathlib import Path
import shutil
import json
from budget_pipeline.build.guide import align_links
ROOT = Path(__file__).resolve().parents[3]
def main():
    for name in ("guide.json", "glossary.json"):
        source = ROOT / "data/inputs/editorial" / name
        target = ROOT / "data/release" / name
        if name == "guide.json":
            doc = align_links(json.loads(source.read_text(encoding="utf-8")))
            target.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        else:
            shutil.copyfile(source, target)
if __name__ == "__main__":
    main()
