import * as content from '../routes/zakon-content';
import { NarrativeContent } from '../routes/narrative-content';
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
  if ('content' in model)
    return <NarrativeContent model={model} navigation={navigation} content={content} />;
  if (model.view && model.view !== 'ready')
    return (
      <PageFrame model={model}>
        <TextState view={model.view} title={byId[model.screen].title} retry={navigation.retry} />
      </PageFrame>
    );

  return null;
}
