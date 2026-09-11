import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StaticRoute } from "./static-route.ts";

class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = "";
  ended = false;
  /** Resolves when the piped read stream has finished, so no file handle is
   *  still open when `after()` deletes the fixture directory. */
  readonly finished: Promise<void>;

  private resolveFinished!: () => void;

  constructor() {
    this.finished = new Promise<void>((resolve) => {
      this.resolveFinished = resolve;
    });
  }

  writeHead(code: number, headers?: Record<string, string>) {
    this.statusCode = code;
    if (headers) this.headers = headers;
    return this;
  }
  end(chunk?: unknown) {
    if (typeof chunk === "string") this.body += chunk;
    this.ended = true;
    this.resolveFinished();
    return this;
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  emit() {
    return true;
  }
  write(chunk: Buffer | string) {
    this.body += chunk.toString();
    return true;
  }
}

let root = "";
/** Lives outside `root` entirely, so anything that reaches it has escaped. */
let secretDir = "";

before(async () => {
  root = await mkdtemp(join(tmpdir(), "tongyeok-web-"));
  await writeFile(join(root, "index.html"), "<!doctype html><title>t</title>");
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "index-abc123.js"), "console.log(1)");

  secretDir = await mkdtemp(join(tmpdir(), "tongyeok-secret-"));
  await writeFile(join(secretDir, "passwd"), "root:x:0:0");
  // A symlink placed *inside* the served root but pointing *outside* it. The
  // string-prefix check on the request path alone cannot catch this: the
  // requested path itself never contains "..", only the symlink's target
  // does, so resolving symlinks (not just resolving "..") is required.
  await symlink(join(secretDir, "passwd"), join(root, "assets", "escape.js"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(secretDir, { recursive: true, force: true });
});

async function get(path: string) {
  const res = new FakeResponse();
  const route = new StaticRoute({ root });
  const served = await route.handle({ method: "GET" } as never, res as never, path);
  if (served) await res.finished;
  return { served, res };
}

test("serves index.html at the root, uncached", async () => {
  const { served, res } = await get("/");
  assert.equal(served, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.body, "<!doctype html><title>t</title>");
});

test("serves a hashed asset as immutable", async () => {
  const { served, res } = await get("/assets/index-abc123.js");
  assert.equal(served, true);
  assert.equal(res.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(res.headers["cache-control"], "public, max-age=31536000, immutable");
});

test("falls back to index.html for an extensionless path", async () => {
  const { served, res } = await get("/listen-screen");
  assert.equal(served, true);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
});

test("declines a missing file that names an extension", async () => {
  const { served } = await get("/assets/gone.js");
  assert.equal(served, false);
});

test("refuses to escape the root", async () => {
  assert.equal((await get("/../../etc/passwd")).served, false);
  assert.equal((await get("/%2e%2e%2f%2e%2e%2fetc%2fpasswd")).served, false);
});

test("refuses to follow a symlink that escapes the root", async () => {
  const { served, res } = await get("/assets/escape.js");
  assert.equal(served, false);
  assert.equal(res.body, "", "the secret file's contents were never written to the response");
});

test("declines a malformed percent-encoded path instead of throwing", async () => {
  const { served } = await get("/%");
  assert.equal(served, false);
});

test("declines everything when the root does not exist", async () => {
  const res = new FakeResponse();
  const route = new StaticRoute({ root: join(root, "nope") });
  assert.equal(await route.handle({ method: "GET" } as never, res as never, "/"), false);
});

test("declines a non-GET method", async () => {
  const res = new FakeResponse();
  const route = new StaticRoute({ root });
  assert.equal(await route.handle({ method: "POST" } as never, res as never, "/"), false);
});

test("answers HEAD with headers but no body", async () => {
  const res = new FakeResponse();
  const route = new StaticRoute({ root });
  const served = await route.handle({ method: "HEAD" } as never, res as never, "/");
  assert.equal(served, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.body, "");
});
