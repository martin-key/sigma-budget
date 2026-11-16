type LayoutShift = PerformanceEntry & {
  hadRecentInput: boolean;
  value: number;
  sources?: { node?: Node }[];
};
declare global {
  interface Window {
    __HASH_ROUTES__: boolean;
    __ROUTES__: { id: string; bare?: boolean; samples: string[] }[];
    __cls: number;
    __prevFocus: Element | null;
  }
}
export const observeLayoutShifts = () => {
  window.__cls = 0;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as LayoutShift[]) {
      if (entry.hadRecentInput) continue;
      if (entry.sources?.some(({ node }) => node instanceof Element && node.closest('#view')))
        window.__cls += entry.value;
    }
  }).observe({ type: 'layout-shift', buffered: true });
};
export const runningAnimations = () =>
  document.getAnimations().filter((animation) => animation.playState === 'running').length;
