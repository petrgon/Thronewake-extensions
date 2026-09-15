// --- Shared Header Tools Registry ---
function registerHeaderTool(toolConfig) {
    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    win.TWHeaderHub = win.TWHeaderHub || {
        tools: [],
        register(tool) {
            if (this.tools.some(t => t.id === tool.id)) return;
            this.tools.push(tool);
            this.mount();
        },
        mount() {
            const header = document.querySelector('header');
            if (!header) return;

            let wrapper = document.getElementById('st-header-tools-wrapper');
            if (!wrapper) {
                wrapper = document.createElement('div');
                wrapper.id = 'st-header-tools-wrapper';
                wrapper.className = 'st-header-tools-wrapper';

                const targetContainer = header.querySelector('.relative.flex.items-center.justify-center') ||
                                        header.querySelector('.relative.z-1.flex.justify-start') ||
                                        header.querySelector('.paper') || header;
                targetContainer.appendChild(wrapper);

                document.addEventListener('click', (e) => {
                    const box = document.getElementById('st-dropdown-box');
                    if (box && !wrapper.contains(e.target)) box.classList.add('hidden');
                });
            }

            if (this.tools.length === 1) {
                const single = this.tools[0];
                wrapper.innerHTML = `
                    <button id="st-header-tools-btn" type="button" class="st-header-btn">
                        <span class="st-btn-desktop">${single.label}</span>
                        <span class="st-btn-mobile">${single.mobileIcon}</span>
                    </button>
                `;
                wrapper.querySelector('#st-header-tools-btn').onclick = (e) => {
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
                    <div id="st-dropdown-box" class="st-dropdown-box hidden">
                        ${itemsHtml}
                    </div>
                `;

                const btn = wrapper.querySelector('#st-header-tools-btn');
                const box = wrapper.querySelector('#st-dropdown-box');

                btn.onclick = (e) => {
                    e.stopPropagation();
                    box.classList.toggle('hidden');
                };

                this.tools.forEach(t => {
                    const itemBtn = wrapper.querySelector(`#st-tool-item-${t.id}`);
                    if (itemBtn) {
                        itemBtn.onclick = (e) => {
                            e.stopPropagation();
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
