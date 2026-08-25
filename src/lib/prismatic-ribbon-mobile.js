const stops = [
  [0.00, "rgba(255,90,40,0)"],
  [0.08, "rgba(255,96,32,0.85)"],
  [0.20, "rgba(255,168,30,0.9)"],
  [0.34, "rgba(255,226,120,0.85)"],
  [0.46, "rgba(255,255,255,0.95)"],
  [0.58, "rgba(190,240,255,0.9)"],
  [0.70, "rgba(70,190,255,0.92)"],
  [0.84, "rgba(0,102,255,0.85)"],
  [1.00, "rgba(90,60,255,0)"]
];

// Portrait tuning: gentler amplitude, much steeper tilt, smaller blur radii
// (blur cost scales with radius — matters on phones).
const LAYERS = [
  { blur: 64, width: 100, ampR: 0.110, freq: 3.4, phase: 0.0, driftR: -0.30, alpha: 0.36 },
  { blur: 42, width: 58,  ampR: 0.105, freq: 3.3, phase: 0.5, driftR: -0.26, alpha: 0.44 },
  { blur: 24, width: 30,  ampR: 0.100, freq: 3.2, phase: 0.9, driftR: -0.23, alpha: 0.56 },
  { blur: 12, width: 13,  ampR: 0.098, freq: 3.1, phase: 1.1, driftR: -0.21, alpha: 0.70 }
];

/**
 * Mounts the animated prismatic light ribbon on a <canvas>. Mobile variant.
 * Returns a cleanup function. Shipped tuning: { speed: 1, glow: 1.1 }.
 *
 * Amplitude/tilt are measured against ref = min(height, width * 1.7) rather than
 * height alone — on a tall portrait viewport, height-based amplitude makes the wave
 * absurdly steep. This keeps the ribbon reading as one band crossing the screen.
 */
export function mountRibbon(canvas, { speed = 1, glow = 1.1 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, ref = 0, raf = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    ref = Math.min(h, w * 1.7);
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const path = (t, amp, freq, phase, drift, baseY) => {
    ctx.beginPath();
    const step = Math.max(5, w / 120);
    for (let x = -40; x <= w + 40; x += step) {
      const p = x / w;
      const y = baseY
        + Math.sin(p * freq + t * 0.00042 + phase) * amp
        + Math.sin(p * (freq * 2.3) - t * 0.00027 + phase) * amp * 0.34
        + (p - 0.5) * drift;
      if (x <= -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  };

  const draw = (t) => {
    const tt = t * speed;
    ctx.clearRect(0, 0, w, h);

    const grad = ctx.createLinearGradient(0, 0, w, 0);
    stops.forEach(([o, c]) => grad.addColorStop(o, c));

    const baseY = h * 0.5;
    ctx.lineCap = "round";

    for (const L of LAYERS) {
      ctx.filter = "blur(" + L.blur + "px)";
      ctx.globalAlpha = L.alpha * glow;
      ctx.strokeStyle = grad;
      ctx.lineWidth = L.width;
      path(tt, ref * L.ampR, L.freq, L.phase, ref * L.driftR, baseY);
      ctx.stroke();
    }

    // secondary faint ribbon, slower, lower, tilted the other way
    ctx.filter = "blur(56px)";
    ctx.globalAlpha = 0.2 * glow;
    ctx.lineWidth = 72;
    path(tt * 0.7, ref * 0.13, 2.7, 2.4, ref * 0.2, baseY + h * 0.1);
    ctx.stroke();

    // bright white core
    ctx.filter = "blur(5px)";
    ctx.globalAlpha = 0.9 * glow;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 2.6;
    path(tt, ref * 0.098, 3.1, 1.1, -ref * 0.21, baseY);
    ctx.stroke();

    ctx.filter = "none";
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
