<template>
  <div v-if="open" class="mask" @mousedown.self="close">
    <section class="dialog" role="dialog" aria-label="打印" @keydown.esc="close">
      <header class="title">
        <strong>打印</strong>
        <button type="button" class="x" aria-label="关闭" @click="close">×</button>
      </header>
      <div class="body">
        <div class="settings">
          <h3>基础设置</h3>
          <div class="row printer-row">
            <span>打印机</span>
            <select v-model="printer">
              <option value="">系统默认</option>
              <option v-for="item in printers" :key="item.name" :value="item.name">{{ item.displayName || item.name }}</option>
            </select>
            <button type="button" class="ghost" title="打开这台打印机的属性" @click="openProperties">属性</button>
          </div>
          <div class="row copies-row">
            <span>打印份数</span>
            <a-input-number v-model:value="copies" class="copies" :min="1" :max="99" :precision="0" />
            <label class="check" :class="{ quiet: copies < 2 }">
              <input v-model="collate" type="checkbox" :disabled="copies < 2" />
              逐份打印
            </label>
          </div>
          <div class="row quality-row">
            <span>打印质量</span>
            <select v-model="quality">
              <option value="standard">标准</option>
              <option value="high">高清</option>
            </select>
            <label class="check">
              <input v-model="grayscale" type="checkbox" />
              灰度打印
            </label>
          </div>

          <h3>页面范围</h3>
          <div class="ranges">
            <label><input v-model="rangeMode" type="radio" value="current" />当前页面</label>
            <label><input v-model="rangeMode" type="radio" value="all" />所有页面</label>
            <label><input v-model="rangeMode" type="radio" value="view" />当前视图</label>
            <div class="spec-line">
              <label><input v-model="rangeMode" type="radio" value="custom" />页码</label>
              <input
                v-model="pageSpec"
                class="spec"
                :disabled="rangeMode !== 'custom'"
                placeholder="1-4, 6"
              />
            </div>
          </div>
          <p v-if="rangeMode === 'custom' && !pages.length" class="warn">页码不在文档范围内</p>
          <div class="row parity-row">
            <span>奇偶页面</span>
            <select v-model="parity">
              <option value="all">范围中所有页面</option>
              <option value="odd">仅奇数页</option>
              <option value="even">仅偶数页</option>
            </select>
            <label class="check">
              <input v-model="reverse" type="checkbox" />
              逆序打印
            </label>
          </div>

          <h3>打印方式</h3>
          <div class="segment">
            <button type="button" :class="{ on: mode === 'page' }" @click="chooseMode('page')">页面大小</button>
            <button type="button" :class="{ on: mode === 'nup' }" @click="chooseMode('nup')">一张多页</button>
            <button type="button" :class="{ on: mode === 'booklet' }" @click="chooseMode('booklet')">小册子</button>
          </div>
          <div v-if="mode === 'page'" class="fits">
            <label><input v-model="fit" type="radio" value="margin" />适合打印边距</label>
            <label><input v-model="fit" type="radio" value="actual" />实际大小</label>
            <label><input v-model="fit" type="radio" value="shrink" />缩小过大页面</label>
            <div class="scale">
              <label><input v-model="fit" type="radio" value="custom" />自定义比例</label>
              <a-input-number
                v-model:value="scale"
                class="scale-input"
                :min="10"
                :max="400"
                :precision="0"
                :disabled="fit !== 'custom'"
              />
              <span>%</span>
            </div>
          </div>
          <div v-else-if="mode === 'nup'" class="nup">
            <button
              v-for="count in nupChoices"
              :key="count"
              type="button"
              :class="{ on: perSheet === count }"
              @click="perSheet = count"
            >
              <span class="mini" :style="{ gridTemplateColumns: `repeat(${nupCols(count)}, 1fr)` }">
                <i v-for="cell in count" :key="cell" />
              </span>
              {{ count }} 页
            </button>
          </div>
          <p v-else class="hint">按折页顺序，两页拼在一张横向纸上。</p>
          <div class="duplex-row">
            <label class="check">
              <input v-model="duplex" type="checkbox" />
              使用双面打印
            </label>
            <div v-if="duplex" class="flip">
              <label><input v-model="duplexEdge" type="radio" value="longEdge" />长边翻页</label>
              <label><input v-model="duplexEdge" type="radio" value="shortEdge" />短边翻页</label>
            </div>
          </div>

          <h3>页面设置</h3>
          <div class="row paper-row">
            <span>纸张大小</span>
            <select v-model="paper">
              <option v-for="(item, name) in papers" :key="name" :value="name">{{ item.label }}</option>
            </select>
            <button type="button" class="ghost" @click="marginOpen = !marginOpen">页边距</button>
          </div>
          <div v-if="marginOpen" class="margin-panel">
            <label v-for="item in marginPresets" :key="item.id">
              <input v-model="marginId" type="radio" :value="item.id" @change="applyPreset(item.id)" />
              {{ item.label }}
            </label>
            <div class="margin-grid">
              <label>上<input v-model.number="marginMm.top" type="number" min="0" max="50" step="0.1" @input="marginId = 'custom'" /></label>
              <label>下<input v-model.number="marginMm.bottom" type="number" min="0" max="50" step="0.1" @input="marginId = 'custom'" /></label>
              <label>左<input v-model.number="marginMm.left" type="number" min="0" max="50" step="0.1" @input="marginId = 'custom'" /></label>
              <label>右<input v-model.number="marginMm.right" type="number" min="0" max="50" step="0.1" @input="marginId = 'custom'" /></label>
            </div>
            <p>单位：毫米</p>
          </div>
          <div class="orients">
            <span>纸张方向</span>
            <label><input v-model="orientation" type="radio" value="auto" :disabled="mode === 'booklet'" />自动横向/纵向</label>
            <label><input v-model="orientation" type="radio" value="portrait" :disabled="mode === 'booklet'" />纵向</label>
            <label><input v-model="orientation" type="radio" value="landscape" :disabled="mode === 'booklet'" />横向</label>
          </div>
        </div>

        <div class="preview">
          <div class="preview-head">
            <span>打印内容</span>
            <select>
              <option>仅文档</option>
            </select>
          </div>
          <div ref="stageRef" class="stage">
            <p v-if="loading" class="status">正在打开预览</p>
            <p v-else-if="!filePath" class="status">没有可预览的文件</p>
            <p v-else-if="error" class="status">{{ error }}</p>
            <p v-else-if="!layout.sheets.length" class="status">没有要打印的页面</p>
            <div v-else class="paper" :class="{ gray: grayscale }" :style="paperStyle">
              <div class="sheet-clip" :style="guideStyle">
                <div
                  v-for="(slot, index) in currentSheet"
                  :key="`${previewIndex}-${slot.page}-${index}`"
                  class="slot"
                  :class="{ framed: mode !== 'page' }"
                  :style="slotStyle(slot)"
                >
                  <img :src="thumbs[slot.page]" alt="" />
                  <em v-if="mode !== 'page'">{{ slot.page }}</em>
                </div>
              </div>
              <i v-if="marginId !== 'none'" class="guide" :style="guideStyle" />
            </div>
          </div>
          <div class="pager">
            <button type="button" :disabled="previewIndex <= 1" @click="previewIndex = 1">|&lt;</button>
            <button type="button" :disabled="previewIndex <= 1" @click="previewIndex -= 1">&lt;</button>
            <input v-model.number="previewInput" type="number" min="1" :max="sheetCount || 1" @change="jumpPreview" />
            <span>/ {{ sheetCount || 0 }}</span>
            <button type="button" :disabled="previewIndex >= sheetCount" @click="previewIndex += 1">&gt;</button>
            <button type="button" :disabled="previewIndex >= sheetCount" @click="previewIndex = sheetCount">&gt;|</button>
          </div>
          <div class="actions">
            <button type="button" class="primary" :disabled="!canPrint" @click="submit">
              {{ preparing ? "正在打印" : "打印" }}
            </button>
            <button type="button" class="ghost close" @click="close">关闭</button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { message } from "ant-design-vue";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PAPERS, detectPaper, layoutSheets, pagesToPrint } from "../print-layout";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const nupChoices = [2, 4, 6, 9, 16];
