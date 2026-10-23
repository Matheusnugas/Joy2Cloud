// Page MAIN world: overrides navigator.getGamepads() so the page sees a
// virtual Xbox controller driven by the Joy-Con (state arrives via bridge.js).
(() => {
  if (window.__joy2cloudInstalled) return;
  window.__joy2cloudInstalled = true;

  const BUTTON_COUNT = 17;
  const PAD_ID = 'Xbox 360 Controller (XInput STANDARD GAMEPAD)';
  const NavProto = Navigator.prototype;
  const originalGetGamepads = NavProto.getGamepads;

  let active = false;
  let buttons = new Array(BUTTON_COUNT).fill(0);
  let axes = [0, 0, 0, 0];
  let timestamp = performance.now();
  let cached = null;

  const actuator = {
    type: 'dual-rumble',
    effects: ['dual-rumble'],
    canPlayEffectType: (t) => t === 'dual-rumble',
    playEffect(type, params) {
      if (params && active) {
        window.postMessage({
          __joy2cloud: 2,
          type: 'rumble',
          strong: +params.strongMagnitude || 0,
          weak: +params.weakMagnitude || 0,
          duration: +params.duration || 0,
        }, '*');
      }
      return Promise.resolve('complete');
    },
    reset() {
      if (active) window.postMessage({ __joy2cloud: 2, type: 'rumble', strong: 0, weak: 0, duration: 0 }, '*');
      return Promise.resolve('complete');
    },
  };

  function defineAll(obj, props, proto) {
    const desc = {};
    for (const k of Object.keys(props)) desc[k] = { value: props[k], enumerable: true };
    Object.defineProperties(obj, desc);
    if (proto) {
      try { Object.setPrototypeOf(obj, proto); } catch (_) { /* ignore */ }
    }
    return obj;
  }

  function makeButton(value) {
    const pressed = value > 0.5;
    return defineAll({}, { pressed, touched: pressed, value },
      typeof GamepadButton !== 'undefined' ? GamepadButton.prototype : null);
  }

  function snapshot() {
    if (cached) return cached;
    cached = defineAll({}, {
      id: PAD_ID,
      index: 0,
      connected: active,
      timestamp,
      mapping: 'standard',
      axes: Object.freeze(axes.slice()),
      buttons: Object.freeze(buttons.map(makeButton)),
      vibrationActuator: actuator,
      hapticActuators: [],
    }, typeof Gamepad !== 'undefined' ? Gamepad.prototype : null);
    return cached;
  }

  function fireEvent(type, pad) {
    const ev = new Event(type);
    Object.defineProperty(ev, 'gamepad', { value: pad, enumerable: true });
    window.dispatchEvent(ev);
  }

  NavProto.getGamepads = function getGamepads() {
    if (!active) return originalGetGamepads.call(this);
    return [snapshot(), null, null, null];
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const msg = e.data;
    if (!msg || msg.__joy2cloud !== 1 || msg.type !== 'state') return;

    const wasActive = active;
    const nextActive = !!msg.active;

    if (nextActive && Array.isArray(msg.buttons) && Array.isArray(msg.axes)) {
      buttons = msg.buttons.slice(0, BUTTON_COUNT).map((v) => +v || 0);
      while (buttons.length < BUTTON_COUNT) buttons.push(0);
      axes = msg.axes.slice(0, 4).map((v) => Math.max(-1, Math.min(1, +v || 0)));
    } else if (!nextActive) {
      buttons = new Array(BUTTON_COUNT).fill(0);
      axes = [0, 0, 0, 0];
    }

    active = nextActive;
    timestamp = performance.now();
    cached = null;

    if (active && !wasActive) fireEvent('gamepadconnected', snapshot());
    if (!active && wasActive) {
      active = true;          // build a snapshot for the disconnect event
      cached = null;
      const pad = snapshot();
      active = false;
      cached = null;
      fireEvent('gamepaddisconnected', defineAll({}, { ...pad, connected: false }));
    }
  });
})();
