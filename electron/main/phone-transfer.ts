import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import Bonjour from "bonjour-service";

type Arrival = { path: string; name: string; hash: string };
type Hooks = {
  dir: string;
  keep: (hash: string) => Promise<boolean>;
  cancel: (hash: string) => void;
  onImage: (file: Arrival) => void;
  onJoin: (devices: string[]) => void;
  onClients: (devices: string[]) => void;
  onDisconnect: (session: { reason: "leave" | "idle" }) => void;
};

type Phone = { name: string; seen: number; reason: "leave" | "idle"; socket: WebSocket };

const IDLE_MS = 30 * 60 * 1000;
const LOCAL_PORT = 17321;

let server: http.Server | null = null;
let probe: http.Server | null = null;
let bonjour: Bonjour | null = null;
let hooks: Hooks | null = null;
let token = "";
let clients = new Map<string, Phone>();
let sockets: WebSocketServer | null = null;
let currentIp = "";
let currentPort = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let starting: Promise<ReturnType<typeof sessionInfo>> | null = null;

export function startPhoneTransfer(options: Hooks) {
  hooks = options;
  if (server && currentPort && token) return Promise.resolve(sessionInfo());
  if (starting) return starting;
  const ip = lanIPv4();
  if (!ip) return Promise.reject(new Error("没有可用的局域网地址"));
  token = randomBytes(8).toString("hex");
  clients = new Map();
  currentIp = ip;
  fs.mkdirSync(options.dir, { recursive: true });
  starting = listen().then((active) => {
    const address = active.address();
    currentPort = typeof address === "object" && address ? address.port : 0;
    advertise(currentPort, token);
    startLocalProbe();
    return sessionInfo();
  }).finally(() => {
    starting = null;
  });
  return starting;
}

export function stopPhoneTransfer() {
  hooks = null;
  token = "";
  currentPort = 0;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  for (const phone of clients.values()) phone.socket.close();
  clients = new Map();
  sockets?.close();
  sockets = null;
  if (server) {
    server.close();
    server = null;
  }
  stopAdvertiser();
  stopLocalProbe();
}

function sessionInfo() {
  return {
    url: `http://${currentIp}:${currentPort}/join?token=${token}`,
    ip: currentIp,
    port: currentPort,
    token,
  };
}

function stopAdvertiser() {
  const instance = bonjour;
  bonjour = null;
  if (!instance) return;
  try {
    instance.destroy();
  } catch {
    // 退出时组播套接字可能已经关掉
  }
}

function startLocalProbe() {
  stopLocalProbe();
  const active = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/session" || !token || !currentPort) {
      sendJson(res, 404, { ok: false });
      return;
    }
    sendJson(res, 200, { ok: true, port: currentPort, token });
  });
  probe = active;
  active.on("error", () => {
    if (probe === active) probe = null;
  });
  active.listen(LOCAL_PORT, "127.0.0.1");
}

function stopLocalProbe() {
  const active = probe;
  probe = null;
  if (!active) return;
  try {
    active.close();
  } catch {
    // 退出时端口可能已经关掉
  }
}

function advertise(port: number, current: string) {
  stopAdvertiser();
  const instance = new Bonjour(undefined, () => {});
  bonjour = instance;
  instance.publish({
    name: "pic-print",
    type: "picprint",
    port,
    protocol: "tcp",
    txt: { token: current },
  });
}

function noteActivity(id: string) {
  const phone = clients.get(id);
  if (!phone) return;
  phone.seen = Date.now();
  scheduleSweep();
}

function deviceNames() {
  return [...clients.values()].map((item) => item.name);
}

function deviceLabel(value: unknown) {
  const text = String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 32);
  return text || "手机";
}

function registerPhone(socket: WebSocket, name: string) {
  const id = randomBytes(4).toString("hex");
  const previous = clients.size;
  clients.set(id, { name: deviceLabel(name), seen: Date.now(), reason: "leave", socket });
  scheduleSweep();
  if (previous === 0) hooks?.onJoin(deviceNames());
  else hooks?.onClients(deviceNames());
  return id;
}

function forgetPhone(id: string) {
  const phone = clients.get(id);
  if (!phone) return;
  const reason = phone.reason;
  clients.delete(id);
  if (!clients.size) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    hooks?.onDisconnect({ reason });
    return;
  }
  hooks?.onClients(deviceNames());
  scheduleSweep();
}

function scheduleSweep() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!clients.size) return;
  let oldest = Date.now();
  for (const phone of clients.values()) oldest = Math.min(oldest, phone.seen);
  idleTimer = setTimeout(sweepClients, Math.max(1000, oldest + IDLE_MS - Date.now()));
}

function sweepClients() {
  idleTimer = null;
  const now = Date.now();
  for (const phone of [...clients.values()]) {
    if (now - phone.seen < IDLE_MS) continue;
    phone.reason = "idle";
    phone.socket.close();
  }
  scheduleSweep();
}

function knownClient(id: string) {
  if (!id || !clients.has(id)) return false;
  noteActivity(id);
  return true;
}

