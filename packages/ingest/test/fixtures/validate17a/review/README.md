# Additional acceptance regressions

This independent Python 3.12 corpus supplements the original 37-case capture and
the 55-case overlay. It does not replace either capture or edit the frozen donor.
The generator loads the original pinned donor closure and regenerates complete
CORE/CATALOG observations for raw integer, float and exponent tokens, boolean
controls, and dictionary-key types. JSON decoder observations come directly from
Python's JSON decoder with the production non-finite-constant callback.

The provenance pins the new cases, generator and observations, plus the original
generator, cases, observations and provenance. The original generator independently
checks all 106 frozen input hashes. No current release, cache or network reads are
used. Run `python3.12 review/generate_oracle.py --check` from this fixture directory.

The CLI regressions independently verify that rejected path declarations prevent
report writes, including traversal and symlink aliases, existing sentinel inputs,
and absent output directories. Console-only failure diagnostics remain available.
These tests establish validator and input-preservation behavior, not recovery of
the missing historical originals.
