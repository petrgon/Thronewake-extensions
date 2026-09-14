// ==UserScript==
// @name         Thronewake - Empire Defense Tracker
// @namespace    violentmonkey-thronewake-troops
// @version      9.4
// @description  Tracks empire defense troops. Single-click to copy stats line, slow double-click (within 800ms) for full breakdown. Auto re-anchors layout on SPA navigation.
// @author       petrgon
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
      padding: 2px 6px;
      margin: 0 0 6px 0;
      font-family: inherit;
      font-size: 15px;
      line-height: 1.25;
      font-weight: inherit;
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
        font-size: 13px;
      }
    }

    #tw-empire-troop-card:hover { background-color: #f3efe0; }
    #tw-empire-troop-card:active { background-color: #dfd8be; }

    .tw-card-top {
      display: flex; align-items: center; justify-content: space-between;
      gap: 4px; border-bottom: 1px solid rgba(16, 16, 16, 0.2);
      padding-bottom: 1px; margin-bottom: 1px; white-space: nowrap;
    }

    .tw-card-title-group { display: flex; align-items: center; gap: 3px; white-space: nowrap; min-width: 0; }
    .tw-card-sync-group { display: none; align-items: center; gap: 3px; white-space: nowrap; }

    #tw-empire-troop-card:hover:not(.is-copied) .tw-card-title-group { display: none; }
    #tw-empire-troop-card:hover:not(.is-copied) .tw-card-sync-group { display: flex; }
    #tw-empire-troop-card.is-copied #tw-val-empire { display: none; }

    .tw-card-title {
      color: #8a6e46; text-transform: uppercase; font-size: 0.85em;
      letter-spacing: 0.03em; white-space: nowrap; transition: color 0.15s ease;
    }

    .tw-card-bottom-row { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding-top: 0px; white-space: nowrap; }
    .tw-card-sub-item { display: flex; align-items: center; gap: 2px; white-space: nowrap; }
    .tw-card-icon { display: inline-flex; align-items: center; justify-content: center; width: 1em; height: 1em; color: #8a6e46; flex-shrink: 0; }
    .tw-card-val { color: #101010; font-size: 1em; font-variant-numeric: lining-nums; white-space: nowrap; }
    .tw-copied-label { color: #165eb9 !important; }
  `);

  const ICONS = {
    defense: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    house: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    infantry: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    cavalry: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20l14-14"/><path d="M19 6h-4V2"/><path d="M14 6l3 3"/></svg>`,
    scout: `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
  };

  const DEF_INF_UNITS = ["emberblade", "ember", "shieldbearer", "axeborn", "briar guard", "monolith warden", "carved warrior"];
  const DEF_CAV_UNITS = ["fang rider", "green lancer", "slate rider"];
  const SCOUT_UNITS   = ["sentinel", "pathstalker", "wind scout", "scout", "pathfinder", "spy", "watcher"];

  let resetCopyTimeout = null;
  let lastParsedSig = "";
  let cachedRegistry = null;
  let wasOnMapRoute = isMapRoute();

  function isMapRoute() {
    return window.location.pathname.startsWith('/map');
  }

  function formatNum(num) {
    return num.toLocaleString('en-US');
  }

  function getTroopMatch(text) {
    const lower = text.toLowerCase().trim();
    for (const u of SCOUT_UNITS) { if (lower.includes(u)) return { category: "scout", unit: u }; }
    for (const u of DEF_INF_UNITS) { if (lower.includes(u)) return { category: "def_inf", unit: u }; }
    for (const u of DEF_CAV_UNITS) { if (lower.includes(u)) return { category: "def_cav", unit: u }; }
    return null;
  }

  function getVillageInfo() {
    const select = document.querySelector('select[aria-label="Switch village"]');
    if (select && select.options.length > 0) {
      const totalVillages = select.options.length;
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

  function getSideMenuContainer() {
    const srSpans = document.querySelectorAll('span.sr-only');
    for (const span of srSpans) {
      if (span.textContent.trim() === 'Food consumption') {
        const fixedParent = span.closest('div.fixed');
        if (fixedParent && !fixedParent.className.includes('bottom-')) {
          return fixedParent;
        }
      }
    }

    const candidates = document.querySelectorAll('div.fixed');
    for (const el of candidates) {
      const cls = el.className;
      if ((cls.includes('left-2') || cls.includes('left-4') || cls.includes('left-3') || cls.includes('left-6')) && !cls.includes('bottom-')) {
        return el;
      }
    }

    for (const el of candidates) {
      if (el.className.includes('bottom-')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.left >= 0 && rect.left < 120 && rect.top < window.innerHeight * 0.4 && rect.height > 20) {
        return el;
      }
    }

    return null;
  }

  function isUpkeepVisible() {
    if (isMapRoute()) return false;
    const container = getSideMenuContainer();
    return !!(container && container.offsetWidth > 0 && container.offsetHeight > 0);
  }

  function parseTroopsFromDOM() {
    const troopLinks = document.querySelectorAll('a[href*="send-troops"]');
    if (!troopLinks || troopLinks.length === 0) return null;

    const data = { total: 0, categories: { def_inf: 0, def_cav: 0, scout: 0 }, details: { def_inf: [], def_cav: [], scout: [] } };
    let foundAny = false;

    troopLinks.forEach(a => {
      const li = a.closest('li') || a.parentElement;
      if (!li) return;

      const srSpan = li.querySelector('span.sr-only');
      const unitNameText = srSpan ? srSpan.textContent : li.textContent;
      const match = getTroopMatch(unitNameText) || getTroopMatch(li.textContent);

      if (match) {
        const countEl = li.querySelector('div.font-medium');
        let count = 0;

        if (countEl) {
          count = parseInt(countEl.textContent.replace(/,/g, ''), 10);
        } else {
          const countMatch = li.textContent.match(/([\d,]+)/);
          if (countMatch) count = parseInt(countMatch[1].replace(/,/g, ''), 10);
        }

        if (!isNaN(count) && count > 0) {
          foundAny = true;
          data.categories[match.category] += count;
          data.details[match.category].push({ name: match.unit, count });
        }
      }
    });

    data.total = data.categories.def_inf + data.categories.def_cav;
    return foundAny ? data : null;
  }

  function getRegistry() {
    if (!cachedRegistry) {
      cachedRegistry = GM_getValue("tw_empire_registry", {});
    }
    return cachedRegistry;
  }

  function setRegistry(registry) {
    cachedRegistry = registry;
    GM_setValue("tw_empire_registry", registry);
  }

  function copySummaryToClipboard(fullData = false) {
    const registry = getRegistry();
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
        if (defInf > 0) parts.push(`Inf: ${formatNum(defInf)}`);
        if (defCav > 0) parts.push(`Cav: ${formatNum(defCav)}`);
        if (scout > 0) parts.push(`Scout: ${formatNum(scout)}`);

        let detailsStr = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
        villageList.push({ name: cleanName, text: `• ${cleanName}: ${formatNum(vTotal)} def${detailsStr}` });
      }
    });

    villageList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    let catSummaryParts = [];
    if (cats.def_inf > 0) catSummaryParts.push(`🛡️ Def Inf: ${formatNum(cats.def_inf)}`);
    if (cats.def_cav > 0) catSummaryParts.push(`🐴 Def Cav: ${formatNum(cats.def_cav)}`);
    if (cats.scout > 0) catSummaryParts.push(`👁️ Scouts: ${formatNum(cats.scout)}`);

    let summaryText = "";
    let copiedMsg = fullData ? "FULL COPIED!" : "COPIED!";

    if (fullData) {
      summaryText = [
        `🛡️ Empire Defense Summary (${recordedIds.length}/${info.totalVillages || recordedIds.length} Villages)`,
        `Total Defense: ${formatNum(total)}`,
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
    const sideMenuContainer = getSideMenuContainer();
    if (!sideMenuContainer) return;

    let card = document.getElementById("tw-empire-troop-card");

    // Check if the card is attached to an old/stale DOM container
    if (card && card.parentElement !== sideMenuContainer) {
      card.remove();
      card = null;
    }

    if (card) return;

    card = document.createElement("div");
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
        copySummaryToClipboard(false);
        clickTimer = setTimeout(() => {
          clickTimer = null;
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
    const registry = getRegistry();
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
        if (defInf > 0) parts.push(`Inf: ${formatNum(defInf)}`);
        if (defCav > 0) parts.push(`Cav: ${formatNum(defCav)}`);
        if (scout > 0) parts.push(`Scout: ${formatNum(scout)}`);

        let detailsStr = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
        totals.villageList.push({ name: cleanName, text: `${cleanName}: ${formatNum(vTotal)} def${detailsStr}` });
      }
    });

    const totalVillages = Math.max(activeInfo.totalVillages || 1, Object.keys(registry).length);
    const syncEl = document.getElementById("tw-val-sync");
    if (syncEl) syncEl.textContent = `${syncedLastHour}/${totalVillages}`;

    totals.villageList.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const empireEl = document.getElementById("tw-val-empire");
    if (empireEl) empireEl.textContent = formatNum(totals.grandTotal);

    ["def_inf", "def_cav", "scout"].forEach(cat => {
      const valEl = document.getElementById(`tw-val-${cat}`);
      if (valEl) valEl.textContent = formatNum(totals.categories[cat]);
    });

    const card = document.getElementById("tw-empire-troop-card");
    if (card) {
      card.title = `Single Click: Copy Stats | Double Click: Copy Full Breakdown\n\n` +
        (totals.villageList.length > 0 ? totals.villageList.map(v => v.text).join("\n") : "Open villages to record troops.");
    }
  }

  function processTroopCheck() {
    const currentlyOnMap = isMapRoute();

    if (wasOnMapRoute && !currentlyOnMap) {
      lastParsedSig = "";
    }
    wasOnMapRoute = currentlyOnMap;

    if (isUpkeepVisible()) {
      createCard();
      const activeCard = document.getElementById("tw-empire-troop-card");
      if (activeCard && activeCard.style.display !== "block") {
        activeCard.style.display = "block";
      }

      const activeVillage = getVillageInfo();
      const liveData = parseTroopsFromDOM();

      const currentSig = `${activeVillage.id}_${JSON.stringify(liveData)}`;

      if (currentSig !== lastParsedSig) {
        lastParsedSig = currentSig;

        if (liveData !== null) {
          const registry = getRegistry();
          registry[activeVillage.id] = { name: activeVillage.name, updatedAt: Date.now(), data: liveData };
          setRegistry(registry);
        }
        calculateAndRenderEmpireTotals();
      }
    } else {
      const card = document.getElementById("tw-empire-troop-card");
      if (card && card.style.display !== "none") {
        card.style.display = "none";
      }
    }
  }

  const triggerCheck = () => {
    setTimeout(processTroopCheck, 100);
    setTimeout(processTroopCheck, 300);
  };

  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    triggerCheck();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    triggerCheck();
  };

  window.addEventListener('popstate', triggerCheck);

  setInterval(processTroopCheck, 1000);
})();
