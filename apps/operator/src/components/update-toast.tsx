import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useUpdateState } from "../hooks/use-update-state.ts";
import { ipc } from "../ipc/manager.ts";
import { nextAnnouncement } from "../updates/announce.ts";

export const UPDATE_TOAST_ID = "update-ready";

/**
 * Renders nothing; raises the toast once per staged version. Persistent
 * (duration Infinity) and non-modal: the engineer restarts when the room
 * allows, or dismisses — Squirrel applies the staged version at the next
 * launch anyway, and the rail footer keeps a restart link meanwhile.
 */
export function UpdateToast() {
  const { t } = useTranslation();
  const state = useUpdateState();
  const announced = useRef<string | null>(null);
  const status = state?.status;
  const version = state?.version ?? null;

  useEffect(() => {
    if (!status) return;
    const next = nextAnnouncement({ status, version, message: null }, announced.current);
    if (!next) return;
    announced.current = next;
    toast(t("update.ready", { version: next }), {
      id: UPDATE_TOAST_ID,
      duration: Infinity,
      description: t("update.readyHint"),
      action: {
        label: t("update.restart"),
        onClick: () => void ipc.client.updates.install(),
      },
    });
  }, [status, version, t]);

  return null;
}
