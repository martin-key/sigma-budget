#!/usr/bin/env python3
"""Безглава проверка на прототипа (Playwright + Chromium) при 1280 px и 400 px, светла и тъмна тема.

Какво прави: вдига локален HTTP сървър за prototype/site/, отваря всеки екран от ROUTES (плюс няколко
ведомства и търсенето в „Моята община“) с включени източници и проверява:
  - няма грешки в конзолата и JS изключения;
  - в текста и в SVG надписите няма NaN, undefined, Infinity, null, [object Object];
  - страницата не се превърта хоризонтално (широки могат да са само таблиците в .table-wrap);
  - калкулаторът дава очакваните суми за 1 500 € бруто по ставките за 2026 г.;
  - началната страница (за всеки тип потребител и при първо посещение, преди избора): заглавието
    „Бюджет на светло“ и лентата „Бюджет 2026 в шест числа“ са най-горе, с 6-те плочки в реда и със
    стойностите от източниците (БВП 125,2; приходи 49,6; разходи 56,8; дефицит 5,7%; капиталови
    разходи 9,36 и 32,7% изпълнение към 31 юли; дълг 30,1%), а в заглавната част е входът „Нов си тук? Започни с пътеводителя“;
  - пътеводителят (#/patevoditel, за всеки тип потребител): текстът е дословно този в tmp/guide/guide_raw.txt (файлът не е в хранилището — поставете го там)
    (номерът на стъпката е в кръгчето, а петте проверки са по една на ред; бележките са в падащите полета); всяка връзка
    води до съществуващ екран; всеки бутон „Отвори „X““ отваря екрана, който в менюто се казва X (и заглавието му е X,
    освен на началната страница), а „Назад“ връща на същата стъпка; от v3.5 „Следва:“ отваря екрана на следващата стъпка
    (от първата — „Откъде идват парите?“, #/prihodi), а „Назад“ връща на тази стъпка в пътеводителя;
    превключвателят „Покажи източниците“ в кутията с петте проверки работи заедно с този горе вдясно.
  - v3.5 — грешката „Откъде идват парите?“: всяка връзка с „откъде идват“ (меню, подзаглавие, плочка, карти, пътеводител)
    води към #/prihodi, а адреси като #/Prihodi, #/prihodi?utm=… и #%2Fprihodi отварят приходите, не началната страница;
  - v3.5 — „Следва“: всеки екран завършва с бутона „Следва“ по реда на пътеводителя (Какъв е бюджетът? → … → Колко плащам
    аз? → „Откъде са данните?“ или началото); всяка връзка води до съществуващ екран, а първата се отваря с правилното заглавие;
  - v3.5 — падащите пояснения (ⓘ): затворени по подразбиране, отварят се и се затварят, не застъпват бутони и превключватели;
  - v3.5 — търсенето на началната страница: ДДС, дълг, Пловдив, образование, МВР (и синоними, латиница) дават резултати с име,
    стойност, период/статус и връзка към съществуващ екран; първият е очакваният и връзката му отваря екрана (и реда, ако е
    към ред); клавиатура: „/“, стрелки, Enter, Escape; при 400 px отворените резултати не превъртат страницата настрани.
  - v3.6 — речникът (#/rechnik): всичките 64 термина са на екрана дословно като в src/glossary.json (номер и заглавие,
    определение, „Пример:“), в петте раздела на PDF-а с обхвата „термини N–M“; „Свързани понятия“ (7) и източниците (7)
    са същите; „Речник“ е в менюто вляво под „Пътеводител“ („Започни оттук“), а на телефон — „Още“ е активно и картата
    на прототипа (#/karta, „Още“) води към него; категориите, буквите от азбучния указател и търсачката показват верните
    термини (и „заплата преди удръжки“ → „Брутна заплата“, примерът от PDF-а); при грешно изписване („дефецит“) има
    близък термин; всеки адрес #/rechnik/<slug> отваря, превърта до и подчертава своя термин; всяко „Виж в бюджета“ отваря
    съществуващ екран (и подчертава реда, ако води към ред); „Разгъни всички“ не разширява страницата настрани;
    думите от речника в текста на екраните водят към съществуващ термин, по веднъж на екран, най-много 3 в абзац, не в
    заглавия, числа, таблици, графики, бутони и връзки; кликът показва пояснението на място (в екрана, над долното меню,
    без смяна на адреса), Escape го затваря, а връзката в него отваря термина; търсенето на началната страница намира
    термините („КФП“, „инфлация“ → речника; при „дефицит“ първа остава плочката с числото).
Записва снимки на ключовите екрани в tmp/render-check/ (папката tmp/ е в .gitignore) и печата обобщение; изходът е 1 при проблем.

Входове: prototype/site/index.html. Мрежа: ECharts от cdnjs и шрифтовете от Google (Bash без sandbox).
Изисква: playwright (pip install playwright) и Chromium; PLAYWRIGHT_BROWSERS_PATH, ако браузърът е другаде.
Употреба: python3 check_render.py [--shots] [--url https://example.org/budget/]  (с --url проверява живия сайт)
"""
import asyncio, functools, http.server, json, os, re, sys, threading

from playwright.async_api import async_playwright

ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[2])
SITE = f"{ROOT}/prototype/site"
SHOTS = f"{ROOT}/tmp/render-check"
BAD = ["NaN", "undefined", "Infinity", "[object Object]", "null"]
EXTRA = ["vedomstvo/9", "vedomstvo/11", "vedomstvo/12", "vedomstvo/14", "vedomstvo/45", "patevoditel/5", "patevoditel/proveri", "rechnik/kfp"]
SHOT_PAGES = ["", "patevoditel", "rechnik", "prihodi", "izpalnenie", "vedomstvo/11", "dalg", "obshtini", "danaci", "danni"]
# Лентата на началната страница: [етикет на плочката, задължителни части от текста ѝ].
STRIP_WANT = [("БВП", ["125,2 млрд. €"]), ("Приходи", ["49,6 млрд. €"]), ("Разходи", ["56,8 млрд. €"]), ("Дефицит", ["5,7% от БВП", "7,19 млрд. €"]),
              ("Капиталови разходи", ["9,36 млрд. €", "3,06 млрд. €", "32,7%", "31 юли"]), ("Държавен дълг", ["30,1% от БВП", "Закона за държавния дълг"])]
STRIP_JS = r"""() => {
  const kids = [...document.querySelectorAll('main .page > *')], sp = s => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  return { h1: sp((document.querySelector('main h1') || {}).innerText || ''), top: kids.slice(0, 2).map(k => k.tagName + '.' + k.className),
           tiles: [...document.querySelectorAll('.kstrip .ktile')].map(t => sp(t.innerText)), chooser: !!document.querySelector('.chooser'),
           cta: sp((document.querySelector('main .hero a.guide-cta[href="#/patevoditel"]') || {}).textContent || '') };
}"""


