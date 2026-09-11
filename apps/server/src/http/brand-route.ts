import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Serves `GET /brand/logo`: the one image file the operator pointed at.
 *
 * There is no path parameter and nothing from the request is ever joined onto
 * a path — the URL this answers is a fixed literal and the file comes from
 * config — so unlike `StaticRoute` there is no traversal surface here to
 * defend.
 *
 * Returns false rather than writing a status when it has no answer, keeping
 * ownership of the 404 with the caller. Every "no answer" case is a soft one:
 * the file was configured but has since been moved, or was never configured
 * at all. Both must land on an unbranded page rather than an error, because a
 * missing logo is not a reason an attendee cannot hear the talk.
 */
export class BrandRoute {
  constructor(private readonly logoPath: string) {}

  async handle(res: ServerResponse): Promise<boolean> {
    if (this.logoPath === "") return false;

    const type = CONTENT_TYPES[extname(this.logoPath).toLowerCase()];
    if (!type) return false;

    try {
      const stats = await stat(this.logoPath);
      if (!stats.isFile()) return false;

      res.writeHead(200, {
        "content-type": type,
        "content-length": String(stats.size),
        // The file can be swapped between events without the URL changing, so
        // a phone must revalidate rather than hold last week's logo forever.
        "cache-control": "no-cache",
      });
      createReadStream(this.logoPath).pipe(res);
      return true;
    } catch {
      return false;
    }
  }
}
