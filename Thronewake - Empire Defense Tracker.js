// ==UserScript==
// @name         Thronewake - Empire Defense Tracker
// @namespace    violentmonkey-thronewake-troops
// @version      7.3
// @description  Tracks empire defense troops. Single-click to copy stats line, slow double-click (within 800ms) for full breakdown.
// @match        *://*.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  GM_addStyle(`
    #tw-empire-troop-card {
      background-color: #ece8d6;
      color: #101010;
      border: 2px solid #101010;
      border-radius: 4px;
      box-shadow: inset 0 0 8px rgba(16, 16, 16, 0.25), 0 4px 6px -1px rgba(0, 0, 0, 0.2);
      padding: 4px 8px;
      font-family: "Josefin Sans Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px;
      font-weight: 400;
      user-select: none;
      box-sizing: border-box;
      pointer-events: auto;
      cursor: pointer;
      transition: background-color 0.15s ease;
      width: 100%;
      max-width: 195px;
      touch-action: manipulation;
    }

    @media (max-width: 640px) {
      #tw-empire-troop-card {
        max-width: 92vw;
        margin: 2px auto;
        padding: 4px 6px;
        font-size: 13px;
      }
    }

    #tw-empire-troop-card:hover {
      background-color: #f3efe0;
    }

    #tw-empire-troop-card:active {
      background-color: #dfd8be;
    }

    .tw-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      font-weight: 400;
      border-bottom: 1px solid rgba(16, 16, 16, 0.2);
      padding-bottom: 2px;
      margin-bottom: 2px;
    }

    .tw-card-title-group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .tw-card-sync-group {
      display: none;
      align-items: center;
      gap: 3px;
    }

    #tw-empire-troop-card:hover:not(.is-copied) .tw-card-title-group {
      display: none;
    }

    #tw-empire-troop-card:hover:not(.is-copied) .tw-card-sync-group {
      display: flex;
    }

    .tw-card-title {
      color: #8a6e46;
      font-family: "Josefin Sans Variable", sans-serif;
      font-weight: 400;
      text-transform: uppercase;
      font-size: 13px;
      letter-spacing: 0.03em;
      transition: color 0.15s ease;
    }

    .tw-card-bottom-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      font-size: 14px;
      padding-top: 1px;
    }

    .tw-card-sub-item {
      display: flex;
      align-items: center;
      gap: 2px;
      white-space: nowrap;
    }

    .tw-card-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      color: #8a6e46;
    }

    .tw-card-val {
      font-weight: 400;
      font-size: 14px;
      color: #101010;
      font-variant-numeric: lining-nums;
    }

    .tw-copied-label {
      color: #165eb9 !important;
    }
  `);

  const ICONS = {
    defense: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    house: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    infantry: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    cavalry: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20l14-14"/><path d="M19 6h-4V2"/><path d="M14 6l3 3"/></svg>`,
    scout: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
  };

  const DEF_INF_UNITS = ["emberblade", "ember", "shieldbearer", "axeborn", "briar guard", "monolith warden", "carved warrior"];
  const DEF_CAV_UNITS = ["fang rider", "green lancer", "slate rider"];
  const SCOUT_UNITS   = ["sentinel", "pathstalker", "wind scout", "scout", "pathfinder", "spy", "watcher"];

  let resetCopyTimeout = null;

  function getTroopMatch(text) {
    const lower = text.toLowerCase().trim();
    for (const u of SCOUT_UNITS) { if (lower.includes(u)) return { category: "scout", unit: u }; }
    for (const u of DEF_INF_UNITS) { if (lower.includes(u)) return { category: "def_inf", unit: u }; }
    for (const u of DEF_CAV_UNITS) { if (lower.includes(u)) return { category: "def_cav", unit: u }; }
    return null;
  }

  function getVillageInfo() {
    let totalVillages = 0;
    const select = document.querySelector('select[aria-label="Switch village"]');
    if (select && select.options.length > 0) {
      totalVillages = select.options.length;
      const selectedOption = select.options[select.selectedIndex] || select.querySelector('option[selected]');
      if (selectedOption) {
        return { id: selectedOption.value || selectedOption.textContent.trim(), name: selectedOption.textContent.trim(), totalVillages };
      }
    }

    const comboSpan = document.querySelector('div[role="combobox"][aria-label="Switch village"] span');
    if (comboSpan && comboSpan.textContent.trim()) {
      const text = comboSpan.textContent.trim();
      return { id: text, name: text, totalVillages: 1 };
    }

    return { id: "global", name: "Global", totalVillages: 1 };
  }

  function isUpkeepVisible() {
    const srSpans = document.querySelectorAll('div.fixed.left-2.z-20 span.sr-only, div.fixed.left-4.z-20 span.sr-only, span.sr-only');
    for (const span of srSpans) {
      if (span.textContent.trim() === 'Food consumption') {
        const container = span.closest('div.fixed');
        if (container && container.offsetWidth > 0 && container.offsetHeight > 0) return true;
      }
    }
    return false;
  }

  function parseTroopsFromDOM() {
    const lis = document.querySelectorAll('main ~ div ul li, div.fixed.bottom-0 ul li');
    if (!lis || lis.length === 0) return null;

    const data = { total: 0, categories: { def_inf: 0, def_cav: 0, scout: 0 }, details: { def_inf: [], def_cav: [], scout: [] } };
    let foundAny = false;

    lis.forEach(li => {
      const fullText = li.getAttribute('aria-label') || li.textContent || "";
      const match = getTroopMatch(fullText);

      if (match) {
        const lowerText = fullText.toLowerCase();
        const idx = lowerText.indexOf(match.unit);
        const textAfter = fullText.slice(idx + match.unit.length);
        const countMatch = textAfter.match(/([\d,]+)/);

        if (countMatch) {
          const count = parseInt(countMatch[1].replace(/,/g, ''), 10);
          if (!isNaN(count)) {
            foundAny = true;
            data.categories[match.category] += count;
            data.details[match.category].push({ name: match.unit, count });
          }
        }
      }
    });

    data.total = data.categories.def_inf + data.categories.def_cav;
    return foundAny ? data : null;
  }

  function copySummaryToClipboard(fullData = false) {
    const registry = GM_getValue("tw_empire_registry", {});
    const info = getVillageInfo();
    const recordedIds = Object.keys(registry);

    let total = 0;
    let cats = { def_inf: 0, def_cav: 0, scout: 0 };
    let villageList = [];

    recordedIds.forEach(id => {
      const v = registry[id];
      if (v && v.data) {
        const defInf = (v.data.categories && v.data.categories.def_inf) || 0;
        const defCav = (v.data.categories && v.data.categories.def_cav) || 0;
        const scout = (v.data.categories && v.data.categories.scout) || 0;
        const vTotal = defInf + defCav;

        total += vTotal;
        cats.def_inf += defInf;
        cats.def_cav += defCav;
        cats.scout += scout;

        const cleanName = v.name.replace(/\s*\(-?\d+\|-?\d+\)/, '');

        let parts = [];
        if (defInf > 0) parts.push(`Inf: ${defInf.toLocaleString()}`);
        if (defCav > 0) parts.push(`Cav: ${defCav.toLocaleString()}`);
        if (scout > 0) parts.push(`Scout: ${scout.toLocaleString()}`);

        let detailsStr = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
        villageList.push({ name: cleanName, text: `• ${cleanName}: ${vTotal.toLocaleString()} def${detailsStr}` });
      }
    });

    villageList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    let catSummaryParts = [];
    if (cats.def_inf > 0) catSummaryParts.push(`🛡️ Def Inf: ${cats.def_inf.toLocaleString()}`);
    if (cats.def_cav > 0) catSummaryParts.push(`🐴 Def Cav: ${cats.def_cav.toLocaleString()}`);
    if (cats.scout > 0) catSummaryParts.push(`👁️ Scouts: ${cats.scout.toLocaleString()}`);

    let summaryText = "";
    let copiedMsg = fullData ? "FULL COPIED!" : "COPIED!";

    if (fullData) {
      summaryText = [
        `🛡️ Empire Defense Summary (${recordedIds.length}/${info.totalVillages || recordedIds.length} Villages)`,
        `Total Defense: ${total.toLocaleString()}`,
        catSummaryParts.length > 0 ? catSummaryParts.join(' | ') : 'No Defense Troops',
        `\nVillage Breakdown:`,
        ...villageList.map(v => v.text)
      ].join('\n');
    } else {
      summaryText = catSummaryParts.length > 0 ? catSummaryParts.join(' | ') : 'No Defense Troops';
    }

    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(summaryText);
    } else {
      navigator.clipboard.writeText(summaryText);
    }

    const cardEl = document.getElementById("tw-empire-troop-card");
    if (cardEl) cardEl.classList.add("is-copied");

    const labelEl = document.getElementById("tw-label-empire");
    if (labelEl) {
      if (resetCopyTimeout) clearTimeout(resetCopyTimeout);

      labelEl.textContent = copiedMsg;
      labelEl.classList.add("tw-copied-label");

      resetCopyTimeout = setTimeout(() => {
        labelEl.textContent = "DEFENSE";
        labelEl.classList.remove("tw-copied-label");
        if (cardEl) cardEl.classList.remove("is-copied");
        resetCopyTimeout = null;
      }, 1500);
    }
  }

  function createCard() {
    if (document.getElementById("tw-empire-troop-card")) return;

    const sideMenuContainer = document.querySelector('div.fixed.left-2.z-20, div.fixed.left-4.z-20');
    if (!sideMenuContainer) return;

    const card = document.createElement("div");
    card.id = "tw-empire-troop-card";
    card.title = "Single Click: Copy Stats | Double Click: Copy Full Breakdown";

    card.innerHTML = `
      <div class="tw-card-top">
        <div class="tw-card-title-group">
          <span class="tw-card-icon">${ICONS.defense}</span>
          <span class="tw-card-title" id="tw-label-empire">DEFENSE</span>
        </div>
        <div class="tw-card-sync-group" title="Villages synced in the last hour">
          <span class="tw-card-icon">${ICONS.house}</span>
          <span id="tw-val-sync" class="tw-card-title">0/0</span>
        </div>
        <span id="tw-val-empire" class="tw-card-val">—</span>
      </div>
      <div class="tw-card-bottom-row">
        <div class="tw-card-sub-item" title="Defensive Infantry">
          <span class="tw-card-icon">${ICONS.infantry}</span>
          <span id="tw-val-def_inf" class="tw-card-val">0</span>
        </div>
        <div class="tw-card-sub-item" title="Defensive Cavalry">
          <span class="tw-card-icon">${ICONS.cavalry}</span>
          <span id="tw-val-def_cav" class="tw-card-val">0</span>
        </div>
        <div class="tw-card-sub-item" title="Scouts">
          <span class="tw-card-icon">${ICONS.scout}</span>
          <span id="tw-val-scout" class="tw-card-val">0</span>
        </div>
      </div>
    `;

    let clickTimer = null;
    card.addEventListener("click", () => {
      if (clickTimer === null) {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          copySummaryToClipboard(false);
        }, 800);
      } else {
        clearTimeout(clickTimer);
        clickTimer = null;
        copySummaryToClipboard(true);
      }
    });

    sideMenuContainer.insertBefore(card, sideMenuContainer.firstChild);
  }

  function calculateAndRenderEmpireTotals() {
    const registry = GM_getValue("tw_empire_registry", {});
    const totals = { grandTotal: 0, categories: { def_inf: 0, def_cav: 0, scout: 0 }, villageList: [] };

    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();
    let syncedLastHour = 0;
    const activeInfo = getVillageInfo();

    Object.keys(registry).forEach(id => {
      const vData = registry[id];
      if (vData && vData.data) {
        if (vData.updatedAt && (now - vData.updatedAt < ONE_HOUR)) {
          syncedLastHour++;
        }

        const defInf = (vData.data.categories && vData.data.categories.def_inf) || 0;
        const defCav = (vData.data.categories && vData.data.categories.def_cav) || 0;
        const scout = (vData.data.categories && vData.data.categories.scout) || 0;
        const vTotal = defInf + defCav;

        totals.grandTotal += vTotal;
        totals.categories.def_inf += defInf;
        totals.categories.def_cav += defCav;
        totals.categories.scout += scout;

        const cleanName = vData.name.replace(/\s*\(-?\d+\|-?\d+\)/, '');
        let parts = [];
        if (defInf > 0) parts.push(`Inf: ${defInf.toLocaleString()}`);
        if (defCav > 0) parts.push(`Cav: ${defCav.toLocaleString()}`);
        if (scout > 0) parts.push(`Scout: ${scout.toLocaleString()}`);

        let detailsStr = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
        totals.villageList.push({ name: cleanName, text: `${cleanName}: ${vTotal.toLocaleString()} def${detailsStr}` });
      }
    });

    const totalVillages = Math.max(activeInfo.totalVillages || 1, Object.keys(registry).length);
    const syncEl = document.getElementById("tw-val-sync");
    if (syncEl) syncEl.textContent = `${syncedLastHour}/${totalVillages}`;

    totals.villageList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const empireEl = document.getElementById("tw-val-empire");
    if (empireEl) empireEl.textContent = totals.grandTotal.toLocaleString();

    ["def_inf", "def_cav", "scout"].forEach(cat => {
      const valEl = document.getElementById(`tw-val-${cat}`);
      if (valEl) valEl.textContent = totals.categories[cat].toLocaleString();
    });

    const card = document.getElementById("tw-empire-troop-card");
    if (card) {
      card.title = `Single Click: Copy Stats | Double Click: Copy Full Breakdown\n\n` +
        (totals.villageList.length > 0 ? totals.villageList.map(v => v.text).join("\n") : "Open villages to record troops.");
    }
  }

  setInterval(() => {
    if (isUpkeepVisible()) {
      createCard();
      const activeCard = document.getElementById("tw-empire-troop-card");
      if (activeCard) activeCard.style.display = "block";

      const activeVillage = getVillageInfo();
      const liveData = parseTroopsFromDOM();

      if (liveData !== null) {
        const registry = GM_getValue("tw_empire_registry", {});
        registry[activeVillage.id] = { name: activeVillage.name, updatedAt: Date.now(), data: liveData };
        GM_setValue("tw_empire_registry", registry);
      }
      calculateAndRenderEmpireTotals();
    } else {
      const card = document.getElementById("tw-empire-troop-card");
      if (card) card.style.display = "none";
    }
  }, 500);
})();
