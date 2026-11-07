import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

/*//////////////////////////////////////////////////////////////////////*/

export function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function atomic(target, value) {
  fs.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
  const temporary = `${target}.${crypto.randomBytes(6).toString("hex")}.pending`;
  const descriptor = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, value);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, target);
  try {
    const directory = fs.openSync(path.dirname(target), "r");
    try {fs.fsyncSync(directory)} finally {fs.closeSync(directory)}
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
}

export function contained(root, relative) {
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.includes(":")) throw new Error("Invalid relative path");
  const parts = relative.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) throw new Error("Invalid relative path");
  if (parts.some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error("Nonportable path");
  const target = path.resolve(root, ...parts);
  const resolved = path.resolve(root);
  if (!target.startsWith(resolved + path.sep)) throw new Error("Path escapes workspace");
  let current = resolved;
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Linked workspace is not allowed");
  for (const part of parts) {
    current = path.join(current, part);
    try {if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links are not mirrored")}
    catch (error) {if (error.code !== "ENOENT") throw error}
  }
  return target;
}

export function putchunk(store, value) {
  const hash = digest(value);
  const target = path.join(store, "chunks", hash);
  if (!fs.existsSync(target)) atomic(target, zlib.gzipSync(value, {level: 6}));
  return hash;
}

export function getchunk(store, hash) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid chunk hash");
  const value = zlib.gunzipSync(fs.readFileSync(path.join(store, "chunks", hash)), {maxOutputLength: 16384});
  if (digest(value) !== hash) throw new Error("Damaged chunk");
  return value;
}

export function chunkfile(store, value) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += 16384) chunks.push(putchunk(store, value.subarray(offset, offset + 16384)));
  return {size: value.length, hash: digest(value), chunks};
}

export function readentry(store, entry) {
  if (!entry || !Array.isArray(entry.chunks) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 512 * 1024 * 1024) throw new Error("Invalid file entry");
  if (entry.chunks.length !== Math.ceil(entry.size / 16384)) throw new Error("Invalid chunk count");
  const value = Buffer.concat(entry.chunks.map(hash => getchunk(store, hash)));
  if (value.length !== entry.size || digest(value) !== entry.hash) throw new Error("File checksum mismatch");
  return value;
}

/*//////////////////////////////////////////////////////////////////////*/

export function derivekey(secret, salt) {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("Use a pairing secret of at least 16 characters");
  return crypto.pbkdf2Sync(secret, salt, 250000, 32, "sha256");
}

export function encrypt(value, key, label) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(label));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(value, key, label) {
  if (value.length < 28) throw new Error("Truncated encrypted packet");
  const cipher = crypto.createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
  cipher.setAuthTag(value.subarray(12, 28));
  cipher.setAAD(Buffer.from(label));
  return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]);
}
