import { os } from "@orpc/server";
import { dialog } from "electron";
import { mainStrings } from "../../localization/main-strings.ts";
import { allowCloseWithoutPrompt, supervisor, updater } from "../../main.ts";
import { uiLanguageForMain } from "../../settings/store.ts";
import type { UpdateState } from "../../updates/update-state.ts";
import { ipcContext } from "../context.ts";

/** Polled by the renderer every 5 s, like the server status. */
export const state = os.handler((): UpdateState => updater.state);

export const check = os.handler((): UpdateState => {
  updater.check();
  return updater.state;
});

/**
 * Restart into the staged version. Quitting a live server cuts every phone
 * in the room, so this asks the same question closing the window does — and
 * having asked, tells the close handler not to ask again on the way out.
 * Returns false when nothing is staged or the engineer cancelled.
 */
export const install = os.handler(async (): Promise<boolean> => {
  if (updater.state.status !== "ready") return false;

  if (supervisor.status.state === "listening") {
    const s = mainStrings(uiLanguageForMain());
    const options = {
      type: "warning" as const,
      buttons: [s.cancel, s.restartToUpdate],
      defaultId: 0,
      cancelId: 0,
      title: s.quitTitle,
      message: s.quitMessage,
      detail: s.quitDetail,
    };
    const window = ipcContext.mainWindow;
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response !== 1) return false;
  }

  allowCloseWithoutPrompt();
  return updater.install();
});
