import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PrintProfile = {
  printer: string;
  copies: number;
  quality: "standard" | "high";
  grayscale: boolean;
  duplex: boolean;
  duplexEdge: "longEdge" | "shortEdge";
  paper: "A4" | "A3";
  layout: "portrait" | "landscape";
};

export type PrintRecord = {
  id: number;
  createdAt: number;
  source: string;
  printer: string;
  copies: number;
  paper: string;
  pages: number;
  summary: string;
  status: "ok" | "error";
  error: string;
  filePath: string;
  fileSize: number;
  pageCount: number;
  fileExists: boolean;
};

const PROFILE: PrintProfile = {
  printer: "",
  copies: 1,
  quality: "standard",
  grayscale: false,
  duplex: false,
  duplexEdge: "longEdge",
  paper: "A4",
  layout: "portrait",
};

const JOB_LIMIT = 200;
const URL_LIMIT = 12;

let database: DatabaseSync | null = null;

function db() {
  if (database) return database;
  const file = path.join(app.getPath("userData"), "pic-print.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = new DatabaseSync(file);
  next.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      printer TEXT NOT NULL DEFAULT '',
      copies INTEGER NOT NULL,
      paper TEXT NOT NULL DEFAULT '',
      pages INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS recent_urls (
      url TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL,
      saved INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS print_daily (
      day TEXT PRIMARY KEY,
      jobs INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      sheets INTEGER NOT NULL DEFAULT 0,
      a4 INTEGER NOT NULL DEFAULT 0,
      a3 INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS print_printer (
      name TEXT PRIMARY KEY,
      jobs INTEGER NOT NULL DEFAULT 0,
      sheets INTEGER NOT NULL DEFAULT 0
    );
  `);
  const columns = next.prepare("PRAGMA table_info(print_jobs)").all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("file_path")) next.exec("ALTER TABLE print_jobs ADD COLUMN file_path TEXT NOT NULL DEFAULT ''");
  if (!names.has("file_size")) next.exec("ALTER TABLE print_jobs ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0");
  if (!names.has("page_count")) next.exec("ALTER TABLE print_jobs ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0");
  database = next;
  return next;
}

export function closeDatabase() {
  database?.close();
  database = null;
}

export function metaGet(key: string) {
  const row = db().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function metaSet(key: string, value: string) {
  db().prepare(`
    INSERT INTO meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function copiesOf(value: unknown) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 1;
  return Math.min(99, Math.max(1, number));
}

export function readPrintProfile(): PrintProfile {
  const raw = metaGet("print_profile");
  if (!raw) return { ...PROFILE };
  try {
    const value = JSON.parse(raw) as Partial<PrintProfile>;
    return {
      printer: typeof value.printer === "string" ? value.printer.slice(0, 200) : "",
      copies: copiesOf(value.copies),
      quality: value.quality === "high" ? "high" : "standard",
      grayscale: value.grayscale === true,
      duplex: value.duplex === true,
      duplexEdge: value.duplexEdge === "shortEdge" ? "shortEdge" : "longEdge",
      paper: value.paper === "A3" ? "A3" : "A4",
      layout: value.layout === "landscape" ? "landscape" : "portrait",
    };
  } catch {
    return { ...PROFILE };
  }
}

export function rememberPrint(patch: Partial<PrintProfile>) {
  const next = readPrintProfile();
  if (typeof patch.printer === "string") next.printer = patch.printer.slice(0, 200);
  if (patch.copies != null) next.copies = copiesOf(patch.copies);
  if (patch.quality === "high" || patch.quality === "standard") next.quality = patch.quality;
  if (typeof patch.grayscale === "boolean") next.grayscale = patch.grayscale;
  if (typeof patch.duplex === "boolean") next.duplex = patch.duplex;
  if (patch.duplexEdge === "shortEdge" || patch.duplexEdge === "longEdge") next.duplexEdge = patch.duplexEdge;
  if (patch.paper === "A3" || patch.paper === "A4") next.paper = patch.paper;
  if (patch.layout === "landscape" || patch.layout === "portrait") next.layout = patch.layout;
  metaSet("print_profile", JSON.stringify(next));
}

function dayKey(time: number) {
  const date = new Date(time);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return dayKey(date.getTime());
}

type StatRow = {
  createdAt: number;
  status: string;
  copies: number;
  pages: number;
  paper: string;
  printer: string;
};

function applyStat(record: StatRow, countPrinter = true) {
  const ok = record.status === "ok";
  const sheets = ok ? Math.max(0, Math.round(record.pages) || 0) * copiesOf(record.copies) : 0;
  const a4 = record.paper === "A4" ? sheets : 0;
  const a3 = record.paper === "A3" ? sheets : 0;
  db().prepare(`
    INSERT INTO print_daily (day, jobs, ok, failed, sheets, a4, a3)
    VALUES (?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(day) DO UPDATE SET
      jobs = jobs + 1,
      ok = ok + excluded.ok,
      failed = failed + excluded.failed,
      sheets = sheets + excluded.sheets,
      a4 = a4 + excluded.a4,
      a3 = a3 + excluded.a3
  `).run(dayKey(record.createdAt), ok ? 1 : 0, ok ? 0 : 1, sheets, a4, a3);
  if (!ok || !countPrinter) return;
  const name = record.printer.trim().slice(0, 200) || "系统默认";
  db().prepare(`
    INSERT INTO print_printer (name, jobs, sheets) VALUES (?, 1, ?)
    ON CONFLICT(name) DO UPDATE SET
      jobs = jobs + 1,
      sheets = sheets + excluded.sheets
  `).run(name, sheets);
}

function seedStats() {
  if (metaGet("stats_seeded") === "1") return;
  const rows = db().prepare(`
    SELECT created_at AS createdAt, status, copies, pages, paper, printer
    FROM print_jobs ORDER BY id ASC
  `).all() as StatRow[];
  for (const row of rows) applyStat(row);
  metaSet("stats_seeded", "1");
}

function spanOf(from: string, to: string) {
  const row = db().prepare(`
    SELECT
      COALESCE(SUM(jobs), 0) AS jobs,
      COALESCE(SUM(ok), 0) AS ok,
      COALESCE(SUM(failed), 0) AS failed,
      COALESCE(SUM(sheets), 0) AS sheets
    FROM print_daily WHERE day >= ? AND day <= ?
  `).get(from, to) as { jobs: number; ok: number; failed: number; sheets: number };
  return {
    jobs: Number(row.jobs) || 0,
    ok: Number(row.ok) || 0,
    failed: Number(row.failed) || 0,
    sheets: Number(row.sheets) || 0,
  };
}

export function printStats() {
  seedStats();
  const today = dayKey(Date.now());
  const monthStart = `${today.slice(0, 8)}01`;
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = shiftDay(today, -offset);
    const span = spanOf(day, day);
    days.push({
      day,
      label: day === today ? "今天" : day.slice(8),
      sheets: span.sheets,
      jobs: span.ok,
    });
  }
  const papers = db().prepare(`
    SELECT COALESCE(SUM(a4), 0) AS a4, COALESCE(SUM(a3), 0) AS a3
    FROM print_daily WHERE day >= ? AND day <= ?
  `).get(monthStart, today) as { a4: number; a3: number };
  const printers = db().prepare(`
    SELECT name, jobs, sheets FROM print_printer
    ORDER BY sheets DESC, jobs DESC LIMIT 4
  `).all() as Array<{ name: string; jobs: number; sheets: number }>;
  return {
    today: spanOf(today, today),
    month: spanOf(monthStart, today),
    total: spanOf("0000-01-01", "9999-12-31"),
    days,
    papers: { a4: Number(papers.a4) || 0, a3: Number(papers.a3) || 0 },
    printers: printers.map((item) => ({
      name: item.name,
      jobs: Number(item.jobs) || 0,
      sheets: Number(item.sheets) || 0,
    })),
  };
}

export function addPrintRecord(record: Omit<PrintRecord, "id" | "createdAt" | "fileExists">) {
  seedStats();
  const createdAt = Date.now();
  const printer = record.printer.slice(0, 200);
  const copies = copiesOf(record.copies);
  const paper = record.paper.slice(0, 20);
  const pages = Math.max(0, Math.round(record.pages) || 0);
  const pageCount = Math.max(0, Math.round(record.pageCount) || pages);
  const status = record.status === "error" ? "error" : "ok";
  const filePath = record.filePath.slice(0, 500);
  const fileSize = Math.max(0, Math.round(record.fileSize) || 0);
  db().prepare(`
    INSERT INTO print_jobs (
      created_at, source, printer, copies, paper, pages, summary, status, error,
      file_path, file_size, page_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    createdAt,
    record.source,
    printer,
    copies,
    paper,
    pages,
    record.summary.slice(0, 240),
    status,
    record.error.slice(0, 300),
    filePath,
    fileSize,
    pageCount,
  );
  applyStat({ createdAt, status, copies, pages, paper, printer }, record.source !== "preview");
  const dropped = db().prepare(`
    SELECT file_path AS filePath FROM print_jobs
    WHERE file_path != '' AND id NOT IN (
      SELECT id FROM print_jobs ORDER BY id DESC LIMIT ?
    )
  `).all(JOB_LIMIT) as Array<{ filePath: string }>;
  db().prepare(`
    DELETE FROM print_jobs WHERE id NOT IN (
      SELECT id FROM print_jobs ORDER BY id DESC LIMIT ?
    )
  `).run(JOB_LIMIT);
  for (const row of dropped) fs.promises.unlink(row.filePath).catch(() => {});
}

const PAGE_SIZE = 40;

export function listPrintRecords(offset = 0) {
  const skip = Math.min(JOB_LIMIT, Math.max(0, Math.round(offset) || 0));
  const totalRow = db().prepare("SELECT COUNT(*) AS total FROM print_jobs").get() as { total: number };
  const total = Math.min(JOB_LIMIT, Number(totalRow.total) || 0);
  const rows = db().prepare(`
    SELECT id, created_at AS createdAt, source, printer, copies, paper, pages, summary, status, error,
      file_path AS filePath, file_size AS fileSize, page_count AS pageCount
    FROM print_jobs ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(PAGE_SIZE, skip) as Array<Omit<PrintRecord, "fileExists">>;
  return {
    items: rows.map((row) => ({
      ...row,
      fileSize: Number(row.fileSize) || 0,
      pageCount: Number(row.pageCount) || 0,
      fileExists: Boolean(row.filePath) && fs.existsSync(row.filePath),
    })),
    total,
  };
}

function savedPdfPaths() {
  return (db().prepare("SELECT file_path AS filePath FROM print_jobs").all() as Array<{ filePath: string }>)
    .map((row) => row.filePath)
    .filter(Boolean);
}

export function clearPrintRecords() {
  const paths = savedPdfPaths();
  db().prepare("DELETE FROM print_jobs").run();
  return paths;
}

export function rememberUrl(url: string, saved: number) {
  const text = url.trim().slice(0, 500);
  if (!/^https?:\/\//i.test(text)) return;
  db().prepare(`
    INSERT INTO recent_urls (url, used_at, saved) VALUES (?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET used_at = excluded.used_at, saved = excluded.saved
  `).run(text, Date.now(), Math.max(0, Math.round(saved) || 0));
  db().prepare(`
    DELETE FROM recent_urls WHERE url NOT IN (
      SELECT url FROM recent_urls ORDER BY used_at DESC LIMIT ?
    )
  `).run(URL_LIMIT);
}

export function listRecentUrls() {
  return db().prepare(`
    SELECT url, used_at AS usedAt, saved FROM recent_urls ORDER BY used_at DESC LIMIT 8
  `).all() as Array<{ url: string; usedAt: number; saved: number }>;
}
