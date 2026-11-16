import { expect, type Page } from '@playwright/test';

type Color = readonly [number, number, number, number];
type Background = string[] | null;
type ShapeFill = { color: string; opacity: number };
type Label = {
  chart: number;
  text: string;
  foreground: string;
  background: Background;
  fills: ShapeFill[];
  size: number;
  bold: boolean;
};
type Edge = {
  background: Background;
  parent: Background;
  borders: { width: number; color: string }[];
};
type Field = {
  name: string;
  background: Background;
  placeholder: string;
  placeholderColor: string;
  placeholderOpacity: number;
  checkBoundary: boolean;
  edges: Edge[];
};
export type ContrastResult = {
  texts: number;
  fields: number;
  placeholders: number;
  boundaries: number;
  textViolations: { text: string; chart: number; ratio: number; minimum: number }[];
  placeholderViolations: { name: string; ratio: number }[];
  boundaryViolations: { name: string; ratio: number }[];
};

function parseColor(value: string): Color | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (hex) {
    let digits = hex[1]!;
    if (digits.length === 3) digits = [...digits].map((digit) => digit + digit).join('');
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
      digits.length === 8 ? parseInt(digits.slice(6), 16) / 255 : 1,
    ];
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value);
  if (rgb)
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1),
    ];
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(
    value,
  );
  return srgb
    ? [
        Number(srgb[1]) * 255,
        Number(srgb[2]) * 255,
        Number(srgb[3]) * 255,
        srgb[4] === undefined ? 1 : Number(srgb[4]),
      ]
    : null;
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}
function luminance(color: Color): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}
function contrastRatio(first: Color, second: Color): number {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const white: Color = [255, 255, 255, 1];
function backgroundColor(layers: Background): Color | null {
  if (!layers) return null;
  // Ignore layers behind the first opaque background.
  const colors: Color[] = [];
  for (const layer of layers) {
    const color = parseColor(layer);
    if (!color || color[3] === 0) continue;
    colors.push(color);
    if (color[3] >= 0.99) break;
  }
  return colors.reverse().reduce((background, color) => composite(color, background), white);
}

/** Collect paint and geometry in the browser; calculate contrast independently in Node. */
function readContrastElements(): { labels: Label[]; fields: Field[] } {
  function backgrounds(element: Element): Background {
    const layers: string[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      layers.push(style.backgroundColor);
      // Stop before an image hidden by an opaque layer.
      const channels = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
      if (channels && (channels[3] ?? 1) >= 0.99) break;
    }
    return layers;
  }
  function chartLabels(): Label[] {
    const labels: Label[] = [];
    const charts = [...document.querySelectorAll('#view .chart[data-ready="1"]')].filter(
      (element) => {
        const box = element.getBoundingClientRect();
        return (
          (box.width > 0 || box.height > 0) && getComputedStyle(element).visibility !== 'hidden'
        );
      },
    );
    for (const [chart, container] of charts.entries()) {
      const svg = container.querySelector('svg');
      if (!svg) continue;
      const shapes = [
        ...svg.querySelectorAll<SVGGeometryElement>('path,rect,circle,ellipse,polygon'),
      ].filter((shape) => {
        const fill = (shape.getAttribute('fill') ?? '').toLowerCase();
        return fill && fill !== 'none' && fill !== 'transparent' && !fill.startsWith('url(');
      });
      const texts = [...svg.querySelectorAll('text')].filter((text) => text.textContent?.trim());
      const stride = texts.length > 70 ? Math.ceil(texts.length / 70) : 1;
      for (const [index, text] of texts.entries()) {
        if (index % stride !== 0) continue;
        const box = text.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        const point = svg.createSVGPoint();
        point.x = box.left + box.width / 2;
        point.y = box.top + box.height / 2;
        const fills: ShapeFill[] = [];
        for (const shape of [...shapes].reverse()) {
          if (!(text.compareDocumentPosition(shape) & Node.DOCUMENT_POSITION_PRECEDING)) continue;
          const matrix = shape.getScreenCTM();
          if (!matrix) continue;
          try {
            if (shape.isPointInFill(point.matrixTransform(matrix.inverse())))
              fills.push({
                color: shape.getAttribute('fill') ?? '',
                opacity: parseFloat(
                  shape.getAttribute('fill-opacity') || shape.getAttribute('opacity') || '1',
                ),
              });
          } catch {
            /* Degenerate SVG geometry has no usable fill. */
          }
        }
        const style = getComputedStyle(text);
        labels.push({
          chart,
          text: text.textContent!.trim().slice(0, 24),
          foreground: text.getAttribute('fill') ?? '',
          background: backgrounds(container),
          fills,
          size: parseFloat(style.fontSize) || 12,
          bold: parseInt(style.fontWeight, 10) >= 700 || style.fontWeight === 'bold',
        });
      }
    }
    return labels;
  }

  function inputFields(): Field[] {
    function edge(element: Element): Edge {
      const style = getComputedStyle(element);
      return {
        background: backgrounds(element),
        parent: backgrounds(element.parentElement ?? document.body),
        borders: [
          { width: parseFloat(style.borderTopWidth) || 0, color: style.borderTopColor },
          { width: parseFloat(style.borderRightWidth) || 0, color: style.borderRightColor },
          { width: parseFloat(style.borderBottomWidth) || 0, color: style.borderBottomColor },
          { width: parseFloat(style.borderLeftWidth) || 0, color: style.borderLeftColor },
        ],
      };
    }
    return [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type=radio]):not([type=checkbox]):not([type=hidden]):not([type=range]), textarea',
      ),
    ]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return (
          (box.width > 0 || box.height > 0) && getComputedStyle(element).visibility !== 'hidden'
        );
      })
      .map((element) => {
        const placeholder = getComputedStyle(element, '::placeholder');
        const edges = [edge(element)];
        for (
          let parent = element.parentElement, level = 0;
          parent && level < 2 && parent !== document.body && !parent.matches('dialog, #view, main');
          parent = parent.parentElement, level++
        )
          edges.push(edge(parent));
        return {
          name: element.id || element.name || element.tagName.toLowerCase(),
          background: backgrounds(element),
          placeholder: element.placeholder,
          placeholderColor: placeholder.color,
          placeholderOpacity: parseFloat(placeholder.opacity),
          checkBoundary: getComputedStyle(element).outlineStyle === 'none',
          edges,
        };
      });
  }

  return { labels: chartLabels(), fields: inputFields() };
}

