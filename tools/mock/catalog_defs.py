"""Static definitions of the data catalog (D25): one entry per file of site/data/, in the order screen S24 shows them.

Shared by build_catalog.py (catalog.json) and build_search.py (the "datasets" group of the search index), so neither
imports the other. Everything that is a DECISION lives here: titles, plain-language descriptions (templates filled with
facts computed from the data by build_catalog.py), the screens that read each file, the group of each file.

`screens` is reconciled with the `needs` that the screens declare in site/js/pages/*.js (validate_data.py prints a warning
for every difference). User-facing strings are Bulgarian; keys and comments are English.
"""

ALL_SCREENS = ["S%02d" % i for i in range(1, 30)]          # S30 is the 404 page

# group id -> label (catalog.groups, in this order)
GROUPS = [
    {"id": "budget", "label": "Бюджет 2026 и прогноза"},
    {"id": "execution", "label": "Изпълнение, дълг и ставки"},
    {"id": "local", "label": "Общини и плащания"},
    {"id": "text", "label": "Текстове"},
    {"id": "service", "label": "Основа и служебни файлове"},
    {"id": "mock", "label": "Примерни данни"},
    {"id": "pending", "label": "Предстоящи набори"},
]

# One row per file. `file` is relative to site/data/. `{…}` placeholders are filled by build_catalog.facts().
DEFS = [
    # ---------------------------------------------------------------------------------------------- budget
    {"slug": "outlook", "file": "outlook.json", "group": "budget", "title": "Рамка на КФП и макропрогноза 2024–2028",
     "desc": "Приходите, разходите, салдото, лихвите и финансирането на консолидираната фискална програма (КФП) за 2024–2028 г. "
             "в млн. € и като дял от БВП, макроикономическата прогноза (БВП, инфлация, безработица) и сравнение на двете "
             "версии на Приложение 3 към мотивите на законопроекта.",
     "screens": ["S01", "S04", "S13", "S17"]},
    # v5: built by gva_sectors_v5.py from two saved Eurostat answers (build_catalog.GVA_FILES); its search row has its own words
    {"slug": "gva-sectors", "file": "gva-sectors.json", "group": "budget",
     "title": "Икономиката по отрасли: добавена стойност и БВП 2019–2025",
     "desc": "Добавената стойност на десетте отрасъла на българската икономика (и на преработващата промишленост като част от "
             "промишлеността), данъците върху продуктите минус субсидиите и БВП, 2019–2025 г., в млн. €. Данни на НСИ, "
             "публикувани от Евростат; 2025 г. е предварителна.",
     "screens": ["S31"],
     "search": {"period": "2019–2025", "kw": "gva-sectors gva-sectors.json отрасли сектори добавена стойност бвп икономика"}},
    {"slug": "revenue", "file": "revenue.json", "group": "budget", "title": "Приходи на КФП по видове",
     "desc": "Приходите на КФП за 2024–2028 г.: {n_rev_groups} групи и {n_rev_rows} реда от Приложение 3 към мотивите, "
             "в млн. € и като дял от БВП. Изпълнението по видове данъци предстои (P01).",
     "screens": ["S04", "S06", "S07", "S13", "S15", "S19"]},
    {"slug": "expenditure", "file": "expenditure.json", "group": "budget", "title": "Разходи на КФП: функции, икономически вид и COFOG",
     "desc": "Разходите на КФП по функции (Табл. III-1, {n_functions} функции), по икономически вид (Приложение 3) и по функции "
             "на държавното управление по COFOG (Евростат, {cofog_from}–{cofog_to}). Трите разреза не са сравними един с друг.",
     "screens": ["S04", "S07", "S08", "S18", "S19"]},
    {"slug": "components", "file": "components.json", "group": "budget", "title": "Съставни бюджети и трансфери",
     "desc": "Бюджетите, от които се състои КФП: държавен бюджет, ДОО, НЗОК, общини и сметки за средства от ЕС, трансферите "
             "между тях по ЗДБ, ЗБДОО и ЗБНЗОК за 2026 г. и национален бюджет срещу европейски средства. "
             "Месечното изпълнение по съставни бюджети предстои (P02).",
     "screens": ["S15"]},
    {"slug": "ministries", "file": "ministries.json", "group": "budget", "title": "Бюджети на ведомствата за 2026 г.",
     "desc": "Бюджетите на {n_budgets} първостепенни разпоредители по чл. 2–47 от ЗДБ 2026: приходи, разходи, трансфери, "
             "политики и сравнение на законопроекта с приетия закон.",
     "screens": ["S05", "S07", "S10", "S11", "S19"]},
    {"slug": "ministries-programs", "file": "ministries/*.json", "group": "budget", "multi": True,
     "title": "Програмни бюджети на ведомствата",
     "desc": "Политиките и програмите на ведомствата по години (2023–2028) от програмните бюджети към законопроекта: по един "
             "файл на ведомство. За {n_pending_programs} от {n_budgets} бюджета програмите предстоят (P03).",
     "screens": ["S10", "S11"]},
    {"slug": "programs", "file": "programs.json", "group": "budget", "title": "Индекс на програмите",
     "desc": "Индекс на {n_programs} програми от програмните бюджети: код, име, политика и суми за 2025 и 2026 г. Служи за търсене "
             "и подреждане, без да се зареждат всички ведомства.",
     "screens": ["S10", "S19"]},
    {"slug": "measures", "file": "measures.json", "group": "budget", "title": "Мерки в бюджета за 2026 г.",
     "desc": "{n_measures} мерки от мотивите към законопроекта (Табл. II-8, II-9 и част VIII) с оценка на ефекта върху приходите "
             "и разходите в млн. €, цитати и страници на документа.",
     "screens": ["S01", "S04", "S08", "S12", "S19"]},
    {"slug": "law", "file": "law.json", "group": "budget", "title": "Законопроект и закон: как се прие бюджетът",
     "desc": "Законопроектът за държавния бюджет е сравнен ред по ред със закона (чл. 1 и {n_budgets} бюджета), с хронология на "
             "законодателния път, доклади, становища, предложения между четенията и ДВ.",
     "screens": ["S11", "S14", "S16"]},
    # ---------------------------------------------------------------------------------------------- execution
    {"slug": "execution", "file": "execution.json", "group": "execution", "title": "Месечно изпълнение на КФП",
     "desc": "Изпълнението на КФП, на националния бюджет и на европейските средства: натрупани суми към края на всеки месец "
             "(януари 2024 – {asof_month}), план за 2026 г., ново заемане и капиталови разходи. Отчетите са на касова основа.",
     "screens": ["S01", "S04", "S06", "S15", "S16", "S17", "S19"]},
    {"slug": "execution-provenance", "file": "execution-provenance.json", "group": "execution",
     "title": "Произход на числата от месечните отчети",
     "desc": "За всяко число на месечното изпълнение: отчетът на МФ, неговият sha256, листът и клетката, а за изчислените числа правилото. "
             "За плана за 2026 г.: страницата и редът на Приложение 3 към мотивите.",
     "screens": ["S15"]},
    {"slug": "debt", "file": "debt.json", "group": "execution", "title": "Държавен дълг: размер, лихви и лимити",
     "desc": "Държавният дълг 2024–2028, дългът по Маастрихт (Евростат, България и ЕС), тримесечни редове (Евростат, БНБ), лихви, "
             "гаранции, ново заемане и законови лимити. Падежите и емисиите предстоят (P06).",
     "screens": ["S01", "S04", "S13", "S16", "S17"]},
    {"slug": "rates", "file": "rates.json", "group": "execution", "title": "Данъци и осигуровки: ставки за 2026 г.",
     "desc": "Ставките по ЗБДОО, ЗБНЗОК и таблицата на НАП, осигурителните прагове до и от 01.08.2026 г., ТЗПБ по {n_activities} "
             "дейности и сценариите на калкулатора. Сценарият „Пенсионер“ и данъкът при самоосигуряване предстоят.",
     "screens": ["S04", "S16", "S18"]},
    # ---------------------------------------------------------------------------------------------- local
    {"slug": "municipalities", "file": "municipalities.json", "group": "local", "title": "Общини: трансфери, население и области",
     "desc": "Трансферите по чл. 51 от ЗДБ 2026 към {n_munis} общини по пет вида, населението им (Евростат GISCO, LAU 2024) и "
             "областите (Евростат).",
     "screens": ["S19", "S20", "S21"]},
    {"slug": "geo-obshtini", "file": "geo/obshtini.json", "group": "local", "title": "Граници на общините (GeoJSON)",
     "desc": "Границите на {n_munis} общини (WGS84), опростени до около 50 метра; общината се разпознава по `properties.id`.",
     "screens": ["S20", "S21"], "format": "GeoJSON", "mediaType": "application/geo+json"},
    {"slug": "sebra", "file": "sebra.json", "group": "local", "title": "Плащания по СЕБРА: дневни обобщения на МИДТ",
     "desc": "Дневните обобщения на плащанията на Министерството на иновациите и дигиталната трансформация за {n_days} дни от "
             "август 2026 г.: брой и сума по вид разход и по бюджетна организация. Файловете нямат получатели и единични плащания.",
     "screens": ["S23"]},
    # ---------------------------------------------------------------------------------------------- text
    {"slug": "glossary", "file": "glossary.json", "group": "text", "title": "Речник",
     "desc": "{n_terms} понятия на разбираем език: определения, примери, свързани понятия и препратки „Виж в бюджета“. "
             "Подсказките за понятията в целия сайт четат същия файл.",
     "screens": ["S03"]},
    {"slug": "guide", "file": "guide.json", "group": "text", "title": "Пътеводител",
     "desc": "Текстовете на пътеводителя: въведение, {n_steps} стъпки с бележки и „Преди да използваш или споделиш число“. "
             "Показват се в „Бюджетът за 5 минути“.",
     "screens": ["S02"]},
    # ---------------------------------------------------------------------------------------------- service
    {"slug": "core", "file": "core.json", "group": "service", "title": "Ядро: източници, предстоящи набори и основни числа",
     "desc": "Единственият файл, който се зарежда преди първото показване: регистърът на източниците, предстоящите набори (P01–P07), "
             "броячите, населението по години и шестте основни числа на началната страница. Числата са копирани от наборите, "
             "които ги притежават.",
     "screens": ALL_SCREENS, "eager": True, "contains": ["D18"]},
    {"slug": "feed", "file": "feed.json", "group": "service", "title": "Новото в данните",
     "desc": "{n_events} събития (отчети, закони, ставки, данни на Евростат), основните изводи от последния отчет и очакваните "
             "публикации.",
     "screens": ["S16"]},
    {"slug": "feed-rss", "file": "feed.xml", "group": "service", "title": "Новото в данните: RSS",
     "desc": "Същите събития като RSS 2.0 за четци на новини.",
     "screens": ["S16"], "format": "RSS", "mediaType": "application/rss+xml"},
    {"slug": "search-index", "file": "search-index.json", "group": "service", "title": "Индекс за търсене",
     "desc": "Индексът на търсенето в сайта: показатели, институции, общини, мерки, понятия и набори от данни.",
     "screens": ["S28"]},
    {"slug": "catalog", "file": "catalog.json", "group": "service", "title": "Каталог на данните",
     "desc": "Този каталог: всички набори и файлове, капаните при четене на числата, методиката и контролните суми на "
             "първичните файлове.",
     "screens": ["S24", "S25"], "self": True},
    # ---------------------------------------------------------------------------------------------- mock
    {"slug": "mock-activities", "file": "mock/activities.json", "group": "mock", "title": "Примерни дейности: здравеопазване и образование",
     "desc": "Примерни данни. Дейности на двете функции; сборът им е равен на реалното перо от Табл. III-1.",
     "screens": ["S09"]},
    {"slug": "mock-indicators", "file": "mock/indicators.json", "group": "mock", "title": "Примерни показатели за резултат на програмите",
     "desc": "Примерни данни. Показатели за резултат на {n_indicator_programs} програми на МФ, МОН и МТСП: програмите са реални, "
             "показателите и стойностите са измислени.",
     "screens": ["S11"]},
    {"slug": "mock-municipal-finance", "file": "mock/municipal-finance.json", "group": "mock", "title": "Примерни финанси на общините",
     "desc": "Примерни данни. Собствени приходи, разходи, дълг и тримесечия по общини; сборът на разходите е реалната сума "
             "от АСБП, а трансферите са реалните по ЗДБ.",
     "screens": ["S20", "S21"]},
    {"slug": "mock-payments", "file": "mock/payments.json", "group": "mock", "title": "Примерни плащания на бюджетните организации",
     "desc": "Примерни данни. Плащания в духа на СЕБРА за януари–август 2026 г. по институции, видове и дни; изпълнителите са "
             "измислени.",
     "screens": ["S23"]},
    {"slug": "mock-projects", "file": "mock/projects.json", "group": "mock", "title": "Примерни капиталови проекти",
     "desc": "Примерни данни. Измислени проекти; общата им сума е малък дял от реалния план за капиталови разходи.",
     "screens": ["S22"]},
    {"slug": "mock-measure-labels", "file": "mock/measure-labels.json", "group": "mock", "title": "Дата и правно основание на мерките",
     "desc": "Примерни данни. Сайтът чете от файла само датата на влизане в сила и правното основание на мярката, дословно от "
             "текста. Етикетите „кого засяга“ не се показват.",
     "screens": ["S01", "S08", "S12"]},
    {"slug": "mock-tax-assumptions", "file": "mock/tax-assumptions.json", "group": "mock", "title": "Допускания за косвените данъци",
     "desc": "Примерни данни. Допускания за ДДС и акцизите в калкулатора: ставките са реални, цените и дяловете са ориентировъчни.",
     "screens": ["S18"]},
]

# Files a catalog entry must NOT describe with sizes (it would be circular).
SELF_SLUGS = {d["slug"] for d in DEFS if d.get("self")}


def dataset_defs():
    """A copy of DEFS (callers may annotate it)."""
    return [dict(d) for d in DEFS]


def by_slug():
    return {d["slug"]: d for d in DEFS}
