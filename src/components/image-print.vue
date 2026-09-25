<template>
  <div class="studio" :class="{ moving }">
    <header class="bar">
      <button type="button" class="back" @click="back">返回</button>
      <strong>图片打印</strong>
    </header>

    <div class="body">
      <div class="main">
        <section ref="stageRef" class="stage">
          <div class="zoom">
            <button type="button" @click="zoomView(-1)">−</button>
            <span>{{ Math.round(viewScale * 100) }}%</span>
            <button type="button" @click="zoomView(1)">+</button>
          </div>
          <div class="paper" :style="paperStyle">
            <div
              v-if="previewUrl"
              class="sheet"
              :class="{ custom: !fit }"
              :style="imageStyle"
              @pointerdown="startDrag"
            >
              <img :src="previewUrl" alt="" draggable="false" />
              <template v-if="!fit">
                <span class="frame" />
                <i v-for="item in handles" :key="item" class="handle" :class="item" @pointerdown="startScale" />
              </template>
            </div>
            <p v-else class="empty">{{ status }}</p>
          </div>
        </section>
      </div>

      <aside class="panel">
        <h2>基础打印</h2>
        <label class="block">
          <span>打印机</span>
          <span class="select">
            <select v-model="printer">
              <option value="">系统默认</option>
              <option v-for="item in printers" :key="item.name" :value="item.name">{{ item.displayName || item.name }}</option>
            </select>
          </span>
        </label>
        <div class="split">
          <label class="block">
            <span>打印份数</span>
            <a-input-number v-model:value="copies" class="box" :min="1" :max="99" :precision="0" />
          </label>
          <label class="block">
            <span>纸张</span>
            <span class="select">
              <select v-model="paper">
                <option value="A4">A4</option>
                <option value="A3">A3</option>
              </select>
            </span>
          </label>
          <div class="orient">
            <button type="button" :class="{ on: orientation === 'portrait' }" @click="orientation = 'portrait'">纵向</button>
            <button type="button" :class="{ on: orientation === 'landscape' }" @click="orientation = 'landscape'">横向</button>
          </div>
        </div>
        <p class="label">页面布局</p>
        <div class="layouts">
          <button type="button" :class="{ on: fit }" @click="fit = true">
            <svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1.2" /><rect x="7" y="7" width="10" height="10" rx="0.6" /></svg>
            自适应
          </button>
          <button type="button" :class="{ on: !fit }" @click="useCustom">
            <svg viewBox="0 0 24 24"><path d="M8 4.5v3.2H4.8M16 4.5v3.2h3.2M8 19.5v-3.2H4.8M16 19.5v-3.2h3.2" /></svg>
            自定义
          </button>
        </div>
        <p class="label">对齐</p>
        <div class="aligns" :class="{ dim: fit }">
          <button
            v-for="item in aligns"
            :key="item.id"
            type="button"
            :class="{ on: !fit && !offset && alignX === item.x && alignY === item.y }"
            :data-tip="item.tip"
            @click="chooseAlign(item)"
          >
            <svg viewBox="0 0 20 20"><rect x="1.75" y="1.75" width="16.5" height="16.5" rx="1.25" /><rect :x="item.mx" :y="item.my" width="6.2" height="4.4" rx="0.45" /></svg>
          </button>
        </div>
        <div class="size">
          <span>尺寸</span>
          <a-input-number class="box" :value="widthCm ? Number(widthCm) : null" :min="1" :step="0.1" :precision="2" :disabled="fit" @change="setWidth" />
          <em>宽</em>
          <a-input-number class="box" :value="heightCm ? Number(heightCm) : null" :min="1" :step="0.1" :precision="2" :disabled="fit" @change="setHeight" />
          <em>高</em>
          <b>厘米</b>
        </div>
        <div class="scale">
          <span>比例</span>
          <input v-model.number="scale" type="range" min="20" max="200" :disabled="fit" />
          <b>{{ shownScale }}%</b>
        </div>
        <button type="button" class="print" :disabled="!previewUrl || printing" @click="submit">
          {{ printing ? "正在打印" : "打印" }}
        </button>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { currentPrint } from "../print-session";
