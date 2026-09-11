import path from "node:path";
import { app, BrowserWindow, dialog, session, systemPreferences } from "electron";
import { ipcMain } from "electron/main";
import { installExtension, REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";
import squirrelStartup from "electron-squirrel-startup";
import { ipcContext } from "@/ipc/context";
import { ServerSupervisor, electronForkFn } from "@/server-host/server-supervisor";
import { IPC_CHANNELS, inDevelopment } from "./constants";
import { serverEnv } from "./settings/schema.ts";
import { mainStrings } from "./localization/main-strings.ts";
import { getSettings, uiLanguageForMain } from "./settings/store.ts";
import { getBasePath, resolveWebRoot } from "./utils/path";
import { createElectronUpdater } from "./updates/electron-updater.ts";

// Squirrel launches this same executable with --squirrel-install,
// --squirrel-updated etc. during install/update/uninstall, each time as a
// real app relaunch. Without this guard every one of those relaunches would
// fall through to app.whenReady() below and flash a full window (and fork a
// second server) at whoever is standing at the venue laptop during an
// install or an auto-update. app.quit() here runs before the app is ready,
// which is what stops "ready" from ever firing for this launch.
if (squirrelStartup) {
  app.quit();
}

const externalServer =
  process.argv.includes("--external-server") || process.env.SIMUL_EXTERNAL_SERVER === "1";

// Both in development and in a packaged app the bundle sits beside main.js.
const serverEntryPath = path.join(getBasePath(), "server-entry.js");

// apps/server defaults WEB_ROOT from import.meta.url, which only means
// anything as an ES module — Forge's Vite plugin bundles server-entry.js to
// CommonJS, where that default throws instead of quietly picking a wrong
// path (see forge.config.ts's extraResource comment). Passed explicitly here
// so that default is never reached; process.env.WEB_ROOT still wins when a
// developer sets one (e.g. scripts/start.sh's standalone-server flow), same
// as apps/server's own `??` treats an explicit empty string as "disabled"
// rather than "unset".
const webRoot = resolveWebRoot(getBasePath(), app.isPackaged, process.resourcesPath);

export const supervisor = new ServerSupervisor({
  entryPath: serverEntryPath,
  // Evaluated on every spawn, so a key saved in 제어 is picked up by the next
  // 서버 재시작 without reconstructing the supervisor. The settings store is the
  // only source of the event's configuration: serverEnv() drops every server
  // variable the shell or a .env file may carry before laying the settings on.
  env: () => ({
    ...serverEnv(process.env, getSettings()),
    WEB_ROOT: process.env.WEB_ROOT ?? webRoot,
  }),
  external: externalServer,
  fork: electronForkFn(),
});

// Transitions land in the server log: the one place an engineer can read
// anything on a packaged app. Started after the window exists (below).
export const updater = createElectronUpdater((line) => supervisor.note(line));

// The close handler in createWindow() asks before quitting a live server. A
// restart the engineer has already confirmed (updates.install) sets this so
// the same question is not asked twice.
let closeConfirmed = false;
export function allowCloseWithoutPrompt(): void {
  closeConfirmed = true;
}

function createWindow() {
  const basePath = getBasePath();
  const preload = path.join(basePath, "preload.js");
  const mainWindow = new BrowserWindow({
    // Six panels at a glance, no scrolling, on any laptop from 13" up. The
    // Forge template's 800×600 fit only the first two (pre-event checklist
    // U1). Painted in the app's own dark before the renderer loads, so the
    // first frame is not a white flash in a dark room.
    height: 820,
    minHeight: 680,
    minWidth: 960,
    backgroundColor: "#17191e",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    trafficLightPosition: process.platform === "darwin" ? { x: 5, y: 5 } : undefined,
    webPreferences: {
      contextIsolation: true,
      devTools: inDevelopment,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: false,

      preload,
    },
    width: 1200,
  });
  ipcContext.setMainWindow(mainWindow);

  // Closing the window quits the app (see "window-all-closed" below), and
  // quitting stops translation for everyone in the room — so ask first, but
  // only when there is actually something to lose. During setup, or after the
  // server has already stopped, closing is just closing and a prompt would be
  // noise. `showMessageBoxSync` blocks the main process, which is what we want
  // here: the close cannot proceed until the engineer has answered.
  mainWindow.on("close", (event) => {
    if (closeConfirmed || supervisor.status.state !== "listening") return;

    event.preventDefault();
    const s = mainStrings(uiLanguageForMain());
    const quit =
      dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        buttons: [s.cancel, s.quit],
        defaultId: 0,
        cancelId: 0,
        title: s.quitTitle,
        message: s.quitMessage,
        detail: s.quitDetail,
      }) === 1;

    if (quit) {
      // Re-entrant: this same handler runs again for the close below, and the
      // flag is what lets it through instead of asking a second time.
      closeConfirmed = true;
      mainWindow.close();
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(basePath, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
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
    // First check now, then hourly. update-electron-app disables itself when
    // not packaged; createElectronUpdater also limits it to win32.
    updater.start();
    await installExtensions();
    await setupORPC();
  } catch (error) {
    console.error("Error during app initialization:", error);
  }
});

// Deliberately not the macOS convention of staying resident with no windows.
// This app is a piece of event equipment, not a document editor: an operator
// who closes the window means "stop", and a headless Electron process still
// holding port 8080 and a billing Gemini session is exactly the state that
// breaks the next launch with EADDRINUSE. The close handler in createWindow()
// is what makes sure this is never an accident.
app.on("window-all-closed", () => {
  app.quit();
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
