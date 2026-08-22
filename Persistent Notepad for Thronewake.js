// ==UserScript==
// @name         Top-Left Persistent Notepad (Mobile Drag & Resize)
// @namespace    violentmonkey-persistent-notes
// @version      4.6
// @description  Per-village persistent notes synced with GitHub Gist. Features full mobile touch drag, touch resize handle, and settings modal.
// @match        *://*.thronewake.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  if (document.getElementById("persistent-notes-widget")) return;

  const ICON_GEAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
  const ICON_CHEVRON_DOWN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  const ICON_CHEVRON_UP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`;

  GM_addStyle(`
    #persistent-notes-widget {
      position: fixed;
      width: 260px;
      height: 200px;
      min-width: 180px;
      min-height: 100px;
      max-width: 85vw;
      max-height: 80vh;
      z-index: 999999;
      background-color: #ece8d6;
      color: #101010;
      border: 2px solid #101010;
      border-radius: 4px;
      box-shadow: inset 0 0 10px rgba(16, 16, 16, 0.3), 0 4px 14px rgba(0, 0, 0, 0.5);
      display: none;
      flex-direction: column;
      font-family: "Josefin Sans Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      box-sizing: border-box;
      touch-action: none;
    }

    #persistent-notes-header {
      background-color: #6a5a48;
      color: #dcd3c6;
      padding: 0 8px;
      height: 32px;
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      display: flex;
      justify-content: space-between;
      align-items: center;
      user-select: none;
      cursor: move;
      white-space: nowrap;
      border-bottom: 2px solid #101010;
      box-sizing: border-box;
      flex-shrink: 0;
      touch-action: none;
    }

    #persistent-notes-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 6px;
    }

    .pn-header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    #persistent-notes-status {
      font-size: 10px;
      opacity: 0.85;
      cursor: pointer;
      margin-right: 4px;
      transition: opacity 0.15s ease;
    }

    #persistent-notes-status:hover {
      opacity: 1;
      text-decoration: underline;
    }

    .pn-icon-btn {
      background: transparent;
      border: none;
      color: #dcd3c6;
      cursor: pointer;
      padding: 0;
      width: 22px;
      height: 22px;
      opacity: 0.8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      transition: background-color 0.15s ease, opacity 0.15s ease;
      flex-shrink: 0;
      box-sizing: border-box;
    }

    .pn-icon-btn svg {
      display: block;
      width: 14px;
      height: 14px;
      pointer-events: none;
      margin-bottom: 1px;
    }

    .pn-icon-btn:hover {
      opacity: 1;
      background-color: rgba(255, 255, 255, 0.15);
    }

    #persistent-notes-textarea {
      flex: 1;
      width: 100%;
      border: none;
      padding: 10px;
      padding-bottom: 18px;
      background-color: #f8f4e6;
      color: #101010;
      resize: none;
      font-size: 14px;
      font-weight: 500;
      line-height: 1.5;
      outline: none;
      box-sizing: border-box;
      font-family: "Josefin Sans Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    #persistent-notes-settings {
      display: none;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      background-color: #f8f4e6;
      flex: 1;
      box-sizing: border-box;
    }

    .pn-input-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .pn-input-group label {
      font-size: 10px;
      font-weight: 700;
      color: #6a5a48;
      text-transform: uppercase;
    }

    .pn-input-group input {
      border: 1px solid #101010;
      border-radius: 3px;
      padding: 4px;
      font-size: 12px;
      background: #ece8d6;
      color: #101010;
    }

    #pn-save-settings {
      background-color: #165eb9;
      color: #fff;
      border: 1px solid #101010;
      border-radius: 3px;
      padding: 5px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 4px;
    }

    #persistent-notes-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 22px;
      height: 22px;
      cursor: nwse-resize;
      touch-action: none;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
    }

    #persistent-notes-resize-handle::after {
      content: "◢";
      font-size: 11px;
      color: #6a5a48;
      position: absolute;
      bottom: 2px;
      right: 3px;
    }

    .pn-minimized {
      height: 32px !important;
      min-height: 32px !important;
      width: 150px !important;
      min-width: 150px !important;
    }

    .pn-minimized #persistent-notes-header {
      border-bottom: none;
    }

    .pn-minimized #persistent-notes-status,
    .pn-minimized #pn-settings-btn,
    .pn-minimized #persistent-notes-textarea,
    .pn-minimized #persistent-notes-settings,
    .pn-minimized #persistent-notes-resize-handle {
      display: none !important;
    }
  `);

  let allNotes = {};
  let saveDebounceTimer = null;

  function getGistId() { return GM_getValue("pn_gist_id", ""); }
  function getApiKey() { return GM_getValue("pn_api_key", ""); }

  function hasVillagePanel() {
    return !!(
      document.querySelector('select[aria-label="Switch village"]') ||
      document.querySelector('div[role="combobox"][aria-label="Switch village"]')
    );
  }

  function getVillageInfo() {
    const select = document.querySelector('select[aria-label="Switch village"]');
    if (select && select.options.length > 0) {
      const selectedOption = select.options[select.selectedIndex] || select.querySelector('option[selected]');
      if (selectedOption) {
        return {
          id: selectedOption.value || selectedOption.textContent.trim(),
          name: selectedOption.textContent.trim()
        };
      }
    }
    const comboSpan = document.querySelector('div[role="combobox"][aria-label="Switch village"] span');
    if (comboSpan && comboSpan.textContent.trim()) {
      const text = comboSpan.textContent.trim();
      return { id: text, name: text };
    }
    return { id: "global", name: "Global" };
  }

  const container = document.createElement("div");
  container.id = "persistent-notes-widget";
  container.style.top = GM_getValue("pn_top", "60px");
  container.style.left = GM_getValue("pn_left", "12px");
  container.style.width = GM_getValue("pn_width", "260px");
  container.style.height = GM_getValue("pn_height", "200px");

  const header = document.createElement("div");
  header.id = "persistent-notes-header";

  const title = document.createElement("span");
  title.id = "persistent-notes-title";

  const status = document.createElement("span");
  status.id = "persistent-notes-status";
  status.textContent = "⌛ Loading...";
  status.title = "Click to open Gist in browser";

  status.addEventListener("click", (e) => {
    e.stopPropagation();
    const gistId = getGistId();
    if (gistId) {
      window.open(`https://gist.github.com/${gistId}`, "_blank");
    }
  });

  const settingsBtn = document.createElement("button");
  settingsBtn.id = "pn-settings-btn";
  settingsBtn.className = "pn-icon-btn";
  settingsBtn.innerHTML = ICON_GEAR;
  settingsBtn.title = "Configure Gist Credentials";

  const toggleBtn = document.createElement("button");
  toggleBtn.id = "persistent-notes-toggle";
  toggleBtn.className = "pn-icon-btn";
  toggleBtn.innerHTML = ICON_CHEVRON_DOWN;
  toggleBtn.title = "Minimize / Expand Note";

  const rightGroup = document.createElement("div");
  rightGroup.className = "pn-header-actions";
  rightGroup.appendChild(status);
  rightGroup.appendChild(settingsBtn);
  rightGroup.appendChild(toggleBtn);

  header.appendChild(title);
  header.appendChild(rightGroup);

  const textarea = document.createElement("textarea");
  textarea.id = "persistent-notes-textarea";

  const settingsPanel = document.createElement("div");
  settingsPanel.id = "persistent-notes-settings";
  settingsPanel.innerHTML = `
    <div class="pn-input-group">
      <label>Gist ID</label>
      <input type="text" id="pn-input-gist" placeholder="YOUR_GIST_ID_HERE" value="${getGistId()}" />
    </div>
    <div class="pn-input-group">
      <label>GitHub Token (ghp_...)</label>
      <input type="password" id="pn-input-key" placeholder="ghp_YOUR_PERSONAL_TOKEN" value="${getApiKey()}" />
    </div>
    <button type="button" id="pn-save-settings">Save & Sync</button>
  `;

  const resizeHandle = document.createElement("div");
  resizeHandle.id = "persistent-notes-resize-handle";
  resizeHandle.title = "Drag to resize";

  container.appendChild(header);
  container.appendChild(textarea);
  container.appendChild(settingsPanel);
  container.appendChild(resizeHandle);
  document.body.appendChild(container);

  let currentVillage = getVillageInfo();

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const showSettings = settingsPanel.style.display !== "flex";
    settingsPanel.style.display = showSettings ? "flex" : "none";
    textarea.style.display = showSettings ? "none" : "block";
  });

  document.getElementById("pn-save-settings").addEventListener("click", () => {
    const newGist = document.getElementById("pn-input-gist").value.trim();
    const newKey = document.getElementById("pn-input-key").value.trim();

    GM_setValue("pn_gist_id", newGist);
    GM_setValue("pn_api_key", newKey);

    settingsPanel.style.display = "none";
    textarea.style.display = "block";

    fetchCloudNotes();
  });

  function fetchCloudNotes() {
    const gistId = getGistId();
    const apiKey = getApiKey();

    if (!gistId || !apiKey) {
      status.textContent = "⚠️ Config Needed";
      loadVillageNotes(currentVillage);
      return;
    }

    GM_xmlhttpRequest({
      method: "GET",
      url: `https://api.github.com/gists/${gistId}`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`
      },
      onload: function (response) {
        if (response.status === 200) {
          const res = JSON.parse(response.responseText);
          const file = res.files["thronewake_notes.json"];
          allNotes = file ? JSON.parse(file.content) : {};
          status.textContent = "☁️ Synced";
          loadVillageNotes(currentVillage);
        } else {
          status.textContent = "❌ Sync Error";
        }
      },
      onerror: function () {
        status.textContent = "❌ Offline";
      }
    });
  }

  function pushCloudNotes() {
    const gistId = getGistId();
    const apiKey = getApiKey();

    if (!gistId || !apiKey) return;

    status.textContent = "⏳ Saving...";

    GM_xmlhttpRequest({
      method: "PATCH",
      url: `https://api.github.com/gists/${gistId}`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`
      },
      data: JSON.stringify({
        files: {
          "thronewake_notes.json": { content: JSON.stringify(allNotes, null, 2) }
        }
      }),
      onload: function (response) {
        if (response.status === 200) {
          status.textContent = "☁️ Synced";
        } else {
          status.textContent = "❌ Save Error";
        }
      }
    });
  }

  function loadVillageNotes(village) {
    currentVillage = village;
    const shortName = village.name.replace(/\s*\(-?\d+\|-?\d+\)/, '');
    title.textContent = `📝 ${shortName}`;
    textarea.placeholder = `Notes for ${shortName}...`;
    textarea.value = allNotes[village.id] || "";
  }

  fetchCloudNotes();

  if (GM_getValue("pn_minimized", false)) {
    container.classList.add("pn-minimized");
    toggleBtn.innerHTML = ICON_CHEVRON_UP;
  }

  textarea.addEventListener("input", () => {
    allNotes[currentVillage.id] = textarea.value;
    status.textContent = "✏️ Typing...";
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(pushCloudNotes, 1000);
  });

  // Check panel presence and village updates periodically
  setInterval(() => {
    if (!hasVillagePanel()) {
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";
    const activeVillage = getVillageInfo();
    if (activeVillage.id !== currentVillage.id) {
      loadVillageNotes(activeVillage);
    }
  }, 500);

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const minState = container.classList.toggle("pn-minimized");
    toggleBtn.innerHTML = minState ? ICON_CHEVRON_UP : ICON_CHEVRON_DOWN;
    GM_setValue("pn_minimized", minState);
  });

  // TOUCH & MOUSE DRAGGING LOGIC
  let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

  function startDrag(clientX, clientY) {
    isDragging = true;
    dragOffsetX = clientX - container.offsetLeft;
    dragOffsetY = clientY - container.offsetTop;
  }

  function moveDrag(clientX, clientY) {
    if (!isDragging) return;
    container.style.left = Math.max(0, clientX - dragOffsetX) + "px";
    container.style.top = Math.max(0, clientY - dragOffsetY) + "px";
  }

  function stopDrag() {
    if (isDragging) {
      isDragging = false;
      GM_setValue("pn_top", container.style.top);
      GM_setValue("pn_left", container.style.left);
    }
  }

  header.addEventListener("mousedown", (e) => {
    if (e.target.closest('.pn-icon-btn') || e.target === status) return;
    startDrag(e.clientX, e.clientY);
  });

  header.addEventListener("touchstart", (e) => {
    if (e.target.closest('.pn-icon-btn') || e.target === status) return;
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener("mousemove", (e) => moveDrag(e.clientX, e.clientY));
  document.addEventListener("touchmove", (e) => {
    if (isDragging) {
      e.preventDefault();
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  document.addEventListener("mouseup", stopDrag);
  document.addEventListener("touchend", stopDrag);

  // TOUCH & MOUSE RESIZING LOGIC
  let isResizing = false, resizeStartW = 0, resizeStartH = 0, resizeStartX = 0, resizeStartY = 0;

  function startResize(clientX, clientY) {
    isResizing = true;
    resizeStartX = clientX;
    resizeStartY = clientY;
    resizeStartW = container.offsetWidth;
    resizeStartH = container.offsetHeight;
  }

  function moveResize(clientX, clientY) {
    if (!isResizing) return;
    const newW = Math.max(180, resizeStartW + (clientX - resizeStartX));
    const newH = Math.max(100, resizeStartH + (clientY - resizeStartY));
    container.style.width = newW + "px";
    container.style.height = newH + "px";
  }

  function stopResize() {
    if (isResizing) {
      isResizing = false;
      GM_setValue("pn_width", container.style.width);
      GM_setValue("pn_height", container.style.height);
    }
  }

  resizeHandle.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    startResize(e.clientX, e.clientY);
  });

  resizeHandle.addEventListener("touchstart", (e) => {
    e.stopPropagation();
    const touch = e.touches[0];
    startResize(touch.clientX, touch.clientY);
  }, { passive: true });

  document.addEventListener("mousemove", (e) => moveResize(e.clientX, e.clientY));
  document.addEventListener("touchmove", (e) => {
    if (isResizing) {
      e.preventDefault();
      moveResize(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  document.addEventListener("mouseup", stopResize);
  document.addEventListener("touchend", stopResize);
})();
