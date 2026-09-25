import { createApp } from "vue";
import Antd from "ant-design-vue";
// @ts-ignore
import vue3PreviewImage from "vue3-preview-image";
import "ant-design-vue/dist/reset.css";
import App from "./App.vue";
import router from "./router";

import "./style.css";

const app = createApp(App);
app
  .use(router)
  .use(Antd)
  .use(vue3PreviewImage)
  .mount("#app")
  .$nextTick(() => {
    postMessage({ payload: "removeLoading" }, "*");
  });
