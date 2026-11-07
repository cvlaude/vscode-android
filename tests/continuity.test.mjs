import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import {DatabaseSync as databasesync} from "node:sqlite";
import {fileURLToPath as fileurl} from "node:url";
import {createRequire as createrequire} from "node:module";
import {atomic, contained, digest, getchunk, putchunk, encrypt, decrypt} from "../companion/storage.mjs";
import {capture, restore, merge, git, validate} from "../companion/snapshot.mjs";
import {exporthandoff, importhandoff, exportauth, importauth, pull, proof} from "../companion/transfer.mjs";
import {configuration} from "../companion/config.mjs";
import {createserver} from "../companion/server.mjs";
import {openmirror, upgradephone} from "../companion/mirrors.mjs";
import {importsessions} from "../companion/sessions.mjs";

const root = fileurl(new URL("../.claude/tests/", import.meta.url));
fs.mkdirSync(root, {recursive: true});
const session = fs.mkdtempSync(path.join(root, "run"));
const secret = "test-only-pairing-secret-123456789";

function fixture(name) {
  const folder = path.join(session, name);
  const repo = path.join(folder, "repo");
  const store = path.join(folder, "store");
  fs.mkdirSync(repo, {recursive: true});
  git(repo, ["init", "-b", "main"]);
  atomic(path.join(repo, "index.html"), "<h1>original</h1>\n");
  atomic(path.join(repo, "unicode.txt"), "Україна\n");
  atomic(path.join(repo, ".env"), "SECRET=excluded\n");
  atomic(path.join(repo, ".gitignore"), ".env\n.claude/\n");
  return {folder, repo, store};
}

/*//////////////////////////////////////////////////////////////////////*/

test("code copies restore without Git and upgrade without overwriting competing edits", async () => {
  const source = fixture("priority");
  const state = path.join(source.folder, "state");
  const code = path.join(source.folder, "code");
  atomic(path.join(code, "index.html"), "base\n");
  atomic(path.join(code, "priority.json"), JSON.stringify({files: ["index.html"]}));
  atomic(path.join(code, ".claude", ".stfolder", "marker.txt"), "private marker\n");
  atomic(path.join(source.repo, ".claude", ".stfolder", "marker.txt"), "private marker\n");
  const upstream = http.createServer((request, response) => {
    assert.equal(request.headers["x-api-key"], "fixture");
    response.end(JSON.stringify({globalFiles: 2, needTotalItems: 0, state: "idle", pullErrors: 0}));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  atomic(path.join(state, "native-sync.json"), JSON.stringify({endpoint: `http://127.0.0.1:${upstream.address().port}`, key: "fixture", workspaces: path.join(source.folder, "copies"), projects: [{id: "site", name: "site", path: source.repo, code}]}));
  try {
    const previous = await openmirror({state, name: "site", kind: "code"});
    assert.ok(!fs.existsSync(path.join(previous.repo, ".git")));
    assert.ok(!fs.existsSync(path.join(previous.repo, ".claude")));
    const baseline = JSON.parse(fs.readFileSync(path.join(previous.activecopy, "baseline.json")));
    const restored = restore({manifest: baseline, store: path.join(state, "store"), destination: path.join(source.folder, "restoredcode")});
    assert.equal(restored.filesonly, true);
    assert.equal(fs.readFileSync(path.join(restored.repo, "index.html"), "utf8"), "base\n");
    assert.ok(!fs.existsSync(path.join(restored.repo, ".git")));
    atomic(path.join(previous.repo, "index.html"), "phone\n");
    assert.equal((await openmirror({state, name: "site", kind: "code"})).repo, previous.repo);
    atomic(path.join(previous.repo, "phone.txt"), "phone addition\n");
    atomic(path.join(source.repo, "index.html"), "pc\n");
    git(source.repo, ["add", "index.html"]);
    const destination = await openmirror({state, name: "site", kind: "repository"});
    assert.ok(!fs.existsSync(path.join(destination.repo, ".claude")));
    const result = upgradephone({state, previous, destination});
    assert.deepEqual(result.conflicts, ["index.html"]);
    assert.equal(fs.readFileSync(path.join(destination.repo, "index.html"), "utf8"), "pc\n");
    assert.equal(fs.readFileSync(path.join(destination.repo, "phone.txt"), "utf8"), "phone addition\n");
    assert.equal(fs.readFileSync(path.join(code, "index.html"), "utf8"), "base\n");
    git(destination.repo, ["fsck", "--full"]);
  } finally {upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve))}
});

