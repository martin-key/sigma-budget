# Историческо съответствие на пътищата

Таблицата описва преместванията от началния commit `8f65861`. Старите пътища са исторически справки. За действащите правила се използва ADR 0003.

| Преди | Сега |
|---|---|
| `app/` | `apps/web/app/` |
| `workers/` | `apps/web/workers/` |
| `worker/` | `apps/web/workers/api/` |
| `migrations/` | `apps/web/migrations/` |
| `site/js/` | `apps/web/client/` |
| `site/data/` | `data/release/` |
| `site/ (статични файлове)` | `apps/web/public/` |
| `prototype/data/raw/` | `data/originals/` |
| `prototype/src/` | `data/inputs/` |
| `prototype/site/` | `reference/prototype/site/` |
| `sources/registry.yaml` | `data/sources.yaml` |
| `datasets/registry.yaml` | `data/datasets.yaml` |
| `requirements-dev.*` | `tests/requirements-dev.*` |
| `package.json и web конфигурация` | `apps/web/; нов коренен npm workspace` |
| `package-lock.json` | `коренният lockfile, запазени версии` |
| `budget` | `budget (обновен вход към Python пакета)` |
| `docs/, .github/, .claude/` | `същите директории, обновени пътища` |

## Историческо съответствие на инструментите

