import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { syncWithLocalTheme } from "./actions/theme";
import { ipc } from "./ipc/manager.ts";
import { applyUiLanguage } from "./localization/i18n";
import { resolveUiLanguage, type UiLanguage } from "./settings/ui-language.ts";
import { router } from "./utils/routes";

// One per window, like captureController: every panel's useQuery/useQueryClient
// call needs a provider somewhere above it in the tree, and this app only ever
// renders one window.
const queryClient = new QueryClient();

/** If the settings bridge has not answered by now, the OS language wins. */
const LANGUAGE_BOOT_TIMEOUT_MS = 1500;

/**
 * Resolves the window's language before anything is painted, so an English
 * machine with a saved Korean choice (or the reverse) never flashes the wrong
 * one. The window's own backgroundColor covers the gap. A bridge that never
 * answers must not leave a black window, hence the timeout and the catch.
 */
function useUiLanguageBoot(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let settled = false;
    const finish = (lang: UiLanguage) => {
      if (settled) return;
      settled = true;
      void applyUiLanguage(lang).finally(() => setReady(true));
    };
    const osDefault = () => resolveUiLanguage(null, navigator.language);
    const fallback = setTimeout(() => finish(osDefault()), LANGUAGE_BOOT_TIMEOUT_MS);

    ipc.client.settings.get().then(
      (settings) => finish(resolveUiLanguage(settings.uiLanguage, navigator.language)),
      () => finish(osDefault()),
    );

    return () => clearTimeout(fallback);
  }, []);

  return ready;
}

export default function App() {
  const ready = useUiLanguageBoot();

  useEffect(() => {
    syncWithLocalTheme();
  }, []);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const container = document.getElementById("app");
if (!container) {
  throw new Error('Root element with id "app" not found');
}
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