def strip_problems(s, user):
    """Проблемите с лентата на началната страница (празен списък, ако всичко е наред)."""
    out = []
    if s["h1"] != "Бюджет на светло" or s["top"][:1] != ["HEADER.hero"] or not s["top"][1:2] or "kstrip" not in s["top"][1]:
        out.append(f"заглавието и лентата не са най-горе: {s['h1']!r} {s['top']}")
    if len(s["tiles"]) != len(STRIP_WANT):
        out.append(f"плочки: {len(s['tiles'])} вместо {len(STRIP_WANT)}")
    for (label, parts), t in zip(STRIP_WANT, s["tiles"]):
        miss = [x for x in parts if x not in t]
        if not t.startswith(label) or miss or "Източник:" not in t:
            out.append(f"плочка „{label}“: {t[:90]!r} (липсва {miss})")
    if (user is None) != s["chooser"]:
        out.append("изборът „Кой си ти?“ трябва да е видим само преди избора на тип")
    if "Нов си тук?" not in s["cta"] or "Започни с пътеводителя" not in s["cta"]:
        out.append(f"в заглавната част няма вход към пътеводителя: {s['cta']!r}")
    return out


GUIDE_RAW = f"{ROOT}/tmp/guide/guide_raw.txt"
GUIDE_CHECKS = ["Период", "Обхват", "Единица", "Статус", "Източник"]
# Екраните на стъпките от пътеводителя, по ред (v3.5: и поредицата на бутоните „Следва“ в края на екраните).
GUIDE_SEQ = ["", "prihodi", "razhodi", "merki", "vedomstva", "izpalnenie", "dalg", "danaci"]
# „Следва“ в края на екрана: очакваните връзки (първата е основната); за останалите екрани — само да водят до съществуващ екран.
NEXT_WANT = {p: [f"#/{GUIDE_SEQ[i + 1]}"] for i, p in enumerate(GUIDE_SEQ[:-1])} | {"danaci": ["#/danni", "#/"], "patevoditel": ["#/"],
                                                                              "rechnik": ["#/patevoditel", "#/"]}
# Търсене: [заявка, името на първия резултат, екранът, към който води].
SEARCH_WANT = [("ДДС", "ДДС", "prihodi"), ("дълг", "Държавен дълг", "dalg"), ("Пловдив", "Пловдив", "obshtini"),
               ("образование", "Образование", "razhodi"), ("МВР", "Министерството на вътрешните работи", "vedomstvo"),
               ("данък добавена стойност", "ДДС", "prihodi"), ("задлъжнялост", "Държавен дълг", "dalg"), ("plovdiv", "Пловдив", "obshtini")]
# Адреси, които трябва да отворят приходите (до v3.5 непознат адрес мълчаливо показваше началната страница).
HASH_VARIANTS = ["#/Prihodi", "#/prihodi?utm_source=chat", "#%2Fprihodi", "#/prihodi)", "#prihodi"]


def guide_expected():
    """Абзаците на пътеводителя, както трябва да се виждат на екрана: без „N. “ пред заглавието на стъпката (номерът е
    в кръгчето), а изброяването „за кой период е, какво обхваща, … и откъде идва“ е по едно на ред."""
    lines = [x for x in open(GUIDE_RAW, encoding="utf-8").read().split("\n") if not x.startswith(("#", "====="))]
    out = []
    for p in (x.strip() for x in "\n".join(lines).split("\n\n")):
        m5 = re.fullmatch(r"(Провери пет неща:) (.+)\. (Използвай .+)", p)
        if m5:
            *head, last = m5[2].split(", ")
            out += [m5[1], *head, *last.split(" и "), m5[3]]
        elif p:
            out.append(re.sub(r"^\d\. ", "", p))
    return out


GUIDE_JS = r"""() => {
  const sp = s => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim(), routes = new Set(ROUTES.map(r => r.path)), bad = [];
  const info = [...document.querySelectorAll('main .gstep details.info')].map(d => d.open);  // \u043f\u043e \u043f\u043e\u0434\u0440\u0430\u0437\u0431\u0438\u0440\u0430\u043d\u0435 \u0437\u0430\u0442\u0432\u043e\u0440\u0435\u043d\u0438
  document.querySelectorAll('main details').forEach(d => { d.open = true; });              // \u0431\u0435\u043b\u0435\u0436\u043a\u0438\u0442\u0435 \u0441\u0430 \u0432 \u043f\u0430\u0434\u0430\u0449\u0438\u0442\u0435 \u043f\u043e\u043b\u0435\u0442\u0430
  for (const a of document.querySelectorAll('main a[href^="#/"]')) {
    const [p, arg] = a.getAttribute('href').slice(2).split('/');
    if (!(routes.has(p) || p === 'vedomstvo') || (p === 'patevoditel' && arg && !document.getElementById('pv-' + arg))) bad.push(a.getAttribute('href'));
  }
  return { text: sp(document.querySelector('main').innerText), bad, info, h1: sp(document.querySelector('main h1').innerText),
           steps: document.querySelectorAll('main .gstep').length, routeQ: Object.fromEntries(ROUTES.map(r => [r.path, r.q])),
           btns: [...document.querySelectorAll('main a.gbtn[data-gstep]')].map(a => [a.getAttribute('href'), a.dataset.screen, sp(a.textContent)]),
           next: [...document.querySelectorAll('main a.gnext')].map(a => a.getAttribute('href')),
           checks: [...document.querySelectorAll('main .checks li b')].map(b => b.textContent),
           danni: !!document.querySelector('main .gcheck a[href="#/danni"]'), sw: !!document.querySelector('main .gcheck #gSrc'),
           nav: sp((document.querySelector('#nav a[href="#/patevoditel"]') || {}).textContent || '') };
}"""
DEST_JS = """() => ({ hash: location.hash, h1: (document.querySelector('main h1') || {}).textContent,
  cur: ((document.querySelector('#nav a[aria-current="page"]') || {}).textContent || '').trim() })"""
POS_JS = """id => { const el = document.getElementById(id), r = el.getBoundingClientRect();
  return { hash: location.hash, top: Math.round(r.top), vh: innerHeight, focused: document.activeElement === el,
           end: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 2 }; }"""


def at_step(pos, hash_):
    """Стъпката е в адреса, на фокус и горе под лентата (scroll-margin-top: 76px) — или страницата е превъртяна докрай."""
    return pos["hash"] == hash_ and pos["focused"] and (abs(pos["top"] - 76) <= 6 or (pos["end"] and 0 <= pos["top"] < pos["vh"]))


async def settle(pg):
    """Изчаква плавното превъртане да спре."""
    await pg.wait_for_timeout(120)
    last = None
    for _ in range(40):
        y = await pg.evaluate("scrollY")
        if y == last:
            return
        last = y
        await pg.wait_for_timeout(80)


