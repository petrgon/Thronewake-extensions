function registerHeaderTool(toolConfig) {
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    win.TWHeaderHub = win.TWHeaderHub || {
        tools: [],
        stylesInjected: false,
        observerStarted: false,
        isOpen: false,
        debounceTimer: null,

        injectStyles() {
            if (this.stylesInjected) return;
            const css = `
                .st-header-tools-wrapper {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    margin-left: 8px;
                    pointer-events: auto !important;
                    z-index: 50;
                }
                .st-header-btn {
                    background: #165eb9;
                    color: #ffffff;
                    border: 1px solid #8c6d46;
                    padding: 4px 10px;
                    font-size: 12px;
                    font-weight: bold;
                    border-radius: 4px;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.5);
                    white-space: nowrap;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    pointer-events: auto !important;
                    user-select: none;
                    transition: background-color 0.15s ease;
                }
                .st-header-btn:hover {
                    background: #1c6ed8;
                }
                .st-dropdown-box {
                    position: absolute;
                    top: 100%;
                    right: 0;
                    margin-top: 4px;
                    background: #141210;
                    border: 1px solid #8c6d46;
                    border-radius: 4px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.8);
                    z-index: 100000;
                    display: flex;
                    flex-direction: column;
                    min-width: 140px;
                    overflow: hidden;
                    pointer-events: auto !important;
                }
                .st-dropdown-box.hidden {
                    display: none !important;
                }
                .st-dropdown-item {
                    background: transparent;
                    color: #e8d8b7;
                    border: none;
                    padding: 8px 12px;
                    font-size: 12px;
                    font-weight: bold;
                    text-align: left;
                    cursor: pointer;
                    width: 100%;
                    transition: background 0.15s ease;
                    pointer-events: auto !important;
                    white-space: nowrap;
                }
                .st-dropdown-item:hover {
                    background: #2d2924;
                    color: #ffffff;
                }
                @media (max-width: 768px) {
                    .st-btn-desktop { display: none !important; }
                    .st-btn-mobile { display: inline !important; }
                }
                @media (min-width: 769px) {
                    .st-btn-desktop { display: inline !important; }
                    .st-btn-mobile { display: none !important; }
                }
            `;
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
            this.stylesInjected = true;
        },

        startObserver() {
            if (this.observerStarted) return;
            this.observerStarted = true;

            // Global click listener to close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                const wrapper = document.getElementById('st-header-tools-wrapper');
                if (wrapper && !wrapper.contains(e.target)) {
                    this.isOpen = false;
                    const box = document.getElementById('st-dropdown-box');
                    if (box) box.classList.add('hidden');
                }
            }, true);

            const observer = new MutationObserver((mutations) => {
                // Ignore self mutations originating from script UI
                const isSelf = mutations.every(m => {
                    const t = m.target;
                    return t.closest && (t.closest('#st-header-tools-wrapper') || t.closest('#tw-modal-overlay'));
                });
                if (isSelf) return;

                if (this.debounceTimer) return;
                this.debounceTimer = setTimeout(() => {
                    this.debounceTimer = null;
                    const wrapper = document.getElementById('st-header-tools-wrapper');
                    if (!wrapper || !document.body.contains(wrapper)) {
                        this.mount();
                    }
                }, 150);
            });

            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
        },

        register(tool) {
            if (!this.tools.some(t => t.id === tool.id)) {
                this.tools.push(tool);
            }
            this.startObserver();
            this.mount();
        },

        mount() {
            this.injectStyles();
            const header = document.querySelector('header');
            if (!header) return;

            let wrapper = document.getElementById('st-header-tools-wrapper');

            // Reuse existing wrapper if already attached to DOM
            if (wrapper && document.body.contains(wrapper)) {
                if (wrapper.dataset.toolsCount === String(this.tools.length)) {
                    return;
                }
            } else {
                wrapper = document.createElement('div');
                wrapper.id = 'st-header-tools-wrapper';
                wrapper.className = 'st-header-tools-wrapper';

                const selectEl = header.querySelector('[role="combobox"]') || header.querySelector('select');
                let targetContainer = selectEl ? (selectEl.closest('.relative.flex') || selectEl.closest('div')) : null;
                if (!targetContainer) {
                    targetContainer = header.querySelector('.relative.flex.items-center') ||
                                      header.querySelector('.paper') || header;
                }
                targetContainer.appendChild(wrapper);
            }

            wrapper.dataset.toolsCount = String(this.tools.length);

            if (this.tools.length === 1) {
                const single = this.tools[0];
                wrapper.innerHTML = `
                    <button id="st-header-tools-btn" type="button" class="st-header-btn">
                        <span class="st-btn-desktop">${single.label}</span>
                        <span class="st-btn-mobile">${single.mobileIcon}</span>
                    </button>
                `;
                wrapper.querySelector('#st-header-tools-btn').onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    single.onClick(e);
                };
            } else {
                const itemsHtml = this.tools.map(t => 
                    `<button type="button" id="st-tool-item-${t.id}" class="st-dropdown-item">${t.label}</button>`
                ).join('');

                wrapper.innerHTML = `
                    <button id="st-header-tools-btn" type="button" class="st-header-btn">
                        <span class="st-btn-desktop">Tools ▾</span>
                        <span class="st-btn-mobile">🛠️▾</span>
                    </button>
                    <div id="st-dropdown-box" class="st-dropdown-box ${this.isOpen ? '' : 'hidden'}">
                        ${itemsHtml}
                    </div>
                `;

                const btn = wrapper.querySelector('#st-header-tools-btn');
                const box = wrapper.querySelector('#st-dropdown-box');

                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.isOpen = !this.isOpen;
                    box.classList.toggle('hidden', !this.isOpen);
                };

                this.tools.forEach(t => {
                    const itemBtn = wrapper.querySelector(`#st-tool-item-${t.id}`);
                    if (itemBtn) {
                        itemBtn.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.isOpen = false;
                            box.classList.add('hidden');
                            t.onClick(e);
                        };
                    }
                });
            }
        }
    };

    win.TWHeaderHub.register(toolConfig);
}
