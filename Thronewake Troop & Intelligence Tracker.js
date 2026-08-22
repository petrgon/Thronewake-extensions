// ==UserScript==
// @name         Thronewake Troop & Intelligence Tracker
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  High-performance troop tracking with native back-button config style, collapsible player & village intel sections precisely targeted before the Villages container, 24h UTC/Local time settings, compact JSON Gist sync, and strict Escape key isolation.
// @author       petrgon
// @match        https://www.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    'use strict';

    const UNITS = {
        // Embermark
        'emberblade':       { name: 'Emberblade',        atk: 40,  defInf: 35,  defCav: 50  },
        'shieldbearer':     { name: 'Shieldbearer',      atk: 30,  defInf: 65,  defCav: 35  },
        'iron spear':       { name: 'Iron Spear',        atk: 70,  defInf: 40,  defCav: 25  },
        'sentinel':         { name: 'Sentinel',          atk: 0,   defInf: 20,  defCav: 10  },
        'sun rider':        { name: 'Sun Rider',         atk: 120, defInf: 65,  defCav: 50  },
        'crimson lancer':   { name: 'Crimson Lancer',    atk: 180, defInf: 80,  defCav: 105 },
        'iron ram':         { name: 'Iron Ram',          atk: 60,  defInf: 30,  defCav: 75  },
        'dominion catapult':{ name: 'Dominion Catapult', atk: 75,  defInf: 60,  defCav: 10  },
        'high prefect':     { name: 'High Prefect',      atk: 50,  defInf: 40,  defCav: 30  },

        // Stormfang
        'raider':           { name: 'Raider',            atk: 40,  defInf: 20,  defCav: 5   },
        'axeborn':          { name: 'Axeborn',           atk: 10,  defInf: 35,  defCav: 60  },
        'war brute':        { name: 'War Brute',         atk: 60,  defInf: 30,  defCav: 30  },
        'pathstalker':      { name: 'Pathstalker',       atk: 0,   defInf: 10,  defCav: 5   },
        'fang rider':       { name: 'Fang Rider',        atk: 55,  defInf: 100, defCav: 40  },
        'blood charger':    { name: 'Blood Charger',     atk: 150, defInf: 50,  defCav: 75  },
        'war ram':          { name: 'War Ram',           atk: 65,  defInf: 30,  defCav: 80  },
        'skullthrower':     { name: 'Skullthrower',      atk: 50,  defInf: 60,  defCav: 10  },
        'clan warlord':     { name: 'Clan Warlord',      atk: 40,  defInf: 60,  defCav: 40  },

        // Verdant
        'briar guard':      { name: 'Briar Guard',       atk: 15,  defInf: 40,  defCav: 50  },
        'woodblade':        { name: 'Woodblade',         atk: 65,  defInf: 35,  defCav: 20  },
        'wind scout':       { name: 'Wind Scout',        atk: 0,   defInf: 20,  defCav: 10  },
        'stag rider':       { name: 'Stag Rider',        atk: 100, defInf: 25,  defCav: 40  },
        'green lancer':     { name: 'Green Lancer',      atk: 45,  defInf: 115, defCav: 55  },
        'oak cavalier':     { name: 'Oak Cavalier',      atk: 140, defInf: 60,  defCav: 165 },
        'timber ram':       { name: 'Timber Ram',        atk: 50,  defInf: 30,  defCav: 105 },
        'stonecaster':      { name: 'Stonecaster',       atk: 70,  defInf: 45,  defCav: 10  },
        'circle elder':     { name: 'Circle Elder',      atk: 40,  defInf: 50,  defCav: 50  },

        // Common
        'settler':          { name: 'Settler',           atk: 10,  defInf: 80,  defCav: 80  }
    };

    const KEY_GIST_TOKEN = 'tw_gist_token';
    const KEY_GIST_ID    = 'tw_gist_id';
    const KEY_INTEL_DATA = 'tw_troop_intel_db';
    const KEY_TIMEZONE   = 'tw_timezone_pref';

    let dbCache = null;
    let summaryCache = new Map();
    let gistStatus = 'not_configured';
    let isProcessing = false;
    let observer = null;
    let escapeHandledFlag = false;

    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('\u2699 Troop Tracker Settings', openGistModal);
    }

    document.addEventListener('click', (e) => {
        const cfgBtn = e.target.closest('#tw-troop-gist-config-btn');
        if (cfgBtn) {
            e.preventDefault();
            e.stopPropagation();
            openGistModal();
        }
    }, true);

    function handleEscapeKey(e) {
        if (e.key !== 'Escape') return;

        const gistModal = document.getElementById('tw-troop-gist-modal');
        const intelModal = document.getElementById('tw-troop-intel-modal');

        const isGistOpen = gistModal && gistModal.style.display !== 'none';
        const isIntelOpen = intelModal && intelModal.style.display !== 'none';

        if (isGistOpen || isIntelOpen) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            if (e.type === 'keydown') {
                if (isGistOpen) gistModal.style.display = 'none';
                if (isIntelOpen) intelModal.style.display = 'none';
                escapeHandledFlag = true;
            }
        } else if (escapeHandledFlag) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (e.type === 'keyup') {
                escapeHandledFlag = false;
            }
        }
    }

    document.addEventListener('keydown', handleEscapeKey, true);
    document.addEventListener('keyup', handleEscapeKey, true);

    function getPageType() {
        const path = window.location.pathname.toLowerCase();

        if (path.includes('/messages') || path.includes('/leaderboards')) {
            return 'excluded';
        }
        if (path.includes('/reports/combat')) {
            return 'report';
        }
        if (path.includes('/player/') || path.includes('/map/player/')) {
            return 'player';
        }
        if (path.includes('/alliance/')) {
            return 'alliance';
        }
        if (path.includes('/map/tile/')) {
            return 'village';
        }

        const mainTitle = document.querySelector('h1.font-title')?.textContent || '';
        if (mainTitle.includes('Combat Report')) {
            return 'report';
        }

        if (document.getElementById('village-scroll-container')) {
            const h2 = document.querySelector('#village-scroll-container h2');
            if (h2 && h2.textContent.trim().toLowerCase() === 'villages') {
                return 'player';
            }
            return 'village';
        }

        return 'unknown';
    }

    function parseReportTimestamp(dateStr) {
        if (!dateStr) return Math.floor(Date.now() / 1000);
        const match = dateStr.match(/(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})[,\s]+(\d{1,2}):(\d{2}):(\d{2})/);
        if (match) {
            const day = parseInt(match[1], 10);
            const month = parseInt(match[2], 10) - 1;
            const year = parseInt(match[3], 10);
            const hours = parseInt(match[4], 10);
            const mins = parseInt(match[5], 10);
            const secs = parseInt(match[6], 10);
            return Math.floor(Date.UTC(year, month, day, hours, mins, secs) / 1000);
        }
        const parsed = Date.parse(dateStr);
        return isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
    }

    function formatTimestamp(sec) {
        if (!sec) return 'N/A';
        const date = new Date(sec * 1000);
        const tzPref = GM_getValue(KEY_TIMEZONE, 'local');
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        };

        if (tzPref === 'utc') {
            options.timeZone = 'UTC';
        }

        const formatted = new Intl.DateTimeFormat('en-GB', options).format(date);
        return tzPref === 'utc' ? `${formatted} UTC` : formatted;
    }

    function getIntelDB() {
        if (!dbCache) {
            try {
                dbCache = JSON.parse(GM_getValue(KEY_INTEL_DATA, '{"r":{},"p":{}}')) || { r: {}, p: {} };
            } catch (e) {
                dbCache = { r: {}, p: {} };
            }
            if (!dbCache.r) dbCache.r = {};
            if (!dbCache.p) dbCache.p = {};
            rebuildSummaryCache();
        }
        return dbCache;
    }

    function saveIntelDB(db) {
        dbCache = db;
        rebuildSummaryCache();
        GM_setValue(KEY_INTEL_DATA, JSON.stringify(db));
        syncToGist(db);
    }

    function calcArmyPower(units) {
        let hammer = 0;
        let defPower = 0;
        for (const [unitName, count] of Object.entries(units || {})) {
            const stats = UNITS[unitName.toLowerCase()];
            if (stats && count > 0) {
                hammer += count * stats.atk;
                defPower += count * ((stats.defInf + stats.defCav) / 2);
            }
        }
        return { hammer, def: Math.round(defPower) };
    }

    function rebuildSummaryCache() {
        summaryCache.clear();
        const db = dbCache || { p: {} };
        for (const [playerName, pData] of Object.entries(db.p || {})) {
            if (!pData || !pData.v) continue;
            let maxHammer = 0;
            let totalDef = 0;

            for (const vil of Object.values(pData.v)) {
                const { hammer, def } = calcArmyPower(vil.u || {});
                if (hammer > maxHammer) maxHammer = hammer;
                totalDef += def;
            }
            summaryCache.set(playerName, { maxHammer, totalDef });
        }
    }

    function getPlayerSummary(playerName) {
        return summaryCache.get(playerName) || { maxHammer: 0, totalDef: 0 };
    }

    function findVillageByCoords(coords) {
        const db = getIntelDB();
        for (const [pName, pData] of Object.entries(db.p || {})) {
            if (!pData || !pData.v) continue;
            if (pData.v[coords]) {
                return { playerName: pName, village: pData.v[coords] };
            }
        }
        return null;
    }

    function createBadgeMarkup(hmr, def, labelHmr = 'HMR', labelDef = 'DEF') {
        return `<span style="background: #f8f4e6; border: 1px solid #6a5a48; color: #991b1b; padding: 1px 5px; border-radius: 2px; font-weight: 500; font-size: 12px; display: inline-flex; align-items: center; gap: 3px;">${labelHmr}: ${hmr.toLocaleString()}</span> <span style="background: #f8f4e6; border: 1px solid #6a5a48; color: #165eb9; padding: 1px 5px; border-radius: 2px; font-weight: 500; font-size: 12px; display: inline-flex; align-items: center; gap: 3px;">${labelDef}: ${def.toLocaleString()}</span>`;
    }

    function syncToGist(data) {
        const token = GM_getValue(KEY_GIST_TOKEN, '');
        const gistId = GM_getValue(KEY_GIST_ID, '');
        if (!token || !gistId) return;

        GM_xmlhttpRequest({
            method: 'PATCH',
            url: `https://api.github.com/gists/${gistId}`,
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                files: { 'thronewake_intel.json': { content: JSON.stringify(data) } }
            }),
            onload: (res) => { gistStatus = res.status === 200 ? 'connected' : 'error'; },
            onerror: () => { gistStatus = 'error'; }
        });
    }

    function fetchFromGist(callback) {
        const token = GM_getValue(KEY_GIST_TOKEN, '');
        const gistId = GM_getValue(KEY_GIST_ID, '');
        if (!token || !gistId) {
            gistStatus = 'not_configured';
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${gistId}`,
            headers: { 'Authorization': `token ${token}` },
            onload: (res) => {
                try {
                    if (res.status === 200) {
                        const gist = JSON.parse(res.responseText);
                        const file = gist.files['thronewake_intel.json'];
                        if (file && file.content) {
                            dbCache = JSON.parse(file.content);
                            if (!dbCache.r) dbCache.r = {};
                            if (!dbCache.p) dbCache.p = {};
                            rebuildSummaryCache();
                            GM_setValue(KEY_INTEL_DATA, JSON.stringify(dbCache));
                            gistStatus = 'connected';
                            if (callback) callback();
                        }
                    } else {
                        gistStatus = 'error';
                    }
                } catch (e) {
                    gistStatus = 'error';
                }
            },
            onerror: () => { gistStatus = 'error'; }
        });
    }

    function createCollapsibleBlock(id, titleText, innerContentHtml, defaultOpen = true) {
        const arrowChar = defaultOpen ? '\u25b2' : '\u25bc';
        const displayState = defaultOpen ? 'block' : 'none';
        return `
            <div class="border-paper-creme border-t-2 my-3"></div>
            <div class="tw-troop-collapsible-block">
                <button type="button" onclick="const c=document.getElementById('${id}'); const a=this.querySelector('.tw-troop-arrow'); const isH=c.style.display==='none'; c.style.display=isH?'block':'none'; a.textContent=isH?'\u25b2':'\u25bc';" class="w-full flex items-center justify-between text-left py-1 cursor-pointer select-none">
                    <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6a5a48;">${titleText}</span>
                    <span class="tw-troop-arrow" style="font-size: 11px; font-weight: 600; color: #6a5a48;">${arrowChar}</span>
                </button>
                <div id="${id}" style="display: ${displayState}; margin-top: 6px;">
                    ${innerContentHtml}
                </div>
            </div>
        `;
    }

    function openGistModal() {
        let modal = document.getElementById('tw-troop-gist-modal');
        if (modal) {
            modal.style.display = 'flex';
            return;
        }

        modal = document.createElement('div');
        modal.id = 'tw-troop-gist-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.6); display: flex;
            align-items: center; justify-content: center;
            font-family: var(--font-sans, sans-serif);
        `;

        const currentGistId = GM_getValue(KEY_GIST_ID, '');
        const currentToken = GM_getValue(KEY_GIST_TOKEN, '');
        const currentTz = GM_getValue(KEY_TIMEZONE, 'local');

        let statusText = '\u25cf Not Configured';
        let statusStyle = 'color: #6a5a48; background: #ece8d6; border: 1px solid #6a5a48;';

        if (gistStatus === 'connected') {
            statusText = '\u25cf Connected';
            statusStyle = 'color: #15803d; background: #dcfce7; border: 1px solid #15803d;';
        } else if (gistStatus === 'error') {
            statusText = '\u25cf Disconnected';
            statusStyle = 'color: #991b1b; background: #fee2e2; border: 1px solid #991b1b;';
        }

        modal.innerHTML = `
            <div style="background: #ece8d6; border: 2px solid #101010; padding: 20px; width: 360px; max-width: 92vw; border-radius: 4px; color: #101010; box-shadow: 0 4px 16px rgba(0,0,0,0.6);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #dcd3c6; padding-bottom: 6px;">
                    <h3 style="font-weight: 700; text-transform: uppercase; font-size: 14px; color: #6a5a48; margin: 0;">\u2699 Troop Tracker Settings</h3>
                    <span id="tw-troop-gist-conn-badge" style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; ${statusStyle}">${statusText}</span>
                </div>
                <div style="margin-bottom: 8px; font-size: 11px; color: #6a5a48; font-weight: 500;">
                    Settings for Troop Tracker component.
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                        <label style="font-size: 11px; font-weight: 600; color: #6a5a48; text-transform: uppercase;">Gist ID</label>
                        <a id="tw-open-gist-link" href="https://gist.github.com/${currentGistId}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; font-weight: 600; color: #165eb9; text-decoration: underline; ${currentGistId ? '' : 'display: none;'}">Open Gist ↗</a>
                    </div>
                    <input type="text" id="tw-troop-input-gist-id" value="${currentGistId}" placeholder="e.g. 872976f2aa4ecec..." style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px; color: #101010;" />
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase; margin-bottom: 3px;">GitHub Token</label>
                    <input type="password" id="tw-troop-input-gist-token" value="${currentToken}" placeholder="ghp_YOUR_TOKEN" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px; color: #101010;" />
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase; margin-bottom: 3px;">Time Format</label>
                    <select id="tw-troop-input-tz" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px; color: #101010;">
                        <option value="local" ${currentTz === 'local' ? 'selected' : ''}>Local Time (24h)</option>
                        <option value="utc" ${currentTz === 'utc' ? 'selected' : ''}>UTC (24h)</option>
                    </select>
                </div>
                <div id="tw-troop-gist-status-msg" style="font-size: 11px; margin-bottom: 12px; color: #6a5a48; font-weight: 600; min-height: 16px;"></div>
                <div style="display: flex; gap: 8px; justify-content: space-between;">
                    <button type="button" id="tw-troop-btn-reset-intel" style="background: #991b1b; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px; text-transform: uppercase;">Clear DB</button>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" id="tw-troop-btn-close-modal" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px; text-transform: uppercase;">Close</button>
                        <button type="button" id="tw-troop-btn-save-modal" style="background: #165eb9; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px; text-transform: uppercase;">Save & Sync</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        document.getElementById('tw-troop-btn-close-modal').onclick = () => { modal.style.display = 'none'; };

        document.getElementById('tw-troop-btn-reset-intel').onclick = () => {
            if (confirm('Clear all stored player and village troop intel?')) {
                dbCache = { r: {}, p: {} };
                saveIntelDB(dbCache);
                alert('Local troop intel cleared.');
                modal.style.display = 'none';
                main();
            }
        };

        document.getElementById('tw-troop-btn-save-modal').onclick = () => {
            const gistId = document.getElementById('tw-troop-input-gist-id').value.trim();
            const token = document.getElementById('tw-troop-input-gist-token').value.trim();
            const tzPref = document.getElementById('tw-troop-input-tz').value;
            const statusMsg = document.getElementById('tw-troop-gist-status-msg');

            GM_setValue(KEY_GIST_ID, gistId);
            GM_setValue(KEY_GIST_TOKEN, token);
            GM_setValue(KEY_TIMEZONE, tzPref);

            statusMsg.textContent = 'Syncing remote database...';
            fetchFromGist(() => {
                statusMsg.textContent = 'Sync complete!';
                setTimeout(() => {
                    modal.style.display = 'none';
                    main();
                }, 800);
            });
        };
    }

    function openTroopBreakdownModal(playerName) {
        let modal = document.getElementById('tw-troop-intel-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'tw-troop-intel-modal';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 999999;
                background: rgba(0,0,0,0.65); display: flex;
                align-items: center; justify-content: center;
                font-family: var(--font-sans, sans-serif);
            `;
            modal.innerHTML = `
                <div style="background: #ece8d6; border: 2px solid #101010; padding: 20px; width: 620px; max-width: 94vw; border-radius: 4px; color: #101010; box-shadow: 0 4px 16px rgba(0,0,0,0.6); max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #dcd3c6; padding-bottom: 6px;">
                        <h3 id="tw-troop-intel-title" style="font-weight: 600; text-transform: uppercase; font-size: 15px; color: #6a5a48; margin: 0;">Troop & Army Statistics</h3>
                        <button type="button" id="tw-troop-btn-close-intel" style="background: #165eb9; color: #fff; border: 1px solid #101010; width: 26px; height: 26px; border-radius: 50%; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;">\u2573</button>
                    </div>
                    <div id="tw-troop-intel-content"></div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('tw-troop-btn-close-intel').onclick = () => { modal.style.display = 'none'; };
            modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        }

        const db = getIntelDB();
        const pData = (db.p && db.p[playerName]) || { v: {} };
        const { maxHammer, totalDef } = getPlayerSummary(playerName);

        document.getElementById('tw-troop-intel-title').textContent = `${playerName} - Troop Statistics`;

        const unitAggregates = {};
        let grandTotalTroops = 0;
        const villages = Object.entries(pData.v || {});

        villages.forEach(([_, vil]) => {
            for (const [rawUnitKey, count] of Object.entries(vil.u || {})) {
                const uKey = rawUnitKey.toLowerCase();
                if (!unitAggregates[uKey]) {
                    unitAggregates[uKey] = { key: uKey, count: 0 };
                }
                unitAggregates[uKey].count += count;
                grandTotalTroops += count;
            }
        });

        let troopTableRows = '';
        const sortedUnits = Object.values(unitAggregates).sort((a, b) => b.count - a.count);

        if (sortedUnits.length === 0) {
            troopTableRows = `<tr><td colspan="4" style="padding: 8px; text-align: center; color: #6a5a48;">No unit records available for this player.</td></tr>`;
        } else {
            sortedUnits.forEach(u => {
                const stats = UNITS[u.key] || { name: u.key, atk: 0, defInf: 0, defCav: 0 };
                const totalAtk = u.count * stats.atk;
                const totalDef = u.count * ((stats.defInf + stats.defCav) / 2);

                troopTableRows += `
                    <tr style="border-bottom: 1px solid #dcd3c6;">
                        <td style="padding: 6px 8px; font-weight: 500; color: #101010;">${stats.name}</td>
                        <td style="padding: 6px 8px; text-align: right; font-weight: 500; color: #101010;">${u.count.toLocaleString()}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #991b1b; font-weight: 500;">${totalAtk.toLocaleString()}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #165eb9; font-weight: 500;">${Math.round(totalDef).toLocaleString()}</td>
                    </tr>
                `;
            });
        }

        let vilHtml = '';
        if (villages.length === 0) {
            vilHtml = '<div style="font-size: 13px; color: #6a5a48; padding: 6px 0;">No combat reports scanned yet.</div>';
        } else {
            villages.forEach(([coords, vil]) => {
                const { hammer, def } = calcArmyPower(vil.u || {});
                let unitBadgeHtml = '';
                for (const [uName, uCount] of Object.entries(vil.u || {})) {
                    const stats = UNITS[uName.toLowerCase()] || { name: uName };
                    unitBadgeHtml += `<span style="background: #ece8d6; border: 1px solid #6a5a48; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #101010;"><strong>${stats.name}:</strong> ${uCount.toLocaleString()}</span> `;
                }

                const lastScanStr = formatTimestamp(vil.t);

                vilHtml += `
                    <div style="background: #f8f4e6; border: 1px solid #6a5a48; padding: 8px 10px; border-radius: 4px; margin-bottom: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-weight: 600; font-size: 12px; color: #101010;">${vil.n || 'Village'} (${coords})</span>
                            <span style="font-size: 11px; color: #6a5a48;">Scanned: ${lastScanStr}</span>
                        </div>
                        <div style="display: flex; gap: 12px; font-size: 11px; font-weight: 500; margin-bottom: 4px;">
                            <span style="color: #991b1b;">HMR: ${hammer.toLocaleString()}</span>
                            <span style="color: #165eb9;">DEF: ${def.toLocaleString()}</span>
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                            ${unitBadgeHtml || '<span style="font-size: 11px; color: #6a5a48;">No surviving units.</span>'}
                        </div>
                    </div>
                `;
            });
        }

        const statsTableHtml = `
            <div style="background: #f8f4e6; border: 1px solid #6a5a48; border-radius: 4px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="background: #6a5a48; color: #fff; text-align: left; font-size: 11px; text-transform: uppercase;">
                            <th style="padding: 6px 8px;">Unit Type</th>
                            <th style="padding: 6px 8px; text-align: right;">Count</th>
                            <th style="padding: 6px 8px; text-align: right;">Total HMR</th>
                            <th style="padding: 6px 8px; text-align: right;">Total DEF</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${troopTableRows}
                    </tbody>
                </table>
            </div>
        `;

        const content = document.getElementById('tw-troop-intel-content');
        content.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px; background: #f8f4e6; border: 1px solid #6a5a48; padding: 10px; border-radius: 4px; margin-bottom: 12px;">
                <div><strong>Total Troops:</strong> <span style="font-weight: 500; color: #101010;">${grandTotalTroops.toLocaleString()}</span></div>
                <div><strong>Max Single Hammer:</strong> <span style="color: #991b1b; font-weight: 500;">${maxHammer.toLocaleString()}</span></div>
                <div><strong>Total Def Power:</strong> <span style="color: #165eb9; font-weight: 500;">${totalDef.toLocaleString()}</span></div>
            </div>

            ${createCollapsibleBlock('tw-troop-modal-stats-table', 'Aggregate Troop Type Statistics', statsTableHtml, true)}
            ${createCollapsibleBlock('tw-troop-modal-garrisons', `Per-Village Garrisons (${villages.length})`, vilHtml, true)}
        `;

        modal.style.display = 'flex';
    }

    function shouldShowConfigButton() {
        const pageType = getPageType();
        return pageType === 'player' || pageType === 'alliance' || pageType === 'report' || pageType === 'village';
    }

    function injectConfigButton() {
        const navContainer = document.querySelector('div.sticky.right-6, div.sticky.top-10');

        if (!shouldShowConfigButton() || !navContainer) {
            const orphanBtn = document.getElementById('tw-troop-gist-config-btn');
            if (orphanBtn) orphanBtn.remove();
            return;
        }

        navContainer.style.display = 'flex';
        navContainer.style.flexDirection = 'row';
        navContainer.style.alignItems = 'center';

        if (navContainer.querySelector('#tw-troop-gist-config-btn')) return;

        const oldBtn = document.getElementById('tw-troop-gist-config-btn');
        if (oldBtn) oldBtn.remove();

        const firstSibling = navContainer.querySelector('button, a');
        const refClass = firstSibling ? firstSibling.className : 'font-button select-none whitespace-nowrap flex pointer-events-auto cursor-pointer hover:before:bg-paper-brown/90 paper-border before:outline before:outline-paper-creme/40 before:-outline-offset-3 paper paper-bg-paper-brown paper-text-paper-white flex-wrap items-center justify-center gap-2 px-3 py-1 text-xl font-bold uppercase shadow-lg transition-colors disabled:brightness-90 disabled:cursor-not-allowed disabled:text-paper-white/60 mr-2 inline-flex p-1! shadow-none! before:rounded-full before:bg-paper-lightbrown hover:before:bg-paper-brown!';

        const newBtn = document.createElement('button');
        newBtn.id = 'tw-troop-gist-config-btn';
        newBtn.type = 'button';
        newBtn.className = refClass;
        newBtn.title = 'Configure Troop Tracker';
        newBtn.style.marginRight = '6px';
        newBtn.innerHTML = `<span><span class="sr-only">Troop Gist Config</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings size-5"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"></path><circle cx="12" cy="12" r="3"></circle></svg></span>`;

        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openGistModal();
        });

        navContainer.insertBefore(newBtn, navContainer.firstChild);
    }

    function processCombatReport() {
        if (document.getElementById('tw-troop-report-parsed-badge')) return;

        const titleEl = document.querySelector('h1.font-title');
        if (!titleEl || !titleEl.textContent.includes('Combat Report')) return;

        const dateEl = document.querySelector('.mt-2')?.previousElementSibling;
        const dateRawStr = dateEl ? dateEl.textContent.trim() : '';
        const reportSec = parseReportTimestamp(dateRawStr);

        document.querySelectorAll('article').forEach(article => {
            const header = article.querySelector('h2');
            if (!header) return;

            const playerAnchor = header.querySelector('a[href^="/player/"], a[href^="/map/player/"]');
            const villageAnchor = header.querySelector('a[href*="/map/tile/"]');
            if (!playerAnchor || !villageAnchor) return;

            const playerName = playerAnchor.textContent.trim();
            const vilText = villageAnchor.textContent.trim();
            const coordMatch = vilText.match(/\((-?\d+)\|(-?\d+)\)/);
            if (!coordMatch) return;

            const coords = `${coordMatch[1]}|${coordMatch[2]}`;
            const vilName = vilText.replace(/\s*\(-?\d+\|-?\d+\)/, '').trim();

            const reportId = `r_${reportSec}_${playerName.replace(/\s+/g, '')}_${coords.replace('|', '_')}`;
            const db = getIntelDB();

            if (db.r[reportId]) return;

            const units = {};
            article.querySelectorAll('ul > li.flex.justify-center').forEach(li => {
                const srText = li.querySelector('.sr-only')?.textContent.trim().toLowerCase();
                const rowDivs = li.querySelectorAll('div.flex-col > div');

                if (srText && rowDivs.length >= 2) {
                    const initialCount = parseInt(rowDivs[0].textContent.replace(/[^0-9]/g, ''), 10) || 0;
                    const lossCount = parseInt(rowDivs[1].textContent.replace(/[^0-9]/g, ''), 10) || 0;
                    const remaining = Math.max(0, initialCount - lossCount);
                    if (remaining > 0) units[srText] = remaining;
                }
            });

            db.p[playerName] = db.p[playerName] || { v: {} };
            const existingVil = db.p[playerName].v[coords];

            if (existingVil) {
                const timeDiff = Math.abs(reportSec - existingVil.t);
                if (timeDiff <= 3600) {
                    const activeSession = existingVil.cu ? { ...existingVil.cu } : { ...(existingVil.u || {}) };
                    for (const [uName, count] of Object.entries(units)) {
                        activeSession[uName] = (activeSession[uName] || 0) + count;
                    }
                    existingVil.cu = activeSession;
                    existingVil.t = Math.max(existingVil.t, reportSec);
                    if (vilName) existingVil.n = vilName;

                    const maxUnits = { ...(existingVil.u || {}) };
                    for (const [uName, count] of Object.entries(activeSession)) {
                        maxUnits[uName] = Math.max(maxUnits[uName] || 0, count);
                    }
                    existingVil.u = maxUnits;
                } else {
                    existingVil.cu = { ...units };
                    existingVil.t = Math.max(existingVil.t, reportSec);
                    if (vilName) existingVil.n = vilName;

                    const maxUnits = { ...(existingVil.u || {}) };
                    for (const [uName, count] of Object.entries(units)) {
                        maxUnits[uName] = Math.max(maxUnits[uName] || 0, count);
                    }
                    existingVil.u = maxUnits;
                }
            } else {
                db.p[playerName].v[coords] = {
                    n: vilName,
                    u: { ...units },
                    cu: { ...units },
                    t: reportSec
                };
            }

            db.r[reportId] = 1;
            saveIntelDB(db);
        });

        const badge = document.createElement('span');
        badge.id = 'tw-troop-report-parsed-badge';
        badge.style.cssText = 'background: #15803d; color: #fff; font-size: 12px; font-weight: normal; padding: 2px 8px; border-radius: 4px; margin-left: 8px; vertical-align: middle;';
        badge.textContent = '\u2713 Intel Saved';
        titleEl.appendChild(badge);
    }

    function injectPlayerPage() {
        let playerName = null;

        const urlMatch = window.location.pathname.match(/\/(?:map\/)?player\/([^/?#]+)/i);
        if (urlMatch) {
            playerName = decodeURIComponent(urlMatch[1]).trim();
        }

        const rootNode = document.getElementById('village-scroll-container') || document;

        if (!playerName) {
            const h1 = rootNode.querySelector('h1.font-title, h1');
            if (h1) playerName = h1.textContent.trim();
        }

        if (!playerName) {
            const playerAnchor = rootNode.querySelector('dd a[href*="/player/"]');
            if (playerAnchor) playerName = playerAnchor.textContent.trim();
        }

        if (!playerName) return;

        // Locate the Villages wrapper (<div class="flex flex-col"><h2 ...>Villages</h2>...)
        let villagesDiv = null;
        const headings = rootNode.querySelectorAll('h2');
        for (let h = 0; h < headings.length; h++) {
            if (headings[h].textContent.trim().toLowerCase() === 'villages') {
                villagesDiv = headings[h].closest('.flex.flex-col') || headings[h].parentElement;
                break;
            }
        }

        if (!villagesDiv) {
            const table = rootNode.querySelector('table');
            if (table) villagesDiv = table.closest('.flex.flex-col') || table.parentElement;
        }

        if (!villagesDiv || !villagesDiv.parentElement) return;

        const existingPanel = document.getElementById('tw-troop-player-intel-panel');
        const isCorrectlyPlaced = existingPanel &&
            existingPanel.dataset.player === playerName &&
            existingPanel.nextElementSibling === villagesDiv &&
            villagesDiv.parentElement.contains(existingPanel);

        if (!isCorrectlyPlaced) {
            if (existingPanel) existingPanel.remove();

            const { maxHammer, totalDef } = getPlayerSummary(playerName);

            const panel = document.createElement('div');
            panel.id = 'tw-troop-player-intel-panel';
            panel.dataset.player = playerName;
            panel.className = 'border-paper-creme flex flex-col gap-2 border-t-2 pt-3';

            panel.innerHTML = `
                <div class="relative flex items-center justify-between gap-2">
                    <h3 class="hyphens-auto text-base font-semibold uppercase">Troop Intelligence</h3>
                    <span class="paper paper-border paper-bg-blue text-paper-white pointer-events-none flex size-5 shrink-0 items-center justify-center before:rounded-full">
                        <svg class="tw-troop-player-chevron-icon lucide lucide-chevrons-up size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path></svg>
                    </span>
                    <button type="button" class="tw-troop-player-toggle-btn hover:bg-paper-creme/25 absolute inset-0 cursor-pointer rounded-md transition-colors" aria-expanded="true" aria-label="Toggle Troop Intelligence">
                        <span class="sr-only">Toggle Troop Intelligence</span>
                    </button>
                </div>
                <div class="tw-troop-player-panel-body flex flex-col gap-2 mt-1">
                    <div class="tw-troop-player-modal-trigger cursor-pointer" title="Click for full troop statistics">
                        ${createBadgeMarkup(maxHammer, totalDef, 'MAX HMR', 'TOTAL DEF')}
                    </div>
                </div>
            `;

            const toggleBtn = panel.querySelector('.tw-troop-player-toggle-btn');
            const bodyEl = panel.querySelector('.tw-troop-player-panel-body');
            const iconSvg = panel.querySelector('.tw-troop-player-chevron-icon');

            if (toggleBtn && bodyEl) {
                toggleBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const isHidden = bodyEl.style.display === 'none';
                    bodyEl.style.display = isHidden ? 'flex' : 'none';
                    toggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
                    if (iconSvg) {
                        iconSvg.innerHTML = isHidden
                            ? '<path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path>'
                            : '<path d="m7 6 5 5 5-5"></path><path d="m7 13 5 5 5-5"></path>';
                    }
                });
            }

            const modalTrigger = panel.querySelector('.tw-troop-player-modal-trigger');
            if (modalTrigger) {
                modalTrigger.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openTroopBreakdownModal(playerName);
                });
            }

            villagesDiv.parentElement.insertBefore(panel, villagesDiv);
        }

        const db = getIntelDB();
        const pData = (db.p && db.p[playerName]) || { v: {} };

        const rows = rootNode.querySelectorAll('table tbody tr');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.dataset.twTroopVilProcessed) continue;

            const tileLink = row.querySelector('a[href*="/map/tile/"]');
            if (!tileLink) continue;

            row.dataset.twTroopVilProcessed = "true";
            const coordMatch = tileLink.textContent.match(/\((-?\d+)\|(-?\d+)\)/);
            if (!coordMatch) continue;

            const coords = `${coordMatch[1]}|${coordMatch[2]}`;
            const vilData = pData.v ? pData.v[coords] : null;

            const nameTd = row.querySelector('td');
            if (nameTd && vilData) {
                const { hammer, def } = calcArmyPower(vilData.u || {});
                const pSpan = document.createElement('div');
                pSpan.className = 'tw-troop-vil-power text-xs mt-0.5 flex gap-2 font-medium cursor-pointer';
                pSpan.title = 'Click for full troop statistics';
                pSpan.onclick = (e) => {
                    e.stopPropagation();
                    openTroopBreakdownModal(playerName);
                };
                pSpan.innerHTML = createBadgeMarkup(hammer, def);
                nameTd.appendChild(pSpan);
            }
        }
    }

    function injectVillageDetailPage() {
        let targetCoords = null;
        const urlMatch = window.location.pathname.match(/\/map\/tile\/(-?\d+)\/(-?\d+)/i);
        if (urlMatch) {
            targetCoords = `${urlMatch[1]}|${urlMatch[2]}`;
        }

        const scrollContainer = document.getElementById('village-scroll-container');
        const rootNode = scrollContainer || document;

        if (!targetCoords) {
            const h1 = rootNode.querySelector('h1.font-title, h1');
            if (h1) {
                const m = h1.textContent.match(/\((-?\d+)\|(-?\d+)\)/);
                if (m) targetCoords = `${m[1]}|${m[2]}`;
            }
        }

        if (!targetCoords) {
            const coordMatch = rootNode.innerText.match(/\((-?\d+)\|(-?\d+)\)/);
            if (coordMatch) targetCoords = `${coordMatch[1]}|${coordMatch[2]}`;
        }

        if (!targetCoords) return;

        const existingPanel = document.getElementById('tw-troop-village-intel-panel');
        if (existingPanel) {
            if (existingPanel.dataset.coords === targetCoords) {
                return;
            }
            existingPanel.remove();
        }

        const vilMatch = findVillageByCoords(targetCoords);
        const panel = document.createElement('div');
        panel.id = 'tw-troop-village-intel-panel';
        panel.dataset.coords = targetCoords;
        panel.className = 'border-paper-creme flex flex-col gap-2 border-t-2 pt-3';

        if (vilMatch) {
            const { hammer, def } = calcArmyPower(vilMatch.village.u || {});
            let unitBadgeHtml = '';
            for (const [uName, uCount] of Object.entries(vilMatch.village.u || {})) {
                const stats = UNITS[uName.toLowerCase()] || { name: uName };
                unitBadgeHtml += `<span style="background: #ece8d6; border: 1px solid #6a5a48; padding: 2px 6px; border-radius: 3px; font-size: 11px; color: #101010;"><strong>${stats.name}:</strong> ${uCount.toLocaleString()}</span> `;
            }

            const lastScanStr = formatTimestamp(vilMatch.village.t);

            panel.innerHTML = `
                <div class="relative flex items-center justify-between gap-2">
                    <h3 class="hyphens-auto text-base font-semibold uppercase font-bold!">Troop Intelligence</h3>
                    <span class="paper paper-border paper-bg-blue text-paper-white pointer-events-none flex size-5 shrink-0 items-center justify-center before:rounded-full">
                        <svg class="tw-troop-chevron-icon lucide lucide-chevrons-up size-4" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path></svg>
                    </span>
                    <button type="button" class="tw-troop-toggle-btn hover:bg-paper-creme/25 absolute inset-0 cursor-pointer rounded-md transition-colors" aria-expanded="true" aria-label="Toggle Troop Intelligence">
                        <span class="sr-only">Toggle Troop Intelligence</span>
                    </button>
                </div>
                <div class="tw-troop-panel-body flex flex-col gap-2 mt-1">
                    <div class="tw-troop-modal-trigger cursor-pointer" title="Click for full troop statistics">
                        ${createBadgeMarkup(hammer, def, 'HMR', 'DEF')}
                    </div>
                    <div class="text-xs text-paper-brown mb-1">Scanned: ${lastScanStr}</div>
                    <div class="flex flex-wrap gap-1">
                        ${unitBadgeHtml || '<span class="text-xs text-paper-brown">No surviving units recorded.</span>'}
                    </div>
                </div>
            `;
        } else {
            panel.innerHTML = `
                <div class="relative flex items-center justify-between gap-2">
                    <h3 class="hyphens-auto text-base font-semibold uppercase font-bold!">Troop Intelligence</h3>
                </div>
                <div class="text-xs font-medium text-paper-brown">No scanned troop intel for village (${targetCoords}).</div>
            `;
        }

        const toggleBtn = panel.querySelector('.tw-troop-toggle-btn');
        const bodyEl = panel.querySelector('.tw-troop-panel-body');
        const iconSvg = panel.querySelector('.tw-troop-chevron-icon');

        if (toggleBtn && bodyEl) {
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isHidden = bodyEl.style.display === 'none';
                bodyEl.style.display = isHidden ? 'flex' : 'none';
                toggleBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
                if (iconSvg) {
                    iconSvg.innerHTML = isHidden
                        ? '<path d="m17 11-5-5-5 5"></path><path d="m17 18-5-5-5 5"></path>'
                        : '<path d="m7 6 5 5 5-5"></path><path d="m7 13 5 5 5-5"></path>';
                }
            });
        }

        const modalTrigger = panel.querySelector('.tw-troop-modal-trigger');
        if (modalTrigger && vilMatch) {
            modalTrigger.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openTroopBreakdownModal(vilMatch.playerName);
            });
        }

        const sendSection = rootNode.querySelector('section');
        if (sendSection && sendSection.parentElement) {
            sendSection.parentElement.insertBefore(panel, sendSection.nextElementSibling);
        } else {
            const dlEl = rootNode.querySelector('dl');
            if (dlEl && dlEl.parentElement) {
                dlEl.parentElement.insertBefore(panel, dlEl.nextElementSibling);
            } else {
                const targetContainer = rootNode.querySelector('.flex.flex-col.gap-3, .flex.flex-col.gap-2, .flex.flex-col.gap-4') || scrollContainer;
                if (targetContainer) {
                    targetContainer.appendChild(panel);
                }
            }
        }
    }

    window.twTroopOpenIntelModal = function (playerName) {
        openTroopBreakdownModal(playerName);
    };

    function injectAlliancePage() {
        const memberTable = document.querySelector('table[data-tw-troop-delegated="true"], table[data-tw-delegated="true"], .flex.flex-col > table.text-sm');
        if (!memberTable) return;

        memberTable.setAttribute('data-tw-troop-delegated', 'true');

        const unparsedRows = memberTable.querySelectorAll('tbody tr:not([data-tw-troop-row-processed])');
        if (unparsedRows.length === 0) return;

        for (let i = 0; i < unparsedRows.length; i++) {
            const row = unparsedRows[i];
            row.setAttribute('data-tw-troop-row-processed', 'true');

            const pLink = row.querySelector('a[href*="/map/player/"], a[href*="/player/"]');
            if (!pLink) continue;

            const playerName = pLink.textContent.trim();
            const { maxHammer, totalDef } = getPlayerSummary(playerName);

            const targetContainer = row.querySelector('td .flex.flex-col');
            if (targetContainer) {
                const infoBadge = document.createElement('div');
                infoBadge.className = 'text-xs flex gap-2 mt-1 cursor-pointer';
                infoBadge.title = 'Click for full troop statistics';
                infoBadge.onclick = (e) => {
                    e.stopPropagation();
                    openTroopBreakdownModal(playerName);
                };
                infoBadge.innerHTML = createBadgeMarkup(maxHammer, totalDef);
                targetContainer.appendChild(infoBadge);
            }
        }
    }

    function main() {
        if (isProcessing) return;
        isProcessing = true;

        if (observer) observer.disconnect();

        try {
            getIntelDB();

            const pageType = getPageType();

            switch (pageType) {
                case 'report':
                    processCombatReport();
                    break;
                case 'player':
                    injectPlayerPage();
                    break;
                case 'alliance':
                    injectAlliancePage();
                    break;
                case 'village':
                    injectVillageDetailPage();
                    break;
                case 'excluded':
                default:
                    break;
            }

            injectConfigButton();
        } finally {
            isProcessing = false;
            if (observer) {
                observer.observe(document.body, { childList: true, subtree: true });
            }
        }
    }

    fetchFromGist(() => main());

    let timer = null;
    observer = new MutationObserver(() => {
        if (timer) return;
        timer = setTimeout(() => {
            timer = null;
            main();
        }, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
