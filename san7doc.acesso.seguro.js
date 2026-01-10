(function() {
    const s7Init = () => {
        if (document.getElementById('s7-wrapper')) return;

        const s = document.createElement('style');
        s.textContent = `
            :root { --s7-blue: #01579B; --s7-cream: #FDFCF0; --s7-dark: #1a1a1a; }
            #s7-trigger { position: fixed; right: 0; top: 50%; transform: translateY(-50%); width: 45px; height: 50px; background: var(--s7-blue); border-radius: 15px 0 0 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 2147483646; transition: 0.3s; border: 1px solid var(--s7-cream); border-right: none; box-shadow: -2px 0 10px rgba(0,0,0,0.2); }
            #s7-trigger img { width: 28px; height: 28px; }
            #s7-overlay { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(253, 252, 240, 0.98); z-index: 2147483647; overflow-y: auto; padding: 40px 20px; box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
            #s7-overlay.active { display: block; animation: s7FadeIn 0.4s ease forwards; }
            @keyframes s7FadeIn { from { opacity: 0; } to { opacity: 1; } }
            #s7-close { position: fixed; top: 20px; right: 20px; width: 45px; height: 45px; background: var(--s7-blue); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 24px; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.2); }
            .s7-container { max-width: 900px; margin: 0 auto; color: var(--s7-blue); }
            .s7-header { text-align: center; margin-bottom: 40px; border-bottom: 2px solid var(--s7-blue); padding-bottom: 20px; }
            .s7-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
            .s7-card { background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #ddd; display: flex; align-items: center; justify-content: space-between; transition: 0.3s; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
            .s7-card:hover { border-color: var(--s7-blue); transform: translateY(-2px); }
            .s7-info { display: flex; align-items: center; gap: 15px; }
            .s7-info svg { width: 24px; height: 24px; fill: var(--s7-blue); }
            .s7-switch { position: relative; width: 50px; height: 26px; }
            .s7-switch input { opacity: 0; width: 0; height: 0; }
            .s7-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; transition: .4s; border-radius: 34px; }
            .s7-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 4px; bottom: 4px; background: white; transition: .4s; border-radius: 50%; }
            input:checked + .s7-slider { background: var(--s7-blue); }
            input:checked + .s7-slider:before { transform: translateX(24px); }
            .s7-full-row { grid-column: 1 / -1; background: #fff; padding: 20px; border-radius: 12px; border: 1px solid #ddd; }
            #s7-range { width: 100%; accent-color: var(--s7-blue); height: 10px; cursor: pointer; }
            .s7-footer { text-align: center; margin-top: 50px; font-weight: bold; opacity: 0.7; font-size: 14px; text-transform: uppercase; }
            /* Classes de Efeito */
            .s7-dark { filter: invert(1) hue-rotate(180deg) !important; background: #000 !important; }
            .s7-sepia { filter: sepia(1) !important; }
            .s7-grayscale { filter: grayscale(1) !important; }
            .s7-cursor { cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="10" fill="rgba(1,87,155,0.5)"/></svg>'), auto !important; }
            .s7-readable-font { font-family: 'Arial', sans-serif !important; letter-spacing: 0.05em !important; line-height: 1.8 !important; }
        `;
        document.head.appendChild(s);

        const wrap = document.createElement('div');
        wrap.id = 's7-wrapper';
        wrap.innerHTML = `
            <div id="s7-trigger"><img src="https://cdn-icons-png.freepik.com/512/5785/5785323.png" alt="S7"></div>
            <div id="s7-overlay">
                <div id="s7-close">✕</div>
                <div class="s7-container">
                    <div class="s7-header"><h1>CENTRAL DE ACESSIBILIDADE SAN7DOC</h1></div>
                    <div class="s7-grid">
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg><span>Leitor de Voz</span></div><label class="s7-switch"><input type="checkbox" id="t-voice"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M12 3v18c5.52 0 10-4.48 10-10S17.52 3 12 3z"/></svg><span>Contraste Noturno</span></div><label class="s7-switch"><input type="checkbox" id="t-dark"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M22 10V6h-8V2h-4v4H2v4h4v4H2v4h8v4h4v-4h8v-4h-4v-4h4z"/></svg><span>Cursor Ampliado</span></div><label class="s7-switch"><input type="checkbox" id="t-cursor"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M4 9h16v2H4zm0 4h10v2H4z"/></svg><span>Fonte Legível</span></div><label class="s7-switch"><input type="checkbox" id="t-font"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg><span>Modo Monocromático</span></div><label class="s7-switch"><input type="checkbox" id="t-gray"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg><span>Destacar Links</span></div><label class="s7-switch"><input type="checkbox" id="t-link"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M12 22C6.47 22 2 17.53 2 12S6.47 2 12 2s10 4.47 10 10-4.47 10-10 10zm-1-11v4h2v-4h3l-4-4-4 4h3z"/></svg><span>Parar Animações</span></div><label class="s7-switch"><input type="checkbox" id="t-anim"><span class="s7-slider"></span></label></div>
                        <div class="s7-card"><div class="s7-info"><svg viewBox="0 0 24 24"><path d="M21 11.64c0 3.04-2.37 5.55-5.39 5.81l1.42 1.42c.42.42.42 1.1 0 1.51-.21.21-.48.31-.75.31s-.54-.1-.75-.31l-2.79-2.79c-.16-.16-.25-.37-.25-.6s.09-.44.25-.6l2.79-2.79c.42-.42 1.1-.42 1.51 0s.42 1.1 0 1.51l-1.37 1.37c1.91-.22 3.42-1.84 3.42-3.79 0-2.1-1.71-3.81-3.81-3.81-.28 0-.54.03-.8.08l-.29-2.43c.36-.05.72-.08 1.09-.08 3.45 0 6.24 2.79 6.24 6.24zM5.5 12c0-1.91 1.39-3.49 3.21-3.77l-1.36-1.36c-.42-.42-.42-1.1 0-1.51s1.1-.42 1.51 0l2.79 2.79c.16.16.25.37.25.6s-.09.44-.25.6L8.65 11.54c-.42.42-1.1.42-1.51 0s-.42-1.1 0-1.51l1.42-1.42C5.54 8.35 3.24 10.9 3.24 14c0 3.45 2.79 6.24 6.24 6.24.34 0 .68-.03 1.01-.08l-.29-2.43c-.23.05-.48.08-.72.08-2.1 0-3.81-1.71-3.81-3.81z"/></svg><span>Inverter Cores</span></div><label class="s7-switch"><input type="checkbox" id="t-inv"><span class="s7-slider"></span></label></div>
                        <div class="s7-full-row">
                            <div class="s7-info" style="margin-bottom:15px"><svg viewBox="0 0 24 24"><path d="M12.79 21L3 11.21V3h8.21L21 12.79 12.79 21zM5 5v3.21l7.79 7.79 3.21-3.21L8.21 5H5z"/></svg><span>Ajustar Tamanho do Texto: <b id="s7-val">100%</b></span></div>
                            <input type="range" id="s7-range" min="100" max="200" value="100">
                        </div>
                    </div>
                    <div class="s7-footer">Tecnologia de Acessibilidade San7Doc &copy; 2026</div>
                </div>
            </div>
        `;
        document.body.appendChild(wrap);

        const trigger = document.getElementById('s7-trigger'), overlay = document.getElementById('s7-overlay'), close = document.getElementById('s7-close'), range = document.getElementById('s7-range'), valDisp = document.getElementById('s7-val');
        const ids = ['voice', 'dark', 'cursor', 'font', 'gray', 'link', 'anim', 'inv'];
        const controls = {};
        ids.forEach(id => controls[id] = document.getElementById('t-' + id));

        const updateState = (key, val) => localStorage.setItem('s7_db_' + key, val);
        const getState = (key) => localStorage.getItem('s7_db_' + key);

        trigger.onclick = () => { trigger.style.display = 'none'; overlay.classList.add('active'); };
        close.onclick = () => { overlay.classList.remove('active'); trigger.style.display = 'flex'; };

        // 1. Zoom Texto Site
        const applyZoom = (v) => {
            valDisp.innerText = v + '%';
            document.querySelectorAll('p, span, h1, h2, h3, h4, h5, a, li, button').forEach(el => {
                if (!overlay.contains(el)) el.style.fontSize = (v/100) + 'em';
            });
        };
        range.oninput = () => { applyZoom(range.value); updateState('zoom', range.value); };

        // 2. Voz Google
        let synth = window.speechSynthesis;
        controls.voice.onchange = () => { if(!controls.voice.checked) synth.cancel(); updateState('voice', controls.voice.checked); };
        document.addEventListener('click', (e) => {
            if (controls.voice.checked && !wrap.contains(e.target)) {
                if (e.target.closest('header') || e.target.closest('footer')) return;
                synth.cancel();
                const u = new SpeechSynthesisUtterance(e.target.innerText || e.target.title);
                u.lang = 'pt-BR';
                synth.speak(u);
            }
        });
        document.addEventListener('dblclick', () => { if(controls.voice.checked) synth.cancel(); });

        // 3. Funções de Estilo
        controls.dark.onchange = () => { document.documentElement.classList.toggle('s7-dark', controls.dark.checked); updateState('dark', controls.dark.checked); };
        controls.cursor.onchange = () => { document.body.classList.toggle('s7-cursor', controls.cursor.checked); updateState('cursor', controls.cursor.checked); };
        controls.font.onchange = () => { document.body.classList.toggle('s7-readable-font', controls.font.checked); updateState('font', controls.font.checked); };
        controls.gray.onchange = () => { document.documentElement.classList.toggle('s7-grayscale', controls.gray.checked); updateState('gray', controls.gray.checked); };
        controls.link.onchange = () => { 
            document.querySelectorAll('a').forEach(a => a.style.textDecoration = controls.link.checked ? 'underline' : ''); 
            updateState('link', controls.link.checked); 
        };
        controls.anim.onchange = () => {
            const css = '* { transition: none !important; animation: none !important; }';
            if(controls.anim.checked) {
                const st = document.createElement('style'); st.id = 's7-no-anim'; st.textContent = css; document.head.appendChild(st);
            } else {
                const st = document.getElementById('s7-no-anim'); if(st) st.remove();
            }
            updateState('anim', controls.anim.checked);
        };
        controls.inv.onchange = () => { document.documentElement.style.filter = controls.inv.checked ? 'invert(1)' : ''; updateState('inv', controls.inv.checked); };

        // Carregar Estado
        ids.forEach(id => {
            if(getState(id) === 'true') { controls[id].checked = true; controls[id].dispatchEvent(new Event('change')); }
        });
        if(getState('zoom')) { range.value = getState('zoom'); applyZoom(range.value); }
    };

    if (document.readyState === 'complete') s7Init();
    else window.addEventListener('load', s7Init);
})();