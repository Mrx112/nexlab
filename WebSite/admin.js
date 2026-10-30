(() => {
  // PBKDF2-SHA256 of the dashboard password. This page only shows public counters and
  // release data, so the lock is a client-side gate, not server-side authentication.
  const ADMIN_PASSWORD = {
    salt: "ab9f80fcc37dfdbc601930dc61e6823d",
    iterations: 210000,
    hash: "b5e822bc9e8154a65ae1697678e17022df274037dbdb755d93224f46b5e4f655"
  };
  const SESSION_KEY = "nexlab_admin_session";
  const ATTEMPT_KEY = "nexlab_admin_attempts";
  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  const lock = document.querySelector("#admin-lock");
  const loginBtn = document.querySelector("#admin-login-btn");
  const loginError = document.querySelector("#admin-login-error");
  const passwordInput = document.querySelector("#admin-password");
  let dashboardStarted = false;

  const readStore = (store, key) => { try { return window[store].getItem(key); } catch (error) { return null; } };
  const writeStore = (store, key, value) => {
    try { value === null ? window[store].removeItem(key) : window[store].setItem(key, value); } catch (error) { /* storage blocked */ }
  };
  const hexToBytes = hex => new Uint8Array(hex.match(/../g).map(byte => parseInt(byte, 16)));

  async function derive(password) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(ADMIN_PASSWORD.salt), iterations: ADMIN_PASSWORD.iterations }, key, 256);
    return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  function sameText(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function attempts() {
    try { return JSON.parse(readStore("localStorage", ATTEMPT_KEY)) || { count: 0, until: 0 }; } catch (error) { return { count: 0, until: 0 }; }
  }

  function lockDashboard(message) {
    writeStore("sessionStorage", SESSION_KEY, null);
    lock.classList.remove("hidden");
    document.body.classList.remove("admin-authed");
    loginError.textContent = message || "";
    passwordInput.focus();
  }

  function touchSession() {
    if (document.body.classList.contains("admin-authed")) writeStore("sessionStorage", SESSION_KEY, String(Date.now()));
  }

  function unlock() {
    lock.classList.add("hidden");
    document.body.classList.add("admin-authed");
    touchSession();
    if (!dashboardStarted) {
      dashboardStarted = true;
      startDashboard();
    }
  }

  loginBtn.addEventListener("click", async () => {
    loginError.textContent = "";
    if (!window.crypto?.subtle) {
      loginError.textContent = "Browser tidak mendukung verifikasi sandi (butuh HTTPS).";
      return;
    }
    const state = attempts();
    if (state.until > Date.now()) {
      loginError.textContent = `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((state.until - Date.now()) / 1000)} detik.`;
      return;
    }
    loginBtn.disabled = true;
    try {
      const ok = sameText(await derive(passwordInput.value), ADMIN_PASSWORD.hash);
      passwordInput.value = "";
      if (ok) {
        writeStore("localStorage", ATTEMPT_KEY, null);
        unlock();
        return;
      }
      const count = state.count + 1;
      const until = count >= 5 ? Date.now() + Math.min(15 * 60, 30 * 2 ** (count - 5)) * 1000 : 0;
      writeStore("localStorage", ATTEMPT_KEY, JSON.stringify({ count, until }));
      loginError.textContent = until ? "Sandi salah. Login dikunci sementara." : `Sandi salah (${count}/5).`;
      passwordInput.focus();
    } finally {
      loginBtn.disabled = false;
    }
  });

  passwordInput.addEventListener("keydown", event => {
    if (event.key === "Enter") loginBtn.click();
  });
  document.querySelector("#admin-logout").addEventListener("click", () => lockDashboard("Dasbor dikunci."));
  ["click", "keydown", "scroll"].forEach(type => document.addEventListener(type, touchSession, { passive: true }));
  setInterval(() => {
    const last = Number(readStore("sessionStorage", SESSION_KEY));
    if (document.body.classList.contains("admin-authed") && (!last || Date.now() - last > IDLE_LIMIT_MS)) {
      lockDashboard("Sesi berakhir karena tidak ada aktivitas.");
    }
  }, 30 * 1000);

  const lastActive = Number(readStore("sessionStorage", SESSION_KEY));
  if (lastActive && Date.now() - lastActive <= IDLE_LIMIT_MS) unlock();
  else lockDashboard();

  function startDashboard() {
  const repository = "Mrx112/nexlab";
  const endpoint = `https://api.github.com/repos/${repository}/releases?per_page=100`;
  const status = document.querySelector("#admin-status");
  const formatCount = value => new Intl.NumberFormat(
    document.documentElement.lang === "id" ? "id-ID" : "en-US"
  ).format(value);
  const formatBytes = value => {
    if (!value) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
  };
  const formatDate = value => {
    if (!value) return "—";
    return new Intl.DateTimeFormat(
      document.documentElement.lang === "id" ? "id-ID" : "en-US",
      { dateStyle: "medium" }
    ).format(new Date(value));
  };
  const createCell = (row, value) => {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
    return cell;
  };
  const createAssetRow = (asset, releaseName, includeRelease) => {
    const row = document.createElement("tr");
    createCell(row, asset.name);
    createCell(row, formatCount(Number(asset.download_count || 0)));
    createCell(row, formatBytes(Number(asset.size || 0)));
    if (includeRelease) createCell(row, releaseName);
    const linkCell = document.createElement("td");
    const link = document.createElement("a");
    const destination = new URL(asset.browser_download_url);
    if (destination.hostname !== "github.com") throw new Error("Unexpected GitHub release asset host.");
    link.href = destination.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Download";
    link.setAttribute("aria-label", `Download ${asset.name}`);
    linkCell.append(link);
    row.append(linkCell);
    return row;
  };

  async function loadMetrics() {
    status.textContent = "Loading release data…";
    const refresh = document.querySelector("#refresh-metrics");
    refresh.disabled = true;
    try {
      const response = await fetch(endpoint, { headers: { Accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
      const releases = await response.json();
      const published = releases.filter(release => !release.draft);
      const allAssets = published.flatMap(release => release.assets.map(asset => ({ asset, release })));
      const total = allAssets.reduce((sum, item) => sum + Number(item.asset.download_count || 0), 0);
      const latest = published[0];
      document.querySelector("#total-downloads").textContent = formatCount(total);
      document.querySelector("#latest-version").textContent = latest?.tag_name || "No releases";
      document.querySelector("#latest-date").textContent = latest ? formatDate(latest.published_at) : "—";

      const latestRows = document.querySelector("#asset-rows");
      latestRows.replaceChildren();
      if (latest?.assets.length) {
        latest.assets.forEach(asset => latestRows.append(createAssetRow(asset, latest.tag_name, false)));
      } else {
        const row = document.createElement("tr");
        createCell(row, "No assets published");
        latestRows.append(row);
      }

      const downloadRows = document.querySelector("#download-rows");
      downloadRows.replaceChildren();
      if (allAssets.length) {
        allAssets.forEach(({ asset, release }) => downloadRows.append(createAssetRow(asset, release.tag_name, true)));
      } else {
        const row = document.createElement("tr");
        createCell(row, "No release assets found");
        downloadRows.append(row);
      }

      const releaseList = document.querySelector("#release-list");
      releaseList.replaceChildren();
      if (published.length) {
        published.forEach(release => {
          const item = document.createElement("article");
          item.className = "admin-release-item";
          const info = document.createElement("div");
          const title = document.createElement("b");
          title.textContent = release.name || release.tag_name;
          const meta = document.createElement("span");
          meta.textContent = `${release.tag_name} · ${formatDate(release.published_at)} · ${release.assets.length} assets`;
          info.append(title, meta);
          const link = document.createElement("a");
          link.href = release.html_url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "View release ↗";
          item.append(info, link);
          releaseList.append(item);
        });
      } else {
        releaseList.textContent = "No releases have been published yet.";
      }
      status.textContent = `Updated ${new Intl.DateTimeFormat(
        document.documentElement.lang === "id" ? "id-ID" : "en-US",
        { timeStyle: "short" }
      ).format(new Date())}.`;
    } catch (error) {
      console.error("Could not load public NexLab release metrics.", error);
      status.textContent = `Release statistics are unavailable: ${error.message}`;
      document.querySelector("#total-downloads").textContent = "Unavailable";
      document.querySelector("#latest-version").textContent = "Unavailable";
      document.querySelector("#asset-rows").textContent = "GitHub API data is temporarily unavailable.";
      document.querySelector("#download-rows").textContent = "GitHub API data is temporarily unavailable.";
      document.querySelector("#release-list").textContent = "GitHub API data is temporarily unavailable.";
    } finally {
      refresh.disabled = false;
    }
  }

  document.querySelectorAll(".admin-nav[data-panel]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav[data-panel]").forEach(item => item.classList.toggle("active", item === button));
      document.querySelectorAll(".admin-panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panelContent === button.dataset.panel));
      document.querySelector("#panel-title").textContent = button.querySelector("span").textContent;
      document.querySelector("#panel-description").textContent = {
        overview: "Public release activity and download totals.",
        visitors: "Anonymous website visits, unique visitors, and download clicks.",
        downloads: "Download counts reported by GitHub for published assets.",
        releases: "Version tags and publication dates.",
        feedback: "Where visitor feedback arrives."
      }[button.dataset.panel];
      document.querySelector("#refresh-metrics").classList.toggle("hidden", button.dataset.panel === "feedback");
    });
  });
  async function loadVisitors() {
    const tracking = window.NexLabTracking;
    const chart = document.querySelector("#visit-chart");
    const rows = document.querySelector("#visitor-rows");
    if (!tracking || !tracking.enabled) {
      ["#visit-total", "#visitor-total", "#visit-today", "#visit-14d", "#overview-visits"].forEach(id => { document.querySelector(id).textContent = "Off"; });
      chart.textContent = "Visitor tracking is disabled in config.js.";
      rows.textContent = "";
      return;
    }
    const days = [...Array(14)].map((_, index) => {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - (13 - index));
      return date;
    });
    const items = [
      ["Home page", "Page", "page-home"], ["Documentation", "Page", "page-docs"],
      ["Windows installer", "Download click", "event-download-windows"],
      ["macOS installer", "Download click", "event-download-macos"],
      ["Linux installer", "Download click", "event-download-linux"]
    ];
    try {
      const [visits, visitors, ...rest] = await Promise.all([
        tracking.get("visits"), tracking.get("visitors"),
        ...days.map(date => tracking.get(tracking.dayKey(date))),
        ...items.map(item => tracking.get(item[2]))
      ]);
      const daily = rest.slice(0, days.length);
      const itemCounts = rest.slice(days.length);
      const recent = daily.reduce((sum, value) => sum + value, 0);
      document.querySelector("#visit-total").textContent = formatCount(visits);
      document.querySelector("#visitor-total").textContent = formatCount(visitors);
      document.querySelector("#visit-today").textContent = formatCount(daily[daily.length - 1]);
      document.querySelector("#visit-today-date").textContent = `${days[days.length - 1].toISOString().slice(0, 10)} (UTC)`;
      document.querySelector("#visit-14d").textContent = formatCount(recent);
      document.querySelector("#visit-avg").textContent = `≈ ${formatCount(Math.round(recent / days.length))} per day`;
      document.querySelector("#overview-visits").textContent = formatCount(visits);
      document.querySelector("#overview-visitors").textContent = `${formatCount(visitors)} unique visitors`;

      const peak = Math.max(1, ...daily);
      chart.replaceChildren(...daily.map((value, index) => {
        const bar = document.createElement("div");
        bar.className = "visit-bar" + (index === daily.length - 1 ? " is-today" : "");
        bar.title = `${days[index].toISOString().slice(0, 10)}: ${value}`;
        const label = document.createElement("b");
        label.textContent = formatCount(value);
        const fill = document.createElement("i");
        fill.style.height = `${Math.max(2, (value / peak) * 100)}%`;
        const day = document.createElement("small");
        day.textContent = days[index].toISOString().slice(5, 10);
        bar.append(label, fill, day);
        return bar;
      }));
      chart.setAttribute("aria-label", `Daily visits for the last 14 days, peak ${peak}`);

      rows.replaceChildren(...items.map((item, index) => {
        const row = document.createElement("tr");
        createCell(row, item[0]);
        createCell(row, item[1]);
        createCell(row, formatCount(itemCounts[index]));
        return row;
      }));
    } catch (error) {
      console.error("Visitor statistics could not be loaded.", error);
      chart.textContent = `Visitor statistics are unavailable: ${error.message}`;
      rows.textContent = "";
      document.querySelector("#overview-visits").textContent = "Unavailable";
    }
  }

  document.querySelector("#refresh-metrics").addEventListener("click", () => { loadMetrics(); loadVisitors(); });

  const feedbackEmail = window.NEXLAB_SITE_CONFIG?.feedbackEmail || "";
  document.querySelector("#feedback-email").textContent = feedbackEmail || "Not configured";
  const inboxLink = document.querySelector("#feedback-email-link");
  if (/@gmail\.com$/i.test(feedbackEmail)) {
    inboxLink.href = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(feedbackEmail)}`;
    inboxLink.target = "_blank";
    inboxLink.rel = "noopener noreferrer";
  } else if (feedbackEmail) {
    inboxLink.href = `mailto:${feedbackEmail}`;
  } else {
    inboxLink.classList.add("hidden");
  }
  loadMetrics();
  loadVisitors();
  }
})();
