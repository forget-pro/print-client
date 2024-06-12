<template>
  <div>
    <div>
      <span>核心运行状态：</span>
      <a-tag color="green">{{ state.run_status ? "运行中" : "未运行" }}</a-tag>
    </div>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      启动核心
    </a-button>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      关闭核心
    </a-button>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      重启核心
    </a-button>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      更新核心
    </a-button>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      检查核心运行状态
    </a-button>
    <a-button type="primary" style="margin-left: 6px; margin-top: 6px">
      清理上传文件缓存
    </a-button>

    <div style="margin-top: 12px">计算微信版本号</div>
    <a-input
      style="margin-top: 6px"
      placeholder="请输入微信版本号"
      @input="inputChange"
    ></a-input>
    <div style="margin-top: 6px">
      <a-typography-paragraph :copyable="{ text: state.wechat_version }">
        复制HEX:{{ state.wechat_version }}
      </a-typography-paragraph>
    </div>
    <div>
      <span>上传服务：</span>
      <a-switch v-model:checked="state.upload_service" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";

const state = reactive<any>({
  run_status: 0,
  wechat_version: "",
  upload_service: false,
});

const check_start = () => {
  console.log("check_start");
  window.ipcRenderer.invoke("wcf_start", { type: "check" }).then((res) => {
    console.log("wcf_start", res);
  });
};

// 计算微信版本号
const inputChange = (e: any) => {
  const version = e.target.value;
  const value =
    "6" +
    version
      .split(".")
      .map((v: string, i: number) =>
        Number(v)
          .toString(16)
          .padStart(i === 0 ? 1 : 2, "0")
      )
      .join("");
  state.wechat_version = value;
};
</script>

<style scoped></style>
