<template>
  <div class="preview-page">
    <header class="bar">
      <div class="side">
        <button type="button" class="back" @click="router.push('/')">
          <left-outlined />
          返回
        </button>
        <strong>{{ title }}</strong>
      </div>
      <div class="pager">
        <button type="button" :disabled="currentPage <= 1" @click="goPage(currentPage - 1)">上一页</button>
        <span>{{ pages.length ? `${currentPage} / ${pages.length}` : "— / —" }}</span>
        <button type="button" :disabled="!pages.length || currentPage >= pages.length" @click="goPage(currentPage + 1)">
          下一页
        </button>
      </div>
      <div class="side end">
        <div class="zoom">
          <button type="button" :disabled="zoomIndex <= 0 || loading" @click="changeZoom(-1)">－</button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <button type="button" :disabled="zoomIndex >= zoomSteps.length - 1 || loading" @click="changeZoom(1)">＋</button>
        </div>
        <a-button type="primary" :loading="printing" :disabled="!filePath || loading" @click="printPdf">
          <template #icon><printer-outlined /></template>
          打印
        </a-button>
      </div>
    </header>
    <main ref="sheetsRef" class="sheets">
      <p v-if="loading" class="status">正在打开预览</p>
      <p v-else-if="error" class="status">{{ error }}</p>
      <canvas
        v-for="page in pages"
        :key="`${filePath}-${page}`"
        :ref="(el) => setCanvas(page, el)"
        :data-page="page"
        class="sheet"
      />
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "ant-design-vue";
import { LeftOutlined, PrinterOutlined } from "@ant-design/icons-vue";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const zoomSteps = [0.5, 0.75, 1, 1.25, 1.5, 2];

const route = useRoute();
const router = useRouter();
const pages = ref([]);
const loading = ref(true);
const error = ref("");
const printing = ref(false);
const filePath = ref("");
const zoom = ref(1);
const currentPage = ref(1);
const sheetsRef = ref(null);
const canvases = [];
let pdfDoc = null;
let renderId = 0;
let observer = null;

const title = computed(() => filePath.value.split(/[/\\]/).pop() || "PDF 预览");
const zoomIndex = computed(() => zoomSteps.findIndex((step) => step >= zoom.value - 0.01));

function setCanvas(page, el) {
  canvases[page] = el;
}

function pdfBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value?.data) return new Uint8Array(value.data);
  return new Uint8Array(value);
}

function watchPages() {
  observer?.disconnect();
  const root = sheetsRef.value;
  if (!root) return;
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const page = Number(visible?.target?.dataset?.page);
      if (page) currentPage.value = page;
    },
    { root, threshold: [0.35, 0.6] }
  );
  for (let index = 1; index <= pages.value.length; index += 1) {
    if (canvases[index]) observer.observe(canvases[index]);
  }
}

async function renderPages() {
  if (!pdfDoc) return;
  const id = ++renderId;
  await nextTick();
  if (id !== renderId) return;
  const fit = Math.min(960, (sheetsRef.value?.clientWidth || window.innerWidth) - 96);
  const cssWidth = Math.max(280, Math.round(fit * zoom.value));
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  for (let index = 1; index <= pdfDoc.numPages; index += 1) {
    if (id !== renderId) return;
    const page = await pdfDoc.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * outputScale });
    const canvas = canvases[index];
    const context = canvas?.getContext("2d");
    if (!canvas || !context) continue;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${Math.floor(viewport.height / outputScale)}px`;
    await page.render({ canvasContext: context, viewport }).promise;
  }
  if (id === renderId) watchPages();
}

async function showFile(pdfPath) {
  if (!pdfPath) {
    loading.value = false;
    error.value = "没有可预览的文件";
    return;
  }
  if (pdfPath === filePath.value && pages.value.length) return;
  filePath.value = pdfPath;
  loading.value = true;
  error.value = "";
  pages.value = [];
  currentPage.value = 1;
  pdfDoc = null;
  try {
    const bytes = await window.ipcRenderer.invoke("read_preview_pdf", pdfPath);
    pdfDoc = await pdfjs.getDocument({ data: pdfBytes(bytes) }).promise;
    pages.value = Array.from({ length: pdfDoc.numPages }, (_, index) => index + 1);
    await renderPages();
  } catch {
    error.value = "预览打开失败";
    pages.value = [];
    pdfDoc = null;
  } finally {
    loading.value = false;
  }
}

function changeZoom(direction) {
  const next = zoomSteps[zoomIndex.value + direction];
  if (!next || next === zoom.value) return;
  zoom.value = next;
  renderPages();
}

function goPage(page) {
  canvases[page]?.scrollIntoView({ behavior: "smooth", block: "start" });
}

onMounted(() => {
  const file = route.query.file;
  showFile(Array.isArray(file) ? file[0] : file || "");
});

onBeforeUnmount(() => {
  renderId += 1;
  observer?.disconnect();
  pdfDoc?.destroy?.();
});

async function printPdf() {
  if (!filePath.value || printing.value) return;
  printing.value = true;
  try {
    const result = await window.ipcRenderer.invoke("print_pdf", JSON.stringify({ path: filePath.value }));
    if (!result?.cancelled) message.success("已提交打印");
  } catch {
    message.error("打印失败，请稍后重试");
  } finally {
    printing.value = false;
  }
}
</script>

<style scoped>
.preview-page {
  display: flex;
  height: 100%;
  flex-direction: column;
  background: #e7e9ee;
  color: #172033;
}

.bar {
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  height: 52px;
  padding: 0 16px;
  border-bottom: 1px solid #e1e4ea;
  background: #fff;
}

.side,
.pager,
.zoom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.side.end {
  justify-content: flex-end;
}

.side strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.back,
.pager button,
.zoom button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #e1e4ea;
  border-radius: 6px;
  background: #fff;
  color: #172033;
  cursor: pointer;
}

.back:hover,
.pager button:hover,
.zoom button:hover {
  border-color: #c5cad3;
  background: #f7f8fa;
}

.pager button:disabled,
.zoom button:disabled {
  color: #b0b7c3;
  cursor: not-allowed;
  background: #f7f8fa;
}

.pager span,
.zoom span {
  min-width: 64px;
  color: #4b5565;
  font-size: 13px;
  text-align: center;
}

.zoom button {
  width: 30px;
  padding: 0;
  justify-content: center;
}

.sheets {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 24px 24px 48px;
}

.status {
  margin: 80px 0 0;
  color: #6b7585;
  text-align: center;
}

.sheet {
  display: block;
  margin: 0 auto 16px;
  background: #fff;
  border: 1px solid #d5d8de;
  box-shadow: 0 2px 8px rgba(23, 32, 51, 0.08);
  scroll-margin-top: 16px;
}
</style>
