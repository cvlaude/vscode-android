import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync as spawn} from "node:child_process";
import {atomic, contained, chunkfile, readentry, digest} from "./storage.mjs";

/*//////////////////////////////////////////////////////////////////////*/

export function git(repo, args, input, optional = false) {
  const result = spawn("git", ["-c", "core.hooksPath=", ...args], {
    cwd: repo, input, windowsHide: true, maxBuffer: 512 * 1024 * 1024,
    timeout: 180000, env: {...process.env, GIT_OPTIONAL_LOCKS: "0"}
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !optional) throw new Error(result.stderr.toString().trim() || `Git failed: ${args[0]}`);
  return result.status === 0 ? result.stdout : null;
}

function excluded(relative) {
  return relative.split("/").some(part => /^(node_modules|\.claude|\.gradle|\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$/i.test(part)) || /\.(pem|p12|pfx|jks|keystore|key)$/i.test(relative);
}

function addfile(files, store, name, filename) {
  const before = fs.statSync(filename);
  if (before.size > 512 * 1024 * 1024) throw new Error(`File exceeds 512 MiB: ${name}`);
  const value = fs.readFileSync(filename);
  const after = fs.statSync(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`File changed during capture: ${name}`);
  files[name] = {...chunkfile(store, value), executable: Boolean(before.mode & 0o111)};
}

export function capture(options) {
  fs.mkdirSync(options.store, {recursive: true, mode: 0o700});
  const lock = path.join(options.store, "capture.lock");
  if (fs.existsSync(lock)) {
    let alive = true;
    try {
      const owner = JSON.parse(fs.readFileSync(lock, "utf8"));
      try {process.kill(owner.pid, 0)} catch (error) {if (error.code === "ESRCH") alive = false}
    } catch {alive = false}
    if (alive) throw new Error("A recovery snapshot is already being captured");
    fs.renameSync(lock, path.join(options.store, `capture-stale-${Date.now()}.lock`));
  }
  const descriptor = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, JSON.stringify({pid: process.pid, started: Date.now()}));
    fs.fsyncSync(descriptor);
    return capturefiles(options);
  } finally {
    fs.closeSync(descriptor);
    fs.renameSync(lock, path.join(options.store, "capture.lastlock"));
  }
}