import { fileSrc } from "../files";
import { PAPER, PT_PER_CM, paperCm, paperPoints } from "../paper";
const aligns = [
  { id: "tl", tip: "左上", x: "left", y: "top", mx: 3.3, my: 3.3 },
  { id: "tc", tip: "上", x: "center", y: "top", mx: 6.9, my: 3.3 },
  { id: "tr", tip: "右上", x: "right", y: "top", mx: 10.5, my: 3.3 },
  { id: "ml", tip: "左", x: "left", y: "middle", mx: 3.3, my: 7.8 },
  { id: "mc", tip: "居中", x: "center", y: "middle", mx: 6.9, my: 7.8 },
  { id: "mr", tip: "右", x: "right", y: "middle", mx: 10.5, my: 7.8 },
  { id: "bl", tip: "左下", x: "left", y: "bottom", mx: 3.3, my: 12.3 },
  { id: "bc", tip: "下", x: "center", y: "bottom", mx: 6.9, my: 12.3 },
  { id: "br", tip: "右下", x: "right", y: "bottom", mx: 10.5, my: 12.3 },
];

const router = useRouter();
const images = ref([]);
const current = ref(0);
const printers = ref([]);
const printer = ref("");
const copies = ref(1);
const paper = ref("A4");
const orientation = ref("portrait");
const fit = ref(true);
const scale = ref(100);
const alignX = ref("center");
const alignY = ref("middle");
const offset = ref(null);
const previewUrl = ref("");
const source = ref({ w: 1, h: 1 });
const status = ref("正在准备");
const printing = ref(false);
const moving = ref(false);
const viewScale = ref(1);
const stageRef = ref(null);
const frame = ref({ w: 800, h: 640 });
const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
let previewObjectUrl = "";
let stageObserver = null;
let scaling = null;
let dragging = null;

const pageBox = computed(() => paperPoints(paper.value, orientation.value));
const pxPerCm = computed(() => {
  const maxW = Math.max(180, frame.value.w - 96);
  const maxH = Math.max(180, frame.value.h - 128);
  const longest = PAPER.A3.cm[1];
  return Math.min(maxW / longest, maxH / longest);
});
const paperStyle = computed(() => {
  const [cmW, cmH] = paperCm(paper.value, orientation.value);
  const unit = pxPerCm.value * viewScale.value;
  return {
    width: `${Math.round(cmW * unit)}px`,
    height: `${Math.round(cmH * unit)}px`,
  };
});
const placed = computed(() => place(source.value.w, source.value.h, pageBox.value[0], pageBox.value[1]));
const shownScale = computed(() => (fit.value ? 100 : Math.round(scale.value)));
const widthCm = computed(() => (previewUrl.value ? (placed.value.width / PT_PER_CM).toFixed(2) : ""));
const heightCm = computed(() => (previewUrl.value ? (placed.value.height / PT_PER_CM).toFixed(2) : ""));
const imageStyle = computed(() => {
  const [pageWidth, pageHeight] = pageBox.value;
  const box = placed.value;
  return {
    width: `${(box.width / pageWidth) * 100}%`,
    height: `${(box.height / pageHeight) * 100}%`,
    left: `${(box.x / pageWidth) * 100}%`,
    top: `${(box.y / pageHeight) * 100}%`,
  };
});

function clampAxis(value, size, page) {
  if (size >= page) return Math.min(0, Math.max(page - size, value));
  return Math.min(page - size, Math.max(0, value));
}

function place(imageWidth, imageHeight, pageWidth, pageHeight) {
  const fitScale = Math.min(pageWidth / imageWidth, pageHeight / imageHeight) || 1;
  const userScale = fit.value ? 1 : Math.min(2, Math.max(0.1, scale.value / 100));
  const width = imageWidth * fitScale * userScale;
  const height = imageHeight * fitScale * userScale;
  let x = (pageWidth - width) / 2;
  let y = (pageHeight - height) / 2;
  if (!fit.value && offset.value) {
    x = clampAxis(offset.value.x, width, pageWidth);
    y = clampAxis(offset.value.y, height, pageHeight);
  } else if (!fit.value) {
    if (alignX.value === "left") x = 0;
    if (alignX.value === "right") x = pageWidth - width;
    if (alignY.value === "top") y = 0;
    if (alignY.value === "bottom") y = pageHeight - height;
  }
  return { x, y, width, height, fitWidth: imageWidth * fitScale };
}

