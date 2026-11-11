import * as content from '../routes/proverka-content';
import { MetadataContent } from '../routes/metadata-content';
import { TextState } from '../components/TextState';
import { byId } from '../lib/legacy';
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
  if ('documents' in model)
    return <MetadataContent model={model} navigation={navigation} render={content.render} />;

  return null;
}
