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

* **Inline 3-Day Growth & 24h Momentum**: Displays percentage changes alongside real-time velocity indicators (`▲` Accelerating, `▼` Slowing down, `⏸` Growth paused).
* **Interactive Trend Charts**: Click any growth badge to view historical line charts with customizable time ranges (`3D`, `7D`, `30D`, `All`).
* **Travian-Style Strategy Intel**: Automatically profiles players into combat archetypes based on 24-hour activity (*Eco Rusher*, *Hammer Builder*, *Decimated Defense*, *Active Raider*).
* **Automatic Gist Sync**: Retains a full 90-day server season history backed up to your private GitHub Gist, featuring automatic bypass for large payloads (>1MB).
* **Customizable Number Formatting**: Toggle between Raw (1,234,567) and Compact (1.2M / 1.2k) display modes anytime in the Gist Settings modal.
* **Flexible Time Display**: Switch between UTC and Local time formats across chart X-axes and hover tooltips directly in the Gist Settings modal.

<p align="left">
  <img width="614" alt="Leaderboard Growth Badges" src="https://github.com/user-attachments/assets/10a4893f-9c22-48ec-a665-6b0a435ef565" />
  <br><br>
  <img width="667" alt="Strategic Intel & Trend Modal" src="https://github.com/user-attachments/assets/fb13a2e0-9a24-4037-884e-ba7dafb74c7f" />
</p>

---

### 2. [Thronewake - Empire Defense Tracker](https://github.com/petrgon/Thronewake-extensions/blob/main/Thronewake%20-%20Empire%20Defense%20Tracker.js) ([Direct Install](https://raw.githubusercontent.com/petrgon/Thronewake-extensions/main/Thronewake%20-%20Empire%20Defense%20Tracker.js))
Helps you collect and organize total troop counts across all your territories.

* **Data Collection**: Open the troops count bottom-right panel and visit each village to record data.
* **Breakdown Export**: Click the panel to copy a complete village troop breakdown to your clipboard.
* **Mobile Friendly**: Fully optimized for mobile phone browsers.

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
  <img width="460" alt="Thronewake Map Travel Time Calculator" src="YOUR_IMAGE_URL_HERE" />
</p>

<p align="left">
  <img width="731" height="821" alt="image" src="https://github.com/user-attachments/assets/76a339d8-2c57-4fe1-a348-61c9443db570" />
</p>
