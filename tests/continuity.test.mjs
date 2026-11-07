import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath as fileurl} from "node:url";
import {createRequire as createrequire} from "node:module";
import {atomic, contained, digest, getchunk, encrypt, decrypt} from "../companion/storage.mjs";
import {capture, restore, merge, git, validate} from "../companion/snapshot.mjs";
import {exporthandoff, importhandoff, exportauth, importauth, pull, proof} from "../companion/transfer.mjs";
import {configuration} from "../companion/config.mjs";
import {createserver} from "../companion/server.mjs";

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
    assert.equal((await fetch(`${peer}/api/status`)).status, 401);
    const status = await fetch(`${peer}/api/status`, {headers: {authorization: `Bearer ${instance.localkey}`}});
    assert.equal(status.status, 200);
    assert.ok(!(await status.text()).includes(secret));
    const workbench = await fetch(`${peer}/api/workbench`, {method: "POST", headers: {authorization: `Bearer ${instance.localkey}`, "content-type": "application/json"}, body: "{}"}).then(response => response.json());
    const folder = new URL(workbench.url, peer).searchParams.get("folder");
    assert.equal(folder, process.platform === "win32" ? `/${source.repo.replaceAll("\\", "/")}` : source.repo);
  } finally {instance.server.closeAllConnections(); await new Promise(resolve => instance.server.close(resolve))}
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
