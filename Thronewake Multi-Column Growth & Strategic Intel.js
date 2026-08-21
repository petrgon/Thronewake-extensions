// ==UserScript==
// @name         Thronewake Multi-Column Growth & Strategic Intel
// @namespace    http://tampermonkey.net/
// @version      13.0
// @description  Tracks leaderboard columns individually, displays inline 3-day growth percentages with 24h momentum, configurable number formatting (Raw vs Compact), 90-day Gist history, and Travian strategy modal.
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
    const GIST_FILENAME = 'thronewake_leaderboard_history.json';
    
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;       // Window for inline % badge
    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;     // Full server season retention (90 days)

    let gistHistory = {};
    let isGistLoaded = false;
    let syncTimeout = null;
    let activeChart = null;

    // --- Dynamic Number Formatting Helper (Raw vs Compact) ---

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

    // --- Gist Storage Operations ---

    function pullFromGist(callback) {
        const gistId = GM_getValue(GIST_ID_KEY, '');
        const token = GM_getValue(GIST_TOKEN_KEY, '');

        if (!gistId || !token) {
            if (callback) callback(false, 'Enter Gist ID & Token first');
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
                                            isGistLoaded = true;
                                            if (callback) callback(true);
                                            processTable();
                                        } else if (callback) {
                                            callback(false, 'Raw Stream Failed');
                                        }
                                    }
                                });
                                return;
                            }

                            gistHistory = JSON.parse(fileObj.content);
                            isGistLoaded = true;
                            if (callback) callback(true);
                            processTable();
                        } else {
                            gistHistory = {};
                            isGistLoaded = true;
                            if (callback) callback(true);
                        }
                    } catch (e) {
                        console.error('Error parsing Gist JSON', e);
                        if (callback) callback(false, 'Invalid JSON in Gist');
                    }
                } else if (response.status === 401) {
                    if (callback) callback(false, '401 Unauthorized (Bad Token)');
                } else if (response.status === 404) {
                    if (callback) callback(false, '404 Gist ID Not Found');
                } else {
                    if (callback) callback(false, `HTTP Error ${response.status}`);
                }
            },
            onerror: function () {
                if (callback) callback(false, 'Network Error / Blocked');
            },
            ontimeout: function () {
                if (callback) callback(false, 'Request Timed Out');
            }
        });
    }

    function pushToGistDebounced() {
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
                })
            });
        }, 2500);
    }

    // --- Growth & Momentum Calculations ---

    function getBaselineValue(records) {
        if (!records || records.length === 0) return null;

        const validRecords = records.filter(r => typeof r.v === 'number' && r.v < 1000000000);
        if (validRecords.length === 0) return null;

        const sorted = validRecords.sort((a, b) => a.t - b.t);
        const now = Date.now();
        const targetTime = now - THREE_DAYS_MS;

        if (sorted[0].t > targetTime) {
            return sorted[0].v;
        }

        let closest = sorted[0];
        let minDiff = Math.abs(closest.t - targetTime);

        for (let i = 1; i < sorted.length; i++) {
            const diff = Math.abs(sorted[i].t - targetTime);
            if (diff < minDiff) {
                minDiff = diff;
                closest = sorted[i];
            }
        }
        return closest.v;
    }

    function getGainOverHours(records, hours) {
        if (!records || records.length < 2) return 0;
        const valid = records.filter(r => typeof r.v === 'number' && r.v < 1000000000).sort((a, b) => a.t - b.t);
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

    function getMomentumInfo(records, currentValue) {
        if (!records || records.length < 2) {
            return { symbol: '', status: '➡️ Gathering history...', gain24h: 0, avgPriorDailyGain: 0 };
        }

        const valid = records.filter(r => typeof r.v === 'number' && r.v < 1000000000).sort((a, b) => a.t - b.t);
        if (valid.length < 2) {
            return { symbol: '', status: '➡️ Gathering history...', gain24h: 0, avgPriorDailyGain: 0 };
        }

        const now = Date.now();

        const target24 = now - ONE_DAY_MS;
        let rec24 = valid[0];
        let minDiff24 = Math.abs(rec24.t - target24);
        for (let i = 1; i < valid.length; i++) {
            let diff = Math.abs(valid[i].t - target24);
            if (diff < minDiff24) { minDiff24 = diff; rec24 = valid[i]; }
        }

        const target72 = now - THREE_DAYS_MS;
        let rec72 = valid[0];
        let minDiff72 = Math.abs(rec72.t - target72);
        for (let i = 1; i < valid.length; i++) {
            let diff = Math.abs(valid[i].t - target72);
            if (diff < minDiff72) { minDiff72 = diff; rec72 = valid[i]; }
        }

        const gain24h = Math.max(0, currentValue - rec24.v);
        const gainPrior2d = Math.max(0, rec24.v - rec72.v);
        const avgPriorDailyGain = gainPrior2d / 2;

        let symbol = '▶';
        let status = '➡️ Steady pace';

        if (gain24h === 0 && gainPrior2d > 0) {
            symbol = '⏸';
            status = '⏸️ Growth paused';
        } else if (gain24h > (avgPriorDailyGain * 1.25) && gain24h > 0) {
            symbol = '▲';
            status = '🚀 Accelerating';
        } else if (gain24h < (avgPriorDailyGain * 0.75) && avgPriorDailyGain > 0) {
            symbol = '▼';
            status = '📉 Slowing down';
        }

        return { symbol, status, gain24h, avgPriorDailyGain };
    }

    // Travian Strategic Assessment
    function getTravianStrategicIntel(playerName, currentValue, metricKey) {
        const pData = gistHistory[playerName] || {};
        const popHistory = pData['pop_population'] || [];
        const pvpAttHistory = pData['attack_pvp'] || [];
        const pvpDefHistory = pData['defense_pvp'] || [];
        const lootHistory = pData['loot'] || [];

        const popGain24h = getGainOverHours(popHistory, 24);
        const pvpGain24h = getGainOverHours(pvpAttHistory, 24);
        const defGain24h = getGainOverHours(pvpDefHistory, 24);
        const lootGain24h = getGainOverHours(lootHistory, 24);

        let archetype = "⚖️ Balanced Growth";
        let statusBg = "#e2e8f0";
        let statusColor = "#334155";
        let tactic = "Player maintains an even ratio of eco growth and army expansion. Standard scouting advised.";

        if (defGain24h > 100) {
            archetype = "💥 Decimated Defense (Heavy Losses)";
            statusBg = "#fce7f3";
            statusColor = "#9d174d";
            tactic = "Player suffered heavy troop casualties defending their village (defense points = lost own def-units). Defensive force is decimated—ideal target for immediate follow-up attack or chiefing!";
        } else if (pvpGain24h > 100 && defGain24h < 20) {
            archetype = "⚔️ Unpunished Attacker";
            statusBg = "#fee2e2";
            statusColor = "#b91c1c";
            tactic = "Kills many enemy troops on attacks without facing counter-attacks. Has a strong hammer—prepare defense stacks for wave attacks.";
        } else if (pvpGain24h > 50 && defGain24h > 50) {
            archetype = "🔥 Two-Way War";
            statusBg = "#ffedd5";
            statusColor = "#c2410c";
            tactic = "Heavy fighting on both sides—killing enemy units on offense while losing troops defending against incoming raids.";
        } else if (popGain24h > 40 && pvpGain24h < 20 && defGain24h < 20) {
            archetype = "🏰 Eco Rusher (Simmer)";
            statusBg = "#dcfce7";
            statusColor = "#15803d";
            tactic = "Upgrading fields/buildings for new villages. Zero defensive losses or attack kills—prime target for catapults or chiefing before wall completion.";
        } else if (popGain24h <= 5 && pvpGain24h > 100) {
            archetype = "⚔️ Hammer Builder";
            statusBg = "#fee2e2";
            statusColor = "#b91c1c";
            tactic = "Population growth stalled while offensive points surged. Barracks/Stables running non-stop. Request defense stacks or plan a preventive strike.";
        } else if (lootGain24h > 30000) {
            archetype = "🐎 Active Raider";
            statusBg = "#fef3c7";
            statusColor = "#b45309";
            tactic = "High daily loot yield. Expect fakes and raids. Keep stocks low, build crannies, or plan counter-raid traps on returning troops.";
        } else if (popGain24h === 0 && pvpGain24h === 0 && defGain24h === 0 && lootGain24h === 0) {
            archetype = "💤 Inactive / Potential Farm";
            statusBg = "#f1f5f9";
            statusColor = "#64748b";
            tactic = "Zero growth across all sectors over 24h. Send scouts to verify garrison and resource stocks.";
        }

        const proj7d = currentValue + (getGainOverHours(pData[metricKey] || [], 24) * 7);

        return { archetype, statusBg, statusColor, tactic, proj7d, popGain24h, pvpGain24h, defGain24h, lootGain24h };
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
        return parseInt(text.replace(/[^0-9]/g, ''), 10) || 0;
    }

    // --- Dynamic Column Mapping ---

    function getMetricsConfig(table) {
        const category = getActiveCategory();
        const headerThs = Array.from(table.querySelectorAll('thead th'));
        const config = [];

        headerThs.forEach((th, idx) => {
            const text = th.textContent.trim().toLowerCase();
            if (text.includes('village')) {
                config.push({ colIndex: idx + 1, key: 'pop_villages', label: 'Villages' });
            } else if (text.includes('population')) {
                config.push({ colIndex: idx + 1, key: 'pop_population', label: 'Population' });
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

    // --- DOM Inline Processing ---

    function processTable() {
        const table = document.querySelector('table');
        if (!table) return;

        if (isWeeklySelected()) {
            table.querySelectorAll('.tw-growth-badge').forEach(b => b.remove());
            return;
        }

        const isAlliancePage = window.location.pathname.includes('/alliance');
        const now = Date.now();

        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return;

        const metricsConfig = getMetricsConfig(table);
        let hasNewData = false;

        rows.forEach(row => {
            const tds = Array.from(row.querySelectorAll('td'));
            const playerLink = row.querySelector('a[href*="/player/"]');
            if (!playerLink) return;

            const playerName = playerLink.textContent.trim();
            if (!gistHistory[playerName]) gistHistory[playerName] = {};

            metricsConfig.forEach(m => {
                const targetTd = tds[m.colIndex - 1];
                if (!targetTd) return;

                const cleanTd = targetTd.cloneNode(true);
                cleanTd.querySelectorAll('.tw-growth-badge').forEach(b => b.remove());
                const currentValue = parseValue(cleanTd.textContent);

                if (currentValue > 1000000000) return;

                if (!gistHistory[playerName][m.key]) gistHistory[playerName][m.key] = [];
                let catHistory = gistHistory[playerName][m.key];

                catHistory = catHistory.filter(r => typeof r.v === 'number' && r.v < 1000000000);
                gistHistory[playerName][m.key] = catHistory;

                const lastRec = catHistory[catHistory.length - 1];

                if (!isAlliancePage) {
                    if (!lastRec || lastRec.v !== currentValue || (now - lastRec.t) > 21600000) {
                        catHistory.push({ t: now, v: currentValue });
                        gistHistory[playerName][m.key] = catHistory.filter(r => (now - r.t) <= NINETY_DAYS_MS);
                        hasNewData = true;
                    }
                }

                const baseline = getBaselineValue(catHistory);
                let growthText = '0.00%';
                let colorStyle = 'color: rgba(16,16,16,0.5);';

                if (baseline !== null && baseline > 0) {
                    const diff = currentValue - baseline;
                    const percent = ((diff / baseline) * 100).toFixed(2);

                    if (diff > 0) {
                        growthText = `+${percent}%`;
                        colorStyle = 'color: #15803d; font-weight: 700;';
                    } else if (diff < 0) {
                        growthText = `${percent}%`;
                        colorStyle = 'color: #dc2626; font-weight: 700;';
                    }
                }

                const momentum = getMomentumInfo(catHistory, currentValue);
                const momentumSymbol = momentum.symbol ? ` ${momentum.symbol}` : '';
                
                const gain3d = baseline !== null ? currentValue - baseline : 0;
                const gain3dFormatted = formatCompact(gain3d, true);

                const tooltipText = `${playerName} (${m.label}): ${growthText} over 3 days (${gain3dFormatted})\n${momentum.status} • Click for tactical analysis`;

                const container = targetTd.querySelector('div.flex') || targetTd;
                let badge = container.querySelector('.tw-growth-badge');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'tw-growth-badge';
                    container.appendChild(badge);
                }

                badge.style.cssText = `font-size: 12px; font-weight: 600; margin-left: 5px; cursor: pointer; text-decoration: underline; text-decoration-style: dotted; ${colorStyle}`;
                badge.textContent = `(${growthText}${momentumSymbol})`;
                badge.title = tooltipText;

                badge.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openTrendModal(playerName, m.key, m.label, currentValue);
                };
            });
        });

        if (hasNewData && isGistLoaded && !isAlliancePage) {
            pushToGistDebounced();
        }
    }

    // --- Trend Chart & Strategy Intel Modal ---

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
                        <h3 id="tw-trend-title" style="font-weight: 700; text-transform: uppercase; font-size: 15px; color: #6a5a48; margin: 0;">Trend Chart</h3>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div id="tw-chart-range-btns" style="display: flex; gap: 4px;">
                                <button type="button" data-days="3" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px;">3D</button>
                                <button type="button" data-days="7" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px;">7D</button>
                                <button type="button" data-days="30" style="background: #165eb9; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px;">30D</button>
                                <button type="button" data-days="90" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 3px 8px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 2px;">All</button>
                            </div>
                            <button type="button" id="tw-btn-close-chart" style="background: #165eb9; color: #fff; border: 1px solid #101010; width: 26px; height: 26px; border-radius: 50%; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;">✕</button>
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
        const fullSortedHistory = [...playerHistory].sort((a, b) => a.t - b.t);

        function renderChartForDays(daysLimit) {
            const now = Date.now();
            const minTime = daysLimit === 90 ? 0 : now - (daysLimit * ONE_DAY_MS);
            const filteredHistory = fullSortedHistory.filter(r => r.t >= minTime);

            const isMultiDay = (daysLimit > 3);
            const labels = filteredHistory.map(r => {
                const d = new Date(r.t);
                return isMultiDay
                    ? `${d.getMonth() + 1}/${d.getDate()}`
                    : `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
            });
            const values = filteredHistory.map(r => r.v);

            if (activeChart) {
                activeChart.destroy();
            }

            const ctx = document.getElementById('tw-trend-canvas').getContext('2d');
            activeChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels.length > 0 ? labels : ['No Data'],
                    datasets: [{
                        label: metricLabel,
                        data: values.length > 0 ? values : [0],
                        borderColor: '#165eb9',
                        backgroundColor: 'rgba(22, 94, 185, 0.15)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.2,
                        pointRadius: filteredHistory.length > 50 ? 2 : 4,
                        pointBackgroundColor: '#8a6e46'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `${metricLabel}: ${formatCompact(context.raw)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { font: { size: 11 }, color: '#6a5a48', maxTicksLimit: 10 }, grid: { color: 'rgba(16,16,16,0.08)' } },
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

        // Attach range button handlers
        const rangeBtns = document.querySelectorAll('#tw-chart-range-btns button');
        rangeBtns.forEach(btn => {
            btn.onclick = () => {
                rangeBtns.forEach(b => b.style.background = '#6a5a48');
                btn.style.background = '#165eb9';
                renderChartForDays(parseInt(btn.getAttribute('data-days'), 10));
            };
        });

        // Initial render: Default to 30 Days view
        renderChartForDays(30);

        // Inject Strategic Intel Panel
        const intel = getTravianStrategicIntel(playerName, currentValue, metricKey);
        const intelContainer = document.getElementById('tw-strat-intel');
        intelContainer.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <span style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #6a5a48;">Travian Strategy Profile</span>
                <span style="font-size: 12px; font-weight: 700; background: ${intel.statusBg}; color: ${intel.statusColor}; padding: 3px 10px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.15);">${intel.archetype}</span>
            </div>
            <div style="font-size: 13px; line-height: 1.5; color: #101010; margin-bottom: 10px;">
                <strong>Tactical Assessment:</strong> ${intel.tactic}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; background: rgba(0,0,0,0.04); padding: 10px; border-radius: 3px; color: #334155;">
                <div>• <strong>24h Pop Growth:</strong> ${formatCompact(intel.popGain24h, true)} pop</div>
                <div>• <strong>24h PvP Attack (Kills):</strong> ${formatCompact(intel.pvpGain24h, true)} pts</div>
                <div>• <strong>24h PvP Defense (Lost):</strong> ${formatCompact(intel.defGain24h, true)} pts</div>
                <div>• <strong>24h Loot Yield:</strong> ${formatCompact(intel.lootGain24h, true)} res</div>
                <div style="grid-column: span 2; font-weight: 600;">• <strong>7d Projection:</strong> ~${formatCompact(Math.round(intel.proj7d))} score</div>
            </div>
        `;
    }

    // --- Config Modal UI ---

    function injectConfigButton() {
        const backBtn = document.querySelector('.lucide-arrow-left')?.closest('button');
        if (!backBtn || document.getElementById('tw-gist-config-btn')) return;

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

        const currentFormat = GM_getValue(NUMBER_FORMAT_KEY, 'raw');

        modal.innerHTML = `
            <div style="background: #ece8d6; border: 2px solid #101010; padding: 18px; width: 340px; border-radius: 4px; color: #101010; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                <h3 style="font-weight: 700; margin-bottom: 12px; text-transform: uppercase; font-size: 14px; color: #6a5a48;">Gist Sync Settings</h3>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 700; display: block; color: #6a5a48; text-transform: uppercase;">Gist ID</label>
                    <input type="text" id="tw-input-gist-id" value="${GM_getValue(GIST_ID_KEY, '')}" placeholder="e.g. 872976f2aa4ecec..." style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;" />
                </div>
                <div style="margin-bottom: 10px;">
                    <label style="font-size: 11px; font-weight: 700; display: block; color: #6a5a48; text-transform: uppercase;">GitHub Token (ghp_...)</label>
                    <input type="password" id="tw-input-gist-token" value="${GM_getValue(GIST_TOKEN_KEY, '')}" placeholder="ghp_YOUR_TOKEN" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;" />
                </div>
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; font-weight: 700; display: block; color: #6a5a48; text-transform: uppercase;">Number Formatting</label>
                    <select id="tw-select-num-format" style="width: 100%; border: 1px solid #101010; background: #f8f4e6; padding: 6px; font-size: 12px; box-sizing: border-box; border-radius: 3px;">
                        <option value="raw" ${currentFormat === 'raw' ? 'selected' : ''}>Raw (1,234,567)</option>
                        <option value="compact" ${currentFormat === 'compact' ? 'selected' : ''}>Compact (1.2M / 1.2k)</option>
                    </select>
                </div>
                <div id="tw-gist-status" style="font-size: 11px; margin-bottom: 12px; color: #165eb9; font-weight: 600;"></div>
                <div style="display: flex; gap: 8px; justify-content: space-between;">
                    <button type="button" id="tw-btn-reset-modal" style="background: #dc2626; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px;">Reset History</button>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" id="tw-btn-close-modal" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px;">Close</button>
                        <button type="button" id="tw-btn-save-modal" style="background: #165eb9; color: #fff; border: 1px solid #101010; padding: 5px 12px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px;">Save & Sync</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

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
                gistHistory = {};

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
            const statusEl = document.getElementById('tw-gist-status');

            GM_setValue(GIST_ID_KEY, gistId);
            GM_setValue(GIST_TOKEN_KEY, token);
            GM_setValue(NUMBER_FORMAT_KEY, numFormat);

            statusEl.textContent = 'Pulling remote data...';
            pullFromGist((success, err) => {
                if (success) {
                    statusEl.textContent = 'Synced successfully!';
                    processTable();
                    setTimeout(() => { modal.style.display = 'none'; }, 1000);
                } else {
                    statusEl.textContent = `Sync failed (${err || 'check credentials'})`;
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
            const table = document.querySelector('table');
            if (table) {
                processTable();
            }
        }, 150);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
        injectConfigButton();
        processTable();
    }, 300);
})();
