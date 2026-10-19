/* =========================================================
   Struktur:
   1. STATE & PERSISTENCE   — kriteria tetap, studio dinamis, localStorage
   2. PERHITUNGAN AHP       — matriks berpasangan -> bobot -> uji konsistensi
   3. RENDER                — dashboard, data studio, perbandingan
                                kriteria/alternatif, hasil perangkingan
   4. INTERAKSI              — modal studio, klik skala perbandingan, tab, nav
========================================================= */

(function () {
  "use strict";

  /* =========================================================
     1. STATE & PERSISTENCE
  ========================================================= */

  const STORAGE_KEY_PROVIDERS = "ahp_studio_list";
  const STORAGE_KEY_CRIT_PAIRS = "ahp_studio_criteria_pairs";
  const STORAGE_KEY_ALT_PAIRS = "ahp_studio_alt_pairs";

  // Lima kriteria tetap — tidak bisa ditambah/dihapus,
  // hanya bobotnya yang dihitung dari perbandingan berpasangan.
  const CRITERIA = [
    { id: "harga", name: "Harga Sewa", type: "cost", hint: "Studio dengan tarif sewa per jam lebih murah dianggap lebih unggul pada kriteria ini." },
    { id: "alat", name: "Kualitas Peralatan", type: "benefit", hint: "Studio dengan instrumen, amplifier, mikrofon, dan audio interface yang lebih bagus dan terawat dianggap lebih unggul pada kriteria ini." },
    { id: "akustik", name: "Akustik Ruangan", type: "benefit", hint: "Studio dengan ruangan lebih kedap suara dan akustik lebih baik (tidak menggema, tidak bocor) dianggap lebih unggul pada kriteria ini." },
    { id: "lokasi", name: "Lokasi & Akses", type: "benefit", hint: "Studio dengan lokasi lebih dekat, mudah dijangkau, dan parkir lebih lega dianggap lebih unggul pada kriteria ini." },
    { id: "layanan", name: "Fasilitas & Layanan", type: "benefit", hint: "Studio dengan fasilitas lebih lengkap (sound engineer, ruang tunggu, jam buka fleksibel) dianggap lebih unggul pada kriteria ini." },
  ];

  // Data contoh: bobot kriteria & perbandingan studio sudah diisi supaya
  // aplikasi langsung menunjukkan hasil yang bermakna (CR terverifikasi < 0.1).
  const DEFAULT_PROVIDERS = [
    { id: "p1", name: "Studio Gema Senja" },
    { id: "p2", name: "Rumah Bunyi" },
    { id: "p3", name: "Kamar Nada" },
    { id: "p4", name: "Garasi Rekam" },
  ];

  // Kunci "i-j" memakai indeks CRITERIA (i<j). Nilai = perbandingan kriteria[i] vs kriteria[j].
  const DEFAULT_CRIT_PAIRS = {
    "0-1": 1 / 3, "0-2": 1 / 3, "0-3": 3, "0-4": 3,
    "1-2": 1, "1-3": 5, "1-4": 5,
    "2-3": 5, "2-4": 5,
    "3-4": 1,
  };

  // Kunci kanonik "idKecil|idBesar" (urut leksikografis) per kriteria.
  const DEFAULT_ALT_PAIRS = {
    harga:   { "p1|p2": 5, "p1|p3": 1 / 3, "p1|p4": 3, "p2|p3": 1 / 7, "p2|p4": 1 / 3, "p3|p4": 5 },
    alat:    { "p1|p2": 3, "p1|p3": 5, "p1|p4": 1 / 3, "p2|p3": 3, "p2|p4": 1 / 5, "p3|p4": 1 / 7 },
    akustik: { "p1|p2": 1 / 5, "p1|p3": 3, "p1|p4": 1 / 3, "p2|p3": 7, "p2|p4": 3, "p3|p4": 1 / 5 },
    lokasi:  { "p1|p2": 1 / 7, "p1|p3": 1 / 5, "p1|p4": 1 / 3, "p2|p3": 3, "p2|p4": 5, "p3|p4": 3 },
    layanan: { "p1|p2": 5, "p1|p3": 7, "p1|p4": 3, "p2|p3": 3, "p2|p4": 1 / 3, "p3|p4": 1 / 5 },
  };

  let state = {
    providers: [],
    criteriaPairs: {},
    altPairs: {},
  };

  // Tab kriteria yang sedang aktif di halaman "Perbandingan Alternatif".
  let activeCritTab = CRITERIA[0].id;

  function loadState() {
    try {
      const rawProviders = localStorage.getItem(STORAGE_KEY_PROVIDERS);
      const rawCritPairs = localStorage.getItem(STORAGE_KEY_CRIT_PAIRS);
      const rawAltPairs = localStorage.getItem(STORAGE_KEY_ALT_PAIRS);
      state.providers = rawProviders ? JSON.parse(rawProviders) : deepClone(DEFAULT_PROVIDERS);
      state.criteriaPairs = rawCritPairs ? JSON.parse(rawCritPairs) : deepClone(DEFAULT_CRIT_PAIRS);
      state.altPairs = rawAltPairs ? JSON.parse(rawAltPairs) : deepClone(DEFAULT_ALT_PAIRS);
    } catch (err) {
      console.error("Gagal memuat data lokal, memakai data bawaan.", err);
      state.providers = deepClone(DEFAULT_PROVIDERS);
      state.criteriaPairs = deepClone(DEFAULT_CRIT_PAIRS);
      state.altPairs = deepClone(DEFAULT_ALT_PAIRS);
    }
    CRITERIA.forEach((c) => { if (!state.altPairs[c.id]) state.altPairs[c.id] = {}; });
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(state.providers));
    localStorage.setItem(STORAGE_KEY_CRIT_PAIRS, JSON.stringify(state.criteriaPairs));
    localStorage.setItem(STORAGE_KEY_ALT_PAIRS, JSON.stringify(state.altPairs));
  }

  function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function uid(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- Kunci kanonik perbandingan studio ---------- */
  function pairKey(idA, idB) { return idA < idB ? idA + "|" + idB : idB + "|" + idA; }

  // Nilai perbandingan "idA vs idB" (jika > 1, idA dianggap lebih unggul).
  function getAltVal(critId, idA, idB) {
    if (idA === idB) return 1;
    const stored = state.altPairs[critId] ? state.altPairs[critId][pairKey(idA, idB)] : undefined;
    if (stored === undefined) return 1; // pasangan baru -> dianggap sama penting
    return idA < idB ? stored : 1 / stored;
  }

  function setAltVal(critId, idA, idB, value) {
    if (!state.altPairs[critId]) state.altPairs[critId] = {};
    const key = pairKey(idA, idB);
    state.altPairs[critId][key] = idA < idB ? value : 1 / value;
  }

  function removeProviderPairs(id) {
    CRITERIA.forEach((c) => {
      const table = state.altPairs[c.id];
      if (!table) return;
      Object.keys(table).forEach((key) => {
        if (key.startsWith(id + "|") || key.endsWith("|" + id)) delete table[key];
      });
    });
  }

  /* =========================================================
     2. PERHITUNGAN AHP
     Metode eigenvector-approksimasi (normalisasi kolom -> rata-rata baris),
     standar dipakai pada implementasi AHP sederhana.
  ========================================================= */

  const RI_TABLE = { 1: 0, 2: 0, 3: 0.58, 4: 0.9, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45, 10: 1.49, 11: 1.51, 12: 1.53, 13: 1.56, 14: 1.57, 15: 1.59 };

  // valFn(i, j) mengembalikan M[i][j] untuk i !== j.
  function computeAHP(n, valFn) {
    if (n <= 0) return { M: [], w: [], lambdaMax: 0, CI: 0, RI: 0, CR: 0, consistent: true };
    const M = [];
    for (let i = 0; i < n; i++) {
      M.push([]);
      for (let j = 0; j < n; j++) M[i][j] = i === j ? 1 : valFn(i, j);
    }
    const colSum = Array(n).fill(0);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) colSum[j] += M[i][j];
    const norm = M.map((row) => row.map((v, j) => (colSum[j] > 0 ? v / colSum[j] : 0)));
    const w = norm.map((row) => row.reduce((a, b) => a + b, 0) / n);
    const ws = M.map((row) => row.reduce((sum, v, j) => sum + v * w[j], 0));
    const cv = ws.map((v, i) => (w[i] > 0 ? v / w[i] : 0));
    const lambdaMax = cv.reduce((a, b) => a + b, 0) / n;
    const CI = n > 2 ? (lambdaMax - n) / (n - 1) : 0;
    const RI = RI_TABLE[n] !== undefined ? RI_TABLE[n] : 1.59;
    const CR = n > 2 && RI > 0 ? CI / RI : 0;
    return { M, w, lambdaMax, CI, RI, CR, consistent: CR <= 0.1, n };
  }

  function computeCriteriaAHP() {
    return computeAHP(CRITERIA.length, (i, j) => {
      if (i < j) return state.criteriaPairs[`${i}-${j}`] !== undefined ? state.criteriaPairs[`${i}-${j}`] : 1;
      return 1 / (state.criteriaPairs[`${j}-${i}`] !== undefined ? state.criteriaPairs[`${j}-${i}`] : 1);
    });
  }

  function computeAltAHP(critId) {
    const providers = state.providers;
    return computeAHP(providers.length, (i, j) => getAltVal(critId, providers[i].id, providers[j].id));
  }

  // Sintesis: skor akhir provider = Σ (bobot kriteria × prioritas lokal).
  function computeFinalRanking() {
    const critResult = computeCriteriaAHP();
    const altResults = {};
    CRITERIA.forEach((c) => { altResults[c.id] = computeAltAHP(c.id); });

    const providers = state.providers;
    const scored = providers.map((p, pi) => {
      let score = 0;
      const breakdown = CRITERIA.map((c, ci) => {
        const weight = critResult.w[ci];
        const localP = altResults[c.id].w[pi] || 0;
        const contrib = weight * localP;
        score += contrib;
        return { crit: c, weight, localP, contrib };
      });
      return { provider: p, score, breakdown };
    }).sort((a, b) => b.score - a.score);

    return { scored, critResult, altResults };
  }

  function fmt(num, decimals) {
    if (!isFinite(num)) return "0";
    return num.toFixed(decimals == null ? 4 : decimals);
  }
  function pct(num, decimals) { return fmt(num * 100, decimals == null ? 1 : decimals) + "%"; }

  /* ---------- Skala Saaty 1–9 (kontrol geser 9 tombol) ---------- */
  const SCALE_VALUES = [9, 7, 5, 3, 1, 3, 5, 7, 9]; // indeks 0..8, 4 = tengah (sama penting)

  function valueToIndex(v) {
    if (Math.abs(v - 1) < 1e-9) return 4;
    if (v > 1) {
      const arr = [9, 7, 5, 3];
      let best = 0, bd = Infinity;
      arr.forEach((val, idx) => { const d = Math.abs(val - v); if (d < bd) { bd = d; best = idx; } });
      return best;
    }
    const inv = 1 / v;
    const arr = [3, 5, 7, 9];
    let best = 5, bd = Infinity;
    arr.forEach((val, k) => { const d = Math.abs(val - inv); if (d < bd) { bd = d; best = 5 + k; } });
    return best;
  }

  function indexToValue(idx) {
    if (idx === 4) return 1;
    if (idx < 4) return SCALE_VALUES[idx];
    return 1 / SCALE_VALUES[idx];
  }

  /* =========================================================
     3. RENDER
  ========================================================= */

  const els = {};
  function cacheEls() {
    [
      "page-title", "page-desc", "crit-status-chip",
      "stat-provider-count", "stat-cr-value", "stat-cr-note", "stat-top-name", "stat-top-score",
      "chart-preview",
      "tbody-provider", "empty-provider",
      "pair-list-kriteria", "tbody-bobot-kriteria", "consistency-kriteria",
      "crit-tabs", "crit-hint", "pair-list-alternatif", "empty-alt-compare",
      "tbody-prioritas-lokal", "consistency-alternatif",
      "panel-warn-hasil", "warn-hasil-text",
      "chart-hasil", "tbl-sintesis", "ranking-list",
      "modal-backdrop", "modal-title", "form-provider", "f-id", "f-nama", "form-error",
      "modal-close", "modal-cancel", "modal-save", "btn-add-provider",
      "detail-backdrop", "detail-title", "detail-body", "detail-close", "detail-ok",
      "toast",
    ].forEach((id) => (els[id] = document.getElementById(id)));
  }

  function renderAll() {
    const result = computeFinalRanking();
    renderTopStatus(result);
    renderDashboard(result);
    renderProviderTable();
    renderKriteriaPage(result);
    renderAlternatifPage(result);
    renderHasilPage(result);
  }

  function renderTopStatus(result) {
    const CR = result.critResult.CR;
    const ok = result.critResult.consistent;
    els["crit-status-chip"].textContent = ok ? "Kriteria konsisten" : `Kriteria belum konsisten (CR ${fmt(CR, 3)})`;
    els["crit-status-chip"].classList.toggle("warn", !ok);
  }

  function renderDashboard(result) {
    els["stat-provider-count"].textContent = state.providers.length;

    const CR = result.critResult.CR;
    els["stat-cr-value"].textContent = fmt(CR, 3);
    els["stat-cr-note"].textContent = result.critResult.consistent ? "konsisten (CR \u2264 0.1)" : "tinjau kembali penilaian";

    if (result.scored.length === 0) {
      els["stat-top-name"].textContent = "\u2014";
      els["stat-top-score"].textContent = "belum ada studio";
    } else {
      const top = result.scored[0];
      els["stat-top-name"].textContent = top.provider.name;
      els["stat-top-score"].textContent = `skor akhir ${fmt(top.score, 4)}`;
    }

    renderBarChart(els["chart-preview"], result.scored.map((s) => ({ label: s.provider.name, value: s.score })));
  }

  function renderBarChart(container, items) {
    if (!container) return;
    if (items.length === 0) {
      container.innerHTML = `<p class="chart-empty">Belum ada data untuk ditampilkan.</p>`;
      return;
    }
    const maxV = items[0].value || 1;
    container.innerHTML = items
      .map((it, i) => {
        const p = maxV > 0 ? (it.value / maxV) * 100 : 0;
        return `
          <div class="chart-bar-row${i === 0 ? " first" : ""}">
            <span class="chart-bar-label" title="${escapeHtml(it.label)}">${escapeHtml(it.label)}</span>
            <span class="chart-bar-track"><span class="chart-bar-fill" style="clip-path:inset(0 100% 0 0)" data-width="${fmt(p, 1)}"></span></span>
            <span class="chart-bar-value">${fmt(it.value, 4)}</span>
          </div>`;
      })
      .join("");
    requestAnimationFrame(() => {
      container.querySelectorAll(".chart-bar-fill").forEach((el) => { el.style.clipPath = "inset(0 " + (100 - Number(el.dataset.width)) + "% 0 0)"; });
    });
  }

  /* ---------- Data Studio ---------- */
  function renderProviderTable() {
    const tbody = els["tbody-provider"];
    tbody.innerHTML = "";
    els["empty-provider"].hidden = state.providers.length > 0;
    state.providers.forEach((p) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="cell-name">${escapeHtml(p.name)}</td>
        <td class="td-actions">
          <span class="row-actions">
            <button class="row-btn edit" data-id="${p.id}" aria-label="Edit ${escapeHtml(p.name)}">
              <svg viewBox="0 0 16 16"><path d="M11.5 2.5l2 2L5 13l-2.7.7.7-2.7L11.5 2.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
            </button>
            <button class="row-btn delete" data-id="${p.id}" aria-label="Hapus ${escapeHtml(p.name)}">
              <svg viewBox="0 0 16 16"><path d="M3.5 4.5h9M6.5 4.5v-1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M6 7.5v4M10 7.5v4M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </span>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  /* ---------- Perbandingan Kriteria ---------- */
  function renderPairCard(opts) {
    const { leftLabel, rightLabel, activeIdx, dataAttrs } = opts;
    const btns = SCALE_VALUES
      .map((val, idx) => `<button type="button" class="scale-btn${idx === activeIdx ? " active" : ""}${idx === 4 ? " scale-btn-mid" : ""}" data-idx="${idx}">${idx === 4 ? "1" : val}</button>`)
      .join("");
    return `
      <div class="pair-card" ${dataAttrs}>
        <div class="pair-head">
          <span class="pair-name">${escapeHtml(leftLabel)}</span>
          <span class="pair-vs">vs</span>
          <span class="pair-name pair-name-right">${escapeHtml(rightLabel)}</span>
        </div>
        <div class="pair-scale">${btns}</div>
        <div class="pair-scale-foot">
          <span>${escapeHtml(leftLabel)} lebih penting</span>
          <span>Sama penting</span>
          <span>${escapeHtml(rightLabel)} lebih penting</span>
        </div>
      </div>`;
  }

  function renderKriteriaPage(result) {
    // Kartu perbandingan berpasangan
    let html = "";
    for (let i = 0; i < CRITERIA.length; i++) {
      for (let j = i + 1; j < CRITERIA.length; j++) {
        const key = `${i}-${j}`;
        const val = state.criteriaPairs[key] !== undefined ? state.criteriaPairs[key] : 1;
        html += renderPairCard({
          leftLabel: CRITERIA[i].name,
          rightLabel: CRITERIA[j].name,
          activeIdx: valueToIndex(val),
          dataAttrs: `data-kind="kriteria" data-i="${i}" data-j="${j}"`,
        });
      }
    }
    els["pair-list-kriteria"].innerHTML = html;

    // Tabel bobot
    const cr = result.critResult;
    els["tbody-bobot-kriteria"].innerHTML = CRITERIA
      .map((c, i) => {
        const badge = c.type === "benefit" ? `<span class="badge badge-benefit">Benefit</span>` : `<span class="badge badge-cost">Cost</span>`;
        return `<tr><td class="cell-name">${escapeHtml(c.name)}</td><td class="td-dir">${badge}</td><td><strong>${pct(cr.w[i], 1)}</strong></td></tr>`;
      })
      .join("");

    renderConsistencyBox(els["consistency-kriteria"], cr, "kriteria");
  }

  function renderConsistencyBox(el, res, kind) {
    const ok = res.consistent;
    el.className = "consistency-box" + (ok ? "" : " warn");
    const note = ok
      ? "Penilaian konsisten \u2014 rasio konsistensi berada dalam batas wajar (\u2264 0.1)."
      : `Penilaian ${kind === "kriteria" ? "kriteria" : "studio pada kriteria ini"} belum konsisten. Sebaiknya tinjau kembali beberapa perbandingan agar hasil lebih dapat dipertanggungjawabkan.`;
    el.innerHTML = `
      <div class="cbox-metric"><span>&lambda; maks</span><span>${fmt(res.lambdaMax, 4)}</span></div>
      <div class="cbox-metric"><span>CI</span><span>${fmt(res.CI, 4)}</span></div>
      <div class="cbox-metric"><span>RI</span><span>${fmt(res.RI, 2)}</span></div>
      <div class="cbox-metric"><span>CR</span><span>${fmt(res.CR, 4)}</span></div>
      <span class="badge ${ok ? "badge-ok" : "badge-warn"}">${ok ? "Konsisten" : "Tidak Konsisten"}</span>
      <p class="cbox-note">${note}</p>`;
  }

  /* ---------- Perbandingan Alternatif ---------- */
  function renderAlternatifPage(result) {
    els["crit-tabs"].innerHTML = CRITERIA
      .map((c) => `<button type="button" class="crit-tab${c.id === activeCritTab ? " active" : ""}" data-crit="${c.id}">${escapeHtml(c.name)}</button>`)
      .join("");

    const crit = CRITERIA.find((c) => c.id === activeCritTab) || CRITERIA[0];
    const badge = crit.type === "benefit" ? `<span class="badge badge-benefit">Benefit</span>` : `<span class="badge badge-cost">Cost</span>`;
    els["crit-hint"].innerHTML = `${badge}<span>${escapeHtml(crit.hint)}</span>`;

    const providers = state.providers;
    if (providers.length < 2) {
      els["pair-list-alternatif"].innerHTML = "";
      els["empty-alt-compare"].hidden = false;
      els["tbody-prioritas-lokal"].innerHTML = "";
      els["consistency-alternatif"].innerHTML = "";
      return;
    }
    els["empty-alt-compare"].hidden = true;

    let html = "";
    for (let i = 0; i < providers.length; i++) {
      for (let j = i + 1; j < providers.length; j++) {
        const a = providers[i], b = providers[j];
        const val = getAltVal(activeCritTab, a.id, b.id);
        html += renderPairCard({
          leftLabel: a.name,
          rightLabel: b.name,
          activeIdx: valueToIndex(val),
          dataAttrs: `data-kind="alternatif" data-crit="${activeCritTab}" data-id-a="${a.id}" data-id-b="${b.id}"`,
        });
      }
    }
    els["pair-list-alternatif"].innerHTML = html;

    const altRes = result.altResults[activeCritTab];
    els["tbody-prioritas-lokal"].innerHTML = providers
      .map((p, i) => `<tr><td class="cell-name">${escapeHtml(p.name)}</td><td><strong>${pct(altRes.w[i], 1)}</strong></td></tr>`)
      .join("");

    renderConsistencyBox(els["consistency-alternatif"], altRes, "alternatif");
  }

  /* ---------- Hasil Perangkingan ---------- */
  function renderHasilPage(result) {
    // Banner peringatan bila ada matriks yang belum konsisten
    const inconsistentCrits = CRITERIA.filter((c) => !result.altResults[c.id].consistent && state.providers.length > 2);
    const critWarn = !result.critResult.consistent;
    if (critWarn || inconsistentCrits.length > 0) {
      const parts = [];
      if (critWarn) parts.push("perbandingan kriteria");
      inconsistentCrits.forEach((c) => parts.push(`perbandingan studio pada "${c.name}"`));
      els["warn-hasil-text"].textContent = `Beberapa penilaian belum konsisten (CR > 0.1): ${parts.join(", ")}. Skor akhir tetap dihitung, namun sebaiknya tinjau kembali perbandingan tersebut.`;
      els["panel-warn-hasil"].hidden = false;
    } else {
      els["panel-warn-hasil"].hidden = true;
    }

    renderBarChart(els["chart-hasil"], result.scored.map((s) => ({ label: s.provider.name, value: s.score })));

    // Tabel sintesis
    const theadRow = els["tbl-sintesis"].querySelector("thead tr");
    theadRow.innerHTML = "<th>Studio</th>" + CRITERIA.map((c) => `<th>${escapeHtml(c.name)}</th>`).join("") + "<th>Skor Akhir</th><th>Ranking</th>";
    els["tbl-sintesis"].querySelector("tbody").innerHTML = result.scored
      .map((s, rank) => {
        const cells = s.breakdown.map((b) => `<td>${fmt(b.contrib, 4)}</td>`).join("");
        return `<tr><td class="cell-name">${escapeHtml(s.provider.name)}</td>${cells}<td><strong>${fmt(s.score, 4)}</strong></td><td>#${rank + 1}</td></tr>`;
      })
      .join("");

    // Daftar peringkat
    const list = els["ranking-list"];
    if (result.scored.length === 0) {
      list.innerHTML = `<p class="empty-msg">Belum ada studio untuk dihitung. Tambahkan studio pada menu Data Studio.</p>`;
      return;
    }
    const maxScore = result.scored[0].score || 1;
    list.innerHTML = result.scored
      .map((s, i) => {
        const p = maxScore > 0 ? (s.score / maxScore) * 100 : 0;
        return `
          <div class="rank-row${i === 0 ? " first" : ""}" data-id="${s.provider.id}">
            <span class="rank-num">${i + 1}</span>
            <span class="rank-main">
              <span class="rank-name">${escapeHtml(s.provider.name)}</span>
              <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${fmt(p, 1)}%"></span></span>
            </span>
            <span class="rank-score">
              <span class="rank-score-val">${fmt(s.score, 4)}</span>
              <span class="rank-score-pct">${pct(s.score, 1)} skor</span>
            </span>
          </div>`;
      })
      .join("");
    list.querySelectorAll(".rank-row").forEach((row) => {
      row.addEventListener("click", () => openDetail(row.dataset.id));
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /* =========================================================
     4. INTERAKSI
  ========================================================= */

  function initNav() {
    document.querySelectorAll(".nav-item").forEach((btn) => {
      btn.addEventListener("click", () => switchPage(btn.dataset.page));
    });
  }

  const PAGE_META = {
    dashboard: ["Dashboard", "Ringkasan sistem pendukung keputusan pemilihan studio musik"],
    provider: ["Data Studio", "Kelola daftar studio musik yang akan dibandingkan"],
    kriteria: ["Perbandingan Kriteria", "Bandingkan lima kriteria secara berpasangan untuk mendapatkan bobot"],
    alternatif: ["Perbandingan Alternatif", "Bandingkan studio secara berpasangan, terpisah untuk tiap kriteria"],
    hasil: ["Hasil Perangkingan", "Skor akhir dan peringkat studio berdasarkan metode AHP"],
  };

  function switchPage(page) {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
    document.querySelectorAll(".page").forEach((p) => p.classList.toggle("active", p.id === "page-" + page));
    const meta = PAGE_META[page];
    if (meta) {
      els["page-title"].textContent = meta[0];
      els["page-desc"].textContent = meta[1];
    }
  }

  /* ---------- Klik tombol skala perbandingan (delegasi) ---------- */
  function initPairwiseClicks() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".scale-btn");
      if (!btn) return;
      const card = btn.closest(".pair-card");
      if (!card) return;
      const idx = Number(btn.dataset.idx);
      const value = indexToValue(idx);

      if (card.dataset.kind === "kriteria") {
        const i = Number(card.dataset.i), j = Number(card.dataset.j);
        state.criteriaPairs[`${i}-${j}`] = value;
      } else if (card.dataset.kind === "alternatif") {
        const critId = card.dataset.crit;
        setAltVal(critId, card.dataset.idA, card.dataset.idB, value);
      } else {
        return;
      }
      saveState();
      renderAll();
    });
  }

  function initCritTabs() {
    els["crit-tabs"].addEventListener("click", (e) => {
      const tab = e.target.closest(".crit-tab");
      if (!tab) return;
      activeCritTab = tab.dataset.crit;
      renderAlternatifPage(computeFinalRanking());
    });
  }

  /* ---------- Modal: tambah / edit provider ---------- */
  function openModal(provider) {
    els["form-error"].hidden = true;
    if (provider) {
      els["modal-title"].textContent = "Edit Studio";
      els["f-id"].value = provider.id;
      els["f-nama"].value = provider.name;
    } else {
      els["modal-title"].textContent = "Tambah Studio";
      els["f-id"].value = "";
      els["f-nama"].value = "";
    }
    els["modal-backdrop"].hidden = false;
    els["f-nama"].focus();
  }

  function closeModal() { els["modal-backdrop"].hidden = true; }

  function showFormError(msg) {
    els["form-error"].textContent = msg;
    els["form-error"].hidden = false;
  }

  function handleSaveProvider() {
    const id = els["f-id"].value;
    const name = els["f-nama"].value.trim();
    if (!name) { showFormError("Nama studio tidak boleh kosong."); return; }
    const duplicate = state.providers.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.id !== id);
    if (duplicate) { showFormError("Nama studio tersebut sudah ada. Gunakan nama lain."); return; }

    if (id) {
      const p = state.providers.find((p) => p.id === id);
      p.name = name;
      showToast("Data studio diperbarui.");
    } else {
      state.providers.push({ id: uid("p"), name });
      showToast("Studio baru ditambahkan.");
    }
    saveState();
    renderAll();
    closeModal();
  }

  function handleDeleteProvider(id) {
    const p = state.providers.find((p) => p.id === id);
    if (!p) return;
    const ok = window.confirm(`Hapus "${p.name}" dari daftar studio?`);
    if (!ok) return;
    state.providers = state.providers.filter((p) => p.id !== id);
    removeProviderPairs(id);
    saveState();
    renderAll();
    showToast("Studio dihapus.");
  }

  function initProviderPage() {
    els["btn-add-provider"].addEventListener("click", () => openModal(null));
    els["modal-close"].addEventListener("click", closeModal);
    els["modal-cancel"].addEventListener("click", closeModal);
    els["modal-backdrop"].addEventListener("click", (e) => { if (e.target === els["modal-backdrop"]) closeModal(); });
    els["modal-save"].addEventListener("click", handleSaveProvider);
    els["form-provider"].addEventListener("submit", (e) => { e.preventDefault(); handleSaveProvider(); });

    els["tbody-provider"].addEventListener("click", (e) => {
      const editBtn = e.target.closest(".row-btn.edit");
      const delBtn = e.target.closest(".row-btn.delete");
      if (editBtn) {
        const p = state.providers.find((p) => p.id === editBtn.dataset.id);
        if (p) openModal(p);
      } else if (delBtn) {
        handleDeleteProvider(delBtn.dataset.id);
      }
    });
  }

  /* ---------- Detail perhitungan (Hasil) ---------- */
  function openDetail(providerId) {
    const p = state.providers.find((p) => p.id === providerId);
    if (!p) return;
    const result = computeFinalRanking();
    const item = result.scored.find((s) => s.provider.id === providerId);
    if (!item) return;

    els["detail-title"].textContent = `Detail Perhitungan \u2014 ${p.name}`;
    els["detail-body"].innerHTML = item.breakdown
      .map((b) => {
        const badge = b.crit.type === "benefit" ? `<span class="badge badge-benefit">Benefit</span>` : `<span class="badge badge-cost">Cost</span>`;
        return `
          <div class="detail-crit">
            <div class="detail-crit-head">
              <span class="detail-crit-name">${escapeHtml(b.crit.name)}</span>
              ${badge}
            </div>
            <div class="detail-grid">
              <div><span>Bobot Kriteria</span><span>${pct(b.weight, 1)}</span></div>
              <div><span>Prioritas Lokal</span><span>${pct(b.localP, 1)}</span></div>
              <div><span>Kontribusi</span><span>${fmt(b.contrib, 4)}</span></div>
            </div>
          </div>`;
      })
      .join("") +
      `<div class="detail-total">
        <span class="detail-total-label">Skor Akhir</span>
        <span class="detail-total-val">${fmt(item.score, 4)}</span>
      </div>`;

    els["detail-backdrop"].hidden = false;
  }

  function closeDetail() { els["detail-backdrop"].hidden = true; }

  function initDetailModal() {
    els["detail-close"].addEventListener("click", closeDetail);
    els["detail-ok"].addEventListener("click", closeDetail);
    els["detail-backdrop"].addEventListener("click", (e) => { if (e.target === els["detail-backdrop"]) closeDetail(); });
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function showToast(msg) {
    els["toast"].textContent = msg;
    els["toast"].hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els["toast"].hidden = true), 2400);
  }

  /* ---------- Init ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    loadState();
    initNav();
    initPairwiseClicks();
    initCritTabs();
    initProviderPage();
    initDetailModal();
    renderAll();
  });
})();