| Преди | Сега |
|---|---|
| `tools/budget.py` | `pipeline/budget_pipeline/cli.py` |
| `tools/compat_check.py` | `tests/release/compat_check.py` |
| `tools/data/Dockerfile` | `pipeline/Dockerfile` |
| `tools/data/access_probe.py` | `pipeline/budget_pipeline/sources/access_probe.py` |
| `tools/data/originals.py` | `pipeline/budget_pipeline/sources/originals.py` |
| `tools/data/registry.py` | `pipeline/budget_pipeline/validate/registry.py` |
| `tools/data/requirements.lock` | `pipeline/requirements.lock` |
| `tools/data/requirements.txt` | `pipeline/requirements.txt` |
| `tools/environments.json` | `pipeline/environments.json` |
| `tools/mock/accept_v5.py` | `reference/mock/accept_v5.py` |
| `tools/mock/accept_v6.py` | `tests/e2e/accept.py` |
| `tools/mock/apply_v6_glue.py` | `pipeline/budget_pipeline/build/apply_sources.py` |
| `tools/mock/forecast_tables.py` | `pipeline/budget_pipeline/build/forecast_tables.py` |
| `tools/mock/budgets.py` | `pipeline/budget_pipeline/build/budgets.py` |
| `tools/mock/definitions.py` | `pipeline/budget_pipeline/build/definitions.py` |
| `tools/mock/components.py` | `pipeline/budget_pipeline/build/components.py` |
| `tools/mock/core.py` | `pipeline/budget_pipeline/build/core.py` |
| `tools/mock/context.py` | `pipeline/budget_pipeline/build/context.py` |
| `tools/mock/debt.py` | `pipeline/budget_pipeline/build/debt.py` |
| `tools/mock/debt_pdf.py` | `pipeline/budget_pipeline/build/debt_pdf.py` |
| `tools/mock/feed.py` | `pipeline/budget_pipeline/build/feed.py` |
| `tools/mock/fiscal.py` | `pipeline/budget_pipeline/build/fiscal.py` |
| `tools/mock/law.py` | `pipeline/budget_pipeline/build/law.py` |
| `tools/mock/measures.py` | `pipeline/budget_pipeline/build/measures.py` |
| `tools/mock/municipalities.py` | `pipeline/budget_pipeline/build/municipalities.py` |
| `tools/mock/program_budgets.py` | `pipeline/budget_pipeline/build/program_budgets.py` |
| `tools/mock/program_budget_pdf.py` | `pipeline/budget_pipeline/build/program_budget_pdf.py` |
| `tools/mock/rates.py` | `pipeline/budget_pipeline/build/rates.py` |
| `tools/mock/payments.py` | `pipeline/budget_pipeline/build/payments.py` |
| `tools/mock/catalog.py` | `pipeline/budget_pipeline/build/catalog.py` |
| `tools/mock/datasets.py` | `pipeline/budget_pipeline/build/datasets.py` |
| `tools/mock/budget_plan.py` | `pipeline/budget_pipeline/build/budget_plan.py` |
| `tools/mock/build_mock.py` | `pipeline/budget_pipeline/build/examples.py` |
| `tools/mock/search.py` | `pipeline/budget_pipeline/build/search.py` |
| `tools/mock/editorial.py` | `pipeline/budget_pipeline/build/editorial.py` |
| `tools/mock/calc_check_v5.py` | `reference/mock/calc_check_v5.py` |
| `tools/mock/calc_check_v6.py` | `tests/e2e/calc_check.py` |
| `tools/mock/catalog_definitions.py` | `pipeline/budget_pipeline/build/catalog_definitions.py` |
| `tools/mock/catalog_refresh_v5.py` | `pipeline/budget_pipeline/build/catalog_refresh.py` |
| `tools/mock/check_mock.py` | `reference/mock/check_mock.py` |
| `tools/mock/check_mock_v2.py` | `reference/mock/check_mock_v2.py` |
| `tools/mock/check_mock_v3.py` | `reference/mock/check_mock_v3.py` |
| `tools/mock/check_mock_v4.py` | `reference/mock/check_mock_v4.py` |
| `tools/mock/check_mock_v5.py` | `reference/mock/check_mock_v5.py` |
| `tools/mock/check_mock_v6.py` | `tests/e2e/screens.py` |
| `tools/mock/contrast_v2.py` | `reference/mock/contrast_v2.py` |
| `tools/mock/contrast_v3.py` | `reference/mock/contrast_v3.py` |
| `tools/mock/diff_json_v5.py` | `reference/mock/diff_json_v5.py` |
| `tools/mock/diff_routes_v5_v6.py` | `reference/mock/diff_routes_v5_v6.py` |
| `tools/mock/data_io.py` | `pipeline/budget_pipeline/build/data_io.py` |
| `tools/mock/exec_contract.py` | `pipeline/budget_pipeline/validate/execution_contract.py` |
| `tools/mock/expect_v6.py` | `tests/e2e/expect.py` |
| `tools/mock/bill.py` | `pipeline/budget_pipeline/extract/bill.py` |
| `tools/mock/dbp2027.py` | `pipeline/budget_pipeline/extract/dbp2027.py` |
| `tools/mock/kfp_full.py` | `pipeline/budget_pipeline/extract/kfp_full.py` |
| `tools/mock/boundaries.py` | `pipeline/budget_pipeline/sources/boundaries.py` |
| `tools/mock/payments.py` | `pipeline/budget_pipeline/sources/payments.py` |
| `tools/mock/guide_v5.py` | `pipeline/budget_pipeline/build/guide_base.py` |
| `tools/mock/guide_v6.py` | `pipeline/budget_pipeline/build/guide.py` |
| `tools/mock/gva_sectors_v5.py` | `pipeline/budget_pipeline/build/gva_sectors.py` |
| `tools/mock/hrefs_v5.py` | `reference/mock/hrefs_v5.py` |
| `tools/mock/hrefs_v6.py` | `tests/e2e/hrefs.py` |
| `tools/mock/budget_law_parser.py` | `pipeline/budget_pipeline/extract/budget_law_parser.py` |
| `tools/mock/mock_content.py` | `pipeline/budget_pipeline/build/example_text.py` |
| `tools/mock/mock_labels.py` | `pipeline/budget_pipeline/build/measure_labels.py` |
| `tools/mock/mock_lib.py` | `pipeline/budget_pipeline/build/example_support.py` |
| `tools/mock/motion_v6.py` | `tests/e2e/motion.py` |
| `tools/mock/overlap_v6.py` | `tests/e2e/overlap.py` |
| `tools/mock/perf_v6.py` | `tests/e2e/perf.py` |
| `tools/mock/png_probe_v5.py` | `reference/mock/png_probe_v5.py` |
| `tools/mock/png_probe_v6.py` | `tests/e2e/png_probe.py` |
| `tools/mock/prototype.sha256` | `data/originals.sha256` |
| `tools/mock/prototype_sums.py` | `pipeline/budget_pipeline/build/input_checksums.py` |
| `tools/mock/rebuild_v6.py` | `pipeline/budget_pipeline/build/rebuild.py` |
| `tools/mock/redirects_v5.py` | `reference/mock/redirects_v5.py` |
| `tools/mock/redirects_v6.py` | `tests/e2e/redirects.py` |
| `tools/mock/run_all.sh` | `pipeline/budget_pipeline/build/run_all.sh` |
| `tools/mock/share_check_v5.py` | `reference/mock/share_check_v5.py` |
| `tools/mock/share_check_v6.py` | `tests/e2e/share_check.py` |
| `tools/mock/shot_v5.py` | `reference/mock/shot_v5.py` |
| `tools/mock/shot_v6.py` | `tests/e2e/shot.py` |
| `tools/mock/shots_v2.py` | `reference/mock/shots_v2.py` |
| `tools/mock/sweep_v5.py` | `reference/mock/sweep_v5.py` |
| `tools/mock/sweep_v6.py` | `tests/e2e/sweep.py` |
| `tools/mock/v5_data_active.py` | `pipeline/budget_pipeline/build/active_data.py` |
| `tools/mock/v5_wording.py` | `pipeline/budget_pipeline/build/wording.py` |
| `tools/mock/validate_data.py` | `pipeline/budget_pipeline/validate/base.py` |
| `tools/mock/validate_data_v5.py` | `reference/mock/validate_data_v5.py` |
| `tools/mock/validate_data_v6.py` | `pipeline/budget_pipeline/validate/datasets.py` |
| `tools/mock/validate_mock.py` | `reference/mock/validate_mock.py` |
| `tools/mock/budgets.py` | `pipeline/budget_pipeline/validate/budgets.py` |
| `tools/mock/catalog.py` | `pipeline/budget_pipeline/validate/catalog.py` |
| `tools/mock/components.py` | `pipeline/budget_pipeline/validate/components.py` |
| `tools/mock/execution.py` | `pipeline/budget_pipeline/validate/execution.py` |
| `tools/mock/foundations.py` | `pipeline/budget_pipeline/validate/foundations.py` |
| `tools/mock/debt.py` | `pipeline/budget_pipeline/validate/debt.py` |
| `tools/mock/fiscal.py` | `pipeline/budget_pipeline/validate/fiscal.py` |
| `tools/mock/search_feed.py` | `pipeline/budget_pipeline/validate/search_feed.py` |
| `tools/mock/execution_reports.py` | `pipeline/budget_pipeline/validate/execution_reports.py` |
| `tools/mock/law.py` | `pipeline/budget_pipeline/validate/law.py` |
| `tools/mock/checks.py` | `pipeline/budget_pipeline/validate/checks.py` |
| `tools/mock/local_finance.py` | `pipeline/budget_pipeline/validate/local_finance.py` |
| `tools/mock/groups.py` | `pipeline/budget_pipeline/validate/groups.py` |
| `tools/mock/subprocess_groups.py` | `pipeline/budget_pipeline/validate/subprocess_groups.py` |
| `tools/mock/budget_plan_check.py` | `pipeline/budget_pipeline/build/budget_plan_check.py` |
| `tools/prototype/build_2025_json.py` | `reference/prototype/tools/build_2025_json.py` |
| `tools/prototype/build_src.py` | `reference/prototype/tools/build_src.py` |
| `tools/prototype/check_render.py` | `reference/prototype/tools/check_render.py` |
| `tools/prototype/extract_2025.py` | `reference/prototype/tools/extract_2025.py` |
| `tools/prototype/asbp_pages.py` | `pipeline/budget_pipeline/extract/asbp_pages.py` |
| `tools/prototype/asbp_tables.py` | `pipeline/budget_pipeline/extract/asbp_tables.py` |
| `tools/prototype/dv_laws.py` | `pipeline/budget_pipeline/extract/dv_laws.py` |
| `tools/prototype/glossary.py` | `pipeline/budget_pipeline/extract/glossary.py` |
| `tools/prototype/home_kpis.py` | `pipeline/budget_pipeline/extract/home_kpis.py` |
| `tools/prototype/program_budgets.py` | `pipeline/budget_pipeline/extract/program_budgets.py` |
| `tools/prototype/download.py` | `pipeline/budget_pipeline/sources/download.py` |
| `tools/prototype/gen_inline.py` | `reference/prototype/tools/gen_inline.py` |
| `tools/prototype/gen_literals.py` | `reference/prototype/tools/gen_literals.py` |
| `tools/release_check.py` | `tests/release/release_check.py` |
| `tools/restore_drill.py` | `tests/release/restore_drill.py` |
| `tools/site/build.py` | `apps/web/scripts/build.py` |
| `tools/site/make_images.py` | `apps/web/scripts/make_images.py` |
| `tools/site/query_check.py` | `apps/web/scripts/query_check.py` |
| `tools/site/serve.py` | `apps/web/scripts/serve.py` |
| `tools/site/ssr_parity.py` | `apps/web/scripts/ssr_parity.py` |

