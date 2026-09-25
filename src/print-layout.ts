export type PaperName = "A4" | "A3" | "A5" | "B5" | "Letter" | "Legal";
export type Orientation = "auto" | "portrait" | "landscape";
export type RangeMode = "current" | "all" | "view" | "custom";
export type Parity = "all" | "odd" | "even";
export type PrintMode = "page" | "nup" | "booklet";
export type FitMode = "margin" | "actual" | "shrink" | "custom";

export const PAPERS: Record<PaperName, { label: string; pt: [number, number] }> = {
  A4: { label: "A4", pt: [595.28, 841.89] },
  A3: { label: "A3", pt: [841.89, 1190.55] },
  A5: { label: "A5", pt: [419.53, 595.28] },
  B5: { label: "B5", pt: [498.9, 708.66] },
  Letter: { label: "Letter", pt: [612, 792] },
  Legal: { label: "Legal", pt: [612, 1008] },
};

export type MarginMm = { top: number; right: number; bottom: number; left: number };

const MM_TO_PT = 72 / 25.4;

export function detectPaper(width: number, height: number): PaperName {
  const w = Math.min(width, height);
  const h = Math.max(width, height);
  let best: PaperName = "A4";
  let score = Infinity;
  (Object.keys(PAPERS) as PaperName[]).forEach((name) => {
    const delta = Math.abs(PAPERS[name].pt[0] - w) + Math.abs(PAPERS[name].pt[1] - h);
    if (delta < score) {
      score = delta;
      best = name;
    }
  });
  return score < 36 ? best : "A4";
}

export function parsePageList(text: string, count: number): number[] {
  const pages: number[] = [];
  text.split(/[,，]/).forEach((part) => {
    const token = part.trim();
    if (!token) return;
    const range = token.match(/^(\d+)\s*[-–~到]\s*(\d+)$/);
    if (range) {
      let start = Number(range[1]);
      let end = Number(range[2]);
      if (start > end) [start, end] = [end, start];
      for (let page = start; page <= end; page += 1) {
        if (page >= 1 && page <= count) pages.push(page);
      }
      return;
    }
    if (/^\d+$/.test(token)) {
      const page = Number(token);
      if (page >= 1 && page <= count) pages.push(page);
    }
  });
  const seen = new Set<number>();
  return pages.filter((page) => (seen.has(page) ? false : (seen.add(page), true)));
}

export function pagesToPrint(options: {
  count: number;
  current: number;
  rangeMode: RangeMode;
  spec: string;
  parity: Parity;
  reverse: boolean;
}) {
  const count = Math.max(0, options.count);
  let pages: number[] = [];
  if (options.rangeMode === "current" || options.rangeMode === "view") {
    if (options.current >= 1 && options.current <= count) pages = [options.current];
  } else if (options.rangeMode === "custom") {
    pages = parsePageList(options.spec, count);
  } else {
    pages = Array.from({ length: count }, (_, index) => index + 1);
  }
  if (options.parity === "odd") pages = pages.filter((page) => page % 2 === 1);
  if (options.parity === "even") pages = pages.filter((page) => page % 2 === 0);
  if (options.reverse) pages = pages.slice().reverse();
  return pages;
}

export function bookletSlots(pages: number[]): Array<number | null> {
  const count = pages.length;
  const total = Math.max(4, Math.ceil(Math.max(count, 1) / 4) * 4);
  const order: number[] = [];
  let high = total;
  let low = 1;
  while (low < high) {
    order.push(high, low, low + 1, high - 1);
    low += 2;
    high -= 2;
  }
  return order.map((slot) => (slot > count ? null : pages[slot - 1]));
}

export function nupGrid(perSheet: number): [number, number] {
  if (perSheet <= 2) return [2, 1];
  if (perSheet <= 4) return [2, 2];
  if (perSheet <= 6) return [3, 2];
  if (perSheet <= 9) return [3, 3];
  return [4, 4];
}

