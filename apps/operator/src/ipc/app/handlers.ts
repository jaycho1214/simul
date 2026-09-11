import { os } from "@orpc/server";
import { app, shell } from "electron";
import { AI_STUDIO_USAGE_URL } from "../../admin/usage-cost.ts";

export const currentPlatfom = os.handler(() => process.platform);

export const appVersion = os.handler(() => app.getVersion());

/**
 * Opens Google's own usage dashboard in the default browser. A fixed URL
 * rather than one the renderer passes: the only page this app has any reason
 * to open is the one that shows the real bill.
 */
export const openUsageDashboard = os.handler(async () => {
  await shell.openExternal(AI_STUDIO_USAGE_URL);
});
