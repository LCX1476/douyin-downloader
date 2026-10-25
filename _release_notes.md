## 新功能

- **个性化设置**：6 个预设主题色 + 任意自定义颜色（实时预览），系统 / 等宽字体切换
- **检查更新**：设置页直接查 GitHub Releases，有新版本可一键下载安装包
- **镜像下载**：更新资产默认走 `gh-proxy.com` 前缀，前缀可自定义，绕开 github.com 直连超时

## 修复

- 设置文件新增 `themeColor` / `fontFamily` / `mirrorPrefix`，旧配置自动补默认值
- 打包后的日志改写到 `%APPDATA%\DouyinDownloader\_main.log`（之前写在 app.asar 内，静默失败）
- MSI 改为 perMachine，双击安装会正常弹 UAC，不再出现 1603 / 2502 错误

## 安装

下载 `DouyinDownloader-0.1.1-x64.msi` 双击安装，默认装到 `C:\Program Files\DouyinDownloader`。

## 校验

- 大小 92,200,960 字节
- md5 `e128b445c7ab8d3fbd35872a3a5bb055`
