(function () {
  const P = window.PROJECTS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     LED matrix text.

     The text is drawn with Geist on a hidden canvas, at twice the size,
     and every LED of the grid covers one square cell. A LED is lit when
     the letter covers more than half of its cell. The dot spacing is set
     so that a vertical stem is exactly a whole number of cells wide, so
     every stem lights the same number of columns, wherever it falls.
     The dots of i and j lose their four corner LEDs, so they read round.

     On the home page (data-spot) a follow-spot lights the letters and,
     sparsely, single LEDs come loose from the edges of the letters and
     step outward on the grid while fading, like the letters eroding.

     data-lines="Light Design|Portfolio"   lines, separated by |
     data-lines-mobile="..."               alternative lines under 760px
     data-align="center"                   centred lines
     data-pitch="3"                        approximate dot spacing in px
     data-board="false"                    hide the unlit LED board
  ------------------------------------------------------------------ */
  function LED(canvas) {
    const ds = canvas.dataset;
    const pickLines = () => ((window.innerWidth < 760 && ds.linesMobile) || ds.lines).split("|");
    const spot = ds.spot === "true";
    const center = ds.align === "center";
    const box = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    let W, H, dpr, pitch, cols, rows, ox, oy, lines;
    let ink = new Uint8Array(0), onIdx = new Int32Array(0), edges = [], board = null;
    let sx = 0, sy = 0, manual = false, t0 = performance.now();
    const grains = [];          // LEDs coming loose
    const worn = new Map();     // letter LEDs dimmed for a while after losing a grain

    function build() {
      lines = pickLines();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth; H = box.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";

      const basePitch = ds.pitch ? +ds.pitch : W < 600 ? 4 : W < 1000 ? 5 : 6;
      const padX = ds.pad !== undefined ? +ds.pad : W < 600 ? 20 : 40;
      const padBottom = spot ? (W < 600 ? 70 : 64) : 0;

      // fit the font size to the box, using the real ink bounds of the text
      const S = 2; // supersampling
      const o = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      o.canvas.width = W * S; o.canvas.height = H * S;
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

      // dot spacing: a whole number of cells per stem
      const stem = stemWidth(fs);
      // at least two LEDs per stem when the dots can stay 2.6px apart (phones, small titles)
      const k = Math.max(stem / 2.6 >= 2 ? 2 : 1, Math.round(stem / basePitch));
      pitch = stem / k;

      o.setTransform(S, 0, 0, S, 0, 0);
      o.font = `500 ${fs}px Geist`;
      o.fillStyle = "#fff";
      o.textBaseline = "alphabetic";
      o.textAlign = center ? "center" : "left";
      const top = spot ? (H - padBottom - mt.h) / 2 + 8 : (H - mt.h) / 2;
      lines.forEach((ln, i) => o.fillText(ln, center ? W / 2 : padX, top + mt.asc + i * fs * lh));

      // coverage of each cell, from a summed-area table of the alpha channel
      cols = Math.floor(W / pitch); rows = Math.floor(H / pitch);
      ox = (W - (cols - 1) * pitch) / 2; oy = (H - (rows - 1) * pitch) / 2;
      const PW = W * S, PH = H * S;
      const px = o.getImageData(0, 0, PW, PH).data;
      const sat = new Float64Array((PW + 1) * (PH + 1));
      for (let y = 0; y < PH; y++) {
        let run = 0;
        for (let x = 0; x < PW; x++) {
          run += px[(y * PW + x) * 4 + 3];
          sat[(y + 1) * (PW + 1) + x + 1] = sat[y * (PW + 1) + x + 1] + run;
        }
      }
      const area = (x0, y0, x1, y1) => sat[y1 * (PW + 1) + x1] - sat[y0 * (PW + 1) + x1] - sat[y1 * (PW + 1) + x0] + sat[y0 * (PW + 1) + x0];
      const clampX = (v) => Math.max(0, Math.min(PW, Math.round(v))), clampY = (v) => Math.max(0, Math.min(PH, Math.round(v)));

      ink = new Uint8Array(cols * rows);
      const cov = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const cx = (ox + i * pitch) * S, cy = (oy + j * pitch) * S, h = pitch * S / 2;
        const x0 = clampX(cx - h), x1 = clampX(cx + h), y0 = clampY(cy - h), y1 = clampY(cy + h);
        const n = (x1 - x0) * (y1 - y0);
        const c = n > 0 ? area(x0, y0, x1, y1) / (255 * n) : 0;
        cov[j * cols + i] = c;
        if (c > 0.5) ink[j * cols + i] = 1;
      }

      evenStems(k, cov);
      roundDots(k);

      const on = [], offPts = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (ink[j * cols + i]) on.push(j * cols + i);
        else offPts.push(ox + i * pitch, oy + j * pitch);
      }
      onIdx = Int32Array.from(on);

      // edge LEDs, with the outward direction (away from the ink around them)
      edges = [];
      for (let j = 2; j < rows - 2; j++) for (let i = 2; i < cols - 2; i++) {
        const c = j * cols + i;
        if (!ink[c] || (ink[c - 1] && ink[c + 1] && ink[c - cols] && ink[c + cols])) continue;
        let dx = 0, dy = 0;
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (ink[(j + b) * cols + i + a]) { dx -= a; dy -= b; }
        const len = Math.hypot(dx, dy);
        if (len > 0.5) edges.push(i, j, dx / len, dy / len);
      }

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

      grains.length = 0; worn.clear();
      if (!sx && !sy) { sx = W * 0.3; sy = H * 0.45; }
      draw(performance.now());
    }

    // Some glyphs (the f, the t) have slightly thinner stems than the I and
    // light one column less. A straight vertical stretch that is one LED
    // narrower than the others gets the missing column, on the side the
    // letter covers most.
    function evenStems(k, cov) {
      if (k < 3) return;
      const minRows = Math.max(4, Math.round(k * 2.5));
      const runAt = (i, j) => { // start of a horizontal run of exactly k-1 LEDs at (i, j), or -1
        if (!ink[j * cols + i] || (i > 0 && ink[j * cols + i - 1])) return -1;
        let n = 0; while (i + n < cols && ink[j * cols + i + n]) n++;
        return n === k - 1 ? n : -1;
      };
      const done = new Uint8Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        if (done[j * cols + i] || runAt(i, j) < 0) continue;
        let e = j;
        while (e + 1 < rows && runAt(i, e + 1) >= 0) e++;
        for (let y = j; y <= e; y++) done[y * cols + i] = 1;
        if (e - j + 1 < minRows) continue;
        let left = 0, right = 0;
        for (let y = j; y <= e; y++) {
          if (i > 0) left += cov[y * cols + i - 1];
          if (i + k - 1 < cols) right += cov[y * cols + i + k - 1];
        }
        const add = left >= right ? i - 1 : i + k - 1;
        if (add < 0 || add >= cols) continue;
        for (let y = j; y <= e; y++) ink[y * cols + add] = 1;
      }
    }

    // i and j dots: small, roughly square blobs of LEDs; drop their four corners
    function roundDots(k) {
      const seen = new Uint8Array(cols * rows);
      const stack = [];
      for (let s = 0; s < ink.length; s++) {
        if (!ink[s] || seen[s]) continue;
        const cells = [];
        stack.push(s); seen[s] = 1;
        let minI = 1e9, maxI = -1, minJ = 1e9, maxJ = -1;
        while (stack.length) {
          const c = stack.pop(); cells.push(c);
          const i = c % cols, j = (c - i) / cols;
          if (i < minI) minI = i; if (i > maxI) maxI = i; if (j < minJ) minJ = j; if (j > maxJ) maxJ = j;
          for (const n of [c - 1, c + 1, c - cols, c + cols]) {
            if (n >= 0 && n < ink.length && ink[n] && !seen[n] && Math.abs((n % cols) - i) <= 1) { seen[n] = 1; stack.push(n); }
          }
        }
        const w = maxI - minI + 1, h = maxJ - minJ + 1;
        if (w >= 3 && h >= 3 && w <= k + 2 && h <= k + 2 && cells.length >= 0.7 * w * h) {
          for (const [i, j] of [[minI, minJ], [maxI, minJ], [minI, maxJ], [maxI, maxJ]]) ink[j * cols + i] = 0;
        }
      }
    }

    /* ---- erosion: single LEDs come loose and step outward ---- */

    const rand = (a, b) => a + Math.random() * (b - a);
    const freeCell = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && !ink[j * cols + i];

    function loosen(t) {
      if (!edges.length) return;
      const e = Math.floor(Math.random() * (edges.length / 4)) * 4;
      const i = edges[e], j = edges[e + 1];
      let fx = edges[e + 2], fy = edges[e + 3];
      const a = Math.atan2(fy, fx) + rand(-0.5, 0.5);
      fx = Math.cos(a); fy = Math.sin(a);
      // first free cell along the outward direction
      let ci = i, cj = j;
      for (let s = 1; s < 4; s++) {
        const ni = Math.round(i + fx * s), nj = Math.round(j + fy * s);
        if (freeCell(ni, nj)) { ci = ni; cj = nj; break; }
      }
      if (ci === i && cj === j) return;
      grains.push({ i: ci, j: cj, pi: ci, pj: cj, fx, fy, t, moved: t, step: rand(380, 650), left: Math.floor(rand(3, 9)), a: rand(0.45, 0.7) });
      worn.set(j * cols + i, { t, d: rand(2500, 4500) });

      // one or two companions come loose from the neighbouring edge LEDs, a beat later
      const extra = Math.random() < 0.5 ? 1 : 2;
      for (let n = 0; n < extra; n++) {
        let ni = -1, nj = -1;
        for (let tries = 0; tries < 12; tries++) {
          const ti = i + Math.round(rand(-3, 3)), tj = j + Math.round(rand(-3, 3));
          if (tj < 1 || ti < 1 || tj >= rows - 1 || ti >= cols - 1 || !ink[tj * cols + ti]) continue;
          const c = tj * cols + ti;
          if (ink[c - 1] && ink[c + 1] && ink[c - cols] && ink[c + cols]) continue; // not an edge
          ni = ti; nj = tj; break;
        }
        if (ni < 0) continue;
        const b = Math.atan2(fy, fx) + rand(-0.35, 0.35);
        const gx = Math.cos(b), gy = Math.sin(b);
        let gi = -1, gj = -1;
        for (let s = 1; s < 4; s++) {
          const pi = Math.round(ni + gx * s), pj = Math.round(nj + gy * s);
          if (freeCell(pi, pj) && !grains.some((g) => g.i === pi && g.j === pj)) { gi = pi; gj = pj; break; }
        }
        if (gi < 0) continue;
        const delay = rand(150, 700);
        grains.push({ i: gi, j: gj, pi: gi, pj: gj, fx: gx, fy: gy, t: t + delay, moved: t + delay, step: rand(380, 650), left: Math.floor(rand(2, 7)), a: rand(0.35, 0.6) });
        worn.set(nj * cols + ni, { t: t + delay, d: rand(2500, 4500) });
      }
    }

    function advance(now) {
      for (let k = grains.length - 1; k >= 0; k--) {
        const g = grains[k];
        if (now < g.t || now - g.moved < g.step) continue;
        if (g.left-- <= 0) { grains.splice(k, 1); continue; }
        // next cell: mostly outward, now and then a sideways drift
        const a = Math.atan2(g.fy, g.fx) + rand(-0.7, 0.7);
        let ni = Math.round(g.i + Math.cos(a) * 1.2), nj = Math.round(g.j + Math.sin(a) * 1.2);
        if (ni === g.i && nj === g.j) ni += Math.sign(g.fx) || 1;
        if (!freeCell(ni, nj)) { grains.splice(k, 1); continue; }
        g.pi = g.i; g.pj = g.j; g.i = ni; g.j = nj; g.moved = now;
        g.a *= rand(0.72, 0.86);
      }
    }

    function draw(now) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(board, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = pitch * 0.34;
      const lit = !spot || (reduce && !manual);
      const R = Math.max(160, Math.min(W, 1200) * 0.24);

      // letters, bucketed by brightness so each level is one path
      const levels = 12, buckets = Array.from({ length: levels }, () => []);
      for (let n = 0; n < onIdx.length; n++) {
        const c = onIdx[n], i = c % cols, j = (c - i) / cols;
        const x = ox + i * pitch, y = oy + j * pitch;
        let a = 1;
        if (!lit) {
          const d = Math.hypot(x - sx, y - sy) / R;
          a = 0.2 + 0.8 * Math.max(0, 1 - d * d);
        }
        const w = worn.size && worn.get(c);
        if (w) {
          const u = (now - w.t) / w.d;
          if (u >= 1) worn.delete(c);
          else a *= 0.35 + 0.65 * u * u;
        }
        buckets[Math.min(levels - 1, Math.floor(a * levels))].push(x, y);
      }
      buckets.forEach((pts, k) => {
        if (!pts.length) return;
        ctx.fillStyle = `rgba(255,255,255,${((k + 1) / levels).toFixed(3)})`;
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i] + r, pts[i + 1]); ctx.arc(pts[i], pts[i + 1], r, 0, 6.2832); }
        ctx.fill();
      });

      // loose LEDs: the new cell fades in while the previous one fades out
      for (const g of grains) {
        if (now < g.t) continue;
        const u = Math.min(1, (now - g.moved) / 220);
        const glow = Math.min(1, (now - g.t) / 600);
        const cur = g.a * u * glow, prev = g.a * (1 - u) * 1.15;
        if (prev > 0.02 && (g.pi !== g.i || g.pj !== g.j)) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, prev).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(ox + g.pi * pitch, oy + g.pj * pitch, r, 0, 6.2832); ctx.fill();
        }
        if (cur > 0.02) {
          ctx.fillStyle = `rgba(255,255,255,${cur.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(ox + g.i * pitch, oy + g.j * pitch, r, 0, 6.2832); ctx.fill();
        }
      }
    }

    if (spot) {
      // The follow-spot always answers the mouse. The automatic sweep and the
      // erosion only run when the system allows motion.
      let raf = 0, next = performance.now() + 1200;
      const frame = (t) => {
        raf = 0;
        if (!manual && !reduce) {
          const k = (t - t0) / 4200;
          sx = W * (0.5 + 0.42 * Math.sin(k));
          sy = H * (0.45 + 0.18 * Math.sin(k * 1.6));
        }
        if (!reduce) {
          if (t > next && grains.length < 16) { loosen(t); next = t + rand(700, 1600); }
          advance(t);
        }
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

  // width of a vertical stroke of Geist 500 at a given size, measured on the ink of an "I"
  function stemWidth(fs) {
    const S = 4, s = Math.ceil(fs * 1.4 * S);
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    c.canvas.width = s; c.canvas.height = Math.ceil(fs * 1.2 * S);
    c.setTransform(S, 0, 0, S, 0, 0);
    c.font = `500 ${fs}px Geist`;
    c.fillStyle = "#fff";
    c.textBaseline = "alphabetic";
    c.fillText("I", fs * 0.2, fs);
    const row = c.getImageData(0, Math.round(fs * 0.65 * S), s, 1).data;
    let ink = 0;
    for (let x = 0; x < s; x++) ink += row[x * 4 + 3] / 255;
    return ink / S;
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