Кешът от `tools/mock/cache/` и входовете от `tmp/research/` се намират съответно в `data/cache/` и `data/cache/research/`. Те са извън git. При този checkout няма локални файлове в старите кешове за преместване.

## Преименуване на модулите след прегледа

| Стар модул | Нов модул |
|---|---|
| `pipeline/budget_pipeline/build/bd_budgets.py` | `pipeline/budget_pipeline/build/budgets.py` |
| `pipeline/budget_pipeline/build/bd_common.py` | `pipeline/budget_pipeline/build/definitions.py` |
| `pipeline/budget_pipeline/build/bd_components.py` | `pipeline/budget_pipeline/build/components.py` |
| `pipeline/budget_pipeline/build/bd_core.py` | `pipeline/budget_pipeline/build/core.py` |
| `pipeline/budget_pipeline/build/bd_ctx.py` | `pipeline/budget_pipeline/build/context.py` |
| `pipeline/budget_pipeline/build/bd_debt.py` | `pipeline/budget_pipeline/build/debt.py` |
| `pipeline/budget_pipeline/build/bd_debt_pdf.py` | `pipeline/budget_pipeline/build/debt_pdf.py` |
| `pipeline/budget_pipeline/build/bd_feed.py` | `pipeline/budget_pipeline/build/feed.py` |
| `pipeline/budget_pipeline/build/bd_fiscal.py` | `pipeline/budget_pipeline/build/fiscal.py` |
| `pipeline/budget_pipeline/build/bd_law.py` | `pipeline/budget_pipeline/build/law.py` |
| `pipeline/budget_pipeline/build/bd_measures.py` | `pipeline/budget_pipeline/build/measures.py` |
| `pipeline/budget_pipeline/build/bd_municipal.py` | `pipeline/budget_pipeline/build/municipalities.py` |
| `pipeline/budget_pipeline/build/bd_prb.py` | `pipeline/budget_pipeline/build/program_budgets.py` |
| `pipeline/budget_pipeline/build/bd_prb_pdf.py` | `pipeline/budget_pipeline/build/program_budget_pdf.py` |
| `pipeline/budget_pipeline/build/bd_rates.py` | `pipeline/budget_pipeline/build/rates.py` |
| `pipeline/budget_pipeline/build/bd_sebra.py` | `pipeline/budget_pipeline/build/payments.py` |
| `pipeline/budget_pipeline/build/dlib.py` | `pipeline/budget_pipeline/build/data_io.py` |
| `pipeline/budget_pipeline/build/build_data.py` | `pipeline/budget_pipeline/build/datasets.py` |
| `pipeline/budget_pipeline/build/build_catalog.py` | `pipeline/budget_pipeline/build/catalog.py` |
| `pipeline/budget_pipeline/build/build_search.py` | `pipeline/budget_pipeline/build/search.py` |
| `pipeline/budget_pipeline/build/build_text.py` | `pipeline/budget_pipeline/build/editorial.py` |
| `pipeline/budget_pipeline/build/build_examples.py` | `pipeline/budget_pipeline/build/examples.py` |
| `pipeline/budget_pipeline/build/build_dbp2027_site.py` | `pipeline/budget_pipeline/build/budget_plan.py` |
| `pipeline/budget_pipeline/build/example_lib.py` | `pipeline/budget_pipeline/build/example_support.py` |
| `pipeline/budget_pipeline/build/example_content.py` | `pipeline/budget_pipeline/build/example_text.py` |
| `pipeline/budget_pipeline/build/example_labels.py` | `pipeline/budget_pipeline/build/measure_labels.py` |
| `pipeline/budget_pipeline/build/catalog_defs.py` | `pipeline/budget_pipeline/build/catalog_definitions.py` |
| `pipeline/budget_pipeline/build/originals_sums.py` | `pipeline/budget_pipeline/build/input_checksums.py` |
| `pipeline/budget_pipeline/build/asbp.py` | `pipeline/budget_pipeline/build/forecast_tables.py` |
| `pipeline/budget_pipeline/build/verify_dbp2027_numbers.py` | `pipeline/budget_pipeline/build/budget_plan_check.py` |
| `pipeline/budget_pipeline/validate/vd_lib.py` | `pipeline/budget_pipeline/validate/checks.py` |
| `pipeline/budget_pipeline/validate/vd_core.py` | `pipeline/budget_pipeline/validate/foundations.py` |
| `pipeline/budget_pipeline/validate/vd_catalog.py` | `pipeline/budget_pipeline/validate/catalog.py` |
| `pipeline/budget_pipeline/validate/vd_budget.py` | `pipeline/budget_pipeline/validate/budgets.py` |
| `pipeline/budget_pipeline/validate/vd_comp.py` | `pipeline/budget_pipeline/validate/components.py` |
| `pipeline/budget_pipeline/validate/vd_contract.py` | `pipeline/budget_pipeline/validate/execution.py` |
| `pipeline/budget_pipeline/validate/vd_debt.py` | `pipeline/budget_pipeline/validate/debt.py` |
| `pipeline/budget_pipeline/validate/vd_fiscal.py` | `pipeline/budget_pipeline/validate/fiscal.py` |
| `pipeline/budget_pipeline/validate/vd_idx.py` | `pipeline/budget_pipeline/validate/search_feed.py` |
| `pipeline/budget_pipeline/validate/vd_kfp.py` | `pipeline/budget_pipeline/validate/execution_reports.py` |
| `pipeline/budget_pipeline/validate/vd_law.py` | `pipeline/budget_pipeline/validate/law.py` |
| `pipeline/budget_pipeline/validate/vd_local.py` | `pipeline/budget_pipeline/validate/local_finance.py` |
| `pipeline/budget_pipeline/validate/vd_other.py` | `pipeline/budget_pipeline/validate/groups.py` |
| `pipeline/budget_pipeline/validate/vd_run.py` | `pipeline/budget_pipeline/validate/subprocess_groups.py` |
| `pipeline/budget_pipeline/extract/extract_asbp_pages.py` | `pipeline/budget_pipeline/extract/asbp_pages.py` |
| `pipeline/budget_pipeline/extract/extract_asbp_tables.py` | `pipeline/budget_pipeline/extract/asbp_tables.py` |
| `pipeline/budget_pipeline/extract/extract_bill.py` | `pipeline/budget_pipeline/extract/bill.py` |
| `pipeline/budget_pipeline/extract/extract_dbp2027.py` | `pipeline/budget_pipeline/extract/dbp2027.py` |
| `pipeline/budget_pipeline/extract/extract_dv_laws.py` | `pipeline/budget_pipeline/extract/dv_laws.py` |
| `pipeline/budget_pipeline/extract/extract_glossary.py` | `pipeline/budget_pipeline/extract/glossary.py` |
| `pipeline/budget_pipeline/extract/extract_home_kpis.py` | `pipeline/budget_pipeline/extract/home_kpis.py` |
| `pipeline/budget_pipeline/extract/extract_kfp_full.py` | `pipeline/budget_pipeline/extract/kfp_full.py` |
| `pipeline/budget_pipeline/extract/extract_program_budgets.py` | `pipeline/budget_pipeline/extract/program_budgets.py` |
| `pipeline/budget_pipeline/extract/lawparse.py` | `pipeline/budget_pipeline/extract/budget_law_parser.py` |
| `pipeline/budget_pipeline/sources/fetch_sources.py` | `pipeline/budget_pipeline/sources/download.py` |
| `pipeline/budget_pipeline/sources/raw_sources.py` | `pipeline/budget_pipeline/sources/originals.py` |
| `pipeline/budget_pipeline/sources/probe_sources.py` | `pipeline/budget_pipeline/sources/access_probe.py` |
| `pipeline/budget_pipeline/sources/fetch_gisco.py` | `pipeline/budget_pipeline/sources/boundaries.py` |
| `pipeline/budget_pipeline/sources/fetch_sebra.py` | `pipeline/budget_pipeline/sources/payments.py` |

## Отделяне на историческото сглобяване след прегледа

| Преди | След |
|---|---|
| `build/run_all.sh` | `reference/mock/run_all.sh` |
| `validate/subprocess_groups.py` | `reference/mock/subprocess_groups.py` |
| `build/examples.py` (M01–M07) | архив в `reference/mock/examples.py`; текущият модул е ограничен до M06/M07 |
| `build/example_text.py` | `reference/mock/example_text.py` |
| `build/guide_base.py` | `reference/mock/guide_base.py`; текущият модул е `build.guide` |
| `extract/home_kpis.py` | `reference/prototype/tools/home_kpis.py`; чете полета от историческия HTML |
| `docs/data-spec-mock.md` | `reference/mock/data-spec.md`; текущите два набора са в `docs/example-datasets.md` |
| `cli.py` (операции) | запазени в `cli.py` до преноса към TypeScript |

Всички действащи Python производители и команди в регистрите вече са `python -m budget_pipeline.<слой>.<модул>`.