function zoomView(step) {
  viewScale.value = Math.min(1.6, Math.max(0.4, Math.round((viewScale.value + step * 0.1) * 10) / 10));
}

function chooseAlign(item) {
  if (fit.value) return;
  alignX.value = item.x;
  alignY.value = item.y;
  offset.value = null;
}

function useCustom() {
  fit.value = false;
  if (!scale.value) scale.value = 100;
}

function startDrag(event) {
  if (fit.value || event.target.closest(".handle")) return;
  event.preventDefault();
  const paper = event.currentTarget.closest(".paper");
  if (!paper) return;
  const rect = paper.getBoundingClientRect();
  const box = placed.value;
  dragging = {
    sx: event.clientX,
    sy: event.clientY,
    x: box.x,
    y: box.y,
    pageW: pageBox.value[0],
    pageH: pageBox.value[1],
    pxW: rect.width,
    pxH: rect.height,
  };
  moving.value = true;
  window.addEventListener("pointermove", moveDrag);
  window.addEventListener("pointerup", endDrag);
}

function moveDrag(event) {
  if (!dragging) return;
  const dx = ((event.clientX - dragging.sx) / dragging.pxW) * dragging.pageW;
  const dy = ((event.clientY - dragging.sy) / dragging.pxH) * dragging.pageH;
  offset.value = { x: dragging.x + dx, y: dragging.y + dy };
}

function endDrag() {
  dragging = null;
  moving.value = false;
  window.removeEventListener("pointermove", moveDrag);
  window.removeEventListener("pointerup", endDrag);
}

function startScale(event) {
  event.stopPropagation();
  event.preventDefault();
  const paper = event.currentTarget.closest(".paper");
  if (!paper) return;
  const rect = paper.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  scaling = {
    cx,
    cy,
    dist: Math.hypot(event.clientX - cx, event.clientY - cy) || 1,
    scale: scale.value,
  };
  window.addEventListener("pointermove", moveScale);
  window.addEventListener("pointerup", endScale);
}

function moveScale(event) {
  if (!scaling) return;
  const dist = Math.hypot(event.clientX - scaling.cx, event.clientY - scaling.cy);
  scale.value = Math.min(200, Math.max(20, Math.round(scaling.scale * (dist / scaling.dist))));
}

function endScale() {
  scaling = null;
  window.removeEventListener("pointermove", moveScale);
  window.removeEventListener("pointerup", endScale);
}

function setWidth(value) {
  const cm = Number(value);
  const fitWidth = placed.value.fitWidth;
  if (!cm || !fitWidth) return;
  fit.value = false;
  scale.value = Math.min(200, Math.max(20, (cm * PT_PER_CM / fitWidth) * 100));
}

function setHeight(value) {
  const cm = Number(value);
  const box = place(source.value.w, source.value.h, pageBox.value[0], pageBox.value[1]);
  const fitHeight = source.value.h * (box.fitWidth / source.value.w);
  if (!cm || !fitHeight) return;
  fit.value = false;
  scale.value = Math.min(200, Math.max(20, (cm * PT_PER_CM / fitHeight) * 100));
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value?.data) return new Uint8Array(value.data);
  return new Uint8Array();
}

async function loadPreview() {
  const item = images.value[current.value];
  if (!item) {
    previewUrl.value = "";
    status.value = "没有可打印的图片";
    return;
  }
  status.value = "正在准备";
  try {
    if (item.edit?.path && window.ipcRenderer) {
      const result = await window.ipcRenderer.invoke("render_edit", JSON.stringify({ ...item.edit, save: false }));
      const bytes = asBytes(result?.bytes);
      if (!bytes.byteLength) throw new Error("empty");
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      previewUrl.value = previewObjectUrl;
      item.preview = previewObjectUrl;
      source.value = {
        w: result.sourceWidth || result.width || 1,
        h: result.sourceHeight || result.height || 1,
      };
    } else {
      previewUrl.value = fileSrc(item.path);
      const probe = new Image();
      const size = await new Promise((resolve, reject) => {
        probe.onload = () => resolve({ w: probe.naturalWidth || 1, h: probe.naturalHeight || 1 });
        probe.onerror = () => reject(new Error("empty"));
        probe.src = previewUrl.value;
      });
      source.value = size;
    }
    status.value = "";
  } catch {
    previewUrl.value = "";
    status.value = "图片无法打开";
  }
}

