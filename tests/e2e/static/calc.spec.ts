import { test, expect, enableHashRoutes } from '../fixtures.ts';
import { calculatorResults, indirectTaxResults } from '../calc-probes.ts';
import { salaryModel, insurableIncomeCaps } from '../expected.ts';
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });

test('salary engine and indirect tax cases', async ({ context, page, siteURL }) => {
  await enableHashRoutes(context);
  await page.goto(siteURL + '/index.html#/danaci');
  await expect(page.locator('#s18-view')).toBeVisible({ timeout: 8000 });
  const ref = [
    ['1500', 'from'],
    ['1500', 'until'],
    ['1500', 'year'],
  ];
  const low = [
    ['500', 'from'],
    ['1000', 'until'],
    ['1000.5', 'from'],
    ['2000', 'year'],
  ];
  const edge = [
    ['2111.64', 'until'],
    ['2111.65', 'until'],
    ['2300', 'from'],
    ['2300.01', 'from'],
    ['2200', 'until'],
    ['2200', 'from'],
    ['2111.64', 'year'],
    ['2300', 'year'],
  ];
  const high = [
    ['3000', 'until'],
    ['3000', 'from'],
    ['3000', 'year'],
    ['5000', 'from'],
    ['9000', 'until'],
    ['9000', 'from'],
    ['12345.67', 'year'],
    ['100000', 'from'],
  ];
  const odd = [
    ['1234.56', 'from'],
    ['1234.56', 'until'],
    ['1234.56', 'year'],
    ['999.99', 'year'],
    ['777.77', 'from'],
    ['1111.11', 'until'],
    ['2222.22', 'year'],
    ['0.01', 'from'],
  ];
  type Case = { gross: string; rules: string; tzpb?: number };
  const cases: Case[] = [...ref, ...low, ...edge, ...high, ...odd].map(([gross, rules]) => ({
    gross: gross!,
    rules: rules!,
  }));
  for (const tzpb of [0.4, 0.7, 1.1, 2.0, 0.1])
    for (const rules of ['from', 'year']) cases.push({ gross: '1800', rules, tzpb });
  // The result is JSON from the browser probe, not a shared production type/model.
  const results = await page.evaluate(calculatorResults, cases);
  for (const [i, c] of cases.entries()) {
    const result = results[i]!,
      tag = JSON.stringify(c);
    expect.soft(result.kind, tag).toBe('ok');
    if (result.kind !== 'ok') continue;
    const expected = salaryModel(c.gross, c.rules, c.tzpb);
    for (const k of ['emp', 'tax', 'er', 'net', 'yEmp', 'yTax', 'yEr'] as const)
      expect.soft(Math.abs(result[k] - expected[k]), `${tag}: ${k}`).toBeLessThanOrEqual(0.005);
    expect
      .soft(Math.abs(result.net + result.emp + result.tax - Number(c.gross)), tag + ': gross sum')
      .toBeLessThan(0.005);
    expect
      .soft(Math.abs(result.total - result.emp - result.tax - result.er), tag + ': total')
      .toBeLessThan(0.005);
    expect
      .soft(
        Math.abs(result.yTotal - result.yEmp - result.yTax - result.yEr),
        tag + ': annual total',
      )
      .toBeLessThan(0.005);
    expect.soft(result.funds, tag + ': fund split').not.toHaveLength(0);
    if (result.funds?.length) {
      expect
        .soft(
          Math.abs(
            result.funds.reduce(
              (s: number, fund: { you: number | null }) => s + (fund.you || 0),
              0,
            ) - result.emp,
          ),
          tag + ': personal funds',
        )
        .toBeLessThan(0.005);
      expect
        .soft(
          Math.abs(
            result.funds.reduce(
              (s: number, fund: { boss: number | null }) => s + (fund.boss || 0),
              0,
            ) - result.er,
          ),
          tag + ': employer funds',
        )
        .toBeLessThan(0.005);
      expect
        .soft(
          result.funds.every(
            (fund: { id: string; you: number | null }) => fund.you === null || fund.id !== 'tzpb',
          ),
          tag + ': no personal ТЗПБ',
        )
        .toBe(true);
    }
    if (c.rules === 'year') {
      expect.soft(result.year, tag + ': year').toBeTruthy();
      expect
        .soft(
          result.periods.map((p: { months: number }) => p.months),
          tag + ': periods',
        )
        .toEqual([7, 5]);
    } else
      expect
        .soft(result.capped, tag + ': cap')
        .toBe(Number(c.gross) > insurableIncomeCaps[c.rules]!);
    expect.soft(result.text, tag).not.toMatch(/NaN|undefined/);
  }
  const r = results[0]!;
  expect
    .soft([r.net, r.emp, r.tax, r.er], 'reference 1500')
    .toEqual([1163.97, 206.7, 129.33, 283.8]);
  for (const s of ['1 163,97', '206,70', '129,33', '283,80'])
    expect.soft(r.text.replace(/[  ]/g, ' ')).toContain(s);
  const run = (cases: Case[]) => page.evaluate(calculatorResults, cases);
  const bad = ['', '0', '-5', 'abc', '1e3x', '0,00', '10000001', '  '];
  const invalid = await run(bad.map((gross) => ({ gross, rules: 'from' })));
  for (const [i, gross] of bad.entries()) {
    expect.soft(invalid[i]!.kind, JSON.stringify(gross)).toBe('empty');
    expect.soft(invalid[i]!.text, JSON.stringify(gross)).not.toMatch(/\d[\d\s ]*,\d\d/);
  }
  expect
    .soft(
      Boolean(invalid[1]!.err) && invalid[2]!.err != null && Boolean(invalid[3]!.err),
      'invalid errors',
    )
    .toBe(true);
  const spelled = await run(
    ['1 500,00', '1500.00', '1.500,00', '1,500.00', '1500 €'].map((gross) => ({
      gross,
      rules: 'from',
    })),
  );
  expect
    .soft(
      spelled.every(
        (result: { kind: string; net: number }) => result.kind === 'ok' && result.net === 1163.97,
      ),
      'spelled amounts',
    )
    .toBe(true);

  const indirectResults = await page.evaluate(indirectTaxResults);
  expect.soft(indirectResults.rows[0]!.fuelExcise, 'petrol coefficient').toBeCloseTo(3.6302, 8);
  expect.soft(indirectResults.rows[1]!.fuelExcise, 'diesel coefficient').toBeCloseTo(3.3029, 8);
  expect.soft(indirectResults.rows[0]!.vat, 'gross VAT').toBeCloseTo(20 + 9 + 20 / 6 + 3 / 6, 8);
  for (const [i, want] of [
    [0, 2.4],
    [2, 3.64],
    [3, 2.52],
    [4, 3.69],
  ] as const)
    expect.soft(indirectResults.rows[i]!.tobaccoExcise, `dated tobacco ${i}`).toBeCloseTo(want, 8);
  for (const i of [5, 6, 7, 8])
    expect.soft(indirectResults.rows[i]!.total, `missing ${i}`).toBeNull();
  expect.soft(indirectResults.rows[9]!.total).toBe(0);
  expect
    .soft(
      indirectResults.views.every((v: { unavailable: boolean } | null) => v && !v.unavailable),
      'only-real estimate',
    )
    .toBe(true);
  expect
    .soft(indirectResults.decimalPrices)
    .toMatchObject({ fuelPrice: 1.605, tobaccoPrice: 3.512 });
  const referencePrices = indirectResults.references;
  expect.soft(referencePrices.shown).toEqual(['1,605', '3,51']);
  expect.soft(referencePrices.before).toMatchObject({
    fuelPrice: referencePrices.expected[0],
    tobaccoPrice: referencePrices.expected[1],
  });
  expect.soft(referencePrices.edited).toMatchObject({ fuelPrice: 1.605, tobaccoPrice: 3.51 });
  expect.soft(referencePrices.diesel.fuelPrice).toBeCloseTo(referencePrices.expected[2]!, 8);
});

