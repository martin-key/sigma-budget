# Supplemental native-operation boundaries

This separate corpus keeps the existing 1,366 definitions, 1,372 observations,
64 pinned inputs, donor files, historical mutations, 77 compound cases and 225
tuple vectors unchanged. The first 119 cases reproduce the tenth acceptance's
single-field mutations. Three further controls preserve the donor-valid empty
mappings, and the additional cases exercise neighboring dictionary, iterable,
regex and hashability boundaries. The three false-PASS cases and all three
controls run every group, as well as their full compiled CLI reports.

The unchanged frozen Python donor generates complete outcomes and exact raw
mutation preimages. The generator invokes eight separate Python 3.12 processes
with hash seeds 0 through 7 and records each distinct complete observation with
its seeds. Direct group and compiled CLI tests require an exact observed variant;
only variable sandbox paths are normalized. The provenance pins this generator,
its definitions, the existing donor proof dependencies, every output and every
mutation. It is offline parity evidence and does not establish complete production
migration or reconstruct missing source PDFs.

```sh
python packages/ingest/test/fixtures/validate15/native/generate_oracle.py --check
```
