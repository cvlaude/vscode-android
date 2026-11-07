(() => {
  if (window.workspacetouch) return;
  window.workspacetouch = true;
  let gesture;
  let animation;

  function closebutton(target, view) {
    if (!target || target.querySelector(".workspaceclose")) return;
    const button = document.createElement("button");
    button.className = "workspaceclose";
    button.title = view === "closegroup" ? "Close editor group" : "Close pane";
    button.setAttribute("aria-label", button.title);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const tab = target.closest(".editor-group-container")?.querySelector(".tab.active");
      if (tab) {mouse(tab, "mousedown", event, true); mouse(window, "mouseup", event, false)}
      const result = await fetch("/api/viewcommand", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({view})});
      if (!result.ok) button.title = "Could not close pane";
    });
    target.classList.add("workspaceclosetitle");
    target.append(button);
  }

  function controls() {
    document.querySelectorAll(".editor-group-container > .title").forEach(target => closebutton(target, "closegroup"));
    document.querySelectorAll(".part.sidebar > .composite.title").forEach(target => closebutton(target, "closesidebar"));
    document.querySelectorAll(".part.auxiliarybar > .composite.title").forEach(target => closebutton(target, "closeauxiliary"));
  }

  let updating;
  new MutationObserver(() => {
    clearTimeout(updating);
    updating = setTimeout(controls, 100);
  }).observe(document.body, {childList: true, subtree: true});
  controls();

  /*//////////////////////////////////////////////////////////////////////*/

  function mouse(target, type, point, pressed) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: point.clientX, clientY: point.clientY,
      button: 0, buttons: pressed ? 1 : 0
    }));
  }

  function drag(target, type, point) {
    target?.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, view: window,
      clientX: point.clientX, clientY: point.clientY,
      dataTransfer: gesture.transfer
    }));
  }

  function frames(disabled) {
    document.querySelectorAll("iframe").forEach(frame => frame.classList.toggle("workspacedrag", disabled));
  }

  function droptarget(point) {
    const elements = document.elementsFromPoint(point.clientX, point.clientY);
    return elements.find(element => element.closest(".editor-group-container")) || elements[0];
  }

  function move(point) {
    if (!gesture?.started) return;
    gesture.ghost.style.transform = `translate(${point.clientX + 12}px,${point.clientY + 12}px)`;
    let target = droptarget(point);
    const scope = target?.closest(".editor-group-container, .pane, .part") || target;
    if (scope !== gesture.scope) {
      drag(gesture.target, "dragleave", point);
      gesture.scope = scope;
      drag(target, "dragenter", point);
    }
    target = droptarget(point);
    gesture.target = target;
    drag(target, "dragover", point);
  }

  function sash(point) {
    let selected;
    let distance = 12 / (window.visualViewport?.scale || 1);
    for (const element of document.querySelectorAll(".monaco-sash:not(.disabled)")) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const vertical = element.classList.contains("vertical");
      if (vertical ? point.clientY < rect.top || point.clientY > rect.bottom : point.clientX < rect.left || point.clientX > rect.right) continue;
      const offset = vertical ? Math.abs(point.clientX - (rect.left + rect.right) / 2) : Math.abs(point.clientY - (rect.top + rect.bottom) / 2);
      if (offset < distance) {selected = element; distance = offset}
    }
    return selected;
  }

  function finish(point, cancelled) {
    if (!gesture) return;
    clearTimeout(gesture.timer);
    cancelAnimationFrame(animation);
    if (gesture.kind === "resize") mouse(window, "mouseup", point, false);
    else if (gesture.started) {
      if (!cancelled) {move(point); drag(droptarget(point), "drop", point)}
      drag(gesture.source, "dragend", point);
    }
    gesture.ghost?.remove();
    frames(false);
    gesture = null;
  }

  /*//////////////////////////////////////////////////////////////////////*/

  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) {if (gesture) finish(gesture.point, true); return}
    if (gesture) finish(gesture.point, true);
    const point = event.touches[0];
    const handle = sash(point);
    if (handle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture = {kind: "resize", source: handle, point, identity: point.identifier};
      mouse(handle, "mousedown", point, true);
      return;
    }
    const source = event.target.closest?.(".tabs-container .tab[draggable='true'], .pane-header[draggable='true']");
    if (!source || event.target.closest(".action-item,button,input")) return;
    gesture = {kind: "drag", source, point, identity: point.identifier, started: false};
    const pending = gesture;
    pending.timer = setTimeout(() => {
      if (gesture !== pending) return;
      pending.started = true;
      pending.transfer = new DataTransfer();
      pending.transfer.effectAllowed = "move";
      pending.transfer.dropEffect = "move";
      pending.ghost = document.createElement("div");
      pending.ghost.className = "workspaceghost";
      pending.ghost.textContent = source.querySelector(".label-name")?.textContent || source.textContent.trim();
      document.body.append(pending.ghost);
      frames(true);
      drag(source, "dragstart", pending.point);
      move(pending.point);
    }, 300);
  }, {capture: true, passive: false});

  document.addEventListener("touchmove", event => {
    if (!gesture) return;
    const point = [...event.touches].find(touch => touch.identifier === gesture.identity);
    if (!point) {finish(gesture.point, true); return}
    if (gesture.kind === "drag" && !gesture.started) {
      if (Math.hypot(point.clientX - gesture.point.clientX, point.clientY - gesture.point.clientY) > 8) finish(point, true);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    gesture.point = point;
    if (gesture.kind === "resize") mouse(window, "mousemove", point, true);
    else {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => move(point));
    }
  }, {capture: true, passive: false});

  for (const type of ["touchend", "touchcancel"]) document.addEventListener(type, event => {
    if (!gesture) return;
    const point = [...event.changedTouches].find(touch => touch.identifier === gesture.identity) || gesture.point;
    const active = gesture.kind === "resize" || gesture.started;
    if (active) {event.preventDefault(); event.stopImmediatePropagation()}
    finish(point, type === "touchcancel");
  }, {capture: true, passive: false});

  document.addEventListener("contextmenu", event => {
    if (gesture) {event.preventDefault(); event.stopImmediatePropagation()}
  }, true);
  window.addEventListener("blur", () => {if (gesture) finish(gesture.point, true)});
})();
