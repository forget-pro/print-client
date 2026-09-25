<template>
  <div
    class="print-app"
    :class="{ 'is-over': state.draggingOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <section class="toolbar">
      <div class="toolbar-row">
        <div class="actions">
          <span class="add-split">
            <a-button type="primary" ghost @click="opendir('file')">
              <template #icon><folder-open-outlined /></template>
              添加图片
            </a-button>
            <a-dropdown v-model:open="addMenuOpen" placement="bottomLeft" trigger="click">
              <a-button type="primary" ghost class="add-caret" aria-label="选择文件夹">
                <down-outlined />
              </a-button>
              <template #overlay>
                <a-menu @click="onAddMenu">
                  <a-menu-item key="file">选择图片</a-menu-item>
                  <a-menu-item key="directory">选择文件夹</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
          </span>
          <a-button @click="openFetch">
            <template #icon><link-outlined /></template>
            抓取网页
          </a-button>
          <a-button @click="openEditor">
            <template #icon><edit-outlined /></template>
            图片编辑
          </a-button>
          <span class="split" aria-hidden="true" />
          <a-dropdown :disabled="state.fileList.length < 2">
            <a-button :disabled="state.fileList.length < 2">
              <template #icon><sort-ascending-outlined /></template>
              排序
            </a-button>
            <template #overlay>
              <a-menu @click="handleMenuClick">
                <a-sub-menu key="create" title="创建时间">
                  <a-menu-item key="create,asc">从早到晚</a-menu-item>
                  <a-menu-item key="create,desc">从晚到早</a-menu-item>
                </a-sub-menu>
                <a-sub-menu key="update" title="修改时间">
                  <a-menu-item key="update,asc">从早到晚</a-menu-item>
                  <a-menu-item key="update,desc">从晚到早</a-menu-item>
                </a-sub-menu>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button :disabled="!state.fileList.length" @click="dedupe">
            <template #icon><filter-outlined /></template>
            去重
          </a-button>
          <a-button :disabled="!state.fileList.length" @click="clearAll">
            <template #icon><clear-outlined /></template>
            清空
          </a-button>
        </div>
        <div class="actions">
          <a-tooltip title="设置">
            <a-button type="text" class="icon-btn" aria-label="设置" @click="state.settingsOpen = true">
              <template #icon><setting-outlined /></template>
            </a-button>
          </a-tooltip>
          <a-button
            type="primary"
            :disabled="!state.fileList.length || Boolean(state.outputMode)"
            :loading="state.outputMode === 'preview'"
            @click="openPreview"
          >
            <template #icon><file-pdf-outlined /></template>
            预览
          </a-button>
        </div>
      </div>
      <div class="toolbar-row options">
        <div class="actions">
          <div class="option">
            <span>纸张</span>
            <a-segmented v-model:value="state.pageSize" :options="pageSizeOptions" />
          </div>
          <div class="option">
            <span>方向</span>
            <a-segmented v-model:value="state.layout" :options="layoutOptions" />
          </div>
          <div class="option">
            <span>边距</span>
            <a-segmented v-model:value="state.margin" :options="marginOptions" />
          </div>
          <div class="option">
            <span>排列</span>
            <a-segmented v-model:value="state.stack" :options="stackOptions" />
          </div>
        </div>
        <div class="metrics">
          <div class="metric">
            <strong>{{ state.detectedCount }}</strong>
            <span>检测到</span>
          </div>
          <div class="metric metric-saved">
            <strong>{{ state.fetchedCount }}</strong>
            <span>已抓取</span>
          </div>
          <div class="metric">
            <strong>{{ state.fileList.length }}</strong>
            <span>待打印</span>
          </div>
        </div>
      </div>
    </section>

    <p class="hint">拖拽卡片可以调整打印顺序</p>

    <main class="stage">
      <div v-if="!state.fileList.length" class="empty" @click="opendir('file')">
        <inbox-outlined />
        <strong>把图片拖到这里</strong>
        <span>点击「添加图片」选择图片，右侧箭头可以选择文件夹。支持 JPG、JPEG、PNG、WebP</span>
      </div>

      <VueDraggable
        v-if="state.fileList.length"
        v-model="state.fileList"
        class="grid"
        :animation="180"
        force-fallback
        :fallback-on-body="true"
        filter=".card-tools"
        ghost-class="ghost"
        drag-class="drag-card"
        @start="onStart"
        @end="onEnd"
      >
          <article v-for="(item, i) in state.fileList" :key="item.id" class="card">
            <img
              :src="fileSrc(item.path)"
              :alt="item.name"
              :style="imageStyle(item)"
              draggable="false"
            />
            <span class="index">{{ i + 1 }}</span>
            <div class="card-tools" @click.stop>
              <button type="button" title="查看大图" @click="$preview(i, previewList)">
                <eye-outlined />
              </button>
              <button type="button" title="编辑" @click="editAt(i)">
                <edit-outlined />
              </button>
              <button type="button" title="旋转" @click="rotateAt(i)">
                <rotate-right-outlined />
              </button>
              <button type="button" title="移除" @click="removeAt(i)">
                <delete-outlined />
              </button>
            </div>
            <p class="name" :title="item.name">{{ item.name }}</p>
          </article>
      </VueDraggable>
    </main>

    <a-modal
      v-model:open="state.fetchOpen"
      title="抓取网页图片"
      ok-text="开始抓取"
      cancel-text="取消"
      :width="460"
      :confirm-loading="state.fetchLoading"
      :cancel-button-props="{ disabled: state.fetchLoading }"
      :mask-closable="!state.fetchLoading"
      :keyboard="!state.fetchLoading"
      :closable="!state.fetchLoading"
      @ok="fetchFromUrl"
    >
      <a-input
        ref="urlInput"
        v-model:value="state.pageUrl"
        size="large"
        allow-clear
        :disabled="state.fetchLoading"
        :status="state.fetchError ? 'error' : ''"
        placeholder="粘贴以 http 或 https 开头的链接"
        @pressEnter="fetchFromUrl"
        @change="state.fetchError = ''"
      />
      <p v-if="state.fetchError" class="fetch-error">{{ state.fetchError }}</p>
      <div v-if="state.fetchLoading || state.fetchText" class="fetch-progress">
        <div class="fetch-status">
          <span>{{ state.fetchText }}</span>
          <strong>{{ state.fetchPercent }}%</strong>
        </div>
        <a-progress
          :percent="state.fetchPercent"
          :show-info="false"
          :status="state.fetchError ? 'exception' : 'active'"
          stroke-color="#1d4ed8"
        />
      </div>
    </a-modal>

    <a-modal v-model:open="state.settingsOpen" title="设置" :footer="null" :width="440">
      <label class="setting">
        <a-checkbox v-model:checked="settings.openPdfExternal">通过默认程序打开 PDF</a-checkbox>
        <span>不勾选时，预览在软件内打开。</span>
      </label>
      <label class="setting">
        <span class="setting-label">更新代理</span>
        <a-select v-model:value="settings.updateProxy" class="setting-select" :options="proxyOptions" />
        <span>访问 GitHub 较慢时，用代理检查更新。选「直接连接」则不用代理。</span>
      </label>
      <label class="setting">
        <a-checkbox v-model:checked="settings.checkOnStartup">启动时检查更新</a-checkbox>
      </label>
      <div class="setting-foot">
        <span>{{ state.version ? `当前版本 v${state.version}` : "当前版本" }}</span>
        <a-button :loading="state.checkingUpdate" @click="checkUpdate">检查更新</a-button>
      </div>
    </a-modal>

    <a-modal
      v-model:open="state.updateOpen"
      title="发现新版本"
      :ok-text="state.update.status === 'downloaded' ? '立即重启' : '正在下载'"
      cancel-text="稍后"
      :ok-button-props="{ disabled: state.update.status !== 'downloaded' }"
      @ok="installUpdate"
    >
      <p class="update-copy">新版本 v{{ state.update.version || "…" }} 可以安装。</p>
      <p v-if="state.update.status === 'downloaded'" class="update-copy">下载完成，重启后会自动安装。</p>
      <p v-else class="update-copy">正在下载 {{ state.update.percent }}%</p>
      <a-progress
        :percent="state.update.status === 'downloaded' ? 100 : state.update.percent"
        :show-info="false"
        stroke-color="#1d4ed8"
      />
    </a-modal>

    <button
      v-if="state.update.status === 'downloaded'"
      type="button"
      class="version-badge"
      @click="installUpdate"
    >
      更新到 v{{ state.update.version }}
    </button>
    <span v-else-if="state.update.status === 'downloading'" class="version-badge">
      正在更新 {{ state.update.percent }}%
    </span>
    <span v-else-if="state.update.status === 'available'" class="version-badge">
      v{{ state.update.version }}
    </span>
    <span v-else-if="state.version" class="version-badge">v{{ state.version }}</span>

    <div v-if="state.draggingOver" class="drop-mask">
      <inbox-outlined />
      <span>松开即可添加</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { VueDraggable } from "vue-draggable-plus";
