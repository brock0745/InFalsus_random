/* =====================================================================
   In Falsus ランダム選曲  app.js
   ---------------------------------------------------------------------
   読む順番の目安
     1. 設定 (CONFIG)              … ここだけ触れば動作の基本設定を変えられます
     2. データ読み込み              … songs.json を読み込んで検査します
     3. 状態 (state) と保存         … ブラウザ(localStorage)に保存される内容
     4. 抽選プールの計算            … 「どの曲・譜面が抽選対象か」を決めます
     5. 描画 (render*)              … 画面を作る関数群
     6. ネタバレ確認ダイアログ       … 章を開くときの確認
     7. イベント / 初期化
   ===================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------
     1. 設定
     ------------------------------------------------------------------ */
  const CONFIG = {
    songsUrl: 'songs.json',              // 曲データ
    storageKey: 'ifalsus-random:v2',     // 保存キー（構造を変えたら v3 などに上げる）
    // ジャケット画像の探し方（優先順位の高い順）
    //   1. songs.json の "jacket" にファイル名を書いた曲 … jackets/ の中のそのファイル
    //      （拡張子つきならそのファイル、拡張子なしなら exts の順に探す）
    //   2. 書いていない曲 … jackets/<曲ID>.<拡張子> を exts の順に探す
    jacket: {
      basePath: 'jackets/',              // ジャケット画像のフォルダ
      exts: ['webp', 'png', 'jpg', 'jpeg'],  // 自動で探すときの拡張子（小文字。この順に試す）
      auto: true,                        // false にすると 2. の自動探索をしない
      overrides: {}                      // 曲ごとに別のURLを直接指定したいとき { "曲ID": "URL" }
    }
  };
  const JACKET = CONFIG.jacket;

  const TIERS = ['MIN', 'EVO', 'ULT', 'FBD'];
  const LEVELS = Array.from({ length: 15 }, (_, i) => i + 1);
  const ARCS = [0, 1, 2, 2.5, 3, 4];
  const ARC_LABEL = { 0: 'Base', 1: 'Arc 1', 2: 'Arc 2', 2.5: 'Arc 2.5', 3: 'Arc 3', 4: 'Arc 4' };
  // クリア済みの章の選択肢（value = その章までの曲を対象にする）
  const PROGRESS = [
    [0, '未クリア'], [1, 'Arc 1'], [2, 'Arc 2'], [2.5, 'Arc 2.5'], [3, 'Arc 3'], [4, 'Arc 4']
  ];

  /* ------------------------------------------------------------------
     2. データ読み込み
     ------------------------------------------------------------------ */
  let SONGS = [];
  let BY_ID = new Map();
  const missingJackets = new Set();      // 自動探索で画像が見つからなかった曲ID（何度も取りに行かない）
  const foundJacket = new Map();         // 自動探索で見つかった画像のURL（次回はそれだけ取りに行く）

  async function loadData() {
    // 単一ファイル版（プレビュー用）では、データがあらかじめ window に埋め込まれます
    if (window.INFALSUS_DATA) return window.INFALSUS_DATA;
    const res = await fetch(CONFIG.songsUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { const err = new Error(e.message); err.kind = 'json'; throw err; }
  }

  // songs.json を検査し、アプリ内部の形に整える
  function normalizeSongs(data) {
    const list = Array.isArray(data) ? data : data && data.songs;
    if (!Array.isArray(list)) throw new Error('songs.json に "songs" 配列がありません');
    const seen = new Set();
    return list.map((r, i) => {
      const name = r && (r.id || r.title) ? '（' + (r.id || r.title) + '）' : '';
      const where = (i + 1) + '番目の曲' + name;
      if (!r || !r.id || !r.title) throw new Error(where + ': id と title は必須です');
      if (seen.has(r.id)) throw new Error(where + ': id が重複しています');
      seen.add(r.id);
      const arc = Number(r.arc);
      if (!ARCS.includes(arc)) throw new Error(where + ': arc は 0 / 1 / 2 / 2.5 / 3 / 4 のいずれかです');
      const lv = r.lv || {};
      for (const t of TIERS) {
        if (!Number.isInteger(lv[t]) || lv[t] < 1 || lv[t] > 15) {
          throw new Error(where + ': lv.' + t + ' は 1〜15 の整数にしてください');
        }
      }
      return {
        id: String(r.id), title: String(r.title), ja: r.ja || '', artist: r.artist || '',
        arc, lv: { MIN: lv.MIN, EVO: lv.EVO, ULT: lv.ULT, FBD: lv.FBD },
        jacket: typeof r.jacket === 'string' && r.jacket.trim() ? r.jacket.trim() : null
      };
    });
  }

  // 画像の拡張子として扱うもの（"jacket" の値がこれで終わっていれば「拡張子つき」）
  const IMG_EXT_RE = /\.(webp|png|jpe?g|gif|avif|bmp)$/i;

  // songs.json の "jacket" の値を、読み込み用のパスにする。
  //   "cover.png"       → jackets/cover.png        （ファイル名だけなら basePath を付ける）
  //   "sub/x.png"       → sub/x.png                 （フォルダ付きならそのまま）
  //   "https://…" / "data:…" → そのまま
  // 日本語や ( ) # などを含む名前も、ここで安全な形に直します。
  function resolveJacketPath(p) {
    if (/^(https?:|data:)/i.test(p)) return p;
    const enc = p.split('/').map(encodeURIComponent).join('/');
    return p.includes('/') ? enc : JACKET.basePath + enc;
  }

  // 画像の候補URLを、試す順に返す（空なら画像なし＝プレースホルダー）
  //   auto:true の候補は「拡張子を順に試す」ので、見つかった/無かった結果を覚えておく。
  function jacketCandidates(song) {
    if (JACKET.overrides[song.id]) return { urls: [JACKET.overrides[song.id]], auto: false };

    if (song.jacket) {
      const p = song.jacket;
      // 拡張子なしの指定（例: "Alterd_Edge"）→ 拡張子を exts の順に試す
      if (!IMG_EXT_RE.test(p) && !/^(https?:|data:)/i.test(p)) {
        if (missingJackets.has(song.id)) return { urls: [], auto: true };
        if (foundJacket.has(song.id)) return { urls: [foundJacket.get(song.id)], auto: true };
        const base = resolveJacketPath(p);
        return { urls: JACKET.exts.map(e => base + '.' + e), auto: true };
      }
      return { urls: [resolveJacketPath(p)], auto: false };   // 拡張子つき → そのまま1つだけ
    }

    // "jacket" の指定なし → jackets/<曲ID>.<拡張子> を探す
    if (JACKET.auto && JACKET.basePath && !missingJackets.has(song.id)) {
      if (foundJacket.has(song.id)) return { urls: [foundJacket.get(song.id)], auto: true };
      return { urls: JACKET.exts.map(e => JACKET.basePath + song.id + '.' + e), auto: true };
    }
    return { urls: [], auto: false };
  }

  /* ------------------------------------------------------------------
     3. 状態と保存
     ------------------------------------------------------------------ */
  const state = {
    mode: 'song',
    progress: 0,                // クリア済みの章。初期値は「未クリア」
    // ネタバレ確認の記録
    //   skipAll: 「二度とほかの章でも表示しない」にチェックしたか
    //   ackMax : 確認済みの最も進んだ章（これ以下の章では確認を出さない）
    spoiler: { skipAll: false, ackMax: 0 },
    tiers: new Set(),
    levels: new Set(),
    arcs: new Set(),
    excluded: new Set(),        // 曲ごとの除外: id
    excludedCharts: new Set(),  // 譜面ごとの除外: "id:TIER"
    noRepeat: false,
    drawCount: 0,
    drawn: new Set(),
    history: [],
    current: null,
    exView: 'all',
    query: ''
  };
  let rolling = false;

  const chartKey = (id, tier) => id + ':' + tier;
  const visible = s => s.arc <= state.progress;

  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(CONFIG.storageKey) || 'null');
      if (j) {
        if (j.mode === 'chart' || j.mode === 'song') state.mode = j.mode;
        if (PROGRESS.some(p => p[0] === j.progress)) state.progress = j.progress;
        if (j.spoiler && typeof j.spoiler === 'object') {
          state.spoiler.skipAll = !!j.spoiler.skipAll;
          const a = Number(j.spoiler.ackMax);
          state.spoiler.ackMax = ARCS.includes(a) ? a : 0;
          if (state.spoiler.skipAll) state.spoiler.ackMax = 4;
        }
        (j.tiers || []).forEach(t => TIERS.includes(t) && state.tiers.add(t));
        (j.levels || []).forEach(l => LEVELS.includes(l) && state.levels.add(l));
        (j.arcs || []).forEach(a => ARCS.includes(a) && state.arcs.add(a));
        (j.excluded || []).forEach(id => BY_ID.has(id) && state.excluded.add(id));
        (j.excludedCharts || []).forEach(k => {
          const [id, t] = String(k).split(':');
          if (BY_ID.has(id) && TIERS.includes(t)) state.excludedCharts.add(k);
        });
        (j.drawn || []).forEach(id => BY_ID.has(id) && state.drawn.add(id));
        state.noRepeat = !!j.noRepeat;
        state.drawCount = Number.isFinite(j.drawCount) ? j.drawCount : 0;
        state.history = (j.history || []).filter(h => BY_ID.has(h.id)).slice(0, 10);
      }
    } catch (e) { /* 保存できない環境でも動作します */ }
    // 確認の記録がない章は開かない（保存データが一部消えた場合の安全策）
    if (state.progress > state.spoiler.ackMax) state.progress = 0;
    pruneFilters();
  }

  function save() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        mode: state.mode,
        progress: state.progress,
        spoiler: state.spoiler,
        tiers: [...state.tiers],
        levels: [...state.levels],
        arcs: [...state.arcs],
        excluded: [...state.excluded],
        excludedCharts: [...state.excludedCharts],
        drawn: [...state.drawn],
        noRepeat: state.noRepeat,
        drawCount: state.drawCount,
        history: state.history
      }));
    } catch (e) { /* noop */ }
  }

  /* ---------- ユーティリティ ---------- */
  const $ = s => document.querySelector(s);
  const els = {
    stage: $('#stage'), jacket: $('#jacket'), arc: $('#arc'), title: $('#songTitle'),
    ja: $('#songJa'), artist: $('#songArtist'), charts: $('#charts'),
    draw: $('#drawBtn'), exclude: $('#excludeBtn'), excludeChart: $('#excludeChartBtn'),
    chartActions: $('#chartActions'), status: $('#status'),
    progressChips: $('#progressChips'), progressInfo: $('#progressInfo'),
    modeSeg: $('#modeSeg'), caption: $('#modeCaption'),
    tierChips: $('#tierChips'), levelChips: $('#levelChips'), arcRow: $('#arcRow'), arcChips: $('#arcChips'),
    poolInfo: $('#poolInfo'), clearFilters: $('#clearFilters'),
    noRepeat: $('#noRepeat'), drawnInfo: $('#drawnInfo'), resetDrawn: $('#resetDrawn'),
    exCount: $('#exCount'), q: $('#q'), exView: $('#exView'), exClear: $('#exClear'),
    exList: $('#exList'), history: $('#history'), copyIds: $('#copyIds'),
    dataInfo: $('#dataInfo'), resetSpoiler: $('#resetSpoiler'),
    spDlg: $('#spoilerDialog'), spTitle: $('#spTitle'), spSkip: $('#spSkip'),
    spOk: $('#spOk'), spCancel: $('#spCancel')
  };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  }

  function rnd(n) {
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return Math.floor(a[0] / 4294967296 * n);
    }
    return Math.floor(Math.random() * n);
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function hue(id) {
    let x = 0;
    for (let i = 0; i < id.length; i++) x = (x * 31 + id.charCodeAt(i)) >>> 0;
    return x % 360;
  }
  const norm = s => String(s).normalize('NFKC').toLowerCase();
  const tierClass = t => 'tier-' + t.toLowerCase();
  const anyFilter = () => state.tiers.size > 0 || state.levels.size > 0 || state.arcs.size > 0;

  // 進行状況で見えている曲のうち、最も高いレベル（それ以上のレベルは選択肢ごと隠す）
  function visibleMaxLevel() {
    let m = 1;
    for (const s of SONGS) if (visible(s)) m = Math.max(m, s.lv.MIN, s.lv.EVO, s.lv.ULT, s.lv.FBD);
    return m;
  }
  function pruneFilters() {
    const maxLv = visibleMaxLevel();
    [...state.arcs].forEach(a => { if (a > state.progress) state.arcs.delete(a); });
    [...state.levels].forEach(l => { if (l > maxLv) state.levels.delete(l); });
  }

  /* ------------------------------------------------------------------
     4. 抽選プール
     ------------------------------------------------------------------ */
  // 譜面が条件に合うか（譜面単位の除外もここで反映）
  function chartMatches(song, tier, tierSet = state.tiers, levelSet = state.levels) {
    if (state.excludedCharts.has(chartKey(song.id, tier))) return false;
    return (!tierSet.size || tierSet.has(tier)) && (!levelSet.size || levelSet.has(song.lv[tier]));
  }
  // 曲が対象範囲か（進行状況・章の絞り込み・曲ごとの除外）
  function inScope(song, arcSet = state.arcs) {
    return visible(song) && !state.excluded.has(song.id) && (!arcSet.size || arcSet.has(song.arc));
  }

  function computePools(applyNoRepeat) {
    const charts = [];
    for (const s of SONGS) {
      if (!inScope(s)) continue;
      if (applyNoRepeat && state.noRepeat && state.drawn.has(s.id)) continue;
      for (const t of TIERS) if (chartMatches(s, t)) charts.push({ song: s, tier: t });
    }
    return { charts, songs: [...new Set(charts.map(c => c.song))] };
  }

  function chartCount(tierSet, levelSet, arcSet) {
    let n = 0;
    for (const s of SONGS) {
      if (!inScope(s, arcSet)) continue;
      for (const t of TIERS) if (chartMatches(s, t, tierSet, levelSet)) n++;
    }
    return n;
  }

  /* ------------------------------------------------------------------
     5. 描画
     ------------------------------------------------------------------ */
  const chartEls = TIERS.map(t => {
    const lv = h('span', { class: 'lv', text: '–' });
    const el = h('div', { class: 'cchip ' + tierClass(t) }, h('span', { class: 'tn', text: t }), lv);
    els.charts.append(el);
    return { t, el, lv };
  });

  // 六角形の枠が途切れ、深紅の破片が散るプレースホルダー
  const RING = '<svg viewBox="0 0 100 100" aria-hidden="true">'
    + '<polygon class="hex2" points="34,24 66,24 82,50 66,76 34,76 18,50"/>'
    + '<polygon class="hex" points="26,10 74,10 98,50 74,90 26,90 2,50"/>'
    + '<polygon class="sh" points="-6,30 4,26 -2,38"/>'
    + '<polygon class="sh" points="8,20 18,16 12,28" fill-opacity="0.75"/>'
    + '<polygon class="sh" points="-12,46 -2,44 -8,54" fill-opacity="0.6"/>'
    + '</svg>';

  function setJacket(song, opts = {}) {
    const box = els.jacket;
    box.replaceChildren();
    const h1 = song ? hue(song.id) : 214;
    box.style.setProperty('--h1', h1);
    box.style.setProperty('--h2', (h1 + 45) % 360);
    const initial = song ? ([...song.title][0] || '?').toUpperCase() : '▮';
    const ph = h('div', { class: 'ph' });
    ph.innerHTML = RING;
    ph.append(h('span', { text: initial }));
    box.append(ph);
    // 抽選中のアニメーションでは画像を取りに行かない（無駄な通信を避ける）
    if (song && !opts.noImage) {
      const c = jacketCandidates(song);
      if (c.urls.length) loadJacket(box, song, c.urls, c.auto);
    }
  }

  // 候補URLを先頭から順に試す。読み込めたらそれを表示し、失敗したら次の候補へ。
  function loadJacket(box, song, urls, auto) {
    const url = urls[0];
    const img = new Image();
    img.alt = song.title + ' のジャケット';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      img.classList.add('ok');
      if (auto) foundJacket.set(song.id, url);
    });
    img.addEventListener('error', () => {
      const stillShown = img.isConnected;   // 別の曲に切り替わっていたら続けない
      img.remove();
      if (urls.length > 1) { if (stillShown) loadJacket(box, song, urls.slice(1), auto); }
      else if (auto) missingJackets.add(song.id);
    });
    img.src = url;
    box.append(img);
  }

  function paintChips(song, pickedTier) {
    const marked = anyFilter() || TIERS.some(t => state.excludedCharts.has(chartKey(song.id, t)));
    for (const c of chartEls) {
      c.lv.textContent = song.lv[c.t];
      c.el.classList.remove('on', 'off', 'picked');
      if (pickedTier) c.el.classList.add(c.t === pickedTier ? 'picked' : 'off');
      else if (marked) c.el.classList.add(chartMatches(song, c.t) ? 'on' : 'off');
    }
  }

  const reducedMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const blocks = n => Array.from({ length: n }, () => (rnd(4) ? '▮' : '▯')).join('');
  const maskOf = text => [...text].map(c => (c === ' ' ? ' ' : (rnd(4) ? '▮' : '▯'))).join('');

  function setTitle(text, redacted) {
    els.title.textContent = text;
    els.title.classList.toggle('redacted', !!redacted);
  }

  // 曲名を墨消し（▮）から左へ順に開示していく
  async function decodeTitle(final) {
    const chars = [...final];
    if (reducedMotion() || !chars.length) { setTitle(final, false); return; }
    const per = Math.max(14, Math.min(42, Math.round(900 / chars.length)));
    for (let i = 0; i <= chars.length; i++) {
      setTitle(chars.slice(0, i).join('') + maskOf(chars.slice(i).join('')), i < chars.length);
      if (i < chars.length) await sleep(per);
    }
    setTitle(final, false);
  }

  async function paint(song, pickedTier, opts = {}) {
    els.stage.style.setProperty('--h', hue(song.id));
    els.arc.textContent = ARC_LABEL[song.arc];
    els.ja.textContent = song.ja || '';
    els.artist.textContent = song.artist;
    setJacket(song);
    paintChips(song, pickedTier);
    if (opts.decode) await decodeTitle(song.title);
    else setTitle(song.title, false);
  }

  function paintEmpty() {
    els.stage.style.setProperty('--h', 214);
    els.arc.textContent = '';
    setTitle('▮▮▮▮▮▮▮▮', true);
    els.artist.textContent = '';
    els.ja.textContent = '抽選すると1曲が開示されます';
    setJacket(null);
    chartEls.forEach(c => { c.lv.textContent = '–'; c.el.classList.remove('on', 'off', 'picked'); });
  }

  let statusTimer = null;
  function setStatus(msg, opts = {}) {
    clearTimeout(statusTimer);
    els.status.className = 'status' + (opts.warn ? ' warn' : '');
    els.status.replaceChildren(msg || '');
    if (opts.action) {
      els.status.append(h('button', {
        class: 'undo', type: 'button', text: opts.action.label,
        onclick: () => opts.action.fn()
      }));
    }
    if (msg && !opts.warn) statusTimer = setTimeout(() => setStatus(''), 7000);
  }

  // 抽選中: ジャケット色と墨消しの長さだけが目まぐるしく変わる
  async function rollAnimation(songs) {
    if (reducedMotion()) return;
    els.stage.classList.add('rolling');
    const steps = 9;
    for (let i = 0; i < steps; i++) {
      const s = songs[rnd(songs.length)];
      els.stage.style.setProperty('--h', hue(s.id));
      els.arc.textContent = '';
      els.ja.textContent = '';
      els.artist.textContent = blocks(8);
      setTitle(maskOf(s.title), true);
      setJacket(s, { noImage: true });
      chartEls.forEach(c => { c.lv.textContent = '–'; c.el.classList.remove('on', 'off', 'picked'); });
      await sleep(46 + i * i * 2);
    }
  }

  async function draw() {
    if (rolling) return;
    let p = computePools(true);
    let note = '';
    if (!p.songs.length && state.noRepeat && state.drawn.size) {
      const base = computePools(false);
      if (base.songs.length) {
        state.drawn.clear();
        p = base;
        note = '全曲が一巡したので、重複チェックをリセットしました';
      }
    }
    if (!p.songs.length) {
      setStatus('条件に合う曲がありません。絞り込みや除外リストを見直してください。', { warn: true });
      return;
    }

    let pick;
    if (state.mode === 'chart') {
      const c = p.charts[rnd(p.charts.length)];
      pick = { song: c.song, tier: c.tier };
    } else {
      pick = { song: p.songs[rnd(p.songs.length)], tier: null };
    }

    rolling = true;
    els.draw.disabled = true;
    updateExcludeBtns();
    setStatus('');
    await rollAnimation(p.songs);
    els.stage.classList.remove('rolling');
    els.stage.classList.remove('pop');
    void els.stage.offsetWidth;
    els.stage.classList.add('pop');
    await paint(pick.song, pick.tier, { decode: true });
    rolling = false;
    els.draw.disabled = false;

    state.current = pick;
    state.drawn.add(pick.song.id);
    state.history.unshift({ id: pick.song.id, tier: pick.tier, n: ++state.drawCount, t: Date.now() });
    state.history = state.history.slice(0, 10);
    save();
    refreshAll();
    if (note) setStatus(note);
  }

  /* ---------- 除外 ---------- */
  function toggleExclude(id) {
    if (state.excluded.has(id)) state.excluded.delete(id);
    else state.excluded.add(id);
    save();
    refreshAll();
  }
  function toggleChartExclude(id, tier) {
    const k = chartKey(id, tier);
    if (state.excludedCharts.has(k)) state.excludedCharts.delete(k);
    else state.excludedCharts.add(k);
    save();
    refreshAll();
  }

  els.exclude.addEventListener('click', () => {
    const s = state.current && state.current.song;
    if (!s || state.excluded.has(s.id)) return;
    state.excluded.add(s.id);
    save();
    refreshAll();
    setStatus('「' + s.title + '」を除外しました', {
      action: {
        label: '取り消す',
        fn: () => { state.excluded.delete(s.id); save(); refreshAll(); setStatus(''); }
      }
    });
  });

  els.excludeChart.addEventListener('click', () => {
    const cur = state.current;
    if (!cur || !cur.tier) return;
    const k = chartKey(cur.song.id, cur.tier);
    if (state.excludedCharts.has(k)) return;
    state.excludedCharts.add(k);
    save();
    refreshAll();
    setStatus('「' + cur.song.title + '」の ' + cur.tier + ' を除外しました', {
      action: {
        label: '取り消す',
        fn: () => { state.excludedCharts.delete(k); save(); refreshAll(); setStatus(''); }
      }
    });
  });

  /* ------------------------------------------------------------------
     6. 進行状況（クリア済みの章）とネタバレ確認
     ------------------------------------------------------------------ */
  function setProgress(v, force) {
    if (v === state.progress && !force) return;
    state.progress = v;
    pruneFilters();
    if (state.current && !visible(state.current.song)) {
      state.current = null;
      paintEmpty();
    }
    save();
    refreshAll();
    setStatus('');
  }

  // 章のボタンが押されたときの入口。確認が必要ならダイアログを出す。
  //   確認が要るのは「未確認の、より先の章を開くとき」だけ。
  //   例) Arc 2 を確認済みなら、Arc 1 や Arc 2 に戻すときは出ない。
  //       Arc 4 を確認済みなら、全章で出ない。
  async function requestProgress(v) {
    if (v === state.progress) return;
    const needAsk = v > 0 && !state.spoiler.skipAll && v > state.spoiler.ackMax;
    if (needAsk) {
      const r = await askSpoiler(v);
      if (!r) return;                                   // 「やめる」
      if (r.skip) { state.spoiler.skipAll = true; state.spoiler.ackMax = 4; }
      else state.spoiler.ackMax = Math.max(state.spoiler.ackMax, v);
    }
    setProgress(v);
  }

  // ダイアログを開いて、結果（{skip: チェック有無} または null）を返す
  function askSpoiler(v) {
    return new Promise(resolve => {
      const dlg = els.spDlg;
      els.spTitle.textContent = ARC_LABEL[v] + ' までの曲を表示';
      els.spSkip.checked = false;
      const finish = ok => {
        const skip = els.spSkip.checked;
        dlg.oncancel = null; els.spOk.onclick = null; els.spCancel.onclick = null;
        if (dlg.open) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
        resolve(ok ? { skip } : null);
      };
      els.spOk.onclick = () => finish(true);
      els.spCancel.onclick = () => finish(false);
      dlg.oncancel = e => { e.preventDefault(); finish(false); };   // Esc キー
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    });
  }

  function renderProgress() {
    els.progressChips.replaceChildren(...PROGRESS.map(([v, label]) => h('button', {
      class: 'chip', type: 'button', role: 'radio',
      'aria-checked': String(v === state.progress), 'aria-pressed': String(v === state.progress),
      text: label, onclick: () => requestProgress(v)
    })));
    const n = SONGS.filter(visible).length;
    const hiddenN = SONGS.length - n;
    const last = ARC_LABEL[state.progress];
    const text = state.progress === 0
      ? '最初から遊べる Base の' + n + '曲が対象です'
      : state.progress === 4
        ? '全' + n + '曲が対象です'
        : 'Base〜' + last + ' の' + n + '曲が対象です';
    els.progressInfo.replaceChildren(
      text,
      h('span', { class: 'redact', 'aria-hidden': hiddenN ? null : 'true' },
        hiddenN ? '▮'.repeat(Math.min(14, Math.ceil(hiddenN / 4))) + '　' + hiddenN + '曲は未開示' : ''));
  }

  /* ---------- 描画（続き） ---------- */
  function renderModeUI() {
    els.modeSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    els.caption.textContent = state.mode === 'song'
      ? '曲を同じ確率で選びます。条件に合う譜面は結果カードで強調表示されます。'
      : '条件に合う譜面（曲×難易度）から1つ選びます。';
  }

  function renderFilters() {
    els.tierChips.replaceChildren(...TIERS.map(t => {
      const on = state.tiers.has(t);
      const empty = chartCount(new Set([t]), state.levels, state.arcs) === 0;
      return h('button', {
        class: 'chip ' + tierClass(t) + (empty ? ' empty' : ''), type: 'button',
        'aria-pressed': String(on), text: t,
        onclick: () => { on ? state.tiers.delete(t) : state.tiers.add(t); onFilterChange(); }
      });
    }));

    const maxLv = visibleMaxLevel();
    els.levelChips.replaceChildren(...LEVELS.filter(l => l <= maxLv).map(l => {
      const on = state.levels.has(l);
      const empty = chartCount(state.tiers, new Set([l]), state.arcs) === 0;
      return h('button', {
        class: 'chip' + (empty ? ' empty' : ''), type: 'button',
        'aria-pressed': String(on), text: String(l),
        onclick: () => { on ? state.levels.delete(l) : state.levels.add(l); onFilterChange(); }
      });
    }));

    // 章の絞り込み: 進行状況までの章だけ表示（Base のみなら行ごと隠す）
    const arcs = ARCS.filter(a => a <= state.progress);
    els.arcRow.hidden = arcs.length <= 1;
    els.arcChips.replaceChildren(...arcs.map(a => {
      const on = state.arcs.has(a);
      const empty = chartCount(state.tiers, state.levels, new Set([a])) === 0;
      return h('button', {
        class: 'chip' + (empty ? ' empty' : ''), type: 'button',
        'aria-pressed': String(on), text: ARC_LABEL[a],
        onclick: () => { on ? state.arcs.delete(a) : state.arcs.add(a); onFilterChange(); }
      });
    }));

    els.clearFilters.disabled = !anyFilter();
  }

  function onFilterChange() {
    save();
    refreshAll();
  }

  function renderPool() {
    const all = computePools(false);
    const rest = computePools(true);
    els.poolInfo.textContent = '対象 ' + all.songs.length + '曲 / ' + all.charts.length + '譜面';
    els.noRepeat.setAttribute('aria-checked', String(state.noRepeat));
    els.drawnInfo.textContent = state.noRepeat
      ? '出た曲 ' + state.drawn.size + '曲 ・ 残り ' + rest.songs.length + '曲'
      : 'オンにすると一巡するまで同じ曲が出ません';
    els.resetDrawn.hidden = !state.drawn.size;
  }

  const hasChartEx = s => TIERS.some(t => state.excludedCharts.has(chartKey(s.id, t)));

  function renderExList() {
    const q = norm(state.query.trim());
    const keep = els.exList.scrollTop;
    const rows = SONGS.filter(s => {
      if (!visible(s)) return false; // 未クリアの章の曲は表示しない
      if (state.exView === 'ex' && !state.excluded.has(s.id) && !hasChartEx(s)) return false;
      if (!q) return true;
      return norm(s.title + ' ' + s.ja + ' ' + s.artist + ' ' + s.id).includes(q);
    }).map(s => {
      const ex = state.excluded.has(s.id);
      return h('div', { class: 'xrow' + (ex ? ' is-ex' : '') },
        h('button', {
          class: 'xmain', type: 'button', 'aria-pressed': String(ex),
          'aria-label': s.title + ' を' + (ex ? '除外から戻す' : '除外する'),
          onclick: () => toggleExclude(s.id)
        },
          h('span', { class: 'xt' },
            h('b', { text: s.title + (s.ja ? '　' + s.ja : '') }),
            h('small', { text: s.artist + '　' + ARC_LABEL[s.arc] })),
          h('span', { class: 'xmark', 'aria-hidden': 'true' })),
        h('div', { class: 'xcharts' }, TIERS.map(t => {
          const off = state.excludedCharts.has(chartKey(s.id, t));
          return h('button', {
            class: 'mini ' + tierClass(t) + (off ? ' is-off' : ''), type: 'button',
            'aria-pressed': String(off), disabled: ex,
            'aria-label': s.title + ' の ' + t + ' ' + s.lv[t] + ' を' + (off ? '除外から戻す' : '除外する'),
            text: t + ' ' + s.lv[t],
            onclick: () => toggleChartExclude(s.id, t)
          });
        })));
    });
    if (rows.length) els.exList.replaceChildren(...rows);
    else els.exList.replaceChildren(h('div', { class: 'empty-note', text: state.exView === 'ex' && !q ? '除外中の曲・譜面はありません' : '該当する曲がありません' }));
    els.exList.scrollTop = keep;

    // 見えている範囲の除外数（曲ごと＋譜面ごと）
    let n = 0;
    for (const s of SONGS) {
      if (!visible(s)) continue;
      if (state.excluded.has(s.id)) n++;
      else n += TIERS.filter(t => state.excludedCharts.has(chartKey(s.id, t))).length;
    }
    els.exCount.textContent = n;
    els.exCount.classList.toggle('has', n > 0);
    els.exClear.disabled = state.excluded.size === 0 && state.excludedCharts.size === 0;
  }

  function ago(t) {
    if (!t) return '';
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return 'たった今';
    if (m < 60) return m + '分前';
    if (m < 1440) return Math.floor(m / 60) + '時間前';
    return Math.floor(m / 1440) + '日前';
  }

  function renderHistory() {
    const items = state.history.filter(e => BY_ID.has(e.id) && visible(BY_ID.get(e.id)));
    if (!items.length) {
      els.history.replaceChildren(h('div', { class: 'empty-note', text: 'まだ抽選していません' }));
      return;
    }
    els.history.replaceChildren(...items.map(e => {
      const s = BY_ID.get(e.id);
      return h('button', {
        class: 'post', type: 'button',
        onclick: () => {
          paint(s, e.tier);
          state.current = { song: s, tier: e.tier };
          updateExcludeBtns();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
        h('div', { class: 'meta' },
          h('span', { class: 'no', text: (e.n ? e.n : '–') + ':' }),
          h('span', { text: ago(e.t) })),
        h('div', { class: 'body' },
          h('b', { text: s.title }),
          e.tier ? h('span', { class: 'htag ' + tierClass(e.tier), text: e.tier + ' ' + s.lv[e.tier] }) : null));
    }));
  }

  function updateExcludeBtns() {
    const cur = state.current;
    const s = cur && cur.song;
    const songEx = !!(s && state.excluded.has(s.id));
    els.exclude.disabled = !s || rolling || songEx;
    els.exclude.textContent = songEx ? '除外済み' : 'この曲を除外';

    const showChart = !!(s && cur.tier);
    els.chartActions.hidden = !showChart;
    if (showChart) {
      const off = state.excludedCharts.has(chartKey(s.id, cur.tier));
      els.excludeChart.disabled = rolling || off || songEx;
      els.excludeChart.textContent = off
        ? 'この譜面は除外済み'
        : 'この譜面を除外（' + cur.tier + ' ' + s.lv[cur.tier] + '）';
    }
  }

  function refreshAll() {
    renderProgress();
    renderModeUI();
    renderFilters();
    renderPool();
    renderExList();
    renderHistory();
    if (state.current && !rolling) paintChips(state.current.song, state.current.tier);
    updateExcludeBtns();
  }

  /* ------------------------------------------------------------------
     7. イベント / 初期化
     ------------------------------------------------------------------ */
  els.draw.addEventListener('click', draw);
  els.modeSeg.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.mode = b.dataset.mode;
    save();
    renderModeUI();
  });
  els.clearFilters.addEventListener('click', () => {
    state.tiers.clear(); state.levels.clear(); state.arcs.clear();
    onFilterChange();
  });
  els.noRepeat.addEventListener('click', () => { state.noRepeat = !state.noRepeat; save(); renderPool(); });
  els.resetDrawn.addEventListener('click', () => { state.drawn.clear(); save(); renderPool(); setStatus('重複チェックをリセットしました'); });
  els.q.addEventListener('input', () => { state.query = els.q.value; renderExList(); });
  els.exView.addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.exView = b.dataset.view;
    els.exView.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderExList();
  });
  els.exClear.addEventListener('click', () => {
    const prevSongs = [...state.excluded];
    const prevCharts = [...state.excludedCharts];
    state.excluded.clear();
    state.excludedCharts.clear();
    save();
    refreshAll();
    setStatus('除外をすべて解除しました', {
      action: {
        label: '取り消す',
        fn: () => {
          prevSongs.forEach(id => state.excluded.add(id));
          prevCharts.forEach(k => state.excludedCharts.add(k));
          save(); refreshAll(); setStatus('');
        }
      }
    });
  });
  els.copyIds.addEventListener('click', async () => {
    const text = SONGS.map(s => s.id + '\t' + s.title).join('\n');
    try { await navigator.clipboard.writeText(text); els.copyIds.textContent = 'コピーしました'; }
    catch (e) { els.copyIds.textContent = 'コピーできませんでした'; }
    setTimeout(() => { els.copyIds.textContent = '曲ID一覧をコピー'; }, 2500);
  });
  // ネタバレ確認の記録を消して、未クリアに戻す
  els.resetSpoiler.addEventListener('click', () => {
    state.spoiler = { skipAll: false, ackMax: 0 };
    setProgress(0, true);
    setStatus('ネタバレ確認の記録をリセットし、未クリアに戻しました');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 読み込みに失敗したときの案内
  function showFatal(e) {
    let msg;
    if (e.kind === 'json') {
      msg = 'songs.json の書式エラーです（' + e.message + '）。カンマ・引用符・コロンの抜けや、全角文字が混ざっていないか確認してください。';
    } else if (location.protocol === 'file:') {
      msg = 'songs.json を読み込めません。ファイルを直接開いている場合は、フォルダで「python -m http.server」を実行し、http://localhost:8000/ を開いてください。';
    } else {
      msg = '曲データを読み込めませんでした（' + e.message + '）。';
    }
    setStatus(msg, { warn: true });
    els.draw.disabled = true;
  }

  async function init() {
    try {
      const data = await loadData();
      SONGS = normalizeSongs(data);
      BY_ID = new Map(SONGS.map(s => [s.id, s]));
      const info = [];
      if (data.version) info.push('曲データ: ' + data.version + ' 時点');
      if (data.updated) info.push(data.updated + ' 更新');
      if (data.note) info.push(data.note);
      els.dataInfo.textContent = info.join('　');
    } catch (e) {
      showFatal(e);
      return;
    }
    load();
    paintEmpty();
    refreshAll();
    els.draw.disabled = false;
    setInterval(renderHistory, 30000);   // 「N分前」を更新
  }

  // 拡張・デバッグ用（ブラウザのコンソールから触れます）
  window.IFR = {
    CONFIG, state,
    get songs() { return SONGS; },
    jacketCandidates,
    ids: () => SONGS.map(s => s.id + '\t' + s.title).join('\n')
  };

  init();
})();
