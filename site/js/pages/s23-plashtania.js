// S23 · Кой на кого плаща? · #/plashtania/:eik? · next S24, S01 · periods [2026.draft, 2026.law] · phase 2
// Data (both optional; a block whose file is missing shows its own pending state):
//   sebra          D24, REAL  the daily summaries of the ministry's payments (three published days; there are no recipients in them)
//   mock/payments  M04, MOCK  invented payments of the budget organisations, January-August 2026, and 48 invented recipients (ЕИК 999...)
// Real and mock never share one number: the real block is the only part without the hatch; the mock blocks say so (badge, strip, the record's own sentence).
// Every figure goes through the format helpers. The money of the mock file is whole euros, the real file has cents.
// „На човек“ and „% от БВП“ do not apply to payment volumes (documented deviation); „и в лева“ does.
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { progress } from '../ui/progress.js';
import { ranklist } from '../ui/ranklist.js';
import { chart } from '../ui/chart.js';
import { tabs } from '../ui/tabs.js';
import { chips } from '../ui/chips.js';
import { dataTable } from '../ui/table.js';
import { callout, facts, ext } from '../ui/cards.js';
import { disclosure } from '../ui/disclosure.js';
import { field, textInput, selectInput } from '../ui/forms.js';
import { emptyState, pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { icon } from '../icons.js';
import { toast } from '../ui/toast.js';
import { csvFor, download, copyOrShow } from '../share.js';
import { num, pct, plural, money, moneyParts, eur, leva, date, monthName, EUR_RATE } from '../format.js';

const MOCK_SRC = ['mockgen'];
const REAL_SRC = ['sebra'];
const WHY = 'Примерни данни.';
const SCOPE_REAL = { key: 'sebra', label: 'Плащания по СЕБРА', note: 'един ден, не месец' };
const SCOPE_MOCK = { key: 'sebra-primer', label: 'Примерни плащания', note: 'не е отчет' };
/** the kinds of institution as the visitor reads them (the keys are the file's; an unknown key prints as it is) */
const KIND_LABEL = { ministry: 'Министерства', agency: 'Агенции и служби', commission: 'Комисии и съвети', judiciary: 'Съдебна власт', constitutional: 'Конституционни органи', legislature: 'Законодателна власт', fund: 'Фондове', other: 'Други' };
const KIND_ONE = { ministry: 'Министерство', agency: 'Агенция или служба', commission: 'Комисия или съвет', judiciary: 'Съдебна власт', constitutional: 'Конституционен орган', legislature: 'Законодателна власт', fund: 'Фонд', other: 'Друго' };
/** one plain line per kind of payment (the keys are the file's codes) */
const TYPE_TEXT = {
  'exp.personnel': 'Заплати и осигуровки на служителите.',
  'exp.maint': 'Ежедневната работа: консумативи, услуги и сметки.',
  'exp.subsidies': 'Пари за организации и дейности, които държавата подпомага.',
  'exp.social': 'Помощи, обезщетения и стипендии за хора.',
  'exp.capex': 'Пътища, сгради и техника, които служат много години.',
  other: 'Всичко, което не е в другите видове.'
};
const SORT_KEYS = ['name', 'eik', 'kind', 'eur', 'count', 'lv'];

const ok = v => typeof v === 'number' && Number.isFinite(v);
const arr = v => (Array.isArray(v) ? v : []);
const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
const lower = s => String(s ?? '').toLocaleLowerCase('bg');
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
const dayN = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN; };
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const pctOf = (a, b) => (ok(a) && ok(b) && b > 0 ? (a / b) * 100 : null);
const shareText = v => (!ok(v) ? '—' : v > 0 && v < 0.1 ? pct(v, 2) : pct(v, 1));
const monthLabel = ym => { const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? '')); return m ? `${monthName(+m[2])} ${m[1]}` : '—'; };
const dayLabel = iso => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso ?? '')); return m ? `${+m[2]} ${monthName(+m[1], true)}` : '—'; };
/** a date in a sentence: „31 август 2026 г.“ */
const dayG = iso => `${date(iso, true)} г.`;
const kindOf = k => KIND_LABEL[k] ?? String(k ?? '—');
const kindOne = k => KIND_ONE[k] ?? String(k ?? '—');
const count = n => plural(n, 'плащане', 'плащания');

/* money. The real file and the mock recipients are in euros (cents / whole euros); the mock totals are shown in млн. € or млрд. €. */
const levaOf = (mln, o = {}) => { const s = money(mln, { leva: true, scale: 'mln', ...o }); const i = s.indexOf('(≈'); return i < 0 ? '' : s.slice(i + 1, -1); };
/** an amount in euros as one text: „171 854,85 €“, with „(≈ 336 124,12 лв.)“ when the visitor wants leva too */
const eurText = (v, d, lv) => (lv ? `${eur(v, d)} (≈ ${leva(v * EUR_RATE, d)})` : eur(v, d));
/** an amount in euros as млн. €/млрд. € (text for a sentence or a list), leva when asked */
const bigText = (v, lv, o = {}) => money(v / 1e6, { scale: 'mln', ...o, leva: !!lv });
const bigParts = (v, o = {}) => moneyParts(v / 1e6, { scale: 'auto', ...o });
const levaSub = (v, lv, o = {}) => (lv ? levaOf(v / 1e6, { scale: 'auto', ...o }) : '');

/* ---------------------------------------------------------------- the models (pure: no state, no clock) */
/** the real daily summaries: the days, the head day (the one the file is dated), the extremes, the notes */
function realModel(d) {
  if (!d || typeof d !== 'object') return null;
  const named = x => x && x.name && ok(x.eur) && ok(x.count);
  const days = arr(d.days)
    .filter(x => x && Number.isFinite(dayN(x.date)) && ok(x.eur) && ok(x.count))
    .map(x => ({
      date: x.date, count: x.count, eur: x.eur,
      cats: arr(x.byCode).filter(named).map(c => ({ code: String(c.code ?? ''), name: String(c.name), count: c.count, eur: c.eur })).sort((a, b) => b.eur - a.eur),
      orgs: arr(x.byOrganisation).filter(named).map(o => ({ code: String(o.code ?? ''), name: String(o.name), count: o.count, eur: o.eur })).sort((a, b) => b.eur - a.eur)
    }))
    .sort((a, b) => dayN(a.date) - dayN(b.date));
  if (!days.length) return null;
  const head = days.find(x => x.date === d.period?.to) || days[days.length - 1];
  const files = arr(d.publication?.files);
  const listed = day => { const f = files.find(x => x && x.day === day); return f && Number.isFinite(dayN(f.listedOn)) ? f.listedOn : null; };
  const byEur = [...days].sort((a, b) => b.eur - a.eur);
  const big = byEur[0], small = byEur[byEur.length - 1];
  const page = typeof d.publication?.page === 'string' && /^https:\/\//.test(d.publication.page) ? d.publication.page : '';
  return {
    days, head, big, small, listed,
    lag: day => { const l = listed(day); return l ? dayN(l) - dayN(day) : null; },
    ratio: small.eur > 0 ? big.eur / small.eur : null,
    publisher: String(d.publisher || ''),
    page,
    notes: arr(d.notes).filter(s => typeof s === 'string' && s.trim())
  };
}

