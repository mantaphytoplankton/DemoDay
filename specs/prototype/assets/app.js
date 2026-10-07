/* DemoDay S-1 prototype: shared shell, store, rubric parsing and scorecard rendering. */
window.DD = window.DD || {};

(function () {
  "use strict";

  /* ---------- helpers ---------- */
  const esc = (v) =>
    String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  DD.esc = esc;
  DD.$ = (sel, root = document) => root.querySelector(sel);

  DD.formatBytes = (n) => {
    if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + " GB";
    if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + " MB";
    if (n >= 1024) return Math.round(n / 1024) + " KB";
    return n + " B";
  };
  DD.formatDuration = (sec) => {
    if (sec == null || !isFinite(sec)) return "unknown length";
    const s = Math.round(sec);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  };
  DD.formatTime = (iso) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  /* ---------- prototype scenario (simulates server/agent outcomes) ---------- */
  const SCN_KEY = "dd.proto.scenario";
  const RUB_KEY = "dd.proto.rubric";
  DD.SCENARIOS = {
    normal: "Normal: completes in about 12s",
    slow: "Slow processing: shows the 10s tip",
    unprocessable: "Fails: video could not be processed",
    unavailable: "Fails: AI service unavailable after retries",
    incomplete: "Fails: AI returned an incomplete scorecard",
  };
  DD.RUBRIC_MODES = {
    default: "rubric.md missing: default rubric used",
    malformed: "rubric.md malformed: invalid configuration",
  };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  DD.scenario = () => ls.get(SCN_KEY, "normal");
  DD.rubricMode = () => ls.get(RUB_KEY, "default");

  /* ---------- store: stands in for data/evaluations/*.json ---------- */
  const EV_KEY = "dd.evaluations";
  DD.store = {
    list() { return ls.get(EV_KEY, []); },
    get(id) { return this.list().find((e) => e.id === id) || null; },
    save(ev) {
      const all = this.list().filter((e) => e.id !== ev.id);
      all.unshift(ev);
      ls.set(EV_KEY, all.slice(0, 20));
    },
    clear() { ls.set(EV_KEY, []); },
  };
  DD.newId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : "ev-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));

  /* ---------- rubric ---------- */
  DD.loadRubric = async function () {
    let text = DD.RUBRIC_MD;
    if (DD.rubricMode() === "malformed") text = text.replace('"weight": 20', '"weight": "twenty"');
    const hash = await DD.sha256(text);
    const m = text.match(/```json rubric-meta\s*([\s\S]*?)```/);
    let meta = null;
    let error = null;
    try {
      meta = JSON.parse(m ? m[1] : "");
      validateMeta(meta);
    } catch (e) {
      error = e.message || "Invalid rubric metadata";
      meta = null;
    }
    return { text, hash, version: hash.slice(0, 8), source: "Default rubric", meta, error };
  };
  function validateMeta(meta) {
    if (!meta || !Array.isArray(meta.categories) || meta.categories.length === 0) throw new Error("No categories defined");
    const ids = new Set();
    for (const c of meta.categories) {
      if (!c.id || !c.name) throw new Error("A category is missing its id or name");
      if (ids.has(c.id)) throw new Error("Duplicate category id: " + c.id);
      ids.add(c.id);
      if (typeof c.weight !== "number" || !(c.weight > 0)) throw new Error('Category "' + c.name + '" has no valid weight');
    }
    if (typeof meta.maxDurationSeconds !== "number") throw new Error("maxDurationSeconds is missing");
  }
  DD.sha256 = async function (text) {
    if (!crypto.subtle) return "unavailable";
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  /* Overall = sum(score_i * w_i) / sum(w_i), 2 decimals (architecture-design.md 5.3). */
  DD.weightedOverall = function (categories, meta) {
    let sw = 0, s = 0;
    for (const c of meta.categories) {
      const hit = categories.find((x) => x.id === c.id);
      if (!hit) throw new Error("Missing category " + c.id);
      s += hit.score * c.weight;
      sw += c.weight;
    }
    return Math.round((s / sw) * 100) / 100;
  };
  DD.scoreClass = (x) => "s" + Math.min(5, Math.max(1, Math.floor(x + 0.5)));

  /* ---------- icons (shape carries meaning; ui-guideline 3.3) ---------- */
  DD.icon = function (kind) {
    const a = 'width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"';
    switch (kind) {
      case "pending":
        return `<svg ${a}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
      case "active":
        return `<svg ${a}><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/><path class="spin" d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
      case "done":
        return `<svg ${a}><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.1 2.1 4.3-4.6" fill="none" stroke="#0B1220" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      case "failed":
        return `<svg ${a}><path d="M8 1.5l7 12.5H1z" fill="currentColor"/><path d="M8 6v4" stroke="#0B1220" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="12.1" r="1" fill="#0B1220"/></svg>`;
      case "hold":
        return `<svg ${a}><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg>`;
      case "flag":
        return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2 1v10M2 1.5h7l-1.5 2.5L9 6.5H2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    }
    return "";
  };
  DD.stateBadge = function (status) {
    const map = {
      Pending: "pending", Uploading: "active", "Processing Video": "active", Scoring: "active",
      Completed: "done", Failed: "failed", Interrupted: "hold",
    };
    const k = map[status] || "pending";
    return `<span class="state state-${k}">${DD.icon(k)}<span>${esc(status)}</span></span>`;
  };

  DD.scoreChip = function (score, label) {
    const cls = DD.scoreClass(score);
    const pips = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= score ? "on" : ""}"></i>`).join("");
    return `<span class="score ${cls}" role="img" aria-label="${esc(label)}: ${score} out of 5"><span class="score-num" aria-hidden="true">${score}</span><span class="pips" aria-hidden="true">${pips}</span></span>`;
  };

  /* ---------- scorecard (SNG-03) ---------- */
  DD.renderScorecard = function (ev, opts = {}) {
    const r = ev.result;
    const meta = r.rubricMeta;
    const cls = DD.scoreClass(r.overallScore);
    const weights = meta.categories.map((c) => `${esc(c.short)} ${c.weight}%`).join(" · ");
    const flags = [];
    if (r.exceedsMaxDuration) flags.push(`Over ${DD.formatDuration(meta.maxDurationSeconds)} (${DD.formatDuration(r.durationSeconds)})`);
    const flagHtml = flags.length
      ? `<div class="flags" aria-label="Data-quality flags">${flags.map((f) => `<span class="flag">${DD.icon("flag")}${esc(f)}</span>`).join("")}</div>`
      : "";

    const cats = meta.categories
      .map((c, i) => {
        const hit = r.categories.find((x) => x.id === c.id);
        const tiers = DD.TIERS[c.id];
        const tier = !tiers ? ""
          : hit.score === 1 ? tiers[0]
          : hit.score === 2 ? `between "${tiers[0]}" and "${tiers[1]}"`
          : hit.score === 3 ? tiers[1]
          : hit.score === 4 ? `between "${tiers[1]}" and "${tiers[2]}"`
          : tiers[2];
        const rid = `rem-${opts.prefix || "sc"}-${i}`;
        return `<li class="cat" data-open="false">
          <div class="cat-row">
            <div><span class="cat-name">${esc(c.name)}</span><span class="cat-weight">${c.weight}%</span>
              ${tier ? `<div class="cat-tier">Tier: ${esc(tier)}</div>` : ""}</div>
            <div>${DD.scoreChip(hit.score, c.name)}</div>
            <div class="cat-preview" aria-hidden="true">${esc(hit.remarks)}</div>
            <button type="button" class="btn-text" data-toggle="${rid}" aria-expanded="false" aria-controls="${rid}">Show remarks<span class="sr-only"> for ${esc(c.name)}</span></button>
          </div>
          <div class="cat-remarks" id="${rid}" hidden>${esc(hit.remarks)}</div>
        </li>`;
      })
      .join("");

    return `<article class="panel" aria-labelledby="sc-title-${opts.prefix || "sc"}">
      <div class="scorecard-head">
        <div>
          <h2 class="panel-title" id="sc-title-${opts.prefix || "sc"}" style="margin:0">${esc(ev.fileName)}</h2>
          <div class="file-row secondary" style="font-size:13px">
            <span class="mono">${DD.formatDuration(r.durationSeconds)}</span>
            <span>${DD.formatBytes(ev.sizeBytes)}</span>
            <span>Evaluated ${DD.formatTime(r.finishedAt)}</span>
          </div>
          ${flagHtml}
        </div>
        <div class="overall ${cls}">
          <div class="overall-label">Overall AI score</div>
          <div class="overall-value"><span class="overall-num">${r.overallScore.toFixed(2)}</span><span class="overall-of">out of 5</span></div>
          <div class="overall-weights">Weighted · ${weights}</div>
        </div>
      </div>
      <div class="btn-row" style="justify-content:space-between;margin-top:8px">
        <h3 class="section-label" style="margin:8px 0 0">Category scores</h3>
        <button type="button" class="btn-text" data-expand-all aria-keyshortcuts="E">Show all remarks</button>
      </div>
      <ul class="cats">${cats}</ul>
      <h3 class="section-label">Overall comments</h3>
      <p class="comments">${esc(r.overallComments)}</p>
      <div class="prov" aria-label="Provenance">
        <span><b>Model</b> ${esc(r.model)}</span>
        <span><b>Rubric</b> ${esc(r.rubricSource)} · <span class="mono">${esc(r.rubricVersion)}</span></span>
        <span><b>Prompt</b> <span class="mono">${esc(r.promptVersion)}</span></span>
        <span><b>Sample output</b> prototype only</span>
      </div>
    </article>`;
  };

  DD.bindScorecard = function (root) {
    const setOpen = (btn, open) => {
      const panel = document.getElementById(btn.getAttribute("aria-controls"));
      btn.setAttribute("aria-expanded", String(open));
      btn.firstChild.textContent = open ? "Hide remarks" : "Show remarks";
      panel.hidden = !open;
      btn.closest(".cat").dataset.open = String(open);
    };
    const all = () => [...root.querySelectorAll("[data-toggle]")];
    const allBtn = root.querySelector("[data-expand-all]");
    const syncAll = () => {
      if (allBtn) allBtn.textContent = all().every((b) => b.getAttribute("aria-expanded") === "true") ? "Hide all remarks" : "Show all remarks";
    };
    all().forEach((b) => b.addEventListener("click", () => { setOpen(b, b.getAttribute("aria-expanded") !== "true"); syncAll(); }));
    DD.toggleAllRemarks = () => {
      const open = !all().every((b) => b.getAttribute("aria-expanded") === "true");
      all().forEach((b) => setOpen(b, open));
      syncAll();
    };
    if (allBtn) allBtn.addEventListener("click", DD.toggleAllRemarks);
  };

  /* ---------- toast + live region ---------- */
  DD.toast = function (msg) {
    let t = DD.$(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(DD._toastT);
    DD._toastT = setTimeout(() => (t.hidden = true), 5000);
  };
  DD.announce = function (msg) {
    const r = DD.$("#live");
    if (r) { r.textContent = ""; setTimeout(() => (r.textContent = msg), 50); }
  };

  /* ---------- brand ---------- */
  /* Logo: a play button built from five score bars (5 = sky ... 1 = coral). Same geometry as assets/logo.svg. */
  DD.logoMark = function (size, cls = "") {
    const bars = [
      [3, 4, 24, "var(--score-5)"], [8.6, 7, 18, "var(--score-4)"], [14.2, 10, 12, "var(--score-3)"],
      [19.8, 12.5, 7, "var(--score-2)"], [25.4, 14.5, 3, "var(--score-1)"],
    ];
    return `<svg class="logo-mark ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${bars
      .map(([x, y, h, c], i) => `<rect style="--i:${i}" x="${x}" y="${y}" width="3.6" height="${h}" rx="1.6" fill="${c}"/>`)
      .join("")}</svg>`;
  };

  /* Stock photography: openly licensed, from Wikimedia Commons (credited on each page). */
  DD.PHOTOS = {
    pitch: {
      src: "assets/img/hero-pitch.jpg",
      title: "Wikimedia Hackathon 2024 10",
      author: "Asaidlo",
      license: "CC0 1.0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimedia_Hackathon_2024_10.jpg",
    },
    teams: {
      src: "assets/img/teams-building.jpg",
      title: "Hackathon participants at Wikimania 2024",
      author: "Tulipasylvestris",
      license: "CC BY 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Hackathon_participants_at_Wikimania_2024.jpg",
    },
    room: {
      src: "assets/img/demo-room.jpg",
      title: "Day2 Indic Wikimania Hackathon 2022 10",
      author: "SSethi (WMF)",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Day2_Indic_Wikimania_Hackathon_2022_10.jpg",
    },
  };
  DD.mountCredits = function (keys) {
    const items = keys.map((k) => {
      const p = DD.PHOTOS[k];
      return `<a href="${p.sourceUrl}">${esc(p.title)}</a> by ${esc(p.author)}, <a href="${p.licenseUrl}">${esc(p.license)}</a>`;
    });
    document.querySelector("main").insertAdjacentHTML(
      "beforeend",
      `<footer class="credits"><p>Photo: ${items.join(" · ")}. Shown with a colour treatment.</p></footer>`
    );
  };

  /* ---------- shell ---------- */
  DD.mountShell = function (active) {
    const nav = [
      ["evaluate", "evaluate.html", "Evaluate"],
      ["batches", null, "Batches"],
      ["rubric", "rubric.html", "Rubric"],
    ]
      .map(([k, href, label]) =>
        href
          ? `<a href="${href}"${k === active ? ' aria-current="page"' : ""}>${label}</a>`
          : `<span aria-disabled="true" title="Available in S-2">${label}<span class="tag">S-2</span></span>`
      )
      .join("");

    document.body.insertAdjacentHTML(
      "afterbegin",
      `<a class="skip-link" href="#main">Skip to content</a>
      <header class="topbar">
        <a class="brand" href="index.html">${DD.logoMark(22)}<span>DemoDay</span></a>
        <nav class="nav" aria-label="Main">${nav}</nav>
        <div class="topbar-end"><button type="button" class="btn-text" data-shortcuts aria-keyshortcuts="Shift+/">Shortcuts</button></div>
      </header>
      <p class="notice">AI scores are decision support, not final results.</p>
      <div id="live" class="sr-only" aria-live="polite"></div>`
    );

    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog id="shortcuts-dialog" aria-labelledby="sd-title">
        <div class="dialog-head"><h2 id="sd-title" class="panel-title" style="margin:0">Keyboard shortcuts</h2>
          <button type="button" class="btn" data-close>Close</button></div>
        <div class="dialog-body">
          <table class="shortcuts"><tbody>
            <tr><td><kbd>E</kbd></td><td>Show or hide all remarks on a scorecard</td></tr>
            <tr><td><kbd>?</kbd></td><td>Open this list</td></tr>
            <tr><td><kbd>Esc</kbd></td><td>Close this list</td></tr>
          </tbody></table>
          <label class="switch"><input type="checkbox" id="sk-off"> Turn off single-key shortcuts</label>
        </div>
      </dialog>
      <details class="proto">
        <summary>Prototype controls</summary>
        <div class="proto-body">
          <label>Evaluation outcome
            <select id="proto-scn">${Object.entries(DD.SCENARIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          </label>
          <label>Rubric file
            <select id="proto-rub">${Object.entries(DD.RUBRIC_MODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          </label>
          <p>File checks, video length and the weighted score are real. Upload, processing and AI scoring are simulated; the scorecard text is sample output.</p>
          <button type="button" class="btn-text" id="proto-clear">Clear stored evaluations</button>
        </div>
      </details>`
    );

    const scn = DD.$("#proto-scn");
    scn.value = DD.scenario();
    scn.addEventListener("change", () => ls.set(SCN_KEY, scn.value));
    const rub = DD.$("#proto-rub");
    rub.value = DD.rubricMode();
    rub.addEventListener("change", () => { ls.set(RUB_KEY, rub.value); if (DD.onRubricModeChange) DD.onRubricModeChange(); });
    DD.$("#proto-clear").addEventListener("click", () => { DD.store.clear(); DD.toast("Stored evaluations cleared"); if (DD.onStoreChange) DD.onStoreChange(); });

    const dlg = DD.$("#shortcuts-dialog");
    const skOff = DD.$("#sk-off");
    skOff.checked = ls.get("dd.shortcutsOff", false);
    skOff.addEventListener("change", () => ls.set("dd.shortcutsOff", skOff.checked));
    DD.$("[data-shortcuts]").addEventListener("click", () => dlg.showModal());
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());

    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
      if (dlg.open) return;
      if (e.key === "?") { e.preventDefault(); dlg.showModal(); return; }
      if (ls.get("dd.shortcutsOff", false)) return;
      if ((e.key === "e" || e.key === "E") && DD.toggleAllRemarks && document.querySelector("[data-toggle]")) {
        e.preventDefault();
        DD.toggleAllRemarks();
      }
    });
  };
})();
