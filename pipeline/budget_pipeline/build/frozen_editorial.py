"""Restore the published editorial snapshots; the original supplied texts are unavailable."""
from pathlib import Path
import shutil
ROOT = Path(__file__).resolve().parents[3]
def main():
    for name in ("guide.json", "glossary.json"):
        shutil.copyfile(ROOT / "data/inputs/editorial" / name, ROOT / "data/release" / name)
if __name__ == "__main__":
    main()
