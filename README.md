# 番茄 IP 数据看板

番茄 IP 数据看板是一个本地运行的数据分析看板，用于查询 PostgreSQL 中的番茄音乐歌手和歌曲采集数据。

当前项目是 **Node.js 实时查询版**：浏览器页面访问本机 Node 服务，Node 服务再读取 PostgreSQL。项目也保留了单文件 HTML 快照导出能力，以及 Electron Windows 便携版打包配置。

## 功能概览

- 第一层按日期区间展示歌手粉丝趋势、粉丝净增、歌曲快照数和最新收藏合计。
- 支持按歌手名搜索、按风格筛选、调整趋势日期区间。
- 点击歌手进入第二层，查看该歌手的歌曲收藏趋势、歌曲快照列表和单曲折线图。
- 支持实时查询 PostgreSQL，也支持导出一个离线可打开的 `番茄看板.html` 快照。
- 支持通过 Electron 打包为 Windows portable exe，供没有 Node.js 环境的电脑使用。

## 项目结构

```text
.
├── electron/
│   └── main.js                  Electron 入口，启动本地服务并打开窗口
├── mvp/
│   ├── index.html               看板页面入口
│   ├── app.js                   前端交互、筛选、图表和 API 调用逻辑
│   ├── styles.css               页面样式
│   ├── server.js                Node HTTP 服务和 PostgreSQL 查询接口
│   └── scripts/
│       └── export-static-html.js 从 PostgreSQL 导出单文件 HTML 快照
├── package.json                 npm 脚本、依赖和 Electron Builder 配置
├── package-lock.json            依赖锁定文件
├── 启动番茄看板.command          macOS 双击启动脚本
├── 启动番茄看板.ps1             Windows PowerShell 启动脚本
└── 使用说明.md                  面向使用人员的简版说明
```

以下内容不会提交到仓库：

```text
.env.local       本地数据库账号和密码
node_modules/    npm 依赖目录
dist/            Electron 打包产物
番茄看板.html     导出的本地 HTML 快照
```

## 环境要求

- Node.js 18 或更高版本
- npm
- 可访问目标 PostgreSQL 数据库

如果使用已经打包好的 Windows exe，则使用电脑不需要安装 Node.js；但重新打包 exe 的电脑仍需要 Node.js 和 npm。

## 数据库配置

在项目根目录创建 `.env.local`：

```text
PGHOST=10.128.1.3
PGPORT=5432
PGDATABASE=qiyin_warehouse
PGUSER=dbuser_view
PGPASSWORD=数据库密码
PGSSL=prefer
```

也兼容以下变量名：

```text
DB_HOST
DB_PORT
DB_NAME
DB_USER
DB_PASSWORD
DB_SSL
```

`.env.local` 包含数据库密码，不要提交到 GitHub。建议数据库账号使用只读权限。

## 启动实时查询版

安装依赖：

```bash
npm install
```

启动本地服务：

```bash
npm start
```

默认访问地址：

```text
http://127.0.0.1:5173/
```

也可以指定端口：

```bash
PORT=5180 npm start
```

### macOS 双击启动

双击项目根目录的：

```text
启动番茄看板.command
```

脚本会检查 Node.js、`.env.local`、依赖目录，并在 `5173-5189` 中选择一个可用端口后自动打开浏览器。

### Windows 双击启动

右键项目根目录的：

```text
启动番茄看板.ps1
```

选择“使用 PowerShell 运行”。如果系统禁止执行脚本，可以在 PowerShell 中进入项目目录后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\启动番茄看板.ps1
```

Windows 脚本同样会检查 Node.js、`.env.local`、依赖目录，并自动打开浏览器。

## 导出离线 HTML 快照

在已经配置好 `.env.local` 的电脑上执行：

```bash
npm run export:html
```

脚本会查询 PostgreSQL，把当前数据库数据、页面、样式和前端脚本合并生成：

```text
番茄看板.html
```

这个文件是导出时刻的静态快照，可以双击打开，不需要启动 Node 服务，也不会继续查询数据库。

## Electron 桌面版

开发时可以运行：

```bash
npm run electron
```

Electron 会启动本地 Node 服务，并打开桌面窗口加载看板页面。

## 打包 Windows exe

在已经配置好 `.env.local` 的项目目录执行：

```bash
npm install
npm run dist:win
```

打包产物会生成到 `dist/`，文件名类似：

```text
dist/番茄IP数据看板-2.0.0-x64.exe
```

当前 `package.json` 的 Electron Builder 配置会把 `.env.local` 打进 exe，方便内部电脑免配置使用。这个方式适合内部分发，但请务必使用只读数据库账号，并控制 exe 的分发范围。

## npm 脚本

```text
npm start        启动 Node 本地服务
npm run export:html
                 导出单文件 HTML 快照
npm run electron 启动 Electron 桌面窗口
npm run dist:win 打包 Windows portable exe
```

## 后端接口

后端接口位于 `mvp/server.js`，当前提供：

```text
GET  /api/meta
GET  /api/singers?start=2026-06-23&end=2026-06-29&search=&style=all
GET  /api/songs?singer=歌手名&start=2026-06-23&end=2026-06-29&search=
POST /api/shutdown
```

接口读取的主要数据表：

```text
ods.ods_scrap_fanqie_singers_df
ods.ods_scrap_fanqie_song_list_df
```

## 注意事项

- 不要提交 `.env.local`、`dist/`、`node_modules/` 或导出的 `番茄看板.html`。
- 浏览器页面不会直接读取数据库密码，密码只由本地 Node 服务读取。
- 实时查询版依赖数据库连接；如果数据库不可达，页面会显示查询失败。
- 多人长期使用时，更推荐部署成公司内网 Web 服务，把数据库连接统一放在服务端管理。
