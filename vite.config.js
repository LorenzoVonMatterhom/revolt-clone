import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const assetFolders = ["cars", "gfx", "levels", "models", "wavs"];

function copyGameAssets() {
  return {
    name: "copy-revolt-assets",
    closeBundle() {
      const outDir = resolve("dist");
      mkdirSync(outDir, { recursive: true });

      for (const folder of assetFolders) {
        const source = resolve(folder);
        const target = resolve(outDir, folder);
        if (!existsSync(source)) continue;
        rmSync(target, { force: true, recursive: true });
        cpSync(source, target, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/revolt-clone/" : "/",
  define: {
    __REVOLT_FILES__: JSON.stringify(readdirSync("levels", { recursive: true }).filter((p) => /\.(prm|bmp|pan)$/i.test(p)).map((p) => `/levels/${p.replaceAll("\\", "/")}`)),
  },
  plugins: [copyGameAssets()],
});
