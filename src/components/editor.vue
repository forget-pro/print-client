<template>
  <div class="viewer">
    <header class="top">
      <div class="side">
        <button type="button" class="icon" title="返回" @click="cancel">
          <svg viewBox="0 0 24 24"><path d="M14.5 6.5 8 12l6.5 5.5" /></svg>
        </button>
        <button type="button" class="text" @click="addImages" v-if="!fromPrint">
          <svg viewBox="0 0 24 24"><path d="M4 8.5h5l1.5-2H20v11H4z" /></svg>
          添加
        </button>
      </div>
      <div class="filename" :title="title">{{ title }}</div>
      <div class="side end">
        <template v-if="fromPrint">
          <button type="button" class="text solid" :disabled="!ready || saving" @click="applyPrint">
            <svg viewBox="0 0 24 24"><path d="M5 12.5 9.2 17 19 7" /></svg>
            完成
          </button>
        </template>
        <template v-else>
        <button type="button" class="text" :disabled="!ready" @click="printImage">
          <svg viewBox="0 0 24 24"><path d="M7 9V4h10v5" /><path d="M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A1.5 1.5 0 0 1 4.5 9h15A1.5 1.5 0 0 1 21 10.5v5a1.5 1.5 0 0 1-1.5 1.5H17" /><path d="M7 13h10v7H7z" /></svg>
          打印
        </button>
        <div class="save">
          <button type="button" class="text solid" :disabled="!ready || saving" @click="saveOpen = !saveOpen">
            <svg viewBox="0 0 24 24"><path d="M6 4h9l3 3v13H6z" /><path d="M8 4v5h7" /><path d="M8 16h8" /></svg>
            保存
            <svg class="chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          <template v-if="saveOpen">
            <div class="mask" @click="saveOpen = false" />
            <div class="menu">
              <button type="button" :disabled="!changed" @click="chooseSave('original')">保存</button>
              <button type="button" @click="chooseSave('copy')">保存副本</button>
            </div>
          </template>
        </div>
        </template>
      </div>
    </header>

    <div class="ribbon">
      <button type="button" class="tool" :class="{ on: cropping }" :disabled="!ready" @click="toggleCrop">
        <svg viewBox="0 0 24 24"><path d="M8 4h8a2 2 0 0 1 2 2v12" /><path d="M4 8v8a2 2 0 0 0 2 2h12" /></svg>
        <span>裁剪</span>
      </button>
      <button type="button" class="tool" :class="{ on: flipH }" :disabled="!ready" @click="toggleFlip('h')">
        <svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M4 8h6v8H4zM14 8h6v8h-6z" /><path d="M12 5v14" /></svg>
        <span>水平</span>
      </button>
      <button type="button" class="tool" :class="{ on: flipV }" :disabled="!ready" @click="toggleFlip('v')">
        <svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M8 4h8v6H8zM8 14h8v6H8z" /><path d="M5 12h14" /></svg>
        <span>垂直</span>
      </button>
      <i class="split" />
      <button type="button" class="tool" :class="{ on: adjust.grayscale }" :disabled="!ready" @click="toggleFlag('grayscale')">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.5" /><path fill="currentColor" stroke="none" d="M12 5.5a6.5 6.5 0 0 0 0 13z" /></svg>
        <span>灰度</span>
      </button>
      <button type="button" class="tool" :class="{ on: adjust.normalize }" :disabled="!ready" @click="toggleFlag('normalize')">
        <svg viewBox="0 0 24 24"><path d="M7 17V11M12 17V7M17 17v-4" /></svg>
        <span>色阶</span>
      </button>
      <button type="button" class="tool" :disabled="!ready" @click="resetAdjustments">
        <svg viewBox="0 0 24 24"><path d="M8 7.5H5V4.5" /><path d="M6 8a6.5 6.5 0 1 1-1.2 3" /></svg>
        <span>重置</span>
      </button>
    </div>

    <div v-if="files.length > 1" class="strip">
      <button
        v-for="(file, index) in files"
        :key="file.path + index"
        type="button"
        :class="{ on: index === current }"
        @click="selectFile(index)"
      >
        <img :src="fileSrc(file.path)" alt="" />
      </button>
    </div>

    <main
      ref="stageRef"
      class="stage"
      @wheel.prevent="onWheel"
      @dblclick="toggleZoom"
      @pointerdown="onPanDown"
      @pointermove="onPanMove"
      @pointerup="onPanUp"
      @pointercancel="onPanUp"
    >
      <div v-if="status && !previewUrl" class="empty">
        <p class="status">{{ status }}</p>
        <button v-if="sessionReady" type="button" class="text solid" @click="addImages">
          <svg viewBox="0 0 24 24"><path d="M4 8.5h5l1.5-2H20v11H4z" /></svg>
          添加图片
        </button>
      </div>
      <div
        v-show="previewUrl"
        class="sheet"
        :style="sheetStyle"
        @pointerdown.stop="onCropDown"
        @pointermove.stop="onCropMove"
        @pointerup.stop="onCropUp"
        @pointercancel.stop="onCropUp"
        @dblclick="onSheetDblClick"
      >
        <img :src="previewUrl" alt="" draggable="false" />
        <div v-if="cropping" class="crop" :style="cropStyle">
          <span class="handle nw" />
          <span class="handle n" />
          <span class="handle ne" />
          <span class="handle e" />
          <span class="handle se" />
          <span class="handle s" />
          <span class="handle sw" />
          <span class="handle w" />
        </div>
      </div>
      <div v-if="ready && !cropping" class="spins" @pointerdown.stop>
        <button type="button" class="icon glass" data-tip="向左旋转" @click.stop="rotateBy(-90)">
          <svg viewBox="0 0 24 24"><path d="M8.5 7.5 5 5v4.5" /><path d="M6.2 9.2a6.2 6.2 0 1 1-1.4 3.6" /></svg>
        </button>
        <button type="button" class="icon glass" data-tip="向右旋转" @click.stop="rotateBy(90)">
          <svg viewBox="0 0 24 24"><path d="M15.5 7.5 19 5v4.5" /><path d="M17.8 9.2a6.2 6.2 0 1 0 1.4 3.6" /></svg>
        </button>
      </div>
    </main>

    <div v-if="cropping" class="crop-bar">
      <button type="button" class="text" @click="cancelCrop">取消</button>
      <button type="button" class="text solid" @click="finishCrop">完成</button>
    </div>

    <footer class="status">
      <div class="meta">
        <span v-if="source.w">{{ source.w }}×{{ source.h }}</span>
        <span v-if="fileSizeLabel">{{ fileSizeLabel }}</span>
      </div>
      <div class="zoom">
        <button type="button" class="icon" data-tip="适应窗口" :disabled="!ready" @click="fitWindow">
          <svg viewBox="0 0 24 24"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" /></svg>
        </button>
        <button type="button" class="icon" data-tip="缩小" :disabled="!ready" @click="stepZoom(-1)">
          <svg viewBox="0 0 24 24"><path d="M6 12h12" /></svg>
        </button>
        <span>{{ zoomLabel }}</span>
        <button type="button" class="icon" data-tip="放大" :disabled="!ready" @click="stepZoom(1)">
          <svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" /></svg>
        </button>
        <button type="button" class="text" :disabled="!ready" @click="actualSize">100%</button>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Modal, message } from "ant-design-vue";
