import { app, dialog, BrowserWindow, shell, Menu, ipcMain, protocol, net } from "electron";
import electronUpdater from "electron-updater";
import { fileURLToPath, pathToFileURL } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { imageSize } from "image-size";
import { imageSizeFromFile } from "image-size/fromFile";
import fs from "node:fs";
import { fetchPageImages } from "./fetch-images";
import { layoutImagePages } from "./pdf-layout";
import { renderEdit } from "./image-edit";
import { paperPoints } from "../../src/paper";
import { IMAGE_EXT } from "../../src/files";
import { readSettings, updateFeed, writeSettings } from "./settings";
import { stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, "../..");

export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith("6.1")) app.disableHardwareAcceleration();

// Set application name for Windows 10+ notifications
if (process.platform === "win32") app.setAppUserModelId(app.getName());

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pic",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win: BrowserWindow | null = null;
const pendingOpens: string[] = [];
let launchArgsQueued = false;

function imagePathsFromArgv(argv: string[], cwd?: string) {
  const files: string[] = [];
  const base = cwd || process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || arg.startsWith("-")) continue;
    if (!IMAGE_EXT.test(arg)) continue;
    const resolved = path.resolve(base, arg);
    try {
      if (fs.statSync(resolved).isFile()) files.push(resolved);
    } catch {
      continue;
    }
  }
  return files;
}

function publishOpens(files: string[]) {
  if (!files.length) return;
  if (win && !win.webContents.isLoading()) {
    win.webContents.send("open_images", files);
    if (win.isMinimized()) win.restore();
    win.focus();
    return;
  }
  pendingOpens.push(...files);
}

function assertImageFile(filePath: string) {
  const resolved = path.resolve(filePath);
  if (!IMAGE_EXT.test(resolved)) throw new Error("无法读取图片");
  if (!fs.statSync(resolved).isFile()) throw new Error("无法读取图片");
  return resolved;
}

function enableTextEditing(contents: Electron.WebContents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const command = process.platform === "darwin" ? input.meta : input.control;
    if (!command || input.alt) return;
    const key = input.key.toLowerCase();
    const actions: Record<string, () => void> = {
      a: () => contents.selectAll(),
      c: () => contents.copy(),
      x: () => contents.cut(),
      v: () => contents.paste(),
      z: () => (input.shift ? contents.redo() : contents.undo()),
    };
    const action = actions[key];
    if (!action) return;
    event.preventDefault();
    action();
  });

  contents.on("context-menu", (_event, params) => {
    if (!params.isEditable && !params.selectionText) return;
    Menu.buildFromTemplate([
      { label: "撤销", role: "undo", enabled: params.editFlags.canUndo },
      { label: "重做", role: "redo", enabled: params.editFlags.canRedo },
      { type: "separator" },
      { label: "剪切", role: "cut", enabled: params.editFlags.canCut },
      { label: "复制", role: "copy", enabled: params.editFlags.canCopy },
      { label: "粘贴", role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: "全选", role: "selectAll", enabled: params.editFlags.canSelectAll },
    ]).popup();
  });
}
const preload = path.join(__dirname, "../preload/index.mjs");
const indexHtml = path.join(RENDERER_DIST, "index.html");

async function createWindow() {
  const launchImages = launchArgsQueued ? [] : imagePathsFromArgv(process.argv);
  if (!launchArgsQueued) {
    launchArgsQueued = true;
    pendingOpens.push(...launchImages);
  }
  const viewerLaunch = launchImages.length === 1;
  win = new BrowserWindow({
    title: "图片打印",
    width: 1200,
    height: 800,
    backgroundColor: viewerLaunch ? "#2a2c31" : "#eef1f6",
    icon: path.join(process.env.VITE_PUBLIC, "logo.png"),
    webPreferences: {
      preload,
    },
  });
  enableTextEditing(win.webContents);

  if (VITE_DEV_SERVER_URL) {
    // #298
    win.loadURL(viewerLaunch ? `${VITE_DEV_SERVER_URL}#/edit` : VITE_DEV_SERVER_URL);
    // Open devTool if the app is not packaged
    win.webContents.openDevTools();
  } else if (viewerLaunch) {
    win.loadFile(indexHtml, { hash: "/edit" });
  } else {
    win.loadFile(indexHtml);
  }

  win.webContents.on("did-finish-load", () => {
    setupUpdater();
    if (app.isPackaged && readSettings().checkOnStartup) autoUpdater.checkForUpdates().catch(() => {});
  });

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) shell.openExternal(url);
    return { action: "deny" };
  });
  // win.webContents.on('will-navigate', (event, url) => { }) #344
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  publishOpens(imagePathsFromArgv([filePath]));
});