test("session imports map Windows paths, retain titles and preserve existing phone conversations", () => {
  const folder = path.join(session, "sessions");
  const source = path.join(folder, "source");
  const destination = path.join(folder, "phone");
  const id = crypto.randomUUID();
  const filename = path.join(source, "sessions", "2026", "11", "07", `rollout-${id}.jsonl`);
  const first = JSON.stringify({type: "session_meta", payload: {id, cwd: "C:\\Users\\example\\Documents\\GitHub\\site"}});
  const body = JSON.stringify({type: "event_msg", payload: {message: "saved conversation"}}) + "\n";
  atomic(filename, first + "\n" + body);
  atomic(path.join(source, "session_index.jsonl"), JSON.stringify({id, thread_name: "Site work"}) + "\n");
  const repo = path.join(folder, "working");
  const options = {source, destination, repo: folder, mapping: {"C:/Users/example/Documents/GitHub/site": repo}};
  const result = importsessions(options);
  assert.equal(result.sessions.length, 1);
  const target = result.sessions[0].file;
  const bytes = fs.readFileSync(target, "utf8");
  assert.equal(JSON.parse(bytes.split("\n")[0]).payload.cwd, repo);
  assert.ok(bytes.endsWith(body));
  assert.ok(fs.readFileSync(path.join(destination, "session_index.jsonl"), "utf8").includes("Site work"));
  assert.equal(importsessions(options).sessions.length, 0);
  assert.ok(!fs.existsSync(path.join(destination, "recovery")));
  atomic(filename, first + "\n" + body + "{}\n");
  assert.deepEqual(importsessions(options).conflicts, [id]);
  assert.equal(fs.readFileSync(target, "utf8"), bytes);
  atomic(path.join(source, "sessions", "damaged.jsonl"), Buffer.alloc(100));
  assert.equal(importsessions(options).errors.length, 1);
});

test("unborn repo, Unicode, ignored secrets and staged objects survive encrypted handoff", async () => {
  const source = fixture("unborn");
  git(source.repo, ["add", "index.html"]);
  atomic(path.join(source.repo, "index.html"), "<h1>working edit</h1>\n");
  const beforeindex = digest(fs.readFileSync(path.join(source.repo, ".git", "index")));
  const manifest = capture(source);
  assert.equal(manifest.files["repo/.env"], undefined);
  assert.equal(digest(fs.readFileSync(path.join(source.repo, ".git", "index"))), beforeindex);
  const archive = path.join(source.folder, "snapshot.handoff");
  exporthandoff({...source, manifest, secret, filename: archive});
  assert.ok(!fs.readFileSync(archive, "utf8").includes("working edit"));
  const store = path.join(source.folder, "receiver");
  await assert.rejects(importhandoff({store, secret: "wrong-secret-1234567890", filename: archive}));
  await importhandoff({store, secret, filename: archive});
  const restored = restore({store, manifest, destination: path.join(source.folder, "restored")});
  assert.equal(fs.readFileSync(path.join(restored.repo, "unicode.txt"), "utf8"), "Україна\n");
  assert.equal(git(restored.repo, ["show", ":index.html"]).toString(), "<h1>original</h1>\n");
  assert.equal(fs.readFileSync(path.join(restored.repo, "index.html"), "utf8"), "<h1>working edit</h1>\n");
  assert.equal(digest(fs.readFileSync(path.join(source.repo, ".git", "index"))), beforeindex);
  git(restored.repo, ["fsck", "--full"]);
  assert.throws(() => restore({store, manifest, destination: path.join(source.folder, "restored")}));
});

test("three-way return retains local conflicts, applies edits and preserves deletions", () => {
  const source = fixture("merge");
  const base = capture(source);
  const target = restore({...source, manifest: base, destination: path.join(source.folder, "mobile")}).repo;
  atomic(path.join(target, "index.html"), "phone edit");
  atomic(path.join(source.repo, "index.html"), "pc edit");
  atomic(path.join(source.repo, "added.txt"), "new file");
  fs.renameSync(path.join(source.repo, "unicode.txt"), path.join(source.folder, "retained.txt"));
  const incoming = capture(source);
  const recovery = path.join(source.folder, "recovery");
  const result = merge({manifest: incoming, base, store: source.store, repo: target, recovery});
  assert.deepEqual(result.conflicts, ["index.html"]);
  assert.equal(fs.readFileSync(path.join(target, "index.html"), "utf8"), "phone edit");
  assert.equal(fs.readFileSync(path.join(recovery, incoming.id, "incoming", "index.html"), "utf8"), "pc edit");
  assert.equal(fs.readFileSync(path.join(target, "added.txt"), "utf8"), "new file");
  assert.ok(!fs.existsSync(path.join(target, "unicode.txt")));
  assert.equal(fs.readFileSync(path.join(recovery, incoming.id, "deleted", "unicode.txt"), "utf8"), "Україна\n");
});

