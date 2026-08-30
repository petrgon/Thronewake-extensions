# Thronewake Extensions

A collection of Userscripts designed to enhance gameplay, tracking, and strategy in Thronewake.

---

## 🛠️ How to Install Any Extension

1. Install a Userscript Manager extension for your browser:
   * [Violentmonkey](https://violentmonkey.github.io/) (Recommended)
   * [Tampermonkey](https://www.tampermonkey.net/) (Works on iOS)
   * [Greasemonkey](https://www.greasyfork.org/)
2. Click any of the extension titles below and select **Raw** (or click **Direct Install**) to automatically trigger the installation prompt in your Userscript manager.

---

## 📜 Extensions Included

### 1. [Thronewake Multi-Column Growth & Strategic Intel](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20Multi-Column%20Growth%20%26%20Strategic%20Intel.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20Multi-Column%20Growth%20%26%20Strategic%20Intel.js))
Tracks individual player leaderboard categories over time and provides real-time growth, momentum, and strategic combat intelligence.

* **Server-Speed Scaled Growth**: Calculates progression using 3 vs 9 game day windows adjusted to server speed, displaying exact real duration tooltips.
* **Inline Momentum Badges**: Displays growth percentages alongside theme-harmonized momentum icons (`▲` Accelerating, `▶` Steady, `▼` Slowing/Declining, `⏸` Paused).
* **Strategic Combat Intel**: Profiles players into tactical archetypes (*Eco Rusher*, *Hammer Builder*, *Decimated Defense*, *Active Raider*) scaled to account size.
* **Interactive Trend Charts**: Click growth badges to view historical line charts (`3D`, `7D`, `30D`, `All`) with live real-time score injection.
* **Smart Gist Backup**: Syncs 90-day season history and settings to a private GitHub Gist, using two-point boundary compression to maximize storage.
* **Customizable Settings**: Easily toggle between Raw (`1,234,567`) or Compact (`1.2M`) numbers, UTC or Local time, and custom record intervals.

<p align="left">
  <img width="614" alt="Leaderboard Growth Badges" src="https://github.com/user-attachments/assets/10a4893f-9c22-48ec-a665-6b0a435ef565" />
  <br><br>
  <img width="667" alt="Strategic Intel & Trend Modal" src="https://github.com/user-attachments/assets/fb13a2e0-9a24-4037-884e-ba7dafb74c7f" />
</p>

---

### 2. [Thronewake - Empire Defense Tracker](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20-%20Empire%20Defense%20Tracker.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20-%20Empire%20Defense%20Tracker.js))
Helps you collect and organize total defense troop counts across all your territories with live sync tracking and dual export options.

* **Automated Data Collection**: Open the bottom-right troop panel and visit each village to automatically record and update defense data.
* **Quick Stats Export (Single-Click)**: Click once to copy just the core summary line (e.g., `🛡️ Def Inf: 23,599 | 👁️ Scouts: 2,008`).
* **Full Breakdown Export (Double-Click)**: Click twice within 800ms to copy the full multi-village empire breakdown.
* **Hover Sync Indicator**: Hover over the panel to see how many villages have been synced within the last hour (e.g., 🏠 `6/8`).
* **Compact & Mobile-Friendly**: Space-efficient card layout with clean typography, fully optimized for mobile phone browsers and desktop views alike.

<p align="left">
  <img width="187" alt="Empire Defense Tracker Panel" src="https://github.com/user-attachments/assets/4751da98-7455-42a3-bfac-ee21e0eaeaa2" />
</p>

---

### 3. [Persistent Notepad for Thronewake](https://github.com/petrgon/Thronewake-extensions/blob/main/Persistent%20Notepad%20for%20Thronewake.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Persistent%20Notepad%20for%20Thronewake.js))
A moveable, resizable cloud-synced notepad overlay for in-game planning and village management.

* **Cloud Backups**: Syncs your notes via your personal private GitHub Gist.
* **Village-Specific Notes**: Every village stores its own dedicated notes automatically.
* **Customizable UI**: Drag to move or resize the notepad anywhere on your screen.
* **Mobile Friendly**: Fully optimized for touch devices and mobile screens.

<p align="left">
  <img width="460" alt="Persistent Notepad" src="https://github.com/user-attachments/assets/b1be3c46-df45-4037-9bcd-1337986dea9d" />
</p>

---

### 4. [Thronewake Map Travel Time Calculator](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20Map%20Travel%20Time%20Calculator.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20Map%20Travel%20Time%20Calculator.js))
An interactive travel duration, distance, and UTC arrival time calculator built directly into the Thronewake map interface.

* **Interactive Map Picking**: Pick Origin and Target coordinates directly from map tiles with z-index floating labels and pan-aware click interception.
* **Piecewise Travel Math**: Accurately models Server Speed (2x default), Bannerfield scaling (>20 tiles), Local Influence (final 25% boost), and research bonuses.
* **Smart Hotkeys**: Single-key shortcuts for picking coordinates (`O`/`T`) and switching factions (`E`/`V`/`S`).
* **Persistent Settings**: Saves active faction, research levels, building modifiers, and layout preferences automatically across sessions.

<p align="left">
  <img width="731" height="821" alt="image" src="https://github.com/user-attachments/assets/76a339d8-2c57-4fe1-a348-61c9443db570" />
</p>

### 4. [Thronewake - Troop & Intelligence Tracker](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20Troop%20%26%20Intelligence%20Tracker.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20Troop%20%26%20Intelligence%20Tracker.js))
Automatically gathers combat report data to track player garrisons, calculate offensive hammer power (HMR) and defense (DEF), and synchronize intelligence across your devices.

* **Automated Combat Report Parsing**: Automatically records surviving unit counts from scanned combat reports, intelligently accumulating split attacks occurring within a 1-hour window.
* **Unified In-Game Power Badges**: Injects clean, native-styled `HMR` and `DEF` indicators across Player profile pages, Alliance member lists, and Village detail views.
* **Interactive Statistics Modal**: Click any power badge to open a detailed breakdown modal displaying aggregate unit counts, total offensive/defensive values, and per-village garrison histories.
* **Native Collapsible UI Cards**: Injects seamless "Troop Intelligence" panels with paper-theme toggle controls positioned above village listings and village action blocks.
* **Gist Cloud Synchronization**: Syncs your cross-player intelligence database remotely using GitHub Gists with a compact JSON format for minimal bandwidth usage.
* **Configurable Time Preferences**: Supports toggling timestamp displays between 24-hour Local Time and UTC formats directly from the configuration menu.

<p align="left">
  <img width="642" height="520" alt="image" src="https://github.com/user-attachments/assets/a99e81d2-5e4a-4320-9f80-d09cd87c6fec" />
  <img width="620" height="249" alt="image" src="https://github.com/user-attachments/assets/bfabfbbb-f46e-4df7-8e58-0b171dfc8e33" />
</p>


### 5. [Thronewake - Trade Route & Income Visualizer](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20Trade%20Route%20Income%20Visualizer.js) ([Direct Install]([https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20-%20Trade%20Route%20%26%20Income%20Visualizer.js](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/refs/heads/main/Thronewake%20Trade%20Route%20Income%20Visualizer.js)))
Visualizes your empire's trade networks, net village resource flows, and custom territory markers on an interactive SVG canvas.

* **Interactive SVG Territory Map**: Displays an overlay map showing all your discovered villages, active trade routes, and custom points of interest in a clean visual network.
* **Detailed Net Income Tooltips**: Hover over any village to view hourly production rates broken down by base production, incoming trade, and outgoing shipments (`base` | `in` | `out`).
* **Non-Overlapping Directional Routes**: Separates overlapping and opposing trade paths using dynamic curvature and directional mid-route arrows to maintain map clarity.
* **Cargo Color-Coding**: Color-codes routes based on their contents—Lumber, Stone, Metal, Meat, or Mixed loads—for quick identification of resource routes.
* **Custom Map Markers**: Add custom markers anywhere on the map with user-defined titles, notes, coordinates, and colors to track targets, outposts, or strategic points.
* **Linked Sidebar & Tile Navigation**: Features sorted sidebar lists with bidirectional hover-highlighting between the list and graph, plus single-click map tile navigation.

<p align="left">
  <img width="1603" height="976" alt="image" src="https://github.com/user-attachments/assets/e81a0498-7eb8-41c6-84e6-f45ee37ed8f8" />
  <img width="1602" height="972" alt="image" src="https://github.com/user-attachments/assets/fd5872f4-a816-467a-828e-3a086b31a1b7" />
</p>
