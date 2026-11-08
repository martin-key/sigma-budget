import { useSyncExternalStore } from 'react';
import { store, PERIODS } from '../../client/store.js';
import { href, byId } from '../lib/legacy';
import { PageFrame } from '../components/PageFrame';
import { TextState } from '../components/TextState';
import { compactText, fixFiles } from '../components/ScreenTree';
import { pendingState, emptyState, NarrativeNavigation } from '../components/NarrativeUI';
import { plural } from '../../client/format.js';
import { render as law } from './zakon-content';
import { render as feed, lede as feedLede, model as feedModel, shownNote } from './novo-content';
import { copyOrShow } from '../../client/share.js';
import type { NarrativeModel, NarrativeContext } from '../lib/screens/narrative-types';
import type { Navigation } from '../lib/screen-state';
export function NarrativeContent({
  model,
  navigation,
}: {
  model: NarrativeModel;
  navigation: Navigation;
}) {
  const unit = useSyncExternalStore(
    (f) =>
      store.subscribe((k: string) => {
        if (k === 'unit') f();
      }),
    () => store.get('unit') as 'eur' | 'pct',
    () => 'eur' as const,
  );
  const ctx: NarrativeContext = {
    data: model.content,
    core: model.core,
    query: model.query,
    origin: model.release.origin,
    unit,
    href,
  };
  const parts =
    model.view === 'ready'
      ? model.screen === 'S14'
        ? law(ctx)
        : { body: feed(ctx), lede: feedLede(ctx), context: '' }
      : null;
  let body = parts?.body;
  if (model.unsupported) {
    const allowed = byId[model.screen].periods;
    const supported = PERIODS.filter((p) => Array.isArray(allowed) && allowed.includes(p.key));
    body = emptyState({
      title: `Няма данни за ${model.period.label} на този екран`,
      text: `Този екран показва ${supported.map((p) => p.label).join(' и ')}.`,
      actions: supported.map((p, i) => (
        <p className="state-act" key={p.key}>
          <button
            type="button"
            className={`btn${i === 0 ? ' btn-primary' : ''}`}
            data-action="set-period"
            data-value={p.key}
          >
            Покажи {p.label}
          </button>
        </p>
      )),
    });
  } else if (model.view !== 'ready')
    body =
      model.view === 'pending' && !model.query.demo ? (
        pendingState({
          title: 'Тези данни още не са включени',
          text: 'Данните съществуват при издателя, още не са извлечени.',
        })
      ) : (
        <TextState view={model.view!} title={byId[model.screen].title} retry={navigation.retry} />
      );
  const context =
    model.screen === 'S14'
      ? compactText(
          <div className="context">
            <span className="ctx-part">
              <span className="ctx-period">
                <strong>{model.period.label}</strong>{' '}
                <span className="muted">· {model.period.desc}</span>
              </span>
            </span>
            {parts?.context ? <span className="ctx-part">{parts.context}</span> : null}
          </div>,
        )
      : undefined;
  return (
    <NarrativeNavigation value={navigation}>
      <PageFrame
        model={model}
        lede={parts?.lede}
        context={context}
        bodyEvents={{
          onClick: (e) => {
            const target = e.target as Element;
            const query = target.closest<HTMLElement>('[data-query]');
            if (query) {
              e.stopPropagation();
              const [key, value] = query.dataset.query!.split('=');
              navigation.setQuery?.({ [key]: value || '' });
              if (model.screen === 'S16' && key === 'vid' && value !== (model.query.vid || '')) {
                const m = feedModel({ ...ctx, query: { ...ctx.query, vid: value } });
                if (m.events.length)
                  navigation.announce(
                    m.vid
                      ? shownNote(m)
                      : `Показани са всички ${plural(m.events.length, 'събитие', 'събития')}.`,
                  );
              }
              return;
            }
            const period = target.closest<HTMLElement>('[data-action="set-period"]');
            if (period) {
              e.stopPropagation();
              store.set('period', period.dataset.value);
              return;
            }
            const term = target.closest<HTMLElement>('[data-gl]');
            if (term && navigation.openGlossary) {
              e.preventDefault();
              e.stopPropagation();
              navigation.openGlossary(term, term.dataset.gl!);
              return;
            }
            const button = target.closest<HTMLElement>('[data-s16-copy]');
            if (button) {
              e.stopPropagation();
              const input = document.getElementById('s16-rss-url') as HTMLInputElement;
              copyOrShow(input.value, 'Адресът е копиран.', 'Адрес на RSS файла', button);
            }
          },
          onChange: (e) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.name === 's14-unit' && t.checked) {
              e.stopPropagation();
              store.set('unit', t.value);
            }
          },
          onFocus: (e) => {
            if (e.target instanceof HTMLInputElement && e.target.id === 's16-rss-url')
              e.target.select();
          },
        }}
      >
        {compactText(fixFiles(body, model.release.dataBase))}
      </PageFrame>
    </NarrativeNavigation>
  );
}
