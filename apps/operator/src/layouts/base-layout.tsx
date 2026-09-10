import type React from "react";
import { useTranslation } from "react-i18next";
import DragWindowRegion from "@/components/drag-window-region";

export default function BaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <>
      <DragWindowRegion title={t("appName")} />
      <main className="h-screen p-2 pb-20">{children}</main>
    </>
  );
}