function paperPoints(name: PaperName, orientation: "portrait" | "landscape"): [number, number] {
  const sheet = PAPERS[name] || PAPERS.A4;
  return orientation === "landscape" ? [sheet.pt[1], sheet.pt[0]] : [sheet.pt[0], sheet.pt[1]];
}

function cellGrid(boxW: number, boxH: number, cols: number, rows: number) {
  const gap = cols * rows > 1 ? 12 : 0;
  const cellW = (boxW - gap * (cols - 1)) / cols;
  const cellH = (boxH - gap * (rows - 1)) / rows;
  const cells: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x: col * (cellW + gap),
        y: row * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }
  return cells;
}

export function contentScale(
  fit: FitMode,
  percent: number,
  docW: number,
  docH: number,
  cellW: number,
  cellH: number,
) {
  if (docW <= 0 || docH <= 0 || cellW <= 0 || cellH <= 0) return 1;
  const contain = Math.min(cellW / docW, cellH / docH);
  if (fit === "actual") return 1;
  if (fit === "custom") {
    const ratio = Number.isFinite(percent) ? percent / 100 : 1;
    return Math.min(4, Math.max(0.1, ratio));
  }
  if (fit === "shrink") return Math.min(1, contain);
  return contain;
}

export type PrintSlot = { page: number | null; x: number; y: number; w: number; h: number };

export function layoutSheets(input: {
  pages: number[];
  pageSize: (page: number) => { w: number; h: number };
  paper: PaperName;
  orientation: Orientation;
  docLandscape: boolean;
  mode: PrintMode;
  fit: FitMode;
  scale: number;
  perSheet: number;
  margin: MarginMm | null;
}) {
  const facing = input.mode === "booklet"
    ? "landscape"
    : input.orientation === "auto"
      ? (input.docLandscape ? "landscape" : "portrait")
      : input.orientation;
  const [pageW, pageH] = paperPoints(input.paper, facing);
  const margin = input.margin;
  const left = margin ? margin.left * MM_TO_PT : 0;
  const right = margin ? margin.right * MM_TO_PT : 0;
  const top = margin ? margin.top * MM_TO_PT : 0;
  const bottom = margin ? margin.bottom * MM_TO_PT : 0;
  const boxX = left;
  const boxY = top;
  const boxW = Math.max(36, pageW - left - right);
  const boxH = Math.max(36, pageH - top - bottom);
  const source = input.mode === "booklet" ? bookletSlots(input.pages) : input.pages;
  const per = input.mode === "booklet" ? 2 : input.mode === "nup" ? Math.min(16, Math.max(2, input.perSheet || 2)) : 1;
  const [cols, rows] = input.mode === "page" ? [1, 1] : input.mode === "booklet" ? [2, 1] : nupGrid(per);
  const grid = cellGrid(boxW, boxH, cols, rows);
  const fit = input.mode === "page" ? input.fit : "margin";
  const sheets: PrintSlot[][] = [];
  for (let index = 0; index < source.length; index += per) {
    const group = source.slice(index, index + per);
    const slots: PrintSlot[] = [];
    for (let cellIndex = 0; cellIndex < per; cellIndex += 1) {
      const page = group[cellIndex];
      const cell = grid[cellIndex];
      if (page == null || !cell) continue;
      const doc = input.pageSize(page);
      const scale = contentScale(fit, input.scale, doc.w, doc.h, cell.w, cell.h);
      const w = doc.w * scale;
      const h = doc.h * scale;
      slots.push({
        page,
        x: boxX + cell.x + (cell.w - w) / 2,
        y: boxY + cell.y + (cell.h - h) / 2,
        w,
        h,
      });
    }
    if (slots.length) sheets.push(slots);
  }
  return {
    paperW: pageW,
    paperH: pageH,
    clip: { x: boxX, y: boxY, w: boxW, h: boxH },
    sheets,
  };
}