async def guide_problems(pg, full):
    """Проверките на пътеводителя; full — и веригата „Следва:“, и превключвателя на източниците (веднъж на контекст)."""
    out = []
    await pg.evaluate("location.hash === '#/patevoditel' ? route(true) : (location.hash = '#/patevoditel')")  # винаги наново нарисуван
    await pg.wait_for_timeout(250)
    g = await pg.evaluate(GUIDE_JS)
    if g["h1"] != "Пътеводител" or g["nav"] != "Пътеводител":
        out.append(f"заглавие {g['h1']!r}, в менюто {g['nav']!r}")
    if g["steps"] != 8 or len(g["btns"]) != 8:
        out.append(f"стъпки: {g['steps']}, бутони „Отвори“: {len(g['btns'])}")
    if g["info"] != [False] * 8:
        out.append(f"бележките на стъпките трябва да са в затворени падащи полета: {g['info']}")
    # v3.5: „Следва:“ на стъпка N отваря екрана на стъпка N+1; на първата — „Откъде идват парите?“ (грешката от v3.4)
    if g["next"] != [f"#/{p}" for p in GUIDE_SEQ[1:]]:
        out.append(f"„Следва:“ води към {g['next']}")
    if g["checks"] != GUIDE_CHECKS or not g["danni"] or not g["sw"]:
        out.append(f"кутията с петте проверки: {g['checks']}, „Откъде са данните?“={g['danni']}, „Покажи източниците“={g['sw']}")
    if g["bad"]:
        out.append(f"връзки към несъществуващ екран: {g['bad']}")
    miss = [p[:70] for p in guide_expected() if p not in g["text"]]
    if miss:
        out.append(f"текстът не е дословен: {miss}")
    for i, (href, screen, text) in enumerate(g["btns"], 1):
        path = href[2:]
        if g["routeQ"].get(path) != screen or not text.startswith(f"Отвори „{screen}“"):
            out.append(f"стъпка {i}: бутон {text!r} към {href}, а екранът в менюто е {g['routeQ'].get(path)!r}")
        await pg.click(f'main a.gbtn[data-gstep="{i}"]')
        await pg.wait_for_timeout(250)
        d = await pg.evaluate(DEST_JS)
        if d["hash"] != href or d["cur"] != screen or (path and d["h1"] != screen):
            out.append(f"стъпка {i}: „Отвори“ → {d}")
        await pg.evaluate("history.back()")
        await pg.wait_for_timeout(300)
        pos = await pg.evaluate(POS_JS, f"pv-{i}")
        if not at_step(pos, f"#/patevoditel/{i}"):
            out.append(f"стъпка {i}: „Назад“ от екрана → {pos}")
    if not full:
        return out
    # „Следва:“ от стъпка i отваря екрана на стъпка i+1 (заглавието и менюто са неговите), а „Назад“ връща на стъпка i+1
    routeq = g["routeQ"]
    for i in range(1, 8):
        await pg.evaluate("location.hash = '#/patevoditel'")
        await pg.wait_for_timeout(250)
        await pg.click(f"#pv-{i} a.gnext")
        await pg.wait_for_timeout(300)
        d = await pg.evaluate(DEST_JS)
        p = GUIDE_SEQ[i]
        if d["hash"] != f"#/{p}" or d["cur"] != routeq[p] or (p and d["h1"] != routeq[p]):
            out.append(f"„Следва:“ от стъпка {i} → {d}")
        await pg.evaluate("history.back()")
        await pg.wait_for_timeout(300)
        pos = await pg.evaluate(POS_JS, f"pv-{i + 1}")
        if not at_step(pos, f"#/patevoditel/{i + 1}"):
            out.append(f"„Следва:“ от стъпка {i}, после „Назад“ → {pos}")
    # падащата бележка на първата стъпка: отваря се и се затваря, и отворена не застъпва бутона „Отвори“
    await pg.evaluate("location.hash = '#/patevoditel'")
    await pg.wait_for_timeout(250)
    for want in (True, False):
        await pg.click("#pv-1 details.info > summary")
        await pg.wait_for_timeout(150)
        st = await pg.evaluate("""() => { const d = document.querySelector('#pv-1 details.info'), b = document.querySelector('#pv-1 a.gbtn').getBoundingClientRect(),
          r = d.getBoundingClientRect(); return { open: d.open, gap: Math.round(b.top - r.bottom) }; }""")
        if st["open"] != want or st["gap"] < 0:
            out.append(f"падащата бележка на стъпка 1: {st} (очаквано отворена={want}, над бутона)")
    # превключвателят в кутията: сменя състоянието навсякъде, показва съобщение; връщаме го както беше
    before = await pg.evaluate("document.body.classList.contains('show-src')")
    await pg.click("#gSrc")
    await pg.wait_for_timeout(150)
    st = await pg.evaluate("""() => ({ on: document.body.classList.contains('show-src'), g: document.getElementById('gSrc').getAttribute('aria-pressed'),
      top: document.getElementById('srcToggle').getAttribute('aria-pressed'), toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText })""")
    if st["on"] == before or st["g"] != str(st["on"]).lower() or st["top"] != st["g"] or not st["toast"]:
        out.append(f"„Покажи източниците“ в пътеводителя: {st}")
    await pg.evaluate(f"setSrc({str(before).lower()})")
    return out


CHECK_JS = """() => {
  const vw = document.documentElement.clientWidth, over = [];
  document.querySelectorAll('main *').forEach(el => {
    if (el.closest('.table-wrap') || el.closest('svg') || el.closest('.src')) return;
    const r = el.getBoundingClientRect();
    if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) over.push((el.id ? '#' + el.id : el.tagName + '.' + el.className) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  return { sw: document.documentElement.scrollWidth, vw, over: over.slice(0, 6), t: document.querySelector('main').innerText,
           svg: [...document.querySelectorAll('main svg text')].map(x => x.textContent).join(' ') };
}"""


# v3.5 — „Следва“: последният елемент на екрана, с връзки към съществуващи екрани.
NEXT_JS = r"""() => {
  const page = document.querySelector('main .page'), last = page && page.lastElementChild;
  const ok = h => { const [p, a] = h.slice(2).split('/'); return ROUTES.some(r => r.path === p) || (p === 'vedomstvo' && ZDB.some(m => String(m.art) === a)); };
  const links = last && last.matches('nav.next') ? [...last.querySelectorAll('a.nextbtn')].map(a => a.getAttribute('href')) : [];
  return { last: last ? last.tagName + '.' + last.className : '', links, bad: links.filter(h => !ok(h)),
           titles: last ? [...last.querySelectorAll('.nx-t')].map(t => t.textContent) : [] };
}"""
# v3.5 — падащите пояснения: състояние и дали обобщението (затворено) или цялото поле (отворено) застъпва бутон или превключвател.
INFO_JS = r"""i => {
  const ds = [...document.querySelectorAll('main details.info')], hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const ctl = [...document.querySelectorAll('main button, main a, main select, main input, main .seg')].filter(c => c.offsetParent);
  const st = d => { const r = (d.open ? d : d.querySelector('summary')).getBoundingClientRect();
    return { open: d.open, label: d.querySelector('summary').textContent.trim(), clash: ctl.filter(c => !d.contains(c) && !c.contains(d) && hit(r, c.getBoundingClientRect())).map(c => c.tagName + ' ' + (c.textContent || '').trim().slice(0, 30)) }; };
  return i == null ? ds.map(st) : st(ds[i]);
}"""
SEARCH_JS = r"""() => {
  const sp = s => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim(), res = document.getElementById('qsRes');
  const ok = h => { const [p, a] = h.slice(2).split('/'); return ROUTES.some(r => r.path === p) || (p === 'vedomstvo' && ZDB.some(m => String(m.art) === a)); };
  const hits = [...res.querySelectorAll('a.qs-hit')].map(a => ({ href: a.getAttribute('href'), kind: sp(a.querySelector('.qs-k').textContent),
    name: sp(a.querySelector('.qs-n').textContent).replace(sp(a.querySelector('.qs-k').textContent), '').trim(),
    val: sp(a.querySelector('.qs-v').textContent), per: sp(a.querySelector('.qs-p').textContent), go: sp(a.querySelector('.qs-go').textContent) }));
  return { open: !res.hidden, expanded: document.getElementById('qsIn').getAttribute('aria-expanded'), stat: sp((res.querySelector('.qs-stat') || {}).textContent || ''),
           hits, bad: hits.filter(h => !ok(h.href) || !h.name || !h.val || !h.per).map(h => h.href + ' ' + h.name) };
}"""
LAND_JS = """() => { const t = document.querySelector('main .hl'), r = t && t.getBoundingClientRect();
  return { hash: location.hash, h1: (document.querySelector('main h1') || {}).textContent, cur: ((document.querySelector('#nav a[aria-current="page"]') || {}).textContent || '').trim(),
           hl: t ? (t.id || t.tagName) : null, inView: !!r && r.bottom > 0 && r.top < innerHeight, mun: ((document.getElementById('munOut') || {}).innerText || '').slice(0, 80) }; }"""


