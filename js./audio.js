/* PAKKAAAN! — 効果音（Web Audio で合成。外部音源ファイル不要） */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});

  const A = {
    ctx: null, master: null, enabled: true, volume: 0.7,
    noiseBuf: null, sizzleGain: null, sizzleFilter: null, sliceGain: null,
  };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC();
    } catch (e) { return; }
    A.master = A.ctx.createGain();
    A.master.gain.value = A.enabled ? A.volume : 0;
    A.master.connect(A.ctx.destination);
    // 小さな部屋の響き（全部の音を少しだけ響かせて、作り物っぽさを減らす）
    try {
      const sr = A.ctx.sampleRate, n = Math.floor(sr * 0.5);
      const ir = A.ctx.createBuffer(2, n, sr);
      for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
      A.verb = A.ctx.createConvolver(); A.verb.buffer = ir;
      A.verbGain = A.ctx.createGain(); A.verbGain.gain.value = 0.35;
      A.verb.connect(A.verbGain); A.verbGain.connect(A.master);
      // 広いホールの響き（拍手用）
      const n2 = Math.floor(sr * 2.2);
      const ir2 = A.ctx.createBuffer(2, n2, sr);
      for (let ch = 0; ch < 2; ch++) { const d = ir2.getChannelData(ch); for (let i = 0; i < n2; i++) { const x = i / n2; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, 2.2) * (i < sr * 0.012 ? 0.3 : 1); } }
      A.hall = A.ctx.createConvolver(); A.hall.buffer = ir2;
      const hlp = A.ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 5000;
      A.hallGain = A.ctx.createGain(); A.hallGain.gain.value = 0.55;
      A.hall.connect(hlp); hlp.connect(A.hallGain); A.hallGain.connect(A.master);
    } catch (e) { A.verb = null; }
    // ホワイトノイズ
    const len = A.ctx.sampleRate * 6;   // 長めにして、くり返しの継ぎ目が聞こえないように
    A.noiseBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = A.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // 低くやわらかいノイズ（ガスの炎用）
    A.brownBuf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const bd = A.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
    // 継ぎ目をなめらかに
    const fade = Math.floor(A.ctx.sampleRate * 0.2);
    for (let i = 0; i < fade; i++) { const t = i / fade; bd[i] = bd[i] * t + bd[len - fade + i] * (1 - t); }
    // 焼ける音：やわらかい「ジュー」（高い音を少し丸めたノイズ）。音量だけで制御する
    const src = A.ctx.createBufferSource();
    src.buffer = A.noiseBuf; src.loop = true;
    A.sizzleFilter = A.ctx.createBiquadFilter();
    A.sizzleFilter.type = 'bandpass'; A.sizzleFilter.frequency.value = 2800; A.sizzleFilter.Q.value = 0.5;
    const soft = A.ctx.createBiquadFilter(); soft.type = 'lowpass'; soft.frequency.value = 6500;
    A.sizzleGain = A.ctx.createGain(); A.sizzleGain.gain.value = 0;
    src.connect(A.sizzleFilter); A.sizzleFilter.connect(soft); soft.connect(A.sizzleGain); A.sizzleGain.connect(A.master);
    src.start();
    // ガスの炎の音：ごく小さく低い「ボー」
    const src3 = A.ctx.createBufferSource();
    src3.buffer = A.brownBuf; src3.loop = true;
    const f3 = A.ctx.createBiquadFilter(); f3.type = 'lowpass'; f3.frequency.value = 260; f3.Q.value = 0.3;
    A.flameGain = A.ctx.createGain(); A.flameGain.gain.value = 0;
    src3.connect(f3); f3.connect(A.flameGain); A.flameGain.connect(A.master);
    src3.start(0, 0.7);
    A.sizLevel = 0;
    // ナイフのスライド音
    const src2 = A.ctx.createBufferSource();
    src2.buffer = A.noiseBuf; src2.loop = true;
    const f2 = A.ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1800; f2.Q.value = 2;
    A.sliceGain = A.ctx.createGain(); A.sliceGain.gain.value = 0;
    src2.connect(f2); f2.connect(A.sliceGain); A.sliceGain.connect(A.master);
    src2.start();
    if (A.clapKind !== 'none') A.prepare(A.clapKind);
    // iPhone などは、最初に指で触れたときに一度声を出しておかないと、あとで話せない
    try { if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } } catch (e) { /* 無視 */ }
  };

  A.setVolume = function (v, enabled) {
    A.volume = v; A.enabled = enabled;
    if (A.master) A.master.gain.setTargetAtTime(enabled ? v : 0, A.ctx.currentTime, 0.05);
  };

  A.sizzle = function (level) {
    if (!A.ctx) return;
    A.sizLevel = level;
    // 「ジュー」は控えめに、細かい「パチパチ」を重ねる
    A.sizzleGain.gain.setTargetAtTime(Math.min(0.1, level * 0.1), A.ctx.currentTime, 0.3);
    if (level > 0.08 && Math.random() < level * 0.22) burst(0.012 + Math.random() * 0.02, 2000 + Math.random() * 4000, 3, 0.03 + level * 0.07);
  };
  /** コンロの火の強さ（0〜1） */
  A.flame = function (level) {
    if (!A.ctx) return;
    A.flameGain.gain.setTargetAtTime(level > 0.01 ? 0.015 + level * 0.035 : 0, A.ctx.currentTime, 0.3);
  };
  A.slice = function (level) {
    if (!A.ctx) return;
    A.sliceGain.gain.setTargetAtTime(Math.min(0.35, level), A.ctx.currentTime, 0.04);
  };

  function burst(dur, freq, q, gain, type) { nz({ dur, f: freq, q, g: gain, type }); }

  /** フィルターをかけたノイズの一打（実際の物音は電子音ではなくノイズの形で作る） */
  function nz(o) {
    const c = A.ctx, t = c.currentTime + (o.t || 0);
    const s = c.createBufferSource(); s.buffer = o.brown ? A.brownBuf : A.noiseBuf;
    s.playbackRate.value = o.rate || 1;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q == null ? 1 : o.q;
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    const g = c.createGain();
    const att = o.att || 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.g, t + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(att + 0.005, o.dur));
    s.connect(f); f.connect(g); g.connect(A.master);
    if (A.verb && o.wet) { const w = c.createGain(); w.gain.value = o.wet; g.connect(w); w.connect(A.verb); }
    if (A.hall && o.hall) { const w = c.createGain(); w.gain.value = o.hall; g.connect(w); w.connect(A.hall); }
    s.start(t, Math.random() * 4); s.stop(t + o.dur + 0.05);
  }
  /** 水滴や泡の「ぽちゃ」：上がっていく短い音 */
  function drip(f1, f2, dur, gain, delay) {
    const c = A.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.03);
  }
  /** ひよこの「ピ」：高い音が上がったり下がったりする短い鳴き */
  function chirp(f1, f2, dur, gain, delay) {
    const c = A.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.master); o.start(t); o.stop(t + dur + 0.03);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ===== 人の拍手・歓声（波形を直接つくる） =====
   * 電子的な「ノイズの一打」ではなく、ひとりひとりの手の形（手のひらの空洞の響き）、
   * 叩く速さのゆらぎ、左右の位置、遠さ（こもり）を持った「人」を何十人も並べて録音するように作る。 */
  function reso(f, bw, sr) {
    const w = (2 * Math.PI * f) / sr, r = Math.exp((-Math.PI * bw) / sr);
    return { a1: 2 * r * Math.cos(w), a2: -r * r, b: (1 - r) * 2 * Math.sin(w) + 1e-4, y1: 0, y2: 0 };
  }
  function makePerson(near) {
    const cup = Math.random();   // 0：手のひらを平らに（高く乾いた音）〜 1：丸めて（低くポコッ）
    return {
      f: U_lerp(2300, 750, cup) * rnd(0.9, 1.1), bw: rnd(180, 520), f2: rnd(2400, 4200), bw2: rnd(700, 1600),
      tau: rnd(0.0035, 0.0085), snap: rnd(0.04, 0.14), body: U_lerp(0.7, 1.15, cup),
      pan: Math.sign(Math.random() - 0.5) * Math.pow(Math.random(), 0.6), dist: near ? rnd(0, 0.25) : rnd(0.15, 1),
      rate: rnd(3.6, 6.4), drift: rnd(-0.25, 0.2), gain: rnd(0.55, 1),
    };
  }
  function U_lerp(a, b, t) { return a + (b - a) * t; }
  function addClap(L, R, sr, t0, P, amp) {
    const n0 = Math.floor(t0 * sr);
    const N = Math.min(Math.floor(sr * Math.min(0.045, P.tau * 6.5)), L.length - n0);
    if (N <= 0 || n0 < 0) return;
    const r1 = reso(P.f * rnd(0.95, 1.05), P.bw, sr), r2 = reso(P.f2 * rnd(0.95, 1.05), P.bw2, sr);
    const att = Math.max(1, Math.floor(sr * rnd(0.0003, 0.0009))), tau = P.tau * rnd(0.85, 1.2) * sr;
    const lpA = 1 - Math.exp((-2 * Math.PI * U_lerp(7500, 2400, P.dist)) / sr);   // 遠い人ほどこもる
    const gl = amp * Math.sqrt(0.5 * (1 - P.pan)), gr = amp * Math.sqrt(0.5 * (1 + P.pan));
    let px = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const env = i < att ? i / att : Math.exp(-(i - att) / tau);
      const x = (Math.random() * 2 - 1) * env;
      const y = r1.b * x + r1.a1 * r1.y1 + r1.a2 * r1.y2; r1.y2 = r1.y1; r1.y1 = y;
      const z = r2.b * x + r2.a1 * r2.y1 + r2.a2 * r2.y2; r2.y2 = r2.y1; r2.y1 = z;
      let v = P.body * y * 2.2 + 0.8 * z + P.snap * (x - 0.7 * px);
      px = x;
      lp += lpA * (v - lp);
      v = lp;
      L[n0 + i] += v * gl; R[n0 + i] += v * gr;
    }
  }
  /** 声（「わー」「おー」「えー」「あはは」）。声帯の振動を母音の響き（フォルマント）に通す */
  const VOW = { a: [800, 1250, 2700], o: [520, 880, 2500], e: [460, 1900, 2650], u: [360, 1100, 2400], w: [330, 750, 2400], i: [300, 2300, 3000], h: [800, 1250, 2700] };
  function addVoice(L, R, sr, t0, dur, o) {
    const n0 = Math.floor(t0 * sr), N = Math.min(Math.floor(dur * sr), L.length - n0);
    if (N <= 0 || n0 < 0) return;
    const pan = o.pan == null ? rnd(-0.8, 0.8) : o.pan;
    const gl = o.amp * Math.sqrt(0.5 * (1 - pan)), gr = o.amp * Math.sqrt(0.5 * (1 + pan));
    const F = [reso(800, 90, sr), reso(1200, 110, sr), reso(2600, 170, sr)], FG = [1, 0.55, 0.22];
    const bws = [90, 110, 170];
    const vib = rnd(4.5, 6.5), vibD = rnd(0.008, 0.02), ph0 = Math.random() * 6;
    let ph = 0, prevS = 0, lp = 0;
    const lpA = 1 - (o.dist || 0) * 0.7;
    for (let i = 0; i < N; i++) {
      const x = i / N, tt = i / sr;
      if ((i & 31) === 0) {
        const va = VOW[o.v0 || o.v], vb = VOW[o.v];
        const g = o.glide ? Math.min(1, tt / o.glide) : 1;
        for (let k = 0; k < 3; k++) {
          const f = (va[k] + (vb[k] - va[k]) * g) * (o.fs || 1);
          const nr = reso(f, bws[k] * (1 + (o.breathy || 0)), sr);
          F[k].a1 = nr.a1; F[k].a2 = nr.a2; F[k].b = nr.b;
        }
      }
      const f0 = o.f0 * (o.pitch ? o.pitch(x) : 1) * (1 + vibD * Math.sin(2 * Math.PI * vib * tt + ph0)) * (1 + 0.004 * (Math.random() - 0.5));
      ph += f0 / sr; if (ph >= 1) ph -= 1;
      const s = ph < 0.65 ? Math.pow(Math.sin((Math.PI * ph) / 0.65), 2) : 0;
      let src = (s - prevS) * 6; prevS = s;
      src += (Math.random() * 2 - 1) * (o.noise || 0.12);
      let env = o.env ? o.env(x, tt) : 1;
      let v = 0;
      for (let k = 0; k < 3; k++) {
        const y = F[k].b * src + F[k].a1 * F[k].y1 + F[k].a2 * F[k].y2; F[k].y2 = F[k].y1; F[k].y1 = y; v += y * FG[k];
      }
      lp += lpA * (v * env - lp);
      L[n0 + i] += lp * gl; R[n0 + i] += lp * gr;
    }
  }
  /** 指笛「ピューイ」 */
  function addWhistle(L, R, sr, t0, o) {
    const dur = o.dur || 0.7, n0 = Math.floor(t0 * sr), N = Math.min(Math.floor(dur * sr), L.length - n0);
    if (N <= 0) return;
    const pan = o.pan == null ? rnd(-0.7, 0.7) : o.pan;
    const gl = o.amp * Math.sqrt(0.5 * (1 - pan)), gr = o.amp * Math.sqrt(0.5 * (1 + pan));
    const base = o.f || rnd(2300, 3000);
    let ph = 0;
    for (let i = 0; i < N; i++) {
      const x = i / N, tt = i / sr;
      const fc = o.wolf
        ? (x < 0.35 ? U_lerp(0.55, 1.05, Math.sqrt(x / 0.35)) : x < 0.5 ? 1.05 : U_lerp(0.8, 0.5, (x - 0.5) / 0.5))
        : (x < 0.12 ? U_lerp(0.75, 1, x / 0.12) : 1 - 0.06 * (x - 0.12));
      const f = base * fc * (1 + 0.012 * Math.sin(2 * Math.PI * 6 * tt));
      ph += f / sr;
      const env = Math.min(1, x / 0.05) * Math.min(1, (1 - x) / 0.15);
      const v = (Math.sin(2 * Math.PI * ph) + (Math.random() - 0.5) * 0.12) * env;
      L[n0 + i] += v * gl; R[n0 + i] += v * gr;
    }
  }
  function crowdVoices(L, R, sr, t0, n, dur, v, opt) {
    opt = opt || {};
    for (let i = 0; i < n; i++) {
      const who = Math.random();
      const f0 = who < 0.45 ? rnd(105, 165) : who < 0.85 ? rnd(200, 300) : rnd(280, 380);
      const d = dur * rnd(0.7, 1.15), st = t0 + rnd(0, opt.spread == null ? 0.25 : opt.spread);
      const att = rnd(0.06, 0.25);
      addVoice(L, R, sr, st, d, {
        f0, v, v0: opt.v0, glide: opt.glide, amp: (opt.amp || 0.05) * rnd(0.5, 1), dist: rnd(0.1, 0.8), fs: who < 0.45 ? 1 : 1.12,
        noise: opt.noise || 0.18, breathy: 0.6,
        pitch: opt.pitch || ((x) => (x < 0.2 ? U_lerp(0.92, 1.1, x / 0.2) : U_lerp(1.1, 0.86, (x - 0.2) / 0.8))),
        env: (x, tt) => Math.min(1, tt / att) * Math.min(1, (1 - x) / 0.45),
      });
    }
  }
  function laugh(L, R, sr, t0, o) {
    const f0 = o.f0 || rnd(200, 320), n = o.n || Math.floor(rnd(4, 7)), pan = rnd(-0.6, 0.6);
    for (let i = 0; i < n; i++) {
      const st = t0 + i * rnd(0.15, 0.19);
      addVoice(L, R, sr, st, 0.12, {
        f0: f0 * (1.08 - i * 0.04), v: 'a', amp: (o.amp || 0.06) * (1 - i * 0.08), pan, noise: 0.45, breathy: 0.8, dist: 0.1,
        env: (x) => Math.sin(Math.PI * Math.min(1, x * 1.1)),
      });
    }
  }

  /** 拍手の種類（設定で選ぶ）。people：人数、len：長さ、near：近い、extra：声や指笛 */
  const CLAP_KINDS = {
    hall:    { label: 'ホールのスタンディングオベーション', people: 85, len: 3.4, room: 'hall', cheer: 18, whistle: 2 },
    cheer:   { label: 'ライブ会場の大歓声「わー！」', people: 60, len: 3.2, room: 'hall', cheer: 28, cheerAmp: 1.6, whistle: 3 },
    class:   { label: '教室のみんな（30人）「おー！」', people: 30, len: 2.6, room: 'room', oh: 10 },
    party:   { label: '友だちのホームパーティ（笑い声・指笛）', people: 9, len: 2.6, room: 'room', near: true, laugh: 3, whistle: 1, oh: 4 },
    family:  { label: '家族の拍手（4人）「わぁ〜」', people: 4, len: 2.2, room: 'room', near: true, wa: 2 },
    rhythm:  { label: '手拍子 → 大拍手', people: 40, len: 3.6, room: 'hall', rhythm: true, cheer: 12 },
    polite:  { label: '上品な拍手（まばら）', people: 14, len: 2.4, room: 'hall', soft: true },
    solo:    { label: 'ひとりでパチパチ', people: 1, len: 1.6, room: 'room', near: true },
  };
  const ALIAS = { crowd: 'hall', small: 'family' };
  const clapCache = {};
  function buildApplause(kind) {
    const K = CLAP_KINDS[kind];
    const sr = A.ctx.sampleRate, len = K.len + 0.4;
    const buf = A.ctx.createBuffer(2, Math.ceil(len * sr), sr);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const n = K.people;
    for (let p = 0; p < n; p++) {
      const P = makePerson(K.near);
      if (K.soft) { P.rate *= 0.75; P.gain *= 0.6; }
      const gain = P.gain * (n > 1 ? 1.4 / Math.sqrt(n) : 0.9) * (1 - P.dist * 0.45);
      // 人によって始めるタイミングと、やめるタイミングがちがう
      let t = n > 1 ? -Math.log(1 - Math.random() * 0.95) * (K.soft ? 0.35 : 0.14) : 0.02;
      const stop = K.len - (n > 1 ? Math.pow(Math.random(), 1.6) * K.len * 0.45 : 0.1);
      if (K.rhythm) {
        // そろった手拍子：だんだん速くなって、最後はばらばらの大拍手に
        let bt = 0.05, iv = 0.44, beat = 0;
        while (bt < 1.9) { addClap(L, R, sr, bt + rnd(-0.018, 0.018), P, gain * rnd(0.8, 1) * 1.15); iv *= 0.94; bt += iv; beat++; }
        t = bt + rnd(0, 0.15);
      }
      let rate = P.rate;
      while (t < stop) {
        const env = Math.min(1, (t + 0.06) / 0.3) * Math.min(1, Math.pow((stop - t) / (K.len * 0.4), 0.7));
        addClap(L, R, sr, t, P, gain * env * rnd(0.7, 1.05));
        rate *= 1 + P.drift * 0.02;   // 疲れて遅くなったり、乗って速くなったり
        t += (1 / Math.max(2.4, rate)) * rnd(0.88, 1.12);
      }
    }
    // 声・指笛
    if (K.cheer) crowdVoices(L, R, sr, K.rhythm ? 1.9 : 0.15, K.cheer, K.len * 0.75, 'a', { v0: 'w', glide: 0.12, amp: 0.035 * (K.cheerAmp || 1) });
    if (K.oh) crowdVoices(L, R, sr, 0.05, K.oh, 1.1, 'o', { amp: 0.06, pitch: (x) => (x < 0.3 ? U_lerp(0.9, 1.12, x / 0.3) : U_lerp(1.12, 0.85, (x - 0.3) / 0.7)) });
    if (K.wa) crowdVoices(L, R, sr, 0.0, K.wa, 1.0, 'a', { v0: 'w', glide: 0.15, amp: 0.07, spread: 0.1 });
    for (let i = 0; i < (K.whistle || 0); i++) addWhistle(L, R, sr, rnd(0.3, K.len * 0.6), { amp: 0.022, wolf: Math.random() < 0.5 });
    for (let i = 0; i < (K.laugh || 0); i++) laugh(L, R, sr, rnd(0.2, 1.2), { amp: 0.07 });
    // 音量をそろえる（どれを選んでも同じくらいの大きさ）
    let pk = 0; for (let i = 0; i < L.length; i += 3) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const sc = 0.8 / (pk || 1);
    for (let i = 0; i < L.length; i++) { L[i] *= sc; R[i] *= sc; }
    return buf;
  }
  function playBuf(buf, k, room, delay) {
    const c = A.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = buf;
    const g = c.createGain(); g.gain.value = k;
    s.connect(g); g.connect(A.master);
    const send = room === 'hall' ? A.hall : A.verb;
    if (send) { const w = c.createGain(); w.gain.value = room === 'hall' ? 0.35 : 0.3; g.connect(w); w.connect(send); }
    s.start(t);
  }
  /** 選ばれている拍手を、ひまなときに先に作っておく（鳴らす瞬間に止まらないように） */
  A.prepare = function (kind) {
    if (!A.ctx) return;
    kind = ALIAS[kind] || kind;
    if (!CLAP_KINDS[kind]) return;
    [0, 1].forEach((v, i) => setTimeout(() => { const key = kind + v; if (!clapCache[key]) clapCache[key] = buildApplause(kind); }, 400 + i * 1500));
  };
  function applause(kind, len, k) {
    kind = ALIAS[kind] || kind;
    if (!CLAP_KINDS[kind]) kind = 'hall';
    // 毎回少しちがう拍手になるよう、2通り作って交互に使う
    const key = kind + ((A._clapN = (A._clapN || 0) + 1) % 2);
    if (!clapCache[key]) clapCache[key] = buildApplause(kind);
    playBuf(clapCache[key], 0.9 * k, CLAP_KINDS[kind].room);
  }
  /** 評価に合わせた見ている人たちの反応（声） */
  const reactCache = {};
  function crowdReact(type, k) {
    if (!reactCache[type]) {
      const sr = A.ctx.sampleRate, len = 1.8;
      const buf = A.ctx.createBuffer(2, Math.ceil(len * sr), sr);
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      if (type === 'ee') crowdVoices(L, R, sr, 0, 14, 1.3, 'e', { amp: 0.06, spread: 0.12, pitch: (x) => (x < 0.25 ? U_lerp(1.0, 1.08, x / 0.25) : U_lerp(1.08, 0.78, (x - 0.25) / 0.75)) });
      else if (type === 'aa') crowdVoices(L, R, sr, 0, 14, 1.2, 'a', { amp: 0.06, spread: 0.1, pitch: (x) => (x < 0.15 ? U_lerp(1.15, 1.2, x / 0.15) : U_lerp(1.2, 0.8, (x - 0.15) / 0.85)) });
      else if (type === 'oo') crowdVoices(L, R, sr, 0, 14, 1.2, 'o', { amp: 0.06, spread: 0.12, pitch: (x) => (x < 0.35 ? U_lerp(0.9, 1.15, x / 0.35) : U_lerp(1.15, 0.9, (x - 0.35) / 0.65)) });
      let pk = 0; for (let i = 0; i < L.length; i += 3) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
      const sc = 0.7 / (pk || 1); for (let i = 0; i < L.length; i++) { L[i] *= sc; R[i] *= sc; }
      reactCache[type] = buf;
    }
    playBuf(reactCache[type], k, 'room');
  }
  A.react = function (type, k) { if (A.ctx && A.enabled) crowdReact(type, k == null ? 0.8 : k); };

  /** ひとことしゃべる（ブラウザの日本語音声）。なければ何もしない */
  A.voiceOn = true;
  A.say = function (text, opt) {
    if (!A.enabled || !A.voiceOn || !text) return;
    const ss = window.speechSynthesis;
    if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      const vs = ss.getVoices ? ss.getVoices() : [];
      const ja = vs.filter((v) => /^ja/i.test(v.lang));
      const pick = ja.find((v) => /Nanami|Kyoko|O-ren|Haruka|Ayumi|Google/i.test(v.name)) || ja[0];
      if (pick) u.voice = pick;
      u.rate = (opt && opt.rate) || 1.08;
      u.pitch = (opt && opt.pitch) || 1.25;
      u.volume = Math.min(1, (A.volume || 0.7) * 1.3);
      ss.speak(u);
    } catch (e) { /* 声が出せない環境は無視 */ }
  };
  // 一部のブラウザは最初の呼び出しで声の一覧が空なので、先に読み込んでおく
  try { if (window.speechSynthesis) { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); } } catch (e) { /* 無視 */ }
  A.clapKind = 'hall';
  A.shutterKind = 'game';
  const SOUND_CHOICES = {
    clap: Object.keys(CLAP_KINDS).map((k) => [k, CLAP_KINDS[k].label]).concat([['none', 'なし']]),
    shutter: [['game', '携帯ゲーム機風「カシャッ」'], ['slr', '一眼レフ「カシャッ」'], ['phone', 'スマホ風「カシャ」'], ['film', 'フィルム「カシャ・ジーッ」']],
  };
  A.CHOICES = SOUND_CHOICES;
  function shutter(kind, k) {
    if (kind === 'game') {
      // 携帯ゲーム機のカメラ風：明るくはっきりした「カッ」→ すぐに軽い「シャッ」。少し金属っぽく響く
      nz({ dur: 0.003, type: 'highpass', f: 5000, q: 0.7, g: 0.9 * k });
      nz({ dur: 0.025, f: 2800, q: 5, g: 0.6 * k, att: 0.001, wet: 0.25 });
      nz({ t: 0.004, dur: 0.02, f: 4600, q: 7, g: 0.35 * k, att: 0.001 });
      nz({ t: 0.045, dur: 0.003, type: 'highpass', f: 4500, q: 0.7, g: 0.7 * k });
      nz({ t: 0.047, dur: 0.11, f: 6000, f2: 2600, q: 0.9, g: 0.5 * k, att: 0.004, wet: 0.3 });
      nz({ t: 0.05, dur: 0.05, f: 1700, q: 4, g: 0.3 * k, att: 0.002 });
    } else if (kind === 'phone') {
      // 明るく短い「カシャ」
      nz({ dur: 0.003, type: 'highpass', f: 4000, q: 0.7, g: 0.8 * k, wet: 0.2 });
      nz({ t: 0.002, dur: 0.05, f: 3200, f2: 1800, q: 1.8, g: 0.6 * k, att: 0.002, wet: 0.2 });
      nz({ t: 0.06, dur: 0.003, type: 'highpass', f: 3500, q: 0.7, g: 0.6 * k, wet: 0.2 });
      nz({ t: 0.062, dur: 0.07, f: 2600, f2: 1400, q: 1.6, g: 0.45 * k, att: 0.004, wet: 0.25 });
    } else if (kind === 'film') {
      // シャッター「カシャ」のあと、フィルムを巻き上げる「ジーッ」
      nz({ dur: 0.004, type: 'highpass', f: 3000, q: 0.7, g: 0.8 * k, wet: 0.3 });
      nz({ t: 0.003, dur: 0.06, f: 1600, q: 3, g: 0.55 * k, att: 0.002, wet: 0.3 });
      nz({ t: 0.07, dur: 0.004, type: 'highpass', f: 2800, q: 0.7, g: 0.6 * k, wet: 0.3 });
      const c = A.ctx, t0 = c.currentTime + 0.18;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t0); o.frequency.linearRampToValueAtTime(120, t0 + 0.45);
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2.5;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.07 * k, t0 + 0.04); g.gain.setValueAtTime(0.07 * k, t0 + 0.4); g.gain.linearRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(f); f.connect(g); g.connect(A.master); o.start(t0); o.stop(t0 + 0.55);
      for (let i = 0; i < 12; i++) nz({ t: 0.18 + i * 0.037, dur: 0.012, f: 2400, q: 4, g: 0.12 * k });
    } else {
      // 一眼レフ：ミラーが上がる「カッ」→ 幕が走る「シャ」→ ミラーが戻る「カシャッ」（低い胴鳴り付き）
      nz({ dur: 0.004, type: 'highpass', f: 2500, q: 0.7, g: 0.9 * k, wet: 0.35 });
      nz({ dur: 0.05, type: 'lowpass', f: 380, q: 2, g: 0.6 * k, att: 0.002, wet: 0.3 });
      nz({ t: 0.004, dur: 0.035, f: 1900, q: 4, g: 0.55 * k, att: 0.002, wet: 0.35 });
      nz({ t: 0.02, dur: 0.05, f: 5200, f2: 3500, q: 1.2, g: 0.35 * k, att: 0.004, wet: 0.3 });
      nz({ t: 0.085, dur: 0.004, type: 'highpass', f: 2500, q: 0.7, g: 0.8 * k, wet: 0.35 });
      nz({ t: 0.086, dur: 0.06, type: 'lowpass', f: 420, q: 2, g: 0.55 * k, att: 0.002, wet: 0.3 });
      nz({ t: 0.088, dur: 0.045, f: 1500, q: 4, g: 0.5 * k, att: 0.002, wet: 0.35 });
    }
  }
  A.preview = function (type, kind) {
    A.init();
    if (!A.ctx) return;
    if (A.ctx.state === 'suspended') A.ctx.resume();
    if (type === 'clap') { if (kind !== 'none') applause(kind, 2.4, 1); }
    else if (type === 'react') crowdReact(kind, 0.8);
    else shutter(kind, 1);
  };

  A.play = function (name, k) {
    if (!A.ctx || !A.enabled) return;
    k = k == null ? 1 : k;
    switch (name) {
      case 'crack': // 殻がパキッ：細かいひびの音がいくつか続いて、最後にコツッ
        for (let i = 0; i < 6; i++) nz({ t: i * rnd(0.004, 0.012), dur: rnd(0.004, 0.012), type: 'highpass', f: rnd(2500, 6000), q: 0.7, g: rnd(0.25, 0.6) * k });
        nz({ t: 0.002, dur: 0.035, f: 1300, q: 5, g: 0.35 * k });
        break;
      case 'knock': // 卵や器を当てた「コン」：硬い物の短い響き
        nz({ dur: 0.05, f: rnd(1500, 1900), q: 9, g: 0.55 * k });
        nz({ dur: 0.03, f: rnd(3000, 3600), q: 12, g: 0.18 * k });
        nz({ dur: 0.012, type: 'highpass', f: 4000, q: 0.7, g: 0.2 * k });
        break;
      case 'drop': // 黄身がボウルに「ぽちゃ」
        drip(rnd(380, 460), rnd(1000, 1300), 0.06, 0.18 * k);
        nz({ dur: 0.12, type: 'lowpass', f: 900, q: 0.5, g: 0.18 * k, att: 0.006 });
        break;
      case 'whisk': // 箸がボウルに当たる「カチャ」と液のかき混ぜ
        nz({ dur: 0.02, f: rnd(3500, 4500), q: 7, g: 0.12 * k });
        nz({ dur: 0.09, type: 'lowpass', f: 700, f2: 400, q: 0.6, g: 0.08 * k, att: 0.02 });
        break;
      case 'pour': // 卵液がとろとろ流れる「とぽとぽ」
        nz({ dur: 1.1, type: 'bandpass', f: 500, f2: 320, q: 0.9, g: 0.22 * k, att: 0.12 });
        for (let i = 0; i < 9; i++) drip(rnd(250, 420), rnd(600, 900), rnd(0.04, 0.07), 0.05 * k, rnd(0.05, 1.0));
        break;
      case 'butter': // バターが溶け始める「ジュワッ」
        nz({ dur: 0.7, type: 'highpass', f: 2500, q: 0.6, g: 0.16 * k, att: 0.04 });
        for (let i = 0; i < 8; i++) nz({ t: rnd(0, 0.5), dur: rnd(0.006, 0.015), f: rnd(2500, 6000), q: 3, g: 0.12 * k });
        break;
      case 'slosh': // 卵液が寄る「ちゃぷ」
        nz({ dur: 0.2, type: 'lowpass', f: 380, f2: 900, q: 1.2, g: 0.09 * k, att: 0.03 });
        break;
      case 'shake': // フライパンが五徳の上を滑る「ザッ」
        nz({ dur: 0.14, f: 2600, q: 2.5, g: 0.16 * k, att: 0.01 });
        nz({ dur: 0.06, f: 650, q: 7, g: 0.12 * k });
        break;
      case 'tear': // 卵の皮がやぶれる、しめった音
        for (let i = 0; i < 5; i++) nz({ t: i * 0.025, dur: 0.04, f: rnd(700, 1200), q: 1.4, g: 0.22 * k * (1 - i * 0.15) });
        break;
      case 'piyo': { // ひよこ「ピヨッ」
        const f0 = rnd(3000, 3500);
        chirp(f0, f0 * 1.4, 0.07, 0.13 * k, 0);
        chirp(f0 * 1.35, f0 * 0.95, 0.1, 0.11 * k, 0.085);
        break;
      }
      case 'plop': // オムレツが着地「ぺちょ」
        nz({ dur: 0.16, type: 'lowpass', f: 650, f2: 250, q: 0.8, g: 0.42 * k, att: 0.008 });
        nz({ t: 0.02, dur: 0.08, f: 1400, q: 1.5, g: 0.1 * k });
        break;
      case 'click': // 指でそっと触れた「トッ」
        nz({ dur: 0.018, f: 2200, q: 2, g: 0.07 * k });
        break;
      case 'squirt': // ボトルを押す「ぶちゅ」
        nz({ dur: 0.16, type: 'lowpass', f: 500, f2: 1200, q: 2.5, g: 0.14 * k, att: 0.02 });
        drip(rnd(200, 260), rnd(500, 700), 0.05, 0.04 * k, 0.03);
        break;
      case 'sprinkle': // ぱらぱら
        for (let i = 0; i < 14; i++) nz({ t: rnd(0, 0.22), dur: rnd(0.003, 0.008), type: 'highpass', f: rnd(4000, 8000), q: 0.8, g: rnd(0.04, 0.12) * k });
        break;
      case 'pak': // ぱっかーん：皮が割れて「ぱかっ」、ふわっと開いて「ぷるん」
        nz({ dur: 0.05, f: 1200, q: 2, g: 0.45 * k });
        nz({ t: 0.04, dur: 0.5, type: 'highpass', f: 600, f2: 3000, q: 0.5, g: 0.12 * k, att: 0.15 });
        nz({ t: 0.25, dur: 0.35, type: 'lowpass', f: 300, f2: 160, q: 4, g: 0.3 * k, att: 0.02 });
        if (A.clapKind !== 'none') applause(A.clapKind, 2.4, 1.0 * k);   // 👏
        break;
      case 'ok': nz({ dur: 0.05, f: 1700, q: 8, g: 0.25 * k }); nz({ t: 0.09, dur: 0.06, f: 2100, q: 8, g: 0.25 * k }); break;
      case 'meh': nz({ dur: 0.12, type: 'lowpass', f: 300, q: 2, g: 0.3 * k, att: 0.01 }); break;
      case 'fail': // ぺしゃっ
        nz({ dur: 0.25, type: 'lowpass', f: 900, f2: 200, q: 1, g: 0.45 * k, att: 0.005 });
        for (let i = 0; i < 6; i++) nz({ t: rnd(0.02, 0.15), dur: 0.02, f: rnd(800, 1600), q: 2, g: 0.12 * k });
        break;
      case 'fanfare': if (A.clapKind !== 'none') applause(A.clapKind, 2.6, k); break;
      case 'shutter': shutter(A.shutterKind, k); break;
      case 'coin': { // お賽銭「チャリン」：金属の高い響きが、はねながら何回か鳴る
        const hit = (t, g) => {
          [2093, 3349, 4710, 6280, 7890].forEach((f, i) => {
            const c = A.ctx, o = c.createOscillator(), gg = c.createGain(), t0 = c.currentTime + t;
            o.frequency.value = f * rnd(0.99, 1.01);
            gg.gain.setValueAtTime(0, t0);
            gg.gain.linearRampToValueAtTime(g * [0.5, 0.35, 0.25, 0.15, 0.1][i] * k, t0 + 0.002);
            gg.gain.exponentialRampToValueAtTime(0.0001, t0 + [0.9, 0.6, 0.4, 0.3, 0.2][i]);
            o.connect(gg); gg.connect(A.master);
            if (A.verb) { const w = c.createGain(); w.gain.value = 0.25; gg.connect(w); w.connect(A.verb); }
            o.start(t0); o.stop(t0 + 1);
          });
          nz({ t, dur: 0.006, type: 'highpass', f: 5000, q: 0.7, g: 0.3 * g * k });
        };
        hit(0, 0.5); hit(0.13, 0.32); hit(0.21, 0.18); hit(0.26, 0.1);
        break;
      }
    }
  };

  PK.Audio = A;
})();
