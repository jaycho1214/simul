import { loadConfig } from "./config.ts";
import { SystemClock } from "./clock.ts";
import { createServer } from "./server.ts";
import { createGeminiTranslateSessionFactory } from "./gemini/gemini-translate-session.ts";

const config = loadConfig();
const server = createServer({
  config,
  clock: new SystemClock(),
  sessionFactory: createGeminiTranslateSessionFactory({ apiKey: config.geminiApiKey }),
});

const port = await server.listen(config.port);
console.log(`tongyeok server on :${port}`);
console.log(`languages: ${config.offeredLanguages.join(", ")} (source ${config.sourceLanguage})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
