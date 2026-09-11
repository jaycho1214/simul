// Feeds 5 seconds of 440 Hz tone into the ingest socket so you can hear the
// passthrough lane without a mixer plugged in.
import { WebSocket } from "ws";
const port = process.env.PORT ?? "8080";
const token = process.env.INGEST_TOKEN ?? "t";
const ws = new WebSocket(`ws://127.0.0.1:${port}/ingest?token=${token}`);
ws.on("error", (e) => {
  console.error("could not connect:", e.message);
  process.exit(1);
});
await new Promise((r) => ws.once("open", r));
console.log("feeding 5s of 440Hz tone — pick 한국어 in the browser");
let n = 0;
await new Promise((done) => {
  const t = setInterval(() => {
    const b = Buffer.alloc(640);
    for (let s = 0; s < 320; s++) {
      b.writeInt16LE(
        Math.round(9000 * Math.sin(2 * Math.PI * 440 * ((n * 320 + s) / 16000))),
        s * 2,
      );
    }
    ws.send(b);
    if (++n >= 250) {
      clearInterval(t);
      ws.close();
      done();
    }
  }, 20);
});
console.log("done");
