"""Parsers for the two law texts behind D08/D10 (pure stdlib).

  dv_blocks(path)    the adopted law (Държавен вестник, бр. 69/2026) as a flat block stream
  docx_blocks(path)  the bill as submitted (parliament file 52-602-01-19, .docx) as the same stream

A block stream is a list of ('p', text) and ('t', rows) items in document order, `rows` being lists of cell texts.
Tables that contain paragraph-like rows (the .docx lays the whole bill out in one huge table) are split at those rows
so that both sources look the same to the article parser (`split_articles`, `parse_budget`).

Text normalisation: whitespace/nbsp collapsed; Latin look-alike letters inside Cyrillic words fixed (`fold`).
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser

# ----------------------------------------------------------------------------------------------- text helpers
_LATIN = str.maketrans({
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р", "T": "Т", "X": "Х",
    "a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у", "k": "к",
})
_WS = re.compile(r"[\s   ]+")
_CYR = re.compile(r"[Ѐ-ӿ]")


def ws(s):
    return _WS.sub(" ", s or "").strip()


def fold(s):
    """Collapse whitespace; map Latin look-alikes to Cyrillic in tokens that already contain Cyrillic letters."""
    out = []
    for tok in ws(s).split(" "):
        if tok and _CYR.search(tok):
            tok = tok.translate(_LATIN)
        out.append(tok)
    return " ".join(out)


def squash(s):
    """Upper-cased label without spaces/punctuation noise: matches 'ОПЕРАЦИИВЧАСТТАНАФИНАНСИРАНЕТО' to the spaced one."""
    t = fold(s).upper().translate(str.maketrans({"І": "I", "Ѝ": "И"}))
    return re.sub(r"[\s\-–—−\.\(\),:;\"„“”«»'’/+]+", "", t)


def roman(s):
    """'VІ.' (Cyrillic І) -> 'VI'; '' for anything that is not a Roman numeral."""
    t = ws(s).upper().replace("І", "I").replace("Х", "X").rstrip(".")
    return t if re.fullmatch(r"[IVX]+", t) else ""


def bgnum(s):
    """'28 455 734,1' -> 28455734.1; '-7 350 531,5' -> -7350531.5; blank or a dash -> None; anything else raises."""
    t = ws(s).replace(" ", "").replace("−", "-").replace("–", "-").replace("—", "-")
    if t in ("", "-"):
        return None
    if not re.fullmatch(r"-?\d+(,\d+)?", t):
        raise ValueError("not a BG number: %r" % s)
    return float(t.replace(",", "."))


# ----------------------------------------------------------------------------------------------- HTML (ДВ)
def _leaf_flags(s):
    """For every <table> in document order: True when it contains no nested table (the law sits in layout tables)."""
    flags, stack = [], []
    for m in re.finditer(r"<(/?)table\b", s):
        if m.group(1) == "":
            if stack:
                stack[-1][1] = True
            flags.append(None)
            stack.append([len(flags) - 1, False])
        else:
            idx, has_child = stack.pop()
            flags[idx] = not has_child
    return flags


class _Blocks(HTMLParser):
    def __init__(self, flags):
        super().__init__(convert_charrefs=True)
        self.flags, self.ti = flags, -1
        self.blocks, self.in_leaf = [], False
        self.rows = self.row = self.cell = self.par = None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.ti += 1
            if self.flags[self.ti]:
                self.in_leaf, self.rows = True, []
        elif self.in_leaf:
            if tag == "tr":
                self.row = []
            elif tag in ("td", "th"):
                self.cell = []
            elif tag == "br" and self.cell is not None:
                self.cell.append(" ")
        elif tag == "p":
            self.par = []
        elif tag == "br" and self.par is not None:
            self.par.append(" ")

    def handle_endtag(self, tag):
        if self.in_leaf:
            if tag in ("td", "th") and self.cell is not None:
                self.row.append(ws("".join(self.cell)))
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.rows.append(self.row)
                self.row = None
            elif tag == "table":
                self.blocks.append(("t", self.rows))
                self.rows, self.in_leaf = None, False
        elif tag == "p" and self.par is not None:
            t = ws("".join(self.par))
            if t:
                self.blocks.append(("p", t))
            self.par = None

    def handle_data(self, data):
        if self.in_leaf:
            if self.cell is not None:
                self.cell.append(data)
        elif self.par is not None:
            self.par.append(data)


def dv_blocks(path):
    with open(path, encoding="utf-8") as fh:
        s = fh.read()
    p = _Blocks(_leaf_flags(s))
    p.feed(s)
    return split_paragraph_rows(p.blocks)


# ----------------------------------------------------------------------------------------------- DOCX (bill)
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _ptext(p):
    out = []
    for el in p.iter():
        if el.tag == _W + "t":
            out.append(el.text or "")
        elif el.tag in (_W + "tab", _W + "br", _W + "cr"):
            out.append(" ")
    return ws("".join(out))


def docx_blocks(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(_W + "body")
    blocks = []
    for ch in body:
        if ch.tag == _W + "p":
            t = _ptext(ch)
            if t:
                blocks.append(("p", t))
        elif ch.tag == _W + "tbl":
            rows = []
            for tr in ch.findall(_W + "tr"):
                rows.append([" ".join(filter(None, (_ptext(p) for p in tc.iter(_W + "p"))))
                             for tc in tr.findall(_W + "tc")])
            blocks.append(("t", rows))
    return split_paragraph_rows(blocks)


# ----------------------------------------------------------------------------------------------- shared
def _is_paragraph_row(row):
    """A table row that only carries running text: 1 cell, or 2 cells with the second one empty."""
    return bool(row) and len(row) <= 2 and bool(row[0]) and not any(row[1:])


def split_paragraph_rows(blocks):
    """Turn paragraph-like rows of tables into ('p', text) items; consecutive other rows form ('t', rows)."""
    out = []
    for kind, val in blocks:
        if kind == "p":
            out.append((kind, val))
            continue
        chunk = []
        for row in val:
            if _is_paragraph_row(row):
                if chunk:
                    out.append(("t", chunk))
                    chunk = []
                out.append(("p", row[0]))
            else:
                chunk.append(row)
        if chunk:
            out.append(("t", chunk))
    return out


_HEAD = re.compile(r"^Чл\.\s*(\d+)\.\s*\(1\)\s*Приема\s+(?:бюджета\s+на\s+(.+?)\s+за\s+2026\s*г\.|държавния\s+бюджет)")


def split_articles(blocks):
    """{art: [occurrence, ...]}; an occurrence is {'head': text, 'name': str|None, 'items': [blocks...]}.

    A heading is a paragraph 'Чл. N. (1) Приема бюджета на <name> за 2026 г., …' (art. 1: 'Приема държавния бюджет').
    The .docx repeats art. 1 and art. 2 (the text with the Висш съдебен съвет draft included, then the Council of
    Ministers' position), hence the list of occurrences.
    """
    arts, cur = {}, None
    for kind, val in blocks:
        if kind == "p":
            m = _HEAD.match(val)
            if m:
                cur = {"head": val, "name": fold(m.group(2)) if m.group(2) else None, "items": []}
                arts.setdefault(int(m.group(1)), []).append(cur)
                continue
            if re.match(r"^Чл\.\s*\d+\.", val) and cur is not None:
                cur = None                      # another article that is not a budget (e.g. art. 48+)
                continue
        if cur is not None:
            cur["items"].append((kind, val))
    return arts


def _data_rows(rows):
    """Rows of a table chunk without header/numbering rows ('№ | Показатели | Сума', '| 1 | 2', '| | (хил. евро)')."""
    out = []
    for r in rows:
        r = (list(r) + ["", "", ""])[:3] if len(r) < 3 else r
        if not any(r):
            continue
        if r[0] in ("№", "N") or (not r[0] and r[1] in ("1", "2", "") and r[2] in ("2", "3", "(хил. евро)", "")):
            continue
        out.append(r)
    return out


def parse_rows(rows):
    """Data rows of one table chunk as dicts: {'no','text','value'} plus the section key ('I', 'II', ...)."""
    out, section = [], ""
    for r in _data_rows(rows):
        no, text, val = ws(r[0]), fold(r[1]), r[-1]
        rom = roman(no)
        if rom:
            section = rom
        try:
            v = bgnum(val)
        except ValueError:
            v = None
        out.append({"sec": section, "no": no, "text": text, "value": v, "raw": val})
    return out


_KEYS = [
    ("rev", "ПРИХОДИПОМОЩИИДАРЕНИЯ"),
    ("exp", "РАЗХОДИ"),
    ("transfers", "БЮДЖЕТНИВЗАИМООТНОШЕНИЯ"),
    ("eucontrib", "ВНОСКАВОБЩИЯБЮДЖЕТНАЕВРОПЕЙСКИЯСЪЮЗ"),
    ("balance", "БЮДЖЕТНОСАЛДО"),
    ("financing", "ОПЕРАЦИИВЧАСТТАНАФИНАНСИРАНЕТО"),
]


def headline(rows_parsed):
    """Section headline rows of a budget table: {'rev':…, 'exp':…, 'transfers':…, 'balance':…, 'financing':…}."""
    out = {}
    for r in rows_parsed:
        if not roman(r["no"]):
            continue
        sq = squash(r["text"])
        for key, label in _KEYS:
            if sq.startswith(label) and key not in out:
                out[key] = r["value"]
    return out


_DIST = re.compile(r"^\(\d+\)\s*Утвърждава\s+(?:разпределение\s+на\s+)?разходите\s+(?:на\s+[^,]+?\s+)?по\s+ал\.\s*1\s+(по\s+[^,:]+)")
_BODIES = re.compile(r"^\(\d+\)\s*Определя\s+бюджетните\s+разходи\s+на\s+органите")
_COMMIT = re.compile(r"^\(\d+\)\s*Утвърждава\s+максималните\s+размери\s+на\s+ангажиментите")


def parse_budget(items):
    """Parse the items of one article occurrence.

    Returns {'lines': [...rows of the main table(s)...], 'headline': {...},
             'policies': [{'n','name','khil'[,'parts':[{'n','name','khil'}]]}] (top level only; '7.1' style rows and unnumbered
             'в т.ч.' rows are the `parts` of the preceding item), 'policiesKind': 'policies'|'areas'|None, 'policyTotal': float|None,
             'bodies': [{'name','khil'}], 'bodiesTotal': float|None   (art. 2 only: expenditure by judicial body),
             'commitments': {'entered': x, 'new': y}|None, 'tables': n}.
    The main table is every table chunk before the first paragraph that opens a distribution/commitment table; art. 1
    has four paragraphs (1)-(4) that all belong to the main part, so its lines are concatenated.
    `policiesKind` is 'policies' for 'по области на политики и бюджетни програми', 'areas' for 'по функционални области'.
    """
    lines, policies, bodies, commit = [], [], [], None
    policy_total = bodies_total = None
    kind = None
    mode = "main"
    ntab = 0
    for k, val in items:
        if k == "p":
            m = _DIST.match(val)
            if m:
                mode = "policies"
                kind = "policies" if "политики" in m.group(1) else "areas"
            elif _BODIES.match(val):
                mode = "bodies"
            elif _COMMIT.match(val):
                mode = "commit"
            continue
        ntab += 1
        rows = parse_rows(val)
        if mode == "main":
            lines.extend(rows)
        elif mode == "policies" and not policies:
            for r in rows:
                if squash(r["text"]).startswith("ВСИЧКО"):
                    policy_total = r["value"]
                    continue
                n = r["no"].rstrip(".")
                item = {"n": n, "name": r["text"], "khil": r["value"]}
                if policies and (not n.isdigit()):          # '7.1' (a programme of policy 7) or an unnumbered 'в т.ч. ...'
                    policies[-1].setdefault("parts", []).append(item)
                else:
                    policies.append(item)
            mode = "after"
        elif mode == "bodies" and not bodies:
            for r in rows:
                if squash(r["text"]).startswith("ВСИЧКО"):
                    bodies_total = r["value"]
                elif r["value"] is not None:                 # skips the header row 'Органи на съдебната власт | Сума'
                    bodies.append({"name": r["text"], "khil": r["value"]})
            mode = "after"
        elif mode == "commit" and commit is None:
            vals = [r["value"] for r in rows]
            if len(vals) >= 2:
                commit = {"entered": vals[0], "new": vals[1]}
            mode = "after"
    return {"lines": lines, "headline": headline(lines), "policies": policies, "policiesKind": kind,
            "policyTotal": policy_total, "bodies": bodies, "bodiesTotal": bodies_total,
            "commitments": commit, "tables": ntab}
