import { routes } from './cases.ts';

// No test is generated for a screen without a public sharing action.
export const withoutSharing: Record<string, string> = {
  S03: 'Речникът предлага термини и определения, без споделим блок.',
  S05: 'Годишната рамка няма бутон за споделяне.',
  S18: 'Личният калкулатор няма публичен бутон за споделяне.',
  S35: 'Проверката на изданието няма споделим блок.',
  S25: 'API страницата предлага файлове директно.',
  S27: 'Формата за обратна връзка няма споделим блок.',
  S28: 'Резултатите от търсенето нямат бутон за споделяне.',
  S29: 'Вграждането е извън обхвата.',
  S30: 'Страницата за непознат адрес няма споделим блок.',
  S36: 'Поверителността е текст без споделим блок.',
  S37: 'Условията за ползване са текст без споделим блок.',
};
export const sharingCases = routes
  .filter((route) => !withoutSharing[route.id])
  .map((route, index) => ({
    ...route,
    csv: ['S01', 'S04', 'S15', 'S11', 'S12', 'S20', 'S21', 'S17', 'S24'].includes(route.id),
    png: !['S16', 'S13'].includes(route.id),
    display: index % 2 ? ('touch' as const) : ('desktop' as const),
  }));