function boundaryRatio(edge: Edge): number {
  const parent = backgroundColor(edge.parent),
    own = backgroundColor(edge.background);
  let best = parent && own ? contrastRatio(own, parent) : 1;
  for (const border of edge.borders) {
    const color = parseColor(border.color);
    if (border.width > 0 && color && parent)
      best = Math.max(best, contrastRatio(composite(color, parent), parent));
  }
  return best;
}

export async function measureContrast(page: Page): Promise<ContrastResult> {
  const { labels, fields } = await page.evaluate(readContrastElements);
  const result: ContrastResult = {
    texts: 0,
    fields: fields.length,
    placeholders: 0,
    boundaries: 0,
    textViolations: [],
    placeholderViolations: [],
    boundaryViolations: [],
  };
  for (const label of labels) {
    const foreground = parseColor(label.foreground);
    if (!foreground) continue;
    const surface = backgroundColor(label.background) ?? white;
    let background = surface;
    for (const fill of label.fills) {
      const color = parseColor(fill.color);
      if (!color || fill.opacity < 0.3) continue;
      background = composite([color[0], color[1], color[2], color[3] * fill.opacity], surface);
      break;
    }
    const minimum = label.size >= 24 || (label.size >= 18.66 && label.bold) ? 3 : 4.5;
    const ratio = contrastRatio(composite(foreground, background), background);
    result.texts++;
    if (ratio < minimum)
      result.textViolations.push({ text: label.text, chart: label.chart, ratio, minimum });
  }
  for (const field of fields) {
    const background = backgroundColor(field.background);
    if (!background) continue;
    if (field.placeholder) {
      result.placeholders++;
      const color = parseColor(field.placeholderColor);
      if (color) {
        const opacity = Number.isNaN(field.placeholderOpacity) ? 1 : field.placeholderOpacity;
        const ratio = contrastRatio(
          composite([color[0], color[1], color[2], color[3] * opacity], background),
          background,
        );
        if (ratio < 4.5) result.placeholderViolations.push({ name: field.name, ratio });
      }
    }
    if (field.checkBoundary) {
      result.boundaries++;
      const ratio = Math.max(...field.edges.map(boundaryRatio));
      if (ratio < 3) result.boundaryViolations.push({ name: field.name, ratio });
    }
  }
  return result;
}

async function readyCharts(page: Page, timeout = 6000): Promise<void> {
  await expect(
    page.locator('#view .chart:visible:not([data-ready="1"]):not([data-ready="err"])'),
  ).toHaveCount(0, { timeout });
}
async function openDetails(page: Page): Promise<void> {
  for (let depth = 0; depth < 3; depth++) {
    const closed = page.locator('#view details:not([open])');
    if ((await closed.count()) === 0) break;
    await closed.evaluateAll((details) =>
      details.forEach((detail) => {
        (detail as HTMLDetailsElement).open = true;
      }),
    );
  }
}
export async function expandContent(page: Page): Promise<void> {
  await openDetails(page);
  await readyCharts(page, 30_000);
  // Font loading and image completion have no locator matcher; geometry must be final before sampling.
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await expect
    .poll(
      () =>
        page
          .locator('#view img')
          .evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.complete)),
      { timeout: 30_000 },
    )
    .toBe(true);
}
