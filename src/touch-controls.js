export function bindTouchButton(button, code, pointers, enabled) {
  function release(event) {
    pointers.delete(event.pointerId);
    button.classList.toggle("is-pressed", [...pointers.values()].includes(code));
  }
  button.addEventListener("pointerdown", (event) => {
    if (!enabled() || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, code);
    button.classList.add("is-pressed");
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

export function createTouchControls({ enabled, onFire = () => {} }) {
  const controls = document.createElement("div");
  controls.className = "touch-controls hud";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Touch driving controls");
  const pointers = new Map();
  const groups = [
    [["KeyA", "◀", "Steer left"], ["KeyD", "▶", "Steer right"]],
    [["KeyS", "Brake", "Brake or reverse"], ["KeyW", "Gas", "Accelerate"]],
  ];
  for (const actions of groups) {
    const group = document.createElement("div");
    group.className = "touch-control-group";
    for (const [code, label, name] of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", name);
      button.dataset.code = code;
      group.append(button);
      bindTouchButton(button, code, pointers, enabled);
    }
    controls.append(group);
  }
  const pedals = controls.lastElementChild;
  pedals.classList.add("touch-pedals");
  const fireButton = document.createElement("button");
  fireButton.type = "button";
  fireButton.className = "touch-fire";
  fireButton.textContent = "Fire";
  fireButton.setAttribute("aria-label", "Fire power-up");
  fireButton.disabled = true;
  pedals.prepend(fireButton);
  fireButton.addEventListener("pointerdown", (event) => {
    if (!enabled() || fireButton.disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    fireButton.setPointerCapture(event.pointerId);
    fireButton.classList.add("is-pressed");
    onFire();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    fireButton.addEventListener(type, () => fireButton.classList.remove("is-pressed"));
  }
  fireButton.addEventListener("contextmenu", (event) => event.preventDefault());
  document.querySelector("#game").append(controls);
  function clear() {
    pointers.clear();
    for (const button of controls.querySelectorAll("button")) button.classList.remove("is-pressed");
  }
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
  return { pressed: (code) => [...pointers.values()].includes(code), clear,
    setFireEnabled: (available) => { fireButton.disabled = !available; } };
}
