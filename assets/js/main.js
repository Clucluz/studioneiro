(function () {
  const P = window.PROJECTS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     LED matrix text.

     1. The text is drawn with Geist on a hidden canvas and sampled on a
        dot grid.
     2. That rough bitmap is thinned down to a one-dot skeleton, then
        thickened again by a fixed number of dots. Every stroke, straight
        or curved, ends up exactly the same width (data-stroke, default 3).
     3. On the home page (data-spot) a follow-spot lights the letters,
        a few dots twinkle, and star dust drifts off the sides of the
        word or flies in and settles onto it.

     data-lines="Light Design|Portfolio"   lines, separated by |
     data-lines-mobile="..."               alternative lines under 760px
     data-align="center"                   centred lines
     data-stroke="3"                       stroke width in dots
     data-board="false"                    hide the unlit LED board
  ------------------------------------------------------------------ */

  // Zhang–Suen thinning on a binary grid (1 = ink). Returns a new grid.
  function thin(src, cols, rows) {
    const g = Uint8Array.from(src);
    const del = [];
    let changed = true;
    const at = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : g[j * cols + i]);
    while (changed) {
      changed = false;
      for (let pass = 0; pass < 2; pass++) {
        del.length = 0;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            if (!g[j * cols + i]) continue;
            const p2 = at(i, j - 1), p3 = at(i + 1, j - 1), p4 = at(i + 1, j), p5 = at(i + 1, j + 1);
            const p6 = at(i, j + 1), p7 = at(i - 1, j + 1), p8 = at(i - 1, j), p9 = at(i - 1, j - 1);
            const n = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (n < 2 || n > 6) continue;
            const s = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
            let t = 0;
            for (let k = 0; k < 8; k++) if (!s[k] && s[k + 1]) t++;
            if (t !== 1) continue;
            if (pass === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
            del.push(j * cols + i);
          }
        }
        if (del.length) { changed = true; del.forEach((k) => (g[k] = 0)); }
      }
    }
    return g;
  }

  // width of a vertical stroke of Geist 500 at a given size, measured on the
  // ink of an "I" (the text metrics API returns the whole glyph box instead)
  function stemWidth(fs) {
    const s = Math.ceil(fs * 1.4);
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    c.canvas.width = s; c.canvas.height = s;
    c.font = `500 ${fs}px Geist`;
    c.fillStyle = "#fff";
    c.textBaseline = "alphabetic";
    c.fillText("I", fs * 0.2, fs);
    const y = Math.round(fs * 0.65);
    const row = c.getImageData(0, y, s, 1).data;
    let ink = 0;
    for (let x = 0; x < s; x++) ink += row[x * 4 + 3] / 255;
    return ink;
  }

  function LED(canvas) {
    const ds = canvas.dataset;
    const pickLines = () => ((window.innerWidth < 760 && ds.linesMobile) || ds.lines).split("|");
    const spot = ds.spot === "true";
    const center = ds.align === "center";
    let stroke = 3;
    const box = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    let W, H, dpr, pitch, lines, onDots = new Float32Array(0), board = null;
    let sx = 0, sy = 0, manual = false, t0 = performance.now();
    let inkL = 0, inkR = 0, inkC = 0;
    const sparks = [], dust = [];

    function build() {
      lines = pickLines();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth; H = box.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";

      const padX = ds.pad !== undefined ? +ds.pad : W < 600 ? 20 : 40;
      const padBottom = spot ? (W < 600 ? 70 : 64) : 0;

      // 1. fit the font size to the box, using the real ink bounds of the text
      const o = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      o.canvas.width = W; o.canvas.height = H;
      const lh = 1.08;
      const metrics = (fs) => {
        o.font = `500 ${fs}px Geist`;
        const ms = lines.map((l) => o.measureText(l));
        const asc = Math.max(...ms.map((x) => x.actualBoundingBoxAscent));
        const desc = Math.max(...ms.map((x) => x.actualBoundingBoxDescent));
        return { asc, w: Math.max(...ms.map((x) => x.width)), h: asc + desc + (lines.length - 1) * fs * lh };
      };
      const availH = H - padBottom - (spot ? 48 : 2);
      let fs = 400, mt = metrics(fs);
      while (fs > 12 && (mt.w > W - padX * 2 || mt.h > availH)) { fs -= 2; mt = metrics(fs); }

      // the dot pitch follows the stem width of the font, so a stroke is about `stroke` dots wide
      o.font = `500 ${fs}px Geist`;
      const stem = stemWidth(fs);
      // as many dots per stroke as wanted (default 4), but never with dots closer than minPitch
      const minP = +(ds.minPitch || 2.6);
      stroke = Math.max(1, Math.min(+(ds.stroke || 4), Math.floor(stem / minP)));
      pitch = stem / stroke;

      o.fillStyle = "#fff";
      o.textBaseline = "alphabetic";
      o.textAlign = center ? "center" : "left";
      const top = spot ? (H - padBottom - mt.h) / 2 + 8 : (H - mt.h) / 2;
      lines.forEach((ln, i) => o.fillText(ln, center ? W / 2 : padX, top + mt.asc + i * fs * lh));

      // 2. sample on the grid, thin to a skeleton, thicken by exactly `stroke` dots
      const cols = Math.floor(W / pitch), rows = Math.floor(H / pitch);
      const ox = (W - (cols - 1) * pitch) / 2, oy = (H - (rows - 1) * pitch) / 2;
      const data = o.getImageData(0, 0, W, H).data;
      const raw = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        raw[j * cols + i] = data[(Math.floor(oy + j * pitch) * W + Math.floor(ox + i * pitch)) * 4 + 3] > 127 ? 1 : 0;
      }
      const skel = thin(raw, cols, rows);
      const ink = new Uint8Array(cols * rows);
      const lo = -Math.floor((stroke - 1) / 2), hi = lo + stroke - 1;
      const round = stroke >= 4; // drop the kernel corners on wide strokes for rounder curves
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (!skel[j * cols + i]) continue;
        for (let b = lo; b <= hi; b++) for (let a = lo; a <= hi; a++) {
          if (round && (a === lo || a === hi) && (b === lo || b === hi)) continue;
          const x = i + a, y = j + b;
          if (x >= 0 && y >= 0 && x < cols && y < rows) ink[y * cols + x] = 1;
        }
      }

      const on = [], offPts = [];
      inkL = Infinity; inkR = -Infinity;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = ox + i * pitch, y = oy + j * pitch;
        if (ink[j * cols + i]) { on.push(x, y); if (x < inkL) inkL = x; if (x > inkR) inkR = x; }
        else offPts.push(x, y);
      }
      onDots = Float32Array.from(on);
      inkC = (inkL + inkR) / 2;

      // the faint unlit board: every LED of the panel, drawn once
      board = document.createElement("canvas");
      board.width = canvas.width; board.height = canvas.height;
      if (ds.board !== "false") {
        const b = board.getContext("2d");
        b.scale(dpr, dpr);
        b.fillStyle = "rgba(255,255,255,0.055)";
        const r = pitch * 0.3;
        b.beginPath();
        for (let i = 0; i < offPts.length; i += 2) { b.moveTo(offPts[i] + r, offPts[i + 1]); b.arc(offPts[i], offPts[i + 1], r, 0, 6.2832); }
        b.fill();
      }

      sparks.length = 0; dust.length = 0;
      if (!sx && !sy) { sx = W * 0.3; sy = H * 0.45; }
      draw(performance.now());
    }

    /* ---- 3. twinkles and star dust ---- */

    const rand = (a, b) => a + Math.random() * (b - a);
    const randomDot = () => (Math.floor(Math.random() * (onDots.length / 2)) * 2);

    function spawnSpark(t, idx) {
      if (onDots.length) sparks.push({ i: idx === undefined ? randomDot() : idx, t, d: rand(500, 1100) });
    }

    function spawnDust(t) {
      if (!onDots.length) return;
      // favour dots towards the left and right ends of the word
      let i = randomDot(), tries = 0;
      const half = Math.max(1, (inkR - inkL) / 2);
      while (tries++ < 6 && Math.random() > Math.pow(Math.abs(onDots[i] - inkC) / half, 1.5)) i = randomDot();
      const x = onDots[i], y = onDots[i + 1];
      const side = x < inkC ? -1 : 1;
      if (Math.random() < 0.35) {
        // flies in from the side and settles onto the letter, which then twinkles
        const dist = rand(60, 180);
        dust.push({ inbound: true, tx: x, ty: y, x0: x + side * dist, y0: y + rand(-50, 30), t, life: rand(1400, 2600), r: rand(0.6, 1.5), i });
      } else {
        // lifts off the letter and drifts away
        dust.push({ inbound: false, x, y, vx: side * rand(0.006, 0.04), vy: rand(-0.025, -0.002), t, life: rand(1600, 3800), r: rand(0.5, 1.6) });
      }
    }

    function draw(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(board, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = pitch * 0.36;
      const lit = !spot || (reduce && !manual);
      const R = Math.max(160, Math.min(W, 1200) * 0.24);

      // letters, bucketed by brightness so each level is one path
      const levels = 12, buckets = Array.from({ length: levels }, () => []);
      for (let i = 0; i < onDots.length; i += 2) {
        let a = 1;
        if (!lit) {
          const d = Math.hypot(onDots[i] - sx, onDots[i + 1] - sy) / R;
          a = 0.2 + 0.8 * Math.max(0, 1 - d * d);
        }
        buckets[Math.min(levels - 1, Math.floor(a * levels))].push(onDots[i], onDots[i + 1]);
      }
      buckets.forEach((pts, k) => {
        if (!pts.length) return;
        ctx.fillStyle = `rgba(255,255,255,${((k + 1) / levels).toFixed(3)})`;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + r, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], r, 0, 6.2832); }
        ctx.fill();
      });

      if (!spot || reduce) return;

      // twinkles: a dot flares up, with a soft halo, then settles back
      for (let k = sparks.length - 1; k >= 0; k--) {
        const s = sparks[k], u = (now - s.t) / s.d;
        if (u >= 1 || s.i >= onDots.length) { sparks.splice(k, 1); continue; }
        const e = Math.sin(Math.PI * u);
        const x = onDots[s.i], y = onDots[s.i + 1];
        ctx.fillStyle = `rgba(255,255,255,${(0.1 * e).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, r * (1.6 + 1.4 * e), 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * e).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, r * (1 + 0.25 * e), 0, 6.2832); ctx.fill();
      }

      // star dust
      for (let k = dust.length - 1; k >= 0; k--) {
        const p = dust[k], u = (now - p.t) / p.life;
        if (u >= 1) {
          if (p.inbound) spawnSpark(now, p.i);
          dust.splice(k, 1);
          continue;
        }
        let x, y, a;
        if (p.inbound) {
          const e = 1 - Math.pow(1 - u, 3);
          x = p.x0 + (p.tx - p.x0) * e;
          y = p.y0 + (p.ty - p.y0) * e + Math.sin(u * 9) * 3 * (1 - u);
          a = Math.min(1, u * 4) * 0.85;
        } else {
          const dt = now - p.t;
          x = p.x + p.vx * dt + Math.sin(dt / 380 + p.r * 10) * 2;
          y = p.y + p.vy * dt;
          a = Math.min(1, u * 6) * (1 - u) * 0.9;
        }
        a *= 0.75 + 0.25 * Math.sin(now / 90 + k); // shimmer
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, p.r, 0, 6.2832); ctx.fill();
      }
    }

    if (spot) {
      // The follow-spot always answers the mouse. The automatic sweep, the
      // twinkles and the dust only run when the system allows motion.
      let raf = 0, last = performance.now();
      const frame = (t) => {
        raf = 0;
        if (!manual && !reduce) {
          const k = (t - t0) / 4200;
          sx = W * (0.5 + 0.42 * Math.sin(k));
          sy = H * (0.45 + 0.18 * Math.sin(k * 1.6));
        }
        if (!reduce) {
          const dt = Math.min(64, t - last);
          if (Math.random() < dt * 0.0022) spawnSpark(t);
          if (dust.length < 110 && Math.random() < dt * 0.06) spawnDust(t);
        }
        last = t;
        draw(t);
        if (!reduce || manual) raf = requestAnimationFrame(frame);
      };
      box.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        const rc = canvas.getBoundingClientRect();
        manual = true; sx = e.clientX - rc.left; sy = e.clientY - rc.top;
        if (!raf) raf = requestAnimationFrame(frame);
      });
      box.addEventListener("pointerleave", () => {
        manual = false; t0 = performance.now();
        if (reduce) { cancelAnimationFrame(raf); raf = 0; draw(performance.now()); }
      });
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    let rt;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(build, 80); }).observe(box);
    build();
  }

  const leds = document.querySelectorAll("canvas.led");
  if (leds.length) {
    (document.fonts ? document.fonts.load("500 100px Geist") : Promise.resolve())
      .catch(() => {})
      .then(() => leds.forEach(LED));
  }

  /* ------------------------------------------------------------------
     Works : years on the left, wall of images in the middle, and one
     panel on the right that describes only the project under the mouse.
  ------------------------------------------------------------------ */
  const works = document.querySelector(".works");
  const panel = document.querySelector(".panel");
  if (works) {
    const years = [...new Set(P.map((p) => p.year))];
    works.innerHTML = years.map((y) => `<div class="year-row">
        <span class="year mono">${y}</span>
        <div class="tiles">${P.filter((p) => p.year === y).map((p) => (p.images || [p.visual]).map((v, k) => `
          <a class="tile${k ? " extra" : ""}" href="work.html?p=${p.slug}" data-slug="${p.slug}"${k ? ' tabindex="-1" aria-hidden="true"' : ""}>
            <div class="frame marked"><i class="mk"></i><div class="ph ${v}"></div></div>
            ${k ? "" : `<div class="cap"><span class="t">${p.title}</span><span class="mono">${p.place}</span></div>`}
          </a>`).join("")).join("")}
        </div>
      </div>`).join("");

    const count = document.querySelector("[data-count]");
    if (count) count.textContent = P.length + " projects";

    const empty = panel && panel.querySelector(".panel-empty");
    const info = panel && panel.querySelector(".panel-info");
    let leaveTimer;

    const show = (slug) => {
      clearTimeout(leaveTimer);
      const p = P.find((x) => x.slug === slug);
      works.classList.add("hovering");
      works.querySelectorAll(".tile").forEach((el) => el.classList.toggle("on", el.dataset.slug === slug));
      if (!panel || !p) return;
      const facts = Object.entries(p.facts).filter(([k]) => k !== "Year" && k !== "Photos");
      info.innerHTML = `
        <span class="mono">${p.year}</span>
        <h3>${p.title}</h3>
        <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        <p>${p.intent}</p>
        <span class="mono">Click to open the project</span>`;
      empty.hidden = true; info.hidden = false;
    };
    const clear = () => {
      leaveTimer = setTimeout(() => {
        works.classList.remove("hovering");
        works.querySelectorAll(".tile.on").forEach((el) => el.classList.remove("on"));
        if (panel) { empty.hidden = false; info.hidden = true; }
      }, 60);
    };
    works.querySelectorAll(".tile").forEach((el) => {
      el.addEventListener("pointerenter", () => show(el.dataset.slug));
      el.addEventListener("pointerleave", clear);
      el.addEventListener("focus", () => show(el.dataset.slug));
      el.addEventListener("blur", clear);
    });
  }

  /* ------------------------------------------------------------------
     Project page
  ------------------------------------------------------------------ */
  const proj = document.querySelector("[data-project]");
  if (proj) {
    const slug = new URLSearchParams(location.search).get("p") || P[0].slug;
    const i = Math.max(0, P.findIndex((p) => p.slug === slug));
    const p = P[i];
    document.title = p.title + " — Louis Cluzel";
    proj.querySelector(".project-hero .ph").classList.add(p.visual);
    proj.querySelector("h1").textContent = p.title;
    proj.querySelector(".facts").innerHTML = Object.entries(p.facts).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    proj.querySelector("[data-intent]").textContent = p.intent;
    proj.querySelector("[data-making]").textContent = p.making;
    proj.querySelectorAll(".gallery .ph").forEach((el) => el.classList.add(p.visual));
    const older = P[i + 1], newer = P[i - 1];
    proj.querySelector("[data-newer]").innerHTML = newer ? `<a href="work.html?p=${newer.slug}">${newer.title}</a>` : "";
    proj.querySelector("[data-older]").innerHTML = older ? `<a href="work.html?p=${older.slug}">${older.title}</a>` : `<a href="index.html#works">All works</a>`;
  }
})();
