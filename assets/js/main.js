(function () {
  const P = window.PROJECTS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;

  /* ------------------------------------------------------------------
     LED matrix text.
     The text is drawn once with Geist on a hidden canvas, then sampled
     on a fine grid: every grid point inside a letter becomes a dot.
     Strokes are several dots thick, like a high-resolution LED panel.
     data-lines="Light design|portfolio"  data-spot="true" (follow-spot)
  ------------------------------------------------------------------ */
  function LED(canvas) {
    const pickLines = () => ((window.innerWidth < 760 && canvas.dataset.linesMobile) || canvas.dataset.lines).split("|");
    let lines = pickLines();
    const spot = canvas.dataset.spot === "true";
    const box = canvas.parentElement;
    const ctx = canvas.getContext("2d");
    let W, H, dpr, pitch, onDots = [], board = null;
    let sx = 0, sy = 0, manual = false, t0 = performance.now();

    function build() {
      lines = pickLines();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = box.clientWidth; H = box.clientHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px"; canvas.style.height = H + "px";

      pitch = W < 600 ? 4 : W < 1000 ? 5 : 6;
      const padX = W < 600 ? 20 : 40;
      const padBottom = spot ? (W < 600 ? 70 : 64) : 0;

      // fit the font size to the box
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const o = off.getContext("2d");
      const lh = 1.0;
      let fs = 400;
      const widest = () => Math.max(...lines.map((l) => { o.font = `500 ${fs}px Geist`; return o.measureText(l).width; }));
      while (fs > 20 && (widest() > W - padX * 2 || fs * lh * lines.length > H - padBottom - (spot ? 40 : 8))) fs -= 2;

      o.font = `500 ${fs}px Geist`;
      o.fillStyle = "#fff";
      o.textBaseline = "alphabetic";
      const blockH = fs * lh * lines.length;
      const top = spot ? (H - padBottom - blockH) / 2 + 10 : (H - blockH) / 2;
      lines.forEach((l, i) => o.fillText(l, padX - fs * 0.04, top + fs * 0.8 + i * fs * lh));

      const data = o.getImageData(0, 0, W, H).data;
      onDots = [];
      const offDots = [];
      const ox = (W % pitch) / 2 + pitch / 2, oy = (H % pitch) / 2 + pitch / 2;
      for (let y = oy; y < H; y += pitch) {
        for (let x = ox; x < W; x += pitch) {
          const a = data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3];
          (a > 110 ? onDots : offDots).push(x, y);
        }
      }

      // faint "unlit board": every LED of the panel, drawn once
      board = document.createElement("canvas");
      board.width = canvas.width; board.height = canvas.height;
      const b = board.getContext("2d");
      b.scale(dpr, dpr);
      b.fillStyle = "rgba(255,255,255,0.055)";
      const r = pitch * 0.3;
      b.beginPath();
      for (let i = 0; i < offDots.length; i += 2) { b.moveTo(offDots[i] + r, offDots[i + 1]); b.arc(offDots[i], offDots[i + 1], r, 0, 6.2832); }
      b.fill();

      if (!sx && !sy) { sx = W * 0.3; sy = H * 0.45; }
      draw();
    }

    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(board, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const r = pitch * 0.34;
      const lit = !spot || reduce;
      const R = Math.max(160, Math.min(W, 1200) * 0.24);
      // bucket the dots by brightness so each level is one path
      const levels = 12, buckets = Array.from({ length: levels }, () => []);
      for (let i = 0; i < onDots.length; i += 2) {
        const x = onDots[i], y = onDots[i + 1];
        let a = 1;
        if (!lit) {
          const d = Math.hypot(x - sx, y - sy) / R;
          a = 0.2 + 0.8 * Math.max(0, 1 - d * d);
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
    }

    if (spot && !reduce) {
      if (fine) {
        box.addEventListener("pointermove", (e) => {
          const rc = canvas.getBoundingClientRect();
          manual = true; sx = e.clientX - rc.left; sy = e.clientY - rc.top;
        });
        box.addEventListener("pointerleave", () => { manual = false; t0 = performance.now(); });
      }
      const tick = (t) => {
        if (!manual) {
          const k = (t - t0) / 4200;
          sx = W * (0.5 + 0.42 * Math.sin(k));
          sy = H * (0.45 + 0.18 * Math.sin(k * 1.6));
        }
        draw();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
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
     Works : grouped by year. Years left, wall of images, titles right.
  ------------------------------------------------------------------ */
  const works = document.querySelector(".works");
  if (works) {
    const years = [...new Set(P.map((p) => p.year))];
    works.innerHTML = years.map((y) => {
      const ps = P.filter((p) => p.year === y);
      return `<div class="year-row">
        <span class="year mono">${y}</span>
        <div class="tiles">${ps.map((p) => (p.images || [p.visual]).map((v, k) => `
          <a class="tile${k ? " extra" : ""}" href="work.html?p=${p.slug}" data-slug="${p.slug}"${k ? ' tabindex="-1" aria-hidden="true"' : ""}>
            <div class="frame marked"><i class="mk"></i><div class="ph ${v}"></div></div>
            ${k ? "" : `<div class="cap"><span class="t">${p.title}</span><span class="mono">${p.place}</span></div>`}
          </a>`).join("")).join("")}
        </div>
        <ul class="titles">${ps.map((p) => `
          <li><a href="work.html?p=${p.slug}" data-slug="${p.slug}"><span class="t">${p.title}</span><span class="mono">${p.place}</span></a></li>`).join("")}
        </ul>
      </div>`;
    }).join("");

    const count = document.querySelector("[data-count]");
    if (count) count.textContent = P.length + " projects";

    const light = (slug) => {
      works.classList.toggle("hovering", !!slug);
      works.querySelectorAll("[data-slug]").forEach((el) => el.classList.toggle("on", el.dataset.slug === slug));
    };
    works.querySelectorAll("[data-slug]").forEach((el) => {
      el.addEventListener("pointerenter", () => light(el.dataset.slug));
      el.addEventListener("pointerleave", () => light(null));
      el.addEventListener("focus", () => light(el.dataset.slug));
      el.addEventListener("blur", () => light(null));
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
