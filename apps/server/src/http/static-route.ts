import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

interface Located {
  file: string;
  size: number;
  immutable: boolean;
}

async function statFile(file: string) {
  try {
    const stats = await stat(file);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

/**
 * Serves the built attendee app. Returns false rather than writing anything when
 * it has no answer, so the caller keeps ownership of the 404 — and so a dev run
 * with no `dist/` on disk simply falls through to Vite's own dev server.
 */
export class StaticRoute {
  private readonly root: string;
  /**
   * Memoized `realpath(root)`, resolved on first use and reused for the life
   * of this instance. Any request that resolves to a symlink whose target
   * lands outside this — not just outside the string form of `root` — is
   * refused. `root` itself can sit under a symlink on this OS (macOS's
   * `/var` is a symlink to `/private/var`, and `os.tmpdir()` lives under
   * it), so comparing a request's canonical path against the *literal*
   * `root` string would reject legitimate requests; comparing against
   * `root`'s own canonical path is what makes the comparison meaningful.
   */
  private realRoot: Promise<string | null> | undefined;

  constructor(opts: { root: string }) {
    this.root = resolve(opts.root);
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const found = await this.locate(pathname);
    if (!found) return false;

    res.writeHead(200, {
      "content-type":
        CONTENT_TYPES[extname(found.file)] ?? "application/octet-stream",
      "content-length": String(found.size),
      // Vite emits content-hashed filenames under /assets, so those are safe to
      // pin forever; 60 phones then fetch them once between them. index.html
      // must never be cached or a re-deploy strands everyone on old code.
      "cache-control": found.immutable
        ? "public, max-age=31536000, immutable"
        : "no-store",
    });

    if (req.method === "HEAD") {
      res.end();
      return true;
    }

    createReadStream(found.file).pipe(res);
    return true;
  }

  private async locate(pathname: string): Promise<Located | null> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      // A malformed percent-escape (e.g. a lone "%") throws rather than
      // producing garbage, so the safest reading is "not a request this
      // route understands" rather than trying to salvage a partial decode.
      return null;
    }

    const candidate = normalize(join(this.root, decoded));
    if (candidate !== this.root && !candidate.startsWith(this.root + sep)) {
      // Cheap, pre-filesystem rejection of the obvious case: "..", encoded
      // or not, resolved to somewhere outside root as a plain string. This
      // alone does not catch a symlink planted inside root that points
      // outside it — isWithinRoot() below does — but it avoids a stat() call
      // for the vast majority of scans and bad links.
      return null;
    }

    const direct = await statFile(candidate);
    if (direct && (await this.isWithinRoot(candidate))) {
      return {
        file: candidate,
        size: direct.size,
        immutable: decoded.startsWith("/assets/"),
      };
    }

    // Anything without a file extension is a route, not a missing asset.
    if (extname(decoded) !== "") return null;

    const index = join(this.root, "index.html");
    const stats = await statFile(index);
    if (!stats) return null;

    return { file: index, size: stats.size, immutable: false };
  }

  /**
   * Resolves symlinks on both sides and compares the canonical paths. A
   * symlink placed inside `root` (by the build, by a careless `unzip`, or by
   * an attacker who can write one file into the served tree some other way)
   * can point anywhere on disk; `stat()` happily follows it and reports the
   * *target's* file info, so string-checking the request path alone is not
   * enough — the request path never contains "..", only the link's target
   * does.
   */
  private async isWithinRoot(candidate: string): Promise<boolean> {
    this.realRoot ??= realpath(this.root).catch(() => null);
    const realRoot = await this.realRoot;
    if (!realRoot) return false;

    try {
      const real = await realpath(candidate);
      return real === realRoot || real.startsWith(realRoot + sep);
    } catch {
      return false;
    }
  }
}
