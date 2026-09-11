/* Temporary design harness. Not shipped, not tested, deleted after review. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Brand } from "./config.ts";
import { languageRows } from "./languages.ts";
import { LanguagePicker } from "./components/LanguagePicker.tsx";
import { ListenScreen } from "./components/ListenScreen.tsx";
import { useBrand } from "./use-brand.ts";
import { VariantB, VariantC } from "./preview-variants.tsx";
import "./styles.css";

const q = new URLSearchParams(location.search);
const branded = q.get("b") === "1";
const theme = (q.get("t") ?? "dark") as Brand["theme"];

const LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><circle cx="14" cy="14" r="13" fill="none" stroke="#e8b64c" stroke-width="2"/><path d="M9 18V10l5 5 5-5v8" fill="none" stroke="#e8b64c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

const brand: Brand = branded
  ? { name: "새문안 주일예배", accent: "#e8b64c", logoUrl: LOGO, theme }
  : { name: null, accent: "#3e8fd0", logoUrl: null, theme };

const rows = languageRows({
  offeredLanguages: ["ko", "en", "es", "ja", "zh", "vi"],
  passthroughLanguage: "original",
});

const lines = [
  "Good morning, and welcome to everyone joining us today.",
  "Please open your order of service to the second page.",
  "Today we are looking at what it means to carry someone else's burden,",
  "and why that is harder than it sounds when the week has already taken everything you had.",
].map((text, i) => ({ seq: i + 1, text, isFinal: true, ts: i }));

function Preview() {
  useBrand(brand);

  if (q.get("s") === "listen") {
    return (
      <ListenScreen
        brand={brand}
        lang="en"
        endonym="English"
        muted={false}
        audioStatus="playing"
        transcript={{
          laneState: "live",
          lines,
          interim: { seq: 99, text: "But Paul does not stop there —", isFinal: false, ts: 99 },
          error: null,
        }}
        onToggleMute={() => {}}
        onBack={() => {}}
        onRetry={() => {}}
      />
    );
  }
  const v = q.get("v");
  if (v === "b") return <VariantB brand={brand} rows={rows} />;
  if (v === "c") return <VariantC brand={brand} rows={rows} />;
  return (
    <LanguagePicker
      brand={brand}
      live
      preference={null}
      onPreferenceChange={() => {}}
      rows={rows}
      onPick={() => {}}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