import {
  ClearOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FilterOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  LinkOutlined,
  RotateRightOutlined,
  SettingOutlined,
  SortAscendingOutlined,
} from "@ant-design/icons-vue";
import { Modal, message } from "ant-design-vue";
import { throttle } from "lodash-es";
import { beginEdit, takeEditResult } from "../edit-session";
import { IMAGE_EXT, fileName, fileSrc } from "../files";
defineOptions({ name: "Print" });

const router = useRouter();
const pageSizeOptions = [
  { label: "A4", value: "A4" },
  { label: "A3", value: "A3" },
];
const layoutOptions = [
  { label: "纵向", value: "portrait" },
  { label: "横向", value: "landscape" },
];
const marginOptions = [
  { label: "无", value: "none" },
  { label: "小", value: "small" },
];
const stackOptions = [
  { label: "自动", value: "auto" },
  { label: "上下", value: "vertical" },
];

const urlInput = ref(null);
const proxyOptions = [
  { label: "直接连接 GitHub", value: "" },
  { label: "gh-proxy.org", value: "gh-proxy.org" },
  { label: "gh-proxy.com", value: "gh-proxy.com" },
  { label: "ghproxy.net", value: "ghproxy.net" },
  { label: "ghfast.top", value: "ghfast.top" },
];
const settings = reactive({
  openPdfExternal: false,
  updateProxy: "",
  checkOnStartup: true,
});
let settingsReady = false;
const addMenuOpen = ref(false);

