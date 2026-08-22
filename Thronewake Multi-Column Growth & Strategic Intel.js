// ==UserScript==
// @name         Thronewake Multi-Column Growth & Strategic Intel
// @namespace    http://tampermonkey.net/
// @version      16.3
// @description  Tracks leaderboard columns individually, displays inline server-speed scaled growth percentages (3 game days vs 9 game days ratio: 1d/3d for 3x, 3d/9d for 1x) with momentum-based dynamic theme color coding, two-point flatline compression, configurable number formatting, UTC/Local time toggle, server speed multiplier, customizable record interval, 90-day UTC Gist history (with settings sync & connection indicator), live plot data injection at Date.now(), dynamic metric projections, real time duration tooltips, and Travian strategy modal.
// @author       petrgon
// @match        https://www.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      githubusercontent.com
// @require      https://cdn.jsdelivr.net/npm/chart.js
// ==/UserScript==

(function () {
    'use strict';

    const GIST_ID_KEY = 'tw_gist_id';
    const GIST_TOKEN_KEY = 'tw_gist_token';
    const NUMBER_FORMAT_KEY = 'tw_number_format';
    const SERVER_SPEED_KEY = 'tw_server_speed';
    const TIMEZONE_FORMAT_KEY = 'tw_timezone_format';
    const RECORD_INTERVAL_KEY = 'tw_record_interval';
    const LOCAL_HISTORY_KEY = 'tw_local_history';
    const GIST_FILENAME = 'thronewake_leaderboard_history.json';

    const ONE_HOUR_MS = 60 * 60 * 1000;
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    const NINE_DAYS_MS = 9 * 24 * 60 * 60 * 1000;
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

    let gistHistory = {};
    try {
        const rawLocal = GM_getValue(LOCAL_HISTORY_KEY, '{}');
        gistHistory = JSON.parse(rawLocal) || {};
    } catch (e) {
        gistHistory = {};
    }

    let isGistLoaded = false;
    let gistStatus = 'not_configured'; // 'connected', 'error', 'not_configured'
    let syncTimeout = null;
    let activeChart = null;

    // --- Settings Sync Helpers (__config__ Namespace) ---

    function syncSettingsFromGist(remoteSettings) {
        if (!remoteSettings || typeof remoteSettings !== 'object') return;
        if (remoteSettings.numFormat !== undefined) GM_setValue(NUMBER_FORMAT_KEY, remoteSettings.numFormat);
        if (remoteSettings.serverSpeed !== undefined) GM_setValue(SERVER_SPEED_KEY, remoteSettings.serverSpeed);
        if (remoteSettings.timeFormat !== undefined) GM_setValue(TIMEZONE_FORMAT_KEY, remoteSettings.timeFormat);
        if (remoteSettings.recordInterval !== undefined) GM_setValue(RECORD_INTERVAL_KEY, remoteSettings.recordInterval);
    }

    function embedSettingsInGistHistory() {
        gistHistory.__config__ = {
            numFormat: GM_getValue(NUMBER_FORMAT_KEY, 'raw'),
            serverSpeed: GM_getValue(SERVER_SPEED_KEY, 3),
            timeFormat: GM_getValue(TIMEZONE_FORMAT_KEY, 'utc'),
            recordInterval: GM_getValue(RECORD_INTERVAL_KEY, 1)
        };
    }

    function saveLocalHistory() {
        embedSettingsInGistHistory();
        GM_setValue(LOCAL_HISTORY_KEY, JSON.stringify(gistHistory));
    }

    function getValidHistory(records) {
        if (!records || !Array.isArray(records)) return [];
        return records.filter(r => typeof r.v === 'number' && r.v < 1000000000);
    }

    function formatRealDuration(hours) {
        if (hours >= 24) {
            const days = hours / 24;
            return `${days.toFixed(1).replace(/\.0$/, '')}d`;
        }
        return `${hours.toFixed(1).replace(/\.0$/, '')}h`;
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const trendModal = document.getElementById('tw-trend-modal');
            const gistModal = document.getElementById('tw-gist-modal');

            const isTrendOpen = trendModal && trendModal.style.display !== 'none';
            const isGistOpen = gistModal && gistModal.style.display !== 'none';

            if (isTrendOpen || isGistOpen) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (isTrendOpen) trendModal.style.display = 'none';
                if (isGistOpen) gistModal.style.display = 'none';
            }
        }
    }, true);

    function formatCompact(num, includeSign = false) {
        if (num === null || num === undefined || isNaN(num)) return 'N/A';
        const formatMode = GM_getValue(NUMBER_FORMAT_KEY, 'raw');
        const rounded = Math.round(num);
        const absNum = Math.abs(rounded);
        const sign = rounded < 0 ? '-' : (includeSign && rounded > 0 ? '+' : '');

        if (formatMode === 'compact') {
            let formatted = '';
            if (absNum >= 1e9) {
                formatted = (absNum / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
            } else if (absNum >= 1e6) {
                formatted = (absNum / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            } else if (absNum >= 1e3) {
                formatted = (absNum / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
            } else {
                formatted = absNum.toString();
            }
            return sign + formatted;
        } else {
            return sign + absNum.toLocaleString('en-US');
        }
    }

    function pullFromGist(callback) {
        const gistId = GM_getValue(GIST_ID_KEY, '');
        const token = GM_getValue(GIST_TOKEN_KEY, '');

        if (!gistId || !token) {
            isGistLoaded = true;
            gistStatus = 'not_configured';
            if (callback) callback(false, 'Enter Gist ID & Token first');
            processTable();
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${gistId}`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000,
            onload: function (response) {
                if (response.status === 200) {
                    try {
                        const resData = JSON.parse(response.responseText);
                        if (resData.files && resData.files[GIST_FILENAME]) {
                            const fileObj = resData.files[GIST_FILENAME];

                            if (fileObj.truncated && fileObj.raw_url) {
                                GM_xmlhttpRequest({
                                    method: 'GET',
                                    url: fileObj.raw_url,
                                    onload: function (rawRes) {
                                        if (rawRes.status === 200) {
                                            gistHistory = JSON.parse(rawRes.responseText);
                                            if (gistHistory.__config__) syncSettingsFromGist(gistHistory.__config__);
                                            else embedSettingsInGistHistory();
                                            saveLocalHistory();
                                            isGistLoaded = true;
                                            gistStatus = 'connected';
                                            if (callback) callback(true);
                                            processTable();
                                        } else {
                                            isGistLoaded = true;
                                            gistStatus = 'error';
                                            if (callback) callback(false, 'Raw Stream Failed');
                                            processTable();
                                        }
                                    }
                                });
                                return;
                            }

                            gistHistory = JSON.parse(fileObj.content);
                            if (gistHistory.__config__) syncSettingsFromGist(gistHistory.__config__);
                            else embedSettingsInGistHistory();
                            saveLocalHistory();
                            isGistLoaded = true;
                            gistStatus = 'connected';
                            if (callback) callback(true);
                            processTable();
                        } else {
                            isGistLoaded = true;
                            gistStatus = 'connected';
                            if (callback) callback(true);
                            processTable();
                        }
                    } catch (e) {
                        console.error('Error parsing Gist JSON', e);
                        isGistLoaded = true;
                        gistStatus = 'error';
                        if (callback) callback(false, 'Invalid JSON in Gist');
                        processTable();
                    }
                } else {
                    isGistLoaded = true;
                    gistStatus = 'error';
                    if (callback) callback(false, `HTTP Error ${response.status}`);
                    processTable();
                }
            },
            onerror: function () {
                isGistLoaded = true;
                gistStatus = 'error';
                if (callback) callback(false, 'Network Error / Blocked');
                processTable();
            },
            ontimeout: function () {
                isGistLoaded = true;
                gistStatus = 'error';
                if (callback) callback(false, 'Request Timed Out');
                processTable();
            }
        });
    }

    function pushToGistDebounced() {
        embedSettingsInGistHistory();
        saveLocalHistory();

        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            const gistId = GM_getValue(GIST_ID_KEY, '');
            const token = GM_getValue(GIST_TOKEN_KEY, '');
            if (!gistId || !token) return;

            GM_xmlhttpRequest({
                method: 'PATCH',
                url: `https://api.github.com/gists/${gistId}`,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({
                    files: {
                        [GIST_FILENAME]: {
                            content: JSON.stringify(gistHistory, null, 2)
                        }
                    }
                }),
                onload: function(res) {
                    if (res.status === 200) gistStatus = 'connected';
                    else gistStatus = 'error';
                },
                onerror: function() { gistStatus = 'error'; }
            });
        }, 2500);
    }

    function getGainOverHours(records, hours) {
        const valid = getValidHistory(records);
        if (valid.length < 2) return 0;

        const targetTime = Date.now() - (hours * 60 * 60 * 1000);
        let rec = valid[0];
        let minDiff = Math.abs(rec.t - targetTime);
        for (let i = 1; i < valid.length; i++) {
            let diff = Math.abs(valid[i].t - targetTime);
            if (diff < minDiff) { minDiff = diff; rec = valid[i]; }
        }
        return Math.max(0, valid[valid.length - 1].v - rec.v);
    }

    // --- Server Speed Scaled Growth Stats (3 Game Days vs 9 Game Days Window) ---

    function getSpeedScaledGrowthStats(validRecords, currentValue) {
        const valid = getValidHistory(validRecords);
        const serverSpeed = parseFloat(GM_getValue(SERVER_SPEED_KEY, 3)) || 3;

        // 3 Game Days = (72 / serverSpeed) real hours; 9 Game Days = (216 / serverSpeed) real hours
        const real1Hours = 72 / serverSpeed;
        const real3Hours = 216 / serverSpeed;
        const str1 = formatRealDuration(real1Hours);
        const str3 = formatRealDuration(real3Hours);

        if (valid.length < 2) {
            return { percentText: '0.00%', pct3dText: '0.00%', gain1Day: 0, gain3Days: 0, str1, str3, symbol: '', status: '▶ Gathering history...', colorStyle: 'color: #948e85; font-weight: 400;' };
        }

        const now = Date.now();

        const real1DayMs = THREE_DAYS_MS / serverSpeed;
        const real3DaysMs = NINE_DAYS_MS / serverSpeed;

        // Primary Window Baseline (3 Game Days)
        const target1Day = now - real1DayMs;
        let rec1Day = valid[0];
        let minDiff1 = Math.abs(rec1Day.t - target1Day);
        for (let i = 1; i < valid.length; i++) {
            let diff = Math.abs(valid[i].t - target1Day);
            if (diff < minDiff1) { minDiff1 = diff; rec1Day = valid[i]; }
        }

        // Secondary Window Baseline (9 Game Days)
        const target3Days = now - real3DaysMs;
        let rec3Days = valid[0];
        let minDiff3 = Math.abs(rec3Days.t - target3Days);
        for (let i = 1; i < valid.length; i++) {
            let diff = Math.abs(valid[i].t - target3Days);
            if (diff < minDiff3) { minDiff3 = diff; rec3Days = valid[i]; }
        }

        const gain1Day = currentValue - rec1Day.v;
        const gain3Days = currentValue - rec3Days.v;
        const gainPrior2Days = Math.max(0, rec1Day.v - rec3Days.v);
        const avgPriorDailyGain = gainPrior2Days / 2;

        let percentText = '0.00%';
        if (rec1Day.v > 0) {
            const pct = ((gain1Day / rec1Day.v) * 100).toFixed(2);
            if (gain1Day > 0) {
                percentText = `+${pct}%`;
            } else if (gain1Day < 0) {
                percentText = `${pct}%`;
            }
        }

        let pct3dText = '0.00%';
        if (rec3Days.v > 0) {
            const pct3 = ((gain3Days / rec3Days.v) * 100).toFixed(2);
            if (gain3Days > 0) {
                pct3dText = `+${pct3}%`;
            } else if (gain3Days < 0) {
                pct3dText = `${pct3}%`;
            }
        }

        let symbol = '▶\uFE0E';
        let status = '▶ Steady pace';
        let colorStyle = 'color: #6a5a48; font-weight: 400;'; // UI Parchment Brown for Steady

        if (gain1Day === 0) {
            symbol = '⏸\uFE0E';
            status = '⏸ Growth paused';
            colorStyle = 'color: #948e85; font-weight: 400;'; // Disabled Light Muted Gray
        } else if (gain1Day < 0) {
            symbol = '▼\uFE0E';
            status = '▼ Stalled / Declining';
            colorStyle = 'color: #c5221f; font-weight: 400;'; // Brighter Clear Red
        } else if (avgPriorDailyGain > 0 && gain1Day > (avgPriorDailyGain * 1.25)) {
            symbol = '▲\uFE0E';
            status = '▲ Accelerating';
            colorStyle = 'color: #15803d; font-weight: 400;'; // Emerald Green
        } else if (avgPriorDailyGain > 0 && gain1Day < (avgPriorDailyGain * 0.75)) {
            symbol = '▼\uFE0E';
            status = '▼ Slowing down';
            colorStyle = 'color: #c5221f; font-weight: 400;'; // Brighter Clear Red
        }

        return { percentText, pct3dText, gain1Day, gain3Days, str1, str3, symbol, status, colorStyle };
    }

    // --- Dynamic Account-Stage Relative Travian Strategy Assessment ---

    function getTravianStrategicIntel(playerName, currentValue, metricKey) {
        const serverSpeed = parseFloat(GM_getValue(SERVER_SPEED_KEY, 3)) || 3;
        const pData = gistHistory[playerName] || {};
        const popHistory = pData['pop_population'] || [];
        const pvpAttHistory = pData['attack_pvp'] || [];
        const pvpDefHistory = pData['defense_pvp'] || [];
        const lootHistory = pData['loot'] || [];

        const popGain24h = getGainOverHours(popHistory, 24);
        const pvpGain24h = getGainOverHours(pvpAttHistory, 24);
        const defGain24h = getGainOverHours(pvpDefHistory, 24);
        const lootGain24h = getGainOverHours(lootHistory, 24);

        const validPop = getValidHistory(popHistory);
        const currentPopRec = validPop[validPop.length - 1];
        const currentPop = (currentPopRec && typeof currentPopRec.v === 'number') ? currentPopRec.v : (metricKey === 'pop_population' ? currentValue : 0);

        const relPopGrowth = currentPop > 0 ? (popGain24h / currentPop) : 0;

        const pvpThreshold = Math.max(50, currentPop * 0.08) * serverSpeed;
        const lootThreshold = Math.max(10000, currentPop * 50) * serverSpeed;
        const ecoPopRateThreshold = 0.03 * serverSpeed;

        let archetype = "⚖️ Balanced Growth";
        let statusBg = "#e2e8f0";
        let statusColor = "#334155";
        let tactic = "Player maintains an even ratio of eco growth and army expansion. Standard scouting advised.";

        if (defGain24h > pvpThreshold) {
            archetype = "💥 Decimated Defense (Heavy Losses)";
            statusBg = "#fce7f3";
            statusColor = "#9d174d";
            tactic = "Player suffered heavy troop casualties defending their village (defense points = lost own def-units). Defensive force is decimated—ideal target for immediate follow-up attack or chiefing!";
        } else if (pvpGain24h > pvpThreshold && defGain24h < (pvpThreshold * 0.25)) {
            archetype = "⚔️ Unpunished Attacker";
            statusBg = "#fee2e2";
            statusColor = "#b91c1c";
            tactic = "Kills many enemy troops on attacks without facing counter-attacks. Has a strong hammer—prepare defense stacks for wave attacks.";
        } else if (pvpGain24h > (pvpThreshold * 0.5) && defGain24h > (pvpThreshold * 0.5)) {
            archetype = "🔥 Two-Way War";
            statusBg = "#ffedd5";
            statusColor = "#c2410c";
            tactic = "Heavy fighting on both sides—killing enemy units on offense while losing troops defending against incoming raids.";
        } else if (relPopGrowth >= ecoPopRateThreshold && pvpGain24h < (pvpThreshold * 0.3) && defGain24h < (pvpThreshold * 0.3)) {
            archetype = "🏰 Eco Rusher (Simmer)";
            statusBg = "#dcfce7";
            statusColor = "#15803d";
            tactic = "Upgrading fields/buildings for new villages. Zero defensive losses or attack kills—prime target for catapults or chiefing before wall completion.";
        } else if (relPopGrowth <= (0.005 * serverSpeed) && pvpGain24h > pvpThreshold) {
            archetype = "⚔️ Hammer Builder";
            statusBg = "#fee2e2";
            statusColor = "#b91c1c";
            tactic = "Population growth stalled while offensive points surged. Barracks/Stables running non-stop. Request defense stacks or plan a preventive strike.";
        } else if (lootGain24h > lootThreshold) {
            archetype = "🐎 Active Raider";
            statusBg = "#fef3c7";
            statusColor = "#b45309";
            tactic = "High daily loot yield for their account size. Expect fakes and raids. Keep stocks low, build crannies, or plan counter-raid traps on returning troops.";
        } else if (popGain24h === 0 && pvpGain24h === 0 && defGain24h === 0 && lootGain24h === 0) {
            archetype = "💤 Inactive / Potential Farm";
            statusBg = "#f1f5f9";
            statusColor = "#64748b";
            tactic = "Zero growth across all sectors over 24h. Send scouts to verify garrison and resource stocks.";
        }

        let unit = 'pts';
        if (metricKey.includes('village')) unit = 'villages';
        else if (metricKey.includes('pop')) unit = 'pop';
        else if (metricKey.includes('loot')) unit = 'res';

        const metric24hGain = getGainOverHours(pData[metricKey] || [], 24);
        const proj7d = currentValue + (metric24hGain * 7 * 0.8);

        return { archetype, statusBg, statusColor, tactic, proj7d, popGain24h, pvpGain24h, defGain24h, lootGain24h, unit };
    }

    function getActiveCategory() {
        const urlParams = new URLSearchParams(window.location.search);
        const cat = urlParams.get('category');
        if (cat) return cat.toLowerCase();

        const activeTab = document.querySelector('[role="tablist"] a.active, [role="tablist"] a[aria-current="page"]');
        if (activeTab) {
            const text = activeTab.textContent.trim().toLowerCase();
            if (['population', 'attack', 'defense', 'loot'].includes(text)) return text;
        }
        return 'population';
    }

    function isWeeklySelected() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('period')?.toLowerCase() === 'weekly') return true;

        const weeklyTab = document.querySelector('#weekly-tab');
        if (weeklyTab && (weeklyTab.classList.contains('active') || weeklyTab.getAttribute('aria-current') === 'page')) {
            return true;
        }

        return false;
    }

    function parseValue(text) {
        if (!text) return 0;
        const clean = text.replace(/[\s\u00a0]+/g, '').trim();
        const match = clean.match(/([\d\.,]+)\s*([kMbB]?)/);
        if (!match) return 0;

        let num = parseFloat(match[1].replace(/,/g, ''));
        if (isNaN(num)) return 0;

        const unit = match[2].toLowerCase();
        if (unit === 'k') num *= 1000;
        else if (unit === 'm') num *= 1000000;
        else if (unit === 'b') num *= 1000000000;

        return Math.round(num) || 0;
    }

    function findLeaderboardTable() {
        const tables = document.querySelectorAll('table, [role="table"]');
        for (const t of tables) {
            if (t.querySelector('a[href*="player"], a[href*="user"], a[href*="profile"], a[href*="alliance"], a[href*="/p/"]')) {
                return t;
            }
        }
        return null;
    }

    function getMetricsConfig(table) {
        const category = getActiveCategory();
        const headerThs = Array.from(table.querySelectorAll('thead th, th, [role="columnheader"]'));
        const config = [];

        headerThs.forEach((th, idx) => {
            const text = th.textContent.trim().toLowerCase();
            if (text.includes('village') || text.includes('town')) {
                config.push({ colIndex: idx + 1, key: 'pop_villages', label: 'Villages' });
            } else if (text.includes('population') || text.includes('pop') || text.includes('score') || text.includes('points')) {
                if (!text.includes('pvp') && !text.includes('pve') && !text.includes('attack') && !text.includes('defense') && !text.includes('loot')) {
                    config.push({ colIndex: idx + 1, key: 'pop_population', label: 'Population' });
                }
            } else if (text.includes('pvp')) {
                config.push({ colIndex: idx + 1, key: category === 'defense' ? 'defense_pvp' : 'attack_pvp', label: 'PvP Points' });
            } else if (text.includes('pve')) {
                config.push({ colIndex: idx + 1, key: category === 'defense' ? 'defense_pve' : 'attack_pve', label: 'PvE Points' });
            } else if (text.includes('loot')) {
                config.push({ colIndex: idx + 1, key: 'loot', label: 'Loot' });
            }
        });

        if (config.length === 0) {
            if (category === 'population') {
                config.push({ colIndex: 3, key: 'pop_villages', label: 'Villages' }, { colIndex: 4, key: 'pop_population', label: 'Population' });
            } else if (category === 'attack') {
                config.push({ colIndex: 3, key: 'attack_pvp', label: 'PvP Attack' }, { colIndex: 4, key: 'attack_pve', label: 'PvE Attack' });
            } else if (category === 'defense') {
                config.push({ colIndex: 3, key: 'defense_pvp', label: 'PvP Defense' }, { colIndex: 4, key: 'defense_pve', label: 'PvE Defense' });
            } else if (category === 'loot') {
                config.push({ colIndex: 3, key: 'loot', label: 'Loot' });
            }
        }

        return config;
    }

    function canInjectPercentages() {
        const table = findLeaderboardTable();
        if (!table) return false;

        const rows = table.querySelectorAll('tbody tr, [role="row"]');
        if (rows.length === 0) return false;

        const metricsConfig = getMetricsConfig(table);
        if (metricsConfig.length === 0) return false;

        let validCellFound = false;
        for (const row of rows) {
            const tds = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
            const playerLink = row.querySelector('a[href*="player"], a[href*="user"], a[href*="profile"], a[href*="alliance"], a[href*="/p/"]') || tds[1]?.querySelector('a');
            if (playerLink) {
                for (const m of metricsConfig) {
                    if (tds[m.colIndex - 1]) {
                        validCellFound = true;
                        break;
                    }
                }
            }
            if (validCellFound) break;
        }

        return validCellFound;
    }

    function processTable() {
        const table = findLeaderboardTable();
        if (!table) return;

        if (isWeeklySelected()) {
            table.querySelectorAll('.tw-growth-badge').forEach(b => b.remove());
            return;
        }

        const isAlliancePage = window.location.pathname.includes('/alliance');
        const now = Date.now();

        const recordIntervalHours = parseFloat(GM_getValue(RECORD_INTERVAL_KEY, 1)) || 1;
        const minRecordMs = recordIntervalHours * ONE_HOUR_MS;

        const rows = table.querySelectorAll('tbody tr, [role="row"]');
        if (rows.length === 0) return;

        const metricsConfig = getMetricsConfig(table);
        let hasNewData = false;

        rows.forEach(row => {
            const tds = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
            const playerLink = row.querySelector('a[href*="player"], a[href*="user"], a[href*="profile"], a[href*="alliance"], a[href*="/p/"]') || tds[1]?.querySelector('a');
            if (!playerLink) return;

            const playerName = playerLink.textContent.trim();
            if (!playerName) return;

            if (!gistHistory[playerName]) gistHistory[playerName] = {};

            metricsConfig.forEach(m => {
                const targetTd = tds[m.colIndex - 1];
                if (!targetTd) return;

                const cleanTd = targetTd.cloneNode(true);
                cleanTd.querySelectorAll('.tw-growth-badge').forEach(b => b.remove());
                const currentValue = parseValue(cleanTd.textContent);

                if (currentValue > 1000000000) return;

                if (!gistHistory[playerName][m.key]) gistHistory[playerName][m.key] = [];
                let catHistory = getValidHistory(gistHistory[playerName][m.key]);

                const lastRec = catHistory[catHistory.length - 1];

                if (!isAlliancePage) {
                    if (!lastRec || (now - lastRec.t) >= minRecordMs) {
                        const len = catHistory.length;
                        if (len === 0) {
                            catHistory.push({ t: now, v: currentValue });
                        } else if (currentValue !== catHistory[len - 1].v) {
                            catHistory.push({ t: now, v: currentValue });
                        } else {
                            if (len >= 2 && catHistory[len - 2].v === currentValue) {
                                catHistory[len - 1].t = now;
                            } else {
                                catHistory.push({ t: now, v: currentValue });
                            }
                        }
                        catHistory = catHistory.filter(r => (now - r.t) <= NINETY_DAYS_MS);
                        catHistory.sort((a, b) => a.t - b.t);
                        gistHistory[playerName][m.key] = catHistory;
                        hasNewData = true;
                    }
                } else {
                    gistHistory[playerName][m.key] = catHistory;
                }

                const stats = getSpeedScaledGrowthStats(catHistory, currentValue);
                const momentumSymbol = stats.symbol ? ` ${stats.symbol}` : '';
                const gain1DayFormatted = formatCompact(stats.gain1Day, true);
                const gain3DaysFormatted = formatCompact(stats.gain3Days, true);

                const tooltipText = [
                    `${playerName} — ${m.label}`,
                    `• ${stats.str1} Gain: ${gain1DayFormatted} (${stats.percentText})`,
                    `• ${stats.str3} Gain: ${gain3DaysFormatted} (${stats.pct3dText})`,
                    `• Pace: ${stats.status}`,
                    `\nClick for tactical analysis`
                ].join('\n');

                const container = targetTd.querySelector('div.flex, div, span') || targetTd;
                let badge = container.querySelector('.tw-growth-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'tw-growth-badge';
                    container.appendChild(badge);
                }

                badge.style.cssText = `font-size: 11px; font-weight: 400; margin-left: 3px; display: inline-block; white-space: nowrap; cursor: pointer; text-decoration: underline; text-decoration-style: dotted; font-variant-emoji: text; ${stats.colorStyle}`;
                badge.textContent = `(${stats.percentText}${momentumSymbol})`;
                badge.title = tooltipText;

                badge.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openTrendModal(playerName, m.key, m.label, currentValue);
                };
            });
        });

        saveLocalHistory();

        if (hasNewData && isGistLoaded && !isAlliancePage) {
            pushToGistDebounced();
        }
    }

    function openTrendModal(playerName, metricKey, metricLabel, currentValue) {
        let modal = document.getElementById('tw-trend-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'tw-trend-modal';
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 999999;
                background: rgba(0,0,0,0.65); display: flex;
                align-items: center; justify-content: center;
                font-family: var(--font-sans, sans-serif);
            `;

            modal.innerHTML = `
                <div style="background: #ece8d6; border: 2px solid #101010; padding: 20px; width: 580px; max-width: 92vw; border-radius: 4px; color: #101010; box-shadow: 0 4px 16px rgba(0,0,0,0.6); max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(16,16,16,0.2); padding-bottom: 6px;">
                        <h3 id="tw-trend-title" style="font-weight: 600; text-transform: uppercase; font-size: 15px; color: #6a5a48; margin: 0;">Trend Chart</h3>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div id="tw-chart-range-btns" style="display: flex; gap: 4px;">
                                <button type="button" data-days="3" style="background: #165eb9; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 2px;">3D</button>
                                <button type="button" data-days="7" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 2px;">7D</button>
                                <button type="button" data-days="30" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 2px;">30D</button>
                                <button type="button" data-days="90" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 2px;">All</button>
                            </div>
                            <button type="button" id="tw-btn-close-chart" style="background: #165eb9; color: #fff; border: 1px solid #101010; width: 26px; height: 26px; border-radius: 50%; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;">✕</button>
                        </div>
                    </div>
                    <div style="position: relative; height: 240px; width: 100%; margin-bottom: 14px;">
                        <canvas id="tw-trend-canvas"></canvas>
                    </div>
                    <div id="tw-strat-intel" style="background: #f8f4e6; border: 1px solid #6a5a48; padding: 14px; border-radius: 4px;">
                        <!-- Injected via JS -->
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('tw-btn-close-chart').onclick = () => {
                modal.style.display = 'none';
            };

            modal.onclick = (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            };
        }

        modal.style.display = 'flex';
        document.getElementById('tw-trend-title').textContent = `${playerName} - ${metricLabel} Intel`;

        const playerHistory = (gistHistory[playerName] && gistHistory[playerName][metricKey]) ? gistHistory[playerName][metricKey] : [];
        const fullSortedHistory = getValidHistory(playerHistory).sort((a, b) => a.t - b.t);

        function renderChartForDays(daysLimit) {
            const now = Date.now();
            const minTime = daysLimit === 90 ? 0 : now - (daysLimit * ONE_DAY_MS);
            const filteredHistory = fullSortedHistory.filter(r => r.t >= minTime);

            const chartData = filteredHistory.map(r => ({ x: r.t, y: r.v }));

            if (chartData.length === 0 || chartData[chartData.length - 1].x < now) {
                chartData.push({ x: now, y: currentValue });
            }

            if (activeChart) {
                activeChart.destroy();
            }

            const minX = chartData.length > 0 ? chartData[0].x : undefined;
            const maxX = chartData.length > 0 ? chartData[chartData.length - 1].x : undefined;

            const ctx = document.getElementById('tw-trend-canvas').getContext('2d');
            activeChart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: metricLabel,
                        data: chartData.length > 0 ? chartData : [{ x: Date.now(), y: 0 }],
                        borderColor: '#165eb9',
                        backgroundColor: 'rgba(22, 94, 185, 0.15)',
                        borderWidth: 2.5,
                        fill: true,
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#165eb9',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: 'nearest',
                        axis: 'x',
                        intersect: false
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                title: function(context) {
                                    if (!context || !context.length) return '';
                                    const timestamp = context[0].parsed.x;
                                    if (!timestamp) return '';
                                    const d = new Date(timestamp);
                                    const timeMode = GM_getValue(TIMEZONE_FORMAT_KEY, 'utc');
                                    if (timeMode === 'utc') {
                                        const month = d.getUTCMonth() + 1;
                                        const day = d.getUTCDate();
                                        const year = d.getUTCFullYear();
                                        const hours = d.getUTCHours().toString().padStart(2, '0');
                                        const mins = d.getUTCMinutes().toString().padStart(2, '0');
                                        return `${month}/${day}/${year} ${hours}:${mins} (UTC)`;
                                    } else {
                                        const month = d.getMonth() + 1;
                                        const day = d.getDate();
                                        const year = d.getFullYear();
                                        const hours = d.getHours().toString().padStart(2, '0');
                                        const mins = d.getMinutes().toString().padStart(2, '0');
                                        return `${month}/${day}/${year} ${hours}:${mins} (Local)`;
                                    }
                                },
                                label: function(context) {
                                    return `${metricLabel}: ${formatCompact(context.parsed.y)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'linear',
                            bounds: 'data',
                            min: minX,
                            max: maxX,
                            ticks: {
                                font: { size: 11 },
                                color: '#6a5a48',
                                maxTicksLimit: 7,
                                callback: function(val) {
                                    const d = new Date(val);
                                    const timeMode = GM_getValue(TIMEZONE_FORMAT_KEY, 'utc');
                                    if (timeMode === 'utc') {
                                        const month = d.getUTCMonth() + 1;
                                        const day = d.getUTCDate();
                                        const hours = d.getUTCHours().toString().padStart(2, '0');
                                        const mins = d.getUTCMinutes().toString().padStart(2, '0');
                                        return `${month}/${day} ${hours}:${mins}`;
                                    } else {
                                        const month = d.getMonth() + 1;
                                        const day = d.getDate();
                                        const hours = d.getHours().toString().padStart(2, '0');
                                        const mins = d.getMinutes().toString().padStart(2, '0');
                                        return `${month}/${day} ${hours}:${mins}`;
                                    }
                                }
                            },
                            grid: { color: 'rgba(16,16,16,0.08)' }
                        },
                        y: {
                            ticks: {
                                font: { size: 11 },
                                color: '#6a5a48',
                                callback: function(val) { return formatCompact(val); }
                            },
                            grid: { color: 'rgba(16,16,16,0.08)' }
                        }
                    }
                }
            });
        }

        const rangeBtns = document.querySelectorAll('#tw-chart-range-btns button');
        rangeBtns.forEach(btn => {
            btn.onclick = () => {
                rangeBtns.forEach(b => b.style.background = '#6a5a48');
                btn.style.background = '#165eb9';
                renderChartForDays(parseInt(btn.getAttribute('data-days'), 10));
            };
        });

        renderChartForDays(3);

        const intel = getTravianStrategicIntel(playerName, currentValue, metricKey);
        const intelContainer = document.getElementById('tw-strat-intel');
        intelContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #6a5a48;">Travian Strategy Profile</span>
                <span style="font-size: 12px; font-weight: 600; background: ${intel.statusBg}; color: ${intel.statusColor}; padding: 3px 10px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15);">${intel.archetype}</span>
            </div>
            <div style="font-size: 13px; line-height: 1.5; color: #101010; margin-bottom: 10px;">
                <strong>Tactical Assessment:</strong> ${intel.tactic}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; background: rgba(0,0,0,0.04); padding: 10px; border-radius: 3px; color: #334155;">
                <div>• <strong>24h Pop Growth:</strong> ${formatCompact(intel.popGain24h, true)} pop</div>
                <div>• <strong>24h PvP Attack (Kills):</strong> ${formatCompact(intel.pvpGain24h, true)} pts</div>
                <div>• <strong>24h PvP Defense (Lost):</strong> ${formatCompact(intel.defGain24h, true)} pts</div>
                <div>• <strong>24h Loot Yield:</strong> ${formatCompact(intel.lootGain24h, true)} res</div>
                <div style="grid-column: span 2; font-weight: 600;">• <strong>7d Projection:</strong> ~${formatCompact(Math.round(intel.proj7d))} ${intel.unit}</div>
            </div>
        `;
    }

    function injectConfigButton() {
        const existingBtn = document.getElementById('tw-gist-config-btn');
        const isInjectable = canInjectPercentages();

        if (!isInjectable) {
            if (existingBtn) existingBtn.remove();
            return;
        }

        if (existingBtn) return;

        const backBtn = document.querySelector('.lucide-arrow-left')?.closest('button');
        if (!backBtn) return;

        const cfgBtn = document.createElement('button');
        cfgBtn.id = 'tw-gist-config-btn';
        cfgBtn.type = 'button';
        cfgBtn.className = backBtn.className;
        cfgBtn.title = 'Configure Gist Sync';
        cfgBtn.style.marginRight = '6px';
        cfgBtn.innerHTML = `<span><span class="sr-only">Gist Config</span><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings size-5"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"></path><circle cx="12" cy="12" r="3"></circle></svg></span>`;

        cfgBtn.onclick = openGistModal;
        backBtn.parentNode.insertBefore(cfgBtn, backBtn);
    }

    function openGistModal() {
        let modal = document.getElementById('tw-gist-modal');
        if (modal) {
            modal.style.display = 'flex';
            return;
        }

        modal = document.createElement('div');
        modal.id = 'tw-gist-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.6); display: flex;
            align-items: center; justify-content: center;
            font-family: var(--font-sans, sans-serif);
        `;

        const currentGistId = GM_getValue(GIST_ID_KEY, '');
        const currentFormat = GM_getValue(NUMBER_FORMAT_KEY, 'raw');
        const currentSpeed = GM_getValue(SERVER_SPEED_KEY, 3);
        const currentTimeFormat = GM_getValue(TIMEZONE_FORMAT_KEY, 'utc');
        const currentRecordInterval = parseFloat(GM_getValue(RECORD_INTERVAL_KEY, 1));

        let statusText = '⚪ Not Configured';
        let statusStyle = 'color: #64748b; background: #f1f5f9; border: 1px solid #cbd5e1;';

        if (gistStatus === 'connected') {
            statusText = '🟢 Connected';
            statusStyle = 'color: #15803d; background: #dcfce7; border: 1px solid #86efac;';
        } else if (gistStatus === 'error') {
            statusText = '🔴 Disconnected';
            statusStyle = 'color: #dc2626; background: #fee2e2; border: 1px solid #fca5a5;';
        }

        modal.innerHTML = `
            <div style="background: #ece8d6; border: 2px solid #101010; padding: 18px; width: 340px; border-radius: 4px; color: #101010; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <h3 style="font-weight: 600; text-transform: uppercase; font-size: 14px; color: #6a5a48; margin: 0;">Gist Sync Settings</h3>
                    <span id="tw-gist-conn-badge" style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; ${statusStyle}">${statusText}</span>
                </div>
                <div style="margin-bottom: 10px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                        <label style="font-size: 11px; font-weight: 600; color: #6a5a48; text-transform: uppercase;">Gist ID</label>
                        <a id="tw-open-gist-link" href="https://gist.github.com/${currentGistId}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; font-weight: 600; color: #165eb9; text-decoration: underline; ${currentGistId ? '' : 'display: none;'}">Open Gist ↗</a>
                    </div>
                    <input type="text" id="tw-input-gist-id" value="${currentGistId}" placeholder="e.g. 872976f2aa4ecec..." style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;" />
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase;">GitHub Token (ghp_...)</label>
                    <input type="password" id="tw-input-gist-token" value="${GM_getValue(GIST_TOKEN_KEY, '')}" placeholder="ghp_YOUR_TOKEN" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;" />
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase;">Record Interval</label>
                    <select id="tw-select-record-interval" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;">
                        <option value="0.5" ${currentRecordInterval === 0.5 ? 'selected' : ''}>Every 30 minutes</option>
                        <option value="1" ${currentRecordInterval === 1 ? 'selected' : ''}>Every 1 hour (Default)</option>
                        <option value="3" ${currentRecordInterval === 3 ? 'selected' : ''}>Every 3 hours</option>
                        <option value="6" ${currentRecordInterval === 6 ? 'selected' : ''}>Every 6 hours</option>
                        <option value="12" ${currentRecordInterval === 12 ? 'selected' : ''}>Every 12 hours</option>
                        <option value="24" ${currentRecordInterval === 24 ? 'selected' : ''}>Every 24 hours</option>
                    </select>
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase;">Server Speed</label>
                    <select id="tw-select-server-speed" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;">
                        <option value="1" ${parseFloat(currentSpeed) === 1 ? 'selected' : ''}>1x</option>
                        <option value="2" ${parseFloat(currentSpeed) === 2 ? 'selected' : ''}>2x</option>
                        <option value="3" ${parseFloat(currentSpeed) === 3 ? 'selected' : ''}>3x (Default)</option>
                        <option value="4" ${parseFloat(currentSpeed) === 4 ? 'selected' : ''}>4x</option>
                        <option value="5" ${parseFloat(currentSpeed) === 5 ? 'selected' : ''}>5x</option>
                        <option value="10" ${parseFloat(currentSpeed) === 10 ? 'selected' : ''}>10x</option>
                    </select>
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase;">Time Display</label>
                    <select id="tw-select-time-format" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;">
                        <option value="utc" ${currentTimeFormat === 'utc' ? 'selected' : ''}>UTC Time</option>
                        <option value="local" ${currentTimeFormat === 'local' ? 'selected' : ''}>Local Time</option>
                    </select>
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; font-weight: 600; display: block; color: #6a5a48; text-transform: uppercase;">Number Formatting</label>
                    <select id="tw-select-num-format" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;">
                        <option value="raw" ${currentFormat === 'raw' ? 'selected' : ''}>Raw (1,234,567)</option>
                        <option value="compact" ${currentFormat === 'compact' ? 'selected' : ''}>Compact (1.2M / 1.2k)</option>
                    </select>
                </div>
                <div id="tw-gist-status" style="font-size: 11px; margin-bottom: 12px; color: #165eb9; font-weight: 600;"></div>
                <div style="display: flex; gap: 8px; justify-content: space-between;">
                    <button type="button" id="tw-btn-reset-modal" style="background: #dc2626; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px;">Reset History</button>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" id="tw-btn-close-modal" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px;">Close</button>
                        <button type="button" id="tw-btn-save-modal" style="background: #165eb9; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 3px;">Save & Sync</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const gistInput = document.getElementById('tw-input-gist-id');
        const openLink = document.getElementById('tw-open-gist-link');
        if (gistInput && openLink) {
            gistInput.addEventListener('input', () => {
                const val = gistInput.value.trim();
                if (val) {
                    openLink.href = `https://gist.github.com/${val}`;
                    openLink.style.display = 'inline';
                } else {
                    openLink.style.display = 'none';
                }
            });
        }

        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        };

        document.getElementById('tw-btn-close-modal').onclick = () => {
            modal.style.display = 'none';
        };

        document.getElementById('tw-btn-reset-modal').onclick = () => {
            if (confirm('Are you sure you want to clear all recorded player history? Your Gist ID and Token will be kept.')) {
                const cfg = gistHistory.__config__;
                gistHistory = {};
                if (cfg) gistHistory.__config__ = cfg;
                else embedSettingsInGistHistory();
                saveLocalHistory();

                document.querySelectorAll('.tw-growth-badge').forEach(b => b.remove());

                const statusEl = document.getElementById('tw-gist-status');
                statusEl.textContent = 'History reset. Syncing to Gist...';

                pushToGistDebounced();
            }
        };

        document.getElementById('tw-btn-save-modal').onclick = () => {
            const gistId = document.getElementById('tw-input-gist-id').value.trim();
            const token = document.getElementById('tw-input-gist-token').value.trim();
            const numFormat = document.getElementById('tw-select-num-format').value;
            const serverSpeed = parseFloat(document.getElementById('tw-select-server-speed').value) || 3;
            const timeFormat = document.getElementById('tw-select-time-format').value;
            const recordInterval = parseFloat(document.getElementById('tw-select-record-interval').value) || 1;
            const statusEl = document.getElementById('tw-gist-status');

            GM_setValue(GIST_ID_KEY, gistId);
            GM_setValue(GIST_TOKEN_KEY, token);
            GM_setValue(NUMBER_FORMAT_KEY, numFormat);
            GM_setValue(SERVER_SPEED_KEY, serverSpeed);
            GM_setValue(TIMEZONE_FORMAT_KEY, timeFormat);
            GM_setValue(RECORD_INTERVAL_KEY, recordInterval);

            embedSettingsInGistHistory();
            saveLocalHistory();

            statusEl.textContent = 'Pulling remote data...';
            pullFromGist((success, err) => {
                const connBadge = document.getElementById('tw-gist-conn-badge');
                if (success) {
                    embedSettingsInGistHistory();
                    pushToGistDebounced();
                    statusEl.textContent = 'Synced successfully!';
                    if (connBadge) {
                        connBadge.textContent = '🟢 Connected';
                        connBadge.style.cssText = 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; color: #15803d; background: #dcfce7; border: 1px solid #86efac;';
                    }
                    processTable();
                    setTimeout(() => { modal.style.display = 'none'; }, 1000);
                } else {
                    statusEl.textContent = `Sync failed (${err || 'check credentials'})`;
                    if (connBadge) {
                        connBadge.textContent = '🔴 Disconnected';
                        connBadge.style.cssText = 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; color: #dc2626; background: #fee2e2; border: 1px solid #fca5a5;';
                    }
                }
            });
        };
    }

    pullFromGist();

    let timeout = null;
    const observer = new MutationObserver(() => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            injectConfigButton();
            processTable();
        }, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
        injectConfigButton();
        processTable();
    }, 300);
})();
