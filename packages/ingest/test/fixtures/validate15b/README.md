# BUDGET2027 validation evidence

The input inventory pins the 8b68ae1 source revision and 2026-11-08 date.
The unchanged Python 3.12 donor closure and the manual-cell transcription are
stored here; the tracked fiscal ZIP and extraction JSON and the wave13a
published projections are reused by their listed SHA-256 values. These paths
are the complete offline closure for the generator. It rejects changed inputs
and network access; it does not read the working release, caches or originals.

`generate_oracle.py --check` compares the full check count, problems, warnings
and facts for the pinned publication and output mutations. For the output-only
mutations it computes the donor projections once and reuses them, while the
unchanged group and oracle checks run on each mutated publication. A separate
case changes the forecast extraction and rebuilds the annual, bill and lineage
outputs together. The two independent PDF failures in that case show that
agreement between a source and its derived output is insufficient.

`audit_pdf.py --check` opens the pinned ZIP members and checks the presence of
both the transcribed label and printed number on each referenced page. This is
new page-level text evidence, not a new table geometry or column extraction.
Earlier physical-cell audits and their limitations remain as documented in the
fiscal and wave13a fixtures. The other historical source gaps remain open.

```sh
PYTHONDONTWRITEBYTECODE=1 python3.12 generate_oracle.py --check
PYTHONDONTWRITEBYTECODE=1 python3.12 generate_helpers.py --check
PYTHONDONTWRITEBYTECODE=1 python3.12 audit_pdf.py --check
```
