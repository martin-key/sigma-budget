// S37 · Условия за ползване. The copy is client/legal.js, shared with the React screen (app/routes/legal-content.tsx); the team's address comes from
// FEEDBACK_EMAIL (client/feedback.js). No data files, no period (periods: 'none').
import { legalHtml } from '../legal.js';
import { to } from '../feedback.js';

export const needs = [];
export const styles = ['s37-usloviya'];

export function render() {
  return { body: legalHtml('S37', to()) };
}
