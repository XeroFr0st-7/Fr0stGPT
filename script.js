/* ==========================================================
   Fr0st GPT — vanilla JS app logic (Google AI Studio Direct + Demo)
   ========================================================== */
(() => {
  'use strict';

  const API_BASE = location.port === '5500' ? 'http://localhost:3000' : '';
  const GEMINI_MODEL = 'gemini-3.8-flash';
  let live = false;
  const MAX_CHARS = 4000;

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { toast('Could not save — browser storage is full or blocked.'); } };
  const abortErr = () => new DOMException('Aborted', 'AbortError');
  const sleep = (ms, sig) => new Promise((res, rej) => {
    if (sig && sig.aborted) return rej(abortErr());
    const t = setTimeout(res, ms);
    if (sig) sig.addEventListener('abort', () => { clearTimeout(t); rej(abortErr()); }, { once: true });
  });

  /* ---------- State ---------- */
  const ACCENTS = { cyan: ['#22d3ee', '#8b5cf6'], blue: ['#3b82f6', '#06b6d4'], violet: ['#8b5cf6', '#ec4899'], mint: ['#34d399', '#22d3ee'] };
  let prefs = Object.assign({ theme: 'dark', accent: 'cyan', anim: true, sound: true, apiKey: '' }, load('frost.prefs', {}));
  let chats = load('frost.chats', []);
  let activeId = null; // Always start with a fresh welcome screen
  let generating = false, ctrl = null, attachments = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const animOn = () => prefs.anim && !reduce.matches;
  const isMobile = () => matchMedia('(max-width: 820px)').matches;

  /* ---------- Elements ---------- */
  const thread = $('#thread'), scrollEl = $('#scroll'), welcome = $('#welcome'), input = $('#input');
  const sendBtn = $('#sendBtn'), stopBtn = $('#stopBtn'), micBtn = $('#micBtn'), counter = $('#counter');
  const list = $('#convList'), search = $('#search'), titleEl = $('#title'), dlg = $('#settings');

  const current = () => chats.find(c => c.id === activeId) || null;
  const persist = () => { save('frost.chats', chats); save('frost.active', activeId); };

  /* ---------- Toast & sound ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  let audio;
  function beep(freq = 660, dur = 0.09) {
    if (!prefs.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq; g.gain.value = 0.04;
      o.connect(g); g.connect(audio.destination); o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur); o.stop(audio.currentTime + dur);
    } catch { /* audio unavailable */ }
  }

  /* ---------- Preferences ---------- */
  function applyPrefs() {
    const root = document.documentElement, [a1, a2] = ACCENTS[prefs.accent] || ACCENTS.cyan;
    root.dataset.theme = prefs.theme;
    root.style.setProperty('--a1', a1); root.style.setProperty('--a2', a2);
    document.body.classList.toggle('no-anim', !animOn());
    $('#animToggle').checked = prefs.anim; $('#soundToggle').checked = prefs.sound;
    document.querySelectorAll('#themeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme)));
    document.querySelectorAll('#accents button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.accent === prefs.accent)));
    save('frost.prefs', prefs); startSnow();
  }
  Object.entries(ACCENTS).forEach(([name, [a, b]]) => {
    const btn = el('button'); btn.type = 'button'; btn.dataset.accent = name; btn.setAttribute('aria-label', name + ' accent');
    btn.style.background = `linear-gradient(135deg, ${a}, ${b})`; $('#accents').append(btn);
  });
  $('#accents').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { prefs.accent = b.dataset.accent; applyPrefs(); } });
  $('#themeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { prefs.theme = b.dataset.theme; applyPrefs(); } });
  $('#themeBtn').onclick = () => { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; applyPrefs(); };
  $('#animToggle').onchange = e => { prefs.anim = e.target.checked; applyPrefs(); };
  $('#soundToggle').onchange = e => { prefs.sound = e.target.checked; applyPrefs(); beep(); };

  const keyIn = $('#apiKeyInput');
  const saveKey = () => {
    const v = keyIn.value.trim();
    if (v && v.length < 15) {
      return toast('That key looks too short. Paste the full key from Google AI Studio.');
    }
    prefs.apiKey = v; save('frost.prefs', prefs); updateMode(); toast(v ? 'Google AI Studio key saved.' : 'API key removed.');
  };
  $('#saveKey').onclick = saveKey;
  keyIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } });

  function updateMode() {
    const mode = live ? 'Live (server)' : prefs.apiKey ? 'Gemini Live' : 'Demo mode';
    $('#modeSmall').textContent = mode;
    $('#modeNote').textContent = mode === 'Demo mode'
      ? 'Demo mode: add your Google AI Studio API key in Settings for real AI.'
      : `Connected to ${GEMINI_MODEL} via Google AI Studio.`;
  }
  $('#settingsBtn').onclick = () => { keyIn.value = prefs.apiKey || ''; dlg.showModal(); };
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  $('#clearAll').onclick = () => {
    if (!chats.length) return toast('There are no chats to clear.');
    if (!confirm('Delete all conversations? This cannot be undone.')) return;
    stop(); chats = []; activeId = null; persist(); renderAll(); toast('Chat history cleared.');
  };
  reduce.addEventListener('change', applyPrefs);

  /* ---------- Snow particles (canvas, lightweight) ---------- */
  const cv = $('#snow'), cx = cv.getContext('2d');
  let flakes = [], raf = 0;
  function startSnow() {
    cancelAnimationFrame(raf);
    cv.width = innerWidth; cv.height = innerHeight; cx.clearRect(0, 0, cv.width, cv.height);
    if (!animOn()) return;
    const n = Math.min(70, Math.floor(innerWidth / 18));
    flakes = Array.from({ length: n }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.8 + .5, v: Math.random() * .5 + .2, d: Math.random() * 6.28 }));
    const tick = () => {
      cx.clearRect(0, 0, cv.width, cv.height);
      cx.fillStyle = prefs.theme === 'light' ? 'rgba(70,120,220,.45)' : 'rgba(220,240,255,.7)';
      for (const f of flakes) {
        f.y += f.v; f.d += .01; f.x += Math.sin(f.d) * .3;
        if (f.y > cv.height + 4) { f.y = -4; f.x = Math.random() * cv.width; }
        cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, 6.28); cx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
  }
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(startSnow, 250); });

  /* ---------- Sidebar ---------- */
  function toggleSidebar(force) {
    if (isMobile()) document.body.classList.toggle('drawer', force);
    else document.body.classList.toggle('collapsed', force);
  }
  $('#menuBtn').onclick = () => toggleSidebar();
  $('#overlay').onclick = () => toggleSidebar(false);

  const fmtTime = ts => {
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  function groupOf(ts) {
    const day = 864e5, today = new Date().setHours(0, 0, 0, 0), then = new Date(ts).setHours(0, 0, 0, 0), diff = today - then;
    return diff <= 0 ? 'Today' : diff <= day ? 'Yesterday' : diff <= 7 * day ? 'Previous 7 days' : 'Older';
  }
  function renderList() {
    const q = search.value.trim().toLowerCase();
    const shown = chats.filter(c => !q || c.title.toLowerCase().includes(q) || c.messages.some(m => m.content.toLowerCase().includes(q)))
      .sort((a, b) => b.updated - a.updated);
    list.replaceChildren();
    if (!shown.length) { list.append(el('p', 'empty', q ? 'No chats match your search.' : 'No conversations yet. Start one below.')); return; }
    let lastGroup = '';
    for (const c of shown) {
      const g = groupOf(c.updated);
      if (g !== lastGroup) { list.append(el('div', 'group', g)); lastGroup = g; }
      const wrap = el('div', 'item-wrap'), item = el('button', 'item' + (c.id === activeId ? ' active' : ''));
      item.type = 'button'; item.append(el('span', 't', c.title), el('small', '', fmtTime(c.updated)));
      item.onclick = () => switchChat(c.id);
      const acts = el('div', 'item-actions');
      const ren = el('button', '', '✎'), del = el('button', '', '🗑');
      ren.type = del.type = 'button'; ren.setAttribute('aria-label', 'Rename ' + c.title); del.setAttribute('aria-label', 'Delete ' + c.title);
      ren.onclick = () => startRename(c, wrap, item, acts); del.onclick = () => deleteChat(c.id);
      acts.append(ren, del); wrap.append(item, acts); list.append(wrap);
    }
  }
  function startRename(c, wrap, item, acts) {
    const inp = el('input', 'rename'); inp.value = c.title; inp.maxLength = 60; inp.setAttribute('aria-label', 'Conversation name');
    item.hidden = acts.hidden = true; wrap.append(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      const v = inp.value.trim(); if (ok && v) { c.title = v; persist(); }
      renderList(); updateTitle();
    };
    inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  }
  function switchChat(id) {
    stop(); activeId = id; persist(); renderAll(); if (isMobile()) toggleSidebar(false);
  }
  function newChat() {
    stop(); activeId = null; persist(); renderAll(); beep(740); input.focus(); if (isMobile()) toggleSidebar(false);
  }
  function deleteChat(id) {
    const c = chats.find(x => x.id === id);
    if (!c || !confirm(`Delete "${c.title}"?`)) return;
    if (id === activeId) { stop(); activeId = null; }
    chats = chats.filter(x => x.id !== id); persist(); renderAll(); toast('Conversation deleted.');
  }
  $('#newChat').onclick = newChat;
  search.oninput = renderList;
  const updateTitle = () => { const c = current(); titleEl.textContent = c ? c.title : 'Fr0st GPT'; document.title = c ? c.title + ' · Fr0st GPT' : 'Fr0st GPT'; };

  /* ---------- Message rendering ---------- */
  function svgLogo() {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), u = document.createElementNS(ns, 'use');
    s.setAttribute('viewBox', '0 0 48 48'); u.setAttribute('href', '#logo'); s.append(u); return s;
  }
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = el('textarea'); t.value = text; document.body.append(t); t.select();
      try { document.execCommand('copy'); } catch { toast('Copy failed — select the text manually.'); } t.remove();
    }
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => (btn.textContent = old), 1400); }
  }
  function codeBlock(lang, code) {
    const box = el('div', 'code'), head = el('div', 'code-head'), btn = el('button', '', 'Copy');
    const body = code.replace(/\n$/, ''); btn.type = 'button'; btn.onclick = () => copyText(body, btn);
    head.append(el('span', '', lang || 'code'), btn);
    const pre = el('pre'), c = el('code', '', body); pre.append(c); box.append(head, pre); return box;
  }
  function inline(node, text) {
    text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).forEach(part => {
      if (!part) return;
      if (part.startsWith('**')) node.append(el('strong', '', part.slice(2, -2)));
      else if (part.startsWith('`')) node.append(el('code', 'ic', part.slice(1, -1)));
      else if (part.startsWith('*') && part.length > 2) node.append(el('em', '', part.slice(1, -1)));
      else node.append(document.createTextNode(part));
    });
  }
  function block(p) {
    const lines = p.split('\n');
    if (/^#{1,3}\s/.test(p)) { const h = el('h4'); inline(h, p.replace(/^#{1,3}\s+/, '')); return h; }
    if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ol = /^\s*\d/.test(lines[0]), ul = el(ol ? 'ol' : 'ul');
      lines.forEach(l => { const li = el('li'); inline(li, l.replace(/^\s*([-*•]|\d+[.)])\s+/, '')); ul.append(li); });
      return ul;
    }
    const pe = el('p'); inline(pe, p); return pe;
  }
  function renderContent(node, text) {
    node.replaceChildren();
    const re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g; let last = 0, m;
    const addText = t => t.split(/\n{2,}/).filter(s => s.trim()).forEach(p => node.append(block(p.trim())));
    while ((m = re.exec(text))) {
      addText(text.slice(last, m.index)); node.append(codeBlock(m[1], m[2])); last = re.lastIndex;
    }
    addText(text.slice(last));
  }
  function actionBar(m) {
    const bar = el('div', 'actions');
    const mk = (label, txt, fn) => { const b = el('button', '', txt); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label; b.onclick = () => fn(b); bar.append(b); return b; };
    mk('Copy message', '📋 Copy', b => copyText(m.content, b));
    const up = mk('Good response', '👍', () => rate(m, 'up', up, down));
    const down = mk('Bad response', '👎', () => rate(m, 'down', up, down));
    up.setAttribute('aria-pressed', String(m.fb === 'up')); down.setAttribute('aria-pressed', String(m.fb === 'down'));
    mk('Regenerate response', '🔄 Regenerate', () => regenerate(m)).classList.add('regen');
    return bar;
  }
  function rate(m, val, up, down) {
    m.fb = m.fb === val ? null : val; persist();
    up.setAttribute('aria-pressed', String(m.fb === 'up')); down.setAttribute('aria-pressed', String(m.fb === 'down'));
    if (m.fb) toast('Thanks for the feedback!');
  }
  function msgEl(m, animate) {
    const row = el('article', `msg ${m.role}` + (animate ? ' enter' : '')), av = el('div', 'avatar'), body = el('div', 'body'), bub = el('div', 'bubble');
    row.dataset.id = m.id;
    if (m.role === 'assistant') av.append(svgLogo()); else av.textContent = 'You';
    renderContent(bub, m.content); body.append(bub);
    if (m.role === 'assistant') body.append(actionBar(m));
    row.append(av, body); return row;
  }
  const refreshRegen = () => { const all = thread.querySelectorAll('.regen'); all.forEach((b, i) => (b.hidden = i !== all.length - 1)); };
  const scrollDown = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };

  function renderAll() {
    renderList(); updateTitle();
    const c = current(); thread.replaceChildren();
    welcome.classList.remove('leaving');
    const empty = !c || !c.messages.length; welcome.hidden = !empty;
    if (!empty) { c.messages.forEach(m => thread.append(msgEl(m, false))); refreshRegen(); scrollDown(); }
    else scrollEl.scrollTop = 0;
  }

  /* ---------- Demo responses ---------- */
  const DEMOS = [
    [/code|function|script|javascript|python|debounce/i, () =>
      "Here's a clean debounce helper you can drop into any project:\n\n```javascript\n// Delays calling fn until `wait` ms have passed since the last call\nfunction debounce(fn, wait = 300) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), wait);\n  };\n}\n\n// Usage: only runs after the user stops typing\nconst onType = debounce(e => console.log(e.target.value), 400);\ninput.addEventListener('input', onType);\n```\n\nEach call resets the timer, so the function only fires once things go quiet."],
    [/story|poem|creative|lighthouse|write/i, () =>
      "The lighthouse at Skarn Point had not seen a ship in eleven winters, yet Ilse climbed its spiral stairs every dusk.\n\nThe sea beyond had frozen into a pale, silent plain. Tonight, far out on the ice, a single lantern flickered back at her, answering the beam in slow, deliberate pulses.\n\nShe set down her tea, lifted the shutter, and flashed three times. Somewhere out there, someone had just found their way home."],
    [/explain|concept|quantum|how does|what is/i, () =>
      "Think of two coins that were minted as a perfectly matched pair. In quantum entanglement, the pair is linked so that measuring one instantly tells you something about the other, however far apart they are.\n\nThe twist: before you measure, neither coin has a definite face. The outcome is only settled at measurement, yet the two results always agree in a precise way.\n\nNothing travels between them, so it can't be used to send messages faster than light. It's a shared correlation, not a signal."],
    [/idea|brainstorm|startup|project/i, () =>
      "Here are five directions worth exploring:\n\n1. Grid Whisperer: AI that schedules home appliances around cheap, clean electricity.\n\n2. ReLoop: image recognition that tells you exactly how to recycle any item.\n\n3. SoilSense: low-cost sensors plus a model that cuts farm water use.\n\n4. Carbon Ledger: automatic footprint tracking for small businesses.\n\n5. WasteMap: predicts food surplus so restaurants can donate before it spoils.\n\nWant me to dig into one of these?"],
    [/^(hi|hello|hey)\b/i, () => "Hello! I'm Fr0st GPT. What would you like to work on today?"],
  ];
  function demoReply(messages) {
    const last = messages[messages.length - 1].content, prev = messages.filter(m => m.role === 'user').slice(-2, -1)[0];
    const hit = DEMOS.find(([re]) => re.test(last)), body = hit ? hit[1]() : `You said: "${last.slice(0, 120)}${last.length > 120 ? '…' : ''}"\n\nI'm running in demo mode with canned replies, but I keep the whole conversation in context.` + (prev ? ` Earlier you mentioned "${prev.content.slice(0, 60)}".` : '');
    return body + (hit ? '' : '\n\nAdd your Google AI Studio API key in Settings (⚙) for real AI answers.');
  }
  async function* typeOut(text, sig) {
    const parts = text.match(/\S+\s*|\s+/g) || [];
    for (let i = 0; i < parts.length; i += 2) { if (sig.aborted) throw abortErr(); yield parts.slice(i, i + 2).join(''); await sleep(30, sig); }
  }

  /* ---------- Google AI Studio Direct Streaming ---------- */
  async function* directReply(history, sig) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(prefs.apiKey)}`;

    const contents = history.slice(-40).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    let r;
    try {
      r = await fetch(endpoint, {
        method: 'POST',
        signal: sig,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'You are Fr0st GPT, a helpful, concise, friendly AI assistant. Use markdown for lists and code blocks.' }]
          },
          contents
        })
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Could not reach Google AI Studio. Check your internet connection.');
    }

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const apiMsg = j.error && j.error.message ? j.error.message : `Google AI Studio returned error ${r.status}.`;
      throw new Error(r.status === 400 || r.status === 403 ? `API Key Error: ${apiMsg}` : apiMsg);
    }

    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('data:')) continue;
        const rawJson = l.slice(5).trim();
        if (!rawJson || rawJson === '[DONE]') continue;
        try {
          const ev = JSON.parse(rawJson);
          const parts = ev?.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts)) {
            for (const p of parts) {
              if (p.text) yield p.text;
            }
          }
        } catch { /* ignore partial/keep-alive frames */ }
      }
    }
  }

  async function* reply(messages, sig) {
    const history = messages.map(({ role, content }) => ({ role, content }));
    if (!live && prefs.apiKey) { yield* directReply(history, sig); return; }
    if (live) {
      let r;
      try { r = await fetch(API_BASE + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history }), signal: sig }); }
      catch (e) { if (e.name === 'AbortError') throw e; throw new Error('Could not reach the Fr0st GPT server.'); }
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `The server responded with an error (${r.status}).`); }
      const reader = r.body.getReader(), dec = new TextDecoder();
      while (true) { const { done, value } = await reader.read(); if (done) break; yield dec.decode(value, { stream: true }); }
      return;
    }
    await sleep(700 + Math.random() * 600, sig);
    yield* typeOut(demoReply(history), sig);
  }

  /* ---------- Sending & generating ---------- */
  function setBusy(b) {
    generating = b; stopBtn.hidden = !b; sendBtn.hidden = b; input.setAttribute('aria-busy', String(b));
  }
  function stop() { if (ctrl) ctrl.abort(); }

  async function generate() {
    const c = current(); if (!c) return;
    ctrl = new AbortController(); setBusy(true);
    const row = el('article', 'msg assistant enter'), av = el('div', 'avatar'), body = el('div', 'body'), bub = el('div', 'bubble');
    const dots = el('div', 'dots'); dots.setAttribute('aria-label', 'Fr0st is thinking');
    dots.append(el('span'), el('span'), el('span')); bub.append(dots);
    av.append(svgLogo()); body.append(bub); row.append(av, body); thread.append(row); scrollDown();
    let text = '';
    try {
      for await (const chunk of reply(c.messages, ctrl.signal)) { text += chunk; renderContent(bub, text); scrollDown(); }
      const m = { id: uid(), role: 'assistant', content: text, fb: null };
      c.messages.push(m); c.updated = Date.now(); persist();
      if (row.isConnected) row.replaceWith(msgEl(m, false));
      refreshRegen(); renderList(); beep(520);
    } catch (err) {
      if (err.name === 'AbortError') {
        if (text.trim()) {
          const m = { id: uid(), role: 'assistant', content: text, fb: null };
          c.messages.push(m); c.updated = Date.now(); persist();
          if (row.isConnected) row.replaceWith(msgEl(m, false));
          refreshRegen();
        } else row.remove();
        toast('Generation stopped.');
      } else {
        bub.className = 'bubble error'; bub.replaceChildren(el('p', '', '⚠ ' + (err.message || 'Something went wrong.')));
        const retry = el('button', 'retry', 'Try again'); retry.type = 'button';
        retry.onclick = () => { row.remove(); generate(); }; bub.append(retry);
      }
    } finally { setBusy(false); ctrl = null; }
  }
  function regenerate(m) {
    const c = current(); if (!c || generating) return;
    const last = c.messages[c.messages.length - 1];
    if (!last || last.id !== m.id) return;
    c.messages.pop(); persist();
    const row = thread.querySelector(`[data-id="${m.id}"]`); if (row) row.remove();
    generate();
  }
  function send(raw) {
    if (generating) return;
    let text = raw.trim(); if (!text && !attachments.length) return;
    text += attachments.map(a => a.text ? `\n\n📎 ${a.name}\n\`\`\`\n${a.text.slice(0, 3000)}\n\`\`\`` : `\n\n📎 ${a.name}`).join('');
    attachments = []; renderChips();
    let c = current();
    if (!c) { c = { id: uid(), title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] }; chats.push(c); activeId = c.id; }
    if (!c.messages.length) c.title = text.replace(/\s+/g, ' ').slice(0, 40) || 'New chat';
    const m = { id: uid(), role: 'user', content: text }; c.messages.push(m); c.updated = Date.now(); persist();
    if (!welcome.hidden) { welcome.classList.add('leaving'); setTimeout(() => (welcome.hidden = true), animOn() ? 300 : 0); }
    thread.append(msgEl(m, true)); refreshRegen(); renderList(); updateTitle(); scrollDown();
    input.value = ''; autosize(); beep(880); generate();
  }

  /* ---------- Composer ---------- */
  function autosize() {
    input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    const n = input.value.length; counter.hidden = n < MAX_CHARS * 0.7; counter.textContent = `${n} / ${MAX_CHARS}`;
    sendBtn.disabled = !input.value.trim() && !attachments.length;
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  $('#composer').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
  stopBtn.onclick = stop;
  document.querySelectorAll('.card').forEach(b => b.addEventListener('click', () => send(b.dataset.prompt)));

  // Attachments
  const fileIn = $('#file');
  $('#attachBtn').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    for (const f of fileIn.files) {
      if (f.size > 200 * 1024) { toast(`${f.name} is over 200 KB and was skipped.`); continue; }
      const isText = f.type.startsWith('text/') || /\.(md|json|js|css|html|py|csv|txt)$/i.test(f.name);
      attachments.push({ name: f.name, text: isText ? await f.text() : null });
    }
    fileIn.value = ''; renderChips(); autosize();
  };
  function renderChips() {
    const box = $('#chips'); box.replaceChildren();
    attachments.forEach((a, i) => {
      const chip = el('span', 'chip', '📎 ' + a.name), x = el('button', '', '✕');
      x.type = 'button'; x.setAttribute('aria-label', 'Remove ' + a.name); x.onclick = () => { attachments.splice(i, 1); renderChips(); autosize(); };
      chip.append(x); box.append(chip);
    });
  }

  // Voice input
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) micBtn.hidden = true;
  else {
    const rec = new SR(); let base = '', on = false;
    rec.interimResults = true; rec.lang = navigator.language || 'en-US';
    rec.onresult = e => { let t = ''; for (const r of e.results) t += r[0].transcript; input.value = (base + ' ' + t).trim(); autosize(); };
    rec.onend = () => { on = false; micBtn.classList.remove('on'); micBtn.setAttribute('aria-pressed', 'false'); };
    rec.onerror = e => toast(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Voice input error: ' + e.error);
    micBtn.onclick = () => {
      if (on) return rec.stop();
      try { base = input.value; rec.start(); on = true; micBtn.classList.add('on'); micBtn.setAttribute('aria-pressed', 'true'); }
      catch { toast('Voice input could not start.'); }
    };
  }

  /* ---------- Init ---------- */
  save('frost.active', null);
  if (isMobile()) document.body.classList.remove('collapsed');
  applyPrefs(); renderAll(); autosize();

  updateMode();
  fetch(API_BASE + '/api/health').then(r => r.json()).then(j => { live = !!j.ok; updateMode(); }).catch(() => {});
})();