const state = reactive({
  fileList: [],
  drag: false,
  draggingOver: false,
  outputMode: "",
  version: "",
  update: { status: "", version: "", percent: 0 },
  updateOpen: false,
  settingsOpen: false,
  checkingUpdate: false,
  pdfPath: "",
  pdfKey: "",
  fetchOpen: false,
  fetchLoading: false,
  fetchPercent: 0,
  fetchText: "",
  fetchError: "",
  detectedCount: 0,
  fetchedCount: 0,
  pageUrl: "",
  pageSize: "A4",
  layout: "portrait",
  margin: "none",
  stack: "auto",
});

const previewList = computed(() => state.fileList.map((item) => fileSrc(item.path)));

let uid = 0;
let dragDepth = 0;

function settingsPayload() {
  return {
    openPdfExternal: settings.openPdfExternal,
    updateProxy: settings.updateProxy,
    checkOnStartup: settings.checkOnStartup,
    pageSize: state.pageSize,
    layout: state.layout,
    margin: state.margin,
    stack: state.stack,
  };
}

function persistSettings() {
  if (!settingsReady || !window.ipcRenderer) return;
  window.ipcRenderer.invoke("save_settings", JSON.stringify(settingsPayload())).catch(() => {});
}

async function loadSettings() {
  const saved = await window.ipcRenderer?.invoke("get_settings").catch(() => null);
  if (saved) {
    settings.openPdfExternal = saved.openPdfExternal === true;
    settings.updateProxy = proxyOptions.some((item) => item.value === saved.updateProxy) ? saved.updateProxy : "";
    settings.checkOnStartup = saved.checkOnStartup !== false;
    state.pageSize = saved.pageSize === "A3" ? "A3" : "A4";
    state.layout = saved.layout === "landscape" ? "landscape" : "portrait";
    state.margin = saved.margin === "small" ? "small" : "none";
    state.stack = saved.stack === "vertical" ? "vertical" : "auto";
  }
  settingsReady = true;
}

