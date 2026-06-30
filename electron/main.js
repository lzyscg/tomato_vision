import { app, BrowserWindow, Menu, dialog } from "electron";
import { startServer, stopDatabasePool } from "../mvp/server.js";

let mainWindow = null;
let dashboardServer = null;

async function createWindow() {
  Menu.setApplicationMenu(null);

  const serverInfo = await startServer({ port: 0 });
  dashboardServer = serverInfo.server;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: "番茄 IP 数据看板",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(serverInfo.url);
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error(error);
    dialog.showErrorBox("番茄看板启动失败", error.message || String(error));
    app.quit();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", async () => {
  if (dashboardServer) {
    dashboardServer.close();
    dashboardServer = null;
  }
  await stopDatabasePool().catch(() => {});
});
