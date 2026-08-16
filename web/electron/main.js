import { app, BrowserWindow, dialog, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";

const applicationDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const staticDirectory = path.join(applicationDirectory, "dist");

let apiServer;
let dataStore;
let mainWindow;

// Keep every renderer sandboxed even if a future window is added without an
// explicit webPreferences block. The desktop app has no renderer-to-Node
// bridge; all durable data stays behind its loopback API.
app.enableSandbox();

function listen(expressApp) {
  return new Promise((resolve, reject) => {
    const server = expressApp.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

async function startDesktopApp() {
  // A desktop install should not silently use a remote DATABASE_URL inherited
  // from a developer's shell. Its script library belongs in the user's local
  // application-data directory and survives app restarts.
  const libraryPath = path.join(app.getPath("userData"), "library.json");
  dataStore = await createStore({ databaseUrl: null, dataFile: libraryPath });
  const expressApp = createApp({ store: dataStore, staticDir: staticDirectory });
  apiServer = await listen(expressApp);
  const address = apiServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  if (!port) throw new Error("AutoTyper Desktop could not reserve a local application port.");

  const desktopUrl = `http://127.0.0.1:${port}/`;
  mainWindow = new BrowserWindow({
    title: "Auto Typer",
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#e7eaee",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== desktopUrl) event.preventDefault();
  });
  await mainWindow.loadURL(desktopUrl);
}

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null);
    app.setAppUserModelId("com.pulkitsu.autotyper.desktop");
    await startDesktopApp();
  } catch (error) {
    dialog.showErrorBox(
      "AutoTyper Desktop could not start",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  apiServer?.close();
  void dataStore?.close();
});
