import { expect, it } from 'vitest';
import glossary from '../../../../data/release/glossary.json';
import { match } from '../../client/routes.js';

it('gives every term a definition and resolves related terms and budget links', () => {
  const slugs = new Set(glossary.terms.map((term) => term.slug));
  for (const term of glossary.terms) {
    expect(term.def.trim(), term.slug).not.toBe('');
    for (const related of term.related || []) expect(slugs.has(related.slug), term.slug).toBe(true);
    for (const link of term.see || [])
      expect(
        match(link.href.replace(/^#/, '').split('?')[0]!.split('/').filter(Boolean))?.route.id,
        link.href,
      ).toBeTruthy();
  }
});