/** the invented payments: totals, months, days, institutions, kinds of payment, recipients, and what the query asks for */
function mockModel(d, q) {
  if (!d || typeof d !== 'object') return null;
  const named = x => x && x.name && ok(x.eur) && ok(x.count);
  const months = arr(d.months).filter(x => x && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(x.month)) && ok(x.eur) && ok(x.count)).sort((a, b) => bg(a.month, b.month));
  const daily = arr(d.daily).filter(x => x && Number.isFinite(dayN(x.date)) && ok(x.eur) && ok(x.count)).sort((a, b) => dayN(a.date) - dayN(b.date));
  const types = arr(d.byType).filter(named);
  const insts = arr(d.byInstitution).filter(x => named(x) && x.id).sort((a, b) => b.eur - a.eur);
  const recs = arr(d.recipients).filter(x => named(x) && x.eik).map(x => ({ ...x, eik: String(x.eik) }));
  if (![months, daily, types, insts, recs].some(l => l.length)) return null;
  const sum = (list, k) => list.reduce((a, x) => a + x[k], 0);
  const t = d.totals || {};
  const base = months.length ? months : daily.length ? daily : types;
  const total = {
    eur: ok(t.eur) ? t.eur : sum(base, 'eur'),
    count: ok(t.count) ? t.count : sum(base, 'count'),
    days: ok(t.workingDays) ? t.workingDays : daily.length,
    institutions: ok(t.institutions) ? t.institutions : insts.length,
    recipients: ok(t.recipients) ? t.recipients : recs.length
  };
  const from = Number.isFinite(dayN(d.meta?.period?.from)) ? d.meta.period.from : daily[0]?.date ?? null;
  const to = Number.isFinite(dayN(d.meta?.period?.to)) ? d.meta.period.to : daily[daily.length - 1]?.date ?? null;
  const monthList = months.length ? months.map(m => m.month) : [...new Set(daily.map(x => x.date.slice(0, 7)))];
  const sel = monthList.includes(q.mesec) ? q.mesec : monthList[monthList.length - 1] ?? '';
  const obem = q.obem === 'dni' || (q.mesec && !q.obem) ? 'dni' : 'meseci';
  const extremes = list => (list.length ? [list.reduce((a, x) => (x.eur > a.eur ? x : a)), list.reduce((a, x) => (x.eur < a.eur ? x : a))] : [null, null]);
  const [peak, quiet] = extremes(daily);
  const monthDays = daily.filter(x => x.date.slice(0, 7) === sel);
  const [mpeak, mquiet] = extremes(monthDays);
  const [topMonth, lowMonth] = extremes(months);
  /* institutions: the chips filter them by kind */
  const kinds = [...new Set(insts.map(i => i.kind).filter(Boolean))];
  const kindCount = Object.fromEntries(kinds.map(k => [k, insts.filter(i => i.kind === k).length]));
  kinds.sort((a, b) => kindCount[b] - kindCount[a] || bg(a, b));
  const vid = kinds.includes(q.vid) ? q.vid : '';
  const instSel = vid ? insts.filter(i => i.kind === vid) : insts;
  /* recipients: a number (with or without „ЕИК“) looks at the ЕИК, any other text at the name, the kind of activity and the subject */
  const qs = clean(q.q);
  const mm = /^(?:еик\s*:?\s*)?(\d[\d ]*)$/i.exec(qs);
  const digits = mm ? mm[1].replace(/\s+/g, '') : '';
  const needle = lower(qs);
  const hit = r => !qs || (digits ? r.eik.includes(digits) : lower(`${r.name} ${r.kind ?? ''} ${r.subject ?? ''}`).includes(needle));
  const recSel = recs.filter(hit).sort((a, b) => b.eur - a.eur || bg(a.name, b.name));
  const withContract = recs.filter(r => ok(r.contractedEur) && ok(r.paidEur));
  const whyOf = list => String(list[0]?.why || WHY);
  return {
    months, daily, types, insts, recs, total, from, to, monthList, sel, obem, monthDays,
    peak, quiet, mpeak, mquiet, topMonth, lowMonth,
    avgEur: total.days > 0 ? total.eur / total.days : null,
    avgCount: total.days > 0 ? total.count / total.days : null,
    kinds, kindCount, vid, instSel, qs, digits, recSel,
    withContract, contracted: sum(withContract, 'contractedEur'), paid: sum(withContract, 'paidEur'),
    topContracts: [...withContract].sort((a, b) => b.contractedEur - a.contractedEur).slice(0, 8),
    top: [...recs].sort((a, b) => b.eur - a.eur)[0] ?? null,
    why: { months: whyOf(months), daily: whyOf(daily), insts: whyOf(insts), types: whyOf(types), recs: whyOf(recs) },
    constrainedBy: arr(d.meta?.constrainedBy).filter(s => typeof s === 'string' && s.trim()),
    recipientsNote: typeof d.meta?.recipientsNote === 'string' ? d.meta.recipientsNote : ''
  };
}

function model(ctx) {
  const q = ctx.query || {};
  return {
    lv: !!ctx.store.get('leva'),
    onlyReal: !!ctx.store.get('onlyReal'),
    real: realModel(ctx.data?.sebra),
    mock: mockModel(ctx.data?.['mock/payments'], q)
  };
}

/* ---------------------------------------------------------------- shared pieces */
const joinBg = list => (list.length < 2 ? list[0] ?? '' : `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`);
/** a block whose data file has not landed: its own pending state (never a made-up number) */
const pendingBlock = (id, title, text) => block({ id, title, status: 'pending', share: false, body: pendingState({ title: 'Данните още не са готови', text }) });
const wrap = (...parts) => html`<div class="s23-stack">${parts}</div>`;
const read = text => html`<p class="s23-read">${text}</p>`;

/* ---------------------------------------------------------------- the real block: the daily summary of the ministry */
/** every published day and every kind of payment, as the table of the block (CSV and „Сподели“) */
function realCsv(R) {
  return {
    columns: ['Дата', 'Код на категорията', 'Категория', 'Плащания', 'Сума, €'],
    rows: R.days.flatMap(day => (day.cats.length ? day.cats.map(c => [day.date, c.code, c.name, c.count, c.eur]) : [[day.date, '', '', day.count, day.eur]]))
  };
}

