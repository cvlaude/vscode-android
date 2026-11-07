import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import zlib from "node:zlib";
import {atomic, derivekey, encrypt, decrypt, getchunk, putchunk, digest, beginchunks, endchunks} from "./storage.mjs";
import {validate} from "./snapshot.mjs";

/*//////////////////////////////////////////////////////////////////////*/

export function packetkey(secret, salt) {
  if (!/^[a-f0-9]{32}$/.test(salt)) throw new Error("Invalid transfer salt");
  return derivekey(secret, Buffer.from(salt, "hex"));
}

export function chunkids(manifest) {
  return [...new Set(Object.values(validate(manifest).files).flatMap(entry => entry.chunks))];
}

export function proof(secret, method, route, nonce, body = Buffer.alloc(0)) {
  return crypto.createHmac("sha256", secret).update(`${method}\n${route}\n${nonce}\n${digest(body)}`).digest("hex");
}

export function authorize(request, secret, seen, body) {
  const nonce = request.headers["x-continuity-nonce"];
  const supplied = request.headers["x-continuity-proof"];
  if (typeof nonce !== "string" || !/^\d{13}:[a-f0-9]{32}$/.test(nonce) || typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  const now = Date.now();
  for (const [key, expiry] of seen) if (expiry < now) seen.delete(key);
  if (Math.abs(now - Number(nonce.split(":")[0])) > 300000 || seen.has(nonce)) return false;
  const expected = proof(secret, request.method, request.url, nonce, body);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return false;
  seen.set(nonce, now + 300000);
  return true;
}

async function signedfetch(peer, secret, route, options = {}, retried = false) {
  const url = new URL(peer);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/") throw new Error("Use a peer origin such as http://192.168.1.4:8765");
  const method = options.method || "GET";
  const body = options.body || Buffer.alloc(0);
  const nonce = `${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  let response;
  try {response = await fetch(new URL(route, url), {
    method, redirect: "error", signal: AbortSignal.timeout(90000),
    headers: {"x-continuity-nonce": nonce, "x-continuity-proof": proof(secret, method, route, nonce, body)},
    ...(method === "GET" ? {} : {body})
  })} catch (error) {
    if (retried || method !== "GET") throw error;
    await new Promise(resolve => setTimeout(resolve, 250));
    return signedfetch(peer, secret, route, options, true);
  }
  if (!response.ok) throw new Error(`Peer returned ${response.status}`);
  const value = Buffer.from(await response.arrayBuffer());
  if (value.length > 64 * 1024 * 1024) throw new Error("Peer response is too large");
  return value;
}

export async function pull({peer, secret, store, rate = 5120, onprogress = () => {}}) {
  const info = JSON.parse((await signedfetch(peer, secret, "/sync/info")).toString());
  const key = packetkey(secret, info.salt);
  const manifest = validate(JSON.parse(decrypt(await signedfetch(peer, secret, `/sync/manifest/${info.id}`), key, `manifest:${info.id}`)));
  if (manifest.id !== info.id) throw new Error("Snapshot identity mismatch");
  const hashes = chunkids(manifest);
  let received = 0;
  let reused = 0;
  let bytes = 0;
  if (rate === 0) beginchunks(store);
  try {
    for (const hash of hashes) {
      try {getchunk(store, hash); reused += 1; continue} catch {}
      const started = Date.now();
      const packet = await signedfetch(peer, secret, `/sync/chunk/${manifest.id}/${hash}`);
      const value = zlib.gunzipSync(decrypt(packet, key, `chunk:${hash}`), {maxOutputLength: 16384});
      if (digest(value) !== hash) throw new Error("Peer chunk checksum mismatch");
      putchunk(store, value);
      received += 1;
      bytes += packet.length;
      if (rate > 0 || received % 128 === 0) atomic(path.join(store, "progress.json"), JSON.stringify({snapshot: manifest.id, received, reused, total: hashes.length, bytes}));
      onprogress({received, reused, total: hashes.length, bytes});
      if (rate > 0) await new Promise(resolve => setTimeout(resolve, Math.max(0, packet.length * 1000 / rate - (Date.now() - started))));
    }
  } finally {if (rate === 0) endchunks(store)}
  atomic(path.join(store, "progress.json"), JSON.stringify({snapshot: manifest.id, received, reused, total: hashes.length, bytes}));
  atomic(path.join(store, "snapshots", `${manifest.id}.json`), JSON.stringify(manifest));
  atomic(path.join(store, "latest.json"), JSON.stringify(manifest));
  atomic(path.join(store, "received.json"), JSON.stringify(manifest));
  return {manifest, received, reused, bytes};
}

/*//////////////////////////////////////////////////////////////////////*/

export function exporthandoff({manifest, store, secret, filename}) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = packetkey(secret, salt);
  const temporary = `${filename}.pending`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  const write = value => fs.writeSync(descriptor, JSON.stringify(value) + "\n");
  try {
    write({format: "continuity", version: 1, salt, id: manifest.id});
    write({manifest: encrypt(Buffer.from(JSON.stringify(manifest)), key, `manifest:${manifest.id}`).toString("base64")});
    for (const hash of chunkids(manifest)) {
      write({hash, packet: encrypt(zlib.gzipSync(getchunk(store, hash)), key, `chunk:${hash}`).toString("base64")});
    }
    fs.fsyncSync(descriptor);
  } finally {fs.closeSync(descriptor)}
  fs.renameSync(temporary, filename);
  return {filename, bytes: fs.statSync(filename).size};
}

export async function importhandoff({store, secret, filename}) {
  const stream = fs.createReadStream(filename);
  const input = readline.createInterface({input: stream, crlfDelay: Infinity});
  let header;
  let manifest;
  let key;
  let count = 0;
  let allowed;
  beginchunks(store);
  try {
    for await (const line of input) {
      if (line.length > 64 * 1024 * 1024) throw new Error("Oversized handoff record");
      const value = JSON.parse(line);
      if (!header) {
        if (value.format !== "continuity" || value.version !== 1 || !/^[a-f0-9-]{36}$/.test(value.id)) throw new Error("Unsupported handoff");
        header = value;
        key = packetkey(secret, header.salt);
      } else if (!manifest) {
        manifest = validate(JSON.parse(decrypt(Buffer.from(value.manifest, "base64"), key, `manifest:${header.id}`)));
        if (manifest.id !== header.id) throw new Error("Snapshot identity mismatch");
        allowed = new Set(chunkids(manifest));
      } else {
        if (!allowed.has(value.hash)) throw new Error("Unexpected chunk");
        const bytes = zlib.gunzipSync(decrypt(Buffer.from(value.packet, "base64"), key, `chunk:${value.hash}`), {maxOutputLength: 16384});
        if (digest(bytes) !== value.hash) throw new Error("Handoff checksum mismatch");
        putchunk(store, bytes);
        count += 1;
      }
    }
    if (!manifest) throw new Error("Truncated handoff");
    for (const hash of allowed) getchunk(store, hash);
  } finally {input.close(); stream.destroy(); endchunks(store)}
  atomic(path.join(store, "snapshots", `${manifest.id}.json`), JSON.stringify(manifest));
  atomic(path.join(store, "latest.json"), JSON.stringify(manifest));
  atomic(path.join(store, "received.json"), JSON.stringify(manifest));
  return {manifest, chunks: count};
}

export function exportauth({source, secret, filename}) {
  const value = fs.readFileSync(source);
  const parsed = JSON.parse(value);
  if (!parsed.tokens && !parsed.OPENAI_API_KEY) throw new Error("No reusable Codex credentials in selected file");
  const salt = crypto.randomBytes(16).toString("hex");
  atomic(filename, JSON.stringify({format: "continuity-auth", version: 1, salt, packet: encrypt(value, packetkey(secret, salt), "auth").toString("base64")}));
  return {filename, bytes: fs.statSync(filename).size};
}

export function importauth({codexhome, secret, filename}) {
  const envelope = JSON.parse(fs.readFileSync(filename));
  if (envelope.format !== "continuity-auth" || envelope.version !== 1) throw new Error("Unsupported credential envelope");
  const value = decrypt(Buffer.from(envelope.packet, "base64"), packetkey(secret, envelope.salt), "auth");
  JSON.parse(value);
  const target = path.join(codexhome, "auth.json");
  if (fs.existsSync(target)) atomic(path.join(codexhome, "recovery", `${Date.now()}-auth.json`), fs.readFileSync(target));
  atomic(target, value);
  return {installed: true};
}
