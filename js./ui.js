/* PAKKAAAN! — UI（工程ごとの操作パネル、HUD、通知、結果、写真） */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;
  const $ = (id) => document.getElementById(id);

  const UI = { G: null, tickT: 0 };

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pct = (v) => `${Math.round(U.clamp(v, 0, 1) * 100)}%`;
  const heatName = (h) => (h <= 0.05 ? '消火' : h < 3.5 ? '弱火' : h < 6.2 ? '中火' : h < 8.8 ? '強火' : '最大火力');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  UI.init = function (G) {
    UI.G = G;
    $('startBtn').onclick = () => G.start();
    $('howBtn').onclick = () => UI.modal('howto', true);
    $('helpBtn').onclick = () => UI.modal('howto', true);
    $('titleSetBtn').onclick = () => UI.openSettings();
    $('setBtn').onclick = () => UI.openSettings();
    $('homeBtn').onclick = () => G.toTitle();
    document.querySelectorAll('.closeModal').forEach((b) => (b.onclick = () => { UI.modal('howto', false); UI.modal('settings', false); }));
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m && m.id !== 'error') m.hidden = true; }));
    $('camBtn').onclick = () => {
      G.camMode = !G.camMode;
      $('camBtn').setAttribute('aria-pressed', String(G.camMode));
    };
    $('panelGrip').onclick = () => $('panel').classList.toggle('collapsed');
    $('homeBtn').textContent = 'タイトルへ戻る';
    $('viewBtn').onclick = () => G.toggleView();
    $('aPour').onclick = () => { G.audio.init(); G.pourEgg(); };
    $('aSpat').onclick = () => G.pan.spatRest();
    $('aKnock').onclick = () => G.pan.knock();
    {
      const b = $('aTilt');
      const on = (e) => { e.preventDefault(); G.pan.keys.up = true; try { b.setPointerCapture(e.pointerId); } catch (_) {} };
      const off = () => { G.pan.keys.up = false; };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    $('aNext').onclick = () => G.go('plate');
    $('againBtn').onclick = () => G.restart(true);
    $('resetBtn').onclick = () => G.restart(false);
    $('toTitleBtn').onclick = () => G.toTitle();
    $('photoBtn').onclick = () => G.photoMode(true);
    $('photoBack').onclick = () => G.photoMode(false);
    $('shutterBtn').onclick = () => G.takePhoto();
    $('photoClose').onclick = () => UI.modal('photoView', false);
    // Xでシェア：結果はリンクでそのまま投稿画面へ。写真はスマホなら画像つきで共有する
    $('xShareResult').addEventListener('click', () => { $('xShareResult').href = G.shareURL(); });
    // おさいせん：URLが設定されているときだけ出す。押すと小銭が落ちて「チャリン」、応援ページが開く
    const tipMeta = document.querySelector('meta[name="pk:tip"]');
    const tipURL = tipMeta && /^https:\/\//.test(tipMeta.content.trim()) ? tipMeta.content.trim() : '';
    if (tipURL) {
      $('tipBox').hidden = false;
      $('tipBtn').href = tipURL;
      $('tipBtn').addEventListener('click', () => {
        G.audio.init(); G.audio.play('coin');
        const box = $('tipBox').querySelector('.tip-coins');
        for (let i = 0; i < 3; i++) {
          const c = document.createElement('i');
          c.className = 'tip-coin';
          c.style.left = `calc(50% + ${(i - 1) * 26 - 11}px)`;
          c.style.animationDelay = `${i * 0.12}s`;
          box.appendChild(c);
          setTimeout(() => c.remove(), 1200);
        }
      });
    }
    $('xSharePhoto').addEventListener('click', async (e) => {
      const a = $('xSharePhoto');
      a.href = G.shareURL();
      const file = G.photoBlob ? new File([G.photoBlob], 'omurice.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] }) && window.matchMedia('(pointer: coarse)').matches) {
        e.preventDefault();
        try { await navigator.share({ files: [file], text: G.shareText() + '\n' + G.gameURL() }); }
        catch (err) { if (err && err.name !== 'AbortError') window.open(a.href, '_blank', 'noopener'); }
        return;
      }
      UI.toast('写真は「画像を保存」してから、投稿にそえてね', 'info');
    });
    const syncTitle = () => {
      const a = $('phAuthor').value.trim(), t = $('phTitle').value.trim();
      if (G.drawOverlay) G.drawOverlay();
      try { localStorage.setItem('pakkaaan-author', a); } catch (e) { /* 保存できなくても続行 */ }
    };
    $('phAuthor').oninput = syncTitle;
    $('phTitle').oninput = syncTitle;
    // 入力して「完了」を押したらキーボードを閉じる
    ['phAuthor', 'phTitle'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }));
    try { $('phAuthor').value = localStorage.getItem('pakkaaan-author') || ''; } catch (e) { /* 無視 */ }
    syncTitle();
    // 設定
    const S = PK.State.settings;
    $('optSound').onchange = (e) => { S.sound = e.target.checked; G.applySettings(); };
    $('optVol').oninput = (e) => { S.volume = Number(e.target.value); G.applySettings(); };
    $('optQuality').onchange = (e) => { S.quality = e.target.value; G.applySettings(true); };
    $('optSens').oninput = (e) => { S.sensitivity = Number(e.target.value); G.applySettings(); };
    $('optHints').onchange = (e) => { S.hints = e.target.checked; G.applySettings(); UI.hint(UI.lastHint); };
    const A = PK.Audio;
    $('optClap').innerHTML = A.CHOICES.clap.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('optShutter').innerHTML = A.CHOICES.shutter.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('optClap').onchange = (e) => { S.clap = e.target.value; G.applySettings(); A.preview('clap', S.clap); };
    $('optShutter').onchange = (e) => { S.shutter = e.target.value; G.applySettings(); A.preview('shutter', S.shutter); };
    $('prevClap').onclick = () => A.preview('clap', $('optClap').value);
    $('prevShutter').onclick = () => A.preview('shutter', $('optShutter').value);
    $('optVoice').onchange = (e) => { S.voice = e.target.checked; G.applySettings(); };
    $('prevVoice').onclick = (e) => { e.preventDefault(); A.init(); const v = A.voiceOn; A.voiceOn = true; A.preview('react', 'aa'); A.voiceOn = v; setTimeout(() => { const w = A.voiceOn; A.voiceOn = true; A.say('おしい！'); A.voiceOn = w; }, 300); };
  };

  UI.openSettings = function () {
    const S = PK.State.settings;
    $('optSound').checked = S.sound;
    $('optVol').value = S.volume;
    $('optQuality').value = S.quality;
    $('optSens').value = S.sensitivity;
    $('optHints').checked = S.hints;
    $('optClap').value = S.clap || 'hall';
    $('optShutter').value = S.shutter || 'game';
    $('optVoice').checked = S.voice !== false;
    UI.modal('settings', true);
  };
  UI.modal = function (id, show) { $(id).hidden = !show; };

  UI.toast = function (text, kind) {
    // 同じ知らせが続けて重ならないように
    const now = performance.now();
    if (UI._lastToast === text && now - UI._lastToastT < 2500) return;
    UI._lastToast = text; UI._lastToastT = now;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.classList.add('out'), 3400);
    setTimeout(() => el.remove(), 3900);
  };
  UI.big = function (text, soft) {
    const el = $('bigText');
    el.textContent = text;
    el.classList.remove('show', 'soft');
    void el.offsetWidth;
    el.classList.add('show');
    if (soft) el.classList.add('soft');
    clearTimeout(UI._bigT);
    UI._bigT = setTimeout(() => el.classList.remove('show'), 2300);
  };
  UI.hint = function (html) {
    UI.lastHint = html;
    const el = $('hint');
    el.hidden = !html || !PK.State.settings.hints || UI.G.photo;
    if (html && el.innerHTML !== html) el.innerHTML = html;
  };

  /** 手順を楕円の枠と▼でつないで表示（いまの手順を強調） */
  UI.flow = function (steps, cur) {
    return '<ol class="flow">' + steps.map((t, i) =>
      `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}">${t}</li>${i < steps.length - 1 ? '<li class="arrow" aria-hidden="true">▼</li>' : ''}`).join('') + '</ol>';
  };
  UI.setFlow = function (id, steps, cur) {
    const el = $(id);
    if (!el || el.dataset.cur === String(cur)) return;
    el.dataset.cur = String(cur);
    el.innerHTML = UI.flow(steps, cur);
  };
  const PREP_FLOW = ['卵を長押しで持つ', '縁や机でコンコン', 'ボウルの上で離して ぱかっ', 'ドラッグで溶く', 'フライパンへ'];
  const COOK_FLOW = ['つまみを回して火をつける', 'バターを皿から運んで入れる', 'バターを広げる', '卵液を流す', 'へらで混ぜる', 'トントンで巻く', '皿に移す'];

  UI.steps = function (stage) {
    const order = ['prep', 'cook', 'plate', 'knife', 'finish', 'result'];
    const i = order.indexOf(stage);
    $('steps').innerHTML = order.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'now' : ''}">${PK.State.STAGE_LABEL[s]}</li>`).join('');
  };

  UI.showGame = function (on) {
    $('hud').hidden = !on;
    $('panel').hidden = !on;
    $('title').hidden = on;
    if (!on) { $('hint').hidden = true; $('viewBtn').hidden = true; $('actBar').hidden = true; document.body.classList.remove('view-on'); if ($('fabNext')) $('fabNext').hidden = true; }
  };

  // ------------------------------------------------------------
  UI.stage = function (stage) {
    const G = UI.G;
    UI.steps(stage);
    // 下のパネルは、最初は開いた状態。横長の「↕」バーを押すと畳める（畳むと、画面の下に約3cmだけ残る）
    $('panel').classList.remove('collapsed');
    $('result').hidden = stage !== 'result';
    $('panel').hidden = stage === 'result' || stage === 'title';
    const body = $('panelBody');
    body.scrollTop = 0;
    $('viewBtn').hidden = stage !== 'cook' && stage !== 'finish';
    $('actBar').hidden = stage !== 'cook' && stage !== 'finish';
    if (stage === 'finish') { ['aPour', 'aSpat', 'aKnock', 'aTilt', 'aNext'].forEach((id) => ($(id).hidden = true)); G.finishView = 'front'; }
    UI.syncViewBtn();
    document.body.classList.toggle('view-on', stage === 'cook' || stage === 'finish');
    if (stage === 'prep') {
      const pr = G.run.prep;
      body.innerHTML = `
        <h2 class="p-title">準備：卵を割る・溶く</h2>
        <div id="prepFlow"></div>
        <div class="p-sec">
          <div class="p-label">力加減 <span id="knockWhere" class="readout"></span></div>
          <div class="knock-meter" aria-hidden="true"><i class="z-ok" id="kmOk"></i><i class="z-bad" id="kmBad"></i><b id="kmNeedle"></b></div>
          <div class="knock-legend"><span>弱い</span><span>ちょうどいい</span><span>強すぎ</span></div>
          <div class="small" id="knockMsg">まだ割っていない</div>
        </div>
        <div class="p-sec">
          <div class="p-label">ボウルの中</div>
          <div class="p-row"><span class="big-num" id="eggNum">0<small>個分</small></span><span class="grow"></span><span class="small" id="eggMlNow">0 ml</span></div>
          <div class="small" id="crackStats"></div>
        </div>
        <div class="p-sec">
          <div class="p-label">溶き卵</div>
          <div class="meters">
            <div class="meter"><span class="small">均一さ <b class="readout" id="uniV">0%</b></span><div class="bar"><i id="uniBar"></i></div></div>
            <div class="meter"><span class="small">泡立ち <b class="readout" id="foamV">0%</b></span><div class="bar"><i id="foamBar" style="background:#fff0bf"></i></div></div>
          </div>
        </div>
        <div class="p-sec" id="prepButter">
          <div class="p-label">フライパンで使うバター</div>
          <div class="p-row"><span class="big-num" id="butterNum"></span></div>
          <input type="range" id="butterRange" min="0" max="30" step="1" aria-label="バターの量（g）">
        </div>
        <div class="p-next"><button class="btn primary" id="nextBtn">フライパンへ</button></div>`;
      $('butterRange').value = pr.butter;
      const setB = (v) => { G.prep.setButter(v); $('butterNum').innerHTML = `${v}<small>g</small>`; };
      $('butterRange').oninput = (e) => setB(Number(e.target.value));
      setB(pr.butter);
      $('nextBtn').onclick = () => G.go('cook');
      UI.hint('卵パックの卵を<b>長押し</b>して持ち上げよう');
    }

    if (stage === 'cook') {
      body.innerHTML = `
        <h2 class="p-title">焼く</h2>
        <div id="cookFlow"></div>
        <div class="p-sec">
          <div class="p-row">
            <div><div class="p-label">鍋肌の温度</div><span class="big-num" id="tempV"></span></div>
            <span class="grow"></span>
            <div style="text-align:right"><div class="p-label">加熱時間</div><span class="readout" id="timeV">0:00</span><div class="small">卵を入れてから <b class="readout" id="cookV">-</b></div></div>
          </div>
          <div class="bar"><i id="tempBar"></i></div>
          <div class="p-label">火加減　<b class="readout" id="heatV"></b></div>
          <input type="range" id="heatRange" min="0" max="10" step="0.1" aria-label="火力">
        </div>
        <div class="p-sec">
          <div class="meters">
            <div class="meter"><span class="small">バターの広がり <b class="readout" id="bCovV">-</b></span><div class="bar"><i id="bCovBar" style="background:#ffd15c"></i></div></div>
            <div class="meter"><span class="small">へらで混ぜた範囲 <b class="readout" id="stirV">-</b></span><div class="bar"><i id="stirBar" style="background:#cfe0ff"></i></div></div>
          </div>
          <div class="small" id="stickV"></div>
        </div>
        <div class="p-sec" id="cookEgg">
          <div class="p-label">卵の状態</div>
          <div><span class="state-chip" id="stateChip">まだ卵がない</span></div>
          <div class="meters">
            <div class="meter"><span class="small">とろとろ <b class="readout" id="liqV">-</b></span><div class="bar"><i id="liqBar" style="background:#ffb21a"></i></div></div>
            <div class="meter"><span class="small">固まり <b class="readout" id="setV">-</b></span><div class="bar"><i id="setBar" style="background:#fbe6a6"></i></div></div>
            <div class="meter"><span class="small">焼き色 <b class="readout" id="brV">-</b></span><div class="bar"><i id="brBar" style="background:#b8742e"></i></div></div>
            <div class="meter"><span class="small">巻き <b class="readout" id="rollV">-</b></span><div class="bar"><i id="rollBar" style="background:var(--good)"></i></div></div>
          </div>
        </div>
        <div class="p-sec">
          <div class="p-btns" style="grid-template-columns:1fr 1fr">
            <button class="btn" id="knockBtn">トントン<br><small>奥へ巻く</small></button>
            <button class="btn" id="tiltFwdBtn">奥へ傾ける<br><small>押している間</small></button>
            <button class="btn" id="shakeBtn">振る</button>
          </div>
          <div class="keyhelp">へら：机のへらをタップ→もう一度タップで持つ。フライパンの中をドラッグして混ぜる・寄せる<br>
          柄をドラッグ：フライパンを自由に動かす（火から離すと温度が下がる）<br>フライパンの外をドラッグ：傾ける　素早くスワイプ：振る<br><kbd>WASD</kbd> 傾ける <kbd>Space</kbd> トントン <kbd>F</kbd> 振る <kbd>R</kbd> へら <kbd>V</kbd> 視点</div>
        </div>
        <div class="p-next"><button class="btn primary" id="nextBtn" disabled>皿に移す</button></div>`;
      const pan = G.pan;
      $('heatRange').value = pan.heat;
      $('heatRange').oninput = (e) => { G.audio.init(); pan.setHeat(Number(e.target.value)); };
      const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture(e.pointerId); on(); el.classList.add('on'); });
        const end = () => { off(); el.classList.remove('on'); };
        el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
      };
      hold($('tiltFwdBtn'), () => (pan.keys.up = true), () => (pan.keys.up = false));
      $('knockBtn').onclick = () => pan.knock();
      $('shakeBtn').onclick = () => pan.shake(0, -1, 1.0);
      $('nextBtn').onclick = () => G.go('plate');
      UI.syncViewBtn();
    }

    if (stage === 'plate') {
      body.innerHTML = `
        <h2 class="p-title">盛る</h2>
        <div class="p-sec">
          <div class="small" id="plPhase"></div>
          <div class="btn-row">
            <button class="btn primary" id="plConfirm">ここで傾ける →</button>
            <button class="btn" id="plBack" hidden>← 位置を決め直す</button>
          </div>
          <div class="p-label">フライパンの傾き <b class="readout" id="tiltV">0°</b></div>
          <input type="range" id="tiltRange" min="0" max="80" step="1" value="0" aria-label="フライパンの傾き">
          <div class="p-label">向き <b class="readout" id="yawV">0°</b></div>
          <input type="range" id="yawRange" min="-45" max="45" step="1" value="0" aria-label="向き">
          <div class="keyhelp"><kbd>A</kbd><kbd>D</kbd> 左右　<kbd>W</kbd><kbd>S</kbd> 奥・手前　<kbd>Q</kbd><kbd>E</kbd> 向き</div>
        </div>
        <div class="p-sec">
          <div class="p-label">ライスとの位置関係</div>
          <div class="stats-grid">
            <span>中心からのずれ</span><b id="offV">-</b>
            <span>向きのずれ</span><b id="yawErrV">-</b>
            <span>ライスを覆う長さ</span><b id="covV">-</b>
            <span>着地</span><b id="impV">-</b>
          </div>
        </div>
        <div class="p-next"><button class="btn primary" id="nextBtn" disabled>ナイフへ</button></div>`;
      $('tiltRange').addEventListener('pointerdown', () => (UI.tiltActive = true));
      $('tiltRange').addEventListener('pointerup', () => (UI.tiltActive = false));
      $('tiltRange').oninput = (e) => G.plating.setTilt(Number(e.target.value));
      $('yawRange').oninput = (e) => G.plating.rotate(Number(e.target.value));
      $('nextBtn').onclick = () => G.go('knife');
      $('plConfirm').onclick = () => G.plating.confirm();
      $('plBack').onclick = () => G.plating.backToAim();
      UI.hint('① フライパンを<b>ドラッグして</b>、黄色い丸（卵が落ちる場所）をライスに合わせる → <b>ここで傾ける</b>');
    }

    if (stage === 'knife') {
      const egg = G.run.omelette;
      const SP = PK.KnifeController.SPEED, MAX = SP.max;
      body.innerHTML = `
        <h2 class="p-title">切る</h2>
        <div class="p-sec">
          <div class="p-label">刃を動かす速さ <b class="readout" id="kspV">-</b></div>
          <div class="speed-meter" aria-hidden="true">
            <i class="z-ok" style="left:0;width:${(SP.hi / MAX) * 100}%"></i>
            <i class="z-fast" style="left:${(SP.hi / MAX) * 100}%;width:${((SP.through - SP.hi) / MAX) * 100}%"></i>
            <i class="z-through" style="left:${(SP.through / MAX) * 100}%;width:${((SP.skid - SP.through) / MAX) * 100}%"></i>
            <i class="z-slow" style="left:${(SP.skid / MAX) * 100}%;width:${((MAX - SP.skid) / MAX) * 100}%"></i>
            <b id="kspNeedle"></b>
          </div>
          <div class="knock-legend"><span>ていねい〜ちょうどいい</span><span>速い</span><span>底まで</span><span>速すぎ</span></div>
          <div class="small">端から端へ。ゆっくりなら失敗しない。速いほど深く切れて、速すぎると刃が滑る</div>
          <div class="p-label">刃の傾き <b class="readout" id="ktiltV"></b></div>
          <input type="range" id="ktiltRange" min="0" max="60" step="1" aria-label="刃の傾き">
        </div>
        <div class="p-sec">
          <div class="p-label">切る前の卵</div>
          <div class="stats-grid">
            <span>中のとろとろ</span><b>${pct(egg.lf)}</b>
            <span>外側の固さ</span><b>${pct(egg.fs)}</b>
            <span>焼き色</span><b>${pct(egg.br)}</b>
            <span>太さ</span><b>${(egg.H * 10).toFixed(1)} cm</b>
          </div>
          <div class="small">${PK.Egg.doneLabel(egg.lf * 1.1, egg.fs, egg.br).text}</div>
        </div>
        <div id="cutRes"></div>
        <div class="p-next"><button class="btn primary" id="nextBtn" disabled>仕上げへ</button></div>`;
      const k = G.knife;
      const setT = (v) => { k.tiltDeg = v; $('ktiltRange').value = v; $('ktiltV').textContent = `${v}°`; };
      $('ktiltRange').oninput = (e) => setT(Number(e.target.value));
      setT(k.tiltDeg);
      $('nextBtn').onclick = () => G.go('finish');
      UI.hint('オムレツの<b>端</b>に刃を当てて、反対の端まで<b>スッと</b>動かす');
    }

    if (stage === 'finish') {
      body.innerHTML = `
        <h2 class="p-title">仕上げ</h2>
        <div class="small">皿の奥に並んだソースとトッピングの容器を<b>タップして選ぶ</b>。選んだら料理の上で使う</div>
        <div class="p-sec">
          <div class="p-label">手に持っているもの</div>
          <div class="holding" id="holding">なし</div>
          <div class="small" id="toolHelp"></div>
          <div class="p-btns"><button class="btn" id="undoBtn">元に戻す</button><button class="btn" id="putBtn">置く</button></div>
        </div>
        <div class="p-sec">
          <div class="stats-grid"><span>ソースの量</span><b id="sTotal">0</b><span>卵の上</span><b id="sEgg">-</b><span>付け合わせ</span><b id="sSides">0</b><span>トッピング</span><b id="sTop">0</b></div>
        </div>
        <div class="p-next"><button class="btn primary" id="nextBtn">完成！</button></div>`;
      $('undoBtn').onclick = () => G.sauce.undo();
      $('putBtn').onclick = () => G.sauce.putAway();
      $('nextBtn').onclick = () => G.go('result');
      UI.lastTool = null;
      UI.hint('皿の奥に並んだ<b>容器をタップ</b>して選ぼう');
    }
    UI.tick(1);
  };

  UI.syncViewBtn = function () {
    const G = UI.G;
    const fin = PK.State && PK.State.stage === 'finish';
    $('viewBtn').classList.toggle('primary', !!fin);
    if (fin) $('viewBtn').textContent = G.finishView === 'top' ? '👀 視点：斜めから見る' : '👀 視点：真上から見る';
    else $('viewBtn').textContent = G.cookView === 'stove' ? 'フライパン目線' : 'コンロ目線';
  };

  /** スマホ・タブレット縦：パネルの「次へ」ボタンを右上にも出す（下のシートを開かなくても押せる） */
  /** スマホ：上のメニュー → ボタン列 → ヒント → メッセージ を、重ならないよう上から順に積む（3D画面の真ん中は空けておく） */
  UI.layoutTop = function () {
    const bar = $('actBar'), hint = $('hint'), toasts = $('toasts'), hud = $('hud'), fab = $('fabNext');
    const sheet = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1180px)').matches;
    if (!sheet) { [bar, hint, toasts, fab].forEach((el) => { el.style.top = ''; el.style.bottom = ''; }); return; }
    let y = hud.hidden ? 8 : hud.getBoundingClientRect().bottom + 6;
    if (!bar.hidden) { bar.style.top = y + 'px'; bar.style.bottom = 'auto'; y = bar.getBoundingClientRect().bottom + 6; }
    if (!hint.hidden) { hint.style.top = y + 'px'; hint.style.bottom = 'auto'; y = hint.getBoundingClientRect().bottom + 6; }
    if (!fab.hidden) { fab.style.top = y + 'px'; y = fab.getBoundingClientRect().bottom + 6; }
    toasts.style.top = y + 'px'; toasts.style.bottom = 'auto';
  };

  UI.syncFab = function () {
    const fab = $('fabNext');
    if (!fab) return;
    const sheet = window.matchMedia('(max-width: 760px), (orientation: portrait) and (max-width: 1180px)').matches;
    const st = PK.State && PK.State.stage;
    // パネルを畳んでいても（見えていなくても）、パネルの中のボタンの状態を使う
    const src = $('panel').hidden ? null : ['plConfirm', 'nextBtn'].map((id) => document.getElementById(id)).find((b) => b && !b.hidden);
    // タイトル画面・遊び方/設定を開いている間は出さない（タイトルでは毎フレームの更新が止まるので、ここで確実に消す）
    const titleOn = !$('title').hidden;
    const modalOn = !!document.querySelector('.modal:not([hidden])');
    // 調理中、パソコンは上のボタン列（actBar）に「皿に移す」があるので右上のボタンは出さない。スマホはボタン列の「皿に移す」を消して、右上のこちらに一本化する
    const show = !!src && !titleOn && !modalOn && st !== 'title' && st !== 'result' && (st !== 'cook' || sheet) && !UI.G.photo;
    fab.hidden = !show;
    if (!show) return;
    const label = src.textContent.trim();
    if (fab.textContent !== label) fab.textContent = label;
    fab.disabled = src.disabled;
    fab.onclick = () => src.click();
  };

  /** 毎フレームの数値更新（間引き） */
  UI.tick = function (dt) {
    UI.syncFab();
    UI.tickT += dt;
    if (UI.tickT < 0.1) return;
    UI.tickT = 0;
    const G = UI.G, st = PK.State.stage;
    [G.pan, G.prep].forEach((src) => { if (src && src.messages.length) src.messages.splice(0).forEach((m) => UI.toast(m.text, m.kind)); });
    if (st === 'prep' && $('eggNum')) {
      const pr = G.run.prep, p = G.prep;
      $('eggNum').innerHTML = `${(Math.round(p.eggs * 10) / 10)}<small>個分</small>`;
      $('eggMlNow').textContent = `${Math.round(p.eggs * 50)} ml`;
      const lostTxt = pr.lost > 0.05 ? `／こぼした ${Math.round(pr.lost * 10) / 10}個分` : '';
      $('crackStats').textContent = `割った卵 ${pr.cracked}個${lostTxt}／残り ${p.eggsLeft()}個${pr.shells ? `／殻 ${pr.shells}つ（タップで取る）` : ''}`;
      $('uniV').textContent = pct(pr.uniformity); $('uniBar').style.width = pct(pr.uniformity);
      $('foamV').textContent = pct(pr.foam); $('foamBar').style.width = pct(pr.foam);
      const kn = p.lastKnock;
      if (kn) {
        const MAX = kn.hi * 1.3;
        $('kmOk').style.left = `${(kn.lo / MAX) * 100}%`; $('kmOk').style.width = `${((kn.hi - kn.lo) / MAX) * 100}%`;
        $('kmBad').style.left = `${(kn.hi / MAX) * 100}%`; $('kmBad').style.width = `${(1 - kn.hi / MAX) * 100}%`;
        $('kmNeedle').style.left = `${U.clamp(kn.v / MAX, 0, 1) * 100}%`;
        $('knockWhere').textContent = kn.name;
        $('knockMsg').textContent = { weak: '弱い。もう一度コンコン', more: 'ちょうどいい。ヒビが少し入った、もう1回', crack: 'ヒビが入った！', crush: '強すぎ！ つぶれた', tap: 'ヒビは入っている。ボウルの上で指を離して「ぱかっ」' }[kn.result] || '';
      }
      $('nextBtn').disabled = p.eggs < 0.5 || p.busy();
      const step = p.mode === 'hold' ? (p.h && p.h.cracked ? 2 : 1) : p.eggs < 0.5 ? 0 : pr.uniformity < 0.6 ? 3 : 4;
      UI.setFlow('prepFlow', PREP_FLOW, step);
      let h;
      if (p.mode === 'hold') h = p.h && p.h.cracked ? 'ボウルの<b>上</b>で<b>指を離す</b>と「ぱかっ」' : 'ボウルの<b>縁</b>や<b>机</b>に上から<b>コンコン</b>（速く当てすぎるとつぶれる）';
      else if (p.mode === 'press') h = 'そのまま押し続けて持ち上げる…';
      else if (p.eggs < 0.5) h = '卵パックの卵を<b>長押し</b>して持ち上げよう';
      else if (pr.shells > 0) h = 'ボウルに入った<b>殻をタップ</b>して取り除こう';
      else if (pr.uniformity < 0.6) h = 'ボウルの中を<b>ドラッグ</b>して溶く。卵を足してもOK';
      else h = 'よく混ざった！ バターの量を決めて<b>フライパンへ</b>';
      UI.hint(h);
    }
    if (st === 'cook' && $('tempV')) {
      const i = G.pan.info(), pan = G.pan, c = G.run.cook;
      $('tempV').innerHTML = `${Math.round(i.T)}<small>°C</small>`;
      $('tempBar').style.width = pct((i.T - 20) / 240);
      $('tempBar').style.background = i.T > 200 ? 'var(--bad)' : i.T > 140 ? 'var(--warn)' : 'var(--yolk)';
      $('timeV').textContent = fmtTime(i.heatTime);
      $('cookV').textContent = i.poured ? fmtTime(i.cookTime) : '-';
      $('heatV').textContent = `${heatName(i.heat)}（${i.heat.toFixed(1)}）${pan.lift > 0.15 ? '　持ち上げ中は火が遠い' : ''}`;
      if (document.activeElement !== $('heatRange')) $('heatRange').value = i.heat;
      if (i.label) { $('stateChip').textContent = i.label.text; $('stateChip').className = 'state-chip l' + i.label.lv; }
      else $('stateChip').textContent = i.poured ? '流し込み中' : 'まだ卵がない';
      const show = (id, v) => { $(id + 'V').textContent = i.poured ? pct(v) : '-'; $(id + 'Bar').style.width = i.poured ? pct(v) : '0'; };
      show('liq', i.liquid); show('set', i.set); show('br', i.brown); show('roll', i.roll);
      const cov = i.butterIn ? pan.butterCoverage() : 0;
      $('bCovV').textContent = i.butterIn ? pct(cov) : '-'; $('bCovBar').style.width = i.butterIn ? pct(cov) : '0';
      const sc = c.stirCover || 0;
      $('stirV').textContent = i.poured ? pct(sc) : '-'; $('stirBar').style.width = i.poured ? pct(sc) : '0';
      $('stickV').textContent = i.butterIn ? `すべり：${i.stick < 0.3 ? 'よく滑る' : i.stick < 0.6 ? 'ふつう' : 'くっつきやすい'}` : '';
      // 画面下の主なボタン：今できることだけ出す
      $('aPour').hidden = i.poured || G.prep.eggs <= 0 || !!G.prep.pourAnim;
      $('aSpat').hidden = pan.spat.state !== 'active';
      $('aKnock').hidden = !i.poured || i.roll >= 0.99 || !!pan.fried;
      $('aTilt').hidden = !i.poured || i.roll >= 0.99 || !!pan.fried;
      $('aNext').hidden = !i.poured || i.pouring || !!G.prep.pourAnim;
      $('knockBtn').disabled = !i.poured;
      $('nextBtn').disabled = !i.poured || i.pouring || !!G.prep.pourAnim;
      // 手順
      let step;
      if (i.heat <= 0.05 && !i.poured) step = 0;
      else if (!i.butterIn && G.run.prep.butter > 0 && !i.poured) step = 1;
      else if (!i.poured && (i.butterMelt < 0.9 || cov < 0.6) && G.run.prep.butter > 0) step = 2;
      else if (!i.poured) step = 3;
      else if (pan.fried) step = i.set < 0.3 ? 4 : 5;
      else if (i.roll < 0.05 && (c.stirCover || 0) < 0.5 && i.set < 0.6) step = 4;
      else if (i.roll < 0.99) step = 5;
      else step = 6;
      // 目玉焼きは混ぜない・巻かない
      if (pan.fried) UI.setFlow('cookFlow', ['つまみを回して火をつける', 'バターを皿から運んで入れる', 'バターを広げる', '卵液（目玉焼き）を流す', '白身が固まるまで焼く', '皿に移す'], step);
      else UI.setFlow('cookFlow', COOK_FLOW, step);
      const sp = pan.spat.state;
      const hs = [
        'コンロの<b>つまみを回して</b>火をつけよう（右へ回すほど強い）',
        '左の皿の<b>バターをつかんで</b>フライパンの上で離す',
        'バターを<b>ドラッグ</b>するか、フライパンを<b>傾けて</b>溶かし広げる',
        i.T < 130 ? 'もう少し鍋を温めてから<b>卵液を流す</b>' : 'バターが泡立ったら<b>卵液を流す</b>',
        sp === 'rest' ? '右手前の<b>へらをタップ</b>（もう一度タップで持つ）' : sp === 'lifted' ? 'もう一度<b>へらをタップ</b>して持つ' : 'フライパンの中を<b>ドラッグ</b>して、へらで混ぜる',
        '<b>奥を下げるように傾け</b>、<b>トントン</b>で巻いていく',
        sp === 'active' ? 'へらで<b>寄せて</b>形を整えたら<b>皿に移す</b>' : '好みの焼き加減で<b>皿に移す</b>。へらで寄せて形を整えてもいい',
      ];
      UI.hint(hs[step]);
    }
    if (st === 'plate' && $('plPhase')) {
      const i = G.plating.info();
      const ph = { move: 'フライパンを皿の上へ運んでいます…', aim: '① 場所を決める：ドラッグでフライパンを動かし、黄色い丸（卵が落ちる場所）をライスの真ん中に合わせる', pour: '② 傾ける：上へドラッグ（またはスライダー）で奥へ傾けると、卵が転がり落ちる', fall: 'すべり落ちる！', raw: '卵液がそのまま流れていく…', landed: '着地！ 皿に乗せたあとは動かせない' }[i.phase];
      if ($('plPhase').textContent !== ph) {
        $('plPhase').textContent = ph;
        if (i.phase === 'pour') UI.hint('② <b>上へドラッグ</b>で奥へ傾けて、卵を転がしてライスへ');
        if (i.phase === 'aim') UI.hint('① フライパンを<b>ドラッグして</b>、黄色い丸（卵が落ちる場所）をライスに合わせる → <b>ここで傾ける</b>');
      }
      $('plConfirm').hidden = i.phase !== 'aim';
      $('plBack').hidden = i.phase !== 'pour';
      $('tiltV').textContent = `${Math.round(i.tilt)}°`;
      if (i.phase === 'pour' && !UI.tiltActive) $('tiltRange').value = Math.round(G.pan.tPitch * 180 / Math.PI);
      $('tiltRange').disabled = i.phase !== 'pour';
      $('yawV').textContent = `${Math.round(i.yaw)}°`;
      if (document.activeElement !== $('yawRange')) $('yawRange').value = Math.round(i.yaw);
      $('yawRange').disabled = i.phase === 'landed' || i.phase === 'fall' || i.phase === 'raw';
      const p = i.plate;
      if (p.landed) {
        $('offV').textContent = p.offset < 0.12 ? 'ほぼ中央' : `${Math.round(p.offset * 100)}%`;
        $('yawErrV').textContent = `${Math.round(p.yawErr)}°`;
        $('covV').textContent = pct(Math.min(1, p.coverage));
        $('impV').textContent = p.broken ? '崩れた' : p.squash > 0.15 ? 'つぶれた' : p.squash > 0.05 ? 'ふるん' : 'しっかり';
        UI.hint(G.run.flat ? '<b>仕上げへ</b> 進もう' : '着地！ <b>ナイフへ</b> 進もう');
      }
      $('nextBtn').disabled = i.phase !== 'landed';
      { const lbl = G.run.flat ? '仕上げへ' : 'ナイフへ'; if ($('nextBtn').textContent !== lbl) $('nextBtn').textContent = lbl; }
    }
    if (st === 'knife' && $('kspNeedle')) {
      const k = G.knife;
      const sp = k.state === 'cutting' ? k.liveSpeed : k.run.cut ? k.run.cut.speed : 0;
      $('kspNeedle').style.left = `${U.clamp(sp / PK.KnifeController.SPEED.max, 0, 1) * 100}%`;
      $('kspV').textContent = sp > 0 ? `${sp.toFixed(2)} 本/秒` : '-';
    }
    if (st === 'finish' && $('sTotal')) {
      const sc = G.run.sauce, tp = G.run.toppings, sa = G.sauce;
      $('sTotal').textContent = sc.total > 0 ? `${Math.round(sc.total * 1000)} ml` : '0';
      $('sEgg').textContent = sc.total > 0 ? pct((sc.onEgg + sc.onRice * 0.5) / sc.total) : '-';
      $('sSides').textContent = `${tp.sides + (tp.sidesOff || 0) + (tp.fell || 0)} 個${tp.fell ? `（${tp.fell}個 皿の外）` : ''}`;
      $('sTop').textContent = `${Math.max(0, (tp.counts.parsley || 0) + (tp.counts.pepper || 0) + (tp.counts.cheese || 0))} 粒`;
      const key = sa.mode ? sa.mode + ':' + (sa.type || sa.topping) : null;
      if (key !== UI.lastTool) {
        UI.lastTool = key;
        $('holding').textContent = sa.selectedName() || 'なし';
        $('putBtn').hidden = !sa.mode;
        if (sa.mode === 'sauce') {
          $('toolHelp').textContent = '押したままなぞると、ボトルからソースが出る（机の上ならどこでも）。元の場所をタップすると戻せる';
          UI.hint('料理の上を<b>押したままなぞって</b>かける');
        } else if (sa.mode === 'topping') {
          $('toolHelp').textContent = PK.TOPPINGS[sa.topping].item ? 'タップした場所に落とす。何個でも置ける（転がるので注意）' : 'タップした場所に散らす';
          UI.hint('置きたい場所を<b>タップ</b>');
        } else {
          $('toolHelp').textContent = '';
          UI.hint('皿の奥に並んだ<b>容器をタップ</b>して選ぼう');
        }
      }
      if (sa.needPick) { sa.needPick = false; UI.toast('先に、奥に並んだ容器をタップして選んでね', 'info'); }
      if (sa.putBack) { sa.putBack = false; UI.toast('元の場所に戻した', 'info'); }
    }
  };

  UI.showCut = function (r) {
    const name = { great: '大成功！', through: '底まで切れた！', good: '成功', close: '惜しい', fail: '失敗' }[r.grade];
    const why = r.why.slice(0, 3);
    $('cutRes').innerHTML = `
      <div class="cut-result">
        <h3 class="grade-${r.grade}">${name}</h3>
        <div class="stats-grid">
          <span>刃の速さ</span><b>${r.speed.toFixed(2)} 本/秒</b>
          <span>切り込みの深さ</span><b>${r.depth >= 1 ? '底まで' : pct(r.depth)}</b>
          <span>切った長さ</span><b>${pct(r.coverage)}</b>
          <span>中心からのずれ</span><b>${Math.round(Math.abs(r.offset) * 100)}%</b>
          <span>左の開き</span><b>${pct(r.avgL)}</b>
          <span>右の開き</span><b>${pct(r.avgR)}</b>
        </div>
        ${why.length ? `<ul>${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<div class="small">完璧な切り口！</div>'}
      </div>`;
    $('nextBtn').disabled = false;
    UI.hint('ソースとトッピングで<b>仕上げ</b>へ');
  };

  UI.showResult = function (res) {
    $('rank').textContent = res.rank;
    $('total').textContent = res.total;
    $('rankTitle').textContent = res.title;
    const qb = $('quips');
    if (qb) { qb.innerHTML = (res.quips || []).map((t) => `<li>${esc(t)}</li>`).join(''); qb.hidden = !(res.quips && res.quips.length); }
    $('kcalTotal').textContent = res.kcal.total.toLocaleString('ja-JP');
    $('kcalParts').textContent = res.kcal.parts.map((p) => `${p.name} ${p.kcal}`).join('／');
    $('scoreList').innerHTML = res.items.map((it) => !it.max ? `<li class="warn-item"><span class="nm">⚠ ${esc(it.name)}</span><span class="nt">${esc(it.note)}</span></li>` : `
      <li><span class="nm">${it.name}</span><span class="pt">${it.pts}<small> / ${it.max}</small></span>
      <div class="bar"><i style="width:${(it.pts / it.max) * 100}%;background:${it.pts / it.max > 0.75 ? 'var(--good)' : it.pts / it.max > 0.45 ? 'var(--yolk)' : 'var(--bad)'}"></i></div>
      <span class="nt">${esc(it.note)}</span></li>`).join('');
    $('result').hidden = false;
    $('panel').hidden = true;
    UI.hint('');
  };

  PK.UI = UI;
})();
