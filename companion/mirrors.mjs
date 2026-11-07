import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {atomic, contained} from "./storage.mjs";
import {capture, git, merge, validate} from "./snapshot.mjs";

/*//////////////////////////////////////////////////////////////////////*/

function configuration(state) {
  const config = JSON.parse(fs.readFileSync(path.join(state, "native-sync.json"), "utf8"));
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.username || endpoint.password || endpoint.pathname !== "/" || typeof config.key !== "string") throw new Error("Invalid native mirror configuration");
  return config;
}

async function request(config, route) {
  const response = await fetch(config.endpoint + route, {headers: {"X-API-Key": config.key}, signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`Mirror service returned ${response.status}`);
  return response.json();
}

async function progress(config, id) {
  try {
    const value = await request(config, `/rest/db/status?folder=${encodeURIComponent(id)}`);
    return {state: value.state, bytes: value.globalBytes || 0, received: value.inSyncBytes || 0, remaining: value.needBytes || 0, files: value.globalFiles || 0, ready: value.globalFiles > 0 && value.needTotalItems === 0 && value.state === "idle" && !value.pullErrors};
  } catch {return {state: "unavailable", ready: false, bytes: 0, received: 0, remaining: 0, files: 0}}
}

export async function mirrorstatus(state) {
  if (!fs.existsSync(path.join(state, "native-sync.json"))) return {available: false, projects: []};
  const config = configuration(state);
  const projects = await Promise.all(config.projects.map(async project => ({name: project.name, id: project.id, code: await progress(config, project.id + ".code"), repository: await progress(config, project.id)})));
  return {available: true, projects, chats: await progress(config, "codexchats")};
}

function copy(source, target, relative = "") {
  fs.mkdirSync(target, {recursive: true});
  for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
    if ([".stfolder", ".stignore", ".stversions", "priority.json"].includes(entry.name) || entry.name.startsWith(".syncthing.")) continue;
    if (relative === ".git/" && ["config", "hooks", "worktrees"].includes(entry.name)) continue;
    const filename = contained(source, entry.name);
    const destination = contained(target, entry.name);
    if (entry.isDirectory()) copy(filename, destination, relative + entry.name + "/");
    else if (entry.isFile()) fs.copyFileSync(filename, destination, fs.constants.COPYFILE_EXCL);
    else throw new Error("Linked files cannot enter a working copy");
  }
}

/*//////////////////////////////////////////////////////////////////////*/

export async function openmirror({state, name, kind}) {
  const config = configuration(state);
  const project = config.projects.find(item => item.name === name);
  if (!project || !["code", "repository"].includes(kind)) throw new Error("Select a mirrored project");
  const status = await progress(config, project.id + (kind === "code" ? ".code" : ""));
  if (!status.ready) throw new Error("This copy is still receiving files");
  const source = kind === "code" ? project.code : project.path;
  if (!source || !fs.existsSync(source)) throw new Error("Incoming copy is unavailable");
  if (kind === "code") {
    const receipt = JSON.parse(fs.readFileSync(path.join(source, "priority.json"), "utf8"));
    for (const filename of receipt.files) if (!fs.statSync(contained(source, filename)).isFile()) throw new Error("Code copy is incomplete");
  } else git(source, ["fsck", "--full", "--no-dangling"]);
  const root = config.workspaces || path.join(os.homedir(), "workspaces");
  const destination = path.join(root, `${name}-${Date.now()}`);
  const repo = path.join(destination, "repo");
  copy(source, repo);
  if (kind === "code") {
    const manifest = capture({repo, store: path.join(state, "store"), name, filesonly: true});
    atomic(path.join(destination, "baseline.json"), JSON.stringify(manifest));
  } else {
    git(repo, ["init"]);
    git(repo, ["config", "core.autocrlf", "false"]);
    git(repo, ["config", "core.filemode", "false"]);
    const metadata = path.join(repo, ".git", "ghdesktop", "mobile.json");
    if (fs.existsSync(metadata)) {
      const omitted = JSON.parse(fs.readFileSync(metadata, "utf8")).omitted || [];
      if (omitted.length) git(repo, ["update-index", "--skip-worktree", "-z", "--stdin"], omitted.join("\0") + "\0");
    }
    git(repo, ["fsck", "--full", "--no-dangling"]);
  }
  atomic(path.join(destination, "mirror.json"), JSON.stringify({name, kind, created: new Date().toISOString()}));
  return {repo, activecopy: destination, filesonly: kind === "code", workproject: name};
}

export function upgradephone({state, previous, destination}) {
  if (!previous.filesonly || previous.workproject !== destination.workproject) return {conflicts: []};
  const baseline = validate(JSON.parse(fs.readFileSync(path.join(previous.activecopy, "baseline.json"), "utf8")));
  const store = path.join(state, "store");
  const edits = capture({repo: previous.repo, store, name: previous.workproject, filesonly: true});
  return merge({manifest: edits, base: baseline, store, repo: destination.repo, recovery: path.join(state, "recovery")});
}
