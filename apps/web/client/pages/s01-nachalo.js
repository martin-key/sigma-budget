// S01 · Начало · #/ · V5 (working-group feedback, 2026-10-10). The start page is the v4 opening again, and nothing else, top to bottom:
//   1. «Държавният бюджет на достъпен език» with the lede of 25.10 (the shell draws the eyebrow, the heading and the lede);
//   2. one primary button «Разгледай бюджета за 5 минути» → S04;
//   3. «Изпълнение на плана за 2026 г.»: the very block of «Изпълнение» (js/ui/plan.js), numbers from execution.json through js/exec.js;
//   4. eight question cards: the v4 «Разгледай бюджета» list, without the four cards that are not wanted here (S04, S16, S19, S24).
// No search form, no „Нов си тук?“ row, no intents, no result table: the monthly report is one click away, in «Изпълнение» (S15).
import { html } from '../html.js';
import { icon } from '../icons.js';
import { linkCard } from '../ui/cards.js';
import { planBlock } from '../ui/plan.js';
import { execModel } from '../exec.js';

export const needs = ['core', 'execution'];
export const styles = ['s01-nachalo'];

/** the v4 «Разгледай бюджета» cards, in the v4 order, cut to the eight of the brief: [route, icon, question, one line] */
const ASK = [
  ['S06', 'trendingUp', 'Откъде идват парите?', 'Данъци, осигуровки и други приходи.'],
  ['S07', 'pieChart', 'За какво се харчат?', 'Разходите по функции и по пера.'],
  ['S15', 'gauge', 'Изпълнява ли се планът?', 'Приходи и разходи месец по месец.'],
  ['S18', 'user', 'Колко плащам аз?', 'Калкулатор за заплата и данъци.'],
  ['S10', 'landmark', 'Кой харчи парите?', 'Бюджетите на министерствата и агенциите.'],
  ['S17', 'banknote', 'Колко е държавният дълг?', 'Дългът, лихвите и новото финансиране.'],
  ['S12', 'scale', 'Какво се променя?', 'Мерките в бюджета и техният ефект.'],
  ['S13', 'forecast', 'Накъде върви бюджетът?', 'Проектът за 2027 и прогнозата до 2029 г.'],
];

export function title() {
  return 'Държавният бюджет на достъпен език';
}
export function next() {
  return [];
} // nothing after the last card: the page ends with the questions

/** Primary bill context; monthly execution keeps its actual year. */
export function lede(ctx) {
  return html`Виж <a href="${ctx.href('S06')}">приходите</a> и <a href="${ctx.href('S07')}">разходите</a> по проекта за <span class="nowrap">2027 г.</span> и прогнозата до 2029 г., както и <a href="${ctx.href('S15')}">изпълнението за 2026 г.</a>`;
}

export function render(ctx) {
  // the plan block has its own model: the latest report against the annual plan (it needs no query); an absent report simply leaves the block out
  const plan = planBlock(execModel(ctx.data.execution, {}));
  const body = html`
    <p class="s01-go"><a class="btn btn-primary s01-lead" href="${ctx.href('S04')}"><span>Разгледай бюджета за 5 минути</span>${icon('arrowRight', { size: 18 })}</a></p>
    ${plan}
    <ul class="s01-ask" aria-label="Разгледай бюджета">${ASK.map(([id, ic, q, text]) => html`<li>${linkCard({ href: ctx.href(id), icon: ic, title: q, text })}</li>`)}</ul>`;
  return { body, eyebrow: 'Започни оттук' };
}
