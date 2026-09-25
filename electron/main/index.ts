import { app, dialog, BrowserWindow, shell, Menu, ipcMain, protocol, net } from "electron";
import electronUpdater from "electron-updater";
import { fileURLToPath, pathToFileURL } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import { imageSize } from "image-size";
import { imageSizeFromFile } from "image-size/fromFile";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import { fetchPageImages } from "./fetch-images";
import { layoutImagePages } from "./pdf-layout";
import { renderEdit } from "./image-edit";
import { paperPoints } from "../../src/paper";
import { IMAGE_EXT } from "../../src/files";
import { readSettings, updateFeed, writeSettings } from "./settings";
import { startPhoneTransfer, stopPhoneTransfer } from "./phone-transfer";
import { stat } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
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
    width: 1320,
    height: 880,
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

function isListedFile(filePath: string) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function collectImages(inputs: string[]) {
  const files: string[] = [];
  const seen = new Set<string>();
  const add = (filePath: string) => {
    const key = process.platform === "win32" ? filePath.toLowerCase() : filePath;
    if (seen.has(key) || !IMAGE_EXT.test(path.basename(filePath)) || !isListedFile(filePath)) return;
    seen.add(key);
    files.push(filePath);
  };
  for (let i = 0; i < inputs.length; i++) {
    const item = inputs[i];
    let info: fs.Stats;
    try {
      info = fs.statSync(item);
    } catch {
      continue;
    }
    if (!info.isDirectory()) {
      add(item);
      continue;
    }
    let names: string[] = [];
    try {
      names = fs.readdirSync(item);
    } catch {
      continue;
    }
    for (let j = 0; j < names.length; j++) {
      if (!IMAGE_EXT.test(names[j])) continue;
      add(path.join(item, names[j]));
    }
  }
  return files;
}

ipcMain.handle("openDialogSync", async (_event, kind?: string) => {
  const directory = kind === "directory";
  // Windows 和 Linux 不能在同一个系统框里同时选文件和文件夹，同时打开时只会剩文件夹。
  const properties: Array<"openFile" | "openDirectory" | "multiSelections"> = directory
    ? ["openDirectory", "multiSelections"]
    : process.platform === "darwin"
      ? ["openFile", "openDirectory", "multiSelections"]
      : ["openFile", "multiSelections"];
  const options: Electron.OpenDialogOptions = {
    title: directory ? "选择文件夹" : "选择图片",
    buttonLabel: "添加",
    properties,
  };
  if (!directory) {
    options.filters = [
      { name: "图片", extensions: ["jpg", "jpeg", "jpe", "jfif", "png", "webp"] },
      { name: "所有文件", extensions: ["*"] },
    ];
  }
  const result = await dialog.showOpenDialog(win ?? undefined, options);
  if (result.canceled || !result.filePaths.length) return null;
  return collectImages(result.filePaths);
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

type PrintJob = {
  copies?: number;
  deviceName?: string;
  grayscale?: boolean;
  duplex?: boolean;
  duplexMode?: "longEdge" | "shortEdge";
  collate?: boolean;
  dpi?: number;
  paper?: string;
  paperWidth?: number;
  paperHeight?: number;
};

function jobCopies(job: PrintJob) {
  return Math.min(99, Math.max(1, Math.round(Number(job.copies)) || 1));
}

function cupsEnv() {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === "LANG" || key.startsWith("LC_") || value === undefined) continue;
    env[key] = value;
  }
  env.LANG = "C";
  env.LC_ALL = "C";
  return env;
}

function runCommand(bin: string, args: string[], timeout: number, env?: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    execFile(bin, args, { timeout, encoding: "utf8", windowsHide: true, env }, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = String(stderr || error.message || "").trim();
      const wrapped = new Error(detail || "打印未完成");
      (wrapped as NodeJS.ErrnoException).code = (error as NodeJS.ErrnoException).code;
      reject(wrapped);
    });
  });
}

function cupsMedia(job: PrintJob) {
  const names: Record<string, string> = {
    a4: "A4",
    a3: "A3",
    a5: "A5",
    b5: "B5",
    letter: "Letter",
    legal: "Legal",
  };
  return names[String(job.paper || "").trim().toLowerCase()] || "A4";
}

