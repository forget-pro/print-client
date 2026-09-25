import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

export const UPDATE_PROXIES = ["gh-proxy.org", "gh-proxy.com", "ghproxy.net", "ghfast.top"] as const;

export type UpdateProxy = "" | (typeof UPDATE_PROXIES)[number];

export type AppSettings = {
  openPdfExternal: boolean;
  updateProxy: UpdateProxy;
  checkOnStartup: boolean;
  pageSize: "A4" | "A3";
  layout: "portrait" | "landscape";
  margin: "none" | "small";
  stack: "auto" | "vertical";
};

const DEFAULTS: AppSettings = {
  openPdfExternal: false,
  updateProxy: "",
  checkOnStartup: true,
  pageSize: "A4",
  layout: "portrait",
  margin: "none",
  stack: "auto",
};

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function pickProxy(value: unknown): UpdateProxy {
  return UPDATE_PROXIES.includes(value as UpdateProxy) ? (value as UpdateProxy) : "";
}

export function normalizeSettings(value: Partial<AppSettings> | null | undefined): AppSettings {
  const source = value || {};
  return {
    openPdfExternal: source.openPdfExternal === true,
    updateProxy: pickProxy(source.updateProxy),
    checkOnStartup: source.checkOnStartup !== false,
    pageSize: source.pageSize === "A3" ? "A3" : "A4",
    layout: source.layout === "landscape" ? "landscape" : "portrait",
    margin: source.margin === "small" ? "small" : "none",
    stack: source.stack === "vertical" ? "vertical" : "auto",
  };
}

export function readSettings(): AppSettings {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath(), "utf8")));
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(value: Partial<AppSettings>): AppSettings {
  const next = normalizeSettings({ ...readSettings(), ...value });
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2));
  fs.renameSync(temp, file);
  return next;
}

export function updateFeed(proxy: UpdateProxy) {
  const release = "https://github.com/forget-pro/print-client/releases/latest/download";
  if (!proxy) {
    return {
      provider: "github" as const,
      owner: "forget-pro",
      repo: "print-client",
    };
  }
  return {
    provider: "generic" as const,
    url: `https://${proxy}/${release}`,
  };
}
