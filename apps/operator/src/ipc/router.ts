import { app } from "./app";
import * as network from "./network/index.ts";
import * as server from "./server/index.ts";
import * as settings from "./settings/index.ts";
import { theme } from "./theme";
import * as updates from "./updates/index.ts";
import { window } from "./window";

export const router = {
  app,
  theme,
  window,
  server,
  network,
  settings,
  updates,
};

export type Router = typeof router;
