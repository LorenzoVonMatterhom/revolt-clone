import test from 'node:test';
import assert from 'node:assert/strict';
import { installAudioLifecycle } from '../src/audio-lifecycle.js';

test('app switches mute looping audio immediately without animation frames and preserve manual mute', () => {
  const win = new EventTarget(), doc = new EventTarget();
  doc.hidden = false; doc.hasFocus = () => true;
  let muted = false, volume = -1;
  const listener = { context: { currentTime: 12 }, gain: { gain: {
    cancelScheduledValues() {}, setValueAtTime(value) { volume = value; },
  } } };
  const lifecycle = installAudioLifecycle(listener, win, doc, () => muted);
  assert.equal(volume, 1);
  win.dispatchEvent(new Event('blur')); assert.equal(volume, 0);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(volume, 0);
  win.dispatchEvent(new Event('focus')); assert.equal(volume, 0);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(volume, 1);
  win.dispatchEvent(new Event('pagehide')); assert.equal(volume, 0);
  win.dispatchEvent(new Event('pageshow')); assert.equal(volume, 1);
  muted = true; lifecycle.update(); assert.equal(volume, 0);
  win.dispatchEvent(new Event('blur')); win.dispatchEvent(new Event('focus')); assert.equal(volume, 0);
  muted = false; lifecycle.update(); assert.equal(volume, 1);
});
