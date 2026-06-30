#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR" || exit 1

NODE_BIN="$(command -v node || true)"
NPM_BIN="$(command -v npm || true)"

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "没有找到 Node.js / npm，请先安装 Node.js 18 或更高版本。"
  echo "下载地址：https://nodejs.org/"
  echo
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if [[ ! -f ".env.local" ]]; then
  if [[ -f ".env.example" ]]; then
    cp ".env.example" ".env.local"
  fi
  echo "没有找到 .env.local，已为你创建数据库配置文件。"
  echo "请填写 PGPASSWORD 后再重新双击启动。"
  open -a TextEdit ".env.local" 2>/dev/null || true
  echo
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if ! grep -Eq "^PGHOST=" ".env.local" || \
   ! grep -Eq "^PGPORT=" ".env.local" || \
   ! grep -Eq "^PGDATABASE=" ".env.local" || \
   ! grep -Eq "^PGUSER=" ".env.local" || \
   ! grep -Eq "^PGPASSWORD=" ".env.local" || \
   grep -Eq "your_database_password" ".env.local"; then
  echo ".env.local 里的数据库配置还没有填写完整。"
  echo "请填写 PGHOST、PGPORT、PGDATABASE、PGUSER、PGPASSWORD 后再重新双击启动。"
  open -a TextEdit ".env.local" 2>/dev/null || true
  echo
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "第一次启动，正在安装 Node 依赖..."
  "$NPM_BIN" install
  if [[ "$?" != "0" ]]; then
    echo "依赖安装失败，请检查网络或 npm 配置。"
    echo
    echo "按任意键关闭窗口。"
    read -k 1
    exit 1
  fi
fi

PORT="$("$NODE_BIN" - <<'JS'
const net = require("node:net");

async function canUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

(async () => {
  for (let port = 5173; port < 5190; port += 1) {
    if (await canUse(port)) {
      console.log(port);
      process.exit(0);
    }
  }
  console.log(0);
})();
JS
)"

if [[ "$PORT" == "0" ]]; then
  echo "5173-5189 端口都被占用了，请关闭其他本地服务后再试。"
  echo
  echo "按任意键关闭窗口。"
  read -k 1
  exit 1
fi

URL="http://127.0.0.1:${PORT}/"
echo "番茄 IP 数据看板正在启动..."
echo "访问地址：${URL}"
echo
echo "提示：这个窗口需要保持打开；关闭窗口后看板服务也会停止。"
echo "页面会直接查询 PostgreSQL 数据库，不再同步飞书。"
echo

(sleep 1 && open "$URL") &
PORT="$PORT" "$NPM_BIN" start
