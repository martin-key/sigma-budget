# Independent-rule frozen inputs

The baseline is `3424bc998c726d6d511d4284295c54c50c42d099`, as recorded in `manifest.json`.

`inputs/` captures the four mutable repository inputs from that commit: `data/originals.sha256`, `data/inputs/indirect_tax_evidence.json`, `data/inputs/budget_forecast_2027.json` and `data/inputs/budget_bill_2027.json`. Their bytes are authenticated by the existing, unchanged `requiredInputs` hashes. They are copied into each owned test root; live checkout changes are not historical evidence.

The immutable raw original dependencies still come from the read-only `--repo` checkout and are authenticated against their recorded content hashes. The captured list is not used to validate current live editorial pins; production validation remains responsible for those.

To check regeneration, copy this entire fixture to a new temporary directory, run its `generate-oracle.py --repo /absolute/checkout` with Python 3.12, then compare the generated `oracle.json` byte for byte with the committed oracle. Never regenerate into the source fixture. Neither the manifest hashes, the donor, the cases nor the existing oracle have been changed for this capture.
