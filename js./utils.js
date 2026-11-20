/* PAKKAAAN! — 共通ユーティリティ（数学・ノイズ・手続き生成テクスチャ・環境マップ） */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});

  const U = {};
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.smooth = (e0, e1, x) => {
    const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  U.easeOutBack = (t) => {
    const c1 = 1.4, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  /** 範囲内なら1、外れるほど0に近づく評価関数 */
  U.band = (x, lo, hi, falloff) => {
    if (x >= lo && x <= hi) return 1;
    const d = x < lo ? lo - x : x - hi;
    return Math.max(0, 1 - d / falloff);
  };
  U.mix3 = (a, b, t) => [U.lerp(a[0], b[0], t), U.lerp(a[1], b[1], t), U.lerp(a[2], b[2], t)];

  // 決定的な乱数
  U.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  // 値ノイズ
  const perm = new Uint8Array(512);
  (function () {
    const r = U.rng(1337);
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  function hash(x, y) { return perm[(perm[x & 255] + y) & 255] / 255; }
  U.noise2 = function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v);
  };
  U.fbm = function (x, y, oct) {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < (oct || 4); i++) { s += a * U.noise2(x * f, y * f); f *= 2; a *= 0.5; }
    return s;
  };

  /** キャンバスに描いてテクスチャ化 */
  U.canvasTex = function (w, h, draw, opts) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(cv);
    opts = opts || {};
    if (opts.repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(opts.repeat[0], opts.repeat[1]); }
    if (opts.color !== false) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    return tex;
  };

  /** グレースケールのノイズ（バンプ・粗さ用） */
  U.noiseTex = function (size, scale, oct, contrast) {
    return U.canvasTex(size, size, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        // タイル可能にするため周期的にサンプル
        const nx = x / w, ny = y / h;
        const a = U.fbm(nx * scale, ny * scale, oct);
        const b = U.fbm((nx - 1) * scale, ny * scale, oct);
        const c = U.fbm(nx * scale, (ny - 1) * scale, oct);
        const d = U.fbm((nx - 1) * scale, (ny - 1) * scale, oct);
        let v = U.lerp(U.lerp(a, b, nx), U.lerp(c, d, nx), ny);
        v = U.clamp(0.5 + (v - 0.5) * (contrast || 1.6), 0, 1);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { repeat: [1, 1], color: false });
  };

  U.woodTex = function () {
    return U.canvasTex(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#9a6a42';
      ctx.fillRect(0, 0, w, h);
      const r = U.rng(7);
      // 板の継ぎ目と木目
      const boards = 5;
      for (let b = 0; b < boards; b++) {
        const y0 = (b * h) / boards, bh = h / boards;
        const tone = 0.85 + r() * 0.3;
        ctx.fillStyle = `rgba(${Math.floor(150 * tone)},${Math.floor(102 * tone)},${Math.floor(62 * tone)},1)`;
        ctx.fillRect(0, y0, w, bh);
        for (let i = 0; i < 70; i++) {
          const yy = y0 + r() * bh;
          ctx.strokeStyle = `rgba(70,40,20,${0.05 + r() * 0.12})`;
          ctx.lineWidth = 0.6 + r() * 2;
          ctx.beginPath();
          ctx.moveTo(0, yy);
          for (let x = 0; x <= w; x += 32) ctx.lineTo(x, yy + Math.sin(x * 0.01 + i) * 3 + (U.noise2(x * 0.01, i) - 0.5) * 8);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(40,22,10,0.55)';
        ctx.fillRect(0, y0, w, 2);
      }
    }, { repeat: [2, 1] });
  };

  U.tileTex = function () {
    return U.canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#b9b2a6';
      ctx.fillRect(0, 0, w, h);
      const n = 4, s = w / n, r = U.rng(3);
      for (let y = 0; y < n; y++) for (let x = 0; x < n * 2; x++) {
        const off = 0;
        const tx = (x * s) / 2 + off, ty = y * s;
        const v = 232 + r() * 14;
        ctx.fillStyle = `rgb(${v - 6},${v - 2},${v})`;
        ctx.fillRect(tx + 3, ty + 3, s / 2 - 6, s - 6);
        const g = ctx.createLinearGradient(tx, ty, tx, ty + s);
        g.addColorStop(0, 'rgba(255,255,255,0.25)');
        g.addColorStop(1, 'rgba(0,0,0,0.05)');
        ctx.fillStyle = g;
        ctx.fillRect(tx + 3, ty + 3, s / 2 - 6, s - 6);
      }
    }, { repeat: [6, 3] });
  };

  U.brushedTex = function () {
    return U.canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, w, h);
      const r = U.rng(11);
      // 同心円状のヘアライン
      for (let i = 0; i < 900; i++) {
        const rad = r() * w * 0.72;
        const a0 = r() * Math.PI * 2;
        ctx.strokeStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},0.05)`;
        ctx.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, rad, a0, a0 + 0.3 + r() * 1.2);
        ctx.stroke();
      }
    }, { color: false });
  };

  /** キッチンの照明を模した環境マップ（PMREM） */
  U.buildEnvMap = function (renderer) {
    const env = new THREE.Scene();
    const room = new THREE.Mesh(
      new THREE.BoxGeometry(20, 10, 20),
      new THREE.MeshBasicMaterial({ color: 0x3a3029, side: THREE.BackSide })
    );
    room.position.y = 4;
    env.add(room);
    const lamp = (w, h, x, y, z, c, rx, ry) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx || 0, ry || 0, 0);
      env.add(m);
    };
    lamp(8, 2, 0, 8.9, 0, 0xfff2df, Math.PI / 2);            // 天井灯
    lamp(5, 3, -9.9, 4, 2, 0xcfe2ff, 0, Math.PI / 2);        // 窓
    lamp(3, 3, 9.9, 3, -3, 0xffd8a8, 0, -Math.PI / 2);       // 暖色ランプ
    lamp(14, 0.6, 0, 1.2, -9.9, 0x8a6d55);                    // 調理台の反射
    lamp(20, 20, 0, -0.9, 0, 0x4b3a2c, -Math.PI / 2);        // 床
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(env, 0.04);
    pm.dispose();
    return rt.texture;
  };

  PK.U = U;
})();
