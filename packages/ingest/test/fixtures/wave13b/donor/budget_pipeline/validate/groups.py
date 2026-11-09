"""Dataset validation groups for debt, local finance, components, rates, search and feed."""


from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import budget_pipeline.validate.components as components
import budget_pipeline.validate.debt as debt
import budget_pipeline.validate.search_feed as search_feed
import budget_pipeline.validate.local_finance as local_finance

GROUPS = tuple(debt.GROUPS) + tuple(local_finance.GROUPS) + tuple(components.GROUPS) + tuple(search_feed.GROUPS)