onMounted(() => {
  loadSettings();
  applyPrintEdit();
  window.ipcRenderer?.on("fetch_page_progress", (_event, progress) => {
    state.fetchPercent = progress?.percent || 0;
    state.fetchText = progress?.text || "";
  });
  window.ipcRenderer?.on("app_update", (_event, payload) => {
    const status = payload?.status || "";
    state.update = {
      status,
      version: payload?.version || state.update.version,
      percent: payload?.percent || 0,
    };
    if (status === "available" || status === "downloaded") state.updateOpen = true;
  });
  window.ipcRenderer?.invoke("app_version").then((version) => {
    if (version) state.version = version;
  }).catch(() => {});
});

onActivated(applyPrintEdit);
onDeactivated(() => {
  addMenuOpen.value = false;
});

watch(() => JSON.stringify(settingsPayload()), persistSettings);

function toItem(filePath) {
  uid += 1;
  return { id: `${Date.now()}-${uid}`, path: filePath, name: fileName(filePath), rotation: 0 };
}

function appendFiles(paths) {
  const images = (paths || []).filter((item) => IMAGE_EXT.test(item));
  if (!images.length) {
    if (paths?.length) message.warning("只支持 JPG、JPEG、PNG、WebP 图片");
    return;
  }
  state.fileList.push(...images.map(toItem));
}

function imageStyle(item) {
  const rotation = item.rotation || 0;
  const scale = rotation % 180 === 0 ? 1 : 0.75;
  return { transform: `rotate(${rotation}deg) scale(${scale})` };
}

function rotateAt(index) {
  const item = state.fileList[index];
  item.rotation = ((item.rotation || 0) + 90) % 360;
}

function editAt(index) {
  const item = state.fileList[index];
  if (!item) return;
  beginEdit({
    paths: [item.path],
    index,
    id: item.id,
    source: "print",
  });
  router.push("/edit");
}

function openEditor() {
  beginEdit({ source: "" });
  router.push("/edit");
}

function applyPrintEdit() {
  const saved = takeEditResult();
  if (!saved || saved.source !== "print") return;
  const item = state.fileList.find((file) => file.id === saved.id) || state.fileList[saved.index];
  if (!item || !saved.path) return;
  item.path = saved.path;
  item.rotation = 0;
}

function pdfPayload() {
  return JSON.stringify({
    files: state.fileList.map((item) => ({ path: item.path, rotation: item.rotation || 0 })),
    size: state.pageSize,
    layout: state.layout,
    margin: state.margin,
    stack: state.stack,
  });
}

function paths() {
  return state.fileList.map((item) => item.path);
}

function openFetch() {
  state.fetchError = "";
  state.fetchText = "";
  state.fetchPercent = 0;
  state.fetchOpen = true;
}

watch(
  () => state.fetchOpen,
  (open) => {
    if (open) nextTick(() => urlInput.value?.focus());
  }
);

function resetFetchStats() {
  state.detectedCount = 0;
  state.fetchedCount = 0;
  state.pageUrl = "";
  state.fetchPercent = 0;
  state.fetchText = "";
  state.fetchError = "";
}