const marginPresets = [
  { id: "none", label: "无" },
  { id: "normal", label: "普通", mm: 19.1 },
  { id: "narrow", label: "窄", mm: 12.7 },
  { id: "wide", label: "宽", mm: 25.4 },
  { id: "custom", label: "自定义" },
];

const open = defineModel("open", { type: Boolean, default: false });
const props = defineProps({
  filePath: { type: String, default: "" },
  currentPage: { type: Number, default: 1 },
});

const printers = ref([]);
const printer = ref("");
const copies = ref(1);
const collate = ref(true);
const quality = ref("standard");
const grayscale = ref(false);
const rangeMode = ref("all");
const pageSpec = ref("");
const parity = ref("all");
const reverse = ref(false);
const mode = ref("page");
const fit = ref("shrink");
const scale = ref(100);
const perSheet = ref(4);
const duplex = ref(false);
const duplexEdge = ref("longEdge");
const paper = ref("A4");
const orientation = ref("portrait");
const marginId = ref("none");
const marginOpen = ref(false);
const marginMm = ref({ top: 0, right: 0, bottom: 0, left: 0 });
const papers = PAPERS;

const loading = ref(false);
const error = ref("");
const preparing = ref(false);
const previewIndex = ref(1);
const previewInput = ref(1);
const thumbs = ref({});
const stageRef = ref(null);
const stageSize = ref({ width: 480, height: 560 });
const pageSizes = ref({});
const docLandscape = ref(false);

