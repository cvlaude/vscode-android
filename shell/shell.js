let access = location.hash.slice(1) || sessionStorage.getItem("access") || "";
if (access) sessionStorage.setItem("access", access);
history.replaceState(null, "", location.pathname);
let snapshot;
let current;
let polling = false;

/*//////////////////////////////////////////////////////////////////////*/

async function api(route, value) {
  const response = await fetch(`/api/${route}`, {
    method: value === undefined ? "GET" : "POST",
    headers: {authorization: `Bearer ${access}`, "content-type": "application/json"},
    ...(value === undefined ? {} : {body: JSON.stringify(value)})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`);
  return result;
}

function text(selector, value) {
  document.querySelectorAll(selector).forEach(element => {element.textContent = value});
}

function size(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    current = await api("status");
    snapshot = current.snapshot;
    const name = snapshot?.name || current.repo.split(/[\\/]/).at(-1) || "No folder selected";
    text(".reponame", name);
    text(".workspacename", `${name} - Workspace`);
    text(".savedtime", snapshot ? new Date(snapshot.created).toLocaleString() : "No snapshot yet");
    text(".filecount", snapshot?.files || 0);
    text(".snapshotsize", size(snapshot?.bytes || 0));
    text(".ratelabel", current.rate ? `${current.rate / 1024} KB/s` : "Unlimited");
    text(".devicename", current.platform === "win32" ? "Windows" : "Android runtime");
    text(".localpath", current.repo || "Select a repository in the companion.");
    text(".operationmessage", current.operation.message);
    text(".statusmessage", current.operation.error || current.operation.message);
    text(".errormessage", current.operation.error);
    text(".connectionlabel", current.peer ? "Paired" : "Local");
    const progress = current.operation.progress;
    const completed = progress ? progress.received + progress.reused : 0;
    text(".progresslabel", progress ? `${completed}/${progress.total}` : "");
    document.querySelector(".transferprogress").max = progress?.total || 1;
    document.querySelector(".transferprogress").value = completed;
    document.querySelectorAll('[data-action="capture"],[data-action="pull"],[data-action="restore"]').forEach(element => {element.disabled = current.operation.active});
    document.querySelector('[data-action="restore"]').disabled = current.operation.active || !snapshot;
  } catch (error) {
    text(".errormessage", error.message);
    text(".statusmessage", "Connection unavailable");
  } finally {polling = false}
}

function page(settings) {
  document.querySelector(".homepage").classList.toggle("hidden", settings);
  document.querySelector(".settingspage").classList.toggle("hidden", !settings);
  if (settings && current) {
    document.querySelector(".peerinput").value = current.peer;
    document.querySelector(".rateinput").value = current.rate;
  }
}

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    try {
      if (action === "settings" || action === "menu") return page(true);
      if (action === "home") {page(false); await refresh(); return}
      if (action === "open") {
        await api("connect", {});
        const result = await api("workbench", {});
        location.assign(result.url);
        return;
      }
      await api(action, {});
      await refresh();
    } catch (error) {text(".errormessage", error.message)}
  });
});

document.querySelector(".settingspage").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await api("config", {peer: document.querySelector(".peerinput").value.trim(), secret: document.querySelector(".secretinput").value, rate: Number(document.querySelector(".rateinput").value)});
    document.querySelector(".secretinput").value = "";
    page(false);
    await refresh();
  } catch (error) {text(".errormessage", error.message)}
});

refresh();
setInterval(refresh, 2500);