app.whenReady().then(() => {
  protocol.handle("pic", (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (process.platform === "win32" && /^\/[A-Za-z]:\//.test(filePath)) {
      filePath = filePath.slice(1);
    }
    if (!IMAGE_EXT.test(filePath) && !/\.(gif|pdf)$/i.test(filePath)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).href);
  });
  createWindow();
});

function collectImages(inputs: string[]) {
  const files: string[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(item);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(item, { withFileTypes: true });
      for (let j = 0; j < entries.length; j++) {
        const entry = entries[j];
        if (entry.isFile() && IMAGE_EXT.test(entry.name)) files.push(path.join(item, entry.name));
      }
    } else if (IMAGE_EXT.test(item)) {
      files.push(item);
    }
  }
  return files;
}

ipcMain.handle("openDialogSync", () => {
  const result = dialog.showOpenDialogSync(win, {
    title: "选择图片或文件夹",
    buttonLabel: "添加",
    filters: [
      { name: "图片", extensions: ["jpg", "jpeg", "jpe", "jfif", "png", "webp"] },
      { name: "所有文件", extensions: ["*"] },
    ],
    properties: ["openFile", "openDirectory", "multiSelections"],
  });
  if (!result?.length) return [];
  return collectImages(result);
});

ipcMain.handle("collect_images", (_event, inputs: string[]) => collectImages(inputs || []));

export function generateRandomString() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 8; i > 0; --i)
    result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

const SMALL_MARGIN = 36;

async function imageForPdf(imageFile: string, rotation: number) {
  if (!rotation && !/\.webp$/i.test(imageFile)) return imageFile;
  let pipeline = sharp(imageFile);
  if (rotation) pipeline = pipeline.rotate(rotation);
  return pipeline.png().toBuffer();
}

function placeOnPage(
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  placement: { fit?: boolean; sizing?: string; scale?: number; alignX?: string; alignY?: string; x?: number; y?: number },
) {
  const sizing = placement.sizing === "cover" || placement.sizing === "stretch" ? placement.sizing : "contain";
  const base = sizing === "stretch"
    ? { width: pageWidth, height: pageHeight }
    : (() => {
      const ratio = sizing === "cover"
        ? Math.max(pageWidth / imageWidth, pageHeight / imageHeight)
        : Math.min(pageWidth / imageWidth, pageHeight / imageHeight);
      const fitScale = ratio || 1;
      return { width: imageWidth * fitScale, height: imageHeight * fitScale };
    })();
  const userScale = placement.fit ? 1 : Math.min(2, Math.max(0.1, (Number(placement.scale) || 100) / 100));
  const width = base.width * userScale;
  const height = base.height * userScale;
  let x = (pageWidth - width) / 2;
  let y = (pageHeight - height) / 2;
  const freeX = Number(placement.x);
  const freeY = Number(placement.y);
  if (!placement.fit && Number.isFinite(freeX) && Number.isFinite(freeY)) {
    x = freeX * pageWidth;
    y = freeY * pageHeight;
  } else if (!placement.fit) {
    if (placement.alignX === "left") x = 0;
    if (placement.alignX === "right") x = pageWidth - width;
    if (placement.alignY === "top") y = 0;
    if (placement.alignY === "bottom") y = pageHeight - height;
  }
  return { x, y, width, height };
}

