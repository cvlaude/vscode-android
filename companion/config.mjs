import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {atomic} from "./storage.mjs";

export function statepath() {
  return process.env.CONTINUITY_HOME || path.join(process.platform === "win32" ? process.env.LOCALAPPDATA || os.homedir() : path.join(os.homedir(), ".local", "share"), "vscode-android");
}

export function configuration(state = statepath()) {
  const filename = path.join(state, "config.json");
  if (!fs.existsSync(filename)) {
    atomic(filename, JSON.stringify({version: 1, secret: crypto.randomBytes(32).toString("base64url"), salt: crypto.randomBytes(16).toString("hex"), repo: "", peer: "", rate: 5120, workbench: "http://127.0.0.1:8766", sessions: [], codexhome: path.join(os.homedir(), ".codex"), profile: ""}, null, 2));
  }
  const config = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (config.version !== 1 || typeof config.secret !== "string" || config.secret.length < 16) throw new Error("Invalid companion configuration");
  return {config, state, store: path.join(state, "store"), filename};
}