import { currentEdit, editVersion, finishEdit, sessionReady } from "../edit-session";
import { beginPrint } from "../print-session";
import { IMAGE_EXT, fileName, fileSrc } from "../files";

const router = useRouter();
const stageRef = ref(null);
const status = ref("正在打开图片");
const ready = ref(false);
const saving = ref(false);
const cropping = ref(false);
const previewUrl = ref("");
const files = ref([]);
const current = ref(0);
const fromPrint = ref(false);
const saveOpen = ref(false);
const fileBytes = ref(0);
const zoomMode = ref("fit");
const scale = ref(1);
const pan = reactive({ x: 0, y: 0 });
const source = reactive({ w: 0, h: 0 });
const frameTick = ref(0);
const adjust = reactive({
  grayscale: false,
  normalize: false,
});
const rotation = ref(0);
const flipH = ref(false);
const flipV = ref(false);
const crop = reactive({ x: 0, y: 0, w: 1, h: 1 });
const title = computed(() => files.value[current.value]?.name || "图片");
const zoomLabel = computed(() => `${Math.round(shownScale() * 100)}%`);
const fileSizeLabel = computed(() => formatSize(fileBytes.value));
const changed = computed(() => {
  if (!ready.value) return false;
  if (rotation.value !== 0 || flipH.value || flipV.value || cropping.value) return true;
  if (crop.x > 0.001 || crop.y > 0.001 || crop.w < 0.999 || crop.h < 0.999) return true;
  return adjust.grayscale || adjust.normalize;
});
const cropStyle = computed(() => ({
  left: `${crop.x * 100}%`,
  top: `${crop.y * 100}%`,
  width: `${crop.w * 100}%`,
  height: `${crop.h * 100}%`,
}));
const sheetStyle = computed(() => {
  const amount = shownScale();
  return {
    width: `${Math.max(1, Math.round(source.w * amount))}px`,
    height: `${Math.max(1, Math.round(source.h * amount))}px`,
    transform: zoomMode.value === "fit" ? "none" : `translate(${pan.x}px, ${pan.y}px)`,
  };
});