/** two sentences on how different the days are (only when it is true: at least twice as big) */
function spreadText(R, lv) {
  if (R.days.length < 2 || R.big === R.small || R.big.eur === R.small.eur) return '';
  const top = R.big.cats[0];
  const inner = top && R.big.cats.length > 1 ? `, от които ${eurText(top.eur, 2, lv)} за „${top.name}“` : '';
  const first = `На ${dayG(R.big.date)} е платено най-много: ${eurText(R.big.eur, 2, lv)}${inner}. На ${dayG(R.small.date)} е платено най-малко: ${eurText(R.small.eur, 2, lv)}.`;
  return R.ratio !== null && R.ratio >= 2 ? `${first} Най-големият ден е около ${num(R.ratio, 0)} пъти по-голям от най-малкия, затова един ден не показва колко плаща министерството.` : first;
}

function realBlock(R, lv) {
  const h = R.head;
  const day = dayG(h.date);
  const top = h.cats[0];
  const many = h.cats.length > 1;
  const tiles = kpiGrid([
    kpi({ label: 'Брой плащания', value: num(h.count, 0), unit: h.count === 1 ? 'плащане' : 'плащания', sub: `На ${day}` }),
    kpi({ label: 'Общо платено', value: num(h.eur, 2), unit: '€', sub: lv ? `≈ ${leva(h.eur * EUR_RATE, 2)}` : null }),
    top ? kpi({ label: many ? 'Най-голям вид плащане' : 'За какво', value: top.name, unit: '', sub: many ? `${eurText(top.eur, 2, lv)} от общата сума` : 'Всички плащания за деня са от този вид.' }) : null
  ].filter(Boolean), { label: `Плащанията на ${day} накратко` });
  const intro = wrap(
    read(`СЕБРА е системата, през която бюджетните организации извършват плащанията си. ${R.publisher || 'Министерството'} публикува на страницата си дневни обобщения от нея.`),
    read(`Това е обобщението за ${day}: ${count(h.count)} за ${eurText(h.eur, 2, lv)}${top && !many ? `, всички за „${top.name}“` : ''}. В него пише колко е платено, по вид плащане и по институция. На кого са платени парите, не пише.`)
  );
  const orgs = h.orgs.length ? ranklist({
    id: 's23-r-orgs', label: `Плащания на ${day} по институции`, unit: 'num', d: 2, shares: true, categoryLabel: 'Институция', unitLabel: '€',
    fmt: v => eurText(v, 2, lv),
    items: h.orgs.map(o => ({ label: o.name, sub: count(o.count), value: o.eur }))
  }) : '';
  const dayDates = R.days.map(x => `${+x.date.slice(8)} ${monthName(+x.date.slice(5, 7))}`);
  const daysList = ranklist({
    id: 's23-r-days', label: 'Публикувани дни', unit: 'num', d: 2, categoryLabel: 'Ден', unitLabel: '€',
    fmt: v => eurText(v, 2, lv),
    items: R.days.map(x => ({
      label: dayG(x.date), sub: count(x.count), value: x.eur,
      children: x.cats.map(c => ({ label: c.name, sub: count(c.count), value: c.eur }))
    }))
  });
  const spread = spreadText(R, lv);
  const lag = R.lag(h.date), listed = R.listed(h.date);
  const notes = disclosure({
    id: 's23-real-notes', title: 'Какво трябва да знаеш за тези данни',
    body: wrap(
      R.notes.length ? html`<ul class="s23-list">${R.notes.map(n => html`<li>${n}</li>`)}</ul>` : '',
      listed && ok(lag) ? read(`Обобщението за ${day} е качено на страницата на ${date(listed, true)} г., тоест ${plural(lag, 'ден', 'дни')} след деня на плащанията.`) : '',
      R.page ? html`<p>${ext(R.page, 'Страницата с документите')}</p>` : ''
    )
  });
  return block({
    id: 's23-real', title: `Официални данни: плащанията на ${day}`, scope: SCOPE_REAL, source: REAL_SRC, asOf: h.date,
    share: { text: `${count(h.count)} за ${eur(h.eur, 2)} на ${day} (официални данни от СЕБРА).`, table: () => realCsv(R) },
    body: wrap(
      tiles, intro,
      orgs ? html`<h3 class="s23-h3">По институции</h3>${orgs}` : '',
      html`<h3 class="s23-h3">Публикуваните дни</h3>`,
      read(`Страницата показва само ${plural(R.days.length, 'ден', 'дни')} (${joinBg(dayDates)}). Това не е цял месец: тези дни не показват колко е платено през август.`),
      daysList,
      spread ? read(spread) : '',
      notes
    )
  });
}

/* ---------------------------------------------------------------- the mock blocks */
const banner = hasReal => callout({
  kind: 'warn', icon: 'hatch', id: 's23-banner',
  title: hasReal ? 'Официално е само едно дневно обобщение. Останалото са примери.' : 'Всичко на тази страница са примери.',
  body: hasReal
    ? 'Официалните файлове за плащанията показват само суми по дни, вид плащане и институция. Получатели в тях няма. Затова търсенето, списъците и страниците на получателите по-долу са измислени примери, ясно отбелязани с щрихи.'
    : 'Търсенето, списъците и страниците на получателите са измислени примери, ясно отбелязани с щрихи.'
});
const mockBlock = (M, id, title, why, o) => block({ id, title, mock: true, why, source: MOCK_SRC, asOf: M.to, scope: SCOPE_MOCK, ...o });
const levaCol = lv => (lv ? [{ key: 'lv', label: 'Платено', unit: 'млн. лв.', d: 2, num: true }] : []);

/* --- „Колко се плаща на ден“: four numbers, then the months and the days in two tabs */
const obemCsv = M => ({ columns: ['Дата', 'Платено, €', 'Плащания'], rows: M.daily.map(x => [x.date, x.eur, x.count]) });
const monthsText = (M, lv) => (M.topMonth && M.lowMonth && M.topMonth !== M.lowMonth
  ? `Най-много е платено през ${monthLabel(M.topMonth.month)}: ${bigText(M.topMonth.eur, lv)}. Най-малко е платено през ${monthLabel(M.lowMonth.month)}: ${bigText(M.lowMonth.eur, lv)}.` : '');
