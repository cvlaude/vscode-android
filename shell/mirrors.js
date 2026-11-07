let checkingmirrors = false;

/*//////////////////////////////////////////////////////////////////////*/

function mirrorbutton(title, name, kind) {
  const button = document.createElement("button");
  button.className = "secondary";
  button.textContent = title;
  button.dataset.kind = kind;
  button.addEventListener("click", async () => {
    try {
      await api("mirroropen", {name, kind});
      await refresh();
      while (current.operation.active) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await refresh();
      }
      if (current.operation.error) throw new Error(current.operation.error);
      await api("connect", {});
      const result = await api("workbench", {view: "editor"});
      location.assign(result.url);
    } catch (error) {text(".errormessage", error.message)}
  });
  return button;
}

function mirrorprogress(value) {
  if (!value.files) return "Waiting for PC";
  if (value.ready) return `${value.files} files ready`;
  return `${size(value.received)} / ${size(value.bytes)}`;
}

async function refreshmirrors() {
  if (checkingmirrors) return;
  checkingmirrors = true;
  try {
    const mirrors = await api("mirrors");
    if (!mirrors.available) return;
    document.querySelector(".mirrorspanel").classList.remove("hidden");
    for (const project of mirrors.projects) {
      let row = document.querySelector(`.mirrorrow[data-name="${CSS.escape(project.name)}"]`);
      if (!row) {
        row = document.createElement("div");
        row.className = "mirrorrow";
        row.dataset.name = project.name;
        const title = document.createElement("strong");
        title.textContent = project.name;
        const status = document.createElement("div");
        status.className = "mirrorstatus";
        const actions = document.createElement("div");
        actions.className = "actions";
        actions.append(mirrorbutton("Open code", project.name, "code"), mirrorbutton("Open repository", project.name, "repository"));
        row.append(title, status, actions);
        document.querySelector(".mirrorrows").append(row);
      }
      row.querySelector(".mirrorstatus").textContent = `Code: ${mirrorprogress(project.code)} | Repository: ${mirrorprogress(project.repository)}`;
      row.querySelector('[data-kind="code"]').disabled = !project.code.ready || Boolean(current?.operation.active);
      row.querySelector('[data-kind="repository"]').disabled = !project.repository.ready || Boolean(current?.operation.active);
    }
    text(".chatprogress", mirrorprogress(mirrors.chats));
  } catch (error) {text(".chatprogress", error.message)}
  finally {checkingmirrors = false}
}

refreshmirrors();
setInterval(refreshmirrors, 10000);
