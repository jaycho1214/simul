import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({ component: OperatorWindow });

function OperatorWindow() {
  const { t } = useTranslation();
  return (
    <main className="grid h-full grid-cols-2 gap-4 overflow-auto p-4">
      <h1 className="col-span-2 text-2xl font-semibold">{t("appName")}</h1>
    </main>
  );
}