let previewObjectUrl = "";
let timer = 0;
let requestId = 0;
let drag = null;
let panDrag = null;
let observer = null;
const baseRotation = ref(0);

function formatSize(size) {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}K`;
  const mb = size / 1024 / 1024;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)}M`;
}

function activeFile() {
  return files.value[current.value] || null;
}

function shownScale() {
  if (zoomMode.value === "fit") return fitScale();
  return scale.value;
}

function fitScale() {
  frameTick.value;
  const stage = stageRef.value;
  if (!stage || !source.w || !source.h) return 1;
  return Math.min((stage.clientWidth - 64) / source.w, (stage.clientHeight - 64) / source.h);
}

function fitWindow() {
  zoomMode.value = "fit";
  pan.x = 0;
  pan.y = 0;
}

function actualSize() {
  zoomMode.value = "manual";
  scale.value = 1;
  pan.x = 0;
  pan.y = 0;
}

function stepZoom(direction) {
  const next = Math.min(8, Math.max(0.05, shownScale() * (direction > 0 ? 1.25 : 0.8)));
  zoomMode.value = "manual";
  scale.value = next;
}

function toggleZoom() {
  if (zoomMode.value === "fit") actualSize();
  else fitWindow();
}

function onWheel(event) {
  if (!ready.value) return;
  const next = Math.min(8, Math.max(0.05, shownScale() * (event.deltaY > 0 ? 0.9 : 1.1)));
  zoomMode.value = "manual";
  scale.value = next;
}

function onPanDown(event) {
  if (cropping.value) {
    if (event.target === event.currentTarget) finishCrop();
    return;
  }
  if (!ready.value || event.button !== 0 || zoomMode.value === "fit") return;
  panDrag = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onPanMove(event) {
  if (!panDrag) return;
  pan.x = panDrag.px + event.clientX - panDrag.x;
  pan.y = panDrag.py + event.clientY - panDrag.y;
}

function onPanUp() {
  panDrag = null;
}

function resetCrop() {
  crop.x = 0;
  crop.y = 0;
  crop.w = 1;
  crop.h = 1;
}

let cropSnapshot = null;

function toggleCrop() {
  if (cropping.value) finishCrop();
  else beginCrop();
}

function beginCrop() {
  cropSnapshot = { x: crop.x, y: crop.y, w: crop.w, h: crop.h };
  cropping.value = true;
}

function finishCrop() {
  if (!cropping.value) return;
  cropping.value = false;
}

function cancelCrop() {
  if (cropSnapshot) {
    crop.x = cropSnapshot.x;
    crop.y = cropSnapshot.y;
    crop.w = cropSnapshot.w;
    crop.h = cropSnapshot.h;
  }
  cropping.value = false;
}

function onCropKey(event) {
  if (saveOpen.value && event.key === "Escape") {
    saveOpen.value = false;
    event.preventDefault();
    return;
  }
  if (!cropping.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    cancelCrop();
  } else if (event.key === "Enter") {
    event.preventDefault();
    finishCrop();
  }
}

function onSheetDblClick(event) {
  if (!cropping.value) return;
  event.stopPropagation();
  finishCrop();
}

function resetAdjustments() {
  rotation.value = baseRotation.value;
  flipH.value = false;
  flipV.value = false;
  cropping.value = false;
  adjust.grayscale = false;
  adjust.normalize = false;
  resetCrop();
  schedule(true);
}

function payload(save) {
  return {
    path: activeFile()?.path || "",
    rotation: rotation.value,
    flipH: flipH.value,
    flipV: flipV.value,
    crop: save || !cropping.value ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h } : null,
    grayscale: adjust.grayscale,
    normalize: adjust.normalize,
    save,
  };
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value?.data) return new Uint8Array(value.data);
  return new Uint8Array();
}

