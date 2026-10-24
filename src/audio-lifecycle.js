// Mute the shared audio graph directly: animation frames may stop in Android's
// background tabs while looping Web Audio sources keep playing.
export function installAudioLifecycle(listener, win, doc, isMuted) {
  let focused = doc.hasFocus();
  let pageHidden = false;
  const update = () => {
    const gain = listener.gain.gain;
    const now = listener.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(doc.hidden || pageHidden || !focused || isMuted() ? 0 : 1, now);
  };
  win.addEventListener("blur", () => { focused = false; update(); });
  win.addEventListener("focus", () => { focused = true; update(); });
  win.addEventListener("pagehide", () => { pageHidden = true; update(); });
  win.addEventListener("pageshow", () => { pageHidden = false; focused = doc.hasFocus(); update(); });
  doc.addEventListener("visibilitychange", update);
  update();
  return { update };
}
