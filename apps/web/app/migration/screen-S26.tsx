import { TextState } from '../components/TextState';
import { byId } from '../lib/legacy';
import { AboutContent } from '../routes/about-content';
import { PageFrame } from '../components/PageFrame';
import type { TextScreenModel, Navigation } from '../lib/screen-state';
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