async function renderPdf(file: {
  files: Array<string | { path: string; rotation?: number }>;
  size?: string;
  layout?: string;
  margin?: string;
  stack?: string;
  placement?: { fit?: boolean; sizing?: string; scale?: number; alignX?: string; alignY?: string; x?: number; y?: number };
}) {
  const doc = new PDFDocument({
    autoFirstPage: false,
    margin: 0,
  });
  const dirpath = path.join(app.getPath("documents"), "pic_print");
  fs.mkdirSync(dirpath, { recursive: true });
  const filepath = path.join(dirpath, `${generateRandomString()}.pdf`);
  const outputStream = fs.createWriteStream(filepath);
  const finished = new Promise((resolve, reject) => {
    outputStream.on("finish", () => resolve(filepath));
    outputStream.on("error", reject);
  });
  doc.pipe(outputStream);

  const layout = file.layout === "landscape" ? "landscape" : "portrait";
  const pageMargin = file.margin === "small" ? SMALL_MARGIN : 0;
  const pageSize = paperPoints(file.size || "A4", layout);
  const images = file.files || [];
  const prepared: Array<{ source: string | Buffer; width: number; height: number }> = [];
  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const imageFile = typeof item === "string" ? item : item.path;
    const rotation = typeof item === "string" ? 0 : Number(item.rotation) || 0;
    const source = await imageForPdf(imageFile, rotation);
    const size = typeof source === "string" ? await imageSizeFromFile(source) : imageSize(source);
    const imageWidth = size.width || 0;
    const imageHeight = size.height || 0;
    if (!imageWidth || !imageHeight) throw new Error("无法读取图片尺寸");
    prepared.push({ source, width: imageWidth, height: imageHeight });
  }

  if (prepared.length && file.placement) {
    for (let i = 0; i < prepared.length; i++) {
      const image = prepared[i];
      doc.addPage({ size: pageSize, margin: 0 });
      const box = placeOnPage(image.width, image.height, doc.page.width, doc.page.height, file.placement);
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).clip();
      doc.image(image.source, box.x, box.y, { width: box.width, height: box.height });
      doc.restore();
    }
  } else if (prepared.length) {
    doc.addPage({ size: pageSize, margin: 0 });
    const boxWidth = doc.page.width - pageMargin * 2;
    const boxHeight = doc.page.height - pageMargin * 2;
    const pages = layoutImagePages(
      prepared,
      boxWidth,
      boxHeight,
      file.stack === "vertical" ? "vertical" : "auto",
    );
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      if (pageIndex > 0) doc.addPage({ size: pageSize, margin: 0 });
      const page = pages[pageIndex];
      for (let i = 0; i < page.length; i++) {
        const item = page[i];
        let offsetX = pageMargin + item.x;
        let offsetY = pageMargin + item.y;
        if (Math.abs(offsetX) < 1e-9) offsetX = 0;
        if (Math.abs(offsetY) < 1e-9) offsetY = 0;
        doc.image(prepared[item.index].source, offsetX, offsetY, {
          width: item.width,
          height: item.height,
        });
      }
    }
  }

  doc.end();
  await finished;
  return filepath;
}

function printPdfFile(filepath: string, copies = 1, deviceName = "") {
  return new Promise((resolve, reject) => {
    const printWin = new BrowserWindow({
      show: false,
      webPreferences: { plugins: true },
    });
    let settled = false;
    const finish = (error?: Error, cancelled = false) => {
      if (settled) return;
      settled = true;
      if (!printWin.isDestroyed()) printWin.close();
      if (error) reject(error);
      else resolve({ cancelled });
    };
    const loadTimer = setTimeout(() => finish(new Error("打印文件打开超时")), 20000);
    printWin.webContents.once("did-fail-load", () => {
      clearTimeout(loadTimer);
      finish(new Error("打印文件打开失败"));
    });
    printWin.webContents.once("did-finish-load", () => {
      clearTimeout(loadTimer);
      const options: Electron.WebContentsPrintOptions = {
        silent: false,
        printBackground: true,
        copies: Math.min(99, Math.max(1, Math.round(copies) || 1)),
      };
      if (deviceName) options.deviceName = deviceName;
      printWin.webContents.print(options, (success, reason) => {
        const cancelled = !success && /cancel/i.test(String(reason || ""));
        if (success || cancelled || !reason) finish(undefined, cancelled);
        else finish(new Error("打印未完成"));
      });
    });
    printWin.loadFile(filepath);
  });
}

let pdfCache: { key: string; path: string } | null = null;

