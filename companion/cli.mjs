import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import {stdin, stdout} from "node:process";
import {configuration} from "./config.mjs";
import {atomic} from "./storage.mjs";
import {capture, restore, merge} from "./snapshot.mjs";
import {exporthandoff, importhandoff, exportauth, importauth, pull} from "./transfer.mjs";
import {createserver} from "./server.mjs";

/*//////////////////////////////////////////////////////////////////////*/

function options(values) {
  const result = {command: values[0] || "help", sessions: []};
  for (let index = 1; index < values.length; index += 1) {
    const name = values[index];
    if (["--lan", "--watch", "--follow"].includes(name)) {result[name.slice(2)] = true; continue}
    if (!name.startsWith("--") || !values[index + 1]) throw new Error(`Missing option value: ${name}`);
    if (name === "--session") result.sessions.push(values[++index]);
    else result[name.slice(2)] = values[++index];
  }
  return result;
}

async function secret(context) {
  if (!stdin.isTTY) {
    const file = process.env.CONTINUITY_SECRET_FILE;
    if (!file) throw new Error("Use an interactive prompt or CONTINUITY_SECRET_FILE pointing to a private secret file");
    return fs.readFileSync(file, "utf8").trim();
  }
  const terminal = readline.createInterface({input: stdin, output: stdout});
  try {return await terminal.question(`${context} pairing secret: `)} finally {terminal.close()}
}

async function main() {
  const args = options(process.argv.slice(2));
  if (args.command === "help") {
    stdout.write("vscode-android companion\n\nconfigure --repo PATH [--codexhome PATH] [--profile PATH] [--session sessions/...jsonl]\ncapture\nserve [--lan] [--watch] [--port 8765]\npair --peer http://ADDRESS:8765\npull [--rate 5120]\nexport --file PATH.handoff\nimport --file PATH.handoff\nrestore --destination EMPTYFOLDER\nmerge --base SNAPSHOTID --repo PATH\nauth-export --source PATH/auth.json --file PATH.handoff\nauth-import --codexhome PRIVATEFOLDER --file PATH.handoff\nstatus\n\nState location: CONTINUITY_HOME, otherwise the user application-data folder.\n");
    return;
  }
  const context = configuration();
  const {config, store, state, filename} = context;
  const latest = () => JSON.parse(fs.readFileSync(path.join(store, "latest.json"), "utf8"));
  let result;
  if (args.command === "configure") {
    if (!args.repo) throw new Error("--repo is required");
    config.repo = fs.realpathSync(args.repo);
    if (args.codexhome) config.codexhome = fs.realpathSync(args.codexhome);
    if (args.profile) config.profile = fs.realpathSync(args.profile);
    if (args.sessions.length) config.sessions = args.sessions;
    atomic(filename, JSON.stringify(config, null, 2));
    result = {configured: true, repo: config.repo, state};
  } else if (args.command === "capture") {
    const manifest = capture({...config, store});
    result = {id: manifest.id, files: Object.keys(manifest.files).length, omitted: manifest.omitted};
  } else if (args.command === "pair") {
    if (!args.peer) throw new Error("--peer is required");
    const url = new URL(args.peer);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid peer URL");
    config.peer = url.origin;
    config.secret = await secret("Other device");
    if (config.secret.length < 16) throw new Error("Secret is too short");
    atomic(filename, JSON.stringify(config, null, 2));
    result = {paired: true, peer: config.peer};
  } else if (args.command === "pull") {
    const value = await pull({peer: config.peer, secret: config.secret, store, rate: args.rate === undefined ? config.rate : Number(args.rate), onprogress: value => stdout.write(`${value.received + value.reused}/${value.total} chunks, ${value.bytes} bytes\r`)});
    result = {id: value.manifest.id, received: value.received, reused: value.reused, bytes: value.bytes};
  } else if (args.command === "export") result = exporthandoff({manifest: latest(), store, secret: await secret("Export"), filename: args.file});
  else if (args.command === "import") {
    const value = await importhandoff({store, secret: await secret("Import"), filename: args.file});
    result = {id: value.manifest.id, chunks: value.chunks};
  } else if (args.command === "restore") {
    if (!args.destination) throw new Error("--destination is required");
    result = restore({manifest: latest(), store, destination: path.resolve(args.destination)});
  } else if (args.command === "merge") {
    if (!/^[a-f0-9-]{36}$/.test(args.base || "") || !args.repo) throw new Error("--base SNAPSHOTID and --repo PATH are required");
    const base = JSON.parse(fs.readFileSync(path.join(store, "snapshots", `${args.base}.json`), "utf8"));
    const incoming = JSON.parse(fs.readFileSync(path.join(store, "received.json"), "utf8"));
    result = merge({manifest: incoming, base, store, repo: fs.realpathSync(args.repo), recovery: path.join(state, "recovery")});
  } else if (args.command === "auth-export") result = exportauth({source: args.source, secret: await secret("Credential export"), filename: args.file});
  else if (args.command === "auth-import") {
    if (!args.codexhome || !args.file) throw new Error("--codexhome and --file are required");
    result = importauth({codexhome: args.codexhome, secret: await secret("Credential import"), filename: args.file});
  } else if (args.command === "status") {
    const manifest = latest();
    result = {state, repo: config.repo, peer: config.peer, snapshot: manifest.id, created: manifest.created, files: Object.keys(manifest.files).length};
  } else if (args.command === "serve") {
    const instance = createserver(context, {port: Number(args.port || 8765), lan: Boolean(args.lan)});
    await instance.listen();
    stdout.write(`Local launcher: http://127.0.0.1:${instance.server.address().port}/#${instance.localkey}\nPairing secret is stored in ${filename}\n`);
    let timer;
    let follower;
    if (args.watch) {
      let previous = "";
      const check = () => {
        try {
          const manifest = capture({...config, store});
          const identity = JSON.stringify(manifest.files);
          if (identity !== previous) {stdout.write(`Recovery snapshot ${manifest.id}: ${Object.keys(manifest.files).length} files\n`); previous = identity}
        } catch (error) {stdout.write(`Capture pending: ${error.message}\n`)}
      };
      check();
      timer = setInterval(check, 30000);
    }
    if (args.follow) {
      let receiving = false;
      const follow = async () => {
        if (receiving || !config.peer) return;
        receiving = true;
        try {
          const result = await pull({peer: config.peer, secret: config.secret, store, rate: config.rate});
          if (result.received) stdout.write(`Mirrored ${result.manifest.id}: ${result.received} new chunks\n`);
        } catch (error) {stdout.write(`Peer unavailable; local workspace retained: ${error.message}\n`)}
        finally {receiving = false}
      };
      follow();
      follower = setInterval(follow, 30000);
    }
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {clearInterval(timer); clearInterval(follower); instance.server.closeAllConnections(); instance.server.close(() => process.exit(0))});
    return;
  } else throw new Error("Unknown command; run help");
  stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main().catch(error => {process.stderr.write(error.message + "\n"); process.exitCode = 1});
