/* PAKKAAAN! — 準備工程：卵を自分の手で割る・溶く・バターを量る
 *  卵パックの卵を長押しで持ち上げ、ボウルの縁・机・ボウルの中に当てて割る。
 *  当てる速さ（助走）で「弱い / ちょうどいい / 強すぎ」が決まり、
 *  強すぎると潰れて机にこぼれたり殻が入ったりする。縁で割ると中身がとろりと漏れ出し、
 *  卵がボウルの内側にあればボウルへ、外側なら机へ落ちる。指を離すと「ぱかっ」と開く。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;

  const BOWL_TOP = 0.62;
  const RIM_IN = 0.78, RIM_OUT = 0.93, RIM_Y = 0.645;
  const EGG_HALF = 0.12;       // 横向きに持った卵の半分の高さ
  const GRAV = 30;
  const PRESS_T = 0.25;        // 長押しで持ち上げるまでの時間
  // 当てた速さ（シーン単位/秒）のしきい値： [これ未満は弱い, これを超えると潰れる]
  const KNOCK = { rim: [2.4, 9.0], table: [3.0, 11.0], bowl: [2.6, 9.5] };
  const SURF_NAME = { rim: 'ボウルの縁', table: '机', bowl: 'ボウルの底' };

  function bowlInnerR(y) { return 0.3 + 0.53 * Math.pow(U.clamp((y - 0.06) / 0.56, 0, 1), 0.55); }

  function Prep(K, audio) {
    this.K = K; this.audio = audio;
    const scene = K.scene;
    const g = (this.group = new THREE.Group());
    g.position.copy(K.POS.bowl);
    scene.add(g);

    // ボウル（陶器）
    const pts = [];
    for (let i = 0; i <= 12; i++) { const y = 0.06 + (i / 12) * 0.56; pts.push(new THREE.Vector2(bowlInnerR(y), y)); }
    pts.unshift(new THREE.Vector2(0, 0.06));
    pts.push(new THREE.Vector2(0.88, 0.64));
    for (let i = 12; i >= 0; i--) { const y = (i / 12) * 0.6; pts.push(new THREE.Vector2(bowlInnerR(y + 0.06) + 0.05 - (i === 0 ? 0.1 : 0), y)); }
    pts.push(new THREE.Vector2(0, 0));
    const bowlMat = new THREE.MeshPhysicalMaterial({ color: 0xdfe6ea, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
    // ボウル一式（卵液を注ぐときはこのまとまりだけがコンロへ運ばれる）
    const bg = (this.bowlG = new THREE.Group());
    g.add(bg);
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), bowlMat);
    bowl.castShadow = bowl.receiveShadow = true;
    bg.add(bowl);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.012, 6, 80), new THREE.MeshStandardMaterial({ color: 0x23407a }));
    band.rotation.x = Math.PI / 2; band.position.y = 0.6;
    bg.add(band);

    // 卵液（上から見える面）
    this.liqCanvas = document.createElement('canvas');
    this.liqCanvas.width = this.liqCanvas.height = 256;
    this.liqTex = new THREE.CanvasTexture(this.liqCanvas);
    this.liqTex.encoding = THREE.sRGBEncoding;
    this.liqMat = new THREE.MeshPhysicalMaterial({ map: this.liqTex, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.96 });
    this.liquid = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.liqMat);
    this.liquid.rotation.x = -Math.PI / 2;
    this.liquid.visible = false;
    bg.add(this.liquid);

    // 黄身
    this.yolkMat = new THREE.MeshPhysicalMaterial({ color: 0xff9d14, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
    this.whiteMat = new THREE.MeshPhysicalMaterial({ color: 0xfff6dc, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.55, depthWrite: false });
    this.yolks = [];
    for (let i = 0; i < 12; i++) {
      const y = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), this.yolkMat);
      y.scale.y = 0.62; y.visible = false;
      bg.add(y);
      this.yolks.push(y);
    }
    // 泡
    this.foamMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshPhysicalMaterial({ color: 0xfff6d8, roughness: 0.1, transparent: true, opacity: 0.75, clearcoat: 1 }), 60);
    this.foamMesh.count = 0;
    bg.add(this.foamMesh);

    // 卵のパック（ふたを開けた状態）
    this.shellMat = new THREE.MeshStandardMaterial({ color: 0xf1dcc0, roughness: 0.55, side: THREE.DoubleSide });
    this.carton = new THREE.Group();
    this.cartonOff = new THREE.Vector3().subVectors(K.POS.carton, K.POS.bowl);
    this.carton.position.copy(this.cartonOff);
    this.carton.rotation.y = Math.PI / 2;
    g.add(this.carton);
    const pulp = new THREE.MeshStandardMaterial({ color: 0xb8a98e, roughness: 0.95 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 1.6), pulp);
    tray.position.y = 0.07; tray.castShadow = tray.receiveShadow = true;
    this.carton.add(tray);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 1.6), pulp);
    lid.position.set(0.48, 0.2, 0); lid.rotation.z = -1.25;
    lid.castShadow = true;
    this.carton.add(lid);
    this.cartonEggs = [];
    for (let i = 0; i < 10; i++) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), this.shellMat);
      e.scale.set(0.12, 0.155, 0.12);
      e.position.set(i % 2 ? 0.14 : -0.14, 0.24, -0.62 + Math.floor(i / 2) * 0.31);
      e.castShadow = true;
      e.userData.home = e.position.clone();
      this.carton.add(e);
      this.cartonEggs.push(e);
    }

    // 卵の真下の影（どこに落ちるかの目印）
    this.dropMark = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    this.dropMark.rotation.x = -Math.PI / 2;
    this.dropMark.visible = false;
    this.dropMark.material.userData.lin = true;
    this.group.add(this.dropMark);
    // 手に持つ卵
    this.held = new THREE.Group();
    const he = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.shellMat);
    he.scale.set(0.12, 0.155, 0.12);
    he.rotation.z = Math.PI / 2;
    he.castShadow = true;
    this.heldEgg = he;
    this.held.add(he);
    // ヒビ
    // ヒビ（卵の胴まわりをギザギザに一周。入った分だけ見える）
    {
      const path = new THREE.CurvePath();
      const N = 22, r = 0.1235, pr = U.rng(5);
      const P = [];
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2;
        const x = (i % 2 ? 0.024 : -0.02) + (pr() - 0.5) * 0.012;
        P.push(new THREE.Vector3(x, Math.cos(t) * r, Math.sin(t) * r));
      }
      P[N] = P[0].clone();
      for (let i = 0; i < N; i++) path.add(new THREE.LineCurve3(P[i], P[i + 1]));
      this.crackGeo = new THREE.TubeGeometry(path, N * 4, 0.0042, 4, false);
      this.crackCount = this.crackGeo.index.count;
      this.crackMesh = new THREE.Mesh(this.crackGeo, new THREE.MeshBasicMaterial({ color: 0x5a3a1e }));
      this.crackMesh.visible = false;
      this.held.add(this.crackMesh);
    }
    this.held.visible = false;
    g.add(this.held);

    // ぱかっと開く殻（左右2つ）
    const halfGeo = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    this.shellA = new THREE.Mesh(halfGeo, this.shellMat);
    this.shellB = new THREE.Mesh(halfGeo, this.shellMat);
    [this.shellA, this.shellB].forEach((m) => { m.scale.set(0.12, 0.155, 0.12); m.visible = false; m.castShadow = true; g.add(m); });

    // 落ちていく中身・しずく
    this.blobs = [];
    // 机にこぼれた卵
    this.splats = [];
    // ボウルに入った殻
    this.shells = [];
    this.shardGeo = new THREE.CircleGeometry(0.045, 5);

    // 菜箸
    this.chop = new THREE.Group();
    const chopMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.5, map: U.woodTex() });
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.012, 1.9, 10), chopMat);
      c.position.set(i ? 0.035 : -0.035, 0.95, 0);
      c.castShadow = true;
      this.chop.add(c);
    }
    g.add(this.chop);
    this.chopRest();

    // バター皿
    const bd = (this.butterDish = new THREE.Group());
    bd.position.copy(K.POS.butter);
    scene.add(bd);
    // 縁のある浅い小皿（木の机でも見分けやすい淡い青）
    const dp = [[0, 0.012], [0.42, 0.012], [0.5, 0.03], [0.56, 0.085], [0.6, 0.09], [0.6, 0.075], [0.5, 0.01], [0.45, 0]].map((q) => new THREE.Vector2(q[0], q[1]));
    const dish = new THREE.Mesh(new THREE.LatheGeometry(dp, 48), new THREE.MeshPhysicalMaterial({ color: 0xcfe2ee, roughness: 0.18, clearcoat: 1, side: THREE.DoubleSide }));
    dish.receiveShadow = true; dish.castShadow = true;
    bd.add(dish);
    if (K.makeLabel) {
      const lb = K.makeLabel('バター', { size: 56, color: '#fff7ea', bg: 'rgba(26,19,15,0.75)', height: 0.13 });
      lb.position.set(0, 0.02, 0.78); lb.rotation.x = -1.1;
      bd.add(lb);
    }
    this.butterMat = new THREE.MeshPhysicalMaterial({ color: 0xffe08a, roughness: 0.35, clearcoat: 0.4 });
    this.butterBlock = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.butterMat);
    this.butterBlock.castShadow = true;
    bd.add(this.butterBlock);

    this.mode = null;          // 'press' | 'hold' | 'mix'
    this.mixAngle = 0;
    this.lastP = null;
    this.tickDist = 0;
    this.speed = 0;
    this.dirSign = 0;
    this.texDirty = true;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.vplane = new THREE.Plane();
    this.ray = new THREE.Raycaster();
    this.messages = [];
  }

  Prep.prototype.say = function (text, kind) { this.messages.push({ text, kind: kind || 'info' }); };

  Prep.prototype.reset = function (run) {
    this.run = run;
    this.eggs = 0;             // ボウルに入っている卵（個分）
    this.yolkN = 0;            // ボウルに入った黄身の数（ヒビから漏れた白身では増えない）
    this.mode = null;
    this.blobs.forEach((b) => b.meshes.forEach((m) => this.group.remove(m)));
    this.blobs.length = 0;
    this.splats.forEach((m) => this.K.scene.remove(m));
    this.splats.length = 0;
    this.shells.forEach((m) => this.bowlG.remove(m));
    this.shells.length = 0;
    this.cartonEggs.forEach((e) => { e.visible = true; e.position.copy(e.userData.home); });
    this.packsLeft = 1;        // 卵は2パック（20個）まで。いまのパックが空になったら、もう1パックだけ出せる
    this._noEggMsg = false;
    (this.chicks || []).forEach((c) => this.group.remove(c.g));
    this.chicks = [];
    this.foamMesh.count = 0;
    this.held.visible = false;
    this.h = null;
    this.pourAnim = null;
    this.bowlG.position.set(0, 0, 0); this.bowlG.rotation.set(0, 0, 0);
    this.liquid.rotation.set(-Math.PI / 2, 0, 0);
    this.liquid.position.set(0, 0, 0);   // 前回フライパンへ注いだときの横ずれを必ず戻す
    this.carton.visible = true; this.chop.visible = true;
    if (this.stream) this.stream.visible = false;
    this.shellA.visible = this.shellB.visible = false;
    this.openAnim = null;
    this.lastKnock = null;
    this.setButter(run.prep.butter);
    this.texDirty = true;
    this.chopRest();
    this.refreshLiquid();
  };

  // 卵がたくさん入っても、卵液がボウルのふちより上に浮かないよう高さに上限をつける
  const LEVEL_MAX = 0.55, EGGS_MAX = 20;   // ボウルには、卵2パック分の20個まで入れられる（あふれない）
  Prep.prototype.level = function () { return Math.min(LEVEL_MAX, 0.07 + 0.075 * Math.pow(Math.max(0, this.eggs), 0.78)); };

  /** 混ざり具合：卵が多いほど、同じだけ混ぜても混ざりにくい */
  Prep.prototype.calcUni = function () {
    const pr = this.run.prep;
    const need = 9 * Math.sqrt(Math.max(1, this.eggs));
    pr.uniformity = 1 - Math.exp(-pr.mixEnergy / need);
  };

  Prep.prototype.setButter = function (gram) {
    this.run.prep.butter = gram;
    const s = Math.cbrt(gram / 10);
    this.butterBlock.visible = gram > 0;
    this.butterBlock.scale.set(0.34 * s, 0.16 * s, 0.24 * s);
    this.butterBlock.position.set(0, 0.06 + 0.08 * s, 0);
  };

  /** ボウルに卵を足す（新しい黄身が入ると混ざり具合は下がる） */
  Prep.prototype.addToBowl = function (amt) {
    if (amt <= 0) return;
    const pr = this.run.prep;
    const before = this.eggs;
    // ボウルがいっぱいなら、入りきらない分はこぼれる（卵液が浮き上がらないように）
    if (before + amt > EGGS_MAX) {
      const over = before + amt - EGGS_MAX;
      pr.lost += over;
      amt -= over;
      // ボウルの縁を越えて、机へとろりとあふれ出る（縁の当たり判定はそのまま残る）
      const a = Math.random() * Math.PI * 2;
      this.makeSplat(Math.cos(a) * (RIM_OUT + 0.1), Math.sin(a) * (RIM_OUT + 0.1), over, 0, false);
      this.audio.play('plop', 0.7);
      this.say('ボウルがいっぱい！ 卵液が縁からあふれた', 'bad');
      if (amt <= 0) { this.texDirty = true; this.refreshLiquid(); return; }
    }
    this.eggs += amt;
    // 新しく入れた卵はまだ混ざっていない：混ざっていた部分の割合を2乗で減らす（混ぜ終わった直後に足しても「完璧」にならない）
    const keep = before / this.eggs;
    pr.mixEnergy *= keep * keep;
    this.calcUni();
    pr.inBowl = this.eggs;
    this.texDirty = true;
    this.refreshLiquid();
  };

  /** テスト・デバッグ用：アニメーションなしで1個割り入れる */
  Prep.prototype.autoCrack = function () { this.run.prep.cracked++; this.addToBowl(1); this.yolkN++; };

  /** 使う量（取り分け）。ボウルの中身以下 */
  Prep.prototype.setUse = function (v) {
    const pr = this.run.prep;
    pr.use = U.clamp(v, 0, this.eggs);
  };

  Prep.prototype.refreshLiquid = function () {
    const has = this.eggs > 0.01;
    this.liquid.visible = has;
    if (!has) { this.yolks.forEach((y) => (y.visible = false)); return; }
    const lv = this.level();
    // 液面はいつもボウルの真ん中（注いでいる途中以外）
    if (!this.pourAnim) { this.liquid.position.set(0, lv, 0); this.liquid.rotation.set(-Math.PI / 2, 0, 0); }
    else this.liquid.position.y = lv;
    const r = bowlInnerR(lv) - 0.01;
    this.liquid.scale.set(r, r, 1);
    this.shells.forEach((s) => (s.position.y = lv + 0.004));
  };

  Prep.prototype.drawLiquid = function () {
    const ctx = this.liqCanvas.getContext('2d');
    const w = 256, U01 = this.run.prep.uniformity;
    const alb = [236, 226, 178], mixc = [252, 176, 38];
    const base = U.mix3(alb, mixc, U.smooth(0, 0.9, U01));
    ctx.fillStyle = `rgb(${base.map(Math.round).join(',')})`;
    ctx.fillRect(0, 0, w, w);
    ctx.save();
    ctx.translate(w / 2, w / 2);
    ctx.rotate(this.mixAngle);
    const streak = 1 - U01;
    for (let i = 0; i < 26; i++) {
      const rad = 18 + i * 4.3;
      ctx.strokeStyle = i % 2 ? `rgba(255,160,20,${0.55 * U01 * streak * 2})` : `rgba(250,246,226,${0.65 * streak})`;
      ctx.lineWidth = 3 + (i % 3) * 2;
      ctx.beginPath();
      ctx.arc(0, 0, rad, i * 0.7, i * 0.7 + 1.2 + streak * 2);
      ctx.stroke();
    }
    ctx.restore();
    const gr = ctx.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(120,70,0,0.25)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, w);
    this.liqTex.needsUpdate = true;
  };

  /** 菜箸はボウルの手前に横向きに置く */
  Prep.prototype.chopRest = function () {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    this.chop.quaternion.setFromRotationMatrix(m);
    this.chop.position.set(-0.95, 0.024, 1.15);
  };

  // ---------------- 当たり面 ----------------
  Prep.prototype.floorAt = function (x, z) {
    const r = Math.hypot(x, z);
    if (r < RIM_IN) return { type: 'bowl', y: Math.max(0.07, this.level()) };
    if (r <= RIM_OUT) return { type: 'rim', y: RIM_Y };
    return { type: 'table', y: 0 };
  };
  /** 横向きに持った卵の長さを考えた当たり面（卵の端が縁にかかれば縁で止まる） */
  Prep.prototype.floorEgg = function (x, z) {
    const r = this.planeRight || new THREE.Vector3(1, 0, 0);
    let best = this.floorAt(x, z);
    for (const s of [-0.13, 0.13]) {
      const f = this.floorAt(x + r.x * s, z + r.z * s);
      if (f.y > best.y + 1e-4) best = f;
    }
    return best;
  };
  Prep.prototype.isInside = function (x, z) { return Math.hypot(x, z) < RIM_IN - 0.04; };

  /** 持っている卵の目標位置：カメラに向いた縦の面（ボウルの中心を通る）上 */
  Prep.prototype.pickHold = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    const c = this.group.position;
    const n = new THREE.Vector3(camera.position.x - c.x, 0, camera.position.z - c.z).normalize();
    this.vplane.setFromNormalAndCoplanarPoint(n, c);
    this.planeRight = new THREE.Vector3(n.z, 0, -n.x);
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.vplane, p)) return null;
    p.sub(c);
    p.y = U.clamp(p.y, 0, 2.2);
    // 横は手が届く範囲に
    const r = Math.hypot(p.x, p.z);
    if (r > 2.2) { p.x *= 2.2 / r; p.z *= 2.2 / r; }
    return p;
  };

  Prep.prototype.pickLiquid = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    const lv = this.group.position.y + this.level();
    this.plane.constant = -lv;
    const p = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(this.plane, p)) return null;
    const lx = p.x - this.group.position.x, lz = p.z - this.group.position.z;
    return { x: lx, z: lz, r: Math.hypot(lx, lz) };
  };

  // ---------------- 入力 ----------------
  Prep.prototype.pointerDown = function (ndc, camera) {
    this.lastNdc = ndc.clone();
    if (this.h || this.openAnim) return false;
    this.ray.setFromCamera(ndc, camera);
    // 殻をつまんで取り除く
    if (this.shells.length) {
      const hit = this.ray.intersectObjects(this.shells, false)[0];
      if (hit) {
        const m = hit.object;
        this.bowlG.remove(m);
        this.shells.splice(this.shells.indexOf(m), 1);
        this.run.prep.shells = this.shells.length;
        this.audio.play('click');
        this.say('殻を取り除いた', 'good');
        return true;
      }
    }
    // 卵パックの卵を長押し
    const eggs = this.cartonEggs.filter((e) => e.visible);
    const hit = this.ray.intersectObjects(eggs, false)[0];
    if (hit) {
      this.mode = 'press';
      this.press = { egg: hit.object, t: 0 };
      return true;
    }
    // 卵液を溶く
    if (this.eggs > 0.01) {
      const p = this.pickLiquid(ndc, camera);
      if (p && p.r < 1.1) { this.mode = 'mix'; this.lastP = p; return true; }
    }
    return false;
  };

  Prep.prototype.pointerMove = function (ndc, camera, dt) {
    this.lastNdc = ndc.clone();
    this.lastCam = camera;
    if (this.mode === 'hold') this.moveHeld(ndc, camera);
    if (this.mode === 'mix') this.mix(ndc, camera, dt);
  };

  Prep.prototype.pointerUp = function () {
    if (this.mode === 'press') {
      this.press.egg.position.copy(this.press.egg.userData.home);
      this.say('卵は長押しで持ち上げる', 'info');
    }
    if (this.mode === 'hold') this.release();
    if (this.mode === 'mix') { this.speed = 0; this.chopRest(); }
    this.mode = null;
  };

  Prep.prototype.pickUp = function (camera) {
    const egg = this.press.egg;
    egg.visible = false;
    egg.position.copy(egg.userData.home);
    const wp = egg.getWorldPosition(new THREE.Vector3()).sub(this.group.position);
    this.h = {
      pos: wp, target: wp.clone(), hist: [],
      cracked: false, damage: 0, leaked: 0, leakRate: 0, contact: null, armed: true, tiltZ: 0,
      need: Math.random() < 0.5 ? 1 : 2,   // ちょうどいい力で何回当てると割れるか（1回か2回）
      dripT: 0, carton: egg,
    };
    this.held.visible = true;
    this.held.position.copy(wp);
    this.showCrack(0);
    this.mode = 'hold';
    this.audio.play('click', 0.5);
    if (this.lastNdc) this.moveHeld(this.lastNdc, camera);
  };

  Prep.prototype.moveHeld = function (ndc, camera) {
    const h = this.h;
    if (!h) return;
    const p = this.pickHold(ndc, camera);
    if (!p) return;
    const now = performance.now() / 1000;
    // 縁の下をくぐり抜けないように：低い位置では縁をまたげない
    const prevIn = Math.hypot(h.target.x, h.target.z) < RIM_OUT;
    const nextIn = Math.hypot(p.x, p.z) < RIM_OUT;
    const prevInner = Math.hypot(h.target.x, h.target.z) < RIM_IN;
    const nextInner = Math.hypot(p.x, p.z) < RIM_IN;
    if ((prevIn !== nextIn || prevInner !== nextInner) && p.y - EGG_HALF < RIM_Y - 0.02 && h.pos.y - EGG_HALF < RIM_Y - 0.02) {
      p.x = h.target.x; p.z = h.target.z;
    }
    h.hist.push({ t: now, y: p.y });
    while (h.hist.length > 2 && now - h.hist[0].t > 0.09) h.hist.shift();
    const f = this.floorEgg(p.x, p.z);
    const bottom = p.y - EGG_HALF;
    const wasAbove = h.pos.y - EGG_HALF > f.y + 0.004;
    if (bottom <= f.y) {
      if (wasAbove && h.armed) {
        // 当たる直前の下向きの速さ
        // 直前の動き（最後の区間）の下向きの速さ。止まっていた時間は数えない
        let a = null;
        for (let i = h.hist.length - 2; i >= 0; i--) if (now - h.hist[i].t > 0.004) { a = h.hist[i]; break; }
        const dtw = a ? U.clamp(now - a.t, 0.016, 0.1) : 0.1;
        const v = a ? Math.max(0, (a.y - p.y) / dtw) : 0;
        this.knock(f.type, v, p);
        h.armed = false;
      }
      p.y = f.y + EGG_HALF;
      h.contact = f.type;
    } else {
      if (bottom > f.y + 0.05) h.armed = true;
      h.contact = bottom <= f.y + 0.01 ? f.type : null;
    }
    h.target.copy(p);
  };

  Prep.prototype.knock = function (type, v, p) {
    const h = this.h;
    const [lo, hi] = KNOCK[type];
    const res = { type, name: SURF_NAME[type], v, lo, hi, result: '' };
    this.lastKnock = res;
    if (h.cracked && v > lo * 0.6) {
      // ヒビの入った卵をもう一度強く当てると潰れる
      if (v > hi * 0.55) { res.result = 'crush'; this.crush(type, p); return; }
    }
    if (v > hi) { res.result = 'crush'; this.crush(type, p); return; }
    if (h.cracked) { res.result = 'tap'; this.audio.play('knock', 0.3); return; }
    if (v >= lo) h.damage += h.need === 1 ? 1 : 0.55;
    else h.damage += (v / lo) * 0.3;
    this.showCrack(Math.min(1, h.damage));
    if (h.damage >= 1) {
      // ごくまれに（0.2%）、殻の中からひよこが出てくる
      if (Math.random() < 0.002) { res.result = 'crack'; this.hatchChick(p); return; }
      h.cracked = true;
      this.showCrack(1);
      h.leakRate = type === 'rim' ? 0.06 : type === 'bowl' ? 0.03 : 0.012;
      res.result = 'crack';
      this.audio.play('crack');
      if (type === 'rim') this.say('ヒビが入った！ ボウルの上で指を離して「ぱかっ」', 'good');
      else if (type === 'table') this.say('机できれいにヒビが入った！ ボウルの上へ運んで指を離す', 'good');
      else this.say('ヒビが入った！ そのまま指を離すと「ぱかっ」', 'good');
    } else {
      res.result = v >= lo ? 'more' : 'weak';
      this.audio.play('knock', 0.3 + 0.5 * Math.min(1, v / lo));
    }
  };

  // ---------------- ひよこ（卵が割れたとき、まれに生まれて、ピヨピヨ鳴きながら画面の外へ走っていく） ----------------
  Prep.prototype.makeChick = function () {
    const g = new THREE.Group();
    const yel = new THREE.MeshStandardMaterial({ color: 0xffd84a, roughness: 0.85 });
    const org = new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.6 });
    const blk = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), yel);
    body.scale.set(1, 0.92, 1.12); body.position.y = 0.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.072, 16, 12), yel);
    head.position.set(0, 0.255, 0.075);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 10), org);
    beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.248, 0.15);
    const eL = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), blk); eL.position.set(-0.03, 0.272, 0.125);
    const eR = eL.clone(); eR.position.x = 0.03;
    const wL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), yel); wL.scale.set(0.35, 0.8, 1); wL.position.set(-0.105, 0.16, 0);
    const wR = wL.clone(); wR.position.x = 0.105;
    const legs = [];
    for (const sx of [-0.035, 0.035]) {
      const lg = new THREE.Group(); lg.position.set(sx, 0.07, 0);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), org); stick.position.y = -0.03;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.05), org); foot.position.set(0, -0.067, 0.012);
      lg.add(stick, foot); g.add(lg); legs.push(lg);
    }
    g.add(body, head, beak, eL, eR, wL, wR);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(1.5);
    return { g, legs, wings: [wL, wR] };
  };
  Prep.prototype.hatchChick = function (p) {
    const pr = this.run.prep;
    pr.cracked++;
    this.audio.play('crack', 1.1);
    // ボウルや縁を避けて、机の上に出てくる
    let x = p.x, z = p.z;
    const r = Math.hypot(x, z);
    const minR = RIM_OUT + 0.3;
    if (r < minR) { const a = r < 1e-3 ? Math.random() * 6.28 : Math.atan2(z, x); x = Math.cos(a) * minR; z = Math.sin(a) * minR; }
    const ch = this.makeChick();
    ch.g.position.set(x, Math.max(0, p.y - 0.1), z);
    // 画面の左右どちらかへ（ボウルから遠ざかる向き。カメラの「右」を基準に）
    const cam = this.lastCam || (window.PKG && window.PKG.camera);
    const right = new THREE.Vector3(1, 0, 0);
    if (cam) { cam.updateMatrixWorld(); right.setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; if (right.lengthSq() < 1e-6) right.set(1, 0, 0); right.normalize(); }
    const side = Math.abs(x * right.x + z * right.z) > 0.1 ? Math.sign(x * right.x + z * right.z) : (Math.random() < 0.5 ? -1 : 1);
    const fwd = new THREE.Vector3(0, 0, 1).addScaledVector(right, 0).multiplyScalar(0);
    const dir = right.clone().multiplyScalar(side).addScaledVector(fwd, 0).normalize();
    ch.g.rotation.y = Math.atan2(dir.x, dir.z);
    this.group.add(ch.g);
    this.chicks.push({ g: ch.g, legs: ch.legs, wings: ch.wings, dir, vy: 0, t: 0, chirpT: 0, state: 'fall' });
    this.say('ひよこが生まれた！？ ピヨピヨ…', 'good');
    this.audio.play('piyo', 1);
    this.endHeld();
  };
  Prep.prototype.updateChicks = function (dt, t) {
    if (!this.chicks || !this.chicks.length) return;
    const cam = this.lastCam || (window.PKG && window.PKG.camera);
    const wp = new THREE.Vector3();
    for (let i = this.chicks.length - 1; i >= 0; i--) {
      const c = this.chicks[i], g = c.g;
      c.t += dt;
      if (c.state === 'fall') {
        c.vy -= GRAV * dt;
        g.position.y += c.vy * dt;
        if (g.position.y <= 0) { g.position.y = 0; c.state = 'run'; c.t = 0; this.audio.play('piyo', 0.9); }
        continue;
      }
      // 走る：ぴょんぴょん跳ねて、足と羽をぱたぱた
      const speed = 2.3;
      g.position.x += c.dir.x * speed * dt;
      g.position.z += c.dir.z * speed * dt;
      const ph = c.t * 16;
      g.position.y = Math.abs(Math.sin(ph)) * 0.06;
      c.legs[0].rotation.x = Math.sin(ph) * 0.9; c.legs[1].rotation.x = -Math.sin(ph) * 0.9;
      c.wings[0].rotation.z = 0.5 + Math.sin(ph * 1.5) * 0.5; c.wings[1].rotation.z = -0.5 - Math.sin(ph * 1.5) * 0.5;
      c.chirpT -= dt;
      if (c.chirpT <= 0) { c.chirpT = 0.28 + Math.random() * 0.12; this.audio.play('piyo', 0.8); }
      // 画面の外へ出たら（または念のため10秒たったら）消す
      let gone = c.t > 10;
      if (cam) {
        g.getWorldPosition(wp);
        wp.project(cam);
        if (Math.abs(wp.x) > 1.2 || Math.abs(wp.y) > 1.3) gone = true;
      }
      if (gone) { this.group.remove(g); this.chicks.splice(i, 1); }
    }
  };

  Prep.prototype.showCrack = function (f) {
    this.crackMesh.visible = f > 0.01;
    const n = Math.floor((this.crackCount * U.clamp(f * 0.5 + (f >= 1 ? 0.5 : 0), 0, 1)) / 3) * 3;
    this.crackGeo.setDrawRange(0, Math.max(3, n));
  };

  /** 強すぎて潰れた */
  Prep.prototype.crush = function (type, p) {
    const h = this.h;
    const pr = this.run.prep;
    const left = 1 - h.leaked;
    this.audio.play('crack', 1.3);
    this.audio.play('plop', 0.8);
    if (type === 'table') {
      this.makeSplat(p.x, p.z, left, 0);
      pr.lost += left;
      this.say('強すぎ！ 卵が机でぐしゃっとつぶれた', 'bad');
    } else if (type === 'rim') {
      const inside = Math.hypot(p.x, p.z) < 0.86;
      const into = left * (inside ? 0.7 : 0.35);
      this.addToBowl(into);
      if (inside) this.yolkN++;
      this.addShells(3);
      pr.lost += left - into;
      const rr = Math.hypot(p.x, p.z) || 1;
      this.makeSplat((p.x / rr) * 1.05, (p.z / rr) * 1.05, left - into, 0);
      this.say('強すぎ！ 縁でつぶれて殻がボウルに入った（タップで取り除ける）', 'bad');
    } else {
      this.addToBowl(left);
      this.yolkN++;
      this.addShells(2);
      this.say('強すぎ！ 殻ごとボウルに入った（タップで取り除ける）', 'bad');
    }
    pr.crushed++;
    pr.cracked++;
    this.endHeld();
  };

  /** 指を離した：ヒビがあれば「ぱかっ」、なければパックへ戻す */
  Prep.prototype.release = function () {
    const h = this.h;
    if (!h) return;
    if (!h.cracked) {
      h.carton.visible = true;
      this.endHeld();
      this.audio.play('click', 0.4);
      return;
    }
    // ぱかっ
    const p = h.pos.clone();
    // 見た目でボウルの上に重ねて離したなら、ボウルに入るように合わせる（スマホの斜めの視点では、
    // 宙に浮いた卵の真下はボウルより手前になりやすい）
    const cam = this.lastCam || (window.PKG && PKG.camera);
    if (cam && Math.hypot(p.x, p.z) > RIM_IN - 0.08 && p.y > RIM_Y) {
      const C = cam.position.clone().sub(this.group.position);
      const d = p.clone().sub(C);
      if (d.y < -1e-3) {
        const t = (RIM_Y - C.y) / d.y;
        const q = C.clone().addScaledVector(d, t);
        if (Math.hypot(q.x, q.z) < RIM_OUT + 0.15) {
          const r = Math.hypot(q.x, q.z), lim = RIM_IN - 0.15;
          if (r > lim) { q.x *= lim / r; q.z *= lim / r; }
          p.x = q.x; p.z = q.z;
        }
      }
    }
    this.openAnim = { t: 0, pos: p };
    this.shellA.visible = this.shellB.visible = true;
    this.audio.play('crack', 0.7);
    const left = Math.max(0, 1 - h.leaked);
    this.spawnBlob(p, left, true);
    this.run.prep.cracked++;
    this.endHeld();
  };

  Prep.prototype.endHeld = function () {
    this.h = null;
    this.dropMark.visible = false;
    this.held.visible = false;
    this.mode = null;
  };

  Prep.prototype.spawnBlob = function (p, amt, big) {
    const meshes = [];
    // ヒビから漏れるのは白身だけ。黄身は殻を開いたときに出る
    const yolk = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.1 : 0.03, 16, 12), big ? this.yolkMat : this.whiteMat);
    if (!big) yolk.scale.set(1.2, 0.8, 1.2);
    meshes.push(yolk);
    if (big) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), this.whiteMat);
      meshes.push(white);
    }
    meshes.forEach((m) => { m.position.copy(p); this.group.add(m); });
    this.blobs.push({ meshes, pos: p.clone().add(new THREE.Vector3(0, -0.04, 0)), vy: 0, amt, big, t: 0 });
  };

  Prep.prototype.makeSplat = function (lx, lz, amt, y, whiteOnly) {
    if (amt <= 0.02) return;
    const g = new THREE.Group();
    const s = Math.sqrt(amt);
    const wh = new THREE.Mesh(new THREE.CircleGeometry(0.32 * s, 18), new THREE.MeshPhysicalMaterial({ color: 0xfff3d0, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.7 }));
    wh.rotation.x = -Math.PI / 2;
    wh.scale.set(1, 0.75 + Math.random() * 0.4, 1);
    const yk = new THREE.Mesh(new THREE.SphereGeometry(0.09 * s, 16, 10), this.yolkMat);
    yk.scale.y = 0.45;
    yk.position.set((Math.random() - 0.5) * 0.08, 0.01, (Math.random() - 0.5) * 0.08);
    g.add(wh);
    if (!whiteOnly) g.add(yk);
    // こぼれた卵は机の上だけ。ボウルの下や縁に重ならないよう、ボウルの外まで流れ出た位置に置く
    {
      const rad = 0.32 * s * 1.15, r = Math.hypot(lx, lz) || 1e-3;
      const need = RIM_OUT + rad + 0.04;
      if (r < need) { lx = (lx / r) * need; lz = (lz / r) * need; }
      y = 0;
    }
    g.position.set(this.group.position.x + lx, (y || 0) + 0.004, this.group.position.z + lz);
    this.K.scene.add(g);
    this.splats.push(g);
  };

  Prep.prototype.addShells = function (n) {
    const lv = this.level();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.shardGeo, this.shellMat);
      const a = Math.random() * Math.PI * 2, r = 0.1 + Math.random() * 0.4;
      m.position.set(Math.cos(a) * r, lv + 0.004, Math.sin(a) * r);
      m.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.4, 0, Math.random() * 6);
      m.scale.set(0.8 + Math.random() * 0.6, 0.6 + Math.random() * 0.5, 1);
      this.bowlG.add(m);
      this.shells.push(m);
    }
    this.run.prep.shells = this.shells.length;
  };

  Prep.prototype.mix = function (ndc, camera, dt) {
    const p = this.pickLiquid(ndc, camera);
    if (!p) return;
    const lim = bowlInnerR(this.level()) - 0.08;
    if (p.r > lim) { p.x *= lim / p.r; p.z *= lim / p.r; }
    const dx = p.x - this.lastP.x, dz = p.z - this.lastP.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.0005) {
      const pr = this.run.prep;
      pr.mixEnergy += Math.min(d, 0.4);
      this.calcUni();
      const sp = d / Math.max(dt, 0.008);
      this.speed = U.lerp(this.speed, sp, 0.3);
      if (this.speed > 4.5) pr.foam = Math.min(1, pr.foam + (this.speed - 4.5) * 0.004);
      const along = Math.sign(dx);
      if (along !== 0 && along !== this.dirSign) { this.dirSign = along; pr.strokes++; }
      const cross = Math.sign(dx * this.lastP.z - dz * this.lastP.x);
      this.mixAngle += cross * d * 2.2;
      this.tickDist += d;
      if (this.tickDist > 0.22) { this.tickDist = 0; this.audio.play('whisk', U.clamp(this.speed / 4, 0.3, 1.2)); }
      this.texDirty = true;
    }
    this.lastP = p;
    this.chop.position.set(p.x, this.level() - 0.05, p.z);
    this.chop.rotation.set(-0.35 + dz * 2, 0, 0.35 + dx * 2);
  };

  // ---------------- 更新 ----------------
  Prep.prototype.update = function (dt, t) {
    const pr = this.run.prep;
    // 長押し
    if (this.mode === 'press') {
      this.press.t += dt;
      const e = this.press.egg;
      e.position.copy(e.userData.home);
      e.position.y += Math.min(0.06, this.press.t * 0.25);
      e.rotation.z = Math.sin(t * 40) * 0.08;
      if (this.press.t >= PRESS_T) { e.rotation.z = 0; this.pickUp(this.lastCam || PKG.camera); }
    }
    // 手に持った卵
    const h = this.h;
    if (h) {
      h.pos.lerp(h.target, 1 - Math.exp(-dt * 28));
      const f = this.floorEgg(h.pos.x, h.pos.z);
      if (h.pos.y - EGG_HALF < f.y) h.pos.y = f.y + EGG_HALF;
      this.held.position.copy(h.pos);
      const fd = this.floorAt(h.pos.x, h.pos.z);
      this.dropMark.visible = h.pos.y > fd.y + 0.25;
      this.dropMark.position.set(h.pos.x, fd.y + 0.006, h.pos.z);
      this.dropMark.scale.setScalar(fd.type === 'bowl' ? 1 : 0.8);
      this.held.rotation.z = U.lerp(this.held.rotation.z, U.clamp((h.target.x - h.pos.x) * 3, -0.5, 0.5), 0.2);
      // ヒビから漏れる
      // ヒビからは白身が少しにじむだけ（殻が閉じている間は黄身は出ない）
      if (h.cracked && h.leaked < 0.12) {
        const amt = h.leakRate * 0.35 * dt * (h.contact === 'rim' ? 1.4 : 1);
        h.leaked += amt;
        h.dripAcc = (h.dripAcc || 0) + amt;
        if (h.dripAcc > 0.03) {
          this.spawnBlob(h.pos.clone().add(new THREE.Vector3(0, -EGG_HALF * 0.8, 0)), h.dripAcc, false);
          h.dripAcc = 0;
        }
      }
    }
    // ぱかっと開く殻
    if (this.openAnim) {
      const a = this.openAnim;
      a.t += dt;
      const o = U.easeOutCubic(U.clamp(a.t / 0.35, 0, 1));
      this.shellA.position.copy(a.pos).add(new THREE.Vector3(-o * 0.22, o * 0.06, 0));
      this.shellB.position.copy(a.pos).add(new THREE.Vector3(o * 0.22, o * 0.06, 0));
      this.shellA.rotation.set(0, 0, Math.PI / 2 + o * 0.9);
      this.shellB.rotation.set(0, 0, -Math.PI / 2 - o * 0.9);
      if (a.t > 0.9) { this.shellA.visible = this.shellB.visible = false; this.openAnim = null; }
    }
    // 落ちる中身
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.t += dt;
      b.vy -= GRAV * dt;
      b.pos.y += b.vy * dt;
      const inside = this.isInside(b.pos.x, b.pos.z);
      const f = this.floorAt(b.pos.x, b.pos.z);
      const st = 1 + Math.min(1.2, -b.vy * 0.08);
      b.meshes[0].position.copy(b.pos);
      b.meshes[0].scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st));
      if (b.meshes[1]) { b.meshes[1].position.copy(b.pos).add(new THREE.Vector3(0, 0.06, 0)); b.meshes[1].scale.set(0.8, st * 1.2, 0.8); }
      if (b.pos.y <= f.y + 0.01 && f.type === 'rim') {
        // 縁に落ちた中身は、とろりと内側か外側へ流れていく
        const r = Math.hypot(b.pos.x, b.pos.z) || 1;
        const inward = r < 0.858 || (Math.abs(r - 0.858) < 0.02 && Math.random() < 0.5);
        const nr = inward ? RIM_IN - 0.06 : RIM_OUT + 0.05;
        b.pos.x *= nr / r; b.pos.z *= nr / r;
        b.vy = 0;
        continue;
      }
      if (b.pos.y <= f.y + 0.01) {
        b.meshes.forEach((m) => this.group.remove(m));
        this.blobs.splice(i, 1);
        if (inside) {
          this.addToBowl(b.amt);
          if (b.big) { this.audio.play('drop'); this.yolkN++; }
        } else {
          pr.lost += b.amt;
          this.makeSplat(b.pos.x, b.pos.z, b.amt, f.type === 'rim' ? RIM_Y : 0, !b.big);
          if (b.big) { this.audio.play('plop', 0.7); this.say('ボウルの外で開いてしまった！', 'bad'); }
        }
      }
    }
    // 卵パックが空になったら補充
    if (!this.h && this.mode !== 'press' && this.cartonEggs.every((e) => !e.visible)) {
      if (this.packsLeft > 0) {
        this.packsLeft--;
        this.cartonEggs.forEach((e) => (e.visible = true));
        this.say('新しい卵パックを出した（これで最後）', 'info');
      } else if (!this._noEggMsg) {
        this._noEggMsg = true;
        this.say('卵はもうない！ 2パック20個ぜんぶ使った', 'warn');
      }
    }
    this.updateChicks(dt, t);

    // 黄身の見た目（混ざるほど小さく崩れる）
    const nY = Math.min(this.yolks.length, this.yolkN);
    const lv = this.level();
    const ys = U.clamp(1 - pr.uniformity * 1.4, 0, 1);
    for (let i = 0; i < this.yolks.length; i++) {
      const y = this.yolks[i];
      y.visible = i < nY && ys > 0.04 && this.eggs > 0;
      if (!y.visible) continue;
      const a = (i / Math.max(1, nY)) * Math.PI * 2 + this.mixAngle * 0.8;
      const rr = nY === 1 ? 0.05 : 0.18 + 0.03 * (i % 3);
      y.position.set(Math.cos(a) * rr, lv + 0.015, Math.sin(a) * rr);
      y.scale.set(ys, ys * 0.62, ys);
    }
    // 泡
    const nf = 0;   // 泡の粒は表示しない（見た目のじゃまになるため）
    if (this.foamMesh.count !== nf) {
      const r = U.rng(9), m = new THREE.Object3D();
      for (let i = 0; i < nf; i++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * (bowlInnerR(lv) - 0.1);
        m.position.set(Math.cos(a) * rr, lv + 0.005, Math.sin(a) * rr);
        const s = 0.012 + r() * 0.025;
        m.scale.set(s, s * 0.6, s);
        m.updateMatrix();
        this.foamMesh.setMatrixAt(i, m.matrix);
      }
      this.foamMesh.count = nf;
      this.foamMesh.instanceMatrix.needsUpdate = true;
    }
    this.foamMesh.rotation.y = this.mixAngle * 0.8;
    if (this.texDirty && this.eggs > 0) { this.drawLiquid(); this.texDirty = false; }
  };

  // ---------------- 卵液を注ぐ（ボウルをコンロへ運び、傾けて全部注ぐ） ----------------
  const POUR_TILT = 1.5;
  const LIP = new THREE.Vector3(-0.86, 0.63, 0);
  Prep.prototype.startPour = function (target) {
    if (!this.stream) {
      this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), new THREE.MeshPhysicalMaterial({ color: 0xffa41c, roughness: 0.08, clearcoat: 1 }));
      this.stream.material.userData.lin = false;
      this.stream.visible = false;
      this.K.scene.add(this.stream);
      if (window.PKG && window.PKG.fixColors) window.PKG.fixColors(this.stream);
    }
    this.pourAnim = { phase: 'move', t: 0, target: target.clone(), total: this.eggs, shake: 0 };
    this.mode = null;
    this.chopRest();
  };
  /** 角度 a・注ぎ口が target にあるときのボウル中心（group 座標） */
  Prep.prototype.pourPose = function (a, target) {
    const lip = LIP.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), a);
    return target.clone().sub(this.group.position).sub(lip);
  };
  /** remain: フライパンに入っていない卵液の割合 0..1 */
  Prep.prototype.updatePour = function (dt, remain) {
    const A = this.pourAnim;
    if (!A) return;
    A.t += dt;
    const bg = this.bowlG;
    const tgtHigh = A.target.clone().add(new THREE.Vector3(0, 0.35, 0));
    if (A.phase === 'move') {
      const k = U.easeInOut(U.clamp(A.t / 0.8, 0, 1));
      const end = this.pourPose(0.15, tgtHigh);
      bg.position.lerpVectors(new THREE.Vector3(0, 0, 0), end, k);
      bg.position.y += Math.sin(k * Math.PI) * 1.2;
      bg.rotation.z = 0.15 * k;
      if (A.t >= 0.8) { A.phase = 'tilt'; A.t = 0; }
    } else if (A.phase === 'tilt') {
      const k = U.easeInOut(U.clamp(A.t / 0.5, 0, 1));
      const a = U.lerp(0.15, POUR_TILT, k);
      bg.rotation.z = a;
      bg.position.copy(this.pourPose(a, tgtHigh.clone().lerp(A.target, k)));
      if (A.t >= 0.5) { A.phase = 'pour'; A.t = 0; }
    } else if (A.phase === 'pour') {
      // 中身が減るほど深く傾ける
      const a = POUR_TILT + (1 - remain) * 0.35;
      bg.rotation.z = a;
      bg.position.copy(this.pourPose(a, A.target));
      if (remain <= 0.001) { A.phase = 'shake'; A.t = 0; }
    } else if (A.phase === 'shake') {
      const a = POUR_TILT + 0.35 + Math.sin(A.t * 40) * 0.05;
      bg.rotation.z = a;
      bg.position.copy(this.pourPose(a, A.target));
      if (A.t >= 0.45) {
        A.phase = 'back'; A.t = 0; A.from = bg.position.clone(); A.fromA = a;
        this.eggs = 0;            // ボウルは空っぽ
        this.yolkN = 0;
        this.refreshLiquid();
        this.yolks.forEach((y) => (y.visible = false));
        this.foamMesh.count = 0;
      }
    } else if (A.phase === 'back') {
      const k = U.easeInOut(U.clamp(A.t / 0.8, 0, 1));
      bg.position.lerpVectors(A.from, new THREE.Vector3(0, 0, 0), k);
      bg.position.y += Math.sin(k * Math.PI) * 1.0;
      bg.rotation.z = U.lerp(A.fromA, 0, k);
      if (A.t >= 0.8) { bg.position.set(0, 0, 0); bg.rotation.z = 0; this.pourAnim = null; }
    }
    // 傾けている間、中の卵液は注ぎ口側に寄って水平を保つ
    const pouring = A && (A.phase === 'pour' || A.phase === 'tilt' || A.phase === 'shake');
    if (A && A.phase !== 'back' && this.eggs > 0) {
      const amount = A.total * (A.phase === 'pour' || A.phase === 'shake' ? remain : 1);
      this.liquid.visible = amount > 0.02;
      const inv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -bg.rotation.z);
      this.liquid.quaternion.copy(inv).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
      const lipDir = LIP.clone().normalize();
      const f = U.clamp(bg.rotation.z / POUR_TILT, 0, 1);
      const r = Math.max(0.08, 0.55 * Math.sqrt(amount / Math.max(1, A.total)) * (1 - f * 0.4));
      this.liquid.position.copy(new THREE.Vector3(0, this.level(), 0).lerp(lipDir.multiplyScalar(0.7), f));
      this.liquid.scale.set(r, r, 1);
      this.yolks.forEach((y) => (y.visible = false));
    }
    // 注ぎ口から落ちる卵液
    if (this.stream) {
      const on = pouring && remain > 0.002 && A.phase !== 'tilt';
      this.stream.visible = on;
      if (on) {
        const lipW = this.bowlG.localToWorld(LIP.clone());
        const bottom = new THREE.Vector3(A.target.x, PK.Kitchen.PAN_Y + 0.03, A.target.z);
        const len = lipW.distanceTo(bottom);
        const rad = 0.02 + 0.03 * Math.min(1, remain * 2);
        this.stream.position.copy(lipW).add(bottom).multiplyScalar(0.5);
        this.stream.scale.set(rad, len, rad);
        this.stream.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), lipW.clone().sub(bottom).normalize());
      }
    }
  };

  /** 残りの卵（いまのパックの残り＋まだ出していないパック） */
  Prep.prototype.eggsLeft = function () { return this.cartonEggs.filter((e) => e.visible).length + (this.packsLeft || 0) * this.cartonEggs.length; };

  Prep.prototype.busy = function () { return !!(this.h || this.blobs.length || this.mode === 'press'); };

  Prep.KNOCK = KNOCK;
  PK.Prep = Prep;
})();