let pdfDoc = null;
let loadedPath = "";
let loadId = 0;
let stageObserver;

const pages = computed(() => pagesToPrint({
  count: pdfDoc?.numPages || Object.keys(pageSizes.value).length,
  current: props.currentPage,
  rangeMode: rangeMode.value,
  spec: pageSpec.value,
  parity: parity.value,
  reverse: reverse.value,
}));

const layout = computed(() => layoutSheets({
  pages: pages.value,
  pageSize: (page) => pageSizes.value[page] || { w: 595.28, h: 841.89 },
  paper: paper.value,
  orientation: orientation.value,
  docLandscape: docLandscape.value,
  mode: mode.value,
  fit: fit.value,
  scale: scale.value,
  perSheet: perSheet.value,
  margin: marginValue(),
}));

const sheetCount = computed(() => layout.value.sheets.length);
const currentSheet = computed(() => layout.value.sheets[previewIndex.value - 1] || []);
const canPrint = computed(() => Boolean(props.filePath) && !loading.value && !preparing.value && sheetCount.value > 0);

const paperStyle = computed(() => {
  const ratio = layout.value.paperW / layout.value.paperH;
  const availW = Math.max(120, stageSize.value.width - 48);
  const availH = Math.max(120, stageSize.value.height - 36);
  let width = availW;
  let height = width / ratio;
  if (height > availH) {
    height = availH;
    width = height * ratio;
  }
  return { width: `${Math.floor(width)}px`, height: `${Math.floor(height)}px` };
});

watch(open, (value) => {
  if (!value) {
    marginOpen.value = false;
    return;
  }
  ensurePrinters();
  ensurePdf();
  nextTick(measureStage);
});

watch(() => props.filePath, () => {
  if (open.value) ensurePdf();
});

watch(previewIndex, (value) => {
  previewInput.value = value;
  paintThumbs();
});

watch(currentSheet, () => paintThumbs(), { deep: true });

watch(sheetCount, (count) => {
  if (previewIndex.value > count) previewIndex.value = Math.max(1, count);
  if (previewIndex.value < 1) previewIndex.value = 1;
});

onBeforeUnmount(() => {
  stageObserver?.disconnect();
  loadId += 1;
  pdfDoc?.destroy?.();
});

function marginValue() {
  if (marginId.value === "none") return null;
  const mm = marginMm.value;
  return {
    top: clampMm(mm.top),
    right: clampMm(mm.right),
    bottom: clampMm(mm.bottom),
    left: clampMm(mm.left),
  };
}

function clampMm(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(50, Math.max(0, number));
}

function applyPreset(id) {
  const preset = marginPresets.find((item) => item.id === id);
  if (!preset || preset.mm == null) return;
  marginMm.value = { top: preset.mm, right: preset.mm, bottom: preset.mm, left: preset.mm };
}

function chooseMode(next) {
  mode.value = next;
  if (next === "booklet") duplex.value = true;
  previewIndex.value = 1;
}

