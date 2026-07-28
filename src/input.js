// Keeps track of which keys are held down right now.
// Other files just read `input.forward`, `input.left`, etc.

export const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  handbrake: false,
  reset: false,
};

const KEYS = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "backward",
  ArrowDown: "backward",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
  KeyR: "reset",
};

function setKey(code, isDown) {
  const action = KEYS[code];
  if (action) {
    input[action] = isDown;
    return true;
  }
  return false;
}

window.addEventListener("keydown", (e) => {
  if (setKey(e.code, true)) e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  if (setKey(e.code, false)) e.preventDefault();
});
