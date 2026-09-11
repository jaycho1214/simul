import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { Updater, type AutoUpdaterLike } from "./updater.ts";

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  checks = 0;
  installs = 0;
  checkForUpdates(): void {
    this.checks += 1;
  }
  quitAndInstall(): void {
    this.installs += 1;
  }
}

function make(enabled = true) {
  const au = new FakeAutoUpdater();
  const log: string[] = [];
  let booted = 0;
  const updater = new Updater({
    enabled,
    autoUpdater: au,
    boot: () => (booted += 1),
    log: (l) => log.push(l),
  });
  return { au, log, updater, booted: () => booted };
}

describe("Updater", () => {
  test("disabled: never boots, never checks, reports disabled", () => {
    const { au, updater, booted } = make(false);
    updater.start();
    updater.check();
    expect(booted()).toBe(0);
    expect(au.checks).toBe(0);
    expect(updater.state.status).toBe("disabled");
    expect(updater.install()).toBe(false);
  });

  test("start boots once and subscribes to the autoUpdater", () => {
    const { au, updater, booted } = make();
    updater.start();
    updater.start();
    expect(booted()).toBe(1);
    au.emit("checking-for-update");
    expect(updater.state.status).toBe("checking");
    au.emit("update-available");
    expect(updater.state.status).toBe("downloading");
    au.emit("update-downloaded", {}, "notes", "0.2.0", new Date(), "url");
    expect(updater.state).toEqual({ status: "ready", version: "0.2.0", message: null });
  });

  test("logs each transition with the [update] prefix, and only transitions", () => {
    const { au, updater, log } = make();
    updater.start();
    au.emit("checking-for-update");
    au.emit("update-not-available");
    au.emit("update-not-available");
    expect(log).toEqual(["[update] checking for updates", "[update] up to date"]);
  });

  test("errors carry their message", () => {
    const { au, updater } = make();
    updater.start();
    au.emit("error", new Error("getaddrinfo ENOTFOUND update.electronjs.org"));
    expect(updater.state).toEqual({
      status: "error",
      version: null,
      message: "getaddrinfo ENOTFOUND update.electronjs.org",
    });
  });

  test("check() forwards to the autoUpdater only once started", () => {
    const { au, updater } = make();
    updater.check();
    expect(au.checks).toBe(0);
    updater.start();
    updater.check();
    expect(au.checks).toBe(1);
  });

  test("install() only acts on a staged update", () => {
    const { au, updater } = make();
    updater.start();
    expect(updater.install()).toBe(false);
    expect(au.installs).toBe(0);
    au.emit("update-downloaded", {}, "", "0.2.0", new Date(), "");
    expect(updater.install()).toBe(true);
    expect(au.installs).toBe(1);
  });
});
