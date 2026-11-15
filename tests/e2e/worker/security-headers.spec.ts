import { createServer } from 'node:http';
import { test, expect } from '../fixtures.ts';
test.use({ serviceWorkers: 'block' });

test('public cross-origin JSON, JSON 400, embed and ordinary framing policy', async ({
  browser,
  siteURL,
}) => {
  const port = Number(new URL(siteURL).port) + 2;
  const consumer = createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>Consumer</body></html>');
  });
  await new Promise<void>((done, reject) => {
    consumer.once('error', reject);
    consumer.listen(port, '127.0.0.1', done);
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/security-consumer`);
    const results = await page.evaluate(async (base) => {
      const results = [];
      for (const path of ['/data/core.json', '/api/releases?limit=1.5']) {
        const response = await fetch(base + path, { credentials: 'omit' });
        results.push({ path, status: response.status, json: await response.json() });
      }
      const frame = document.createElement('iframe');
      frame.src = base + '/embed/selftest';
      document.body.append(frame);
      return results;
    }, siteURL);
    expect(results[0]!.status, JSON.stringify(results)).toBe(200);
    expect(results[1]!.status, JSON.stringify(results)).toBe(400);
    expect(results[1]!.json, 'JSON 400 error').toHaveProperty('error');
    await page.waitForFunction("document.querySelector('iframe') !== null");
    let frame = page.frame({ url: siteURL + '/embed/selftest' });
    for (let i = 0; i < 100; i++) {
      if (frame && (await frame.locator('.s29-embed figure').count())) break;
      await page.waitForTimeout(100);
      frame = page.frame({ url: siteURL + '/embed/selftest' });
    }
    expect(
      frame && (await frame.locator('.s29-embed figure').count()),
      'cross-origin embed did not render',
    ).toBeTruthy();
    const ordinary = await context.request.get(siteURL + '/');
    expect(ordinary.headers()['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(ordinary.headers()['x-frame-options']).toBe('SAMEORIGIN');
  } finally {
    await context.close();
    await new Promise<void>((done, reject) =>
      consumer.close((error) => (error ? reject(error) : done())),
    );
  }
});
