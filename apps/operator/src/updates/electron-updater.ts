import { EventEmitter } from "node:events";
import { app, autoUpdater } from "electron";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { Updater, type AutoUpdaterLike } from "./updater.ts";

export const UPDATE_REPO = "jaycho1214/simul";

/**
 * Development stand-in: SIMUL_FAKE_UPDATE=1 pnpm start walks the real event
 * sequence on a timer so the toast and the footer can be seen without a
 * Windows machine and two published releases. Never active when packaged.
 */
class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  checkForUpdates(): void {
    this.emit("checking-for-update");
    setTimeout(() => this.emit("update-available"), 1000);
    setTimeout(() => this.emit("update-downloaded", {}, "", "9.9.9", new Date(), ""), 4000);
  }
  quitAndInstall(): void {
    app.relaunch();
    app.quit();
  }
}

/**
 * update.electronjs.org in front of the public repo's GitHub Releases, which
 * is where the release workflow puts Squirrel's RELEASES + nupkg. Only ever
 * enabled for the platform we actually publish for. notifyUser is off: the
 * default is a modal dialog the moment a download finishes, and this window
 * is open during services — the renderer shows a toast instead.
 */
export function createElectronUpdater(log: (line: string) => void): Updater {
  if (!app.isPackaged && process.env.SIMUL_FAKE_UPDATE === "1") {
    const fake = new FakeAutoUpdater();
    return new Updater({
      enabled: true,
      autoUpdater: fake,
      boot: () => fake.checkForUpdates(),
      log,
    });
  }

  const say = (...args: unknown[]) => log(`[update] ${args.map(String).join(" ")}`);
  return new Updater({
    enabled: app.isPackaged && process.platform === "win32",
    autoUpdater,
    boot: () =>
      updateElectronApp({
        updateSource: { type: UpdateSourceType.ElectronPublicUpdateService, repo: UPDATE_REPO },
        updateInterval: "1 hour",
        notifyUser: false,
        logger: { log: say, info: say, warn: say, error: say },
      }),
    log,
  });
}