function capturefiles({repo, store, sessions = [], codexhome, profile, name: projectname}) {
  repo = fs.realpathSync(repo);
  const gitdir = git(repo, ["rev-parse", "--absolute-git-dir"]).toString().trim();
  for (const lock of ["index.lock", "HEAD.lock", "ghdesktop/queue.json.lock"]) {
    if (fs.existsSync(path.join(gitdir, lock))) throw new Error("Git or Desktop SCM is busy; capture will retry later");
  }
  const files = {};
  const head = fs.readFileSync(path.join(gitdir, "HEAD"), "utf8");
  const refs = git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"]).toString();
  const queuepath = path.join(gitdir, "ghdesktop", "queue.json");
  const queuebytes = fs.existsSync(queuepath) ? fs.readFileSync(queuepath) : Buffer.from('{"version":1,"drafts":[]}');
  const queue = JSON.parse(queuebytes);
  const names = git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean);
  const omitted = [];
  for (const name of new Set(names)) {
    if (excluded(name)) {omitted.push(name); continue}
    const filename = contained(repo, name);
    if (!fs.existsSync(filename)) continue;
    if (!fs.statSync(filename).isFile()) {omitted.push(name); continue}
    addfile(files, store, `repo/${name}`, filename);
  }
  const objectids = new Set(refs.trim().split("\n").filter(Boolean).map(line => line.split(" ")[0]));
  const currenthead = git(repo, ["rev-parse", "--verify", "HEAD"], undefined, true)?.toString().trim();
  if (currenthead) objectids.add(currenthead);
  for (const draft of queue.drafts || []) {
    for (const key of ["tree", "basetree", "snapshottree", "basecommit"]) if (draft[key]) objectids.add(draft[key]);
  }
  const stages = git(repo, ["ls-files", "--stage", "-z"]).toString().split("\0").filter(Boolean);
  for (const stage of stages) {
    const match = stage.match(/^\d+ ([a-f0-9]{40,64}) \d\t/);
    if (match && !/^0+$/.test(match[1])) objectids.add(match[1]);
  }
  if ([...objectids].some(value => !/^[a-f0-9]{40,64}$/.test(value))) throw new Error("Invalid Git object in queue");
  const objectidentity = digest([...objectids].sort().join("\n"));
  let previous;
  try {previous = JSON.parse(fs.readFileSync(path.join(store, "published.json")))} catch {}
  if (objectids.size) {
    files["git/objects.pack"] = previous?.objectidentity === objectidentity && previous.source === repo && previous.files["git/objects.pack"]
      ? previous.files["git/objects.pack"] : chunkfile(store, git(repo, ["pack-objects", "--stdout", "--revs"], [...objectids].join("\n") + "\n"));
  }
  files["git/HEAD"] = chunkfile(store, Buffer.from(head));
  files["git/refs"] = chunkfile(store, Buffer.from(refs));
  files["git/ghdesktop/queue.json"] = chunkfile(store, queuebytes);
  if (fs.existsSync(path.join(gitdir, "index"))) addfile(files, store, "git/index", path.join(gitdir, "index"));
  if (codexhome) {
    for (const relative of sessions) {
      if (!relative.startsWith("sessions/") || !relative.endsWith(".jsonl")) throw new Error("Select individual Codex session JSONL files");
      addfile(files, store, `codex/${relative}`, contained(codexhome, relative));
    }
  }
  if (profile) {
    for (const name of ["settings.json", "keybindings.json", "extensions.json"]) {
      if (fs.existsSync(path.join(profile, name))) addfile(files, store, `profile/${name}`, path.join(profile, name));
    }
  }
  if (refs !== git(repo, ["for-each-ref", "--format=%(objectname) %(refname)"]).toString() || head !== fs.readFileSync(path.join(gitdir, "HEAD"), "utf8") || (fs.existsSync(queuepath) && !queuebytes.equals(fs.readFileSync(queuepath)))) throw new Error("Repository changed during capture; retry");
  if (previous?.source === repo && JSON.stringify(previous.files) === JSON.stringify(files) && JSON.stringify(previous.omitted) === JSON.stringify(omitted)) return previous;
  const manifest = {version: 1, id: crypto.randomUUID(), created: new Date().toISOString(), name: projectname || path.basename(repo), source: repo, objectidentity, files, omitted};
  validate(manifest);
  atomic(path.join(store, "snapshots", `${manifest.id}.json`), JSON.stringify(manifest));
  atomic(path.join(store, "latest.json"), JSON.stringify(manifest));
  atomic(path.join(store, "published.json"), JSON.stringify(manifest));
  return manifest;
}