test("new commits reuse seeded Git packs and restore complete history", () => {
  const source = fixture("history");
  atomic(path.join(source.repo, "seed.bin"), crypto.randomBytes(512 * 1024));
  git(source.repo, ["add", "."]);
  git(source.repo, ["-c", "user.name=workspace test", "-c", "user.email=test@example.invalid", "commit", "-m", "seed"]);
  const first = capture(source);
  const packs = Object.keys(first.files).filter(name => name.startsWith("git/packs/"));
  assert.equal(packs.length, 1);
  atomic(path.join(source.repo, "index.html"), "<h1>next commit</h1>\n");
  git(source.repo, ["add", "index.html"]);
  git(source.repo, ["-c", "user.name=workspace test", "-c", "user.email=test@example.invalid", "commit", "-m", "next"]);
  const second = capture(source);
  assert.deepEqual(second.files[packs[0]], first.files[packs[0]]);
  const added = Object.keys(second.files).filter(name => name.startsWith("git/packs/") && !first.files[name]);
  assert.equal(added.length, 1);
  assert.ok(second.files[added[0]].size < 16384);
  const restored = restore({...source, manifest: second, destination: path.join(source.folder, "restored")});
  git(restored.repo, ["fsck", "--full"]);
  assert.equal(git(restored.repo, ["rev-list", "--count", "HEAD"]).toString().trim(), "2");
  assert.equal(git(restored.repo, ["show", "HEAD:index.html"]).toString(), "<h1>next commit</h1>\n");
  const phone = capture({...source, repo: restored.repo, activecopy: path.join(source.folder, "restored")});
  for (const name of Object.keys(second.files).filter(name => name.startsWith("git/packs/"))) assert.deepEqual(phone.files[name], second.files[name]);
  assert.equal(Object.keys(phone.files).filter(name => name.startsWith("git/packs/")).length, 2);
  assert.equal(phone.source, restored.repo);
  assert.notEqual(phone.id, second.id);
});

test("namespace traversal, ADS, Windows aliases and case collisions are rejected", () => {
  for (const name of ["../outside", "/absolute", "a/../b", "a\\b", "a:b", "nul.txt", "a.", "a /b"]) assert.throws(() => contained(session, name));
  const source = fixture("validation");
  const manifest = capture(source);
  manifest.files["repo/INDEX.HTML"] = manifest.files["repo/index.html"];
  assert.throws(() => validate(manifest), /Case-colliding/);
  delete manifest.files["repo/INDEX.HTML"];
  manifest.files["git/config"] = manifest.files["repo/index.html"];
  assert.throws(() => validate(manifest), /Unapproved/);
});