async function submit() {
  if (!images.value.length || printing.value) return;
  printing.value = true;
  try {
    const body = {
      images: images.value.map((item) => ({ path: item.path, edit: item.edit })),
      size: paper.value,
      layout: orientation.value,
      fit: fit.value,
      scale: scale.value,
      alignX: alignX.value,
      alignY: alignY.value,
      copies: copies.value,
      deviceName: printer.value,
    };
    if (!fit.value && offset.value) {
      body.x = placed.value.x / pageBox.value[0];
      body.y = placed.value.y / pageBox.value[1];
    }
    const result = await window.ipcRenderer.invoke("print_sheet", JSON.stringify(body));
    if (!result?.cancelled) message.success("已提交打印");
  } catch {
    message.error("打印失败，请稍后重试");
  } finally {
    printing.value = false;
  }
}

function back() {
  router.push("/edit");
}

watch(current, () => loadPreview());

onMounted(() => {
  stageObserver = new ResizeObserver(() => {
    if (!stageRef.value) return;
    frame.value = { w: stageRef.value.clientWidth, h: stageRef.value.clientHeight };
  });
  if (stageRef.value) stageObserver.observe(stageRef.value);
  const job = currentPrint();
  const list = job?.images || [];
  const index = Math.min(job?.index || 0, Math.max(0, list.length - 1));
  images.value = list[index] ? [{ ...list[index] }] : [];
  current.value = 0;
  window.ipcRenderer?.invoke("list_printers").then((list) => {
    printers.value = list || [];
  }).catch(() => {});
  loadPreview();
});

onBeforeUnmount(() => {
  stageObserver?.disconnect();
  endDrag();
  endScale();
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});
</script>

<style scoped>
.studio {
  display: flex;
  height: 100%;
  flex-direction: column;
  background: #2a2c31;
  color: #e8eaef;
  font-size: 13px;
}

.bar {
  display: flex;
  height: 40px;
  flex: none;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  background: #2a2c31;
}

.back {
  height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #e8eaef;
  cursor: pointer;
}

.back:hover {
  background: rgba(255, 255, 255, 0.08);
}

.bar strong {
  font-size: 14px;
  font-weight: 600;
}

.body {
  display: flex;
  min-height: 0;
  flex: 1;
}

.main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}

.stage {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 48px 36px 28px;
  background: #23252a;
}

.zoom {
  position: absolute;
  top: 12px;
  left: 14px;
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 4px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #d7dae1;
  font-size: 12px;
}

