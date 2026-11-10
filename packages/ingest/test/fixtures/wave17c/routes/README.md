# SEARCH route-catalogue evidence

`routes/generate.py --check` records eleven complete outcomes from the unchanged
Python SEARCH validator and route loader. The cases cover seven/eight-field
records and malformed lengths, duplicate IDs after options expansion, valid
options, absent options, empty catalogues and BOM bytes. Direct and compiled
SEARCH tests compare the whole group in raw and accepted modes.

This supplement depends on the shared loader correction in PR35. It preserves
the original 65 SEARCH observations, source-boundary supplement, corpus and all
eleven original evidence pins. The original README remains byte-identical.
