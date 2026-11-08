"""Registries and helpers shared by the datasets modules (bd_*.py). Pure stdlib.

Holds everything that is a DECISION rather than a computation: the source registry (`core.sources`), the pending
registry P01-P07 (`core.pending`), function slugs, revenue groups, the ЕБК code <-> ЗДБ article map and the
Bulgarian number formatting used for ready-made display strings (search index, feed). User-facing strings are
Bulgarian; code, keys and comments are English.
"""

from pathlib import Path as _Path
ROOT = _Path(__file__).resolve().parents[3]
import re

from budget_pipeline.build.data_io import BUILD_DATE, isnum

NBSP = "\u00a0"
NNBSP = "\u202f"
MINUS = "\u2212"
# the Eurostat release of tps00001 that data/inputs/population.json copies (core.json and the feed event both carry it);
# a later release with the same numbers does not move it, feed.py stops if the numbers change
POPULATION_ASOF = "2026-09-30"

# --------------------------------------------------------------------------------------------- formatting
# Mirrors apps/web/client/format.js (group separator = narrow no-break space, decimal comma, typographic minus).


def fmt_num(v, d=0, sign=False):
    if not isnum(v):
        return "—"
    f = "%.*f" % (d, abs(v))
    neg = v < 0 and float(f) != 0
    i, _, fr = f.partition(".")
    i = re.sub(r"\B(?=(\d{3})+(?!\d))", NNBSP, i)
    return (MINUS if neg else "+" if sign and float(f) != 0 else "") + i + ("," + fr if fr else "")


def fmt_pct(v, d=1, sign=False):
    return fmt_num(v, d, sign) + "%" if isnum(v) else "—"


def fmt_money(mln, d=None):
    """Million euro -> '26,35 млрд. €' (>= 1000) or '738,4 млн. €'."""
    if not isnum(mln):
        return "—"
    a = abs(mln)
    if a >= 1000:
        return fmt_num(mln / 1000.0, 2 if d is None else d) + NBSP + "млрд." + NBSP + "€"
    return fmt_num(mln, (1 if a >= 100 else 2) if d is None else d) + NBSP + "млн." + NBSP + "€"


def fmt_khil(v, d=1):
    return fmt_num(v, d) + NBSP + "хил." + NBSP + "€" if isnum(v) else "—"


def fmt_eur(v, d=0):
    return fmt_num(v, d) + NBSP + "€" if isnum(v) else "—"


_MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември",
           "декември"]


def fmt_date(iso, long=False):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    if not m:
        return "—"
    if long:
        return "%d%s%s%s%s" % (int(m.group(3)), NBSP, _MONTHS[int(m.group(2)) - 1], NBSP, m.group(1))
    return "%s.%s.%s" % (m.group(3), m.group(2), m.group(1))


def month_name(m):
    return _MONTHS[m - 1]


# --------------------------------------------------------------------------------------------- year-aligned arrays
def span(values):
    """Annual series with possible blanks -> (start_index, values) without None.

    Blank cells are only allowed at the start and/or end (a missing year is never filled with 0); a blank
    inside the span raises. The caller stores `y0` when start_index > 0."""
    idx = [i for i, v in enumerate(values) if v is not None]
    if not idx:
        return 0, []
    a, b = idx[0], idx[-1]
    seg = values[a:b + 1]
    if any(v is None for v in seg):
        raise ValueError("blank inside a series: %r" % (values,))
    return a, seg


