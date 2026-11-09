"""Verify the S24 („Откъде са данните?“) and S27 („Обратна връзка“) React screens on the actual built Worker: they adopt the server's
DOM, and their controls behave as the legacy screens did (apps/web/client/pages/s24-danni.js, s27-vrazka.js).

    python -m tests.e2e.reference_adoption --url http://127.0.0.1:8895

Prints the results as JSON; exits 1 when a check fails.
"""
import argparse
import json
import sys
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright

ADOPT = [
    '/danni',
    '/danni?status=pending',
    '/danni/execution',
    '/danni/ministries-programs',
    '/danni/p01',
    '/vrazka',
    '/vrazka?tab=ideya',
    '/vrazka?type=error&from=prihodi&val=12&src=kfp&block=s06-total',
]
READY = 'article[data-ready="1"]'


def query(page):
    return {k: v[0] for k, v in parse_qs(urlsplit(page.url).query).items()}


def visible_rows(page):
    return page.evaluate("[...document.querySelectorAll('li.s24-row')].filter(li => !li.hidden).map(li => li.dataset.slug)")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--url', required=True)
    base = ap.parse_args().url.rstrip('/')
    checks = []

    def check(title, ok, **detail):
        checks.append({'check': title, 'ok': bool(ok), **detail})

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path in ADOPT:
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.add_init_script(
                "window.firstArticle=null;new MutationObserver(()=>{window.firstArticle ||= document.querySelector('article.page');})"
                ".observe(document,{subtree:true,childList:true});")
            page.goto(base + path)
            page.wait_for_selector(READY)
            adopted = page.evaluate("window.firstArticle === document.querySelector('article.page')")
            owned = page.evaluate("document.getElementById('view').hasAttribute('data-react-owned')")
            check(f'{path}: adopts the server DOM', adopted and owned and not errors, errors=errors)
            page.close()

        # S24: the search box filters in place and mirrors ?q= without a redraw
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        page.goto(base + '/danni')
        page.wait_for_selector(READY)
        total = len(visible_rows(page))
        page.evaluate("window.marker = document.querySelector('article.page')")
        box = page.locator('#s24-q')
        box.click()
        box.press_sequentially('дълг', delay=30)
        page.wait_for_function("() => new URL(location.href).searchParams.get('q') === 'дълг'")
        rows = visible_rows(page)
        same = page.evaluate("window.marker === document.querySelector('article.page')")
        focused = page.evaluate("document.activeElement && document.activeElement.id")
        count = page.locator('[data-count]').text_content()
        check('S24 search filters rows in place', 0 < len(rows) < total and same and focused == 's24-q',
              rows=rows, total=total, count=count, focused=focused)
        check('S24 search says how many are shown', count.startswith(f'Показани: {len(rows)} от'), count=count)
        check('S24 reset button appears with a filter', page.locator('[data-s24-reset]').is_visible())
        with page.expect_download() as dl:
            page.locator('[data-s24-csv]').click()
        csv = open(dl.value.path(), encoding='utf-8-sig').read().splitlines()
        check('S24 CSV is the shown rows', dl.value.suggested_filename == 'bns-danni-s24-sets.csv' and any(
            'Набор' in line for line in csv[:3]), file=dl.value.suggested_filename, lines=len(csv))
        box.press('Escape')
        page.wait_for_function("() => !new URL(location.href).searchParams.has('q')")
        check('S24 Escape clears the search', len(visible_rows(page)) == total)

        # a status chip and a select write the filter into the address and redraw from it
        page.locator('button.chip[data-query="status=pending"]').click()
        page.wait_for_function("() => new URL(location.href).searchParams.get('status') === 'pending'")
        page.wait_for_selector(READY)
        pend = visible_rows(page)
        pressed = page.locator('button.chip[data-query="status=pending"]').get_attribute('aria-pressed')
        sts = page.evaluate("[...document.querySelectorAll('li.s24-row')].filter(li => !li.hidden).map(li => li.dataset.st)")
        check('S24 status chip filters', pend and set(sts) == {'pending'} and pressed == 'true', rows=pend)
        page.locator('[data-s24-reset]').click()
        page.wait_for_function("() => !new URL(location.href).searchParams.has('status')")
        page.wait_for_selector(READY)
        page.wait_for_function("() => document.activeElement && document.activeElement.id === 's24-q'")
        check('S24 reset clears the filters and focuses the search', len(visible_rows(page)) == total)
        page.select_option('#s24-ekran', 'dalg')
        page.wait_for_function("() => new URL(location.href).searchParams.get('ekran') === 'dalg'")
        page.wait_for_selector(READY)
        check('S24 screen select filters', 0 < len(visible_rows(page)) < total, rows=visible_rows(page))

        # the glossary popover and the legend from the React-owned list
        term = page.locator('article a.gl').first
        if term.count():
            term.click()
            page.wait_for_selector('#gl-pop', state='visible')
            check('S24 glossary term opens its popover', page.locator('#gl-pop').is_visible())
            page.keyboard.press('Escape')
        page.locator('button[data-action="legend"]').first.click()
        page.wait_for_selector('.legend-list', state='visible')
        check('S24 legend opens', page.locator('.legend-list').is_visible())
        page.keyboard.press('Escape')

        # the passport: copy the address, share
        page.goto(base + '/danni/execution')
        page.wait_for_selector(READY)
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=base)
        page.locator('[data-s24-copy-from="s24-addr"]').click()
        page.wait_for_function("() => document.getElementById('toasts')?.textContent.includes('Адресът е копиран')")
        check('S24 copies the file address', True)
        page.locator('button[data-share="s24-d-card"]').click()
        page.wait_for_selector('[role="dialog"]', state='visible')
        check('S24 share menu opens', page.locator('[role="dialog"]').first.is_visible())
        ctx.close()

        # S27: tabs, validation, drafts, saved messages
        ctx = browser.new_context()
        page = ctx.new_page()
        page.goto(base + '/vrazka')
        page.wait_for_selector(READY)
        page.locator('#s27-tabs-t-greshka').focus()
        page.keyboard.press('ArrowRight')
        page.wait_for_function("() => new URL(location.href).searchParams.get('tab') === 'neyasno'")
        shown = page.evaluate("[...document.querySelectorAll('#s27-tabs > [role=tabpanel]')].filter(p => !p.hidden).map(p => p.dataset.key)")
        focused = page.evaluate("document.activeElement.id")
        check('S27 arrow keys move between tabs', shown == ['neyasno'] and focused == 's27-tabs-t-neyasno', shown=shown)
        page.locator('#s27-tabs-t-greshka').click()
        page.locator('form[data-s27-form="greshka"] button[type=submit]').click()
        err = page.locator('#s27-greshka-text-err').text_content()
        invalid = page.locator('#s27-greshka-text').get_attribute('aria-invalid')
        focused = page.evaluate("document.activeElement.id")
        check('S27 empty message is refused', bool(err) and invalid == 'true' and focused == 's27-greshka-text', error=err)
        page.locator('#s27-greshka-text').fill('Числото на приходите не съвпада.')
        page.locator('#s27-greshka-text').press('End')
        page.keyboard.type(' ')
        check('S27 counts the letters', page.locator('[data-s27-count]').first.text_content().startswith('33 /'))
        check('S27 clears the error while typing', not page.locator('#s27-greshka-text-err').text_content())
        page.wait_for_function("() => (sessionStorage.getItem('bns.s27.draft.v1') || '').includes('приходите')")
        page.reload()
        page.wait_for_selector(READY)
        page.wait_for_function("() => document.getElementById('s27-greshka-text').value.includes('приходите')")
        check('S27 keeps the draft of this tab', True)
        page.locator('#s27-greshka-text').press('Control+Enter')
        page.wait_for_selector('[data-s27-ok="greshka"]:not([hidden])')
        focused = page.evaluate("document.activeElement.className")
        stored = page.evaluate("JSON.parse(localStorage.getItem('bns.feedback.v1') || '[]').length")
        count = page.locator('#s27-saved-count').text_content()
        draft = page.evaluate("sessionStorage.getItem('bns.s27.draft.v1')")
        check('S27 saves the message in this browser', 's27-ok-h' in focused and stored == 1 and
              'Записани: 1' in count and not draft, focused=focused, count=count)
        check('S27 lists the saved message', page.locator('.s27-saved-item').count() == 1)
        page.locator('[data-s27-again="greshka"]').click()
        check('S27 writes another one', page.locator('form[data-s27-form="greshka"]').is_visible() and
              page.evaluate("document.activeElement.id") == 's27-greshka-text')
        page.locator('[data-s27-clear]').click()
        check('S27 clears the saved messages', page.locator('.s27-saved-item').count() == 0 and
              page.evaluate("document.activeElement.id") == 's27-saved-h' and
              not page.evaluate("localStorage.getItem('bns.feedback.v1')"))
        page.locator('#s27-tabs-t-ideya').click()
        page.locator('#s27-ideya-text').fill('Карта на общините по години')
        page.locator('#s27-ideya-contact').fill('не-е-имейл')
        page.locator('form[data-s27-form="ideya"] button[type=submit]').click()
        check('S27 refuses a wrong e-mail', page.evaluate("document.activeElement.id") == 's27-ideya-contact' and
              page.locator('#s27-ideya-contact').get_attribute('aria-invalid') == 'true')
        page.goto(base + '/vrazka?type=error&from=prihodi&val=12&src=kfp&block=s06-total')
        page.wait_for_selector(READY)
        check('S27 fills the context of the link', page.locator('#s27-greshka-from').input_value() == 'prihodi' and
              page.locator('#s27-greshka-val').input_value() == '12' and page.locator('.s27-src').count() == 1)
        ctx.close()
        browser.close()

    print(json.dumps(checks, ensure_ascii=False, indent=2))
    failed = [c for c in checks if not c['ok']]
    print(f'{len(checks)} checks, {len(failed)} failed', file=sys.stderr)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
