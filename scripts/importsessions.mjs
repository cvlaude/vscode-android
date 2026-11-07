import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {importsessions} from "../companion/sessions.mjs";

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const source = option("--source");
const repo = option("--repo");
const destination = option("--destination") || path.join(os.homedir(), ".codex");
if (!source || !repo) throw new Error("Use --source CHAT_FOLDER --repo FALLBACK_WORKSPACE [--mapping PATH_MAP_JSON] [--destination CODEX_HOME]");
if (process.platform === "win32" && !option("--destination")) throw new Error("Select an explicit Windows test destination");
const mapping = option("--mapping") ? JSON.parse(fs.readFileSync(option("--mapping"), "utf8")) : {};
const result = importsessions({source, repo, destination, mapping});
console.log(JSON.stringify({imported: result.sessions.length, conflicts: result.conflicts.length, errors: result.errors.length}));
