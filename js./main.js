/* PAKKAAAN! — 起動・メインループ・入力・工程の切り替え */
(function () {
  'use strict';
  const PK = window.PK || {};
  const $ = (id) => document.getElementById(id);
  const fail = (msg) => window.__pkError && window.__pkError(msg);

  if (typeof THREE === 'undefined') {
    fail('3Dライブラリ（Three.js）を読み込めませんでした。インターネット接続を確認して再読み込みしてください。');
    return;
  }
  (function () {
    try {
      const c = document.createElement('canvas');
      if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
    } catch (e) {
      fail('このブラウザでは WebGL（3D表示）が使えません。別のブラウザか端末でお試しください。');
      throw e;
    }
  })();

  // 必要なファイルがすべて読み込まれたか確認（欠けていたらファイル名を表示）
  const REQUIRED = {
    U: 'js/utils.js', Audio: 'js/audio.js', State: 'js/gameState.js', Kitchen: 'js/kitchen.js', Prep: 'js/prep.js',
    Egg: 'js/eggSimulation.js', Omelette: 'js/omelette.js', PanController: 'js/panController.js', Plating: 'js/plating.js',
    KnifeController: 'js/knifeController.js', SauceController: 'js/sauceController.js', Scoring: 'js/scoring.js', UI: 'js/ui.js',
  };
  const missing = Object.keys(REQUIRED).filter((k) => !PK[k]).map((k) => REQUIRED[k]);
  if (missing.length) {
    fail('次のファイルが読み込めませんでした：\n' + missing.join('\n') +
      '\n\nindex.html と同じ場所に js フォルダがあり、その中に上のファイルがあるか確認してください。ページを再読み込みすると直ることもあります。');
    return;
  }
  const U = PK.U, S = PK.State, UI = PK.UI;
  const G = (window.PKG = { camMode: false });

  const PRESETS = {};
  let renderer, camera, K, rig, demo, demoT = 0;
  let last = performance.now(), time = 0;

  function qualityLevel() {
    const q = S.settings.quality;
    if (q !== 'auto') return q;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return coarse || Math.min(innerWidth, innerHeight) < 600 ? 'mid' : 'high';
  }

  function init() {
    S.loadSettings();
    const q = qualityLevel();
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = q !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('stage3d').appendChild(renderer.domElement);
    camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 80);

    K = PK.Kitchen.build(renderer, q);
    rig = new PK.Kitchen.CameraRig(camera);
    G.K = K; G.rig = rig; G.camera = camera; G.renderer = renderer;
    G.audio = PK.Audio;
    G.prep = new PK.Prep(K, G.audio);
    G.pan = new PK.PanController(K, G.audio);
    G.plating = new PK.Plating(K, G.pan, G.audio);
    G.knife = new PK.KnifeController(K, G.pan, G.audio);
    G.sauce = new PK.SauceController(K, G.pan, G.audio);

    const P = K.POS;
    PRESETS.title = { target: new THREE.Vector3(P.plate.x, 0.35, P.plate.z), dist: 6.2, theta: 0.55, phi: 1.02 };   // オムライスを中心にして回る
    PRESETS.prep = { target: new THREE.Vector3(P.bowl.x + 0.25, 0.45, P.bowl.z - 0.35), dist: 4.8, theta: 0.05, phi: 0.74 };
    PRESETS.cook = { target: new THREE.Vector3(P.stove.x + 0.05, 0.55, P.stove.z + 0.45), dist: 6.2, theta: 0.0, phi: 0.76 };
    PRESETS.cookStove = { target: new THREE.Vector3(P.stove.x + 0.45, 0.35, P.stove.z + 1.0), dist: 3.4, theta: 0.32, phi: 1.28 };
    // 盛り付けの2段目：横から見て、フライパンを傾けて卵が転がるのを見る
    PRESETS.plateSide = { target: new THREE.Vector3(P.plate.x, 0.8, P.plate.z + 0.6), dist: 5.0, theta: 1.35, phi: 1.12 };
    PRESETS.plate = { target: new THREE.Vector3(P.plate.x, 0.7, P.plate.z + 0.8), dist: 6.6, theta: 0.5, phi: 0.82 };   // 斜め前から：上へドラッグ＝ライスへ寄せる
    PRESETS.knife = { target: new THREE.Vector3(P.plate.x, 0.45, P.plate.z), dist: 4.3, theta: 0.0, phi: 0.6 };
    PRESETS.finishTop = { target: new THREE.Vector3(P.plate.x, 0.3, P.plate.z - 0.35), dist: 6.4, theta: 0.0, phi: 0.14 };
    PRESETS.finishPhone = { target: new THREE.Vector3(P.plate.x, 0.3, P.plate.z - 0.9), dist: 4.4, theta: 0.0, phi: 0.86 };
    PRESETS.finish = { target: new THREE.Vector3(P.plate.x, 0.3, P.plate.z - 0.6), dist: 7.2, theta: 0.0, phi: 0.78 };
    PRESETS.result = { target: new THREE.Vector3(P.plate.x, 0.45, P.plate.z), dist: 5.4, theta: 0.3, phi: 0.92 };
    PRESETS.photo = { target: new THREE.Vector3(P.plate.x, 0.3, P.plate.z), dist: 4.8, theta: 0.0, phi: 0.6 };

    // タイトル画面の見本（開いたオムライスがくり返しぱっかーん）
    demo = new PK.Omelette();
    demo.setSize(4 * PK.Egg.EGG_V, PK.Egg.EGG_V);
    demo.setLook({ fs: 0.62, br: 0.06, lf: 0.18, uniformity: 1 });   // 少し火が通った半熟
    K.scene.add(demo.group);
    demo.group.position.set(P.plate.x, K.surfaceY(P.plate.x, P.plate.z), P.plate.z);
    demo.surfaceWorld = K.coverY;
    demo.sag = 0.75;
    demo.dirty = true;
    G.demo = demo;
    G.demoOpen = () => openDemo();

    // 指定した色は sRGB なので、リニア空間へ一度だけ変換する（動的に色を変える材質は各自で変換済み）
    const fixColors = (root) => root.traverse((o) => {
      if (!o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (m.userData.lin) return;
        m.userData.lin = true;
        if (m.color) m.color.convertSRGBToLinear();
        if (m.emissive) m.emissive.convertSRGBToLinear();
      });
    });
    fixColors(K.scene);
    G.fixColors = fixColors;
    for (const k in G.sauce.protos) fixColors(G.sauce.protos[k].obj);

    UI.init(G);
    $('saveBtn').onclick = () => G.savePhoto();
    G.run = S.newRun(null);
    resetAll();
    applySettings(false);
    rig.setPreset(PRESETS.title, true);
    rig.autoRotate = true;
    S.stage = 'title';
    setScene('title');
    UI.showGame(false);
    bindInput();
    window.addEventListener('resize', () => { resize(); G.drawOverlay(); });
    resize();
    window.__pkStarted = true;
    requestAnimationFrame(loop);
  }

  function resetAll() {
    const run = G.run;
    G.knife.exit();
    G.knife.slit.visible = false;                 // 前回の切り口の線を残さない
    G.knife.slitGeo.setDrawRange(0, 0);
    G.knife.guide.visible = false;
    G.prep.reset(run);
    G.pan.reset(run);
    G.sauce.reset(run);
    G.sauce.recompute();
  }

  /** 評価に合わせた拍手と声（「すごーい！」「おしい！」「えー」「だめだめー」） */
  G.cheer = function (run) {
    const A = G.audio, sc = run.score || {}, r = sc.rank;
    const shells = (run.prep && run.prep.shells) > 0;
    let line, react = null, clap = false;
    if (run.raw) { line = 'えー！ なまたまごのまま！？'; react = 'ee'; }
    else if (shells) { line = 'ジャリッ…えー！ 殻入ってる！'; react = 'ee'; }
    else if (r === 'S') { line = 'すごーい！ お店のオムライスだ！'; clap = true; }
    else if (r === 'A') { line = 'おいしそう！'; react = 'oo'; clap = true; }
    else if (r === 'B') { line = 'いいね！'; clap = true; }
    else if (r === 'C') { line = 'おしい！'; react = 'aa'; }
    else if (r === 'D') { line = 'えー…'; react = 'ee'; }
    else { line = 'だめだめー！'; react = 'ee'; }
    if (clap) A.play('fanfare', r === 'B' ? 0.7 : 1);
    if (react) A.react(react, 0.75);
    setTimeout(() => A.say(line, r === 'D' || r === 'E' || react === 'ee' ? { pitch: 1.1, rate: 0.95 } : null), clap ? 700 : 350);
  };

  // ---------- 設定 ----------
  function applySettings(rebuild) {
    const st = S.settings;
    G.audio.setVolume(st.volume, st.sound);
    G.audio.clapKind = st.clap || 'hall'; G.audio.shutterKind = st.shutter || 'game'; G.audio.voiceOn = st.voice !== false;
    if (G.audio.ctx && G.audio.clapKind !== 'none') G.audio.prepare(G.audio.clapKind);
    const q = qualityLevel();
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(q === 'low' ? 1 : q === 'mid' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    if (rebuild) {
      const sh = q !== 'low';
      renderer.shadowMap.enabled = sh;
      K.sun.castShadow = sh;
      const size = q === 'high' ? 2048 : 1024;
      if (K.sun.shadow.map) { K.sun.shadow.map.dispose(); K.sun.shadow.map = null; }
      K.sun.shadow.mapSize.set(size, size);
      K.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)); });
    }
    S.saveSettings();
    resize();
  }
  G.applySettings = applySettings;

  // ---------- 画面サイズと、パネルに隠れない位置への視点ずらし ----------
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    const panelOn = S.stage !== 'title' && !G.photo;
    // CSS と同じ条件：スマホとタブレット縦向きはパネルが下のシート
    const sheet = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1180px)').matches;
    const pw = (S.stage === 'result' ? 396 : (w <= 1180 ? 300 : 340) + 16);
    if (!panelOn) camera.clearViewOffset();
    else if (sheet) {
      // スマホ：視点の中心は画面の真ん中（物理的な中心）に合わせる。結果画面だけは下のカードに隠れないよう、少し上にずらす
      if (S.stage === 'result') camera.setViewOffset(w, h, 0, h * (h > 900 ? 0.17 : 0.2), w, h);
      else camera.clearViewOffset();
    }
    else camera.setViewOffset(w, h, Math.min(w * 0.18, pw / 2), 0, w, h);
    camera.updateProjectionMatrix();
  }

  // ---------- 工程 ----------
  G.go = function (stage) {
    if (stage === 'knife' && G.run && G.run.flat) {
      stage = 'finish'; G.run.cut = null;
      UI.toast && UI.toast({ fried: '目玉焼きは切らずに仕上げへ', sheet: '包むオムライスは、ぱっかーんなしで仕上げへ', raw: '…このまま仕上げへ' }[G.run.flat], 'info');
    }
    const prev = S.stage;
    S.stage = stage;
    const run = G.run;
    rig.autoRotate = false;
    if (stage === 'prep') { demo.group.visible = false; G.pan.setHeat(0); }
    if (stage === 'cook') {
      G.prep.pointerUp();
      const pr = run.prep;
      pr.eggs = G.prep.eggs;          // ボウルの卵は全部使う
      pr.inBowl = G.prep.eggs;
      G.cookView = 'pan';
      G.pan.spatRest();
    }
    if (stage === 'plate') {
      G.pan.spatRest();
      G.plating.onPhase = (ph) => {
        if (ph === 'pour') {
          const p = PRESETS.plateSide;
          p.target.set(G.plating.panX, 0.85, (G.plating.panZ + K.POS.plate.z) / 2 - 0.2);
          rig.setPreset(p);
        } else rig.setPreset(PRESETS.plate);
        UI.syncPlate && UI.syncPlate();
      };
      G.plating.enter(run);
    }
    if (stage === 'knife') { G.knife.enter(run); }
    if (stage === 'finish') { G.knife.exit(); G.sauce.putAway(); }
    if (stage === 'result') {
      G.sauce.putAway();
      try { run.riceVisible = G.sauce.riceExposure(); } catch (e) { run.riceVisible = 0; }
      run.score = PK.Scoring.score(run);
      UI.showResult(run.score);
      G.cheer(run);
      rig.autoRotate = true;
    }
    UI.stage(stage);
    setScene(stage);
    // スマホ（縦長）では仕上げを少し近くから始める（容器の名前が読めるように）
    const sheetLay = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1180px)').matches;
    const pre = (sheetLay && PRESETS[stage + 'Phone']) || PRESETS[stage];
    if (pre) rig.setPreset(pre, prev === 'title' && stage !== 'prep');
    if (stage !== 'result') G.photoMode(false, true);
    resize();
  };

  /** 工程ごとに見せる物・隠す物（離れた作業エリアと、撮影用のレストランのテーブル） */
  function setScene(stage) {
    if (stage !== 'cook' && G.audio) { G.audio.sizzle(0); if (G.audio.flame) G.audio.flame(0); }
    const P = K.POS;
    const dining = stage === 'result';
    K.setDining(dining || stage === 'title', stage === 'title');   // タイトルは、壁のないテーブルとオムライスだけ
    K.plateGroup.visible = stage === 'title' || stage === 'plate' || stage === 'knife' || stage === 'finish' || stage === 'result';
    demo.group.visible = stage === 'title';
    G.sauce.pantry.visible = stage === 'finish';
    K.spoon.visible = stage === 'finish' || stage === 'result';
    if (stage === 'result') K.spoon.position.set(P.plate.x + 2.2, 0.024, P.plate.z + 0.5);
    else K.spoon.position.set(P.plate.x + 1.0, 0.012, P.plate.z + 1.95);
    K.spoon.rotation.y = stage === 'result' ? Math.PI / 2 + 0.1 : 0.2;
    const tidy = dining || stage === 'title';   // タイトルと撮影では調理道具を片づける
    [K.stoveGroup, G.prep.group, G.prep.butterDish].forEach((o) => (o.visible = !tidy));
    G.pan.root.visible = !tidy;
    G.pan.spatula.visible = !tidy;
    const f = stage === 'prep' ? P.bowl : stage === 'cook' ? P.stove : P.plate;
    K.focus(f.x, f.z);
  }
  G.setScene = setScene;

  /** 卵液を流す：ボウルをコンロまで運んで傾け、全部注ぐ */
  G.pourEgg = function () {
    if (G.pan.poured || G.prep.eggs <= 0) return false;
    if (!G.pan.pour()) return false;
    const r = G.pan.root.position;
    G.prep.startPour(new THREE.Vector3(r.x, r.y + 0.75, r.z));
    return true;
  };

  // 仕上げ：斜め前から ⇔ 真上から
  G.finishView = 'front';
  G.toggleView = function () {
    if (S.stage === 'finish') {
      G.finishView = G.finishView === 'top' ? 'front' : 'top';
      const ph = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1180px)').matches;
      rig.setPreset(G.finishView === 'top' ? PRESETS.finishTop : ph ? PRESETS.finishPhone : PRESETS.finish);
      UI.syncViewBtn();
    } else G.toggleCookView();
  };
  G.cookView = 'pan';
  G.toggleCookView = function () {
    G.cookView = G.cookView === 'stove' ? 'pan' : 'stove';
    rig.setPreset(G.cookView === 'stove' ? PRESETS.cookStove : PRESETS.cook);
    UI.syncViewBtn();
  };

  // ---------- 写真 ----------
  G.photo = false;
  G.photoMode = function (on, silent) {
    if (!on && !G.photo) return;
    G.photo = on;
    $('photo').hidden = !on;
    $('result').hidden = on || S.stage !== 'result';
    $('hud').hidden = on || S.stage === 'title';
    $('hint').hidden = true;
    if (on) {
      rig.autoRotate = false;
      rig.limits.pmin = 0.28; rig.limits.pmax = 1.0;
      rig.setPreset(PRESETS.photo);
      document.fonts && document.fonts.load('40px "Dela Gothic One"').then(G.drawOverlay, G.drawOverlay);
      G.drawOverlay();
    } else {
      rig.limits.pmin = 0.12; rig.limits.pmax = 1.45;
      if (!silent && S.stage === 'result') { rig.setPreset(PRESETS.result); rig.autoRotate = true; }
    }
    resize();
  };

  function fitFont(ctx, text, family, size, maxW) {
    let s = size;
    ctx.font = `${s}px ${family}`;
    while (s > 12 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${s}px ${family}`; }
    return s;
  }

  /** サムネイル風：左上に、少し弧を描いて斜めに並ぶ文字 */
  function arcText(ctx, text, cx, cy, R, fs, passes) {
    ctx.font = `${fs}px "Dela Gothic One", "Hiragino Kaku Gothic StdN", sans-serif`;
    const ws = [...text].map((c) => ctx.measureText(c).width * 0.98);
    const total = ws.reduce((a, b) => a + b, 0);
    const span = total / R;
    for (const pass of passes) {
      let acc = 0;
      [...text].forEach((ch, i) => {
        const a = -Math.PI / 2 - span / 2 + (acc + ws[i] / 2) / R;
        acc += ws[i];
        ctx.save();
        ctx.translate(cx + R * Math.cos(a), cy + R * Math.sin(a));
        ctx.rotate(a + Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        if (pass.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = fs * pass.w; ctx.strokeStyle = pass.stroke; ctx.strokeText(ch, 0, 0); }
        if (pass.fill) { ctx.fillStyle = pass.fill; ctx.fillText(ch, pass.dx ? fs * pass.dx : 0, pass.dy ? fs * pass.dy : 0); }
        ctx.restore();
      });
    }
    return total;
  }
  /** 大きさや色の違う文字を、1本の弧に続けて並べる。segs: [{ text, fs, passes }] */
  function arcRun(ctx, segs, x0, cy, R) {
    const fam = '"Dela Gothic One", "Hiragino Kaku Gothic StdN", sans-serif';
    const chars = [];
    for (const sg of segs) {
      ctx.font = `${sg.fs}px ${fam}`;
      for (const ch of sg.text) chars.push({ ch, sg, w: ctx.measureText(ch).width * 0.98 });
    }
    const total = chars.reduce((a, c) => a + c.w, 0);
    const cx = x0 + total / 2;          // 行の左端を x0 にそろえる
    const span = total / R;
    const maxPass = Math.max(...segs.map((sg) => sg.passes.length));
    for (let pi = 0; pi < maxPass; pi++) {
      let acc = 0;
      for (const c of chars) {
        const a = -Math.PI / 2 - span / 2 + (acc + c.w / 2) / R;
        acc += c.w;
        const pass = c.sg.passes[pi];
        if (!pass) continue;
        ctx.save();
        ctx.font = `${c.sg.fs}px ${fam}`;
        ctx.translate(cx + R * Math.cos(a), cy + R * Math.sin(a));
        ctx.rotate(a + Math.PI / 2);
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const fs = c.sg.fs;
        if (pass.stroke) { ctx.lineJoin = 'round'; ctx.lineWidth = fs * pass.w; ctx.strokeStyle = pass.stroke; ctx.strokeText(c.ch, 0, 0); }
        if (pass.fill) { ctx.fillStyle = pass.fill; ctx.fillText(c.ch, 0, 0); }
        ctx.restore();
      }
    }
    return total;
  }
  G.drawTitle = function (ctx, W, H, topY) {
    const author = $('phAuthor').value.trim(), title = $('phTitle').value.trim();
    // 書いた文字（名前・題名）は大きく色付きで目立たせ、「作！」「オムライス！」は小さく白で控えめに
    const HL = [{ stroke: 'rgba(0,0,0,0.45)', w: 0.42 }, { stroke: '#1a0d06', w: 0.3 }, { stroke: '#e0331f', w: 0.16 }, { fill: '#ffd23a' }];
    const SUB = [{ stroke: 'rgba(0,0,0,0.4)', w: 0.34 }, { stroke: '#1a0d06', w: 0.24 }, { stroke: '#e07a1f', w: 0.1 }, { fill: '#fff1a8' }];   // 小さめの黄色
    const base = Math.min(W, H * 1.5);
    const fam = '"Dela Gothic One", sans-serif';
    const widthOf = (t, f) => { ctx.font = `${f}px ${fam}`; return [...t].reduce((a, c) => a + ctx.measureText(c).width, 0); };
    let fs = Math.round(base * 0.09);
    const big = title || 'オムライス！';
    while (fs > 14 && widthOf(big, fs) > W * 0.5) fs -= 2;
    const fsA = Math.round(fs * 0.6), fsSub = Math.round(fs * 0.5);
    ctx.save();
    ctx.translate(W * 0.045, topY != null ? topY : H * 0.05);
    ctx.rotate(-0.12);                      // 左上に斜め
    const R = W * 0.9;
    let y = fsA * 1.1;
    if (author) {
      arcRun(ctx, [{ text: author, fs: fsA, passes: HL }, { text: '作！', fs: Math.round(fsA * 0.72), passes: SUB }], 0, y + R, R);
      y += fs * 1.08;
    } else y = fs * 0.95;
    if (title) {
      arcRun(ctx, [{ text: title, fs, passes: HL }], 0, y + R, R);
      y += fsSub * 1.05 + fs * 0.32;   // 題名の下にすき間をあけて重ならないように
      arcRun(ctx, [{ text: 'オムライス！', fs: fsSub, passes: SUB }], fs * 1.6, y + R, R);
    } else {
      arcRun(ctx, [{ text: 'オムライス！', fs, passes: HL }], 0, y + R, R);
    }
    ctx.restore();
  };
  // 表示の大きさが変わったら（キーボードが閉じたときなど）文字を描き直す
  (function () {
    const redraw = () => { if (G.drawOverlay) G.drawOverlay(); };
    const later = () => { redraw(); setTimeout(redraw, 150); setTimeout(redraw, 500); };
    try { new ResizeObserver(redraw).observe($('photoCanvas')); } catch (e) { /* 古いブラウザ */ }
    if (window.visualViewport) window.visualViewport.addEventListener('resize', later);
    document.addEventListener('focusout', later);
  })();
  G.drawOverlay = function () {
    const cv = $('photoCanvas');
    if (!cv || !G.photo) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 実際に表示されている大きさで描く（キーボードの出し入れで縦横が引きのばされないように）
    const cw = cv.clientWidth || innerWidth, ch = cv.clientHeight || innerHeight;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    // 縦長の画面では、文字をお皿のすぐ上に添える（撮った写真と同じ位置）
    let top = null;
    if (cv.height > cv.width * 1.1) {
      const H = Math.round(cv.width * 1.25);
      const v = K.POS.plate.clone().setY(0.3).project(camera);
      const py = (1 - v.y) / 2 * cv.height;
      const y0 = U.clamp(py - H * 0.55, 0, cv.height - H);
      top = y0 + H * 0.05;
    }
    G.drawTitle(ctx, cv.width, cv.height, top);
  };

  /** 写真の縦横：端末の画面全体（キーボードで縮む前）の形。横向きは 4:3〜16:9 におさめる */
  function photoSize() {
    // パソコン（キーボードで画面が縮まない）は、見えている画面そのままの形
    if (!window.matchMedia('(pointer: coarse)').matches) return { w: innerWidth, h: innerHeight };
    // 縦長に見えているなら端末は縦向き（キーボードは高さしか縮めない）
    if (innerHeight > innerWidth) return { w: Math.min(screen.width, screen.height) || innerWidth, h: Math.max(screen.width, screen.height) || innerHeight };
    const sw = screen.width || innerWidth, sh = screen.height || innerHeight;
    const long = Math.max(sw, sh), short = Math.min(sw, sh);
    let land;
    const ot = screen.orientation && screen.orientation.type;
    if (ot) land = ot.indexOf('landscape') === 0;
    else if (typeof window.orientation === 'number') land = Math.abs(window.orientation) === 90;
    else land = sw >= sh;
    if (land) {
      const r = U.clamp(long / short, 4 / 3, 16 / 9);
      return { w: Math.round(short * r), h: short };
    }
    return { w: short, h: long };
  }

  G.takePhoto = async function () {
    const btn = $('shutterBtn');
    btn.disabled = true;
    G.audio.init(); G.audio.play('shutter');
    // 画面を一瞬白く光らせる（フラッシュ）
    const fl = document.createElement('div');
    fl.className = 'flash'; document.body.appendChild(fl);
    setTimeout(() => fl.remove(), 450);
    try {
      try { await document.fonts.load('40px "Dela Gothic One"'); } catch (e) { /* 代わりの書体で描く */ }
      // 入力中ならキーボードを閉じる
      const ae = document.activeElement;
      if (ae && ae.blur && /INPUT|TEXTAREA/.test(ae.tagName)) ae.blur();
      // 写真の大きさは「今見えている範囲」ではなく、端末の画面全体の形で決める。
      // （iPad 横向きでキーボードが出て画面が半分になっていても、横長に潰れた写真にならない）
      const dim = photoSize();
      const prevPR = renderer.getPixelRatio();
      const pr = Math.min(2.5, Math.max(2, window.devicePixelRatio || 1), 4096 / Math.max(dim.w, dim.h));
      renderer.setPixelRatio(pr);
      renderer.setSize(dim.w, dim.h, false);   // 画面の表示（CSS）はそのまま、描く大きさだけ変える
      camera.aspect = dim.w / dim.h;
      camera.clearViewOffset();
      camera.updateProjectionMatrix();
      rig.update(0);
      renderer.render(K.scene, camera);
      const src = renderer.domElement;
      const W = src.width, H0 = src.height;
      // 縦長の画面（スマホ）では、お皿のまわりだけを切り抜いて余白をなくす
      let H = H0, y0 = 0;
      if (H0 > W * 1.1) {
        H = Math.round(W * 1.25);
        const v = K.POS.plate.clone().setY(0.3).project(camera);
        const py = (1 - v.y) / 2 * H0;
        y0 = Math.round(U.clamp(py - H * 0.55, 0, H0 - H));
      }
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d');
      ctx.drawImage(src, 0, y0, W, H, 0, 0, W, H);
      renderer.setPixelRatio(prevPR);
      resize();
      G.drawTitle(ctx, W, H);
      const fam = '"Dela Gothic One", "Hiragino Kaku Gothic StdN", sans-serif';
      const big = Math.min(W, H * 1.4);
      // 下にスコア
      const sc = G.run.score;
      if (sc) {
        const fs3 = Math.round(big * 0.026);
        ctx.font = `${fs3}px ${fam}`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        const line = `PAKKAAAN!  ${sc.rank}ランク ${sc.total}点  ${sc.kcal.total}kcal`;
        const pad = fs3 * 0.6, tw = ctx.measureText(line).width;
        ctx.fillStyle = 'rgba(26,19,15,0.7)';
        ctx.fillRect(W * 0.03 - pad, H * 0.97 - fs3 - pad, tw + pad * 2, fs3 + pad * 2);
        ctx.fillStyle = '#fff7ea';
        ctx.fillText(line, W * 0.03, H * 0.97);
      }
      const blob = await new Promise((res) => out.toBlob(res, 'image/png'));
      if (G.photoURL) URL.revokeObjectURL(G.photoURL);
      G.photoBlob = blob;
      G.photoURL = URL.createObjectURL(blob);
      $('photoImg').src = G.photoURL;
      UI.modal('photoView', true);
    } catch (err) {
      console.error(err);
      UI.toast('撮影できませんでした：' + err.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  };

  // ---------- Xでシェア ----------
  /** ゲームの公開URL（GitHub Pages）。ほかの場所で開いていても、遊べる場所をのせる */
  G.gameURL = function () {
    const m = document.querySelector('meta[property="og:url"]');
    return (m && m.content) || location.href.split('#')[0];
  };
  /** 投稿文。名前・題名は写真の入力欄から、点数は結果から */
  G.shareText = function () {
    const sc = G.run && G.run.score;
    const author = ($('phAuthor').value || '').trim(), title = ($('phTitle').value || '').trim();
    const lines = [];
    lines.push((author ? author + '作！' : '') + (title ? title + 'オムライス！' : 'オムライスを作った！') + '🍳');
    if (sc) {
      lines.push(`${sc.rank}ランク ${sc.total}点「${sc.title}」`);
      const q = (sc.quips || [])[0];
      if (q) lines.push(q.length > 40 ? q.slice(0, 39) + '…' : q);
    }
    lines.push('ぱっかーんできるかな？');
    return lines.join('\n');
  };
  G.shareURL = function () {
    const e = encodeURIComponent;
    return 'https://x.com/intent/post?text=' + e(G.shareText()) + '&url=' + e(G.gameURL()) + '&hashtags=' + e('PAKKAAAN,オムライス');
  };

  G.savePhoto = async function () {
    if (!G.photoBlob) return;
    const title = $('phTitle').value.trim();
    const name = `${title ? title + '_' : ''}オムライス.png`.replace(/[\\/:*?"<>|]/g, '');
    let dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) {
      try {
        await dl.save({ filename: name, data: G.photoBlob });
        UI.toast('画像を保存した', 'good');
      } catch (e) {
        if (e && e.code === 'declined') UI.toast('保存をやめた', 'info');
        else { UI.toast('ここでは保存できない。画像を長押し（右クリック）して保存してね', 'warn'); }
      }
      return;
    }
    // 通常のブラウザ（GitHub Pages など）
    const a = document.createElement('a');
    a.href = G.photoURL; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    UI.toast('画像を保存した（できないときは長押し・右クリックで保存）', 'good');
  };

  G.start = function () {
    G.audio.init();
    UI.showGame(true);
    $('result').hidden = true;
    G.go('prep');
  };
  G.restart = function (keep) {
    const prev = keep ? G.run.prep : null;
    G.run = S.newRun(prev);
    resetAll();
    $('result').hidden = true;
    G.camMode = false; $('camBtn').setAttribute('aria-pressed', 'false');
    G.go('prep');
  };
  G.toTitle = function () {
    G.run = S.newRun(G.run.prep);
    resetAll();
    S.stage = 'title';
    UI.showGame(false);
    $('result').hidden = true;
    setScene('title');
    demoT = 0;
    rig.setPreset(PRESETS.title);
    rig.autoRotate = true;
    G.audio.sizzle(0);
    if (G.audio.flame) G.audio.flame(0);
    resize();
  };

  // ---------- 入力 ----------
  function bindInput() {
    const cv = renderer.domElement;
    const ptrs = new Map();
    let gesture = null, pinch0 = 0, mid0 = null;
    const ndcOf = (x, y) => {
      const r = cv.getBoundingClientRect();
      return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    };
    const sens = () => S.settings.sensitivity;
    const stage = () => S.stage;

    function stageDown(ndc) {
      switch (stage()) {
        case 'prep': return G.prep.pointerDown(ndc, camera);
        case 'cook': {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(ndc, camera);
          if (ray.intersectObject(K.knobHit, false).length) {
            const v = K.knob.getWorldPosition(new THREE.Vector3()).project(camera);
            const r = renderer.domElement.getBoundingClientRect();
            const cx = r.left + ((v.x + 1) / 2) * r.width, cy = r.top + ((1 - v.y) / 2) * r.height;
            const sx = r.left + ((ndc.x + 1) / 2) * r.width, sy = r.top + ((1 - ndc.y) / 2) * r.height;
            G.pan.knobStart(sx, sy, cx, cy);
            G.cookDrag = 'knob';
            return true;
          }
          // へら：置いてある→タップで少し浮く→もう一度タップで使う
          const sp = G.pan.spat;
          if (G.pan.spatHit(ray.ray) && sp.state !== 'active') { G.pan.spatTap(); G.cookDrag = 'none'; return true; }
          if (sp.state === 'active' && !G.pan.inPan(ray.ray) && G.pan.restHit(ray.ray)) { G.pan.spatRest(); G.audio.play('click', 0.6); G.cookDrag = 'none'; return true; }
          if (sp.state === 'active' && (G.pan.inPan(ray.ray) || G.pan.spatHit(ray.ray))) { G.cookDrag = 'spat'; G.pan.spatDragTo(ray.ray); return true; }
          // バター皿のバターをつかんでフライパンへ運ぶ
          if (!G.pan.butterIn && G.run.prep.butter > 0 && G.prep.butterBlock.visible) {
            const bb = new THREE.Box3().setFromObject(G.prep.butterBlock).expandByScalar(0.18);
            if (ray.ray.intersectsBox(bb)) { G.cookDrag = 'butterCarry'; carryButter(ray.ray); return true; }
          }
          if (G.pan.butterHit(ray.ray)) { G.cookDrag = 'butter'; G.pan.butterDragTo(ray.ray); return true; }
          if (G.pan.handleHit(ray.ray) && G.pan.handleStart(ray.ray)) { G.cookDrag = 'handle'; return true; }
          G.cookDrag = 'pan';
          G.pan.dragStart();
          return true;
        }
        case 'plate': return G.plating.dragStart(ndc, camera);
        case 'knife': return G.knife.down(ndc, camera);
        case 'finish': return G.sauce.pointerDown(ndc, camera);
      }
      return false;
    }
    function stageMove(ndc, dx, dy, dt) {
      switch (stage()) {
        case 'prep': G.prep.pointerMove(ndc, camera, dt); break;
        case 'cook': {
          if (G.cookDrag === 'knob') {
            const r = renderer.domElement.getBoundingClientRect();
            G.pan.knobMove(r.left + ((ndc.x + 1) / 2) * r.width, r.top + ((1 - ndc.y) / 2) * r.height);
          } else if (G.cookDrag === 'butter' || G.cookDrag === 'spat' || G.cookDrag === 'butterCarry' || G.cookDrag === 'handle') {
            const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
            if (G.cookDrag === 'handle') G.pan.handleDragTo(ray.ray);
            else if (G.cookDrag === 'butter') G.pan.butterDragTo(ray.ray);
            else if (G.cookDrag === 'spat') G.pan.spatDragTo(ray.ray);
            else carryButter(ray.ray);
          } else if (G.cookDrag === 'pan') G.pan.dragMove(dx, dy, sens());
          break;
        }
        case 'plate': G.plating.dragMove(dx, dy, ndc, camera, sens()); break;
        case 'knife': G.knife.move(ndc, camera); break;
        case 'finish': G.sauce.pointerMove(ndc, camera); break;
      }
    }
    function stageUp(p) {
      switch (stage()) {
        case 'prep': G.prep.pointerUp(); break;
        case 'cook':
          if (G.cookDrag === 'knob') G.pan.knobEnd();
          else if (G.cookDrag === 'handle') G.pan.handleEnd();
          else if (G.cookDrag === 'butter') G.pan.bDrag = null;
          else if (G.cookDrag === 'spat') G.pan.spat.dragging = false;
          else if (G.cookDrag === 'butterCarry') dropButter();
          else if (G.cookDrag === 'pan') G.pan.dragEnd(p.vx, p.vy);
          G.cookDrag = null;
          break;
        case 'plate': G.plating.dragEnd(); break;
        case 'knife': {
          const r = G.knife.up();
          if (!r) break;
          if (r.retry) { UI.toast(r.text, 'warn'); break; }
          UI.showCut(r);
          if (r.grade === 'great') UI.big('ぱっかーーん！');
          else if (r.grade === 'through') UI.big('どぱっかーーん！');
          else if (r.grade === 'good') UI.big('ぱっかーん！');
          else if (r.grade === 'close') UI.big('ぱかっ…', true);
          else UI.big('……', true);
          break;
        }
        case 'finish': G.sauce.pointerUp(); break;
      }
    }

    // バターを持ち上げて運ぶ
    function carryButter(ray) {
      const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
      const p = new THREE.Vector3();
      if (!ray.intersectPlane(pl, p)) return;
      G.prep.butterDish.worldToLocal(p);
      G.prep.butterBlock.position.copy(p);
      G.carryAt = G.prep.butterDish.localToWorld(p.clone());
    }
    function dropButter() {
      const w = G.carryAt;
      G.prep.setButter(G.run.prep.butter);   // 皿の上の位置に戻す
      if (!w) return;
      const r = G.pan.root.position;
      if (Math.hypot(w.x - r.x, w.z - r.z) < 1.15) {
        const l = G.pan.tilt.worldToLocal(new THREE.Vector3(w.x, r.y, w.z));
        if (G.pan.addButter(l.x, l.z)) {
          G.prep.butterBlock.visible = false;
          UI.toast(`バター ${G.pan.butterG}g を入れた。ドラッグするか傾けて広げよう`);
        }
      } else UI.toast('フライパンの上で離すとバターが入る', 'info');
      G.carryAt = null;
    }

    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      G.audio.init();
      cv.setPointerCapture(e.pointerId);
      const now = performance.now();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now, vx: 0, vy: 0 });
      if (ptrs.size === 2) {
        // 2本指：ピンチでズーム、移動で回転
        if (gesture === 'stage') stageUp({ vx: 0, vy: 0 });
        gesture = 'pinch';
        const [a, b] = [...ptrs.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
        mid0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return;
      }
      if (ptrs.size > 2) return;
      const ndc = ndcOf(e.clientX, e.clientY);
      const s = stage();
      if (e.button === 2 || e.button === 1 || G.camMode || s === 'title' || s === 'result') { gesture = 'camera'; return; }
      gesture = stageDown(ndc) ? 'stage' : 'camera';
    });
    cv.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      const ndc = ndcOf(e.clientX, e.clientY);
      if (!p) {
        // マウスのホバー（ナイフを追従させる）
        if (stage() === 'knife' && e.pointerType === 'mouse') G.knife.hover(ndc, camera);
        if (stage() === 'finish' && e.pointerType === 'mouse') G.sauce.hover(ndc, camera);
        return;
      }
      const now = performance.now();
      const dt = Math.max(1, now - p.t) / 1000;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.vx = U.lerp(p.vx, dx / dt, 0.5); p.vy = U.lerp(p.vy, dy / dt, 0.5);
      p.x = e.clientX; p.y = e.clientY; p.t = now;
      if (gesture === 'pinch' && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0 > 0) rig.zoom(pinch0 / d);
        pinch0 = d;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        rig.rotate(m.x - mid0.x, m.y - mid0.y);
        mid0 = m;
      } else if (gesture === 'camera') {
        rig.rotate(dx, dy);
      } else if (gesture === 'stage') {
        stageMove(ndc, dx, dy, dt);
      }
    });
    const up = (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      // 離す直前に止めていたら速度はゼロ扱い
      if (performance.now() - p.t > 80) { p.vx = 0; p.vy = 0; }
      if (gesture === 'stage') stageUp(p);
      ptrs.delete(e.pointerId);
      if (ptrs.size === 0) gesture = null;
      else if (gesture === 'pinch' && ptrs.size === 1) gesture = 'none';
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

    const keyMap = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', q: 'rotL', Q: 'rotL', e: 'rotR', E: 'rotR' };
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && a.type !== 'range' && a.type !== 'checkbox'; };
    window.addEventListener('keydown', (e) => {
      if (typing()) return;
      const st = stage();
      if (st === 'title' || st === 'result') return;
      if (document.activeElement && document.activeElement.type === 'range' && e.key.startsWith('Arrow')) return;
      const k = keyMap[e.key];
      const target = st === 'plate' ? G.plating.keys : G.pan.keys;
      if (k) { target[k] = true; e.preventDefault(); }
      if (st === 'cook') {
        G.audio.init();
        if (e.key === ' ') { e.preventDefault(); if (!e.repeat) G.pan.knock(); }
        if ((e.key === 'f' || e.key === 'F') && !e.repeat) G.pan.shake(0, -1, 1.0);
        if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
          if (G.pan.spat.state === 'active') G.pan.spatRest();
          else { G.pan.spatTap(); G.pan.spatTap(); }
        }
        if ((e.key === 'v' || e.key === 'V') && !e.repeat) G.toggleView();
        const hk = { 0: 0, 1: 2.5, 2: 5, 3: 7.5, 4: 10 }[e.key];
        if (hk !== undefined) G.pan.setHeat(hk);
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = keyMap[e.key];
      if (k) { G.pan.keys[k] = false; G.plating.keys[k] = false; }
    });
    window.addEventListener('blur', () => { G.pan.keys = {}; G.plating.keys = {}; });
  }

  // ---------- ループ ----------
  function openDemo() {
    const NU = PK.Omelette.NU;
    const o = new Float32Array(NU + 1);
    for (let i = 0; i <= NU; i++) { const u = -1 + (2 * i) / NU; o[i] = 1; void u; }
    demo.startOpen({ openL: o, openR: o, tear: 0, reach: 1.05, runnyAmount: 0.35, runnySpread: 0.6, runnyFlow: 0.05, duration: 1.35 });
  }
  function updateDemo(dt) {
    if (!demo.group.visible) return;
    demoT += dt;
    if (demoT > 9) { demoT = 0; demo.resetOpen(); }
    if (demoT > 2.2 && demo.animT < 0) openDemo();
    demo.update(dt);
  }

  function loop(now) {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    try {
      const st = S.stage;
      K.updateFlames(G.pan.mode === 'stove' ? G.pan.heat : 0, time);
      if (st === 'prep') G.prep.update(dt, time); else G.prep.updateChicks(dt, time);   // ひよこは、別の工程に進んでも走り続ける
      if (G.prep.pourAnim) {
        const sh = G.pan.sheet;
        G.prep.updatePour(dt, sh.pourTotal > 0 ? sh.pourLeft / sh.pourTotal : 0);
      }
      G.pan.update(dt, time);
      if (st === 'plate') G.plating.update(dt);
      if (st === 'knife' || st === 'finish') G.knife.update(dt);
      if (st === 'finish' || st === 'result') G.sauce.update(dt);
      updateDemo(dt);
      rig.update(dt);
      if (st !== 'title') UI.tick(dt); else UI.syncFab();
      if (st !== 'title') UI.layoutTop();
      // 皿に卵を落とす場所の目印は、盛り付けの工程のあいだだけ。トッピングなど、ほかの工程では必ず消す
      if (st !== 'plate' && G.plating) { if (G.plating.mark) G.plating.mark.visible = false; if (G.plating.rawStream) G.plating.rawStream.visible = false; }
      renderer.render(K.scene, camera);
    } catch (err) {
      console.error(err);
      if (!G.errShown) { G.errShown = true; fail('実行中にエラーが発生しました：' + err.message); }
    }
  }

  try {
    init();
  } catch (err) {
    console.error(err);
    fail('初期化に失敗しました：' + err.message);
  }
})();
