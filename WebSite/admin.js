(() => {
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
        downloads: "Download counts reported by GitHub for published assets.",
        releases: "Version tags and publication dates."
      }[button.dataset.panel];
    });
  });
  document.querySelector("#refresh-metrics").addEventListener("click", loadMetrics);
  loadMetrics();
})();
