import path from "node:path";
import { app, BrowserWindow, session, systemPreferences } from "electron";
import { ipcMain } from "electron/main";
import {
  installExtension,
  REACT_DEVELOPER_TOOLS,
} from "electron-devtools-installer";
import { ipcContext } from "@/ipc/context";
import { ServerSupervisor, electronForkFn } from "@/server-host/server-supervisor";
import { IPC_CHANNELS, inDevelopment } from "./constants";
import { getBasePath } from "./utils/path";

const externalServer =
  process.argv.includes("--external-server") ||
  process.env.TONGYEOK_EXTERNAL_SERVER === "1";

// Both in development and in a packaged app the bundle sits beside main.js.
const serverEntryPath = path.join(getBasePath(), "server-entry.js");

export const supervisor = new ServerSupervisor({
  entryPath: serverEntryPath,
  // Task 9 replaces this stub with the real electron-store read. It stays a
  // function so every spawn picks up settings (e.g. a freshly pasted Gemini
  // API key) as they are at fork time, not as they were when the app booted.
  env: () => ({ PORT: "8080" }),
  external: externalServer,
  fork: electronForkFn(),
});

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.js");
  const mainWindow = new BrowserWindow({
    height: 600,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition:
      process.platform === "darwin" ? { x: 5, y: 5 } : undefined,
    webPreferences: {
      contextIsolation: true,
      devTools: inDevelopment,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,

      preload,
    },
    width: 800,
  });
  ipcContext.setMainWindow(mainWindow);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
}

async function installExtensions() {
  try {
    const result = await installExtension(REACT_DEVELOPER_TOOLS);
    console.log(`Extensions installed successfully: ${result.name}`);
  } catch {
    console.error("Failed to install extensions");
  }
}

async function setupORPC() {
  const { rpcHandler } = await import("./ipc/handler");

  ipcMain.on(IPC_CHANNELS.START_ORPC_SERVER, (event) => {
    const [serverPort] = event.ports;
    if (!serverPort) {
      return;
    }

    serverPort.start();
    rpcHandler.upgrade(serverPort);
  });
}

app.whenReady().then(async () => {
  try {
    // The operator app only ever asks for the microphone. Everything else is
    // denied. Electron refuses getUserMedia outright unless this handler
    // explicitly allows it, independent of the OS-level TCC prompt below.
    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "media");
    });

    if (process.platform === "darwin") {
      // Returns the cached answer if the user already decided; the dialog
      // only appears once. Requires NSMicrophoneUsageDescription (Task 11).
      void systemPreferences.askForMediaAccess("microphone");
    }

    // Fork before the window opens. The renderer's /ingest and /admin
    // sockets both reconnect on their own, so a server that is still binding
    // when the window appears is not a problem — but a server nobody ever
    // started is. utilityProcess.fork can only be called after this "ready"
    // handler runs, which is why this lives here rather than at module load.
    supervisor.start();

    createWindow();
    await installExtensions();
    await setupORPC();
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

//osX only
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
//osX only ends

let quitting = false;

app.on("will-quit", (event) => {
  // will-quit fires once per quit attempt; without the guard, app.exit(0)
  // below would itself trigger another will-quit and recurse.
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Graceful, not a kill: stop() posts { type: "shutdown" }, which the entry
  // turns into server.close(), which closes every lane's LaneOpusEncoder and
  // is itself bounded-time even with phones still connected. Skipping this
  // and letting Electron kill the utility process outright would orphan a
  // process holding port 8080, breaking the *next* launch with EADDRINUSE.
  void supervisor.stop().then(() => app.exit(0));
});