function daysText(M, lv) {
  const n = M.monthDays.length;
  if (!n) return '';
  const head = `През ${monthLabel(M.sel)} има ${plural(n, 'работен ден', 'работни дни')}. Показани са само работните дни.`;
  if (n < 2 || M.mpeak === M.mquiet) return head;
  return `${head} Най-много е платено на ${dayG(M.mpeak.date)}: ${bigText(M.mpeak.eur, lv)} и ${count(M.mpeak.count)}. Най-малко е платено на ${dayG(M.mquiet.date)}: ${bigText(M.mquiet.eur, lv)} и ${count(M.mquiet.count)}.`;
}

function obemBlock(M, lv) {
  const title = 'Колко се плаща на ден';
  if (!M.months.length && !M.daily.length) return pendingBlock('s23-obem', title, 'Дневният обем на примерните плащания още не е зареден.');
  const tile = (label, v, sub) => { const p = bigParts(v); return kpi({ label, value: p.v, unit: p.u, mock: true, sub: [sub, levaSub(v, lv)].filter(Boolean).join(' · ') || null }); };
  const period = M.from && M.to ? ` от ${date(M.from)} до ${date(M.to)}` : '';
  const tiles = kpiGrid([
    tile('Общо платено', M.total.eur, `${count(M.total.count)}${period}`),
    ok(M.avgEur) ? tile('Средно на работен ден', M.avgEur, `${count(Math.round(M.avgCount))} на ден`) : null,
    M.peak ? tile('Най-натоварен ден', M.peak.eur, `${dayG(M.peak.date)} · ${count(M.peak.count)}`) : null,
    M.quiet ? tile('Най-тих ден', M.quiet.eur, `${dayG(M.quiet.date)} · ${count(M.quiet.count)}`) : null
  ].filter(Boolean), { label: 'Обемът на примерните плащания накратко' });
  /* tab 1: the months */
  const mSpec = M.months.length ? {
    id: 's23-months', type: 'bar', title: 'Платено по месеци', sub: 'В милиони евро (млн. €).', unit: 'млн. €', d: 0, labels: true, mock: true, categoryLabel: 'Месец',
    categories: M.months.map(m => cap(monthName(+m.month.slice(5), true))),
    series: [{ name: 'Платено', data: M.months.map(m => m.eur / 1e6), mock: true }],
    desc: `Сумата на примерните плащания за всеки месец от ${monthLabel(M.months[0].month)} до ${monthLabel(M.months[M.months.length - 1].month)}.`,
    table: {
      columns: [{ key: 'c', label: 'Месец' }, { key: 'v', label: 'Платено', unit: 'млн. €', d: 1, num: true }, { key: 'n', label: 'Плащания', d: 0, num: true }],
      rows: M.months.map(m => ({ c: cap(monthLabel(m.month)), v: m.eur / 1e6, n: m.count, _mock: true }))
    }
  } : null;
  const monthsBody = mSpec
    ? wrap(chart(mSpec), monthsText(M, lv) ? read(monthsText(M, lv)) : '')
    : emptyState({ title: 'Няма данни по месеци', text: 'Примерните плащания по месеци още не са заредени.' });
  /* tab 2: the working days of one month */
  const days = M.monthDays;
  const dSpec = days.length ? {
    id: 's23-days', type: 'bar', title: `Платено по дни през ${monthLabel(M.sel)}`, sub: 'В милиони евро (млн. €).', unit: 'млн. €', d: 1, mock: true, categoryLabel: 'Ден',
    categories: days.map(x => dayLabel(x.date)),
    series: [{ name: 'Платено', data: days.map(x => x.eur / 1e6), mock: true }],
    desc: `Само работните дни на ${monthLabel(M.sel)}.`,
    table: {
      columns: [{ key: 'c', label: 'Ден' }, { key: 'v', label: 'Платено', unit: 'млн. €', d: 1, num: true }, { key: 'n', label: 'Плащания', d: 0, num: true }],
      rows: days.map(x => ({ c: date(x.date), v: x.eur / 1e6, n: x.count, _mock: true }))
    }
  } : null;
  const pick = M.monthList.length ? html`<div class="s23-pick">${field({ id: 's23-mesec', label: 'Месец', control: selectInput({ id: 's23-mesec', name: 'mesec', value: M.sel, options: M.monthList.map(ym => ({ value: ym, label: cap(monthLabel(ym)) })), query: 'mesec' }) })}</div>` : '';
  const daysBody = wrap(
    pick,
    dSpec ? chart(dSpec) : emptyState({ title: 'Няма плащания през този месец', text: 'За избрания месец в примерните данни няма работни дни.' }),
    daysText(M, lv) ? read(daysText(M, lv)) : ''
  );
  return mockBlock(M, 's23-obem', title, M.why.daily, {
    share: { text: `Примерни данни: ${count(M.total.count)} за ${bigText(M.total.eur, false)}${period}.`, table: () => obemCsv(M) },
    body: wrap(tiles, tabs({
      id: 's23-obem-tabs', label: 'Обем на плащанията', query: 'obem', active: M.obem,
      tabs: [{ key: 'meseci', label: 'По месеци', body: monthsBody }, { key: 'dni', label: 'По дни', body: daysBody }]
    }))
  });
}

/* --- „Плащания по институции“: the biggest ten, the kinds as filters, all of them in a table */
const instCsv = (M, list) => ({
  columns: ['Код', 'Институция', 'Вид', 'Платено, €', 'Плащания', 'Дял от всички плащания, %'],
  rows: list.map(i => [i.id, i.name, kindOne(i.kind), i.eur, i.count, pctOf(i.eur, M.total.eur)])
});