async function fetchFromUrl() {
  const pageUrl = state.pageUrl.trim();
  state.fetchError = "";
  if (!pageUrl) {
    state.fetchError = "请先粘贴网页链接";
    urlInput.value?.focus();
    return;
  }
  if (!/^https?:\/\//i.test(pageUrl)) {
    state.fetchError = "链接需要以 http 或 https 开头";
    urlInput.value?.focus();
    return;
  }
  if (!window.ipcRenderer) {
    state.fetchError = "无法连接本地打印服务";
    return;
  }
  state.fetchPercent = 2;
  state.fetchText = "正在打开页面";
  state.fetchLoading = true;
  try {
    const result = await window.ipcRenderer.invoke("fetch_page_images", pageUrl);
    if (result?.error) {
      state.fetchError = result.error;
      state.fetchText = "";
      return;
    }
    const files = result?.files || [];
    const detected = Number(result?.detected ?? files.length);
    const saved = Number(result?.saved ?? files.length);
    state.detectedCount = detected;
    state.fetchedCount = saved;
    if (!files.length) {
      state.fetchError = detected ? `检测到 ${detected} 张，没有可打印的图片` : "这个页面里没有找到图片";
      state.fetchText = "";
      return;
    }
    const before = state.fileList.length;
    appendFiles(files);
    const added = state.fileList.length - before;
    message.success(
      added === saved ? `检测到 ${detected} 张，已抓取 ${saved} 张` : `检测到 ${detected} 张，已抓取 ${saved} 张，新增 ${added} 张`
    );
    state.fetchOpen = false;
  } catch {
    state.fetchError = "抓取失败，请检查链接是否可以打开";
    state.fetchText = "";
  } finally {
    state.fetchLoading = false;
  }
}

function onAddMenu({ key }) {
  addMenuOpen.value = false;
  opendir(key);
}

async function opendir(kind = "file") {
  if (!window.ipcRenderer) {
    message.error("无法打开文件选择");
    return;
  }
  const directory = kind === "directory";
  const res = await window.ipcRenderer.invoke("openDialogSync", directory ? "directory" : "file");
  if (!res) return;
  if (!res.length) {
    message.warning(directory ? "这个文件夹里没有 JPG、JPEG、PNG、WebP 图片" : "只支持 JPG、JPEG、PNG、WebP 图片");
    return;
  }
  appendFiles(res);
}

function dedupe() {
  const seen = new Set();
  const next = state.fileList.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
  const removed = state.fileList.length - next.length;
  state.fileList = next;
  message.success(removed ? `已去除 ${removed} 张重复图片` : "没有重复图片");
}

function clearAll() {
  if (!state.fileList.length) return;
  Modal.confirm({
    title: "清空全部图片？",
    content: `将移除 ${state.fileList.length} 张图片，不会删除电脑上的原文件。`,
    okText: "清空",
    cancelText: "取消",
    okButtonProps: { danger: true },
    onOk() {
      state.fileList = [];
      resetFetchStats();
    },
  });
}

function removeAt(index) {
  state.fileList.splice(index, 1);
}

async function ensurePdfPath() {
  const key = pdfPayload();
  if (state.pdfKey === key && state.pdfPath) return state.pdfPath;
  const result = await window.ipcRenderer.invoke("preview_pdf", key);
  const pdfPath = result?.path || "";
  state.pdfPath = pdfPath;
  state.pdfKey = key;
  if (!pdfPath) throw new Error("empty");
  return pdfPath;
}

async function openPreview() {
  if (!state.fileList.length) {
    message.warning("请先添加图片");
    return;
  }
  if (!window.ipcRenderer) {
    message.error("无法连接本地打印服务");
    return;
  }
  if (state.outputMode) return;
  state.outputMode = "preview";
  try {
    const pdfPath = await ensurePdfPath();
    if (settings.openPdfExternal) {
      await window.ipcRenderer.invoke("open_pdf_external", JSON.stringify({ path: pdfPath }));
    } else {
      await router.push({ path: "/preview", query: { file: pdfPath } });
    }
  } catch {
    message.error("预览失败，请检查图片是否可以读取");
  } finally {
    state.outputMode = "";
  }
}

