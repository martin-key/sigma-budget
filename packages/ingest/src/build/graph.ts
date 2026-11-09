/** A stage may read only the successful stages explicitly declared in its inputs. */
export interface GraphStage {
  id: string;
  requires: readonly string[];
  optional?: readonly string[];
  run: (read: (id: string) => unknown) => unknown;
}

export type StageState =
  | { id: string; status: 'success' }
  | { id: string; status: 'failed'; error: string }
  | { id: string; status: 'skipped'; blockedBy: string[] };

/** Validate the whole graph before executing anything, then run independent work after failures. */
export function runGraph(stages: readonly GraphStage[]): {
  states: StageState[];
  outputs: ReadonlyMap<string, unknown>;
} {
  const byId = new Map<string, GraphStage>();
  for (const stage of stages) {
    if (!stage.id || byId.has(stage.id)) throw new Error(`Duplicate or empty stage: ${stage.id}`);
    byId.set(stage.id, stage);
  }
  for (const stage of stages) {
    const deps = [...stage.requires, ...(stage.optional ?? [])];
    if (new Set(deps).size !== deps.length) throw new Error(`Duplicate dependency: ${stage.id}`);
    for (const dep of deps)
      if (!byId.has(dep)) throw new Error(`Missing stage ${dep} for ${stage.id}`);
  }
  const sorted: GraphStage[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`Cycle at stage ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const stage = byId.get(id)!;
    for (const dep of [...stage.requires, ...(stage.optional ?? [])]) visit(dep);
    visiting.delete(id);
    visited.add(id);
    sorted.push(stage);
  };
  for (const stage of stages) visit(stage.id);

  const outputs = new Map<string, unknown>(),
    states: StageState[] = [];
  for (const stage of sorted) {
    const blockedBy = stage.requires.filter((id) => !outputs.has(id));
    if (blockedBy.length) {
      states.push({ id: stage.id, status: 'skipped', blockedBy });
      continue;
    }
    try {
      const allowed = new Set([...stage.requires, ...(stage.optional ?? [])]);
      const result = stage.run((id) => {
        if (!allowed.has(id)) throw new Error(`Undeclared dependency ${id} for ${stage.id}`);
        return outputs.get(id);
      });
      if (result === undefined) throw new Error('Stage returned undefined');
      outputs.set(stage.id, result);
      states.push({ id: stage.id, status: 'success' });
    } catch (error) {
      states.push({
        id: stage.id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { states, outputs };
}
