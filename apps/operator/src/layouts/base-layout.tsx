import type React from "react";
import { useTranslation } from "react-i18next";
import DragWindowRegion from "@/components/drag-window-region";

export default function BaseLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-screen flex-col">
      <DragWindowRegion title={t("appName")} />
      {/* The route owns scrolling, so its sticky header strip stays put. */}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
