import { createRouter, createWebHashHistory } from "vue-router";
import Print from "./components/print.vue";
import Preview from "./components/preview.vue";
import Editor from "./components/editor.vue";
import ImagePrint from "./components/image-print.vue";

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", component: Print },
    { path: "/preview", component: Preview },
    { path: "/edit", component: Editor },
    { path: "/image-print", component: ImagePrint },
  ],
});
