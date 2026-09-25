import { BrowserWindow, app, net } from "electron";
import fs from "node:fs";
import path from "node:path";
import { imageSize } from "image-size";

const MAX_BYTES = 15 * 1024 * 1024;
const MIN_EDGE = 100;

type Progress = { percent: number; text: string };
type Report = (progress: Progress) => void;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(step: string, detail?: unknown) {
  if (detail === undefined) console.log(`[抓取图片] ${step}`);
  else console.log(`[抓取图片] ${step}`, detail);
}

function randomName() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 10; i > 0; i -= 1) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function extensionFor(mime: string, url: string) {
  const type = mime.toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (/\.png(?:$|\?)/i.test(url)) return ".png";
  if (/\.webp(?:$|\?)/i.test(url)) return ".webp";
  if (/\.jpe?g(?:$|\?)/i.test(url)) return ".jpg";
  return "";
}

function saveImage(buffer: Buffer, ext: string, dir: string) {
  if (buffer.length < 64 || buffer.length > MAX_BYTES) return "";
  try {
    const size = imageSize(buffer);
    if (!size.width || !size.height) return "";
    if (size.width < MIN_EDGE || size.height < MIN_EDGE) return "";
  } catch {
    return "";
  }
  const file = path.join(dir, `${randomName()}${ext}`);
  fs.writeFileSync(file, buffer);
  return file;
}

function reportProgress(report: Report, percent: number, text: string) {
  report({ percent: Math.max(0, Math.min(100, Math.round(percent))), text });
}

function openBrowser() {
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 1366,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\sElectron\/[\d.]+/, ""));
  return win;
}

function loadPage(win: BrowserWindow, url: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("页面加载超时")), 30000);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    win.webContents
      .loadURL(url)
      .then(() => finish())
      .catch((error: unknown) => {
        const text = error instanceof Error ? error.message : "";
        if (/ERR_ABORTED/.test(text)) finish();
        else finish(new Error("页面打开失败，请检查链接是否可以访问"));
      });
  });
}

const SCROLL_SCRIPT = `(() => {
  document.querySelectorAll("img").forEach((img) => {
    img.loading = "eager";
    const lazy = img.getAttribute("data-src") || img.getAttribute("data-original");
    const current = img.getAttribute("src") || "";
    if (lazy && !lazy.startsWith("data:") && (!current || current.startsWith("data:"))) img.src = lazy;
  });
  const root = document.scrollingElement || document.documentElement;
  const max = Math.max(0, root.scrollHeight - root.clientHeight);
  if (root.scrollTop < max - 2) {
    const view = Math.max(window.innerHeight || 800, 600);
    root.scrollTop = Math.min(root.scrollTop + view, max);
  }
  const images = Array.from(document.images);
  return {
    height: root.scrollHeight,
    top: root.scrollTop,
    max,
    atBottom: root.scrollTop >= max - 2,
    pending: images.filter((img) => !img.complete).length,
    total: images.length,
  };
})()`;

const WAIT_IMAGES_SCRIPT = `Promise.race([
  Promise.all(Array.from(document.images).filter((img) => !img.complete).map((img) => new Promise((resolve) => {
    img.addEventListener("load", () => resolve(true), { once: true });
    img.addEventListener("error", () => resolve(true), { once: true });
  }))),
  new Promise((resolve) => setTimeout(resolve, 2500))
])`;

async function scrollToBottom(win: BrowserWindow, report: Report) {
  await win.webContents.executeJavaScript("window.scrollTo(0, 0)");
  let lastHeight = 0;
  let stable = 0;
  let stuckPending = 0;
  for (let i = 0; i < 80; i += 1) {
    const state = await win.webContents.executeJavaScript(SCROLL_SCRIPT);
    const ratio = state.max > 0 ? Math.min(1, state.top / state.max) : 1;
    const loaded = Math.max(0, state.total - state.pending);
    reportProgress(report, 12 + ratio * 60, state.total ? `正在加载图片 ${loaded}/${state.total}` : "正在滚动页面");
    if (state.pending > 0) await win.webContents.executeJavaScript(WAIT_IMAGES_SCRIPT);
    else await delay(200);
    if (state.atBottom && state.pending === 0 && state.height === lastHeight) {
      stable += 1;
      if (stable >= 2) break;
    } else {
      stable = 0;
    }
    if (state.atBottom && state.pending > 0) {
      stuckPending += 1;
      if (stuckPending >= 8) break;
    } else {
      stuckPending = 0;
    }
    lastHeight = state.height;
  }
}

