(() => {
  'use strict';

  const START_COUNT = 2;
  const STORAGE_KEY = 'number-line:count';
  const CLEAR_DELAY_MS = 1200;
  const ERROR_MS = 450;

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const stageEl = document.getElementById('stage');
  const progressEl = document.getElementById('progress');
  const hintEl = document.getElementById('hint');
  const restartBtn = document.getElementById('restart');
  const overlayEl = document.getElementById('overlay');
  const overlayTitleEl = document.getElementById('overlay-title');
  const overlaySubEl = document.getElementById('overlay-sub');

  const DEFAULT_HINT = '1 から順番に、数字を線でつなごう';

  const state = {
    count: START_COUNT, // このステージに並ぶ数字の数 (1〜count)
    nodes: [], // { n, fx, fy } fx/fy は盤面内の 0〜1 の相対座標
    connected: 1, // 1 から connected までつながっている
    dragging: false,
    pointerId: null,
    pointer: { x: 0, y: 0 },
    errorNode: 0,
    errorUntil: 0,
    cleared: false,
  };

  const view = { width: 0, height: 0, dpr: 1, radius: 30 };
  let colors = {};
  let hintTimer = 0;

  // ---------- 保存 ----------

  function loadCount() {
    try {
      const saved = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      if (Number.isFinite(saved) && saved >= START_COUNT) return saved;
    } catch (e) {
      // ストレージが使えない環境でも遊べるようにする
    }
    return START_COUNT;
  }

  function saveCount(count) {
    try {
      localStorage.setItem(STORAGE_KEY, String(count));
    } catch (e) {
      // 保存できなくてもゲームは続行
    }
  }

  // ---------- レイアウト ----------

  // 数字が増えるほど円を小さくして、盤面に必ず収まるようにする
  function radiusFor(count, width, height) {
    const cell = Math.sqrt((width * height) / count);
    return Math.max(6, Math.min(34, cell * 0.3));
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // 円が重ならないようにランダム配置。詰まったら間隔を詰めて再挑戦し、
  // それでも無理ならジッター付きグリッドで確実に配置する。
  function placeNodes(count, width, height, r) {
    const pad = r + 8;
    const w = Math.max(1, width - pad * 2);
    const h = Math.max(1, height - pad * 2);

    for (const gapScale of [1.6, 1.0, 0.6, 0.3]) {
      const minDist = r * 2 + r * gapScale;
      const points = [];
      let ok = true;
      for (let i = 0; i < count && ok; i++) {
        let placed = false;
        for (let attempt = 0; attempt < 400; attempt++) {
          const x = pad + Math.random() * w;
          const y = pad + Math.random() * h;
          if (points.every((p) => Math.hypot(p.x - x, p.y - y) >= minDist)) {
            points.push({ x, y });
            placed = true;
            break;
          }
        }
        ok = placed;
      }
      if (ok) return points;
    }

    const cols = Math.max(1, Math.ceil(Math.sqrt((count * w) / h)));
    const rows = Math.ceil(count / cols);
    const cw = w / cols;
    const ch = h / rows;
    const jx = Math.max(0, (cw - r * 2) / 2);
    const jy = Math.max(0, (ch - r * 2) / 2);
    const cells = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        cells.push({
          x: pad + cw * (col + 0.5) + (Math.random() * 2 - 1) * jx,
          y: pad + ch * (row + 0.5) + (Math.random() * 2 - 1) * jy,
        });
      }
    }
    return shuffle(cells).slice(0, count);
  }

  function nodePos(node) {
    const pad = view.radius + 8;
    return {
      x: pad + node.fx * Math.max(1, view.width - pad * 2),
      y: pad + node.fy * Math.max(1, view.height - pad * 2),
    };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    view.width = rect.width;
    view.height = rect.height;
    view.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * view.dpr);
    canvas.height = Math.round(rect.height * view.dpr);
    view.radius = radiusFor(state.count, view.width, view.height);
  }

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const get = (name) => s.getPropertyValue(name).trim();
    colors = {
      bg: get('--bg'),
      text: get('--text'),
      node: get('--node'),
      nodeBorder: get('--node-border'),
      accent: get('--accent'),
      accentText: get('--accent-text'),
      error: get('--error'),
      drag: get('--drag'),
    };
  }

  // ---------- ゲーム進行 ----------

  function startStage(count) {
    state.count = count;
    state.connected = 1;
    state.dragging = false;
    state.pointerId = null;
    state.errorNode = 0;
    state.cleared = false;
    view.radius = radiusFor(count, view.width, view.height);

    const pad = view.radius + 8;
    const w = Math.max(1, view.width - pad * 2);
    const h = Math.max(1, view.height - pad * 2);
    state.nodes = placeNodes(count, view.width, view.height, view.radius).map((p, i) => ({
      n: i + 1,
      fx: (p.x - pad) / w,
      fy: (p.y - pad) / h,
    }));

    overlayEl.hidden = true;
    setHint(DEFAULT_HINT);
    updateHud();
  }

  function updateHud() {
    stageEl.textContent = `ステージ ${state.count - 1}`;
    progressEl.textContent = `${state.connected} / ${state.count}`;
  }

  function setHint(text, isError = false) {
    clearTimeout(hintTimer);
    hintEl.textContent = text;
    hintEl.classList.toggle('is-error', isError);
    if (isError) {
      hintTimer = setTimeout(() => setHint(DEFAULT_HINT), 1600);
    }
  }

  function flashError(n, message) {
    state.errorNode = n;
    state.errorUntil = performance.now() + ERROR_MS;
    setHint(message, true);
  }

  function connectNext() {
    state.connected += 1;
    updateHud();
    if (state.connected === state.count) {
      stageClear();
    }
  }

  function stageClear() {
    state.cleared = true;
    state.dragging = false;
    const next = state.count + 1;
    saveCount(next);
    overlayTitleEl.textContent = 'クリア！';
    overlaySubEl.textContent = `次は 1〜${next}`;
    overlayEl.hidden = false;
    setTimeout(() => startStage(next), CLEAR_DELAY_MS);
  }

  // ---------- 入力 ----------

  function toLocal(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // 指でも触りやすいよう、見た目より少し広い当たり判定にする
  function hitNode(p) {
    const hitR = Math.max(view.radius * 1.15, view.radius + 6);
    let best = null;
    let bestDist = Infinity;
    for (const node of state.nodes) {
      const pos = nodePos(node);
      const d = Math.hypot(pos.x - p.x, pos.y - p.y);
      if (d <= hitR && d < bestDist) {
        best = node;
        bestDist = d;
      }
    }
    return best;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (state.cleared || state.dragging) return;
    const p = toLocal(e);
    const node = hitNode(p);
    if (!node) return;

    if (node.n === state.connected) {
      state.dragging = true;
      state.pointerId = e.pointerId;
      state.pointer = p;
      canvas.setPointerCapture(e.pointerId);
    } else if (node.n > state.connected) {
      flashError(node.n, `${state.connected} から線を引いてね`);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!state.dragging || e.pointerId !== state.pointerId) return;
    state.pointer = toLocal(e);
    const node = hitNode(state.pointer);
    if (!node || node.n <= state.connected) return;

    if (node.n === state.connected + 1) {
      connectNext();
    } else if (state.errorNode !== node.n || performance.now() > state.errorUntil) {
      flashError(node.n, `次は ${state.connected + 1} だよ`);
    }
  });

  function endDrag(e) {
    if (e.pointerId !== state.pointerId) return;
    state.dragging = false;
    state.pointerId = null;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  restartBtn.addEventListener('click', () => {
    if (state.count > START_COUNT && !window.confirm('ステージ 1 からやり直しますか？')) return;
    saveCount(START_COUNT);
    startStage(START_COUNT);
  });

  // ---------- 描画 ----------

  function draw(now) {
    const { width, height, dpr, radius: r } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const positions = state.nodes.map(nodePos);
    const lineWidth = Math.max(3, r * 0.28);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // つないだ線
    if (state.connected > 1) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(positions[0].x, positions[0].y);
      for (let i = 1; i < state.connected; i++) {
        ctx.lineTo(positions[i].x, positions[i].y);
      }
      ctx.stroke();
    }

    // ドラッグ中の線
    if (state.dragging) {
      const head = positions[state.connected - 1];
      ctx.strokeStyle = colors.drag;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      ctx.lineTo(state.pointer.x, state.pointer.y);
      ctx.stroke();
    }

    // 数字の円
    const errorActive = now < state.errorUntil;
    for (let i = 0; i < state.nodes.length; i++) {
      const node = state.nodes[i];
      let { x, y } = positions[i];
      const done = node.n <= state.connected;
      const isError = errorActive && node.n === state.errorNode;

      if (isError) {
        const t = 1 - (state.errorUntil - now) / ERROR_MS;
        x += Math.sin(t * Math.PI * 6) * r * 0.25 * (1 - t);
      }

      // 次に線を伸ばす起点をゆっくり点滅させる
      if (node.n === state.connected && !state.cleared) {
        const pulse = (Math.sin(now / 280) + 1) / 2;
        ctx.strokeStyle = colors.accent;
        ctx.globalAlpha = 0.25 + pulse * 0.35;
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + pulse * r * 0.25, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = isError ? colors.error : done ? colors.accent : colors.node;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.strokeStyle = isError ? colors.error : done ? colors.accent : colors.nodeBorder;
      ctx.stroke();

      const label = String(node.n);
      const fontScale = label.length <= 2 ? 0.95 : 1.9 / label.length;
      ctx.font = `700 ${Math.max(7, r * fontScale)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isError || done ? colors.accentText : colors.text;
      ctx.fillText(label, x, y + r * 0.04);
    }

    requestAnimationFrame(draw);
  }

  // ---------- 起動 ----------

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  darkQuery.addEventListener('change', readColors);
  window.addEventListener('resize', resize);

  readColors();
  resize();
  startStage(loadCount());
  requestAnimationFrame(draw);
})();