function pdfCacheKey(file: {
  files?: Array<string | { path: string; rotation?: number }>;
  size?: string;
  layout?: string;
  margin?: string;
  stack?: string;
}) {
  const images = file.files || [];
  const parts: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    const imageFile = typeof item === "string" ? item : item.path;
    const rotation = typeof item === "string" ? 0 : Number(item.rotation) || 0;
    let stamp = "missing";
    try {
      const value = fs.statSync(imageFile);
      stamp = `${value.mtimeMs}:${value.size}`;
    } catch {
      stamp = "missing";
    }
    parts.push(`${imageFile}|${rotation}|${stamp}`);
  }
  return JSON.stringify({
    images: parts,
    size: file.size || "A4",
    layout: file.layout === "landscape" ? "landscape" : "portrait",
    margin: file.margin === "small" ? "small" : "none",
    stack: file.stack === "vertical" ? "vertical" : "auto",
    flow: "fit",
  });
}

async function ensurePdf(file: {
  files: Array<string | { path: string; rotation?: number }>;
  size?: string;
  layout?: string;
  margin?: string;
  stack?: string;
}) {
  const key = pdfCacheKey(file);
  if (pdfCache && pdfCache.key === key && fs.existsSync(pdfCache.path)) {
    return { path: pdfCache.path, reused: true };
  }
  const filepath = await renderPdf(file);
  pdfCache = { key, path: filepath };
  return { path: filepath, reused: false };
}

ipcMain.handle("preview_pdf", async (_event, data) => ensurePdf(JSON.parse(data)));

ipcMain.handle("take_open_images", () => pendingOpens.splice(0));

function outputFormat(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "png" as const;
  if (ext === ".webp") return "webp" as const;
  return "jpeg" as const;
}

function nextCopyPath(filePath: string) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  let candidate = path.join(dir, `${base}-副本${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-副本${index}${ext}`);
    index += 1;
  }
  return candidate;
}

