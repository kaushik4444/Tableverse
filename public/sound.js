/* Small synthesized sound effects (Web Audio, no audio files). Mute is remembered per browser. */
(() => {
  'use strict';
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('ct_mute') === '1'; } catch { /* ignore */ }
  // the volume (0 to 100, kept on this device): every sound goes through one gain node, so one setting sets them all
  let volume = 100;
  try { const v = Number(localStorage.getItem('ct_volume')); if (Number.isFinite(v) && localStorage.getItem('ct_volume') !== null) volume = Math.min(100, Math.max(0, v)); } catch { /* ignore */ }
  let master = null;
  function out(a) {
    if (!master) { master = a.createGain(); master.gain.value = volume / 100; master.connect(a.destination); }
    return master;
  }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, t0, dur, { type = 'sine', vol = 0.18, slide = 0 } = {}) {
    const a = ac();
    if (!a) return;
    const o = a.createOscillator();
    const g = a.createGain();
    const t = a.currentTime + t0;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out(a));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise(t0, dur, vol = 0.2, hp = 1800) {
    const a = ac();
    if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    f.type = 'highpass';
    f.frequency.value = hp;
    g.gain.value = vol;
    s.buffer = buf;
    s.connect(f).connect(g).connect(out(a));
    s.start(a.currentTime + t0);
  }

  let noiseBuf = null;
  /** Band-passed noise whose centre frequency sweeps from f0 to f1: the "swish" of a card moving through air. */
  function swish(t0, dur, { vol = 0.3, f0 = 3000, f1 = 900, q = 1 } = {}) {
    const a = ac();
    if (!a) return;
    if (!noiseBuf) {
      noiseBuf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const s = a.createBufferSource();
    const f = a.createBiquadFilter();
    const g = a.createGain();
    const t = a.currentTime + t0;
    s.buffer = noiseBuf;
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(out(a));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    // refined tactile card play: crisp tactile swish with warm wood/felt thud
    card: () => {
      swish(0, 0.09, { vol: 0.28, f0: 3200, f1: 1100, q: 0.8 });
      tone(110, 0.015, 0.09, { type: 'sine', vol: 0.22, slide: 0.45 });
      tone(65, 0.03, 0.06, { type: 'triangle', vol: 0.15 });
    },
    // deal: smooth riffle cascade
    deal: () => {
      for (let i = 0; i < 5; i++) {
        swish(i * 0.06, 0.06, { vol: 0.22, f0: 4000, f1: 1500, q: 0.9 });
        tone(140 + i * 15, i * 0.06 + 0.02, 0.05, { type: 'sine', vol: 0.08 });
      }
    },
    // collect: graceful sweep into winner's pile
    collect: () => {
      swish(0, 0.28, { vol: 0.32, f0: 800, f1: 2800, q: 0.75 });
      tone(261.63, 0.02, 0.15, { type: 'triangle', vol: 0.08, slide: 1.5 });
      tone(329.63, 0.08, 0.18, { type: 'triangle', vol: 0.08, slide: 1.4 });
    },
    // a mark set on a square: a soft wooden tap
    place: () => {
      tone(720, 0, 0.07, { type: 'sine', vol: 0.12, slide: 0.8 });
      tone(120, 0.005, 0.09, { type: 'sine', vol: 0.22, slide: 0.5 });
    },
    // a disc dropped into a column: the fall (a short swish, at the start) and the landing (a thud and a small bounce)
    fall: () => swish(0, 0.2, { vol: 0.14, f0: 2400, f1: 700, q: 0.9 }),
    land: () => {
      tone(160, 0, 0.1, { type: 'sine', vol: 0.26, slide: 0.45 });
      tone(210, 0.12, 0.05, { type: 'sine', vol: 0.1, slide: 0.6 });
    },
    chat: () => { tone(523.25, 0, 0.06, { type: 'sine', vol: 0.1 }); tone(659.25, 0.05, 0.08, { type: 'sine', vol: 0.1 }); },
    tick: () => tone(587.33, 0, 0.05, { type: 'sine', vol: 0.08 }),
    turn: () => { tone(523.25, 0, 0.12, { type: 'triangle', vol: 0.15 }); tone(659.25, 0.1, 0.18, { type: 'triangle', vol: 0.18 }); tone(783.99, 0.2, 0.25, { type: 'triangle', vol: 0.22 }); },
    win: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.08, 0.25, { type: 'triangle', vol: 0.18 }));
    },
    lose: () => tone(220, 0, 0.25, { type: 'triangle', vol: 0.15, slide: 0.6 }),
    round: () => { tone(392, 0, 0.15, { type: 'triangle', vol: 0.15 }); tone(523.25, 0.12, 0.25, { type: 'triangle', vol: 0.18 }); },
    fanfare: () => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.12, 0.35, { type: 'triangle', vol: 0.2 }));
      tone(1046.5, 0.5, 0.6, { type: 'sine', vol: 0.18, slide: 1.05 });
    },
    emote: () => tone(783.99, 0, 0.1, { type: 'sine', vol: 0.12, slide: 1.3 }),
    // a game starts: a rising, open chord (softer than the turn cue)
    start: () => { tone(392, 0, 0.14, { type: 'sine', vol: 0.14 }); tone(523.25, 0.1, 0.14, { type: 'sine', vol: 0.14 }); tone(659.25, 0.2, 0.26, { type: 'sine', vol: 0.16 }); },
    // someone sits down at your table, or leaves it
    join: () => { tone(659.25, 0, 0.1, { type: 'sine', vol: 0.12 }); tone(880, 0.07, 0.16, { type: 'sine', vol: 0.12 }); },
    leave: () => tone(440, 0, 0.14, { type: 'sine', vol: 0.1, slide: 0.7 }),
    // a friend request or table invitation arrives
    notify: () => { tone(987.77, 0, 0.09, { type: 'sine', vol: 0.12 }); tone(1318.5, 0.09, 0.18, { type: 'sine', vol: 0.1 }); },
    // a soft tap on one of the app's own buttons
    tap: () => { swish(0, 0.03, { vol: 0.07, f0: 4200, f1: 2200, q: 1.1 }); tone(1500, 0, 0.02, { type: 'triangle', vol: 0.03 }); },
    // a check in chess: two short, high taps
    check: () => { tone(830.61, 0, 0.09, { type: 'triangle', vol: 0.14 }); tone(830.61, 0.12, 0.09, { type: 'triangle', vol: 0.14 }); },
    // dice thrown: a quick rattle of clicks, then the die lands
    dice: () => {
      for (let i = 0; i < 6; i++) {
        swish(i * 0.045, 0.04, { vol: 0.16 + (i % 2) * 0.05, f0: 5200 - i * 300, f1: 2600, q: 1.2 });
        tone(900 + (i % 3) * 140, i * 0.045, 0.03, { type: 'triangle', vol: 0.04 });
      }
      tone(140, 0.28, 0.1, { type: 'sine', vol: 0.16, slide: 0.6 });
    },
    // poker chips: a few soft clinks
    chip: () => { [0, 0.05, 0.1].forEach((t, i) => { tone(2000 + i * 220, t, 0.05, { type: 'triangle', vol: 0.06 }); swish(t, 0.03, { vol: 0.1, f0: 6000, f1: 3800, q: 1.5 }); }); },
    allin: () => { for (let i = 0; i < 7; i++) { const t = i * 0.05; tone(1800 + (i % 3) * 260, t, 0.05, { type: 'triangle', vol: 0.05 }); swish(t, 0.03, { vol: 0.09, f0: 6000, f1: 3800, q: 1.5 }); } tone(140, 0.3, 0.3, { type: 'sine', vol: 0.15, slide: 0.6 }); },
    fold: () => swish(0, 0.14, { vol: 0.18, f0: 3200, f1: 900, q: 0.7 }),
    // carrom: `power` is the impact speed, 0 to about 2; harder impacts are louder and a little brighter
    clack: (power = 0.5) => {
      const k = Math.min(1, Math.max(0.15, power / 1.2));
      tone(1500 + 900 * k, 0, 0.05, { type: 'triangle', vol: 0.05 + 0.16 * k, slide: 0.6 });
      tone(420, 0, 0.035, { type: 'sine', vol: 0.04 + 0.1 * k });
    },
    rail: (power = 0.5) => {
      const k = Math.min(1, Math.max(0.15, power / 1.2));
      tone(150, 0, 0.07, { type: 'sine', vol: 0.06 + 0.16 * k, slide: 0.55 });
      swish(0, 0.05, { vol: 0.04 + 0.08 * k, f0: 1500, f1: 600, q: 0.8 });
    },
    pocket: () => {
      tone(190, 0, 0.12, { type: 'sine', vol: 0.2, slide: 0.45 });
      swish(0.02, 0.1, { vol: 0.1, f0: 1200, f1: 400, q: 0.8 });
      tone(95, 0.1, 0.09, { type: 'triangle', vol: 0.14 });
    },
    // Sea Battle: a shot that falls into the water, a hit, and a ship going down
    splash: () => { swish(0, 0.32, { vol: 0.16, f0: 2600, f1: 500, q: 0.8 }); tone(900, 0.12, 0.12, { type: 'sine', vol: 0.06, slide: 0.5 }); },
    boom: () => { noise(0, 0.28, 0.22, 200); tone(120, 0, 0.3, { type: 'sine', vol: 0.22, slide: 0.4 }); },
    sink: () => { tone(160, 0, 0.9, { type: 'sawtooth', vol: 0.08, slide: 0.25 }); noise(0.15, 0.7, 0.12, 120); },
    // Falling Blocks: a piece locking, junk rows arriving, a row cleared
    lock: () => { tone(260, 0, 0.07, { type: 'triangle', vol: 0.16, slide: 0.6 }); swish(0, 0.05, { vol: 0.08, f0: 1400, f1: 500, q: 1 }); },
    garbage: () => { noise(0, 0.35, 0.2, 80); tone(90, 0, 0.35, { type: 'square', vol: 0.06, slide: 0.7 }); },
    clear: () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.05, 0.16, { type: 'triangle', vol: 0.12 })); },
    // Memory Match: a pair found, and two cards that do not match
    match: () => { tone(1046.5, 0, 0.12, { type: 'sine', vol: 0.12 }); tone(1568, 0.07, 0.18, { type: 'sine', vol: 0.1 }); },
    mismatch: () => { tone(196, 0, 0.14, { type: 'square', vol: 0.06, slide: 0.9 }); tone(174.6, 0.16, 0.16, { type: 'square', vol: 0.05, slide: 0.9 }); },
  };

  window.CardTable = window.CardTable || {};
  window.CardTable.sound = {
    play(name, arg) { if (muted || !SOUNDS[name]) return; try { SOUNDS[name](arg); } catch { /* ignore */ } },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('ct_mute', muted ? '1' : '0'); } catch { /* ignore */ }
      if (!muted) SOUNDS.tick();
      return muted;
    },
    isMuted: () => muted,
    volume: () => volume,
    setVolume(v) {
      volume = Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
      try { localStorage.setItem('ct_volume', String(volume)); } catch { /* ignore */ }
      if (master && ctx) master.gain.setValueAtTime(volume / 100, ctx.currentTime);
    },
    button: () => `<button class="btn ghost small sound-btn" data-act="sound" aria-label="${muted ? 'Turn sound on' : 'Turn sound off'}">${muted ? '🔇' : '🔊'}</button>`,
  };

  // browsers only allow audio after a user gesture
  const unlock = () => { ac(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
})();
