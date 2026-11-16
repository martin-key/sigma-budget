import { TextState } from '../components/TextState';
import { byId } from '../lib/legacy';
import { PageFrame } from '../components/PageFrame';
import { LegalBody } from '../routes/legal-content';
import type { TextScreenModel, Navigation } from '../lib/screen-state';
// S37 · Условия за ползване: the shared copy of client/legal.js
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
      <LegalBody screen="S37" email={model.release.feedbackEmail} />
    </PageFrame>
  );
}
