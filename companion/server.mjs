import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import {fileURLToPath as fileurl} from "node:url";
import {atomic, encrypt, getchunk} from "./storage.mjs";
import {capture, restore} from "./snapshot.mjs";
import {authorize, packetkey, pull, importhandoff, importauth, exporthandoff} from "./transfer.mjs";
import zlib from "node:zlib";
import {background} from "./worker.mjs";
import {execFile as execfile} from "node:child_process";
import {promisify} from "node:util";

const webroot = fileurl(new URL("../shell/", import.meta.url));
const types = {".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml"};

/*//////////////////////////////////////////////////////////////////////*/

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function json(response, status, value) {
  response.writeHead(status, {"content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff"});
  response.end(JSON.stringify(value));
}

function loopback(request) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress) && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(request.headers.host || "");
}

export function createserver({config, state, store, filename}, {port = 8765, lan = false} = {}) {
  const seen = new Map();
  const localkey = crypto.randomBytes(32).toString("base64url");
  let operation = {active: false, message: "Ready", error: "", progress: null};
  let selected = "";
  let upstream = null;
  let upstreamcookie = "";
  let keysecret = "";
  let cachedkey;
  const authenticated = request => {
    if (!loopback(request)) return false;
    const candidate = request.headers.authorization?.replace(/^Bearer /, "") || (request.headers.cookie || "").split("; ").find(value => value.startsWith("continuity="))?.slice(11);
    return typeof candidate === "string" && candidate.length === localkey.length && crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(localkey));
  };
  const latest = () => JSON.parse(fs.readFileSync(path.join(store, "latest.json"), "utf8"));
  const published = () => JSON.parse(fs.readFileSync(path.join(store, "published.json"), "utf8"));
  const run = task => {
    if (operation.active) throw new Error("Another operation is running");
    operation = {active: true, message: "Working", error: "", progress: null};
    Promise.resolve().then(task).then(message => {operation = {active: false, message, error: "", progress: operation.progress}}).catch(error => {operation = {active: false, message: "Stopped", error: error.message, progress: operation.progress}});
  };

  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/health") return json(response, 200, {application: "vscode-android", version: "0.1.0"});
      if (request.url.startsWith("/sync/")) {
        const bytes = await body(request);
        if (!authorize(request, config.secret, seen, bytes)) return json(response, 401, {error: "Pairing proof required"});
        if (request.method !== "GET") return json(response, 405, {error: "Read only peer"});
        const manifest = published();
        if (keysecret !== config.secret) {cachedkey = packetkey(config.secret, config.salt); keysecret = config.secret}
        const key = cachedkey;
        let packet;
        if (request.url === "/sync/info") return json(response, 200, {salt: config.salt, id: manifest.id});
        if (request.url === `/sync/manifest/${manifest.id}`) packet = encrypt(Buffer.from(JSON.stringify(manifest)), key, `manifest:${manifest.id}`);
        else if (/^\/sync\/chunk\/[a-f0-9]{64}$/.test(request.url)) {
          const hash = request.url.split("/").at(-1);
          if (!Object.values(manifest.files).some(entry => entry.chunks.includes(hash))) return json(response, 404, {error: "Chunk is not in current snapshot"});
          packet = encrypt(zlib.gzipSync(getchunk(store, hash)), key, `chunk:${hash}`);
        } else return json(response, 404, {error: "Snapshot not found"});
        response.writeHead(200, {"content-type": "application/octet-stream", "cache-control": "no-store"});
        response.end(packet);
        return;
      }
      if (!loopback(request)) return json(response, 403, {error: "Local interface only"});
      if (request.url === "/api/connect" && request.method === "POST") {
        if (!authenticated(request)) return json(response, 401, {error: "Local access key required"});
        response.setHeader("set-cookie", `continuity=${localkey}; HttpOnly; SameSite=Strict; Path=/`);
        return json(response, 200, {connected: true});
      }
      if (request.url.startsWith("/api/")) {
        if (!authenticated(request)) return json(response, 401, {error: "Open the local link printed by the companion"});
        if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return json(response, 403, {error: "Invalid origin"});
        if (request.method === "GET" && request.url === "/api/download") {
          const archive = path.join(state, "outbox", "workspace.handoff");
          if (!fs.existsSync(archive)) return json(response, 404, {error: "Export a snapshot first"});
          response.writeHead(200, {"content-type": "application/octet-stream", "content-disposition": 'attachment; filename="workspace.handoff"', "cache-control": "no-store"});
          fs.createReadStream(archive).pipe(response);
          return;
        }
        if (request.method === "POST" && ["/api/import", "/api/authimport"].includes(request.url)) {
          if (operation.active) throw new Error("Another operation is running");
          operation = {active: true, message: "Receiving file", error: "", progress: null};
          const archive = path.join(state, "inbox", `${crypto.randomUUID()}.handoff`);
          fs.mkdirSync(path.dirname(archive), {recursive: true, mode: 0o700});
          const descriptor = fs.openSync(archive, "wx", 0o600);
          let size = 0;
          try {
            for await (const chunk of request) {
              size += chunk.length;
              if (size > 2 * 1024 * 1024 * 1024) throw new Error("Split handoffs larger than 2 GiB");
              fs.writeSync(descriptor, chunk);
            }
            fs.fsyncSync(descriptor);
          } catch (error) {
            operation = {active: false, message: "Stopped", error: error.message, progress: null};
            throw error;
          } finally {fs.closeSync(descriptor)}
          operation.active = false;
          run(async () => {
            if (request.url === "/api/authimport") {
              importauth({filename: archive, codexhome: config.codexhome, secret: config.secret});
              return "Codex credentials imported";
            }
            const result = await importhandoff({filename: archive, store, secret: config.secret});
            return `Imported ${Object.keys(result.manifest.files).length} files`;
          });
          return json(response, 202, {started: true});
        }
        if (request.method === "GET" && request.url === "/api/status") {
          let snapshot = null;
          try {
            const value = latest();
            snapshot = {id: value.id, name: value.name, created: value.created, files: Object.keys(value.files).length, bytes: Object.values(value.files).reduce((sum, item) => sum + item.size, 0), omitted: value.omitted.length};
          } catch {}
          return json(response, 200, {operation, snapshot, repo: config.repo, peer: config.peer, rate: config.rate, selected, platform: process.platform, workbench: config.workbench, paired: Boolean(config.peer)});
        }
        if (request.method !== "POST") return json(response, 405, {error: "POST required"});
        const value = JSON.parse((await body(request)).toString() || "{}");
        if (request.url === "/api/config") {
          if (operation.active) throw new Error("Wait for the current operation to finish");
          if (value.peer !== undefined) {
            if (value.peer && !/^https?:\/\/[^/@?#]+(?::\d+)?\/?$/.test(value.peer)) throw new Error("Enter a peer origin");
            config.peer = value.peer;
          }
          if (value.secret) {
            if (value.secret.length < 16) throw new Error("Pairing secret is too short");
            config.secret = value.secret;
          }
          if (value.rate !== undefined) {
            if (![0, 5120, 20480, 102400].includes(value.rate)) throw new Error("Invalid transfer limit");
            config.rate = value.rate;
          }
          atomic(filename, JSON.stringify(config, null, 2));
          return json(response, 200, {saved: true});
        }
        if (request.url === "/api/capture") run(async () => {
          if (!config.repo) throw new Error("Set the repository with the companion configure command");
          const manifest = await background("capture", {...config, store});
          return `Saved ${Object.keys(manifest.files).length} files`;
        });
        else if (request.url === "/api/pull") run(async () => {
          if (!config.peer) throw new Error("Set the other device address first");
          const result = await pull({peer: config.peer, secret: config.secret, store, rate: config.rate, onprogress: progress => {operation.progress = progress; operation.message = "Receiving snapshot"}});
          return `Received ${result.received} chunks; reused ${result.reused}`;
        });
        else if (request.url === "/api/restore") run(async () => {
          const manifest = latest();
          const destination = path.join(state, "workspaces", manifest.id);
          const result = await background("restore", {manifest, store, destination});
          selected = result.repo;
          config.repo = result.repo;
          config.name = manifest.name;
          config.activecopy = destination;
          config.pendingsessions = Object.keys(manifest.files).filter(name => name.startsWith("codex/sessions/")).map(name => name.slice(6));
          atomic(filename, JSON.stringify(config, null, 2));
          return `Working copy ready: ${manifest.name}`;
        });
        else if (request.url === "/api/sessionsimport") run(async () => {
          if (!config.activecopy || !config.pendingsessions?.length) throw new Error("Create a working copy containing selected Codex sessions first");
          const helper = fileurl(new URL("../scripts/importsessions.mjs", import.meta.url));
          const result = await promisify(execfile)(process.execPath, [helper, "--source", path.join(config.activecopy, "codex"), "--repo", config.repo, "--destination", config.codexhome], {timeout: 180000, windowsHide: true});
          const receipt = JSON.parse(result.stdout);
          config.sessions = [...new Set([...config.sessions, ...config.pendingsessions])];
          atomic(filename, JSON.stringify(config, null, 2));
          return `Imported ${receipt.imported} sessions; retained ${receipt.conflicts.length} conflicts`;
        });
        else if (request.url === "/api/export") run(async () => {
          const archive = path.join(state, "outbox", "workspace.handoff");
          fs.mkdirSync(path.dirname(archive), {recursive: true});
          await background("exporthandoff", {manifest: latest(), store, secret: config.secret, filename: archive});
          return "Export ready";
        });
        else if (request.url === "/api/workbench") {
          const target = new URL(config.workbench);
          if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || target.protocol !== "http:") throw new Error("Workbench must be a local HTTP service");
          upstream = target;
          const passwordfile = path.join(state, "workbench-password");
          if (fs.existsSync(passwordfile)) {
            const login = await fetch(new URL("/login", target), {method: "POST", redirect: "manual", headers: {"content-type": "application/x-www-form-urlencoded"}, body: new URLSearchParams({password: fs.readFileSync(passwordfile, "utf8")})});
            upstreamcookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
            if (!upstreamcookie) throw new Error("Local workbench authentication failed");
          }
          let folder = (config.repo || selected).replaceAll("\\", "/");
          if (/^[a-zA-Z]:\//.test(folder)) folder = `/${folder}`;
          return json(response, 200, {url: `/workbench/?folder=${encodeURIComponent(folder)}`});
        } else return json(response, 404, {error: "Unknown command"});
        return json(response, 202, {started: true});
      }
      if (request.url.startsWith("/workbench/")) {
        if (!authenticated(request) || !upstream) return json(response, 401, {error: "Open the workbench from the launcher"});
        const proxy = http.request({hostname: upstream.hostname, port: upstream.port, method: request.method, path: request.url.slice(10) || "/", headers: {...request.headers, host: upstream.host, origin: upstream.origin, cookie: upstreamcookie}}, result => {
          response.writeHead(result.statusCode, result.headers);
          result.pipe(response);
        });
        proxy.on("error", () => {if (!response.headersSent) json(response, 502, {error: "Local workbench is not running"}); else response.end()});
        request.pipe(proxy);
        return;
      }
      const names = {"/": "index.html", "/shell.css": "shell.css", "/shell.js": "shell.js", "/icons.svg": "icons.svg"};
      const name = names[request.url];
      if (!name) return json(response, 404, {error: "Not found"});
      response.writeHead(200, {"content-type": types[path.extname(name)], "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'", "x-content-type-options": "nosniff", "cache-control": "no-cache"});
      fs.createReadStream(path.join(webroot, name)).pipe(response);
    } catch (error) {json(response, 400, {error: error.message})}
  });
  server.on("upgrade", (request, socket, head) => {
    if (!request.url.startsWith("/workbench/") || !authenticated(request) || !upstream) {socket.destroy(); return}
    const proxy = http.request({hostname: upstream.hostname, port: upstream.port, path: request.url.slice(10) || "/", headers: {...request.headers, host: upstream.host, origin: upstream.origin, cookie: upstreamcookie}});
    proxy.on("upgrade", (response, connection, buffer) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n`);
      for (const [name, value] of Object.entries(response.headers)) socket.write(`${name}: ${value}\r\n`);
      socket.write("\r\n");
      if (head.length) connection.write(head);
      if (buffer.length) socket.write(buffer);
      connection.pipe(socket).pipe(connection);
      connection.on("error", () => socket.destroy());
      socket.on("error", () => connection.destroy());
    });
    proxy.on("error", () => socket.destroy());
    proxy.end();
  });
  return {server, localkey, listen: () => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
      atomic(path.join(state, "access.json"), JSON.stringify({origin: `http://127.0.0.1:${server.address().port}`, key: localkey}));
      resolve();
    });
  })};
}
