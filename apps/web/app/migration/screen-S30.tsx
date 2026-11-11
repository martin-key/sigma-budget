import { TextState } from '../components/TextState';
import { byId } from '../lib/legacy';
import { notFoundParts } from '../routes/not-found-content';
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
  if (model.screen === 'S30') {
    const parts = notFoundParts(model.params, navigation);
    return (
      <PageFrame model={model} lede={parts.lede}>
        {parts.body}
      </PageFrame>
    );
  }
  return null;
}
