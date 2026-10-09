// Old addresses → the new screens (V5). Applied by the router BEFORE the route is matched, so a link saved from an earlier version
// lands on the matching new screen and keeps what it can of the context (period, month, scope, mode, item). The address bar is rewritten.
//   redirect(segs, query) → { segs, query } | null
// What went away and where its links go:
//   /izpalnenie/pera        → /izpalnenie  with the item groups open (?pera=rev,exp)
//   /izpalnenie/sravnenie   → /izpalnenie  (?g1 ?g2 ?mesec ?obhvat ?rez as before; ?pok=prihodi|razhodi|saldo → ?pokazatel=…)
//   /izpalnenie ?ed= ?prag= → the same without the two old controls (plan share and the 8/12 line are not shown any more)
//   /razhodi/:fn/deynosti   → /razhodi/:fn   (the breakdown by activity is not an active screen)
//   /plashtania[/…]         → /izpalnenie    (no payment data in the active interface)
//   /proekti[/…]            → /vedomstva?tab=programi (the programmes of the departments)
//   /moyat-byudzhet         → /razhodi       (the simulator is not in the interface)
//   /razhodi?po=vedomstva   → /vedomstva   («Кой харчи» is its own cut of the explorer)
//   /klasacii               → /razhodi     (the rankings and the «lagging items» comparison are not in the active interface)
//   /deystvie               → /              (the four actions are replaced by the start screen and the search)
//   /patevoditel[/N]        → /5-minuti?to=<scene of step N>  (the guide is merged into «Бюджетът за 5 минути»: step 1 → scene 1, 2 → 2, 3 and 5 → 3,
//                             4 → 5 (the measures), 6 → 6, 7 → 4; step 8 → /danaci, the calculator the guide ended with); /patevoditel/9 stays unknown
const POK = { prihodi: 'rev', razhodi: 'exp.total', saldo: 'balance' };
const GUIDE_SCENE = { 1: 's04-scene1', 2: 's04-scene2', 3: 's04-scene3', 4: 's04-scene5', 5: 's04-scene3', 6: 's04-scene6', 7: 's04-scene4' };

export function redirect(segs, query = {}) {
  const [a, b, c] = segs.map(s => String(s).toLowerCase());
  const q = { ...query };
  if (a === 'izpalnenie') {
    if (b === 'pera') { q.pera = q.pera || 'rev,exp'; delete q.ed; delete q.prag; return { segs: ['izpalnenie'], query: q }; }
    if (b === 'sravnenie') {
      if (q.rez == null) q.rez = 'mesec';                      // the old comparison opened on the month alone
      if (q.pok) { if (POK[q.pok]) q.pokazatel = POK[q.pok]; delete q.pok; }
      delete q.ed; delete q.prag;
      return { segs: ['izpalnenie'], query: q };
    }
    if (q.ed != null || q.prag != null || q.pok != null) {
      if (q.pok && POK[q.pok] && !q.pokazatel) q.pokazatel = POK[q.pok];
      delete q.ed; delete q.prag; delete q.pok;
      return { segs: segs.slice(0, 2), query: q };
    }
    return null;
  }
  if (a === 'razhodi' && c === 'deynosti') return { segs: ['razhodi', segs[1]], query: q };
  if (a === 'plashtania') return { segs: ['izpalnenie'], query: {} };
  if (a === 'proekti') return { segs: ['vedomstva'], query: { ...(q.per ? { per: q.per } : {}), tab: 'programi' } };
  if (a === 'moyat-byudzhet') return { segs: ['razhodi'], query: q.per ? { per: q.per } : {} };
  if (a === 'deystvie') return { segs: [], query: {} };
  if (a === 'patevoditel' && segs.length <= 2 && (b === undefined || /^[1-8]$/.test(b))) {
    if (b === '8') return { segs: ['danaci'], query: {} };
    return { segs: ['5-minuti'], query: GUIDE_SCENE[b] ? { to: GUIDE_SCENE[b] } : {} };
  }
  if (a === 'razhodi' && !b && q.po === 'vedomstva') return { segs: ['vedomstva'], query: q.per ? { per: q.per } : {} };
  if (a === 'klasacii') return { segs: ['razhodi'], query: q.per ? { per: q.per } : {} };
  return null;
}

/** the same rule for the pages' own links: where an old address now lives (a hash like '#/proekti/pr-01'); null = unchanged */
export function redirectHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const qi = s.indexOf('?');
  const path = qi < 0 ? s : s.slice(0, qi);
  const query = {};
  if (qi >= 0) for (const [k, v] of new URLSearchParams(s.slice(qi + 1))) query[k] = v;
  const r = redirect(path.split('/').filter(Boolean), query);
  if (!r) return null;
  const qs = new URLSearchParams(Object.entries(r.query).filter(([, v]) => v != null && v !== '')).toString();
  return '#/' + r.segs.map(encodeURIComponent).join('/') + (qs ? '?' + qs : '');
}