async def info_problems(pg):
    """Падащите пояснения на текущия екран: затворени, отварят се и се затварят, без да застъпват бутоните."""
    out = []
    infos = await pg.evaluate(INFO_JS, None)
    for i, st in enumerate(infos):
        if st["open"] or st["clash"]:
            out.append(f"„{st['label']}“ (затворено): отворено={st['open']}, застъпва {st['clash']}")
        for want in (True, False):
            await pg.locator("main details.info > summary").nth(i).click()
            await pg.wait_for_timeout(60)
            s = await pg.evaluate(INFO_JS, i)
            if s["open"] != want or s["clash"]:
                out.append(f"„{st['label']}“ след клик: отворено={s['open']} (очаквано {want}), застъпва {s['clash']}")
    return out, len(infos)


async def search_problems(pg, w, scheme, shots):
    """Търсенето на началната страница: очакваните първи резултати, връзките, клавиатурата и ширината при 400 px."""
    out = []
    home = "location.hash = '#/'"
    await pg.evaluate(home)
    await pg.wait_for_timeout(300)
    for q, first, screen in SEARCH_WANT:
        await pg.fill("#qsIn", q)
        await pg.wait_for_timeout(120)
        s = await pg.evaluate(SEARCH_JS)
        if not s["open"] or s["expanded"] != "true" or not s["hits"] or s["bad"] or s["hits"][0]["name"] != first:
            out.append(f"търсене „{q}“: {s['stat']!r}, първи {s['hits'][:1]}, лоши {s['bad'][:3]}")
            continue
        if q == "ДДС":
            r = await pg.evaluate(CHECK_JS)
            if r["sw"] > r["vw"] or r["over"] or any(x in r["t"] for x in BAD):
                out.append(f"отворените резултати: scrollW={r['sw']} vw={r['vw']} over={r['over']}")
            if shots:
                await pg.screenshot(path=f"{SHOTS}/home-search_{w}_{scheme}.png")
        h = s["hits"][0]["href"]
        await pg.click("#qsRes a.qs-hit")
        await pg.wait_for_timeout(450)
        d = await pg.evaluate(LAND_JS)
        p = h[2:].split("/")
        deep = len(p) > (2 if p[0] == "vedomstvo" else 1)
        if d["hash"] != h or not h.startswith(f"#/{screen}") or not d["h1"] or (deep and not (d["hl"] and d["inView"])) or (screen == "obshtini" and first not in d["mun"]):
            out.append(f"търсене „{q}“ → {h}: {d}")
        await pg.evaluate(home)
        await pg.wait_for_timeout(300)
    # клавиатура: стрелки между резултатите, Escape затваря и чисти, Enter отваря първия, „/“ отива в търсенето
    await pg.fill("#qsIn", "")
    await pg.focus("#qsIn")
    await pg.keyboard.type("ДДС")
    await pg.wait_for_timeout(100)
    seq = []
    for key in ("ArrowDown", "ArrowDown", "ArrowUp", "ArrowUp"):
        await pg.keyboard.press(key)
        seq.append(await pg.evaluate("(document.activeElement.id || document.activeElement.className) + ':' + [...document.querySelectorAll('#qsRes a.qs-hit')].indexOf(document.activeElement)"))
    await pg.keyboard.press("Escape")
    closed = await pg.evaluate("document.getElementById('qsRes').hidden")
    await pg.keyboard.press("Escape")
    cleared = await pg.evaluate("document.getElementById('qsIn').value === ''")
    if seq != ["qs-hit:0", "qs-hit:1", "qs-hit:0", "qsIn:-1"] or not closed or not cleared:
        out.append(f"клавиатура: {seq}, затворено={closed}, изчистено={cleared}")
    await pg.keyboard.type("Пловдив")
    await pg.wait_for_timeout(100)
    await pg.keyboard.press("Enter")
    await pg.wait_for_timeout(450)
    d = await pg.evaluate(LAND_JS)
    if d["h1"] != "Моята община" or "Пловдив" not in d["mun"]:
        out.append(f"Enter в търсенето → {d}")
    await pg.evaluate(home)
    await pg.wait_for_timeout(300)
    await pg.evaluate("document.activeElement && document.activeElement.blur()")
    await pg.keyboard.press("/")
    if await pg.evaluate("document.activeElement.id") != "qsIn":
        out.append("„/“ не отива в търсенето")
    await pg.fill("#qsIn", "")
    await pg.keyboard.press("Escape")
    return out


async def bug_problems(pg):
    """„Откъде идват парите?“ (бележка от прегледа, 01.10.2026): никоя връзка с „откъде идват“ не води другаде освен към #/prihodi."""
    out = []
    await pg.evaluate("location.hash = '#/'")
    await pg.wait_for_timeout(300)
    links = await pg.evaluate("""() => [...document.querySelectorAll('a')].filter(a => /откъде идват/i.test(a.textContent)).map(a => [a.getAttribute('href'), a.textContent.trim().slice(0, 50)])""")
    tile = await pg.evaluate("""() => { const a = [...document.querySelectorAll('.ktile a.kt-a')].find(a => a.textContent.startsWith('Приходи')); return a && a.getAttribute('href'); }""")
    if not any("откъде идват парите" in t for _, t in links) or tile != "#/prihodi":
        out.append(f"началната страница: подзаглавието/плочката „Приходи“ не водят към приходите: {links}, плочка {tile}")
    for path in ["", "patevoditel", "karta", "danni"]:
        await pg.evaluate(f"location.hash = '#/{path}'")
        await pg.wait_for_timeout(250)
        bad = await pg.evaluate("""() => [...document.querySelectorAll('a')].filter(a => /откъде идват/i.test(a.textContent) && !/^#\\/prihodi(\\/|$)/.test(a.getAttribute('href'))).map(a => [a.getAttribute('href'), a.textContent.trim().slice(0, 50)])""")
        if bad:
            out.append(f"#/{path}: „откъде идват“ води другаде: {bad}")
    await pg.evaluate("location.hash = '#/'")
    await pg.wait_for_timeout(250)
    await pg.click(".ktile a.kt-a[href='#/prihodi']")
    await pg.wait_for_timeout(300)
    d = await pg.evaluate(DEST_JS)
    if d["hash"] != "#/prihodi" or d["h1"] != "Откъде идват парите?":
        out.append(f"плочката „Приходи“ → {d}")
    for h in HASH_VARIANTS:
        await pg.evaluate(f"location.hash = {h!r}")
        await pg.wait_for_timeout(250)
        d = await pg.evaluate(DEST_JS)
        if d["h1"] != "Откъде идват парите?":
            out.append(f"адрес {h} → {d}")
    await pg.evaluate("location.hash = '#/nyama-takava'")
    await pg.wait_for_timeout(250)
    t = await pg.evaluate("document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText")
    if "Няма страница" not in t:
        out.append(f"непознат адрес: няма съобщение ({t!r})")
    return out


