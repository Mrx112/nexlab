(() => {
  const repository = "Mrx112/nexlab";
  const endpoint = `https://api.github.com/repos/${repository}/releases?per_page=100`;
  const status = document.querySelector("#admin-status");
  let feedbackPrivateKey = null;
  let feedbackRecords = [];
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
  const downloadJson = (name, value) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const formatDateTime = value => new Intl.DateTimeFormat(
    document.documentElement.lang === "id" ? "id-ID" : "en-US",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    }
  ).format(new Date(value));
  const renderFeedback = () => {
    const rows = document.querySelector("#feedback-rows");
    rows.replaceChildren();
    const ordered = [...feedbackRecords].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    if (!ordered.length) {
      const row = document.createElement("tr");
      const cell = createCell(row, "No files imported.");
      cell.colSpan = 4;
      rows.append(row);
      return;
    }
    ordered.forEach(record => {
      const row = document.createElement("tr");
      createCell(row, formatDateTime(record.createdAt));
      createCell(row, record.method === "saweria" ? "Saweria" : "PayPal");
      createCell(row, record.contact || "—");
      createCell(row, record.message);
      rows.append(row);
    });
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
        downloads: "Download counts reported by GitHub for published assets.",
        releases: "Version tags and publication dates.",
        feedback: "Unlock and import encrypted visitor messages."
      }[button.dataset.panel];
      document.querySelector("#refresh-metrics").classList.toggle("hidden", button.dataset.panel === "feedback");
    });
  });
  document.querySelector("#refresh-metrics").addEventListener("click", loadMetrics);

  document.querySelector("#generate-feedback-keys").addEventListener("click", async event => {
    const button = event.currentTarget;
    const passwordInput = document.querySelector("#new-key-password");
    const confirmationInput = document.querySelector("#new-key-password-confirm");
    const keyStatus = document.querySelector("#key-status");
    const password = passwordInput.value;
    if (password.length < 12) {
      keyStatus.textContent = "Use a password with at least 12 characters.";
      passwordInput.focus();
      return;
    }
    if (password !== confirmationInput.value) {
      keyStatus.textContent = "The password entries do not match.";
      confirmationInput.focus();
      return;
    }
    button.disabled = true;
    keyStatus.textContent = "Generating keys…";
    try {
      const keys = await window.NexLabSupportCrypto.generateAdminKeys(password);
      const publicText = JSON.stringify(keys.publicJwk, null, 2);
      document.querySelector("#public-key-output").value = publicText;
      document.querySelector("#generated-key-output").classList.remove("hidden");
      downloadJson("nexlab-feedback-private-key.json", keys.privateBundle);
      keyStatus.textContent = "Keys generated. Store the private-key file securely and add the public key to the site configuration.";
      passwordInput.value = "";
      confirmationInput.value = "";
    } catch (error) {
      console.error("Feedback encryption keys could not be generated.", error);
      keyStatus.textContent = `Key generation failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#unlock-feedback").addEventListener("click", async event => {
    const button = event.currentTarget;
    const file = document.querySelector("#private-key-file").files[0];
    const password = document.querySelector("#private-key-password").value;
    const feedbackStatus = document.querySelector("#feedback-status");
    if (!file || !password) {
      feedbackStatus.textContent = "Choose the encrypted private-key file and enter its password.";
      return;
    }
    if (file.size > 1024 * 1024) {
      feedbackStatus.textContent = "The private-key file exceeds the 1 MB limit.";
      return;
    }
    button.disabled = true;
    feedbackStatus.textContent = "Unlocking private key…";
    try {
      const bundle = JSON.parse(await file.text());
      feedbackPrivateKey = await window.NexLabSupportCrypto.unlockPrivateKey(bundle, password);
      document.querySelector("#private-key-password").value = "";
      document.querySelector("#feedback-inbox").classList.remove("hidden");
      feedbackStatus.textContent = "Private key unlocked in this browser session.";
      renderFeedback();
    } catch (error) {
      feedbackPrivateKey = null;
      console.error("Feedback private key could not be unlocked.", error);
      feedbackStatus.textContent = "Could not unlock the key. Check that the file is valid and the password is correct.";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#import-feedback").addEventListener("click", async event => {
    const button = event.currentTarget;
    const filesInput = document.querySelector("#feedback-files");
    const files = [...filesInput.files];
    const feedbackStatus = document.querySelector("#feedback-status");
    if (!feedbackPrivateKey) {
      feedbackStatus.textContent = "Unlock the private key before importing feedback.";
      return;
    }
    if (!files.length) {
      feedbackStatus.textContent = "Choose one or more encrypted feedback files.";
      return;
    }
    if (files.length > 100 || files.some(file => file.size > 2 * 1024 * 1024)) {
      feedbackStatus.textContent = "Select at most 100 files, each smaller than 2 MB.";
      return;
    }
    button.disabled = true;
    feedbackStatus.textContent = "Decrypting feedback locally…";
    try {
      const imported = [];
      for (const file of files) {
        const bundle = JSON.parse(await file.text());
        if (bundle.format !== window.NexLabSupportCrypto.feedbackFormat || bundle.version !== 1 ||
          !Array.isArray(bundle.submissions) || !bundle.submissions.length || bundle.submissions.length > 100) {
          throw new Error(`${file.name}: unsupported feedback file format.`);
        }
        for (const encrypted of bundle.submissions) {
          const record = await window.NexLabSupportCrypto.decryptFeedback(encrypted, feedbackPrivateKey);
          if (!record || !["saweria", "paypal"].includes(record.method) ||
            typeof record.message !== "string" || !record.message.trim() || record.message.length > 3000 ||
            typeof record.contact !== "string" || record.contact.length > 160 ||
            !Number.isFinite(Date.parse(record.createdAt))) {
            throw new Error(`${file.name}: invalid decrypted feedback data.`);
          }
          imported.push({ ...record, id: String(encrypted.id || crypto.randomUUID()) });
        }
      }
      const knownIds = new Set(feedbackRecords.map(record => record.id));
      const unique = imported.filter(record => {
        if (knownIds.has(record.id)) return false;
        knownIds.add(record.id);
        return true;
      });
      feedbackRecords = [...feedbackRecords, ...unique];
      renderFeedback();
      feedbackStatus.textContent = `${unique.length} new message(s) imported. Data remains in memory only.`;
      filesInput.value = "";
    } catch (error) {
      console.error("Encrypted feedback could not be imported.", error);
      feedbackStatus.textContent = `Import failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#clear-feedback").addEventListener("click", () => {
    feedbackRecords = [];
    renderFeedback();
    document.querySelector("#feedback-status").textContent = "Inbox cleared from this browser session.";
  });

  document.querySelector("#download-public-key").addEventListener("click", () => {
    try {
      const publicKey = JSON.parse(document.querySelector("#public-key-output").value);
      downloadJson("nexlab-feedback-public-key.json", publicKey);
    } catch (error) {
      console.error("Public key export failed.", error);
      document.querySelector("#key-status").textContent = `Public-key export failed: ${error.message}`;
    }
  });
  loadMetrics();
})();
