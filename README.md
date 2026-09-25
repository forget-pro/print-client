# 图片打印

桌面端图片打印工具。支持批量排版打印、单张图片编辑，以及按纸张预览后再打印。

支持 JPG、JPEG、PNG、WebP。

## 功能

- 批量添加图片或整个文件夹，拖拽调整顺序，去重后排成 PDF 预览再打印。
- 从网页抓取图片，加入待打印列表。
- 图片编辑：裁剪、旋转、翻转、灰度、色阶。可以覆盖原图，或另存副本。
- 从首页进入编辑时，完成修改只作用于待打印的图片，不改原文件。
- 单张打印可选打印机、份数、A4/A3、纵向/横向，以及自适应或自定义排版。
- Windows 安装后会出现在图片的「打开方式」里，不会抢占系统默认图片程序。
- 已安装的客户端会检查 GitHub Release，发现新版本后提示更新。

## 开发

```sh
git clone https://github.com/forget-pro/print-client.git
cd print-client
npm install
npm run dev
```

开发时页面在 `http://localhost:5173`。Windows 的「打开方式」只在安装包里生效。

## 打包

```sh
npm run build:win
```

安装包输出到 `release/<版本>/`。

## 发布

仓库默认分支是 `print`。在 GitHub Actions 里手动运行 [Electron App Release](.github/workflows/publish.yml)，会打包 Windows 安装包，并发布标签 `app-v<版本>`。

工作流文件在 `print` 分支。切到 `main` 时看不到这个脚本。
