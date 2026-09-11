import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { UNBRANDED } from "../config.ts";
import { languageRows } from "../languages.ts";
import { PASSTHROUGH_TAG, S, bilingual } from "../strings.ts";
import { LanguagePicker } from "./LanguagePicker.tsx";

const rows = languageRows({
  offeredLanguages: ["ko", "en", "es", "ja"],
  passthroughLanguage: null,
});

// The same event with the operator's debug passthrough lane switched on.
const rowsWithPassthrough = languageRows({
  offeredLanguages: ["ko", "en", "es", "ja"],
  passthroughLanguage: "original",
});

describe("LanguagePicker", () => {
  test("renders one row per offered language", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />);
    expect(
      screen.getAllByRole("button").filter((b) => b.className.includes("picker-row")),
    ).toHaveLength(4);
  });

  test("shows each endonym in its own script", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />);
    for (const text of ["한국어", "English", "Español", "日本語"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  test("tags nothing when every row is a translation", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />);
    expect(screen.queryByText(PASSTHROUGH_TAG)).toBeNull();
  });

  test("tags the passthrough lane as debug, last in the list", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rowsWithPassthrough}
        onPick={() => {}}
      />);
    const tag = screen.getByText(PASSTHROUGH_TAG);
    expect(tag.closest("button")?.textContent).toContain("원음");
    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1]!.textContent).toContain("원음");
  });

  // The row the tag sits on is also marked structurally, for the reader who
  // can read neither of the tag's two languages.
  test("marks the passthrough row apart from the translated ones", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rowsWithPassthrough}
        onPick={() => {}}
      />);
    const passthrough = screen.getByText("원음").closest("button")!;
    expect(passthrough.className).toContain("picker-row--passthrough");

    const translated = screen.getByText("English").closest("button")!;
    expect(translated.className).not.toContain("picker-row--passthrough");
  });

  test("shows the prompt in both languages, stacked rather than slash-joined", () => {
    const { ko, en } = bilingual(S.pickLanguage);
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />);

    const heading = screen.getByRole("heading");
    expect(screen.getByText(ko)).toBeTruthy();
    expect(screen.getByText(en)).toBeTruthy();
    expect(heading.textContent).not.toContain(" / ");
  });

  test("shows the event name when the operator set one", () => {
    render(
      <LanguagePicker
        brand={{ ...UNBRANDED, name: "주일 예배" }}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText("주일 예배")).toBeTruthy();
  });

  test("calls onPick synchronously inside the click handler", () => {
    const onPick = vi.fn();
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={onPick}
      />);

    fireEvent.click(screen.getByText("Español").closest("button")!);

    // fireEvent.click returns only after the handler has run, so a call count
    // of 1 here proves nothing was deferred to a microtask — which is what iOS
    // requires for the same tap to authorise playback.
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith("es");
  });

  test("every row is a real button, not a div with a handler", () => {
    render(<LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={() => {}}
      />);
    for (const el of screen.getAllByRole("button")) {
      expect(el.tagName).toBe("BUTTON");
      expect(el.getAttribute("type")).toBe("button");
    }
  });
});

/**
 * A row tapped before the operator has started would open a Gemini session
 * against an empty room and bill for translating silence, so the gate is a
 * cost control as much as it is a kindness to someone who arrived early.
 */
describe("before the room is live", () => {
  function renderWaiting() {
    render(
      <LanguagePicker
        brand={UNBRANDED}
        live={false}
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={vi.fn()}
      />,
    );
  }

  test("says the event has not started", () => {
    renderWaiting();
    expect(screen.getByText(bilingual(S.notStarted).ko)).toBeTruthy();
    // Both halves on their own lines: a slash landing mid-sentence is the
    // thing this stacking exists to avoid.
    expect(screen.getByText(bilingual(S.notStartedBody).ko)).toBeTruthy();
    expect(screen.getByText(bilingual(S.notStartedBody).en)).toBeTruthy();
  });

  test("leaves every language row inert", () => {
    renderWaiting();
    for (const row of screen.getAllByRole("button")) {
      // The theme toggle is a control in its own right and stays usable.
      if (row.className.includes("theme-toggle")) continue;
      expect(row.hasAttribute("disabled"), row.textContent ?? "").toBe(true);
    }
  });

  test("still lists the languages, so a reader can see theirs is coming", () => {
    renderWaiting();
    expect(screen.getByText("Español")).toBeTruthy();
  });

  test("cannot be picked", () => {
    const onPick = vi.fn();
    render(
      <LanguagePicker
        brand={UNBRANDED}
        live={false}
        preference={null}
        onPreferenceChange={() => {}}
        rows={rows}
        onPick={onPick}
      />,
    );
    fireEvent.click(screen.getByText("Español").closest("button")!);
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("the theme toggle", () => {
  test("cycles the reader's preference", () => {
    const onPreferenceChange = vi.fn();
    render(
      <LanguagePicker
        brand={UNBRANDED}
        live
        preference={null}
        onPreferenceChange={onPreferenceChange}
        rows={rows}
        onPick={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: S.themeAuto }));
    expect(onPreferenceChange).toHaveBeenCalledWith("light");
  });
});