function nupCols(count) {
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

const guideStyle = computed(() => {
  const { clip, paperW, paperH } = layout.value;
  if (!paperW || !paperH) return {};
  return {
    left: `${(clip.x / paperW) * 100}%`,
    top: `${(clip.y / paperH) * 100}%`,
    width: `${(clip.w / paperW) * 100}%`,
    height: `${(clip.h / paperH) * 100}%`,
  };
});

function close() {
  if (preparing.value) return;
  open.value = false;
}

function measureStage() {
  const node = stageRef.value;
  if (!node) return;
  stageSize.value = { width: node.clientWidth, height: node.clientHeight };
  stageObserver?.disconnect();
  stageObserver = new ResizeObserver(() => {
    stageSize.value = { width: node.clientWidth, height: node.clientHeight };
  });
  stageObserver.observe(node);
}

async function ensurePrinters() {
  try {
    printers.value = (await window.ipcRenderer?.invoke("list_printers")) || [];
  } catch {
    printers.value = [];
  }
}

async function ensurePdf() {
  const file = props.filePath;
  if (!file) {
    error.value = "";
    return;
  }
  if (file === loadedPath && pdfDoc) return;
  const id = ++loadId;
  loading.value = true;
  error.value = "";
  thumbs.value = {};
  try {
    const bytes = await window.ipcRenderer.invoke("read_preview_pdf", file);
    const data = bytes?.data ? new Uint8Array(bytes.data) : new Uint8Array(bytes);
    const doc = await pdfjs.getDocument({ data }).promise;
    if (id !== loadId) {
      doc.destroy?.();
      return;
    }
    pdfDoc?.destroy?.();
    pdfDoc = doc;
    loadedPath = file;
    const sizes = {};
    for (let index = 1; index <= doc.numPages; index += 1) {
      const page = await doc.getPage(index);
      const viewport = page.getViewport({ scale: 1 });
      sizes[index] = { w: viewport.width, h: viewport.height };
    }
    pageSizes.value = sizes;
    const first = sizes[1] || { w: 595.28, h: 841.89 };
    docLandscape.value = first.w > first.h;
    paper.value = detectPaper(first.w, first.h);
    orientation.value = docLandscape.value ? "landscape" : "portrait";
    pageSpec.value = `1-${doc.numPages}`;
    previewIndex.value = 1;
    await paintThumbs();
  } catch {
    if (id !== loadId) return;
    error.value = "预览打开失败";
    pdfDoc = null;
    loadedPath = "";
    pageSizes.value = {};
  } finally {
    if (id === loadId) loading.value = false;
    nextTick(measureStage);
  }
}

async function paintThumbs() {
  if (!pdfDoc) return;
  const wanted = currentSheet.value.map((slot) => slot.page).filter(Boolean);
  const next = { ...thumbs.value };
  for (const pageNumber of wanted) {
    if (next[pageNumber]) continue;
    next[pageNumber] = await renderPage(pageNumber, 720, 0.82);
  }
  thumbs.value = next;
}

async function renderPage(pageNumber, maxEdge, quality) {
  const page = await pdfDoc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxEdge / base.width, maxEdge / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", quality);
}

function slotStyle(slot) {
  const { clip } = layout.value;
  const width = clip.w || 1;
  const height = clip.h || 1;
  return {
    left: `${((slot.x - clip.x) / width) * 100}%`,
    top: `${((slot.y - clip.y) / height) * 100}%`,
    width: `${(slot.w / width) * 100}%`,
    height: `${(slot.h / height) * 100}%`,
  };
}

function jumpPreview() {
  const next = Math.min(sheetCount.value || 1, Math.max(1, Math.round(Number(previewInput.value) || 1)));
  previewIndex.value = next;
  previewInput.value = next;
}

async function openProperties() {
  if (!printer.value) {
    message.warning("请先选择一台打印机");
    return;
  }
  try {
    await window.ipcRenderer.invoke("open_printer_properties", printer.value);
  } catch {
    message.error("没能打开这台打印机的属性");
  }
}

async function submit() {
  if (!canPrint.value || !pdfDoc) return;
  preparing.value = true;
  try {
    const plan = layout.value;
    const unique = [...new Set(plan.sheets.flat().map((slot) => slot.page).filter(Boolean))];
    const images = {};
    for (const pageNumber of unique) {
      const edge = quality.value === "high" ? 2480 : 1500;
      images[pageNumber] = (await renderPage(pageNumber, edge, quality.value === "high" ? 0.95 : 0.9)).replace(/^data:image\/jpeg;base64,/, "");
    }
    const result = await window.ipcRenderer.invoke("print_pdf", JSON.stringify({
      copies: copies.value,
      collate: copies.value > 1 && collate.value,
      quality: quality.value,
      deviceName: printer.value,
      grayscale: grayscale.value,
      duplex: duplex.value,
      duplexEdge: duplex.value ? duplexEdge.value : "",
      paperWidth: plan.paperW,
      paperHeight: plan.paperH,
      clip: plan.clip,
      sheets: plan.sheets.map((sheet) => sheet.map((slot) => ({
        jpeg: images[slot.page],
        x: slot.x,
        y: slot.y,
        w: slot.w,
        h: slot.h,
      }))),
    }));
    if (!result?.cancelled) message.success("已提交打印");
    open.value = false;
  } catch {
    message.error("打印失败，请稍后重试");
  } finally {
    preparing.value = false;
  }
}
</script>

<style scoped>
.mask {
  position: fixed;
  z-index: 30;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(23, 32, 51, 0.38);
}

.dialog {
  display: flex;
  width: min(980px, 100%);
  height: min(780px, 100%);
  flex-direction: column;
  overflow: hidden;
  border-radius: 10px;
  background: #fff;
  color: #1f2430;
  box-shadow: 0 18px 60px rgba(18, 28, 48, 0.28);
}

.title {
  display: flex;
  height: 48px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 18px;
  border-bottom: 1px solid #eceff3;
}

.title strong {
  font-size: 15px;
  font-weight: 650;
}

.x {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #667085;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.x:hover {
  background: #f3f5f8;
}

.body {
  display: grid;
  min-height: 0;
  flex: 1;
  grid-template-columns: 372px minmax(0, 1fr);
}

.settings {
  min-height: 0;
  overflow: auto;
  padding: 20px 18px 24px;
  border-right: 1px solid #eceff3;
}

.preview {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  padding: 14px 16px 14px;
  background: #f7f8fa;
}

h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 26px 0 14px;
  color: #1f2430;
  font-size: 13px;
  font-weight: 650;
}

