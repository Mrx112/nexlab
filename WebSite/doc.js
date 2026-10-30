(() => {
  document.getElementById("year").textContent = new Date().getFullYear();
  const toc = document.getElementById("toc");
  const toggle = document.getElementById("toc-toggle");
  const links = [...toc.querySelectorAll("a[href^='#']")];
  const sections = links.map(link => document.querySelector(link.getAttribute("href"))).filter(Boolean);

  toggle.addEventListener("click", () => {
    const open = !toc.classList.contains("open");
    toc.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });
  links.forEach(link => link.addEventListener("click", () => {
    toc.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }));

  const visible = new Map();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => visible.set(entry.target.id, entry.isIntersecting));
    const current = sections.find(section => visible.get(section.id));
    if (current) links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === `#${current.id}`));
  }, { rootMargin: "-70px 0px -60% 0px" });
  sections.forEach(section => observer.observe(section));

  // Filter the table of contents by section title and body text.
  const search = document.getElementById("toc-search");
  const noResult = document.getElementById("no-result");
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase("id");
    let shown = 0;
    links.forEach(link => {
      const section = document.querySelector(link.getAttribute("href"));
      const match = !query || (section && section.textContent.toLocaleLowerCase("id").includes(query));
      link.parentElement.classList.toggle("hidden-by-search", !match);
      if (match) shown += 1;
    });
    noResult.style.display = shown ? "none" : "block";
  });

  // Copy buttons on code blocks.
  document.querySelectorAll("pre").forEach(pre => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Salin";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector("code").textContent);
        button.textContent = "Tersalin";
      } catch (error) {
        button.textContent = "Gagal";
      }
      setTimeout(() => { button.textContent = "Salin"; }, 1500);
    });
    pre.append(button);
  });
  window.NexLabTracking?.recordVisit("docs").catch(error => console.error("Kunjungan tidak dapat dicatat.", error));
})();
