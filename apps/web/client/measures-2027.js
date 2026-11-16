/** The editorial entry only when the printed row still matches. */
export function measureText(data, table, index, label) {
  const entry = data?.MEASURES_2027?.[table]?.find((e) => e.row === index);
  return entry && String(label || '').startsWith(entry.starts) ? entry : null;
}