function instBlock(ctx, M, lv) {
  const title = 'Плащания по институции';
  if (!M.insts.length) return pendingBlock('s23-institutsii', title, 'Примерните плащания по институции още не са заредени.');
  const list = M.instSel, total = M.total.eur;
  const short = i => (i.name.length <= 44 ? i.name : i.short || i.name);
  const top = list.slice(0, 10);
  const topSum = top.reduce((a, i) => a + i.eur, 0), allSum = list.reduce((a, i) => a + i.eur, 0);
  const lead = [
    M.vid ? `${list.length === 1 ? 'Показана е 1 институция' : `Показани са ${plural(list.length, 'институция', 'институции')}`} от вида „${kindOf(M.vid)}“.` : '',
    `Най-много плаща ${short(list[0])}: ${bigText(list[0].eur, lv)}, или ${shareText(pctOf(list[0].eur, total))} от всички примерни плащания.`,
    list.length > top.length ? `Първите ${top.length} от тях заедно плащат ${shareText(pctOf(topSum, total))} от всички.` : M.vid && list.length > 1 ? `Заедно те плащат ${shareText(pctOf(allSum, total))} от всички примерни плащания.` : ''
  ].filter(Boolean).join(' ');
  const kinds = M.kinds.length >= 2 ? chips({
    id: 's23-vid', label: 'Вид институция',
    items: [{ label: 'Всички', count: M.insts.length, query: 'vid=', pressed: !M.vid }, ...M.kinds.map(k => ({ label: kindOf(k), count: M.kindCount[k], query: `vid=${k}`, pressed: M.vid === k }))]
  }) : '';
  const rank = ranklist({
    id: 's23-r-inst', caption: list.length > top.length ? `Първите ${top.length} институции по платена сума` : 'Институциите по платена сума',
    unit: 'num', d: 2, categoryLabel: 'Институция', unitLabel: 'млн. €', mock: true,
    fmt: v => money(v, { scale: 'mln', leva: lv }),
    items: top.map(i => ({ label: short(i), sub: short(i) !== i.name ? `${i.name} · ${count(i.count)}` : count(i.count), value: i.eur / 1e6, share: pctOf(i.eur, total), href: ctx.href('vedomstvo', { code: i.id }), mock: true }))
  });
  const columns = [
    { key: 'name', label: 'Институция' }, { key: 'kind', label: 'Вид' },
    { key: 'mln', label: 'Платено', unit: 'млн. €', d: 2, num: true }, ...levaCol(lv),
    { key: 'count', label: 'Плащания', d: 0, num: true }, { key: 'share', label: 'Дял от всички', fmt: shareText, num: true }
  ];
  const rows = list.map(i => ({ name: short(i), kind: kindOne(i.kind), mln: i.eur / 1e6, lv: (i.eur * EUR_RATE) / 1e6, count: i.count, share: pctOf(i.eur, total), _mock: true, _href: ctx.href('vedomstvo', { code: i.id }) }));
  const table = disclosure({
    id: 's23-inst-table', title: 'Таблица с институциите',
    body: dataTable({ id: 's23-t-inst', caption: 'Примерни плащания по институции', columns, rows, sortable: true, sortBy: 'mln', dir: 'desc', status: 'mock' })
  });
  return mockBlock(M, 's23-institutsii', title, M.why.insts, {
    share: { text: `Примерни данни: ${lead}`, table: () => instCsv(M, list) },
    body: wrap(kinds, read(lead), rank, table)
  });
}

/* --- „Плащания по видове“ */
function typesBlock(M, lv) {
  const title = 'Плащания по видове';
  if (!M.types.length) return pendingBlock('s23-vidove', title, 'Примерните плащания по видове още не са заредени.');
  const total = M.types.reduce((a, t) => a + t.eur, 0);
  const top = [...M.types].sort((a, b) => b.eur - a.eur)[0];
  const rank = ranklist({
    id: 's23-r-types', caption: 'За какво се плаща', unit: 'num', d: 1, shares: true, sort: 'desc', categoryLabel: 'Вид плащане', unitLabel: 'млн. €', mock: true,
    fmt: v => money(v, { scale: 'mln', leva: lv }),
    items: M.types.map(t => ({ label: t.name, sub: TYPE_TEXT[t.code] ? `${count(t.count)} · ${TYPE_TEXT[t.code]}` : count(t.count), value: t.eur / 1e6, mock: true }))
  });
  const lead = `Най-голям е видът „${top.name}“: ${shareText(pctOf(top.eur, total))} от всички примерни плащания.`;
  return mockBlock(M, 's23-vidove', title, M.why.types, {
    share: { text: `Примерни данни: ${lead}`, table: () => ({ columns: ['Вид плащане', 'Платено, €', 'Плащания', 'Дял от плащанията, %'], rows: M.types.map(t => [t.name, t.eur, t.count, pctOf(t.eur, total)]) }) },
    body: wrap(rank, read(lead), read(html`Повече за ${gl('kapitalovi-razhodi', 'капиталовите разходи')} и ${gl('subsidiya', 'субсидиите')} има в речника.`))
  });
}

/* --- „Търсене на получател по ЕИК“: one field (digits look at the ЕИК, other text at the name), the table of what was found */
const RECS = n => plural(n, 'примерен получател', 'примерни получатели');
const recCsv = list => ({
  columns: ['ЕИК', 'Получател', 'Вид дейност', 'Предмет на договора', 'Платено през 2026, €', 'Плащания', 'Договорено, €', 'Платено по договора досега, €'],
  rows: list.map(r => [r.eik, r.name, r.kind ?? '', r.subject ?? '', r.eur, r.count, ok(r.contractedEur) ? r.contractedEur : '', ok(r.paidEur) ? r.paidEur : ''])
});
const recSpec = M => ({ id: 's23-poluchateli', route: 'plashtania', source: MOCK_SRC, status: 'mock', mock: true, asOf: M.to, table: () => recCsv(M.recSel) });
function recCount(M) {
  const all = M.recs.length, n = M.recSel.length;
  if (!M.qs) return all === 1 ? 'Показан е 1 примерен получател.' : `Показани са всички ${RECS(all)}.`;
  if (!n) return `Няма получател за „${M.qs}“.`;
  return n === 1 ? `Намерен е 1 от ${RECS(all)}.` : `Намерени са ${num(n, 0)} от ${RECS(all)}.`;
}
/** the order of the table: what the address says (only a column that exists), else the biggest first */
function recSort(q, lv) {
  const key = SORT_KEYS.includes(q.sort) && (q.sort !== 'lv' || lv) ? q.sort : '';
  return key ? { sortBy: key, dir: q.dir === 'desc' ? 'desc' : 'asc' } : { sortBy: 'eur', dir: 'desc' };
}