async function checkUpdate() {
  if (!window.ipcRenderer) {
    message.info("安装后的软件才会检查更新");
    return;
  }
  state.checkingUpdate = true;
  try {
    const result = await window.ipcRenderer.invoke("check_update");
    if (!result?.ok && result?.reason === "unpackaged") {
      message.info("安装后的软件才会检查更新");
      return;
    }
    if (!result?.ok) {
      message.error("检查更新失败，请换一个代理或改为直接连接");
      return;
    }
    if (!result.available) message.success("已是最新版本");
  } catch {
    message.error("检查更新失败，请换一个代理或改为直接连接");
  } finally {
    state.checkingUpdate = false;
  }
}

async function installUpdate() {
  if (state.update.status !== "downloaded") return;
  await window.ipcRenderer?.invoke("install_update");
}

async function handleMenuClick({ key }) {
  if (!window.ipcRenderer) {
    message.error("无法读取文件时间");
    return;
  }
  const [type, order] = key.split(",");
  try {
    const fileList = await window.ipcRenderer.invoke(
      "sort_files",
      JSON.stringify({ type, sort: order, files: paths() })
    );
    const groups = new Map();
    state.fileList.forEach((item) => {
      const list = groups.get(item.path) || [];
      list.push(item);
      groups.set(item.path, list);
    });
    state.fileList = fileList.map((filePath) => groups.get(filePath)?.shift() || toItem(filePath));
  } catch {
    message.error("排序失败，请稍后重试");
  }
}

function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes("Files");
}

function onDragEnter(event) {
  if (state.drag || !isFileDrag(event)) return;
  dragDepth += 1;
  state.draggingOver = true;
}

function onDragOver(event) {
  if (!state.drag && isFileDrag(event)) state.draggingOver = true;
}

function onDragLeave(event) {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) state.draggingOver = false;
}

async function onDrop(event) {
  dragDepth = 0;
  state.draggingOver = false;
  const dropped = Array.from(event.dataTransfer?.files || [])
    .map((item) => item.path || window.webUtils?.getPathForFile(item) || "")
    .filter(Boolean);
  if (!dropped.length) return;
  if (!window.ipcRenderer) {
    appendFiles(dropped);
    return;
  }
  const expanded = await window.ipcRenderer.invoke("collect_images", dropped);
  appendFiles(expanded || []);
}

function onStart() {
  state.drag = true;
}

function onEnd() {
  state.drag = false;
}
</script>

<style scoped>
.print-app {
  position: relative;
  display: flex;
  height: 100%;
  box-sizing: border-box;
  flex-direction: column;
  overflow: hidden;
  padding: 16px 20px 36px;
  color: #172033;
  background: #eef1f6;
}

.update-copy {
  margin: 0 0 12px;
  color: #445066;
}

.version-badge {
  position: absolute;
  right: 20px;
  bottom: 12px;
  z-index: 2;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8b95a5;
  font-size: 12px;
  line-height: 1;
}

button.version-badge {
  color: #1d4ed8;
  cursor: pointer;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(3, 76px);
  flex: none;
  overflow: hidden;
  border: 1px solid #e7ebf2;
  border-radius: 10px;
  background: #f8fafc;
}

.metric {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 8px 6px 7px;
}

.metric + .metric {
  border-left: 1px solid #eef1f5;
}

.metric strong {
  color: #172033;
  font-size: 22px;
  font-weight: 680;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.metric span {
  color: #6b7585;
  font-size: 12px;
}

.metric-saved strong {
  color: #1d4ed8;
}

.toolbar {
  z-index: 5;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid #e3e8f0;
  border-radius: 16px;
  background: #fff;
}

.toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.toolbar-row.options {
  padding-top: 10px;
  border-top: 1px solid #eef1f5;
}

.fetch-error {
  margin: 8px 0 0;
  color: #dc2626;
  font-size: 13px;
}

.fetch-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.fetch-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #445066;
  font-size: 13px;
}

