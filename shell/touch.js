(() => {
  if (window.workspacetouch) return;
  window.workspacetouch = true;
  let gesture;

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
    const target = elements.find(element => element.closest(".editor-group-container")) || elements[0];
    const group = target?.closest(".editor-group-container");
    if (gesture.source.matches(".tab") && group && !target.closest(".tabs-container")) {
      return group.querySelector(".tabs-container .tab:last-child") || group.querySelector(".tabs-container") || target;
    }
    return target;
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
    if (gesture.kind === "resize") mouse(window, "mouseup", point, false);
    else if (gesture.started) {
      if (!cancelled) drag(droptarget(point), "drop", point);
      drag(gesture.source, "dragend", point);
    }
    frames(false);
    gesture = null;
  }

  /*//////////////////////////////////////////////////////////////////////*/

  document.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) {if (gesture) finish(gesture.point, true); return}
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
      frames(true);
      drag(source, "dragstart", pending.point);
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
      const target = droptarget(point);
      if (target !== gesture.target) {
        drag(gesture.target, "dragleave", point);
        drag(target, "dragenter", point);
        gesture.target = target;
      }
      drag(target, "dragover", point);
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