function searchBlock(ctx, M, lv) {
  const title = 'Търсене на получател по ЕИК';
  if (!M.recs.length) return pendingBlock('s23-poluchateli', title, 'Примерните получатели още не са заредени.');
  const list = M.recSel;
  const hint = M.top ? `Пиши цифрите на ЕИК или част от името. Например: ${M.top.eik}.` : 'Пиши цифрите на ЕИК или част от името.';
  const form = html`<form class="s23-find" id="s23-form" role="search" aria-label="Търсене на получател" novalidate>
    <div class="s23-row">
      ${field({ id: 's23-q', label: 'ЕИК или име на получател', hint, control: textInput({ id: 's23-q', name: 'q', value: M.qs, type: 'search', inputmode: 'search', autocomplete: 'off', hint }) })}
      <button class="btn btn-primary" id="s23-go" type="submit">${icon('search', { size: 16 })}<span>Търси</span></button>
    </div>
    <div class="s23-bar">
      <p class="s23-count" id="s23-count">${recCount(M)}</p>
      <div class="s23-actions">
        ${M.qs ? html`<button type="button" class="btn btn-sm btn-quiet" id="s23-clear">${icon('x', { size: 16 })}<span>Изчисти търсенето</span></button>` : ''}
        ${list.length ? html`<button type="button" class="btn btn-sm btn-quiet" id="s23-csv">${icon('download', { size: 16 })}<span>Свали като CSV</span></button>` : ''}
      </div>
    </div>
  </form>`;
  const columns = [
    { key: 'name', label: 'Получател' },
    { key: 'eik', label: 'ЕИК', fmt: v => html`<span class="s23-eik">${v}</span>` },
    { key: 'kind', label: 'Вид дейност' },
    { key: 'eur', label: 'Платено през 2026', unit: '€', d: 0, num: true },
    ...(lv ? [{ key: 'lv', label: 'Платено през 2026', unit: 'лв.', d: 0, num: true }] : []),
    { key: 'count', label: 'Плащания', d: 0, num: true }
  ];
  const rows = list.map(r => ({ name: r.name, eik: r.eik, kind: r.kind ?? '', eur: r.eur, lv: r.eur * EUR_RATE, count: r.count, _mock: true, _href: ctx.href('plashtania', { eik: r.eik }) }));
  const result = list.length
    ? dataTable({ id: 's23-t-rec', caption: 'Примерни получатели на държавни плащания', columns, rows, sortable: true, ...recSort(ctx.query || {}, lv), query: true, status: 'mock' })
    : emptyState({
      title: 'Няма такъв получател',
      text: M.digits.length >= 9
        ? 'Получателите тук са измислени и ЕИК им започва с 999. Официалните файлове за плащанията не показват получателите, затова истински ЕИК не може да се намери.'
        : 'Опитай с други цифри от ЕИК или с друга част от името.'
    });
  const recSum = M.recs.reduce((a, r) => a + r.eur, 0);
  const tail = list.length ? read(`Натисни името, за да отвориш страницата на получателя. Всички ${RECS(M.recs.length)} получават заедно ${bigText(recSum, lv)}: това е само ${shareText(pctOf(recSum, M.total.eur))} от примерните плащания.`) : '';
  return mockBlock(M, 's23-poluchateli', title, M.why.recs, {
    sub: 'Всички получатели са измислени: ЕИК започва с 999.',
    share: { text: `Примерни данни: ${recCount(M)}`, table: () => recCsv(M.recSel) },
    body: wrap(form, result, tail)
  });
}

/* --- „Договорено срещу платено“ */
function contractBlock(ctx, M, lv) {
  const title = 'Договорено срещу платено';
  if (!M.withContract.length) return pendingBlock('s23-dogovoreno', title, 'Данните за договорите на примерните получатели още не са заредени.');
  const n = M.withContract.length, left = M.contracted - M.paid, sh = pctOf(M.paid, M.contracted);
  const tile = (label, v, sub) => { const p = bigParts(v); return kpi({ label, value: p.v, unit: p.u, mock: true, sub: [sub, levaSub(v, lv)].filter(Boolean).join(' · ') || null }); };
  const tiles = kpiGrid([
    tile('Договорено общо', M.contracted, `По договорите на ${RECS(n)}`),
    tile('Платено досега', M.paid, 'Вече излязло от сметките'),
    kpi({ label: 'Платено от договореното', value: ok(sh) ? num(sh, 1) : '—', unit: '%', mock: true, sub: left > 0 ? `Остава за плащане: ${bigText(left, lv)}.` : null })
  ], { label: 'Договорено и платено накратко' });
  const top = M.topContracts;
  const spec = {
    id: 's23-dog', type: 'barh', title: 'Най-големите договори', sub: 'В милиони евро (млн. €).', unit: 'млн. €', d: 1, mock: true, legend: true, categoryLabel: 'Получател',
    labelWidth: 'auto', labelOverflow: 'break', height: Math.max(360, top.length * 64 + 80),
    /* whole numbers on the value axis and no two labels on top of each other at 400 px; the tooltip and the table keep the decimal */
    option: { xAxis: { axisLabel: { formatter: v => num(v, 0), hideOverlap: true } } },
    categories: top.map(r => r.name),
    series: [
      { name: 'Договорено', data: top.map(r => r.contractedEur / 1e6), mock: true },
      { name: 'Платено досега', data: top.map(r => r.paidEur / 1e6), mock: true }
    ],
    desc: `Сумата по договора и колкото вече е платено за ${plural(top.length, 'получател', 'получателя')} с най-големи договори.`,
    table: {
      columns: [
        { key: 'c', label: 'Получател' }, { key: 'e', label: 'ЕИК' },
        { key: 'a', label: 'Договорено', unit: 'млн. €', d: 1, num: true }, { key: 'b', label: 'Платено досега', unit: 'млн. €', d: 1, num: true },
        { key: 'p', label: 'Платено от договореното', fmt: shareText, num: true }
      ],
      rows: top.map(r => ({ c: r.name, e: r.eik, a: r.contractedEur / 1e6, b: r.paidEur / 1e6, p: pctOf(r.paidEur, r.contractedEur), _mock: true, _href: ctx.href('plashtania', { eik: r.eik }) }))
    }
  };
  const explain = html`<div class="prose s23-read">
    <p>„Договорено“ е сумата, записана в договора за ${gl('obshtestvena-porachka', 'обществена поръчка')}. Договорите се водят в ЦАИС ЕОП, държавната система за обществените поръчки.</p>
    <p>„Платено“ е сумата, която вече е излязла от сметките на институцията ${gl('kasova-osnova', 'на касова основа')}: плащанията стават на части, докато договорът върви. Затова платеното е по-малко от договореното, докато работата не приключи.</p>
  </div>`;
  return mockBlock(M, 's23-dogovoreno', title, M.withContract[0]?.why || WHY, {
    sub: 'Колко е договорено с изпълнителите и колко от него вече е платено.',
    share: { text: `Примерни данни: договорено ${bigText(M.contracted, false)}, платено досега ${bigText(M.paid, false)}.`, table: () => ({ columns: ['ЕИК', 'Получател', 'Договорено, €', 'Платено досега, €'], rows: M.withContract.map(r => [r.eik, r.name, r.contractedEur, r.paidEur]) }) },
    body: wrap(tiles, chart(spec), explain)
  });
}