test("authenticated LAN pull deduplicates chunks and rejects wrong secrets and replay", async () => {
  const source = fixture("network");
  atomic(path.join(source.repo, "large.bin"), crypto.randomBytes(50000));
  const manifest = capture(source);
  const context = configuration(path.join(source.folder, "state"));
  context.config.secret = secret;
  context.config.repo = source.repo;
  context.store = source.store;
  const instance = createserver(context, {port: 0});
  await instance.listen();
  const peer = `http://127.0.0.1:${instance.server.address().port}`;
  const store = path.join(source.folder, "download");
  try {
    assert.equal((await fetch(`${peer}/sync/info`)).status, 401);
    await assert.rejects(pull({peer, store, secret: "incorrect-pairing-secret", rate: 0}));
    const nonce = `${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
    const headers = {"x-continuity-nonce": nonce, "x-continuity-proof": proof(secret, "GET", "/sync/info", nonce)};
    assert.equal((await fetch(`${peer}/sync/info`, {headers})).status, 200);
    assert.equal((await fetch(`${peer}/sync/info`, {headers})).status, 401);
    await assert.rejects(pull({peer, secret, store, rate: 5120, onprogress: () => {throw new Error("Simulated disconnect")}}), /Simulated disconnect/);
    assert.ok(!fs.existsSync(path.join(store, "latest.json")));
    const first = await pull({peer, secret, store, rate: 5120});
    assert.equal(first.manifest.id, manifest.id);
    assert.ok(first.received > 0);
    const second = await pull({peer, secret, store, rate: 0});
    assert.equal(second.received, 0);
    assert.equal(second.bytes, 0);
    assert.equal(second.reused, first.received + first.reused);
    atomic(path.join(source.repo, "large.bin"), "edited while an older snapshot is downloading");
    const updated = capture(source);
    atomic(path.join(source.store, "published.json"), JSON.stringify(manifest));
    const frozen = await pull({peer, secret, store: path.join(source.folder, "frozen"), rate: 0, onprogress: () => {
      atomic(path.join(source.store, "published.json"), JSON.stringify(updated));
    }});
    assert.equal(frozen.manifest.id, manifest.id);
    assert.notEqual(updated.id, manifest.id);
    const current = await pull({peer, secret, store, rate: 0});
    assert.equal(current.manifest.id, updated.id);
    assert.equal((await fetch(`${peer}/api/status`)).status, 401);
    const status = await fetch(`${peer}/api/status`, {headers: {authorization: `Bearer ${instance.localkey}`}});
    assert.equal(status.status, 200);
    assert.ok(!(await status.text()).includes(secret));
    const workbench = await fetch(`${peer}/api/workbench`, {method: "POST", headers: {authorization: `Bearer ${instance.localkey}`, "content-type": "application/json"}, body: "{}"}).then(response => response.json());
    const folder = new URL(workbench.url, peer).searchParams.get("folder");
    assert.equal(folder, process.platform === "win32" ? `/${source.repo.replaceAll("\\", "/")}` : source.repo);
  } finally {instance.server.closeAllConnections(); await new Promise(resolve => instance.server.close(resolve))}
  const restarted = createserver(context, {port: 0});
  await restarted.listen();
  try {
    assert.equal(restarted.localkey, instance.localkey);
    const address = `http://127.0.0.1:${restarted.server.address().port}`;
    assert.equal((await fetch(`${address}/api/status`, {headers: {authorization: `Bearer ${instance.localkey}`}})).status, 200);
  } finally {restarted.server.closeAllConnections(); await new Promise(resolve => restarted.server.close(resolve))}
});

