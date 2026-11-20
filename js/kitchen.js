/* PAKKAAAN! — キッチンの3Dシーンとカメラ
 *  工程ごとに作業エリアを離して配置し、いま使わない物が画面に入らないようにする。
 *    準備エリア（ボウル・卵パック）… 左端
 *    コンロエリア（コンロ・バター皿・へら）… 中央
 *    盛り付けエリア（皿・ライス・ソースやトッピングの容器）… 右
 *  撮影のときはレストランのテーブルに模様替えする。
 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;

  const POS = {
    bowl: new THREE.Vector3(-11.0, 0, 0.55),
    carton: new THREE.Vector3(-10.4, 0, -1.25),
    stove: new THREE.Vector3(-3.4, 0, 0.1),
    butter: new THREE.Vector3(-5.45, 0, -0.75),   // コンロの左奥（スマホでも下のパネルに隠れない）
    spatula: new THREE.Vector3(-1.4, 0, 0.55),
    plate: new THREE.Vector3(3.2, 0, 0.25),
  };
  const PAN_Y = 0.5;          // コンロに置いたときのフライパン床面の高さ
  const PLATE_TOP = 0.06;     // 皿の内側の高さ
  const RICE = { ra: 0.9, rb: 0.6, h: 0.44 };
  const KNOB_RANGE = (135 * Math.PI) / 180;

  /** 文字を書いた板（ラベル） */
  function makeLabel(text, opt) {
    opt = opt || {};
    const fs = opt.size || 64, pad = fs * 0.45;
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const font = `${opt.weight || 800} ${fs}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Noto Sans JP", sans-serif`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width + pad * 2), h = Math.ceil(fs + pad * 1.4);
    cv.width = w; cv.height = h;
    ctx.font = font;
    if (opt.bg) {
      ctx.fillStyle = opt.bg;
      const r = h / 2;
      ctx.beginPath();
      ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arc(w - r, r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(r, h); ctx.arc(r, r, r, Math.PI / 2, Math.PI * 1.5);
      ctx.fill();
    }
    ctx.fillStyle = opt.color || '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + fs * 0.04);
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    const height = opt.height || 0.12;
    const m = new THREE.Mesh(new THREE.PlaneGeometry((height * w) / h, height), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    m.material.userData.lin = true;
    m.renderOrder = 2;
    return m;
  }

  /** ケチャップが全体に混ざったご飯の表面テクスチャ */
  function riceTex() {
    return U.canvasTex(1024, 512, (ctx, w, h) => {
      ctx.fillStyle = '#b8461c';
      ctx.fillRect(0, 0, w, h);
      const r = U.rng(21);
      for (let i = 0; i < 5200; i++) {
        const x = r() * w, y = r() * h, a = r() * Math.PI;
        const len = 9 + r() * 5, wid = 4 + r() * 2;
        const l = 40 + r() * 16;
        ctx.fillStyle = `hsl(${14 + r() * 8}, ${68 + r() * 12}%, ${l}%)`;
        ctx.beginPath();
        ctx.ellipse(x, y, len, wid, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,220,180,${0.18 + r() * 0.15})`;
        ctx.beginPath();
        ctx.ellipse(x - 1.5, y - 1.2, len * 0.55, wid * 0.4, a, 0, Math.PI * 2);
        ctx.fill();
      }
    }, { repeat: [3, 2] });
  }

  /** ライスの断面：e = 中心からの距離²（楕円で正規化）。上は丸く、裾はなだらか */
  function riceProfile(e) { return e >= 1 ? 0 : 1 - Math.pow(e, 1.3); }
  function riceSlope(e) { return e <= 0 ? 0 : -1.3 * Math.pow(e, 0.3); }

  function buildKitchen(renderer, quality) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1b1511);
    scene.fog = new THREE.Fog(0x1b1511, 14, 30);
    scene.environment = U.buildEnvMap(renderer);

    // 照明（影を落とす太陽は、いま作業しているエリアについていく）
    const hemi = new THREE.HemisphereLight(0xfff1e0, 0x3b2a1e, 0.35);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dc, 1.7);
    sun.castShadow = quality !== 'low';
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -5; sc.right = 5; sc.top = 4.5; sc.bottom = -4.5; sc.near = 1; sc.far = 25;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    scene.add(sun.target);
    function focus(x, z) {
      sun.position.set(x + 3.5, 9, z + 5.5);
      sun.target.position.set(x, 0, z);
    }
    focus(0, 0);
    const rim = new THREE.DirectionalLight(0xcfe0ff, 0.55);
    rim.position.set(-6, 5, -4);
    scene.add(rim);

    // 調理台（木）
    const wood = U.woodTex();
    wood.repeat.set(4, 1);
    const counterMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.62, metalness: 0, bumpMap: U.noiseTex(256, 8, 3, 1.2), bumpScale: 0.003 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(32, 0.6, 7), counterMat);
    counter.position.set(-3.5, -0.3, 0.2);
    counter.receiveShadow = true;
    scene.add(counter);
    // 壁（タイル）
    const tile = U.tileTex();
    tile.repeat.set(12, 3);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(34, 8), new THREE.MeshStandardMaterial({ map: tile, roughness: 0.25, metalness: 0 }));
    wall.position.set(-3.5, 4, -3.3);
    wall.receiveShadow = true;
    scene.add(wall);
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 0.8), counterMat);
    shelf.position.set(-3.4, 3.4, -2.9);
    shelf.castShadow = true;
    scene.add(shelf);

    // ===== コンロ =====
    const stove = new THREE.Group();
    stove.position.copy(POS.stove);
    scene.add(stove);
    const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.32, map: U.brushedTex() });
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.22, 2.8), steel);
    top.position.y = 0.11;
    top.castShadow = top.receiveShadow = true;
    stove.add(top);
    const iron = new THREE.MeshStandardMaterial({ color: 0x1e1d1c, metalness: 0.6, roughness: 0.6 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.1, 40), iron);
    cap.position.y = 0.27;
    stove.add(cap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 48), iron);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.27;
    stove.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 0.07), iron);
      arm.position.set(Math.cos(a) * 0.95, 0.42, Math.sin(a) * 0.95);
      arm.rotation.y = -a;
      arm.castShadow = true;
      stove.add(arm);
    }
    const trivet = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.035, 6, 60), iron);
    trivet.rotation.x = Math.PI / 2;
    trivet.position.y = 0.36;
    stove.add(trivet);
    // 火力のつまみ（135°の範囲で回る）。前面に「消火・弱・中・強」
    const KX = 0.95, KY = 0.11, KZ = 1.41;
    const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 40), new THREE.MeshStandardMaterial({ color: 0x9da1a6, metalness: 0.9, roughness: 0.3 }));
    knobBase.rotation.x = Math.PI / 2;
    knobBase.position.set(KX, KY, KZ);
    stove.add(knobBase);
    // つまみの白い線は左上（消火）から時計回りに 135° 動いて右上（強）まで。ラベルは線の先の外側
    const A0 = Math.PI / 2 + KNOB_RANGE / 2;
    const marks = [['消火', 0, '#ffffff'], ['弱', 0.25, '#7fb2ff'], ['中', 0.55, '#ffb347'], ['強', 1.0, '#ff6b5b']];
    for (const [t, f, c] of marks) {
      const a = A0 - f * KNOB_RANGE;
      const lb = makeLabel(t, { size: 72, color: c, bg: 'rgba(20,20,22,0.85)', height: 0.16 });
      const rr = t === '消火' ? 0.72 : 0.6;
      lb.position.set(KX + Math.cos(a) * rr, KY + Math.sin(a) * rr + 0.04, KZ + 0.03);
      stove.add(lb);
      const tk = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.06, 0.006), new THREE.MeshBasicMaterial({ color: c }));
      tk.position.set(KX + Math.cos(a) * 0.3, KY + Math.sin(a) * 0.3, KZ + 0.015);
      tk.rotation.z = a - Math.PI / 2;
      stove.add(tk);
    }
    const knob = new THREE.Group();
    knob.position.set(KX, KY, KZ + 0.07);
    const kbody = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.13, 32), new THREE.MeshStandardMaterial({ color: 0x1e1e20, roughness: 0.35 }));
    kbody.rotation.x = Math.PI / 2;
    const kgrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.34, 0.09), kbody.material);
    kgrip.position.z = 0.09;
    const kmark = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.02), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    kmark.position.set(0, 0.1, 0.14);
    knob.add(kbody, kgrip, kmark);
    knob.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    stove.add(knob);
    const knobHit = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
    knobHit.position.copy(knob.position);
    stove.add(knobHit);
    function setKnob(heat) { knob.rotation.z = KNOB_RANGE / 2 - (heat / 10) * KNOB_RANGE; }
    setKnob(0);

    // 炎
    const flameN = 28;
    const flameGeo = new THREE.ConeGeometry(0.045, 0.24, 8, 1, true);
    flameGeo.translate(0, 0.12, 0);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x4f8dff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const flames = new THREE.InstancedMesh(flameGeo, flameMat, flameN);
    flames.frustumCulled = false;
    const tipMat = flameMat.clone(); tipMat.color.set(0xffa040); tipMat.opacity = 0.5;
    const tips = new THREE.InstancedMesh(flameGeo, tipMat, flameN);
    tips.frustumCulled = false;
    stove.add(flames); stove.add(tips);
    const heatLight = new THREE.PointLight(0x6aa0ff, 0, 3, 2);
    heatLight.position.set(0, 0.35, 0);
    stove.add(heatLight);
    const dummy = new THREE.Object3D();
    function updateFlames(heat, t) {
      const on = heat > 0.01;
      flames.visible = tips.visible = on;
      heatLight.intensity = on ? 0.6 + heat * 0.25 : 0;
      if (!on) return;
      const k = heat / 10;
      for (let i = 0; i < flameN; i++) {
        const a = (i / flameN) * Math.PI * 2;
        const fl = 0.85 + 0.3 * Math.sin(t * 23 + i * 1.7) * Math.sin(t * 11 + i);
        const len = (0.3 + k * 0.9) * fl;
        dummy.position.set(Math.cos(a) * 0.44, 0.28, Math.sin(a) * 0.44);
        dummy.rotation.set(0, -a, 0);
        dummy.rotateZ(-(0.9 - k * 0.6));
        dummy.scale.set(1 + k * 0.6, len, 1 + k * 0.6);
        dummy.updateMatrix();
        flames.setMatrixAt(i, dummy.matrix);
        dummy.scale.set(1.3 + k * 0.6, len * 1.15, 1.3 + k * 0.6);
        dummy.updateMatrix();
        tips.setMatrixAt(i, dummy.matrix);
      }
      flames.instanceMatrix.needsUpdate = true;
      tips.instanceMatrix.needsUpdate = true;
      tipMat.opacity = 0.1 + k * 0.25;
    }

    // ===== 皿 =====
    const plateGroup = new THREE.Group();
    plateGroup.position.copy(POS.plate);
    scene.add(plateGroup);
    const pts = [
      [0.0, PLATE_TOP], [1.12, PLATE_TOP], [1.34, 0.1], [1.58, 0.18], [1.64, 0.19], [1.66, 0.165], [1.55, 0.11], [1.15, 0.02], [1.0, 0.0], [0.0, 0.0],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const plateMat = new THREE.MeshPhysicalMaterial({ color: 0xf7f5f0, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0, side: THREE.DoubleSide });
    const plate = new THREE.Mesh(new THREE.LatheGeometry(pts.reverse(), 96), plateMat);
    plate.castShadow = plate.receiveShadow = true;
    plateGroup.add(plate);
    const rimLine = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.012, 6, 120), new THREE.MeshStandardMaterial({ color: 0x23407a, roughness: 0.3 }));
    rimLine.rotation.x = Math.PI / 2;
    rimLine.position.y = 0.168;
    plateGroup.add(rimLine);

    // ===== チキンライス（ケチャップが全体に混ざったご飯） =====
    const riceMat = new THREE.MeshStandardMaterial({ map: riceTex(), roughness: 0.82, bumpMap: U.noiseTex(256, 60, 2, 2.2), bumpScale: 0.012 });
    // 型で抜いたような、裾がなだらかで上が丸い山の形（真横が垂直にならない）
    const domeGeo = new THREE.SphereGeometry(1, 64, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    {
      const pa = domeGeo.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i), z = pa.getZ(i);
        pa.setY(i, riceProfile(x * x + z * z));
      }
      domeGeo.computeVertexNormals();
    }
    const dome = new THREE.Mesh(domeGeo, riceMat);
    dome.scale.set(RICE.ra, RICE.h, RICE.rb);
    dome.position.y = PLATE_TOP - 0.005;
    dome.castShadow = dome.receiveShadow = true;
    plateGroup.add(dome);
    const rnd = U.rng(42);
    const grainGeo = new THREE.SphereGeometry(1, 8, 6);
    const grainMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
    const nGrain = quality === 'low' ? 2200 : 4200;
    const grains = new THREE.InstancedMesh(grainGeo, grainMat, nGrain);
    const col = new THREE.Color();
    const nrm = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    function domePoint(r1, r2) {
      const rr = Math.sqrt(r1) * 0.985;
      const th = r2 * Math.PI * 2;
      const x = rr * Math.cos(th), z = rr * Math.sin(th), e = rr * rr;
      const p = new THREE.Vector3(x * RICE.ra, PLATE_TOP + riceProfile(e) * RICE.h, z * RICE.rb);
      const g = riceSlope(e) * RICE.h;
      nrm.set(-g * 2 * x / RICE.ra, 1, -g * 2 * z / RICE.rb).normalize();
      return p;
    }
    for (let i = 0; i < nGrain; i++) {
      const p = domePoint(rnd(), rnd());
      q.setFromUnitVectors(up, nrm);
      q2.setFromAxisAngle(up, rnd() * Math.PI * 2);
      dummy.position.copy(p).addScaledVector(nrm, -0.002);   // 半分ほど埋まっている
      dummy.quaternion.copy(q).multiply(q2);
      dummy.rotateZ(Math.PI / 2 + (rnd() - 0.5) * 0.9);
      dummy.scale.set(0.014, 0.034, 0.015);
      dummy.updateMatrix();
      grains.setMatrixAt(i, dummy.matrix);
      col.setHSL((12 + rnd() * 9) / 360, 0.66 + rnd() * 0.12, 0.42 + rnd() * 0.12).convertSRGBToLinear();
      grains.setColorAt(i, col);
    }
    grains.castShadow = true;
    plateGroup.add(grains);
    function bits(geo, mat, n, scale, colors, sink) {
      const m = new THREE.InstancedMesh(geo, mat, n);
      for (let i = 0; i < n; i++) {
        const p = domePoint(rnd(), rnd());
        dummy.position.copy(p).addScaledVector(nrm, -sink);
        dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        const s = scale * (0.7 + rnd() * 0.6);
        dummy.scale.set(s, s * (0.7 + rnd() * 0.4), s);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
        col.setHex(colors[Math.floor(rnd() * colors.length)]).convertSRGBToLinear();
        m.setColorAt(i, col);
      }
      m.castShadow = true;
      plateGroup.add(m);
      return m;
    }
    // 鶏肉（ケチャップ色に染まっている）・グリンピース
    bits(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 26, 0.06, [0xd9784a, 0xc9683c, 0xe08a58], 0.02);
    bits(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.45 }), 14, 0.026, [0x5c9a2a, 0x6aa832], 0.01);

    function surfaceY(wx, wz) {
      const dx = wx - POS.plate.x, dz = wz - POS.plate.z;
      const r = Math.hypot(dx, dz);
      let y = PLATE_TOP;
      if (r > 1.12) y = PLATE_TOP + U.clamp((r - 1.12) / 0.5, 0, 1) * 0.13;
      if (r > 1.66) y = 0;
      const e = (dx / RICE.ra) ** 2 + (dz / RICE.rb) ** 2;
      if (e < 1) y = Math.max(y, PLATE_TOP + RICE.h * riceProfile(e));
      return y;
    }
    /** 卵やソースを載せる面：ライスの上ではご飯粒の凹凸より上に（貫通しない） */
    function coverY(wx, wz) {
      const dx = wx - POS.plate.x, dz = wz - POS.plate.z;
      const e = Math.sqrt((dx / RICE.ra) ** 2 + (dz / RICE.rb) ** 2);
      return surfaceY(wx, wz) + 0.045 * (1 - U.smooth(1.0, 1.18, e));
    }
    function onRice(wx, wz) {
      const dx = wx - POS.plate.x, dz = wz - POS.plate.z;
      return (dx / RICE.ra) ** 2 + (dz / RICE.rb) ** 2 < 1;
    }
    function onPlate(wx, wz) { return Math.hypot(wx - POS.plate.x, wz - POS.plate.z) < 1.62; }

    // ===== スプーン（盛り付けが終わったら皿の手前に） =====
    const spoon = new THREE.Group();
    {
      const silver = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, metalness: 1, roughness: 0.15 });
      const bowlS = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), silver);
      bowlS.scale.set(0.2, 0.05, 0.14);
      bowlS.rotation.x = Math.PI;
      bowlS.position.set(0.55, 0.05, 0);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.018, 0.07), silver);
      handle.position.set(-0.05, 0.03, 0);
      handle.rotation.z = -0.05;
      const end = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.018, 20), silver);
      end.position.set(-0.5, 0.025, 0);
      spoon.add(bowlS, handle, end);
      spoon.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    }
    spoon.position.set(POS.plate.x + 1.0, 0.012, POS.plate.z + 1.95);
    spoon.rotation.y = 0.2;
    spoon.visible = false;
    scene.add(spoon);

    // ===== レストランのテーブル（撮影用） =====
    const dining = new THREE.Group();
    dining.visible = false;
    scene.add(dining);
    let dTable, dMat, dNap, dBg;   // タイトル画面では、テーブルだけにするために取っておく
    {
      // ふつうのダイニングテーブル（明るい木目）
      const tw = U.woodTex();
      tw.repeat.set(3, 2);
      const table = new THREE.Mesh(new THREE.PlaneGeometry(14, 9), new THREE.MeshStandardMaterial({ map: tw, color: 0xffe2c0, roughness: 0.55 }));
      table.rotation.x = -Math.PI / 2;
      table.position.set(POS.plate.x, 0.004, POS.plate.z - 1.2);
      table.receiveShadow = true;
      dining.add(table);
      dTable = table;
      // 生成りのランチョンマット
      const mat = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.006, 3.3), new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.95 }));
      mat.position.set(POS.plate.x + 0.35, 0.007, POS.plate.z + 0.15);
      mat.receiveShadow = true;
      dining.add(mat);
      dMat = mat;
      // 白いナプキン（スプーンの下）
      const nap = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.01, 1.4), new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.9 }));
      nap.position.set(POS.plate.x + 2.2, 0.014, POS.plate.z + 0.5);
      nap.rotation.y = 0.08;
      nap.receiveShadow = true;
      dining.add(nap);
      dNap = nap;
      // 奥は落ち着いた明るい壁
      const wallTex = U.canvasTex(512, 256, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#d9d2c6'); g.addColorStop(1, '#efe9df');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      });
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(24, 9), new THREE.MeshBasicMaterial({ map: wallTex }));
      bg.position.set(POS.plate.x, 3.6, -3.2);
      dining.add(bg);
      dBg = bg;
    }
    const kitchenOnly = [wall, shelf];
    /** on：レストランのテーブル。titleMode：タイトル画面用（壁もマットもなし。広いテーブルとオムライスだけ） */
    function setDining(on, titleMode) {
      const t = !!(on && titleMode);
      const light = on && !t;     // 明るい背景は撮影用だけ。タイトルは文字が読めるよう暗いまま
      dining.visible = on;
      kitchenOnly.forEach((o) => (o.visible = !on));
      if (dBg) dBg.visible = !t;
      if (dMat) dMat.visible = !t;
      if (dNap) dNap.visible = !t;
      if (dTable) {
        dTable.scale.set(t ? 3 : 1, t ? 3 : 1, 1);          // 回って見ても、テーブルの端が見えないくらい広く
        if (dTable.material.map) dTable.material.map.repeat.set(t ? 9 : 3, t ? 6 : 2);
      }
      scene.fog.color.set(light ? 0xe6dfd4 : 0x1b1511);
      scene.background.set(light ? 0xe6dfd4 : 0x1b1511);
      if (light) { scene.fog.color.convertSRGBToLinear(); scene.background.convertSRGBToLinear(); }
      hemi.intensity = light ? 0.55 : 0.35;
    }

    return {
      scene, sun, POS, PAN_Y, PLATE_TOP, RICE, KNOB_RANGE,
      riceMesh: dome, plateMesh: plate, plateGroup, spoon, dining, stoveGroup: stove, counter,
      updateFlames, surfaceY, coverY, onRice, onPlate, focus, setDining,
      knob, knobHit, setKnob, makeLabel,
    };
  }

  /* ===== カメラ ===== */
  function CameraRig(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0.5, 0);
    this.dist = 7; this.theta = 0; this.phi = 1.0;
    this.goal = { target: this.target.clone(), dist: 7, theta: 0, phi: 1 };
    this.autoRotate = false;
    this.limits = { dmin: 2.2, dmax: 14, pmin: 0.12, pmax: 1.45 };
  }
  CameraRig.prototype.setPreset = function (p, instant) {
    this.goal.target.copy(p.target);
    this.goal.dist = p.dist; this.goal.theta = p.theta; this.goal.phi = p.phi;
    if (instant) {
      this.target.copy(p.target); this.dist = p.dist; this.theta = p.theta; this.phi = p.phi;
    }
  };
  CameraRig.prototype.rotate = function (dx, dy) {
    this.goal.theta -= dx * 0.008;
    this.goal.phi = U.clamp(this.goal.phi - dy * 0.006, this.limits.pmin, this.limits.pmax);
  };
  CameraRig.prototype.zoom = function (f) {
    this.goal.dist = U.clamp(this.goal.dist * f, this.limits.dmin, this.limits.dmax);
  };
  CameraRig.prototype.update = function (dt) {
    if (this.autoRotate) this.goal.theta += dt * 0.25;
    // 遠い場所への移動は速く（離れたエリア間をすばやく移る）
    const far = this.target.distanceTo(this.goal.target) > 3;
    const k = 1 - Math.exp(-dt * (far ? 4 : 6));
    this.target.lerp(this.goal.target, k);
    this.dist = U.lerp(this.dist, this.goal.dist, k);
    this.theta = U.lerp(this.theta, this.goal.theta, k);
    this.phi = U.lerp(this.phi, this.goal.phi, k);
    const sp = Math.sin(this.phi);
    const a = this.camera.aspect || 1.6;
    const d = this.dist * (a < 1.3 ? Math.pow(1.3 / a, 0.8) : 1);
    this.camera.position.set(
      this.target.x + d * sp * Math.sin(this.theta),
      this.target.y + d * Math.cos(this.phi),
      this.target.z + d * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  };

  PK.Kitchen = { build: buildKitchen, CameraRig, POS, PAN_Y, PLATE_TOP, RICE, makeLabel };
})();
