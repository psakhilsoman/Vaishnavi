window.startButterfly = function () {
  if (window.__butterflyOn) return;
  window.__butterflyOn = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:8;";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0;
  function resize() {
    W = innerWidth;
    H = innerHeight;
    canvas.width = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  resize();
  addEventListener("resize", resize);

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const hypot = Math.hypot;
  const smooth = (t) => t * t * (3 - 2 * t);

  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }
  function turnToward(from, to, maxStep) {
    return from + clamp(wrapAngle(to - from), -maxStep, maxStep);
  }
  function rgb(c, a) {
    const s = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
    return a == null ? s : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  }

  const FORE = [
    [5, 2, 2], [16, 9, 4], [22, 24, 5], [14, 48, 2],
    [2, 58, 1], [-8, 52, 2], [-12, 34, 4], [-8, 16, 4], [0, 6, 3]
  ];
  const HIND = [
    [1, 6, 3], [-8, 16, 4], [-18, 30, 3], [-30, 28, 1],
    [-34, 16, 2], [-26, 6, 3], [-12, 3, 3], [-2, 5, 3]
  ];
  const VEINS_F = [
    [[5, 2, 2], [14, 48, 2]],
    [[5, 2, 2], [2, 58, 1]],
    [[5, 2, 2], [22, 24, 5]]
  ];
  const VEINS_H = [
    [[1, 6, 3], [-18, 30, 3]],
    [[1, 6, 3], [-30, 28, 1]]
  ];

  const OFFSET_X = 26;
  const OFFSET_Y = 34;
  const SCALE = 0.56;

  const b = {
    x: 0, y: 0, vx: 0, vy: 0,
    heading: 0, roll: 0, pitch: 0.12, phase: 0,
    flapL: 0.5, flapR: 0.5, heave: 0, beats: 6, glide: 0
  };

  let mx = 0, my = 0, cx = 0, cy = 0, hasMouse = false, ready = false, shown = 0;
  let idleTime = 0, lastMx = 0, lastMy = 0, wanderBlend = 0, inDoc = false;
  const dust = [];

  function placeAtCursor(x, y) {
    mx = x;
    my = y;
    cx = x + OFFSET_X;
    cy = y + OFFSET_Y;
    b.x = cx;
    b.y = cy;
    b.vx = 0;
    b.vy = 0;
    hasMouse = true;
    ready = true;
  }

  function trackPointer(e) {
    inDoc = true;
    if (!ready) {
      placeAtCursor(e.clientX, e.clientY);
      return;
    }
    mx = e.clientX;
    my = e.clientY;
    hasMouse = true;
  }
  addEventListener("pointermove", trackPointer, { passive: true });
  addEventListener("pointerenter", trackPointer, { passive: true });
  document.documentElement.addEventListener("mouseleave", () => { inDoc = false; });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) inDoc = false;
  });

  function rotX(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }
  function rotY(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
  }
  function rotZ(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }

  function toScreen(p) {
    p = [p[0] * SCALE, p[1] * SCALE, p[2] * SCALE];
    let q = rotX(p, b.roll);
    q = rotY(q, b.pitch);
    q = rotZ(q, b.heading);
    q = rotX(q, 0.58);
    q = rotY(q, 0.18);
    const persp = 1 + q[2] * 0.0048;
    return {
      x: b.x + q[0] * persp,
      y: b.y + b.heave + q[1] * persp - q[2] * 0.82,
      z: q[2]
    };
  }

  function wingPts(shape, side, flap, sweep) {
    return shape.map((pt) => {
      let p = [pt[0], pt[1] * side, pt[2]];
      p = rotZ(p, sweep * side);
      p = rotX(p, flap * side);
      return toScreen(p);
    });
  }

  function wingColor(flap, u) {
    const view = Math.pow(0.35 + 0.65 * Math.abs(Math.cos(flap)), 1.2);
    const blush = [255, 196, 214];
    const rose = [216, 59, 120];
    const deep = [157, 33, 88];
    const rim = [78, 22, 46];
    let c = mix(deep, rose, view);
    c = mix(c, blush, view * view * (1 - u * 0.55));
    c = mix(c, rim, smooth(clamp((u - 0.72) / 0.28, 0, 1)));
    return c;
  }

  function smoothPath(pts) {
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[0].x + pts[n - 1].x) / 2, (pts[0].y + pts[n - 1].y) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
    }
    ctx.closePath();
  }

  function drawWing(shape, veins, side, flap, sweep) {
    const pts = wingPts(shape, side, flap, sweep);
    const zAvg = pts.reduce((s, p) => s + p.z, 0) / pts.length;
    const tip = pts[3];
    const root = pts[0];
    const g = ctx.createLinearGradient(root.x, root.y, tip.x, tip.y);
    g.addColorStop(0, rgb(wingColor(flap, 0.05)));
    g.addColorStop(0.38, rgb(wingColor(flap, 0.4)));
    g.addColorStop(0.78, rgb(wingColor(flap, 0.78)));
    g.addColorStop(1, rgb(wingColor(flap, 1)));

    ctx.save();
    ctx.shadowColor = rgb(wingColor(flap, 0.2), 0.28);
    ctx.shadowBlur = 12;
    smoothPath(pts);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(78,22,46,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = (0.16 + 0.22 * Math.abs(Math.cos(flap))) * shown;
    ctx.strokeStyle = "#fff0f4";
    ctx.lineWidth = 0.65;
    ctx.lineCap = "round";
    for (const v of veins) {
      const a = toScreen(rotX(rotZ([v[0][0], v[0][1] * side, v[0][2]], sweep * side), flap * side));
      const d = toScreen(rotX(rotZ([v[1][0], v[1][1] * side, v[1][2]], sweep * side), flap * side));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(lerp(a.x, d.x, 0.5) + side * 2, lerp(a.y, d.y, 0.45), d.x, d.y);
      ctx.stroke();
    }
    ctx.globalAlpha = (0.22 + 0.2 * Math.abs(Math.cos(flap))) * shown;
    ctx.fillStyle = "#fff6f3";
    ctx.beginPath();
    ctx.arc(lerp(root.x, tip.x, 0.34), lerp(root.y, tip.y, 0.3), 4.2 * SCALE, 0, TAU);
    ctx.fill();
    ctx.restore();
    return zAvg;
  }

  function spawnDust(power) {
    const n = 1 + (power * 6) | 0;
    const back = b.heading + Math.PI;
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      dust.push({
        x: b.x - Math.cos(b.heading) * 10 + (Math.random() - 0.5) * 8,
        y: b.y + b.heave - Math.sin(b.heading) * 6 + (Math.random() - 0.5) * 6,
        vx: Math.cos(back) * (0.25 + Math.random() * 1.5) + (Math.random() - 0.5) * 0.5,
        vy: Math.sin(back) * (0.15 + Math.random() * 1.1) + (Math.random() - 0.5) * 0.5,
        life: 1,
        fade: 0.014 + Math.random() * 0.02,
        size: (k > 0.72 ? 2 + Math.random() * 2.4 : 0.6 + Math.random() * 1.3) * SCALE,
        square: k > 0.58 && k < 0.86,
        diamond: k >= 0.86,
        color: k > 0.55 ? "rgba(216,59,120," : (k > 0.28 ? "rgba(255,196,214," : "rgba(184,137,61,")
      });
    }
    if (dust.length > 280) dust.splice(0, dust.length - 280);
  }

  function strokeAngle(phase) {
    const p = ((phase % TAU) + TAU) % TAU / TAU;
    if (p < 0.36) return lerp(0.92, 0.28, smooth(p / 0.36));
    return lerp(0.28, 0.92, smooth((p - 0.36) / 0.64));
  }

  function stepPhysics(dt) {
    if (!ready) return;
    const t = performance.now() / 1000;
    const follow = 1 - Math.exp(-dt * 5.6);
    cx += (mx + OFFSET_X - cx) * follow;
    cy += (my + OFFSET_Y - cy) * follow;

    const mouseDist = hypot(mx - lastMx, my - lastMy);
    lastMx = mx;
    lastMy = my;
    if (mouseDist > 1) idleTime = 0;
    else idleTime += dt;

    const targetWander = idleTime > 1.5 ? 1 : 0;
    wanderBlend = lerp(wanderBlend, targetWander, dt * 1.5);
    const wanderX = (Math.sin(t * 0.8) * 110 + Math.sin(t * 0.35) * 160) * wanderBlend;
    const wanderY = (Math.cos(t * 0.6) * 90 + Math.sin(t * 0.45) * 140) * wanderBlend;
    const flutterX = (Math.sin(t * 5.2) * 4 + Math.sin(t * 2.3) * 6) * SCALE;
    const flutterY = (Math.cos(t * 4.4) * 3.5 + Math.sin(t * 1.9) * 5) * SCALE;
    const tx = cx + flutterX + wanderX;
    const ty = cy + flutterY + wanderY;
    const dx = tx - b.x;
    const dy = ty - b.y;
    const dist = hypot(dx, dy) || 1;

    b.vx += (dx * 16 - b.vx * 5.4) * dt;
    b.vy += (dy * 16 - b.vy * 5.4) * dt;

    const speed = hypot(b.vx, b.vy);
    if (speed > 10) b.heading = turnToward(b.heading, Math.atan2(b.vy, b.vx), 9 * dt);
    else if (dist > 12) b.heading = turnToward(b.heading, Math.atan2(dy, dx), 6 * dt);

    const yawErr = wrapAngle(Math.atan2(dy, dx) - b.heading);
    b.roll = lerp(b.roll, clamp(-yawErr * 0.32, -0.38, 0.38), 0.1);
    b.pitch = lerp(b.pitch, 0.16 + clamp(b.vy * 0.0012, -0.12, 0.14), 0.08);

    if (b.glide > 0) {
      b.glide -= dt;
      if (b.glide <= 0) b.beats = 4 + (Math.random() * 5) | 0;
    }

    const busy = 8.2 + clamp(speed / 90, 0, 3.5);
    const omega = b.glide > 0 ? 3.4 : busy;
    const prev = b.phase;
    b.phase += omega * dt;
    if (b.glide <= 0 && Math.floor(b.phase / TAU) > Math.floor(prev / TAU)) {
      b.beats -= 1;
      if (b.beats <= 0) b.glide = 0.16 + Math.random() * 0.34;
    }

    b.flapR = strokeAngle(b.phase);
    b.flapL = strokeAngle(b.phase + 0.14);
    const down = b.glide > 0 ? 0 : Math.max(0, (b.flapR < 0.5 ? 1 : 0) * (0.92 - b.flapR));
    b.heave = lerp(b.heave, Math.sin(b.phase) * -2.4, 0.35);
    b.vy -= down * 22 * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.x = clamp(b.x, 24, W - 24);
    b.y = clamp(b.y, 24, H - 24);

    if (shown > 0.45) spawnDust(clamp(0.15 + down * 0.6, 0.1, 1));
  }

  function drawDust() {
    for (let i = dust.length - 1; i >= 0; i--) {
      const p = dust[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.987;
      p.vy *= 0.987;
      p.life -= p.fade;
      if (p.life <= 0) { dust.splice(i, 1); continue; }
      ctx.fillStyle = p.color + (Math.max(0, p.life) * 0.68).toFixed(3) + ")";
      if (p.diamond) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - p.size);
        ctx.lineTo(p.x + p.size * 0.32, p.y);
        ctx.lineTo(p.x, p.y + p.size);
        ctx.lineTo(p.x - p.size * 0.32, p.y);
        ctx.closePath();
        ctx.fill();
      } else if (p.square) {
        ctx.fillRect(p.x, p.y, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.42, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawBody() {
    const thorax = toScreen([1, 0, 3]);
    const head = toScreen([15, 0, 4]);
    const mid = toScreen([-8, 0, 2]);
    const tail = toScreen([-24, 0, 1]);
    const glow = ctx.createRadialGradient(thorax.x, thorax.y, 2 * SCALE, thorax.x, thorax.y, 46 * SCALE);
    glow.addColorStop(0, "rgba(216,59,120,0.22)");
    glow.addColorStop(0.45, "rgba(255,196,214,0.08)");
    glow.addColorStop(1, "rgba(255,246,243,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(thorax.x, thorax.y, 46 * SCALE, 0, TAU);
    ctx.fill();

    ctx.lineCap = "round";
    ctx.strokeStyle = "#3c2430";
    ctx.lineWidth = 3.4 * SCALE;
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.quadraticCurveTo(thorax.x, thorax.y, mid.x, mid.y);
    ctx.quadraticCurveTo(mid.x, mid.y, tail.x, tail.y);
    ctx.stroke();

    ctx.fillStyle = "#3c2430";
    ctx.beginPath();
    ctx.ellipse(head.x, head.y, 3.6 * SCALE, 2.8 * SCALE, b.heading, 0, TAU);
    ctx.fill();

    const t = performance.now() / 1000;
    for (const side of [-1, 1]) {
      const a0 = toScreen([16, 0, 5]);
      const a1 = toScreen([26, 6 * side, 11 + Math.sin(t * 7 + side) * 1.2]);
      const a2 = toScreen([34, 9 * side, 13 + Math.sin(t * 7 + side + 0.8) * 1.6]);
      ctx.strokeStyle = "#3c2430";
      ctx.lineWidth = Math.max(0.5, 1 * SCALE);
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.quadraticCurveTo(a1.x, a1.y, a2.x, a2.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(184,137,61,0.9)";
      ctx.beginPath();
      ctx.arc(a2.x, a2.y, 1.05 * SCALE, 0, TAU);
      ctx.fill();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0.001, 0.033);
    last = now;
    ctx.clearRect(0, 0, W, H);
    if (!ready) {
      requestAnimationFrame(frame);
      return;
    }
    stepPhysics(dt);
    shown = lerp(shown, inDoc ? 1 : 0, 0.08);
    if (shown < 0.005) {
      requestAnimationFrame(frame);
      return;
    }

    ctx.save();
    ctx.globalAlpha = shown;
    drawDust();
    const sweep = (b.glide > 0 ? 0.03 : 0.11) * Math.sin(b.phase);
    const hind = 0.16;
    const wings = [
      { side: -1, shape: HIND, veins: VEINS_H, flap: b.flapL + hind, sweep: sweep * 0.55 },
      { side: 1, shape: HIND, veins: VEINS_H, flap: b.flapR + hind, sweep: sweep * 0.55 },
      { side: -1, shape: FORE, veins: VEINS_F, flap: b.flapL, sweep },
      { side: 1, shape: FORE, veins: VEINS_F, flap: b.flapR, sweep }
    ].map((w) => {
      const pts = wingPts(w.shape, w.side, w.flap, w.sweep);
      const z = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      return { ...w, z };
    }).sort((a, c) => a.z - c.z);

    let bodyDrawn = false;
    const bodyZ = toScreen([0, 0, 2]).z;
    for (const w of wings) {
      if (!bodyDrawn && w.z > bodyZ) {
        drawBody();
        bodyDrawn = true;
      }
      drawWing(w.shape, w.veins, w.side, w.flap, w.sweep);
    }
    if (!bodyDrawn) drawBody();
    ctx.restore();
    requestAnimationFrame(frame);
  }

  const stage = document.getElementById("stage");
  const rect = stage ? stage.getBoundingClientRect() : { left: W * 0.3, top: H * 0.35, width: W * 0.4, height: H * 0.3 };
  placeAtCursor(rect.left + rect.width / 2, rect.top + rect.height * 0.42);
  inDoc = true;
  requestAnimationFrame(frame);
};
