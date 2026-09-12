import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
const targets = {
  api: "apps/api-worker",
  orchestration: "apps/orchestration-worker",
  watcher: "workers/resolution-watcher",
};
if (!targets[target]) throw new Error("build target must be api, orchestration, or watcher");
const packageDir = path.join(root, targets[target]);
const packageRequire = createRequire(path.join(packageDir, "package.json"));
const wranglerManifest = packageRequire.resolve("wrangler/package.json");
const wranglerRequire = createRequire(wranglerManifest);
const { build } = wranglerRequire("esbuild");
const outfile = path.join(packageDir, "build", "worker.js");

await build({
  entryPoints: [path.join(packageDir, "src", "index.ts")],
  outfile,
  bundle: true,
  // Keep Node built-ins as static `node:` imports. Wrangler's/browser-style
  // dynamic-require shim breaks `pg`'s EventEmitter usage in workerd.
  platform: "node",
  format: "esm",
  target: "es2022",
  conditions: ["workerd", "browser"],
  mainFields: ["module", "main"],
  external: [
    // Let Wrangler process `pg` with its nodejs_compat/Hyperdrive integration;
    // esbuild's browser bundle turns pg's EventEmitter require into an
    // unsupported dynamic require in workerd.
    "pg", "cloudflare:workers", "node:*", "assert", "buffer", "crypto", "dns", "events", "fs", "http",
    "https", "net", "os", "path", "process", "stream", "string_decoder", "timers", "tls", "url", "util", "zlib",
  ],
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});
console.log(`Bundled ${target} Worker to ${path.relative(root, outfile)}`);