/* --- „Как да четеш числата“ */
function howBlock(R, M, onlyReal) {
  const parts = [];
  if (R) parts.push(html`<p>В официалните файлове има само суми: за деня, за всеки вид плащане и за всяка институция. Получатели и отделни плащания в тях няма, затова от тях не може да се види кой е получил парите.</p>`);
  parts.push(html`<p>Сумите са в евро. „Млн. €“ са милиони евро, „млрд. €“ са милиарди евро.</p>`);
  if (M && !onlyReal) {
    parts.push(html`<p>Примерите показват как ще изглежда екранът, когато има данни за получателите. Те не са отчет на нито една институция.</p>`);
    const made = [
      ...(M.constrainedBy.length ? [html`<ul class="s23-list">${M.constrainedBy.map(s => html`<li>${s}</li>`)}</ul>`] : []),
      ...(M.recipientsNote ? [html`<p>${M.recipientsNote}</p>`] : [])
    ];
    if (made.length) parts.push(disclosure({ id: 's23-how-made', title: 'Как са направени примерите', body: html`<div class="s23-stack">${made}</div>` }));
  }
  return block({ id: 's23-chetene', title: 'Как да четеш числата', status: false, share: false, body: html`<div class="prose s23-read s23-stack">${parts}</div>` });
}

/* ---------------------------------------------------------------- the list */
function listPage(ctx, md) {
  const { real: R, mock: M, lv, onlyReal } = md;
  const realPart = R ? realBlock(R, lv) : pendingBlock('s23-real', 'Официални данни: дневно обобщение на плащанията', 'Официалното дневно обобщение на плащанията още не е заредено.');
  let mockPart;
  if (!M) mockPart = pendingBlock('s23-primeri', 'Примерни плащания', 'Примерните данни за плащанията още не са заредени.');
  else if (onlyReal) mockPart = block({ id: 's23-primeri', title: 'Примерни данни за плащанията', mock: true });
  else mockPart = html`${obemBlock(M, lv)}${instBlock(ctx, M, lv)}${typesBlock(M, lv)}${searchBlock(ctx, M, lv)}${contractBlock(ctx, M, lv)}`;
  return html`${M && !onlyReal ? banner(!!R) : ''}${realPart}${mockPart}${howBlock(R, M, onlyReal)}`;
}

/* ---------------------------------------------------------------- one recipient */
const eikOf = ctx => String(ctx.params?.eik ?? '').replace(/\s+/g, '');
const findRec = (M, eik) => (M ? M.recs.find(x => x.eik === eik) ?? null : null);

export function crumbs(ctx) {
  if (!ctx.params?.eik) return null;
  const md = model(ctx);
  const r = findRec(md.mock, eikOf(ctx));
  return [{ label: 'Кой на кого плаща?', href: ctx.href('plashtania') }, { label: r && !md.onlyReal ? r.name : 'Получател' }];
}

function detailPage(ctx, md) {
  const M = md.mock, lv = md.lv;
  if (!M) return pendingState({ title: 'Предстои', text: 'Данните за примерните получатели още не са заредени.' });
  const r = findRec(M, eikOf(ctx));
  if (!r) ctx.notFound();
  const why = String(r.why || WHY);
  const back = html`<p class="s23-links"><a class="btn btn-quiet" href="${ctx.href('plashtania')}">Всички примерни получатели</a></p>`;
  if (md.onlyReal) {
    return {
      lede: 'Страниците на получателите са с примерни данни.',
      body: html`${block({ id: 's23-d-nakratko', title: 'Страница на примерен получател', mock: true })}${back}`
    };
  }
  const paidSh = pctOf(r.paidEur, r.contractedEur);
  const tile = (label, v, sub) => { const p = bigParts(v); return kpi({ label, value: p.v, unit: p.u, mock: true, sub: [sub, levaSub(v, lv)].filter(Boolean).join(' · ') || null }); };
  const period = M.from && M.to ? `От ${date(M.from)} до ${date(M.to)}` : '';
  const tiles = kpiGrid([
    tile('Платено през 2026', r.eur, period),
    kpi({ label: 'Брой плащания', value: num(r.count, 0), unit: r.count === 1 ? 'плащане' : 'плащания', mock: true, sub: period || null }),
    ok(r.contractedEur) ? tile('Договорено', r.contractedEur, 'Сумата по договора') : null,
    ok(r.paidEur) ? tile('Платено по договора досега', r.paidEur, ok(paidSh) ? `${shareText(paidSh)} от договореното` : '') : null
  ].filter(Boolean), { label: 'Основни числа за получателя' });
  const facts1 = facts([
    { k: 'ЕИК', v: `${r.eik} (измислен)` },
    ...(r.kind ? [{ k: 'Вид дейност', v: r.kind }] : []),
    ...(r.subject ? [{ k: 'Предмет на договора', v: r.subject }] : [])
  ]);
  const prog = ok(paidSh) ? progress({ id: 's23-d-p', label: 'Платено от договореното', value: r.paidEur, max: r.contractedEur, text: shareText(paidSh), mock: true }) : '';
  const summary = mockBlock(M, 's23-d-nakratko', 'Накратко за получателя', why, {
    sub: 'Получателят е измислен: такава фирма или организация няма.',
    share: { text: `${r.name} (измислен получател): платено през 2026 ${bigText(r.eur, false)}, ${count(r.count)}.` },
    body: wrap(
      tiles, prog, facts1,
      html`<p class="s23-links"><button type="button" class="btn btn-sm btn-quiet" id="s23-d-copy" data-s23-copy="${r.eik}">${icon('copy', { size: 16 })}<span>Копирай линк</span></button><a class="btn btn-quiet btn-sm" href="${ctx.href('plashtania')}">Всички примерни получатели</a></p>`
    )
  });

  /* who pays him */
  const byInst = arr(r.byInstitution).filter(x => x && x.name && ok(x.eur)).sort((a, b) => b.eur - a.eur);
  const instByName = new Map(M.insts.map(i => [i.name, i]));
  const sumInst = byInst.reduce((a, x) => a + x.eur, 0);
  const instLead = byInst.length === 1
    ? `Всички плащания към този получател идват от една институция: ${byInst[0].name}.`
    : byInst.length > 1 ? `Най-много плаща ${byInst[0].name}: ${bigText(byInst[0].eur, lv)}, или ${shareText(pctOf(byInst[0].eur, sumInst))} от парите към този получател.` : '';
  const institutions = byInst.length
    ? mockBlock(M, 's23-d-institucii', 'Кой му плаща', why, {
      share: { text: `${r.name} (измислен получател): ${instLead}` },
      body: wrap(read(instLead), ranklist({
        id: 's23-d-r-inst', caption: 'Институции, които плащат на получателя', unit: 'num', d: 1, shares: true, sort: 'desc', categoryLabel: 'Институция', unitLabel: 'млн. €', mock: true,
        fmt: v => money(v, { scale: 'mln', leva: lv }),
        items: byInst.map(x => ({ label: x.name, value: x.eur / 1e6, mock: true, href: instByName.has(x.name) ? ctx.href('vedomstvo', { code: instByName.get(x.name).id }) : undefined }))
      }))
    })
    : '';

  /* what for */
  const byTyp = arr(r.byType).filter(x => x && x.name && ok(x.eur)).sort((a, b) => b.eur - a.eur);
  const sumTyp = byTyp.reduce((a, x) => a + x.eur, 0);
  const kinds = byTyp.length >= 2
    ? mockBlock(M, 's23-d-vidove', 'За какво се плаща', why, {
      share: { text: `${r.name} (измислен получател): най-голям е видът „${byTyp[0].name}“, ${shareText(pctOf(byTyp[0].eur, sumTyp))} от плащанията към него.` },
      body: wrap(read(`Най-голям е видът „${byTyp[0].name}“: ${shareText(pctOf(byTyp[0].eur, sumTyp))} от плащанията към този получател.`), ranklist({
        id: 's23-d-r-types', caption: 'За какво плащат на получателя', unit: 'num', d: 1, shares: true, sort: 'desc', categoryLabel: 'Вид плащане', unitLabel: 'млн. €', mock: true,
        fmt: v => money(v, { scale: 'mln', leva: lv }),
        items: byTyp.map(x => ({ label: x.name, value: x.eur / 1e6, mock: true }))
      }))
    })
    : byTyp.length === 1
      ? mockBlock(M, 's23-d-vidove', 'За какво се плаща', why, { body: read(`Всички плащания към този получател са от един вид: „${byTyp[0].name}“.`) })
      : '';

  /* the latest payments */
  const recent = arr(r.recent).filter(x => x && Number.isFinite(dayN(x.date)) && ok(x.eur)).sort((a, b) => dayN(b.date) - dayN(a.date));
  const latest = recent.length
    ? mockBlock(M, 's23-d-posledni', 'Последни плащания', why, {
      sub: `Последните ${plural(recent.length, 'плащане', 'плащания')} към този получател, от най-новото към най-старото.`,
      share: { text: `${r.name} (измислен получател): ${plural(recent.length, 'последно плащане', 'последни плащания')}.`, table: () => ({ columns: ['Дата', 'Институция', 'Вид плащане', 'Сума, €'], rows: recent.map(x => [x.date, x.institution ?? '', x.type ?? '', x.eur]) }) },
      body: dataTable({
        id: 's23-d-t-recent', caption: 'Последни плащания към получателя', status: 'mock',
        columns: [
          { key: 'date', label: 'Дата', fmt: v => date(v) }, { key: 'institution', label: 'Институция' }, { key: 'type', label: 'Вид плащане' },
          { key: 'eur', label: 'Сума', unit: '€', d: 0, num: true },
          ...(lv ? [{ key: 'lv', label: 'Сума', unit: 'лв.', d: 0, num: true }] : [])
        ],
        rows: recent.map(x => ({ date: x.date, institution: x.institution ?? '', type: x.type ?? '', eur: x.eur, lv: x.eur * EUR_RATE, _mock: true }))
      })
    })
    : '';
  return {
    title: r.name,
    lede: 'Един измислен получател на държавни пари: колко е договорено, колко е платено и кой му плаща.',
    body: html`${summary}${institutions}${kinds}${latest}`
  };
}

