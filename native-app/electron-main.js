const http = require("node:http");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");

const APP_NAME = "PAOFI LP Database";
const DATA_FOLDER_NAME = "PAOFI-LP-Database-Data";
const PREFERRED_PORT = 3417;

let mainWindow = null;
let serverProcess = null;
let appBaseUrl = "";

function dataRoot() {
  const base = process.env.LOCALAPPDATA || app.getPath("userData");
  return path.join(base, DATA_FOLDER_NAME);
}

function appRoot() {
  return app.getAppPath();
}

function bundledNodePath() {
  const packagedNode = path.join(process.resourcesPath, "runtime", "node.exe");
  if (app.isPackaged) return packagedNode;

  const localNode = path.join(__dirname, "runtime", "node.exe");
  if (process.env.NODE_EXE) return process.env.NODE_EXE;
  return fs.existsSync(localNode) ? localNode : "node.exe";
}

function canListen(port) {
  return new Promise(resolve => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function availablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 40; port += 1) {
    if (await canListen(port)) return port;
  }

  throw new Error("Could not find an available local port for the application backend.");
}

function requestStats(baseUrl) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}api/stats`, response => {
      response.resume();
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Backend returned HTTP ${response.statusCode}.`));
        }
      });
    });

    request.setTimeout(700, () => {
      request.destroy(new Error("Backend startup timed out."));
    });
    request.on("error", reject);
  });
}

async function waitForBackend(baseUrl) {
  let lastError = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await requestStats(baseUrl);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  throw lastError || new Error("Backend did not start.");
}

async function startBackend() {
  const port = await availablePort(PREFERRED_PORT);
  const serverFile = path.join(appRoot(), "server.js");
  const nodeExe = bundledNodePath();
  const localDataRoot = dataRoot();
  appBaseUrl = `http://127.0.0.1:${port}/`;

  serverProcess = spawn(nodeExe, [serverFile, "--no-open"], {
    cwd: appRoot(),
    env: {
      ...process.env,
      LPDB_DB_PATH: path.join(localDataRoot, "lp_database.sqlite"),
      NO_OPEN: "1",
      PORT: String(port)
    },
    stdio: "ignore",
    windowsHide: true
  });

  serverProcess.once("exit", code => {
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox(APP_NAME, "The application backend stopped unexpectedly.");
    }
  });

  await waitForBackend(appBaseUrl);
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: APP_NAME,
    backgroundColor: "#f6f8f5",
    autoHideMenuBar: true,
    icon: path.join(appRoot(), "public", "assets", "paofi-logo.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appBaseUrl)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadURL(appBaseUrl);
}

function stopBackend() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  serverProcess = null;
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady()
    .then(startBackend)
    .then(createWindow)
    .catch(error => {
      dialog.showErrorBox(APP_NAME, error.message || String(error));
      app.quit();
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appBaseUrl) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", stopBackend);
}
