import { createApp } from "vue";
import Antd from "ant-design-vue";
// @ts-ignore
import vue3PreviewImage from "vue3-preview-image";

const previewPlugin =
  typeof vue3PreviewImage === "function" ? vue3PreviewImage : vue3PreviewImage?.default;
import "ant-design-vue/dist/reset.css";
import App from "./App.vue";
import router from "./router";

import "./style.css";

const app = createApp(App);
app
  .use(router)
  .use(Antd)
  .use(previewPlugin)
  .mount("#app")
  .$nextTick(() => {
    postMessage({ payload: "removeLoading" }, "*");
  });