# --------------------------------------------------------------------------------------------- sources
# core.sources: key -> {title, publisher, url, kind, access, note}. `url` is the PUBLIC address of the publisher.
SOURCES = {
    "kfp": {
        "title": "Консолидирана фискална програма (КФП): месечна информация за изпълнението",
        "publisher": "Министерство на финансите",
        "url": "https://www.minfin.bg/bg/statistics/5",
        "kind": "xls", "access": "browser-only",
        "note": "Кумулативни месечни отчети, лист „стартова“. Отчетите за 2025 г. са в млн. лв. и са превърнати в евро по 1,95583; "
                "за 2026 г. са в млн. €. Страницата на МФ се отваря само през браузър; запазените файлове са описани с контролна сума (sha256) в „Данни“."},
    "asbp": {
        "title": "Мотиви към законопроекта за държавния бюджет 2026: актуализирана средносрочна бюджетна прогноза (АСБП) 2026–2028",
        "publisher": "Министерство на финансите",
        "url": "https://www.parliament.bg/bills/52/52-602-01-19.docx",
        "kind": "pdf", "access": "open",
        "note": "Основата на числата е PDF версията на мотивите (проект от юни 2026 г.). Внесеният на 01.07.2026 г. документ (.docx) се различава в 9 реда "
                "на Приложение 3 (само 2026–2028, до 4,3 млн. €; общите суми и осемте групи приходи съвпадат). Различията са публикувани в „Прогноза“."},
    "bill": {
        "title": "Законопроект за държавния бюджет на Република България за 2026 г. (№ 52-602-01-19)",
        "publisher": "Министерски съвет; Народно събрание",
        "url": "https://www.parliament.bg/bills/52/52-602-01-19.docx",
        "kind": "doc", "access": "open",
        "note": "Внесен на 01.07.2026 г. Проектът е сравнен с приетия закон ред по ред."},
    "zdb": {
        "title": "Закон за държавния бюджет на Република България за 2026 г.",
        "publisher": "Народно събрание; Държавен вестник, бр. 69 от 31.07.2026 г.",
        "url": "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=245041",
        "kind": "html", "access": "open",
        "note": "Чл. 1–47 (бюджети по ведомства), чл. 51–52 (трансфери към общините). Суми в хил. €."},
    "zbdoo": {
        "title": "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
        "publisher": "Народно събрание; Държавен вестник, бр. 68 от 28.07.2026 г.",
        "url": "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244982",
        "kind": "html", "access": "open", "note": "Осигурителни вноски и разпределението им между фондовете."},
    "zbnzok": {
        "title": "Закон за бюджета на Националната здравноосигурителна каса за 2026 г.",
        "publisher": "Народно събрание; Държавен вестник, бр. 68 от 28.07.2026 г.",
        "url": "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244981",
        "kind": "html", "access": "open", "note": "Здравноосигурителни вноски и бюджет на НЗОК."},
    "prb": {
        "title": "Програмни бюджети на първостепенните разпоредители (архив към законопроекта)",
        "publisher": "Министерство на финансите; Народно събрание",
        "url": "https://www.parliament.bg/bills/52/52-602-01-19.zip",
        "kind": "pdf", "access": "open",
        "note": "PDF документи по ведомства (папка 7 на архива). Таблиците са разчетени автоматично; сумите са сверени със закона."},
    "parliament": {
        "title": "Народно събрание: данни за законопроекта и законодателния път",
        "publisher": "Народно събрание на Република България",
        "url": "https://www.parliament.bg/bg/bills/ID/167157",
        "kind": "api", "access": "open",
        "note": "Дати на докладите, четенията и предложенията между първо и второ четене; само броят и връзките към документите."},
    "eurostat": {
        "title": "Eurostat: държавен дълг, разходи по функции (COFOG), население, БВП по отрасли",
        "publisher": "Евростат",
        "url": "https://ec.europa.eu/eurostat/web/main/data/database",
        "kind": "api", "access": "open",
        "note": "Набори gov_10dd_edpt1, gov_10q_ggdebt, gov_10a_exp, tps00001, demo_r_pjanaggr3, nama_10_a10 и nama_10_gdp (национални "
                "сметки на България по данни на НСИ: добавена стойност по отрасли и БВП). Разходите по функции (COFOG) са по методика "
                "на сектор „Държавно управление“, не по КФП."},
    "bnb": {
        "title": "БНБ: дълг на сектор „Държавно управление“ и на централното управление (SDMX)",
        "publisher": "Българска народна банка",
        "url": "https://www.bnb.bg/bnbweb/groups/public/documents/bnb_sdmx/ggd.xml",
        "kind": "api", "access": "open", "note": "Тримесечни общи суми в млн. €."},
    "nap": {
        "title": "НАП: размер на осигурителните вноски за 2026 г. и разпределението им (изх. ВК-30-10237 от 12.08.2026 г.)",
        "publisher": "Национална агенция за приходите",
        "url": "https://nap.bg/wps/wcm/connect/nra.bg25863/6f117462-1836-48f8-9e27-a4b02a1e55fb/%D0%9F%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5_1_%D0%92%D0%9A-30-10237_12.08.2026.pdf?MOD=AJPERES",
        "kind": "pdf", "access": "open", "note": "Приложение 1: ставки на осигурителните вноски по видове осигурени лица."},
    "sebra": {
        "title": "СЕБРА: дневно обобщение на плащанията на Министерството на иновациите и дигиталната трансформация, 31.08.2026 г.",
        "publisher": "Министерство на иновациите и дигиталната трансформация",
        "url": "https://midt.gov.bg/bg/transparency/sebra/2026",
        "kind": "xls", "access": "open", "note": "Обобщение по бюджетни организации и по вид разход."},
    "gisco": {
        "title": "Eurostat GISCO: местни административни единици (LAU) 2024, граници и население",
        "publisher": "Евростат (GISCO)",
        "url": "https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units/local-administrative-units",
        "kind": "api", "access": "open",
        "note": "Населението на общините е към 1 януари 2024 г. (сборът за страната е 6 445 481, колкото е официалното число на Евростат за същата дата). Границите са опростени за показване."},
    "dataeuropa": {
        "title": "Европейски портал за данни (data.europa.eu)",
        "publisher": "Службата за публикации на Европейския съюз",
        "url": "https://data.europa.eu/data/datasets?locale=bg&query=minfin",
        "kind": "api", "access": "open",
        "note": "Каталогът препраща към наборите на Министерството на финансите; огледалото не е винаги актуално."},
    "minfin": {
        "title": "Министерство на финансите (minfin.bg)",
        "publisher": "Министерство на финансите",
        "url": "https://www.minfin.bg/bg/statistics/5",
        "kind": "html", "access": "browser-only",
        "note": "Страниците връщат отказ (403) към автоматични заявки. Данните, които са само там, са отбелязани като „предстои“."},
    "wg": {
        "title": "Работна група „Бюджет на светло“: редакционни текстове",
        "publisher": "Работна група „Бюджет на светло“",
        "kind": "doc", "access": "none",
        "note": "Речник, пътеводител и редакционни етикети. Не са официални данни."},
    "mockgen": {
        "title": "Генератор на примерни данни (фиксирано семе 20261002)",
        "publisher": "Работна група „Бюджет на светло“",
        "kind": "generator", "access": "none",
        "note": "Примерните набори са означени „примерни данни“; сборовете им са свързани с реалните числа, които разбиват."},
}

