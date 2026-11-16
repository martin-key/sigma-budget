import type { TextScreenModel } from '../lib/screen-state';
const screens = {
  S30: () => import('./screen-S30'),
  S25: () => import('./screen-S25'),
  S35: () => import('./screen-S35'),
  S14: () => import('./screen-S14'),
  S16: () => import('./screen-S16'),
  S36: () => import('./screen-S36'),
  S37: () => import('./screen-S37'),
};
export const loadScreen = (id: TextScreenModel['screen']) =>
  screens[id]().then((m) => m.MigratedScreen);
