import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../../.env", import.meta.url);
const contents = fs.readFileSync(envPath, "utf8");
const lines = contents.split(/\r?\n/);
const values = new Map(lines.filter((line) => line && !line.trim().startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const missing = Array.from({ length: 5 }, (_, i) => i + 1).filter((i) => !values.get(`TEST_WATCHER_${i}_PRIVATE_KEY`));
if (missing.length === 0) { console.log("five test watcher signers already configured"); process.exit(0); }
const additions = missing.map((i) => {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  return { line: `TEST_WATCHER_${i}_PRIVATE_KEY=${key}`, address };
});
fs.appendFileSync(envPath, `${contents.endsWith("\n") ? "" : "\n"}${additions.map((entry) => entry.line).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ generated: additions.map((entry, index) => ({ watcher: missing[index], address: entry.address })) }));
