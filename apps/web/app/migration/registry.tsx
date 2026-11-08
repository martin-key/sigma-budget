import { MetadataContent } from '../routes/metadata-content';
import { TextState } from '../components/TextState';
import { byId } from '../lib/legacy';
import { AboutContent } from '../routes/about-content';
import { notFoundParts } from '../routes/not-found-content';
import { PageFrame } from '../components/PageFrame';
import type { TextScreenModel, Navigation } from '../lib/screen-state';
export { textModel, textMetadata } from '../lib/screens/text';
export const migrated = (id: string): id is TextScreenModel['screen'] =>
  ['S26', 'S30', 'S25', 'S35'].includes(id);
export function MigratedScreen({
  model,
  navigation,
}: {
  model: TextScreenModel;
  navigation: Navigation;
}) {
  if (model.view && model.view !== 'ready')
    return (
      <PageFrame model={model}>
        <TextState view={model.view} title={byId[model.screen].title} retry={navigation.retry} />
      </PageFrame>
    );
  if ('documents' in model) return <MetadataContent model={model} navigation={navigation} />;
  if (model.screen === 'S30') {
    const parts = notFoundParts(model.params, navigation);
    return (
      <PageFrame model={model} lede={parts.lede}>
        {parts.body}
      </PageFrame>
    );
  }
  return (
    <PageFrame model={model}>
      <AboutContent
        core={model.core}
        glossary={model.glossary}
        onTerm={navigation.openGlossary}
        announce={navigation.announce}
      />
    </PageFrame>
  );
}
export const safeJSON = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
