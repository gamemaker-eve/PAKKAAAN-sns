/* PAKKAAAN! — フライパン：モデル、温度、傾け・振る・トントン、バター、ヘラ、こぼれ */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;
  const DEG = Math.PI / 180;

  function PanController(K, audio) {
    this.K = K; this.audio = audio;
    const Egg = PK.Egg;

    this.root = new THREE.Group();
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    K.scene.add(this.root);
    this.home = new THREE.Vector3(K.POS.stove.x, K.PAN_Y, K.POS.stove.z);
    this.root.position.copy(this.home);

    // --- フライパン本体（鉄） ---
    const pts = [
      [0, 0], [1.0, 0], [1.08, 0.04], [1.21, 0.29], [1.25, 0.315], [1.275, 0.3],
      [1.12, 0.03], [1.04, -0.035], [0.98, -0.045], [0, -0.045],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const panMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.85, roughness: 0.36, roughnessMap: U.brushedTex(), side: THREE.DoubleSide });
    this.panMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 80), panMat);
    this.panMesh.castShadow = true; this.panMesh.receiveShadow = true;
    this.tilt.add(this.panMesh);
    // 鍋底（使い込んだ油膜の質感）
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1b1d, metalness: 0.7, roughness: 0.28, bumpMap: U.noiseTex(128, 12, 3, 1.4), bumpScale: 0.002 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.0, 72), this.floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.0015;
    floor.receiveShadow = true;
    this.tilt.add(floor);
    // 柄
    const handle = new THREE.Group();
    handle.position.set(0, 0.24, 1.22);
    handle.rotation.x = -0.18;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.6, 16), panMat);
    neck.rotation.x = Math.PI / 2; neck.position.z = 0.3;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 1.5, 20), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.55, map: U.woodTex() }));
    grip.rotation.x = Math.PI / 2; grip.position.z = 1.3;
    neck.castShadow = grip.castShadow = true;
    handle.add(neck, grip);
    // 柄をつかみやすい当たり判定
    const hHit = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.9, 10), new THREE.MeshBasicMaterial({ visible: false }));
    hHit.rotation.x = Math.PI / 2; hHit.position.z = 1.1;
    handle.add(hHit);
    this.handleHitMesh = hHit;
    this.tilt.add(handle);
    this.handle = handle;
    this.hold = new THREE.Vector3(); this.holdPos = new THREE.Vector3(); this.holdVel = new THREE.Vector3();

    // --- バター ---
    this.butterMat = new THREE.MeshPhysicalMaterial({ color: 0xffe08a, roughness: 0.3, clearcoat: 0.5 });
    this.butterBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.butterMat);
    this.butterBlock.castShadow = true;
    this.butterBlock.visible = false;
    this.tilt.add(this.butterBlock);
    // 溶けたバターが広がった範囲（32×32 のグリッド）
    this.BN = 32;
    this.cov = new Float32Array(this.BN * this.BN);
    this.covTmp = new Float32Array(this.BN * this.BN);
    this.covBrown = new Float32Array(this.BN * this.BN);
    this.covData = new Uint8Array(this.BN * this.BN * 4);
    this.covTex = new THREE.DataTexture(this.covData, this.BN, this.BN, THREE.RGBAFormat);
    this.covTex.magFilter = this.covTex.minFilter = THREE.LinearFilter;
    this.covTex.encoding = THREE.sRGBEncoding;
    // 溶けたバターの膜：熱い油のように強いつや（細かいさざ波でハイライトがきらめく）
    // 輪郭用の細かい透明度（32マスを4倍に拡大してなめらかに）
    this.FA = 128;
    this.filmAData = new Uint8Array(this.FA * this.FA * 4);
    this.filmATex = new THREE.DataTexture(this.filmAData, this.FA, this.FA, THREE.RGBAFormat);
    this.filmATex.magFilter = this.filmATex.minFilter = THREE.LinearFilter;
    this.covS = new Float32Array(this.BN * this.BN);
    this.butterFilmMat = new THREE.MeshPhysicalMaterial({ map: this.covTex, alphaMap: this.filmATex, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03,
      envMapIntensity: 1.3, bumpMap: U.noiseTex(128, 22, 2, 1.6), bumpScale: 0.0008, transparent: true, opacity: 1, depthWrite: false });
    // 照明が映り込んだようなつやのハイライト（溶けたバターの上でゆらめく）
    this.glintTex = U.canvasTex(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const r = U.rng(31);
      for (let i = 0; i < 26; i++) {
        const x = r() * w, y = r() * h, rx = 8 + r() * 26, ry = 2 + r() * 6;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.5 + r() * 0.3);
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
        g.addColorStop(0, `rgba(255,250,225,${0.5 + r() * 0.5})`); g.addColorStop(1, 'rgba(255,250,225,0)');
        ctx.scale(1, ry / rx); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });
    this.glintMat = new THREE.MeshBasicMaterial({ map: this.glintTex, alphaMap: this.filmATex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 });
    this.glintMat.userData.lin = true;
    this.butterFilmMat.userData.lin = true;
    const filmGeo = new THREE.CircleGeometry(1, 48);
    { // UV を鍋底の座標 [-1,1] に合わせる
      const pa = filmGeo.attributes.position, uv = filmGeo.attributes.uv;
      for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) + 1) / 2, (1 - pa.getY(i)) / 2);   // 回転後 z = -y → 行 j と同じ向き
    }
    this.butterFilm = new THREE.Mesh(filmGeo, this.butterFilmMat);
    this.butterFilm.rotation.x = -Math.PI / 2; this.butterFilm.position.y = 0.003;
    this.tilt.add(this.butterFilm);
    this.butterGlint = new THREE.Mesh(filmGeo, this.glintMat);
    this.butterGlint.rotation.x = -Math.PI / 2; this.butterGlint.position.y = 0.0036;
    this.butterGlint.renderOrder = 1;
    this.tilt.add(this.butterGlint);
    this.foam = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshPhysicalMaterial({ color: 0xfff3cc, roughness: 0.2, transparent: true, opacity: 0.8 }), 70);
    this.foam.count = 0;
    this.tilt.add(this.foam);

    // --- 卵（高さ場） ---
    this.sheet = new Egg.EggSheet(44, 1.0);
    this.sheetMesh = new Egg.SheetMesh(this.sheet);
    this.tilt.add(this.sheetMesh.mesh);

    // --- 巻いたオムレツ ---
    this.omelette = new PK.Omelette();
    this.omelette.group.visible = false;
    this.tilt.add(this.omelette.group);

    // --- へら（ターナー）：普段は調理台に置いてある ---
    {
      const sp = (this.spatula = new THREE.Group());
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.45, metalness: 0.2 });
      const shape = new THREE.Shape();
      const W = 0.17, L = 0.42, r = 0.05;
      shape.moveTo(-W, 0);
      shape.lineTo(W, 0);
      shape.lineTo(W - 0.02, L - r); shape.quadraticCurveTo(W - 0.03, L, W - 0.03 - r, L);
      shape.lineTo(-W + 0.03 + r, L); shape.quadraticCurveTo(-W + 0.03, L, -W + 0.02, L - r);
      shape.closePath();
      // 油切りのスリット
      for (let i = -1; i <= 1; i++) {
        const h = new THREE.Path();
        const x = i * 0.08;
        h.moveTo(x - 0.012, 0.08); h.lineTo(x + 0.012, 0.08); h.lineTo(x + 0.012, 0.32); h.lineTo(x - 0.012, 0.32); h.closePath();
        shape.holes.push(h);
      }
      const bg = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
      bg.rotateX(Math.PI / 2);           // 刃は水平（xz 平面）、先端の辺が原点、柄の方向が +z
      const blade = new THREE.Mesh(bg, bladeMat);
      blade.position.y = 0.012;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.25 }));
      neck.rotation.x = Math.PI / 2 - 0.55;
      neck.position.set(0, 0.11, L + 0.17);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.85, 14), new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.5, map: U.woodTex() }));
      handle.rotation.x = Math.PI / 2 - 0.55;
      handle.position.set(0, 0.42, L + 0.62);
      [blade, neck, handle].forEach((m) => { m.castShadow = true; sp.add(m); });
      // 触りやすい当たり判定
      const hit = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.95), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.set(0, 0.12, 0.32);
      sp.add(hit);
      this.spatHitMesh = hit;
      K.scene.add(sp);
      this.spat = { state: 'rest', x: 0, z: 0, tx: 0, tz: 0, vx: 0, vz: 0, t: 0, dragging: false };
      // 右手で持った角度（柄が右手前、刃は少し寝かせる）。パン座標での刃の向き
      this.spatYaw = Math.atan2(0.55, 0.83);
      this.spatEdge = { x: Math.cos(this.spatYaw), z: -Math.sin(this.spatYaw) };
    }

    // --- こぼれた卵のしずく ---
    this.drips = [];
    const dripMat = new THREE.MeshPhysicalMaterial({ color: 0xffb020, roughness: 0.1, clearcoat: 1 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dripMat);
      m.visible = false;
      K.scene.add(m);
      this.drips.push({ m, v: new THREE.Vector3(), life: 0 });
    }
    // こぼれて焦げ付いた跡（コンロの上）
    this.spillMarks = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 16), new THREE.MeshStandardMaterial({ color: 0xc89236, roughness: 0.6 }), 60);
    this.spillMarks.count = 0;
    K.scene.add(this.spillMarks);

    // --- 湯気 ---
    const steamTex = U.canvasTex(64, 64, (ctx, w) => {
      const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    });
    this.steam = [];
    for (let i = 0; i < 14; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false }));
      sp.visible = false;
      K.scene.add(sp);
      this.steam.push({ sp, t: Math.random() * 3, x: 0, z: 0 });
    }

    // 状態
    this.pitch = 0; this.roll = 0; this.yaw = 0;
    this.tPitch = 0; this.tRoll = 0;
    this.off = new THREE.Vector3(); this.offV = new THREE.Vector3(); this.accel = new THREE.Vector3();
    this.knockT = -1;
    this.dragging = false;
    this.keys = {};
    this.lookTimer = 0;
    this.messages = [];
  }

  PanController.prototype.reset = function (run) {
    this.served = false;
    this.fried = false;
    if (this.sheet) this.sheet.fried = false;
    (this.yolks || []).forEach((m) => (m.visible = false));
    (this.shellBits || []).forEach((m) => (m.visible = false));
    if (this.panMesh) this.setGhost(false);
    this.run = run;
    this.T = 22; this.heat = 0;
    this.butterIn = false; this.butterMelt = 0; this.butterBrown = 0; this.butterG = run.prep.butter;
    this.bSolid = 0; this.bx = 0; this.bz = 0; this.bvx = 0; this.bvz = 0; this.bDrop = 0; this.bDrag = null;
    this.cov.fill(0); this.covBrown.fill(0); this.covT = 0;
    this.knobDrag = null; this.lift = 0;
    this.poured = false; this.pourT = -1;
    this.heatTime = 0; this.sinceePour = 0;
    this.sheet.reset();
    this.fold = new PK.Egg.EggFold();
    this.fold.uniformity = run.prep.uniformity;
    this.foldPos = { x: 0, z: 0, vx: 0, vz: 0, spin: 0 };
    this.omelette.group.visible = false;
    this.omelette.resetOpen();
    if (this.omelette.setShells) this.omelette.setShells(0);
    this.omelette.squash = 0; this.omelette.sag = 0; this.omelette.irr = 0;
    this.omelette.surfaceWorld = null;
    if (this.omelette.group.parent !== this.tilt) this.tilt.add(this.omelette.group);
    this.omelette.group.position.set(0, 0, 0);
    this.omelette.group.rotation.set(0, 0, 0);
    this.scrambling = false;
    this.spatRest();
    this.shapeMsg = false;
    this.dripAcc = 0;
    this.butterBlock.visible = false;
    this.drawCov();
    this.foam.count = 0;
    this.pitch = this.roll = this.tPitch = this.tRoll = this.yaw = 0;
    this.off.set(0, 0, 0); this.offV.set(0, 0, 0);
    this.hold.set(0, 0, 0); this.holdPos.set(0, 0, 0); this.holdVel.set(0, 0, 0); this.hDrag = null;
    this.root.position.copy(this.home);
    this.root.rotation.set(0, 0, 0);
    this.tilt.rotation.set(0, 0, 0);
    this.spillMarks.count = 0;
    this.drips.forEach((d) => { d.m.visible = false; d.life = 0; });
    this.mode = 'stove';
    this.messages.length = 0;
  };

  PanController.prototype.say = function (text, kind) { this.messages.push({ text, kind: kind || 'info' }); };

  PanController.prototype.setHeat = function (h) { this.heat = U.clamp(h, 0, 10); };

  /** 鍋底の、卵がある所（なければ全体）のバターの広がり 0..1 */
  PanController.prototype.butterCoverage = function () {
    const N = this.BN, sh = this.sheet;
    let sum = 0, w = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -1 + (2 * (i + 0.5)) / N, z = -1 + (2 * (j + 0.5)) / N;
      if (x * x + z * z > 0.92) continue;
      let wt = 1;
      if (this.poured && sh.stats && sh.stats.V > 0.002) {
        const si = Math.floor(((x + 1) / 2) * sh.N), sj = Math.floor(((z + 1) / 2) * sh.N);
        const k = sj * sh.N + si;
        wt = sh.mask[k] && sh.hs[k] + sh.hl[k] > 0.003 ? 1 : 0.05;
      }
      sum += Math.min(1, this.cov[j * N + i] / 1.2) * wt; w += wt;
    }
    return w > 0 ? sum / w : 0;
  };

  /** バターのくっつき防止効果（0=つるつる、1=くっつく） */
  PanController.prototype.stickiness = function () {
    const cv = this.butterIn ? this.butterCoverage() : 0;
    let s = (1 - cv) * 0.85 + 0.08;
    s += this.butterBrown * 0.25;
    if (this.T < 60 && this.poured) s += 0.25; // 温まっていない鍋に流すとくっつく
    return U.clamp(s, 0, 1);
  };

  /** バターを置く（lx, lz: パン座標。省略時は真ん中あたり） */
  PanController.prototype.addButter = function (lx, lz) {
    if (this.butterIn || this.butterG <= 0) return false;
    this.butterIn = true;
    this.bSolid = this.butterG;
    const r = Math.hypot(lx || 0, lz || 0), lim = 0.75;
    this.bx = lx == null ? 0.15 : r > lim ? (lx * lim) / r : lx;
    this.bz = lz == null ? 0.1 : r > lim ? (lz * lim) / r : lz;
    this.bvx = this.bvz = 0;
    this.bDrop = 1;
    this.run.cook.butterUsed = this.butterG;
    this.butterBlock.visible = true;
    // 冷たいフライパンでは音はしない。熱いほど「ジュワッ」
    if (this.T > 70) this.audio.play('butter', 0.6 * U.smooth(70, 150, this.T));
    else this.audio.play('knock', 0.15);
    return true;
  };

  // バターに触ってドラッグ
  PanController.prototype.butterHit = function (ray) {
    if (!this.butterIn || this.bSolid < 0.3 || this.poured) return false;
    const box = new THREE.Box3().setFromObject(this.butterBlock).expandByScalar(0.12);
    return ray.intersectsBox(box);
  };
  PanController.prototype.butterDragTo = function (ray) {
    // 鍋底の面との交点（パンの座標）
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion()));
    const o = this.tilt.getWorldPosition(new THREE.Vector3());
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(pl, p)) return;
    this.tilt.worldToLocal(p);
    this.bDrag = { x: p.x, z: p.z };
  };

  /** 溶けたバターを鍋底へ置く */
  PanController.prototype.depositButter = function (x, z, grams, rad) {
    const N = this.BN, cell = 2 / N;
    const r2 = rad * rad;
    let wsum = 0;
    const cells = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const cx = -1 + (i + 0.5) * cell, cz = -1 + (j + 0.5) * cell;
      const d2 = (cx - x) ** 2 + (cz - z) ** 2;
      if (d2 > r2 || cx * cx + cz * cz > 1) continue;
      const w = 1 - d2 / r2;
      cells.push([j * N + i, w]); wsum += w;
    }
    if (!wsum) return;
    const area = cell * cell;
    for (const [k, w] of cells) this.cov[k] += (grams * w) / wsum / area;
  };

  PanController.prototype.drawCov = function () {
    const N = this.BN, d = this.covData, cv = this.cov, cs = this.covS;
    for (let k = 0; k < N * N; k++) {
      // まわりと少しならす
      const i = k % N, j = (k / N) | 0;
      let sm = cv[k] * 4, w = 4;
      if (i > 0) { sm += cv[k - 1]; w++; } if (i < N - 1) { sm += cv[k + 1]; w++; }
      if (j > 0) { sm += cv[k - N]; w++; } if (j < N - 1) { sm += cv[k + N]; w++; }
      cs[k] = U.clamp(sm / w / 1.2, 0, 1);
      const c = U.mix3([1.0, 0.8, 0.32], [0.62, 0.34, 0.1], this.covBrown[k]);
      d[k * 4] = c[0] * 255; d[k * 4 + 1] = c[1] * 255; d[k * 4 + 2] = c[2] * 255; d[k * 4 + 3] = 255;
    }
    // 4倍に拡大して輪郭をなめらかに
    const FA = this.FA, U4 = FA / N, ad = this.filmAData, top = this.poured ? 0.35 : 0.9;
    for (let J = 0; J < FA; J++) {
      const fy = (J + 0.5) / U4 - 0.5, j0 = U.clamp(Math.floor(fy), 0, N - 1), j1 = Math.min(N - 1, j0 + 1), ty = U.clamp(fy - j0, 0, 1);
      for (let I = 0; I < FA; I++) {
        const fx = (I + 0.5) / U4 - 0.5, i0 = U.clamp(Math.floor(fx), 0, N - 1), i1 = Math.min(N - 1, i0 + 1), tx = U.clamp(fx - i0, 0, 1);
        const v = (cs[j0 * N + i0] * (1 - tx) + cs[j0 * N + i1] * tx) * (1 - ty) + (cs[j1 * N + i0] * (1 - tx) + cs[j1 * N + i1] * tx) * ty;
        ad[(J * FA + I) * 4 + 1] = U.smooth(0.08, 0.45, v) * top * 255;
      }
    }
    this.covTex.needsUpdate = true;
    this.filmATex.needsUpdate = true;
  };

  /** バターの固まり：傾き・ドラッグで動き、熱い所ほど・動くほど早く溶けて跡が残る */
  /** その場所の卵液（卵）の表面の高さ。卵がなければ 0 */
  PanController.prototype.eggTopAt = function (x, z) {
    const sh = this.sheet;
    const i = Math.floor((x - sh.ox + sh.R) / sh.dx), j = Math.floor((z - sh.oz + sh.R) / sh.dx);
    if (i < 0 || j < 0 || i >= sh.N || j >= sh.N) return 0;
    const k = j * sh.N + i;
    if (!sh.mask[k]) return 0;
    const h = sh.hs[k] + sh.hl[k];
    return h > 0.0018 ? 0.004 + h * 1.05 : 0;
  };
  PanController.prototype.updateButter = function (dt, t, gl) {
    const c = this.run.cook;
    const N = this.BN;
    if (this.bSolid > 0.05) {
      if (this.bDrop > 0) this.bDrop = Math.max(0, this.bDrop - dt * 4);
      const r = Math.hypot(this.bx, this.bz);
      const Tl = 20 + (this.T - 20) * PK.Egg.heatProfile(r);
      const meltF = this.butterMelt;
      // 動き
      if (this.bDrag) {
        const tx = this.bDrag.x - this.bx, tz = this.bDrag.z - this.bz;
        this.bvx = U.lerp(this.bvx, tx * 12, 0.5); this.bvz = U.lerp(this.bvz, tz * 12, 0.5);
      } else {
        const slope = Math.hypot(gl.x, gl.z);
        const mu = 0.3 - 0.24 * U.smooth(40, 100, Tl);   // 下が溶けると滑りやすい
        if (slope > mu || Math.hypot(this.bvx, this.bvz) > 0.03) {
          this.bvx += gl.x * 9 * dt; this.bvz += gl.z * 9 * dt;
        }
        const damp = Math.exp(-dt * (2.5 + (1 - meltF) * 2));
        this.bvx *= damp; this.bvz *= damp;
      }
      this.bx += this.bvx * dt; this.bz += this.bvz * dt;
      const sz = 0.2 * Math.cbrt(this.bSolid / 10);
      const lim = 0.97 - sz;
      const rr = Math.hypot(this.bx, this.bz);
      if (rr > lim) {
        this.bx *= lim / rr; this.bz *= lim / rr;
        const vn = (this.bvx * this.bx + this.bvz * this.bz) / lim;
        if (vn > 0) { this.bvx -= (vn * this.bx) / lim * 1.3; this.bvz -= (vn * this.bz) / lim * 1.3; }
      }
      // 溶ける
      const speed = Math.hypot(this.bvx, this.bvz);
      const rate = 0.6 * Math.max(0, Tl - 32) / 100 * (1 + speed * 2.5);
      const m = Math.min(this.bSolid, rate * dt);
      this.bSolid -= m;
      this.depositButter(this.bx, this.bz, m, 0.12 + sz * 0.9);
      this.butterMelt = 1 - this.bSolid / this.butterG;
      if (speed > 0.2 && Tl > 80 && Math.random() < dt * 8) this.audio.play('butter', 0.15 * U.smooth(80, 150, Tl));
    } else if (this.bSolid > 0) {
      this.depositButter(this.bx, this.bz, this.bSolid, 0.15);
      this.bSolid = 0; this.butterMelt = 1;
    }
    // 溶けたバターは低い方へ流れ、少しずつ広がる
    this.covT += dt;
    if (this.covT > 0.05) {
      const step = this.covT; this.covT = 0;
      const A = this.cov, B = this.covTmp;
      const liquidT = U.smooth(30, 70, this.T);
      const diff = 0.6 * step * liquidT;
      const fx = gl.x * 1.6 * step * liquidT, fz = gl.z * 1.6 * step * liquidT;
      const FILM = 0.9;   // 鍋肌に残る薄い膜（これより多い分だけが流れる）
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        let v = A[k];
        const nb = (ii, jj) => (ii < 0 || jj < 0 || ii >= N || jj >= N ? A[k] : A[jj * N + ii]);
        const mob = (ii, jj) => Math.max(0, nb(ii, jj) - FILM);
        const mk = Math.max(0, A[k] - FILM);
        const lap = nb(i + 1, j) + nb(i - 1, j) + nb(i, j + 1) + nb(i, j - 1) - 4 * v;
        v += lap * Math.min(0.24, diff);
        // 移流（上流側から運ばれてくる量）
        const ux = U.clamp(fx * N * 0.5, -0.45, 0.45), uz = U.clamp(fz * N * 0.5, -0.45, 0.45);
        v += (ux > 0 ? ux * mob(i - 1, j) : -ux * mob(i + 1, j)) - Math.abs(ux) * mk;
        v += (uz > 0 ? uz * mob(i, j - 1) : -uz * mob(i, j + 1)) - Math.abs(uz) * mk;
        const x = -1 + (2 * (i + 0.5)) / N, z = -1 + (2 * (j + 0.5)) / N;
        B[k] = x * x + z * z > 1 ? 0 : Math.max(0, v);
        if (this.T > 150 && A[k] > 0.1) this.covBrown[k] = Math.min(1, this.covBrown[k] + ((this.T - 150) / 70) * step * 0.06 * (this.poured ? 0.15 : 1));
      }
      A.set(B);
      let bs = 0, bn = 0;
      for (let k = 0; k < N * N; k++) if (A[k] > 0.1) { bs += this.covBrown[k]; bn++; }
      this.butterBrown = bn ? bs / bn : 0;
      c.butterBurn = this.butterBrown;
      c.butterCover = Math.max(c.butterCover || 0, this.butterCoverage());
      this.drawCov();
    }
    // 固まりの見た目
    const s = Math.cbrt(Math.max(0.01, this.bSolid) / 10);
    const soft = this.butterMelt;
    const bH = 0.14 * s * (1 - soft * 0.4) + 0.005;       // 固まりの高さ
    // 卵液を流しても、バターは急に消さない。卵液がバターの上まで来て隠れてから消す
    let showB = this.bSolid > 0.05;
    if (showB && this.poured) {
      const hw = 0.16 * s, hd = 0.11 * s;
      const top = Math.min(
        this.eggTopAt(this.bx, this.bz),
        this.eggTopAt(this.bx - hw, this.bz), this.eggTopAt(this.bx + hw, this.bz),
        this.eggTopAt(this.bx, this.bz - hd), this.eggTopAt(this.bx, this.bz + hd));
      const covered = top > bH * 0.9 + this.bDrop * 0.6;
      this.butterHideT = (this.butterHideT || 0) + dt;
      // 卵液が薄くて届かない場合でも、ずっと残らないよう時間で消す
      if (covered || this.butterHideT > 12) showB = false;
    } else if (!this.poured) this.butterHideT = 0;
    this.butterBlock.visible = showB;
    this.butterBlock.scale.set(0.32 * s * (1 + soft * 0.3), bH, 0.22 * s * (1 + soft * 0.3));
    this.butterBlock.position.set(this.bx, 0.07 * s * (1 - soft * 0.4) + this.bDrop * 0.6, this.bz);
    this.butterBlock.rotation.y = Math.atan2(this.bvz, this.bvx) * 0.2;
    // 泡立つバター
    const bubbling = !this.poured && this.T > 110 ? U.clamp((this.T - 110) / 60, 0, 1) : 0;
    let nf = 0;
    if (bubbling > 0) {
      const m = new THREE.Object3D();
      for (let i = 0; i < 70; i++) {
        const a = i * 2.39996, r = Math.sqrt((i + 0.5) / 70) * 0.95;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const ci = Math.floor(((x + 1) / 2) * N), cj = Math.floor(((z + 1) / 2) * N);
        if (this.cov[cj * N + ci] < 0.4) continue;
        m.position.set(x, 0.006, z);
        const sz = (0.01 + 0.012 * Math.abs(Math.sin(t * 9 + i * 1.7))) * bubbling;
        m.scale.set(sz, sz * 0.6, sz);
        m.updateMatrix();
        this.foam.setMatrixAt(nf++, m.matrix);
      }
    }
    this.foam.count = nf;
    this.foam.instanceMatrix.needsUpdate = true;
  };

  // 火力つまみ
  PanController.prototype.knobStart = function (sx, sy, cx, cy) {
    this.knobDrag = { a: Math.atan2(sy - cy, sx - cx), cx, cy, y: sy };
  };
  PanController.prototype.knobMove = function (sx, sy) {
    const k = this.knobDrag;
    if (!k) return;
    let dh;
    if (Math.hypot(sx - k.cx, sy - k.cy) < 18) {
      dh = (k.y - sy) * 0.04;
    } else {
      const a = Math.atan2(sy - k.cy, sx - k.cx);
      let d = a - k.a; d = Math.atan2(Math.sin(d), Math.cos(d));
      k.a = a;
      dh = (d / this.K.KNOB_RANGE) * 10;   // 時計回りで強く（135°で最大）
    }
    k.y = sy;
    const prev = this.heat;
    this.setHeat(this.heat + dh);
    if ((prev <= 0.05) !== (this.heat <= 0.05)) this.audio.play('click', 0.8);
  };
  PanController.prototype.knobEnd = function () { this.knobDrag = null; };

  PanController.prototype.pour = function () {
    if (this.poured) return false;
    const pr = this.run.prep;
    const vol = pr.eggs * PK.Egg.EGG_V;
    if (vol <= 0) return false;
    this.poured = true;
    this.pourT = 0;
    this.sheet.startPour(vol, pr.uniformity, pr.foam);
    this.sheet.pourDelay = 1.3;   // ボウルを運んで傾けるまで待つ
    // まったく混ぜていない卵は、黄身がくずれずにそのまま落ちる → 目玉焼き
    this.fried = (pr.mixEnergy || 0) < 1.5;
    this.sheet.fried = this.fried;
    if (this.fried) this.makeYolks(Math.max(1, Math.round(pr.eggs)));
    this.makeShellBits(pr.shells || 0);
    this.audio.play('pour', 0.8);
    if (!this.butterIn || this.butterMelt < 0.5) this.say('バターが溶ける前に流したので、くっつきやすい', 'warn');
    else if (this.butterCoverage() < 0.45) this.say('バターが鍋全体に広がっていない。くっつく所がある', 'warn');
    if (this.T < 90) this.say('鍋がまだ温まっていない。固まるまで時間がかかる', 'warn');
    if (pr.eggs * PK.Egg.EGG_V > 0.9) this.say('卵が多すぎる！ フライパンからあふれそう', 'warn');
    return true;
  };

  // ---------------- へら ----------------
  PanController.prototype.setScramble = function () { /* へらは手で動かす */ };
  /** 使っている間、へらの置き場所に「ここに置く」の目印を出す */
  PanController.prototype.restMark = function (on) {
    if (!this._restMark) {
      const P = this.K.POS.spatula;
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.56, 48), new THREE.MeshBasicMaterial({ color: 0xffc12e, transparent: true, opacity: 0.85 }));
      ring.rotation.x = -Math.PI / 2;
      const lb = this.K.makeLabel('タップで へらを置く', { size: 56, color: '#2a1a06', bg: 'rgba(255,193,46,0.95)', height: 0.13 });
      lb.rotation.x = -Math.PI / 2; lb.position.z = 0.7;
      g.add(ring, lb);
      g.position.set(P.x, 0.012, P.z);
      g.traverse((o) => { if (o.material) o.material.userData.lin = true; });
      this.K.scene.add(g);
      this._restMark = g;
    }
    this._restMark.visible = on;
  };
  /** 置き場所をタップしたか */
  PanController.prototype.restHit = function (ray) {
    const P = this.K.POS.spatula, p = new THREE.Vector3();
    if (!ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return false;
    return Math.hypot(p.x - P.x, p.z - (P.z + 0.2)) < 0.75;
  };
  PanController.prototype.spatRest = function () {
    this.restMark(false);
    const sp = this.spatula, P = this.K.POS.spatula;
    if (sp.parent !== this.K.scene) this.K.scene.attach(sp);
    sp.position.set(P.x, 0.0, P.z);
    sp.rotation.set(0, 0.35, 0);
    sp.scale.setScalar(1);
    this.spat.state = 'rest';
    this.spat.dragging = false;
  };
  PanController.prototype.spatHit = function (ray) {
    if (!this._rc) this._rc = new THREE.Raycaster();
    this._rc.ray.copy(ray);
    this.spatula.updateMatrixWorld(true);
    return this._rc.intersectObject(this.spatHitMesh, false).length > 0;
  };
  /** タップ：置いてある→少し浮く→使う */
  PanController.prototype.spatTap = function () {
    const S = this.spat;
    if (S.state === 'rest') { S.state = 'lifted'; S.t = 0; this.audio.play('click', 0.6); return 'lifted'; }
    if (S.state === 'lifted') {
      S.state = 'active';
      this.tilt.add(this.spatula);
      this.restMark(true);
      S.x = S.tx = 0.25; S.z = S.tz = 0.3; S.vx = S.vz = 0;
      this.audio.play('click', 0.8);
      return 'active';
    }
    return S.state;
  };
  /** 画面の点 → パン底の点（パン座標） */
  PanController.prototype.floorPoint = function (ray) {
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.tilt.getWorldQuaternion(new THREE.Quaternion()));
    const o = this.tilt.getWorldPosition(new THREE.Vector3());
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(pl, p)) return null;
    return this.tilt.worldToLocal(p);
  };
  PanController.prototype.spatDragTo = function (ray) {
    const p = this.floorPoint(ray);
    if (!p) return;
    const r = Math.hypot(p.x, p.z), lim = 0.86;
    if (r > lim) { p.x *= lim / r; p.z *= lim / r; }
    this.spat.tx = p.x; this.spat.tz = p.z;
    this.spat.dragging = true;
  };
  PanController.prototype.inPan = function (ray) {
    const p = this.floorPoint(ray);
    return !!p && Math.hypot(p.x, p.z) < 1.15;
  };
  PanController.prototype.updateSpatula = function (dt, t) {
    const S = this.spat, sp = this.spatula;
    if (S.state === 'rest') return;
    if (S.state === 'lifted') {
      S.t += dt;
      const P = this.K.POS.spatula;
      sp.position.set(P.x, 0.16 + Math.sin(S.t * 4) * 0.025, P.z);
      sp.rotation.set(0.08, 0.35, 0);
      return;
    }
    // 使っている：右手で持った角度のまま、刃先だけを動かす
    const px = S.x, pz = S.z;
    const k = 1 - Math.exp(-dt * 22);
    S.x = U.lerp(S.x, S.tx, k); S.z = U.lerp(S.z, S.tz, k);
    S.vx = (S.x - px) / Math.max(dt, 1e-3); S.vz = (S.z - pz) / Math.max(dt, 1e-3);
    // 卵があればその上をなでる高さ
    const sh = this.sheet;
    let top = 0;
    if (this.poured) {
      const i = Math.floor(((S.x - sh.ox + 1) / 2) * sh.N), j = Math.floor(((S.z - sh.oz + 1) / 2) * sh.N);
      const kk = j * sh.N + i;
      if (i >= 0 && j >= 0 && i < sh.N && j < sh.N && sh.mask[kk]) top = sh.hs[kk] * 0.6;
    }
    sp.position.set(S.x, 0.004 + top, S.z);
    sp.rotation.set(0, 0, 0);
    sp.rotateY(this.spatYaw);
    sp.rotateX(-0.42);
    const speed = Math.hypot(S.vx, S.vz);
    const c = this.run.cook;
    if (!S.dragging || speed < 0.05) return;
    // 混ぜる
    if (this.poured && this.fold.roll < 0.99) {
      const n = sh.stir(S.x, S.z, this.spatEdge.x, this.spatEdge.z, S.vx, S.vz, dt);
      if (n > 0) {
        c.scramble += dt * U.clamp(speed / 1.5, 0.3, 1.5);
        c.stirDist = (c.stirDist || 0) + speed * dt;
        if (Math.random() < dt * 6) this.audio.play('shake', 0.15);
      }
    }
    // 巻いたオムレツをへらで寄せて形を整える
    if (this.fold.V > 0 && this.fold.roll >= 0.99) {
      const fp = this.foldPos, om = this.omelette;
      const dx = fp.x - S.x, dz = fp.z - S.z;
      const d = Math.hypot(dx, dz);
      if (d < om.W * 0.6 + 0.12) {
        const toward = (S.vx * dx + S.vz * dz) / (d || 1);
        if (toward > 0) {
          fp.vx += (S.vx * 0.6 - fp.vx) * Math.min(1, dt * 10);
          fp.vz += (S.vz * 0.6 - fp.vz) * Math.min(1, dt * 10);
          const soft = 1 - this.fold.fs;
          this.fold.quality = Math.min(0.98, this.fold.quality + dt * toward * 0.08);
          this.fold.tear = Math.min(1, this.fold.tear + dt * Math.max(0, toward - 2) * soft * 0.05);
          c.shaped = (c.shaped || 0) + dt;
          if (!this.shapeMsg && c.shaped > 0.5) { this.shapeMsg = true; this.say('へらで寄せて形を整えている', 'good'); }
        }
      }
    }
  };

  /** 振る：フライパンを素早く動かす。中身は慣性で反対側へ */
  PanController.prototype.shake = function (dirX, dirZ, strength) {
    strength = U.clamp(strength, 0, 2.5);
    const len = Math.hypot(dirX, dirZ) || 1;
    this.offV.x += (dirX / len) * strength * 2.2;
    this.offV.z += (dirZ / len) * strength * 2.2;
    this.audio.play('shake', Math.min(1, strength));
    const c = this.run.cook;
    c.shakes++;
    if (strength > 1.4) c.hardShakes++;
    if (this.fold.roll < 0.99 && this.sheet.stats && this.sheet.stats.V > 0.01) {
      const torn = this.sheet.impulse((dirX / len) * strength, (dirZ / len) * strength, strength);
      if (torn) { c.tears++; this.audio.play('tear', 0.8); this.say('強く振りすぎて卵が破れた', 'bad'); }
    } else if (this.fold.V > 0) {
      this.foldPos.vx += (dirX / len) * strength * 0.8;
      this.foldPos.vz += (dirZ / len) * strength * 0.8;
      if (strength > 1.6 && this.fold.fs < 0.45) { this.fold.tear += 0.15; c.tears++; this.audio.play('tear', 0.6); this.say('柔らかいオムレツを強く振って皮が裂けた', 'bad'); }
    }
  };

  /** トントン：柄をたたいて奥の卵を巻き込む */
  PanController.prototype.knock = function () {
    if (this.fried) { this.say('目玉焼きは巻けない。そのまま皿に移そう', 'info'); return; }
    if (this.knockT >= 0 && this.knockT < 0.18) return;
    this.knockT = 0;
    this.audio.play('knock');
    this.offV.y -= 0.9;
    this.offV.z -= 0.6;
    const c = this.run.cook;
    const s = this.sheet.stats || this.sheet.computeStats();
    if (this.fold.roll >= 0.99) {
      this.foldPos.vz -= 0.4;
      this.foldPos.spin += 0.3;
      return;
    }
    if (!this.poured || s.V < 0.004) return;
    c.rollTaps++;
    const pitchDeg = this.pitch / DEG;
    const setOK = U.smooth(0.12, 0.38, s.setFrac);
    if (setOK < 0.15) {
      c.failedRolls++;
      this.sheet.impulse(0, -0.8, 0.6);
      this.say('まだ固まっていないので巻けない', 'warn');
      return;
    }
    if (pitchDeg < 7) {
      this.sheet.impulse(0, -0.6, 0.5);
      this.say('奥を下げるように傾けながらトントン', 'info');
      return;
    }
    const gather = U.clamp(-s.cz / 0.42, 0, 1);
    const firm = U.smooth(0.8, 0.97, s.fs);
    const over = U.clamp((c.scramble - 9) / 10, 0, 0.6); // 混ぜすぎはスクランブルエッグ
    const stick = this.stickiness();
    const q = U.clamp((0.35 + 0.65 * gather) * (0.45 + 0.55 * setOK) * (1 - firm * 0.6) * (1 - stick * 0.45) * (1 - over), 0, 1);
    const total = this.fold.V + s.V;
    let step = (0.16 + 0.14 * gather) * total;
    if (s.V - step < total * 0.06) step = s.V;
    const part = this.sheet.take(step / s.V);
    this.fold.add(part, q);
    this.fold.roll = this.fold.V / (this.fold.V + this.sheet.stats.V);
    if (firm > 0.5) { this.fold.tear += 0.12 * firm; c.tears++; this.audio.play('tear', 0.5); this.say('固くなりすぎて巻くと割れる', 'bad'); }
    if (stick > 0.6) { c.stickEvents++; this.fold.tear += 0.06; this.say('鍋にくっついて巻きにくい（バター不足）', 'warn'); }
    // 巻き始めの位置：シートの重心の横位置、奥の縁
    if (this.fold.V === part.V) this.foldPos.x = U.clamp(s.cx, -0.25, 0.25);
    this.foldPos.spin += 1.2;
    this.omelette.group.visible = true;
    if (this.fold.roll >= 0.99) this.say('きれいに巻けた！ 好みの焼き加減で皿へ移そう', 'good');
  };

  /** 残ったシートを強制的に巻き込む（巻かずに皿へ移すとき） */
  PanController.prototype.forceFold = function () {
    const s = this.sheet.computeStats();
    if (s.V > 0.002) {
      const part = this.sheet.take(1);
      const q = 0.25 * U.smooth(0.1, 0.4, s.setFrac);
      this.fold.add(part, q);
    }
    this.fold.roll = 1;
    this.omelette.group.visible = this.fold.V > 0;
  };

  // ---------------- 入力 ----------------
  PanController.prototype.dragStart = function () {
    this.dragging = true;
    this.dragBase = { p: this.tPitch, r: this.tRoll };
    this.dragAcc = { x: 0, y: 0 };
  };
  PanController.prototype.dragMove = function (dx, dy, sens) {
    if (!this.dragging) return;
    this.dragAcc.x += dx; this.dragAcc.y += dy;
    const k = 0.18 * DEG * sens;
    this.tPitch = U.clamp(this.dragBase.p - this.dragAcc.y * k, -16 * DEG, 30 * DEG);
    this.tRoll = U.clamp(this.dragBase.r + this.dragAcc.x * k, -28 * DEG, 28 * DEG);
  };
  PanController.prototype.dragEnd = function (vx, vy) {
    this.dragging = false;
    // 素早いスワイプは「振る」
    const sp = Math.hypot(vx, vy);
    if (sp > 1500) this.shake(vx, vy, (sp - 1200) / 1300);
  };

  /** 柄をつかんでフライパンを自由に動かす */
  PanController.prototype.handleHit = function (ray) {
    if (this.mode !== 'stove') return false;
    if (!this._rc) this._rc = new THREE.Raycaster();
    this._rc.ray.copy(ray);
    this.root.updateMatrixWorld(true);
    return this._rc.intersectObject(this.handleHitMesh, false).length > 0;
  };
  PanController.prototype.handleStart = function (ray) {
    const y = this.handle.getWorldPosition(new THREE.Vector3()).y;
    const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(pl, p)) return false;
    this.hDrag = { pl, p0: p, h0: this.hold.clone() };
    return true;
  };
  PanController.prototype.handleDragTo = function (ray) {
    const d = this.hDrag;
    if (!d) return;
    const p = new THREE.Vector3();
    if (!ray.intersectPlane(d.pl, p)) return;
    this.hold.set(U.clamp(d.h0.x + p.x - d.p0.x, -1.3, 1.3), 0, U.clamp(d.h0.z + p.z - d.p0.z, -0.9, 0.8));
  };
  PanController.prototype.handleEnd = function () { this.hDrag = null; };

  /** 盛り付けで場所を決める間は、フライパンを半透明にして下のライスと目印が見えるように */
  PanController.prototype.setGhost = function (on) {
    if (this._ghost === on) return;
    this._ghost = on;
    const m = this.panMesh.material;
    m.transparent = on; m.opacity = on ? 0.35 : 1; m.depthWrite = !on;
    m.needsUpdate = true;
  };

  PanController.prototype.keyTilt = function (dt) {
    const k = this.keys;
    const rate = 70 * DEG * dt;
    let any = false;
    if (k.up) { this.tPitch = Math.min(26 * DEG, this.tPitch + rate); any = true; }
    if (k.down) { this.tPitch = Math.max(-16 * DEG, this.tPitch - rate); any = true; }
    if (k.left) { this.tRoll = Math.max(-26 * DEG, this.tRoll - rate); any = true; }
    if (k.right) { this.tRoll = Math.min(26 * DEG, this.tRoll + rate); any = true; }
    return any;
  };

  // ---------------- 更新 ----------------
  /** 目玉焼きの黄身（白身の上にぷっくり） */
  PanController.prototype.makeYolks = function (n) {
    if (!this.yolkMat) {
      this.yolkMat = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0xffa90f).convertSRGBToLinear(), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
      this.yolkMat.userData.lin = true;
      this.yolkGeo = new THREE.SphereGeometry(0.13, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    }
    (this.yolks || []).forEach((m) => this.tilt.remove(m));
    this.yolks = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.6, r = n === 1 ? 0 : 0.3;
      const m = new THREE.Mesh(this.yolkGeo, this.yolkMat);
      m.userData.off = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      m.scale.set(1, 0.55, 1);
      m.visible = false;
      m.castShadow = true;
      this.tilt.add(m);
      this.yolks.push(m);
    }
  };
  /** 取りのぞかなかった殻のかけら：卵液と一緒にフライパンへ入り、表面にちらっと見える */
  PanController.prototype.makeShellBits = function (n) {
    (this.shellBits || []).forEach((m) => this.tilt.remove(m));
    this.shellBits = [];
    if (!n) return;
    if (!this.shellBitMat) {
      this.shellBitMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xf4ead8).convertSRGBToLinear(), roughness: 0.6, side: THREE.DoubleSide });
      this.shellBitMat.userData.lin = true;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.07, 0.015); sh.lineTo(0.06, 0.06); sh.lineTo(0.02, 0.075); sh.lineTo(-0.025, 0.04); sh.closePath();
      this.shellBitGeo = new THREE.ShapeGeometry(sh);
      this.shellBitGeo.rotateX(-Math.PI / 2);
    }
    for (let i = 0; i < n * 2; i++) {
      const m = new THREE.Mesh(this.shellBitGeo, this.shellBitMat);
      const a = Math.random() * 6.28, r = 0.15 + Math.random() * 0.5;
      m.userData.off = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      m.rotation.y = Math.random() * 6.28;
      m.scale.setScalar(0.8 + Math.random() * 0.6);
      m.visible = false;
      this.tilt.add(m);
      this.shellBits.push(m);
    }
  };

  PanController.prototype.updateYolks = function () {
    // 殻のかけら（巻くと中に巻き込まれて見えなくなる）
    if (this.shellBits && this.shellBits.length) {
      const s = this.sheet, N = s.N, R = s.R, dx = s.dx;
      for (const m of this.shellBits) {
        const x = m.userData.off.x + s.ox, z = m.userData.off.z + s.oz;
        const i = Math.floor((x - s.ox + R) / dx), j = Math.floor((z - s.oz + R) / dx);
        const k = j * N + i;
        const h = i >= 0 && j >= 0 && i < N && j < N && s.mask[k] ? s.hs[k] + s.hl[k] : 0;
        m.visible = h > 0.004 && this.mode === 'stove';
        m.position.set(x, 0.006 + h * 1.05, z);
      }
    }
    if (!this.yolks || !this.yolks.length) return;
    const s = this.sheet, c = this.run.cook;
    // 混ぜたり巻いたりしたら黄身はくずれて、ふつうの卵焼きになる
    if (this.fried && (c.stirCover || 0) > 0.3) {
      this.fried = false; s.fried = false;
      this.yolks.forEach((m) => (m.visible = false));
      this.say('黄身がくずれた。目玉焼きじゃなくなった', 'info');
      return;
    }
    const N = s.N, R = s.R, dx = s.dx;
    for (const m of this.yolks) {
      if (!this.fried) { m.visible = false; continue; }
      const x = m.userData.off.x + s.ox, z = m.userData.off.z + s.oz;
      const i = Math.floor((x - s.ox + R) / dx), j = Math.floor((z - s.oz + R) / dx);
      const k = j * N + i;
      const h = i >= 0 && j >= 0 && i < N && j < N && s.mask[k] ? s.hs[k] + s.hl[k] : 0;
      m.visible = h > 0.004;
      m.position.set(x, 0.004 + h * 1.05, z);
    }
  };

  PanController.prototype.update = function (dt, t) {
    const run = this.run, c = run.cook;
    // 傾き：ドラッグ・キー操作中以外は水平に戻る
    const held = this.keyTilt(dt);
    if (!this.dragging && !held && this.mode === 'stove') {
      this.tPitch *= Math.exp(-dt * 3.5);
      this.tRoll *= Math.exp(-dt * 3.5);
    }
    const k = 1 - Math.exp(-dt * 14);
    this.pitch = U.lerp(this.pitch, this.tPitch, k);
    this.roll = U.lerp(this.roll, this.tRoll, k);

    // トントンの振動
    let knockPitch = 0;
    if (this.knockT >= 0) {
      this.knockT += dt;
      knockPitch = Math.sin(U.clamp(this.knockT / 0.18, 0, 1) * Math.PI) * 5 * DEG;
      if (this.knockT > 0.3) this.knockT = -1;
    }
    this.tilt.rotation.set(-(this.pitch + knockPitch), this.yaw, -this.roll, 'YXZ');

    // 振ったときの位置のばね（加速度は中身の慣性力になる）
    const prevV = this.offV.clone();
    this.offV.addScaledVector(this.off, -140 * dt);
    this.offV.multiplyScalar(Math.exp(-dt * 9));
    this.off.addScaledVector(this.offV, dt);
    this.accel.copy(this.offV).sub(prevV).divideScalar(Math.max(dt, 1e-3));
    // 柄で動かした分（手の動きにすっと付いてくる。急に動かすと中身が慣性で取り残される）
    if (this.mode === 'stove') {
      const prevHV = this.holdVel.clone();
      const np = this.holdPos.clone().lerp(this.hold, 1 - Math.exp(-dt * 16));
      this.holdVel.copy(np).sub(this.holdPos).divideScalar(Math.max(dt, 1e-3));
      this.holdPos.copy(np);
      const ha = this.holdVel.clone().sub(prevHV).divideScalar(Math.max(dt, 1e-3));
      if (ha.length() > 60) ha.setLength(60);
      this.accel.add(ha);
    }
    // 傾けた分だけ持ち上げる（五徳やバーナーにめり込まないように）
    const tiltAmt = Math.max(Math.abs(Math.sin(this.pitch)), Math.abs(Math.sin(this.roll)));
    this.lift = U.lerp(this.lift, tiltAmt * 1.3 + (tiltAmt > 0.03 ? 0.03 : 0), 1 - Math.exp(-dt * 20));
    // 火から離すと五徳より少し持ち上がる
    const away = Math.min(1, this.holdPos.length() / 0.5);
    if (this.mode === 'stove') this.root.position.copy(this.home).add(this.holdPos).add(this.off).add(new THREE.Vector3(0, this.lift + away * 0.12, 0));
    if (this.lift > 0.15) run.cook.lifted += dt;

    // 温度
    const onFire = Math.exp(-this.holdPos.lengthSq() * 2.2);   // 火の真上から外すほど温まらない
    const target = 22 + (this.heat * 23 * onFire) / (1 + this.lift * 2.2);
    const load = this.poured ? 1 + (run.prep.eggs * 0.12) : 1;
    const tau = (this.heat > 0 && target > this.T ? 7 : 26) * load;
    if (this.mode === 'stove') this.T += (target - this.T) * (1 - Math.exp(-dt / tau));
    if (this.K.setKnob) this.K.setKnob(this.heat);
    else this.T += (22 - this.T) * (1 - Math.exp(-dt / 40));
    if (this.pourT >= 0 && this.sheet.pourLeft > 0) this.T -= 18 * dt * Math.min(2, run.prep.eggs / 3);
    c.maxTemp = Math.max(c.maxTemp, this.T);
    if (this.heat > 0 && this.mode === 'stove') { this.heatTime += dt; c.heatTime = this.heatTime; }
    if (this.poured) { c.cookTime += dt; }

    // 実効重力（パン座標）
    const q = new THREE.Quaternion();
    this.tilt.getWorldQuaternion(q);
    const g = new THREE.Vector3(0, -1, 0).addScaledVector(this.accel, -0.02);
    const gt = Math.hypot(g.x, g.z);
    if (gt > 1.5) { g.x *= 1.5 / gt; g.z *= 1.5 / gt; }
    g.applyQuaternion(q.invert());
    const gl = { x: g.x, y: g.y, z: g.z };
    const g0 = new THREE.Vector3(0, -1, 0).applyQuaternion(q);   // 揺れを含まない重力（こぼれの判定用）
    const gs = { x: g0.x, y: g0.y, z: g0.z };

    // バター
    if (this.butterIn) this.updateButter(dt, t, gl);
    if (this.butterIn) {
      // 熱いほどつやがゆらめく
      const hot = U.smooth(40, 140, this.T);
      this.glintMat.opacity = (0.25 + 0.55 * hot) * (0.8 + 0.2 * Math.sin(t * 9) * Math.sin(t * 5.3)) * (this.poured ? 0.35 : 1);
    }

    // 卵
    const stick = this.stickiness();
    const Tpan = this.mode === 'stove' ? this.T : this.T * 0.9;
    if (this.poured) {
      this.sheet.update(dt, { T: Tpan, gl, gs, stick, scramble: false });
      // こぼれ（縁を越えた量がまとまってから、越えた所からしずくが落ちる）
      for (const ev of this.sheet.spillEvents) {
        c.spill += ev.vol;
        this.dripAcc += ev.vol;
        if (this.dripAcc > 0.004) { this.dripAcc = 0; this.spawnDrip(ev.x, ev.z); }
      }
      if (c.spill > 0.006 && !c.overflowWarned) { c.overflowWarned = true; this.say('卵液がフライパンの縁からあふれた！', 'bad'); }
      this.sheet.spillEvents.length = 0;
      if (this.sheet.bumpEvent > 0) {
        // 卵液が縁に寄る音は、やわらかい「ちゃぷ」。続けて鳴らない
        const now = performance.now();
        if (!this._slosh || now - this._slosh > 350) { this.audio.play('slosh', Math.min(0.8, this.sheet.bumpEvent)); this._slosh = now; }
        this.sheet.bumpEvent = 0;
      }
      this.sheetMesh.update(dt);
      // 流し込み中の帯
      if (this.sheet.pourLeft <= 0) this.pourT = -1;
    } else {
      this.sheetMesh.mesh.visible = false;
    }

    // 巻いたオムレツ
    if (this.fold.V > 0) {
      const om = this.omelette;
      om.setSize(this.fold.V, PK.Egg.EGG_V);
      // 巻くほど形が整う。巻きの質が低いと凸凹に
      om.irr = U.clamp((1 - this.fold.quality) * 0.22 + this.fold.tear * 0.12, 0, 0.32);
      const growing = this.fold.roll;
      if (this.mode === 'stove' && om.group.parent === this.tilt) {
        const fp = this.foldPos;
        if (this.fold.roll >= 0.99) {
          const slope = Math.hypot(gl.x, gl.z);
          if (slope > 0.12 + stick * 0.5 || Math.hypot(fp.vx, fp.vz) > 0.05) {
            fp.vx += gl.x * 6 * (1 - stick * 0.7) * dt;
            fp.vz += gl.z * 6 * (1 - stick * 0.7) * dt;
          }
          fp.vx *= Math.exp(-dt * (2 + stick * 8)); fp.vz *= Math.exp(-dt * (2 + stick * 8));
          fp.x += fp.vx * dt; fp.z += fp.vz * dt;
        } else {
          // 巻いている卵は、残っている平たい卵の奥のふちにくっついたまま手前へ進む
          const scNow = 0.55 + 0.45 * Math.cbrt(growing);
          const wall = -(1.0 - om.W * 0.5 * scNow - 0.02);
          const fe = this.sheet.farEdge();
          const tz = fe == null ? wall : Math.max(wall, Math.min(0.6, fe - om.W * 0.5 * scNow * 0.55));
          fp.z = U.lerp(fp.z, tz, 1 - Math.exp(-dt * 8));
        }
        // 縁の内側に収める（楕円近似）
        const ax = Math.max(0.05, 1.0 - om.L * 0.42), az = Math.max(0.05, 1.0 - om.W * 0.5 - 0.02);
        const e = (fp.x / ax) ** 2 + (fp.z / az) ** 2;
        if (e > 1) {
          const s = 1 / Math.sqrt(e);
          fp.x *= s; fp.z *= s;
          fp.vx *= -0.2; fp.vz *= -0.2;
        }
        om.group.position.set(fp.x, 0.004, fp.z);
        const sc = 0.55 + 0.45 * Math.cbrt(growing);
        om.group.scale.setScalar(sc);
        fp.spin *= Math.exp(-dt * 6);
        om.group.rotation.set(Math.sin(fp.spin * 3) * 0.12 * fp.spin, 0, 0);
        const r = Math.hypot(fp.x, fp.z);
        this.fold.cook(dt, 20 + (Tpan - 20) * PK.Egg.heatProfile(r), stick);
      }
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = 0.35;
        om.setLook({ fs: this.fold.fs, br: this.fold.br, lf: this.fold.liquidFrac(), uniformity: this.fold.uniformity });
      }
      om.dirty = true;
      om.update(dt);
    }

    // へら
    this.updateSpatula(dt, t);
    if (this.poured) c.stirCover = this.sheet.stirCoverage ? Math.max(c.stirCover || 0, this.sheet.stirCoverage()) : 0;
    this.updateYolks();

    // しずく
    for (const d of this.drips) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.v.y -= 9.8 * 0.6 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.24 || d.life <= 0) {
        d.life = 0; d.m.visible = false;
        if (this.spillMarks.count < 60) {
          const m = new THREE.Object3D();
          m.position.set(d.m.position.x, 0.225, d.m.position.z);
          m.rotation.x = -Math.PI / 2;
          const s = 0.04 + Math.random() * 0.05;
          m.scale.set(s, s, 1);
          m.updateMatrix();
          this.spillMarks.setMatrixAt(this.spillMarks.count++, m.matrix);
          this.spillMarks.instanceMatrix.needsUpdate = true;
        }
        this.audio.play('sprinkle', 0.5);
      }
    }

    // 湯気
    const steaming = this.poured && this.T > 95 ? U.clamp((this.T - 95) / 100, 0, 1) : 0;
    for (const s of this.steam) {
      s.t += dt;
      if (s.t > 2.6) { s.t = 0; s.x = (Math.random() - 0.5) * 1.4; s.z = (Math.random() - 0.5) * 1.4; }
      s.sp.visible = steaming > 0.02;
      if (!s.sp.visible) continue;
      const k2 = s.t / 2.6;
      const p = new THREE.Vector3(s.x, 0.1 + k2 * 1.6, s.z);
      this.tilt.localToWorld(p);
      s.sp.position.copy(p);
      s.sp.scale.setScalar(0.3 + k2 * 0.9);
      s.sp.material.opacity = Math.sin(k2 * Math.PI) * 0.35 * steaming;
    }

    // 焼ける音
    let siz = 0;
    if (this.mode === 'stove' && !this.served) {
      if (this.poured && this.T > 90) siz = U.clamp((this.T - 90) / 140, 0, 1) * (0.6 + (this.sheet.stats ? this.sheet.stats.setFrac * 0 : 0) + 0.4);
      else if (this.butterIn && this.butterMelt > 0.1 && this.T > 100) siz = U.clamp((this.T - 100) / 160, 0, 0.6);
    }
    this.audio.sizzle(siz);
    if (this.audio.flame) this.audio.flame(this.mode === 'stove' ? this.heat / 10 : 0);
  };

  PanController.prototype.spawnDrip = function (lx, lz) {
    const d = this.drips.find((x) => x.life <= 0);
    if (!d) return;
    const p = new THREE.Vector3(lx * 1.04, 0.3, lz * 1.04);
    this.tilt.localToWorld(p);
    d.m.position.copy(p);
    d.m.visible = true;
    const out = new THREE.Vector3(lx, 0, lz).normalize().multiplyScalar(0.6);
    d.v.set(out.x, 0.2, out.z);
    d.life = 2;
  };

  /** UI 表示用の状態 */
  PanController.prototype.info = function () {
    const s = this.sheet.stats || this.sheet.computeStats();
    let label = null, liquid = 0, set = 0, brown = 0;
    if (this.fold.roll >= 0.99 && this.fold.V > 0) {
      label = this.fold.label();
      liquid = this.fold.liquidFrac(); set = 1 - liquid; brown = this.fold.br;
    } else if (this.poured && s.V > 0.002) {
      const V = s.V + this.fold.V;
      const Vl = s.Vl * (1 - 0.55 * s.pl) + this.fold.Vl;
      liquid = Vl / V;
      set = 1 - liquid;
      brown = (s.br * s.Vs + this.fold.br * this.fold.Vs) / Math.max(1e-6, s.Vs + this.fold.Vs);
      label = PK.Egg.doneLabel(liquid, s.fs, Math.max(brown, s.maxBr * 0.7));
    }
    return {
      T: this.T, heat: this.heat, heatTime: this.heatTime, cookTime: this.run.cook.cookTime,
      label, liquid, set, brown, roll: this.fold.roll, poured: this.poured,
      butterIn: this.butterIn, butterMelt: this.butterMelt, stick: this.stickiness(),
      pouring: this.sheet.pourLeft > 0, thick: s.thick,
    };
  };

  PK.PanController = PanController;
})();
