/* PAKKAAAN! — 盛り付け：フライパンを傾けてオムレツをライスへ滑らせ、着地後に位置と向きを整える */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;
  const DEG = Math.PI / 180;
  const GRAV = 30; // 見やすさのため実際より遅い重力（シーン単位/s²）

  function Plating(K, pan, audio) {
    this.K = K; this.pan = pan; this.audio = audio;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.vel = new THREE.Vector3();
    this.keys = {};
  }

  Plating.prototype.enter = function (run) {
    this.run = run;
    const pan = this.pan;
    pan.setHeat(0);
    pan.setScramble(false);
    if (window.PKG && window.PKG.knife) { const kn = window.PKG.knife; kn.slit.visible = false; kn.slitGeo.setDrawRange(0, 0); kn.guide.visible = false; }
    // 巻かずに盛る目玉焼き
    // 巻いていない卵は、そのままの形でのせる：
    //   火が通っていない → 液体のまま流れ落ちる（raw）、目玉焼き → fried、薄く焼けた卵 → sheet（包むオムライス）
    const st = pan.sheet.computeStats ? pan.sheet.computeStats() : { setFrac: 1 };
    let flat = null;
    if (pan.fold.roll < 0.3 && pan.poured) flat = (st.setFrac || 0) < 0.05 ? 'raw' : pan.fried ? 'fried' : 'sheet';
    run.flat = flat;
    run.fried = flat === 'fried';
    run.raw = flat === 'raw';
    run.sheet = flat === 'sheet';
    // 混ぜていない生卵：溶き卵の液にはせず、生卵のまま（白身は透けて、黄身は丸ごと）ライスの上へ落とす
    this.rawLook = flat === 'raw' && !!pan.fried;
    if (this.rawLook) flat = 'fried';
    const fsNow = st.fs != null ? st.fs : 0.6;
    if (pan.fold.roll < 0.99) pan.forceFold();
    // 取りのこした卵の薄い膜（細い筋）が、巻いたときのような線として残らないよう、鍋の中の卵データを空にする
    if (pan.sheet && pan.sheet.hs) { pan.sheet.hs.fill(0); pan.sheet.hl.fill(0); pan.sheet.stats = pan.sheet.computeStats(); }
    if (pan.sheetMesh) pan.sheetMesh.mesh.visible = false;
    const sz = Math.cbrt(Math.max(1, run.prep.eggs) / 3);
    if (flat === 'fried') pan.omelette.setFlat('fried', (pan.yolks || []).length || 1, 0.62 * sz, 0.62 * sz, this.rawLook ? { raw: true } : undefined);
    else if (flat === 'sheet') pan.omelette.setFlat('sheet', 0, 1.12 * sz, 0.92 * sz, { fs: Math.max(0.5, pan.fold.fs || fsNow), br: pan.fold.br });
    else if (flat === 'raw') { pan.omelette.setFlat('sheet', 0, 0.8 * sz, 0.8 * sz, { fs: 0.05, br: 0 }); }
    else pan.omelette.setFlat(null);
    pan.omelette.setShells(flat === 'raw' ? 0 : (run.prep && run.prep.shells) || 0);
    this.flat = flat;
    (pan.yolks || []).forEach((m) => (m.visible = false));
    pan.mode = 'transfer';
    if (pan.hold) { pan.hold.set(0, 0, 0); pan.holdPos.set(0, 0, 0); pan.holdVel.set(0, 0, 0); pan.hDrag = null; }
    this.phase = 'move';
    this.t = 0;
    this.from = pan.root.position.clone();
    this.panX = this.K.POS.plate.x;
    this.panZ = this.K.POS.plate.z + 1.3;   // ライスの手前から始める
    if (!this.mark) {
      // 卵が落ちる場所の目印（フライパンの奥の縁の真下）
      this.mark = new THREE.Group();
      const m1 = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 40), new THREE.MeshBasicMaterial({ color: 0xffc12e, transparent: true, opacity: 0.95, depthTest: false }));
      const m2 = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.225, 40), new THREE.MeshBasicMaterial({ color: 0x1a0d06, transparent: true, opacity: 0.6, depthTest: false }));
      [m1, m2].forEach((m) => { m.rotation.x = -Math.PI / 2; m.renderOrder = 9; m.material.userData.lin = true; this.mark.add(m); });
      this.K.scene.add(this.mark);
    }
    this.mark.visible = false;
    this.to = new THREE.Vector3(this.panX, 1.45, this.panZ);
    pan.tPitch = 0; pan.tRoll = 0;
    this.slideV = 0;
    this.onPlateT = 0;
    this.yaw = 0;
    pan.yaw = 0;
    if (flat) {
      // 鍋の中での卵の位置（薄い卵の重心）から始める
      const fp = pan.foldPos;
      if (st.V > 0.002) { fp.x = U.clamp(st.cx, -0.35, 0.35); fp.z = U.clamp(st.cz, -0.35, 0.35); }
      else { fp.x = 0; fp.z = 0; }
      fp.vx = fp.vz = 0;
      this.flatBegin(flat);
    }
  };

  // ================= 平らな卵（目玉焼き・薄焼き・生卵）：フライパンの形に沿って動かす =================
  // 剛体の円盤を動かさず、頂点ひとつひとつを
  //   鍋の中 → 鍋の底・側面の曲面にそって移動 → 縁を越えたら最終位置（皿の上）へ垂れ落ちる
  // と動かす。皿の上の最終形は、これまでの「のせた卵」と同じ。
  const PAN_PROFILE = [[0, 0], [1.0, 0], [1.08, 0.04], [1.21, 0.29], [1.25, 0.315]];
  function panY(r) {
    if (r <= 1.0) return 0;
    for (let i = 1; i < PAN_PROFILE.length; i++) {
      if (r <= PAN_PROFILE[i][0]) { const a = PAN_PROFILE[i - 1], b = PAN_PROFILE[i]; return a[1] + ((b[1] - a[1]) * (r - a[0])) / (b[0] - a[0]); }
    }
    return 0.315;
  }
  const RIM_R = 1.25;

  Plating.prototype.flatBegin = function (kind) {
    const pan = this.pan, om = pan.omelette, g = om.group;
    this.K.scene.add(g);   // フライパンの子ではなく、世界に置く（頂点を世界座標で動かすため）
    g.visible = true;
    g.scale.setScalar(1);
    om.surfaceWorld = this.K.coverY;
    om.sag = 1;
    om.squash = 0;
    om.beginFlatSim();
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3(); this._dir = new THREE.Vector3();
    this._gm = new THREE.Matrix4(); this._gi = new THREE.Matrix4();
    this._fkey = null;
    this.fsim = { started: false, startZ: pan.foldPos.z, gone: null, goneW: 0, totalW: 0, crossed: 0 };
    this.flatDone = false;
    if (kind === 'raw') { this.rawFlowT = 0; this.raw = { total: Math.min(0.16, Math.max(0.04, this.run.prep.eggs * 0.034)), done: 0 }; }
    om.fgeo && (om.fgeo.attributes.position.needsUpdate = true);
    this.flatStep();
  };

  /** 点（元の位置 x0,z0／最終位置 F はグループのローカル）の今の位置をグループのローカルで out に返す。返り値：0=鍋の中、0〜1=縁を越えて最終位置へ向かう割合 */
  Plating.prototype.flatPoint = function (x0, z0, fx, fy, fz, out) {
    const pan = this.pan, fp = pan.foldPos, v = this._v1, F = this._v2, P1 = this._v3;
    const sc = this._fit || 1;   // 大きい卵は鍋の中では縮めて収める
    const lx = fp.x + x0 * sc;
    let lz = fp.z + z0 * sc;
    const zr = -Math.sqrt(Math.max(0, RIM_R * RIM_R - lx * lx));
    // ライスに合わせている間（まだ傾けていない）は、鍋の奥の縁からはみ出した部分も鍋の中に収める。
    // 収めないと、卵を傾ける前から、縁を越えた分の形が先にライスの上に出てしまう（卵が少ないときに目立つ）
    if ((this.phase === 'aim' || this.phase === 'move') && lz <= zr) lz = zr + 0.03;
    if (lz > zr) {
      // 鍋の中：底から側面の曲面にそって、表面の上に寝る
      v.set(lx, panY(Math.hypot(lx, lz)) + 0.014, lz);
      pan.tilt.localToWorld(v);
      out.copy(v).applyMatrix4(this._gi);
      return 0;
    }
    // 縁を越えた：縁の点から、鍋の向きに出て、重力で最終位置へ曲がりながら落ちる（2次ベジェ）
    F.set(fx, fy, fz).applyMatrix4(this._gm);
    v.set(lx, 0.33, zr);
    pan.tilt.localToWorld(v);
    const chord = v.distanceTo(F);
    const t = Math.min(1, (zr - lz) / (chord * 1.1 + 0.15));
    if (this.flat === 'raw') { out.copy(v).applyMatrix4(this._gi); return Math.max(t, 1e-4); }   // 生卵：縁から液体としてこぼれる
    P1.copy(v).addScaledVector(this._dir, Math.min(0.35, chord * 0.45));
    const a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.set(a * v.x + b * P1.x + c * F.x, a * v.y + b * P1.y + c * F.y, a * v.z + b * P1.z + c * F.z).applyMatrix4(this._gi);
    return Math.max(t, 1e-4);
  };

  /** 生卵が縁からライスへ流れ落ちる、卵液の流れ。卵が少なくても、最低1秒は流れている様子を見せる */
  Plating.prototype.updateRawStream = function (dt) {
    const S = this.fsim;
    if (!this.rawStream) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true),
        new THREE.MeshPhysicalMaterial({ color: 0xf2b830, roughness: 0.08, transparent: true, opacity: 0.88, side: THREE.DoubleSide, clearcoat: 1 }));
      m.material.userData.lin = true; m.visible = false; m.frustumCulled = false;
      this.K.scene.add(m);
      this.rawStream = m; this.rawStreamT = 0;
    }
    const m = this.rawStream;
    if (this.flat !== 'raw' || !S || !S.started) { m.visible = false; this.rawStreamT = 0; return; }
    this.rawStreamT += dt;
    const show = !this.flatDone || this.rawStreamT < 1.0;
    m.visible = show;
    if (!show) return;
    const pan = this.pan;
    pan.root.updateMatrixWorld(true);
    const A = new THREE.Vector3(0, 0.33, -RIM_R * 0.98); pan.tilt.localToWorld(A);
    const bx = this.panX, bz = this.panZ - 0.8;
    const B = new THREE.Vector3(bx, this.K.surfaceY(bx, bz) + 0.03, bz);
    const d = B.clone().sub(A), len = d.length();
    if (len < 0.02) { m.visible = false; return; }
    const r = (0.018 + 0.012 * Math.min(3, this.run.prep.eggs)) * (1 + 0.15 * Math.sin(this.rawStreamT * 35));
    m.position.copy(A).addScaledVector(d, 0.5);
    m.scale.set(r, len, r);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };

  Plating.prototype.flatStep = function () {
    const pan = this.pan, om = pan.omelette, g = om.group, S = this.fsim;
    if (!S || !om.fgeo) return;
    // 落ちる場所（黄色い丸）：卵の中心。皿の外なら縁へ寄せる
    const P = this.K.POS.plate;
    let tx = this.panX, tz = this.panZ - 0.8;
    const rr = Math.hypot(tx - P.x, tz - P.z);
    S.missed = rr > 1.0;
    if (S.missed) { tx = P.x + ((tx - P.x) * 1.0) / rr; tz = P.z + ((tz - P.z) * 1.0) / rr; }
    const yaw = pan.yaw;
    g.position.set(tx, this.K.surfaceY(tx, tz), tz);
    g.rotation.set(0, yaw, 0);
    g.updateMatrixWorld(true);
    pan.root.updateMatrixWorld(true);
    this._gm.copy(g.matrixWorld);
    this._gi.copy(this._gm).invert();
    // 鍋の向き（奥＝縁の方向）を世界座標で
    { const e = pan.tilt.matrixWorld.elements; this._dir.set(-e[8], -e[9], -e[10]).normalize(); }
    const key = tx.toFixed(3) + '|' + tz.toFixed(3) + '|' + yaw.toFixed(3);
    if (key !== this._fkey || !om.fFinal || om.fFinal.length !== om.fpos.length) {
      om.fFinal = new Float32Array(om.fpos.length);
      om.fillFried(om.fFinal);
      this._fkey = key;
      // 面積の重み（外側ほど大きい）
      const AS = om.fAS, RS = om.fRS;
      if (!S.w || S.w.length !== (RS + 1) * AS + 1) {
        S.w = new Float32Array((RS + 1) * AS + 1);
        let tot = 0;
        for (let r = 0; r <= RS; r++) for (let a = 0; a < AS; a++) { const w = Math.max(0.3, r); S.w[r * AS + a] = w; tot += w; }
        S.w[(RS + 1) * AS] = 0.3; tot += 0.3;
        S.totalW = tot;
        S.gone = new Uint8Array(S.w.length);
      }
    }
    this._fit = Math.min(1, 1.05 / (Math.max(om.fRx, om.fRz) * 1.08));
    const nV = (om.fRS + 1) * om.fAS, Pn = om.fpos, Fn = om.fFinal, rx = om.frestX, rz = om.frestZ;
    const out = new THREE.Vector3();
    let notDone = 0, crossedW = 0;
    const newly = [];
    for (let i = 0; i <= nV; i++) {
      const k = i * 3;
      const t = this.flatPoint(rx[i], rz[i], Fn[k], Fn[k + 1], Fn[k + 2], out);
      if (t > 0) crossedW += S.w[i];
      if (this.flat === 'raw') {
        if (t > 0.02 && !S.gone[i]) { S.gone[i] = 1; newly.push(i); }
        if (!S.gone[i]) notDone++;
      } else if (t < 1) notDone++;
      Pn[k] = out.x; Pn[k + 1] = out.y; Pn[k + 2] = out.z;
    }
    om.fgeo.attributes.position.needsUpdate = true;
    om.fgeo.computeVertexNormals();
    om.fgeo.computeBoundingSphere();
    // 黄身：卵の表面の上に、表面の向きにのせる
    const q = new THREE.Quaternion(), n = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3(), b1 = new THREE.Vector3(), b2 = new THREE.Vector3();
    for (const m of om.fYolks || []) {
      const x0 = m.userData.off[0], z0 = m.userData.off[1];
      const f = this.yolkFinal(x0, z0);
      this.flatPoint(x0, z0, f.x, f.y, f.z, out);
      const e = 0.06;
      this.flatPoint(x0 + e, z0, f.x + e, f.y, f.z, a1);
      this.flatPoint(x0 - e, z0, f.x - e, f.y, f.z, a2);
      this.flatPoint(x0, z0 + e, f.x, f.y, f.z + e, b1);
      this.flatPoint(x0, z0 - e, f.x, f.y, f.z - e, b2);
      n.copy(a1).sub(a2).cross(b1.sub(b2));
      n.negate();
      if (n.y < 0) n.negate();
      if (n.lengthSq() > 1e-8) { n.normalize(); q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); m.quaternion.copy(q); }
      m.position.copy(out).addScaledVector(n.lengthSq() > 0 ? n : new THREE.Vector3(0, 1, 0), 0.012);
    }
    // ---- 縁を越えはじめたら
    if (!S.started && crossedW > 0) {
      S.started = true;
      pan.served = true;   // もう鍋の中は空になっていく：焼ける音を止める
      this.audio.play('shake', 0.4);
      if (this.flat === 'raw') {
        om.group.visible = false;   // 落ちてくる卵を高さに入れない
        window.PKG.sauce.ensureBase(true);
        om.group.visible = true;
        this.audio.play('pour', 1);
      }
    }
    S.crossedFrac = crossedW / (S.totalW || 1);
    // 生卵：縁を越えた分だけ液体としてライスへ
    if (this.flat === 'raw' && newly.length) {
      const G = window.PKG, R = this.raw;
      let w = 0; for (const i of newly) w += S.w[i];
      const dv = R.total * (w / S.totalW);
      const pick = Math.min(6, newly.length);
      for (let c = 0; c < pick; c++) {
        const i = newly[Math.floor(Math.random() * newly.length)], k = i * 3;
        const wp = new THREE.Vector3(Fn[k], Fn[k + 1], Fn[k + 2]).applyMatrix4(this._gm);
        G.sauce.deposit(wp.x + (Math.random() - 0.5) * 0.08, wp.z + (Math.random() - 0.5) * 0.08, dv / pick, RAW_EGG);
      }
      G.sauce.rawEggVol = (G.sauce.rawEggVol || 0) + dv;
      R.done += dv;
    }
    if (S.started && notDone === 0) this.flatFinish();
  };

  /** 黄身の最終位置（卵の表面の上）：Omelette の最終形と同じ高さの取り方 */
  Plating.prototype.yolkFinal = function (x, z) {
    const om = this.pan.omelette;
    const d = 0.05;
    const h = Math.max(om.surfaceLocal(x, z), om.surfaceLocal(x + d, z), om.surfaceLocal(x - d, z), om.surfaceLocal(x, z + d), om.surfaceLocal(x, z - d)) + 0.03;
    return { x, y: h + 0.01, z };
  };

  /** 縁を越えきった：皿の上にのった（これまでと同じ、のせた卵の形） */
  Plating.prototype.flatFinish = function () {
    if (this.flatDone) return;
    this.flatDone = true;
    const pan = this.pan, om = pan.omelette, run = this.run, S = this.fsim;
    om.endFlatSim();
    om.dirty = true;
    pan.tPitch = 0;
    run.plate.landed = true; run.plate.impact = 0.3; run.plate.squash = 0;
    if (S.missed) run.plate.missed = true;
    this.baseSquash = 0; this.bounceAmp = 0; this.bounceT = 9;
    if (this.flat === 'raw') {
      run.plate.broken = true;
      om.group.visible = false;
    } else {
      this.audio.play('plop', 0.6);
      if (this.rawLook) { om.yolkSlide = true; pan.say('生卵がのった！ 黄身がころころ…', 'bad'); }
      else pan.say(this.flat === 'fried' ? 'ぺたん、と目玉焼きがのった' : '薄焼き卵がふわっとのった', 'good');
    }
    this.phase = 'landed';
    this.backT = 0; this.backFrom = pan.root.position.clone(); pan.yaw = 0;
    this.measure();
    if (this.onPhase) this.onPhase('landed');
  };

  Plating.prototype.dragStart = function (ndc, camera) {
    if (this.phase === 'pour') { this.dragging = true; this.grab = null; return true; }   // 上下ドラッグで傾ける
    if (this.phase === 'aim') {
      // フライパン（柄）をつかむ：つかんだ点とフライパンの位置関係を保ったまま動かす
      const hit = this.pickPan(ndc, camera);
      this.dragging = true;
      this.grab = null;
      this.grabPan = hit ? new THREE.Vector3(hit.x - this.panX, 0, hit.z - this.panZ) : null;
      return true;
    }
    // 皿に乗せたあとは、卵の位置は動かせない
    return false;
  };
  Plating.prototype.dragMove = function (dx, dy, ndc, camera, sens) {
    if (!this.dragging) return;
    const pan = this.pan;
    if (this.phase === 'pour') {
      // 横から見ながら、上へドラッグで奥へ傾ける
      pan.tPitch = U.clamp(pan.tPitch - dy * 0.3 * DEG * sens, 0, 80 * DEG);
    } else if (this.phase === 'aim') {
      const hit = this.grabPan && this.pickPan(ndc, camera);
      if (hit) { this.panX = hit.x - this.grabPan.x; this.panZ = hit.z - this.grabPan.z; }
      else { this.panX += dx * 0.006 * sens; this.panZ += dy * 0.006 * sens; }
      this.clampPan();
    }
  };
  Plating.prototype.dragEnd = function () { this.dragging = false; };

  Plating.prototype.afterMove = function (moved) {
    const om = this.pan.omelette;
    om.group.position.y = this.K.surfaceY(om.group.position.x, om.group.position.z);
    om.dirty = true;
    const soft = 1 - this.pan.fold.fs;
    this.run.plate.nudge += moved;
    // 柔らかい卵を何度も動かすと皮が傷む
    this.pan.fold.tear = Math.min(1, this.pan.fold.tear + moved * soft * 0.04);
    this.measure();
  };

  Plating.prototype.rotate = function (deg) {
    if (this.phase === 'pour' || this.phase === 'move' || this.phase === 'aim') { this.yaw = U.clamp(deg, -45, 45); this.pan.yaw = this.yaw * DEG; }
    // 皿に乗せたあとは、向きも変えられない
  };
  Plating.prototype.setTilt = function (deg) { if (this.phase === 'pour') this.pan.tPitch = deg * DEG; };
  /** 位置を決めたら、横から見る視点で傾ける段階へ */
  Plating.prototype.confirm = function () {
    if (this.phase !== 'aim') return;
    this.phase = 'pour';
    this.pan.tPitch = 0;
    this.slideV = 0;
    if (this.onPhase) this.onPhase('pour');
  };
  Plating.prototype.backToAim = function () {
    if (this.phase !== 'pour' || this.slideV < -0.05) return;
    if (this.flat && this.fsim && Math.abs(this.pan.foldPos.z - this.fsim.startZ) > 0.02) return;   // 卵が動き出したら、位置の決め直しはできない
    this.phase = 'aim';
    this.pan.tPitch = 0;
    if (this.onPhase) this.onPhase('aim');
  };

  /** フライパンの高さの水平面上の点 */
  Plating.prototype.pickPan = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.45);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(pl, p) ? p : null;
  };
  Plating.prototype.clampPan = function () {
    const P = this.K.POS.plate;
    this.panX = U.clamp(this.panX, P.x - 1.6, P.x + 1.6);
    this.panZ = U.clamp(this.panZ, P.z + 0.3, P.z + 2.2);
  };
  /** ライスに寄せるほど、自然に奥へ傾く */
  Plating.prototype.autoTilt = function () {
    const d = this.panZ - this.K.POS.plate.z;
    return 70 * DEG * U.smooth(1.85, 0.6, d);
  };

  Plating.prototype.pick = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    this.plane.constant = -(this.K.PLATE_TOP + 0.45);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p) ? p : null;
  };

  /** 皿の上での出来を測る */
  Plating.prototype.measure = function () {
    const om = this.pan.omelette, g = om.group, P = this.K.POS.plate, R = this.K.RICE;
    const pl = this.run.plate;
    const dx = g.position.x - P.x, dz = g.position.z - P.z;
    pl.offset = Math.hypot(dx / R.ra, dz / R.rb);
    let yaw = ((g.rotation.y % Math.PI) + Math.PI) % Math.PI;
    if (yaw > Math.PI / 2) yaw = Math.PI - yaw;
    pl.yawErr = yaw / DEG;
    // ライスの長さに対してオムレツがどれだけ覆えるか（向きずれとはみ出しも考慮）
    const effLen = om.L * Math.cos(yaw) + om.W * Math.sin(yaw) * 0.5;
    pl.coverage = U.clamp(effLen / (R.ra * 2), 0, 1.3) * U.clamp(1 - Math.max(0, pl.offset - 0.15) * 0.8, 0, 1);
    pl.onRice = this.K.onRice(g.position.x, g.position.z) ? 1 : 0;
  };

  Plating.prototype.update = function (dt) {
    const pan = this.pan, om = pan.omelette, fold = pan.fold;
    this.t += dt;
    if (this.mark && this.phase !== 'aim' && this.phase !== 'pour') this.mark.visible = false;
    this.updateRawStream(dt);
    const keys = this.keys;
    if (this.phase === 'move') {
      const k = U.easeInOut(U.clamp(this.t / 1.0, 0, 1));
      pan.root.position.lerpVectors(this.from, this.to, k);
      if (this.flat) this.flatStep();
      if (this.t >= 1.0) { this.phase = 'aim'; if (this.onPhase) this.onPhase('aim'); }
    } else if (this.phase === 'aim' || this.phase === 'pour') {
      if (this.phase === 'aim') {
        if (keys.left) this.panX -= dt * 1.2;
        if (keys.right) this.panX += dt * 1.2;
        if (keys.up) this.panZ -= dt * 1.0;
        if (keys.down) this.panZ += dt * 1.0;
        this.clampPan();
        pan.tPitch = 0;
      } else {
        if (keys.up) pan.tPitch = Math.min(80 * DEG, pan.tPitch + dt * 45 * DEG);
        if (keys.down) pan.tPitch = Math.max(0, pan.tPitch - dt * 45 * DEG);
      }
      if (keys.rotL) this.rotate(this.yaw - dt * 40);
      if (keys.rotR) this.rotate(this.yaw + dt * 40);
      const target = new THREE.Vector3(this.panX, 1.25 + Math.sin(pan.pitch) * 0.4, this.panZ);
      pan.root.position.lerp(target, 1 - Math.exp(-dt * 10));
      // 落ちる場所の目印（奥の縁の真下）
      if (this.mark) {
        this.mark.visible = this.phase === 'aim' || this.phase === 'pour';   // 落とす場所の目印は、ライスに合わせる間だけ出す
        // 傾けるときは本物のフライパンと卵の向こう側に隠れる（卵の上に輪が透けて見えない）
        const dt = this.phase === 'aim';
        this.mark.children.forEach((m) => { if (m.material.depthTest !== dt) { m.material.depthTest = dt; m.material.needsUpdate = true; } });
        const mx = this.panX, mz = this.panZ - 0.8;   // 卵が落ちる場所（奥の縁を越えたところ）
        this.mark.position.set(mx, this.K.surfaceY(mx, mz) + 0.02, mz);
      }
      pan.setGhost(this.phase === 'aim');
      if (this.phase === 'aim') {
        if (this.flat) { this.flatStep(); om.update(dt); return; }
        om.group.position.set(pan.foldPos.x, 0.004, pan.foldPos.z); om.dirty = true; om.update(dt); return;
      }
      // フライパンの中でオムレツが縁へ滑る
      const fp = pan.foldPos;
      const stick = pan.stickiness();
      const soft = 1 - fold.fs;
      const thresh = 16 * DEG + stick * 22 * DEG + soft * 6 * DEG; // 傾き始めのしきい値
      if (pan.pitch > thresh || this.slideV < -0.05) {
        const a = GRAV * 0.12 * (Math.sin(pan.pitch) - Math.sin(thresh) * 0.8);
        this.slideV -= Math.max(0, a) * dt;
      }
      this.slideV *= Math.exp(-dt * (1 + stick * 3));
      if (this.flat && this.fsim) {
        // 半分近く縁を越えたら、残りの重みで引っぱられて最後までするっと出ていく
        const cf = this.fsim.crossedFrac || 0;
        if (cf > 0.3 && pan.pitch > thresh * 0.8) this.slideV = Math.min(this.slideV, -0.45);
        if (cf > 0.85) this.slideV = Math.min(this.slideV, -0.8);
      }
      fp.z += this.slideV * dt;
      fp.x = U.lerp(fp.x, 0, 1 - Math.exp(-dt * 2));
      if (this.flat) { this.flatStep(); om.update(dt); return; }
      // 縁に近づいたら、フライパンの側面に沿って持ち上がり、少し反りながら滑る（側面を突き抜けない）
      const lead = -fp.z + om.W * 0.45;          // 奥側の端までの距離
      const over = Math.max(0, lead - 1.0);
      const climb = Math.min(0.3, over * 1.38);
      om.group.position.set(fp.x, 0.004 + climb * 0.75, fp.z);
      om.group.rotation.set(Math.min(0.55, over * 1.6), 0, 0);
      om.squash = Math.min(0.18, over * 0.25 * (1 - fold.fs));
      om.dirty = true;
      if (fp.z < -1.12) this.release();
    } else if (this.phase === 'raw') {
      this.updateRawPour(dt);
      return;
    } else if (this.phase === 'fall') {
      const g = om.group;
      this.vel.y -= GRAV * dt;
      g.position.addScaledVector(this.vel, dt);
      // 落ちながら水平に戻る
      g.rotation.x = U.lerp(g.rotation.x, 0, 1 - Math.exp(-dt * 5));
      g.rotation.z = U.lerp(g.rotation.z, 0, 1 - Math.exp(-dt * 5));
      const sy = this.K.surfaceY(g.position.x, g.position.z);
      if (g.position.y <= sy) this.land(sy);
      // フライパンは戻す
      pan.tPitch = 0;
    } else if (this.phase === 'landed') {
      if (this.run.raw && (this.rawFlowT = (this.rawFlowT || 0) + dt) < 6) { window.PKG.sauce.update(dt); window.PKG.sauce.update(dt); }
      this.onPlateT += dt;
      fold.carryOver(dt, this.onPlateT);
      // 着地のぷるん
      if (this.bounceT < 0.8) {
        this.bounceT += dt;
        const b = Math.exp(-this.bounceT * 6) * Math.sin(this.bounceT * 30) * this.bounceAmp;
        om.squash = U.clamp(this.baseSquash + b, 0, 0.6);
        om.dirty = true;
      }
      if (this.backT < 1) {
        this.backT = Math.min(1, this.backT + dt);
        pan.root.position.lerpVectors(this.backFrom, pan.home, U.easeInOut(this.backT));
        if (this.backT >= 1) pan.mode = 'stove';
      }
      this.lookT = (this.lookT || 0) - dt;
      if (this.lookT <= 0) { this.lookT = 0.5; om.setLook({ fs: fold.fs, br: fold.br, lf: fold.liquidFrac(), uniformity: fold.uniformity }); }
    }
    if (this.phase !== 'landed' && this.phase !== 'fall') { om.dirty = true; }
    om.update(dt);
  };

  /** 火の通っていない卵：形にならず、液体のままライスへ流れ落ちる（ソースと同じ液体の計算） */
  const RAW_EGG = { name: '卵液', color: '#f2a414', sig: 0.13, hy: 0.0045, K: 260 };
  Plating.prototype.startRawPour = function () {
    const G = window.PKG, om = this.pan.omelette;
    om.group.visible = false;
    this.K.scene.attach(om.group);
    const tx = this.panX, tz = this.panZ - 0.8;
    om.group.position.set(tx, this.K.surfaceY(tx, tz), tz);
    om.group.rotation.set(0, 0, 0);
    G.sauce.ensureBase(true);
    const total = Math.min(0.16, Math.max(0.04, this.run.prep.eggs * 0.034));
    this.raw = { t: 0, total, done: 0, tx, tz }; this.rawFlowT = 0;
    this.phase = 'raw';
    this.audio.play('pour', 1);
  };
  Plating.prototype.updateRawPour = function (dt) {
    const G = window.PKG, R = this.raw;
    R.t += dt;
    const want = R.total * Math.min(1, R.t / 1.2);
    const dv = want - R.done;
    if (dv > 0) {
      // フライパンの縁から「ばーっ」と幅をもって流れ落ちる：ライスの上を横切るように落とす
      const sweep = Math.sin(R.t * 5) * 0.35;
      for (let i = 0; i < 6; i++) {
        const xx = R.tx + sweep + (Math.random() - 0.5) * 0.5, zz = R.tz + (Math.random() - 0.5) * 0.35;
        G.sauce.deposit(xx, zz, dv / 6, RAW_EGG);
      }
      G.sauce.rawEggVol = (G.sauce.rawEggVol || 0) + dv;
      R.done = want;
    }
    G.sauce.update(dt);
    this.pan.tPitch = 0;
    if (R.t > 1.3) {
      const run = this.run;
      run.plate.landed = true; run.plate.impact = 0; run.plate.squash = 0; run.plate.broken = true;
      this.phase = 'landed';
      this.backT = 0; this.backFrom = this.pan.root.position.clone(); this.pan.yaw = 0;
      this.bounceT = 9;
      this.measure();
      if (this.onPhase) this.onPhase('landed');
    }
  };

  Plating.prototype.release = function () {
    this.pan.setGhost(false);
    if (this.mark) this.mark.visible = false;
    const pan = this.pan, om = pan.omelette;
    pan.served = true;   // もう中は空：焼ける音を止める
    const g = om.group;
    if (this.run.raw) { this.startRawPour(); return; }
    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    g.getWorldPosition(wp); g.getWorldQuaternion(wq);
    this.K.scene.attach(g);
    g.position.copy(wp);
    // 進行方向：フライパンの奥（-z）方向
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(pan.tilt.getWorldQuaternion(new THREE.Quaternion()));
    // 縁から転がり落ちて、目印（黄色い丸）の場所に着地する
    const tx = this.panX, tz = this.panZ - 0.8;
    const fallH = Math.max(0.2, g.position.y - this.K.surfaceY(tx, tz));
    const T = Math.sqrt((2 * fallH) / GRAV);
    this.vel.set((tx - g.position.x) / T, 0, (tz - g.position.z) / T);
    void dir;
    const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
    g.rotation.set(e.x, pan.yaw, e.z, 'XYZ');
    g.rotation.y = pan.yaw;
    this.phase = 'fall';
    this.audio.play('shake', 0.4);
  };

  Plating.prototype.land = function (sy) {
    const pan = this.pan, om = pan.omelette, fold = pan.fold, run = this.run;
    const g = om.group;
    const P = this.K.POS.plate;
    // 皿の外に落ちそうなら縁で止まって内側へ
    const r = Math.hypot(g.position.x - P.x, g.position.z - P.z);
    if (r > 1.0) {
      g.position.x = P.x + ((g.position.x - P.x) * 1.0) / r;
      g.position.z = P.z + ((g.position.z - P.z) * 1.0) / r;
      run.plate.missed = true;
    }
    g.position.y = this.K.surfaceY(g.position.x, g.position.z);
    g.rotation.set(0, g.rotation.y, 0);
    const vy = Math.abs(this.vel.y);
    const soft = U.clamp(1 - fold.fs, 0, 1);
    const impact = vy * (0.3 + soft);
    om.surfaceWorld = this.K.coverY;
    om.sag = 1;   // 重力：支えのない所は皿まで垂れる（端が宙に浮かない）
    this.baseSquash = U.clamp(vy * soft * 0.03, 0, 0.42);
    om.squash = this.baseSquash;
    this.bounceAmp = 0.05 + soft * 0.08;
    this.bounceT = 0;
    om.dirty = true;
    run.plate.landed = true;
    run.plate.impact = impact;
    run.plate.squash = this.baseSquash;
    // 柔らかすぎる卵が勢いよく落ちると崩れる
    if (impact > 6.2 && fold.liquidFrac() > 0.25) {
      run.plate.broken = true;
      const NU = PK.Omelette.NU;
      const oL = new Float32Array(NU + 1), oR = new Float32Array(NU + 1);
      for (let i = 0; i <= NU; i++) { const u = -1 + (2 * i) / NU; const w = Math.max(0, 1 - Math.abs(u - 0.2) * 1.6); oL[i] = 0.35 * w; oR[i] = 0.22 * w; }
      om.startOpen({ openL: oL, openR: oR, tear: 0.6, runnyAmount: fold.liquidFrac() * 0.8, runnySpread: 0.6, runnyFlow: 0.5, duration: 0.8 });
      fold.tear = Math.min(1, fold.tear + 0.5);
      this.audio.play('tear');
      pan.say('落とした勢いで卵が崩れてしまった', 'bad');
    } else {
      this.audio.play('plop', 0.6 + soft * 0.4);
      pan.say(soft > 0.5 ? 'ふるん、と着地！' : 'しっかりした卵が着地', 'good');
    }
    this.phase = 'landed';
    if (this.onPhase) this.onPhase('landed');
    this.backT = 0;
    this.backFrom = pan.root.position.clone();
    pan.yaw = 0;
    this.measure();
  };

  Plating.prototype.info = function () {
    const pan = this.pan;
    return {
      phase: this.phase,
      tilt: pan.pitch / DEG,
      yaw: this.phase === 'landed' ? pan.omelette.group.rotation.y / DEG : this.yaw,
      plate: this.run.plate,
    };
  };

  PK.Plating = Plating;
})();
