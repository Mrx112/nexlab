// Anonymous visitor counters for the static website (GitHub Pages has no backend).
// Only counter totals are stored at the counter service: no cookies, no personal data,
// no IP logging by NexLab. Browsers that send Do Not Track / Global Privacy Control are not counted.
(() => {
  const config = window.NEXLAB_SITE_CONFIG || {};
  const api = (config.analytics && config.analytics.api) || "https://abacus.jasoncameron.dev";
  const namespace = (config.analytics && config.analytics.namespace) || "nexlab-mrx112-site";
  const enabled = !(config.analytics && config.analytics.enabled === false);
  const optedOut = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  // Local previews (file://, localhost) read the counters but never increment them.
  const isLocal = ["", "localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) || window.location.protocol === "file:";
  const keyPattern = /^[A-Za-z0-9_.-]{3,64}$/;

  function storage(kind) {
    try {
      const store = window[kind];
      const probe = "__nexlab_probe__";
      store.setItem(probe, "1");
      store.removeItem(probe);
      return store;
    } catch (error) {
      return null;
    }
  }
  const session = storage("sessionStorage");
  const local = storage("localStorage");

  function dayKey(date = new Date()) {
    return `day-${date.toISOString().slice(0, 10).replace(/-/g, "")}`;
  }

  async function request(action, key) {
    if (!keyPattern.test(key)) throw new Error(`Invalid counter key: ${key}`);
    const response = await fetch(`${api}/${action}/${namespace}/${key}`, { cache: "no-store", keepalive: action === "hit" });
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`Counter service returned ${response.status}`);
    const data = await response.json();
    const value = Number(data && data.value);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  const get = key => request("get", key);
  const hit = key => request("hit", key);

  // Count one page view per page per browser session, plus one unique visitor per browser.
  async function recordVisit(page) {
    const result = { counted: false, visits: null, visitors: null };
    if (!enabled || optedOut || isLocal) return result;
    const sessionKey = `nexlab-counted-${page}`;
    if (session && session.getItem(sessionKey)) return result;
    if (session) session.setItem(sessionKey, "1");
    const isNewVisitor = local ? !local.getItem("nexlab-visitor") : false;
    if (local && isNewVisitor) local.setItem("nexlab-visitor", new Date().toISOString());
    const jobs = [hit("visits"), hit(`page-${page}`), hit(dayKey())];
    if (isNewVisitor) jobs.push(hit("visitors"));
    const values = await Promise.allSettled(jobs);
    result.counted = true;
    if (values[0].status === "fulfilled") result.visits = values[0].value;
    if (isNewVisitor && values[3].status === "fulfilled") result.visitors = values[3].value;
    return result;
  }

  function recordEvent(name) {
    if (!enabled || optedOut || isLocal) return Promise.resolve(null);
    return hit(`event-${name}`).catch(() => null);
  }

  window.NexLabTracking = { enabled, optedOut, isLocal, dayKey, get, hit, recordVisit, recordEvent };
})();
