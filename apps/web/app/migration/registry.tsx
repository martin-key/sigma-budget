import { MigratedScreen as S26 } from './screen-S26';
import { MigratedScreen as S30 } from './screen-S30';
import { MigratedScreen as S25 } from './screen-S25';
import { MigratedScreen as S35 } from './screen-S35';
import { MigratedScreen as S14 } from './screen-S14';
import { MigratedScreen as S16 } from './screen-S16';
import type { TextScreenModel, Navigation } from '../lib/screen-state';
export { textModel, textMetadata } from '../lib/screens/text';
export const migrated = (id: string): id is TextScreenModel['screen'] =>
  ['S26', 'S30', 'S25', 'S35', 'S14', 'S16'].includes(id);
const screens = { S26, S30, S25, S35, S14, S16 };
export function MigratedScreen(props: { model: TextScreenModel; navigation: Navigation }) {
  const Screen = screens[props.model.screen];
  return <Screen {...props} />;
}
export const safeJSON = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