function cupsDuplex(job: PrintJob) {
  if (job.duplex === true) return job.duplexMode === "shortEdge" ? "DuplexTumble" : "DuplexNoTumble";
  if (job.duplex === false) return "None";
  return "";
}

function lpArgs(filepath: string, job: PrintJob, detailed: boolean) {
  const args = ["-t", "图片打印", "-n", String(jobCopies(job))];
  if (job.deviceName) args.push("-d", job.deviceName);
  if (detailed) {
    args.push("-o", `media=${cupsMedia(job)}`);
    const duplex = cupsDuplex(job);
    if (duplex) args.push("-o", `Duplex=${duplex}`);
    if (job.grayscale) args.push("-o", "ColorModel=Gray");
    args.push("-o", "fit-to-page");
  }
  args.push(filepath);
  return args;
}

async function printWithLp(filepath: string, job: PrintJob) {
  const bin = process.platform === "darwin" ? "/usr/bin/lp" : "lp";
  await runCommand(bin, lpArgs(filepath, job, true), 60000, cupsEnv());
  return { cancelled: false };
}

const WINDOWS_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Printer = "",
  [int]$Copies = 1,
  [string]$Duplex = "",
  [switch]$Collate,
  [switch]$Grayscale,
  [double]$PaperWidth = 0,
  [double]$PaperHeight = 0,
  [int]$Dpi = 200
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation\`1"
})[0]
function Await($Operation, $Type) {
  $task = $asTaskGeneric.MakeGenericMethod($Type).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}
function AwaitAction($Action) {
  $method = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod
  })[0]
  $task = $method.Invoke($null, @($Action))
  $task.Wait()
}
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
if ($pdf.PageCount -lt 1) { throw "PDF 没有页面" }
$dpi = [Math]::Max(72, [Math]::Min(300, $Dpi))
$stamp = [guid]::NewGuid().ToString("n")
$script:images = @()
for ($i = 0; $i -lt $pdf.PageCount; $i++) {
  $page = $pdf.GetPage($i)
  $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
  $render = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $pixels = [uint32]([Math]::Min(4500, [Math]::Round($page.Size.Width * $dpi / 96)))
  if ($pixels -gt 0) { $render.DestinationWidth = $pixels }
  AwaitAction ($page.RenderToStreamAsync($stream, $render))
  $memory = New-Object System.IO.MemoryStream
  [System.IO.WindowsRuntimeStreamExtensions]::AsStream($stream).CopyTo($memory)
  $memory.Position = 0
  $bitmap = [System.Drawing.Image]::FromStream($memory)
  $pageFile = Join-Path $env:TEMP ("pic-print-{0}-{1}.png" -f $stamp, $i)
  $bitmap.Save($pageFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
  $memory.Dispose()
  $script:images += $pageFile
}
$script:pageIndex = 0
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = "图片打印"
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
if ($Printer) { $doc.PrinterSettings.PrinterName = $Printer }
if (-not $doc.PrinterSettings.IsValid) { throw "找不到这台打印机" }
$doc.PrinterSettings.Copies = [int16]([Math]::Max(1, [Math]::Min(99, $Copies)))
if ($Collate) { $doc.PrinterSettings.Collate = $true }
if ($Duplex -eq "long" -and $doc.PrinterSettings.CanDuplex) {
  $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Vertical
} elseif ($Duplex -eq "short" -and $doc.PrinterSettings.CanDuplex) {
  $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Horizontal
} elseif ($Duplex -eq "simplex" -and $doc.PrinterSettings.CanDuplex) {
  $doc.PrinterSettings.Duplex = [System.Drawing.Printing.Duplex]::Simplex
}
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.DefaultPageSettings.Color = -not $Grayscale
if ($PaperWidth -gt 0 -and $PaperHeight -gt 0) {
  $width = [int][Math]::Round($PaperWidth * 100 / 72)
  $height = [int][Math]::Round($PaperHeight * 100 / 72)
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("pic-print", $width, $height)
  $doc.DefaultPageSettings.Landscape = $false
}
$doc.add_PrintPage({
  param($sender, $e)
  $image = [System.Drawing.Image]::FromFile($script:images[$script:pageIndex])
  $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $e.Graphics.TranslateTransform(-$e.PageSettings.HardMarginX, -$e.PageSettings.HardMarginY)
  $e.Graphics.DrawImage($image, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height)
  $image.Dispose()
  $script:pageIndex += 1
  $e.HasMorePages = $script:pageIndex -lt $script:images.Count
})
try { $doc.Print() } finally {
  $doc.Dispose()
  foreach ($pageFile in $script:images) { Remove-Item $pageFile -Force -ErrorAction SilentlyContinue }
}
`;

