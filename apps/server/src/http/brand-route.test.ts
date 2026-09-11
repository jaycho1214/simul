import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrandRoute } from "./brand-route.ts";

class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  body = "";
  ended = false;
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

let dir = "";
let svg = "";

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "brand-"));
  svg = join(dir, "logo.svg");
  await writeFile(svg, "<svg xmlns='http://www.w3.org/2000/svg'/>");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("serves the configured logo with a matching content type", async () => {
  const res = new FakeResponse();
  const served = await new BrandRoute(svg).handle(res as never);
  await res.finished;

  assert.equal(served, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/svg+xml");
  assert.match(res.body, /<svg/);
});

test("declines when no logo is configured", async () => {
  const res = new FakeResponse();
  assert.equal(await new BrandRoute("").handle(res as never), false);
  assert.equal(res.statusCode, 0, "must leave the 404 to the caller");
});

// The path is read at startup but the file lives on a venue laptop, where it
// can be moved or deleted between boot and doors opening. That must degrade to
// an unbranded page, never to a crash mid-event.
test("declines when the configured file has gone missing", async () => {
  const res = new FakeResponse();
  assert.equal(await new BrandRoute(join(dir, "not-here.png")).handle(res as never), false);
});

test("declines when the path is a directory rather than a file", async () => {
  const res = new FakeResponse();
  assert.equal(await new BrandRoute(dir).handle(res as never), false);
});

test("lets a phone cache the logo but re-check it between events", async () => {
  const res = new FakeResponse();
  await new BrandRoute(svg).handle(res as never);
  await res.finished;
  assert.match(res.headers["cache-control"]!, /no-cache/);
});
