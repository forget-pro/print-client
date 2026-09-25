const SHEETS = {
  A4: { pt: [595.28, 841.89], cm: [21, 29.7] },
  A3: { pt: [841.89, 1190.55], cm: [29.7, 42] },
} as const;

export const PT_PER_CM = 72 / 2.54;
export const PAPER = SHEETS;

export function paperPoints(name: string, layout: string): [number, number] {
  const sheet = name === "A3" ? SHEETS.A3 : SHEETS.A4;
  return layout === "landscape" ? [sheet.pt[1], sheet.pt[0]] : [sheet.pt[0], sheet.pt[1]];
}

export function paperCm(name: string, layout: string): [number, number] {
  const sheet = name === "A3" ? SHEETS.A3 : SHEETS.A4;
  return layout === "landscape" ? [sheet.cm[1], sheet.cm[0]] : [sheet.cm[0], sheet.cm[1]];
}