# v3.6 — речникът. Очакванията идват от src/glossary.json (извлечен от PDF-а с extract_glossary.py).
GLOSSARY_JSON = f"{ROOT}/prototype/src/glossary.json"
# Търсачката на речника: [заявка, slug на първия термин]; „заплата преди удръжки“ е примерът от с. 2 на PDF-а.
GL_SEARCH_WANT = [("заплата преди удръжки", "brutna-zaplata"), ("КФП", "kfp"), ("осигуровки", "osiguritelni-vnoski"), ("ДДС", "dds"),
                  ("дълг", "darzhaven-dalg"), ("ново заемане", "nov-dalg-novo-zaemane"), ("inflatsiya", "inflatsiya")]
GL_TYPO = ("дефецит", "byudzheten-defitsit")  # няма резултат → близкият термин
# Търсенето на началната страница: [заявка, href на първия резултат]; при „дефицит“ първа остава плочката, а терминът е в първите 8.
GL_HOME_WANT = [("КФП", "#/rechnik/kfp"), ("инфлация", "#/rechnik/inflatsiya"), ("заплата преди удръжки", "#/rechnik/brutna-zaplata")]
GL_HOME_AMONG = ("дефицит", "#/dalg/dl-saldo", "#/rechnik/byudzheten-defitsit")
# Екраните, на които трябва да има поне една дума от речника в текста (на „Карта на прототипа“ и в самия речник — нито една).
GL_LINKED = ["patevoditel", "prihodi", "razhodi", "izpalnenie", "merki", "dalg", "danaci", "danni"]
GL_PAGE_JS = r"""() => {
  const sp = s => s.replace(/[\u00a0\u202f]]/g, ' ').replace(/\s+/g, ' ').trim(), q = (el, s) => el.querySelector(s);
  return { h1: sp(document.querySelector('main h1').textContent), stat: sp(document.getElementById('glStat').textContent),
    terms: [...document.querySelectorAll('main .gl-term')].map(a => ({ id: a.id, t: sp(q(a, '.gl-t').textContent), d: sp(q(a, '.gl-d').textContent),
      ex: sp(q(a, '.gl-ex').textContent), open: q(a, 'details.gl-more').open })),
    secs: [...document.querySelectorAll('main .gl-sec')].map(s => [sp(q(s, 'h2').textContent), sp((q(s, '.gl-range') || {}).textContent || '')]),
    rel: [...document.querySelectorAll('main .gl-rels li')].map(li => [sp(q(li, '.gl-rel-h').textContent), sp(q(li, '.gl-rel-note').textContent),
      [...li.querySelectorAll('a')].map(a => a.getAttribute('href'))]),
    src: [...document.querySelectorAll('main .gl-srcs a')].map(a => a.getAttribute('href')),
    nav: [...document.querySelectorAll('#nav a')].slice(0, 2).map(a => [a.getAttribute('href'), sp(a.textContent), a.getAttribute('aria-current')]),
    group: sp((document.querySelector('#nav .group') || {}).textContent || ''),
    tab: sp((document.querySelector('#tabbar a[aria-current="page"]') || {}).textContent || ''),
    see: Object.entries(GL_SEE).map(([s, to]) => [s, '#/' + to]) };
}"""
GL_LIST_JS = """() => ({ ids: [...document.querySelectorAll('main .gl-term')].map(a => a.id), stat: document.getElementById('glStat').textContent,
  sugg: [...document.querySelectorAll('main .gl-sugg a')].map(a => a.getAttribute('href')), q: document.getElementById('glQ').value,
  pressed: [...document.querySelectorAll('main [aria-pressed="true"]')].map(b => b.dataset.glcat ?? b.dataset.gll ?? b.id),
  open: [...document.querySelectorAll('main details.gl-more')].filter(d => d.open).length })"""
GL_LAND_JS = """() => { const t = document.querySelector('main .hl'), r = t && t.getBoundingClientRect(), d = t && t.querySelector('details.gl-more');
  return { hash: location.hash, h1: (document.querySelector('main h1') || {}).textContent, hl: t ? t.id : null, inView: !!r && r.top >= 0 && r.top < innerHeight - 40,
           open: d ? d.open : null, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').innerText }; }"""
# Думите от речника на текущия екран: всяка води към съществуващ термин, по веднъж, най-много 3 в абзац и не на забранено място.
GL_LINKS_JS = r"""() => {
  const forbid = 'a, button, summary, label, h1, h2, h3, h4, table, svg, .kstrip, .kpi, .chart, .src, .next, .rank, .receipt, .legend, .lg, .psub, .seg, .share-row, .mapcard, .sentence, [role="search"]';
  const links = [...document.querySelectorAll('main a.gl-link')], slugs = new Set(GLOSSARY.terms.map(t => t.slug)), seen = new Set(), per = new Map(), bad = [];
  for (const a of links) {
    const m = /^#\/rechnik\/([a-z0-9-]+)$/.exec(a.getAttribute('href') || ''), s = m && m[1];
    if (!s || !slugs.has(s) || s !== a.dataset.gl) bad.push('връзка ' + a.getAttribute('href'));
    if (seen.has(s)) bad.push('втора връзка към ' + s);
    seen.add(s);
    if (a.parentElement.closest(forbid) || a.children.length) bad.push('на забранено място: ' + a.textContent);
    if (/\d/.test(a.textContent)) bad.push('с число: ' + a.textContent);
    const box = a.closest('p, li, .wh');
    if (!box) bad.push('извън абзац: ' + a.textContent);
    per.set(box, (per.get(box) || 0) + 1);
  }
  for (const [box, n] of per) if (n > 3) bad.push(n + ' връзки в един абзац');
  return { n: links.length, words: links.map(a => a.dataset.gl + '=' + a.textContent), bad };
}"""
GL_POP_JS = """() => { const p = document.getElementById('glPop'); if (!p || p.hidden) return null;
  const r = p.getBoundingClientRect(), tb = document.getElementById('tabbar');
  return { t: p.querySelector('.glpop-t').textContent, d: p.querySelector('#glPopD').textContent, go: p.querySelector('.glpop-go').getAttribute('href'),
           l: r.left, r: r.right, top: r.top, b: r.bottom, vw: document.documentElement.clientWidth, vh: innerHeight, hash: location.hash,
           floor: tb && tb.offsetParent ? tb.getBoundingClientRect().top : innerHeight, focus: p.contains(document.activeElement) }; }"""


def gl_title(t):
    return f"{t['name']} – {t['abbr']}" if t["abbr"] else t["title"]


async def gl_go(pg, h, wait=250):
    """Отваря адреса h наново (през #/karta, ако вече сме там, за да има hashchange)."""
    if await pg.evaluate("location.hash") == h:
        await pg.evaluate("location.hash = '#/karta'")
        await pg.wait_for_timeout(120)
    await pg.evaluate(f"location.hash = {h!r}")
    await pg.wait_for_timeout(wait)


