// ==UserScript==
// @name         Thronewake Safe Time Tracker
// @namespace    http://tampermonkey.net/
// @version      8.5
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

    const SCRIPT_VERSION = '8.5';

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
        const str = timeStr.trim();
        let h = -1, m = -1;

        const matchColon = str.match(/^(\d{1,2}):(\d{2})$/);
        if (matchColon) {
            h = parseInt(matchColon[1], 10);
            m = parseInt(matchColon[2], 10);
        } else if (/^\d{3,4}$/.test(str)) {
            if (str.length === 3) {
                h = parseInt(str.substring(0, 1), 10);
                m = parseInt(str.substring(1, 3), 10);
            } else {
                h = parseInt(str.substring(0, 2), 10);
                m = parseInt(str.substring(2, 4), 10);
            }
        } else if (/^\d{1,2}$/.test(str)) {
            h = parseInt(str, 10);
            m = 0;
        }

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

    // --- Check If Sample Falls Inside Confirmed Blocked Span ---
    function isSampleInBlockedSpan(m, blockedList) {
        if (!blockedList || blockedList.length === 0) return false;
        const valid = Array.from(new Set(blockedList.filter(x => typeof x === 'number' && x >= 0))).sort((a, b) => a - b);
        const n = valid.length;
        if (n === 0) return false;
        if (n === 1) return m === valid[0];

        let maxGap = -1;
        let gapStartIndex = -1;
        for (let i = 0; i < n; i++) {
            const current = valid[i];
            const next = (i === n - 1) ? valid[0] + 1440 : valid[i + 1];
            const gap = next - current;
            if (gap > maxGap) {
                maxGap = gap;
                gapStartIndex = i;
            }
        }

        const bStart = valid[(gapStartIndex + 1) % n];
        const bEnd = valid[gapStartIndex];
        const spanLen = (bEnd - bStart + 1440) % 1440;

        if (spanLen > 360) {
            return valid.includes(m);
        }

        if (bStart <= bEnd) {
            return m >= bStart && m <= bEnd;
        } else {
            return m >= bStart || m <= bEnd;
        }
    }

    // --- Leakage Cleanup Logic ---
    function pruneLeakedSamples(blockedList, availList) {
        if (!blockedList || blockedList.length <= 1) return blockedList || [];

        const validBlocked = Array.from(new Set(blockedList.filter(x => typeof x === 'number' && x >= 0))).sort((a, b) => a - b);
        const validAvail = Array.from(new Set(availList.filter(x => typeof x === 'number' && x >= 0))).sort((a, b) => a - b);
        if (validBlocked.length <= 1) return validBlocked;

        const confirmedStarts = [];
        for (const b of validBlocked) {
            let minGap = 1440;
            let bestA = null;
            for (const a of validAvail) {
                const gap = (b - a + 1440) % 1440;
                if (gap > 0 && gap < minGap) {
                    minGap = gap;
                    bestA = a;
                }
            }
            if (bestA !== null && minGap <= 360) {
                let hasBlockedBetween = false;
                for (const otherB of validBlocked) {
                    if (otherB !== b) {
                        const gOther = (otherB - bestA + 1440) % 1440;
                        if (gOther < minGap) {
                            hasBlockedBetween = true;
                            break;
                        }
                    }
                }
                if (!hasBlockedBetween) {
                    confirmedStarts.push({ bStart: b, unblockedBefore: bestA, gap: minGap });
                }
            }
        }

        if (confirmedStarts.length === 0) return validBlocked;

        return validBlocked.filter(x => {
            return confirmedStarts.some(cs => {
                const dist = (x - cs.bStart + 1440) % 1440;
                return dist <= 360;
            });
        });
    }

    // --- Dynamic URL Path Resolution ---
    function getCurrentMapPrefix() {
        if (window.location.pathname.includes('/map')) return '/map';
        if (document.querySelector('a[href*="/map/player/"], a[href*="/map/alliance/"]')) return '/map';
        return '';
    }

    let timeZoneMode = GM_getValue(STORAGE_TZ_MODE, 'local');

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
            let customRaw = [];

            if (Array.isArray(entry)) {
                blockedRaw = entry;
            } else if (entry && typeof entry === 'object') {
                alliance = cleanAllianceTag(entry.alliance || entry.a || '');
                blockedRaw = entry.samples || entry.s || [];
                availRaw = entry.availableSamples || entry.v || [];
                customRaw = entry.customSamples || entry.c || [];
            }

            const parseItemToUtc = (item) => {
                if (typeof item === 'number' && !isNaN(item) && item >= 0 && item < 1440) return item;
                if (item && typeof item.localMinutes === 'number' && item.localMinutes >= 0) return localMinsToUtc(item.localMinutes);
                if (item && typeof item.arrivalTime === 'string') {
                    const parsedMins = parseTimeToMinutes(item.arrivalTime);
                    return (timeZoneMode === 'utc') ? parsedMins : localMinsToUtc(parsedMins);
                }
                return null;
            };

            const s = Array.from(new Set(blockedRaw.map(parseItemToUtc).filter(x => typeof x === 'number' && x >= 0))).sort((a, b) => a - b);
            const v = Array.from(new Set(availRaw.map(parseItemToUtc).filter(x => typeof x === 'number' && x >= 0 && !s.includes(x) && !isSampleInBlockedSpan(x, s)))).sort((a, b) => a - b);

            const c = customRaw.map(item => {
                if (typeof item === 'object' && item !== null) {
                    let m = item.mins;
                    if (typeof m !== 'number') m = parseItemToUtc(item);
                    return { mins: m, type: item.type || 'blocked' };
                }
                return null;
            }).filter(x => x && typeof x.mins === 'number' && x.mins >= 0);

            result[name] = { alliance, samples: s, availableSamples: v, customSamples: c };
        }
        return result;
    }

    let playerData = normalizePlayerData(GM_getValue(STORAGE_PLAYER_DATA, {}));

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

        .st-btn-desktop { display: inline; }
        .st-btn-mobile { display: none; }

        @media (max-width: 767px) {
            .st-header-tools-wrapper {
                margin-left: 3px !important;
            }
            .st-header-btn {
                padding: 3px 5px !important;
                font-size: 11px !important;
                gap: 2px !important;
            }
            .st-btn-desktop { display: none !important; }
            .st-btn-mobile { display: inline !important; }
        }

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

        details.st-player-card-item:not([open]) .st-del-player,
        details.st-player-card-item:not([open]) .st-add-custom-sample {
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

        .st-leaked-tag {
            opacity: 0.45 !important;
            filter: grayscale(1);
            border: 1px dashed #94a3b8 !important;
            background: rgba(0, 0, 0, 0.03) !important;
            color: #64748b !important;
            text-decoration: line-through;
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

        .st-custom-tag {
            display: inline-flex;
            align-items: center;
            background: rgba(106, 90, 72, 0.12);
            border: 1px dashed #6a5a48;
            color: #101010;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
            margin: 2px 4px 2px 0;
        }

        .st-custom-conflict-tag {
            display: inline-flex;
            align-items: center;
            background: #fee2e2 !important;
            border: 1px solid #ef4444 !important;
            color: #b91c1c !important;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
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

        .st-assumed-box {
            background: #fef3c7 !important;
            border: 1px dashed #b45309 !important;
            color: #78350f !important;
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

    // --- Custom Theme Confirmation Modal ---
    function showConfirmModal(title, message, onConfirm) {
        const confirmBackdrop = document.createElement('div');
        confirmBackdrop.className = 'st-backdrop';
        confirmBackdrop.style.zIndex = '9999999';

        confirmBackdrop.innerHTML = `
            <div class="st-modal-container" style="width: 360px; min-height: auto; padding: 14px; resize: none; pointer-events: auto;">
                <div style="font-size: 13px; font-weight: 600; text-transform: uppercase; color: #6a5a48; margin-bottom: 8px;">
                    ${title}
                </div>
                <div style="font-size: 12px; color: #101010; margin-bottom: 14px; line-height: 1.4;">
                    ${message}
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button type="button" id="st-confirm-cancel" class="st-header-btn" style="background: #6a5a48;">Cancel</button>
                    <button type="button" id="st-confirm-ok" class="st-btn-red">Confirm</button>
                </div>
            </div>
        `;

        document.body.appendChild(confirmBackdrop);

        const cancelBtn = confirmBackdrop.querySelector('#st-confirm-cancel');
        const okBtn = confirmBackdrop.querySelector('#st-confirm-ok');

        const close = () => confirmBackdrop.remove();

        cancelBtn.addEventListener('click', close);
        okBtn.addEventListener('click', () => {
            close();
            onConfirm();
        });
    }

    // --- Add Custom Sample Modal ---
    function showAddCustomSampleModal(playerName, onAdd) {
        const backdrop = document.createElement('div');
        backdrop.className = 'st-backdrop';
        backdrop.style.zIndex = '9999999';

        backdrop.innerHTML = `
            <div class="st-modal-container" style="width: 320px; min-height: auto; padding: 14px; resize: none; pointer-events: auto;">
                <div style="font-size: 13px; font-weight: 600; text-transform: uppercase; color: #6a5a48; margin-bottom: 10px;">
                    Add Custom Sample (${playerName})
                </div>
                <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
                    <div>
                        <label class="st-label-title">Time (${timeZoneMode.toUpperCase()} HH:MM / HMM)</label>
                        <input id="st-custom-time-input" type="text" placeholder="e.g. 14:30 or 430" class="st-field-input" value="12:00">
                    </div>
                    <div>
                        <label class="st-label-title">Sample Type</label>
                        <select id="st-custom-type-select" class="st-field-input">
                            <option value="blocked">Blocked (Safe Time)</option>
                            <option value="available">Available (Unblocked)</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button type="button" id="st-custom-cancel" class="st-header-btn" style="background: #6a5a48;">Cancel</button>
                    <button type="button" id="st-custom-save" class="st-btn-blue">Add</button>
                </div>
            </div>
        `;

        document.body.appendChild(backdrop);

        const cancelBtn = backdrop.querySelector('#st-custom-cancel');
        const saveBtn = backdrop.querySelector('#st-custom-save');
        const timeInput = backdrop.querySelector('#st-custom-time-input');
        const typeSelect = backdrop.querySelector('#st-custom-type-select');

        const close = () => backdrop.remove();

        cancelBtn.addEventListener('click', close);
        saveBtn.addEventListener('click', () => {
            const timeStr = timeInput.value.trim();
            const parsedMins = parseTimeToMinutes(timeStr);
            if (parsedMins < 0) {
                alert('Invalid time format. Please enter time like 14:30, 4:30, or 430.');
                return;
            }
            const utcMins = (timeZoneMode === 'utc') ? parsedMins : localMinsToUtc(parsedMins);
            onAdd(utcMins, typeSelect.value);
            close();
        });
    }

    // --- Gist Sync Logic & Throttling ---
    let lastPushTime = 0;
    let pushTimeout = null;
    let syncCountdownTimer = null;
    let nextPushCountdownSec = 0;
    let isPushing = false;
    let hasPendingPush = false;
    const MIN_PUSH_INTERVAL_MS = 10000;

    function updateGistIndicator(status, message = '', countdownSec = 0) {
        gistStatus = status;
        const el = document.getElementById('st-gist-indicator');
        if (!el) return;

        if (status === 'connected') {
            el.innerHTML = '<span class="st-badge st-badge-connected">Connected</span>';
        } else if (status === 'queued') {
            el.innerHTML = `<span class="st-badge st-badge-connected">Connected</span><span class="st-badge st-badge-syncing">Push in ${countdownSec}s</span>`;
        } else if (status === 'syncing') {
            el.innerHTML = '<span class="st-badge st-badge-syncing">Syncing...</span>';
        } else if (status === 'error') {
            el.innerHTML = `<span class="st-badge st-badge-error">${message || 'Sync Error'}</span>`;
        } else {
            el.innerHTML = '<span class="st-badge st-badge-disconnected">Disconnected</span>';
        }
    }

    function prepareCompactGistData() {
        const compactPlayers = {};
        for (const name in playerData) {
            compactPlayers[name] = {
                a: playerData[name].alliance || '',
                s: playerData[name].samples || [],
                v: playerData[name].availableSamples || [],
                c: playerData[name].customSamples || []
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
                                const incomingData = normalizePlayerData(rawPlayers);
                                for (const p in incomingData) {
                                    if (!playerData[p]) {
                                        playerData[p] = incomingData[p];
                                    } else {
                                        if (incomingData[p].alliance) playerData[p].alliance = incomingData[p].alliance;
                                        playerData[p].samples = Array.from(new Set([...playerData[p].samples, ...incomingData[p].samples])).sort((a, b) => a - b);
                                        playerData[p].availableSamples = Array.from(new Set([...playerData[p].availableSamples, ...incomingData[p].availableSamples])).sort((a, b) => a - b);
                                        playerData[p].availableSamples = playerData[p].availableSamples.filter(m => !isSampleInBlockedSpan(m, playerData[p].samples));

                                        const combinedCustom = [...(playerData[p].customSamples || []), ...(incomingData[p].customSamples || [])];
                                        const uniqueCustom = [];
                                        combinedCustom.forEach(item => {
                                            if (!uniqueCustom.some(u => u.mins === item.mins && u.type === item.type)) {
                                                uniqueCustom.push(item);
                                            }
                                        });
                                        playerData[p].customSamples = uniqueCustom;
                                    }
                                }
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

    function pushToGist(immediate = false) {
        const token = ghToken.trim();
        const id = gistId.trim();

        if (!token || !id) return;

        hasPendingPush = true;

        if (pushTimeout) {
            clearTimeout(pushTimeout);
            pushTimeout = null;
        }
        if (syncCountdownTimer) {
            clearInterval(syncCountdownTimer);
            syncCountdownTimer = null;
        }

        const now = Date.now();
        const elapsed = now - lastPushTime;

        const executePush = () => {
            if (syncCountdownTimer) {
                clearInterval(syncCountdownTimer);
                syncCountdownTimer = null;
            }
            if (isPushing) {
                hasPendingPush = true;
                return;
            }

            isPushing = true;
            hasPendingPush = false;
            lastPushTime = Date.now();
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
                    isPushing = false;
                    if (res.status === 200) {
                        updateGistIndicator('connected');
                    } else {
                        const errMsg = res.status === 403 ? '403 Rate Limit / Owner' : (res.status === 401 ? '401 Bad Token' : (res.status === 404 ? '404 Bad Gist ID' : `Push Error ${res.status}`));
                        updateGistIndicator('error', errMsg);
                    }
                    if (hasPendingPush) {
                        pushToGist(false);
                    }
                },
                onerror: function () {
                    isPushing = false;
                    updateGistIndicator('error', 'Network Error');
                }
            });
        };

        if (immediate && !isPushing && elapsed >= 3000) {
            executePush();
        } else {
            const delay = Math.max(1000, MIN_PUSH_INTERVAL_MS - elapsed);
            nextPushCountdownSec = Math.ceil(delay / 1000);

            updateGistIndicator('queued', '', nextPushCountdownSec);
            syncCountdownTimer = setInterval(() => {
                nextPushCountdownSec--;
                if (nextPushCountdownSec <= 0) {
                    clearInterval(syncCountdownTimer);
                    syncCountdownTimer = null;
                } else {
                    updateGistIndicator('queued', '', nextPushCountdownSec);
                }
            }, 1000);

            pushTimeout = setTimeout(() => {
                if (hasPendingPush && !isPushing) {
                    executePush();
                }
            }, delay);
        }
    }

    pullFromGist();

    // --- Math & Safe Time Deduction ---
    function calculateSpannedInterval(utcMinsList, availableUtcMinsList = []) {
        const validBlocked = (Array.isArray(utcMinsList) ? utcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);
        const validAvail = (Array.isArray(availableUtcMinsList) ? availableUtcMinsList : [])
            .filter(m => typeof m === 'number' && !isNaN(m) && m >= 0)
            .filter(m => !validBlocked.includes(m));

        if (validBlocked.length > 0) {
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
            if (span_len > 360) {
                return { text: `${utcMinsToDisplay(bStart)} - ${utcMinsToDisplay(bEnd)} | Conflict (>6h)`, isAssumed: false };
            }

            const base = (bEnd - 360 + 1440) % 1440;
            const max_x = (bStart - base + 1440) % 1440;

            const possible_x = [];

            const isBetweenArc = (m, start, end) => {
                if (start === end) return m === start;
                if (start < end) return m >= start && m <= end;
                return m >= start || m <= end;
            };

            for (let x = 0; x <= max_x; x++) {
                const sStart = (base + x + 1440) % 1440;
                const sEnd = (sStart + 360) % 1440;
                let has_conflict = false;

                // Candidate 6-hour Safe Time window [sStart, sEnd] must NOT contain any unblocked sample
                for (const a of validAvail) {
                    if (isBetweenArc(a, sStart, sEnd)) {
                        has_conflict = true;
                        break;
                    }
                }
                if (!has_conflict) {
                    possible_x.push(x);
                }
            }

            if (possible_x.length === 0) {
                if (n === 1) {
                    return { text: `Sample: ${utcMinsToDisplay(bStart)} | Conflict`, isAssumed: false };
                }
                return { text: `${utcMinsToDisplay(bStart)} - ${utcMinsToDisplay(bEnd)} | Conflict`, isAssumed: false };
            }

            const min_x = possible_x[0];
            const final_max_x = possible_x[possible_x.length - 1];

            const earliestStart = (base + min_x + 1440) % 1440;
            const latestStart = (base + final_max_x + 1440) % 1440;
            const latestEnd = (latestStart + 360) % 1440;

            if (n === 1) {
                return { text: `Sample: ${utcMinsToDisplay(bStart)} (Bounds: ${utcMinsToDisplay(earliestStart)} to ${utcMinsToDisplay(latestEnd)})`, isAssumed: false };
            }

            return { text: `${utcMinsToDisplay(bStart)} - ${utcMinsToDisplay(bEnd)} | Bounds: ${utcMinsToDisplay(earliestStart)} to ${utcMinsToDisplay(latestEnd)}`, isAssumed: false };
        }

        const sortedAvail = Array.from(new Set(validAvail)).sort((a, b) => a - b);
        if (sortedAvail.length >= 2) {
            const nAvail = sortedAvail.length;
            const candidate_gaps = [];

            for (let i = 0; i < nAvail; i++) {
                const s = sortedAvail[i];
                const e = sortedAvail[(i + 1) % nAvail];
                let gap_len = (e - s + 1440) % 1440;
                if (gap_len === 0) gap_len = 1440;

                if (gap_len >= 180) {
                    candidate_gaps.push({ start: s, end: e, len: gap_len });
                }
            }

            if (candidate_gaps.length > 0) {
                candidate_gaps.sort((a, b) => b.len - a.len);
                const topGaps = candidate_gaps.slice(0, 3);

                const formatted = topGaps.map(g => `${utcMinsToDisplay(g.start)} - ${utcMinsToDisplay(g.end)}`).join(', ');
                return { text: `Assumed: ${formatted}`, isAssumed: true };
            }
        }

        return { text: 'No blocked data', isAssumed: false };
    }

    function groupSamplesIntoIntervals(utcMinsList, cssClass = 'st-sample-tag', gapThreshold = 60, oppositeUtcMinsList = [], isAvailable = false, titleText = '') {
        const validSamples = (Array.isArray(utcMinsList) ? utcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);
        if (validSamples.length === 0) return [];

        const validOpposite = (Array.isArray(oppositeUtcMinsList) ? oppositeUtcMinsList : []).filter(m => typeof m === 'number' && !isNaN(m) && m >= 0);

        let hasValidSafeTime = false;
        if (validOpposite.length > 0) {
            if (validOpposite.length === 1) {
                hasValidSafeTime = true;
            } else {
                const sortedOpp = Array.from(new Set(validOpposite)).sort((a, b) => a - b);
                let maxGap = -1;
                for (let i = 0; i < sortedOpp.length; i++) {
                    const curr = sortedOpp[i];
                    const next = (i === sortedOpp.length - 1) ? sortedOpp[0] + 1440 : sortedOpp[i + 1];
                    const gap = next - curr;
                    if (gap > maxGap) maxGap = gap;
                }
                const spanLen = (1440 - maxGap + 1440) % 1440;
                if (spanLen <= 360) {
                    hasValidSafeTime = true;
                }
            }
        }

        const sorted = Array.from(new Set(validSamples)).sort((a, b) => a - b);
        let intervals = [];
        let start = sorted[0];
        let prev = sorted[0];

        for (let i = 1; i < sorted.length; i++) {
            const curr = sorted[i];
            const gap = curr - prev;

            const hasOppositeBetween = validOpposite.some(a => a > prev && a < curr);

            let shouldMerge = false;
            if (isAvailable) {
                if (hasValidSafeTime) {
                    shouldMerge = (gap <= gapThreshold) && !hasOppositeBetween;
                } else {
                    shouldMerge = (gap <= gapThreshold) && !hasOppositeBetween;
                }
            } else {
                shouldMerge = (gap <= gapThreshold) && !hasOppositeBetween;
            }

            if (shouldMerge) {
                prev = curr;
            } else {
                intervals.push({ start, end: prev });
                start = curr;
                prev = curr;
            }
        }
        intervals.push({ start, end: prev });

        if (intervals.length > 1) {
            const first = intervals[0];
            const last = intervals[intervals.length - 1];
            const midnightGap = (1440 - last.end) + first.start;
            const hasOppositeInMidnight = validOpposite.some(a => a > last.end || a < first.start);

            let shouldMergeWrap = false;
            if (isAvailable) {
                if (hasValidSafeTime) {
                    shouldMergeWrap = (midnightGap <= gapThreshold) && !hasOppositeInMidnight;
                } else {
                    shouldMergeWrap = (midnightGap <= gapThreshold) && !hasOppositeInMidnight;
                }
            } else {
                shouldMergeWrap = (midnightGap <= gapThreshold) && !hasOppositeInMidnight;
            }

            if (shouldMergeWrap) {
                const merged = { start: last.start, end: first.end };
                intervals = [merged, ...intervals.slice(1, -1)];
            }
        }

        const titleAttr = titleText ? `title="${titleText}"` : '';

        return intervals.map(inv => {
            if (inv.start === inv.end) {
                return `<span class="${cssClass}" ${titleAttr}>${utcMinsToDisplay(inv.start)}</span>`;
            }
            return `<span class="${cssClass}" ${titleAttr}>${utcMinsToDisplay(inv.start)} - ${utcMinsToDisplay(inv.end)}</span>`;
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
    const lastProcessedKeysByPlayer = {};

    function scanRallyPoint() {
        mountHeaderMenu();

        const urlParams = new URLSearchParams(window.location.search);
        const isSendTroopsTab = urlParams.get('tab') === 'send-troops' || window.location.href.includes('tab=send-troops');

        if (!isSendTroopsTab) return;

        const sendTroopsPanel = document.getElementById('send-troops-panel');
        if (!sendTroopsPanel) return;

        if (!sendTroopsPanel.dataset.stListenersAttached) {
            sendTroopsPanel.dataset.stListenersAttached = 'true';
            sendTroopsPanel.addEventListener('input', () => scanRallyPoint());
            sendTroopsPanel.addEventListener('change', () => scanRallyPoint());
        }

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
        const parsedMins = parseTimeToMinutes(timeHHMM);
        if (parsedMins < 0) return;

        const utcMins = (timeZoneMode === 'utc') ? parsedMins : localMinsToUtc(parsedMins);
        if (utcMins < 0) return;

        const warning = Array.from(sendTroopsPanel.querySelectorAll('p')).find(p => {
            const text = p.textContent.toLowerCase();
            return text.includes('blocks this mission') || (text.includes('safe time') && text.includes('blocks'));
        });

        const isBlocked = !!warning;
        const currentKey = `${utcMins}@${isBlocked ? 'B' : 'A'}`;

        if (lastProcessedKeysByPlayer[playerName] === currentKey) return;
        lastProcessedKeysByPlayer[playerName] = currentKey;

        if (!playerData[playerName]) {
            playerData[playerName] = { alliance: playerAlliance, samples: [], availableSamples: [], customSamples: [] };
        } else {
            if (playerAlliance) playerData[playerName].alliance = playerAlliance;
            if (!playerData[playerName].samples) playerData[playerName].samples = [];
            if (!playerData[playerName].availableSamples) playerData[playerName].availableSamples = [];
            if (!playerData[playerName].customSamples) playerData[playerName].customSamples = [];
        }

        if (isBlocked) {
            let samples = playerData[playerName].samples || [];
            if (!samples.includes(utcMins)) {
                samples.push(utcMins);
            }

            playerData[playerName].samples = samples;

            playerData[playerName].availableSamples = (playerData[playerName].availableSamples || []).filter(
                m => m !== utcMins
            );

            GM_setValue(STORAGE_PLAYER_DATA, playerData);
            pushToGist(false);
            updateModalContent();
        } else {
            let avail = playerData[playerName].availableSamples || [];
            if (!avail.includes(utcMins)) {
                avail.push(utcMins);
                avail.sort((a, b) => a - b);
            }

            playerData[playerName].samples = (playerData[playerName].samples || []).filter(m => m !== utcMins);
            playerData[playerName].availableSamples = avail;

            GM_setValue(STORAGE_PLAYER_DATA, playerData);
            pushToGist(false);
            updateModalContent();
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
                    <span class="st-btn-desktop">Tools ▾</span>
                    <span class="st-btn-mobile">🛠️▾</span>
                </button>
                <div id="st-dropdown-box" class="st-dropdown-box hidden">
                    <button type="button" id="st-menu-item-st" class="st-dropdown-item">Safe Times</button>
                </div>
            `;

            const dropdownBox = toolsWrapper.querySelector('#st-dropdown-box');
            twGraphBtn.removeAttribute('style');
            twGraphBtn.className = 'st-dropdown-item';
            twGraphBtn.innerHTML = 'Trade Graph';
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
                    <span class="st-btn-desktop">Safe Times</span>
                    <span class="st-btn-mobile">🛡️</span>
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
                        <h3 class="st-header-title">Safe Time Tracker v${SCRIPT_VERSION}</h3>
                        <span id="st-gist-indicator" style="display: inline-flex; align-items: center; gap: 6px;"></span>
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
        updateGistIndicator(gistStatus, '', nextPushCountdownSec);

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
            showConfirmModal(
                'Reset All History',
                'Are you sure you want to reset and clear <strong>all recorded target safe times</strong>? This action will sync to your Gist.',
                () => {
                    playerData = {};
                    GM_setValue(STORAGE_PLAYER_DATA, playerData);
                    pushToGist(true);
                    updateModalContent();
                }
            );
        });

        updateModalContent();
    }

    function updateModalContent() {
        if (!modalElement) return;
        const listContainer = modalElement.querySelector('#st-player-list');
        if (!listContainer) return;

        const openPlayerNames = new Set();
        listContainer.querySelectorAll('details.st-player-card-item[open]').forEach(card => {
            const pName = card.querySelector('.st-player-name')?.textContent?.trim();
            if (pName) openPlayerNames.add(pName);
        });

        listContainer.innerHTML = '';

        const filterInput = modalElement.querySelector('#st-player-filter');
        const currentQuery = filterInput ? filterInput.value.toLowerCase().trim() : '';

        const playerNames = Object.keys(playerData).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
            const customList = playerEntry.customSamples || [];

            const customBlocked = customList.filter(c => c.type === 'blocked').map(c => c.mins);
            const customAvail = customList.filter(c => c.type === 'available').map(c => c.mins);

            const combinedAvail = Array.from(new Set([...availUtcMinsList, ...customAvail])).sort((a, b) => a - b);
            const rawBlocked = Array.from(new Set([...utcMinsList, ...customBlocked])).sort((a, b) => a - b);

            const effectiveBlocked = pruneLeakedSamples(rawBlocked, combinedAvail);

            const validScanSamples = utcMinsList.filter(s => effectiveBlocked.includes(s));
            const leakedScanSamples = utcMinsList.filter(s => !effectiveBlocked.includes(s));

            const deducedRes = calculateSpannedInterval(effectiveBlocked, combinedAvail);
            const deducedText = (typeof deducedRes === 'object' && deducedRes.text) ? deducedRes.text : String(deducedRes);
            const isAssumed = typeof deducedRes === 'object' && !!deducedRes.isAssumed;
            const deducedBoxClass = isAssumed ? 'st-deduced-box st-assumed-box' : 'st-deduced-box';

            const validIntervalsHtml = groupSamplesIntoIntervals(validScanSamples, 'st-sample-tag', 60, combinedAvail, false);
            const leakedIntervalsHtml = groupSamplesIntoIntervals(leakedScanSamples, 'st-sample-tag st-leaked-tag', 60, [], false, 'Considered Safe Time leakage');
            const sampleIntervalsHtml = [...validIntervalsHtml, ...leakedIntervalsHtml].join(' ');

            const availIntervalsHtml = groupSamplesIntoIntervals(availUtcMinsList, 'st-avail-tag', 60, effectiveBlocked, true).join(' ');

            const customSamplesHtml = customList.map((cs, idx) => {
                let isConflict = false;
                if (cs.type === 'blocked') {
                    if (combinedAvail.includes(cs.mins)) isConflict = true;
                } else {
                    if (effectiveBlocked.includes(cs.mins) || isSampleInBlockedSpan(cs.mins, effectiveBlocked)) isConflict = true;
                }

                const tagClass = isConflict ? 'st-custom-conflict-tag' : 'st-custom-tag';
                const typeLabel = cs.type === 'blocked' ? 'Blocked' : 'Available';
                const timeText = utcMinsToDisplay(cs.mins);
                return `<span class="${tagClass}" title="${isConflict ? 'Conflict with scans!' : ''}">
                    ${timeText} (${typeLabel})
                    <button type="button" class="st-del-custom-sample" data-player="${name}" data-idx="${idx}" style="background:none;border:none;color:inherit;cursor:pointer;margin-left:4px;font-size:10px;padding:0;">✕</button>
                </span>`;
            }).join(' ');

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
                        <div class="${deducedBoxClass}" style="margin: 0;">${deducedText}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                        <button type="button" class="st-del-player st-btn-red" data-player="${name}" style="padding: 2px 6px; font-size: 10px;">Delete</button>
                        <button type="button" class="st-add-custom-sample st-btn-blue" data-player="${name}" style="padding: 2px 6px; font-size: 10px;">Custom</button>
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
                    <div>
                        <span class="st-label-title" style="margin-bottom: 2px;">Custom Samples (${timeZoneMode.toUpperCase()}):</span>
                        <div>${customSamplesHtml || '<span class="st-empty">None</span>'}</div>
                    </div>
                </div>
            `;

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
                const playerNameToDelete = e.currentTarget.dataset.player;
                showConfirmModal(
                    'Delete Player Record',
                    `Are you sure you want to delete safe time records for <strong>${playerNameToDelete}</strong>?`,
                    () => {
                        delete playerData[playerNameToDelete];
                        GM_setValue(STORAGE_PLAYER_DATA, playerData);
                        pushToGist(true);
                        updateModalContent();
                    }
                );
            });

            card.querySelector('.st-add-custom-sample').addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const targetPlayer = e.currentTarget.dataset.player;
                showAddCustomSampleModal(targetPlayer, (mins, type) => {
                    if (!playerData[targetPlayer].customSamples) {
                        playerData[targetPlayer].customSamples = [];
                    }
                    const exists = playerData[targetPlayer].customSamples.some(c => c.mins === mins && c.type === type);
                    if (!exists) {
                        playerData[targetPlayer].customSamples.push({ mins, type });
                        GM_setValue(STORAGE_PLAYER_DATA, playerData);
                        pushToGist(false);
                        updateModalContent();
                    }
                });
            });

            card.querySelectorAll('.st-del-custom-sample').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    const targetPlayer = btn.dataset.player;
                    const idx = parseInt(btn.dataset.idx, 10);
                    if (playerData[targetPlayer] && playerData[targetPlayer].customSamples) {
                        playerData[targetPlayer].customSamples.splice(idx, 1);
                        GM_setValue(STORAGE_PLAYER_DATA, playerData);
                        pushToGist(false);
                        updateModalContent();
                    }
                });
            });

            listContainer.appendChild(card);
        });
    }

    mountHeaderMenu();

    let scanTimeout = null;
    const observer = new MutationObserver(() => {
        if (!scanTimeout) {
            scanTimeout = setTimeout(() => {
                scanTimeout = null;
                scanRallyPoint();
            }, 300);
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

})();