for (const width of [1280, 390])
  test(`calculator screen ${width}`, async ({ browser, siteURL }) => {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      reducedMotion: 'reduce',
      hasTouch: width < 700,
      viewport: { width, height: width >= 700 ? 900 : 844 },
    });
    try {
      await enableHashRoutes(context);
      const page = await context.newPage(),
        errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text().slice(0, 160));
      });
      page.on('pageerror', (error) => errors.push(String(error).slice(0, 160)));
      await page.goto(siteURL + '/index.html#/danaci');
      const result = page.locator('#s18-view'),
        gross = page.locator('#s18-gross');
      await expect(result).toBeVisible({ timeout: 8000 });
      for (const amount of ['1 163,97', '206,70', '129,33', '283,80', '336,03'])
        await expect(result).toContainText(amount);
      expect(new URL(page.url()).hash).toBe('#/danaci');
      await gross.fill('2 345,67');
      await expect(gross).toHaveValue('2 345,67');
      const salaryLink = page.url();
      expect(salaryLink).not.toMatch(/2345|2%20345|gross/);
      expect(salaryLink.slice(salaryLink.indexOf('#') + 1)).not.toContain('?');
      const previousResult = await result.textContent();
      await page.locator('#s18-rules-until').check();
      await expect(result).not.toHaveText(previousResult!);
      await page.locator('#s18-rules-year').check();
      await expect(result).toContainText('средно на месец');
      await expect(result).toContainText('За цялата 2026');
      await page.locator('#s18-rules-from').check();
      await gross.fill('abc');
      await expect(result).not.toContainText(/\d,\d\d\s*€/);
      await expect(page.locator('#s18-gross-err')).toBeVisible();
      await gross.fill('1500');
      await expect(result).toContainText('1 163,97');
      for (const id of ['s18-funds', 's18-how', 's18-sources', 's18-receipt', 's18-indirect']) {
        const disclosure = page.locator('#' + id);
        if (!(await disclosure.evaluate((element) => (element as HTMLDetailsElement).open)))
          await disclosure.locator('summary').first().click();
        await expect(disclosure).toHaveAttribute('open');
      }
      for (const text of ['ДОО', 'ТЗПБ', '6,00', '163,80'])
        await expect(page.locator('#s18-funds-view')).toContainText(text);
      for (const text of ['1 500,00 € × 13,78%', '206,70', '283,80'])
        await expect(page.locator('#s18-how-view')).toContainText(text);
      const indirectToggle = page.locator('#s18-ind'),
        indirectResult = page.locator('#s18-ind-view');
      await expect(indirectToggle).not.toBeChecked();
      const directResult = await result.textContent();
      await page.locator('label.toggle').filter({ has: indirectToggle }).click();
      await expect(page.locator('#s18-fuelPrice')).toHaveValue('1,605');
      await expect(page.locator('#s18-tobaccoPrice')).toHaveValue('3,51');
      for (const [key, value] of [
        ['purchases', '120'],
        ['reduced', '109'],
        ['exempt', '0'],
        ['fuel', '0'],
        ['tobacco', '0'],
      ] as const)
        await page.locator('#s18-' + key).fill(value);
      await expect(indirectResult).toContainText(/ориентировъчно/i);
      await expect(result).toHaveText(directResult!);
      for (const key of [
        'purchases',
        'reduced',
        'exempt',
        'fuel',
        'tobacco',
        'fuelPrice',
        'tobaccoPrice',
        'sticks',
      ]) {
        const field = page.locator('#s18-' + key),
          previousValue = await field.inputValue();
        await field.fill('-1');
        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#s18-' + key + '-err')).toBeVisible();
        await expect(indirectResult).toContainText('Поправи');
        await field.fill(previousValue);
        await expect(field).not.toHaveAttribute('aria-invalid');
      }
      await page.locator('#s18-reduced').fill('');
      await expect(indirectResult).toContainText('Липсва');
      await expect(page.locator('#s18-reduced')).not.toHaveAttribute('aria-invalid');
      await page.locator('#s18-reduced').fill('109');
      await page.locator('#s18-tobacco').fill('1');
      await page.locator('#s18-sticks').fill('20');
      await page.locator('#s18-date').fill('2026-07-31');
      await expect(page.locator('#s18-date')).toHaveAttribute('aria-invalid', 'true');
      await expect(indirectResult).toContainText('проверени ставки');
      await page.locator('#s18-date').fill('2026-11-08');
      await page.locator('#s18-tobacco').fill('0');
      await page.locator('#s18-sticks').fill('');
      const sharedLink = page.url();
      expect(sharedLink.slice(sharedLink.indexOf('#') + 1)).not.toContain('?');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