async def glossary_problems(pg, w, scheme, shots):
    """Речникът: съдържанието спрямо glossary.json, менюто, филтрите, адресите на термините, „Виж в бюджета“, думите от
    речника в текста на екраните, пояснението на място и търсенето на началната страница. Връща (проблеми, бройки)."""
    out, stats = [], {}
    G = json.load(open(GLOSSARY_JSON, encoding="utf-8"))
    T = G["terms"]
    await gl_go(pg, "#/rechnik")
    await pg.evaluate("document.getElementById('toast').hidden = true")  # съобщение от предишна проверка (непознат адрес)
    g = await pg.evaluate(GL_PAGE_JS)
    # съдържанието — дословно като в PDF-а (през glossary.json)
    if g["h1"] != "Речник" or g["stat"] != G["subtitle"]:
        out.append(f"заглавие {g['h1']!r}, ред със статуса {g['stat']!r}")
    if len(g["terms"]) != 64 or len(T) != 64:
        out.append(f"термини на екрана: {len(g['terms'])} (в glossary.json: {len(T)})")
    by_id = {x["id"]: x for x in g["terms"]}
    for t in T:
        x = by_id.get(f"gl-{t['slug']}")
        if not x:
            out.append(f"липсва термин №{t['n']} {t['title']}")
            continue
        if x["t"] != f"{t['n']}. {gl_title(t)}" or x["d"] != t["def"] or x["ex"] != f"Пример: {t['example']}":
            out.append(f"термин №{t['n']} не е дословен: {x['t']!r} / {x['d'][:40]!r} / {x['ex'][:40]!r}")
    if [x["id"] for x in g["terms"]] != [f"gl-{t['slug']}" for t in T]:
        out.append("термините не са в реда на PDF-а")
    want_secs = [[c["title"], f"термини {c['from']}–{c['to']}"] for c in G["categories"]]
    if g["secs"] != want_secs:
        out.append(f"разделите: {g['secs']}")
    slug_of = {t["n"]: t["slug"] for t in T}
    want_rel = [[r["text"], r["note"], [f"#/rechnik/{slug_of[n]}" for n in r["terms"]]] for r in G["related"]["items"]]
    if g["rel"] != want_rel:
        out.append(f"„Свързани понятия“: {g['rel'][:2]}…")
    if g["src"] != [s["url"] for s in G["sources"]["items"]]:
        out.append(f"източниците: {g['src']}")
    # място: вляво под „Пътеводител“ (група „Започни оттук“); на телефон долното меню показва „Още“
    if g["nav"] != [["#/patevoditel", "Пътеводител", None], ["#/rechnik", "Речник", "page"]] or g["group"] != "Започни оттук" or g["tab"] != "Още":
        out.append(f"менюто: {g['nav']}, група {g['group']!r}, долно меню {g['tab']!r}")
    if shots:
        await pg.screenshot(path=f"{SHOTS}/rechnik-top_{w}_{scheme}.png")
    # категории (с броя от раздела), „Всички“, буквите и търсачката
    for c in G["categories"]:
        await pg.click(f"main [data-glcat='{c['id']}']")
        await pg.wait_for_timeout(80)
        s = await pg.evaluate(GL_LIST_JS)
        want = [f"gl-{t['slug']}" for t in T if t["cat"] == c["id"]]
        if s["ids"] != want or s["pressed"] != [c["id"]]:
            out.append(f"категория „{c['short']}“: {len(s['ids'])} термина вместо {len(want)}, натиснати {s['pressed']}")
    await pg.click("main [data-glcat='']")
    await pg.wait_for_timeout(80)
    if len((await pg.evaluate(GL_LIST_JS))["ids"]) != 64:
        out.append("„Всички“ не показва 64 термина")
    letters = sorted({t["name"][0].upper() for t in T})
    for L in letters:
        await pg.click(f"main [data-gll='{L}']")
        await pg.wait_for_timeout(60)
        s = await pg.evaluate(GL_LIST_JS)
        want = {f"gl-{t['slug']}" for t in T if t["name"][0].upper() == L}
        if set(s["ids"]) != want or len(s["ids"]) != len(want) or s["pressed"] != [L]:
            out.append(f"буква „{L}“: {len(s['ids'])} термина вместо {len(want)}")
    await pg.click(f"main [data-gll='{letters[0]}']")  # повторно — връща всички
    await pg.click(f"main [data-gll='{letters[0]}']")
    await pg.wait_for_timeout(60)
    if len((await pg.evaluate(GL_LIST_JS))["ids"]) != 64:
        out.append("повторното натискане на буквата не връща всички термини")
    for q, slug in GL_SEARCH_WANT:
        await pg.fill("#glQ", q)
        await pg.wait_for_timeout(80)
        s = await pg.evaluate(GL_LIST_JS)
        if not s["ids"] or s["ids"][0] != f"gl-{slug}":
            out.append(f"търсачка „{q}“: първи {s['ids'][:2]} вместо gl-{slug} ({s['stat']!r})")
    await pg.fill("#glQ", GL_TYPO[0])
    await pg.wait_for_timeout(80)
    s = await pg.evaluate(GL_LIST_JS)
    if s["ids"] or f"#/rechnik/{GL_TYPO[1]}" not in s["sugg"]:
        out.append(f"„{GL_TYPO[0]}“: термини {s['ids'][:2]}, близки {s['sugg']}")
    await pg.press("#glQ", "Escape")
    await pg.wait_for_timeout(80)
    s = await pg.evaluate(GL_LIST_JS)
    if s["q"] or len(s["ids"]) != 64:
        out.append(f"Escape в търсачката: {s['q']!r}, {len(s['ids'])} термина")
    # „Разгъни всички“: всички карти отворени, страницата не се разширява; после обратно
    await pg.click("#glAllBtn")
    await pg.wait_for_timeout(120)
    r = await pg.evaluate(CHECK_JS)
    if (await pg.evaluate(GL_LIST_JS))["open"] != 64 or r["sw"] > r["vw"] or r["over"] or any(x in r["t"] for x in BAD):
        out.append(f"„Разгъни всички“: scrollW={r['sw']} vw={r['vw']} over={r['over']}")
    await pg.click("#glAllBtn")
    await pg.wait_for_timeout(80)
    if (await pg.evaluate(GL_LIST_JS))["open"]:
        out.append("„Свий всички“ оставя отворени карти")
    # всеки термин има свой адрес: превърта до него, разгъва го и го подчертава
    for t in T:
        await pg.evaluate(f"location.hash = '#/rechnik/{t['slug']}'")
        await settle(pg)  # в рамките на речника превъртането е плавно
        d = await pg.evaluate(GL_LAND_JS)
        if d["hl"] != f"gl-{t['slug']}" or not d["inView"] or not d["open"]:
            out.append(f"#/rechnik/{t['slug']} → {d}")
    if shots:
        await gl_go(pg, "#/rechnik/kfp", 600)
        await pg.screenshot(path=f"{SHOTS}/rechnik-kfp_{w}_{scheme}.png")
    await gl_go(pg, "#/rechnik/nyama-takav")
    d = await pg.evaluate(GL_LAND_JS)
    if "Няма термин" not in d["toast"] or d["h1"] != "Речник":
        out.append(f"непознат термин: {d}")
    # „Виж в бюджета“: всеки води до съществуващ екран, а с ред — до подчертания ред
    routes = set(await pg.evaluate("ROUTES.map(r => r.path)"))
    for href in sorted({h for _, h in g["see"]}):
        p = href[2:].split("/")
        if p[0] not in routes:
            out.append(f"„Виж в бюджета“ към несъществуващ екран: {href}")
            continue
        await gl_go(pg, href, 250)
        await settle(pg)
        d = await pg.evaluate(GL_LAND_JS)
        if d["hash"] != href or not d["h1"] or (len(p) > 1 and not (d["hl"] and d["inView"])):
            out.append(f"„Виж в бюджета“ {href} → {d}")
    stats["виж"] = len(g["see"])
    # думите от речника в текста на екраните
    linked = {}
    for path in sorted(routes) + ["vedomstvo/11"]:
        await gl_go(pg, f"#/{path}")
        L = await pg.evaluate(GL_LINKS_JS)
        linked[path or "начало"] = L["n"]
        if L["bad"]:
            out.append(f"#/{path}: думи от речника: {L['bad'][:4]}")
        if (path in GL_LINKED and not L["n"]) or (path in ("rechnik", "karta") and L["n"]):
            out.append(f"#/{path}: {L['n']} думи от речника ({L['words'][:5]})")
    stats["думи"] = sum(linked.values())
    stats["по екрани"] = {k: v for k, v in linked.items() if v}
    # пояснение на място: клик върху първата дума в пътеводителя — без смяна на адреса, в рамките на екрана, над долното меню
    await gl_go(pg, "#/patevoditel", 300)
    slug = await pg.evaluate("document.querySelector('main a.gl-link').dataset.gl")
    t = next(x for x in T if x["slug"] == slug)
    link = pg.locator("main a.gl-link").first
    await link.scroll_into_view_if_needed()
    await link.click()
    await pg.wait_for_timeout(150)
    p = await pg.evaluate(GL_POP_JS)
    if (not p or p["t"] != gl_title(t) or p["d"] != t["def"] or p["go"] != f"#/rechnik/{slug}" or p["hash"] != "#/patevoditel" or not p["focus"]
            or p["l"] < 0 or p["r"] > p["vw"] + 0.5 or p["top"] < 0 or p["b"] > min(p["vh"], p["floor"]) + 0.5):
        out.append(f"пояснението на място за „{slug}“: {p}")
    if shots:
        await pg.screenshot(path=f"{SHOTS}/rechnik-pop_{w}_{scheme}.png")
    await pg.keyboard.press("Escape")
    await pg.wait_for_timeout(80)
    st = await pg.evaluate("[!!document.getElementById('glPop') && document.getElementById('glPop').hidden, !!(document.activeElement && document.activeElement.matches('a.gl-link'))]")
    if st != [True, True]:
        out.append(f"Escape в пояснението: скрито={st[0]}, фокусът на думата={st[1]}")
    # клавиатура: Tab минава през „Затвори“ и връзката към речника, а след нея пояснението се затваря и фокусът е пак на думата
    await link.click()
    await pg.wait_for_timeout(120)
    for _ in range(3):
        await pg.keyboard.press("Tab")
    st = await pg.evaluate("[!!document.getElementById('glPop') && document.getElementById('glPop').hidden, !!(document.activeElement && document.activeElement.matches('a.gl-link'))]")
    if st != [True, True]:
        out.append(f"Tab в пояснението: скрито={st[0]}, фокусът на думата={st[1]}")
    await link.click()
    await pg.wait_for_timeout(150)
    await pg.click("#glPop .glpop-go")
    await pg.wait_for_timeout(250)
    await settle(pg)
    d = await pg.evaluate(GL_LAND_JS)
    if d["hash"] != f"#/rechnik/{slug}" or d["hl"] != f"gl-{slug}" or not d["inView"] or await pg.evaluate("!document.getElementById('glPop').hidden"):
        out.append(f"„Пример и свързани понятия в речника“ → {d}")
    # търсенето на началната страница намира термините
    for q, href in GL_HOME_WANT:
        await gl_go(pg, "#/", 300)
        await pg.fill("#qsIn", q)
        await pg.wait_for_timeout(120)
        s = await pg.evaluate(SEARCH_JS)
        if not s["hits"] or s["hits"][0]["href"] != href or s["hits"][0]["kind"] != "Речник" or s["bad"]:
            out.append(f"търсене на началната страница „{q}“: първи {s['hits'][:1]}, лоши {s['bad'][:2]}")
            continue
        await pg.click("#qsRes a.qs-hit")
        await pg.wait_for_timeout(250)
        await settle(pg)
        d = await pg.evaluate(GL_LAND_JS)
        if d["hash"] != href or d["hl"] != "gl-" + href.split("/")[-1] or not d["inView"]:
            out.append(f"търсене на началната страница „{q}“ → {d}")
    q, first, among = GL_HOME_AMONG
    await gl_go(pg, "#/", 300)
    await pg.fill("#qsIn", q)
    await pg.wait_for_timeout(120)
    s = await pg.evaluate(SEARCH_JS)
    if not s["hits"] or s["hits"][0]["href"] != first or among not in [h["href"] for h in s["hits"][:8]]:
        out.append(f"търсене на началната страница „{q}“: {[h['href'] for h in s['hits'][:8]]}")
    await pg.fill("#qsIn", "")
    await pg.keyboard.press("Escape")
    # на телефон „Още“ е картата на прототипа: там има карта към речника
    await gl_go(pg, "#/karta")
    if not await pg.evaluate("!!document.querySelector('main a.mapcard[href=\"#/rechnik\"]')"):
        out.append("„Карта на прототипа“ („Още“) няма връзка към речника")
    return out, stats


