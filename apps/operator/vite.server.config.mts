import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: {
      // opusscript is pure emscripten-compiled JavaScript — no native addon, no
      // ABI to match, nothing to rebuild. It is external anyway because
      // build/opusscript_native_wasm.js reads its 310 KB .wasm sibling with
      // fs.readFileSync(__dirname + …); inlining the JS would leave that read
      // pointing at a path Rollup never emitted. Keeping it external means the
      // package ships as ordinary node_modules, which is what Task 11 packages.
      // ws's two optional accelerators are absent by design; ws try/catches them.
      external: ["opusscript", "bufferutil", "utf-8-validate"],
    },
  },
});
