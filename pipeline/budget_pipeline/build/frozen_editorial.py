"""Restore the published editorial snapshots; the original supplied texts are unavailable."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[3]
def main():
    for name in ("guide.json", "glossary.json"):
        source = ROOT / "data/inputs/editorial" / name
        target = ROOT / "data/release" / name
        shutil.copyfile(source, target)
if __name__ == "__main__":
    main()