def serve():
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    h.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def run(shots, live=None):
    srv = serve()
    url = live or f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    os.makedirs(SHOTS, exist_ok=True)
    failed = False
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for w in (1280, 400):
            for scheme in ("light", "dark"):
                ctx = await b.new_context(viewport={"width": w, "height": 900}, color_scheme=scheme, device_scale_factor=1)
                await ctx.add_init_script("try { localStorage.setItem('bns-src', '1'); } catch (e) {}")
                pg = await ctx.new_page()
                errs = []
                pg.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type in ("error",) else None)
                pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
                await pg.goto(url, wait_until="networkidle")
                await pg.evaluate("document.fonts.ready")
                paths = await pg.evaluate("ROUTES.map(r => r.path)") + EXTRA
                probs = []
                info_total = 0
                # първо посещение: типът още не е избран — заглавие, лента и „Кой си ти?“
                r = await pg.evaluate(CHECK_JS)
                bad = [x for x in BAD if x in r["t"] or x in r["svg"]]
                sp = strip_problems(await pg.evaluate(STRIP_JS), None)
                if bad or sp or r["sw"] > r["vw"] or r["over"]:
                    probs.append({"user": "(не е избран)", "path": "", "bad": bad, "strip": sp, "scrollW": r["sw"], "vw": r["vw"], "over": r["over"]})
                if shots:  # лентата без източниците (така я вижда повечето хора) и без долното меню, което е fixed и я застъпва
                    await pg.evaluate("setSrc(false); document.getElementById('tabbar').style.visibility = 'hidden'")
                    await pg.locator("section.kstrip").screenshot(path=f"{SHOTS}/home-strip_{w}_{scheme}.png")
                    await pg.evaluate("setSrc(true); document.getElementById('tabbar').style.visibility = ''")
                for user in ("citizen", "journalist", "expert"):
                    await pg.evaluate(f"setUserType('{user}')")
                    for path in (paths if user == "citizen" else ["", "razhodi", "merki", "patevoditel"]):
                        await pg.evaluate(f"location.hash = '#/{path}'")
                        await pg.wait_for_timeout(250)
                        r = await pg.evaluate(CHECK_JS)
                        bad = [x for x in BAD if x in r["t"] or x in r["svg"]]
                        sp = strip_problems(await pg.evaluate(STRIP_JS), user) if path == "" else []
                        if bad or sp or r["sw"] > r["vw"] or r["over"]:
                            probs.append({"user": user, "path": path, "bad": bad, "strip": sp, "scrollW": r["sw"], "vw": r["vw"], "over": r["over"]})
                        if shots and user == "citizen" and path in SHOT_PAGES and (w == 400 or scheme == "light"):
                            await pg.screenshot(path=f"{SHOTS}/{path.replace('/', '-') or 'home'}_{w}_{scheme}.png", full_page=True)
                        # v3.5: „Следва“ е последното на екрана и води до съществуващ екран (по реда на пътеводителя, където има ред)
                        n = await pg.evaluate(NEXT_JS)
                        want = NEXT_WANT.get(path.split("/")[0])
                        if not n["last"].startswith("NAV.next") or not n["links"] or n["bad"] or (want and n["links"] != want):
                            probs.append({"user": user, "path": path, "next": n})
                        # v3.5: падащите пояснения (всеки тип има свои: напр. „Как са сметнати“ при журналиста, таблицата при експерта);
                        # после ширината с всички отворени
                        ip, cnt = await info_problems(pg)
                        info_total += cnt
                        if ip:
                            probs.append({"user": user, "path": path, "info": ip})
                        if cnt:
                            await pg.evaluate("document.querySelectorAll('main details.info').forEach(d => { d.open = true; })")
                            r = await pg.evaluate(CHECK_JS)
                            if r["sw"] > r["vw"] or r["over"] or any(x in r["t"] for x in BAD):
                                probs.append({"user": user, "path": path, "info-open": {"scrollW": r["sw"], "vw": r["vw"], "over": r["over"]}})
                            await pg.evaluate("document.querySelectorAll('main details.info').forEach(d => { d.open = false; })")
                    gp = await guide_problems(pg, user == "citizen")
                    if gp:
                        probs.append({"user": user, "path": "patevoditel", "guide": gp})
                # v3.5: първият бутон „Следва“ на всеки екран отваря екрана, който обещава (заглавието и менюто му)
                await pg.evaluate("setUserType('citizen')")
                routeq = await pg.evaluate("Object.fromEntries(ROUTES.map(r => [r.path, r.q]))")
                for path in GUIDE_SEQ + ["patevoditel", "rechnik", "obshtini", "plashtania", "danni", "karta", "vedomstvo/11"]:
                    await pg.evaluate(f"location.hash = '#/{path}'")
                    await pg.wait_for_timeout(250)
                    href = await pg.evaluate("document.querySelector('main nav.next a.nextbtn').getAttribute('href')")
                    await pg.click("main nav.next a.nextbtn")
                    await pg.wait_for_timeout(300)
                    d = await pg.evaluate(DEST_JS)
                    p = href[2:]
                    if d["hash"] != href or not d["cur"].startswith(routeq[p]) or d["h1"] != (routeq[p] if p else "Бюджет на светло"):
                        probs.append({"path": path, "next-click": href, "dest": d})
                if shots:
                    await pg.evaluate("location.hash = '#/danaci'")
                    await pg.wait_for_timeout(300)
                    await pg.evaluate("document.getElementById('tabbar').style.visibility = 'hidden'")
                    await pg.locator("main nav.next").screenshot(path=f"{SHOTS}/next-danaci_{w}_{scheme}.png")
                    await pg.evaluate("location.hash = '#/patevoditel'")
                    await pg.wait_for_timeout(300)
                    await pg.click("#pv-1 details.info > summary")
                    await pg.locator("#pv-1").screenshot(path=f"{SHOTS}/guide-info_{w}_{scheme}.png")
                    await pg.evaluate("document.getElementById('tabbar').style.visibility = ''")
                # v3.5: търсенето и грешката „Откъде идват парите?“
                sp_ = await search_problems(pg, w, scheme, shots)
                if sp_:
                    probs.append({"path": "search", "problems": sp_})
                bp = await bug_problems(pg)
                if bp:
                    probs.append({"path": "prihodi-bug", "problems": bp})
                # v3.6: речникът
                gp_, gst = await glossary_problems(pg, w, scheme, shots)
                if gp_:
                    probs.append({"path": "rechnik", "problems": gp_})
                # началната страница: „Изпълнение към 31 юли“ в млрд. € (превключвателят „% от плана | млрд. €“)
                await pg.evaluate("setUserType('citizen'); location.hash = '#/'")
                await pg.wait_for_timeout(300)
                await pg.click('[data-hexu="eur"]')
                await pg.wait_for_timeout(250)
                r = await pg.evaluate(CHECK_JS)
                txt = r["t"].replace(" ", " ")
                if "28,55 млрд. €" not in txt or "26,35 млрд. €" not in txt or r["sw"] > r["vw"] or r["over"] or any(x in txt for x in BAD):
                    probs.append({"path": "home/eur", "scrollW": r["sw"], "vw": r["vw"], "over": r["over"]})
                if shots:
                    el = pg.locator("section.panel:has(.prog)")
                    await el.screenshot(path=f"{SHOTS}/home-exec-eur_{w}_{scheme}.png")
                await pg.click('[data-hexu="pct"]')
                await pg.wait_for_timeout(200)
                if "53,1%" not in (await pg.evaluate("document.querySelector('.prog').innerText")):
                    probs.append({"path": "home/pct", "msg": "няма 53,1% след връщане към % от плана"})
                # „Моята община“: търсене
                await pg.evaluate("setUserType('citizen'); location.hash = '#/obshtini'")
                await pg.wait_for_timeout(300)
                await pg.fill("#munQ", "Ловеч")
                one = await pg.inner_text("#munOut")
                await pg.fill("#munQ", "ба")
                many = await pg.inner_text("#munOut")
                await pg.click("#munOut [data-mun]")
                picked = await pg.inner_text("#munOut")
                if shots and w == 400:
                    await pg.screenshot(path=f"{SHOTS}/obshtini-search_{w}_{scheme}.png", full_page=True)
                if "Ловеч" not in one or "млн. €" not in one or "общини:" not in many or "трансфери от централния бюджет" not in picked:
                    probs.append({"path": "obshtini/search", "one": one[:120], "many": many[:120], "picked": picked[:120]})
                # калкулаторът: 1 500 € бруто → 2 480 € лични осигуровки, 1 552 € данък, 3 406 € от работодателя (за година)
                await pg.evaluate("location.hash = '#/danaci'")
                await pg.wait_for_timeout(300)
                rec = await pg.inner_text("#receipt")
                flat = rec.replace(" ", "").replace("\u00a0", "").replace("\u202f", "")
                for want in ("2480€", "1552€", "3406€", "13,78%", "18,92%"):  # bg-BG не групира четирицифрените числа
                    if want not in flat:
                        probs.append({"path": "danaci", "missing": want})
                idx = await pg.evaluate("qsIndex().length")
                print(f"{w:>4} {scheme:5}: екрани={len(paths)} пояснения={info_total} индекс={idx} речник={gst} грешки={errs or 'няма'} проблеми={probs or 'няма'}")
                failed |= bool(errs or probs)
                await ctx.close()
        await b.close()
    srv.shutdown()
    return failed


if __name__ == "__main__":
    live = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else None
    sys.exit(1 if asyncio.run(run("--shots" in sys.argv, live)) else 0)
