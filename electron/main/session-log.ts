import { BrowserWindow } from "electron";

export type SessionLog = {
  id: number;
  time: string;
  level: "info" | "warn" | "error";
  message: string;
};

const LIMIT = 400;
const entries: SessionLog[] = [];
let nextId = 1;

function stamp() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function push(level: SessionLog["level"], message: string) {
  const text = String(message || "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!text) return;
  const entry: SessionLog = { id: nextId++, time: stamp(), level, message: text };
  entries.push(entry);
  if (entries.length > LIMIT) entries.splice(0, entries.length - LIMIT);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("session_log", entry);
  }
}

export function logInfo(message: string) {
  push("info", message);
}

export function logWarn(message: string) {
  push("warn", message);
}

export function logError(message: string) {
  push("error", message);
}

export function sessionLogs() {
  return entries.slice();
}
