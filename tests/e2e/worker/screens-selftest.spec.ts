import { test, expect, openScreen } from '../screens/fixtures.ts';
import { AUDIT_CODES, auditScreen, screenReady } from '../screens/browser.ts';
test('screen audit detects visible defects and a busy screen times out', async ({
  page,
  siteURL,
  browserEvents,
}) => {
  test.setTimeout(150_000);
  await openScreen(page, siteURL, '#/');
  await page.evaluate(() => {
    const view = document.getElementById('view')!;
    view.setAttribute('aria-busy', 'true');
  });
  await expect(
    page.waitForFunction(screenReady, undefined, { timeout: 500, polling: 100 }),
  ).rejects.toThrow(/Timeout/);
  await page.evaluate(() => {
    document.getElementById('view')!.removeAttribute('aria-busy');
    document.querySelector<HTMLElement>('article.page')!.dataset.ready = '0';
    document.title = 'СИГМА Бюджет';
    document.documentElement.lang = 'en';
    document.querySelector('.skip-link')!.remove();
    document.getElementById('topbar')!.hidden = true;
    document.querySelector('h1')!.textContent = '';
    const defects = document.createElement('section');
    defects.innerHTML = `<p>NaN lorem ipsum �</p><div style="width:3000px;height:4px"></div>
      <button></button><input><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <p aria-labelledby="missing-label">Missing label</p><div aria-hidden="true"><button>Hidden control</button></div>
      <details>Missing summary</details><a href="#">Dead link</a>
      <div role="tablist"><button role="tab" aria-selected="true" aria-controls="missing-panel">Tab</button></div>
      <button aria-label="small a" style="width:10px;height:10px;padding:0;display:inline-block"></button><button aria-label="small b" style="width:10px;height:10px;padding:0;display:inline-block"></button>
      <p style="font-size:9px">Tiny text</p><span data-src="missing-source">Source</span><span data-pending-id="missing-pending">Pending</span>
      <a data-gl="missing-term" href="#/rechnik">Unknown term</a><button data-share="missing-share">Share</button>
      <figure class="fig" data-mock-fig="true"></figure><div class="chart" data-ready="err" style="width:200px;height:100px"></div>
      <aside class="next"></aside><a href="#/missing-route-for-audit">Missing destination</a>`;
    document.getElementById('view')!.append(defects);
    const script = document.createElement('script');
    script.textContent = 'void 0';
    document.body.append(script);
    console.error('Deliberate console error');
    setTimeout(() => {
      throw new Error('Deliberate exception');
    }, 0);
    setTimeout(() => alert('Deliberate dialog'), 0);
    void fetch('/data/missing.json');
    document.cookie = 'audit-defect=1';
    // CSP blocks external requests before they can leave the page.
    void Promise.reject(new Error('Deliberate audit rejection'));
  });
  const captured: { code: string; message: string }[] = [];
  const eventCodes = ['console-error', 'pageerror', 'dialog', 'http', 'cookie', 'csp', 'rejection'];
  await expect
    .poll(async () => {
      captured.push(...(await browserEvents.readAndClear()));
      return eventCodes.filter((code) => !captured.some((event) => event.code === code));
    })
    .toEqual([]);
  const findings = await page.evaluate(auditScreen, 'missing-route');
  expect(
    AUDIT_CODES.filter((code) => !findings.some((finding) => finding.code === code)),
    'Undetected defect codes',
  ).toEqual([]);
});