function downloadImage(win: BrowserWindow, imageUrl: string, pageUrl: string) {
  return new Promise<{ buffer: Buffer; ext: string }>((resolve, reject) => {
    const image = new URL(imageUrl);
    image.hash = "";
    const page = new URL(pageUrl);
    const request = net.request({
      url: image.href,
      session: win.webContents.session,
      redirect: "follow",
      referrerPolicy: "origin",
    });
    request.setHeader("Referer", `${page.origin}/`);
    request.setHeader("User-Agent", win.webContents.getUserAgent());
    const timer = setTimeout(() => {
      request.abort();
      reject(new Error("下载超时"));
    }, 20000);
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        clearTimeout(timer);
        const mime = String(response.headers["content-type"] || "");
        const ext = extensionFor(mime, image.href);
        if (!ext || response.statusCode >= 400) {
          reject(new Error(`图片下载失败 ${response.statusCode} ${mime}`));
          return;
        }
        resolve({ buffer: Buffer.concat(chunks), ext });
      });
      response.on("error", fail);
    });
    request.on("error", fail);
    request.end();
  });
}

async function collectImageUrls(win: BrowserWindow) {
  return win.webContents.executeJavaScript(`(() => {
    const urls = [];
    const seen = new Set();
    document.querySelectorAll("img").forEach((img) => {
      const value = img.currentSrc || img.getAttribute("src") || "";
      if (!value || value.startsWith("data:") || value.startsWith("blob:")) return;
      let href = "";
      try {
        href = new URL(value, location.href).href;
      } catch (error) {
        return;
      }
      if (seen.has(href)) return;
      seen.add(href);
      const width = img.naturalWidth || img.clientWidth || 0;
      const height = img.naturalHeight || img.clientHeight || 0;
      const small = width > 0 && height > 0 && (width < ${MIN_EDGE} || height < ${MIN_EDGE});
      if (!small) urls.push(href);
    });
    return { urls, detected: seen.size };
  })()`) as Promise<{ urls: string[]; detected: number }>;
}

export async function fetchPageImages(pageUrl: string, report: Report = () => undefined) {
  let target: URL;
  try {
    target = new URL(pageUrl.trim());
  } catch {
    throw new Error("链接格式不正确");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("只支持 http 或 https 链接");
  }

  const dir = path.join(app.getPath("documents"), "pic_print");
  fs.mkdirSync(dir, { recursive: true });
  const win = openBrowser();

  try {
    reportProgress(report, 4, "正在打开页面");
    await loadPage(win, target.href);
    reportProgress(report, 12, "页面已打开，开始加载图片");
    await delay(500);
    await scrollToBottom(win, report);

    const found = await collectImageUrls(win);
    const urls = found.urls || [];
    const detected = found.detected || 0;
    reportProgress(
      report,
      74,
      urls.length ? `准备保存 ${urls.length} 张图片` : detected ? `检测到 ${detected} 张，没有可打印的图片` : "没有发现图片"
    );
    const files: string[] = [];
    let missed = 0;
    for (let index = 0; index < urls.length; index += 1) {
      const url = urls[index];
      reportProgress(report, 74 + ((index + 1) / urls.length) * 26, `正在保存 ${index + 1}/${urls.length}`);
      try {
        const image = await downloadImage(win, url, target.href);
        const file = saveImage(image.buffer, image.ext, dir);
        if (file) files.push(file);
        else missed += 1;
      } catch (error) {
        missed += 1;
        log("这张没有抓到", { index: index + 1, url, error: error instanceof Error ? error.message : error });
      }
    }
    log("抓取结束", { detected, saved: files.length, missed });
    reportProgress(report, 100, `检测到 ${detected} 张，已抓取 ${files.length} 张`);
    return { files, detected, saved: files.length };
  } catch (error) {
    log("抓取失败", error instanceof Error ? error.message : error);
    throw error;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
