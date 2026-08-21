// ==UserScript==
// @name         Thronewake Map Travel Time Calculator
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Calculates distance, travel durations, and UTC arrival times on Thronewake. Features 2x default Server Speed, collapsible Research/Modifiers section, tile (t) terminology, and hotkeys.
// @author       petrgon
// @match        https://www.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
    'use strict';

    const SAVED_SRC_X     = 'tw_calc_src_x';
    const SAVED_SRC_Y     = 'tw_calc_src_y';
    const SAVED_TRG_X     = 'tw_calc_trg_x';
    const SAVED_TRG_Y     = 'tw_calc_trg_y';
    const SAVED_SERVER_SPD= 'tw_calc_server_speed';
    const SAVED_OPEN      = 'tw_calc_is_open';
    const SAVED_FACTION   = 'tw_calc_faction';
    const SAVED_MOD_OPEN  = 'tw_calc_modifiers_open';

    // Research & Building Storage Keys
    const SAVED_BANNER    = 'tw_calc_bannerfield';
    const SAVED_CARAVANS  = 'tw_calc_caravans';
    const SAVED_RECALL    = 'tw_calc_recall';
    const SAVED_ROADS     = 'tw_calc_roads';
    const SAVED_INFLUENCE = 'tw_calc_influence';

    // Thronewake faction unit speeds (tiles per hour)
    const FACTIONS = {
        embermark: {
            name: 'Embermark',
            color: '#991b1b', // Red
            units: [
                { name: 'Emberblade', speed: 6 },
                { name: 'Shieldbearer', speed: 5 },
                { name: 'Iron Spear', speed: 7 },
                { name: 'Sentinel', speed: 16 },
                { name: 'Sun Rider', speed: 14 },
                { name: 'Crimson Lancer', speed: 10 },
                { name: 'Iron Ram', speed: 4 },
                { name: 'Dominion Catapult', speed: 3 },
                { name: 'High Prefect', speed: 4 },
                { name: 'Settler', speed: 5 }
            ]
        },
        verdant: {
            name: 'Verdant',
            color: '#166534', // Green
            units: [
                { name: 'Briar Guard', speed: 7 },
                { name: 'Woodblade', speed: 6 },
                { name: 'Wind Scout', speed: 17 },
                { name: 'Stag Rider', speed: 19 },
                { name: 'Green Lancer', speed: 16 },
                { name: 'Oak Cavalier', speed: 13 },
                { name: 'Timber Ram', speed: 4 },
                { name: 'Stonecaster', speed: 3 },
                { name: 'Circle Elder', speed: 5 },
                { name: 'Settler', speed: 5 }
            ]
        },
        stormfang: {
            name: 'Stormfang',
            color: '#334155', // Gray-Blue
            units: [
                { name: 'Raider', speed: 7 },
                { name: 'Axeborn', speed: 7 },
                { name: 'War Brute', speed: 6 },
                { name: 'Pathstalker', speed: 9 },
                { name: 'Fang Rider', speed: 10 },
                { name: 'Blood Charger', speed: 9 },
                { name: 'War Ram', speed: 4 },
                { name: 'Skullthrower', speed: 3 },
                { name: 'Clan Warlord', speed: 4 },
                { name: 'Settler', speed: 5 }
            ]
        }
    };

    let pickingMode = null; // null | 'src' | 'trg'
    let pointerDownPos = null;
    let initiatedViaHotkey = false;

    // Inject CSS Animation for Ultra-Visible Magenta Map Markers
    if (!document.getElementById('tw-marker-styles')) {
        const style = document.createElement('style');
        style.id = 'tw-marker-styles';
        style.textContent = `
            @keyframes twMarkerPulse {
                0% { opacity: 0.85; transform: scale(0.95); }
                50% { opacity: 1.0; transform: scale(1.05); }
                100% { opacity: 0.85; transform: scale(0.95); }
            }
        `;
        document.head.appendChild(style);
    }

    function isMapRoute() {
        const path = window.location.pathname;
        return path === '/map' || path === '/map/';
    }

    // --- Time & Math Helpers ---

    function calculateDistance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function formatSeconds(totalSeconds) {
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = Math.floor(totalSeconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function formatArrivalTimeUTC(totalSeconds) {
        const arrival = new Date(Date.now() + totalSeconds * 1000);
        const hours = arrival.getUTCHours().toString().padStart(2, '0');
        const mins = arrival.getUTCMinutes().toString().padStart(2, '0');
        const secs = arrival.getUTCSeconds().toString().padStart(2, '0');
        return `${hours}:${mins}:${secs}`;
    }

    // Advanced Piecewise Distance Calculation Engine (Bannerfield & Local Influence aware)
    function calculateTripSeconds(distance, baseUnitSpeed, serverSpeedMultiplier, bannerLvl, caravansBonus, recallBonus, roadsBonus, influenceBonus) {
        if (distance <= 0) return 0;

        const flatResearchBonus = caravansBonus + recallBonus + roadsBonus;
        // Server Speed directly multiplies speed
        const baseSpeed = baseUnitSpeed * serverSpeedMultiplier * (1 + flatResearchBonus);

        // Define segment breakpoints on interval [0, distance]
        const points = [0, distance];
        if (distance > 20) points.push(20);

        const localInfThreshold = distance * 0.75;
        points.push(localInfThreshold);

        // Sort unique cut points
        const sortedPoints = Array.from(new Set(points)).sort((a, b) => a - b);

        let totalHours = 0;

        for (let i = 0; i < sortedPoints.length - 1; i++) {
            const p1 = sortedPoints[i];
            const p2 = sortedPoints[i + 1];
            const segLength = p2 - p1;
            const midPoint = (p1 + p2) / 2;

            // Bannerfield applies +20% per level ONLY beyond 20 tiles
            const bannerMultiplier = (midPoint > 20 && bannerLvl > 0) ? (1 + bannerLvl * 0.20) : 1.0;

            // Local Influence applies during final 25% of the trip
            const influenceMultiplier = (midPoint >= localInfThreshold && influenceBonus > 0) ? (1 + influenceBonus) : 1.0;

            const segSpeed = baseSpeed * bannerMultiplier * influenceMultiplier;
            totalHours += segLength / segSpeed;
        }

        return totalHours * 3600;
    }

    // --- Dynamic Map Marker System ---

    function resetCellZIndex(el) {
        if (!el) return;
        el.style.zIndex = '';
        const gridCell = el.closest('[role="gridcell"]');
        if (gridCell) gridCell.style.zIndex = '';
    }

    function removeMapMarkers() {
        document.querySelectorAll('.tw-calc-map-marker').forEach(el => {
            resetCellZIndex(el.parentElement);
            el.remove();
        });
    }

    function renderMapMarkers() {
        if (!isMapRoute()) {
            removeMapMarkers();
            return;
        }

        const widget = document.getElementById('tw-calc-widget');
        if (!widget || widget.style.display === 'none') {
            removeMapMarkers();
            return;
        }

        const x1 = parseInt(document.getElementById('tw-src-x')?.value, 10);
        const y1 = parseInt(document.getElementById('tw-src-y')?.value, 10);
        const x2 = parseInt(document.getElementById('tw-trg-x')?.value, 10);
        const y2 = parseInt(document.getElementById('tw-trg-y')?.value, 10);

        // Forest Green (#15803d) for Origin
        if (!isNaN(x1) && !isNaN(y1)) {
            const srcTile = findTileElement(x1, y1);
            updateMarkerOnTile('tw-marker-src', srcTile, '📍 Origin', '#15803d');
        } else {
            const el = document.getElementById('tw-marker-src');
            if (el) {
                resetCellZIndex(el.parentElement);
                el.remove();
            }
        }

        // Crimson Red (#dc2626) for Target
        if (!isNaN(x2) && !isNaN(y2)) {
            const trgTile = findTileElement(x2, y2);
            updateMarkerOnTile('tw-marker-trg', trgTile, '🎯 Target', '#dc2626');
        } else {
            const el = document.getElementById('tw-marker-trg');
            if (el) {
                resetCellZIndex(el.parentElement);
                el.remove();
            }
        }
    }

    function findTileElement(x, y) {
        let tile = document.querySelector(`button[aria-label="Map tile at ${x}, ${y}"]`) ||
                   document.querySelector(`[aria-label="Map tile at ${x}, ${y}"]`);
        if (tile) return tile;

        const srSpans = document.querySelectorAll('button span.sr-only, [role="gridcell"] span.sr-only');
        const targetText = `(${x}|${y})`;
        for (let i = 0; i < srSpans.length; i++) {
            if (srSpans[i].textContent.trim() === targetText) {
                return srSpans[i].closest('button') || srSpans[i].parentElement;
            }
        }

        return document.querySelector(`[aria-label*="(${x}|${y})"]`)?.closest('button, div') ||
               document.querySelector(`[aria-label*="${x}, ${y}"]`)?.closest('button, div') ||
               document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
    }

    function updateMarkerOnTile(markerId, tileEl, labelText, color) {
        let marker = document.getElementById(markerId);

        if (marker && marker.parentElement && marker.parentElement !== tileEl) {
            resetCellZIndex(marker.parentElement);
            marker.remove();
            marker = null;
        }

        if (!tileEl) {
            if (marker) marker.remove();
            return;
        }

        const gridCell = tileEl.closest('[role="gridcell"]') || tileEl.parentElement;
        if (gridCell) {
            gridCell.style.zIndex = '9999';
        }
        tileEl.style.zIndex = '9999';

        const computedPos = window.getComputedStyle(tileEl).position;
        if (computedPos === 'static') {
            tileEl.style.position = 'relative';
        }

        if (marker && marker.parentElement === tileEl) {
            return;
        }

        marker = document.createElement('div');
        marker.id = markerId;
        marker.className = 'tw-calc-map-marker';
        marker.style.cssText = `
            position: absolute; inset: 0; z-index: 99999;
            border: 3px solid ${color}; background: ${color}44;
            pointer-events: none; border-radius: 4px;
            display: flex; align-items: center; justify-content: center;
            box-shadow: inset 0 0 10px ${color}, 0 0 12px ${color};
            animation: twMarkerPulse 1.5s infinite ease-in-out;
        `;
        marker.innerHTML = `<span style="background:${color}; color:#ffffff; font-size:11px; font-weight:800; padding:2px 6px; border-radius:3px; white-space:nowrap; box-shadow:0 2px 6px rgba(0,0,0,0.7); text-shadow:0 1px 2px #000;">${labelText}</span>`;

        tileEl.appendChild(marker);
    }

    // --- UI Creation ---

    function injectUI() {
        if (document.getElementById('tw-calc-launcher')) return;

        // 1. Re-open Launcher Button
        const launcher = document.createElement('button');
        launcher.id = 'tw-calc-launcher';
        launcher.type = 'button';
        launcher.title = 'Open Travel Calculator (UTC) [Hotkeys: O/T, E/V/S]';
        launcher.style.cssText = `
            position: fixed; bottom: 45px; right: 18px; z-index: 999990;
            background: radial-gradient(circle, #f8f4e6 55%, #dcd3c6 100%);
            color: #4a3f35; border: 2px solid #101010;
            box-shadow: 0 0 0 3px #e2dacd, 0 0 0 4px #101010, inset 0 0 6px rgba(16,16,16,0.35), 0 6px 16px rgba(0,0,0,0.65);
            width: 44px; height: 44px; border-radius: 50%; font-size: 20px;
            cursor: pointer; display: ${isMapRoute() ? 'flex' : 'none'}; align-items: center; justify-content: center;
            user-select: none; transition: transform 0.15s ease-in-out;
        `;
        launcher.innerHTML = '🧭';

        launcher.onmouseenter = () => { launcher.style.transform = 'scale(1.08)'; };
        launcher.onmouseleave = () => { launcher.style.transform = 'scale(1.0)'; };
        launcher.onclick = toggleCalculator;
        document.body.appendChild(launcher);

        // 2. Calculator Main Widget
        const widget = document.createElement('div');
        widget.id = 'tw-calc-widget';
        widget.style.cssText = `
            position: fixed; bottom: 98px; right: 18px; z-index: 999995;
            background: #ece8d6; border: 2px solid #101010; padding: 16px;
            width: 410px; max-width: 95vw; min-width: 300px; height: auto;
            max-height: 82vh; border-radius: 4px; color: #101010;
            font-family: var(--font-sans, sans-serif); font-size: 14px;
            box-shadow: inset 0 0 10px rgba(16,16,16,0.25), 0 6px 18px rgba(0,0,0,0.6);
            display: none; flex-direction: column; overflow: auto; resize: both;
            user-select: none; touch-action: auto;
        `;

        const activeFaction   = GM_getValue(SAVED_FACTION, 'embermark');
        const activeServerSpd = GM_getValue(SAVED_SERVER_SPD, 2);
        const activeBanner    = GM_getValue(SAVED_BANNER, 0);
        const activeCaravans  = GM_getValue(SAVED_CARAVANS, 0);
        const activeRecall    = GM_getValue(SAVED_RECALL, 0);
        const activeRoads     = GM_getValue(SAVED_ROADS, 0);
        const activeInfluence = GM_getValue(SAVED_INFLUENCE, 0);
        const isModOpen       = GM_getValue(SAVED_MOD_OPEN, false);

        // Generate Bannerfield options (0..20)
        let bannerOptionsHtml = '';
        for (let i = 0; i <= 20; i++) {
            const bonusStr = i > 0 ? ` (+${i * 20}% >20 t)` : ' (None)';
            bannerOptionsHtml += `<option value="${i}" ${i === parseInt(activeBanner, 10) ? 'selected' : ''}>Lvl ${i}${bonusStr}</option>`;
        }

        widget.innerHTML = `
            <!-- Header -->
            <div id="tw-calc-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(16,16,16,0.25); padding-bottom: 8px; cursor: move; touch-action: none;">
                <span style="font-weight: 700; text-transform: uppercase; color: #6a5a48; font-size: 15px; font-family: var(--font-title, serif); letter-spacing: 0.5px;">🧭 Travel Calculator (UTC)</span>
                <button type="button" id="tw-calc-close-btn" style="background: #165eb9; color: #fff; border: 1px solid #101010; width: 26px; height: 26px; border-radius: 50%; font-size: 13px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; line-height: 1;">✕</button>
            </div>

            <!-- Faction Selector Bar -->
            <div id="tw-faction-bar" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                <button type="button" data-faction="embermark" style="background: #991b1b; color: #fff; border: 1px solid #101010; padding: 7px 4px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px; text-transform: uppercase; transition: opacity 0.15s, transform 0.15s;" title="Hotkey: E">Embermark (E)</button>
                <button type="button" data-faction="verdant" style="background: #166534; color: #fff; border: 1px solid #101010; padding: 7px 4px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px; text-transform: uppercase; transition: opacity 0.15s, transform 0.15s;" title="Hotkey: V">Verdant (V)</button>
                <button type="button" data-faction="stormfang" style="background: #334155; color: #fff; border: 1px solid #101010; padding: 7px 4px; font-size: 12px; font-weight: 700; cursor: pointer; border-radius: 3px; text-transform: uppercase; transition: opacity 0.15s, transform 0.15s;" title="Hotkey: S">Stormfang (S)</button>
            </div>

            <!-- Map Picker Action Bar -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                <button type="button" id="tw-pick-src" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border-radius: 3px; text-transform: uppercase;" title="Hotkey: O">📍 Pick Origin (O)</button>
                <button type="button" id="tw-pick-trg" style="background: #6a5a48; color: #fff; border: 1px solid #101010; padding: 8px; font-size: 13px; font-weight: 700; cursor: pointer; border-radius: 3px; text-transform: uppercase;" title="Hotkey: T">🎯 Pick Target (T)</button>
            </div>

            <!-- Coordinates Inputs -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div style="background: #f8f4e6; border: 1px solid #6a5a48; padding: 8px; border-radius: 3px;">
                    <label style="font-weight: 700; font-size: 12px; color: #6a5a48; display: block; text-transform: uppercase; margin-bottom: 4px;">Origin (X | Y)</label>
                    <div style="display: flex; gap: 6px;">
                        <input type="number" id="tw-src-x" value="${GM_getValue(SAVED_SRC_X, 0)}" placeholder="X" style="width: 50%; border: 1px solid #101010; background: #ece8d6; padding: 6px; font-size: 14px; font-weight: 600; text-align: center; border-radius: 2px;" />
                        <input type="number" id="tw-src-y" value="${GM_getValue(SAVED_SRC_Y, 0)}" placeholder="Y" style="width: 50%; border: 1px solid #101010; background: #ece8d6; padding: 6px; font-size: 14px; font-weight: 600; text-align: center; border-radius: 2px;" />
                    </div>
                </div>
                <div style="background: #f8f4e6; border: 1px solid #6a5a48; padding: 8px; border-radius: 3px;">
                    <label style="font-weight: 700; font-size: 12px; color: #6a5a48; display: block; text-transform: uppercase; margin-bottom: 4px;">Target (X | Y)</label>
                    <div style="display: flex; gap: 6px;">
                        <input type="number" id="tw-trg-x" value="${GM_getValue(SAVED_TRG_X, 0)}" placeholder="X" style="width: 50%; border: 1px solid #101010; background: #ece8d6; padding: 6px; font-size: 14px; font-weight: 600; text-align: center; border-radius: 2px;" />
                        <input type="number" id="tw-trg-y" value="${GM_getValue(SAVED_TRG_Y, 0)}" placeholder="Y" style="width: 50%; border: 1px solid #101010; background: #ece8d6; padding: 6px; font-size: 14px; font-weight: 600; text-align: center; border-radius: 2px;" />
                    </div>
                </div>
            </div>

            <!-- Collapsible Speed, Building & Research Section -->
            <div style="background: #f8f4e6; border: 1px solid #6a5a48; padding: 8px 10px; border-radius: 3px; margin-bottom: 10px;">
                <div id="tw-modifiers-header" style="font-weight: 700; color: #6a5a48; font-size: 12px; text-transform: uppercase; cursor: pointer; display: flex; justify-content: space-between; align-align: center; user-select: none;">
                    <span>🏛️ Server Speed, Buildings & Research</span>
                    <span id="tw-modifiers-arrow" style="font-size: 11px;">${isModOpen ? '▲' : '▼'}</span>
                </div>

                <div id="tw-modifiers-content" style="display: ${isModOpen ? 'grid' : 'none'}; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px; margin-top: 8px; border-top: 1px solid rgba(106,90,72,0.25); padding-top: 8px;">
                    <!-- Server Speed -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Server Speed:</label>
                        <select id="tw-server-speed" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            <option value="1" ${parseFloat(activeServerSpd) === 1 ? 'selected' : ''}>1x</option>
                            <option value="2" ${parseFloat(activeServerSpd) === 2 ? 'selected' : ''}>2x (Default)</option>
                            <option value="3" ${parseFloat(activeServerSpd) === 3 ? 'selected' : ''}>3x</option>
                            <option value="4" ${parseFloat(activeServerSpd) === 4 ? 'selected' : ''}>4x</option>
                            <option value="5" ${parseFloat(activeServerSpd) === 5 ? 'selected' : ''}>5x</option>
                            <option value="10" ${parseFloat(activeServerSpd) === 10 ? 'selected' : ''}>10x</option>
                        </select>
                    </div>

                    <!-- Bannerfield -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Bannerfield:</label>
                        <select id="tw-bannerfield" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            ${bannerOptionsHtml}
                        </select>
                    </div>

                    <!-- Swift Caravans -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Swift Caravans:</label>
                        <select id="tw-caravans" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            <option value="0" ${parseFloat(activeCaravans) === 0 ? 'selected' : ''}>None (0%)</option>
                            <option value="0.05" ${parseFloat(activeCaravans) === 0.05 ? 'selected' : ''}>Lvl I (+5%)</option>
                            <option value="0.10" ${parseFloat(activeCaravans) === 0.10 ? 'selected' : ''}>Lvl II (+10%)</option>
                            <option value="0.15" ${parseFloat(activeCaravans) === 0.15 ? 'selected' : ''}>Lvl III (+15%)</option>
                        </select>
                    </div>

                    <!-- Recall Signals -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Recall Signals:</label>
                        <select id="tw-recall" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            <option value="0" ${parseFloat(activeRecall) === 0 ? 'selected' : ''}>None (0%)</option>
                            <option value="0.05" ${parseFloat(activeRecall) === 0.05 ? 'selected' : ''}>Lvl I (+5%)</option>
                            <option value="0.10" ${parseFloat(activeRecall) === 0.10 ? 'selected' : ''}>Lvl II (+10%)</option>
                            <option value="0.15" ${parseFloat(activeRecall) === 0.15 ? 'selected' : ''}>Lvl III (+15%)</option>
                        </select>
                    </div>

                    <!-- Known Roads -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Known Roads:</label>
                        <select id="tw-roads" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            <option value="0" ${parseFloat(activeRoads) === 0 ? 'selected' : ''}>None (0%)</option>
                            <option value="0.02" ${parseFloat(activeRoads) === 0.02 ? 'selected' : ''}>Lvl I (+2%)</option>
                            <option value="0.04" ${parseFloat(activeRoads) === 0.04 ? 'selected' : ''}>Lvl II (+4%)</option>
                            <option value="0.06" ${parseFloat(activeRoads) === 0.06 ? 'selected' : ''}>Lvl III (+6%)</option>
                        </select>
                    </div>

                    <!-- Local Influence -->
                    <div>
                        <label style="font-weight: 600; color: #101010; display: block; margin-bottom: 2px;">Local Influence:</label>
                        <select id="tw-influence" style="width: 100%; border: 1px solid #101010; background: #ece8d6; padding: 4px; font-size: 12px; font-weight: 600; border-radius: 2px;">
                            <option value="0" ${parseFloat(activeInfluence) === 0 ? 'selected' : ''}>None (0%)</option>
                            <option value="0.03" ${parseFloat(activeInfluence) === 0.03 ? 'selected' : ''}>Lvl I (+3% final 1/4)</option>
                            <option value="0.06" ${parseFloat(activeInfluence) === 0.06 ? 'selected' : ''}>Lvl II (+6% final 1/4)</option>
                            <option value="0.10" ${parseFloat(activeInfluence) === 0.10 ? 'selected' : ''}>Lvl III (+10% final 1/4)</option>
                        </select>
                    </div>
                </div>
            </div>

            <!-- Distance Header -->
            <div style="font-weight: 700; margin-bottom: 8px; color: #6a5a48; display: flex; justify-content: space-between; font-size: 14px;">
                <span>Distance:</span>
                <span id="tw-calc-dist">0.00 tiles</span>
            </div>

            <!-- Unit Travel Times Table -->
            <div style="flex: 1; min-height: 160px; overflow-y: auto; border: 1px solid #101010; border-radius: 3px; background: #f8f4e6;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                    <thead>
                        <tr style="background: #6a5a48; color: #fff; text-align: left; font-size: 12px; text-transform: uppercase;">
                            <th style="padding: 6px 8px;">Unit Name</th>
                            <th style="padding: 6px 8px; text-align: center;">Duration</th>
                            <th style="padding: 6px 8px; text-align: right;">Arrival (UTC)</th>
                        </tr>
                    </thead>
                    <tbody id="tw-calc-results">
                        <!-- Dynamic content -->
                    </tbody>
                </table>
            </div>
        `;

        document.body.appendChild(widget);

        // Setup Draggable
        makeDraggable(widget, document.getElementById('tw-calc-header'));

        // Setup Collapsible Modifiers Header
        const modHeader = document.getElementById('tw-modifiers-header');
        const modContent = document.getElementById('tw-modifiers-content');
        const modArrow = document.getElementById('tw-modifiers-arrow');

        modHeader.onclick = () => {
            const currentlyOpen = modContent.style.display === 'grid';
            const newOpenState = !currentlyOpen;
            modContent.style.display = newOpenState ? 'grid' : 'none';
            modArrow.textContent = newOpenState ? '▲' : '▼';
            GM_setValue(SAVED_MOD_OPEN, newOpenState);
        };

        // Attach listeners
        document.getElementById('tw-calc-close-btn').onclick = toggleCalculator;

        document.getElementById('tw-pick-src').onclick = () => {
            initiatedViaHotkey = false;
            setPickingMode('src');
        };
        document.getElementById('tw-pick-trg').onclick = () => {
            initiatedViaHotkey = false;
            setPickingMode('trg');
        };

        // Faction bar listeners
        const factionBtns = document.querySelectorAll('#tw-faction-bar button');
        factionBtns.forEach(btn => {
            btn.onclick = () => {
                const selected = btn.getAttribute('data-faction');
                GM_setValue(SAVED_FACTION, selected);
                updateFactionUI(selected);
                updateCalculations();
            };
        });

        ['tw-src-x', 'tw-src-y', 'tw-trg-x', 'tw-trg-y', 'tw-server-speed', 'tw-bannerfield', 'tw-caravans', 'tw-recall', 'tw-roads', 'tw-influence'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', updateCalculations);
                el.addEventListener('change', updateCalculations);
            }
        });

        // Restore open state if on map
        if (isMapRoute() && GM_getValue(SAVED_OPEN, true)) {
            widget.style.display = 'flex';
            renderMapMarkers();
        }

        setupMapClickListener();
        setupHotkeys();
        updateFactionUI(activeFaction);
        updateCalculations();
    }

    function updateFactionUI(activeKey) {
        const factionBtns = document.querySelectorAll('#tw-faction-bar button');
        factionBtns.forEach(btn => {
            const key = btn.getAttribute('data-faction');
            if (key === activeKey) {
                btn.style.opacity = '1.0';
                btn.style.boxShadow = '0 0 0 2px #101010, inset 0 0 4px rgba(255,255,255,0.4)';
                btn.style.transform = 'scale(1.02)';
            } else {
                btn.style.opacity = '0.55';
                btn.style.boxShadow = 'none';
                btn.style.transform = 'scale(1.0)';
            }
        });
    }

    function toggleCalculator() {
        const widget = document.getElementById('tw-calc-widget');
        if (!widget) return;

        const isCurrentlyOpen = widget.style.display === 'flex';
        const newOpenState = !isCurrentlyOpen;

        widget.style.display = newOpenState ? 'flex' : 'none';
        GM_setValue(SAVED_OPEN, newOpenState);

        if (!newOpenState) {
            setPickingMode(null);
            removeMapMarkers();
        } else {
            renderMapMarkers();
        }
    }

    function checkRouteVisibility() {
        const launcher = document.getElementById('tw-calc-launcher');
        const widget = document.getElementById('tw-calc-widget');
        const onMap = isMapRoute();

        if (launcher) {
            launcher.style.display = onMap ? 'flex' : 'none';
        }
        if (widget) {
            if (onMap && GM_getValue(SAVED_OPEN, true)) {
                widget.style.display = 'flex';
                renderMapMarkers();
            } else {
                widget.style.display = 'none';
                removeMapMarkers();
            }
        }
    }

    // --- Draggable Movement ---

    function makeDraggable(element, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        const startDrag = (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            isDragging = true;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            startX = clientX;
            startY = clientY;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.left = `${initialLeft}px`;
            element.style.top = `${initialTop}px`;
        };

        const doDrag = (e) => {
            if (!isDragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const dx = clientX - startX;
            const dy = clientY - startY;

            element.style.left = `${initialLeft + dx}px`;
            element.style.top = `${initialTop + dy}px`;
        };

        const stopDrag = () => { isDragging = false; };

        handle.addEventListener('mousedown', startDrag);
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);

        handle.addEventListener('touchstart', startDrag, { passive: true });
        document.addEventListener('touchmove', doDrag, { passive: true });
        document.addEventListener('touchend', stopDrag);
    }

    // --- Hotkey Setup (O/T for Pick, E/V/S for Factions) ---

    function setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            const activeEl = document.activeElement;
            if (activeEl && (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) || activeEl.isContentEditable)) {
                return;
            }

            if (!isMapRoute()) return;

            const key = e.key.toLowerCase();

            // Faction hotkeys: E = Embermark, V = Verdant, S = Stormfang
            const factionMap = { 'e': 'embermark', 'v': 'verdant', 's': 'stormfang' };
            if (factionMap[key]) {
                e.preventDefault();
                const selectedFaction = factionMap[key];
                GM_setValue(SAVED_FACTION, selectedFaction);
                updateFactionUI(selectedFaction);
                updateCalculations();
                return;
            }

            // Origin / Target hotkeys: O = Origin, T = Target
            if (key === 'o' || key === 't') {
                e.preventDefault();

                const widget = document.getElementById('tw-calc-widget');
                if (widget && widget.style.display === 'none') {
                    toggleCalculator();
                }

                initiatedViaHotkey = true;
                setPickingMode(key === 'o' ? 'src' : 'trg');
            }
        });
    }

    // --- Interactive Map Coordinate Extraction (Pan-Aware & Intercepting) ---

    function setPickingMode(mode) {
        pickingMode = mode;
        const btnSrc = document.getElementById('tw-pick-src');
        const btnTrg = document.getElementById('tw-pick-trg');

        if (!btnSrc || !btnTrg) return;

        btnSrc.style.background = '#6a5a48';
        btnTrg.style.background = '#6a5a48';
        btnSrc.textContent = '📍 Pick Origin (O)';
        btnTrg.textContent = '🎯 Pick Target (T)';

        if (mode === 'src') {
            btnSrc.style.background = '#15803d';
            btnSrc.textContent = 'Click Map Tile...';
        } else if (mode === 'trg') {
            btnTrg.style.background = '#15803d';
            btnTrg.textContent = 'Click Map Tile...';
        }
    }

    function extractCoordsFromEvent(e) {
        let el = e.target;
        while (el && el !== document.body) {
            const ariaLabel = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';

            // 1. Check aria-label for "Map tile at X, Y"
            let match = ariaLabel.match(/Map tile at\s*(-?\d+),\s*(-?\d+)/i);
            if (match) {
                return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
            }

            // 2. Check inner text or title for (-24|-27)
            const textToSearch = (el.getAttribute ? (el.getAttribute('title') || '') : '') + ' ' + ariaLabel + ' ' + (el.textContent || '');
            match = textToSearch.match(/\((-?\d{1,3})\|(-?\d{1,3})\)/);
            if (match) {
                return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
            }

            // 3. Dataset check
            if (el.dataset) {
                if (el.dataset.x !== undefined && el.dataset.y !== undefined) {
                    return { x: parseInt(el.dataset.x, 10), y: parseInt(el.dataset.y, 10) };
                }
            }

            el = el.parentElement;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const urlX = urlParams.get('x');
        const urlY = urlParams.get('y');
        if (urlX !== null && urlY !== null) {
            return { x: parseInt(urlX, 10), y: parseInt(urlY, 10) };
        }

        return null;
    }

    function setupMapClickListener() {
        // Record pointer press position
        document.addEventListener('pointerdown', (e) => {
            if (!pickingMode) return;
            pointerDownPos = { x: e.clientX, y: e.clientY };
        }, true);

        // Capture CLICK event phase to cleanly suppress tile detail popups while picking
        document.addEventListener('click', (e) => {
            if (!pickingMode) return;

            const widget = document.getElementById('tw-calc-widget');
            const launcher = document.getElementById('tw-calc-launcher');
            if (widget && widget.contains(e.target)) return;
            if (launcher && launcher.contains(e.target)) return;

            // Calculate movement distance
            let dist = 0;
            if (pointerDownPos) {
                const dx = e.clientX - pointerDownPos.x;
                const dy = e.clientY - pointerDownPos.y;
                dist = Math.hypot(dx, dy);
                pointerDownPos = null;
            }

            // If mouse moved more than 6px, user was panning -> allow map movement and skip pick
            if (dist > 6) return;

            // Stop tile detail popup from opening on clean stationary click
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            const coords = extractCoordsFromEvent(e);
            if (coords) {
                if (pickingMode === 'src') {
                    document.getElementById('tw-src-x').value = coords.x;
                    document.getElementById('tw-src-y').value = coords.y;

                    // Check if Target is already set
                    const trgXVal = document.getElementById('tw-trg-x')?.value;
                    const trgYVal = document.getElementById('tw-trg-y')?.value;
                    const hasTarget = (trgXVal !== '' && trgYVal !== '' && (parseFloat(trgXVal) !== 0 || parseFloat(trgYVal) !== 0));

                    // If picked via hotkey O and a target already exists -> DO NOT auto-switch!
                    if (initiatedViaHotkey && hasTarget) {
                        setPickingMode(null);
                    } else {
                        setPickingMode('trg');
                    }
                } else if (pickingMode === 'trg') {
                    document.getElementById('tw-trg-x').value = coords.x;
                    document.getElementById('tw-trg-y').value = coords.y;
                    setPickingMode(null);
                }

                initiatedViaHotkey = false;
                updateCalculations();

                setTimeout(renderMapMarkers, 50);
                setTimeout(renderMapMarkers, 150);
                setTimeout(renderMapMarkers, 300);
            }
        }, true);

        const observer = new MutationObserver(() => {
            checkRouteVisibility();
            if (isMapRoute()) {
                renderMapMarkers();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // --- Calculation Engine ---

    function updateCalculations() {
        const x1 = parseFloat(document.getElementById('tw-src-x')?.value) || 0;
        const y1 = parseFloat(document.getElementById('tw-src-y')?.value) || 0;
        const x2 = parseFloat(document.getElementById('tw-trg-x')?.value) || 0;
        const y2 = parseFloat(document.getElementById('tw-trg-y')?.value) || 0;

        const serverSpeedMultiplier = parseFloat(document.getElementById('tw-server-speed')?.value) || 2;
        const bannerfieldLvl       = parseInt(document.getElementById('tw-bannerfield')?.value, 10) || 0;
        const caravansBonus        = parseFloat(document.getElementById('tw-caravans')?.value) || 0;
        const recallBonus          = parseFloat(document.getElementById('tw-recall')?.value) || 0;
        const roadsBonus           = parseFloat(document.getElementById('tw-roads')?.value) || 0;
        const influenceBonus       = parseFloat(document.getElementById('tw-influence')?.value) || 0;

        GM_setValue(SAVED_SRC_X, x1);
        GM_setValue(SAVED_SRC_Y, y1);
        GM_setValue(SAVED_TRG_X, x2);
        GM_setValue(SAVED_TRG_Y, y2);

        GM_setValue(SAVED_SERVER_SPD, serverSpeedMultiplier);
        GM_setValue(SAVED_BANNER, bannerfieldLvl);
        GM_setValue(SAVED_CARAVANS, caravansBonus);
        GM_setValue(SAVED_RECALL, recallBonus);
        GM_setValue(SAVED_ROADS, roadsBonus);
        GM_setValue(SAVED_INFLUENCE, influenceBonus);

        const distance = calculateDistance(x1, y1, x2, y2);
        const distEl = document.getElementById('tw-calc-dist');
        if (distEl) distEl.textContent = `${distance.toFixed(2)} tiles`;

        const tbody = document.getElementById('tw-calc-results');
        if (!tbody) return;
        tbody.innerHTML = '';

        const activeFactionKey = GM_getValue(SAVED_FACTION, 'embermark');
        const factionData = FACTIONS[activeFactionKey] || FACTIONS.embermark;

        factionData.units.forEach(u => {
            const totalSeconds = calculateTripSeconds(
                distance, u.speed, serverSpeedMultiplier,
                bannerfieldLvl, caravansBonus, recallBonus, roadsBonus, influenceBonus
            );

            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid rgba(16,16,16,0.1)';
            tr.innerHTML = `
                <td style="padding: 6px 8px; font-weight: 600;">${u.name} <span style="color:#6a5a48; font-weight:400;">(${u.speed} t/h)</span></td>
                <td style="padding: 6px 8px; text-align: center; font-weight: 700; color: #15803d;">${formatSeconds(totalSeconds)}</td>
                <td style="padding: 6px 8px; text-align: right; color: #334155; font-weight: 600;">${formatArrivalTimeUTC(totalSeconds)}</td>
            `;
            tbody.appendChild(tr);
        });

        renderMapMarkers();
    }

    // --- Init ---

    setTimeout(() => {
        injectUI();
        checkRouteVisibility();
    }, 400);
})();
