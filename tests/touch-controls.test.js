import test from "node:test";
import assert from "node:assert/strict";
import { bindTouchButton } from "../src/touch-controls.js";

class Button extends EventTarget {
  classes = new Set();
  classList = {
    add: (name) => this.classes.add(name),
    toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
  };
  setPointerCapture() {}
}
function pointer(button, type, id) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: id, pointerType: "touch", button: 0 });
  button.dispatchEvent(event);
}
test("gas and steering support simultaneous fingers and independent release", () => {
  const pointers = new Map(), gas = new Button(), left = new Button();
  bindTouchButton(gas, "KeyW", pointers, () => true);
  bindTouchButton(left, "KeyA", pointers, () => true);
  pointer(gas, "pointerdown", 1); pointer(left, "pointerdown", 2);
  assert.deepEqual([...pointers.values()], ["KeyW", "KeyA"]);
  pointer(left, "pointerup", 2);
  assert.deepEqual([...pointers.values()], ["KeyW"]);
  pointer(gas, "pointercancel", 1);
  assert.equal(pointers.size, 0);
  assert.equal(gas.classes.has("is-pressed"), false);
});
test("capture loss releases input and menu touches cannot accelerate", () => {
  const pointers = new Map(), gas = new Button();
  let enabled = false;
  bindTouchButton(gas, "KeyW", pointers, () => enabled);
  pointer(gas, "pointerdown", 1);
  assert.equal(pointers.size, 0);
  enabled = true;
  pointer(gas, "pointerdown", 2); pointer(gas, "pointerdown", 3);
  pointer(gas, "lostpointercapture", 2);
  assert.equal(gas.classes.has("is-pressed"), true);
  pointer(gas, "lostpointercapture", 3);
  assert.equal(pointers.size, 0);
  assert.equal(gas.classes.has("is-pressed"), false);
});