async function printWithWindows(filepath: string, job: PrintJob) {
  const scriptPath = path.join(os.tmpdir(), "pic-print-spool.ps1");
  await fs.promises.writeFile(scriptPath, WINDOWS_PRINT_SCRIPT.trim(), "utf8");
  const args = [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-Path", filepath,
    "-Copies", String(jobCopies(job)),
    "-Dpi", String(job.dpi === 300 ? 300 : 200),
  ];
  if (job.deviceName) args.push("-Printer", job.deviceName);
  if (job.duplex === true) args.push("-Duplex", job.duplexMode === "shortEdge" ? "short" : "long");
  else if (job.duplex === false) args.push("-Duplex", "simplex");
  if (job.collate) args.push("-Collate");
  if (job.grayscale) args.push("-Grayscale");
  if (job.paperWidth && job.paperHeight) {
    args.push("-PaperWidth", String(job.paperWidth), "-PaperHeight", String(job.paperHeight));
  }
  await runCommand("powershell.exe", args, 120000);
  return { cancelled: false };
}

function printPdfFile(filepath: string, copies: number | PrintJob = 1, deviceName = "") {
  const job: PrintJob = typeof copies === "number" ? { copies, deviceName } : copies;
  if (process.platform === "win32") return printWithWindows(filepath, job);
  return printWithLp(filepath, job);
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
  return printPdfFile(pdf, {
    copies: Number(options.copies) || 1,
    deviceName: options.deviceName || "",
    paper: options.size === "A3" ? "A3" : "A4",
  });
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

function finite(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

async function composePrintPdf(payload: {
  grayscale?: boolean;
  paperWidth?: number;
  paperHeight?: number;
  clip?: { x?: number; y?: number; w?: number; h?: number };
  sheets?: Array<Array<{ jpeg?: string; x?: number; y?: number; w?: number; h?: number }>>;
}) {
  const paperWidth = finite(payload.paperWidth, 200, 2000);
  const paperHeight = finite(payload.paperHeight, 200, 2000);
  const sheets = Array.isArray(payload.sheets) ? payload.sheets.slice(0, 80) : [];
  if (!sheets.length) throw new Error("没有要打印的页面");
  const clip = payload.clip || {};
  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const filepath = path.join(os.tmpdir(), `pic-print-${generateRandomString()}.pdf`);
  const outputStream = fs.createWriteStream(filepath);
  const finished = new Promise((resolve, reject) => {
    outputStream.on("finish", () => resolve(filepath));
    outputStream.on("error", reject);
  });
  doc.pipe(outputStream);
  for (const sheet of sheets) {
    doc.addPage({ size: [paperWidth, paperHeight], margin: 0 });
    doc.save();
    doc.rect(
      finite(clip.x, 0, paperWidth),
      finite(clip.y, 0, paperHeight),
      finite(clip.w, 1, paperWidth),
      finite(clip.h, 1, paperHeight),
    ).clip();
    const cells = Array.isArray(sheet) ? sheet.slice(0, 16) : [];
    for (const cell of cells) {
      const jpeg = String(cell?.jpeg || "");
      if (!jpeg || jpeg.length > 12_000_000) continue;
      let image: Buffer = Buffer.from(jpeg, "base64");
      if (payload.grayscale) image = await sharp(image).grayscale().jpeg({ quality: 90 }).toBuffer();
      doc.image(image, finite(cell.x, -paperWidth, paperWidth * 2), finite(cell.y, -paperHeight, paperHeight * 2), {
        width: finite(cell.w, 1, paperWidth * 8),
        height: finite(cell.h, 1, paperHeight * 8),
      });
    }
    doc.restore();
  }
  doc.end();
  await finished;
  return filepath;
}

ipcMain.handle("open_printer_properties", async (_event, deviceName: string) => {
  const name = String(deviceName || "").trim();
  if (!name) throw new Error("请先选择一台打印机");
  await new Promise<void>((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn("rundll32.exe", ["printui.dll,PrintUIEntry", "/e", "/n", name], { detached: true, stdio: "ignore", windowsHide: true })
      : process.platform === "darwin"
        ? spawn("open", ["x-apple.systempreferences:com.apple.Printers-Settings.extension"], { detached: true, stdio: "ignore" })
        : spawn("system-config-printer", [], { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
});

ipcMain.handle("print_pdf", async (_event, data) => {
  const payload = JSON.parse(data);
  const copies = Number(payload?.copies) || 1;
  const deviceName = payload?.deviceName || "";
  if (Array.isArray(payload?.sheets)) {
    const filepath = await composePrintPdf(payload);
    try {
      return await printPdfFile(filepath, {
        copies,
        deviceName,
        grayscale: Boolean(payload.grayscale),
        duplex: Boolean(payload.duplex),
        duplexMode: payload.duplexEdge === "shortEdge" ? "shortEdge" : "longEdge",
        collate: Boolean(payload.collate),
        dpi: payload.quality === "high" ? 300 : 150,
        paper: typeof payload.paper === "string" ? payload.paper : "",
        paperWidth: Number(payload.paperWidth) || undefined,
        paperHeight: Number(payload.paperHeight) || undefined,
      });
    } finally {
      fs.promises.unlink(filepath).catch(() => {});
    }
  }
  if (payload?.path) return printPdfFile(assertPreviewPdf(payload.path), copies, deviceName);
  const result = await ensurePdf(payload);
  return printPdfFile(result.path, copies, deviceName);
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

const phoneDecisions = new Map<string, (keep: boolean) => void>();

ipcMain.handle("phone_transfer_start", (event) => {
  const dirpath = path.join(app.getPath("documents"), "pic_print");
  const send = (payload: Record<string, unknown>) => {
    if (!event.sender.isDestroyed()) event.sender.send("phone_transfer", payload);
  };
  return startPhoneTransfer({
    dir: dirpath,
    keep: (hash) => new Promise((resolve) => {
      const id = randomBytes(4).toString("hex");
      const timer = setTimeout(() => {
        phoneDecisions.delete(id);
        resolve(true);
      }, 4000);
      phoneDecisions.set(id, (keep) => {
        clearTimeout(timer);
        phoneDecisions.delete(id);
        resolve(keep);
      });
      send({ type: "offer", id, hash });
    }),
    cancel: (hash) => send({ type: "offer-cancel", hash }),
    onJoin: (devices) => send({ type: "join", devices }),
    onClients: (devices) => send({ type: "clients", devices }),
    onImage: (file) => send({ type: "image", path: file.path, name: file.name, hash: file.hash }),
    onDisconnect: (session) => send({ type: "disconnect", reason: session.reason }),
  });
});

ipcMain.handle("phone_transfer_decide", (_event, payload: unknown) => {
  const body = payload && typeof payload === "object" ? payload as { id?: unknown; keep?: unknown } : {};
  const id = typeof body.id === "string" ? body.id : "";
  phoneDecisions.get(id)?.(body.keep === true);
});

ipcMain.handle("phone_transfer_discard", async (_event, filePath: unknown) => {
  if (typeof filePath !== "string") return;
  const dirpath = path.resolve(app.getPath("documents"), "pic_print");
  const resolved = path.resolve(filePath);
  if (path.dirname(resolved) !== dirpath) return;
  await fs.promises.unlink(resolved).catch(() => {});
});

ipcMain.handle("phone_transfer_stop", () => {
  stopPhoneTransfer();
});

ipcMain.handle("image_hashes", (_event, paths: unknown) => {
  const list = Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string") : [];
  return Promise.all(list.map((filePath) => hashFile(filePath)));
});

function hashFile(filePath: string) {
  return new Promise<string>((resolve) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => resolve(""));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

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
  stopPhoneTransfer();
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
