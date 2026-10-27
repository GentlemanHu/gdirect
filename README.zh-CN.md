# gdirect · Google Drive 高性能流媒体网关与传输系统

[English](README.md) · [Releases 预编译下载](https://github.com/GentlemanHu/gdirect/releases) · [更新日志](CHANGELOG.md) · [项目说明文档](文件说明.md)

gdirect 是面向 Google 云盘（Google Drive）的高性能网络直连传输与私有流媒体网关系统。通过就近探测并绑定中国大陆可连通的 Google 官方边缘 IP（结合 SNI 伪装技术），绕过限速与阻断，让数 TB 的影视与大文件跑满本地物理带宽。

针对云盘大容量媒体播放痛点，系统深度重构了流式传输层，内嵌现代化 React 19 单页管理控制台与影院级双字幕播放器，原生支持 WebDAV 302 重定向直连与 Emby/Jellyfin `.strm` 无盘直解。

---

## 核心特性

- ⚡ **HTTP 206 Partial Content 流媒体服务**：支持随意拖拽 Seek 毫秒级跳转，精准支持 MP4 `moov` / MKV `cues` 随机索引寻道与首字节秒开。
- 💾 **零磁盘 I/O 环形内存缓冲（Zero-Disk RAM Buffer）**：8MB~512MB 纯内存弹性滑动窗口预读，告别小容量服务器的磁盘磨损与写满风险；快进时瞬间取消旧分块请求，绝无流量浪费。
- 🎬 **影院级原生播放器**：
  - **全格式双字幕渲染**：内置自研 ASS/SSA/SRT/VTT 文本与特效解析器（智能容错空字段并过滤控制符），支持主/副字幕双轨独立渲染与中英双语分行分色；
  - **内嵌字幕探测**：原生嗅探容器内嵌字幕轨，并提供一键外部硬件播放器唤醒（VLC、Infuse、IINA、MX Player、PotPlayer、VidHub）；
  - **6 档画幅比例切换**：默认最佳适配（无裁剪、黑边自适应），支持快捷键 `C` 循环切换智能铺满（去黑边）、拉伸、16:9、4:3 与 21:9；
  - **网络静默自愈与断点自动起播**：网关重启或网络瞬断 2 秒内静默自动重连原进度；记忆秒数恢复与卡顿缓冲就绪时全自动续播。
- 📁 **多协议与私有媒体库无盘挂载**：
  - **WebDAV（RFC 4918）**：支持 302 重定向模式（OpenList 首选，播放器直连网关不走 OpenList 服务器重复中转）与 206 Range 直流模式；
  - **Emby / Jellyfin `.strm` 生成器**：全盘递归扫描一键打包导出 ZIP，无需占用本地数 TB 硬盘即可实现海报刮削与原画播放。
- 🌐 **多引擎传输调度**：
  - `边缘直连 (Direct)`：国内直连 Google 边缘网络，客户端与网关均免翻墙；
  - `官方 302 (Official)`：302 跳转至 Google 官方直链（客户端自备代理），网关零带宽消耗；
  - `网关代理中继 (Proxy)`：网关通过本地代理中继数据流。
- 📦 **全平台双版本矩阵 Release**：
  - 每版均提供 **集成嵌入式 Web 前端全功能版** 与 **纯 CLI / Headless 超轻量版**；
  - 原生覆盖：Linux x86_64、macOS ARM (M系列)、macOS Intel、Windows x86_64、Android ARM64-v8a、Android ARMv7-a。

---

## 快速上手

### 1. Docker Compose 容器化一键部署（推荐）

```bash
# 下载 docker-compose.yml 并启动
curl -fsSL https://raw.githubusercontent.com/GentlemanHu/gdirect/main/docker-compose.yml -o docker-compose.yml
docker compose up -d
```
启动后访问 `http://<服务器IP>:8080` 进入 Web 管理控制台。

### 2. Android 手机 / 电视盒子 Termux 部署

在支持 Termux 的 Android 设备（ARM64 / ARMv7）上，直接下载预编译二进制执行：
```bash
# 下载最新 Android aarch64 静态单文件二进制
curl -fL https://github.com/GentlemanHu/gdirect/releases/latest/download/gdirect-0.9.0-aarch64-linux-android.tar.gz | tar -xz
chmod +x gdirect

# 启动流媒体网关服务
./gdirect serve --host 0.0.0.0 --port 8090
```

### 3. 主机独立运行（Linux / macOS / Windows）

直接从 [GitHub Releases](https://github.com/GentlemanHu/gdirect/releases) 下载对应平台的打包文件，或一键运行：
```bash
# 启动流媒体网关及管理面板（默认 8080 端口）
./gdirect serve --port 8080

# 携带 Master API Key 进行全局访问鉴权
./gdirect serve --port 8080 --api-key my-secure-token
```

---

## 客户端与媒体库接入

### 1. OpenList 挂载配置 (WebDAV 302 零中转)
- **驱动类型**：`WebDAV`
- **WebDAV 地址**：`http://<网关IP>:<端口>/webdav/`
- **Web 代理开关**：**必须关闭**（关闭后 OpenList 触发 302 客户端直连机制，避免流量在 OpenList 服务器重复中转）
- **账号/密码**：若网关未设置 `--api-key`，任意输入即可。

### 2. Emby / Jellyfin 媒体库无盘直刮 (.strm)
1. 访问 gdirect 控制台进入【协议接入】&rarr;【Emby / Jellyfin】；
2. 输入影视根目录 ID（默认 `root`）与网关公网访问基地址，点击下载 `.strm` ZIP 媒体压缩包；
3. 解压到 Emby 媒体目录，在 Emby 后台添加媒体库并开启“Direct Play 原画直解”，实现 5TB 影视无盘海报墙。

### 3. 第三方播放器一键唤醒
在 Web 播放器右上角或底部控制栏，点击【外部播放器】，支持一键唤起：
- **iOS / macOS**：Infuse (`infuse://`)、IINA (`iina://`)、VLC (`vlc://`)
- **Android**：MX Player (`intent://`)、nPlayer (`nplayer-http://`)
- **Windows**：PotPlayer (`potplayer://`)、VLC

---

## 工作原理与安全架构

| 流量类型 | 调度通道 | 安全与说明 |
| --- | --- | --- |
| **视频流 / 下载 / 上传 / 令牌刷新** (`serve`、`browse`、`download`、`upload`) | 直连扫描优选的 Google 边缘 IP | 端到端 TLS 加密，内置 Google GTS 根证书强制比对校验。遭遇 SNI 阻断时自动改用伪造身份 (`g.cn` TLS 握手，Host 保持真实主机)。完全不消耗梯子流量。 |
| **OAuth 授权登录** (`accounts.google.com`、`oauth2.googleapis.com`) | 系统网络（系统 DNS / 代理） | 仅在初次授权时交互数 KB 数据。支持在电脑端完成授权后，将 `authorized_user` JSON 一键粘贴至 Web 控制台导入。 |
| **文件系统挂载** (`gdirect mount`) | 系统网络 (rclone FUSE) | 传统本地虚拟磁盘挂载接口。 |

> **注意**：如果本地开启了全局 TUN 模式代理（如 Clash TUN），请确保将 Google 直连 IP 设为 **DIRECT**，避免真实链路测速失真。

---

## 编译与构建

### 1. 前端构建
```bash
cd web
npm install
npm run build
```

### 2. 后端构建
```bash
# 构建全功能版（集成 Web 控制台）
cargo build --release

# 构建纯 CLI / Headless 版（无前端，体积超小）
cargo build --release --no-default-features
```

### 3. 交叉编译 Android NDK
通过 `.cargo/config.toml` 配置 NDK 路径后：
```bash
cargo ndk --target aarch64-linux-android --platform 24 build --release --bin gdirect
```

---

## 开源协议

本项目采用 [GPL-2.0-or-later](LICENSE) 开源许可证。
