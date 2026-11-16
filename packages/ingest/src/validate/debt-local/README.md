# DEBT, MUNIC and SEBRA validation APIs

Import from `validate/debt-local/index.js`. `debtLocalGroups` exports three
`Group<Context>` registrations, using the existing shared `Context`, `Check` and
runner. Production validation composes the aggregate registration and reader bindings. No scoped CLI or independent Context implementation is introduced.

The rules inspect the shared Context without invoking the corresponding builders.

## Donor scope and precision

`debt(context)` checks VI-1 totals, percentages and the outlook GDP denominator;
scopes/latest/next; annual Maastricht series; all three continuous quarterly
series; provisional flags; Eurostat/BNB and Q4/annual reconciliations; the three
debt definitions; every structure group and maturity; interest and guaranteed
debt; issuance; five legal limits, SAFE inclusion and plan relationships;
execution financing references; notes; and every stored control.

The reviewed GDP vintage exception remains exactly `2026-10-21` for 2024 and
2025, with tolerance 0.2 rather than 0.051. The other donor tolerances are
unchanged: printed-part sums `0.05 * (n + 1) + 0.01`, quarterly overlap 0.05,
annual/Q4 overlap 0.06, structure deviations 0.101 and stored deviations 0.0051.
Float arrays use compensated summation.

`municipalities(context)` checks ordered schema and kinds, year and population
year, all 265 identities and 28 regions, the Dobrich population swap, population
controls, every transfer component and per-capita value, national/region sums,
manual name matches, all boundary identities and every coordinate. Published
thousand-euro transfer precision is unchanged, including row deviation 0.26,
region sums 0.05, national sums 0.5 and per-capita deviations 0.0051.

`sebra(context)` checks all three ordered days, day/category/organisation count
and euro aggregates, latest-day headline, overall category aggregation, file
listing, byte sizes, publication dates, ministry/publisher text, partial-month
wording and stored checks. Money tolerance remains 0.011. Its build-date bound
uses `context.buildDate`, not the donor module's global date. The donor accepts
nonempty ministry identifiers; checking their original identity requires the
reader binding below.

## Separately labelled additional safety

`debtLocalSafetyGroups` exports `DEBT_SAFETY`, `MUNIC_SAFETY` and `SEBRA_SAFETY`.
They close three donor gaps: null/non-numeric quarterly percentages and
per-capita values, impossible Gregorian dates, and invalid polygon topology
inside the Bulgaria bounding box. They are additional checks, not claims about
the base rules. On the current candidate they run 1, 530
and 14 checks respectively (545 total).

The existing `validateMunicipalityGeometry` predicate retains its exact
historical SZR36 exception only for source-coordinate SHA-256
`a775c7cac73123abd78d88d30013e15b024bd2deb70ddb710991bcba1e80b5a0` and
published-coordinate SHA-256
`b3c8416bcea638d92a6a83ea7bf2b7514c5ef459c5a9685f511717aee5d7a6d1`.
An altered self-intersecting SZR36 fails. The known defect is reported as a
warning; no historical boundary is repaired or newly certified.

## Independent source-reader bindings

The base rules inspect published data; the source groups read originals.
`createDebtLocalSourceGroups(bindings)` provides separate `DEBT_SOURCE`,
`MUNIC_SOURCE` and `SEBRA_SOURCE` registrations for the production readers. It uses the same `Context`; it does not fork its interface.

Each binding receives `Context` and must parse actual original bytes,
independently of the corresponding production builder. Expected registry pins
are supplied separately in `binding.pins`. Paths resolve under `context.root`
through `safePath`, using a staged root containing
source inputs and a separately selected candidate data directory. Every pin is
hashed before the reader runs, source identities are checked for the group,
and each assertion must reference a pinned original. Readers return expected
values with candidate file/RFC 6901 pointers and exact equality or explicitly
reviewed source-printed tolerance.

Required reader scopes are exported as `debtLocalSourceRequirements`:

- DEBT: ASBP ZDD/structure/issuance, adopted-law limits, Eurostat annual and
  quarterly series, both BNB series and distinct GDP vintages.
- MUNIC: adopted-law transfers, GISCO identities/population and geometry,
  Eurostat oblast population.
- SEBRA: publication listing, XLSX payments and ministry identity.

Unbound readers, missing scopes, empty/mismatched pins, captured/unavailable
evidence, missing assertion targets and reader crashes fail explicitly. A
binding's assertions and scope coverage are a trusted adapter contract, not a
way for this module to prove that an arbitrary callback actually parsed every
required source cell. Each adapter must be verified against its actual documents before these groups
can establish complete original evidence.
Production bindings are composed by `packages/ingest/src/production/validation.ts`.
