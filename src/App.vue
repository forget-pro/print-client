<template>
  <a-config-provider :theme="theme">
    <router-view v-slot="{ Component }">
      <keep-alive include="Print,Editor">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </a-config-provider>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { beginEdit, markSessionReady } from "./edit-session";
import { IMAGE_EXT } from "./files";
const router = useRouter();
const theme = {
  token: {
    fontFamily: `"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", sans-serif`,
  },
};

function normalize(files: string[]) {
  const seen = new Set<string>();
  const images: string[] = [];
  for (let i = 0; i < (files || []).length; i++) {
    const item = files[i];
    if (!IMAGE_EXT.test(item) || seen.has(item)) continue;
    seen.add(item);
    images.push(item);
  }
  return images;
}

function acceptOpened(files: string[]) {
  const images = normalize(files);
  if (!images.length) return;
  beginEdit({ paths: images });
  if (router.currentRoute.value.path !== "/edit") router.push("/edit");
}

onMounted(() => {
  const ipc = window.ipcRenderer;
  if (!ipc) {
    markSessionReady();
    return;
  }
  ipc.on("open_images", (_event, files: string[]) => acceptOpened(files));
  ipc
    .invoke("take_open_images")
    .then((files: string[]) => acceptOpened(files || []))
    .catch(() => {})
    .finally(() => markSessionReady());
});
</script>
