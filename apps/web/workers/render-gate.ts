// A guard in front of the render of a screen that is not in the edge cache, as in СИГМА (midt-bg/sigma, apps/web/workers/render-gate.ts):
//   • single flight: identical misses wait for the first one's cache entry instead of each drawing the screen. This matters most right
//     after a new release, when every cache key changes at once;
//   • a cap on renders under way, past which a request gets a 503 instead of queueing behind the others.
// Per isolate only: Cloudflare runs many isolates per location, so this tames one herd on one isolate, not the whole site.

/** how many screens one isolate draws at once before it sheds a request */
export const MAX_RENDERING = 20;

/** how long an identical miss waits for the first render before it draws the screen itself. A put whose request was cancelled (the
 *  visitor left) may never settle: without a bound, every later miss of that screen on the isolate would wait for it */
export const FLIGHT_MS = 10_000;

const flights = new Map<string, { done: Promise<void>; at: number }>();
let rendering = 0;

/** the identical miss already being drawn in this isolate: settles once its cache entry is stored (or not), or when the flight runs out
 *  of time, whichever comes first */
export function inFlight(key: string): Promise<void> | undefined {
  const flight = flights.get(key);
  const left = flight ? flight.at + FLIGHT_MS - Date.now() : 0;
  if (!flight || left <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, left)));
  return Promise.race([flight.done, timeout]).finally(() => clearTimeout(timer));
}

/** become the render that the next identical misses wait for; call the returned function when the cache entry is stored (or not) */
export function claim(key: string): () => void {
  const now = flights.get(key);
  if (now && Date.now() - now.at < FLIGHT_MS) return () => {};
  let settle!: () => void;
  const flight = { done: new Promise<void>((resolve) => (settle = resolve)), at: Date.now() };
  flights.set(key, flight);
  return () => {
    if (flights.get(key) === flight) flights.delete(key); // a late settle of a timed-out flight must not drop the one that replaced it
    settle();
  };
}

/** run a render within the cap; null when the isolate is already at it */
export async function withinCap<T>(render: () => Promise<T>): Promise<T | null> {
  if (rendering >= MAX_RENDERING) return null;
  rendering += 1;
  try {
    return await render();
  } finally {
    rendering -= 1;
  }
}
