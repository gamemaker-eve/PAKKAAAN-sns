/* PAKKAAAN! — 卵のシミュレーション
 *  ・EggSheet : フライパン上の卵液を高さ場（グリッド）で扱う。
 *               液体層 hl と固まった層 hs を分けて持ち、傾き・慣性で液体が流れ、
 *               固まった部分は一枚のシートとして滑る。加熱で液体→固体、焼き色が進む。
 *  ・SheetMesh: 高さ場をそのまま3Dメッシュの頂点高さと色テクスチャに反映する。
 *  ・EggFold  : 巻いた後の卵（オムレツ）の内部状態。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;

  const EGG_V = 0.085;   // 卵1個の体積（シーン単位³。1単位=10cm、焼くと少し膨らむ分を含む）
  const RIM_H = 0.3;     // フライパンの縁の高さ
  const RIM_R = 1.18;

  /** 鍋肌の温度分布（バーナーの輪の真上が熱い） */
  function heatProfile(r) {
    return 0.72 + 0.34 * Math.exp(-((r - 0.45) * (r - 0.45)) / 0.12) - 0.1 * U.smooth(0.75, 1.0, r);
  }
  function cookRate(Tc) { return Math.pow(Math.max(0, (Tc - 65) / 110), 1.15); }
  function brownRate(Tc) { return Math.pow(Math.max(0, (Tc - 145) / 80), 1.3) * 0.045; }

  // ================= EggSheet =================
  function EggSheet(N, R) {
    this.N = N; this.R = R; this.dx = (2 * R) / N;
    const n = N * N;
    this.hs = new Float32Array(n); this.hl = new Float32Array(n);
    this.pl = new Float32Array(n); this.fs = new Float32Array(n);
    this.br = new Float32Array(n); this.curd = new Float32Array(n);
    this.st = new Float32Array(n); // 混ぜ不足の白身の筋
    this.tmp = new Float32Array(n);
    this.mask = new Uint8Array(n);
    this.cx = new Float32Array(n); this.cz = new Float32Array(n);
    this.boundary = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = -R + (i + 0.5) * this.dx, z = -R + (j + 0.5) * this.dx;
      this.cx[k] = x; this.cz[k] = z;
      this.mask[k] = x * x + z * z < (R - this.dx * 0.35) ** 2 ? 1 : 0;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!this.mask[k]) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      if (nb.some(([a, b]) => i + a < 0 || i + a >= N || j + b < 0 || j + b >= N || !this.mask[(j + b) * N + i + a])) {
        const r = Math.hypot(this.cx[k], this.cz[k]);
        this.boundary.push({ k, nx: this.cx[k] / r, nz: this.cz[k] / r });
      }
    }
    this.reset();
  }

  EggSheet.prototype.reset = function () {
    [this.hs, this.hl, this.pl, this.fs, this.br, this.curd, this.st].forEach((a) => a.fill(0));
    this.ox = 0; this.oz = 0; this.vx = 0; this.vz = 0;
    this.pourLeft = 0; this.pourRate = 0; this.pourDelay = 0; this.pourTotal = 0;
    this.stirred = new Uint8Array(this.N * this.N);
    this.uniformity = 1; this.foam = 0;
    this.ripple = 0;
    this.spillEvents = [];
    this.bumpEvent = 0;
    this.stats = null;
    this.seed = 1;
  };

  EggSheet.prototype.startPour = function (volume, uniformity, foam) {
    this.pourLeft = volume;
    this.pourTotal = volume;
    this.pourRate = Math.max(volume / 1.8, 0.05);
    this.uniformity = uniformity;
    this.foam = foam;
  };

  /** 混ぜ不足の筋（セルごとの固定ノイズ） */
  EggSheet.prototype.streakAt = function (x, z) {
    const v = U.noise2(x * 5 + 3.1, z * 5 - 1.7);
    return U.smooth(0.55, 0.8, v);
  };

  /**
   * env: { T, gl:{x,y,z}（パン座標での実効重力。慣性を含む）, stick, scramble, dt }
   */
  EggSheet.prototype.update = function (dt, env) {
    const N = this.N, dx = this.dx;
    const { hs, hl, pl, fs, br, curd, st, mask } = this;

    // --- 流し込み ---
    if (this.pourDelay > 0) this.pourDelay -= dt;
    else if (this.pourLeft > 0) {
      const amt = Math.min(this.pourLeft, this.pourRate * dt);
      this.pourLeft -= amt;
      // パンの中央付近（パンの傾きに関係なく真上から）に注ぐ。量が多いときは、細い柱（塔）にならないよう広い範囲に注ぐ
      const spreadR2 = 0.06 * Math.min(6, Math.max(1, this.pourTotal / 0.18));
      const cells = [];
      for (let k = 0; k < N * N; k++) {
        if (!mask[k]) continue;
        const x = this.cx[k] + this.ox, z = this.cz[k] + this.oz;
        const d2 = x * x + z * z;
        if (d2 < spreadR2) cells.push([k, 1 - d2 / spreadR2]);
      }
      let wsum = 0;
      cells.forEach((c) => (wsum += c[1]));
      cells.forEach(([k, w]) => {
        const add = (amt * w) / wsum / (dx * dx);
        const s = (1 - this.uniformity) * this.streakAt(this.cx[k] + this.seed, this.cz[k]);
        st[k] = (st[k] * hl[k] + s * add) / (hl[k] + add + 1e-9);
        pl[k] = (pl[k] * hl[k]) / (hl[k] + add + 1e-9);
        hl[k] += add;
      });
      this.seed += 0.37;
    }

    const gn = Math.max(0.25, -env.gl.y);
    const tx = env.gl.x, tz = env.gl.z;
    const tear = env.tear || 0;

    // --- 固まったシートの滑り（くっつき具合で変わる） ---
    const st0 = this.stats || this.computeStats();
    const solid = U.smooth(0.18, 0.45, st0.setFrac) * (st0.V > 0.002 ? 1 : 0);
    if (solid > 0 && !env.scramble) {
      const slope = Math.hypot(tx, tz);
      const muS = 0.1 + env.stick * 0.55;     // 静止摩擦（傾きのしきい値）
      if (slope > muS || Math.hypot(this.vx, this.vz) > 0.02) {
        const a = 7.5 * solid * (1 - env.stick * 0.7);
        this.vx += tx * a * dt;
        this.vz += tz * a * dt;
      }
      const damp = Math.exp(-dt * (2.2 + env.stick * 10));
      this.vx *= damp; this.vz *= damp;
      this.ox += this.vx * dt;
      this.oz += this.vz * dt;
      this.resolveShift();
    } else {
      this.vx *= 0.8; this.vz *= 0.8;
    }

    // --- 液体の流れ（傾き・慣性・粘り） ---
    const P = this.tmp;
    const sub = 4;
    for (let s = 0; s < sub; s++) {
      for (let k = 0; k < N * N; k++) {
        if (!mask[k]) continue;
        P[k] = gn * (hs[k] + hl[k]) - (tx * (this.cx[k] + this.ox) + tz * (this.cz[k] + this.oz));
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const a = j * N + i;
        if (!mask[a]) continue;
        // 右と下の隣だけ見ればすべての辺を一度ずつ処理できる
        for (let d = 0; d < 2; d++) {
          const ii = i + (d === 0 ? 1 : 0), jj = j + (d === 1 ? 1 : 0);
          if (ii >= N || jj >= N) continue;
          const b = jj * N + ii;
          if (!mask[b]) continue;
          const dP = P[a] - P[b];
          const src = dP > 0 ? a : b, dst = dP > 0 ? b : a;
          const h = hl[src];
          if (h < 1e-5) continue;
          const film = 0.016;                     // 表面張力：薄くなると止まる（卵液のふちが丸く残る）
          const mob = (1 - 0.92 * pl[src]) * U.smooth(film * 0.4, film * 1.6, h);
          // 卵液のとろみ（水よりずっとゆっくり流れる）。ただし深く溜まった所は、自分の重みで平らにならされる（塔にならない）
          // （少ない量では効かせない：量が少ないときに勢いよく広がって縁からこぼれてしまうため、深さが出てから効く）
          const slump = 1 + 4 * U.smooth(0.12, 0.35, h);
          let q = 0.075 * mob * Math.abs(dP) * slump;
          q = Math.min(q, h * 0.2);
          if (q <= 0) continue;
          const hd = hl[dst];
          pl[dst] = (pl[dst] * hd + pl[src] * q) / (hd + q);
          st[dst] = (st[dst] * hd + st[src] * q) / (hd + q);
          hl[src] -= q; hl[dst] += q;
        }
      }
    }

    // --- あふれ（縁より高く溜まった液体はこぼれる） ---
    for (let n = 0; n < this.boundary.length; n++) {
      const b = this.boundary[n];
      const k = b.k;
      if (hl[k] < 0.004) continue;
      const xr = b.nx * RIM_R, zr = b.nz * RIM_R;
      // こぼれるかは揺れの勢いではなく、実際に液面が縁の高さを越えたかで決める
      const gs = env.gs || env.gl, gsn = Math.max(0.25, -gs.y);
      const Prim = gsn * (RIM_H + 0.02) - (gs.x * xr + gs.z * zr);
      const Pc = gsn * (hs[k] + hl[k]) - (gs.x * (this.cx[k] + this.ox) + gs.z * (this.cz[k] + this.oz));
      if (Pc > Prim) {
        const amt = Math.min(hl[k], ((Pc - Prim) / gsn) * 0.5);
        hl[k] -= amt;
        const vol = amt * dx * dx;
        this.spillEvents.push({ x: xr, z: zr, vol });
      }
    }

    // --- 加熱 ---
    const T = env.T;
    const scr = 0;
    for (let k = 0; k < N * N; k++) {
      if (!mask[k]) continue;
      const h = hs[k] + hl[k];
      if (h < 1e-5) continue;
      const x = this.cx[k] + this.ox, z = this.cz[k] + this.oz;
      const r = Math.sqrt(x * x + z * z);
      const Tc = 20 + (T - 20) * heatProfile(r);
      const rate = cookRate(Tc);
      if (rate > 0) {
        const contact = hs[k] < 0.003 ? 1 : 1 / (1 + hs[k] / 0.012);
        let dh = rate * (0.0068 * contact * (1 + curd[k] * 1.1) + 0.0008) * dt;
        dh = Math.min(dh, hl[k]);
        if (dh > 0) {
          fs[k] = (fs[k] * hs[k] + 0.22 * dh) / (hs[k] + dh);
          hs[k] += dh; hl[k] -= dh;
        }
        pl[k] = Math.min(1, pl[k] + rate * 0.07 * dt * (0.3 + 0.5 * contact) * (1 - pl[k]));
        if (hs[k] > 0) fs[k] = Math.min(1, fs[k] + rate * 0.055 * dt * (1 - fs[k]) / (1 + hs[k] / 0.06));
      }
      if (hs[k] > 0.002) {
        const thin = U.clamp(Math.sqrt(0.06 / (h + 0.012)), 0.6, 2.2);
        const b = brownRate(Tc) * (1 + env.stick * 0.6) * thin * (fs[k] > 0.5 ? 1 : 0.45);
        br[k] = Math.min(1, br[k] + b * dt);
      }
      if (scr && hs[k] > 0.002) curd[k] = Math.min(1, curd[k] + dt * 0.9);
    }

    // --- ヘラで混ぜる：平らにならし、中央へ寄せ、生の部分を鍋肌へ ---
    if (scr) {
      const tmp = this.tmp;
      const arrs = [hs, hl];
      for (let q = 0; q < 2; q++) {
        const A = arrs[q];
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const k = j * N + i;
          if (!mask[k]) { tmp[k] = 0; continue; }
          let s = 0, c = 0;
          for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
            const ii = i + a, jj = j + b;
            if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
            const kk = jj * N + ii;
            if (!mask[kk]) continue;
            s += A[kk]; c++;
          }
          tmp[k] = U.lerp(A[k], s / c, 0.12);
        }
        for (let k = 0; k < N * N; k++) if (mask[k]) A[k] = tmp[k];
      }
    }

    // さざ波（揺すった直後の液体）
    this.ripple *= Math.exp(-dt * 2.5);
    this.stats = this.computeStats();
  };

  /** 固まったシート全体の平行移動（セル単位でずらし、端数は描画オフセットで表現） */
  EggSheet.prototype.resolveShift = function () {
    const dx = this.dx;
    let guard = 0;
    while ((Math.abs(this.ox) > dx * 0.5 || Math.abs(this.oz) > dx * 0.5) && guard++ < 4) {
      const sx = Math.abs(this.ox) > dx * 0.5 ? Math.sign(this.ox) : 0;
      const sz = sx === 0 ? Math.sign(this.oz) : 0;
      if (this.canShift(sx, sz)) {
        this.shift(sx, sz);
        this.ox -= sx * dx; this.oz -= sz * dx;
      } else {
        const sp = Math.hypot(this.vx, this.vz);
        if (sp > 0.25) this.bumpEvent = Math.max(this.bumpEvent, sp);
        if (sx) { this.ox = sx * dx * 0.5; this.vx = 0; }
        if (sz) { this.oz = sz * dx * 0.5; this.vz = 0; }
        break;
      }
    }
  };
  EggSheet.prototype.canShift = function (sx, sz) {
    const N = this.N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!this.mask[k] || this.hs[k] < 0.004) continue;
      const ii = i + sx, jj = j + sz;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N || !this.mask[jj * N + ii]) return false;
    }
    return true;
  };
  EggSheet.prototype.shift = function (sx, sz) {
    const N = this.N;
    const arrs = [this.hs, this.hl, this.pl, this.fs, this.br, this.curd, this.st];
    const t = this.tmp;
    for (const A of arrs) {
      t.fill(0);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (!this.mask[k]) continue;
        const ii = i + sx, jj = j + sz;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N || !this.mask[jj * N + ii]) {
          // 行き場のない液体はその場に残す（縁に溜まる）
          if (A === this.hl) t[k] += A[k];
          continue;
        }
        if (A === this.hl || A === this.hs) t[jj * N + ii] += A[k];
        else t[jj * N + ii] = A[k];
      }
      A.set(t);
    }
  };

  /**
   * へらで混ぜる：刃の当たった所の卵をほぐして（ふわふわの粒に）進行方向へ寄せる。
   * x,z: 刃先の中心（パン座標）、ex,ez: 刃の向き（単位）、vx,vz: 動く速さ
   */
  EggSheet.prototype.stir = function (x, z, ex, ez, vx, vz, dt) {
    const N = this.N, dx = this.dx;
    const sp = Math.hypot(vx, vz);
    if (sp < 0.05) return 0;
    const mx = vx / sp, mz = vz / sp;
    const half = 0.17, depth = 0.07;
    let touched = 0;
    const moves = [];
    for (let k = 0; k < N * N; k++) {
      if (!this.mask[k]) continue;
      const px = this.cx[k] + this.ox - x, pz = this.cz[k] + this.oz - z;
      const along = px * ex + pz * ez;
      const across = px * mx + pz * mz;
      if (Math.abs(along) > half || across > 0.02 || across < -depth) continue;
      const h = this.hs[k] + this.hl[k];
      this.stirred[k] = 1;
      if (h < 1e-4) continue;
      touched++;
      if (this.hs[k] > 0.002) this.curd[k] = Math.min(1, this.curd[k] + sp * dt * 2.2);
      moves.push(k);
    }
    // 刃の前へ押し出す（寄せる）
    const f = Math.min(0.55, sp * dt * 5);
    const si = Math.abs(mx) > Math.abs(mz) ? Math.sign(mx) : 0, sj = si === 0 ? Math.sign(mz) : 0;
    for (const k of moves) {
      const i = k % N, j = (k / N) | 0;
      const ii = i + si * 2, jj = j + sj * 2;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const k2 = jj * N + ii;
      if (!this.mask[k2]) continue;
      const ms = this.hs[k] * f, ml = this.hl[k] * f;
      this.hs[k] -= ms; this.hl[k] -= ml; this.hs[k2] += ms; this.hl[k2] += ml;
      this.curd[k2] = Math.max(this.curd[k2], this.curd[k] * 0.9);
      this.fs[k2] = Math.max(this.fs[k2], this.fs[k] * 0.95);
    }
    if (touched) this.ripple = Math.min(1, this.ripple + sp * dt * 2);
    return touched;
  };
  /** 混ぜた範囲（卵のある所のうち、へらが通った割合） */
  EggSheet.prototype.stirCoverage = function () {
    let a = 0, b = 0;
    for (let k = 0; k < this.N * this.N; k++) {
      if (!this.mask[k] || this.hs[k] + this.hl[k] < 0.003) continue;
      b++; if (this.stirred[k]) a++;
    }
    return b ? a / b : 0;
  };

  /** 揺すった衝撃。fragile な半熟シートは破れることがある */
  EggSheet.prototype.impulse = function (ax, az, strength) {
    const s = this.stats || this.computeStats();
    this.vx += ax * 0.9; this.vz += az * 0.9;
    this.ripple = Math.min(1, this.ripple + strength * 0.5);
    let torn = 0;
    if (strength > 1.1 && s.setFrac > 0.15 && s.setFrac < 0.9 && s.fs < 0.75) {
      const r = U.rng(Math.floor(performance.now()));
      const holes = Math.floor((strength - 1.1) * 6) + 1;
      const N = this.N;
      for (let h = 0; h < holes; h++) {
        const i0 = Math.floor(r() * N), j0 = Math.floor(r() * N);
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const k = (j0 + b) * N + (i0 + a);
          if (k < 0 || k >= N * N || !this.mask[k] || this.hs[k] < 0.004) continue;
          // 破れた所は固まりが崩れて液体が流れ込む
          this.hl[k] += this.hs[k] * 0.5;
          this.hs[k] *= 0.5;
          this.curd[k] = 1;
          torn++;
        }
      }
    }
    return torn > 0 ? 1 : 0;
  };

  EggSheet.prototype.computeStats = function () {
    const N = this.N, a = this.dx * this.dx;
    let V = 0, Vl = 0, Vs = 0, fsw = 0, brw = 0, plw = 0, cw = 0, stw = 0, mx = 0, mz = 0, area = 0, maxBr = 0;
    for (let k = 0; k < N * N; k++) {
      if (!this.mask[k]) continue;
      const hs = this.hs[k], hl = this.hl[k], h = hs + hl;
      if (h < 1e-5) continue;
      V += h * a; Vl += hl * a; Vs += hs * a;
      fsw += this.fs[k] * hs * a; brw += this.br[k] * hs * a; plw += this.pl[k] * hl * a;
      cw += this.curd[k] * h * a; stw += this.st[k] * hl * a;
      mx += (this.cx[k] + this.ox) * h * a; mz += (this.cz[k] + this.oz) * h * a;
      if (h > 0.004) area += a;
      if (this.br[k] > maxBr && hs > 0.004) maxBr = this.br[k];
    }
    return {
      V, Vl, Vs,
      setFrac: V > 0 ? Vs / V : 0,
      fs: Vs > 0 ? fsw / Vs : 0,
      br: Vs > 0 ? brw / Vs : 0,
      pl: Vl > 0 ? plw / Vl : 0,
      curd: V > 0 ? cw / V : 0,
      streak: Vl > 0 ? stw / Vl : 0,
      maxBr,
      cx: V > 0 ? mx / V : 0, cz: V > 0 ? mz / V : 0,
      area, thick: area > 0 ? V / area : 0,
    };
  };

  /** シートの奥側のふち（パン座標の z）。巻いている卵はここに沿わせる */
  EggSheet.prototype.farEdge = function () {
    const N = this.N;
    for (let j = 0; j < N; j++) {
      let c = 0;
      for (let i = 0; i < N; i++) { const k = j * N + i; if (this.mask[k] && this.hs[k] + this.hl[k] > 0.004) c++; }
      if (c >= 3) return this.cz[j * N] + this.oz - this.dx * 0.5;
    }
    return null;
  };

  /** 巻いた分だけシートから卵を取り出す（frac=0..1） */
  EggSheet.prototype.take = function (frac) {
    const s = this.computeStats();
    frac = U.clamp(frac, 0, 1);
    const N = this.N, a = this.dx * this.dx;
    // 奥（z が小さい側）から順に巻き取る：巻くほど手前の平たい部分だけが残る
    if (!this.orderZ) {
      this.orderZ = [];
      for (let k = 0; k < N * N; k++) if (this.mask[k]) this.orderZ.push(k);
      this.orderZ.sort((p, q) => this.cz[p] - this.cz[q] || Math.abs(this.cx[p]) - Math.abs(this.cx[q]));
    }
    let need = s.V * frac;
    for (const k of this.orderZ) {
      if (need <= 0) break;
      const v = (this.hs[k] + this.hl[k]) * a;
      if (v <= 0) continue;
      const f = Math.min(1, need / v);
      this.hs[k] *= 1 - f; this.hl[k] *= 1 - f;
      need -= v * f;
    }
    this.stats = this.computeStats();
    return { V: s.V * frac, Vl: s.Vl * frac, Vs: s.Vs * frac, fs: s.fs, br: s.br, curd: s.curd, pl: s.pl };
  };

  /** 液体の状態を言葉に（シート全体の平均） */
  function doneLabel(liquidFrac, firm, br) {
    if (br > 0.72) return { key: 'burnt', text: '焦げ', lv: 6 };
    if (br > 0.38) return { key: 'over', text: '焼きすぎ', lv: 5 };
    if (liquidFrac > 0.82) return { key: 'liquid', text: '液状', lv: 0 };
    if (liquidFrac > 0.6) return { key: 'half', text: '半熟', lv: 1 };
    if (liquidFrac > 0.36) return { key: 'fuwa', text: 'ふわとろ', lv: 2 };
    if (liquidFrac > 0.16 || firm < 0.6) return { key: 'good', text: '適度に火が通った', lv: 3 };
    return { key: 'firm', text: '固め', lv: 4 };
  }

  // ================= SheetMesh =================
  const C = {
    liquid: [0.98, 0.6, 0.06], white: [0.97, 0.93, 0.76], thick: [1.0, 0.74, 0.22],
    set0: [1.0, 0.78, 0.2], set1: [1.0, 0.84, 0.36], brown: [0.8, 0.52, 0.22], burnt: [0.2, 0.11, 0.05],
  };
  function setColor(fs, br, brVis) {
    let c = U.mix3(C.set0, C.set1, fs);
    const b = br * brVis;
    c = b < 0.5 ? U.mix3(c, C.brown, b * 2) : U.mix3(C.brown, C.burnt, (b - 0.5) * 2);
    return c;
  }

  function SheetMesh(sheet) {
    this.sheet = sheet;
    const N = sheet.N, V = N + 1;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(V * V * 3);
    const uv = new Float32Array(V * V * 2);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i;
      uv[k * 2] = i / N; uv[k * 2 + 1] = j / N;   // DataTexture の行 j と同じ向き
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    this.colData = new Uint8Array(N * N * 4);
    this.roughData = new Uint8Array(N * N * 4);
    this.colHi = new Uint8Array(N * 4 * N * 4 * 4);
    this.colTex = new THREE.DataTexture(this.colHi, N * 4, N * 4, THREE.RGBAFormat);
    this.colTex.encoding = THREE.sRGBEncoding;
    this.colTex.magFilter = this.colTex.minFilter = THREE.LinearFilter;
    this.colTex.flipY = false;
    this.roughTex = new THREE.DataTexture(this.roughData, N, N, THREE.RGBAFormat);
    this.roughTex.magFilter = this.roughTex.minFilter = THREE.LinearFilter;
    // 輪郭用の細かい透明度マップ（4倍の解像度でなめらかな曲線にする）
    this.AU = 4; this.NA = N * this.AU;
    this.alphaData = new Uint8Array(this.NA * this.NA * 4);
    this.alphaTex = new THREE.DataTexture(this.alphaData, this.NA, this.NA, THREE.RGBAFormat);
    this.alphaTex.magFilter = this.alphaTex.minFilter = THREE.LinearFilter;
    this.field = new Float32Array(N * N); this.field2 = new Float32Array(N * N);
    this.mat = new THREE.MeshPhysicalMaterial({
      alphaMap: this.alphaTex,
      map: this.colTex, roughnessMap: this.roughTex, roughness: 1, metalness: 0,
      clearcoat: 0.6, clearcoatRoughness: 0.12,
      bumpMap: U.noiseTex(128, 10, 3, 1.8), bumpScale: 0.002,
      alphaTest: 0.5,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.time = 0;
  }

  SheetMesh.prototype.update = function (dt) {
    const s = this.sheet, N = s.N, V = N + 1, R = s.R, dx = s.dx;
    this.time += dt;
    const t = this.time;
    const pos = this.pos;
    let any = false;
    if (!this.vy) { this.vy = new Float32Array(V * V); this.vin = new Uint8Array(V * V); }
    const vy = this.vy, vin = this.vin;
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      let h = 0, c = 0, liq = 0, cu = 0;
      for (let b = -1; b <= 0; b++) for (let a = -1; a <= 0; a++) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const k = jj * N + ii;
        if (!s.mask[k]) continue;
        h += s.hs[k] + s.hl[k]; liq += s.hl[k]; cu += s.curd[k]; c++;
      }
      if (c) { h /= c; liq /= c; cu /= c; }
      const v = j * V + i;
      vin[v] = c > 0 ? 1 : 0;
      const x = -R + i * dx + s.ox, z = -R + j * dx + s.oz;
      let y = 0.003;
      if (h > 0.0018) {
        any = true;
        y = 0.004 + h * 1.05;
        const lf = h > 0 ? liq / h : 0;
        y += s.ripple * lf * 0.012 * Math.sin(x * 9 + t * 11) * Math.sin(z * 8 - t * 9);
        y += cu * 0.018 * U.noise2(x * 9, z * 9);
      }
      vy[v] = y;
    }
    // 鍋の外の頂点は、内側の隣の高さをもらって縁にそろえる（縁がギザギザにならない）
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const v = j * V + i;
      if (vin[v]) continue;
      const x = -R + i * dx, z = -R + j * dx;
      const r = Math.hypot(x, z) || 1;
      const ii = Math.round(i - (x / r) * 1.5), jj = Math.round(j - (z / r) * 1.5);
      const u = U.clamp(jj, 0, N) * V + U.clamp(ii, 0, N);
      vy[v] = vy[u];
    }
    // 縁ぎわの高さを少しならす（側面をはい上がった卵の縁が波打たない）
    if (!this.vy2) this.vy2 = new Float32Array(V * V);
    const vy2 = this.vy2;
    vy2.set(vy);
    for (let j = 1; j < V - 1; j++) for (let i = 1; i < V - 1; i++) {
      const x = -R + i * dx, z = -R + j * dx;
      if (x * x + z * z < 0.8) continue;
      const v = j * V + i;
      if (vy[v] <= 0.0035) continue;
      let sm = 0, n = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const y2 = vy[v + b * V + a]; if (y2 > 0.0035) { sm += y2; n++; } }
      vy2[v] = sm / n;
    }
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const v = j * V + i, k = v * 3;
      const x = -R + i * dx + s.ox, z = -R + j * dx + s.oz;
      const y = vy2[v];
      const r = Math.hypot(x, z) || 1;
      // 縁では卵の高さに合わせてフライパンの側面をはい上がる（側面を突き抜けない）
      const wallR = 1.0 + Math.max(0, y) * 0.72;
      const lim = y > 0.0035 ? wallR - 0.01 : 0.97;
      if (r > 0.9) {
        // 格子の角ばった外周を、なめらかに鍋の縁の円へ寄せる
        const nr = r + (lim - r) * U.smooth(0.9, 1.06, r);
        pos[k] = (x * nr) / r; pos[k + 2] = (z * nr) / r;
      } else { pos[k] = x; pos[k + 2] = z; }
      pos[k + 1] = y;
    }
    this.mesh.visible = any;
    if (!any) return;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();

    // 色と粗さ
    const st = s.stats || s.computeStats();
    let avg = [255, 210, 80];
    let liquidSum = 0, n = 0;
    for (let k = 0; k < N * N; k++) {
      const o = k * 4;
      const hs = s.hs[k], hl = s.hl[k], h = hs + hl;
      if (!s.mask[k] || h < 0.0018) {
        this.colData[o] = avg[0]; this.colData[o + 1] = avg[1]; this.colData[o + 2] = avg[2]; this.colData[o + 3] = 0;
        this.roughData[o + 1] = 120;
        continue;
      }
      const brVis = U.clamp(0.035 / (h + 0.012), 0.35, 1);
      let cs = setColor(s.fs[k], s.br[k], brVis);
      let cl = U.mix3(C.liquid, C.white, s.st[k] * 0.85);
      cl = U.mix3(cl, C.thick, s.pl[k]);
      if (s.fried) {
        // 目玉焼き：白身は透明 → 焼けると真っ白に（焼き色はふちから）
        const b = s.br[k] * brVis;
        cs = U.mix3([0.99, 0.98, 0.95], C.brown, Math.min(1, b * 1.6));
        cl = [0.86, 0.84, 0.74];
      }
      const wl = U.clamp(hl / 0.009, 0, 1);
      const col = U.mix3(cs, cl, wl);
      this.colData[o] = col[0] * 255; this.colData[o + 1] = col[1] * 255; this.colData[o + 2] = col[2] * 255; this.colData[o + 3] = 255;
      avg = [this.colData[o], this.colData[o + 1], this.colData[o + 2]];
      const rough = U.lerp(U.lerp(0.32, 0.55, s.fs[k]) + s.br[k] * 0.2, 0.07 + s.pl[k] * 0.15, wl);
      this.roughData[o + 1] = U.clamp(rough, 0, 1) * 255;
      liquidSum += wl; n++;
    }
    // 輪郭をなめらかに：卵の厚みを連続値のまま少しぼかし、4倍に拡大してから切る
    const f = this.field, f2 = this.field2;
    for (let k = 0; k < N * N; k++) { f[k] = s.mask[k] ? U.clamp((s.hs[k] + s.hl[k] - 0.0006) / 0.0035, 0, 1) : 0; this.colData[k * 4 + 3] = 255; }
    // 鍋の外のセルは内側の値をのばす（縁まで卵があるとき輪郭が欠けない）
    for (let pass = 0; pass < 3; pass++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (s.mask[k]) continue;
      let m = 0;
      if (i > 0) m = Math.max(m, f[k - 1]); if (i < N - 1) m = Math.max(m, f[k + 1]);
      if (j > 0) m = Math.max(m, f[k - N]); if (j < N - 1) m = Math.max(m, f[k + N]);
      f[k] = m;
    }
    const KW = [1, 4, 6, 4, 1];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let sum = 0, ws = 0;
      for (let a = -2; a <= 2; a++) { const ii = i + a; if (ii < 0 || ii >= N) continue; sum += f[j * N + ii] * KW[a + 2]; ws += KW[a + 2]; }
      f2[j * N + i] = sum / ws;
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let sum = 0, ws = 0;
      for (let b = -2; b <= 2; b++) { const jj = j + b; if (jj < 0 || jj >= N) continue; sum += f2[jj * N + i] * KW[b + 2]; ws += KW[b + 2]; }
      f[j * N + i] = sum / ws;
    }
    const AU = this.AU, NA = this.NA, ad = this.alphaData, ch = this.colHi;
    for (let J = 0; J < NA; J++) {
      const fy = (J + 0.5) / AU - 0.5, j0 = Math.max(0, Math.min(N - 1, Math.floor(fy))), j1 = Math.min(N - 1, j0 + 1), ty = U.clamp(fy - j0, 0, 1);
      for (let I = 0; I < NA; I++) {
        const fx = (I + 0.5) / AU - 0.5, i0 = Math.max(0, Math.min(N - 1, Math.floor(fx))), i1 = Math.min(N - 1, i0 + 1), tx = U.clamp(fx - i0, 0, 1);
        const v = (f[j0 * N + i0] * (1 - tx) + f[j0 * N + i1] * tx) * (1 - ty) + (f[j1 * N + i0] * (1 - tx) + f[j1 * N + i1] * tx) * ty;
        const a = U.clamp((v - 0.3) / 0.4, 0, 1);
        const o = (J * NA + I) * 4;
        ad[o + 1] = a * 255;
        // 色も細かく補間し、ふちを少し濃くして卵の輪郭（厚みのある端）を見せる
        const cd = this.colData, k00 = (j0 * N + i0) * 4, k10 = (j0 * N + i1) * 4, k01 = (j1 * N + i0) * 4, k11 = (j1 * N + i1) * 4;
        const edge = 1 - U.smooth(0.5, 0.9, v);
        const shade = 1 - 0.22 * edge;
        for (let c = 0; c < 3; c++) {
          const cv = (cd[k00 + c] * (1 - tx) + cd[k10 + c] * tx) * (1 - ty) + (cd[k01 + c] * (1 - tx) + cd[k11 + c] * tx) * ty;
          ch[o + c] = cv * (c === 2 ? shade * shade : shade);
        }
        ch[o + 3] = 255;
      }
    }
    this.alphaTex.needsUpdate = true;
    this.colTex.needsUpdate = true;
    this.roughTex.needsUpdate = true;
    this.mat.clearcoat = n ? 0.15 + 0.85 * (liquidSum / n) : 0.3;
    this.mat.bumpScale = 0.0015 + st.fs * 0.004 + st.curd * 0.004;
  };

  // ================= EggFold（巻いた卵） =================
  function EggFold() {
    this.V = 0; this.Vl = 0; this.Vs = 0; this.fs = 0; this.br = 0; this.curd = 0;
    this.quality = 0; this.qWeight = 0; this.tear = 0; this.roll = 0; this.uniformity = 1;
  }
  EggFold.prototype.add = function (part, quality) {
    const V0 = this.V;
    this.V += part.V; this.Vl += part.Vl; this.Vs += part.Vs;
    if (this.V > 0) {
      this.fs = (this.fs * V0 + part.fs * part.V) / this.V;
      this.br = (this.br * V0 + part.br * part.V) / this.V;
      this.curd = (this.curd * V0 + part.curd * part.V) / this.V;
    }
    this.quality = (this.quality * this.qWeight + quality * part.V) / (this.qWeight + part.V || 1);
    this.qWeight += part.V;
  };
  EggFold.prototype.liquidFrac = function () { return this.V > 0 ? this.Vl / this.V : 0; };
  /** 巻いた後の加熱（中は外側に守られてゆっくり火が通る） */
  EggFold.prototype.cook = function (dt, T, stick) {
    const Tc = 20 + (T - 20) * 1.0;
    const rate = cookRate(Tc);
    const size = Math.cbrt(Math.max(this.V, 0.02) / (EGG_V * 3));
    const dl = Math.min(this.Vl, this.V * rate * 0.011 * dt / size);
    this.Vl -= dl; this.Vs += dl;
    this.fs = Math.min(1, this.fs + rate * 0.045 * dt * (1 - this.fs));
    this.br = Math.min(1, this.br + brownRate(Tc) * 0.8 * (1 + stick * 0.6) * dt * (this.fs > 0.5 ? 1 : 0.5));
  };
  /** 皿の上での余熱 */
  EggFold.prototype.carryOver = function (dt, tOn) {
    const k = Math.exp(-tOn / 18) * 0.0045;
    const dl = Math.min(this.Vl, this.V * k * dt);
    this.Vl -= dl; this.Vs += dl;
  };
  EggFold.prototype.label = function () {
    const lf = this.liquidFrac();
    return doneLabel(lf * 1.1, this.fs, this.br);
  };

  PK.Egg = { EggSheet, SheetMesh, EggFold, EGG_V, RIM_H, RIM_R, heatProfile, cookRate, doneLabel, COLORS: C, setColor };
})();
