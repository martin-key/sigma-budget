/** Parliament records are captured after Python's literal decoding and contain
 * only fields read by the builder. Raw legal document parsing remains in Python. */
type RecordData = Record<string, any>;
const duplicateOpinions: Record<number, number> = { 24023: 22976 };
const sortedCounts = (values: string[]) => {
  const counts: Record<string, number> = {};
  for (const value of values.sort()) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

export function parliamentFacts(billId: number, data: RecordData): RecordData {
  const dates = (stage: string, status?: string): string[] =>
    [
      ...new Set<string>(
        data.activity
          .filter(
            (a: RecordData) =>
              a.L_Act_St2_name === stage && (status === undefined || a.L_Act_St_name === status),
          )
          .map((a: RecordData) => a.L_Act_St_date),
      ),
    ].sort();
  const first = dates('зала първо гласуване', 'приет');
  const second = dates('зала второ гласуване');
  const adopted = dates('зала второ гласуване', 'приет');
  if (first.length !== 1 || adopted.length !== 1 || adopted[0] !== data.L_Act_date2.slice(0, 10))
    throw new Error(`bill ${billId}: readings are not as expected`);
  const ids = new Set(data.standp_list.map((x: RecordData) => x.A_Cm_Stanid));
  const opinions = data.standp_list.filter(
    (x: RecordData) => !ids.has(duplicateOpinions[x.A_Cm_Stanid]),
  );
  const proposals = data.proposal_12_list
    .map((p: RecordData) => {
      if (!Array.isArray(p.act_files) || !p.act_files.length)
        throw new Error(`proposal ${p.RN_DOC} has no file`);
      return { no: p.RN_DOC, date: p.DAT_DOC.slice(0, 10), file: p.act_files[0].FILENAME };
    })
    .sort((a: RecordData, b: RecordData) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : a.no > b.no ? 1 : 0,
    );
  if (!/^[+-]?\d+$/.test(String(data.L_Act_dv_iss).trim()))
    throw new Error(`Invalid issue for bill ${billId}`);
  return {
    sign: data.L_Act_sign,
    title: data.L_ActL_title,
    lawTitle: data.L_ActL_final,
    submitted: data.L_Act_date.slice(0, 10),
    first: first[0],
    second,
    adopted: adopted[0],
    issue: Number(data.L_Act_dv_iss),
    reportDates: sortedCounts(data.stan_list.map((x: RecordData) => x.A_Cm_Stan_date.slice(0, 10))),
    reports: data.stan_list.length,
    reportAuthors: new Set(data.stan_list.map((x: RecordData) => x.A_ns_CL_value)).size,
    opinionDates: sortedCounts(opinions.map((x: RecordData) => x.A_Cm_Stan_date.slice(0, 10))),
    opinions: opinions.length,
    proposals,
    report2: data.stan_list2_1.map((x: RecordData) => x.A_Cm_Stan_date.slice(0, 10)),
    committees: data.dist_list.map((x: RecordData) => ({
      name: x.A_ns_CL_value,
      role: x.L_Act_DTL_value,
    })),
    archive: data.static_archive || null,
    pdf: data.order.map((x: RecordData) => x.FILENAME),
    docx: data.file_list.map((x: RecordData) => x.FILENAME),
  };
}

/** The 2027 stage is intentionally separate from the 2026 law computation. */
export function next2027() {
  return {
    title: 'Бюджет 2027',
    status: 'pending',
    note: 'Бюджетният план за 2027 г. (изпратен на 15.10.2026 г.) е на екрана „Бюджет 2027 (проект)“. Законопроектът за държавния бюджет за 2027 г. ще бъде добавен, когато бъде внесен в Народното събрание.',
    expected: 'минфин.бг, parliament.bg',
  };
}

const months = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];
function iso(day: string, month: string, year: string): string {
  const m = /^\d+$/.test(month) ? Number(month) : months.indexOf(month) + 1;
  if (!m) throw new Error(`Unknown month ${month}`);
  return `${year.padStart(4, '0')}-${String(m).padStart(2, '0')}-${day.padStart(2, '0')}`;
}
/** Derive facts from the parser's captured blocks, retaining the builder's
 * completeness checks. No HTML extraction is performed here. */
export function gazetteFacts(blocks: [string, any][]): RecordData {
  const f: RecordData = {
    issue: null,
    date: null,
    decree: null,
    issued: null,
    adopted: null,
    inForce: [],
  };
  for (const [kind, x] of blocks.slice(0, 12)) {
    if (kind === 't') {
      for (const row of x)
        for (const cell of row) {
          const m = /брой:\s*(\d+),\s*от дата\s*(\d+)\.(\d+)\.(\d{4})/.exec(cell);
          if (m) {
            f.issue = Number(m[1]);
            f.date = iso(m[2]!, m[3]!, m[4]!);
          }
        }
    } else {
      let m = /^УКАЗ № (\d+)/.exec(x);
      if (m) f.decree = Number(m[1]);
      m = /^Издаден в София на (\d+) (\S+) (\d{4}) г\./.exec(x);
      if (m) f.issued = iso(m[1]!, m[2]!, m[3]!);
      m = /приет от 52-рото Народно събрание на (\d+) (\S+) (\d{4}) г\./.exec(x);
      if (m && !f.adopted) f.adopted = iso(m[1]!, m[2]!, m[3]!);
    }
  }
  const paras: string[] = blocks.filter(([k]) => k === 'p').map(([, x]) => x);
  for (let i = 0; i < paras.length; i++) {
    const m = /^§\s*\d+\.\s*Законът влиза в сила от (\d+) (\S+) (\d{4}) г\.\s*с изключение на/.exec(
      paras[i]!,
    );
    if (!m) continue;
    f.general = iso(m[1]!, m[2]!, m[3]!);
    for (const y of paras.slice(i + 1)) {
      if (y.startsWith('Законът е приет')) break;
      const mi = /^\d+\.\s*(.+?),?\s+(?:които|която|който)\s+влизат?\s+в\s+сила\s+(.+?)[.;]?$/.exec(
        y,
      );
      if (!mi) continue;
      const rawScope = mi[1]!.trim(),
        scope = rawScope[0]!.toUpperCase() + rawScope.slice(1);
      const when = mi[2]!.trim().replace(/\s+г$/, ' г.');
      const md = /^от (\d+) (\S+) (\d{4}) г\./.exec(when);
      const from = md
        ? iso(md[1]!, md[2]!, md[3]!)
        : when.startsWith('от деня на обнародването')
          ? f.date
          : null;
      f.inForce.push({ from, when, scope });
    }
    break;
  }
  if (!(f.issue && f.date && f.decree && f.issued && f.adopted && f.general))
    throw new Error('Gazette facts incomplete');
  return f;
}
