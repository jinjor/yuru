import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/renderer"),
  plugins: [react()],
  base: "./",
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/renderer"),
    // 起動中の renderer は、起動時に読んだ entry chunk から遅延読み込み先を参照する。
    // 再 build で旧 chunk を消すと初回表示時に import できなくなるため、app restart までは残す。
    emptyOutDir: false,
    manifest: true,
  },
});