async function requestPreview() {
  const file = activeFile();
  if (!file?.path || !window.ipcRenderer) {
    ready.value = false;
    status.value = file?.path ? "无法连接本地图片服务" : "没有可查看的图片";
    return;
  }
  const id = ++requestId;
  try {
    const result = await window.ipcRenderer.invoke("render_edit", JSON.stringify(payload(false)));
    if (id !== requestId) return;
    const bytes = asBytes(result?.bytes);
    if (!bytes.byteLength) throw new Error("empty");
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
    previewUrl.value = previewObjectUrl;
    source.w = result.sourceWidth || result.width || 1;
    source.h = result.sourceHeight || result.height || 1;
    fileBytes.value = result.fileSize || fileBytes.value;
    ready.value = true;
    status.value = "";
  } catch {
    if (id !== requestId) return;
    if (!previewUrl.value) {
      ready.value = false;
      status.value = "图片无法打开";
    } else {
      message.error("处理失败，请稍后重试");
    }
  }
}

function schedule(immediate = false) {
  window.clearTimeout(timer);
  if (immediate) {
    requestPreview();
    return;
  }
  timer = window.setTimeout(requestPreview, 90);
}

function rotateBy(degrees) {
  rotation.value = (rotation.value + degrees + 360) % 360;
  cropping.value = false;
  resetCrop();
  schedule(true);
}

function toggleFlip(axis) {
  if (axis === "h") flipH.value = !flipH.value;
  else flipV.value = !flipV.value;
  cropping.value = false;
  resetCrop();
  schedule(true);
}

