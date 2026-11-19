// Builds every landing figure: node scripts/figures/build.mjs [name ...]
// Each figure's build lives in scripts/figures/<name>/build.mjs and exports build().
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HERE, copyKit } from "./common.mjs";

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
copyKit();
const names = readdirSync(HERE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "kit" && existsSync(join(HERE, d.name, "build.mjs")))
  .map((d) => d.name)
  .filter((n) => !wanted.length || wanted.includes(n));
for (const name of names) {
  const mod = await import(pathToFileURL(join(HERE, name, "build.mjs")).href);
  await mod.build();
}
