"""The remaining groups of validate_data.py, one module each: DEBT, MUNIC + SEBRA, COMPONENTS + RATES, SEARCH + FEED, REBUILD + MOCK (child processes)."""
import vd_comp
import vd_debt
import vd_idx
import vd_local
import vd_run

GROUPS = tuple(vd_debt.GROUPS) + tuple(vd_local.GROUPS) + tuple(vd_comp.GROUPS) + tuple(vd_idx.GROUPS) + tuple(vd_run.GROUPS)