# --------------------------------------------------------------------------------------------- pending registry
# status "pending" = the data exist at the publisher but are not extracted; NO numbers. `reason` states the real cause.
PENDING_DEFS = {
    "P01": {"title": "Изпълнение по видове данъци",
            "reason": "Месечният отчет на МФ в .xls дава само общата сума на данъчните приходи. Разбивката по данъци (ДДС, ДДФЛ, корпоративен данък, акцизи) е в месечния бюлетин на МФ във формат PDF, който не се изтегля автоматично.",
            "expected": "Месечен бюлетин за изпълнението на КФП, minfin.bg",
            "source": ["minfin"], "screens": ["S06", "S15"]},
    "P02": {"title": "Месечно изпълнение по съставни бюджети (държавен бюджет, ДОО, НЗОК, общини)",
            "reason": "Месечните отчети, които са извлечени, дават консолидираната програма, националния бюджет и европейските средства. Разбивката на националния бюджет по съставни бюджети е в отделни таблици на МФ, които още не са извлечени.",
            "expected": "Отделни таблици към месечната информация за КФП, minfin.bg",
            "source": ["minfin"], "screens": ["S15"]},
    "P03": {"title": "Програмите на част от ведомствата",
            "reason": "За тези бюджети таблиците на програмния бюджет в архива към законопроекта не се разчетоха надеждно (различен формат на документа), затова не показваме числа.",
            "expected": "Програмни бюджети на ведомствата, архив към законопроекта 52-602-01-19",
            "source": ["prb"], "screens": ["S10", "S11"]},
    "P04": {"title": None, "reason": None,                    # set_kfp_pending() fills both from execution.json
            "expected": "Месечна информация за КФП, minfin.bg",
            "source": ["minfin"], "screens": ["S15", "S16"]},
    "P05": {"title": "Ориентир 2022–2023",
            "reason": "Месечните отчети за 2022–2023 г. не са извлечени; сравнението на изпълнението е със същия период на предходната година (2024 или 2025 г.).",
            "expected": "Месечна информация за КФП за предходните години, minfin.bg",
            "source": ["minfin"], "screens": ["S15"]},
    "P06": {"title": "Падежи и емисии на държавния дълг",
            "reason": "Регистърът на държавния дълг на МФ с падежите и емисиите на държавните ценни книжа не е достъпен за автоматично изтегляне.",
            "expected": "Данни за държавния дълг, minfin.bg",
            "source": ["minfin"], "screens": ["S17"]},
    "P07": {"title": "Съдържанието и ефектът на 69-те предложения между първо и второ четене",
            "reason": "Предложенията са PDF документи в сайта на Народното събрание. Публикуваме броя им и връзките; съдържанието и фискалният им ефект не са извлечени.",
            "expected": "Предложения за второ гласуване, parliament.bg",
            "source": ["parliament"], "screens": ["S14"]},
}


