import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {atomic, hashpath} from "./storage.mjs";

/*//////////////////////////////////////////////////////////////////////*/

function readheader(descriptor) {
  const chunks = [];
  let length = 0;
  while (length < 1024 * 1024) {
    const buffer = Buffer.alloc(4096);
    const count = fs.readSync(descriptor, buffer, 0, buffer.length, length);
    if (!count) break;
    const newline = buffer.subarray(0, count).indexOf(10);
    chunks.push(buffer.subarray(0, newline < 0 ? count : newline));
    length += newline < 0 ? count : newline;
    if (newline >= 0) return {header: JSON.parse(Buffer.concat(chunks)), offset: length + 1};
  }
  throw new Error("Session header is missing or too large");
}

function cwd(previous, repo, mapping) {
  const normalized = String(previous || "").replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
  const candidates = Object.keys(mapping).sort((left, right) => right.length - left.length);
  for (const prefix of candidates) {
    const key = prefix.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
    if (normalized === key || normalized.startsWith(key + "/")) return path.resolve(mapping[prefix]);
  }
  return path.resolve(repo);
}

function stream(descriptor, offset, size, consume) {
  const buffer = Buffer.alloc(1024 * 1024);
  let position = offset;
  while (position < size) {
    const count = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, size - position), position);
    if (!count) throw new Error("Session was truncated while importing");
    consume(buffer.subarray(0, count));
    position += count;
  }
}

function write(descriptor, bytes) {
  let position = 0;
  while (position < bytes.length) {
    const count = fs.writeSync(descriptor, bytes, position, bytes.length - position);
    if (!count) throw new Error("Session write did not progress");
    position += count;
  }
}

export function importsessions({source, destination, repo, mapping = {}}) {
  const receipt = path.join(destination, "continuity-import.json");
  const fingerprints = fs.existsSync(receipt) ? JSON.parse(fs.readFileSync(receipt, "utf8")).fingerprints || {} : {};
  const imported = [];
  const conflicts = [];
  const errors = [];
  const identities = new Set();
  const visit = (folder, relative = "sessions") => {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true})) {
      const filename = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Linked sessions are not imported");
      if (entry.isDirectory()) {visit(filename, `${relative}/${entry.name}`); continue}
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const descriptor = fs.openSync(filename, "r");
      let output;
      try {
        const before = fs.fstatSync(descriptor);
        const {header, offset} = readheader(descriptor);
        if (header.type !== "session_meta" || !/^[a-f0-9-]{36}$/.test(header.payload?.id || "")) throw new Error("Invalid session metadata");
        identities.add(header.payload.id);
        const previouscwd = header.payload.cwd;
        header.payload.cwd = cwd(previouscwd, repo, mapping);
        const target = path.join(destination, relative, entry.name);
        const existing = fs.existsSync(target) ? fs.statSync(target) : null;
        const cached = fingerprints[target];
        if (existing && cached && cached.sourcesize === before.size && cached.sourcemodified === before.mtimeMs && cached.targetsize === existing.size && cached.targetmodified === existing.mtimeMs && cached.cwd === header.payload.cwd) {
          if (cached.conflict) conflicts.push(header.payload.id);
          continue;
        }
        const first = Buffer.from(JSON.stringify(header) + "\n");
        if (existing) {
          const comparison = crypto.createHash("sha256").update(first);
          stream(descriptor, offset, before.size, bytes => comparison.update(bytes));
          if (hashpath(target) === comparison.digest("hex")) {
            fingerprints[target] = {sourcesize: before.size, sourcemodified: before.mtimeMs, targetsize: existing.size, targetmodified: existing.mtimeMs, cwd: header.payload.cwd, conflict: false};
            continue;
          }
        }
        fs.mkdirSync(path.dirname(target), {recursive: true});
        const pending = target + ".import.pending";
        if (fs.existsSync(pending)) fs.renameSync(pending, pending + "." + Date.now());
        output = fs.openSync(pending, "wx", 0o600);
        const hash = crypto.createHash("sha256");
        write(output, first);
        hash.update(first);
        stream(descriptor, offset, before.size, bytes => {write(output, bytes); hash.update(bytes)});
        fs.fsyncSync(output);
        fs.closeSync(output);
        output = undefined;
        const after = fs.fstatSync(descriptor);
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("Session changed during import; retry after synchronization");
        const digest = hash.digest("hex");
        if (fs.existsSync(target)) {
          const duplicate = hashpath(target) === digest;
          const recovery = path.join(destination, "recovery", duplicate ? "duplicates" : "incoming", digest + ".jsonl");
          fs.mkdirSync(path.dirname(recovery), {recursive: true});
          fs.renameSync(pending, fs.existsSync(recovery) ? recovery + "." + Date.now() : recovery);
          if (!duplicate) conflicts.push(header.payload.id);
        } else {
          fs.renameSync(pending, target);
          imported.push({id: header.payload.id, file: target, sourcecwd: previouscwd, cwd: header.payload.cwd});
        }
        const saved = fs.statSync(target);
        fingerprints[target] = {sourcesize: before.size, sourcemodified: before.mtimeMs, targetsize: saved.size, targetmodified: saved.mtimeMs, cwd: header.payload.cwd, conflict: conflicts.includes(header.payload.id)};
      } catch (error) {
        errors.push({file: filename, error: error.message});
      } finally {
        if (output !== undefined) fs.closeSync(output);
        fs.closeSync(descriptor);
        atomic(receipt, JSON.stringify({created: new Date().toISOString(), sessions: imported, conflicts, errors, fingerprints}, null, 2));
      }
    }
  };
  visit(path.join(source, "sessions"));
  const index = path.join(source, "session_index.jsonl");
  const targetindex = path.join(destination, "session_index.jsonl");
  if (fs.existsSync(index)) {
    const lines = filename => fs.readFileSync(filename, "utf8").split("\n").filter(Boolean).flatMap((line, number) => {
      try {return [JSON.parse(line)]}
      catch {errors.push({file: filename, line: number + 1, error: "Invalid title index line"}); return []}
    });
    const existingraw = fs.existsSync(targetindex) ? fs.readFileSync(targetindex, "utf8") : "";
    const existing = fs.existsSync(targetindex) ? lines(targetindex) : [];
    const titles = new Set(existing.map(value => value.id));
    const selected = lines(index).filter(value => {
      if (!identities.has(value.id) || titles.has(value.id)) return false;
      titles.add(value.id);
      return true;
    });
    if (selected.length) {
      if (existingraw && errors.some(error => error.file === targetindex)) atomic(path.join(destination, "recovery", `titles-${Date.now()}.jsonl`), existingraw);
      atomic(targetindex, [...existing, ...selected].map(value => JSON.stringify(value)).join("\n") + "\n");
    }
  }
  const result = {created: new Date().toISOString(), sessions: imported, conflicts, errors, fingerprints};
  atomic(receipt, JSON.stringify(result, null, 2));
  return result;
}
