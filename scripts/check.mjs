import fs from "node:fs";
import path from "node:path";
import {spawnSync as spawn} from "node:child_process";

let failures = 0;
for (const folder of ["companion", "shell", "scripts", "extension", "tests"]) {
  if (!fs.existsSync(folder)) continue;
  for (const name of fs.readdirSync(folder)) {
    const filename = path.join(folder, name);
    if (/\.(js|mjs|cjs)$/.test(name)) {
      const result = spawn(process.execPath, ["--check", filename], {encoding: "utf8"});
      if (result.status !== 0) {process.stderr.write(result.stderr); failures += 1}
    }
  }
}
process.stdout.write(`Syntax checks: ${failures ? "failed" : "passed"}\n`);
process.exitCode = failures ? 1 : 0;
