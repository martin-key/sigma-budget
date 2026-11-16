// Both renderers show the producer recorded by the shipped release, including historical releases.
export function reproductionCommand(manifest, releaseId, origin) {
  const { repository, commit } = manifest.processing?.code || {};
  if (!repository || !commit) return 'Манифестът не посочва хранилище и commit за пресъздаване.';
  return `git clone ${repository.replace(/\.git$/, '')}.git budget-reproduce
cd budget-reproduce
git checkout ${commit}
pnpm install --frozen-lockfile
./budget reproduce --manifest ${origin}/data/releases/${releaseId}/manifest.json --originals /път/до/входовете`;
}
