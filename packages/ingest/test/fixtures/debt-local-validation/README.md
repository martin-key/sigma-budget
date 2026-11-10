# Independent validation donor corpus

This new corpus freezes the complete DEBT/MUNIC/SEBRA validation donors and six
input files from each named published/candidate baseline. Existing builder
fixtures are preserved. See the [API and scope notes](../../../src/validate/debt-local/README.md)
for exact commits, dates, counts, limits and source-evidence integration.

Run `python3.12 generate_oracle.py --check` from this directory, or use its
repository-relative path. Python 3.12 is required. The generator verifies the
frozen pin inventory and reproduces all 95 finite scenarios with no production
builder, network call or TypeScript dependency. The imported frozen modules
retain their original bytes; the small harness supplies the six datasets and
the explicit baseline build date.

`provenance.json` pins donors, cases, oracle, generator and both sets of
snapshots. It also records available existing BNB/SEBRA original byte hashes;
that inventory does not claim those original files have been parsed by these
validation rules. No snapshot is described as a new acquisition.