export function validate(manifest) {
  if (manifest.version !== 1 || !manifest.files || Object.keys(manifest.files).length > 200000 || !/^[a-f0-9-]{36}$/.test(manifest.id)) throw new Error("Invalid snapshot");
  const unique = new Set();
  for (const name of Object.keys(manifest.files)) {
    const entry = manifest.files[name];
    if (!entry || !/^[a-f0-9]{64}$/.test(entry.hash) || !Array.isArray(entry.chunks) || !entry.chunks.every(hash => /^[a-f0-9]{64}$/.test(hash)) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 512 * 1024 * 1024 || entry.chunks.length !== Math.ceil(entry.size / 16384)) throw new Error("Invalid file entry");
    if (!/^(repo|git|codex|profile)\//.test(name)) throw new Error("Invalid snapshot namespace");
    contained(path.resolve("validation"), name);
    const portable = name.toLowerCase();
    if (unique.has(portable)) throw new Error("Case-colliding paths cannot be mirrored");
    unique.add(portable);
    if (name.startsWith("repo/.git/") || name === "repo/.git") throw new Error("Git metadata must use its own namespace");
    if (name.startsWith("git/") && !["git/objects.pack", "git/HEAD", "git/refs", "git/index", "git/ghdesktop/queue.json"].includes(name)) throw new Error("Unapproved Git metadata");
    if (name.startsWith("codex/") && !/^codex\/sessions\/.*\.jsonl$/.test(name)) throw new Error("Unapproved Codex state");
    if (name.startsWith("profile/") && !["profile/settings.json", "profile/keybindings.json", "profile/extensions.json"].includes(name)) throw new Error("Unapproved profile data");
  }
  return manifest;
}

/*//////////////////////////////////////////////////////////////////////*/

export function restore({manifest, store, destination}) {
  validate(manifest);
  const marker = path.join(destination, "restore.pending.json");
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) {
    if (fs.existsSync(path.join(destination, "receipt.json")) || !fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker)).id !== manifest.id) throw new Error("Restore into a new empty folder; use merge for an existing working copy");
  }
  fs.mkdirSync(destination, {recursive: true});
  atomic(marker, JSON.stringify({id: manifest.id}));
  for (const [name, entry] of Object.entries(manifest.files)) {
    const target = contained(destination, name);
    if (fs.existsSync(target)) {
      const previous = fs.readFileSync(target);
      if (digest(previous) === entry.hash) continue;
      atomic(contained(destination, `recovery/${Date.now()}/${name}`), previous);
    }
    atomic(target, readentry(store, entry));
    if (entry.executable && process.platform !== "win32") fs.chmodSync(target, 0o700);
  }
  const repo = path.join(destination, "repo");
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-b", "main"]);
  const metadata = path.join(destination, "git");
  if (manifest.files["git/objects.pack"]) git(repo, ["index-pack", "--stdin", "--strict"], fs.readFileSync(path.join(metadata, "objects.pack")));
  const refs = fs.readFileSync(path.join(metadata, "refs"), "utf8").trim().split("\n").filter(Boolean);
  for (const line of refs) {
    const [hash, ref] = line.split(" ");
    if (!/^[a-f0-9]{40,64}$/.test(hash) || !ref?.startsWith("refs/")) throw new Error("Invalid Git reference");
    git(repo, ["check-ref-format", ref]);
    git(repo, ["update-ref", ref, hash]);
  }
  const head = fs.readFileSync(path.join(metadata, "HEAD"), "utf8");
  if (!/^(ref: refs\/[a-zA-Z0-9/._-]+|[a-f0-9]{40,64})\s*$/.test(head)) throw new Error("Invalid HEAD");
  if (head.startsWith("ref: ")) git(repo, ["check-ref-format", head.trim().slice(5)]);
  else git(repo, ["cat-file", "-e", head.trim()]);
  atomic(path.join(repo, ".git", "HEAD"), head);
  for (const name of ["index", "ghdesktop/queue.json"]) {
    if (manifest.files[`git/${name}`]) atomic(contained(path.join(repo, ".git"), name), fs.readFileSync(contained(metadata, name)));
  }
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.filemode", "false"]);
  atomic(path.join(destination, "receipt.json"), JSON.stringify({snapshot: manifest.id, restored: new Date().toISOString(), files: Object.keys(manifest.files).length}));
  return {repo, codexhome: path.join(destination, "codex"), profile: path.join(destination, "profile")};
}

export function merge({manifest, base, store, repo, recovery}) {
  validate(manifest);
  if (!base) throw new Error("A common base snapshot is required for a safe merge");
  validate(base);
  const results = {applied: [], unchanged: [], conflicts: [], recovered: []};
  const names = new Set([...Object.keys(base.files), ...Object.keys(manifest.files)].filter(name => name.startsWith("repo/")));
  const pending = [];
  for (const name of names) {
    const relative = name.slice(5);
    const target = contained(repo, relative);
    const previous = base.files[name]?.hash;
    const incoming = manifest.files[name]?.hash;
    const current = fs.existsSync(target) ? digest(fs.readFileSync(target)) : undefined;
    if (current === incoming || previous === incoming) {results.unchanged.push(relative); continue}
    if (current !== previous) {
      results.conflicts.push(relative);
      if (manifest.files[name]) atomic(contained(recovery, `${manifest.id}/incoming/${relative}`), readentry(store, manifest.files[name]));
      continue;
    }
    pending.push({name, relative, target, value: manifest.files[name] ? readentry(store, manifest.files[name]) : null});
  }
  for (const item of pending) {
    if (fs.existsSync(item.target)) {
      atomic(contained(recovery, `${manifest.id}/before/${item.relative}`), fs.readFileSync(item.target));
      results.recovered.push(item.relative);
    }
    if (item.value === null) {
      const retained = contained(recovery, `${manifest.id}/deleted/${item.relative}`);
      fs.mkdirSync(path.dirname(retained), {recursive: true});
      fs.renameSync(item.target, retained);
    } else atomic(item.target, item.value);
    results.applied.push(item.relative);
  }
  atomic(contained(recovery, `${manifest.id}/receipt.json`), JSON.stringify(results));
  return results;
}
