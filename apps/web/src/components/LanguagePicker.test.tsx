import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { languageRows } from "../languages.ts";
import { ORIGINAL_TAG, S } from "../strings.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";

const rows = languageRows({
  offeredLanguages: ["ko", "en", "es", "ja"],
  sourceLanguage: "ko",
});

describe("LanguagePicker", () => {
  test("renders one row per offered language", () => {
    render(<LanguagePicker rows={rows} onPick={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });

  test("shows each endonym in its own script", () => {
    render(<LanguagePicker rows={rows} onPick={() => {}} />);
    for (const text of ["한국어", "English", "Español", "日本語"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  test("tags the source language row as the original", () => {
    render(<LanguagePicker rows={rows} onPick={() => {}} />);
    const tag = screen.getByText(`(${ORIGINAL_TAG})`);
    expect(tag).toBeTruthy();
    expect(tag.closest("button")?.textContent).toContain("한국어");
  });

  test("shows the bilingual prompt", () => {
    render(<LanguagePicker rows={rows} onPick={() => {}} />);
    expect(screen.getByText(S.pickLanguage)).toBeTruthy();
  });

  test("calls onPick synchronously inside the click handler", () => {
    const onPick = vi.fn();
    render(<LanguagePicker rows={rows} onPick={onPick} />);

    fireEvent.click(screen.getByText("Español").closest("button")!);

    // fireEvent.click returns only after the handler has run, so a call count
    // of 1 here proves nothing was deferred to a microtask — which is what iOS
    // requires for the same tap to authorise playback.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("es");
  });

  test("every row is a real button, not a div with a handler", () => {
    render(<LanguagePicker rows={rows} onPick={() => {}} />);
    for (const el of screen.getAllByRole("button")) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
  });
});
