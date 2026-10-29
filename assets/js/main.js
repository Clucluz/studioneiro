(function () {
  const P = window.PROJECTS || [];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;

  /* Follow-spot on the name */
  const hero = document.querySelector(".hero");
  if (hero) {
    const set = (x, y) => { hero.style.setProperty("--x", x + "px"); hero.style.setProperty("--y", y + "px"); };
    const name = hero.querySelector(".hero-name");
    const toLocal = (cx, cy) => { const r = name.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };

    if (fine) {
      hero.addEventListener("pointermove", (e) => set(...toLocal(e.clientX, e.clientY)));
    }
    // Slow automatic sweep: on touch screens always, on desktop until the pointer moves in.
    if (!reduce) {
      let manual = false, t0 = performance.now();
      hero.addEventListener("pointermove", () => { if (fine) manual = true; });
      hero.addEventListener("pointerleave", () => { manual = false; t0 = performance.now(); });
      const tick = (t) => {
        if (!manual) {
          const r = name.getBoundingClientRect();
          const k = (t - t0) / 5200;
          set(r.width * (0.5 + 0.45 * Math.sin(k)), r.height * (0.5 + 0.3 * Math.sin(k * 1.7)));
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      hero.style.setProperty("--r", "2000px");
    }
  }

  /* Works index */
  const list = document.querySelector(".works");
  if (list) {
    list.innerHTML = P.map((p) => `
      <li><a href="work.html?p=${p.slug}" data-visual="${p.visual}">
        <span class="year mono">${p.year}</span>
        <span class="title">${p.title}</span>
        <span class="place mono">${p.place}</span>
        <span class="arrow mono" aria-hidden="true">+</span>
        <span class="thumb ph ${p.visual}"></span>
      </a></li>`).join("");

    const count = document.querySelector("[data-count]");
    if (count) count.textContent = P.length + " projects";

    const prev = document.querySelector(".preview");
    if (prev && fine) {
      const inner = prev.querySelector(".ph");
      list.querySelectorAll("a").forEach((a) => {
        a.addEventListener("pointerenter", () => { inner.className = "ph " + a.dataset.visual; prev.classList.add("on"); });
        a.addEventListener("pointerleave", () => prev.classList.remove("on"));
        a.addEventListener("pointermove", (e) => { prev.style.left = (e.clientX + 200) + "px"; prev.style.top = e.clientY + "px"; });
      });
    }
  }

  /* Project page */
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
