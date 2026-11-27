(() => {
  const canvas = document.getElementById("viz");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  canvas.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });

  let bins = new Float32Array(128);
  let pulse = 0;
  let beatFlash = 0;
  let bursts = [];

  const es = new EventSource("/stream");
  es.onmessage = (e) => {
    const f = JSON.parse(e.data);
    bins = new Float32Array(f.bins);
    if (f.beat) {
      pulse = 1;
      beatFlash = 1;
      bursts.push({ r: 8, a: 0.9 });
      if (bursts.length > 6) bursts.shift();
    }
  };

  function hsl(h, s, l, a = 1) {
    h = ((h % 360) + 360) % 360;
    return `hsla(${h.toFixed(1)},${s.toFixed(1)}%,${l.toFixed(1)}%,${a})`;
  }

  const schemes = ["random", "mono", "analogous", "complementary", "triadic", "neon"];
  function makePalette() {
    const base = Math.random() * 360;
    const scheme = schemes[(Math.random() * schemes.length) | 0];
    const cols = [];
    const n = 6;
    if (scheme === "mono") {
      for (let i = 0; i < n; i++) cols.push({ h: base, s: 65 + Math.random() * 25, l: 32 + i * 9 });
    } else if (scheme === "analogous") {
      for (let i = 0; i < n; i++) cols.push({ h: base - 45 + i * 18, s: 78, l: 42 + (i % 3) * 11 });
    } else if (scheme === "complementary") {
      for (let i = 0; i < n; i++) {
        cols.push({ h: i % 2 ? base + 180 : base, s: 82, l: 38 + ((i >> 1) % 3) * 13 });
      }
    } else if (scheme === "triadic") {
      for (let i = 0; i < n; i++) {
        cols.push({ h: base + (i % 3) * 120 + (i > 2 ? 18 : 0), s: 82, l: 44 + (i % 2) * 12 });
      }
    } else if (scheme === "neon") {
      for (let i = 0; i < n; i++) cols.push({ h: Math.random() * 360, s: 100, l: 55 + Math.random() * 12 });
    } else {
      for (let i = 0; i < n; i++) cols.push({ h: Math.random() * 360, s: 60 + Math.random() * 40, l: 38 + Math.random() * 28 });
    }
    return { cols, bg: { h: base, s: scheme === "neon" ? 45 : 30, l: 3.5 + Math.random() * 4 } };
  }

  function drawBars(ctx, b, t, pal, w, h) {
    const n = b.length, bw = w / n;
    for (let i = 0; i < n; i++) {
      const c = pal.cols[i % pal.cols.length];
      const bh = Math.pow(b[i], 1.4) * h * 0.82 + 2;
      const g = ctx.createLinearGradient(0, h, 0, h - bh);
      g.addColorStop(0, hsl(c.h + t * 4, c.s, Math.max(c.l * 0.45, 12)));
      g.addColorStop(1, hsl(c.h + t * 4, c.s, Math.min(c.l + 28, 88)));
      ctx.fillStyle = g;
      ctx.fillRect(i * bw + 1, h - bh, Math.max(bw - 2, 1), bh);
    }
  }

  function drawMirror(ctx, b, t, pal, w, h) {
    const n = b.length, bw = w / n, mid = h / 2;
    for (let i = 0; i < n; i++) {
      const c = pal.cols[i % pal.cols.length];
      const bh = Math.pow(b[i], 1.4) * h * 0.46 + 2;
      ctx.fillStyle = hsl(c.h + t * 4, c.s, c.l + 8, 0.9);
      ctx.fillRect(i * bw + 1, mid - bh, Math.max(bw - 2, 1), bh * 2);
    }
  }

  function drawRadial(ctx, b, t, pal, w, h) {
    const cx = w / 2, cy = h / 2, n = b.length;
    const base = Math.min(w, h) * 0.13;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.06);
    ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const c = pal.cols[i % pal.cols.length];
      const len = Math.pow(b[i], 1.3) * Math.min(w, h) * 0.4;
      const a = (i / n) * Math.PI * 2;
      ctx.strokeStyle = hsl(c.h + t * 6, c.s, c.l + 8);
      ctx.lineWidth = Math.max(2, ((Math.PI * 2 * (base + len)) / n) * 0.55);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * base, Math.sin(a) * base);
      ctx.lineTo(Math.cos(a) * (base + len), Math.sin(a) * (base + len));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWave(ctx, b, t, pal, w, h) {
    const n = b.length, mid = h / 2;
    for (const dir of [-1, 1]) {
      const c = pal.cols[dir < 0 ? 0 : 3 % pal.cols.length];
      ctx.strokeStyle = hsl(c.h + t * 3, c.s, 62);
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 20;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = mid + dir * (Math.pow(b[i], 1.2) * h * 0.42 + 6 * Math.sin(t * 3 + i * 0.2));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  const particles = [];
  for (let i = 0; i < 240; i++) {
    particles.push({ a: Math.random() * Math.PI * 2, r: Math.random(), s: 0.5 + Math.random(), sp: (Math.random() - 0.5) * 0.02 });
  }

  function drawParticles(ctx, b, t, pal, w, h) {
    const cx = w / 2, cy = h / 2, maxR = Math.hypot(w, h) / 2;
    for (const p of particles) {
      const idx = (((p.a / (Math.PI * 2)) % 1 + 1) % 1) * (b.length - 1) | 0;
      const e = b[idx];
      p.r += (0.0015 + e * 0.022) * p.s;
      p.a += p.sp + e * 0.012;
      if (p.r > 1) {
        p.r = Math.random() * 0.08;
        p.a = Math.random() * Math.PI * 2;
      }
      const c = pal.cols[(p.r * pal.cols.length) | 0];
      const x = cx + Math.cos(p.a) * p.r * maxR;
      const y = cy + Math.sin(p.a) * p.r * maxR;
      const sz = 1 + e * 9 * p.s;
      ctx.fillStyle = hsl(c.h + t * 5, c.s, c.l + 15, 0.2 + e * 0.8);
      ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }

  function drawTunnel(ctx, b, t, pal, w, h) {
    const cx = w / 2, cy = h / 2, n = b.length, rings = 26;
    for (let k = rings; k > 0; k--) {
      const e = b[(k * 5) % n];
      const r = (k / rings) * Math.max(w, h) * 0.72 + e * 42 + Math.sin(t * 2 + k) * 5;
      const c = pal.cols[k % pal.cols.length];
      ctx.strokeStyle = hsl(c.h + t * 8 + k * 4, c.s, 18 + k * 2.6);
      ctx.lineWidth = 1 + e * 7;
      const rot = t * 0.35 * (k % 2 ? 1 : -1);
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = rot + (i / 64) * Math.PI * 2;
        const rr = r + Math.sin(a * 3 + t * 3 + k) * e * 22;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  function drawMountains(ctx, b, t, pal, w, h) {
    const n = b.length;
    const layers = [
      { off: 0, amp: 0.78, col: pal.cols[0] },
      { off: 37, amp: 0.55, col: pal.cols[2 % pal.cols.length] },
      { off: 71, amp: 0.34, col: pal.cols[4 % pal.cols.length] },
    ];
    for (const L of layers) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, hsl(L.col.h + t * 4, L.col.s, Math.min(L.col.l + 22, 80)));
      g.addColorStop(1, hsl(L.col.h + t * 4, L.col.s, Math.max(L.col.l * 0.35, 8)));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < n; i++) {
        const e = b[(i + L.off) % n];
        ctx.lineTo((i / (n - 1)) * w, h - Math.pow(e, 1.3) * h * L.amp - 4);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  const patterns = [
    { name: "bars", fn: drawBars },
    { name: "mirror", fn: drawMirror },
    { name: "radial", fn: drawRadial },
    { name: "wave", fn: drawWave },
    { name: "particles", fn: drawParticles },
    { name: "tunnel", fn: drawTunnel },
    { name: "mountains", fn: drawMountains },
  ];

  function pickDifferent(except) {
    let p = except;
    while (p === except) p = patterns[(Math.random() * patterns.length) | 0];
    return p;
  }

  let cur = patterns[(Math.random() * patterns.length) | 0];
  let prev = null;
  let trans = 1;
  let palette = makePalette();
  let nextSwitch = performance.now() + 4000 + Math.random() * 4000;

  function frame(now) {
    requestAnimationFrame(frame);
    const t = now / 1000;
    if (now > nextSwitch) {
      prev = cur;
      cur = pickDifferent(cur);
      palette = makePalette();
      trans = 0;
      nextSwitch = now + 5000 + Math.random() * 9000;
    }
    ctx.fillStyle = hsl(palette.bg.h + t * 1.5, palette.bg.s, palette.bg.l);
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    const s = 1 + 0.12 * pulse;
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);

    if (prev && trans < 1) {
      ctx.globalAlpha = 1 - trans;
      prev.fn(ctx, bins, t, palette, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = prev && trans < 1 ? trans : 1;
    cur.fn(ctx, bins, t, palette, W, H);
    ctx.globalAlpha = 1;

    for (const bu of bursts) {
      bu.r += Math.max(W, H) * 0.02;
      bu.a *= 0.9;
      ctx.strokeStyle = hsl(palette.cols[0].h + t * 5, 90, 65, bu.a * 0.7);
      ctx.lineWidth = 3 * bu.a + 1;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, bu.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    bursts = bursts.filter((bu) => bu.a > 0.03);
    ctx.restore();

    if (beatFlash > 0.02) {
      ctx.fillStyle = hsl(palette.cols[0].h, 90, 60, beatFlash * 0.07);
      ctx.fillRect(0, 0, W, H);
    }
    pulse *= 0.9;
    beatFlash *= 0.92;
    trans = Math.min(1, trans + 0.035);
  }
  requestAnimationFrame(frame);
})();