def set_kfp_pending(execution):
    """P04 names the next КФП report and the last one added. datasets.py calls this before the builders run,
    so core, the catalog, the feed and search follow execution.json instead of a month written into the code."""
    nxt, last = execution["pendingMonths"][0], execution["latest"]
    y, m, d = nxt["asOf"].split("-")
    PENDING_DEFS["P04"].update(
        title="Отчетът към %s.%s.%s г. и следващите" % (d, m, y),
        reason="Отчетът за %s %s г. още не е добавен: страницата на МФ с месечните отчети се отваря само през браузър "
               "(отказ 403 към автоматични заявки), а последният наличен файл е за %s %s г."
               % (month_name(nxt["month"]), y, month_name(last["month"]), last["asOf"][:4]))


def pending_block(pid, **override):
    """A pending block as embedded in core.pending (no numbers)."""
    d = PENDING_DEFS[pid]
    out = {"status": "pending", "id": pid, "title": d["title"], "reason": d["reason"], "expected": d["expected"],
           "source": list(d["source"]), "screens": list(d["screens"])}
    out.update(override)
    return out


# --------------------------------------------------------------------------------------------- functions (Табл. III-1)
# (slug, prefix of the printed name, glossary slug, main budgets - an editorial pointer, NOT an accounting split)
FUNCTION_DEFS = [
    ("obshti-sluzhbi", "Общи държавни служби", "byudzhetna-funktsiya", ["0100", "0200", "0300", "1000", "1100"]),
    ("otbrana-sigurnost", "Отбрана и сигурност", "byudzhetna-funktsiya", ["1200", "1300", "0600", "3000", "3900"]),
    ("obrazovanie", "Образование", "byudzhetna-funktsiya", ["1700"]),
    ("zdraveopazvane", "Здравеопазване", "byudzhetna-funktsiya", ["1600"]),
    ("sotsialni", "Социално осигуряване, подпомагане и грижи", "byudzhetna-funktsiya", ["1500"]),
    ("zhilishtno-sreda", "Жилищно строителство", "byudzhetna-funktsiya", ["2100", "1900"]),
    ("kultura-sport", "Култура, спорт", "byudzhetna-funktsiya", ["1800", "2500"]),
    ("ikonomika", "Икономически дейности и услуги", "byudzhetna-funktsiya", ["2000", "2200", "2300", "2400", "7100", "7400"]),
    ("drugi", "Р-ди некласифицирани", "byudzhetna-funktsiya", []),
]
FUNCTION_NAMES = {   # full display names (the printed names are abbreviated in two places)
    "drugi": "Разходи, некласифицирани в другите функции",
}
FUNCTIONS_MINISTRIES_NOTE = ("Основни ведомства по функцията: ориентир за навигация, не счетоводно разпределение. "
                             "Бюджетите на ведомствата и функциите са два различни разреза на едни и същи пари.")

# --------------------------------------------------------------------------------------------- revenue groups
# (id, display name, Annex 3 row ids that are summed, glossary slug)
REVENUE_GROUP_DEFS = [
    ("dds", "ДДС", ["r.vat"], "dds"),
    ("osiguritelni", "Социални и здравни осигуровки", ["r.social"], "osiguritelni-vnoski"),
    ("nedanachni", "Неданъчни приходи", ["r.nontax"], "nedanachni-prihodi"),
    ("pomoshti", "Помощи и дарения (основно европейски средства)", ["r.grants"], "bezvazmezdno-finansirane"),
    ("ddfl", "Данък върху доходите на физическите лица", ["r.pit"], "danak-varhu-dohodite"),
    ("akcizi", "Акцизи", ["r.excise"], "aktsiz"),
    ("korporativen", "Корпоративен данък", ["r.corp"], "korporativen-danak"),
    ("drugi", "Други данъци и мита", ["r.insprem", "r.customs", "r.othertax"], "danak"),
]

