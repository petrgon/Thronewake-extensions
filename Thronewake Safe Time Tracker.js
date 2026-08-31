// ==UserScript==
// @name         Thronewake Safe Time Tracker
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  Track and deduce target players' Safe Times from Rally Point troop arrival blocks
// @author       You
// @match        *://*.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// ==/UserScript==

(function () {
    'use strict';

    // --- Storage Keys ---
    const STORAGE_PLAYER_DATA = 'st_player_data';
    const STORAGE_TZ_MODE = 'st_tz_mode';
    const STORAGE_SETTINGS_OPEN = 'st_settings_open';
    const STORAGE_GH_TOKEN = 'st_gh_token';
    const STORAGE_GIST_ID = 'st_gist_id';

    // --- Timezone Conversion Utilities ---
    const getTzOffset = () => new Date().getTimezoneOffset();

    function parseTimeToMinutes(timeStr) {
        if (!timeStr || typeof timeStr !== 'string') return -1;
        const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})/);
        if (!match) return -1;
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) return -1;
        return (h * 60 + m) % 1440;
    }

    function minutesToHHMM(mins) {
        if (typeof mins !== 'number' || isNaN(mins) || mins < 0) return '--:--';
        const m = (mins + 1440) % 1440;
        const h = Math.floor(m / 60) % 24;
        const min = m % 60;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }

    function localMinsToUtc(localMins) {
        if (typeof localMins !== 'number' || isNaN(localMins) || localMins < 0) return -1;
        return (localMins + getTzOffset() + 1440) % 1440;
    }

    function utcMinsToLocal(utcMins) {
        if (typeof utcMins !== 'number' || isNaN(utcMins) || utcMins < 0) return -1;
        return (utcMins - getTzOffset() + 1440) % 1440;
    }

    function utcMinsToDisplay(utcMins) {
        if (typeof utcMins !== 'number' || isNaN(utcMins) || utcMins < 0) return '--:--';
        const displayMins = (timeZoneMode === 'local') ? utcMinsToLocal(utcMins) : utcMins;
        return minutesToHHMM(displayMins);
    }

    function cleanAllianceTag(tag) {
        if (!tag || typeof tag !== 'string') return '';
        return tag.replace(/\[/g, '').replace(/\]/g, '').trim();
    }

    // --- Dynamic URL Path Resolution ---
    function getCurrentMapPrefix() {
        if (window.location.pathname.includes('/map')) return '/map';
        if (document.querySelector('a[href*="/map/player/"], a[href*="/map/alliance/"]')) return '/map';
        return '';
    }

    // --- Data Normalization ---
    function normalizePlayerData(raw) {
        const result = {};
        if (!raw || typeof raw !== 'object') return result;

        for (const name in raw) {
            if (['tz', 'p', 'playerData', 'timeZoneMode'].includes(name)) continue;

            const entry = raw[name];
            let alliance = '';
            let blockedRaw = [];
            let availRaw = [];

            if (Array.isArray(entry)) {
                blockedRaw = entry;
            } else if (entry && typeof entry === 'object') {
                alliance = cleanAllianceTag(entry.alliance || entry.a || '');
                blockedRaw = entry.samples || entry.s || [];
                availRaw = entry.availableSamples || entry.v || [];
            }

            const parseItemToUtc = (item) => {
                if (typeof item === 'number' && !isNaN(item) && item >= 0 && item < 1440) return item;
                if (item && typeof item.localMinutes === 'number' && item.localMinutes >= 0) return localMinsToUtc(item.localMinutes);
                if (item && typeof item.arrivalTime === 'string') return localMinsToUtc(parseTimeToMinutes(item.arrivalTime));
                return null;
            };

            const s = Array.from(new Set(blockedRaw.map(parseItemToUtc).filter(x => typeof x === 'number' && x >= 0))).sort((a, b) => a - b);
            const v = Array.from(new Set(availRaw.map(parseItemToUtc).filter(x => typeof x === 'number' && x >= 0 && !s.includes(x)))).sort((a, b) => a - b);

            result[name] = { alliance, samples: s, availableSamples: v };
        }
        return result;
    }

    let playerData = normalizePlayerData(GM_getValue(STORAGE_PLAYER_DATA, {}));

    let timeZoneMode = GM_getValue(STORAGE_TZ_MODE, 'local');
    let isSettingsOpen = GM_getValue(STORAGE_SETTINGS_OPEN, false);
    let ghToken = String(GM_getValue(STORAGE_GH_TOKEN, '')).trim();
    let gistId = String(GM_getValue(STORAGE_GIST_ID, '')).trim();
    let gistStatus = 'disconnected';

    // --- CSS Styles ---
    const styles = `
        @keyframes st-pulse-flicker {
            0% { filter: brightness(1); }
            50% { filter: brightness(1.8) drop-shadow(0 0 8px #165eb9); }
            100% { filter: brightness(1); }
        }
        .st-flicker { animation: st-pulse-flicker 0.8s ease-in-out infinite alternate; }

        /* Header Mounted Tool Menu Styles */
        .st-header-tools-wrapper {
            position: relative;
            display: inline-flex;
            align-items: center;
            margin-left: 6px;
            pointer-events: auto;
            z-index: 100;
        }

        .st-header-btn {
            background: #6a5a48;
            color: #ffffff;
            border: 1px solid #101010;
            border-radius: 4px;
            padding: 4px 8px;
            font-family: var(--font-sans, sans-serif);
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
            cursor: pointer;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
            user-select: none;
            transition: background 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            line-height: 1.2;
        }
        .st-header-btn:hover { background: #165eb9; }

        .st-dropdown-box {
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 4px;
            background: #ece8d6;
            border: 2px solid #101010;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            display: flex;
            flex-direction: column;
            min-width: 120px;
            z-index: 999999;
            overflow: hidden;
        }
        .st-dropdown-box.hidden { display: none !important; }

        .st-dropdown-item, #tw-graph-btn {
            background: transparent !important;
            border: none !important;
            border-bottom: 1px solid #dcd3c6 !important;
            padding: 8px 12px !important;
            text-align: left !important;
            font-family: var(--font-sans, sans-serif) !important;
            font-size: 11px !important;
            font-weight: 600 !important;
            text-transform: uppercase !important;
            color: #101010 !important;
            cursor: pointer !important;
            width: 100% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            box-sizing: border-box !important;
            transition: background 0.15s, color 0.15s !important;
            margin: 0 !important;
            outline: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            height: auto !important;
            line-height: 1.2 !important;
        }
        .st-dropdown-item:last-child, #tw-graph-btn:last-child {
            border-bottom: none !important;
        }
        .st-dropdown-item:hover, #tw-graph-btn:hover {
            background: #165eb9 !important;
            color: #ffffff !important;
        }

        .st-backdrop {
            position: fixed;
            inset: 0px;
            z-index: 999999;
            background: transparent;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: var(--font-sans, sans-serif);
            pointer-events: none;
        }

        .st-modal-container {
            position: relative;
            background: #ece8d6;
            border: 2px solid #101010;
            padding: 16px;
            width: 580px;
            min-width: 280px;
            min-height: 250px;
            max-width: 95vw;
            max-height: 90vh;
            border-radius: 4px;
            color: #101010;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-sizing: border-box;
            resize: both;
            pointer-events: auto;
        }

        .st-header-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            border-bottom: 1px solid #dcd3c6;
            padding-bottom: 6px;
            cursor: move;
            touch-action: none;
            user-select: none;
        }

        .st-header-title {
            font-size: 14px;
            font-weight: normal;
            text-transform: uppercase;
            color: #6a5a48;
            margin: 0;
        }

        .st-close-btn {
            background: #165eb9;
            color: #ffffff;
            border: 1px solid #101010;
            width: 26px;
            height: 26px;
            border-radius: 50%;
            font-size: 13px;
            font-weight: normal;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            line-height: 1;
            margin-left: 12px;
            transition: background 0.2s;
            flex-shrink: 0;
        }
        .st-close-btn:hover { background: #0f4487; }

        .st-badge {
            font-size: 11px;
            font-weight: normal;
            padding: 2px 8px;
            border-radius: 12px;
            display: inline-flex;
            align-items: center;
        }
        .st-badge-connected { color: #15803d; background: #dcfce7; border: 1px solid #15803d; }
        .st-badge-syncing { color: #b45309; background: #fef3c7; border: 1px solid #b45309; }
        .st-badge-error { color: #b91c1c; background: #fee2e2; border: 1px solid #b91c1c; }
        .st-badge-disconnected { color: #6a5a48; background: #e2e8f0; border: 1px solid #6a5a48; }

        .st-body-scroll {
            overflow-y: auto;
            flex-grow: 1;
            padding-right: 4px;
        }

        .st-card-box {
            background: #f8f4e6;
            border: 1px solid #6a5a48;
            border-radius: 4px;
            padding: 10px 12px;
            margin-bottom: 8px;
        }

        details.st-card-box summary {
            outline: none;
            list-style: none;
            cursor: pointer;
            user-select: none;
        }
        details.st-card-box summary::-webkit-details-marker { display: none; }

        details.st-player-card-item:not([open]) .st-del-player {
            display: none !important;
        }

        .st-label-title {
            font-size: 11px;
            font-weight: normal;
            color: #6a5a48;
            text-transform: uppercase;
            display: block;
            margin-bottom: 4px;
        }

        .st-field-input {
            width: 100%;
            border: 1px solid #101010;
            background: #f8f4e6;
            padding: 6px;
            font-size: 12px;
            font-weight: normal;
            box-sizing: border-box;
            border-radius: 3px;
            color: #101010;
        }

        .st-btn-blue {
            background: #165eb9;
            color: #ffffff;
            border: 1px solid #101010;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: normal;
            cursor: pointer;
            border-radius: 3px;
            text-transform: uppercase;
            transition: background 0.2s;
        }
        .st-btn-blue:hover { background: #0f4487; }

        .st-btn-red {
            background: #991b1b;
            color: #ffffff;
            border: 1px solid #101010;
            padding: 5px 12px;
            font-size: 12px;
            font-weight: normal;
            cursor: pointer;
            border-radius: 3px;
            text-transform: uppercase;
            transition: background 0.2s;
        }
        .st-btn-red:hover { background: #7f1d1d; }

        .st-link {
            font-size: 11px;
            font-weight: normal;
            color: #165eb9;
            text-decoration: underline;
        }

        .st-player-name {
            color: #165eb9;
            font-size: 13px;
            font-weight: normal;
            text-decoration: underline;
        }
        .st-player-name:hover { color: #0f4487; }

        .st-alliance-tag {
            color: #6a5a48;
            font-size: 11px;
            font-weight: normal;
            margin-left: 2px;
            text-decoration: underline;
        }
        .st-alliance-tag:hover { color: #101010; }

        .st-sample-tag {
            display: inline-block;
            background: rgba(0,0,0,0.04);
            border: 1px solid rgba(16,16,16,0.2);
            color: #334155;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: normal;
            margin: 2px 4px 2px 0;
        }

        .st-avail-tag {
            display: inline-block;
            background: rgba(22, 163, 74, 0.1);
            border: 1px solid rgba(22, 163, 74, 0.3);
            color: #15803d;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: normal;
            margin: 2px 4px 2px 0;
        }

        .st-deduced-box {
            background: #e2e8f0;
            border: 1px solid rgba(0,0,0,0.15);
            color: #334155;
            padding: 2px 6px;
            border-radius: 3px;
            display: inline-block;
            font-size: 11px;
            font-weight: normal;
        }

        .st-empty {
            color: #6a5a48;
            font-style: italic;
            font-size: 12px;
        }
    `;

    if (typeof GM_addStyle !== 'undefined') {
        GM_addStyle(styles);
    } else {
        const styleNode = document.createElement('style');
        styleNode.textContent = styles;
        document.head.appendChild(styleNode);
    }

    // --- Gist Sync Logic ---
    function updateGistIndicator(status, message = '') {
        gistStatus = status;
        const el = document.getElementById('st-gist-indicator');
        if (!el) return;

        if (status === 'connected') {
            el.className = 'st-badge st-badge-connected';
            el.textContent = 'Connected';
        } else if (status === 'syncing') {
            el.className = 'st-badge st-badge-syncing';
            el.textContent = 'Syncing...';
        } else if (status === 'error') {
            el.className = 'st-badge st-badge-error';
            el.textContent = `${message || 'Sync Error'}`;
        } else {
            el.className = 'st-badge st-badge-disconnected';
            el.textContent = 'Disconnected';
        }
    }

    function prepareCompactGistData() {
        const compactPlayers = {};
        for (const name in playerData) {
            compactPlayers[name] = {
                a: playerData[name].alliance || '',
                s: playerData[name].samples || [],
                v: playerData[name].availableSamples || []
            };
        }
        return {
            tz: timeZoneMode,
            p: compactPlayers
        };
    }

    function pullFromGist(callback) {
        const token = ghToken.trim();
        const id = gistId.trim();

        if (!token || !id) {
            updateGistIndicator('disconnected');
            if (callback) callback(false);
            return;
        }

        const authHeader = token.startsWith('ghp_') || token.startsWith('github_pat_') ? `token ${token}` : `Bearer ${token}`;

        updateGistIndicator('syncing');
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://api.github.com/gists/${id}`,
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'Thronewake-SafeTime-Tracker'
            },
            onload: function (res) {
                if (res.status === 200) {
                    try {
                        const data = JSON.parse(res.responseText);
                        const file = data.files['thronewake_safetime.json'] || data.files['embermark_safetime.json'];
                        if (file && file.content) {
                            const parsed = JSON.parse(file.content);

                            const tz = parsed.tz || parsed.timeZoneMode;
                            if (tz) { timeZoneMode = tz; GM_setValue(STORAGE_TZ_MODE, timeZoneMode); }

                            let rawPlayers = parsed.p || parsed.playerData;
                            if (!rawPlayers && typeof parsed === 'object') {
                                rawPlayers = parsed;
                            }

                            if (rawPlayers) {
                                playerData = normalizePlayerData(rawPlayers);
                                GM_setValue(STORAGE_PLAYER_DATA, playerData);
                            }

                            updateGistIndicator('connected');
                            updateModalContent();
                            if (callback) callback(true);
                            return;
                        } else {
                            updateGistIndicator('connected');
                            pushToGist(true);
                            if (callback) callback(true);
                            return;
                        }
                    } catch (e) {
                        updateGistIndicator('error', 'Invalid Gist JSON');
                        if (callback) callback(false);
                        return;
                    }
                }
                const errMsg = res.status === 401 ? '401 Bad Token' : (res.status === 404 ? '404 Bad Gist ID' : `Error ${res.status}`);
                updateGistIndicator('error', errMsg);
                if (callback) callback(false);
            },
            onerror: function () {
                updateGistIndicator('error', 'Network Error');
                if (callback) callback(false);
            }
        });
    }

    let pushDebounceTimer = null;
    function pushToGist(immediate = false) {
        const token = ghToken.trim();
        const id = gistId.trim();

        if (!token || !id) return;

        clearTimeout(pushDebounceTimer);

        const executePush = () => {
            updateGistIndicator('syncing');
            const contentData = prepareCompactGistData();
            const authHeader = token.startsWith('ghp_') || token.startsWith('github_pat_') ? `token ${token}` : `Bearer ${token}`;

            GM_xmlhttpRequest({
                method: 'PATCH',
                url: `https://api.github.com/gists/${id}`,
                headers: {
                    'Authorization': authHeader,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Thronewake-SafeTime-Tracker'
                },
                data: JSON.stringify({ files: { 'thronewake_safetime.json': { content: JSON.stringify(contentData) } } }),
                onload: function (res) {
                    if (res.status === 200) {
                        updateGistIndicator('connected');
                    } else {
                        const errMsg = res.status === 403 ? '403 Not Gist Owner' : (res.status === 401 ? '401 Bad Token' : (res.status === 404 ? '404 Bad Gist ID' : `Push Error ${res.status}`));
                        updateGistIndicator('error', errMsg);
                    }
                },
                onerror: function () { updateGistIndicator('error', 'Network Error'); }
            });
        };

        if (immediate) {
            executePush();
        } else {
            pushDebounceTimer = setTimeout(executePush, 800);
        }
    }

    pullFromGist();

    // --- Math & Safe Time Deduction ---
    function calculateSpannedInterval(utcMinsList, availableUtcMinsList = []) {
        const validBlocked = (Array.isArray(utcMinsList) ? utcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);
        if (validBlocked.length === 0) return 'No blocked data';

        const uniqueBlocked = Array.from(new Set(validBlocked)).sort((a, b) => a - b);
        const n = uniqueBlocked.length;

        let bStart, bEnd;
        if (n === 1) {
            bStart = uniqueBlocked[0];
            bEnd = uniqueBlocked[0];
        } else {
            let maxGap = -1;
            let gapStartIndex = -1;

            for (let i = 0; i < n; i++) {
                const current = uniqueBlocked[i];
                const next = (i === n - 1) ? uniqueBlocked[0] + 1440 : uniqueBlocked[i + 1];
                const gap = next - current;

                if (gap > maxGap) {
                    maxGap = gap;
                    gapStartIndex = i;
                }
            }

            bStart = uniqueBlocked[(gapStartIndex + 1) % n];
            bEnd = uniqueBlocked[gapStartIndex];
        }

        const span_len = (bEnd - bStart + 1440) % 1440;
        const base = bEnd - 360;
        let max_x = (bStart - base + 1440) % 1440;
        let min_x = 0;

        const validAvail = (Array.isArray(availableUtcMinsList) ? availableUtcMinsList : [])
            .filter(m => typeof m === 'number' && !isNaN(m) && m >= 0)
            .filter(m => !uniqueBlocked.includes(m));

        if (validAvail.length > 0) {
            let possible_x = [];
            const min_duration = Math.max(240, span_len);

            for (let x = 0; x <= max_x; x++) {
                const sStart = (base + x + 1440) % 1440;
                const req_d = Math.max(min_duration, (bEnd - sStart + 1440) % 1440);
                if (req_d > 360) continue;

                let has_conflict = false;
                for (const a of validAvail) {
                    const diff = (a - sStart + 1440) % 1440;
                    if (diff <= req_d) {
                        has_conflict = true;
                        break;
                    }
                }
                if (!has_conflict) possible_x.push(x);
            }
            if (possible_x.length > 0) {
                min_x = possible_x[0];
                max_x = possible_x[possible_x.length - 1];
            }
        }

        const earliestStart = (base + min_x + 1440) % 1440;
        const latestStart = (base + max_x + 1440) % 1440;
        const latestEnd = (latestStart + 360) % 1440;

        if (n === 1 && validAvail.length === 0) {
            const single = uniqueBlocked[0];
            return `Sample: ${utcMinsToDisplay(single)} (Bounds: ${utcMinsToDisplay(single - 360)} to ${utcMinsToDisplay(single + 360)})`;
        }

        return `${utcMinsToDisplay(bStart)} - ${utcMinsToDisplay(bEnd)} | Bounds: ${utcMinsToDisplay(earliestStart)} to ${utcMinsToDisplay(latestEnd)}`;
    }

    function groupSamplesIntoIntervals(utcMinsList, cssClass = 'st-sample-tag', gapThreshold = 360, availableUtcMinsList = []) {
        const validBlocked = (Array.isArray(utcMinsList) ? utcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);
        if (validBlocked.length === 0) return [];

        const validAvail = (Array.isArray(availableUtcMinsList) ? availableUtcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);
        const sorted = Array.from(new Set(validBlocked)).sort((a, b) => a - b);
        let intervals = [];
        let start = sorted[0];
        let prev = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
            const curr = sorted[i];
            const gap = curr - prev;

            const hasUnblockedBetween = validAvail.some(a => a > prev && a < curr);

            if (gap <= 240 || (gap <= gapThreshold && !hasUnblockedBetween)) {
                prev = curr;
            } else {
                intervals.push({ start, end: prev });
                start = curr;
                prev = curr;
            }
        }
        intervals.push({ start, end: prev });

        // Circular wrap-around check across midnight (1440 -> 0)
        if (intervals.length > 1) {
            const first = intervals[0];
            const last = intervals[intervals.length - 1];
            const midnightGap = (1440 - last.end) + first.start;
            const hasUnblockedInMidnight = validAvail.some(a => a > last.end || a < first.start);

            if (midnightGap <= 240 || (midnightGap <= gapThreshold && !hasUnblockedInMidnight)) {
                const merged = { start: last.start, end: first.end };
                intervals = [merged, ...intervals.slice(1, -1)];
            }
        }

        return intervals.map(inv => {
            if (inv.start === inv.end) {
                return `<span class="${cssClass}">${utcMinsToDisplay(inv.start)}</span>`;
            }
            return `<span class="${cssClass}">${utcMinsToDisplay(inv.start)} - ${utcMinsToDisplay(inv.end)}</span>`;
        });
    }

    let flickerTimeout = null;
    function triggerButtonFlicker() {
        const btn = document.getElementById('st-header-tools-btn');
        if (!btn) return;
        btn.classList.add('st-flicker');

        clearTimeout(flickerTimeout);
        flickerTimeout = setTimeout(() => {
            btn.classList.remove('st-flicker');
        }, 1200);
    }

    // --- Rally Point DOM Scanner ---
    let lastProcessedKey = '';

    function scanRallyPoint() {
        mountHeaderMenu();

        const urlParams = new URLSearchParams(window.location.search);
        const isSendTroopsTab = urlParams.get('tab') === 'send-troops' || window.location.href.includes('tab=send-troops');

        if (!isSendTroopsTab) return;

        const sendTroopsPanel = document.getElementById('send-troops-panel');
        if (!sendTroopsPanel) return;

        const playerAnchor = sendTroopsPanel.querySelector('a[href*="/player/"]');
        if (!playerAnchor) return;

        const playerName = playerAnchor.textContent.trim();

        const allianceAnchor = sendTroopsPanel.querySelector('a[href*="/alliance/"]');
        const playerAlliance = allianceAnchor ? cleanAllianceTag(allianceAnchor.textContent) : '';

        let arrivalTime = null;
        const dts = Array.from(sendTroopsPanel.querySelectorAll('dt'));
        for (const dt of dts) {
            if (dt.textContent.includes('Arrives at:')) {
                const dd = dt.nextElementSibling || dt.parentElement.querySelector('dd');
                if (dd) arrivalTime = dd.textContent.trim();
                break;
            }
        }

        if (!playerName || !arrivalTime) return;

        const timeHHMM = arrivalTime.substring(0, 5);
        const localMins = parseTimeToMinutes(timeHHMM);
        if (localMins < 0) return;

        const utcMins = localMinsToUtc(localMins);
        if (utcMins < 0) return;

        const warning = Array.from(sendTroopsPanel.querySelectorAll('p')).find(p =>
            p.textContent.includes('Safe Time blocks this mission')
        );

        const isBlocked = !!warning;
        const currentKey = `${playerName}@${utcMins}@${isBlocked ? 'B' : 'A'}`;

        if (lastProcessedKey === currentKey) return;
        lastProcessedKey = currentKey;

        if (!playerData[playerName]) {
            playerData[playerName] = { alliance: playerAlliance, samples: [], availableSamples: [] };
        } else {
            if (playerAlliance) playerData[playerName].alliance = playerAlliance;
            if (!playerData[playerName].samples) playerData[playerName].samples = [];
            if (!playerData[playerName].availableSamples) playerData[playerName].availableSamples = [];
        }

        if (isBlocked) {
            const samples = playerData[playerName].samples;
            if (!samples.includes(utcMins)) {
                samples.push(utcMins);
                samples.sort((a, b) => a - b);
                playerData[playerName].availableSamples = playerData[playerName].availableSamples.filter(m => m !== utcMins);
                GM_setValue(STORAGE_PLAYER_DATA, playerData);
                pushToGist();
                updateModalContent();
            }
        } else {
            const avail = playerData[playerName].availableSamples;
            const isBlockedSample = playerData[playerName].samples.includes(utcMins);
            if (!avail.includes(utcMins) && !isBlockedSample) {
                avail.push(utcMins);
                avail.sort((a, b) => a - b);
                GM_setValue(STORAGE_PLAYER_DATA, playerData);
                pushToGist();
                updateModalContent();
            }
        }

        triggerButtonFlicker();
    }

    // --- Header Menu Mount Logic ---
    function mountHeaderMenu() {
        const header = document.querySelector('header');
        if (!header) return;

        let toolsWrapper = document.getElementById('st-header-tools-wrapper');
        const twGraphBtn = document.getElementById('tw-graph-btn');

        if (!toolsWrapper) {
            toolsWrapper = document.createElement('div');
            toolsWrapper.id = 'st-header-tools-wrapper';
            toolsWrapper.className = 'st-header-tools-wrapper';

            const targetContainer = header.querySelector('.relative.flex.items-center.justify-center') ||
                                    header.querySelector('.relative.z-1.flex.justify-start') ||
                                    header.querySelector('.paper');

            if (targetContainer) {
                targetContainer.appendChild(toolsWrapper);
            } else {
                header.appendChild(toolsWrapper);
            }
        }

        if (twGraphBtn && twGraphBtn.parentElement !== document.getElementById('st-dropdown-box')) {
            toolsWrapper.innerHTML = `
                <button id="st-header-tools-btn" type="button" class="st-header-btn">
                    <span class="max-md:hidden">Tools ▾</span>
                    <span class="md:hidden">Tools ▾</span>
                </button>
                <div id="st-dropdown-box" class="st-dropdown-box hidden">
                    <button type="button" id="st-menu-item-st" class="st-dropdown-item">
                        <span class="max-md:hidden">Safe Times</span>
                        <span class="md:hidden">ST</span>
                    </button>
                </div>
            `;

            const dropdownBox = toolsWrapper.querySelector('#st-dropdown-box');
            twGraphBtn.removeAttribute('style');
            twGraphBtn.className = 'st-dropdown-item';
            twGraphBtn.innerHTML = `
                <span class="max-md:hidden">Trade Graph</span>
                <span class="md:hidden">TG</span>
            `;
            dropdownBox.appendChild(twGraphBtn);

            const triggerBtn = toolsWrapper.querySelector('#st-header-tools-btn');
            triggerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownBox.classList.toggle('hidden');
            });

            toolsWrapper.querySelector('#st-menu-item-st').addEventListener('click', (e) => {
                e.stopPropagation();
                dropdownBox.classList.add('hidden');
                toggleModal();
            });

            twGraphBtn.addEventListener('click', () => {
                dropdownBox.classList.add('hidden');
            });
        } else if (!twGraphBtn && !toolsWrapper.querySelector('#st-header-tools-btn')) {
            toolsWrapper.innerHTML = `
                <button id="st-header-tools-btn" type="button" class="st-header-btn">
                    <span class="max-md:hidden">Safe Times</span>
                    <span class="md:hidden">ST</span>
                </button>
            `;
            toolsWrapper.querySelector('#st-header-tools-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleModal();
            });
        }
    }

    document.addEventListener('click', (e) => {
        const toolsWrapper = document.getElementById('st-header-tools-wrapper');
        if (toolsWrapper && !toolsWrapper.contains(e.target)) {
            const dropdown = document.getElementById('st-dropdown-box');
            if (dropdown) dropdown.classList.add('hidden');
        }
    });

    // --- Make Modal Draggable ---
    function attachModalDraggable(modalContainer, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const onStart = (e) => {
            if (e.target.closest('#st-btn-close-modal, input, select, button, a')) return;

            isDragging = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            startX = clientX;
            startY = clientY;

            const rect = modalContainer.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            modalContainer.style.position = 'fixed';
            modalContainer.style.left = `${initialLeft}px`;
            modalContainer.style.top = `${initialTop}px`;
            modalContainer.style.margin = '0';

            if (e.type === 'touchstart') e.preventDefault();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            modalContainer.style.left = `${initialLeft + (clientX - startX)}px`;
            modalContainer.style.top = `${initialTop + (clientY - startY)}px`;

            if (e.type === 'touchmove') e.preventDefault();
        };

        const onEnd = () => { isDragging = false; };

        handle.addEventListener('mousedown', onStart);
        handle.addEventListener('touchstart', onStart, { passive: false });
        document.addEventListener('mousemove', onMove);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchend', onEnd);
    }

    // --- UI Modal & Trigger ---
    let modalElement = null;

    function toggleModal() {
        if (modalElement) {
            modalElement.remove();
            modalElement = null;
            return;
        }

        modalElement = document.createElement('div');
        modalElement.className = 'st-backdrop';

        const openGistLink = gistId ? `<a href="https://gist.github.com/${gistId}" class="st-link">Open Gist ↗</a>` : '';

        modalElement.innerHTML = `
            <div class="st-modal-container" id="st-modal-box">
                <!-- Header -->
                <div class="st-header-row" id="st-header-drag-handle">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <h3 class="st-header-title">Safe Time Tracker</h3>
                        <span id="st-gist-indicator"></span>
                    </div>
                    <button id="st-btn-close-modal" type="button" class="st-close-btn">✕</button>
                </div>

                <!-- Modal Body -->
                <div class="st-body-scroll">
                    <!-- Collapsible Settings -->
                    <details id="st-settings-details" class="st-card-box" ${isSettingsOpen ? 'open' : ''}>
                        <summary class="st-label-title" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0;">
                            <span>Settings</span>
                            <span style="font-size: 10px; color: #6a5a48;">▼</span>
                        </summary>

                        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #dcd3c6; display: flex; flex-direction: column; gap: 10px;">
                            <div>
                                <label class="st-label-title">Time Display</label>
                                <select id="st-tz-mode" class="st-field-input">
                                    <option value="local" ${timeZoneMode === 'local' ? 'selected' : ''}>Local Time</option>
                                    <option value="utc" ${timeZoneMode === 'utc' ? 'selected' : ''}>UTC Time</option>
                                </select>
                            </div>

                            <div style="border-top: 1px solid #dcd3c6; padding-top: 10px; margin-top: 4px; display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <label class="st-label-title" style="margin-bottom: 0;">Gist ID</label>
                                    <span id="st-open-gist-wrapper">${openGistLink}</span>
                                </div>
                                <input id="st-gh-gist-id" type="text" placeholder="e.g. 872976f2aa4ecec..." value="${gistId}" class="st-field-input">

                                <label class="st-label-title" style="margin-top: 4px; margin-bottom: 0;">GitHub Token (ghp_...)</label>
                                <input id="st-gh-token" type="password" placeholder="ghp_YOUR_TOKEN" value="${ghToken}" class="st-field-input">

                                <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
                                    <button id="st-btn-sync" type="button" class="st-btn-blue">Save &amp; Sync</button>
                                </div>
                            </div>
                        </div>
                    </details>

                    <!-- Tracked Players Section -->
                    <div class="st-card-box">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                            <span class="st-label-title" style="margin-bottom: 0;">Tracked Target Players</span>
                            <button id="st-clear-all" type="button" class="st-btn-red">Reset History</button>
                        </div>
                        <div style="margin-bottom: 8px;">
                            <input id="st-player-filter" type="text" placeholder="Filter by name or alliance..." class="st-field-input" style="padding: 4px 6px;">
                        </div>
                        <div id="st-player-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modalElement);

        const modalBox = modalElement.querySelector('#st-modal-box');
        const dragHandle = modalElement.querySelector('#st-header-drag-handle');
        attachModalDraggable(modalBox, dragHandle);

        modalElement.querySelector('#st-btn-close-modal').addEventListener('click', toggleModal);
        updateGistIndicator(gistStatus);

        const detailsElem = modalElement.querySelector('#st-settings-details');
        detailsElem.addEventListener('toggle', () => {
            isSettingsOpen = detailsElem.open;
            GM_setValue(STORAGE_SETTINGS_OPEN, isSettingsOpen);
        });

        const tzSelect = modalElement.querySelector('#st-tz-mode');
        const tokenInput = modalElement.querySelector('#st-gh-token');
        const gistIdInput = modalElement.querySelector('#st-gh-gist-id');
        const btnSync = modalElement.querySelector('#st-btn-sync');
        const filterInput = modalElement.querySelector('#st-player-filter');

        filterInput.addEventListener('input', () => {
            const query = filterInput.value.toLowerCase().trim();
            const cards = modalElement.querySelectorAll('.st-player-card-item');
            cards.forEach(card => {
                const searchData = card.getAttribute('data-search') || '';
                if (!query || searchData.includes(query)) {
                    card.style.display = '';
                } else {
                    card.style.display = 'none';
                }
            });
        });

        tzSelect.addEventListener('change', (e) => {
            timeZoneMode = e.target.value;
            GM_setValue(STORAGE_TZ_MODE, timeZoneMode);

            pushToGist();
            updateModalContent();
        });

        btnSync.addEventListener('click', () => {
            ghToken = tokenInput.value.trim();
            gistId = gistIdInput.value.trim();
            GM_setValue(STORAGE_GH_TOKEN, ghToken);
            GM_setValue(STORAGE_GIST_ID, gistId);

            const wrapper = modalElement.querySelector('#st-open-gist-wrapper');
            if (wrapper) {
                wrapper.innerHTML = gistId ? `<a href="https://gist.github.com/${gistId}" class="st-link">Open Gist ↗</a>` : '';
            }

            pullFromGist((success) => {
                if (!success && ghToken && gistId) {
                    pushToGist(true);
                }
            });
        });

        modalElement.querySelector('#st-clear-all').addEventListener('click', () => {
            if (confirm('Reset all recorded safe time history?')) {
                playerData = {};
                GM_setValue(STORAGE_PLAYER_DATA, playerData);
                pushToGist(true);
                updateModalContent();
            }
        });

        updateModalContent();
    }

    function updateModalContent() {
        if (!modalElement) return;
        const listContainer = modalElement.querySelector('#st-player-list');
        if (!listContainer) return;

        // Remember expanded cards
        const openPlayerNames = new Set();
        listContainer.querySelectorAll('details.st-player-card-item[open]').forEach(card => {
            const pName = card.querySelector('.st-player-name')?.textContent?.trim();
            if (pName) openPlayerNames.add(pName);
        });

        listContainer.innerHTML = '';

        const filterInput = modalElement.querySelector('#st-player-filter');
        const currentQuery = filterInput ? filterInput.value.toLowerCase().trim() : '';

        const playerNames = Object.keys(playerData);
        if (playerNames.length === 0) {
            listContainer.innerHTML = '<div class="st-empty">No target safe times recorded yet. Switch targets/troops in Rally Point to collect data.</div>';
            return;
        }

        const mapPath = getCurrentMapPrefix();

        playerNames.forEach(name => {
            const playerEntry = playerData[name] || {};
            const cleanTag = cleanAllianceTag(playerEntry.alliance || '');
            const encodedName = encodeURIComponent(name);
            const encodedTag = encodeURIComponent(cleanTag);

            const playerLinkHtml = `<a href="https://www.thronewake.com${mapPath}/player/${encodedName}" data-type="player" data-name="${name}" class="st-player-name st-link-nav">${name}</a>`;
            const allianceLinkHtml = cleanTag ? `<a href="https://www.thronewake.com${mapPath}/alliance/${encodedTag}" data-type="alliance" data-name="${cleanTag}" class="st-alliance-tag st-link-nav">[${cleanTag}]</a>` : '';

            const utcMinsList = playerEntry.samples || [];
            const availUtcMinsList = playerEntry.availableSamples || [];

            const deducedInterval = calculateSpannedInterval(utcMinsList, availUtcMinsList);
            const sampleIntervalsHtml = groupSamplesIntoIntervals(utcMinsList, 'st-sample-tag', 360, availUtcMinsList).join(' ');
            const availIntervalsHtml = groupSamplesIntoIntervals(availUtcMinsList, 'st-avail-tag', 30, []).join(' ');

            const searchKey = `${name.toLowerCase()} ${cleanTag.toLowerCase()}`;
            const card = document.createElement('details');
            card.className = 'st-card-box st-player-card-item';
            card.style.marginBottom = '6px';
            card.setAttribute('data-search', searchKey);

            if (openPlayerNames.has(name)) {
                card.open = true;
            }

            if (currentQuery && !searchKey.includes(currentQuery)) {
                card.style.display = 'none';
            }

            card.innerHTML = `
                <summary style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        ${playerLinkHtml}
                        ${allianceLinkHtml}
                        <div class="st-deduced-box" style="margin: 0;">${deducedInterval}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <button type="button" class="st-del-player st-btn-red" data-player="${name}" style="padding: 2px 6px; font-size: 10px;">Delete</button>
                        <span style="font-size: 10px; color: #6a5a48;">▼</span>
                    </div>
                </summary>
                <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #dcd3c6; display: flex; flex-direction: column; gap: 6px;">
                    <div>
                        <span class="st-label-title" style="margin-bottom: 2px;">Safe Time detected samples (${timeZoneMode.toUpperCase()}):</span>
                        <div>${sampleIntervalsHtml || '<span class="st-empty">None</span>'}</div>
                    </div>
                    ${availUtcMinsList.length > 0 ? `
                    <div>
                        <span class="st-label-title" style="margin-bottom: 2px;">Unblocked Samples (${timeZoneMode.toUpperCase()}):</span>
                        <div>${availIntervalsHtml}</div>
                    </div>
                    ` : ''}
                </div>
            `;

            // Prevent navigation links inside summary from toggling card collapse and update href dynamically on click
            card.querySelectorAll('.st-link-nav').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const livePrefix = getCurrentMapPrefix();
                    const type = link.dataset.type;
                    const nameVal = link.dataset.name;
                    if (type && nameVal) {
                        link.href = `https://www.thronewake.com${livePrefix}/${type}/${encodeURIComponent(nameVal)}`;
                    }
                });
            });

            card.querySelector('.st-del-player').addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                delete playerData[e.currentTarget.dataset.player];
                GM_setValue(STORAGE_PLAYER_DATA, playerData);
                pushToGist(true);
                updateModalContent();
            });

            listContainer.appendChild(card);
        });
    }

    mountHeaderMenu();
    const observer = new MutationObserver(() => scanRallyPoint());
    observer.observe(document.body, { childList: true, subtree: true });

})();
