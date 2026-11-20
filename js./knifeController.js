/* PAKKAAAN! — ナイフで「ぱっかーーん」
 *  刃はオムレツの長さ方向にまっすぐ進むよう補正（横ぶれは小さく抑える）。
 *  刃を動かす速さで切り込みの深さが決まる：
 *    ゆっくりすぎ → 浅く皮がよれて開かない／ちょうどいい → きれいに開く／
 *    速く力強い → 底まで切れて左右にどーんと開く。
 *  切り始めの位置・中心からのずれ・切った長さ・刃の傾き・卵の状態も判定に使う。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;
  const DEG = Math.PI / 180;

  // オムレツ何本分/秒。ゆっくりは慎重なので失敗にしない。速すぎると刃が滑って切れない
  const SPEED = { lo: 0, hi: 2.2, through: 3.0, skid: 4.2, max: 5 };

  function KnifeController(K, pan, audio) {
    this.K = K; this.pan = pan; this.audio = audio;
    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const knife = (this.knife = new THREE.Group());
    const inner = (this.knifeInner = new THREE.Group());
    knife.add(inner);
    const sh = new THREE.Shape();
    sh.moveTo(0, 0);
    sh.lineTo(1.05, 0);
    sh.quadraticCurveTo(1.35, 0.02, 1.45, 0.16);
    sh.lineTo(0.0, 0.26);
    sh.closePath();
    const blade = new THREE.Mesh(
      new THREE.ExtrudeGeometry(sh, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }),
      new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.18 })
    );
    blade.geometry.translate(-1.0, 0, -0.007);
    blade.castShadow = true;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.15, 0.07), new THREE.MeshStandardMaterial({ color: 0x2b1c14, roughness: 0.45 }));
    handle.position.set(-1.38, 0.15, 0);
    handle.castShadow = true;
    const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 1, roughness: 0.2 }));
    rivet.rotation.x = Math.PI / 2; rivet.position.set(-1.22, 0.15, 0);
    const rivet2 = rivet.clone(); rivet2.position.x = -1.52;
    inner.add(blade, handle, rivet, rivet2);
    knife.visible = false;
    K.scene.add(knife);

    // 切り口（リボン）
    this.MAXP = 400;
    const rg = new THREE.BufferGeometry();
    this.slitPos = new Float32Array(this.MAXP * 2 * 3);
    const idx = [];
    for (let i = 0; i < this.MAXP - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    rg.setAttribute('position', new THREE.BufferAttribute(this.slitPos, 3));
    rg.setIndex(idx);
    rg.setDrawRange(0, 0);
    this.slitGeo = rg;
    this.slit = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xb56a10, side: THREE.DoubleSide }));
    this.slit.frustumCulled = false;
    this.tiltDeg = 20;
    this.liveSpeed = 0;

    // 切る線の目印（オムレツの上に点線）
    this.DASH = 22;
    const gg = new THREE.BufferGeometry();
    this.guidePos = new Float32Array(this.DASH * 4 * 3);
    const gi = [];
    for (let d = 0; d < this.DASH; d++) { const a = d * 4; gi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    gg.setAttribute('position', new THREE.BufferAttribute(this.guidePos, 3));
    gg.setIndex(gi);
    this.guideGeo = gg;
    const gm = new THREE.MeshBasicMaterial({ color: 0xff3b2a, transparent: true, opacity: 0.95, depthTest: false, side: THREE.DoubleSide });
    gm.userData.lin = true;
    this.guide = new THREE.Mesh(gg, gm);
    this.guide.renderOrder = 8;
    this.guide.frustumCulled = false;
    this.guide.visible = false;
  }

  /** 切る線（点線）をオムレツの上、横位置 z に描く */
  KnifeController.prototype.updateGuide = function (z) {
    const L = this.om.L, n = this.DASH, w = 0.016, P = this.guidePos;
    for (let d = 0; d < n; d++) {
      const x0 = -L * 0.48 + (L * 0.96 * d) / n, x1 = x0 + (L * 0.96) / n * 0.6;
      const y0 = this.om.topAt(x0) + 0.02, y1 = this.om.topAt(x1) + 0.02;
      const k = d * 12;
      P[k] = x0; P[k + 1] = y0; P[k + 2] = z - w;
      P[k + 3] = x0; P[k + 4] = y0; P[k + 5] = z + w;
      P[k + 6] = x1; P[k + 7] = y1; P[k + 8] = z - w;
      P[k + 9] = x1; P[k + 10] = y1; P[k + 11] = z + w;
    }
    this.guideGeo.attributes.position.needsUpdate = true;
    this.guide.visible = true;
  };

  KnifeController.prototype.enter = function (run) {
    this.run = run;
    this.om = this.pan.omelette;
    this.om.group.add(this.slit);
    this.om.group.add(this.guide);
    this.slit.visible = true;
    this.slitGeo.setDrawRange(0, 0);
    this.state = 'aim';
    this.path = [];
    this.updateGuide(0);
    this.knife.visible = true;
    this.knife.position.set(this.om.group.position.x + 1.6, this.om.group.position.y + 1.2, this.om.group.position.z + 0.8);
    this.knifeYaw = this.om.group.rotation.y;
    this.cur = this.knife.position.clone();
    this.tgt = this.cur.clone();
    this.liveSpeed = 0;
    const f = this.pan.fold;
    run.omelette = { V: f.V, lf: f.liquidFrac(), fs: f.fs, br: f.br, quality: f.quality, tear: f.tear, uniformity: f.uniformity, L: this.om.L, W: this.om.W, H: this.om.H };
  };

  KnifeController.prototype.exit = function () { this.knife.visible = false; this.guide.visible = false; };

  KnifeController.prototype.hit = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    const hits = this.ray.intersectObjects(this.om.outerMeshes, false);
    if (hits.length) return { p: hits[0].point, on: true };
    this.plane.constant = -(this.om.group.position.y + this.om.H * 0.9);
    const p = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(this.plane, p)) return { p, on: false };
    return null;
  };
  KnifeController.prototype.toLocal = function (p) { return this.om.group.worldToLocal(p.clone()); };

  KnifeController.prototype.depthFor = function (speed) { return speed >= SPEED.skid ? 0.06 : speed >= SPEED.through ? 1.0 : 0.62; };

  KnifeController.prototype.hover = function (ndc, camera) {
    if (this.state !== 'aim' && this.state !== 'cutting') return;
    const h = this.hit(ndc, camera);
    if (!h) return;
    const lp = this.toLocal(h.p);
    if (this.state === 'cutting') {
      // まっすぐ補正：横方向のぶれは15%だけ反映
      lp.z = this.z0 + (lp.z - this.z0) * 0.15;
    }
    lp.x = U.clamp(lp.x, -this.om.L * 0.62, this.om.L * 0.62);
    // 切る線の目印：構えている間は指（マウス）に合わせて動く
    if (this.state === 'aim') this.updateGuide(U.clamp(lp.z * 0.6, -this.om.W * 0.4, this.om.W * 0.4));
    const top = this.om.topAt(lp.x);
    const bot = this.om.bottomAt(lp.x);
    lp.y = this.state === 'aim' ? top + 0.32 : top - Math.min(1, this.depthFor(this.liveSpeed)) * (top - bot);
    this.tgt.copy(this.om.group.localToWorld(lp.clone()));
    this.lastLocal = lp;
  };

  KnifeController.prototype.down = function (ndc, camera) {
    if (this.state !== 'aim') return false;
    const h = this.hit(ndc, camera);
    if (!h) return false;
    const lp = this.toLocal(h.p);
    if (Math.abs(lp.x) > this.om.L * 0.62 || Math.abs(lp.z) > this.om.W * 0.75) return false;
    this.state = 'cutting';
    this.z0 = lp.z * 0.6;   // 切り始めの横位置も少し中央へ寄せて手助け
    this.liveSpeed = 0;
    this.path = [{ x: lp.x, z: this.z0, t: performance.now() / 1000 }];
    this.hover(ndc, camera);
    // 刃を入れるときは音を鳴らさない
    return true;
  };

  KnifeController.prototype.move = function (ndc, camera) {
    this.hover(ndc, camera);
    if (this.state !== 'cutting') return;
    const lp = this.lastLocal;
    if (!lp) return;
    const last = this.path[this.path.length - 1];
    const now = performance.now() / 1000;
    const d = Math.hypot(lp.x - last.x, lp.z - last.z);
    if (d > 0.012 && this.path.length < this.MAXP) {
      const sp = d / Math.max(0.008, now - last.t) / this.om.L;
      this.liveSpeed = U.lerp(this.liveSpeed, sp, 0.35);
      this.path.push({ x: lp.x, z: lp.z, t: now });
      this.updateSlit();
      // 切っている間も無音
    }
  };

  KnifeController.prototype.updateSlit = function () {
    const P = this.path, n = P.length;
    const w = 0.008 + Math.min(1, this.depthFor(this.liveSpeed)) * 0.016;
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const y = this.om.topAt(P[i].x) + 0.006;
      const k = i * 6;
      this.slitPos[k] = P[i].x - dz * w; this.slitPos[k + 1] = y; this.slitPos[k + 2] = P[i].z + dx * w;
      this.slitPos[k + 3] = P[i].x + dz * w; this.slitPos[k + 4] = y; this.slitPos[k + 5] = P[i].z - dx * w;
    }
    this.slitGeo.attributes.position.needsUpdate = true;
    this.slitGeo.setDrawRange(0, Math.max(0, (n - 1) * 6));
  };

  KnifeController.prototype.up = function () {
    if (this.state !== 'cutting') return null;
    this.audio.slice(0);
    const P = this.path;
    let len = 0;
    for (let i = 1; i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    if (len < this.om.L * 0.12) {
      this.state = 'aim';
      this.slitGeo.setDrawRange(0, 0);
      return { retry: true, text: 'もっと長く、卵の端から端へ刃を滑らせて' };
    }
    const r = this.evaluate(P, len);
    this.run.cut = r;
    this.state = 'opening';
    this.om.startOpen(r.open);
    this.slit.visible = false;
    this.guide.visible = false;
    if (r.grade === 'great' || r.grade === 'through') this.audio.play('pak', 1.2);
    else if (r.grade === 'good') this.audio.play('pak', 0.7);
    else if (r.grade === 'close') this.audio.play('pak', 0.5);   // 開いたら拍手
    else this.audio.play('fail');
    return r;
  };

  KnifeController.prototype.evaluate = function (P, len) {
    const om = this.om, NU = PK.Omelette.NU;
    const egg = this.run.omelette;
    const halfL = om.L / 2, halfW = om.W / 2;
    const cov = new Float32Array(NU + 1);
    let wSum = 0, wSq = 0, wN = 0, firstU = null;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      const seg = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(seg / 0.01));
      for (let s = 0; s <= steps; s++) {
        const x = U.lerp(a.x, b.x, s / steps), z = U.lerp(a.z, b.z, s / steps);
        const u = x / halfL, w = z / halfW;
        if (Math.abs(u) > 1 || Math.abs(w) > 0.9) continue;
        if (firstU === null) firstU = u;
        const i0 = Math.round(((u + 1) / 2) * NU);
        cov[i0] = Math.max(cov[i0], 1 - U.smooth(0.25, 0.75, Math.abs(w)));
        wSum += w; wSq += w * w; wN++;
      }
    }
    const cov2 = new Float32Array(NU + 1);
    for (let i = 0; i <= NU; i++) {
      let m = cov[i];
      for (let d = -2; d <= 2; d++) { const j = i + d; if (j >= 0 && j <= NU) m = Math.max(m, cov[j] * (1 - Math.abs(d) * 0.2)); }
      cov2[i] = m;
    }
    let coverage = 0, cn = 0;
    for (let i = 0; i <= NU; i++) { const u = -1 + (2 * i) / NU; if (Math.abs(u) < 0.85) { coverage += cov2[i]; cn++; } }
    coverage /= cn;
    const meanW = wN ? wSum / wN : 1;
    const sdW = wN ? Math.sqrt(Math.max(0, wSq / wN - meanW * meanW)) : 1;
    const dur = Math.max(0.05, P[P.length - 1].t - P[0].t);
    const speed = len / dur / om.L;
    const startU = firstU === null ? 0 : Math.abs(firstU);
    const tilt = this.tiltDeg;
    const depth = this.depthFor(speed);

    // 卵の状態
    const lf = egg.lf;
    const runny = U.smooth(0.06, 0.42, lf);
    const hard = 1 - U.smooth(0.08, 0.28, lf);          // 火が通りすぎ → オムレツのまま
    const skinWeak = 1 - U.smooth(0.22, 0.5, egg.fs);
    const shellT = U.clamp(0.12 + (1 - lf) * 0.3, 0.12, 0.42);
    const skid = speed >= SPEED.skid;
    const through = !skid && speed >= SPEED.through && coverage > 0.55;

    const speedScore = skid ? 0 : speed <= SPEED.hi ? 1 : U.band(speed, 0, SPEED.hi, 1.6);
    const depthOK = depth < shellT ? (depth / shellT) * 0.35 : 1;
    const startScore = U.smooth(0.3, 0.75, startU);
    const tiltScore = U.band(tilt, 8, 35, 30);
    const centerScore = 1 - U.clamp(Math.abs(meanW) * 1.1, 0, 0.7);
    const qc = U.clamp(Math.pow(coverage, 0.7) * (0.3 + 0.7 * depthOK) * (0.45 + 0.55 * speedScore) *
      (0.8 + 0.2 * startScore) * (0.88 + 0.12 * tiltScore) * centerScore, 0, 1);

    // 開き方
    const depthOpen = depth < shellT ? 0.15 : depth < shellT + 0.05 ? 0.6 : 1;
    let base = depthOpen * (1 - hard * 0.85) * (1 - skinWeak * 0.25) * (0.65 + 0.35 * speedScore);
    if (through) base = Math.max(base, 0.95 - hard * 0.25);   // 底まで切れたら固くても割れて開く
    const sideR = 1 - U.clamp(meanW * 1.4, 0, 0.75);
    const sideL = 1 - U.clamp(-meanW * 1.4, 0, 0.75);
    const uneven = U.clamp((1 - speedScore) * 0.3 + sdW * 0.8, 0, 0.6) * (through ? 0.3 : 1);
    const flip = (Math.round((P[0].x + P[P.length - 1].x) * 100) & 1) ? 1 : -1;
    const oL = new Float32Array(NU + 1), oR = new Float32Array(NU + 1);
    for (let i = 0; i <= NU; i++) {
      const u = -1 + (2 * i) / NU;
      const endT = 0.45 + 0.55 * (1 - U.smooth(0.82, 1.0, Math.abs(u)));
      const partial = cov2[i] > 0.05 ? cov2[i] : 0;
      let L = base * sideL * endT * partial, R = base * sideR * endT * partial;
      if (flip > 0) L *= 1 - uneven; else R *= 1 - uneven;
      oL[i] = U.clamp(L, 0, 1);
      oR[i] = U.clamp(R, 0, 1);
    }
    // 中まで固く焼けたオムレツは開かない代わりに、切れた所が半分ずつ外へ転がる
    const rigid = this.pan.fold.liquidFrac() < 0.06 && this.pan.fold.fs > 0.5;
    if (rigid) for (let i = 0; i <= NU; i++) { const c = cov2[i] > 0.3 ? 1 : 0; oL[i] = c; oR[i] = c; }
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const avgL = avg(oL), avgR = avg(oR);
    const tear = U.clamp(egg.tear * 0.6 + skinWeak * 0.3 + (through ? 0.25 : 0) + hard * 0.2, 0, 1);
    const eggIdeal = U.band(lf, 0.22, 0.5, 0.25) * (1 - skinWeak * 0.45) * (1 - hard * 0.6) * (1 - U.smooth(0.3, 0.8, egg.br) * 0.3);
    const sym = 1 - Math.min(1, Math.abs(avgL - avgR) * 1.6);
    const opened = Math.min(1, (avgL + avgR) / 1.3);
    let score = U.clamp(qc * 0.45 + opened * sym * 0.25 + eggIdeal * 0.3 * Math.min(1, qc * 1.6), 0, 1);
    if (through) score = U.clamp(0.45 + 0.3 * eggIdeal + 0.1 * coverage - hard * 0.25, 0, 0.85);

    let grade;
    if (skid) grade = 'fail';
    else if (through) grade = 'through';
    else if (score > 0.76 && Math.min(avgL, avgR) > 0.6 && runny > 0.5) grade = 'great';
    else if (score > 0.55 && Math.min(avgL, avgR) > 0.35) grade = 'good';
    else if (Math.max(avgL, avgR) > 0.35 || (score > 0.32 && Math.max(avgL, avgR) > 0.22)) grade = 'close';
    else grade = 'fail';

    const why = [];
    if (hard > 0.5) why.push(through ? '火が通りすぎて、とろとろは出ずに真っ二つ' : '中まで火が通ってオムレツのまま。とろとろが出ない');
    if (through && hard <= 0.5) why.push('速く力強く切ったので底まで切れた');
    if (skinWeak > 0.6) why.push('外側が柔らかすぎて皮が破れた');
    if (skid) why.push('速すぎて刃が表面を滑り、切れなかった');
    if (coverage < 0.6) why.push('端から端まで切れていない');
    if (Math.abs(meanW) > 0.25) why.push('中央の線からずれている');
    if (!through && speed > SPEED.hi) why.push('少し速すぎて切り口が乱れた');
    if (startScore < 0.4) why.push('真ん中から切り始めた（端から入れると開きやすい）');
    if (tilt > 45) why.push('刃を寝かせすぎた');
    if (lf > 0.6 && grade !== 'fail') why.push('中がゆるすぎて流れすぎた');

    return {
      grade, score, qc, coverage, depth, shellT, speed, offset: meanW, straight: sdW, startU, tilt,
      avgL, avgR, sym, runny, hard, why, through,
      open: {
        openL: oL, openR: oR, tear,
        reach: through ? 1.15 : 1.02,
        rigid,   // 固く焼けたオムレツは半分ずつ転がる   // 皮はライスを包む分だけ垂れ、皿に大きく広がらない
        runnyAmount: runny * Math.max(avgL, avgR) * (0.4 + 0.6 * coverage) + (through ? 0.15 * runny : 0),
        runnySpread: (0.55 + 0.45 * qc) * (0.6 + 0.4 * runny) * (through ? 1.15 : 1),
        runnyFlow: runny * (0.35 + (through ? 0.55 : 0) + U.smooth(0.5, 0.8, lf) * 0.5),
        duration: grade === 'great' || grade === 'through' ? 1.35 : grade === 'good' ? 1.5 : 1.9,
      },
    };
  };

  KnifeController.prototype.update = function (dt) {
    if (!this.knife.visible) return;
    if (this.state === 'opening' || this.state === 'done') {
      this.tgt.set(this.om.group.position.x + 1.9, this.om.group.position.y + 1.4, this.om.group.position.z + 0.9);
    }
    if (this.state === 'cutting') this.liveSpeed *= Math.exp(-dt * 1.5);
    const k = 1 - Math.exp(-dt * (this.state === 'cutting' ? 30 : 12));
    this.cur.lerp(this.tgt, k);
    this.knife.position.copy(this.cur);
    // 刃は常にオムレツの長さ方向を向く
    this.knifeYaw = U.lerp(this.knifeYaw, this.om.group.rotation.y, 0.2);
    this.knife.rotation.set(0, this.knifeYaw, 0, 'YXZ');
    this.knifeInner.rotation.set(this.tiltDeg * DEG, 0, -(this.state === 'cutting' ? 14 : 24) * DEG);
  };

  KnifeController.SPEED = SPEED;
  PK.KnifeController = KnifeController;
})();
