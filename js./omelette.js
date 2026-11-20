/* PAKKAAAN! — 巻いたオムレツの3Dモデル
 *  左右2枚の殻（外側・内側の2マテリアル）＋中身のとろとろメッシュ。
 *  殻の各頂点は「閉じた形」と「ライスの上に開いた形」の両方を計算し、
 *  長さ方向の位置ごとの開き具合 openL/openR に応じて補間する。
 *  開いた形はライスと皿の実際の表面の高さに沿わせる。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;
  const NU = 48, NA = 24;

  function taper(u) { return Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.3)), 0.52); }

  function Omelette() {
    this.group = new THREE.Group();
    this.L = 1.9; this.W = 0.75; this.H = 0.5;
    this.squash = 0; this.sag = 0.5; this.irr = 0; this.tearAmp = 0;
    this.surfaceWorld = null;
    this.openL = new Float32Array(NU + 1);
    this.openR = new Float32Array(NU + 1);
    this.progress = 0; this.animT = -1; this.animDur = 1.6; this.reach = 1;
    this.runny = { amount: 0, spread: 0, flow: 0, lf: 0 };
    this.dirty = true;

    // 頂点ごとの凹凸ノイズ（形の乱れ用）
    this.noise = new Float32Array((NU + 1) * (NA + 1) * 2);
    for (let s = 0; s < 2; s++) for (let j = 0; j <= NA; j++) for (let i = 0; i <= NU; i++) {
      const k = (s * (NA + 1) + j) * (NU + 1) + i;
      this.noise[k] = U.fbm(i * 0.18 + s * 7, j * 0.3 + 3, 3) - 0.5;
    }

    // 殻の外側テクスチャ
    this.cv = document.createElement('canvas');
    this.cv.width = 512; this.cv.height = 128;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.encoding = THREE.sRGBEncoding;
    this.outerMat = new THREE.MeshPhysicalMaterial({
      map: this.tex, roughness: 0.38, clearcoat: 0.5, clearcoatRoughness: 0.2,
      bumpMap: U.noiseTex(128, 14, 3, 1.6), bumpScale: 0.004,
    });
    this.innerMat = new THREE.MeshPhysicalMaterial({ color: 0xffb52a, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.BackSide });

    this.sides = [];
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? -1 : 1;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array((NU + 1) * (NA + 1) * 3);
      const uv = new Float32Array((NU + 1) * (NA + 1) * 2);
      for (let j = 0; j <= NA; j++) for (let i = 0; i <= NU; i++) {
        const k = j * (NU + 1) + i;
        uv[k * 2] = i / NU;
        uv[k * 2 + 1] = side < 0 ? 0.5 + (j / NA) * 0.5 : 0.5 - (j / NA) * 0.5;
      }
      const idx = [];
      for (let j = 0; j < NA; j++) for (let i = 0; i < NU; i++) {
        const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const outer = new THREE.Mesh(geo, this.outerMat);
      const inner = new THREE.Mesh(geo, this.innerMat);
      outer.castShadow = true; outer.receiveShadow = true;
      outer.frustumCulled = inner.frustumCulled = false;
      this.group.add(outer); this.group.add(inner);
      this.sides.push({ side, geo, pos, outer, inner });
    }

    // とろとろの中身
    this.RX = 34; this.RZ = 22;
    const rgeo = new THREE.BufferGeometry();
    this.rpos = new Float32Array((this.RX + 1) * (this.RZ + 1) * 3);
    const ridx = [];
    for (let j = 0; j < this.RZ; j++) for (let i = 0; i < this.RX; i++) {
      const a = j * (this.RX + 1) + i, b = a + 1, c = a + this.RX + 1, d = c + 1;
      ridx.push(a, c, b, b, c, d);
    }
    rgeo.setAttribute('position', new THREE.BufferAttribute(this.rpos, 3));
    this.rcol = new Float32Array((this.RX + 1) * (this.RZ + 1) * 3).fill(1);
    rgeo.setAttribute('color', new THREE.BufferAttribute(this.rcol, 3));
    rgeo.setIndex(ridx);
    this.runnyMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
    this.runnyMesh = new THREE.Mesh(rgeo, this.runnyMat);
    this.runnyMesh.castShadow = true; this.runnyMesh.receiveShadow = true;
    this.runnyMesh.frustumCulled = false;
    this.runnyMesh.visible = false;
    this.runnyGeo = rgeo;
    this.group.add(this.runnyMesh);

    // 切り口の下に見える卵の底（開いたときにライスが透けて見えないように全体を覆う）
    const ugeo = new THREE.BufferGeometry();
    this.upos = new Float32Array((this.RX + 1) * (this.RZ + 1) * 3);
    ugeo.setAttribute('position', new THREE.BufferAttribute(this.upos, 3));
    ugeo.setIndex(ridx.slice());
    this.underMat = new THREE.MeshPhysicalMaterial({ color: 0xffd36a, roughness: 0.3, clearcoat: 0.6 });
    this.underMesh = new THREE.Mesh(ugeo, this.underMat);
    this.underMesh.receiveShadow = true;
    this.underMesh.frustumCulled = false;
    this.underMesh.visible = false;
    this.underGeo = ugeo;
    this.group.add(this.underMesh);

    // よく焼けたオムレツを切ったときの断面（中は詰まっている）
    this.fillMat = new THREE.MeshPhysicalMaterial({ color: 0xffe08a, roughness: 0.55, side: THREE.DoubleSide });
    this.fills = [0, 1].map(() => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array((NU + 1) * 2 * 3);
      const idx = [];
      for (let i = 0; i < NU; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, this.fillMat);
      m.visible = false; m.frustumCulled = false; m.castShadow = true;
      this.group.add(m);
      return { g, pos, m };
    });
    [this.outerMat, this.innerMat, this.runnyMat, this.underMat, this.fillMat].forEach((m) => (m.userData.lin = true));
    this.outerMeshes = this.sides.map((s) => s.outer);
    this.allMeshes = this.sides.map((s) => s.outer).concat(this.sides.map((s) => s.inner), [this.runnyMesh, this.underMesh]);
    this.setLook({ fs: 0.5, br: 0, lf: 0.4, uniformity: 1 });
  }

  /** 体積から大きさを決める（卵の量がそのまま長さ・太さになる） */
  Omelette.prototype.setSize = function (V, EGG_V) {
    const s = Math.cbrt(Math.max(V, 0.005) / (EGG_V * 3));
    this.L = 1.9 * s; this.W = 0.98 * s; this.H = 0.44 * s;
    this.dirty = true;
  };

  /** 焼き色・固さ・混ぜむらを見た目に反映 */
  Omelette.prototype.setLook = function (f) {
    const ctx = this.cv.getContext('2d');
    const w = this.cv.width, h = this.cv.height;
    const base = PK.Egg.setColor(f.fs, f.br * 0.55, 1);
    ctx.fillStyle = `rgb(${base.map((c) => Math.round(c * 255)).join(',')})`;
    ctx.fillRect(0, 0, w, h);
    // 焼き色のまだら（鍋肌に当たっていた所ほど濃い）
    const r = U.rng(5);
    const brown = PK.Egg.setColor(f.fs, Math.min(1, f.br * 1.25), 1);
    for (let i = 0; i < 160; i++) {
      const x = r() * w, y = h * 0.5 + (r() - 0.5) * h * (0.3 + f.br * 0.7);
      const rad = 4 + r() * 22;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(${brown.map((c) => Math.round(c * 255)).join(',')},${U.clamp(f.br * 1.6, 0, 0.9)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 混ぜ不足の白い筋
    const streak = 1 - (f.uniformity == null ? 1 : f.uniformity);
    if (streak > 0.05) {
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = `rgba(255,252,236,${streak * 0.7})`;
        ctx.lineWidth = 1 + r() * 3;
        ctx.beginPath();
        const y = r() * h, x = r() * w;
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + 30, y + 10 * (r() - 0.5), x + 60, y + 14 * (r() - 0.5), x + 90 + r() * 60, y + 8 * (r() - 0.5));
        ctx.stroke();
      }
    }
    this.tex.needsUpdate = true;
    const soft = 1 - f.fs;
    this.outerMat.roughness = U.lerp(0.5, 0.26, soft) + f.br * 0.15;
    this.outerMat.clearcoat = 0.2 + soft * 0.6;
    // 内側と中身：液体が多いほどつややかで濃い黄色
    const lf = f.lf;
    const wet = U.smooth(0.08, 0.45, lf);
    // 外側と同じ卵の色をもとに、半熟ほど少しだけ濃くつややかに（色が別物に見えないように）
    const ci = U.mix3(base, [1.0, 0.8, 0.33], wet * 0.5);
    this.innerMat.color.setRGB(ci[0], ci[1], ci[2]).convertSRGBToLinear();
    this.underMat.color.copy(this.innerMat.color);
    if (this.fillMat) this.fillMat.color.copy(this.innerMat.color).multiplyScalar(0.97);
    this.innerMat.roughness = U.lerp(0.55, 0.1, wet);
    this.innerMat.clearcoat = wet;
    this.underMat.roughness = this.innerMat.roughness;
    this.underMat.clearcoat = wet;
    // 中身は皮の内側と同じ色から、中央だけほんの少し濃く（縁で色が切り替わらない）
    const cr = U.mix3(ci, [1.0, 0.78, 0.3], wet * 0.25);
    this._ci = new THREE.Color().setRGB(ci[0], ci[1], ci[2]).convertSRGBToLinear();
    this._cr = new THREE.Color().setRGB(cr[0], cr[1], cr[2]).convertSRGBToLinear();
    this.runnyMat.color.set(0xffffff);
    this.runnyMat.roughness = this.innerMat.roughness;
    this.runnyMat.clearcoat = wet;
    this.runny.lf = lf;
  };

  /** 皿の上に置いたときのローカル表面高さ */
  Omelette.prototype.surfaceLocal = function (x, z) {
    if (!this.surfaceWorld) return 0;
    const g = this.group, c = Math.cos(g.rotation.y), s = Math.sin(g.rotation.y);
    const wx = g.position.x + x * c + z * s;
    const wz = g.position.z - x * s + z * c;
    return this.surfaceWorld(wx, wz) - g.position.y;
  };

  Omelette.prototype.closedPoint = function (u, j, side, sIdx, i, out) {
    const t = taper(u);
    const phi = (Math.PI * j) / NA;
    const c = Math.cos(phi), s = Math.sin(phi);
    const sq = this.squash;
    const yc = this.H * 0.45 * (1 - sq);
    const rt = this.H * 0.55 * (1 - sq), rb = this.H * 0.45 * (1 - sq);
    const n = this.noise[(sIdx * (NA + 1) + j) * (NU + 1) + i] * this.irr;
    const ry = c >= 0 ? rt * c : -rb * Math.pow(-c, 0.65);
    out[0] = (u * this.L) / 2 * (1 + n * 0.25);
    out[2] = side * (this.W / 2) * (1 + sq * 0.8) * t * s * (1 + n);
    out[1] = yc + ry * t * (1 + n * 0.8);
    // 柔らかい卵ほどライスの形に沿って垂れる
    if (this.surfaceWorld) {
      const along = this.surfaceLocal(out[0], 0);
      out[1] += along * this.sag;
      const floor = this.surfaceLocal(out[0], out[2]) + 0.006;
      if (out[1] < floor) out[1] = floor;
    }
  };

  // 断面の弧長（下端から上端まで）
  Omelette.prototype.arcTable = function () {
    if (this._arc && this._arcKey === this.H + ':' + this.W + ':' + this.squash) return this._arc;
    const arc = new Float32Array(NA + 1);
    const p = [0, 0, 0], q = [0, 0, 0];
    const save = this.surfaceWorld, sv = this.irr;
    this.surfaceWorld = null; this.irr = 0;
    arc[NA] = 0;
    for (let j = NA - 1; j >= 0; j--) {
      this.closedPoint(0, j, 1, 1, NU / 2, p);
      this.closedPoint(0, j + 1, 1, 1, NU / 2, q);
      arc[j] = arc[j + 1] + Math.hypot(p[1] - q[1], p[2] - q[2]);
    }
    this.surfaceWorld = save; this.irr = sv;
    this._arc = arc; this._arcKey = this.H + ':' + this.W + ':' + this.squash;
    return arc;
  };

  /** 表面に沿った長さ → 横の距離（シートが料理の形に沿って垂れ下がるように） */
  Omelette.prototype.buildDrape = function () {
    const K = 220, dz = 0.012;
    if (!this.drape) this.drape = new Float32Array((NU + 1) * 2 * (K + 1));
    const D = this.drape;
    for (let i = 0; i <= NU; i++) {
      const x = ((-1 + (2 * i) / NU) * this.L) / 2;
      for (let sd = 0; sd < 2; sd++) {
        const side = sd ? 1 : -1, o = (i * 2 + sd) * (K + 1);
        let len = 0, yp = this.surfaceLocal(x, 0);
        D[o] = 0;
        for (let k = 1; k <= K; k++) {
          const y = this.surfaceLocal(x, side * k * dz);
          len += Math.hypot(dz, y - yp);
          yp = y;
          D[o + k] = len;
        }
      }
    }
    this.drapeK = K; this.drapeDz = dz;
  };
  Omelette.prototype.zAtArc = function (i, side, s) {
    const K = this.drapeK, D = this.drape, o = (i * 2 + (side > 0 ? 1 : 0)) * (K + 1);
    if (s <= 0) return 0;
    if (s >= D[o + K]) return K * this.drapeDz + (s - D[o + K]);
    let a = 0, b = K;
    while (b - a > 1) { const m = (a + b) >> 1; if (D[o + m] < s) a = m; else b = m; }
    const f = (s - D[o + a]) / Math.max(1e-6, D[o + b] - D[o + a]);
    return (a + f) * this.drapeDz;
  };

  /** 目玉焼き（巻かずに盛った卵）：白身の円盤＋黄身。ライスの上に沿って垂れる */
  /**
   * 巻かずに皿へのせた卵（平らな1枚）。kind: 'fried'（目玉焼き）／'sheet'（薄焼き卵で包む）
   * ライスの形に沿って上にのる。ライスより下に潜らない。
   */
  Omelette.prototype.setFried = function (on, nYolk, radius) { this.setFlat(on ? 'fried' : null, nYolk, radius, radius); };
  Omelette.prototype.setFlat = function (kind, nYolk, rx, rz, look) {
    const on = !!kind;
    this.fried = on;
    this.flatKind = kind;
    this.sides.forEach((S) => { S.outer.visible = S.inner.visible = !on; });
    if (on) {
      this.runnyMesh.visible = false; this.underMesh.visible = false;
      // 前に切ったオムレツの断面（ぱっかーんの形）が残らないよう、必ず消す
      (this.fills || []).forEach((F) => { F.m.visible = false; });
      this.rigid = false; this.yolkSlide = false;
    }
    if (!on) { this.yolkSlide = false; if (this.friedG) this.friedG.visible = false; this.dirty = true; return; }
    if (!this.friedG) {
      const RS = 44, AS = 112;
      const g = new THREE.BufferGeometry();
      this.fpos = new Float32Array((RS + 1) * AS * 3 + 3);
      const idx = [];
      const c0 = (RS + 1) * AS;
      for (let a = 0; a < AS; a++) {
        const a2 = (a + 1) % AS;
        idx.push(c0, a2, a);
        for (let r = 0; r < RS; r++) {
          const p0 = r * AS + a, p1 = r * AS + a2, q0 = (r + 1) * AS + a, q1 = (r + 1) * AS + a2;
          idx.push(p0, p1, q0, p1, q1, q0);
        }
      }
      g.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3));
      this.fcol = new Float32Array(this.fpos.length);
      g.setAttribute('color', new THREE.BufferAttribute(this.fcol, 3));
      g.setIndex(idx);
      this.fgeo = g; this.fRS = RS; this.fAS = AS;
      const wm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.4, clearcoat: 0.6, side: THREE.DoubleSide });
      const ym = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(0xffa90f).convertSRGBToLinear(), roughness: 0.12, clearcoat: 1 });
      wm.userData.lin = ym.userData.lin = true;
      this.friedG = new THREE.Group();
      this.fWhite = new THREE.Mesh(g, wm);
      this.fWhite.castShadow = this.fWhite.receiveShadow = true;
      this.fWhite.frustumCulled = false;
      this.friedG.add(this.fWhite);
      this.fYolkGeo = new THREE.SphereGeometry(0.13, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
      this.fYolkMat = ym;
      this.group.add(this.friedG);
      this.allMeshes.push(this.fWhite);
    }
    // 色：目玉焼きはクリーム色の白身＋こんがりした縁、薄焼き卵は黄色＋うっすら焼き色
    {
      const RS = this.fRS, AS = this.fAS, col = this.fcol;
      let cIn, cEdge, edge0;
      if (kind === 'fried' && look && look.raw) { cIn = new THREE.Color(0xf6f1e2); cEdge = new THREE.Color(0xf6f1e2); edge0 = 1; }   // 火が通っていない白身：透けた乳白色（焼き色なし）
      else if (kind === 'fried') { cIn = new THREE.Color(0xfff6e2); cEdge = new THREE.Color(0xc98a3c); edge0 = 0.72; }
      else {
        const c = PK.Egg.setColor((look && look.fs) || 0.7, ((look && look.br) || 0.1) * 0.6, 1);
        cIn = new THREE.Color().setRGB(c[0], c[1], c[2]); cEdge = new THREE.Color(0xe7b04a); edge0 = 0.85;
      }
      cIn.convertSRGBToLinear(); cEdge.convertSRGBToLinear();
      for (let r = 0; r <= RS; r++) for (let a = 0; a < AS; a++) {
        const k = (r * AS + a) * 3, f = r / RS;
        const e = U.smooth(edge0, 1.0, f) * (0.65 + 0.35 * U.noise2(a * 0.45, r * 0.4));
        col[k] = cIn.r + (cEdge.r - cIn.r) * e; col[k + 1] = cIn.g + (cEdge.g - cIn.g) * e; col[k + 2] = cIn.b + (cEdge.b - cIn.b) * e;
      }
      const c0k = (RS + 1) * AS * 3; col[c0k] = cIn.r; col[c0k + 1] = cIn.g; col[c0k + 2] = cIn.b;
      this.fgeo.attributes.color.needsUpdate = true;
    }
    this.fWhite.material.transparent = !!(look && look.raw); this.fWhite.material.opacity = look && look.raw ? 0.72 : 1; this.fWhite.material.needsUpdate = true;
    this.friedG.visible = true;
    (this.fYolks || []).forEach((m) => this.friedG.remove(m));
    this.fYolks = [];
    for (let i = 0; i < (nYolk || 0); i++) {
      const a = (i / nYolk) * Math.PI * 2 + 0.6, r = nYolk === 1 ? 0 : 0.28;
      const m = new THREE.Mesh(this.fYolkGeo, this.fYolkMat);
      m.userData.off = [Math.cos(a) * r, Math.sin(a) * r];
      m.scale.set(1, 0.55, 1);
      m.castShadow = true;
      this.friedG.add(m);
      this.fYolks.push(m);
    }
    this.fRx = rx || 0.75; this.fRz = rz || this.fRx;
    this.dirty = true;
  };
  /** 平らな卵の最終形（皿の上にのったときの頂点）を P に書き出す。元の位置(frestX/Z)と黄身の最終位置も更新 */
  Omelette.prototype.fillFried = function (P) {
    const RS = this.fRS, AS = this.fAS, Rx = this.fRx, Rz = this.fRz;
    const nV = (RS + 1) * AS;
    if (!this.frestX || this.frestX.length !== nV + 1) { this.frestX = new Float32Array(nV + 1); this.frestZ = new Float32Array(nV + 1); }
    const lay = (x, z) => {
      if (!this.surfaceWorld) return 0.012;
      const d = 0.05;
      return Math.max(this.surfaceLocal(x, z), this.surfaceLocal(x + d, z), this.surfaceLocal(x - d, z), this.surfaceLocal(x, z + d), this.surfaceLocal(x, z - d)) + 0.03;
    };
    for (let r = 0; r <= RS; r++) for (let a = 0; a < AS; a++) {
      const ang = (a / AS) * Math.PI * 2;
      const wob = 1 + 0.07 * (U.noise2(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2) - 0.5) * 2;
      const f = r / RS;
      const x = Math.cos(ang) * f * Rx * wob, z = Math.sin(ang) * f * Rz * wob;
      const i = r * AS + a, k = i * 3;
      this.frestX[i] = x; this.frestZ[i] = z;
      P[k] = x; P[k + 1] = lay(x, z) + 0.016 * (1 - Math.pow(f, 3)); P[k + 2] = z;
    }
    const c0 = nV * 3;
    this.frestX[nV] = 0; this.frestZ[nV] = 0;
    P[c0] = 0; P[c0 + 1] = lay(0, 0) + 0.016; P[c0 + 2] = 0;
    return lay;
  };
  /** 皿に落ちる途中（フライパンの形に沿って動かしている間）は、頂点を外から書き込む */
  Omelette.prototype.beginFlatSim = function () { this.flatSim = true; (this.shellBits || []).forEach((m) => (m.visible = false)); };
  Omelette.prototype.endFlatSim = function () { this.flatSim = false; (this.shellBits || []).forEach((m) => (m.visible = true)); (this.fYolks || []).forEach((m) => m.quaternion.identity()); this.dirty = true; };

  Omelette.prototype.updateFried = function () {
    if (this.flatSim) return;   // 落下中の形は Plating が頂点を直接動かす
    const RS = this.fRS, AS = this.fAS, P = this.fpos, Rx = this.fRx, Rz = this.fRz;
    // 表面の上にのせる（ご飯粒の凹凸より上。三角形の間からご飯がのぞかないように少し余裕をとる）
    // まわりの一番高いところに合わせる（ご飯のでこぼこが卵を突き抜けない）
    const lay = (x, z) => {
      if (!this.surfaceWorld) return 0.012;
      const d = 0.05;
      return Math.max(this.surfaceLocal(x, z), this.surfaceLocal(x + d, z), this.surfaceLocal(x - d, z), this.surfaceLocal(x, z + d), this.surfaceLocal(x, z - d)) + 0.03;
    };
    for (let r = 0; r <= RS; r++) for (let a = 0; a < AS; a++) {
      const ang = (a / AS) * Math.PI * 2;
      const wob = 1 + 0.07 * (U.noise2(Math.cos(ang) * 2 + 5, Math.sin(ang) * 2) - 0.5) * 2;
      const f = r / RS;
      const x = Math.cos(ang) * f * Rx * wob, z = Math.sin(ang) * f * Rz * wob;
      const k = (r * AS + a) * 3;
      P[k] = x; P[k + 1] = lay(x, z) + 0.016 * (1 - Math.pow(f, 3)); P[k + 2] = z;
    }
    const c0 = (RS + 1) * AS * 3;
    P[c0] = 0; P[c0 + 1] = lay(0, 0) + 0.016; P[c0 + 2] = 0;
    this.fgeo.attributes.position.needsUpdate = true;
    this.fgeo.computeVertexNormals();
    this.fgeo.computeBoundingSphere();
    for (const m of this.fYolks) { const [x, z] = m.userData.off; m.position.set(x, lay(x, z) + 0.01, z); m.quaternion.identity(); }
    this.updateShellBits(lay);
  };

  /** 取りのぞかなかった殻のかけら。卵の表面にくっついて見える */
  Omelette.prototype.setShells = function (n) {
    (this.shellBits || []).forEach((m) => this.group.remove(m));
    this.shellBits = [];
    if (!n) return;
    if (!this.shellBitMat) {
      this.shellBitMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xf6efe2).convertSRGBToLinear(), roughness: 0.55, side: THREE.DoubleSide });
      this.shellBitMat.userData.lin = true;
      const sh = new THREE.Shape();
      sh.moveTo(0, 0); sh.lineTo(0.07, 0.015); sh.lineTo(0.06, 0.06); sh.lineTo(0.02, 0.075); sh.lineTo(-0.025, 0.04); sh.closePath();
      this.shellBitGeo = new THREE.ShapeGeometry(sh);
      this.shellBitGeo.translate(-0.02, -0.035, 0);
    }
    for (let k = 0; k < Math.min(8, n * 2); k++) {
      const m = new THREE.Mesh(this.shellBitGeo, this.shellBitMat);
      m.userData.at = { s: k % 2, i: 8 + Math.floor(Math.random() * (NU - 16)), j: Math.floor(NA * (0.45 + Math.random() * 0.45)), fx: (Math.random() - 0.5) * 1.2, fz: (Math.random() - 0.5) * 1.2, rot: Math.random() * 6.28 };
      m.scale.setScalar(0.8 + Math.random() * 0.5);
      m.castShadow = true;
      this.group.add(m);
      this.shellBits.push(m);
    }
    this.dirty = true;
  };
  Omelette.prototype.updateShellBits = function (lay) {
    if (!this.shellBits || !this.shellBits.length) return;
    const up = new THREE.Vector3(0, 0, 1), nrm = new THREE.Vector3(), q = new THREE.Quaternion(), qz = new THREE.Quaternion();
    for (const m of this.shellBits) {
      const at = m.userData.at;
      if (this.fried) {
        const x = at.fx * this.fRx * 0.8, z = at.fz * this.fRz * 0.8;
        m.position.set(x, lay(x, z) + 0.022, z);
        nrm.set(0, 1, 0);
      } else {
        const S = this.sides[at.s], k = (at.j * (NU + 1) + at.i) * 3;
        const na = S.geo.attributes.normal;
        nrm.set(na.array[k], na.array[k + 1], na.array[k + 2]);
        if (nrm.lengthSq() < 1e-6) nrm.set(0, 1, 0);
        nrm.normalize();
        if (nrm.y < 0) nrm.negate();
        m.position.set(S.pos[k] + nrm.x * 0.008, S.pos[k + 1] + nrm.y * 0.008, S.pos[k + 2] + nrm.z * 0.008);
      }
      q.setFromUnitVectors(up, nrm);
      qz.setFromAxisAngle(up, at.rot);
      m.quaternion.copy(q).multiply(qz);
    }
  };

  /** 固いオムレツの半分が、外側の下の辺を軸に倒れたときの点 */
  Omelette.prototype.rigidPoint = function (u, j, side, sIdx, i, prog, o, p, cutFace) {
    const t = taper(u);
    const sw = this.surfaceWorld; this.surfaceWorld = null;
    const q = [0, 0, 0];
    this.closedPoint(u, j, side, sIdx, i, q);
    this.surfaceWorld = sw;
    if (cutFace) q[2] = 0;   // 断面（切り口の平らな面）
    const ang = (Math.PI / 2) * U.easeOutCubic(U.clamp(prog * 1.3, 0, 1)) * o;
    const hz = side * (this.W / 2) * t * 0.9;
    const yy = q[1], zz = q[2] - hz;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const ny = yy * c - zz * side * sn;
    const nz = hz + side * yy * sn + zz * c;
    p[0] = q[0]; p[2] = nz;
    p[1] = Math.max(0, ny) * 0.9 + this.surfaceLocal(p[0], p[2]) + 0.006;
  };
  Omelette.prototype.updateFills = function (prog) {
    const show = this.rigid && prog > 0 && !this.fried;
    this.fills.forEach((F, sIdx) => {
      F.m.visible = show;
      if (!show) return;
      const side = sIdx === 0 ? -1 : 1, open = side < 0 ? this.openL : this.openR, p = [0, 0, 0];
      for (let i = 0; i <= NU; i++) {
        const u = -1 + (2 * i) / NU;
        for (let e = 0; e < 2; e++) {
          this.rigidPoint(u, e === 0 ? 0 : NA, side, sIdx, i, prog, open[i], p, true);
          const k = (i * 2 + e) * 3;
          F.pos[k] = p[0]; F.pos[k + 1] = p[1] + 0.004; F.pos[k + 2] = p[2];
        }
      }
      F.g.attributes.position.needsUpdate = true;
      F.g.computeVertexNormals();
      F.g.computeBoundingSphere();
    });
  };

  Omelette.prototype.updateGeometry = function () {
    this.geomVer = (this.geomVer || 0) + 1;   // 形が変わった回数（ソースの高さ場の作り直しに使う）
    if (this.fried) { this.updateFried(); return; }
    const arc = this.arcTable();
    const total = arc[0];
    const p = [0, 0, 0];
    const prog = U.clamp(this.progress, 0, 1);
    const draping = !!this.surfaceWorld && prog > 0;
    if (draping) this.buildDrape();
    let oAvg = 0;
    for (let i = 0; i <= NU; i++) oAvg += (this.openL[i] + this.openR[i]) / 2;
    oAvg /= NU + 1;
    // 開いた後は、中の空洞が重さでつぶれる（支えのない皮は浮かない）
    const collapse = draping ? U.smooth(0.25, 1, prog) * U.clamp(oAvg * 1.4, 0, 1) : 0;
    const rigid = this.rigid && prog > 0;
    for (let sIdx = 0; sIdx < 2; sIdx++) {
      const S = this.sides[sIdx];
      const side = S.side;
      const open = side < 0 ? this.openL : this.openR;
      const pos = S.pos;
      for (let j = 0; j <= NA; j++) {
        const af = arc[j] / total; // 0=下端（ちょうつがい）、1=切り口
        for (let i = 0; i <= NU; i++) {
          const u = -1 + (2 * i) / NU;
          this.closedPoint(u, j, side, sIdx, i, p);
          const o = open[i];
          if (rigid && o > 0) {
            this.rigidPoint(u, j, side, sIdx, i, prog, o, p);
          } else if (false) {
            // よく焼けたオムレツ：切れたら半分ずつ、外側の下の辺を軸にごろんと外へ倒れる（切り口が上を向く）
            const t = taper(u);
            const sw = this.surfaceWorld; this.surfaceWorld = null;
            const q = [0, 0, 0];
            this.closedPoint(u, j, side, sIdx, i, q);
            this.surfaceWorld = sw;
            const ang = (Math.PI / 2) * U.easeOutCubic(U.clamp(prog * 1.3, 0, 1)) * o;
            const hz = side * (this.W / 2) * t * 0.9;
            const yy = q[1], zz = q[2] - hz;
            const c = Math.cos(ang), sn = Math.sin(ang);
            // 上の点は外へ、下の点は内へ：side 側に倒れる回転
            const ny = yy * c - zz * side * sn;
            const nz = hz + side * yy * sn + zz * c;
            p[0] = q[0];
            p[2] = nz;
            p[1] = Math.max(0, ny) * 0.9 + this.surfaceLocal(p[0], p[2]) + 0.006;
          } else if (o > 0 && prog > 0) {
            // 切り口に近い所から順にめくれる
            const e0 = U.clamp(prog * 1.25 - (1 - af) * 0.25, 0, 1);
            // ばねのように行き過ぎて戻る（ぼよん）
            const sp = 1 - Math.exp(-5 * e0) * Math.cos(11 * e0);
            const e = sp * o;
            const t = taper(u);
            const n = this.noise[(sIdx * (NA + 1) + j) * (NU + 1) + i];
            // 切り口から下端までの長さだけ、ライスの表面に沿って垂れ下がる
            const sArc = arc[j] * (0.3 + 0.7 * t) * this.reach + 0.015 + (j < 3 ? this.tearAmp * n * 0.04 : 0);
            const zt = side * (draping ? this.zAtArc(i, side, sArc) : sArc);
            const xt = p[0] * (1 + 0.05 * o) + (j < 4 ? this.tearAmp * n * 0.02 : 0);
            const yt = this.surfaceLocal(xt, zt) + 0.014 + 0.01 * (1 - af);
            const lift = Math.sin(Math.PI * U.clamp(e0 * 1.6, 0, 1)) * this.H * 0.45 * af * o;
            p[0] = U.lerp(p[0], xt, e);
            p[1] = U.lerp(p[1], yt, e) + lift;
            p[2] = U.lerp(p[2], zt, e);
            // 行き過ぎてもライスや皿の下に潜らない
            const fl = this.surfaceLocal(p[0], p[2]) + 0.01;
            if (p[1] < fl) p[1] = fl;
          }
          if (collapse > 0 && !rigid) {
            // 重力：卵の皮は表面の上に寝る。閉じたままの端も空洞がつぶれて低くなる
            const fl = this.surfaceLocal(p[0], p[2]) + 0.01;
            const keep = 0.035 + (1 - o) * this.H * taper(u) * 0.55;
            const cap = fl + U.lerp(Math.max(keep, p[1] - fl), keep, collapse);
            if (p[1] > cap) p[1] = cap;
          }
          const k = (j * (NU + 1) + i) * 3;
          pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
        }
      }
      S.geo.attributes.position.needsUpdate = true;
      S.geo.computeVertexNormals();
      S.geo.computeBoundingSphere();
    }
    this.updateShellBits();
    this.updateRunny(total);
  };

  Omelette.prototype.updateRunny = function (total) {
    const R = this.runny;
    const prog = U.clamp(this.progress, 0, 1);
    let oL = 0, oR = 0;
    for (let i = 0; i <= NU; i++) { oL += this.openL[i]; oR += this.openR[i]; }
    oL /= NU + 1; oR /= NU + 1;
    if (this.fills) this.updateFills(prog);
    if (this.rigid) { this.underMesh.visible = false; this.runnyMesh.visible = false; return; }
    this.updateUnder(total, prog, oL, oR);
    const show = prog > 0.08 && R.amount > 0.02 && (oL + oR) > 0.05;
    this.runnyMesh.visible = show;
    if (!show) return;
    const grow = U.easeOutCubic(U.clamp((prog - 0.08) / 0.92, 0, 1)) * (0.85 + R.flow * 0.3);
    const dL = total * oL * 0.42 * R.spread * this.reach, dR = total * oR * 0.42 * R.spread * this.reach;   // 半熟は流れ広がらない
    const wr = Math.max(0.05, (dL + dR) * grow * (0.85 + R.flow * 0.35));
    const zc = (dR - dL) * 0.5 * grow;
    let lr = this.L * 0.78 * U.lerp(0.75, 1.0, R.spread) * grow;
    // 切れていない部分の長さにとどまる
    let first = -1, last = -1;
    for (let i = 0; i <= NU; i++) if (this.openL[i] + this.openR[i] > 0.1) { if (first < 0) first = i; last = i; }
    const u0 = first < 0 ? 0 : -1 + (2 * first) / NU, u1 = last < 0 ? 0 : -1 + (2 * last) / NU;
    const xc = ((u0 + u1) / 2) * this.L * 0.5;
    lr = Math.min(lr, (u1 - u0) * 0.5 * this.L * 1.05 + 0.2);
    const bulge = this.H * 0.07 * R.amount;
    const pos = this.rpos;
    for (let j = 0; j <= this.RZ; j++) for (let i = 0; i <= this.RX; i++) {
      const a = -1 + (2 * i) / this.RX, b = -1 + (2 * j) / this.RZ;
      // 正方形 → 円盤への写像
      const x = a * Math.sqrt(1 - (b * b) / 2), z = b * Math.sqrt(1 - (a * a) / 2);
      const wob = 1 + 0.08 * (U.noise2(a * 2 + 4, b * 2) - 0.5) * 2;
      const X = xc + (x * lr) / 2 * wob, Z = zc + (z * wr) / 2 * wob;
      const r2 = x * x + z * z;
      const k = (j * (this.RX + 1) + i) * 3;
      pos[k] = X;
      // 縁は皮の内側より少し下に沈め、中央だけふっくら盛り上がる（境目が見えないように）
      const fall = Math.max(0, 1 - r2);
      const sm = fall * fall * (3 - 2 * fall);   // 縁へなだらかに薄くなる
      pos[k + 1] = this.surfaceLocal(X, Z) + 0.006 + 0.02 * sm + bulge * sm * sm;
      pos[k + 2] = Z;
      // 色も縁ほど皮の内側の色に近づけて、境目を見せない
      const cc = U.smooth(0.0, 0.7, fall);
      const ci = this._ci, cr = this._cr;
      const c3 = k;
      this.rcol[c3] = ci.r + (cr.r - ci.r) * cc; this.rcol[c3 + 1] = ci.g + (cr.g - ci.g) * cc; this.rcol[c3 + 2] = ci.b + (cr.b - ci.b) * cc;
    }
    this.runnyGeo.attributes.color.needsUpdate = true;
    this.runnyGeo.attributes.position.needsUpdate = true;
    this.runnyGeo.computeVertexNormals();
    this.runnyGeo.computeBoundingSphere();
  };

  Omelette.prototype.updateUnder = function (total, prog, oL, oR) {
    const show = !!this.surfaceWorld && prog > 0.02 && oL + oR > 0.05 && !!this.drape;
    this.underMesh.visible = show;
    if (!show) return;
    // 開いた皮の届く範囲（ライスの形に沿った長さ）の内側だけを覆う。皿の上に楕円に広がらない
    const g = U.smooth(0, 0.6, prog);
    const pos = this.upos;
    for (let j = 0; j <= this.RZ; j++) for (let i = 0; i <= this.RX; i++) {
      const a = -1 + (2 * i) / this.RX, b = -1 + (2 * j) / this.RZ;
      const u = a * 1.0;
      const ci = Math.round(((Math.max(-1, Math.min(1, u)) + 1) / 2) * NU);
      const side = b < 0 ? -1 : 1;
      const o = (side < 0 ? this.openL : this.openR)[ci];
      const t = taper(u);
      const reachArc = total * (0.3 + 0.7 * t) * this.reach * o * g;
      const ext = Math.max(this.W * 0.42 * Math.max(t, 0.45) * Math.min(1, o * 3), this.zAtArc(ci, side, reachArc) * 0.98);
      const X = (u * this.L) / 2 * 1.02, Z = b * ext;
      const k = (j * (this.RX + 1) + i) * 3;
      pos[k] = X;
      pos[k + 1] = this.surfaceLocal(X, Z) + 0.006;
      pos[k + 2] = Z;
    }
    this.underGeo.attributes.position.needsUpdate = true;
    this.underGeo.computeVertexNormals();
    this.underGeo.computeBoundingSphere();
  };

  /**
   * 切開結果を受けて開くアニメーション開始
   * r: { openL:Float32Array, openR:Float32Array, tear, runnyAmount, runnySpread, runnyFlow, duration }
   */
  Omelette.prototype.startOpen = function (r) {
    // 長さ方向に開き具合をならす（隣どうしで差が大きいと、薄い板のような裂け目ができる）
    const smooth = (src, dst) => {
      const n = src.length, R = 4;
      for (let i = 0; i < n; i++) {
        let sum = 0, w = 0;
        for (let d = -R; d <= R; d++) {
          const j = Math.min(n - 1, Math.max(0, i + d));
          const wt = R + 1 - Math.abs(d);
          sum += src[j] * wt; w += wt;
        }
        dst[i] = sum / w;
      }
    };
    smooth(r.openL, this.openL);
    smooth(r.openR, this.openR);
    // 重力：切れて支えを失った皮は、途中で宙に浮いたまま止まらず下まで垂れる
    // 中途半端に開いて宙に浮いた形にはしない：半分以上切れていれば下まで垂れ、そうでなければ閉じたまま
    for (const a of [this.openL, this.openR]) {
      // ほぼ端から端まで切れていれば、細い両端も一緒に倒れる（端だけ立った「耳」を作らない）
      let n = 0;
      for (let i = 0; i < a.length; i++) if (a[i] > 0.4) n++;
      if (n > a.length * 0.45) for (let i = 0; i < a.length; i++) a[i] = Math.max(a[i], 0.75);
      for (let i = 0; i < a.length; i++) a[i] = U.smooth(0.28, 0.5, a[i]);
    }
    this.tearAmp = r.tear || 0;
    this.runny.amount = r.runnyAmount;
    this.runny.spread = r.runnySpread;
    this.reach = r.reach || 1.0;
    this.rigid = !!r.rigid;
    this.runny.flow = 0;
    this.runnyFlowTarget = r.runnyFlow || 0;
    this.animT = 0; this.animDur = r.duration || 1.6;
    this.progress = 0;
  };

  Omelette.prototype.resetOpen = function () {
    if (this.fried) this.setFried(false);
    this.rigid = false;
    this.openL.fill(0); this.openR.fill(0);
    this.progress = 0; this.animT = -1; this.tearAmp = 0;
    this.runny.amount = 0; this.runny.flow = 0;
    this.runnyMesh.visible = false;
    this.underMesh.visible = false;
    (this.fills || []).forEach((F) => { F.m.visible = false; });
    this.underMesh.visible = false;
    this.dirty = true;
  };

  /** 生卵の黄身：ライスの山の上から、傾きにそって転がり落ちる（山のふもと・皿の上まで） */
  Omelette.prototype.slideYolks = function (dt) {
    if (!this.fYolks || !this.fYolks.length || !this.surfaceWorld) return;
    const d = 0.06;
    let moving = false;
    for (const m of this.fYolks) {
      const o = m.userData.off, x = o[0], z = o[1];
      const gx = (this.surfaceLocal(x + d, z) - this.surfaceLocal(x - d, z)) / (2 * d);
      const gz = (this.surfaceLocal(x, z + d) - this.surfaceLocal(x, z - d)) / (2 * d);
      const g = Math.hypot(gx, gz);
      if (g < 0.1) continue;                       // ほぼ平ら：止まる
      const sp = Math.min(1.1, 0.35 + g * 2.2);    // 急なほど速く
      o[0] -= (gx / g) * sp * dt; o[1] -= (gz / g) * sp * dt;
      const r = Math.hypot(o[0], o[1]);
      if (r > 1.25) { o[0] *= 1.25 / r; o[1] *= 1.25 / r; }   // 皿の外までは落ちない
      moving = true;
    }
    if (moving) this.dirty = true;
  };
  Omelette.prototype.update = function (dt) {
    if (this.yolkSlide && this.fried && !this.flatSim) this.slideYolks(dt);
    if (this.animT >= 0) {
      this.animT += dt;
      this.progress = U.clamp(this.animT / this.animDur, 0, 1);
      // 開いた後もとろとろはゆっくり流れ続ける
      this.runny.flow = U.lerp(this.runny.flow, this.runnyFlowTarget, 1 - Math.exp(-dt * 0.5));
      if (this.animT < this.animDur + 8) this.dirty = true;
    }
    if (this.dirty) { this.updateGeometry(); this.dirty = false; }
  };

  /** ナイフ用：閉じた状態の上面の高さ（ローカル） */
  Omelette.prototype.topAt = function (x) {
    const u = U.clamp((2 * x) / this.L, -1, 1);
    const p = [0, 0, 0];
    this.closedPoint(u, 0, 1, 1, Math.round(((u + 1) / 2) * NU), p);
    return p[1];
  };
  Omelette.prototype.bottomAt = function (x) {
    const u = U.clamp((2 * x) / this.L, -1, 1);
    const p = [0, 0, 0];
    this.closedPoint(u, NA, 1, 1, Math.round(((u + 1) / 2) * NU), p);
    return p[1];
  };

  Omelette.NU = NU;
  PK.Omelette = Omelette;
})();
