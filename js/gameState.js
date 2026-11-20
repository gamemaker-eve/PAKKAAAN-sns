/* PAKKAAAN! — ゲーム状態と設定 */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});

  const STAGES = ['title', 'prep', 'cook', 'plate', 'knife', 'finish', 'result'];
  const STAGE_LABEL = { prep: '準備', cook: '焼く', plate: '盛る', knife: '切る', finish: '仕上げ', result: '完成' };

  const DEFAULT_SETTINGS = { volume: 0.7, sound: true, quality: 'auto', sensitivity: 1, hints: true, clap: 'hall', shutter: 'game', voice: true };
  const KEY = 'pakkaaan-settings-v1';

  const S = {
    STAGES, STAGE_LABEL,
    stage: 'title',
    settings: Object.assign({}, DEFAULT_SETTINGS),
    run: null,
  };

  S.loadSettings = function () {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(S.settings, JSON.parse(raw));
    } catch (e) { /* 保存できない環境でも動かす */ }
  };
  S.saveSettings = function () {
    try { localStorage.setItem(KEY, JSON.stringify(S.settings)); } catch (e) { /* 無視 */ }
  };

  /**
   * 1回分の料理の記録。各工程がここに実測値を書き込み、scoring.js が読む。
   * prevPrep を渡すと、前回の卵の量・バターなどの設定を引き継ぐ。
   */
  S.newRun = function (prevPrep) {
    S.run = {
      prep: {
        eggs: 0,            // フライパンに使う量（個分）
        use: null,          // 使う量のスライダー（null=全部）
        inBowl: 0, cracked: 0, lost: 0, crushed: 0, shells: 0,
        butter: prevPrep ? prevPrep.butter : 10,
        mixEnergy: 0, uniformity: 0, foam: 0, strokes: 0,
      },
      cook: {
        heatTime: 0, cookTime: 0, spill: 0, tears: 0, shakes: 0, hardShakes: 0,
        scramble: 0, rollTaps: 0, failedRolls: 0, stickEvents: 0, maxTemp: 20,
        butterBurn: 0, overflowWarned: false, butterCover: 0, lifted: 0,
      },
      omelette: null,  // 巻いた後の卵（体積・中の液体率・皮の固さ・焼き色・形状の質）
      plate: { landed: false, offset: 0, yawErr: 0, coverage: 0, impact: 0, squash: 0, broken: false, nudge: 0, onRice: 1 },
      cut: null,       // ナイフ判定結果
      sauce: { byType: {}, onEgg: 0, onRice: 0, onPlate: 0, strokes: 0, patterns: [], smoothness: 0, total: 0, customColor: false },
      toppings: { counts: {}, onEgg: 0, onPlate: 0, sides: 0, sidesOff: 0, fell: 0 },
      score: null,
    };
    return S.run;
  };

  PK.State = S;
})();