h3::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #eef1f4;
}

h3:first-child {
  margin-top: 0;
}

.row,
.orients,
.ranges,
.fits,
.parity-row {
  color: #3d4654;
  font-size: 12px;
}

.row {
  display: grid;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.printer-row,
.paper-row,
.parity-row {
  grid-template-columns: 64px minmax(0, 1fr) auto;
}

.copies-row {
  grid-template-columns: 64px 108px minmax(0, 1fr);
}

.copies.ant-input-number {
  width: 100%;
  height: 32px;
  border-color: #d7dbe3;
  border-radius: 4px;
  background: #fff;
}

.copies :deep(.ant-input-number-input) {
  height: 30px;
  padding-inline: 8px 22px;
  text-align: center;
  font-size: 13px;
}

.copies :deep(.ant-input-number-handler-wrap) {
  opacity: 1;
}

.copies.ant-input-number-focused {
  border-color: #2f6fed;
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.12);
}

.quality-row {
  grid-template-columns: 64px minmax(0, 1fr) auto;
}

.copies-row .check {
  justify-self: end;
}

select,
.ghost,
.spec,
.pager input,
.margin-grid input {
  height: 32px;
  border: 1px solid #d7dbe3;
  border-radius: 4px;
  background: #fff;
  color: #1f2430;
  font-size: 13px;
}

input[type="radio"],
input[type="checkbox"] {
  width: 14px;
  height: 14px;
  margin: 0;
  flex: none;
}

