import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const cliCtx = await esbuild.context({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.mjs",
  banner: { js: "#!/usr/bin/env node" },
  external: ["node-pty", "ws"],
  sourcemap: true,
});

const webCtx = await esbuild.context({
  entryPoints: ["src/web/app.ts"],
  bundle: true,
  platform: "browser",
  target: "es2020",
  format: "iife",
  outdir: "dist/public",
  entryNames: "app",
});

if (watch) {
  await Promise.all([cliCtx.watch(), webCtx.watch()]);
  console.log("Watching...");
} else {
  await Promise.all([cliCtx.rebuild(), webCtx.rebuild()]);
  await Promise.all([cliCtx.dispose(), webCtx.dispose()]);
}
