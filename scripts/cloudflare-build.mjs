import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

execFileSync(process.execPath, [resolve("node_modules/@opennextjs/cloudflare/dist/cli/index.js"), "build"], {
  stdio: "inherit",
  env: { ...process.env, DRAWCOVER_CLOUDFLARE_BUILD: "true" },
});

// OpenNext copies local .env files into this server module. Deploy secrets only as bindings.
const envFile = ".open-next/cloudflare/next-env.mjs";
const source = readFileSync(envFile, "utf8");
const modes = ["production", "development", "test"];
const safe = modes.map((mode) => {
  const match = source.match(new RegExp(`export const ${mode} = (.*);`));
  if (!match) throw new Error("OpenNext env output changed; refusing to publish a possibly secret-bearing build.");
  const values = JSON.parse(match[1]);
  const publicValues = Object.fromEntries(Object.entries(values).filter(([name]) => name.startsWith("NEXT_PUBLIC_")));
  return `export const ${mode} = ${JSON.stringify(publicValues)};\n`;
}).join("");
writeFileSync(envFile, safe);
console.log("Cloudflare bundle: private local env values removed; use Worker secret bindings.");
