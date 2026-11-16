import { glossaryTree } from '../components/GlossaryText';
import { compactText, fixFiles } from '../components/ScreenTree';
import { useEffect, useRef } from 'react';
import { PageFrame } from '../components/PageFrame';
import type { MetadataModel } from '../lib/screens/metadata-types';
import type { Navigation } from '../lib/screen-state';
import type { render as ContentRenderer } from './api-content';
import { href } from '../lib/legacy';
import { copyOrShow } from '../../client/share.js';
export function MetadataContent({
  model,
  navigation,
  render,
}: {
  model: MetadataModel;
  navigation: Navigation;
  render: typeof ContentRenderer;
}) {
  const root = useRef<HTMLDivElement>(null);
  const content = render({
    origin: model.release.origin,
    dataBase: model.release.dataBase,
    data: model.documents,
    core: model.core,
    query: model.query,
    failed: model.failed,
    fileMeta: model.fileMeta,
  });
  useEffect(() => {
    const title = root.current?.querySelector('.s25-set-t')?.textContent;
    if (title) navigation.announce(`Показан е наборът: ${title}.`);
  }, [model.query.set]);
  return (
    <PageFrame model={model} lede={content.lede}>
      <div
        ref={root}
        onClick={(e) => {
          const button = (e.target as Element).closest<HTMLElement>('[data-s25-copy-from]');
          const id = button?.dataset.s25CopyFrom;
          const text = id ? root.current?.querySelector(`#${id}`)?.textContent?.trim() : '';
          if (text && button)
            copyOrShow(
              text,
              id === 's25-addr'
                ? 'Адресът е копиран.'
                : id === 's25-c-curl'
                  ? 'Командата е копирана.'
                  : id === 's25-c-meta'
                    ? 'Блокът meta е копиран.'
                    : 'Кодът е копиран.',
              'Копирай ръчно',
              button,
            );
        }}
        onChange={(e) => {
          const control = e.target;
          if (control instanceof HTMLSelectElement && control.id === 's25-set') {
            e.stopPropagation();
            if (navigation.setQuery) navigation.setQuery({ set: control.value });
            else navigation.go(href('api', {}, { ...model.query, set: control.value }));
          }
        }}
      >
        {compactText(
          glossaryTree(
            fixFiles(content.body, model.release.dataBase),
            model.glossary,
            navigation.openGlossary,
          ),
        )}
      </div>
    </PageFrame>
  );
}