/* ---------------------------------------------------------------- the screen */
export const needs = ['sebra?', 'mock/payments?'];
export const styles = ['s23-plashtania'];
export const periods = ['2026.draft', '2026.law'];
export const lede = ctx => (ctx.params?.eik
  ? 'Един измислен получател на държавни пари: колко е договорено, колко е платено и кой му плаща.'
  : 'Виж как държавата плаща: колко пари излизат за ден, на кого и за какво. Официално е само едно дневно обобщение, останалото са примери.');

export function render(ctx) {
  const md = model(ctx);
  if (!md.real && !md.mock) return pendingState({ title: 'Предстои', text: 'Данните за плащанията още не са заредени.' });
  return ctx.params?.eik ? detailPage(ctx, md) : listPage(ctx, md);
}

/* ---------------------------------------------------------------- the live part: search, announcements, copy link, CSV */
export function mount(root, ctx) {
  const md = model(ctx);
  const M = md.mock;
  const offs = [];
  const on = (type, fn) => { root.addEventListener(type, fn); offs.push(() => root.removeEventListener(type, fn)); };
  const say = msg => { try { ctx.announce?.(msg); } catch { /* the live region is a courtesy */ } };
  const val = id => root.querySelector(`#${id}`)?.value ?? '';
  /* the model as it will be after a change of the address: the delegated handlers update the address after this code has run */
  const next = q => mockModel(ctx.data?.['mock/payments'], { ...(ctx.query || {}), ...q });

  on('submit', e => {
    const form = e.target instanceof Element ? e.target.closest('#s23-form') : null;
    if (!form) return;
    e.preventDefault();
    if (!M) return;
    const v = clean(val('s23-q'));
    ctx.setQuery({ q: v || null }, { rerender: true });
    const n = next({ q: v });
    if (n) say(recCount(n));
  });

  on('change', e => {
    const t = e.target instanceof Element ? e.target.closest('#s23-mesec') : null;
    if (!t || !M) return;
    const n = next({ mesec: t.value, obem: 'dni' });
    if (n) say(`${cap(monthLabel(n.sel))}: ${plural(n.monthDays.length, 'работен ден', 'работни дни')}.`);
  });

  on('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !M) return;
    const chip = t.closest('button[data-query^="vid="]');
    if (chip) {
      const n = next({ vid: chip.dataset.query.slice(4) });
      if (n) say(`${n.instSel.length === 1 ? 'Показана е 1 институция' : `Показани са ${plural(n.instSel.length, 'институция', 'институции')}`}${n.vid ? ` от вида „${kindOf(n.vid)}“` : ''}.`);
      return;
    }
    if (t.closest('#s23-clear')) {
      root.querySelector('#s23-q')?.focus();                  // the button disappears with the search: keep the focus on the field
      ctx.setQuery({ q: null }, { rerender: true });
      const n = next({ q: '' });
      say(`Търсенето е изчистено.${n ? ` ${recCount(n)}` : ''}`);
      return;
    }
    if (t.closest('#s23-csv')) {
      download(new Blob([csvFor(recSpec(M))], { type: 'text/csv;charset=utf-8' }), 'bns-poluchateli.csv');
      toast('CSV файлът се изтегля.');
      return;
    }
    const copy = t.closest('[data-s23-copy]');
    if (copy) {
      const url = new URL(ctx.href('plashtania', { eik: copy.dataset.s23Copy }), location.href).href;
      void copyOrShow(url, 'Връзката е копирана.', 'Копирай връзката към получателя', copy);
    }
  });

  return () => offs.forEach(f => f());
}