.fetch-status strong {
  flex: none;
  color: #172033;
  font-variant-numeric: tabular-nums;
}

.fetch-progress :deep(.ant-progress) {
  margin: 0;
}

.actions,
.option {
  display: flex;
  align-items: center;
  flex: none;
  gap: 8px;
}

.add-split {
  display: inline-flex;
  align-items: center;
}

.add-split :deep(.ant-btn:first-child) {
  border-start-end-radius: 0;
  border-end-end-radius: 0;
}

.add-caret {
  width: 32px;
  margin-left: -1px;
  padding-inline: 0;
  border-start-start-radius: 0;
  border-end-start-radius: 0;
}

.split {
  width: 1px;
  height: 16px;
  flex: none;
  background: #e6ebf2;
}

.icon-btn {
  width: 32px;
  padding-inline: 0;
  color: #8b95a5;
}

.icon-btn:hover {
  color: #445066;
  background: transparent;
}

.setting {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
  color: #667085;
  font-size: 12px;
  line-height: 1.5;
}

.setting-label {
  color: #172033;
  font-size: 14px;
}

.setting-select {
  width: 100%;
}

.setting-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8b95a5;
  font-size: 12px;
}

.option {
  color: #445066;
  font-size: 13px;
}

.stage {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: auto;
}

.empty {
  display: flex;
  width: 100%;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1.5px dashed #c9d2e0;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.55);
  color: #6b7585;
  cursor: pointer;
}

.empty:hover,
.print-app.is-over .empty {
  border-color: #2563eb;
  background: #fff;
}

.empty :deep(.anticon) {
  margin-bottom: 6px;
  color: #2563eb;
  font-size: 36px;
}

.empty strong {
  color: #172033;
  font-size: 18px;
  font-weight: 640;
}

.empty span {
  font-size: 13px;
}

.hint {
  flex: none;
  margin: -6px 2px 10px;
  color: #8b95a5;
  font-size: 12px;
  line-height: 1;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: 16px;
}

.card {
  position: relative;
  overflow: hidden;
  aspect-ratio: 3 / 4;
  border: 1px solid #e7ebf2;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 8px 20px rgba(23, 32, 51, 0.04);
  cursor: grab;
}

.card:active {
  cursor: grabbing;
}

.card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  -webkit-user-drag: none;
  user-select: none;
  background:
    linear-gradient(45deg, #f3f5f8 25%, transparent 25%),
    linear-gradient(-45deg, #f3f5f8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #f3f5f8 75%),
    linear-gradient(-45deg, transparent 75%, #f3f5f8 75%);
  background-color: #fbfcfe;
  background-size: 18px 18px;
  background-position: 0 0, 0 9px, 9px -9px, -9px 0;
}

.index {
  position: absolute;
  top: 10px;
  left: 10px;
  min-width: 26px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(23, 32, 51, 0.78);
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.card-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
}

.card-tools button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 4px rgba(23, 32, 51, 0.16);
  color: #172033;
  font-size: 13px;
  cursor: pointer;
}

.card-tools button:last-child:hover {
  color: #dc2626;
}

.name {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  margin: 0;
  padding: 8px 10px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.94);
  color: #334155;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ghost {
  opacity: 0.4;
}

.drag-card {
  opacity: 1;
  cursor: grabbing;
}

.drop-mask {
  position: fixed;
  inset: 16px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed #2563eb;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.88);
  color: #1d4ed8;
  font-size: 20px;
  font-weight: 640;
  pointer-events: none;
}

.drop-mask :deep(.anticon) {
  font-size: 40px;
}

@media (max-width: 860px) {
  .print-app {
    padding: 16px 12px 24px;
  }

  .toolbar,
  .toolbar-row {
    align-items: stretch;
    flex-direction: column;
  }

  .metrics {
    width: 100%;
  }
}
</style>
