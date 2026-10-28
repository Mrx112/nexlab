(() => {
  const config = window.NEXLAB_SITE_CONFIG || {};
  const designs = [
    { id: "ftth-home", title: "FTTH Perumahan 32 Pelanggan", category: "FTTH", author: "NetRancang", price: 45000, rating: 4.9, sales: 128, devices: 46, tags: ["GPON", "VLAN", "DHCP"], description: "Rancangan jaringan FTTH dari OLT hingga ONT pelanggan. Lengkap dengan pembagian splitter, VLAN layanan, server DHCP, serta dokumentasi jalur distribusi untuk 32 rumah.", kind: "fiber", date: 6 },
    { id: "enterprise-ospf", title: "Enterprise 3 Cabang — OSPF", category: "Enterprise", author: "rizky.network", price: 65000, rating: 4.8, sales: 96, devices: 28, tags: ["OSPF", "ACL", "Inter-VLAN"], description: "Topologi kantor pusat dan tiga cabang dengan OSPF, segmentasi VLAN per divisi, DHCP terpusat, ACL, serta workbook berisi tugas dan pemeriksaan konektivitas.", kind: "enterprise", date: 3 },
    { id: "wifi-campus", title: "Wi-Fi Kampus & Captive Network", category: "Wireless", author: "Nadia Lab", price: 35000, rating: 4.7, sales: 74, devices: 21, tags: ["Wireless", "VLAN", "DHCP"], description: "Desain wireless untuk dua gedung kampus dengan SSID staf dan tamu, pemetaan access point, segmentasi VLAN, serta simulasi coverage dan koneksi klien.", kind: "wireless", date: 1 },
    { id: "ospf-starter", title: "Belajar OSPF dari Nol", category: "Pemula", author: "paketlab", price: 18000, rating: 5.0, sales: 209, devices: 8, tags: ["OSPF", "Routing", "Workbook"], description: "Lab terarah untuk memahami adjacency dan pertukaran route OSPF. Dilengkapi instruksi bertahap, konfigurasi awal, serta tantangan troubleshooting.", kind: "routing", date: 8 },
    { id: "wan-secure", title: "Dual-WAN & Firewall Failover", category: "Routing", author: "PacketCraft", price: 52000, rating: 4.8, sales: 51, devices: 17, tags: ["WAN", "Firewall", "Failover"], description: "Simulasi jaringan dual-WAN dengan jalur cadangan, kebijakan firewall, pemeriksaan failover, dan skenario gangguan yang bisa diuji mandiri.", kind: "security", date: 2 },
    { id: "ftth-ptp", title: "Backbone Fiber + Link PtP", category: "FTTH", author: "NetRancang", price: 39000, rating: 4.6, sales: 43, devices: 19, tags: ["Fiber", "PtP", "Budget"], description: "Rencana backbone antargedung dengan jalur fiber optik dan wireless point-to-point. Memuat daftar material dan ruang untuk perhitungan link budget.", kind: "fiber", date: 0 }
  ].map(item => ({ ...item, isExample: true }));
  const state = { category: "Semua", query: "", sort: "popular", custom: [] };
  const grid = document.querySelector("#market-grid");
  const empty = document.querySelector("#market-empty");
  const toast = document.querySelector("#toast");
  const maxDesignBytes = 5 * 1024 * 1024;
  const indexedDbName = "nexlab-marketplace";
  const indexedDbStore = "listings";
  let toastTimer;
  let databasePromise;

  const icon = {
    fiber: '<path d="M38 52h31M55 40v24M43 40l24 24m0-24L43 64"/><circle cx="55" cy="52" r="22"/>',
    enterprise: '<rect x="37" y="35" width="36" height="34" rx="6"/><path d="M44 44h7m9 0h7m-23 9h7m9 0h7m-23 9h7m9 0h7M29 52h8m36 0h8M55 27v8M55 69v8"/>',
    wireless: '<path d="M34 49a30 30 0 0 1 42 0M41 56a20 20 0 0 1 28 0M48 63a10 10 0 0 1 14 0"/><circle cx="55" cy="71" r="3"/>',
    routing: '<circle cx="55" cy="51" r="20"/><path d="m55 35 5 15-15 7 10-22Zm0 16 15 11m-15-11-14-11"/>',
    security: '<path d="M55 29 76 37v15c0 14-9 23-21 29-12-6-21-15-21-29V37l21-8Z"/><path d="m46 53 6 6 13-14"/>'
  };

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3600);
  }

  async function loadReleaseDownloadCount() {
    const output = document.querySelector("#release-download-count");
    if (!output) return;
    try {
      const response = await fetch("https://api.github.com/repos/Mrx112/nexlab/releases?per_page=100", {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
      const releases = await response.json();
      const total = releases.reduce((sum, release) =>
        sum + release.assets.reduce((assetSum, asset) => assetSum + Number(asset.download_count || 0), 0), 0);
      output.textContent = new Intl.NumberFormat(
        document.documentElement.lang === "id" ? "id-ID" : "en-US"
      ).format(total);
    } catch (error) {
      console.error("GitHub release download statistics could not be loaded.", error);
      output.textContent = "Unavailable";
      output.title = "Download counts are temporarily unavailable from GitHub.";
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function formatPrice(price) {
    return price === 0 ? "Gratis" : new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(price);
  }

  function openMarketplaceDatabase() {
    if (!window.indexedDB) return Promise.reject(new Error("Penyimpanan IndexedDB tidak tersedia di browser ini."));
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(indexedDbName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(indexedDbStore)) {
          request.result.createObjectStore(indexedDbStore, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Database marketplace tidak dapat dibuka."));
      request.onblocked = () => reject(new Error("Database marketplace sedang dipakai tab lain. Tutup tab NexLab lain lalu coba kembali."));
    }).catch(error => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function getStoredListings() {
    const database = await openMarketplaceDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(indexedDbStore, "readonly");
      const request = transaction.objectStore(indexedDbStore).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Listing marketplace tidak dapat dibaca."));
      transaction.onabort = () => reject(transaction.error || new Error("Pembacaan listing dibatalkan."));
    });
  }

  async function storeListing(listing) {
    const database = await openMarketplaceDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(indexedDbStore, "readwrite");
      transaction.objectStore(indexedDbStore).put(listing);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Listing marketplace tidak dapat disimpan."));
      transaction.onabort = () => reject(transaction.error || new Error("Penyimpanan listing dibatalkan."));
    });
  }

  async function deleteStoredListing(id) {
    const database = await openMarketplaceDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(indexedDbStore, "readwrite");
      transaction.objectStore(indexedDbStore).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Listing marketplace tidak dapat dihapus."));
      transaction.onabort = () => reject(transaction.error || new Error("Penghapusan listing dibatalkan."));
    });
  }

  async function loadCustomListings() {
    const database = await openMarketplaceDatabase();
    let legacyListings = [];
    try {
      const legacy = JSON.parse(localStorage.getItem("nexlab-market-preview") || "[]");
      if (Array.isArray(legacy)) legacyListings = legacy.filter(item => item && typeof item.id === "string" && typeof item.title === "string");
    } catch (error) {
      console.error("Listing marketplace lama tidak dapat dimigrasikan.", error);
      showToast("Sebagian listing dari versi sebelumnya tidak dapat dibaca.");
    }
    if (legacyListings.length) {
      const existing = new Set((await getStoredListings()).map(item => item.id));
      for (const listing of legacyListings) {
        if (!existing.has(listing.id)) await storeListing({ ...listing, designText: "", designFileName: "" });
      }
      localStorage.removeItem("nexlab-market-preview");
    }
    return getStoredListings();
  }

  function validateLabDocument(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) return false;
    const lab = document.lab && typeof document.lab === "object" ? document.lab : document;
    return Array.isArray(lab.nodes) && Array.isArray(lab.links);
  }

  function sanitizeFileName(name) {
    return String(name || "rancangan.nexlab.json").replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/^\.+/, "").slice(0, 100) || "rancangan.nexlab.json";
  }

  function getConfiguredWebUrl(value) {
    const url = new URL(value, window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("URL harus menggunakan HTTP atau HTTPS.");
    }
    return url;
  }

  function getVisibleDesigns() {
    const all = [...state.custom, ...designs];
    const query = state.query.trim().toLocaleLowerCase("id");
    const filtered = all.filter(item => {
      const matchesCategory = state.category === "Semua" || item.category === state.category;
      const searchable = `${item.title} ${item.category} ${item.author} ${item.description} ${(item.tags || []).join(" ")}`.toLocaleLowerCase("id");
      return matchesCategory && (!query || searchable.includes(query));
    });
    const sorters = {
      popular: (a, b) => (b.sales || 0) - (a.sales || 0),
      "price-low": (a, b) => a.price - b.price,
      "price-high": (a, b) => b.price - a.price,
      newest: (a, b) => (b.date || 0) - (a.date || 0)
    };
    return filtered.sort(sorters[state.sort] || sorters.popular);
  }

  function renderCards() {
    const items = getVisibleDesigns();
    empty.classList.toggle("hidden", items.length > 0);
    grid.innerHTML = items.map((item, index) => `
      <article class="design-card" style="--card-index:${index}">
        <div class="design-art art-${escapeHtml(item.kind || "routing")}">
          <span class="design-category">${escapeHtml(item.isExample ? "Contoh · " + item.category : item.category)}</span>
          <svg viewBox="0 0 110 102" aria-hidden="true">${icon[item.kind] || icon.routing}</svg>
          <span class="design-devices">${escapeHtml(item.devices || 0)} perangkat</span>
        </div>
        <div class="design-content">
          <div class="design-meta"><span>${item.designText ? "File siap diunduh" : "Pratinjau katalog"}</span><span>${item.designText ? "Format NexLab" : "Contoh"}</span></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>oleh ${escapeHtml(item.author || "Kreator NexLab")}</p>
          <div class="design-tags">${(item.tags || []).slice(0, 3).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          <div class="design-footer"><b>${formatPrice(Number(item.price) || 0)}</b><button type="button" class="view-design" data-design="${escapeHtml(item.id)}" aria-label="Lihat ${escapeHtml(item.title)}">Lihat detail <span>↗</span></button></div>
        </div>
      </article>`).join("");
  }

  function openDetail(id) {
    const item = [...state.custom, ...designs].find(design => design.id === id);
    if (!item) return;
    const dialog = document.querySelector("#detail-dialog");
    const hasDesign = typeof item.designText === "string" && item.designText.length > 0;
    const purchaseLabel = hasDesign && Number(item.price) === 0 ? "Unduh rancangan" : config.checkoutUrl && hasDesign ? "Lanjut ke checkout" : "Ajukan pembelian";
    dialog.innerHTML = `<div class="detail-art art-${escapeHtml(item.kind || "routing")}"><button class="dialog-close" type="button" data-close-dialog aria-label="Tutup">×</button><span class="design-category">${escapeHtml(item.isExample ? "Contoh · " + item.category : item.category)}</span><svg viewBox="0 0 110 102" aria-hidden="true">${icon[item.kind] || icon.routing}</svg></div>
      <div class="detail-content"><div class="eyebrow">RANCANGAN KOMUNITAS</div><h2 id="detail-title">${escapeHtml(item.title)}</h2><p class="detail-author">Oleh ${escapeHtml(item.author || "Kreator NexLab")}</p>
      <p class="detail-description">${escapeHtml(item.description)}</p><div class="detail-specs"><span><b>${Number(item.devices || 0)}</b> perangkat</span><span><b>${(item.tags || []).length}</b> topik</span><span><b>.nexlab.json</b> format lab</span></div>
      <div class="design-tags">${(item.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="detail-purchase"><div><small>Harga rancangan</small><b>${formatPrice(Number(item.price) || 0)}</b></div><button class="button button-primary" type="button" data-buy="${escapeHtml(item.id)}">${purchaseLabel} <span>↗</span></button></div>
      ${hasDesign ? `<button class="button button-outline export-listing" type="button" data-export="${escapeHtml(item.id)}">↓ Ekspor paket listing untuk dibagikan</button>` : ""}
      ${!item.isExample ? `<button class="button delete-listing" type="button" data-delete="${escapeHtml(item.id)}">Hapus listing dari browser ini</button>` : ""}
      <p class="detail-disclaimer">${hasDesign ? Number(item.price) > 0 ? "Listing tersimpan lokal. Checkout dan verifikasi pembayaran memerlukan layanan pembayaran yang dikonfigurasi." : "File rancangan ini dapat diunduh langsung. Ekspor paket listing untuk membagikannya ke browser lain." : "Ini contoh katalog tanpa file rancangan yang bisa dibeli atau diunduh."}</p></div>`;
    dialog.showModal();
  }

  function closeDialog(target) {
    const dialog = target.closest("dialog");
    if (dialog) dialog.close();
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadDesign(listing) {
    if (!listing.designText) {
      showToast("Listing ini belum memiliki file rancangan.");
      return;
    }
    downloadBlob(new Blob([listing.designText], { type: "application/json" }), sanitizeFileName(listing.designFileName));
  }

  function exportListing(listing) {
    const bundle = {
      format: "nexlab-marketplace-listing",
      version: 1,
      listing: {
        title: listing.title,
        category: listing.category,
        author: listing.author,
        price: listing.price,
        devices: listing.devices,
        tags: listing.tags,
        description: listing.description,
        kind: listing.kind
      },
      design: {
        fileName: sanitizeFileName(listing.designFileName),
        content: listing.designText
      }
    };
    const slug = sanitizeFileName(listing.title.toLocaleLowerCase("id").replace(/\s+/g, "-"));
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }), `${slug}.nexlab-listing.json`);
    showToast("Paket listing berhasil diekspor. Bagikan file ini agar dapat diimpor di browser lain.");
  }

  function kindForCategory(category) {
    return { FTTH: "fiber", Wireless: "wireless", Enterprise: "enterprise", Routing: "routing", Pemula: "routing" }[category] || "routing";
  }

  async function importListing(file) {
    const maxPackageBytes = 12 * 1024 * 1024;
    if (!file || file.size > maxPackageBytes) throw new Error("Ukuran file paket listing maksimal 12 MB.");

    const bundle = JSON.parse(await file.text());
    if (!bundle || bundle.format !== "nexlab-marketplace-listing" || bundle.version !== 1) {
      throw new Error("Format paket tidak dikenal. Pilih file .nexlab-listing.json hasil ekspor NexLab.");
    }

    const data = bundle.listing;
    const designText = bundle.design?.content;
    const categories = ["Routing", "FTTH", "Enterprise", "Wireless", "Pemula"];
    if (!data || typeof data.title !== "string" || !data.title.trim() || data.title.length > 70 || !categories.includes(data.category)) {
      throw new Error("Informasi listing tidak lengkap atau kategorinya tidak valid.");
    }
    if (typeof designText !== "string" || new Blob([designText]).size > maxDesignBytes) {
      throw new Error("File rancangan tidak ada atau ukurannya melebihi 5 MB.");
    }

    const lab = JSON.parse(designText);
    if (!validateLabDocument(lab)) throw new Error("File rancangan di dalam paket bukan file lab NexLab yang valid.");
    const devices = lab.nodes?.length ?? lab.lab?.nodes?.length ?? 0;
    const listing = {
      id: `shared-${crypto.randomUUID()}`,
      title: data.title.trim(),
      category: data.category,
      author: typeof data.author === "string" ? data.author.slice(0, 60) : "Kreator NexLab",
      price: Number.isSafeInteger(data.price) && data.price >= 0 && data.price <= 1_000_000_000 ? data.price : 0,
      rating: 0,
      sales: 0,
      devices,
      tags: Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === "string").slice(0, 6) : [data.category],
      description: typeof data.description === "string" ? data.description.slice(0, 220) : "Rancangan lab NexLab dari kreator komunitas.",
      kind: kindForCategory(data.category),
      date: Date.now(),
      designText,
      designFileName: sanitizeFileName(bundle.design.fileName),
      isImported: true
    };

    await storeListing(listing);
    state.custom.unshift(listing);
    state.category = "Semua";
    state.query = "";
    document.querySelector("#market-search").value = "";
    document.querySelectorAll(".category-chip").forEach(chip => chip.classList.toggle("active", chip.dataset.category === "Semua"));
    renderCards();
  }

  function initCinematicBackground() {
    const backdrop = document.querySelector(".cinematic-backdrop");
    const frames = [...backdrop.querySelectorAll(".cinematic-frame")];
    const counter = document.querySelector("#scene-counter");
    const progressBar = document.querySelector(".cinematic-track i");
    const frameCount = 240;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let activeFrame = 1;
    let lastFrameRequest = 0;
    let scheduledFrame = 0;
    let loadTimer;
    let loadToken = 0;
    let requestedFrame = 0;

    function loadFrame(frameNumber) {
      if (frameNumber === activeFrame) return;
      const current = frames.find(frame => frame.classList.contains("is-current"));
      const incoming = frames.find(frame => frame !== current);
      const token = ++loadToken;
      requestedFrame = frameNumber;
      incoming.onload = () => {
        if (token !== loadToken) return;
        incoming.classList.add("is-current");
        current.classList.remove("is-current");
        incoming.onload = null;
        activeFrame = frameNumber;
        requestedFrame = frameNumber;
      };
      incoming.onerror = () => {
        if (token !== loadToken) return;
        console.error(`Latar animasi gagal dimuat: ${incoming.src}`);
        showToast("Satu frame latar gagal dimuat. Periksa file WebP di WebSite/bg/optimized.");
        requestedFrame = activeFrame;
      };
      incoming.src = `bg/optimized/${String(frameNumber).padStart(5, "0")}.webp`;
      lastFrameRequest = performance.now();
    }

    function updateScene() {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const progress = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
      const frameNumber = Math.min(frameCount, 1 + Math.round(progress * (frameCount - 1)));
      counter.textContent = `${String(frameNumber).padStart(3, "0")} / ${frameCount}`;
      progressBar.style.width = `${progress * 100}%`;
      backdrop.style.setProperty("--scene-zoom", (1.035 + progress * 0.07).toFixed(3));
      backdrop.style.setProperty("--scene-y", `${progress * -1.5}%`);

      if (prefersReducedMotion) return;
      if (frameNumber === activeFrame) {
        window.clearTimeout(loadTimer);
        if (requestedFrame !== activeFrame) {
          ++loadToken;
          requestedFrame = activeFrame;
        }
        return;
      }
      if (frameNumber === requestedFrame) return;
      const delay = Math.max(0, 85 - (performance.now() - lastFrameRequest));
      window.clearTimeout(loadTimer);
      loadTimer = window.setTimeout(() => loadFrame(frameNumber), delay);
    }

    function queueSceneUpdate() {
      if (scheduledFrame) return;
      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = 0;
        updateScene();
      });
    }

    window.addEventListener("scroll", queueSceneUpdate, { passive: true });
    window.addEventListener("resize", queueSceneUpdate, { passive: true });
    updateScene();
  }

  renderCards();
  document.querySelector("#year").textContent = new Date().getFullYear();
  initCinematicBackground();

  loadCustomListings().then(listings => {
    state.custom = listings;
    renderCards();
  }).catch(error => {
    console.error("Marketplace lokal tidak dapat dimuat.", error);
    showToast(`Marketplace tidak dapat dibuka: ${error.message}`);
  });

  document.querySelector("#market-search").addEventListener("input", event => {
    state.query = event.target.value;
    renderCards();
  });
  document.querySelector("#market-sort").addEventListener("change", event => {
    state.sort = event.target.value;
    renderCards();
  });
  document.querySelector(".category-list").addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category;
    document.querySelectorAll(".category-chip").forEach(chip => chip.classList.toggle("active", chip === button));
    renderCards();
  });
  grid.addEventListener("click", event => {
    const button = event.target.closest("[data-design]");
    if (button) openDetail(button.dataset.design);
  });
  document.querySelector("#detail-dialog").addEventListener("click", async event => {
    if (event.target.matches("[data-close-dialog]")) closeDialog(event.target);
    const deleteButton = event.target.closest("[data-delete]");
    if (deleteButton) {
      const listing = state.custom.find(item => item.id === deleteButton.dataset.delete);
      if (!listing || !window.confirm(`Hapus "${listing.title}" dari browser ini?`)) return;
      try {
        await deleteStoredListing(listing.id);
        state.custom = state.custom.filter(item => item.id !== listing.id);
        renderCards();
        document.querySelector("#detail-dialog").close();
        showToast("Listing lokal berhasil dihapus.");
      } catch (error) {
        console.error("Listing marketplace tidak dapat dihapus.", error);
        showToast(`Listing gagal dihapus: ${error.message}`);
      }
      return;
    }
    const exportButton = event.target.closest("[data-export]");
    if (exportButton) {
      const listing = state.custom.find(item => item.id === exportButton.dataset.export);
      if (listing) exportListing(listing);
      return;
    }
    const buyButton = event.target.closest("[data-buy]");
    if (!buyButton) return;
    const listing = [...state.custom, ...designs].find(item => item.id === buyButton.dataset.buy);
    if (!listing) {
      showToast("Listing tidak ditemukan. Muat ulang halaman dan coba kembali.");
      return;
    }
    if (Number(listing.price) === 0 && listing.designText) {
      downloadDesign(listing);
    } else if (config.checkoutUrl && listing.designText) {
      try {
        const destination = getConfiguredWebUrl(config.checkoutUrl);
        destination.searchParams.set("design", buyButton.dataset.buy);
        window.location.assign(destination.href);
      } catch (error) {
        showToast(`URL checkout tidak valid: ${error.message}`);
      }
    } else {
      showToast(listing.designText ? "Checkout belum dikonfigurasi. Isi checkoutUrl di WebSite/config.js untuk menghubungkan pembayaran." : "Listing contoh ini belum memiliki file rancangan atau layanan checkout.");
    }
  });
  document.querySelector("#sell-open").addEventListener("click", () => document.querySelector("#sell-dialog").showModal());
  document.querySelectorAll("[data-close-dialog]").forEach(button => button.addEventListener("click", () => closeDialog(button)));
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  }));
  document.querySelector("#sell-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get("design");
    const message = document.querySelector("#sell-message");
    const submitButton = form.querySelector('[type="submit"]');
    const title = String(values.get("title") || "").trim();
    const description = String(values.get("description") || "").trim();
    const category = String(values.get("category") || "");
    const price = Number(values.get("price"));
    message.textContent = "";

    if (!file || !file.size) {
      message.textContent = "Pilih file .nexlab.json yang ingin dibagikan.";
      return;
    }
    if (file.size > maxDesignBytes) {
      message.textContent = "File maksimal 5 MB.";
      return;
    }
    if (!Number.isSafeInteger(price) || price < 0 || price > 1_000_000_000) {
      message.textContent = "Harga harus bilangan bulat antara Rp0 dan Rp1.000.000.000.";
      return;
    }

    submitButton.disabled = true;
    try {
      const designText = await file.text();
      const lab = JSON.parse(designText);
      if (!validateLabDocument(lab)) {
        message.textContent = "File harus berisi rancangan NexLab dengan daftar nodes dan links.";
        return;
      }

      const listing = {
        id: `local-${crypto.randomUUID()}`,
        title,
        category,
        author: "Rancangan saya",
        price,
        rating: 0,
        sales: 0,
        devices: lab.nodes?.length ?? lab.lab?.nodes?.length ?? 0,
        tags: [category, "Rancangan komunitas"],
        description,
        kind: kindForCategory(category),
        date: Date.now(),
        designText,
        designFileName: sanitizeFileName(file.name)
      };
      await storeListing(listing);
      state.custom.unshift(listing);
      state.category = "Semua";
      document.querySelectorAll(".category-chip").forEach(chip => chip.classList.toggle("active", chip.dataset.category === "Semua"));
      document.querySelector("#market-search").value = "";
      state.query = "";
      renderCards();
      form.reset();
      document.querySelector("#sell-dialog").close();
      showToast("Listing tersimpan. Buka detail untuk mengunduh rancangan atau mengekspor paket listing.");
    } catch (error) {
      console.error("Listing marketplace tidak dapat disimpan.", error);
      message.textContent = error instanceof SyntaxError ? "File tidak terbaca sebagai JSON NexLab yang valid." : `Listing gagal disimpan: ${error.message}`;
    } finally {
      submitButton.disabled = false;
    }
  });
  document.querySelector("#import-open").addEventListener("click", () => document.querySelector("#import-listing").click());
  document.querySelector("#import-listing").addEventListener("change", async event => {
    const input = event.currentTarget;
    const file = input.files[0];
    if (!file) return;
    try {
      await importListing(file);
      showToast("Listing dan rancangan berhasil diimpor.");
    } catch (error) {
      console.error("Paket listing tidak dapat diimpor.", error);
      showToast(`Impor gagal: ${error.message}`);
    } finally {
      input.value = "";
    }
  });
  document.querySelector("#donate-button").addEventListener("click", () => {
    if (config.donateUrl) {
      try {
        window.open(getConfiguredWebUrl(config.donateUrl).href, "_blank", "noopener,noreferrer");
      } catch (error) {
        showToast(`URL donasi tidak valid: ${error.message}`);
      }
    } else {
      showToast("Kanal donasi belum dikonfigurasi. Isi donateUrl di WebSite/config.js.");
    }
  });
  document.querySelectorAll("[data-download]").forEach(link => {
    const destination = config.downloads?.[link.dataset.download];
    if (destination) {
      try {
        link.href = getConfiguredWebUrl(destination).href;
        link.removeAttribute("download");
      } catch (error) {
        console.error(`URL unduhan ${link.dataset.download} tidak valid.`, error);
        showToast(`URL unduhan ${link.dataset.download} tidak valid.`);
      }
    }
  });
  loadReleaseDownloadCount();
  const menuToggle = document.querySelector(".menu-toggle");
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    document.querySelector(".main-nav").classList.toggle("nav-open", !isOpen);
  });
  document.querySelectorAll(".main-nav a").forEach(link => link.addEventListener("click", () => {
    document.querySelector(".main-nav").classList.remove("nav-open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));
})();
