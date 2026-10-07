/* ============================================================
   Agent Computer Use Atlas · app.js
   12 个 Agent 光标的时间轴引擎 + 打字/点击/拖拽反应
   + 窗口聚焦管理 + Dock + 档案检查器窗口
   零依赖 · vanilla JS
   ============================================================ */
'use strict';
(() => {
  /* JS 可用标记：隐藏静态可索引内容层（SEO/GEO progressive enhancement，数据失败时回退显示） */
  document.documentElement.classList.add('js-on');
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const rand = (a, b) => a + Math.random() * (b - a);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const stage = $('#stage');
  const body = document.body;
  const CLICK_MS = 620;

  let AGENTS = [];
  let paused = false;
  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const posterMq = matchMedia('(max-width: 1023px)');

  /* ---------- 尊重暂停的 rAF sleep ---------- */
  const sleepers = new Set();
  function rafSleep(ms) {
    return new Promise(res => {
      const s = { t0: performance.now(), res };
      sleepers.add(s);
      const step = t => {
        if (!sleepers.has(s)) return;              // 已被 flush 或替换
        if (!paused && t - s.t0 >= ms) { sleepers.delete(s); res(); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function flushSleep() {
    for (const s of Array.from(sleepers)) { sleepers.delete(s); s.res(); }
  }

  /* ---------- 数据加载：HTTP 优先读 agents.json，file:// 回退内联副本 ---------- */
  async function loadData() {
    try {
      const r = await fetch('data/agents.json');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      try {
        return JSON.parse($('#agents-data').textContent);
      } catch (e2) {
        console.error('[atlas] agents 数据解析失败', e2);
        return [];
      }
    }
  }

  /* 品牌色降饱和：向中性灰混合，仅用于光标徽章 / Dock 图标 / 窄屏卡片 */
  function desat(hex) {
    const n = parseInt(hex.slice(1), 16);
    const mix = c => Math.round(c * .5 + 138 * .5);
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function textOn(hex) {
    const n = parseInt(hex.slice(1), 16);
    const L = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return L > 0.62 ? '#171b2c' : '#ffffff';
  }

  /* ---------- 真实 logo：插入 img，加载失败回退 monogram ---------- */
  function logoImg(ag, cls) {
    if (!ag.logo) return '';
    return '<img class="' + cls + '" src="' + esc(ag.logo) + '" alt="' + esc(ag.name) + ' logo" loading="lazy">';
  }
  function bindLogoFallback(root, onFail) {
    $$('img[data-fb]', root).forEach(img => {
      img.addEventListener('error', () => {
        const holder = img.parentElement;
        if (holder) holder.classList.remove('has-logo', 'dk-logo');
        if (onFail) onFail(holder, img);
        img.remove();
      }, { once: true });
    });
  }

  /* 把目标点（窗口内归一化坐标 或 舞台百分比）解析为舞台像素坐标 */
  function stagePt(p) {
    const sr = stage.getBoundingClientRect();
    if (p.pct) return { x: sr.width * p.pct[0] / 100, y: sr.height * p.pct[1] / 100 };
    const wr = $(p.win).getBoundingClientRect();
    return { x: wr.left - sr.left + wr.width * p.ax, y: wr.top - sr.top + wr.height * p.ay };
  }

  /* ---------- 光标路线 ---------- */
  const W = (win, ax, ay) => ({ win, ax, ay });
  const A = (x, y) => ({ pct: [x, y] });
  const T = '#win-term', B = '#win-browser', N = '#win-notes', M = '#win-music';

  const ROUTES = {
    zcode: [
      { t: 'move', p: W(T, .34, .52), d: 900 },
      { t: 'hover', d: 620 },
      { t: 'click', p: W(T, .34, .52), hit: '#term-body' },
      { t: 'move', p: W(T, .62, .26), d: 700 },
      { t: 'click', p: W(T, .62, .26), hit: '#term-body' },
      { t: 'move', p: A(27, 66), d: 1000 },
      { t: 'hover', d: 500 }
    ],
    codex: [
      { t: 'move', p: W(B, .30, .25), d: 950 },
      { t: 'click', p: W(B, .30, .25), hit: '#br-url' },
      { t: 'move', p: W('#br-btn-run', .5, .5), d: 600 },
      { t: 'click', p: W('#br-btn-run', .5, .5), hit: '#br-btn-run' },
      { t: 'hover', d: 850 },
      { t: 'move', p: W('#br-results', .5, .55), d: 650 },
      { t: 'click', p: W('#br-results', .5, .55), hit: '#br-results' },
      { t: 'move', p: A(72, 72), d: 1050 }
    ],
    'claude-code': [
      { t: 'move', p: W(N, .30, .34), d: 1000 },
      { t: 'click', p: W(N, .30, .34), hit: '#note-input' },
      { t: 'type', p: W(N, .48, .75), d: 1700 },
      { t: 'hover', d: 550 },
      { t: 'move', p: W(T, .66, .62), d: 1100 },
      { t: 'click', p: W(T, .66, .62), hit: '#term-body' },
      { t: 'move', p: A(55, 22), d: 950 }
    ],
    cursor: [
      { t: 'move', p: W('#br-btn-more', .5, .5), d: 850 },
      { t: 'click', p: W('#br-btn-more', .5, .5), hit: '#br-btn-more' },
      { t: 'move', p: W(B, .32, .055), d: 700 },
      { t: 'drag', p0: W(B, .32, .055), p1: A(57, 10), follow: 'win:#win-browser', d: 2100 },
      { t: 'hover', d: 500 },
      { t: 'move', p: W('#br-btn-run', .5, .5), d: 800 },
      { t: 'click', p: W('#br-btn-run', .5, .5), hit: '#br-btn-run' },
      { t: 'move', p: A(44, 76), d: 1000 }
    ],
    'minimax-code': [
      { t: 'move', p: W(M, .14, .74), d: 900 },
      { t: 'drag', p0: W(M, .14, .74), p1: W(M, .86, .74), follow: 'slider', d: 2200 },
      { t: 'hover', d: 400 },
      { t: 'move', p: W('#mu-play', .5, .5), d: 600 },
      { t: 'click', p: W('#mu-play', .5, .5), hit: '#mu-play' },
      { t: 'move', p: W(M, .55, .50), d: 650 },
      { t: 'hover', d: 800 },
      { t: 'move', p: A(20, 74), d: 1100 }
    ],
    synara: [
      { t: 'move', p: W(N, .48, .75), d: 900 },
      { t: 'type', p: W(N, .48, .75), d: 1650 },
      { t: 'move', p: W(N, .60, .34), d: 600 },
      { t: 'click', p: W(N, .60, .34), hit: '#note-input' },
      { t: 'hover', d: 500 },
      { t: 'move', p: A(80, 62), d: 1150 },
      { t: 'click', p: A(80, 62) },
      { t: 'hover', d: 400 }
    ],
    'kimi-code': [
      { t: 'move', p: A(4, 14), d: 900 },
      { t: 'hover', d: 650 },
      { t: 'move', p: W(T, .50, .88), d: 850 },
      { t: 'click', p: W(T, .50, .88), hit: '#term-body' },
      { t: 'move', p: W(T, .22, .30), d: 700 },
      { t: 'hover', d: 600 },
      { t: 'move', p: A(50, 46), d: 1200 }
    ],
    qoder: [
      { t: 'move', p: W(B, .68, .60), d: 950 },
      { t: 'click', p: W(B, .68, .60), hit: '#br-results' },
      { t: 'move', p: W(M, .50, .74), d: 1050 },
      { t: 'click', p: W(M, .50, .74), hit: '#mu-slider' },
      { t: 'move', p: W('#mu-play', .5, .5), d: 500 },
      { t: 'click', p: W('#mu-play', .5, .5), hit: '#mu-play' },
      { t: 'move', p: A(60, 18), d: 1000 },
      { t: 'hover', d: 400 }
    ],
    grok: [
      { t: 'move', p: A(88, 12), d: 1000 },
      { t: 'hover', d: 500 },
      { t: 'move', p: A(84, 44), d: 900 },
      { t: 'click', p: A(84, 44) },
      { t: 'move', p: A(14, 78), d: 1200 },
      { t: 'hover', d: 550 },
      { t: 'move', p: W(B, .82, .55), d: 900 },
      { t: 'click', p: W(B, .82, .55), hit: '#br-results' }
    ],
    devin: [
      { t: 'move', p: A(50, 88), d: 1100 },
      { t: 'move', p: A(18, 52), d: 1100 },
      { t: 'move', p: A(46, 13), d: 1050 },
      { t: 'hover', d: 450 },
      { t: 'move', p: W(T, .80, .70), d: 900 },
      { t: 'click', p: W(T, .80, .70), hit: '#term-body' },
      { t: 'move', p: A(34, 64), d: 1000 }
    ],
    goose: [
      { t: 'move', p: W(M, .30, .74), d: 900 },
      { t: 'drag', p0: W(M, .30, .74), p1: W(M, .62, .74), follow: 'slider', d: 1600 },
      { t: 'move', p: W(N, .48, .75), d: 850 },
      { t: 'type', p: W(N, .48, .75), d: 1600 },
      { t: 'move', p: A(70, 76), d: 1000 },
      { t: 'hover', d: 500 }
    ],
    mimo: [
      { t: 'move', p: W(T, .42, .58), d: 850 },
      { t: 'click', p: W(T, .42, .58), hit: '#term-body' },
      { t: 'move', p: W(B, .62, .25), d: 800 },
      { t: 'click', p: W(B, .62, .25), hit: '#br-url' },
      { t: 'move', p: W('#br-btn-run', .5, .5), d: 600 },
      { t: 'click', p: W('#br-btn-run', .5, .5), hit: '#br-btn-run' },
      { t: 'move', p: A(40, 30), d: 950 }
    ],
    _default: [
      { t: 'move', p: A(50, 50), d: 900 },
      { t: 'hover', d: 600 },
      { t: 'move', p: A(30, 40), d: 900 },
      { t: 'hover', d: 500 }
    ]
  };

  const SPAWNS = [
    [8, 14], [16, 86], [32, 10], [46, 88], [60, 10], [74, 86],
    [90, 14], [93, 42], [52, 50], [24, 58], [86, 62], [10, 36]
  ];

  /* ---------- 窗口聚焦管理（z 序 + 标题栏 active + 菜单栏应用名） ---------- */
  let zTop = 5;
  const mbAppName = $('#mbAppName');
  function setAppName(t) { mbAppName.textContent = t; }
  function focusWindow(el, name) {
    $$('.window').forEach(w => w.classList.toggle('active', w === el));
    zTop = Math.min(zTop + 1, 700);
    el.style.zIndex = zTop;
    if (name) setAppName(name);
  }
  function blurWindows() {
    $$('.window').forEach(w => w.classList.remove('active'));
    setAppName('访达');
  }
  function registerWindows() {
    $$('.window').forEach(w => {
      w.addEventListener('pointerdown', () => {
        clearIconSel();
        focusWindow(w, w.dataset.app || null);
      });
    });
    /* 点击桌面空白处 = 访达 */
    stage.addEventListener('pointerdown', e => {
      if (e.target.closest('.window') || e.target.closest('.dock') ||
          e.target.closest('.cursor') || e.target.closest('.desk-icons')) return;
      clearIconSel();
      blurWindows();
    });
  }

  /* ---------- 桌面图标：单击选中 · 双击打开 ---------- */
  function clearIconSel() { $$('.d-icon.selected').forEach(x => x.classList.remove('selected')); }
  function registerDeskIcons() {
    $$('.d-icon').forEach(a => {
      a.addEventListener('click', e => {
        if (a.classList.contains('selected')) return;   // 已选中 → 放行默认跳转
        e.preventDefault();
        clearIconSel();
        a.classList.add('selected');
      });
      a.addEventListener('dblclick', () => { window.open(a.href, '_blank', 'noopener'); });
    });
  }

  /* ---------- 构建光标 DOM ---------- */
  const cursors = [];
  function buildCursors() {
    const layer = $('#cursors');
    AGENTS.forEach((ag, i) => {
      const el = document.createElement('div');
      const c = desat(ag.color);
      el.className = 'cursor';
      el.dataset.slug = ag.slug;
      el.style.setProperty('--c', c);
      el.style.setProperty('--ct', textOn(c));
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', '查看 ' + ag.name + '（' + ag.vendor + '）的逆向档案');
      el.innerHTML =
        '<svg class="arrow" viewBox="0 0 20 22" aria-hidden="true"><path d="M3 1.6 L3 17.4 L7.3 13.7 L10 20.1 L12.8 18.9 L10.1 12.8 L15.6 12.5 Z"/></svg>' +
        '<span class="badge' + (ag.logo ? ' has-logo' : '') + '" aria-hidden="true">' +
          (ag.logo ? '<img class="b-img" src="' + esc(ag.logo) + '" alt="" data-fb loading="lazy">' : '') +
          '<span class="b-mono">' + esc(ag.monogram) + '</span></span>' +
        '<span class="tag" aria-hidden="true">' + esc(ag.name) + '</span>' +
        '<span class="chip mono" aria-hidden="true">' + esc(ag.toolcall) + '</span>';
      layer.appendChild(el);

      const spawn = SPAWNS[i % SPAWNS.length];
      const sr = stage.getBoundingClientRect();
      const cur = {
        ag, el,
        steps: ROUTES[ag.slug] || ROUTES._default,
        idx: 0, phase: 'pre', delay: 300 + i * 420,
        t: 0, dur: 1, act: false,
        pos: { x: sr.width * spawn[0] / 100, y: sr.height * spawn[1] / 100 },
        from: null, to: null, ctrl: null, base: null,
        speed: rand(.92, 1.12),
        seed: rand(0, 6.28),
        hovered: false, dragCtx: null
      };
      cursors.push(cur);

      el.addEventListener('click', e => { e.stopPropagation(); openPanel(ag, el); });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(ag, el); }
      });
      el.addEventListener('pointerenter', () => { cur.hovered = true; });
      el.addEventListener('pointerleave', () => { cur.hovered = false; });
    });
    bindLogoFallback(layer);
  }

  /* ---------- 反应：目标窗口真实反馈 ---------- */
  function pressEl(el) {
    if (!el) return;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 210);
  }
  function react(hit) {
    if (!hit) return;
    pressEl($(hit));
    switch (hit) {
      case '#term-body': flushSleep(); break;          // 打断终端待机 → 立刻继续打字
      case '#br-btn-run': Browser.run(); break;
      case '#br-btn-more': Browser.more(); break;
      case '#br-results': Browser.rowNext(); break;
      case '#mu-play': Music.toggle(); break;
    }
  }

  /* ---------- 拖拽 ---------- */
  function makeDrag(follow, from) {
    if (follow === 'slider') {
      return {
        kind: 'slider',
        trackRect: $('#mu-slider').getBoundingClientRect(),
        stageRect: stage.getBoundingClientRect(),
        sx: from.x, sy: from.y
      };
    }
    const el = $(follow.slice(4));
    el.classList.add('dragging');
    return { kind: 'win', el, sx: from.x, sy: from.y };
  }
  function moveDrag(ctx, pos) {
    if (!ctx) return;
    if (ctx.kind === 'slider') {
      const r = ctx.trackRect, sr = ctx.stageRect;
      setSlider(clamp((sr.left + pos.x - r.left) / r.width, 0, 1));
    } else {
      const dx = clamp((pos.x - ctx.sx) * .38, -16, 16);
      const dy = clamp((pos.y - ctx.sy) * .30, -10, 12);
      ctx.el.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }
  }
  function releaseDrag(ctx) {
    if (!ctx) return;
    if (ctx.kind === 'win') {
      const el = ctx.el;
      el.classList.remove('dragging');
      el.classList.add('settle');
      el.style.transform = '';
      setTimeout(() => el.classList.remove('settle'), 600);
    }
  }

  /* ---------- 时间轴引擎 ---------- */
  function bezier(a, c, b, t) {
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * c.y + t * t * b.y
    };
  }
  function enter(c) {
    const s = c.steps[c.idx];
    c.t = 0;
    c.el.classList.remove('pressing');
    switch (s.t) {
      case 'move': {
        c.from = { x: c.pos.x, y: c.pos.y };
        c.to = stagePt(s.p);
        const dx = c.to.x - c.from.x, dy = c.to.y - c.from.y;
        const dist = Math.hypot(dx, dy) || 1;
        const off = rand(-.16, .16) * dist;
        c.ctrl = {
          x: (c.from.x + c.to.x) / 2 - dy / dist * off,
          y: (c.from.y + c.to.y) / 2 + dx / dist * off - dist * .06
        };
        c.dur = Math.max(340, s.d * c.speed);
        c.act = false;
        break;
      }
      case 'hover':
        c.base = { x: c.pos.x, y: c.pos.y };
        c.dur = s.d * c.speed;
        c.act = true;
        break;
      case 'click': {
        c.pos = stagePt(s.p);
        c.base = { x: c.pos.x, y: c.pos.y };
        c.dur = CLICK_MS;
        c.act = true;
        c.el.classList.add('pressing');
        const hit = s.hit;
        setTimeout(() => react(hit), 110);
        break;
      }
      case 'drag': {
        c.from = stagePt(s.p0);
        c.to = stagePt(s.p1);
        c.dur = s.d * c.speed;
        c.act = true;
        c.el.classList.add('pressing');
        c.dragCtx = makeDrag(s.follow, c.from);
        break;
      }
      case 'type': {
        c.pos = stagePt(s.p);
        c.base = { x: c.pos.x, y: c.pos.y };
        c.dur = s.d * c.speed;
        c.act = true;
        Notes.advance(s.d);
        break;
      }
    }
    c.el.classList.toggle('acting', !!c.act);
  }
  function finish(c) {
    const s = c.steps[c.idx];
    if (s.t === 'drag') { releaseDrag(c.dragCtx); c.dragCtx = null; }
    c.el.classList.remove('pressing');
    c.idx = (c.idx + 1) % c.steps.length;
    enter(c);
  }
  function updateCursor(c, dt, now) {
    if (c.phase === 'pre') {
      c.delay -= dt;
      if (c.delay <= 0) { c.phase = 'run'; enter(c); }
      return;
    }
    c.t += dt;
    const s = c.steps[c.idx];
    const k = clamp(c.t / c.dur, 0, 1);
    if (s.t === 'move') {
      c.pos = bezier(c.from, c.ctrl, c.to, easeIO(k));
    } else if (s.t === 'drag') {
      c.pos = { x: lerp(c.from.x, c.to.x, easeIO(k)), y: lerp(c.from.y, c.to.y, easeIO(k)) };
      moveDrag(c.dragCtx, c.pos);
    } else if (s.t === 'hover' || s.t === 'click' || s.t === 'type') {
      // 悬停微颤：光标有"活物感"
      c.pos = {
        x: c.base.x + Math.sin(now / 430 + c.seed) * 1.2,
        y: c.base.y + Math.cos(now / 510 + c.seed) * 1.0
      };
    }
    if (c.t >= c.dur) finish(c);
  }
  function render(c) {
    c.el.style.transform = 'translate3d(' + c.pos.x.toFixed(1) + 'px,' + c.pos.y.toFixed(1) + 'px,0)';
    c.el.classList.toggle('chip-on', !!c.act || c.hovered);
    c.el.classList.toggle('flip', c.pos.x > stage.clientWidth * .60);
  }

  let rafId = 0, lastT = 0;
  function frame(now) {
    if (posterMq.matches) { rafId = 0; return; }      // 窄屏：引擎停转
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(64, now - (lastT || now));
    lastT = now;
    if (!paused) for (const c of cursors) updateCursor(c, dt, now);
    for (const c of cursors) render(c);
  }
  function startEngine() {
    if (rafId || reduced || posterMq.matches || !cursors.length) return;
    lastT = 0;
    rafId = requestAnimationFrame(frame);
  }
  /* reduced-motion：光标静态就位 + 芯片可见 */
  function staticPlace() {
    cursors.forEach(c => {
      const firstMove = c.steps.find(x => x.p);
      c.pos = stagePt(firstMove.p);
      c.act = false;
      c.el.classList.add('chip-on');
      render(c);
    });
  }

  /* ---------- 终端打字机 ---------- */
  const Term = (() => {
    const box = $('#term-lines');
    const LINES = [
      ['cmd', '$ get_app_state({app_ref:{name:"Notes"}})'],
      ['dim', '  state_id: s_84 · 132 elements · focused'],
      ['cmd', '$ js("(el) => el.click()")'],
      ['ok', '  ✓ AXPress → Button「发送」 · 212ms'],
      ['cmd', '$ screenshot({reticle:false})'],
      ['dim', '  → png 1470×956 · 384 KB'],
      ['cmd', '$ drag(562,418 → 742,418) · 380ms'],
      ['ok', '  ✓ drag complete · token #a17']
    ];
    function addLine(cls) {
      const d = document.createElement('div');
      d.className = 'tl ' + cls;
      box.appendChild(d);
      return d;
    }
    async function loop() {
      for (;;) {
        box.innerHTML = '';
        for (const [k, tx] of LINES) {
          const el = addLine(k);
          for (let i = 0; i < tx.length; i++) {
            el.textContent = tx.slice(0, i + 1);
            await rafSleep(k === 'cmd' ? 17 : 9);
          }
          await rafSleep(240);
        }
        await rafSleep(2300);
      }
    }
    return {
      loop,
      renderStatic() { box.innerHTML = ''; LINES.forEach(([k, tx]) => addLine(k).textContent = tx); }
    };
  })();

  /* ---------- 备忘录逐字输入 + 虚拟键盘 ---------- */
  const Notes = (() => {
    const TXT = 'deploy site --agents 12';
    const textEl = $('#note-text');
    let quota = 0, idx = 0;
    function pressKey(ch) {
      const k = ch === ' ' ? 'space' : ch;
      const el = $('.key[data-k="' + k + '"]');
      if (!el) return;
      el.classList.add('pressed');
      setTimeout(() => el.classList.remove('pressed'), 170);
    }
    async function loop() {
      for (;;) {
        if (quota <= 0) { await rafSleep(140); continue; }
        if (idx >= TXT.length) {
          await rafSleep(1500);
          textEl.classList.add('fade');
          await rafSleep(320);
          textEl.textContent = '';
          idx = 0; quota = 0;
          textEl.classList.remove('fade');
          continue;
        }
        const ch = TXT[idx++];
        textEl.textContent += ch;
        pressKey(ch);
        quota--;
        await rafSleep(105);
      }
    }
    return {
      advance(ms) { quota += Math.max(3, Math.round(ms / 105)); },
      loop,
      renderStatic() { textEl.textContent = TXT; }
    };
  })();

  /* ---------- 键盘 / 频谱条构建 ---------- */
  function buildKeyboard() {
    const rows = [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['z', 'x', 'c', 'v', 'b', 'n', 'm', '⌫'],
      ['-', '1', '2', 'space', '⏎']
    ];
    $('#note-kb').innerHTML = rows.map(r =>
      '<span class="kb-row">' + r.map(k =>
        '<i class="key' + (k === 'space' ? ' space' : '') + '" data-k="' + k + '">' +
        (k === 'space' ? '' : k) + '</i>').join('') + '</span>').join('');
  }
  function buildBars() {
    let h = '';
    for (let i = 0; i < 22; i++) {
      h += '<i style="--d:' + (i * -0.12).toFixed(2) + 's;--h:' +
        (0.18 + Math.abs(Math.sin(i * 1.7)) * .55).toFixed(2) + '"></i>';
    }
    $('#mu-bars').innerHTML = h;
  }
  function setSlider(p) {
    $('#mu-slider').style.setProperty('--val', (p * 100).toFixed(1));
    $('#mu-val').textContent = String(Math.round(p * 12)).padStart(2, '0');
  }

  /* ---------- 浏览器 / 频谱反应 ---------- */
  const Browser = (() => {
    const res = $('#br-results');
    let row = -1;
    return {
      async run() {
        res.classList.remove('loaded', 'loading');
        void res.offsetWidth;                       // 重触发骨架闪烁
        res.classList.add('loading');
        await new Promise(r => setTimeout(r, 750));
        res.classList.remove('loading');
        res.classList.add('loaded');
      },
      more() {
        const rows = $('.rows', res);
        rows.classList.remove('pulse');
        void rows.offsetWidth;
        rows.classList.add('pulse');
      },
      rowNext() {
        const rows = $$('#br-results .rows li');
        if (!rows.length) return;
        row = (row + 1) % rows.length;
        rows.forEach((li, i) => li.classList.toggle('on', i === row));
      }
    };
  })();
  const Music = (() => {
    const win = $('#win-music');
    return { toggle() { win.classList.toggle('playing'); } };
  })();

  /* ---------- Dock：仓库 / 文档 · 12 Agent（真实 logo） · 访问 GitHub ---------- */
  function buildDock() {
    const box = $('#dockAgents');
    box.innerHTML = AGENTS.map(ag => {
      const c = desat(ag.color);
      return '<button class="dk-item" type="button" data-slug="' + ag.slug + '"' +
        ' data-tip="' + esc(ag.name) + '" aria-label="聚焦 ' + esc(ag.name) + ' 并打开档案">' +
        (ag.logo
          ? '<span class="dk-ic dk-logo">' +
            '<img src="' + esc(ag.logo) + '" alt="" data-fb data-bg="' + c + '" data-fg="' + textOn(c) + '" loading="lazy">' +
            '<span class="dk-mono">' + esc(ag.monogram) + '</span></span>'
          : '<span class="dk-ic" style="background:' + c + ';color:' + textOn(c) + '">' + esc(ag.monogram) + '</span>') +
        '</button>';
    }).join('');
    bindLogoFallback(box, (holder, img) => {
      if (!holder || !img) return;
      if (img.dataset.bg) { holder.style.background = img.dataset.bg; holder.style.color = img.dataset.fg; }
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('.dk-item');
      if (!b) return;
      const ag = AGENTS.find(a => a.slug === b.dataset.slug);
      if (!ag) return;
      const cur = cursors.find(x => x.ag === ag);
      openPanel(ag, cur ? cur.el : null);
    });
    setupDockMagnify();
  }

  /* ---------- Dock 鱼眼放大：高斯距离衰减 + 相互推挤 ---------- */
  function setupDockMagnify() {
    const dock = $('.dock');
    const items = $$('.dock .dock-agents .dk-item, .dock > .dk-item');
    if (!dock || items.length < 2) return;
    const SIZE = 40, MAG = .5, SIGMA2 = 2 * 60 * 60;
    let base = [];
    const measure = () => {
      items.forEach(it => { it.style.transform = ''; const ic = it.firstElementChild; if (ic) ic.style.transform = ''; });
      base = items.map(it => {
        const r = it.getBoundingClientRect();
        return r.left + r.width / 2;
      });
    };
    measure();
    addEventListener('resize', measure);
    dock.addEventListener('pointermove', e => {
      if (posterMq.matches) return;
      const px = e.clientX;
      const scales = base.map(cx => 1 + MAG * Math.exp(-((px - cx) * (px - cx)) / SIGMA2));
      items.forEach((it, i) => {
        let shift = 0;
        for (let j = 0; j < base.length; j++) {
          if (j === i) continue;
          shift += SIZE * (scales[j] - 1) / 2 * (base[i] > base[j] ? 1 : -1);
        }
        it.style.transform = 'translateX(' + shift.toFixed(1) + 'px)';
        const ic = it.firstElementChild;
        if (ic) ic.style.transform = 'scale(' + scales[i].toFixed(3) + ')';
      });
    });
    dock.addEventListener('pointerleave', () => {
      items.forEach(it => {
        it.style.transform = '';
        const ic = it.firstElementChild;
        if (ic) ic.style.transform = '';
      });
    });
  }

  /* ---------- Agent 档案窗口（单窗复用，内容刷新） ---------- */
  const panel = $('#panel');
  const pLogo = $('#pLogo');
  const pMono = $('#pMono');
  let activeEl = null;
  /* 档案 logo：加载失败回退 monogram（单例元素，每次绑定） */
  function onLogoErr() { pLogo.hidden = true; pMono.hidden = false; }
  function setPanelLogo(ag) {
    pLogo.removeEventListener('error', onLogoErr);
    pLogo.hidden = !ag.logo;
    pMono.hidden = true;
    pMono.textContent = ag.monogram;
    pMono.style.background = desat(ag.color);
    pMono.style.color = textOn(desat(ag.color));
    if (ag.logo) {
      pLogo.addEventListener('error', onLogoErr, { once: true });
      pLogo.src = ag.logo;
      pLogo.alt = ag.name + ' logo';
    }
  }
  function openPanel(ag, el) {
    panel.dataset.app = ag.name;
    setPanelLogo(ag);
    $('#pIdName').textContent = ag.name;
    $('#pIdVendor').textContent = ag.vendor;
    $('#pRows').innerHTML = [
      ['CU · 桌面控制', ag.cu],
      ['BU · 浏览器控制', ag.bu]
    ].map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('');
    $('#pTags').innerHTML = (ag.chips || []).map(x =>
      '<span class="p-tag">' + esc(x.label) + ' · ' + esc(x.value) + '</span>').join('');
    $('#pTool').textContent = '$ ' + ag.toolcall;
    $('#pTake').textContent = ag.takeaway;
    $('#pLinkReadme').href = ag.links.readme;
    $('#pLinkSource').href = ag.links.source;
    if (!panel.classList.contains('open')) panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    clearIconSel();
    focusWindow(panel, ag.name);
    if (activeEl) activeEl.classList.remove('active');
    activeEl = el || null;
    if (el) el.classList.add('active');
    $('.p-body', panel).scrollTop = 0;
  }
  function closePanel() {
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    if (activeEl) { activeEl.classList.remove('active'); activeEl = null; }
  }
  $('#pClose').addEventListener('click', closePanel);
  addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanel();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); closePanel(); }
  });

  /* ---------- 窄屏卡片列表 ---------- */
  function buildGrid() {
    const g = $('#agentsGrid');
    g.innerHTML = AGENTS.map(ag => {
      const c = desat(ag.color);
      const head = ag.logo
        ? '<span class="ag-logo-wrap"><img class="ag-logo" src="' + esc(ag.logo) + '" alt="" data-fb loading="lazy">' +
          '<span class="ag-logo-fallback" hidden style="background:' + c + ';color:' + textOn(c) + '">' + esc(ag.monogram) + '</span></span>'
        : '<span class="ag-logo-fallback" style="background:' + c + ';color:' + textOn(c) + '">' + esc(ag.monogram) + '</span>';
      return '<button class="ag-card" type="button" data-slug="' + ag.slug + '">' +
        head +
        '<span class="ag-name">' + esc(ag.name) + '<em>' + esc(ag.vendor) + '</em></span>' +
        '<span class="ag-tool mono">' + esc(ag.toolcall) + '</span>' +
        '<span class="ag-take">' + esc(ag.takeaway) + '</span>' +
        '<span class="ag-more">查看档案 →</span>' +
        '</button>';
    }).join('');
    bindLogoFallback(g, (holder, img) => {
      if (!holder || !img) return;
      const fb = holder.querySelector('.ag-logo-fallback');
      if (fb) fb.hidden = false;
    });
    g.addEventListener('click', e => {
      const b = e.target.closest('.ag-card');
      if (!b) return;
      const ag = AGENTS.find(a => a.slug === b.dataset.slug);
      if (ag) openPanel(ag, null);
    });
  }

  /* ---------- 暂停控件（菜单栏按钮 + 视图菜单共用） / 时钟 / 响应式 ---------- */
  const animBtn = $('#animToggle');
  const menuAnimItem = $('#menuAnimItem');
  function setPaused(p) {
    paused = p;
    body.classList.toggle('is-paused', p);
    animBtn.setAttribute('aria-pressed', String(p));
    animBtn.title = p ? '继续动画' : '暂停动画';
    if (menuAnimItem) menuAnimItem.textContent = p ? '继续动画' : '暂停动画';
  }
  animBtn.addEventListener('click', () => setPaused(!paused));

  /* ---------- 菜单栏下拉（行为真实：hover 高亮 · 点击展开 · 换项即切 · 点击外部/Esc 收起） ---------- */
  const MB_ACTIONS = {
    repo: () => window.open('https://github.com/freeall12/computer-use', '_blank', 'noopener'),
    reports: () => window.open('https://github.com/freeall12/computer-use/tree/main/agents', '_blank', 'noopener'),
    docs: () => window.open('https://github.com/freeall12/computer-use#readme', '_blank', 'noopener'),
    issues: () => window.open('https://github.com/freeall12/computer-use/issues', '_blank', 'noopener'),
    closewin: () => closePanel(),
    toggleanim: () => setPaused(!paused),
    restart: () => location.reload()
  };
  (function setupMenus() {
    const triggers = $$('.mb-trigger');
    let openDrop = null, openTrigger = null;
    function close() {
      if (!openDrop) return;
      openDrop.hidden = true;
      openTrigger.setAttribute('aria-expanded', 'false');
      openDrop = null; openTrigger = null;
    }
    function open(trigger) {
      const drop = document.getElementById(trigger.dataset.menu);
      if (!drop) return;
      close();
      drop.hidden = false;
      drop.style.left = Math.min(trigger.offsetLeft, stage.clientWidth - drop.offsetWidth - 8) + 'px';
      trigger.setAttribute('aria-expanded', 'true');
      openDrop = drop; openTrigger = trigger;
    }
    triggers.forEach(tg => {
      tg.addEventListener('click', e => {
        e.stopPropagation();
        if (openTrigger === tg) close(); else open(tg);
      });
      tg.addEventListener('pointerenter', () => { if (openTrigger && openTrigger !== tg) open(tg); });
    });
    $$('.mb-drop .md-item[data-act]').forEach(mi => {
      mi.addEventListener('click', () => {
        const act = MB_ACTIONS[mi.dataset.act];
        close();
        if (act) act();
      });
    });
    document.addEventListener('pointerdown', e => {
      if (openDrop && !e.target.closest('.mb-drop') && !e.target.closest('.mb-trigger')) close();
    });
    addEventListener('keydown', e => { if (e.key === 'Escape' && openDrop) close(); });
  })();

  const WK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function tickClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    $('#mbTime').textContent =
      (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WK[d.getDay()] + ' ' + hh + ':' + mm;
  }

  posterMq.addEventListener('change', e => { if (!e.matches) startEngine(); });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => {
    reduced = e.matches;
    if (reduced) staticPlace();
    else startEngine();
  });
  addEventListener('resize', () => { if (reduced) staticPlace(); });

  /* ---------- 启动 ---------- */
  async function init() {
    AGENTS = await loadData();
    if (!AGENTS.length) {
      /* 数据失败：恢复显示静态内容层，保证页面仍可读 */
      document.documentElement.classList.remove('js-on');
      return;
    }
    registerWindows();
    registerDeskIcons();
    buildBars();
    buildKeyboard();
    buildCursors();
    buildDock();
    buildGrid();
    focusWindow($('#win-term'), '终端');            // 初始聚焦终端窗口
    if (reduced) {
      Term.renderStatic();
      Notes.renderStatic();
      setSlider(.55);
      staticPlace();
    } else {
      Term.loop();
      Notes.loop();
      setSlider(.42);
      startEngine();
    }
    tickClock();
    setInterval(tickClock, 20000);
  }
  init().catch(err => console.error('[atlas] 初始化失败', err));
})();
