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

const LAYERS = [
  { blur: 90, width: 130, ampR: 0.10,  freq: 4.2, phase: 0.0, driftR: -0.16, alpha: 0.34 },
  { blur: 60, width: 74,  ampR: 0.095, freq: 4.0, phase: 0.5, driftR: -0.12, alpha: 0.42 },
  { blur: 34, width: 38,  ampR: 0.09,  freq: 3.8, phase: 0.9, driftR: -0.10, alpha: 0.55 },
  { blur: 16, width: 16,  ampR: 0.088, freq: 3.7, phase: 1.1, driftR: -0.09, alpha: 0.70 }
];

// Mounts an animated prismatic light ribbon on a <canvas>.
// Returns a cleanup function. speed: 1 = default, glow: 1.1 = shipped value.
export function mountRibbon(canvas, { speed = 1, glow = 1.1 } = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, raf = 0;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.max(1, w * dpr);
    canvas.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // Traces one wave: two summed sines + a linear tilt across the viewport.
  const path = (t, amp, freq, phase, drift, baseY) => {
    ctx.beginPath();
    const step = Math.max(6, w / 160);
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

    const baseY = h * 0.56;
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "source-over";

    for (const L of LAYERS) {
      ctx.filter = "blur(" + L.blur + "px)";
      ctx.globalAlpha = L.alpha * glow;
      ctx.strokeStyle = grad;
      ctx.lineWidth = L.width;
      path(tt, h * L.ampR, L.freq, L.phase, h * L.driftR, baseY);
      ctx.stroke();
    }

    // secondary faint ribbon, slower and lower
    ctx.filter = "blur(70px)";
    ctx.globalAlpha = 0.22 * glow;
    ctx.lineWidth = 90;
    path(tt * 0.7, h * 0.12, 3.1, 2.4, h * 0.1, baseY + h * 0.06);
    ctx.stroke();

    // bright white core
    ctx.filter = "blur(6px)";
    ctx.globalAlpha = 0.9 * glow;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 3.2;
    path(tt, h * 0.088, 3.7, 1.1, -h * 0.09, baseY);
    ctx.stroke();

    ctx.filter = "none";
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  return () => { cancelAnimationFrame(raf); ro.disconnect(); };
}
