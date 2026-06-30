$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$EnvFile = Join-Path $Root ".env.local"
$EnvExample = Join-Path $Root ".env.example"
$ServerFile = Join-Path $Root "mvp/server.js"

function Write-Info($Message) {
  Write-Host "[番茄看板] $Message"
}

function Get-CommandPath($Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) {
    return $null
  }
  return $cmd.Source
}

function Test-PortAvailable($Port) {
  $listener = $null
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    if ($null -ne $listener) {
      $listener.Stop()
    }
  }
}

function Get-FreePort {
  foreach ($port in 5173..5189) {
    if (Test-PortAvailable $port) {
      return $port
    }
  }
  return $null
}

function Ensure-EnvFile {
  if (Test-Path $EnvFile) {
    return $true
  }

  if (Test-Path $EnvExample) {
    Copy-Item $EnvExample $EnvFile
    Write-Info "没有找到 .env.local，已创建数据库配置模板。请填写 PGPASSWORD 后重新运行。"
    Start-Process notepad.exe $EnvFile
    return $false
  }

  Write-Info "缺少 .env.local 和 .env.example，无法读取数据库配置。"
  return $false
}

function Test-EnvReady {
  if (!(Test-Path $EnvFile)) {
    return $false
  }

  $content = Get-Content $EnvFile -Raw -Encoding UTF8
  $required = @("PGHOST=", "PGPORT=", "PGDATABASE=", "PGUSER=", "PGPASSWORD=")
  foreach ($item in $required) {
    if (!$content.Contains($item)) {
      return $false
    }
  }

  if ($content.Contains("your_database_password")) {
    return $false
  }

  return $true
}

Write-Info "准备启动本地服务..."

$node = Get-CommandPath "node"
$npm = Get-CommandPath "npm"

if ($null -eq $node -or $null -eq $npm) {
  Write-Info "没有找到 Node.js / npm。"
  Write-Host ""
  Write-Host "请先安装 Node.js 18 或更高版本。"
  Write-Host "下载地址：https://nodejs.org/"
  Write-Host ""
  Read-Host "按 Enter 关闭"
  exit 1
}

if (!(Test-Path $ServerFile)) {
  Write-Info "找不到服务文件：$ServerFile"
  Read-Host "按 Enter 关闭"
  exit 1
}

if (!(Ensure-EnvFile)) {
  Read-Host "按 Enter 关闭"
  exit 1
}

if (!(Test-EnvReady)) {
  Write-Info ".env.local 里的数据库配置还没有填写完整。"
  Start-Process notepad.exe $EnvFile
  Read-Host "填写完成后重新运行。按 Enter 关闭"
  exit 1
}

if (!(Test-Path (Join-Path $Root "node_modules"))) {
  Write-Info "第一次启动，正在安装 Node 依赖..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Info "依赖安装失败，请检查网络或 npm 配置。"
    Read-Host "按 Enter 关闭"
    exit 1
  }
}

$port = Get-FreePort
if ($null -eq $port) {
  Write-Info "5173-5189 端口都被占用了，请关闭其他本地服务后再试。"
  Read-Host "按 Enter 关闭"
  exit 1
}

$url = "http://127.0.0.1:$port/"

Write-Info "Node：$(& node --version)"
Write-Info "启动地址：$url"

$env:PORT = "$port"
$process = Start-Process `
  -FilePath $node `
  -ArgumentList @("`"$ServerFile`"") `
  -WorkingDirectory $Root `
  -WindowStyle Minimized `
  -PassThru

Start-Sleep -Seconds 1
Start-Process $url

Write-Host ""
Write-Host "看板已启动。"
Write-Host "如果浏览器没有自动打开，请手动访问：$url"
Write-Host "页面会直接查询 PostgreSQL 数据库，不再同步飞书。"
Write-Host "测试结束后，可以点击网页右上角「关闭服务」。"
Write-Host ""
Write-Host "本窗口可以关闭；本地服务会继续运行，直到在网页中关闭。"
Write-Host ""
Read-Host "按 Enter 关闭此窗口"