function listen() {
  const active = http.createServer(async (req, res) => {
    try {
      await route(req, res);
    } catch {
      sendJson(res, 500, { ok: false, error: "传图失败" });
    }
  });
  server = active;
  const wss = new WebSocketServer({ noServer: true });
  sockets = wss;
  active.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const given = url.searchParams.get("token") || "";
    if (url.pathname !== "/socket" || (given && given !== token)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      acceptSocket(ws);
    });
  });
  return new Promise<http.Server>((resolve, reject) => {
    const fail = (error: Error) => {
      active.close();
      if (server === active) server = null;
      reject(error);
    };
    active.once("error", fail);
    active.listen(0, "0.0.0.0", () => {
      active.off("error", fail);
      resolve(active);
    });
  });
}

function acceptSocket(socket: WebSocket) {
  let id = "";
  const helloTimer = setTimeout(() => {
    if (!id) socket.close();
  }, 8000);
  socket.on("message", (data) => {
    let msg: { type?: string; name?: string } = {};
    try {
      const text = Buffer.isBuffer(data) ? data.toString() : Array.isArray(data) ? Buffer.concat(data).toString() : String(data);
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!id) {
      if (msg.type !== "hello") {
        socket.close();
        return;
      }
      clearTimeout(helloTimer);
      id = registerPhone(socket, msg.name || "");
      socket.send(JSON.stringify({ type: "hello", ok: true, client: id, token, name: "图片打印" }));
      return;
    }
    noteActivity(id);
    if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
  });
  socket.on("close", () => {
    clearTimeout(helloTimer);
    if (id) forgetPhone(id);
  });
  socket.on("error", () => socket.close());
}

async function route(req: http.IncomingMessage, res: http.ServerResponse) {
  const options = hooks;
  if (!options || !token) {
    sendJson(res, 503, { ok: false, error: "传图未开启" });
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/join") {
    const given = url.searchParams.get("token") || "";
    if (given && given !== token) {
      sendHtml(res, "二维码已失效", "请重新打开电脑上的手机传图，再用小程序扫码。");
      return;
    }
    sendHtml(res, "请用小程序连接", "微信扫一扫只会打开这个页面，不会连上电脑。请打开小程序，在首页点「连接电脑」，用里面的扫码。");
    return;
  }
  if (req.method === "POST" && url.pathname === "/images") {
    if (url.searchParams.get("token") !== token || !knownClient(url.searchParams.get("client") || "")) {
      sendJson(res, 403, { ok: false, error: "连接已失效" });
      return;
    }
    const body = await readBody(req, 20_000_000);
    const file = extractUpload(body, String(req.headers["content-type"] || ""));
    const ext = file && file.data.length ? imageExt(file.filename, file.data) : "";
    if (!file || !ext) {
      sendJson(res, 415, { ok: false, error: "只支持 JPG、PNG、WebP" });
      return;
    }
    const hash = createHash("sha256").update(file.data).digest("hex");
    if (!await options.keep(hash)) {
      sendJson(res, 200, { ok: true, duplicate: true });
      return;
    }
    const name = safeName(file.filename, ext);
    const filepath = path.join(options.dir, name);
    try {
      await fs.promises.writeFile(filepath, file.data);
    } catch (error) {
      options.cancel(hash);
      throw error;
    }
    options.onImage({ path: filepath, name, hash });
    sendJson(res, 200, { ok: true, name });
    return;
  }
  sendJson(res, 404, { ok: false, error: "没有这个地址" });
}

function lanIPv4() {
  const found: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      const family = item.family as string | number;
      if (item.internal || (family !== "IPv4" && family !== 4)) continue;
      found.push(item.address);
    }
  }
  return found.find((ip) => ip.startsWith("192.168.") || ip.startsWith("10.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) || found[0] || "";
}

function readBody(req: http.IncomingMessage, limit: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("图片太大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractUpload(body: Buffer, contentType: string) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (boundaryMatch?.[1] || boundaryMatch?.[2] || "").trim();
  if (!boundary) return null;
  const marker = Buffer.from(`--${boundary}`);
  const start = body.indexOf(marker);
  if (start < 0) return null;
  const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), start);
  if (headerEnd < 0) return null;
  const headers = body.subarray(start, headerEnd).toString("utf8");
  const nameMatch = /filename\*=UTF-8''([^;\r\n]+)|filename="([^"]*)"|filename=([^;\r\n]+)/i.exec(headers);
  const filename = decodeURIComponent((nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || "image.jpg").trim());
  const dataStart = headerEnd + 4;
  const next = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
  return { filename, data: body.subarray(dataStart, next >= 0 ? next : body.length) };
}

function imageExt(filename: string, data: Buffer) {
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8) return ".jpg";
  if (data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return ".png";
  if (data.length > 12 && data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP") return ".webp";
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return ".jpg";
  if (ext === ".png" || ext === ".webp") return ext;
  return "";
}

function safeName(filename: string, ext: string) {
  const base = path.basename(filename, path.extname(filename)).replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 40);
  return `${base || "图片"}-${randomBytes(3).toString("hex")}${ext}`;
}

function sendHtml(res: http.ServerResponse, title: string, text: string) {
  const payload = Buffer.from(`<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3ede4;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#2f2820"><main style="width:min(440px,calc(100% - 48px));padding:28px;border-radius:20px;background:#fffdf9"><h1 style="margin:0;font-size:22px">${title}</h1><p style="margin:12px 0 0;line-height:1.7;font-size:16px;color:#7a6a5a">${text}</p></main>`);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": payload.length,
  });
  res.end(payload);
}

function sendJson(res: http.ServerResponse, status: number, body: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
  });
  res.end(payload);
}
