(function () {
  const P = window.PROJECTS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     LED matrix text.

     The text is drawn with Geist on a hidden canvas and sampled on a dot
     grid: every grid point inside a letter is a lit LED, every other one
     is an unlit LED of the board.

     On the home page (data-spot) a follow-spot lights the letters, and
     now and then, very slowly, LEDs of the board next to the letters
     light up: either a soft swelling around an edge, as if the letter
     were dilating, or a trail that spirals away from it. Everything
     stays on the grid.

     data-lines="Light Design|Portfolio"   lines, separated by |
     data-lines-mobile="..."               alternative lines under 760px
     data-align="center"                   centred lines
     data-pitch="3"                        dot spacing in px
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
    let ink = new Uint8Array(0), onDots = new Float32Array(0), edges = [], board = null;
    let sx = 0, sy = 0, manual = false, t0 = performance.now();
    const events = [];

    function build() {
      lines = pickLines();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth; H = box.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";

      pitch = ds.pitch ? +ds.pitch : W < 600 ? 4 : W < 1000 ? 5 : 6;
      const padX = ds.pad !== undefined ? +ds.pad : W < 600 ? 20 : 40;
      const padBottom = spot ? (W < 600 ? 70 : 64) : 0;

      // fit the font size to the box, using the real ink bounds of the text
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

      o.fillStyle = "#fff";
      o.textBaseline = "alphabetic";
      o.textAlign = center ? "center" : "left";
      const top = spot ? (H - padBottom - mt.h) / 2 + 8 : (H - mt.h) / 2;
      lines.forEach((ln, i) => o.fillText(ln, center ? W / 2 : padX, top + mt.asc + i * fs * lh));

      // sample on the grid
      cols = Math.floor(W / pitch); rows = Math.floor(H / pitch);
      ox = (W - (cols - 1) * pitch) / 2; oy = (H - (rows - 1) * pitch) / 2;
      const data = o.getImageData(0, 0, W, H).data;
      ink = new Uint8Array(cols * rows);
      const on = [], offPts = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = ox + i * pitch, y = oy + j * pitch;
        if (data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 110) { ink[j * cols + i] = 1; on.push(x, y); }
        else offPts.push(x, y);
      }
      onDots = Float32Array.from(on);

      // edge LEDs: lit dots with an unlit neighbour, where the swelling starts
      edges = [];
      for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
        const k = j * cols + i;
        if (ink[k] && (!ink[k - 1] || !ink[k + 1] || !ink[k - cols] || !ink[k + cols])) edges.push(i, j);
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

      events.length = 0;
      if (!sx && !sy) { sx = W * 0.3; sy = H * 0.45; }
      draw(performance.now());
    }

    /* ---- slow swellings and spirals, on the board LEDs ---- */

    const rand = (a, b) => a + Math.random() * (b - a);
    const free = (i, j) => i >= 0 && j >= 0 && i < cols && j < rows && !ink[j * cols + i];

    function spawn(t) {
      if (!edges.length) return;
      const e = Math.floor(Math.random() * (edges.length / 2)) * 2;
      const ci = edges[e], cj = edges[e + 1];
      // outward direction: away from the ink around this edge dot
      let dx = 0, dy = 0;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (!free(ci + a, cj + b)) { dx -= a; dy -= b; }
      const ang0 = Math.atan2(dy, dx) + rand(-0.4, 0.4);

      if (Math.random() < 0.55) {
        // swelling: the board LEDs just outside the letter glow, then fade
        const R = rand(2.5, 5), pts = [];
        for (let b = -6; b <= 6; b++) for (let a = -6; a <= 6; a++) {
          const d = Math.hypot(a, b);
          if (d <= R && free(ci + a, cj + b)) pts.push(ci + a, cj + b, Math.pow(1 - d / (R + 0.8), 0.7));
        }
        if (pts.length) events.push({ kind: "swell", pts, t, d: rand(3600, 6000) });
      } else {
        // spiral: a trail that unwinds from the letter, one LED at a time
        const pts = [], seen = new Set(), turn = Math.random() < 0.5 ? 1 : -1;
        const len = Math.floor(rand(32, 64));
        for (let s = 1; pts.length / 2 < len && s < 600; s++) {
          const u = s / 8;
          const r = 1.5 + u * 1.6;
          const ang = ang0 + turn * u * 0.9;
          const i = Math.round(ci + Math.cos(ang) * r), j = Math.round(cj + Math.sin(ang) * r);
          const key = j * cols + i;
          if (seen.has(key)) continue;
          seen.add(key);
          if (i < 0 || j < 0 || i >= cols || j >= rows) break;
          if (!free(i, j)) continue;
          pts.push(i, j);
        }
        if (pts.length >= 8) events.push({ kind: "spiral", pts, t, step: rand(90, 150), tail: rand(1800, 2800) });
      }
    }

    function drawEvents(now, r) {
      for (let k = events.length - 1; k >= 0; k--) {
        const ev = events[k], age = now - ev.t;
        if (ev.kind === "swell") {
          const u = age / ev.d;
          if (u >= 1) { events.splice(k, 1); continue; }
          const env = Math.pow(Math.sin(Math.PI * u), 1.6);
          for (let p = 0; p < ev.pts.length; p += 3) {
            const a = 0.75 * env * ev.pts[p + 2];
            if (a < 0.02) continue;
            ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
            ctx.beginPath(); ctx.arc(ox + ev.pts[p] * pitch, oy + ev.pts[p + 1] * pitch, r, 0, 6.2832); ctx.fill();
          }
        } else {
          const n = ev.pts.length / 2;
          if (age > n * ev.step + ev.tail) { events.splice(k, 1); continue; }
          for (let p = 0; p < n; p++) {
            const lit = age - p * ev.step;
            if (lit < 0) break;
            const fadeIn = Math.min(1, lit / 400), fadeOut = Math.max(0, 1 - lit / ev.tail);
            const a = 0.8 * fadeIn * fadeOut * (1 - (p / n) * 0.6);
            if (a < 0.02) continue;
            ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
            ctx.beginPath(); ctx.arc(ox + ev.pts[2 * p] * pitch, oy + ev.pts[2 * p + 1] * pitch, r, 0, 6.2832); ctx.fill();
          }
        }
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

      if (spot && !reduce) drawEvents(now, r);

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
    }

    if (spot) {
      // The follow-spot always answers the mouse. The automatic sweep and the
      // swellings only run when the system allows motion.
      let raf = 0, last = performance.now(), next = performance.now() + 800;
      const frame = (t) => {
        raf = 0;
        if (!manual && !reduce) {
          const k = (t - t0) / 4200;
          sx = W * (0.5 + 0.42 * Math.sin(k));
          sy = H * (0.45 + 0.18 * Math.sin(k * 1.6));
        }
        if (!reduce && t > next && events.length < 6) { spawn(t); next = t + rand(900, 2200); }
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
