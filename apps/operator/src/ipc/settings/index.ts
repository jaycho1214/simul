import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { os } from "@orpc/server";
import { app, dialog } from "electron";
import { z } from "zod";
import {
  BRAND_THEMES,
  LOGO_EXTENSIONS,
  MAX_LOGO_BYTES,
  logoDataUri,
  storedLogoName,
} from "../../settings/brand.ts";
import { redactSettings, type PublicSettings } from "../../settings/schema.ts";
import { getSettings, updateSettings } from "../../settings/store.ts";
import { UI_LANGUAGES } from "../../settings/ui-language.ts";
import { supervisor } from "../../main.ts";

const patchSchema = z.object({
  deviceId: z.string().nullable().optional(),
  deviceLabel: z.string().nullable().optional(),
  channelIndex: z.number().optional(),
  requestedChannelCount: z.number().optional(),
  lanAddress: z.string().nullable().optional(),
  uiLanguage: z.enum(UI_LANGUAGES).nullable().optional(),
  port: z.number().optional(),
  passthroughLane: z.boolean().optional(),
  offeredLanguages: z.array(z.string()).optional(),
  transcriptDelayMs: z.number().optional(),
  geminiApiKey: z.string().optional(),

  brandName: z.string().nullable().optional(),
  brandAccent: z.string().nullable().optional(),
  brandLogoPath: z.string().nullable().optional(),
  brandTheme: z.enum(BRAND_THEMES).nullable().optional(),
});

/**
 * Hands the current brand to the running server so it applies to the next
 * /config a phone asks for, with no restart. Everything else in settings
 * shapes a live lane and can only take effect on the next spawn.
 *
 * A no-op when nothing is running: the value is already saved, and
 * buildServerEnv puts it in the next spawn's environment.
 */
function pushBrand(): void {
  const s = getSettings();
  supervisor.setBrand({
    name: s.brandName ?? "",
    accent: s.brandAccent ?? "",
    logoPath: s.brandLogoPath ?? "",
    theme: s.brandTheme ?? "dark",
  });
}

export const get = os.handler((): PublicSettings => redactSettings(getSettings()));

export const set = os.input(patchSchema).handler(({ input }): PublicSettings => {
  const next = updateSettings(input);
  pushBrand();
  return redactSettings(next);
});

/**
 * The ingest token is a shared secret between two processes on the same
 * machine, and the renderer needs it to open /ingest. It is exposed on its own
 * procedure rather than inside settings.get so that no accidental
 * console.log(settings) puts it on screen during an event.
 */
export const ingestToken = os.handler((): string => getSettings().ingestToken);

/** Where a logo lives once it belongs to the app rather than to the engineer. */
function brandDir(): string {
  return join(app.getPath("userData"), "brand");
}

/**
 * Copies a logo into the app's own storage and points settings at the copy.
 *
 * The copy is the whole point: an engineer drags a file out of Downloads, then
 * empties Downloads, moves the file, or sets the rig up on a different machine
 * — and the attendee app still has its logo. Referencing the original where it
 * sat made the logo a dangling path waiting to break between the rehearsal and
 * the event.
 */
async function storeLogo(originalName: string, bytes: Buffer): Promise<PublicSettings> {
  const name = storedLogoName(originalName);
  if (!name) {
    throw new Error(`지원하지 않는 이미지 형식입니다: ${originalName}`);
  }
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    throw new Error(`로고 파일이 너무 큽니다 (최대 ${Math.floor(MAX_LOGO_BYTES / 1_000_000)}MB)`);
  }

  const dir = brandDir();
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  await writeFile(target, bytes);

  const next = updateSettings({ brandLogoPath: target });
  pushBrand();
  return redactSettings(next);
}

/**
 * A native picker, filtered to the types BrandRoute can serve. The chosen file
 * is copied in immediately, so the path stored in settings is always one the
 * app owns.
 *
 * Returns the settings unchanged when the dialog is dismissed — that is "no
 * change", not "clear the logo", which has its own action.
 */
export const pickBrandLogo = os.handler(async (): Promise<PublicSettings> => {
  const result = await dialog.showOpenDialog({
    title: "행사 로고 선택",
    properties: ["openFile"],
    filters: [{ name: "Image", extensions: LOGO_EXTENSIONS.map((ext) => ext.replace(".", "")) }],
  });

  const picked = result.canceled ? undefined : result.filePaths[0];
  if (!picked) return redactSettings(getSettings());

  return storeLogo(picked, await readFile(picked));
});

/**
 * The drag-and-drop path. The renderer reads the dropped File itself and sends
 * the bytes, rather than a path: Electron no longer exposes File.path under
 * context isolation, and bytes work identically whether the file came from
 * Finder, a browser, or a Slack download.
 */
export const dropBrandLogo = os
  .input(z.object({ filename: z.string(), base64: z.string() }))
  .handler(async ({ input }): Promise<PublicSettings> =>
    storeLogo(input.filename, Buffer.from(input.base64, "base64")),
  );

/**
 * The stored logo as a data URI, so the panel can show the engineer the actual
 * image rather than a filename. Reading it back from the app's own copy also
 * proves the copy is really there and really readable.
 */
export const brandLogoPreview = os.handler(async (): Promise<string | null> => {
  const path = getSettings().brandLogoPath;
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_LOGO_BYTES) return null;
    return logoDataUri(path, bytes.toString("base64"));
  } catch {
    // The file was configured and has since gone. The panel shows no preview
    // and the attendee app falls back to an unbranded bar; neither is an error
    // worth stopping anything for.
    return null;
  }
});
