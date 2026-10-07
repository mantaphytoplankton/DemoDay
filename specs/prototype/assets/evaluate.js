/* DemoDay S-1 prototype: Evaluate page (SNG-01 upload, SNG-02 live progress, SNG-03 scorecard). */
(function () {
  "use strict";
  const { $, esc } = DD;

  DD.mountShell("evaluate");
  DD.mountCredits(["pitch"]);
  $("#hero-lockup").insertAdjacentHTML("afterbegin", DD.logoMark(40) + '<span class="lockup-name">DemoDay</span>');

  DD.loadRubric().then((r) => {
    if (!r.meta) return;
    $("#stickers").innerHTML = r.meta.categories
      .map((c) => `<li class="sticker">${esc(c.name)} <b>${c.weight}%</b></li>`).join("");
  });

  /* Pitch clock: 3:00 limit until a video is chosen, then its measured length. */
  function setClock(duration) {
    const c = $("#clock");
    if (duration == null) {
      c.dataset.state = "limit";
      $("#clock-label").textContent = "Pitch limit";
      $("#clock-num").textContent = "3:00";
      $("#clock-limit").hidden = true;
      $("#clock-note").textContent = "Longer videos are flagged";
      return;
    }
    const over = Math.round(duration) > 180;
    c.dataset.state = over ? "over" : "ok";
    $("#clock-label").textContent = "This video";
    $("#clock-num").textContent = DD.formatDuration(duration);
    $("#clock-limit").hidden = false;
    $("#clock-note").textContent = over ? "Over the 3:00 limit, will be flagged" : "Within the 3:00 limit";
  }

  const MAX_BYTES = 1024 ** 3; // 1 GB (architecture-design.md Q4)
  const STEPS = ["Uploading", "Processing Video", "Scoring", "Completed"];
  const SOFT_TIP_MS = 10000;
  const ERR = {
    type: "Unsupported file type. Use MP4, MOV or WebM.",
    size: "File is larger than 1 GB",
    content: "File is not a readable video",
    unprocessable: "Video could not be processed (corrupted or unsupported format)",
    unavailable: "AI service unavailable, retry later",
    incomplete: "The AI returned an incomplete scorecard",
    rubric: "Rubric configuration invalid",
  };

  const els = {
    upload: $("#upload-panel"), input: $("#file-input"), dz: $("#dropzone"), err: $("#file-error"),
    run: $("#run-panel"), title: $("#run-title"), meta: $("#run-meta"), status: $("#run-status"),
    steps: $("#steps"), prog: $("#upload-progress"), tip: $("#soft-tip"), outcome: $("#outcome"), recent: $("#recent"),
  };

  /* ---------- recent evaluations ---------- */
  function renderRecent() {
    const list = DD.store.list();
    if (!list.length) {
      els.recent.innerHTML = `<p class="panel-sub">No evaluations yet. Upload a team video to get its first scorecard.</p>`;
      return;
    }
    els.recent.innerHTML = `<ul class="recent">${list
      .slice(0, 8)
      .map((ev) => {
        const score = ev.status === "Completed"
          ? `<span class="mono ${DD.scoreClass(ev.result.overallScore)}" style="color:var(--sc);font-weight:600">${ev.result.overallScore.toFixed(2)}</span>`
          : "";
        return `<li><div class="recent-row"><a href="result.html?id=${encodeURIComponent(ev.id)}">${esc(ev.fileName)}</a>${score}</div>
          <div class="recent-meta">${DD.stateBadge(ev.status)}<span>${DD.formatTime(ev.updatedAt)}</span></div></li>`;
      })
      .join("")}</ul>`;
  }
  DD.onStoreChange = renderRecent;
  renderRecent();

  /* ---------- SNG-01: validation (real checks on the chosen file) ---------- */
  function showError(msg) {
    els.err.innerHTML = `${DD.icon("failed")}<span>${esc(msg)}</span>`;
    els.err.hidden = false;
    els.input.setAttribute("aria-invalid", "true");
  }
  function clearError() {
    els.err.hidden = true;
    els.err.textContent = "";
    els.input.removeAttribute("aria-invalid");
  }

  const OK_EXT = /\.(mp4|mov|webm)$/i;
  const OK_MIME = ["video/mp4", "video/quicktime", "video/webm", ""];

  async function sniff(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isFtyp = b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // "ftyp" (MP4/MOV)
    const isEbml = b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // WebM
    return isFtyp || isEbml;
  }
  function probeDuration(file) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      const done = (d) => { URL.revokeObjectURL(url); resolve(d); };
      v.preload = "metadata";
      v.onloadedmetadata = () => done(isFinite(v.duration) ? v.duration : null);
      v.onerror = () => done(null); // codec not playable in this browser; the server measures length later
      setTimeout(() => done(null), 5000);
      v.src = url;
    });
  }

  async function handleFile(file) {
    clearError();
    if (!file) return;
    if (!OK_EXT.test(file.name) || !OK_MIME.includes(file.type)) return showError(ERR.type);
    if (file.size > MAX_BYTES) return showError(ERR.size);
    if (!(await sniff(file))) return showError(ERR.content);
    const duration = await probeDuration(file);
    start(file, duration);
  }

  els.input.addEventListener("change", () => { handleFile(els.input.files[0]); els.input.value = ""; });
  ["dragenter", "dragover"].forEach((t) => els.dz.addEventListener(t, (e) => { e.preventDefault(); els.dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => els.dz.addEventListener(t, () => els.dz.classList.remove("is-over")));
  els.dz.addEventListener("drop", (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); });

  /* ---------- SNG-02: run (simulated server/agent timing) ---------- */
  let run = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function renderSteps() {
    els.steps.innerHTML = STEPS.map((name, i) => {
      let s = "todo", icon = "pending";
      if (i < run.stepIndex || (run.status === "Completed")) { s = "done"; icon = "done"; }
      else if (i === run.stepIndex && run.status === "Failed") { s = "failed"; icon = "failed"; }
      else if (i === run.stepIndex) { s = "active"; icon = "active"; }
      const cur = s === "active" ? ' aria-current="step"' : "";
      const meta = run.stepMeta[i] ? `<div class="step-meta">${esc(run.stepMeta[i])}</div>` : "";
      return `<li class="step" data-s="${s}"${cur}><span class="state">${DD.icon(icon)}<span>${name}</span></span>${meta}</li>`;
    }).join("");
    els.status.innerHTML = DD.stateBadge(run.status);
  }

  function setStep(i, status) {
    run.stepIndex = i;
    run.status = status || STEPS[i];
    run.stepStartedAt = Date.now();
    els.tip.hidden = true;
    renderSteps();
  }

  function tick() {
    if (!run || run.finished) return;
    const elapsed = Date.now() - run.stepStartedAt;
    if (run.stepIndex < 3) {
      const base = run.stepNote || "";
      run.stepMeta[run.stepIndex] = (base ? base + " · " : "") + Math.floor(elapsed / 1000) + "s";
      renderSteps();
    }
    if (elapsed >= SOFT_TIP_MS && run.stepIndex < 3) {
      els.tip.textContent = `More time is needed. Still ${STEPS[run.stepIndex].toLowerCase()}…`;
      els.tip.hidden = false;
    }
  }

  async function start(file, duration) {
    const scn = DD.scenario();
    const rubric = await DD.loadRubric();
    run = {
      id: DD.newId(), file, duration, scn, rubric,
      stepIndex: 0, status: "Uploading", stepStartedAt: Date.now(), stepMeta: [], stepNote: "", finished: false,
    };
    els.upload.hidden = true;
    els.outcome.innerHTML = "";
    els.run.hidden = false;
    els.title.textContent = file.name;
    els.meta.textContent = `${DD.formatDuration(duration)} · ${DD.formatBytes(file.size)}`;
    if (duration != null) setClock(duration);
    renderSteps();
    run.timer = setInterval(tick, 250);
    DD.announce(`Evaluating ${file.name}. Uploading.`);

    try {
      // Rubric is read when the evaluation starts (JDG-01).
      if (rubric.error) throw failure(0, ERR.rubric, `${rubric.error}. Fix rubric.md and evaluate again.`);

      // Uploading: progress bar with bytes sent.
      els.prog.hidden = false;
      const upMs = Math.min(6000, Math.max(2000, (file.size / (40 * 1024 ** 2)) * 1000));
      const t0 = Date.now();
      while (Date.now() - t0 < upMs) {
        const p = Math.min(1, (Date.now() - t0) / upMs);
        els.prog.firstElementChild.style.width = (p * 100).toFixed(0) + "%";
        els.prog.setAttribute("aria-valuenow", (p * 100).toFixed(0));
        run.stepNote = `${Math.round(p * 100)}% · ${DD.formatBytes(file.size * p)} of ${DD.formatBytes(file.size)}`;
        await sleep(150);
      }
      els.prog.hidden = true;
      run.stepMeta[0] = DD.formatBytes(file.size) + " sent";
      run.stepNote = "";

      // Processing Video
      setStep(1);
      if (scn === "unprocessable") { await sleep(3000); throw failure(1, ERR.unprocessable, "Check that the file plays on your computer, then evaluate it again."); }
      await sleep(scn === "slow" ? 13000 : 4000);
      run.stepMeta[1] = "Ready";

      // Scoring
      setStep(2);
      if (scn === "unavailable") {
        for (let a = 1; a <= 4; a++) {
          run.stepNote = `AI service busy · attempt ${a} of 4`;
          await sleep(1500);
        }
        throw failure(2, ERR.unavailable, "No score was saved. Evaluate the video again in a few minutes.");
      }
      if (scn === "incomplete") {
        await sleep(2500);
        run.stepNote = "Checking scorecard format · retrying once";
        await sleep(2500);
        throw failure(2, ERR.incomplete, "No score was saved. Evaluate the video again.");
      }
      await sleep(4500);

      complete();
    } catch (e) {
      if (e && e.isFailure) fail(e);
      else { console.error(e); fail(failure(run.stepIndex, "Evaluation stopped unexpectedly", "Evaluate the video again.")); }
    }
  }

  function failure(step, reason, help) {
    return { isFailure: true, step, reason, help };
  }

  async function buildResult() {
    const meta = run.rubric.meta;
    const promptVersion = (await DD.sha256("prompts/judge-system.md v1")).slice(0, 8);
    const out = DD.SAMPLE_OUTPUT;
    return {
      categories: out.categories,
      overallComments: out.overallComments,
      overallScore: DD.weightedOverall(out.categories, meta),
      rubricMeta: meta,
      durationSeconds: run.duration,
      exceedsMaxDuration: run.duration != null && Math.round(run.duration) > meta.maxDurationSeconds,
      model: "gemini-3.8-flash",
      rubricSource: run.rubric.source,
      rubricVersion: run.rubric.version,
      promptVersion,
      finishedAt: new Date().toISOString(),
    };
  }

  async function complete() {
    run.finished = true;
    clearInterval(run.timer);
    run.stepMeta[2] = "Done";
    const result = await buildResult();
    const ev = {
      id: run.id, fileName: run.file.name, sizeBytes: run.file.size, status: "Completed",
      result, updatedAt: result.finishedAt,
    };
    DD.store.save(ev);
    setStep(3, "Completed");
    els.tip.hidden = true;
    renderRecent();

    els.outcome.innerHTML = `
      <div class="btn-row" style="margin-bottom:12px">
        <button type="button" class="btn btn-primary" id="again">Evaluate another video</button>
        <a class="btn" href="result.html?id=${encodeURIComponent(ev.id)}">Open result page</a>
      </div>
      ${DD.renderScorecard(ev, { prefix: "ev" })}`;
    DD.bindScorecard(els.outcome);
    $("#again").addEventListener("click", reset);
    const h = $("#sc-title-ev");
    h.setAttribute("tabindex", "-1");
    h.focus();
    DD.announce(`Evaluation completed. Overall AI score ${result.overallScore.toFixed(2)} out of 5.`);
  }

  function fail(f) {
    run.finished = true;
    clearInterval(run.timer);
    els.prog.hidden = true;
    run.stepIndex = f.step;
    run.status = "Failed";
    run.stepMeta[f.step] = "Stopped";
    els.tip.hidden = true;
    renderSteps();

    DD.store.save({
      id: run.id, fileName: run.file.name, sizeBytes: run.file.size, status: "Failed",
      error: { reason: f.reason, help: f.help, step: STEPS[f.step] }, updatedAt: new Date().toISOString(),
    });
    renderRecent();

    const rubricLink = f.reason === ERR.rubric ? `<a class="btn" href="rubric.html">View rubric</a>` : "";
    els.outcome.innerHTML = `
      <div class="banner banner-failed" role="alert">
        <span class="state state-failed">${DD.icon("failed")}</span>
        <div>
          <p class="banner-title" id="fail-title" tabindex="-1">${esc(f.reason)}</p>
          <p class="banner-body">${esc(f.help)}</p>
          <div class="btn-row"><button type="button" class="btn btn-primary" id="again">Evaluate another video</button>${rubricLink}</div>
        </div>
      </div>`;
    $("#again").addEventListener("click", reset);
    $("#fail-title").focus();
  }

  function reset() {
    if (run && run.timer) clearInterval(run.timer);
    run = null;
    els.run.hidden = true;
    els.outcome.innerHTML = "";
    els.upload.hidden = false;
    setClock(null);
    DD.toggleAllRemarks = null;
    clearError();
    els.input.focus();
  }
})();