.zoom button {
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.zoom button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.zoom span {
  min-width: 42px;
  text-align: center;
}

.paper {
  position: relative;
  flex: none;
  background: #fff;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}

.sheet {
  position: absolute;
  touch-action: none;
}

.sheet img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.sheet.custom {
  cursor: grab;
}

.moving .sheet.custom {
  cursor: grabbing;
}

.frame {
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

.handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
.handle.n { top: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
.handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
.handle.e { top: 50%; right: -6px; margin-top: -6px; cursor: ew-resize; }
.handle.se { right: -6px; bottom: -6px; cursor: nwse-resize; }
.handle.s { bottom: -6px; left: 50%; margin-left: -6px; cursor: ns-resize; }
.handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.handle.w { top: 50%; left: -6px; margin-top: -6px; cursor: ew-resize; }

.empty {
  margin: 0;
  padding: 28px 16px;
  color: #98a0ab;
  font-size: 13px;
  text-align: center;
}

.back:hover {
  background: rgba(255, 255, 255, 0.08);
}

.panel {
  display: flex;
  width: 332px;
  flex: none;
  flex-direction: column;
  gap: 12px;
  padding: 16px 16px 14px;
  background: #32343a;
}

.panel h2,
.label {
  margin: 0;
  color: #e8eaef;
  font-size: 14px;
  font-weight: 600;
}

.label {
  font-size: 12px;
  font-weight: 500;
  color: #b7bcc6;
}

.block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: #b7bcc6;
  font-size: 12px;
}

.split .block {
  flex: 1;
}

.split {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.select {
  position: relative;
  display: block;
}

.select select,
.box {
  width: 100%;
  height: 32px;
  border: 1px solid #4a4e58;
  border-radius: 6px;
  background: #26282d;
  color: #f4f5f7;
  font-size: 13px;
}

.select select {
  padding: 0 26px 0 8px;
  color-scheme: dark;
  appearance: none;
}

.box.ant-input-number {
  padding: 0;
  background: #26282d;
  border-color: #4a4e58;
}

.box :deep(.ant-input-number-input) {
  height: 30px;
  padding-inline: 8px 26px;
  background: transparent;
  color: #f4f5f7;
  -webkit-text-fill-color: #f4f5f7;
  text-align: center;
}

.box :deep(.ant-input-number-handler-wrap) {
  opacity: 1;
  background: #1e2024;
  border-inline-start: 1px solid #3a3d46;
}

.box :deep(.ant-input-number-handler) {
  border-block-start: 1px solid #3a3d46;
  border-inline-start-color: #3a3d46;
  border-left-color: #3a3d46;
  background: #1e2024;
}

.box :deep(.ant-input-number-handler-up-inner),
.box :deep(.ant-input-number-handler-down-inner) {
  color: #e8eaef;
}

.box.ant-input-number-focused {
  border-color: #4c6fff;
  box-shadow: none;
}

.box.ant-input-number-disabled {
  background: #26282d;
}

.select select:focus,
.box:focus {
  outline: none;
  border-color: #4c6fff;
}

.select::after {
  content: "";
  position: absolute;
  top: 13px;
  right: 10px;
  border: 4px solid transparent;
  border-top-color: #c5cad3;
  pointer-events: none;
}

.orient {
  display: flex;
  flex: none;
  gap: 4px;
  margin-bottom: 1px;
}

.orient button,
.layouts button,
.aligns button,
.print {
  border: 0;
  color: #e8eaef;
  cursor: pointer;
}

.orient button {
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  background: #26282d;
  font-size: 12px;
}

.orient button.on {
  background: #4c6fff;
  color: #fff;
}

.layouts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.layouts button {
  display: flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #26282d;
  font-size: 13px;
}

.layouts button svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}

.layouts button.on {
  border-color: #4c6fff;
  background: #2c3558;
}

.aligns {
  display: grid;
  width: 132px;
  margin: 0 auto;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.aligns.dim {
  opacity: 0.4;
}

.aligns button {
  position: relative;
  display: grid;
  aspect-ratio: 1;
  height: auto;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  background: #26282d;
  color: #d7dbe3;
}

.aligns button[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  z-index: 8;
  padding: 3px 6px;
  border-radius: 4px;
  background: #f4f5f7;
  color: #17181c;
  font-size: 12px;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-50%);
}

.aligns button[data-tip]:hover::after {
  opacity: 1;
}

.aligns button svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
}

.aligns button svg rect:last-child {
  fill: currentColor;
  stroke: none;
}

.aligns button.on {
  border-color: #4c6fff;
  background: #2c3558;
  color: #fff;
}

.size,
.scale {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b7bcc6;
  font-size: 12px;
}

.size span,
.scale span {
  flex: none;
  white-space: nowrap;
}

.size .box {
  width: 96px;
  flex: none;
}

.size em,
.size b {
  flex: none;
  white-space: nowrap;
}

.size em,
.scale b,
.size b {
  color: #d7dae1;
  font-style: normal;
  font-weight: 500;
}

.scale {
  gap: 8px;
}

.scale input {
  width: 100%;
  accent-color: #4c6fff;
}

.scale b {
  width: 40px;
  flex: none;
  text-align: right;
}

.print {
  height: 40px;
  margin-top: auto;
  border-radius: 8px;
  background: #4c6fff;
  color: #fff;
  font-size: 15px;
}

.print:hover:not(:disabled) {
  background: #3d62f5;
}

.print:disabled,
.box:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