function toggleFlag(key) {
  adjust[key] = !adjust[key];
  schedule();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function movedCrop(mode, base, dx, dy) {
  const min = 0.08;
  let x = base.x;
  let y = base.y;
  let w = base.w;
  let h = base.h;
  if (mode === "move") return { x: clamp(x + dx, 0, 1 - w), y: clamp(y + dy, 0, 1 - h), w, h };
  if (mode === "nw" || mode === "w" || mode === "sw") {
    const next = clamp(x + dx, 0, x + w - min);
    w += x - next;
    x = next;
  }
  if (mode === "ne" || mode === "e" || mode === "se") w = clamp(w + dx, min, 1 - x);
  if (mode === "nw" || mode === "n" || mode === "ne") {
    const next = clamp(y + dy, 0, y + h - min);
    h += y - next;
    y = next;
  }
  if (mode === "sw" || mode === "s" || mode === "se") h = clamp(h + dy, min, 1 - y);
  return { x, y, w, h };
}

function hitTest(point, width, height) {
  const box = { x: crop.x * width, y: crop.y * height, w: crop.w * width, h: crop.h * height };
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const points = [
    ["nw", box.x, box.y],
    ["n", box.x + box.w / 2, box.y],
    ["ne", right, box.y],
    ["e", right, box.y + box.h / 2],
    ["se", right, bottom],
    ["s", box.x + box.w / 2, bottom],
    ["sw", box.x, bottom],
    ["w", box.x, box.y + box.h / 2],
  ];
  for (let i = 0; i < points.length; i++) {
    const handle = points[i];
    if (Math.abs(point.x - handle[1]) <= 10 && Math.abs(point.y - handle[2]) <= 10) return handle[0];
  }
  if (point.x >= box.x && point.x <= right && point.y >= box.y && point.y <= bottom) return "move";
  return "";
}

function onCropDown(event) {
  if (!cropping.value) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  const mode = hitTest(point, bounds.width, bounds.height);
  if (!mode) return;
  drag = { mode, x: point.x, y: point.y, crop: { x: crop.x, y: crop.y, w: crop.w, h: crop.h } };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onCropMove(event) {
  if (!drag) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const dx = (event.clientX - bounds.left - drag.x) / bounds.width;
  const dy = (event.clientY - bounds.top - drag.y) / bounds.height;
  const next = movedCrop(drag.mode, drag.crop, dx, dy);
  crop.x = next.x;
  crop.y = next.y;
  crop.w = next.w;
  crop.h = next.h;
}

function onCropUp() {
  drag = null;
}

function adoptRequest() {
  const request = currentEdit();
  fromPrint.value = request?.source === "print";
  const paths = request?.paths || (request?.path ? [request.path] : []);
  if (!paths.length) return;
  files.value = paths.map((path) => ({ path, name: fileName(path) }));
  current.value = 0;
}

function load() {
  const file = activeFile();
  ready.value = false;
  previewUrl.value = "";
  source.w = 0;
  source.h = 0;
  fileBytes.value = 0;
  fitWindow();
  status.value = file?.path ? "正在打开" : sessionReady.value ? "没有可查看的图片" : "正在打开";
  if (!file?.path) return;
  baseRotation.value = 0;
  rotation.value = baseRotation.value;
  flipH.value = false;
  flipV.value = false;
  cropping.value = false;
  adjust.grayscale = false;
  adjust.normalize = false;
  resetCrop();
  schedule(true);
}

function selectFile(index) {
  if (index === current.value) return;
  current.value = index;
  load();
}

function cancel() {
  fromPrint.value = false;
  router.push("/");
}

async function addImages() {
  if (!window.ipcRenderer) {
    message.error("无法打开文件选择");
    return;
  }
  const picked = await window.ipcRenderer.invoke("openDialogSync");
  if (!picked) return;
  const images = picked.filter((item) => IMAGE_EXT.test(item));
  if (!images.length) {
    message.warning("这个文件夹里没有 JPG、JPEG、PNG、WebP 图片");
    return;
  }
  const start = files.value.length;
  files.value.push(...images.map((path) => ({ path, name: fileName(path) })));
  current.value = start;
  load();
}

async function commit(mode) {
  if (!ready.value || saving.value) return;
  saving.value = true;
  try {
    const result = await window.ipcRenderer.invoke("render_edit", JSON.stringify(payload(mode)));
    if (!result?.path) throw new Error("empty");
    const name = result.path.split(/[/\\]/).pop() || title.value;
    const item = files.value[current.value];
    if (item) {
      item.path = result.path;
      item.name = name;
    }
    baseRotation.value = 0;
    resetAdjustments();
    message.success(mode === "original" ? "已覆盖原图" : "已保存副本");
  } catch {
    message.error(mode === "original" ? "原图保存失败" : "副本保存失败");
  } finally {
    saving.value = false;
  }
}

function saveCopy() {
  commit("copy");
}

function chooseSave(mode) {
  saveOpen.value = false;
  if (mode === "copy") saveCopy();
  else saveOriginal();
}

async function applyPrint() {
  if (!ready.value || saving.value) return;
  if (!changed.value) {
    fromPrint.value = false;
    router.push("/");
    return;
  }
  saving.value = true;
  try {
    const result = await window.ipcRenderer.invoke("render_edit", JSON.stringify(payload("apply")));
    if (!result?.path) throw new Error("empty");
    finishEdit({ path: result.path, name: fileName(result.path) });
    fromPrint.value = false;
    router.push("/");
  } catch {
    message.error("修改失败，请稍后重试");
  } finally {
    saving.value = false;
  }
}

function saveOriginal() {
  Modal.confirm({
    title: "覆盖原图",
    content: "当前修改会直接写回原来的文件。",
    okText: "覆盖保存",
    cancelText: "取消",
    onOk: () => commit("original"),
  });
}

function printImage() {
  if (!ready.value) return;
  const item = files.value[current.value];
  if (!item) return;
  beginPrint({
    images: [{ path: item.path, name: item.name, edit: payload(false) }],
    index: 0,
  });
  router.push("/image-print");
}

watch(cropping, () => {
  if (ready.value) schedule(true);
});
watch(editVersion, () => {
  adoptRequest();
  load();
});
watch(sessionReady, () => {
  if (!activeFile()?.path) load();
});

onMounted(() => {
  observer = new ResizeObserver(() => {
    frameTick.value += 1;
  });
  if (stageRef.value) observer.observe(stageRef.value);
  window.addEventListener("keydown", onCropKey);
  adoptRequest();
  load();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onCropKey);
  window.clearTimeout(timer);
  requestId += 1;
  observer?.disconnect();
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
</script>

<style scoped>
.viewer {
  display: flex;
  height: 100%;
  flex-direction: column;
  background: #16171a;
  color: #f3f4f6;
}

.top,
.ribbon,
.zoom,
.side {
  display: flex;
  align-items: center;
}

.top {
  display: grid;
  flex: none;
  grid-template-columns: 1fr auto 1fr;
  height: 48px;
  padding: 0 10px;
  background: #1c1d21;
}

.side {
  gap: 4px;
  min-width: 0;
}

.side.end {
  justify-content: flex-end;
}

.filename {
  max-width: 36vw;
  overflow: hidden;
  color: #eceef2;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon,
.text {
  display: inline-flex;
  height: 32px;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #e8eaef;
  font-size: 13px;
  cursor: pointer;
}

.icon {
  position: relative;
  width: 32px;
  padding: 0;
}

.icon[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  z-index: 5;
  padding: 4px 8px;
  border-radius: 6px;
  background: #f4f5f7;
  color: #17181c;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
}

.icon[data-tip]:hover::after {
  opacity: 1;
}

.text {
  padding: 0 10px;
}

.icon:hover,
.text:hover {
  background: rgba(255, 255, 255, 0.08);
}

.icon.on {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.text.solid {
  background: #f4f5f7;
  color: #17181c;
}

.text.solid:hover {
  background: #fff;
}

.save {
  position: relative;
  z-index: 9;
}

.save .chevron {
  width: 14px;
  height: 14px;
}

.save .mask {
  position: fixed;
  inset: 0;
  z-index: 7;
}

.save .menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 8;
  min-width: 132px;
  padding: 4px;
  border-radius: 10px;
  background: #2a2c31;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}

.save .menu button {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #f4f5f7;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.save .menu button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.icon svg,
.text svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ribbon {
  gap: 4px;
  height: 64px;
  flex: none;
  justify-content: center;
  padding: 0 12px;
  background: #1c1d21;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.tool {
  display: flex;
  width: 52px;
  height: 48px;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: #d5d8e0;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.tool svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.tool:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.tool.on {
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

.split {
  width: 1px;
  height: 16px;
  flex: none;
  margin: 0 8px;
  background: rgba(255, 255, 255, 0.12);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.crop-bar {
  display: flex;
  height: 52px;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #1c1d21;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.spins {
  position: absolute;
  left: 50%;
  bottom: 22px;
  z-index: 4;
  display: flex;
  gap: 10px;
  transform: translateX(-50%);
  pointer-events: none;
}

.spins .icon {
  pointer-events: auto;
}

.glass {
  width: 40px;
  height: 40px;
  color: #fff;
  background: rgba(20, 20, 22, 0.28);
  backdrop-filter: blur(10px);
}

.glass:hover {
  background: rgba(20, 20, 22, 0.46);
}

.strip {
  display: flex;
  flex: none;
  gap: 8px;
  padding: 8px 12px;
  overflow-x: auto;
  background: #2e3138;
}

.strip button {
  width: 48px;
  height: 48px;
  flex: none;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 6px;
  background: #1c1e22;
  cursor: pointer;
}

.strip button.on {
  border-color: #3d7eff;
}

.strip img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

button:disabled {
  cursor: default;
  opacity: 0.38;
}

.stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #121316;
}

.status {
  margin: 0;
  color: #9aa1ad;
}

.sheet {
  position: relative;
  flex: none;
  background: #111;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.38);
  touch-action: none;
}

.sheet img {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

.crop {
  position: absolute;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
}

.crop::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(90deg, #3a86ff 0 4px, transparent 4px 7px) top / 100% 1.5px no-repeat,
    repeating-linear-gradient(90deg, #3a86ff 0 4px, transparent 4px 7px) bottom / 100% 1.5px no-repeat,
    repeating-linear-gradient(#3a86ff 0 4px, transparent 4px 7px) left / 1.5px 100% no-repeat,
    repeating-linear-gradient(#3a86ff 0 4px, transparent 4px 7px) right / 1.5px 100% no-repeat;
  pointer-events: none;
}

.handle {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: #1f6fff;
  box-shadow: 0 0 0 0.5px rgba(31, 111, 255, 0.35);
}

.nw { top: -6px; left: -6px; }
.n { top: -6px; left: calc(50% - 6px); }
.ne { top: -6px; right: -6px; }
.e { top: calc(50% - 6px); right: -6px; }
.se { right: -6px; bottom: -6px; }
.sw { bottom: -6px; left: -6px; }
.s { bottom: -6px; left: calc(50% - 6px); }
.w { top: calc(50% - 6px); left: -6px; }

footer.status {
  display: flex;
  height: 36px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  background: #1c1d21;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: #aeb4bf;
  font-size: 12px;
}

.meta {
  display: flex;
  gap: 14px;
  font-variant-numeric: tabular-nums;
}

.zoom {
  gap: 2px;
}

.zoom span {
  min-width: 48px;
  color: #e7e9ee;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
</style>
