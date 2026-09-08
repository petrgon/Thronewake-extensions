// ==UserScript==
// @name         Thronewake Trade Route & Income Visualizer
// @namespace    https://www.thronewake.com/
// @version      5.9
// @description  Parses village income and trade routes with SVG map visualization, curved non-overlapping routes, mid-route arrows, dynamic status updates, tab-aware route scraping protection, section-scoped DOM selector targeting, unique route card indexing, sorted sidebar lists with linked village/route hover tooltips, intuitive stone-gray color coding, detailed resource breakdown tooltips, non-blocking label hitboxes, tile navigation, state storage, smart screen-aware tooltips, and mobile responsiveness.
// @author       Assistant
// @match        https://*.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'tw_auto_visualizer_data_v3';
    let activeMobileItemId = null;

    // --- State Storage ---
    function loadState() {
        try {
            const data = JSON.parse(GM_getValue(STORAGE_KEY, JSON.stringify({ villages: {}, routes: [], customItems: [] })));
            if (!data.customItems) data.customItems = [];
            if (!data.routes) data.routes = [];
            if (!data.villages) data.villages = {};
            return data;
        } catch (e) {
            return { villages: {}, routes: [], customItems: [] };
        }
    }

    function isMobile(window) {
        return window.innerWidth <= 768;
    }

    function saveState(stateData) {
        GM_setValue(STORAGE_KEY, JSON.stringify(stateData));
    }

    let state = loadState();

    // --- Delete Custom Marker ---
    function deleteCustomMarker(id) {
        if (!state.customItems) return;
        state.customItems = state.customItems.filter(item => item.id !== id);
        saveState(state);
        render();
    }

    // --- Helper: Resolve Village Name ---
    function getVillageName(x, y, fallbackName = '') {
        const key = `${x},${y}`;
        if (state.villages[key] && state.villages[key].name) {
            return state.villages[key].name;
        }
        return fallbackName || `Village (${x}|${y})`;
    }

    // --- Helper: Update Route Status Badge Text ---
    function updateRouteStatusBadge(parsedCount) {
        const statusEl = document.getElementById('tw-route-status');
        if (statusEl) {
            if (typeof parsedCount === 'number') {
                statusEl.textContent = `✓ Parsed ${parsedCount} (Total: ${state.routes.length})`;
                statusEl.style.color = '#28a745';
            } else {
                statusEl.textContent = `✓ Active (${state.routes.length})`;
                statusEl.style.color = '#e8d8b7';
            }
        }
    }

    // --- Scrape Current Active Village & Header Income Rates ---
    function scrapePageVillageData() {
        const activeVillageEl = document.querySelector('#_r_d_-select span') || document.querySelector('select[aria-label="Switch village"] option:checked');
        let text = activeVillageEl ? activeVillageEl.textContent.trim() : '';

        let coordMatch = text.match(/^(.*?)\s*\(([-+]?\d+)\|([-+]?\d+)\)$/);
        if (!coordMatch) {
            coordMatch = document.body.innerText.match(/([^\n\r(|]+)\s*\(([-+]?\d+)\|([-+]?\d+)\)/);
        }

        if (!coordMatch) return null;

        const name = coordMatch[1].trim();
        const x = parseInt(coordMatch[2], 10);
        const y = parseInt(coordMatch[3], 10);
        const key = `${x},${y}`;

        const rates = [];
        const resourceCols = document.querySelectorAll('header .grid.grid-cols-4 > div');

        if (resourceCols.length >= 4) {
            resourceCols.forEach(col => {
                const match = col.textContent.match(/([+-]?[\d,]+)\/h/);
                if (match) {
                    rates.push(parseInt(match[1].replace(/,/g, ''), 10));
                }
            });
        }

        if (rates.length < 4) {
            const allMatches = [...document.body.innerText.matchAll(/([+-]?[\d,]+)\/h/g)].map(m => parseInt(m[1].replace(/,/g, ''), 10));
            const uniqueRates = allMatches.filter((val, i, arr) => i === 0 || val !== arr[i - 1]);
            if (uniqueRates.length >= 4) {
                rates.length = 0;
                rates.push(...uniqueRates.slice(0, 4));
            }
        }

        if (rates.length >= 4) {
            state.villages[key] = {
                id: name,
                name: name,
                x: x,
                y: y,
                wood: rates[0] || 0,
                clay: rates[1] || 0,
                iron: rates[2] || 0,
                crop: rates[3] || 0,
                isPlaceholder: false,
                lastSeen: Date.now()
            };
            saveState(state);
        } else if (!state.villages[key]) {
            state.villages[key] = {
                id: name, name: name, x: x, y: y,
                wood: 0, clay: 0, iron: 0, crop: 0,
                isPlaceholder: true
            };
            saveState(state);
        }
        return state.villages[key];
    }

    // --- Locate "Trade routes" Header in Page ---
    function findTradeRoutesHeader() {
        const panelHeader = document.querySelector('#marketplace-send-panel h2');
        if (panelHeader && /Trade\s+routes/i.test(panelHeader.textContent)) {
            return panelHeader;
        }

        const h2s = document.querySelectorAll('h2');
        for (const h2 of h2s) {
            if (/Trade\s+routes/i.test(h2.textContent)) {
                return h2;
            }
        }
        return null;
    }

    // --- Scrape Precise Trade Route HTML Items ---
    function scrapeTradeRoutesFromDOM() {
        const origin = scrapePageVillageData();
        if (!origin) return 0;

        const header = findTradeRoutesHeader();
        const isTradeRoutesTab = window.location.href.includes('tab=marketplace-send') || !!header;

        if (!isTradeRoutesTab) return 0;

        const section = header ? header.closest('section') : document.getElementById('marketplace-send-panel');
        if (!section) return 0;

        const routeCards = section.querySelectorAll('ul > li.paper');
        const foundRoutes = [];

        routeCards.forEach((card, cardIdx) => {
            const checkbox = card.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) return;

            const tileLink = card.querySelector('a[href*="/map/tile/"]');
            if (!tileLink) return;

            const href = tileLink.getAttribute('href') || '';
            const tileMatch = href.match(/\/map\/tile\/([-+]?\d+)\/([-+]?\d+)/);
            const textContent = tileLink.textContent.trim();
            const textMatch = textContent.match(/^(.*?)\s*\(([-+]?\d+)\|([-+]?\d+)\)$/);

            let toX, toY, destName;

            if (textMatch) {
                destName = textMatch[1].trim();
                toX = parseInt(textMatch[2], 10);
                toY = parseInt(textMatch[3], 10);
            } else if (tileMatch) {
                toX = parseInt(tileMatch[1], 10);
                toY = parseInt(tileMatch[2], 10);
                destName = textContent.split('(')[0].trim() || `Village (${toX}|${toY})`;
            } else {
                return;
            }

            if (toX === origin.x && toY === origin.y) return;

            const targetKey = `${toX},${toY}`;
            if (!state.villages[targetKey]) {
                state.villages[targetKey] = {
                    id: destName,
                    name: destName,
                    x: toX,
                    y: toY,
                    wood: 0, clay: 0, iron: 0, crop: 0,
                    isPlaceholder: true
                };
            }

            // Extract Repeat Interval (e.g. "Every 2h" -> 2)
            const cardText = card.textContent;
            const repeatMatch = cardText.match(/Every\s+(\d+)h/i);
            const repeatHours = repeatMatch ? parseInt(repeatMatch[1], 10) : 1;

            // Extract Deliveries Count (e.g. "1 delivery", "2 deliveries" -> 1 or 2)
            const deliveryMatch = cardText.match(/(\d+)\s+deliveries?/i);
            const deliveries = deliveryMatch ? parseInt(deliveryMatch[1], 10) : 1;

            // Calculate overall hourly factor
            const hourlyMultiplier = deliveries / (repeatHours || 1);

            let wood = 0, clay = 0, iron = 0, crop = 0;
            const resBoxes = card.querySelectorAll('div.flex.items-center.gap-1');

            resBoxes.forEach(box => {
                const srLabel = box.querySelector('.sr-only');
                const valSpan = box.querySelector('span:not(.sr-only)');

                if (srLabel && valSpan) {
                    const label = srLabel.textContent.trim().toLowerCase();
                    const val = parseInt(valSpan.textContent.replace(/,/g, ''), 10);

                    if (!isNaN(val)) {
                        if (label === 'lumber' || label === 'wood') wood += val;
                        else if (label === 'stone' || label === 'clay') clay += val;
                        else if (label === 'metal' || label === 'iron') iron += val;
                        else if (label === 'food' || label === 'crop') crop += val;
                    }
                }
            });

            // Convert to true rate per hour
            const hourlyWood = Math.round(wood * hourlyMultiplier);
            const hourlyClay = Math.round(clay * hourlyMultiplier);
            const hourlyIron = Math.round(iron * hourlyMultiplier);
            const hourlyCrop = Math.round(crop * hourlyMultiplier);

            const routeId = `route_${origin.x}_${origin.y}_to_${toX}_${toY}_idx_${cardIdx}`;
            foundRoutes.push({
                id: routeId,
                fromX: origin.x,
                fromY: origin.y,
                toX: toX,
                toY: toY,
                destName: destName,
                wood: hourlyWood,
                clay: hourlyClay,
                iron: hourlyIron,
                crop: hourlyCrop,
                repeatHours: repeatHours,
                deliveries: deliveries,
                rawWood: wood,
                rawClay: clay,
                rawIron: iron,
                rawCrop: crop
            });
        });

        const otherRoutes = state.routes.filter(r => !(r.fromX === origin.x && r.fromY === origin.y));
        state.routes = [...otherRoutes, ...foundRoutes];
        saveState(state);

        return foundRoutes.length;
    }

    function injectTradeRouteControls() {
        const header = findTradeRoutesHeader();
        if (!header) return;

        if (!document.getElementById('tw-reparse-routes-btn')) {
            const container = document.createElement('span');
            container.id = 'tw-route-controls-wrap';
            container.style.cssText = `
                margin-left: 12px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                font-weight: normal;
                text-transform: none;
                vertical-align: middle;
            `;

            container.innerHTML = `
                <span id="tw-route-status" style="
                    background: #23201c;
                    color: #e8d8b7;
                    border: 1px solid #8c6d46;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                ">📦 Stored: ${state.routes.length}</span>
                <button id="tw-reparse-routes-btn" type="button" style="
                    background: #165eb9;
                    color: #ffffff;
                    border: 1px solid #8c6d46;
                    padding: 3px 9px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: bold;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                ">Reparse Routes</button>
            `;

            header.appendChild(container);

            const reparseBtn = document.getElementById('tw-reparse-routes-btn');
            reparseBtn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const statusEl = document.getElementById('tw-route-status');
                if (statusEl) {
                    statusEl.textContent = 'Parsing...';
                    statusEl.style.color = '#ffc107';
                }

                setTimeout(() => {
                    const count = scrapeTradeRoutesFromDOM();
                    updateRouteStatusBadge(count);
                    render();
                }, 200);
            };
        }

        setTimeout(() => {
            const count = scrapeTradeRoutesFromDOM();
            updateRouteStatusBadge(count);
        }, 300);
    }

    function getRouteColor(route) {
        const hasWood = (route.wood || 0) > 0;
        const hasClay = (route.clay || 0) > 0;
        const hasIron = (route.iron || 0) > 0;
        const hasCrop = (route.crop || 0) > 0;
        const count = [hasWood, hasClay, hasIron, hasCrop].filter(Boolean).length;

        if (count === 1) {
            if (hasWood) return '#b45309';
            if (hasClay) return '#94a3b8';
            if (hasIron) return '#38bdf8';
            if (hasCrop) return '#f43f5e';
        }

        if (count > 1) {
            return hasCrop ? '#fbbf24' : '#a855f7';
        }

        return '#165eb9';
    }

    function injectStyles() {
        const css = `
            :root {
                --tw-paper-brown: #8c6d46;
                --tw-paper-dark: #1e1b18;
                --tw-paper-light: #e8d8b7;
                --tw-blue-primary: #165eb9;
                --tw-blue-hover: #1c6ed8;
            }
            #tw-graph-btn {
                display: inline-flex; align-items: center; gap: 6px;
                margin-left: 10px; background: var(--tw-blue-primary); color: #fff;
                border: 1px solid var(--tw-paper-brown); padding: 4px 10px; font-size: 12px;
                font-weight: bold; cursor: pointer; border-radius: 4px;
                vertical-align: middle; box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                white-space: nowrap;
            }
            #tw-graph-btn:hover { background: var(--tw-blue-hover); }
            #tw-reset-btn {
                background: #8b0000; color: #fff; border: 1px solid var(--tw-paper-brown);
                padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;
                border-radius: 4px; transition: background 0.1s ease;
            }
            #tw-reset-btn:hover { background: #b22222; }
            #tw-modal-overlay {
                display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85);
                z-index: 999999; justify-content: center; align-items: center; backdrop-filter: blur(2px);
            }
            .tw-modal {
                background: var(--tw-paper-dark); color: var(--tw-paper-light);
                border: 2px solid var(--tw-paper-brown); width: 90vw; height: 85vh;
                border-radius: 6px; display: flex; flex-direction: column; position: relative;
                font-family: ui-sans-serif, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.9);
            }
            .tw-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 20px; background: #141210; border-bottom: 1px solid var(--tw-paper-brown);
            }
            .tw-body { display: flex; flex: 1; overflow: hidden; }
            .tw-sidebar {
                width: 280px; background: #161412; padding: 15px;
                border-right: 1px solid var(--tw-paper-brown); overflow-y: auto;
            }
            .tw-canvas-container { flex: 1; position: relative; background: #0c0b0a; overflow: hidden; }
            .tw-close { cursor: pointer; font-size: 22px; font-weight: bold; color: var(--tw-paper-light); }
            .tw-close:hover { color: #fff; }
            .tw-tooltip {
                position: fixed; background: #141210; border: 1px solid var(--tw-paper-brown);
                color: var(--tw-paper-light); padding: 10px 14px; border-radius: 4px;
                pointer-events: none; display: none; z-index: 10000000; font-size: 12px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.8); max-width: 350px; word-break: break-word;
            }
            .tw-list-item {
                background: #23201c; padding: 8px 10px; margin-bottom: 6px;
                border-radius: 4px; border: 1px solid #332e28; font-size: 12px;
                display: flex; justify-content: space-between; align-items: center;
                transition: background 0.15s ease, border-color 0.15s ease;
            }
            .tw-list-item:hover {
                background: #2d2924; border-color: #8c6d46;
            }
            .tw-legend {
                position: absolute; bottom: 15px; right: 15px;
                background: #141210; border: 1px solid var(--tw-paper-brown);
                color: var(--tw-paper-light); padding: 10px 12px; border-radius: 6px;
                font-size: 11px; z-index: 100000; box-shadow: 0 4px 12px rgba(0,0,0,0.7);
                pointer-events: none;
            }
            .tw-legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
            .tw-legend-item:last-child { margin-bottom: 0; }
            .tw-legend-color { width: 14px; height: 10px; border-radius: 2px; display: inline-block; }
            .tw-route-path, .tw-route-arrow { transition: opacity 0.15s ease, stroke-width 0.15s ease; }

            #tw-add-custom-btn {
                position: absolute; top: 12px; left: 12px; z-index: 10000;
                background: #165eb9; color: #fff; border: 1px solid var(--tw-paper-brown);
                padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;
                border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.6);
            }
            #tw-add-custom-btn:hover { background: #1c6ed8; }
            .tw-add-modal-popover {
                display: none; position: absolute; top: 50px; left: 12px; z-index: 100001;
                background: #141210; border: 1px solid var(--tw-paper-brown); padding: 14px;
                border-radius: 6px; width: 220px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.9);
            }
            .tw-add-modal-popover label { display: block; margin-bottom: 3px; font-weight: bold; color: #e8d8b7; }
            .tw-add-modal-popover input, .tw-add-modal-popover textarea {
                width: 100%; background: #23201c; color: #fff; border: 1px solid #443c33;
                border-radius: 4px; padding: 4px 6px; font-size: 12px; margin-bottom: 8px; box-sizing: border-box;
            }
            .tw-add-modal-popover input[type="color"] { height: 28px; padding: 1px; cursor: pointer; }
            .tw-popover-btns { display: flex; gap: 6px; justify-content: flex-end; }
            .tw-popover-btns button {
                padding: 4px 8px; font-size: 11px; font-weight: bold; border-radius: 3px; cursor: pointer; border: none;
            }
            .tw-del-btn {
                background: transparent; color: #ff6b6b; border: none; cursor: pointer;
                font-size: 13px; font-weight: bold; padding: 0 4px;
            }
            .tw-del-btn:hover { color: #ff0000; }

            /* --- Mobile View Adjustments --- */
            @media (max-width: 768px) {
                .tw-modal {
                    width: 95vw;
                    height: 90vh;
                }
                .tw-body {
                    flex-direction: column;
                }
                .tw-sidebar {
                    width: 100% !important;
                    height: 100% !important;
                    border-right: none !important;
                    border-bottom: none !important;
                }
                .tw-canvas-container {
                    display: none !important;
                }
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // --- Smart Tooltip Renderer (Adapts to Screen Boundaries) ---
    function showTooltip(html, e) {
        const tooltip = document.getElementById('tw-tooltip');
        if (!tooltip) return;

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';

        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : window.innerWidth / 2);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : window.innerHeight / 2);

        const ttWidth = tooltip.offsetWidth;
        const ttHeight = tooltip.offsetHeight;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        let left = clientX + 15;
        let top = clientY + 15;

        // Render above cursor if overflowing screen bottom
        if (top + ttHeight > winHeight - 10) {
            top = clientY - ttHeight - 15;
        }

        // Render to left of cursor if overflowing screen right
        if (left + ttWidth > winWidth - 10) {
            left = clientX - ttWidth - 15;
        }

        // Clamp values to stay within visible screen bounds
        left = Math.max(10, Math.min(left, winWidth - ttWidth - 10));
        top = Math.max(10, Math.min(top, winHeight - ttHeight - 10));

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    function deactivateTooltip() {
        const tooltip = document.getElementById('tw-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    // --- Interaction Handler for Desktop Hover vs Mobile 2-Tap Navigation ---
    function handleInteractiveElement(el, itemId, navUrl, getTooltipContent, onActivate, onDeactivate) {
        // Desktop Hover
        el.onmousemove = (e) => {
            if (window.innerWidth > 768) {
                if (onActivate) onActivate();
                showTooltip(getTooltipContent(), e);
            }
        };

        el.onmouseleave = () => {
            if (window.innerWidth > 768) {
                if (onDeactivate) onDeactivate();
                deactivateTooltip();
            }
        };

        // Click / Touch interaction
        el.onclick = (e) => {
            if (isMobile(window)) {
                if (activeMobileItemId !== itemId) {
                    e.preventDefault();
                    e.stopPropagation();
                    activeMobileItemId = itemId;
                    if (onActivate) onActivate();
                    showTooltip(getTooltipContent(), e);
                    return;
                }
            }

            activeMobileItemId = null;
            deactivateTooltip();

            if (navUrl) {
                window.location.href = navUrl;
            }
        };
    }

    function createUI() {
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'tw-modal-overlay';
        overlay.innerHTML = `
            <div class="tw-modal">
                <div class="tw-header">
                    <strong style="font-size: 15px;">Thronewake Territory & Trade Map</strong>
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <button id="tw-reset-btn" type="button">🗑️ Reset Data</button>
                        <span class="tw-close" id="tw-close-modal">&times;</span>
                    </div>
                </div>
                <div class="tw-body">
                    <div class="tw-sidebar">
                        <h3 style="margin-top:0; font-size: 13px; border-bottom: 1px solid var(--tw-paper-brown); padding-bottom: 6px; color: #fff;">Discovered Villages & Routes</h3>
                        <div id="tw-village-list"></div>
                    </div>
                    <div class="tw-canvas-container" id="tw-canvas-container">
                        <button id="tw-add-custom-btn" type="button">➕ Add Marker</button>
                        <div class="tw-add-modal-popover" id="tw-add-modal-popover">
                            <strong style="display:block; margin-bottom:8px; color:#fff;">Add Custom Map Marker</strong>
                            <div style="display:flex; gap:6px;">
                                <div style="flex:1;">
                                    <label>X Coord:</label>
                                    <input type="number" id="tw-new-x" placeholder="e.g. -15" />
                                </div>
                                <div style="flex:1;">
                                    <label>Y Coord:</label>
                                    <input type="number" id="tw-new-y" placeholder="e.g. -39" />
                                </div>
                            </div>
                            <label>Header / Title:</label>
                            <input type="text" id="tw-new-title" placeholder="Outpost / Target" />
                            <label>Note / Description:</label>
                            <textarea id="tw-new-note" rows="2" placeholder="Optional details..."></textarea>
                            <label>Marker Color:</label>
                            <input type="color" id="tw-new-color" value="#ff007f" />
                            <div class="tw-popover-btns">
                                <button type="button" id="tw-cancel-marker-btn" style="background:#555; color:#fff;">Cancel</button>
                                <button type="button" id="tw-save-marker-btn" style="background:#28a745; color:#fff;">Save</button>
                            </div>
                        </div>
                        <svg id="tw-svg" width="100%" height="100%"></svg>
                        <div class="tw-legend">
                            <strong style="display:block; margin-bottom: 6px; border-bottom: 1px solid #332e28; padding-bottom: 2px;">Route Color Legend</strong>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#fbbf24;"></span> Mixed (with Food)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#a855f7;"></span> Mixed (without Food)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#b45309;"></span> Wood (Lumber)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#94a3b8;"></span> Stone (Clay)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#38bdf8;"></span> Iron (Metal)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#f43f5e;"></span> Food (Crop)</div>
                        </div>
                    </div>
                </div>
                <div class="tw-tooltip" id="tw-tooltip"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // Clear active tooltip when tapping outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.tw-list-item') && !e.target.closest('g') && !e.target.closest('#tw-tooltip')) {
                activeMobileItemId = null;
                deactivateTooltip();
            }
        });

        document.getElementById('tw-close-modal').onclick = () => { overlay.style.display = 'none'; };

        document.getElementById('tw-reset-btn').onclick = () => {
            if (confirm('Clear all stored village income, trade route, and custom marker data?')) {
                state = { villages: {}, routes: [], customItems: [] };
                saveState(state);
                scrapePageVillageData();
                render();
                updateRouteStatusBadge(0);
            }
        };

        const addBtn = document.getElementById('tw-add-custom-btn');
        const popover = document.getElementById('tw-add-modal-popover');
        const saveMarkerBtn = document.getElementById('tw-save-marker-btn');
        const cancelMarkerBtn = document.getElementById('tw-cancel-marker-btn');

        addBtn.onclick = (e) => {
            e.stopPropagation();
            popover.style.display = popover.style.display === 'block' ? 'none' : 'block';
        };

        cancelMarkerBtn.onclick = () => { popover.style.display = 'none'; };

        saveMarkerBtn.onclick = () => {
            const xVal = parseInt(document.getElementById('tw-new-x').value, 10);
            const yVal = parseInt(document.getElementById('tw-new-y').value, 10);
            const titleVal = document.getElementById('tw-new-title').value.trim() || 'Custom Point';
            const noteVal = document.getElementById('tw-new-note').value.trim();
            const colorVal = document.getElementById('tw-new-color').value || '#ff007f';

            if (isNaN(xVal) || isNaN(yVal)) {
                alert('Please enter valid numeric X and Y coordinates.');
                return;
            }

            if (!state.customItems) state.customItems = [];
            state.customItems.push({
                id: `custom_${Date.now()}`,
                x: xVal,
                y: yVal,
                title: titleVal,
                note: noteVal,
                color: colorVal
            });

            saveState(state);
            popover.style.display = 'none';
            document.getElementById('tw-new-x').value = '';
            document.getElementById('tw-new-y').value = '';
            document.getElementById('tw-new-title').value = '';
            document.getElementById('tw-new-note').value = '';
            render();
        };

        let lastObservedVillage = '';
        const observer = new MutationObserver(() => {
            injectHeaderButton();
            injectTradeRouteControls();

            const selectEl = document.querySelector('#_r_d_-select');
            if (selectEl) {
                const currentText = selectEl.textContent.trim();
                if (currentText !== lastObservedVillage) {
                    lastObservedVillage = currentText;
                    setTimeout(() => {
                        scrapePageVillageData();
                        const parsedCount = scrapeTradeRoutesFromDOM();
                        updateRouteStatusBadge(parsedCount);
                        render();
                    }, 300);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        injectHeaderButton();
        injectTradeRouteControls();
    }

    function injectHeaderButton() {
        if (document.getElementById('tw-graph-btn')) return;

        const selectEl = document.querySelector('#_r_d_-select');
        let targetEl = null;

        if (selectEl) {
            targetEl = selectEl.closest('.relative.flex.min-w-0') || selectEl.closest('.relative.w-fit')?.parentElement;
        }

        if (!targetEl) {
            const candidates = document.querySelectorAll('div, span, h1, h2, h3');
            for (const el of candidates) {
                if (el.children.length <= 2 && /\([-+]?\d+\|[-+]?\d+\)/.test(el.textContent)) {
                    targetEl = el;
                    break;
                }
            }
        }

        if (targetEl) {
            const btn = document.createElement('button');
            btn.id = 'tw-graph-btn';
            if (isMobile(window)) {
                btn.innerHTML = 'TG';
            } else {
                btn.innerHTML = 'Trade Graph';
            }
            btn.onclick = (e) => {
                e.stopPropagation();
                scrapePageVillageData();
                const parsedCount = scrapeTradeRoutesFromDOM();
                updateRouteStatusBadge(parsedCount);
                document.getElementById('tw-modal-overlay').style.display = 'flex';
                render();
            };
            targetEl.appendChild(btn);
        }
    }

    // --- Helper: Format Resource Line in Tooltip ---
    function formatResourceTooltipLine(icon, name, base, inc, out) {
        const total = base + inc - out;
        let routeDetails = '';
        if (inc > 0 || out > 0) {
            const incStr = inc > 0 ? `+${inc.toLocaleString()}` : '0';
            const outStr = out > 0 ? `-${out.toLocaleString()}` : '0';
            routeDetails = ` <span style="color:#aaa;">(base: ${base.toLocaleString()} | in: ${incStr} | out: ${outStr})</span>`;
        } else {
            routeDetails = ` <span style="color:#aaa;">(base: ${base.toLocaleString()})</span>`;
        }
        return `${icon} ${name}: <strong>${total.toLocaleString()}/h</strong>${routeDetails}`;
    }

    function getVillageTooltipHtml(v) {
        let incWood = 0, incClay = 0, incIron = 0, incCrop = 0;
        let outWood = 0, outClay = 0, outIron = 0, outCrop = 0;

        state.routes.forEach(r => {
            if (r.toX === v.x && r.toY === v.y) {
                incWood += (r.wood || 0);
                incClay += (r.clay || 0);
                incIron += (r.iron || 0);
                incCrop += (r.crop || 0);
            }
            if (r.fromX === v.x && r.fromY === v.y) {
                outWood += (r.wood || 0);
                outClay += (r.clay || 0);
                outIron += (r.iron || 0);
                outCrop += (r.crop || 0);
            }
        });

        return `
            <strong style="color:#fff">${v.name} (${v.x}|${v.y})</strong><br/>
            ${formatResourceTooltipLine('🌲', 'Lumber', v.wood || 0, incWood, outWood)}<br/>
            ${formatResourceTooltipLine('🧱', 'Stone', v.clay || 0, incClay, outClay)}<br/>
            ${formatResourceTooltipLine('⛏️', 'Metal', v.iron || 0, incIron, outIron)}<br/>
            ${formatResourceTooltipLine('🥩', 'Food', v.crop || 0, incCrop, outCrop)}
            ${window.innerWidth <= 768 ? '<br/><span style="font-size:10px; color:#ffc107;">Tap again to navigate</span>' : ''}
        `;
    }

    function getRouteTooltipHtml(r) {
        const fromName = getVillageName(r.fromX, r.fromY);
        const toName = r.destName || getVillageName(r.toX, r.toY);
        const schedInfo = (r.repeatHours && r.deliveries)
            ? `<span style="color:#aaa;">Schedule: ${r.deliveries}x delivery every ${r.repeatHours}h</span><br/>`
            : '';

        return `
            <strong style="color:var(--tw-paper-light)">Trade Route Details</strong><br/>
            From: <strong>${fromName}</strong> (${r.fromX}|${r.fromY})<br/>
            To: <strong>${toName}</strong> (${r.toX}|${r.toY})<br/>
            ${schedInfo}
            🌲 Lumber: +${(r.wood || 0).toLocaleString()}/h<br/>
            🧱 Stone: +${(r.clay || 0).toLocaleString()}/h<br/>
            ⛏️ Metal: +${(r.iron || 0).toLocaleString()}/h<br/>
            🥩 Food: +${(r.crop || 0).toLocaleString()}/h
        `;
    }

    // --- Render SVG Graph ---
    function render() {
        const villages = Object.values(state.villages);
        const routes = state.routes;
        const customItems = state.customItems || [];
        const svg = document.getElementById('tw-svg');
        const container = document.getElementById('tw-canvas-container');
        const sidebarList = document.getElementById('tw-village-list');

        svg.innerHTML = '';
        sidebarList.innerHTML = '';

        if (villages.length === 0 && customItems.length === 0) {
            sidebarList.innerHTML = '<div style="font-size:12px; color:#888;">No villages auto-parsed yet. Navigate around your villages to register them automatically.</div>';
            return;
        }

        // Coordinate Bounds Calculation
        const allXs = [...villages.map(v => v.x), ...customItems.map(c => c.x)];
        const allYs = [...villages.map(v => v.y), ...customItems.map(c => c.y)];

        let minX = Math.min(...allXs), maxX = Math.max(...allXs);
        let minY = Math.min(...allYs), maxY = Math.max(...allYs);

        minX -= 5; maxX += 5; minY -= 5; maxY += 5;
        const width = container.clientWidth || 600;
        const height = container.clientHeight || 500;

        const mapX = (x) => ((x - minX) / ((maxX - minX) || 1)) * (width - 100) + 50;
        const mapY = (y) => height - (((y - minY) / ((maxY - minY) || 1)) * (height - 100) + 50);

        const routeGroupMap = new Map();
        routes.forEach(r => {
            const dirKey = `${r.fromX},${r.fromY}_to_${r.toX},${r.toY}`;
            if (!routeGroupMap.has(dirKey)) routeGroupMap.set(dirKey, []);
            routeGroupMap.get(dirKey).push(r);
        });

        const routesGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        routesGroupElement.id = 'tw-routes-group';

        const nodesGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodesGroupElement.id = 'tw-nodes-group';

        svg.appendChild(routesGroupElement);
        svg.appendChild(nodesGroupElement);

        const routeDomMap = new Map();

        function activateRouteHighlight(path, arrow) {
            routesGroupElement.querySelectorAll('.tw-route-path, .tw-route-arrow').forEach(p => p.style.opacity = '0.25');
            path.style.opacity = '1';
            arrow.style.opacity = '1';
            path.setAttribute('stroke-width', '5');
            routesGroupElement.appendChild(path);
            routesGroupElement.appendChild(arrow);
        }

        function deactivateRouteHighlight() {
            routesGroupElement.querySelectorAll('.tw-route-path, .tw-route-arrow').forEach(p => {
                p.style.opacity = '1';
                p.setAttribute('stroke-width', '3');
            });
            deactivateTooltip();
        }

        // --- Render Trade Routes on SVG ---
        routes.forEach(r => {
            const x1 = mapX(r.fromX), y1 = mapY(r.fromY);
            const x2 = mapX(r.toX), y2 = mapY(r.toY);
            const color = getRouteColor(r);

            const dx = x2 - x1;
            const dy = y2 - y1;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            const nx = -dy / dist;
            const ny = dx / dist;

            const dirKey = `${r.fromX},${r.fromY}_to_${r.toX},${r.toY}`;
            const group = routeGroupMap.get(dirKey) || [r];
            const index = group.indexOf(r);

            const baseOffset = 25;
            const offsetSpacing = 18;
            const distanceScale = Math.min(Math.max(dist / 250, 0.8), 2.0);
            const curveOffset = (baseOffset + index * offsetSpacing) * distanceScale;

            const cx = (x1 + x2) / 2 + nx * curveOffset;
            const cy = (y1 + y2) / 2 + ny * curveOffset;

            const mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
            const my = 0.25 * y1 + 0.5 * cy + 0.25 * y2;

            const arrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '3');
            path.setAttribute('fill', 'none');
            path.setAttribute('class', 'tw-route-path');
            path.style.cursor = 'pointer';

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', '-7,-5 6,0 -7,5');
            arrow.setAttribute('fill', color);
            arrow.setAttribute('transform', `translate(${mx}, ${my}) rotate(${arrowAngle})`);
            arrow.setAttribute('class', 'tw-route-arrow');
            arrow.style.pointerEvents = 'none';

            path.onmousemove = (e) => {
                activateRouteHighlight(path, arrow);
                showTooltip(getRouteTooltipHtml(r), e);
            };
            path.onmouseleave = () => deactivateRouteHighlight();

            routesGroupElement.appendChild(path);
            routesGroupElement.appendChild(arrow);

            routeDomMap.set(r.id, { route: r, path: path, arrow: arrow });
        });

        // --- Render Villages on SVG ---
        villages.forEach(v => {
            const cx = mapX(v.x), cy = mapY(v.y);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.style.cursor = 'pointer';

            const nodeColor = v.isPlaceholder ? '#ffc107' : '#165eb9';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', '7');
            circle.setAttribute('fill', nodeColor);
            circle.setAttribute('stroke', '#e8d8b7');
            circle.setAttribute('stroke-width', '2');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', cx + 12); text.setAttribute('y', cy + 4);
            text.setAttribute('fill', '#e8d8b7'); text.setAttribute('font-size', '12px');
            text.setAttribute('font-weight', 'bold');
            text.style.pointerEvents = 'none';
            text.textContent = `${v.name} (${v.x}|${v.y})`;

            g.appendChild(circle); g.appendChild(text);

            const vId = `node_v_${v.x}_${v.y}`;
            const navUrl = `/map/tile/${v.x}/${v.y}?center=true`;

            handleInteractiveElement(
                g,
                vId,
                navUrl,
                () => getVillageTooltipHtml(v),
                null,
                deactivateTooltip
            );

            nodesGroupElement.appendChild(g);
        });

        // --- Render Custom Map Markers on SVG ---
        customItems.forEach(c => {
            const cx = mapX(c.x), cy = mapY(c.y);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.style.cursor = 'pointer';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', '6');
            circle.setAttribute('fill', c.color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '1.5');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', cx + 12); text.setAttribute('y', cy + 4);
            text.setAttribute('fill', c.color); text.setAttribute('font-size', '12px');
            text.setAttribute('font-weight', 'bold');
            text.style.pointerEvents = 'none';
            text.textContent = `${c.title} (${c.x}|${c.y})`;

            g.appendChild(circle); g.appendChild(text);

            const cId = `node_c_${c.id}`;
            const navUrl = `/map/tile/${c.x}/${c.y}?center=true`;
            const getHtml = () => `
                <strong style="color:${c.color}">${c.title} (${c.x}|${c.y})</strong><br/>
                ${c.note ? `<span style="color:#ddd;">${c.note}</span><br/>` : ''}
                <hr style="border:0; border-top:1px solid #332e28; margin: 4px 0;"/>
                <span style="font-size:10px; color:#aaa;">Click / tap again to view tile map</span>
            `;

            handleInteractiveElement(
                g,
                cId,
                navUrl,
                getHtml,
                null,
                deactivateTooltip
            );

            nodesGroupElement.appendChild(g);
        });

        // --- Render Sorted Sidebar Content ---

        // 1. Sidebar: Sorted Villages
        const sortedVillages = [...villages].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
        );

        const vHeader = document.createElement('div');
        vHeader.style.cssText = 'font-weight:bold; margin-bottom: 6px; color:#e8d8b7;';
        vHeader.textContent = `Villages (${sortedVillages.length}):`;
        sidebarList.appendChild(vHeader);

        sortedVillages.forEach(v => {
            const div = document.createElement('div');
            div.className = 'tw-list-item';
            div.style.cursor = 'pointer';
            div.innerHTML = `<span>🏡 ${v.name} (${v.x}|${v.y})</span>`;

            const sidebarVId = `sidebar_v_${v.x}_${v.y}`;
            const navUrl = `/map/tile/${v.x}/${v.y}?center=true`;

            handleInteractiveElement(
                div,
                sidebarVId,
                navUrl,
                () => getVillageTooltipHtml(v),
                null,
                deactivateTooltip
            );

            sidebarList.appendChild(div);
        });

        // 2. Sidebar: Sorted Custom Markers
        if (customItems.length > 0) {
            const sortedCustomItems = [...customItems].sort((a, b) =>
                (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' })
            );

            const cHeader = document.createElement('div');
            cHeader.style.cssText = 'font-weight:bold; margin: 12px 0 6px 0; color:#e8d8b7;';
            cHeader.textContent = `Custom Markers (${sortedCustomItems.length}):`;
            sidebarList.appendChild(cHeader);

            sortedCustomItems.forEach(c => {
                const div = document.createElement('div');
                div.className = 'tw-list-item';
                div.innerHTML = `
                    <span class="tw-marker-title" style="color:${c.color}; font-weight:bold; cursor:pointer;">${c.title} (${c.x}|${c.y})</span>
                    <button class="tw-del-btn" title="Delete Marker">✖</button>
                `;

                const titleSpan = div.querySelector('.tw-marker-title');
                const sidebarCId = `sidebar_c_${c.id}`;
                const navUrl = `/map/tile/${c.x}/${c.y}?center=true`;
                const getHtml = () => `
                    <strong style="color:${c.color}">${c.title} (${c.x}|${c.y})</strong><br/>
                    ${c.note ? `<span style="color:#ddd;">${c.note}</span><br/>` : ''}
                    <hr style="border:0; border-top:1px solid #332e28; margin: 4px 0;"/>
                    <span style="font-size:10px; color:#aaa;">Click / tap again to view tile map</span>
                `;

                handleInteractiveElement(
                    titleSpan,
                    sidebarCId,
                    navUrl,
                    getHtml,
                    null,
                    deactivateTooltip
                );

                const delBtn = div.querySelector('.tw-del-btn');
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteCustomMarker(c.id);
                };

                sidebarList.appendChild(div);
            });
        }

        // 3. Sidebar: Sorted Active Routes
        if (routes.length > 0) {
            const sortedRoutes = [...routes].sort((a, b) => {
                const nameA = `${getVillageName(a.fromX, a.fromY)} -> ${a.destName || getVillageName(a.toX, a.toY)}`;
                const nameB = `${getVillageName(b.fromX, b.fromY)} -> ${b.destName || getVillageName(b.toX, b.toY)}`;
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            });

            const rHeader = document.createElement('div');
            rHeader.style.cssText = 'font-weight:bold; margin: 12px 0 6px 0; color:#e8d8b7;';
            rHeader.textContent = `Active Routes (${sortedRoutes.length}):`;
            sidebarList.appendChild(rHeader);

            sortedRoutes.forEach(r => {
                const fromName = getVillageName(r.fromX, r.fromY);
                const toName = r.destName || getVillageName(r.toX, r.toY);

                const div = document.createElement('div');
                div.className = 'tw-list-item';
                div.style.cursor = 'pointer';
                div.innerHTML = `<span>🛤️ ${fromName} → ${toName}</span>`;

                const domRef = routeDomMap.get(r.id);
                const sidebarRId = `sidebar_r_${r.id}`;

                handleInteractiveElement(
                    div,
                    sidebarRId,
                    null,
                    () => getRouteTooltipHtml(r),
                    () => { if (domRef) activateRouteHighlight(domRef.path, domRef.arrow); },
                    deactivateRouteHighlight
                );

                sidebarList.appendChild(div);
            });
        }
    }

    scrapePageVillageData();
    createUI();
})();
// ==UserScript==
// @name         Thronewake Trade Route & Income Visualizer
// @namespace    https://www.thronewake.com/
// @version      6.8
// @description  Parses village income and trade routes with SVG map visualization, individual resource targets per village, strict header scraping protection, Gist sync, screen-aware tooltips, and non-propagating ESC key shortcuts.
// @author       Assistant
// @match        https://*.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'tw_auto_visualizer_data_v3';
    const GIST_FILENAME = 'thronewake_targets.json';
    let activeMobileItemId = null;

    // --- State Storage ---
    function loadState() {
        try {
            const data = JSON.parse(GM_getValue(STORAGE_KEY, JSON.stringify({ villages: {}, routes: [], customItems: [], gistId: '', gistKey: '' })));
            if (!data.customItems) data.customItems = [];
            if (!data.routes) data.routes = [];
            if (!data.villages) data.villages = {};
            if (!data.gistId) data.gistId = '';
            if (!data.gistKey) data.gistKey = '';
            return data;
        } catch (e) {
            return { villages: {}, routes: [], customItems: [], gistId: '', gistKey: '' };
        }
    }

    function isMobile(window) {
        return window.innerWidth <= 768;
    }

    function saveState(stateData) {
        GM_setValue(STORAGE_KEY, JSON.stringify(stateData));
    }

    let state = loadState();

    // --- Gist API Helper ---
    function gistApiRequest(method, gistId, gistKey, bodyData = null) {
        return new Promise((resolve, reject) => {
            const headers = {
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            };
            if (gistKey) {
                headers['Authorization'] = `token ${gistKey}`;
            }

            GM_xmlhttpRequest({
                method: method,
                url: `https://api.github.com/gists/${gistId}`,
                headers: headers,
                data: bodyData ? JSON.stringify(bodyData) : null,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) {
                        try {
                            resolve(JSON.parse(res.responseText));
                        } catch (e) {
                            reject(e);
                        }
                    } else {
                        reject(new Error(`HTTP ${res.status}: ${res.statusText}`));
                    }
                },
                onerror: function (err) {
                    reject(err);
                }
            });
        });
    }

    // --- Gist Synchronization ---
    async function syncGist(forcePushLocal = false) {
        const gistId = (state.gistId || '').trim();
        const gistKey = (state.gistKey || '').trim();

        if (!gistId || !gistKey) {
            updateGistStatusUI('off', 'Not Configured');
            return;
        }

        updateGistStatusUI('syncing', 'Syncing...');

        try {
            const localTargetsToPush = {};
            Object.keys(state.villages).forEach(key => {
                const req = getVillageRequiredIncome(state.villages[key]);
                if (req.wood || req.clay || req.iron || req.crop) {
                    localTargetsToPush[key] = req;
                }
            });

            if (forcePushLocal) {
                await gistApiRequest('PATCH', gistId, gistKey, {
                    files: {
                        [GIST_FILENAME]: {
                            content: JSON.stringify(localTargetsToPush, null, 2)
                        }
                    }
                });
                updateGistStatusUI('connected', 'Connected & Saved');
                return;
            }

            const remoteGist = await gistApiRequest('GET', gistId, gistKey);
            let remoteTargets = {};

            if (remoteGist.files && remoteGist.files[GIST_FILENAME]) {
                try {
                    remoteTargets = JSON.parse(remoteGist.files[GIST_FILENAME].content);
                } catch (e) {
                    remoteTargets = {};
                }
            }

            let stateModified = false;
            Object.keys(remoteTargets).forEach(key => {
                const remoteReq = remoteTargets[key];
                if (state.villages[key]) {
                    const localReq = getVillageRequiredIncome(state.villages[key]);
                    const hasLocalTarget = localReq.wood || localReq.clay || localReq.iron || localReq.crop;
                    if (!hasLocalTarget && JSON.stringify(localReq) !== JSON.stringify(remoteReq)) {
                        state.villages[key].requiredIncome = remoteReq;
                        stateModified = true;
                    }
                } else {
                    const [xStr, yStr] = key.split(',');
                    const x = parseInt(xStr, 10);
                    const y = parseInt(yStr, 10);
                    state.villages[key] = {
                        id: `Village (${x}|${y})`,
                        name: `Village (${x}|${y})`,
                        x: x, y: y,
                        wood: 0, clay: 0, iron: 0, crop: 0,
                        requiredIncome: remoteReq,
                        isPlaceholder: true
                    };
                    stateModified = true;
                }
            });

            const finalTargetsToPush = {};
            Object.keys(state.villages).forEach(key => {
                const req = getVillageRequiredIncome(state.villages[key]);
                if (req.wood || req.clay || req.iron || req.crop) {
                    finalTargetsToPush[key] = req;
                }
            });

            await gistApiRequest('PATCH', gistId, gistKey, {
                files: {
                    [GIST_FILENAME]: {
                        content: JSON.stringify(finalTargetsToPush, null, 2)
                    }
                }
            });

            if (stateModified) {
                saveState(state);
            }

            updateGistStatusUI('connected', 'Connected & Synced');
            render();
        } catch (err) {
            console.error('[TW Visualizer] Gist Sync Error:', err);
            updateGistStatusUI('error', `Error: ${err.message || 'Failed'}`);
        }
    }

    function updateGistStatusUI(status, text) {
        const badge = document.getElementById('tw-gist-status-badge');
        const settingsText = document.getElementById('tw-gist-conn-status');

        if (badge) {
            if (status === 'connected') {
                badge.textContent = '🟢 Gist Connected';
                badge.style.color = '#22c55e';
            } else if (status === 'syncing') {
                badge.textContent = '🟡 Syncing...';
                badge.style.color = '#f59e0b';
            } else if (status === 'error') {
                badge.textContent = '🔴 Gist Error';
                badge.style.color = '#ef4444';
            } else {
                badge.textContent = '⚪ Gist Off';
                badge.style.color = '#888888';
            }
        }

        if (settingsText) {
            settingsText.textContent = `Status: ${text}`;
            if (status === 'connected') settingsText.style.color = '#22c55e';
            else if (status === 'error') settingsText.style.color = '#ef4444';
            else if (status === 'syncing') settingsText.style.color = '#f59e0b';
            else settingsText.style.color = '#aaa';
        }
    }

    // --- Delete Custom Marker ---
    function deleteCustomMarker(id) {
        if (!state.customItems) return;
        state.customItems = state.customItems.filter(item => item.id !== id);
        saveState(state);
        render();
    }

    // --- Helper: Resolve Village Name ---
    function getVillageName(x, y, fallbackName = '') {
        const key = `${x},${y}`;
        if (state.villages[key] && state.villages[key].name) {
            return state.villages[key].name;
        }
        return fallbackName || `Village (${x}|${y})`;
    }

    // --- Helper: Get Safely Structured Resource Targets ---
    function getVillageRequiredIncome(v) {
        if (!v || !v.requiredIncome || typeof v.requiredIncome !== 'object') {
            return { wood: '', clay: '', iron: '', crop: '' };
        }
        return {
            wood: v.requiredIncome.wood !== undefined ? v.requiredIncome.wood : '',
            clay: v.requiredIncome.clay !== undefined ? v.requiredIncome.clay : '',
            iron: v.requiredIncome.iron !== undefined ? v.requiredIncome.iron : '',
            crop: v.requiredIncome.crop !== undefined ? v.requiredIncome.crop : ''
        };
    }

    // --- Net Income Calculation ---
    function getVillageNetIncome(v) {
        let wood = v.wood || 0;
        let clay = v.clay || 0;
        let iron = v.iron || 0;
        let crop = v.crop || 0;

        state.routes.forEach(r => {
            if (r.toX === v.x && r.toY === v.y) {
                wood += (r.wood || 0);
                clay += (r.clay || 0);
                iron += (r.iron || 0);
                crop += (r.crop || 0);
            }
            if (r.fromX === v.x && r.fromY === v.y) {
                wood -= (r.wood || 0);
                clay -= (r.clay || 0);
                iron -= (r.iron || 0);
                crop -= (r.crop || 0);
            }
        });

        const total = wood + clay + iron + crop;
        return { wood, clay, iron, crop, total };
    }

    // --- Helper: Color Logic for Villages ---
    function getVillageNodeColor(v) {
        const net = getVillageNetIncome(v);

        if (net.wood < 0 || net.clay < 0 || net.iron < 0 || net.crop < 0) {
            return '#ef4444';
        }

        const req = getVillageRequiredIncome(v);
        const reqW = parseFloat(req.wood);
        const reqC = parseFloat(req.clay);
        const reqI = parseFloat(req.iron);
        const reqCr = parseFloat(req.crop);

        const hasW = !isNaN(reqW) && req.wood.toString().trim() !== '';
        const hasC = !isNaN(reqC) && req.clay.toString().trim() !== '';
        const hasI = !isNaN(reqI) && req.iron.toString().trim() !== '';
        const hasCr = !isNaN(reqCr) && req.crop.toString().trim() !== '';

        if (!hasW && !hasC && !hasI && !hasCr) {
            return '#a855f7';
        }

        if ((hasW && net.wood < reqW) ||
            (hasC && net.clay < reqC) ||
            (hasI && net.iron < reqI) ||
            (hasCr && net.crop < reqCr)) {
            return '#f59e0b';
        }

        return '#22c55e';
    }

    // --- Helper: Update Route Status Badge Text ---
    function updateRouteStatusBadge(parsedCount) {
        const statusEl = document.getElementById('tw-route-status');
        if (statusEl) {
            if (typeof parsedCount === 'number') {
                statusEl.textContent = `✓ Parsed ${parsedCount} (Total: ${state.routes.length})`;
                statusEl.style.color = '#28a745';
            } else {
                statusEl.textContent = `✓ Active (${state.routes.length})`;
                statusEl.style.color = '#e8d8b7';
            }
        }
    }

    // --- Strict Header Rate Scraper ---
    function extractHeaderRates() {
        const header = document.querySelector('header');
        if (!header) return null;

        const resContainers = header.querySelectorAll('.grid.grid-cols-4 > div');
        if (resContainers.length < 4) return null;

        const rates = [];
        resContainers.forEach(col => {
            const match = col.textContent.match(/([+-]?[\d,]+)\/h/);
            if (match) {
                rates.push(parseInt(match[1].replace(/,/g, ''), 10));
            }
        });

        if (rates.length === 4) {
            return {
                wood: rates[0],
                clay: rates[1],
                iron: rates[2],
                crop: rates[3]
            };
        }
        return null;
    }

    // --- Scrape Current Active Village & Header Income Rates ---
    function scrapePageVillageData() {
        const activeVillageEl = document.querySelector('#_r_d_-select span') || document.querySelector('select[aria-label="Switch village"] option:checked');
        let text = activeVillageEl ? activeVillageEl.textContent.trim() : '';

        let coordMatch = text.match(/^(.*?)\s*\(([-+]?\d+)\|([-+]?\d+)\)$/);
        if (!coordMatch) {
            coordMatch = document.body.innerText.match(/([^\n\r(|]+)\s*\(([-+]?\d+)\|([-+]?\d+)\)/);
        }

        if (!coordMatch) return null;

        const name = coordMatch[1].trim();
        const x = parseInt(coordMatch[2], 10);
        const y = parseInt(coordMatch[3], 10);
        const key = `${x},${y}`;

        const headerRates = extractHeaderRates();
        const existingReq = getVillageRequiredIncome(state.villages[key] || {});

        if (!state.villages[key]) {
            state.villages[key] = {
                id: name,
                name: name,
                x: x,
                y: y,
                wood: headerRates ? headerRates.wood : 0,
                clay: headerRates ? headerRates.clay : 0,
                iron: headerRates ? headerRates.iron : 0,
                crop: headerRates ? headerRates.crop : 0,
                requiredIncome: existingReq,
                isPlaceholder: !headerRates,
                lastSeen: Date.now()
            };
            saveState(state);
        } else if (headerRates) {
            state.villages[key].id = name;
            state.villages[key].name = name;
            state.villages[key].wood = headerRates.wood;
            state.villages[key].clay = headerRates.clay;
            state.villages[key].iron = headerRates.iron;
            state.villages[key].crop = headerRates.crop;
            state.villages[key].isPlaceholder = false;
            state.villages[key].lastSeen = Date.now();
            saveState(state);
        }

        return state.villages[key];
    }

    // --- Locate "Trade routes" Header in Page ---
    function findTradeRoutesHeader() {
        const h2s = document.querySelectorAll('h2');
        for (const h2 of h2s) {
            if (/Trade\s+routes/i.test(h2.textContent)) {
                return h2;
            }
        }
        return null;
    }

    // --- Scrape Precise Trade Route HTML Items ---
    function scrapeTradeRoutesFromDOM() {
        const origin = scrapePageVillageData();
        if (!origin) return 0;

        const header = findTradeRoutesHeader();
        if (!header) return 0;

        const section = header.closest('section');
        if (!section) return 0;

        const routeCards = section.querySelectorAll('li.paper:has(input[name^="route-enabled"]), li.paper:has(input[type="checkbox"])');
        const foundRoutes = [];

        routeCards.forEach((card, cardIdx) => {
            const checkbox = card.querySelector('input[type="checkbox"]');
            if (checkbox && !checkbox.checked) return;

            const tileLink = card.querySelector('a[href*="/map/tile/"]');
            if (!tileLink) return;

            const href = tileLink.getAttribute('href') || '';
            const tileMatch = href.match(/\/map\/tile\/([-+]?\d+)\/([-+]?\d+)/);
            const textContent = tileLink.textContent.trim();
            const textMatch = textContent.match(/^(.*?)\s*\(([-+]?\d+)\|([-+]?\d+)\)$/);

            let toX, toY, destName;

            if (textMatch) {
                destName = textMatch[1].trim();
                toX = parseInt(textMatch[2], 10);
                toY = parseInt(textMatch[3], 10);
            } else if (tileMatch) {
                toX = parseInt(tileMatch[1], 10);
                toY = parseInt(tileMatch[2], 10);
                destName = textContent.split('(')[0].trim() || `Village (${toX}|${toY})`;
            } else {
                return;
            }

            if (toX === origin.x && toY === origin.y) return;

            const targetKey = `${toX},${toY}`;
            if (!state.villages[targetKey]) {
                state.villages[targetKey] = {
                    id: destName,
                    name: destName,
                    x: toX,
                    y: toY,
                    wood: 0, clay: 0, iron: 0, crop: 0,
                    requiredIncome: { wood: '', clay: '', iron: '', crop: '' },
                    isPlaceholder: true
                };
            }

            const cardText = card.textContent;
            const repeatMatch = cardText.match(/Every\s+(\d+)h/i);
            const repeatHours = repeatMatch ? parseInt(repeatMatch[1], 10) : 1;

            const deliveryMatch = cardText.match(/(\d+)\s+deliveries?/i);
            const deliveries = deliveryMatch ? parseInt(deliveryMatch[1], 10) : 1;

            const hourlyMultiplier = deliveries / (repeatHours || 1);

            let wood = 0, clay = 0, iron = 0, crop = 0;
            const resBoxes = card.querySelectorAll('div.flex.items-center.gap-1');

            resBoxes.forEach(box => {
                const srLabel = box.querySelector('.sr-only');
                const valSpan = box.querySelector('span:not(.sr-only)');

                if (srLabel && valSpan) {
                    const label = srLabel.textContent.trim().toLowerCase();
                    const val = parseInt(valSpan.textContent.replace(/,/g, ''), 10);

                    if (!isNaN(val)) {
                        if (label === 'lumber' || label === 'wood') wood += val;
                        else if (label === 'stone' || label === 'clay') clay += val;
                        else if (label === 'metal' || label === 'iron') iron += val;
                        else if (label === 'food' || label === 'crop') crop += val;
                    }
                }
            });

            const hourlyWood = Math.round(wood * hourlyMultiplier);
            const hourlyClay = Math.round(clay * hourlyMultiplier);
            const hourlyIron = Math.round(iron * hourlyMultiplier);
            const hourlyCrop = Math.round(crop * hourlyMultiplier);

            const routeId = `route_${origin.x}_${origin.y}_to_${toX}_${toY}_idx_${cardIdx}`;
            foundRoutes.push({
                id: routeId,
                fromX: origin.x,
                fromY: origin.y,
                toX: toX,
                toY: toY,
                destName: destName,
                wood: hourlyWood,
                clay: hourlyClay,
                iron: hourlyIron,
                crop: hourlyCrop,
                repeatHours: repeatHours,
                deliveries: deliveries,
                rawWood: wood,
                rawClay: clay,
                rawIron: iron,
                rawCrop: crop
            });
        });

        const otherRoutes = state.routes.filter(r => !(r.fromX === origin.x && r.fromY === origin.y));
        state.routes = [...otherRoutes, ...foundRoutes];

        const uniqueMap = new Map();
        state.routes.forEach(r => {
            const sig = `${r.fromX}_${r.fromY}_to_${r.toX}_${r.toY}_${r.wood}_${r.clay}_${r.iron}_${r.crop}_${r.repeatHours}_${r.deliveries}`;
            if (!uniqueMap.has(sig)) {
                uniqueMap.set(sig, r);
            }
        });
        state.routes = Array.from(uniqueMap.values());

        saveState(state);
        return foundRoutes.length;
    }

    function injectTradeRouteControls() {
        const header = findTradeRoutesHeader();
        if (!header) return;

        if (!document.getElementById('tw-reparse-routes-btn')) {
            const container = document.createElement('span');
            container.id = 'tw-route-controls-wrap';
            container.style.cssText = `
                margin-left: 12px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                font-weight: normal;
                text-transform: none;
                vertical-align: middle;
            `;

            container.innerHTML = `
                <span id="tw-route-status" style="
                    background: #23201c;
                    color: #e8d8b7;
                    border: 1px solid #8c6d46;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: bold;
                ">📦 Stored: ${state.routes.length}</span>
                <button id="tw-reparse-routes-btn" type="button" style="
                    background: #165eb9;
                    color: #ffffff;
                    border: 1px solid #8c6d46;
                    padding: 3px 9px;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: bold;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                ">Reparse Routes</button>
            `;

            header.appendChild(container);

            const reparseBtn = document.getElementById('tw-reparse-routes-btn');
            reparseBtn.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const statusEl = document.getElementById('tw-route-status');
                if (statusEl) {
                    statusEl.textContent = 'Parsing...';
                    statusEl.style.color = '#ffc107';
                }

                setTimeout(() => {
                    const count = scrapeTradeRoutesFromDOM();
                    updateRouteStatusBadge(count);
                    render();
                }, 200);
            };
        }

        setTimeout(() => {
            const count = scrapeTradeRoutesFromDOM();
            updateRouteStatusBadge(count);
        }, 300);
    }

    function getRouteColor(route) {
        const hasWood = (route.wood || 0) > 0;
        const hasClay = (route.clay || 0) > 0;
        const hasIron = (route.iron || 0) > 0;
        const hasCrop = (route.crop || 0) > 0;
        const count = [hasWood, hasClay, hasIron, hasCrop].filter(Boolean).length;

        if (count === 1) {
            if (hasWood) return '#b45309';
            if (hasClay) return '#94a3b8';
            if (hasIron) return '#38bdf8';
            if (hasCrop) return '#f43f5e';
        }

        if (count > 1) {
            return hasCrop ? '#fbbf24' : '#a855f7';
        }

        return '#165eb9';
    }

    function injectStyles() {
        const css = `
            :root {
                --tw-paper-brown: #8c6d46;
                --tw-paper-dark: #1e1b18;
                --tw-paper-light: #e8d8b7;
                --tw-blue-primary: #165eb9;
                --tw-blue-hover: #1c6ed8;
            }
            #tw-graph-btn {
                display: inline-flex; align-items: center; gap: 6px;
                margin-left: 10px; background: var(--tw-blue-primary); color: #fff;
                border: 1px solid var(--tw-paper-brown); padding: 4px 10px; font-size: 12px;
                font-weight: bold; cursor: pointer; border-radius: 4px;
                vertical-align: middle; box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                white-space: nowrap;
            }
            #tw-graph-btn:hover { background: var(--tw-blue-hover); }
            #tw-settings-btn {
                background: #2d2924; color: #fff; border: 1px solid var(--tw-paper-brown);
                padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;
                border-radius: 4px; transition: background 0.1s ease;
            }
            #tw-settings-btn:hover { background: #3d3730; }
            #tw-reset-btn {
                background: #8b0000; color: #fff; border: 1px solid var(--tw-paper-brown);
                padding: 4px 10px; font-size: 12px; font-weight: bold; cursor: pointer;
                border-radius: 4px; transition: background 0.1s ease;
            }
            #tw-reset-btn:hover { background: #b22222; }
            #tw-modal-overlay {
                display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85);
                z-index: 999999; justify-content: center; align-items: center; backdrop-filter: blur(2px);
            }
            .tw-modal {
                background: var(--tw-paper-dark); color: var(--tw-paper-light);
                border: 2px solid var(--tw-paper-brown); width: 90vw; height: 85vh;
                border-radius: 6px; display: flex; flex-direction: column; position: relative;
                font-family: ui-sans-serif, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,0.9);
            }
            .tw-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px 20px; background: #141210; border-bottom: 1px solid var(--tw-paper-brown);
            }
            .tw-body { display: flex; flex: 1; overflow: hidden; }
            .tw-sidebar {
                width: 280px; background: #161412; padding: 15px;
                border-right: 1px solid var(--tw-paper-brown); overflow-y: auto;
            }
            .tw-canvas-container { flex: 1; position: relative; background: #0c0b0a; overflow: hidden; }
            .tw-close { cursor: pointer; font-size: 22px; font-weight: bold; color: var(--tw-paper-light); }
            .tw-close:hover { color: #fff; }
            .tw-tooltip {
                position: fixed; background: #141210; border: 1px solid var(--tw-paper-brown);
                color: var(--tw-paper-light); padding: 10px 14px; border-radius: 4px;
                pointer-events: none; display: none; z-index: 10000000; font-size: 12px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.8); max-width: 420px; word-break: break-word;
            }
            .tw-list-item {
                background: #23201c; padding: 8px 10px; margin-bottom: 6px;
                border-radius: 4px; border: 1px solid #332e28; font-size: 12px;
                display: flex; justify-content: space-between; align-items: center;
                transition: background 0.15s ease, border-color 0.15s ease;
            }
            .tw-list-item:hover {
                background: #2d2924; border-color: #8c6d46;
            }
            .tw-legend {
                position: absolute; bottom: 15px; right: 15px;
                background: #141210; border: 1px solid var(--tw-paper-brown);
                color: var(--tw-paper-light); padding: 10px 12px; border-radius: 6px;
                font-size: 11px; z-index: 100000; box-shadow: 0 4px 12px rgba(0,0,0,0.7);
                pointer-events: none; max-height: 80%; overflow-y: auto;
            }
            .tw-legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
            .tw-legend-item:last-child { margin-bottom: 0; }
            .tw-legend-color { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
            .tw-route-path, .tw-route-arrow { transition: opacity 0.15s ease, stroke-width 0.15s ease; }

            #tw-add-custom-btn {
                position: absolute; top: 12px; left: 12px; z-index: 10000;
                background: #165eb9; color: #fff; border: 1px solid var(--tw-paper-brown);
                padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer;
                border-radius: 4px; box-shadow: 0 2px 6px rgba(0,0,0,0.6);
            }
            #tw-add-custom-btn:hover { background: #1c6ed8; }

            .tw-settings-popover {
                display: none; position: absolute; top: 50px; right: 12px; z-index: 100003;
                background: #141210; border: 2px solid var(--tw-paper-brown); padding: 18px;
                border-radius: 6px; width: 340px; font-size: 12px; box-shadow: 0 8px 25px rgba(0,0,0,0.95);
            }
            .tw-settings-popover h4 { margin: 0 0 10px 0; color: #fff; border-bottom: 1px solid #332e28; padding-bottom: 6px; font-size: 13px; }
            .tw-settings-popover label { display: block; margin-bottom: 3px; font-weight: bold; color: #e8d8b7; font-size: 11px; }
            .tw-settings-popover input {
                width: 100%; background: #23201c; color: #fff; border: 1px solid #443c33;
                border-radius: 4px; padding: 6px 8px; font-size: 12px; margin-bottom: 10px; box-sizing: border-box;
            }

            .tw-village-popover {
                display: none; position: absolute; top: 50px; left: 12px; z-index: 100002;
                background: #141210; border: 2px solid var(--tw-paper-brown); padding: 18px;
                border-radius: 6px; width: 380px; font-size: 12px; box-shadow: 0 8px 25px rgba(0,0,0,0.95);
            }
            .tw-village-popover h4 { margin: 0 0 10px 0; color: #fff; border-bottom: 1px solid #332e28; padding-bottom: 6px; font-size: 13px; }
            .tw-village-popover label { display: block; margin-bottom: 3px; font-weight: bold; color: #e8d8b7; font-size: 11px; }
            .tw-village-popover input {
                width: 100%; background: #23201c; color: #fff; border: 1px solid #443c33;
                border-radius: 4px; padding: 6px 8px; font-size: 12px; box-sizing: border-box;
            }

            .tw-add-modal-popover {
                display: none; position: absolute; top: 50px; left: 12px; z-index: 100001;
                background: #141210; border: 1px solid var(--tw-paper-brown); padding: 14px;
                border-radius: 6px; width: 220px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.9);
            }
            .tw-add-modal-popover label { display: block; margin-bottom: 3px; font-weight: bold; color: #e8d8b7; }
            .tw-add-modal-popover input, .tw-add-modal-popover textarea {
                width: 100%; background: #23201c; color: #fff; border: 1px solid #443c33;
                border-radius: 4px; padding: 4px 6px; font-size: 12px; margin-bottom: 8px; box-sizing: border-box;
            }
            .tw-add-modal-popover input[type="color"] { height: 28px; padding: 1px; cursor: pointer; }
            .tw-popover-btns { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
            .tw-popover-btns button {
                padding: 6px 12px; font-size: 11px; font-weight: bold; border-radius: 4px; cursor: pointer; border: none;
            }
            .tw-del-btn {
                background: transparent; color: #ff6b6b; border: none; cursor: pointer;
                font-size: 13px; font-weight: bold; padding: 0 4px;
            }
            .tw-del-btn:hover { color: #ff0000; }

            @media (max-width: 768px) {
                .tw-modal {
                    width: 95vw;
                    height: 90vh;
                }
                .tw-body {
                    flex-direction: column;
                }
                .tw-sidebar {
                    width: 100% !important;
                    height: 100% !important;
                    border-right: none !important;
                    border-bottom: none !important;
                }
                .tw-canvas-container {
                    display: none !important;
                }
            }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    // --- Smart Tooltip Renderer ---
    function showTooltip(html, e) {
        const tooltip = document.getElementById('tw-tooltip');
        if (!tooltip) return;

        tooltip.innerHTML = html;
        tooltip.style.display = 'block';

        const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : window.innerWidth / 2);
        const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : window.innerHeight / 2);

        const ttWidth = tooltip.offsetWidth;
        const ttHeight = tooltip.offsetHeight;
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        let left = clientX + 15;
        let top = clientY + 15;

        if (top + ttHeight > winHeight - 10) {
            top = clientY - ttHeight - 15;
        }

        if (left + ttWidth > winWidth - 10) {
            left = clientX - ttWidth - 15;
        }

        left = Math.max(10, Math.min(left, winWidth - ttWidth - 10));
        top = Math.max(10, Math.min(top, winHeight - ttHeight - 10));

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    function deactivateTooltip() {
        const tooltip = document.getElementById('tw-tooltip');
        if (tooltip) tooltip.style.display = 'none';
    }

    // --- Interaction Handler ---
    function handleInteractiveElement(el, itemId, navUrl, getTooltipContent, onActivate, onDeactivate, onClickAction) {
        el.onmousemove = (e) => {
            if (window.innerWidth > 768) {
                if (onActivate) onActivate();
                showTooltip(getTooltipContent(), e);
            }
        };

        el.onmouseleave = () => {
            if (window.innerWidth > 768) {
                if (onDeactivate) onDeactivate();
                deactivateTooltip();
            }
        };

        el.onclick = (e) => {
            if (onClickAction) {
                e.preventDefault();
                e.stopPropagation();
                onClickAction(e);
                return;
            }

            if (isMobile(window)) {
                if (activeMobileItemId !== itemId) {
                    e.preventDefault();
                    e.stopPropagation();
                    activeMobileItemId = itemId;
                    if (onActivate) onActivate();
                    showTooltip(getTooltipContent(), e);
                    return;
                }
            }

            activeMobileItemId = null;
            deactivateTooltip();

            if (navUrl) {
                window.location.href = navUrl;
            }
        };
    }

    // --- Village Modal Popover ---
    let targetVillageKey = null;

    function openVillageModal(v) {
        const key = `${v.x},${v.y}`;
        targetVillageKey = key;
        const net = getVillageNetIncome(v);

        document.getElementById('tw-village-popover-title').textContent = `${v.name} (${v.x}|${v.y})`;
        document.getElementById('tw-village-net-info').innerHTML = `
            <div style="font-size:12px; line-height:1.5; display:grid; grid-template-columns: 1fr 1fr; gap:4px 12px; background:#1e1b18; padding:8px; border-radius:4px; border:1px solid #332e28;">
                <div>🌲 Net Wood: <strong style="color:${net.wood >= 0 ? '#22c55e' : '#ef4444'}">${net.wood.toLocaleString()}/h</strong></div>
                <div>🧱 Net Clay: <strong style="color:${net.clay >= 0 ? '#22c55e' : '#ef4444'}">${net.clay.toLocaleString()}/h</strong></div>
                <div>⛏️ Net Iron: <strong style="color:${net.iron >= 0 ? '#22c55e' : '#ef4444'}">${net.iron.toLocaleString()}/h</strong></div>
                <div>🥩 Net Crop: <strong style="color:${net.crop >= 0 ? '#22c55e' : '#ef4444'}">${net.crop.toLocaleString()}/h</strong></div>
            </div>
        `;

        const req = getVillageRequiredIncome(v);
        document.getElementById('tw-village-req-wood').value = req.wood;
        document.getElementById('tw-village-req-clay').value = req.clay;
        document.getElementById('tw-village-req-iron').value = req.iron;
        document.getElementById('tw-village-req-crop').value = req.crop;

        const popover = document.getElementById('tw-village-popover');
        popover.style.display = 'block';

        const customPopover = document.getElementById('tw-add-modal-popover');
        if (customPopover) customPopover.style.display = 'none';

        const settingsPopover = document.getElementById('tw-settings-popover');
        if (settingsPopover) settingsPopover.style.display = 'none';
    }

    function createUI() {
        injectStyles();

        const overlay = document.createElement('div');
        overlay.id = 'tw-modal-overlay';
        overlay.innerHTML = `
            <div class="tw-modal">
                <div class="tw-header">
                    <strong style="font-size: 15px;">Thronewake Territory & Trade Map</strong>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <span id="tw-gist-status-badge" style="
                            background: #23201c; color: #888888; border: 1px solid #8c6d46;
                            padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;
                        ">⚪ Gist Off</span>
                        <button id="tw-settings-btn" type="button">⚙️ Settings</button>
                        <button id="tw-reset-btn" type="button">🗑️ Reset Data</button>
                        <span class="tw-close" id="tw-close-modal">&times;</span>
                    </div>
                </div>
                <div class="tw-body">
                    <div class="tw-sidebar">
                        <h3 style="margin-top:0; font-size: 13px; border-bottom: 1px solid var(--tw-paper-brown); padding-bottom: 6px; color: #fff;">Discovered Villages & Routes</h3>
                        <div id="tw-village-list"></div>
                    </div>
                    <div class="tw-canvas-container" id="tw-canvas-container">
                        <button id="tw-add-custom-btn" type="button">➕ Add Marker</button>

                        <div class="tw-settings-popover" id="tw-settings-popover">
                            <h4>⚙️ Gist Synchronization Settings</h4>
                            <label>GitHub Gist ID:</label>
                            <input type="text" id="tw-gist-id-input" placeholder="e.g. 8a7f2b9c0d1e2f3a4b5c" />
                            <label>GitHub Access Token (Key):</label>
                            <input type="password" id="tw-gist-key-input" placeholder="ghp_x1y2z3..." />
                            <div id="tw-gist-conn-status" style="margin: 4px 0 10px 0; font-size: 11px; color: #aaa;">Status: Not Configured</div>
                            <div class="tw-popover-btns">
                                <button type="button" id="tw-settings-cancel-btn" style="background:#555; color:#fff;">Cancel</button>
                                <button type="button" id="tw-settings-save-btn" style="background:#28a745; color:#fff;">Save & Sync</button>
                            </div>
                        </div>

                        <div class="tw-village-popover" id="tw-village-popover">
                            <h4 id="tw-village-popover-title">Village Resource Targets</h4>
                            <div id="tw-village-net-info" style="margin-bottom:12px;"></div>

                            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                                <div>
                                    <label>🌲 Wood Target (/h):</label>
                                    <input type="number" id="tw-village-req-wood" placeholder="e.g. 4834" />
                                </div>
                                <div>
                                    <label>🧱 Clay Target (/h):</label>
                                    <input type="number" id="tw-village-req-clay" placeholder="e.g. 6274" />
                                </div>
                                <div>
                                    <label>⛏️ Iron Target (/h):</label>
                                    <input type="number" id="tw-village-req-iron" placeholder="e.g. 7714" />
                                </div>
                                <div>
                                    <label>🥩 Crop Target (/h):</label>
                                    <input type="number" id="tw-village-req-crop" placeholder="e.g. 3394" />
                                </div>
                            </div>

                            <div class="tw-popover-btns">
                                <button type="button" id="tw-village-tile-btn" style="background:#165eb9; color:#fff;">View Tile</button>
                                <button type="button" id="tw-village-cancel-btn" style="background:#555; color:#fff;">Cancel</button>
                                <button type="button" id="tw-village-save-btn" style="background:#28a745; color:#fff;">Save</button>
                            </div>
                        </div>

                        <div class="tw-add-modal-popover" id="tw-add-modal-popover">
                            <strong style="display:block; margin-bottom:8px; color:#fff;">Add Custom Map Marker</strong>
                            <div style="display:flex; gap:6px;">
                                <div style="flex:1;">
                                    <label>X Coord:</label>
                                    <input type="number" id="tw-new-x" placeholder="e.g. -15" />
                                </div>
                                <div style="flex:1;">
                                    <label>Y Coord:</label>
                                    <input type="number" id="tw-new-y" placeholder="e.g. -39" />
                                </div>
                            </div>
                            <label>Header / Title:</label>
                            <input type="text" id="tw-new-title" placeholder="Outpost / Target" />
                            <label>Note / Description:</label>
                            <textarea id="tw-new-note" rows="2" placeholder="Optional details..."></textarea>
                            <label>Marker Color:</label>
                            <input type="color" id="tw-new-color" value="#ff007f" />
                            <div class="tw-popover-btns">
                                <button type="button" id="tw-cancel-marker-btn" style="background:#555; color:#fff;">Cancel</button>
                                <button type="button" id="tw-save-marker-btn" style="background:#28a745; color:#fff;">Save</button>
                            </div>
                        </div>

                        <svg id="tw-svg" width="100%" height="100%"></svg>

                        <div class="tw-legend">
                            <strong style="display:block; margin-bottom: 4px; border-bottom: 1px solid #332e28; padding-bottom: 2px;">Village Income Status</strong>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#ef4444;"></span> Negative Resource Net</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#a855f7;"></span> Targets Unconfigured</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#f59e0b;"></span> Insufficient Target Net</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#22c55e;"></span> All Targets Met</div>

                            <strong style="display:block; margin: 8px 0 4px 0; border-bottom: 1px solid #332e28; padding-bottom: 2px;">Route Legend</strong>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#fbbf24; border-radius: 2px;"></span> Mixed (with Food)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#a855f7; border-radius: 2px;"></span> Mixed (without Food)</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#b45309; border-radius: 2px;"></span> Wood</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#94a3b8; border-radius: 2px;"></span> Clay</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#38bdf8; border-radius: 2px;"></span> Iron</div>
                            <div class="tw-legend-item"><span class="tw-legend-color" style="background:#f43f5e; border-radius: 2px;"></span> Food</div>
                        </div>
                    </div>
                </div>
                <div class="tw-tooltip" id="tw-tooltip"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        // --- Non-propagating ESC Key Handler ---
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.keyCode === 27) {
                e.preventDefault();
                e.stopPropagation();

                const overlayEl = document.getElementById('tw-modal-overlay');
                const villagePop = document.getElementById('tw-village-popover');
                const addPop = document.getElementById('tw-add-modal-popover');
                const settingsPop = document.getElementById('tw-settings-popover');

                let popoverClosed = false;
                [villagePop, addPop, settingsPop].forEach(pop => {
                    if (pop && pop.style.display === 'block') {
                        pop.style.display = 'none';
                        popoverClosed = true;
                    }
                });

                if (!popoverClosed && overlayEl && overlayEl.style.display !== 'none') {
                    overlayEl.style.display = 'none';
                }

                activeMobileItemId = null;
                deactivateTooltip();
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.tw-list-item') && !e.target.closest('g') && !e.target.closest('#tw-tooltip')) {
                activeMobileItemId = null;
                deactivateTooltip();
            }
        });

        document.getElementById('tw-close-modal').onclick = () => { overlay.style.display = 'none'; };

        document.getElementById('tw-reset-btn').onclick = () => {
            if (confirm('Clear all stored village income, trade route, and custom marker data?')) {
                state = { villages: {}, routes: [], customItems: [], gistId: state.gistId, gistKey: state.gistKey };
                saveState(state);
                scrapePageVillageData();
                render();
                updateRouteStatusBadge(0);
            }
        };

        const addBtn = document.getElementById('tw-add-custom-btn');
        const popover = document.getElementById('tw-add-modal-popover');
        const villagePopover = document.getElementById('tw-village-popover');
        const settingsPopover = document.getElementById('tw-settings-popover');
        const saveMarkerBtn = document.getElementById('tw-save-marker-btn');
        const cancelMarkerBtn = document.getElementById('tw-cancel-marker-btn');

        addBtn.onclick = (e) => {
            e.stopPropagation();
            villagePopover.style.display = 'none';
            settingsPopover.style.display = 'none';
            popover.style.display = popover.style.display === 'block' ? 'none' : 'block';
        };

        cancelMarkerBtn.onclick = () => { popover.style.display = 'none'; };

        saveMarkerBtn.onclick = () => {
            const xVal = parseInt(document.getElementById('tw-new-x').value, 10);
            const yVal = parseInt(document.getElementById('tw-new-y').value, 10);
            const titleVal = document.getElementById('tw-new-title').value.trim() || 'Custom Point';
            const noteVal = document.getElementById('tw-new-note').value.trim();
            const colorVal = document.getElementById('tw-new-color').value || '#ff007f';

            if (isNaN(xVal) || isNaN(yVal)) {
                alert('Please enter valid numeric X and Y coordinates.');
                return;
            }

            if (!state.customItems) state.customItems = [];
            state.customItems.push({
                id: `custom_${Date.now()}`,
                x: xVal,
                y: yVal,
                title: titleVal,
                note: noteVal,
                color: colorVal
            });

            saveState(state);
            popover.style.display = 'none';
            document.getElementById('tw-new-x').value = '';
            document.getElementById('tw-new-y').value = '';
            document.getElementById('tw-new-title').value = '';
            document.getElementById('tw-new-note').value = '';
            render();
        };

        document.getElementById('tw-settings-btn').onclick = (e) => {
            e.stopPropagation();
            villagePopover.style.display = 'none';
            popover.style.display = 'none';

            document.getElementById('tw-gist-id-input').value = state.gistId || '';
            document.getElementById('tw-gist-key-input').value = state.gistKey || '';

            settingsPopover.style.display = settingsPopover.style.display === 'block' ? 'none' : 'block';
        };

        document.getElementById('tw-settings-cancel-btn').onclick = () => {
            settingsPopover.style.display = 'none';
        };

        document.getElementById('tw-settings-save-btn').onclick = () => {
            state.gistId = document.getElementById('tw-gist-id-input').value.trim();
            state.gistKey = document.getElementById('tw-gist-key-input').value.trim();
            saveState(state);
            settingsPopover.style.display = 'none';
            syncGist(false);
        };

        document.getElementById('tw-village-cancel-btn').onclick = () => {
            villagePopover.style.display = 'none';
        };

        document.getElementById('tw-village-save-btn').onclick = () => {
            if (targetVillageKey && state.villages[targetVillageKey]) {
                const reqWood = document.getElementById('tw-village-req-wood').value.trim();
                const reqClay = document.getElementById('tw-village-req-clay').value.trim();
                const reqIron = document.getElementById('tw-village-req-iron').value.trim();
                const reqCrop = document.getElementById('tw-village-req-crop').value.trim();

                state.villages[targetVillageKey].requiredIncome = {
                    wood: reqWood,
                    clay: reqClay,
                    iron: reqIron,
                    crop: reqCrop
                };

                saveState(state);
                villagePopover.style.display = 'none';
                render();
                syncGist(true);
            }
        };

        document.getElementById('tw-village-tile-btn').onclick = () => {
            if (targetVillageKey && state.villages[targetVillageKey]) {
                const v = state.villages[targetVillageKey];
                window.location.href = `/map/tile/${v.x}/${v.y}?center=true`;
            }
        };

        let lastObservedVillage = '';
        const observer = new MutationObserver(() => {
            injectHeaderButton();
            injectTradeRouteControls();

            const selectEl = document.querySelector('#_r_d_-select');
            if (selectEl) {
                const currentText = selectEl.textContent.trim();
                if (currentText !== lastObservedVillage) {
                    lastObservedVillage = currentText;
                    setTimeout(() => {
                        scrapePageVillageData();
                        const parsedCount = scrapeTradeRoutesFromDOM();
                        updateRouteStatusBadge(parsedCount);
                        render();
                    }, 300);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });

        injectHeaderButton();
        injectTradeRouteControls();
        syncGist(false);
    }

    function injectHeaderButton() {
        if (document.getElementById('tw-graph-btn')) return;

        const selectEl = document.querySelector('#_r_d_-select');
        let targetEl = null;

        if (selectEl) {
            targetEl = selectEl.closest('.relative.flex.min-w-0') || selectEl.closest('.relative.w-fit')?.parentElement;
        }

        if (!targetEl) {
            const candidates = document.querySelectorAll('div, span, h1, h2, h3');
            for (const el of candidates) {
                if (el.children.length <= 2 && /\([-+]?\d+\|[-+]?\d+\)/.test(el.textContent)) {
                    targetEl = el;
                    break;
                }
            }
        }

        if (targetEl) {
            const btn = document.createElement('button');
            btn.id = 'tw-graph-btn';
            btn.innerHTML = isMobile(window) ? 'TG' : 'Trade Graph';
            btn.onclick = (e) => {
                e.stopPropagation();
                scrapePageVillageData();
                const parsedCount = scrapeTradeRoutesFromDOM();
                updateRouteStatusBadge(parsedCount);
                document.getElementById('tw-modal-overlay').style.display = 'flex';
                render();
                syncGist(false);
            };
            targetEl.appendChild(btn);
        }
    }

    // --- Helper: Format Resource Line in Tooltip with b, i, o, t ---
    function formatResourceTooltipLine(icon, name, base, inc, out, target) {
        const total = base + inc - out;
        let targetDetails = '';
        if (target !== undefined && target !== null && target.toString().trim() !== '') {
            const targetVal = parseFloat(target);
            const statusColor = total >= targetVal ? '#22c55e' : '#f59e0b';
            targetDetails = ` | t: <span style="color:${statusColor}; font-weight:bold;">${targetVal.toLocaleString()}</span>`;
        }

        let routeDetails = '';
        if (inc > 0 || out > 0) {
            const incStr = inc > 0 ? `+${inc.toLocaleString()}` : '0';
            const outStr = out > 0 ? `-${out.toLocaleString()}` : '0';
            routeDetails = ` <span style="color:#aaa;">(b: ${base.toLocaleString()} | i: ${incStr} | o: ${outStr}${targetDetails})</span>`;
        } else {
            routeDetails = ` <span style="color:#aaa;">(b: ${base.toLocaleString()}${targetDetails})</span>`;
        }
        return `${icon} ${name}: <strong>${total.toLocaleString()}/h</strong>${routeDetails}`;
    }

    function getVillageTooltipHtml(v) {
        let incWood = 0, incClay = 0, incIron = 0, incCrop = 0;
        let outWood = 0, outClay = 0, outIron = 0, outCrop = 0;

        state.routes.forEach(r => {
            if (r.toX === v.x && r.toY === v.y) {
                incWood += (r.wood || 0);
                incClay += (r.clay || 0);
                incIron += (r.iron || 0);
                incCrop += (r.crop || 0);
            }
            if (r.fromX === v.x && r.fromY === v.y) {
                outWood += (r.wood || 0);
                outClay += (r.clay || 0);
                outIron += (r.iron || 0);
                outCrop += (r.crop || 0);
            }
        });

        const req = getVillageRequiredIncome(v);

        return `
            <strong style="color:#fff">${v.name} (${v.x}|${v.y})</strong><br/>
            ${formatResourceTooltipLine('🌲', 'Lumber', v.wood || 0, incWood, outWood, req.wood)}<br/>
            ${formatResourceTooltipLine('🧱', 'Stone', v.clay || 0, incClay, outClay, req.clay)}<br/>
            ${formatResourceTooltipLine('⛏️', 'Metal', v.iron || 0, incIron, outIron, req.iron)}<br/>
            ${formatResourceTooltipLine('🥩', 'Food', v.crop || 0, incCrop, outCrop, req.crop)}<br/>
            <hr style="border:0; border-top:1px solid #332e28; margin: 4px 0;"/>
            <span style="font-size:10px; color:#ffc107;">Click village node to edit resource targets</span>
        `;
    }

    function getRouteTooltipHtml(r) {
        const fromName = getVillageName(r.fromX, r.fromY);
        const toName = r.destName || getVillageName(r.toX, r.toY);
        const schedInfo = (r.repeatHours && r.deliveries)
            ? `<span style="color:#aaa;">Schedule: ${r.deliveries}x delivery every ${r.repeatHours}h</span><br/>`
            : '';

        return `
            <strong style="color:var(--tw-paper-light)">Trade Route Details</strong><br/>
            From: <strong>${fromName}</strong> (${r.fromX}|${r.fromY})<br/>
            To: <strong>${toName}</strong> (${r.toX}|${r.toY})<br/>
            ${schedInfo}
            🌲 Lumber: +${(r.wood || 0).toLocaleString()}/h<br/>
            🧱 Stone: +${(r.clay || 0).toLocaleString()}/h<br/>
            ⛏️ Metal: +${(r.iron || 0).toLocaleString()}/h<br/>
            🥩 Food: +${(r.crop || 0).toLocaleString()}/h
        `;
    }

    // --- Render SVG Graph ---
    function render() {
        const villages = Object.values(state.villages);
        const routes = state.routes;
        const customItems = state.customItems || [];
        const svg = document.getElementById('tw-svg');
        const container = document.getElementById('tw-canvas-container');
        const sidebarList = document.getElementById('tw-village-list');

        svg.innerHTML = '';
        sidebarList.innerHTML = '';

        if (villages.length === 0 && customItems.length === 0) {
            sidebarList.innerHTML = '<div style="font-size:12px; color:#888;">No villages auto-parsed yet. Navigate around your villages to register them automatically.</div>';
            return;
        }

        const allXs = [...villages.map(v => v.x), ...customItems.map(c => c.x)];
        const allYs = [...villages.map(v => v.y), ...customItems.map(c => c.y)];

        let minX = Math.min(...allXs), maxX = Math.max(...allXs);
        let minY = Math.min(...allYs), maxY = Math.max(...allYs);

        minX -= 5; maxX += 5; minY -= 5; maxY += 5;
        const width = container.clientWidth || 600;
        const height = container.clientHeight || 500;

        const mapX = (x) => ((x - minX) / ((maxX - minX) || 1)) * (width - 100) + 50;
        const mapY = (y) => height - (((y - minY) / ((maxY - minY) || 1)) * (height - 100) + 50);

        const routeGroupMap = new Map();
        routes.forEach(r => {
            const dirKey = `${r.fromX},${r.fromY}_to_${r.toX},${r.toY}`;
            if (!routeGroupMap.has(dirKey)) routeGroupMap.set(dirKey, []);
            routeGroupMap.get(dirKey).push(r);
        });

        const routesGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        routesGroupElement.id = 'tw-routes-group';

        const nodesGroupElement = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        nodesGroupElement.id = 'tw-nodes-group';

        svg.appendChild(routesGroupElement);
        svg.appendChild(nodesGroupElement);

        const routeDomMap = new Map();

        function activateRouteHighlight(path, arrow) {
            routesGroupElement.querySelectorAll('.tw-route-path, .tw-route-arrow').forEach(p => p.style.opacity = '0.25');
            path.style.opacity = '1';
            arrow.style.opacity = '1';
            path.setAttribute('stroke-width', '5');
            routesGroupElement.appendChild(path);
            routesGroupElement.appendChild(arrow);
        }

        function deactivateRouteHighlight() {
            routesGroupElement.querySelectorAll('.tw-route-path, .tw-route-arrow').forEach(p => {
                p.style.opacity = '1';
                p.setAttribute('stroke-width', '3');
            });
            deactivateTooltip();
        }

        // --- Render Trade Routes ---
        routes.forEach(r => {
            const x1 = mapX(r.fromX), y1 = mapY(r.fromY);
            const x2 = mapX(r.toX), y2 = mapY(r.toY);
            const color = getRouteColor(r);

            const dx = x2 - x1;
            const dy = y2 - y1;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            const nx = -dy / dist;
            const ny = dx / dist;

            const dirKey = `${r.fromX},${r.fromY}_to_${r.toX},${r.toY}`;
            const group = routeGroupMap.get(dirKey) || [r];
            const index = group.indexOf(r);

            const baseOffset = 25;
            const offsetSpacing = 18;
            const distanceScale = Math.min(Math.max(dist / 250, 0.8), 2.0);
            const curveOffset = (baseOffset + index * offsetSpacing) * distanceScale;

            const cx = (x1 + x2) / 2 + nx * curveOffset;
            const cy = (y1 + y2) / 2 + ny * curveOffset;

            const mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
            const my = 0.25 * y1 + 0.5 * cy + 0.25 * y2;

            const arrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '3');
            path.setAttribute('fill', 'none');
            path.setAttribute('class', 'tw-route-path');
            path.style.cursor = 'pointer';

            const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            arrow.setAttribute('points', '-7,-5 6,0 -7,5');
            arrow.setAttribute('fill', color);
            arrow.setAttribute('transform', `translate(${mx}, ${my}) rotate(${arrowAngle})`);
            arrow.setAttribute('class', 'tw-route-arrow');
            arrow.style.pointerEvents = 'none';

            path.onmousemove = (e) => {
                activateRouteHighlight(path, arrow);
                showTooltip(getRouteTooltipHtml(r), e);
            };
            path.onmouseleave = () => deactivateRouteHighlight();

            routesGroupElement.appendChild(path);
            routesGroupElement.appendChild(arrow);

            routeDomMap.set(r.id, { route: r, path: path, arrow: arrow });
        });

        // --- Render Villages on SVG ---
        villages.forEach(v => {
            const cx = mapX(v.x), cy = mapY(v.y);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.style.cursor = 'pointer';

            const nodeColor = getVillageNodeColor(v);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', '8');
            circle.setAttribute('fill', nodeColor);
            circle.setAttribute('stroke', '#e8d8b7');
            circle.setAttribute('stroke-width', '2');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', cx + 12); text.setAttribute('y', cy + 4);
            text.setAttribute('fill', '#e8d8b7'); text.setAttribute('font-size', '12px');
            text.setAttribute('font-weight', 'bold');
            text.style.pointerEvents = 'none';
            text.textContent = `${v.name} (${v.x}|${v.y})`;

            g.appendChild(circle); g.appendChild(text);

            const vId = `node_v_${v.x}_${v.y}`;

            handleInteractiveElement(
                g,
                vId,
                null,
                () => getVillageTooltipHtml(v),
                null,
                deactivateTooltip,
                () => openVillageModal(v)
            );

            nodesGroupElement.appendChild(g);
        });

        // --- Render Custom Map Markers ---
        customItems.forEach(c => {
            const cx = mapX(c.x), cy = mapY(c.y);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.style.cursor = 'pointer';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', '6');
            circle.setAttribute('fill', c.color);
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '1.5');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', cx + 12); text.setAttribute('y', cy + 4);
            text.setAttribute('fill', c.color); text.setAttribute('font-size', '12px');
            text.setAttribute('font-weight', 'bold');
            text.style.pointerEvents = 'none';
            text.textContent = `${c.title} (${c.x}|${c.y})`;

            g.appendChild(circle); g.appendChild(text);

            const cId = `node_c_${c.id}`;
            const navUrl = `/map/tile/${c.x}/${c.y}?center=true`;
            const getHtml = () => `
                <strong style="color:${c.color}">${c.title} (${c.x}|${c.y})</strong><br/>
                ${c.note ? `<span style="color:#ddd;">${c.note}</span><br/>` : ''}
                <hr style="border:0; border-top:1px solid #332e28; margin: 4px 0;"/>
                <span style="font-size:10px; color:#aaa;">Click / tap again to view tile map</span>
            `;

            handleInteractiveElement(
                g,
                cId,
                navUrl,
                getHtml,
                null,
                deactivateTooltip
            );

            nodesGroupElement.appendChild(g);
        });

        // --- Render Sidebar ---
        const sortedVillages = [...villages].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' })
        );

        const vHeader = document.createElement('div');
        vHeader.style.cssText = 'font-weight:bold; margin-bottom: 6px; color:#e8d8b7;';
        vHeader.textContent = `Villages (${sortedVillages.length}):`;
        sidebarList.appendChild(vHeader);

        sortedVillages.forEach(v => {
            const div = document.createElement('div');
            div.className = 'tw-list-item';
            div.style.cursor = 'pointer';

            const statusColor = getVillageNodeColor(v);
            div.innerHTML = `
                <span>
                    <span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${statusColor}; margin-right:6px;"></span>
                    ${v.name} (${v.x}|${v.y})
                </span>
            `;

            const sidebarVId = `sidebar_v_${v.x}_${v.y}`;

            handleInteractiveElement(
                div,
                sidebarVId,
                null,
                () => getVillageTooltipHtml(v),
                null,
                deactivateTooltip,
                () => openVillageModal(v)
            );

            sidebarList.appendChild(div);
        });

        // Custom Markers Sidebar
        if (customItems.length > 0) {
            const sortedCustomItems = [...customItems].sort((a, b) =>
                (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' })
            );

            const cHeader = document.createElement('div');
            cHeader.style.cssText = 'font-weight:bold; margin: 12px 0 6px 0; color:#e8d8b7;';
            cHeader.textContent = `Custom Markers (${sortedCustomItems.length}):`;
            sidebarList.appendChild(cHeader);

            sortedCustomItems.forEach(c => {
                const div = document.createElement('div');
                div.className = 'tw-list-item';
                div.innerHTML = `
                    <span class="tw-marker-title" style="color:${c.color}; font-weight:bold; cursor:pointer;">${c.title} (${c.x}|${c.y})</span>
                    <button class="tw-del-btn" title="Delete Marker">✖</button>
                `;

                const titleSpan = div.querySelector('.tw-marker-title');
                const sidebarCId = `sidebar_c_${c.id}`;
                const navUrl = `/map/tile/${c.x}/${c.y}?center=true`;
                const getHtml = () => `
                    <strong style="color:${c.color}">${c.title} (${c.x}|${c.y})</strong><br/>
                    ${c.note ? `<span style="color:#ddd;">${c.note}</span><br/>` : ''}
                    <hr style="border:0; border-top:1px solid #332e28; margin: 4px 0;"/>
                    <span style="font-size:10px; color:#aaa;">Click / tap again to view tile map</span>
                `;

                handleInteractiveElement(
                    titleSpan,
                    sidebarCId,
                    navUrl,
                    getHtml,
                    null,
                    deactivateTooltip
                );

                const delBtn = div.querySelector('.tw-del-btn');
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteCustomMarker(c.id);
                };

                sidebarList.appendChild(div);
            });
        }

        // Active Routes Sidebar
        if (routes.length > 0) {
            const sortedRoutes = [...routes].sort((a, b) => {
                const nameA = `${getVillageName(a.fromX, a.fromY)} -> ${a.destName || getVillageName(a.toX, a.toY)}`;
                const nameB = `${getVillageName(b.fromX, b.fromY)} -> ${b.destName || getVillageName(b.toX, b.toY)}`;
                return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
            });

            const rHeader = document.createElement('div');
            rHeader.style.cssText = 'font-weight:bold; margin: 12px 0 6px 0; color:#e8d8b7;';
            rHeader.textContent = `Active Routes (${sortedRoutes.length}):`;
            sidebarList.appendChild(rHeader);

            sortedRoutes.forEach(r => {
                const fromName = getVillageName(r.fromX, r.fromY);
                const toName = r.destName || getVillageName(r.toX, r.toY);

                const div = document.createElement('div');
                div.className = 'tw-list-item';
                div.style.cursor = 'pointer';
                div.innerHTML = `<span>🛤️ ${fromName} → ${toName}</span>`;

                const domRef = routeDomMap.get(r.id);
                const sidebarRId = `sidebar_r_${r.id}`;

                handleInteractiveElement(
                    div,
                    sidebarRId,
                    null,
                    () => getRouteTooltipHtml(r),
                    () => { if (domRef) activateRouteHighlight(domRef.path, domRef.arrow); },
                    deactivateRouteHighlight
                );

                sidebarList.appendChild(div);
            });
        }
    }

    scrapePageVillageData();
    createUI();
})();