# --------------------------------------------------------------------------------------------- ЕБК codes <-> ЗДБ articles
# Budget code (ЕБК, 4 digits, as used in the program budgets) -> article of ЗДБ 2026 (чл. 2-47).
EBK_ART = {
    "0100": 3, "0200": 5, "0300": 6, "0400": 7, "0500": 4, "0600": 2, "1000": 9, "1100": 10, "1200": 11, "1300": 12,
    "1400": 13, "1500": 14, "1600": 15, "1700": 16, "1800": 17, "1900": 18, "2000": 19, "2100": 23, "2200": 24,
    "2300": 25, "2400": 21, "2500": 26, "3000": 27, "3200": 28, "3300": 29, "3400": 30, "3700": 31, "3800": 32,
    "3900": 33, "4000": 8, "4100": 34, "4200": 35, "4300": 36, "4400": 37, "4500": 38, "4600": 39, "4700": 42,
    "4800": 40, "5300": 41, "7100": 22, "7400": 20, "8200": 44, "8300": 43, "8400": 45, "8500": 46, "8600": 47,
}
ART_EBK = {a: c for c, a in EBK_ART.items()}

# code -> (short name, kind). kind: ministry|agency|commission|judiciary|constitutional|legislature|fund|other
BUDGET_INFO = {
    "0100": ("Народно събрание", "legislature"),
    "0200": ("Президент (администрация)", "constitutional"),
    "0300": ("Министерски съвет", "other"),
    "0400": ("Конституционен съд", "constitutional"),
    "0500": ("Сметна палата", "constitutional"),
    "0600": ("Съдебна власт", "judiciary"),
    "1000": ("МФ", "ministry"), "1100": ("МВнР", "ministry"), "1200": ("МО", "ministry"), "1300": ("МВР", "ministry"),
    "1400": ("МП", "ministry"), "1500": ("МТСП", "ministry"), "1600": ("МЗ", "ministry"), "1700": ("МОН", "ministry"),
    "1800": ("МК", "ministry"), "1900": ("МОСВ", "ministry"), "2000": ("МИИИ", "ministry"), "2100": ("МРРБ", "ministry"),
    "2200": ("МЗХ", "ministry"), "2300": ("МТС", "ministry"), "2400": ("МЕ", "ministry"), "2500": ("ММС", "ministry"),
    "3000": ("ДАНС", "agency"),
    "3200": ("Комисия по досиетата", "commission"),
    "3300": ("КЗД", "commission"), "3400": ("КЗЛД", "commission"), "3700": ("КОНПИ", "commission"),
    "3800": ("НСО", "agency"), "3900": ("ДАР", "agency"),
    "4000": ("Омбудсман", "constitutional"),
    "4100": ("НСИ", "agency"), "4200": ("КЗК", "commission"), "4300": ("КРС", "commission"), "4400": ("СЕМ", "commission"),
    "4500": ("КЕВР", "commission"), "4600": ("АЯР", "agency"), "4700": ("КФН", "commission"), "4800": ("ДКСИ", "commission"),
    "5300": ("ДА „Държавен резерв“", "agency"),
    "7100": ("МТ", "ministry"), "7400": ("МИДТ", "ministry"),
    "8200": ("ЦИК", "commission"), "8300": ("КПНРО", "commission"), "8400": ("ДФ „Земеделие“", "fund"),
    "8500": ("НБКСРС", "agency"), "8600": ("ДАТО", "agency"),
}
KIND_LABELS = {"ministry": "Министерства", "agency": "Агенции и служби", "commission": "Комисии и съвети",
               "judiciary": "Съдебна власт", "constitutional": "Конституционни органи", "legislature": "Законодателна власт",
               "fund": "Фондове", "other": "Други"}

# the printed names are in the genitive ("бюджета на Министерството ..."): first-word map to the nominative
_NOM_FIRST = {"Министерството": "Министерство", "Министерския": "Министерски", "Комисията": "Комисия", "Държавната": "Държавна",
              "Националната": "Национална", "Националния": "Национален", "Националното": "Национално", "Съвета": "Съвет",
              "Агенцията": "Агенция", "Омбудсмана": "Омбудсман", "Конституционния": "Конституционен", "Сметната": "Сметна",
              "Администрацията": "Администрация", "Централната": "Централна", "Народното": "Народно", "съдебната": "Съдебна"}


def nominative(law_name):
    """'Министерството на финансите' -> 'Министерство на финансите' (only the first word changes)."""
    first, _, rest = law_name.partition(" ")
    return (_NOM_FIRST.get(first, first) + (" " + rest if rest else "")).strip()


def _selftest():
    assert nominative("съдебната власт") == "Съдебна власт"
    assert nominative("Държавен фонд „Земеделие“") == "Държавен фонд „Земеделие“"
    assert fmt_money(26347.377) == "26,35 млрд. €"
    assert fmt_num(-2201.439, 1) == "−2 201,4"
    assert len(EBK_ART) == 46 and sorted(ART_EBK) == list(range(2, 48))
    assert set(BUDGET_INFO) == set(EBK_ART)


_selftest()