function writeImageFile(filePath: string, bytes: Buffer) {
  const tmp = `${filePath}.${generateRandomString()}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, filePath);
}

ipcMain.handle("render_edit", async (_event, data: string) => {
  const options = JSON.parse(data);
  const file = assertImageFile(options.path);
  const save = options.save === "copy" || options.save === "original" || options.save === "apply" ? options.save : "";
  if (save === "apply") {
    const dirpath = path.join(app.getPath("documents"), "pic_print");
    fs.mkdirSync(dirpath, { recursive: true });
    const rendered = await renderEdit(file, options, false, "png");
    const png = path.join(dirpath, `${generateRandomString()}.png`);
    fs.writeFileSync(png, rendered.data);
    return { path: png };
  }
  const target = save === "copy" ? nextCopyPath(file) : file;
  const rendered = await renderEdit(file, options, !save, save ? outputFormat(target) : "jpeg");
  if (save) {
    writeImageFile(target, rendered.data);
    return { path: target };
  }
  return {
    width: rendered.info.width,
    height: rendered.info.height,
    sourceWidth: rendered.sourceWidth,
    sourceHeight: rendered.sourceHeight,
    fileSize: fs.statSync(file).size,
    bytes: rendered.data,
  };
});

ipcMain.handle("list_printers", (event) => event.sender.getPrintersAsync());

ipcMain.handle("print_sheet", async (_event, data: string) => {
  const options = JSON.parse(data);
  const images = Array.isArray(options.images) ? options.images : [];
  const dirpath = path.join(app.getPath("documents"), "pic_print");
  fs.mkdirSync(dirpath, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    if (item?.edit?.path) {
      const file = assertImageFile(item.edit.path);
      const rendered = await renderEdit(file, item.edit, false, "png");
      const png = path.join(dirpath, `${generateRandomString()}.png`);
      fs.writeFileSync(png, rendered.data);
      files.push(png);
    } else if (item?.path) {
      files.push(assertImageFile(item.path));
    }
  }
  if (!files.length) throw new Error("没有可打印的图片");
  const pdf = await renderPdf({
    files,
    size: options.size === "A3" ? "A3" : "A4",
    layout: options.layout === "landscape" ? "landscape" : "portrait",
    margin: "none",
    placement: {
      fit: options.fit !== false,
      sizing: options.sizing,
      scale: options.scale,
      alignX: options.alignX,
      alignY: options.alignY,
      x: options.x,
      y: options.y,
    },
  });
  return printPdfFile(pdf, Number(options.copies) || 1, options.deviceName || "");
});

function assertPreviewPdf(filePath: string) {
  const dir = path.resolve(app.getPath("documents"), "pic_print");
  const resolved = path.resolve(filePath);
  const inside = resolved === dir || resolved.startsWith(`${dir}${path.sep}`);
  if (!inside || !resolved.toLowerCase().endsWith(".pdf") || !fs.existsSync(resolved)) {
    throw new Error("预览文件不存在");
  }
  return resolved;
}

ipcMain.handle("read_preview_pdf", (_event, filePath: string) => {
  return fs.readFileSync(assertPreviewPdf(filePath));
});

ipcMain.handle("open_pdf_external", async (_event, data) => {
  const payload = JSON.parse(data);
  const filePath = payload?.path ? assertPreviewPdf(payload.path) : (await ensurePdf(payload)).path;
  const errorText = await shell.openPath(filePath);
  if (errorText) throw new Error(errorText);
  return { path: filePath };
});

function sendUpdate(payload: { status: string; version?: string; percent?: number }) {
  win?.webContents.send("app_update", payload);
}

let updaterReady = false;

function applyUpdateFeed() {
  autoUpdater.setFeedURL(updateFeed(readSettings().updateProxy));
}

function setupUpdater() {
  if (!app.isPackaged || updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => {
    sendUpdate({ status: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => {
    sendUpdate({ status: "current" });
  });
  autoUpdater.on("download-progress", (progress) => {
    sendUpdate({ status: "downloading", percent: Math.round(progress.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    sendUpdate({ status: "downloaded", version: info.version });
  });
  autoUpdater.on("error", () => {
    sendUpdate({ status: "error" });
  });
  applyUpdateFeed();
}

ipcMain.handle("get_settings", () => readSettings());

ipcMain.handle("save_settings", (_event, data: string) => {
  const prev = readSettings();
  const next = writeSettings(JSON.parse(data));
  if (app.isPackaged && prev.updateProxy !== next.updateProxy) {
    applyUpdateFeed();
    if (next.checkOnStartup) autoUpdater.checkForUpdates().catch(() => {});
  }
  return next;
});

ipcMain.handle("check_update", async () => {
  if (!app.isPackaged) return { ok: false, reason: "unpackaged" };
  if (!updaterReady) setupUpdater();
  applyUpdateFeed();
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo?.version || "";
    return { ok: true, version, available: Boolean(version && version !== app.getVersion()) };
  } catch {
    return { ok: false, reason: "network" };
  }
});

ipcMain.handle("app_version", () => app.getVersion());

ipcMain.handle("install_update", () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("print_pdf", async (_event, data) => {
  const payload = JSON.parse(data);
  if (payload?.path) return printPdfFile(assertPreviewPdf(payload.path));
  const result = await ensurePdf(payload);
  return printPdfFile(result.path);
});

ipcMain.handle("fetch_page_images", async (event, pageUrl: string) => {
  try {
    return await fetchPageImages(pageUrl, (progress) => {
      event.sender.send("fetch_page_progress", progress);
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : "抓取失败";
    return { files: [], detected: 0, saved: 0, error: text };
  }
});

ipcMain.handle("sort_files", async (_event, data: string) => {
  const info = JSON.parse(data);
  const files: string[] = Array.isArray(info.files) ? info.files : [];
  const listed = await Promise.all(files.map(async (item) => {
    const value = await stat(item);
    return { path: item, birthtimeMs: value.birthtimeMs, mtimeMs: value.mtimeMs };
  }));
  const key = info.type === "create" ? "birthtimeMs" : "mtimeMs";
  const direction = info.sort === "asc" ? 1 : -1;
  listed.sort((a, b) => (a[key] - b[key]) * direction);
  return listed.map((item) => item.path);
});
const menu = Menu.buildFromTemplate([]);
Menu.setApplicationMenu(process.platform === "darwin" ? menu : null);

app.on("window-all-closed", () => {
  win = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  const dirpath = path.join(app.getPath("documents"), "pic_print");
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dirpath);
  } catch {
    return;
  }
  for (let i = 0; i < entries.length; i++) {
    const itemPath = path.join(dirpath, entries[i]);
    try {
      if (fs.statSync(itemPath).isFile()) fs.unlinkSync(itemPath);
    } catch (err) {
      console.log(err);
    }
  }
});

app.on("second-instance", (_event, argv, workingDirectory) => {
  publishOpens(imagePathsFromArgv(argv, workingDirectory));
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("activate", () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length) {
    allWindows[0].focus();
  } else {
    createWindow();
  }
});