select {
  width: 100%;
  min-width: 0;
  padding: 0 24px 0 8px;
  appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, #8b93a1 50%), linear-gradient(135deg, #8b93a1 50%, transparent 50%);
  background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.ghost {
  padding: 0 12px;
  cursor: pointer;
}

.ghost:hover,
.segment button:hover,
.nup button:hover,
.pager button:hover {
  border-color: #b7c0cc;
  background: #f7f9fb;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #3d4654;
  font-size: 12px;
  white-space: nowrap;
}

.copies-row .check,
.quality-row .check {
  justify-content: flex-end;
}

.check.quiet,
.check:has(input:disabled) {
  color: #b0b7c3;
}

.ranges,
.fits {
  display: grid;
  gap: 12px 10px;
  margin-bottom: 14px;
}

.ranges {
  grid-template-columns: 1fr 1.35fr;
  align-items: center;
}

.spec-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.spec-line label {
  flex: none;
}

.fits {
  grid-template-columns: 1fr 1fr 1.15fr;
}

.ranges label,
.fits label,
.orients label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.spec {
  width: 100%;
  min-width: 0;
  margin: 0;
  padding: 0 8px;
}

.spec:disabled {
  color: #98a2b3;
  background: #f7f8fa;
}

.warn,
.hint {
  margin: -4px 0 8px;
  color: #98a2b3;
  font-size: 12px;
}

.warn {
  color: #d14343;
}

.segment,
.nup {
  display: grid;
  gap: 4px;
  margin-bottom: 16px;
  padding: 3px;
  border-radius: 6px;
  background: #eef0f3;
}

.segment {
  grid-template-columns: repeat(3, 1fr);
}

.nup {
  grid-template-columns: repeat(5, 1fr);
}

.segment button,
.nup button {
  height: 30px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #3d4654;
  font-size: 12px;
  cursor: pointer;
}

.segment button.on,
.nup button.on {
  background: #fff;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.12);
  color: #1f2430;
  font-weight: 600;
}

.nup button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 48px;
}

.mini {
  display: grid;
  width: 22px;
  height: 16px;
  gap: 1px;
}

.mini i {
  border-radius: 1px;
  background: #c5ccd6;
}

.nup button.on .mini i {
  background: #2f6fed;
}

.scale {
  display: flex;
  align-items: center;
  gap: 8px;
  grid-column: 1 / -1;
}

.scale-input.ant-input-number {
  width: 96px;
  height: 32px;
  border-color: #d7dbe3;
  border-radius: 4px;
  background: #fff;
}

.scale-input :deep(.ant-input-number-input) {
  height: 30px;
  padding-inline: 8px 22px;
  text-align: center;
  font-size: 13px;
}

.scale-input :deep(.ant-input-number-handler-wrap) {
  opacity: 1;
}

.scale-input.ant-input-number-focused {
  border-color: #2f6fed;
  box-shadow: 0 0 0 2px rgba(47, 111, 237, 0.12);
}

.duplex-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 10px 0 16px;
}

.flip {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 0;
  color: #3d4654;
  font-size: 12px;
}

.flip label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.orients {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.margin-panel {
  margin: -2px 0 10px;
  padding: 10px;
  border: 1px solid #e4e7ee;
  border-radius: 8px;
  background: #fafbfc;
}

.margin-panel > label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 10px 8px 0;
  font-size: 12px;
}

.margin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.margin-grid label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.margin-grid input {
  width: 64px;
  padding: 0 6px;
}

.margin-panel p {
  margin: 4px 0 0;
  color: #98a2b3;
  font-size: 11px;
}

.preview-head {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: #3d4654;
  font-size: 12px;
}

.stage {
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 8px;
  background: #eef0f3;
}

.status {
  margin: 0;
  color: #667085;
  font-size: 13px;
}

.paper {
  position: relative;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 10px rgba(23, 32, 51, 0.14);
}

.sheet-clip {
  position: absolute;
  overflow: hidden;
}

.paper.gray {
  filter: grayscale(1);
}

.guide {
  position: absolute;
  z-index: 1;
  border: 1px dashed rgba(47, 111, 237, 0.45);
  pointer-events: none;
}

.slot {
  position: absolute;
  overflow: hidden;
  background: #fff;
}

.slot.framed {
  box-shadow: 0 0 0 1px rgba(23, 32, 51, 0.12);
}

.slot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.slot em {
  position: absolute;
  right: 3px;
  bottom: 1px;
  color: #8b95a5;
  font-size: 9px;
  font-style: normal;
  line-height: 1;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 10px;
  color: #667085;
  font-size: 13px;
}

.pager button,
.pager input {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid #d7dbe3;
  border-radius: 4px;
  background: #fff;
  color: #1f2430;
  cursor: pointer;
}

.pager input {
  width: 48px;
  text-align: center;
}

.pager button:disabled {
  color: #c0c6d0;
  cursor: not-allowed;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.primary,
.close {
  min-width: 88px;
  height: 34px;
  padding: 0 18px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}

.primary {
  border: 0;
  background: #2f6fed;
  color: #fff;
}

.primary:disabled {
  background: #b9cdf8;
  cursor: not-allowed;
}

.primary:not(:disabled):hover {
  background: #245fe0;
}

.close {
  border: 1px solid #d7dbe3;
  background: #fff;
  color: #1f2430;
}
</style>