test("workbench adds touch controls and preserves forwarded preview host and origin", async () => {
  const source = fixture("workbench");
  const upstream = http.createServer((request, response) => {
    if (request.url === "/login") {response.writeHead(302, {"set-cookie": "session=fixture; Path=/"}); response.end(); return}
    if (request.url.startsWith("/proxy/")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({host: request.headers.host, origin: request.headers.origin, path: request.url}));
      return;
    }
    response.setHeader("content-type", "text/html");
    response.end('<html><head><script nonce="fixture123"></script></head><body>workbench</body></html>');
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
  const context = configuration(path.join(source.folder, "state"));
  context.config.repo = source.repo;
  context.config.workbench = `http://127.0.0.1:${upstream.address().port}`;
  atomic(path.join(context.state, "workbench-password"), "fixture");
  const instance = createserver(context, {port: 0});
  await instance.listen();
  const peer = `http://127.0.0.1:${instance.server.address().port}`;
  const headers = {authorization: `Bearer ${instance.localkey}`, "content-type": "application/json"};
  try {
    assert.equal((await fetch(`${peer}/?editor=1`)).status, 200);
    assert.equal((await fetch(`${peer}/touch.js`)).status, 200);
    const result = await fetch(`${peer}/api/workbench`, {method: "POST", headers, body: "{}"}).then(response => response.json());
    const page = await fetch(new URL(result.url, peer), {headers}).then(response => response.text());
    assert.ok(page.includes('nonce="fixture123" src="/touch.js"'));
    assert.ok(page.includes('href="/touch.css"'));
    assert.ok(page.includes('nonce="fixture123" src="/display.js"'));
    assert.ok(page.includes('href="/display.css"'));
    const preview = await fetch(`${peer}/workbench/proxy/6969/page`, {headers: {...headers, origin: peer}}).then(response => response.json());
    assert.deepEqual(preview, {host: new URL(peer).host, origin: peer, path: "/proxy/6969/page"});
    const asset = await fetch(`${peer}/assets/style.css`, {headers: {...headers, referer: `${peer}/workbench/proxy/6969/page`}}).then(response => response.json());
    assert.equal(asset.path, "/proxy/6969/assets/style.css");
    const nested = await fetch(`${peer}/assets/font.woff`, {headers: {...headers, referer: `${peer}/assets/style.css`}}).then(response => response.json());
    assert.equal(nested.path, "/proxy/6969/assets/font.woff");
    assert.equal((await fetch(`${peer}/assets/private.css`, {headers: {referer: `${peer}/workbench/proxy/6969/page`}})).status, 404);
    assert.equal((await fetch(`${peer}/assets/private.css`, {headers: {...headers, referer: "https://example.invalid/workbench/proxy/6969/page"}})).status, 404);
  } finally {
    instance.server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise(resolve => instance.server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
  }
});

test("truncated handoff never becomes latest and damaged chunks are detected", async () => {
  const source = fixture("truncation");
  const manifest = capture(source);
  const archive = path.join(source.folder, "full.handoff");
  exporthandoff({...source, manifest, secret, filename: archive});
  const lines = fs.readFileSync(archive, "utf8").trim().split("\n");
  const incomplete = path.join(source.folder, "incomplete.handoff");
  atomic(incomplete, lines.slice(0, -1).join("\n") + "\n");
  const store = path.join(source.folder, "incomplete");
  await assert.rejects(importhandoff({store, secret, filename: incomplete}));
  assert.ok(!fs.existsSync(path.join(store, "latest.json")));
  const hash = Object.values(manifest.files)[0].chunks[0];
  atomic(path.join(source.store, "chunks", hash), "damaged");
  assert.throws(() => getchunk(source.store, hash));
});

test("verified replacement repairs damaged database and legacy chunks without losing evidence", () => {
  const source = fixture("repair");
  const value = Buffer.from("recovered bytes");
  const hash = putchunk(source.store, value);
  const connection = new databasesync(path.join(source.store, "chunks.sqlite"));
  try {connection.prepare("UPDATE chunks SET data = ? WHERE hash = ?").run(Buffer.from("damaged database"), hash)}
  finally {connection.close()}
  assert.throws(() => getchunk(source.store, hash));
  assert.equal(putchunk(source.store, value), hash);
  assert.deepEqual(getchunk(source.store, hash), value);
  atomic(path.join(source.store, "chunks", hash), "damaged legacy");
  assert.throws(() => getchunk(source.store, hash));
  putchunk(source.store, value);
  assert.deepEqual(getchunk(source.store, hash), value);
  const retained = fs.readdirSync(path.join(source.store, "recovery")).map(name => fs.readFileSync(path.join(source.store, "recovery", name)).toString());
  assert.ok(retained.includes("damaged database"));
  assert.ok(retained.includes("damaged legacy"));
});

test("credential envelope is separate, encrypted, and preserves an existing login", () => {
  const folder = path.join(session, "vault");
  const source = path.join(folder, "source", "auth.json");
  const codexhome = path.join(folder, "receiver");
  const filename = path.join(folder, "auth.handoff");
  const fake = JSON.stringify({tokens: {access_token: "test-only-not-a-token"}});
  atomic(source, fake);
  atomic(path.join(codexhome, "auth.json"), "previous");
  exportauth({source, secret, filename});
  assert.ok(!fs.readFileSync(filename, "utf8").includes("test-only-not-a-token"));
  assert.throws(() => importauth({codexhome, secret: "wrong-secret-123456789", filename}));
  assert.equal(fs.readFileSync(path.join(codexhome, "auth.json"), "utf8"), "previous");
  importauth({codexhome, secret, filename});
  assert.equal(fs.readFileSync(path.join(codexhome, "auth.json"), "utf8"), fake);
  assert.equal(fs.readFileSync(path.join(codexhome, "recovery", fs.readdirSync(path.join(codexhome, "recovery"))[0]), "utf8"), "previous");
});

test("Desktop SCM queue trees are included without changing source HEAD or index", () => {
  const queuefile = process.env.DESKTOP_SCM_QUEUE_MODULE;
  if (!queuefile) return;
  const queue = createrequire(import.meta.url)(queuefile);
  const source = fixture("drafts");
  const indexpath = path.join(source.repo, ".git", "index");
  const beforehead = fs.readFileSync(path.join(source.repo, ".git", "HEAD"), "utf8");
  const draft = queue.adddraft(source.repo, {title: "phone handoff test", files: ["index.html", "unicode.txt"]});
  const beforeindex = fs.existsSync(indexpath) ? digest(fs.readFileSync(indexpath)) : "missing";
  const manifest = capture(source);
  const restored = restore({...source, manifest, destination: path.join(source.folder, "restored")});
  const mirrored = queue.listdrafts(restored.repo);
  assert.equal(mirrored[0].tree, draft.tree);
  for (const key of ["tree", "basetree", "snapshottree"]) if (draft[key]) git(restored.repo, ["cat-file", "-e", draft[key]]);
  assert.equal(fs.readFileSync(path.join(source.repo, ".git", "HEAD"), "utf8"), beforehead);
  assert.equal(fs.existsSync(indexpath) ? digest(fs.readFileSync(indexpath)) : "missing", beforeindex);
});
