/* PAKKAAAN! — ソースとトッピング
 *  皿の奥にソースのボトル、その手前にトッピングの透明容器を並べ、タップして選ぶ。
 *  ソース：どれも口の細いボトル。押している間、一定の量が出る（量の調整はなし）。
 *    ソースは「皿の上の高さ場」に積もる液体として計算する。
 *    上から見た料理の高さ（卵・ライス・皿）を一度だけ GPU で測り、その上をソースが
 *    重力で低い方へゆっくり流れる。とろみ（降伏応力）があるので、薄くなると止まる。
 *    そのため線はなめらかで丸みがあり、止めると溜まって丸く広がり、卵の斜面では垂れる。
 *  トッピング：パセリ・黒こしょう・粉チーズは散らす。
 *    ブロッコリー・ミニトマト・にんじん・ポテトは落ちて転がったり滑ったりして止まる（個数の制限なし）。
 *  当たり判定や着地はすべて高さ場を使うので、たくさん置いても重くならない。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;

  // rate: 1秒に出る量（シーン単位³。1単位³=1000ml）、sig: 線の太さ、hy: これより薄いと流れない、K: 流れやすさ
  const SAUCES = {
    ketchup: { name: 'ケチャップ', color: '#b81d12', body: 0xd2271a, rate: 0.0008, sig: 0.015, hy: 0.032, K: 12, ideal: 0.014, kcal: 1.2 },   // 少しとろみ。細い線は止まって字が書け、溜まった分は低く丸く広がる（塔にならない）
    demi: { name: 'デミグラス', color: '#4a1d0b', body: 0x5a2a12, rate: 0.0017, sig: 0.024, hy: 0.0065, K: 140, ideal: 0.035, kcal: 1.0 },
    cream: { name: 'クリーム', color: '#f2e8d2', body: 0xf4efe2, rate: 0.0017, sig: 0.024, hy: 0.008, K: 120, ideal: 0.035, kcal: 1.2 },
    tomato: { name: 'トマト', color: '#c9341d', body: 0xd4482a, rate: 0.0016, sig: 0.023, hy: 0.009, K: 100, ideal: 0.03, kcal: 0.5 },
  };
  // kcal: 1個（粒）あたり
  const TOPPINGS = {
    parsley: { name: 'パセリ', per: 22, spread: 0.24, color: '#2f7a22', kcal: 0.01 },
    pepper: { name: '黒こしょう', per: 45, spread: 0.3, color: '#1b1714', kcal: 0.005 },
    cheese: { name: '粉チーズ', per: 30, spread: 0.22, color: '#f6ecc8', kcal: 0.45 },
    broccoli: { name: 'ブロッコリー', item: true, n: 1, color: '#3f7f2a', kcal: 5 },
    tomato: { name: 'ミニトマト', item: true, n: 1, color: '#d91e10', kcal: 3 },
    carrot: { name: 'にんじん', item: true, n: 2, color: '#f07a1e', kcal: 4 },
    potato: { name: 'ポテト', item: true, n: 3, color: '#e8b54a', kcal: 12 },
  };
  const GRAV = 60;
  // 高さ場：机の上ぜんぶ（皿のまわりだけでなく、どこにでもかけたり置いたりできる）
  const DX = 0.02;
  const HX = 3.6, HZ = 2.9;                 // 計算する範囲の半分の幅・奥行き
  const NX = Math.round((HX * 2) / DX), NZ = Math.round((HZ * 2) / DX);
  const CZ = -0.5;                           // 皿の中心から見た範囲の中心（奥の容器の手前まで含める）
  const LAYER = 7;
  const UPV = new THREE.Vector3(0, 1, 0);
  const CAT = { none: 0, egg: 1, rice: 2, plate: 3 };
  const MAX_UNDO = 12;
  // テーブルの端（ダイニングテーブルは皿の中心から左右7・手前3.3まで。奥は壁）。端から出た物は落ちる
  const TBL = { x0: 3.2 - 6.9, x1: 3.2 + 6.9, z1: 0.25 + 3.2, wallZ: -3.15 };

  function srgbToLin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

  /** 複数の部品からなる模型を、頂点色つきの1つの形にまとめる（インスタンス描画用） */
  function mergeGroup(group) {
    group.updateMatrixWorld(true);
    const P = [], Nn = [], C = [];
    group.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      const col = o.material.color.clone();
      if (!o.material.userData.lin) col.convertSRGBToLinear();
      const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        P.push(p.getX(i), p.getY(i), p.getZ(i));
        Nn.push(n.getX(i), n.getY(i), n.getZ(i));
        C.push(col.r, col.g, col.b);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  /** 必要に応じて容量を倍にするインスタンス描画 */
  function GrowInst(parent, geo, mat, cap, shadow) {
    this.parent = parent; this.geo = geo; this.mat = mat; this.shadow = shadow;
    this.make(cap);
  }
  GrowInst.prototype.make = function (cap) {
    const old = this.mesh;
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.count = 0; m.frustumCulled = false; m.castShadow = !!this.shadow; m.receiveShadow = true;
    if (old) {
      m.instanceMatrix.array.set(old.instanceMatrix.array.subarray(0, old.count * 16));
      m.count = old.count;
      this.parent.remove(old);
      old.dispose && old.dispose();
    }
    this.parent.add(m);
    this.mesh = m;
  };
  GrowInst.prototype.add = function (matrix) {
    const m = this.mesh;
    if (m.count >= m.instanceMatrix.count) this.make(m.instanceMatrix.count * 2);
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  };
  Object.defineProperty(GrowInst.prototype, 'count', {
    get() { return this.mesh.count; },
    set(v) { this.mesh.count = v; this.mesh.instanceMatrix.needsUpdate = true; },
  });

  function SauceController(K, pan, audio) {
    this.K = K; this.pan = pan; this.audio = audio;
    this.ray = new THREE.Raycaster();
    this.group = new THREE.Group();
    K.scene.add(this.group);
    const P = K.POS.plate;
    this.x0 = P.x - HX; this.z0 = P.z + CZ - HZ;

    // ---- 高さ場 ----
    const NN = NX * NZ;
    this.base = new Float32Array(NN);       // 料理と皿の高さ
    this.cat = new Uint8Array(NN);          // そこにある物
    this.th = new Float32Array(NN);         // ソースの厚み
    this.ar = new Float32Array(NN); this.ag = new Float32Array(NN); this.ab = new Float32Array(NN);  // 色（sRGB）
    this.ahy = new Float32Array(NN); this.aK = new Float32Array(NN);                                  // とろみ
    this.dTh = new Float32Array(NN);
    this.inR = new Float32Array(NN); this.inG = new Float32Array(NN); this.inB = new Float32Array(NN);
    this.inHy = new Float32Array(NN); this.inK = new Float32Array(NN); this.outTot = new Float32Array(NN);
    this.outS = new Float32Array(NN * 4);
    this.baseReady = false;

    // ---- ソースの見た目（高さ場を1枚のメッシュで描く） ----
    const geo = new THREE.BufferGeometry();
    this.spos = new Float32Array(NN * 3);
    this.snrm = new Float32Array(NN * 3);
    const uv = new Float32Array(NN * 2);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      this.spos[k * 3] = this.x0 + (i + 0.5) * DX;
      this.spos[k * 3 + 2] = this.z0 + (j + 0.5) * DX;
      this.snrm[k * 3 + 1] = 1;
      uv[k * 2] = (i + 0.5) / NX; uv[k * 2 + 1] = (j + 0.5) / NZ;
    }
    const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6);
    let q = 0;
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.spos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.snrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(P.x, 0.3, P.z + CZ), HX * 1.4);
    this.sgeo = geo;
    this.texData = new Uint8Array(NN * 4);
    this.tex = new THREE.DataTexture(this.texData, NX, NZ, THREE.RGBAFormat);
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.encoding = THREE.sRGBEncoding;
    this.smat = new THREE.MeshPhysicalMaterial({ map: this.tex, roughness: 0.2, clearcoat: 0.85, clearcoatRoughness: 0.08, alphaTest: 0.5 });
    // 卵の表面とぴったり重なる所でも、ソースが必ず上に見えるように少し手前に描く
    this.smat.polygonOffset = true; this.smat.polygonOffsetFactor = -2; this.smat.polygonOffsetUnits = -6;
    this.smat.userData.lin = true;
    this.smesh = new THREE.Mesh(geo, this.smat);
    this.smesh.receiveShadow = true;
    this.smesh.frustumCulled = false;
    this.smesh.visible = false;
    this.group.add(this.smesh);

    // ---- 手に持つボトル ----
    this.bottles = {};
    for (const k in SAUCES) {
      const b = this.buildBottle(SAUCES[k].body);
      b.visible = false;
      K.scene.add(b);
      this.bottles[k] = b;
    }
    this.streamMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 0.8 });
    this.streamMat.userData.lin = true;
    this.stream = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), this.streamMat);
    this.stream.visible = false;
    K.scene.add(this.stream);
    // ソースが落ちる場所の目印（ボトルの口の真下）
    this.aimMark = new THREE.Group();
    const amMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
    const amEdge = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.062, 40), new THREE.MeshBasicMaterial({ color: 0x1a0d06, transparent: true, opacity: 0.7, depthTest: false }));
    amEdge.rotation.x = -Math.PI / 2; amEdge.material.userData.lin = true;
    const amRing = new THREE.Mesh(new THREE.RingGeometry(0.036, 0.052, 40), amMat);
    amRing.rotation.x = -Math.PI / 2;
    const amDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), amMat);
    amDot.rotation.x = -Math.PI / 2;
    const amLine = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
    amLine.position.y = 0.5;
    this.aimMark.add(amEdge, amRing, amDot, amLine);
    this.aimMark.userData = { mat: amMat, line: amLine };
    this.aimMark.renderOrder = 10;
    this.aimMark.traverse((o) => { o.renderOrder = 10; });
    this.aimMark.visible = false;
    amMat.userData.lin = true; amLine.material.userData.lin = true;
    K.scene.add(this.aimMark);

    // ---- トッピング ----
    this.protos = this.buildProtos();
    this.itemMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.35 });
    this.itemMat.userData.lin = true;
    this.itemInst = {};
    for (const k in this.protos) {
      this.protos[k].geo = mergeGroup(this.protos[k].obj);
      this.itemInst[k] = new GrowInst(this.group, this.protos[k].geo, this.itemMat, 64, true);
    }
    const sprinkleMat = (c, r) => { const m = new THREE.MeshStandardMaterial({ color: srgbToLin(c), roughness: r }); m.userData.lin = true; return m; };
    this.tmeshes = {
      parsley: new GrowInst(this.group, new THREE.BoxGeometry(1, 0.25, 1), sprinkleMat(0x2f7a22, 0.6), 1024),
      pepper: new GrowInst(this.group, new THREE.IcosahedronGeometry(1, 0), sprinkleMat(0x1b1714, 0.8), 1024),
      cheese: new GrowInst(this.group, new THREE.BoxGeometry(1, 0.4, 0.4), sprinkleMat(0xf6ecc8, 0.7), 1024),
    };
    this.items = [];

    // ---- 容器を並べた棚 ----
    this.pantry = new THREE.Group();
    K.scene.add(this.pantry);
    this.slots = [];
    this.dummy = new THREE.Object3D();
    this.buildPantry();

    this.type = null; this.topping = null; this.mode = null;
    this.mtx = new THREE.Matrix4();
  }

  // ---------- 道具の形 ----------
  /** ソースのボトル（口が下を向いたときの原点が口の先。立てて置くときは上下を返す） */
  SauceController.prototype.buildBottle = function (bodyHex) {
    const g = new THREE.Group();
    const body = new THREE.MeshPhysicalMaterial({ color: srgbToLin(bodyHex), roughness: 0.3, clearcoat: 0.9 });
    const white = new THREE.MeshStandardMaterial({ color: srgbToLin(0xf4f2ec), roughness: 0.4 });
    body.userData.lin = white.userData.lin = true;
    const squeeze = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.135, 0.62, 28), body);
    b.position.y = 0.55;
    const shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.085, 0.1, 28), body);
    shoulder.position.y = 0.19;
    const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 28), body);
    bottom.position.y = 0.87;
    squeeze.add(b, shoulder, bottom);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.08, 20), white);
    cap.position.y = 0.11;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.05, 0.1, 16), white);
    nozzle.position.y = 0.05;
    g.add(squeeze, cap, nozzle);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData.squeeze = squeeze;
    return g;
  };

  SauceController.prototype.buildProtos = function () {
    const P = {};
    const M = (c, r, cc) => new THREE.MeshPhysicalMaterial({ color: c, roughness: r, clearcoat: cc || 0 });
    {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.24, 10), M(0x9cc06a, 0.6));
      stem.rotation.z = Math.PI / 2; stem.position.x = -0.08;
      g.add(stem);
      const fm = M(0x2f6a1f, 0.85);
      for (let i = 0; i < 9; i++) {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), fm);
        const a = i * 2.4, r = i === 0 ? 0 : 0.055;
        f.position.set(0.08 + (i === 0 ? 0.03 : 0), Math.cos(a) * r, Math.sin(a) * r);
        g.add(f);
      }
      P.broccoli = { obj: g, hh: 0.1, r: 0.13, roll: false, mu: 0.6, rest: 0.05 };
    }
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 22, 16), M(0xd91e10, 0.15, 1)));
      const cal = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.025, 5), M(0x3d7a24, 0.6));
      cal.position.y = 0.11; g.add(cal);
      P.tomato = { obj: g, hh: 0.11, r: 0.11, roll: true, mu: 0.02, rest: 0.25 };
    }
    {
      const g = new THREE.Group();
      // 大きめの輪切り
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.125, 0.045, 28), M(0xf07a1e, 0.25, 0.8)));
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), M(0xffa04a, 0.4));
      core.rotation.x = -Math.PI / 2; core.position.y = 0.0231; g.add(core);
      P.carrot = { obj: g, hh: 0.023, r: 0.13, roll: false, mu: 0.45, rest: 0.05 };
    }
    {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.05), M(0xd68f2a, 0.5)));
      P.potato = { obj: g, hh: 0.025, r: 0.07, roll: false, mu: 0.5, rest: 0.05 };
    }
    return P;
  };

  /** 皿の奥にソースのボトル、その手前にトッピングの透明容器を並べる */
  SauceController.prototype.buildPantry = function () {
    const K = this.K, P = K.POS.plate;
    const add = (key, kind, obj, pos, hitSize, labelText) => {
      const g = new THREE.Group();
      g.position.copy(pos);
      g.add(obj);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(hitSize[0], hitSize[1], hitSize[2]), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = hitSize[1] / 2;
      g.add(hit);
      const lb = K.makeLabel(labelText, { size: 56, color: '#fff7ea', bg: 'rgba(26,19,15,0.72)', height: 0.1 });
      lb.position.set(0, 0.03, hitSize[2] / 2 + 0.1);
      lb.rotation.x = -1.0;
      g.add(lb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(hitSize[0], hitSize[2]) * 0.62, 0.014, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffc12e }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; ring.visible = false;
      g.add(ring);
      this.pantry.add(g);
      this.slots.push({ key, kind, g, obj, hit, ring, base: pos.clone() });
    };
    const sx = [-1.55, -0.52, 0.52, 1.55];
    Object.keys(SAUCES).forEach((k, i) => {
      const obj = this.buildBottle(SAUCES[k].body);
      obj.rotation.x = Math.PI; obj.position.y = 0.9;   // 立てて置く
      add(k, 'sauce', obj, new THREE.Vector3(P.x + sx[i], 0, P.z - 2.9), [0.42, 0.95, 0.42], SAUCES[k].name);
    });
    const boxShape = (w, r) => {
      const s = new THREE.Shape(), h = w / 2;
      s.moveTo(-h + r, -h); s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
      s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h); s.lineTo(-h + r, h);
      s.quadraticCurveTo(-h, h, -h, h - r); s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
      return s;
    };
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
    glass.userData.lin = true;
    const r = U.rng(8);
    const W = 0.44, H = 0.2;
    const geo = new THREE.ExtrudeGeometry(boxShape(W, 0.08), { depth: H, bevelEnabled: false, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2);
    Object.keys(TOPPINGS).forEach((k, i) => {
      const box = new THREE.Group();
      const shell = new THREE.Mesh(geo, glass);
      shell.renderOrder = 1;
      box.add(shell);
      const T = TOPPINGS[k];
      const d = this.dummy;
      let im;
      if (T.item) {
        im = new THREE.InstancedMesh(this.protos[k].geo, this.itemMat, 4);
        for (let n = 0; n < 4; n++) {
          d.position.set((r() - 0.5) * 0.2, 0.04 + n * 0.012, (r() - 0.5) * 0.2);
          d.rotation.set(0, r() * 6, 0); d.scale.setScalar(0.6);
          d.updateMatrix(); im.setMatrixAt(n, d.matrix);
        }
      } else {
        im = new THREE.InstancedMesh(this.tmeshes[k].geo, this.tmeshes[k].mat, 120);
        for (let n = 0; n < 120; n++) {
          d.position.set((r() - 0.5) * 0.34, 0.02 + r() * 0.06, (r() - 0.5) * 0.34);
          d.rotation.set(r() * 3, r() * 3, r() * 3);
          const s = k === 'pepper' ? 0.008 : k === 'cheese' ? 0.03 : 0.022;
          d.scale.set(s, k === 'cheese' ? 0.01 : s, k === 'cheese' ? 0.01 : s);
          d.updateMatrix(); im.setMatrixAt(n, d.matrix);
        }
      }
      box.add(im);
      add(k, 'top', box, new THREE.Vector3(P.x - 1.65 + i * 0.55, 0, P.z - 2.1), [W, H + 0.05, W], T.name);
    });
    this.pantry.visible = false;
  };

  SauceController.prototype.reset = function (run) {
    this.run = run;
    for (const k in this.tmeshes) this.tmeshes[k].count = 0;
    for (const k in this.itemInst) this.itemInst[k].count = 0;
    this.items.length = 0;
    this.th.fill(0);
    this.strokes = [];
    this.history = [];
    this.cur = null;
    this.pouring = false;
    this.simAwake = false;
    this.dirty = null;
    this.act = null;
    this.rawEggVol = 0;
    this.baseReady = false;
    this.smesh.visible = false;
    for (const k in this.bottles) this.bottles[k].visible = false;
    this.stream.visible = false;
    this.type = null; this.topping = null; this.mode = null; this.selected = null;
    this.slots.forEach((s) => { s.g.position.copy(s.base); s.ring.visible = false; s.g.visible = true; s.obj.visible = true; });
    this.aimSm = null; this.aim = null;
    if (this.aimMark) this.aimMark.visible = false;
  };

  // ---------------- 料理の高さを上から測る ----------------
  SauceController.prototype.captureBase = function () {
    const G = window.PKG, renderer = G && G.renderer;
    if (!renderer) return;
    const K = this.K, P = K.POS.plate, scene = K.scene;
    if (!this.ocam) {
      this.ocam = new THREE.OrthographicCamera(-HX, HX, HZ, -HZ, 0.1, 4);
      this.ocam.up.set(0, 0, -1);
      this.ocam.position.set(P.x, 3, P.z + CZ);
      this.ocam.lookAt(P.x, 0, P.z + CZ);
      this.ocam.updateMatrixWorld(true);
      this.ocam.layers.set(LAYER);
      this.rt = new THREE.WebGLRenderTarget(NX, NZ, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      // 開いて裏返った皮は、内側の面（BackSide）しか上から見えない。両面を測らないと高さが 0 になり、ソースが皮の下に沈む
      this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      this.catMats = [1, 2, 3].map((c) => new THREE.MeshBasicMaterial({ color: c === 1 ? 0xff0000 : c === 2 ? 0x00ff00 : 0x0000ff, toneMapped: false, side: THREE.DoubleSide }));
      this.pix = new Uint8Array(NX * NZ * 4);
    }
    const om = this.pan.omelette;
    const objs = [];
    // 前回の高さを覚えておく（トッピングが乗った所のソースを、二重に高さへ足さないため）
    const prevBase = this.prevBase || (this.prevBase = new Float32Array(NX * NZ));
    const hadBase = this.baseReady;
    if (hadBase) prevBase.set(this.base);
    // まだ動いている（落ちている）トッピングは、測る間だけ見えなくする。測ってしまうと、空中の自分の姿の上に乗って浮いてしまう
    const flying = this.items.filter((it) => !it.asleep);
    const zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
    flying.forEach((it) => this.itemInst[it.kind].mesh.setMatrixAt(it.idx, zeroM));
    flying.forEach((it) => { this.itemInst[it.kind].mesh.instanceMatrix.needsUpdate = true; });
    const mark = (root, c) => root.traverse((o) => { if (o.isMesh && o.visible) { o.layers.enable(LAYER); objs.push([o, c, o.material]); } });
    mark(K.plateGroup, 0);
    if (om.group.visible) mark(om.group, CAT.egg);
    // 置いて止まったトッピングも高さに入れる（ソースはその上に重なる。下の皿へ突き抜けない）
    for (const k in this.itemInst) { const m = this.itemInst[k].mesh; if (m.count) { m.layers.enable(LAYER); objs.push([m, CAT.plate, m.material, true]); } }
    for (const e of objs) {
      if (e[1]) continue;
      e[1] = e[0] === K.riceMesh || e[0].isInstancedMesh ? CAT.rice : CAT.plate;
    }
    this.itemsDirty = false;
    const prevRT = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const prevBg = scene.background, prevFog = scene.fog, prevAuto = renderer.shadowMap.autoUpdate;
    scene.background = null; scene.fog = null; renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    // 1) 深さ → 高さ
    scene.overrideMaterial = this.depthMat;
    renderer.setClearColor(0xffffff, 1); renderer.clear();
    renderer.render(scene, this.ocam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, NX, NZ, this.pix);
    const px = this.pix, base = this.base, cam = this.ocam;
    for (let r = 0; r < NZ; r++) for (let i = 0; i < NX; i++) {
      const o = (r * NX + i) * 4;
      const d = (255 / 256) * (px[o] / 255 / 16777216 + px[o + 1] / 255 / 65536 + px[o + 2] / 255 / 256 + px[o + 3] / 255);
      const y = cam.position.y - (cam.near + d * (cam.far - cam.near));
      const j = NZ - 1 - r;   // 画像の下 = 手前（+z）
      base[j * NX + i] = Math.max(0, y);
    }
    // 切り立った所はソースが不自然に引き伸ばされるので、少しふくらませてからならす（実物より下にはならない）
    this.smoothBase();
    // 2) そこにある物（卵・ライス・皿）
    scene.overrideMaterial = null;
    for (const e of objs) e[0].material = this.catMats[e[1] - 1];
    renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, this.ocam);
    renderer.readRenderTargetPixels(this.rt, 0, 0, NX, NZ, px);
    for (let r = 0; r < NZ; r++) for (let i = 0; i < NX; i++) {
      const o = (r * NX + i) * 4, j = NZ - 1 - r;
      const R = px[o], Gc = px[o + 1], B = px[o + 2];
      const m = Math.max(R, Gc, B);
      this.cat[j * NX + i] = m < 12 ? CAT.none : m === R ? CAT.egg : m === Gc ? CAT.rice : CAT.plate;
    }
    for (const e of objs) { e[0].material = e[2]; e[0].layers.disable(LAYER); }
    // 見えなくしていたトッピングを元に戻す
    {
      const one = new THREE.Vector3(1, 1, 1);
      flying.forEach((it) => { this.mtx.compose(it.pos, it.quat, one); this.itemInst[it.kind].mesh.setMatrixAt(it.idx, this.mtx); });
      flying.forEach((it) => { this.itemInst[it.kind].mesh.instanceMatrix.needsUpdate = true; });
    }
    // 新しく物（トッピング）が乗って高さが上がった所は、その下のソースを高さから引く。
    // 引かないと、物の高さ（ソースの上に乗っている分）にソースの厚みがもう一度足されて、ソースが塔のように伸びる
    if (hadBase) {
      const b2 = this.base, th2 = this.th;
      for (let k = 0; k < NX * NZ; k++) {
        const t = th2[k];
        if (t <= 0) continue;
        const d = b2[k] - prevBase[k];
        if (d > 1e-4) th2[k] = t > d ? t - d : 0;
      }
    }
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.background = prevBg; scene.fog = prevFog; renderer.shadowMap.autoUpdate = prevAuto;
    this.baseReady = true;
    this.baseT = 0;
    this.baseVer = om.geomVer;
    this.markDirty(0, 0, NX - 1, NZ - 1);
  };

  SauceController.prototype.smoothBase = function () {
    const b = this.base, t = this.dTh, R = 2;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? b : t, dst = pass === 0 ? t : b;
      // 横方向の最大値 → 縦方向の最大値
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        let m = 0;
        for (let a = -R; a <= R; a++) {
          const ii = pass === 0 ? i + a : i, jj = pass === 0 ? j : j + a;
          if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
          const v = src[jj * NX + ii]; if (v > m) m = v;
        }
        dst[j * NX + i] = m;
      }
    }
    const KW = [1, 4, 6, 4, 1];
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? b : t, dst = pass === 0 ? t : b;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        let sm = 0, ws = 0;
        for (let a = -2; a <= 2; a++) {
          const ii = pass === 0 ? i + a : i, jj = pass === 0 ? j : j + a;
          if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue;
          sm += src[jj * NX + ii] * KW[a + 2]; ws += KW[a + 2];
        }
        dst[j * NX + i] = sm / ws;
      }
    }
  };

  // ---------------- 高さ場の読み取り ----------------
  SauceController.prototype.cellOf = function (x, z) {
    return [Math.floor((x - this.x0) / DX), Math.floor((z - this.z0) / DX)];
  };
  /** 表面（料理＋ソース）の高さ（なめらかに補間） */
  SauceController.prototype.heightAt = function (x, z) {
    const fx = (x - this.x0) / DX - 0.5, fz = (z - this.z0) / DX - 0.5;
    if (fx < 0 || fz < 0 || fx > NX - 1 || fz > NZ - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * NX + i, b = this.base, t = this.th;
    const i1 = Math.min(i + 1, NX - 1) - i, j1 = (Math.min(j + 1, NZ - 1) - j) * NX;
    const h00 = b[k] + t[k], h10 = b[k + i1] + t[k + i1], h01 = b[k + j1] + t[k + j1], h11 = b[k + i1 + j1] + t[k + i1 + j1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  };
  SauceController.prototype.normalAt = function (x, z, out) {
    const e = DX * 1.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return (out || new THREE.Vector3()).set(-hx, 2 * e, -hz).normalize();
  };
  SauceController.prototype.catAt = function (x, z) {
    const [i, j] = this.cellOf(x, z);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return 'table';
    const c = this.cat[j * NX + i];
    if (c === CAT.egg) return 'egg';
    if (c === CAT.rice) return 'rice';
    if (c === CAT.plate) return Math.hypot(x - this.K.POS.plate.x, z - this.K.POS.plate.z) > 1.2 ? 'rim' : 'plate';
    return 'table';
  };
  /** 画面の点 → 料理の表面の点（高さ場に沿ってレイを進める） */
  /** 卵の形が変わっていたら料理の高さを測り直す（ソースが卵の裏に回り込まないように）。重いので間隔をあける */
  SauceController.prototype.ensureBase = function (force) {
    const now = performance.now();
    if (!this.baseReady || ((this.pan.omelette.geomVer !== this.baseVer || this.itemsDirty) && (force || now - (this.capAt || 0) > (this.pouring ? 500 : 1200)))) {
      this.captureBase();
      this.capAt = now;
    }
  };
  SauceController.prototype.castScreen = function (ndc, camera, force) {
    this.ensureBase(force);
    this.ray.setFromCamera(ndc, camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y >= -1e-4) return null;
    const P = this.K.POS.plate;
    const top = 1.2;
    let t = Math.max(0, (top - o.y) / d.y);
    const tEnd = (0 - o.y) / d.y;
    const p = new THREE.Vector3();
    let prevT = t, prevDiff = 1;
    const step = DX * 0.8;
    for (; t <= tEnd + step; t += step) {
      p.copy(o).addScaledVector(d, t);
      const diff = p.y - this.heightAt(p.x, p.z);
      if (diff <= 0) {
        // 二分法で詰める
        let a = prevT, b = t;
        for (let it = 0; it < 6; it++) {
          const m = (a + b) / 2;
          p.copy(o).addScaledVector(d, m);
          if (p.y - this.heightAt(p.x, p.z) > 0) a = m; else b = m;
        }
        p.copy(o).addScaledVector(d, b);
        p.y = this.heightAt(p.x, p.z);
        if (p.x < this.x0 || p.z < this.z0 || p.x > this.x0 + NX * DX || p.z > this.z0 + NZ * DX) return null;
        return { point: p };
      }
      prevT = t; prevDiff = diff;
    }
    void prevDiff;
    return null;
  };

  // ---------------- 選ぶ ----------------
  SauceController.prototype.select = function (slot) {
    this.slots.forEach((s) => { s.ring.visible = s === slot; s.g.position.copy(s.base); s.obj.visible = true; });
    slot.g.position.y = 0.1;
    if (slot.kind === 'sauce') {
      this.mode = 'sauce'; this.type = slot.key; this.topping = null;
      slot.obj.visible = false;      // 手に取っている
    } else {
      this.mode = 'topping'; this.topping = slot.key; this.type = null;
    }
    this.hideTools();
    this.audio.play('click', 0.7);
    this.selected = slot;
    if (!this.baseReady) this.captureBase();
  };
  SauceController.prototype.hideTools = function () {
    for (const k in this.bottles) this.bottles[k].visible = false;
    this.stream.visible = false;
  };
  SauceController.prototype.selectedName = function () {
    if (this.mode === 'sauce') return SAUCES[this.type].name;
    if (this.mode === 'topping') return TOPPINGS[this.topping].name;
    return null;
  };
  SauceController.prototype.putAway = function () {
    if (this.pouring) this.pointerUp();
    this.slots.forEach((s) => { s.g.position.copy(s.base); s.ring.visible = false; s.obj.visible = true; });
    this.hideTools();
    this.mode = null; this.type = null; this.topping = null; this.selected = null;
    this.aim = null; this.aimMark.visible = false;
  };

  /** ボトルを注ぐ点の上に逆さに構え、口の位置を返す */
  SauceController.prototype.placeTool = function (p) {
    const b = this.bottles[this.type];
    for (const k in this.bottles) this.bottles[k].visible = k === this.type;
    const rig = window.PKG && window.PKG.rig;
    const yaw = rig ? rig.theta : 0;
    b.rotation.set(0, yaw, -0.2);
    b.position.set(p.x, p.y + (this.pouring ? 0.16 : 0.3), p.z);
    // 握るとボトルが少しへこむ
    const sq = b.userData.squeeze, k = this.pouring ? 1 : 0;
    sq.scale.set(1 - 0.12 * k, 1, 1 + 0.04 * k);
    return new THREE.Vector3(p.x, b.position.y, p.z);
  };

  /** ボトルの口の真下に、どこに落ちるかの目印を出す */
  SauceController.prototype.updateAimMark = function () {
    const m = this.aimMark;
    const p = this.pouring ? this.aimSm : this.aim;
    if (this.mode !== 'sauce' || !p) { m.visible = false; return; }
    const y = this.heightAt(p.x, p.z);
    m.visible = true;
    m.position.set(p.x, y + 0.004, p.z);
    const b = this.bottles[this.type];
    const top = b ? b.position.y - y : 0.3;
    m.userData.line.scale.y = Math.max(0.01, top);
    m.userData.line.position.y = top / 2;
    m.userData.line.visible = !this.pouring;
    m.userData.mat.color.set(SAUCES[this.type].color).convertSRGBToLinear().lerp(new THREE.Color(1, 1, 1), 0.35);
  };

  // ---------------- 入力 ----------------
  SauceController.prototype.pointerDown = function (ndc, camera) {
    this.ray.setFromCamera(ndc, camera);
    const ph = this.ray.intersectObjects(this.slots.map((s) => s.hit), false)[0];
    if (ph) {
      const slot = this.slots.find((s) => s.hit === ph.object);
      // 持っている物の元の場所をタップしたら、そこへ戻す
      if (slot === this.selected) { this.putAway(); this.audio.play('click', 0.6); this.putBack = true; }
      else this.select(slot);
      return true;
    }
    const h = this.castScreen(ndc, camera, true);
    if (!h) return false;
    if (!this.mode) { this.needPick = true; return true; }
    if (this.mode === 'sauce') {
      this.pouring = true;
      this.pourT = 0;
      this.holdT = 0;
      this.history.push({ kind: 'sauce', snap: this.snapshot() });
      this.trimHistory();
      this.cur = { type: this.type, vol: 0, pts: [h.point.clone()] };
      this.strokes.push(this.cur);
      this.aim = h.point.clone();
      this.aimSm = h.point.clone();
      this.lastDep = null;
      this.placeTool(h.point);
      this.audio.play('pour', 0.3);
      return true;
    }
    this.placeTopping(h.point);
    return true;
  };
  SauceController.prototype.pointerMove = function (ndc, camera) {
    if (this.mode !== 'sauce') return;
    const h = this.castScreen(ndc, camera);
    if (!h) return;
    this.aim = h.point.clone();
    if (!this.pouring) this.placeTool(h.point);
  };
  SauceController.prototype.hover = function (ndc, camera) { this.pointerMove(ndc, camera); };
  SauceController.prototype.pointerUp = function () {
    if (!this.pouring) return;
    this.pouring = false;
    this.stream.visible = false;
    const st = this.cur;
    this.cur = null;
    if (st && st.vol <= 0) {
      this.strokes.pop();
      const h = this.history.pop();
      if (h && h.snap) this.restore(h.snap);
    }
    if (this.aimSm) this.placeTool(this.aimSm);
    this.recompute();
  };

  // ---------------- 取り消し用の写し ----------------
  SauceController.prototype.snapshot = function () {
    return { th: this.th.slice(), ar: this.ar.slice(), ag: this.ag.slice(), ab: this.ab.slice(), ahy: this.ahy.slice(), aK: this.aK.slice() };
  };
  SauceController.prototype.restore = function (s) {
    this.th.set(s.th); this.ar.set(s.ar); this.ag.set(s.ag); this.ab.set(s.ab); this.ahy.set(s.ahy); this.aK.set(s.aK);
    this.markDirty(0, 0, NX - 1, NZ - 1);
    this.simAwake = true; this.calm = 0;
  };
  SauceController.prototype.trimHistory = function () {
    // 古いソースの写しは捨てる（メモリ節約）。取り消しはできなくなる
    let n = 0;
    for (let i = this.history.length - 1; i >= 0; i--) if (this.history[i].snap) { n++; if (n > MAX_UNDO) this.history[i].snap = null; }
  };

  // ---------------- ソースを落とす ----------------
  SauceController.prototype.deposit = function (x, z, vol, S) {
    const sig = S.sig, R = Math.ceil((sig * 2.6) / DX);
    const [ci, cj] = this.cellOf(x, z);
    if (ci < -R || cj < -R || ci >= NX + R || cj >= NZ + R) return;
    const col = S._rgb || (S._rgb = (() => { const c = new THREE.Color(S.color); return [c.r, c.g, c.b]; })());
    let wsum = 0;
    const ws = this._ws || (this._ws = new Float32Array(64 * 64));
    const W = 2 * R + 1;
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
      const px = this.x0 + (ci + a + 0.5) * DX - x, pz = this.z0 + (cj + b + 0.5) * DX - z;
      const w = Math.exp(-(px * px + pz * pz) / (2 * sig * sig));
      ws[(b + R) * W + a + R] = w; wsum += w;
    }
    const amt = vol / (wsum * DX * DX);
    for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) {
      const i = ci + a, j = cj + b;
      if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
      const k = j * NX + i;
      const add = ws[(b + R) * W + a + R] * amt;
      const t0 = this.th[k], t1 = t0 + add;
      // 上からかけたソースの色が見えるように、新しい方を強めに混ぜる
      const f = t1 > 0 ? Math.min(1, (add * 2.5) / (t0 + add * 2.5)) : 1;
      if (t0 < 1e-5) { this.ar[k] = col[0]; this.ag[k] = col[1]; this.ab[k] = col[2]; this.ahy[k] = S.hy; this.aK[k] = S.K; }
      else {
        this.ar[k] += (col[0] - this.ar[k]) * f; this.ag[k] += (col[1] - this.ag[k]) * f; this.ab[k] += (col[2] - this.ab[k]) * f;
        const g = add / t1;
        this.ahy[k] += (S.hy - this.ahy[k]) * g; this.aK[k] += (S.K - this.aK[k]) * g;
      }
      this.th[k] = t1;
    }
    this.markDirty(ci - R - 1, cj - R - 1, ci + R + 1, cj + R + 1);
    this.simAwake = true; this.calm = 0;
  };

  SauceController.prototype.markDirty = function (i0, j0, i1, j1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(NX - 1, i1); j1 = Math.min(NZ - 1, j1);
    const d = this.dirty;
    if (!d) this.dirty = { i0, j0, i1, j1 };
    else { d.i0 = Math.min(d.i0, i0); d.j0 = Math.min(d.j0, j0); d.i1 = Math.max(d.i1, i1); d.j1 = Math.max(d.j1, j1); }
    if (!this.act) this.act = { i0, j0, i1, j1 };
    else { const a = this.act; a.i0 = Math.min(a.i0, i0); a.j0 = Math.min(a.j0, j0); a.i1 = Math.max(a.i1, i1); a.j1 = Math.max(a.j1, j1); }
  };

  /** とろみのある液体として、低い方へゆっくり流す */
  SauceController.prototype.flow = function (dt) {
    const a = this.act;
    if (!a) return 0;
    const i0 = Math.max(1, a.i0 - 2), j0 = Math.max(1, a.j0 - 2), i1 = Math.min(NX - 2, a.i1 + 2), j1 = Math.min(NZ - 2, a.j1 + 2);
    const th = this.th, base = this.base, out = this.outS, ot = this.outTot;
    const gain = this.dTh, inR = this.inR, inG = this.inG, inB = this.inB, inHy = this.inHy, inK = this.inK;
    const NB = [1, -1, NX, -NX];
    const c = dt / (DX * DX);
    let maxMove = 0;
    let ni0 = NX, nj0 = NZ, ni1 = -1, nj1 = -1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      gain[k] = 0; inR[k] = 0; inG[k] = 0; inB[k] = 0; inHy[k] = 0; inK[k] = 0; ot[k] = 0;
      out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = out[k * 4 + 3] = 0;
      const t = th[k];
      if (t <= 1e-6) continue;
      if (i < ni0) ni0 = i; if (i > ni1) ni1 = i; if (j < nj0) nj0 = j; if (j > nj1) nj1 = j;
      const te = Math.min(0.02, t - this.ahy[k]);
      if (te <= 0) continue;
      // 厚いほど（とろみの限界を超えた分の3乗で）流れやすい
      const mob = te * te * te * this.aK[k] * 10;
      const S0 = base[k] + t;
      let tot = 0;
      for (let n = 0; n < 4; n++) {
        const dS = S0 - (base[k + NB[n]] + th[k + NB[n]]);
        if (dS <= 0) continue;
        const f = mob * Math.min(dS, 0.06) * c;
        out[k * 4 + n] = f; tot += f;
      }
      // 限界の厚みより下の分は出ていかない
      const lim = Math.max(0, t - this.ahy[k] * 0.6) * 0.4;
      if (tot > lim) { const sc = tot > 0 ? lim / tot : 0; for (let n = 0; n < 4; n++) out[k * 4 + n] *= sc; tot = lim; }
      if (tot > maxMove) maxMove = tot;
    }
    if (maxMove < 2e-7) { this.act = ni1 >= 0 ? { i0: ni0, j0: nj0, i1: ni1, j1: nj1 } : null; return 0; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      for (let n = 0; n < 4; n++) {
        const f = out[k * 4 + n];
        if (!f) continue;
        const m = k + NB[n];
        gain[m] += f; inR[m] += f * this.ar[k]; inG[m] += f * this.ag[k]; inB[m] += f * this.ab[k]; inHy[m] += f * this.ahy[k]; inK[m] += f * this.aK[k];
        ot[k] += f;
      }
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      const g = gain[k], o = ot[k];
      if (!g && !o) continue;
      const own = Math.max(0, th[k] - o);
      const nt = own + g;
      if (g > 0 && nt > 0) {
        this.ar[k] = (this.ar[k] * own + inR[k]) / nt; this.ag[k] = (this.ag[k] * own + inG[k]) / nt; this.ab[k] = (this.ab[k] * own + inB[k]) / nt;
        this.ahy[k] = (this.ahy[k] * own + inHy[k]) / nt; this.aK[k] = (this.aK[k] * own + inK[k]) / nt;
      }
      th[k] = nt;
    }
    this.markDirty(i0, j0, i1, j1);
    this.act = { i0: Math.max(0, ni0 - 1), j0: Math.max(0, nj0 - 1), i1: Math.min(NX - 1, ni1 + 1), j1: Math.min(NZ - 1, nj1 + 1) };
    return maxMove;
  };

  /** 変わった範囲だけメッシュと色を作り直す */
  SauceController.prototype.redraw = function () {
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    const th = this.th, base = this.base, pos = this.spos, nrm = this.snrm, td = this.texData;
    const j0 = Math.max(0, d.j0 - 1), j1 = Math.min(NZ - 1, d.j1 + 1), i0 = Math.max(0, d.i0 - 1), i1 = Math.min(NX - 1, d.i1 + 1);
    let any = this.smesh.visible;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      const t = th[k];
      pos[k * 3 + 1] = base[k] + t + 0.004;
      td[k * 4] = this.ar[k] * 255; td[k * 4 + 1] = this.ag[k] * 255; td[k * 4 + 2] = this.ab[k] * 255;
      td[k * 4 + 3] = U.clamp((t - 0.0004) / 0.0032, 0, 1) * 255;
      if (t > 0.0008) any = true;
    }
    // 法線（高さの傾きから）
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * NX + i;
      const l = i > 0 ? k - 1 : k, r = i < NX - 1 ? k + 1 : k, u = j > 0 ? k - NX : k, w = j < NZ - 1 ? k + NX : k;
      const hx = pos[r * 3 + 1] - pos[l * 3 + 1], hz = pos[w * 3 + 1] - pos[u * 3 + 1];
      const nx = -hx, ny = 2 * DX, nz = -hz, inv = 1 / Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx * inv; nrm[k * 3 + 1] = ny * inv; nrm[k * 3 + 2] = nz * inv;
    }
    const pa = this.sgeo.attributes.position, na = this.sgeo.attributes.normal;
    pa.updateRange.offset = na.updateRange.offset = j0 * NX * 3;
    pa.updateRange.count = na.updateRange.count = (j1 - j0 + 1) * NX * 3;
    pa.needsUpdate = na.needsUpdate = true;
    this.tex.needsUpdate = true;
    this.smesh.visible = any;
  };

  SauceController.prototype.update = function (dt) {
    // 開いた直後のとろとろが流れている間は、料理の高さを測り直す
    const om = this.pan.omelette;
    void om;
    this.updateAimMark();
    if (this.pouring && this.cur && this.aim) this.updatePour(dt);
    if (this.simAwake) {
      const sub = 2;
      let mv = 0;
      for (let s = 0; s < sub; s++) mv = Math.max(mv, this.flow(Math.min(dt, 1 / 30) / sub));
      if (mv < 2e-7 && !this.pouring) { this.calm = (this.calm || 0) + dt; if (this.calm > 0.5) { this.simAwake = false; this.recompute(); } }
      else this.calm = 0;
    }
    this.redrawT = (this.redrawT || 0) + dt;
    if (this.dirty && (this.redrawT > 1 / 30 || this.pouring)) { this.redrawT = 0; this.redraw(); }
    this.updateItems(dt);
  };

  SauceController.prototype.updatePour = function (dt) {
    this.pourT += dt;
    const st = this.cur, S = SAUCES[st.type];
    // ボトルの口は手に少し遅れて付いてくる
    this.aimSm.lerp(this.aim, 1 - Math.exp(-dt * (this.type === 'ketchup' ? 45 : 22)));   // ケチャップは手の動きにぴったり（字を書きやすく）
    const p = new THREE.Vector3(this.aimSm.x, this.heightAt(this.aimSm.x, this.aimSm.z), this.aimSm.z);
    const tip = this.placeTool(p);
    if (this.pourT < 0.08) return;
    const dv = S.rate * dt;
    // 前の位置から今の位置まで、とぎれずに並べて落とす
    const from = this.lastDep || p;
    const len = Math.hypot(p.x - from.x, p.z - from.z);
    // 長押し判定：ほぼ動かさずに押し続けている間は、落とす幅を少しずつ広げて、高い塔にならず丸く低く溜まるようにする
    const spd = len / Math.max(dt, 1e-3);
    this.holdT = spd < 0.25 ? (this.holdT || 0) + dt : 0;
    let Sd = S;
    if (this.holdT > 0.3) {
      const sc = 1 + Math.min(2.5, (this.holdT - 0.3) * 1.4);
      Sd = this._holdS || (this._holdS = {});
      if (Sd._src !== S) { Object.keys(Sd).forEach((k) => delete Sd[k]); Object.assign(Sd, S); Sd._src = S; }
      Sd.sig = S.sig * sc;
    }
    const n = Math.max(1, Math.ceil(len / (S.sig * 0.45)));
    for (let s = 1; s <= n; s++) {
      const f = s / n;
      this.deposit(from.x + (p.x - from.x) * f, from.z + (p.z - from.z) * f, dv / n, Sd);
    }
    this.lastDep = p.clone();
    st.vol += dv;
    const last = st.pts[st.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.z - last.z) > 0.03) st.pts.push(p.clone());
    // ボトルから落ちる流れ
    const l = tip.distanceTo(p);
    const rad = Math.sqrt(S.rate) * 0.32;
    this.stream.visible = true;
    this.streamMat.color.set(S.color).convertSRGBToLinear();
    this.stream.position.copy(tip).add(p).multiplyScalar(0.5);
    this.stream.scale.set(rad, l, rad);
    this.stream.quaternion.setFromUnitVectors(UPV, new THREE.Vector3().subVectors(tip, p).normalize());
    if (Math.random() < dt * 3) this.audio.play('squirt', 0.2);
  };

  // ---------------- トッピング ----------------
  SauceController.prototype.placeTopping = function (pt) {
    const T = TOPPINGS[this.topping];
    if (!T) return;
    const tp = this.run.toppings;
    if (T.item) {
      const pr = this.protos[this.topping];
      const n = T.n;
      const added = [];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28;
        const pos = new THREE.Vector3(pt.x + (n > 1 ? Math.cos(a) * 0.08 : 0), pt.y + 0.45 + i * 0.12, pt.z + (n > 1 ? Math.sin(a) * 0.08 : 0));
        const yaw = Math.random() * 6.28;
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 0.8, yaw, Math.random() * 0.8));
        const inst = this.itemInst[this.topping];
        const it = { kind: this.topping, pos, quat, yaw, idx: 0, hh: pr.hh, r: pr.r, roll: pr.roll, mu: pr.mu, rest: pr.rest,
          v: new THREE.Vector3((Math.random() - 0.5) * 0.4, -0.5, (Math.random() - 0.5) * 0.4), sleepT: 0, asleep: false, ground: 'air' };
        this.mtx.compose(pos, quat, new THREE.Vector3(1, 1, 1));
        it.idx = inst.add(this.mtx);
        this.items.push(it);
        added.push(it);
      }
      tp.counts[this.topping] = (tp.counts[this.topping] || 0) + n;
      this.history.push({ kind: 'items', items: added, topping: this.topping });
      this.audio.play('plop', 0.4);
      return;
    }
    const inst = this.tmeshes[this.topping];
    const d = this.dummy;
    const start = inst.count;
    let onEgg = 0, onPlate = 0;
    const nrm = new THREE.Vector3(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    for (let i = 0; i < T.per; i++) {
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * T.spread;
      const x = pt.x + Math.cos(a) * r, z = pt.z + Math.sin(a) * r;
      const y = this.heightAt(x, z);
      this.normalAt(x, z, nrm);
      d.position.set(x, y, z).addScaledVector(nrm, 0.005);
      q.setFromUnitVectors(UPV, nrm);
      q2.setFromEuler(new THREE.Euler(Math.random() * 0.5, Math.random() * 6.28, Math.random() * 0.5));
      d.quaternion.copy(q).multiply(q2);
      let s;
      if (this.topping === 'parsley') { s = 0.012 + Math.random() * 0.012; d.scale.set(s, s, s * 1.3); }
      else if (this.topping === 'pepper') { s = 0.004 + Math.random() * 0.005; d.scale.set(s, s, s); }
      else { s = 0.022 + Math.random() * 0.03; d.scale.set(s, 0.008, 0.008); }
      d.updateMatrix();
      inst.add(d.matrix);
      const c = this.catAt(x, z);
      if (c === 'egg' || c === 'rice') onEgg++; else onPlate++;
    }
    const added = inst.count - start;
    tp.counts[this.topping] = (tp.counts[this.topping] || 0) + added;
    tp.onEgg += onEgg; tp.onPlate += onPlate;
    this.history.push({ kind: 'sprinkle', topping: this.topping, start, count: added, onEgg, onPlate });
    this.audio.play('sprinkle', 0.8);
  };

  SauceController.prototype.updateItems = function (dt) {
    if (!this.items.length) return;
    const awake = this.items.filter((it) => !it.asleep);
    if (!awake.length) return;
    const sub = 3, h = Math.min(dt, 0.04) / sub;
    const tmp = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), axis = new THREE.Vector3();
    const gt = new THREE.Vector3();
    for (let s = 0; s < sub; s++) {
      for (const it of awake) {
        const o = it.pos;
        it.v.y -= GRAV * h;
        o.addScaledVector(it.v, h);
        // 奥の壁にぶつかった物は、そこで止まる（壁は突き抜けない）
        if (o.z - it.r < TBL.wallZ) { o.z = TBL.wallZ + it.r; if (it.v.z < 0) it.v.z *= -0.25; }
        // テーブルの外（手前・左右の端の先）へ出た物は、もう床がないので下へ落ちていく
        if (!it.fallen && (o.x < TBL.x0 || o.x > TBL.x1 || o.z > TBL.z1)) it.fallen = true;
        const gy = it.fallen ? -99 : this.heightAt(o.x, o.z);
        if (o.y - it.hh <= gy + 0.001) {
          this.normalAt(o.x, o.z, n);
          o.y = gy + it.hh;
          const vn = it.v.dot(n);
          if (vn < 0) it.v.addScaledVector(n, -vn * (1 + (vn < -1.2 ? it.rest : 0)));
          gt.set(0, -GRAV, 0).addScaledVector(n, GRAV * n.y);
          const slope = Math.sqrt(Math.max(0, 1 - n.y * n.y));
          if (it.roll) {
            it.v.addScaledVector(gt, (5 / 7) * h);
            it.v.multiplyScalar(Math.exp(-1.4 * h));
            const vt = tmp.copy(it.v).addScaledVector(n, -it.v.dot(n));
            const sp = vt.length();
            if (sp > 1e-4) {
              axis.crossVectors(n, vt).normalize();
              q.setFromAxisAngle(axis, (sp / it.r) * h);
              it.quat.premultiply(q);
            }
          } else {
            if (slope > it.mu) it.v.addScaledVector(gt, h * (1 - it.mu / slope));
            it.v.multiplyScalar(Math.exp(-(slope > it.mu ? 3 : 18) * h));
            q.setFromUnitVectors(UPV, n);
            qy.setFromAxisAngle(UPV, it.yaw);
            q.multiply(qy);
            it.quat.slerp(q, 1 - Math.exp(-h * 18));
          }
        }
        it.ground = 'set';
      }
      // ぶつかり合い（動いている物と、近くの物だけ）
      for (const a of awake) for (const b of this.items) {
        if (a === b) continue;
        const d = tmp.subVectors(b.pos, a.pos);
        const minD = (a.r + b.r) * 0.85;
        if (Math.abs(d.x) > minD || Math.abs(d.z) > minD || Math.abs(d.y) > minD) continue;
        const dist = d.length();
        if (dist > 1e-5 && dist < minD) {
          d.multiplyScalar(1 / dist);
          const push = (minD - dist) * 0.5;
          a.pos.addScaledVector(d, -push);
          if (!b.asleep) b.pos.addScaledVector(d, push); else a.pos.addScaledVector(d, -push);
          const rel = b.v.clone().sub(a.v).dot(d);
          if (rel < 0) { a.v.addScaledVector(d, rel * 0.5); if (!b.asleep) b.v.addScaledVector(d, -rel * 0.5); }
        }
      }
    }
    const one = new THREE.Vector3(1, 1, 1), zeroS = new THREE.Vector3(0, 0, 0);
    const touched = {};
    for (const it of awake) {
      if (it.v.length() < 0.04) { it.sleepT += dt; if (it.sleepT > 0.5) { it.asleep = true; it.v.set(0, 0, 0); this.itemsDirty = true; } }
      else it.sleepT = 0;
      if (it.pos.y < -1) it.asleep = true;
      this.mtx.compose(it.pos, it.quat, it.pos.y < -2.5 ? zeroS : one);   // 落ちきった物は見えなくする
      this.itemInst[it.kind].mesh.setMatrixAt(it.idx, this.mtx);
      touched[it.kind] = true;
      it.ground = this.catAt(it.pos.x, it.pos.z);
    }
    for (const k in touched) this.itemInst[k].mesh.instanceMatrix.needsUpdate = true;
    this.countItems();
  };

  SauceController.prototype.countItems = function () {
    const tp = this.run.toppings;
    tp.sides = 0; tp.sidesOff = 0; tp.fell = 0;
    for (const it of this.items) {
      if (it.ground === 'plate' || it.ground === 'rim') tp.sides++;
      else if (it.ground === 'table') tp.fell++;
      else tp.sidesOff++;
    }
  };

  SauceController.prototype.undo = function () {
    const h = this.history.pop();
    if (!h) return false;
    const tp = this.run.toppings;
    if (h.kind === 'sauce') {
      if (!h.snap) { this.history.push(h); return false; }
      this.restore(h.snap);
      this.strokes.pop();
    } else if (h.kind === 'items') {
      // 最後に置いた物から順に消す（インスタンスの末尾を詰める）
      for (const it of h.items) {
        const i = this.items.indexOf(it);
        if (i >= 0) this.items.splice(i, 1);
      }
      const inst = this.itemInst[h.topping];
      const rest = this.items.filter((it) => it.kind === h.topping);
      const one = new THREE.Vector3(1, 1, 1);
      rest.forEach((it, i) => { it.idx = i; this.mtx.compose(it.pos, it.quat, it.pos.y < -2.5 ? new THREE.Vector3(0, 0, 0) : one); inst.mesh.setMatrixAt(i, this.mtx); });
      inst.count = rest.length;
      tp.counts[h.topping] -= h.items.length;
      // 消した物の上に乗っていた物は、宙に浮かないよう起こして落とし直す
      for (const o of this.items) {
        if (!o.asleep) continue;
        if (h.items.some((r) => Math.hypot(r.pos.x - o.pos.x, r.pos.z - o.pos.z) < (r.r + o.r) * 1.1 && o.pos.y > r.pos.y - 0.02)) { o.asleep = false; o.sleepT = 0; }
      }
      this.itemsDirty = true;   // 高さを測り直す
      this.countItems();
    } else if (h.kind === 'sprinkle') {
      this.tmeshes[h.topping].count = h.start;
      tp.counts[h.topping] -= h.count; tp.onEgg -= h.onEgg; tp.onPlate -= h.onPlate;
    }
    this.recompute();
    this.audio.play('click');
    return true;
  };

  /** 上から見て、ライスのうち卵（とトッピング）に覆われずに見えている割合 */
  SauceController.prototype.riceExposure = function () {
    this.ensureBase(true);
    const P = this.K.POS.plate, R = this.K.RICE;
    let rice = 0, all = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = this.x0 + (i + 0.5) * DX - P.x, z = this.z0 + (j + 0.5) * DX - P.z;
      if ((x / R.ra) ** 2 + (z / R.rb) ** 2 > 0.9) continue;
      all++;
      if (this.cat[j * NX + i] === CAT.rice) rice++;
    }
    return all ? rice / all : 0;
  };

  SauceController.prototype.recompute = function () {
    const sc = this.run.sauce;
    sc.byType = {}; sc.onEgg = sc.onRice = sc.onPlate = sc.onRim = 0; sc.total = 0; sc.strokes = 0; sc.patterns = []; sc.colors = 0;
    // 実際に今ある場所で数える（流れた先も反映）
    const P = this.K.POS.plate, A = DX * DX;
    let field = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, t = this.th[k];
      if (t <= 0) continue;
      const v = t * A;
      field += v;
      const c = this.cat[k];
      if (c === CAT.egg) sc.onEgg += v;
      else if (c === CAT.rice) sc.onRice += v;
      else if (c === CAT.plate) {
        const x = this.x0 + (i + 0.5) * DX - P.x, z = this.z0 + (j + 0.5) * DX - P.z;
        if (Math.hypot(x, z) > 1.2) sc.onRim += v; else sc.onPlate += v;
      } else sc.onRim += v;
    }
    let dep = 0;
    for (const st of this.strokes) dep += st.vol;
    const scale = dep > 0 ? field / dep : 0;
    let smoothSum = 0, smoothN = 0;
    const cols = new Set();
    for (const st of this.strokes) {
      if (st.vol <= 0) continue;
      sc.byType[st.type] = (sc.byType[st.type] || 0) + st.vol * scale;
      sc.strokes++;
      cols.add(st.type);
      const pts = st.pts;
      if (pts.length > 4) {
        let jerk = 0, n = 0;
        for (let i = 2; i < pts.length; i++) {
          const a1 = Math.atan2(pts[i - 1].z - pts[i - 2].z, pts[i - 1].x - pts[i - 2].x);
          const a2 = Math.atan2(pts[i].z - pts[i - 1].z, pts[i].x - pts[i - 1].x);
          let d = a2 - a1; d = Math.atan2(Math.sin(d), Math.cos(d));
          jerk += Math.abs(d); n++;
        }
        smoothSum += U.clamp(1 - (jerk / n - 0.25) * 1.2, 0, 1) * st.vol; smoothN += st.vol;
      } else { smoothSum += 0.7 * st.vol; smoothN += st.vol; }
    }
    sc.total = Math.max(0, field - (this.rawEggVol || 0));   // 流れた卵液はソースに数えない
    sc.smoothness = smoothN ? smoothSum / smoothN : 0;
    sc.customColor = false;
    sc.colors = cols.size;
  };

  PK.SauceController = SauceController;
  PK.SAUCES = SAUCES;
  PK.TOPPINGS = TOPPINGS;
})();
