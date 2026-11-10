import { pythonNumberAt } from '../common/numbers.js';
import { pyTruth } from './checks.js';
import { executionIterable, executionRequired } from './execution-python.js';

function fail(name: string, message: string): never {
  const error = new Error(message);
  error.name = name;
  throw error;
}
function kind(value: any, holder?: object, key?: string): string {
  if (value == null) return 'NoneType';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number')
    return holder && key !== undefined
      ? pythonNumberAt(holder, key, value).kind
      : Number.isInteger(value)
        ? 'int'
        : 'float';
  return typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'str' : 'dict';
}
function length(value: any, holder?: object, key?: string): number {
  if (typeof value === 'string') return [...value].length;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return fail('TypeError', `object of type '${kind(value, holder, key)}' has no len()`);
}
function iterate(value: any, holder?: object, key?: string): any[] {
  if (value == null || typeof value === 'boolean' || typeof value === 'number')
    return fail('TypeError', `'${kind(value, holder, key)}' object is not iterable`);
  return executionIterable(value);
}

/** The frozen Python load_routes contract: records, defaults, options, then identities. */
export function routeCatalogue(catalog: any): { id: any; pattern: any; patternType: string }[] {
  const rows = executionRequired(catalog, 'routes');
  const result = iterate(rows).map((record, index) => {
    const count = length(record, rows, String(index));
    if (count !== 7 && count !== 8)
      fail('ValueError', 'route record must have seven fields and optional options');
    if (!Array.isArray(record) && typeof record !== 'string')
      fail('TypeError', "unhashable type: 'slice'");
    const head = typeof record === 'string' ? [...record] : record;
    const route = Object.assign(
      Object.create(null),
      Object.fromEntries(
        ['id', 'key', 'pattern', 'file', 'title', 'group', 'icon'].map((name, i) => [
          name,
          head[i],
        ]),
      ),
      {
        step: null,
        next: ['S01'],
        parent: null,
        phase: 1,
        nav: true,
        samples: [],
        desc: '',
        periods: 'all',
        short: '',
        query: [],
      },
    );
    let patternHolder = head as object,
      patternKey = '2';
    const put = (key: any, value: any, holder: object, field: string) => {
      if (key !== null && typeof key === 'object')
        fail('TypeError', `unhashable type: '${kind(key)}'`);
      route[String(key)] = value;
      if (key === 'pattern') {
        patternHolder = holder;
        patternKey = field;
      }
    };
    if (count === 8) {
      const options = head[7];
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        for (const [key, value] of Object.entries(options)) put(key, value, options, key);
      } else {
        for (const [i, pair] of iterate(options, head, '7').entries()) {
          let values: any[];
          try {
            values = iterate(pair, options, String(i));
          } catch (error) {
            if (error instanceof Error && error.name === 'TypeError')
              fail(
                'TypeError',
                `cannot convert dictionary update sequence element #${i} to a sequence`,
              );
            throw error;
          }
          if (values.length !== 2)
            fail(
              'ValueError',
              `dictionary update sequence element #${i} has length ${values.length}; 2 is required`,
            );
          put(values[0], values[1], pair, '1');
        }
      }
    }
    const patternType = kind(route.pattern, patternHolder, patternKey);
    if (!pyTruth(route.samples) && pyTruth(route.pattern)) {
      if (typeof route.pattern !== 'string')
        fail('TypeError', `can only concatenate str (not "${patternType}") to str`);
      route.samples = ['#' + route.pattern];
    }
    return { id: route.id, pattern: route.pattern, patternType };
  });
  const identities = result.map((row) => {
    if (row.id !== null && typeof row.id === 'object')
      fail('TypeError', `unhashable type: '${kind(row.id)}'`);
    return typeof row.id === 'boolean' ? Number(row.id) : row.id;
  });
  if (!result.length || new Set(identities).size !== result.length)
    fail('ValueError', 'route catalogue must contain unique screen ids');
  return result;
}
