"""Shared route metadata, independent of JavaScript formatting and of Node."""
from pathlib import Path
import json

CATALOGUE = Path(__file__).resolve().parents[2] / "apps/web/app/lib/routes.json"
FIELDS = ("id", "key", "pattern", "file", "title", "group", "icon")


def load_routes(path=CATALOGUE):
    """Expand the compact route records in catalogue order, like web/lib/routes.ts."""
    with open(path, encoding="utf-8") as fh:
        catalogue = json.load(fh)
    routes = []
    for record in catalogue["routes"]:
        if len(record) not in (7, 8):
            raise ValueError("route record must have seven fields and optional options")
        route = dict(zip(FIELDS, record[:7]))
        route.update(step=None, next=["S01"], parent=None, phase=1, nav=True,
                     samples=[], desc="", periods="all", short="", query=[])
        if len(record) == 8:
            route.update(record[7])
        if not route["samples"] and route["pattern"]:
            route["samples"] = ["#" + route["pattern"]]
        routes.append(route)
    if not routes or len({r["id"] for r in routes}) != len(routes):
        raise ValueError("route catalogue must contain unique screen ids")
    return routes
