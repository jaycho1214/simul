import { SystemClock } from "@tongyeok/server/clock";
import { loadConfig } from "@tongyeok/server/config";
import { createGeminiTranslateSessionFactory } from "@tongyeok/server/gemini";
import { createServer } from "@tongyeok/server/server";

/**
 * Runs inside an Electron utilityProcess. Deliberately has no top-level await:
 * Forge builds main-target bundles as CommonJS, where top-level await is a
 * syntax error.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const server = createServer({
    config,
    clock: new SystemClock(),
    sessionFactory: createGeminiTranslateSessionFactory({ apiKey: config.geminiApiKey }),
  });

  // Registered before the listen() await settles, so a shutdown request that
  // arrives while the server is still binding is not lost.
  process.parentPort.on("message", (event) => {
    const message = event.data as { type?: string } | undefined;
    if (message?.type === "shutdown") {
      // Must go through server.close(), never a bare process.exit(): close()
      // reaches LaneManager.closeAll() -> lane.close() -> LaneOpusEncoder.close(),
      // which is the only thing that calls opusscript's delete() and frees the
      // encoder's WASM-heap allocation. Skipping it leaks one allocation per
      // lane for the life of the process. close() is itself bounded-time (it
      // calls http.closeAllConnections()), so this never hangs waiting on a
      // connected phone.
      void server.close().then(() => process.exit(0));
    }
  });

  const port = await server.listen(config.port);
  // stdio: "pipe" (see electronForkFn) lets the supervisor capture these two
  // lines for the 서버 로그 panel and echo them to its own console, instead of
  // the server's boot state being invisible outside its status.
  console.log(`tongyeok server on :${port}`);
  console.log(`languages: ${config.offeredLanguages.join(", ")} (source ${config.sourceLanguage})`);
  process.parentPort.postMessage({ type: "listening", port });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  // A config error (missing GEMINI_API_KEY, a bad env var) or a port conflict
  // (EADDRINUSE, since server.ts's listen() rejects rather than crashing) must
  // reach the operator's control panel, not just a log nobody is watching. The
  // supervisor turns this into a readable status line.
  process.parentPort.postMessage({ type: "fatal", message });
  process.exit(1);
});
