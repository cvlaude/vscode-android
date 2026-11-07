(() => {
  const bridge = window.workspaceandroid;
  if (!bridge || window.workspacedisplay) return;
  window.workspacedisplay = true;
  let updating;

  /*//////////////////////////////////////////////////////////////////////*/

  function zoom(direction) {
    const current = bridge.getscale();
    bridge.setscale(direction === 0 ? 66 : current + direction * 6);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", code: "Escape", keyCode: 27, bubbles: true}));
  }

  function menus() {
    for (const list of document.querySelectorAll(".monaco-menu .actions-container")) {
      const labels = [...list.querySelectorAll(".action-label")].map(item => item.textContent.replaceAll("&", "").trim());
      if (!labels.includes("Appearance") || !labels.includes("Editor Layout") || list.querySelector(".workspacezoom")) continue;
      for (const [label, direction] of [["Zoom In", 1], ["Zoom Out", -1], ["Reset Zoom", 0]]) {
        const row = document.createElement("li");
        row.className = "action-item workspacezoom";
        row.setAttribute("role", "presentation");
        const button = document.createElement("a");
        button.className = "action-menu-item";
        button.setAttribute("role", "menuitem");
        button.tabIndex = 0;
        const check = document.createElement("span");
        check.className = "menu-item-check";
        const title = document.createElement("span");
        title.className = "action-label";
        title.textContent = label;
        button.append(check, title);
        const activate = event => {event.preventDefault(); event.stopImmediatePropagation(); zoom(direction)};
        button.addEventListener("click", activate);
        button.addEventListener("keydown", event => {if (["Enter", " "].includes(event.key)) activate(event)});
        row.append(button);
        list.append(row);
      }
    }
  }

  function overlap(left, right) {
    return left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
  }

  function geometry() {
    const data = JSON.parse(bridge.getgeometry());
    if (!data.width || !data.height) return;
    const horizontal = innerWidth / data.width;
    const vertical = innerHeight / data.height;
    const corner = Math.round(data.corner * horizontal);
    document.documentElement.style.setProperty("--workspacecorner", corner + "px");
    for (const position of ["top", "bottom"]) {
      if (document.querySelector(".workspacecorner" + position)) continue;
      const square = document.createElement("div");
      square.className = "workspacecorner workspacecorner" + position;
      document.body.append(square);
    }
    document.querySelectorAll(".workspacenotchrow, .workspacenotchwebview").forEach(item => item.classList.remove("workspacenotchrow", "workspacenotchwebview"));
    for (const raw of data.cutouts) {
      const cutout = {left: raw.left * horizontal, top: raw.top * vertical, right: raw.right * horizontal, bottom: raw.bottom * vertical};
      for (const row of document.querySelectorAll(".monaco-list-row")) {
        const rect = row.getBoundingClientRect();
        if (!overlap(rect, cutout)) continue;
        const content = row.querySelector(".monaco-tl-row") || row.firstElementChild;
        if (!content) continue;
        const inset = Math.max(0, cutout.right - rect.left + 6);
        content.style.setProperty("--workspacenotch", inset + "px");
        content.classList.add("workspacenotchrow");
      }
      for (const panel of document.querySelectorAll(".webview-overlay-content")) {
        const rect = panel.getBoundingClientRect();
        if (!overlap(rect, cutout)) continue;
        panel.style.setProperty("--workspacewidth", rect.width + "px");
        panel.style.setProperty("--workspacenotch", Math.max(0, cutout.right - rect.left + 6) + "px");
        panel.classList.add("workspacenotchwebview");
      }
    }
  }

  function schedule() {
    if (updating) return;
    updating = requestAnimationFrame(() => {
      updating = null;
      menus();
      geometry();
    });
  }

  new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true});
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("workspacegeometry", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  schedule();
})();
