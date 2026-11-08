import { expect, it } from 'vitest';
import { textModel } from './text';
import type { ReleaseReader } from '../release-types';
const release = {
  id: 'a'.repeat(64),
  dataBase: '/data/',
  origin: 'https://budget.test',
  sigmaUrl: '',
  feedbackEmail: '',
};
it('an aborted navigation never becomes a successful editorial fallback', async () => {
  const reader: ReleaseReader = {
    release,
    load: async () => {
      throw new DOMException('superseded', 'AbortError');
    },
  };
  await expect(textModel('S26', {}, {}, reader)).rejects.toMatchObject({ name: 'AbortError' });
});
it('missing optional editorial data leaves a usable model on the selected release', async () => {
  const reader: ReleaseReader = {
    release,
    load: async () => {
      throw new Error('unavailable');
    },
  };
  const model = await textModel('S26', {}, {}, reader);
  expect(model.core).toEqual({});
  expect(model.release).toEqual(release);
  expect(model.view).toBe('ready');
});
