const vscode = require("vscode");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/*//////////////////////////////////////////////////////////////////////*/

function activate(context) {
  const controls = [
    ["explorer", "$(files)", "Explorer", "workbench.action.toggleSidebarVisibility"],
    ["scm", "$(git-branch)", "Desktop SCM", "desktopscm.openfullview"],
    ["preview", "$(open-preview)", "Live preview", "livePreview.start.internalPreview.atFile"],
    ["codex", "$(comment-discussion)", "Codex", "chatgpt.openSidebar"]
  ];
  let priority = 200;
  for (const [name, icon, title, command] of controls) {
    const registration = vscode.commands.registerCommand(`workspacemobile.${name}`, async () => {
      try {await vscode.commands.executeCommand(command)}
      catch (error) {vscode.window.showErrorMessage(`${title}: ${error.message}`)}
    });
    const button = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority--);
    button.text = ` ${icon} `;
    button.tooltip = title;
    button.accessibilityInformation = {label: title};
    button.command = `workspacemobile.${name}`;
    button.show();
    context.subscriptions.push(registration, button);
  }
  context.subscriptions.push(vscode.commands.registerCommand("workspacemobile.handoff", async () => {
    try {
      const connection = access();
      await vscode.env.openExternal(vscode.Uri.parse(`${connection.origin}/#${connection.key}`));
    } catch (error) {vscode.window.showErrorMessage(error.message)}
  }));
  context.subscriptions.push(vscode.commands.registerCommand("workspacemobile.snapshot", async () => {
    try {
      const connection = access();
      const response = await fetch(`${connection.origin}/api/capture`, {method: "POST", headers: {authorization: `Bearer ${connection.key}`, "content-type": "application/json"}, body: "{}"});
      if (!response.ok) throw new Error((await response.json()).error);
      vscode.window.setStatusBarMessage("$(check) Snapshot requested", 4000);
    } catch (error) {vscode.window.showErrorMessage(error.message)}
  }));
  const snapshot = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 190);
  snapshot.text = " $(sync) ";
  snapshot.tooltip = "Save recovery snapshot";
  snapshot.command = "workspacemobile.snapshot";
  snapshot.show();
  context.subscriptions.push(snapshot);
  let opening = false;
  const requestedview = async () => {
    if (opening) return;
    const filename = path.join(statepath(), "view.request.json");
    if (!fs.existsSync(filename)) return;
    opening = true;
    try {
      const request = JSON.parse(fs.readFileSync(filename, "utf8"));
      fs.renameSync(filename, path.join(statepath(), "view.lastrequest.json"));
      if (["codex", "scm"].includes(request.view)) await vscode.commands.executeCommand(`workspacemobile.${request.view}`);
      const actions = {closesidebar: "workbench.action.closeSidebar", closeauxiliary: "workbench.action.closeAuxiliaryBar", closegroup: "workbench.action.closeEditorsInGroup"};
      if (actions[request.view]) await vscode.commands.executeCommand(actions[request.view]);
    } catch (error) {vscode.window.showErrorMessage(error.message)}
    finally {opening = false}
  };
  requestedview();
  const timer = setInterval(requestedview, 250);
  context.subscriptions.push({dispose: () => clearInterval(timer)});
}

function statepath() {
  return process.env.CONTINUITY_HOME || path.join(process.platform === "win32" ? process.env.LOCALAPPDATA : path.join(os.homedir(), ".local", "share"), "vscode-android");
}

function access() {
  const filename = path.join(statepath(), "access.json");
  if (!fs.existsSync(filename)) throw new Error("Start the local workspace companion first");
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

module.exports = {activate};
