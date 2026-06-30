# 番茄 IP 数据看板

这是一个数据看板，用于查看 PostgreSQL 中的番茄音乐 IP 数据。

- 第一层：按日期范围查看歌手粉丝数、粉丝增长趋势
- 第二层：点击歌手后，按日期范围查询该歌手的歌曲收藏趋势
- 支持搜索歌手、筛选风格、选择日期范围
- 支持导出为单文件本地 HTML，双击即可查看快照数据
- 实时版数据来源为 PostgreSQL，不再从飞书全量同步

## 启动方式

### 双击 HTML 快照

如果只需要查看已导出的快照数据，直接双击项目根目录里的：

```text
番茄看板.html
```

这个文件不需要启动服务，也不需要 Python / Node 运行环境。它展示的是导出时刻的数据库快照，不会自动查询最新数据。

需要更新快照时，在已经配置好数据库的电脑上执行：

```bash
npm install
npm run export:html
```

会重新生成：

```text
番茄看板.html
```

### 实时查询版

### macOS

双击：

```text
启动番茄看板.command
```

或者在终端中执行：

```bash
npm install
npm start
```

然后打开：

```text
http://127.0.0.1:5173/
```

### Windows

生产人员可以直接运行已经打包好的 exe：

```text
dist/番茄IP数据看板-2.0.0-x64.exe
```

这个 exe 已经内置运行环境和当前项目里的 `.env.local` 数据库配置，不需要生产人员安装 Node.js 或手动配置环境。

如果不使用 exe，也可以用脚本方式启动。右键项目根目录里的：

```text
启动番茄看板.ps1
```

选择：

```text
使用 PowerShell 运行
```

如果 Windows 提示禁止运行脚本，可以打开 PowerShell，进入项目目录后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\启动番茄看板.ps1
```

## 环境要求

脚本方式和重新打包需要本机有 Node.js 18 或更高版本。已经打好的 Windows exe 不需要安装 Node.js。

第一次用脚本方式启动时，脚本会自动执行 `npm install` 安装 Node 依赖；后续启动会直接打开本地服务。

## 打包 Windows exe

在已经配置好 `.env.local` 的项目目录中执行：

```bash
npm install
npm run dist:win
```

打包产物会生成在：

```text
dist/番茄IP数据看板-2.0.0-x64.exe
```

注意：当前打包配置会把 `.env.local` 一起打进 exe，方便生产人员免配置使用。这个方案适合内部分发，但数据库账号仍建议使用只读账号并限制权限。

## 数据库配置

项目根目录需要存在 `.env.local` 文件：

```text
PGHOST=10.128.1.3
PGPORT=5432
PGDATABASE=qiyin_warehouse
PGUSER=dbuser_view
PGPASSWORD=数据库密码
PGSSL=prefer
```

仓库里提供了 `.env.example` 模板。真实 `.env.local` 包含数据库密码，不会提交到 Git。

## 查询逻辑

实时查询版不再生成或读取全量 `data.json`。逻辑是：

1. 页面启动时读取数据库日期范围和风格列表
2. 按日期范围、搜索关键词、风格筛选查询歌手
3. 点击某个歌手后，再查询该歌手在当前日期范围内的歌曲快照
4. 切换日期范围时重新按条件查询数据库

后端 API 位于：

```text
mvp/server.js
```

主要接口：

```text
GET /api/meta
GET /api/singers?start=2026-06-23&end=2026-06-29&search=&style=all
GET /api/songs?singer=歌手名&start=2026-06-23&end=2026-06-29
POST /api/shutdown
```

静态 HTML 快照由下面脚本生成：

```text
mvp/scripts/export-static-html.js
```

## 项目结构

```text
mvp/
  index.html              页面入口
  app.js                  前端交互和图表逻辑
  styles.css              页面样式
  server.js               Node.js 本地 HTTP 服务和 PostgreSQL 查询接口
  scripts/
    export-static-html.js  从 PostgreSQL 导出单文件 HTML 快照

package.json              Node 依赖和启动命令
番茄看板.html              单文件 HTML 快照
启动番茄看板.ps1          Windows 启动入口
启动番茄看板.command      macOS 启动入口
使用说明.md               面向测试人员的简版说明
```

## 注意

- 不要把 `.env.local` 上传到 GitHub。
- 浏览器页面不会直接访问数据库密码；密码只由本地 Node 服务读取。
- 生产环境多人使用时，更推荐部署为公司内网 Web 服务，把数据库连接统一放在服务器端。
