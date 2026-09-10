import { os } from "@orpc/server";
import { z } from "zod";
import { redactSettings, type PublicSettings } from "../../settings/schema.ts";
import { getSettings, updateSettings } from "../../settings/store.ts";

const patchSchema = z.object({
  deviceId: z.string().nullable().optional(),
  deviceLabel: z.string().nullable().optional(),
  channelIndex: z.number().optional(),
  requestedChannelCount: z.number().optional(),
  lanAddress: z.string().nullable().optional(),
  port: z.number().optional(),
  offeredLanguages: z.array(z.string()).optional(),
  transcriptDelayMs: z.number().optional(),
  geminiApiKey: z.string().optional(),
});

export const get = os.handler((): PublicSettings => redactSettings(getSettings()));

export const set = os
  .input(patchSchema)
  .handler(({ input }): PublicSettings => redactSettings(updateSettings(input)));

/**
 * The ingest token is a shared secret between two processes on the same
 * machine, and the renderer needs it to open /ingest. It is exposed on its own
 * procedure rather than inside settings.get so that no accidental
 * console.log(settings) puts it on screen during an event.
 */
export const ingestToken = os.handler((): string => getSettings().ingestToken);
