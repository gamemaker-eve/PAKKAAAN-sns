/* PAKKAAAN! — 採点とカロリー：実際に作った料理の状態から計算（乱数は使わない） */
(function () {
  'use strict';
  const PK = (window.PK = window.PK || {});
  const U = PK.U;

  // カロリーの目安
  const KCAL = { egg: 76, butterPerG: 7.5, rice: 430 };

  function calories(run) {
    const pr = run.prep, c = run.cook, sc = run.sauce, tp = run.toppings;
    const parts = [];
    const eggsUsed = Math.max(0, pr.eggs - c.spill / PK.Egg.EGG_V);
    parts.push({ name: `卵 ${Math.round(eggsUsed * 10) / 10}個`, kcal: eggsUsed * KCAL.egg });
    if (run.cook.butterUsed > 0) parts.push({ name: `バター ${run.cook.butterUsed}g`, kcal: run.cook.butterUsed * KCAL.butterPerG });
    parts.push({ name: 'チキンライス', kcal: KCAL.rice });
    for (const k in sc.byType) {
      const ml = sc.byType[k] * 1000;
      parts.push({ name: `${PK.SAUCES[k].name} ${Math.round(ml)}ml`, kcal: ml * PK.SAUCES[k].kcal });
    }
    let top = 0;
    for (const k in tp.counts) top += Math.max(0, tp.counts[k]) * PK.TOPPINGS[k].kcal;
    if (top > 0) parts.push({ name: 'トッピング・付け合わせ', kcal: top });
    parts.forEach((p) => (p.kcal = Math.round(p.kcal)));
    return { total: parts.reduce((s, p) => s + p.kcal, 0), parts };
  }

  function score(run) {
    const egg = run.omelette || { lf: 0, fs: 1, br: 0, quality: 0, tear: 1, uniformity: 0, L: 1, V: 0 };
    const c = run.cook, pl = run.plate, cut = run.cut, sc = run.sauce, tp = run.toppings, pr = run.prep;
    const items = [];
    const add = (key, name, max, ratio, note) => items.push({ key, name, max, pts: Math.round(U.clamp(ratio, 0, 1) * max * 10) / 10, note });

    // 1. 卵の焼き加減
    {
      const inner = U.band(egg.lf, 0.22, 0.52, 0.25);
      const shell = U.band(egg.fs, 0.42, 0.86, 0.35);
      const brown = 1 - U.smooth(0.12, 0.6, egg.br);
      const uni = 0.72 + 0.28 * egg.uniformity;
      const foam = 1 - U.clamp((pr.foam - 0.4) * 0.3, 0, 0.15);
      const shells = 1 - U.clamp(pr.shells * 0.08, 0, 0.4);
      let note;
      if (egg.br > 0.6) note = '焦げてしまった';
      else if (egg.br > 0.3) note = '焼き色が付きすぎ';
      else if (egg.lf > 0.6) note = '中がゆるすぎた';
      else if (egg.lf < 0.12) note = '中まで火が通ってオムレツのよう';
      else if (inner > 0.9 && shell > 0.8) note = '理想のふわとろ';
      else note = 'もう一歩でふわとろ';
      if (egg.uniformity < 0.5) note += '／混ぜむらが見える';
      if (pr.shells > 0) note += `／殻が${pr.shells}つ入っている`;
      // へらでまんべんなく混ぜると火の通りがそろう
      const stir = c.stirCover > 0 ? 0.9 + 0.1 * c.stirCover : 0.9;
      if (c.stirCover > 0.7) note += '／へらでまんべんなく混ぜた';
      else if ((c.stirCover || 0) < 0.3) note += '／混ぜむらで火の通りがばらついた';
      add('doneness', '卵の焼き加減', 20, (0.45 * inner + 0.3 * shell + 0.25 * brown) * uni * foam * shells * stir, note);
    }
    // 2. 卵の形状
    {
      const L = egg.L, riceLen = PK.Kitchen.RICE.ra * 2;
      const lenScore = U.band(L / riceLen, 0.72, 1.08, 0.35);
      const s = egg.quality * (1 - egg.tear * 0.55) * (1 - pl.squash * 0.8) * (pl.broken ? 0.4 : 1);
      let note = s > 0.75 ? 'つややかな木の葉形' : s > 0.5 ? '少し形が乱れた' : 'いびつな形になった';
      if (L / riceLen < 0.65) note += '／卵が少なくライスに対して小さい';
      if (L / riceLen > 1.2) note += '／卵が多くて大きすぎ';
      add('shape', '卵の形状', 15, 0.62 * s + 0.38 * lenScore, note);
    }
    // 3. フライパン操作（卵を割る・バターを広げるところから）
    {
      const spillFrac = c.spill / Math.max(0.01, pr.eggs * PK.Egg.EGG_V);
      const sp = 1 - U.clamp(spillFrac * 3, 0, 1);
      const tear = 1 - U.clamp(c.tears * 0.14, 0, 0.6);
      const roll = c.rollTaps > 0 ? 1 - U.clamp(c.failedRolls * 0.08, 0, 0.4) : 0.55;
      const scr = U.band(c.scramble, 1.2, 9, 9);
      const stick = 1 - U.clamp(c.stickEvents * 0.1, 0, 0.4);
      const burn = 1 - c.butterBurn * 0.4;
      const butter = c.butterCover > 0 ? U.band(c.butterCover, 0.6, 1, 0.6) : 0.4;
      const crack = 1 - U.clamp(pr.lost * 0.12 + pr.crushed * 0.08, 0, 0.5);
      const note = [];
      if (pr.lost > 0.3) note.push('卵を割るときにこぼした');
      if (pr.crushed) note.push(`力を入れすぎて${pr.crushed}個つぶした`);
      if (c.butterCover < 0.6) note.push('バターが鍋全体に広がっていない');
      if (spillFrac > 0.05) note.push('卵液をこぼした');
      if (c.tears) note.push(`卵が${c.tears}回破れた`);
      if (c.rollTaps === 0) note.push('トントンで巻かなかった');
      if (c.scramble < 1) note.push('へらで混ぜるとふわふわに');
      if (c.shaped > 0.5) note.push('へらで形を整えた');
      if (c.scramble > 12) note.push('混ぜすぎてスクランブル気味');
      add('pan', 'フライパン操作', 10,
        (sp * 0.24 + tear * 0.18 + roll * 0.16 + scr * 0.12 + stick * burn * 0.1 + butter * 0.1 + crack * 0.1), note.length ? note.join('／') : '見事な手さばき');
    }
    // 4. 皿に載せる技術
    {
      if (!pl.landed) add('plate', '卵を皿に載せる技術', 10, 0, '皿に載せていない');
      else {
        const off = U.band(pl.offset, 0, 0.14, 0.6);
        const yaw = U.band(pl.yawErr, 0, 8, 35);
        const cov = U.band(pl.coverage, 0.72, 1.1, 0.45);
        const soft = pl.broken ? 0.3 : 1 - U.clamp((pl.impact - 4) * 0.08, 0, 0.4);
        const nud = 1 - U.clamp(pl.nudge * 0.12, 0, 0.35);
        let note = off > 0.8 && yaw > 0.8 ? 'ライスの真ん中にぴったり' : off < 0.5 ? '中心からずれた' : '少しずれた';
        if (pl.yawErr > 15) note += '／向きが斜め';
        if (pl.broken) note = '落とした勢いで崩れた';
        if (pl.missed) note += '／皿の端に落ちた';
        add('plate', '卵を皿に載せる技術', 10, (off * 0.35 + yaw * 0.2 + cov * 0.25 + soft * 0.2) * nud * (pl.missed ? 0.6 : 1), note);
      }
    }
    // 5. ぱっかーーん
    {
      if (!cut && run.sheet) {
        // 巻かずに薄焼き卵で包んだオムライス：ぱっかーんはないが、きれいに包めていれば点になる
        const rv0 = run.riceVisible || 0;
        const f = run.omelette ? run.omelette.fs : (run.pan && run.pan.fs) || 0.6;
        add('pakkaan', '薄焼き卵で包む', 20, U.clamp(1 - rv0 * 1.6, 0, 1) * 0.85 * U.band(f, 0.5, 0.9, 0.4), rv0 < 0.15 ? '昔ながらの、きれいに包んだオムライス' : 'ライスが見えている。包みきれていない');
      } else if (!cut) add('pakkaan', 'ぱっかーーんの成功度', 20, 0, run.raw ? '火を通さずに流してしまった' : run.fried ? '目玉焼きなので、ぱっかーんはなし' : '切っていない');
      else {
        const label = {
          great: '大成功！ 左右に美しく開いた', through: '底まで切れて豪快に開いた',
          good: '成功。左右の開きが少し違う', close: '惜しい。開き方が不均等', fail: '失敗。うまく開かなかった',
        }[cut.grade];
        add('pakkaan', 'ぱっかーーんの成功度', 20, cut.score, label + (cut.why.length ? '（' + cut.why[0] + '）' : ''));
      }
    }
    // 6. ソースの量と配置
    {
      if (sc.total <= 0) add('sauce', 'ソースの量と配置', 10, 0.15, 'ソースなし');
      else {
        let ideal = 0;
        for (const k in sc.byType) ideal += PK.SAUCES[k].ideal * (sc.byType[k] / sc.total);
        ideal *= Math.pow(egg.L / 1.9, 2);
        const amt = U.band(sc.total, ideal * 0.5, ideal * 1.6, ideal * 1.4);
        const ketShare = (sc.byType.ketchup || 0) / sc.total;
        const onEgg = (sc.onEgg + sc.onRice * 0.5) / sc.total;
        const place = ketShare > 0.5 ? U.band(onEgg, 0.7, 1, 0.6) : U.band(onEgg, 0.3, 0.9, 0.5);
        const rim = 1 - U.clamp((sc.onRim / sc.total) * 3, 0, 0.6);
        const smooth = 0.5 + 0.5 * sc.smoothness;
        let note = amt < 0.6 ? (sc.total < ideal ? 'ソースが少なめ' : 'ソースが多すぎ') : 'ちょうどいい量';
        if (rim < 0.8) note += '／皿の縁が汚れた';
        if (place < 0.6) note += '／かける位置がずれた';
        add('sauce', 'ソースの量と配置', 10, amt * 0.45 + place * 0.25 * rim + smooth * 0.3, note);
      }
    }
    // 7. 盛り付け
    {
      const herbs = (tp.counts.parsley || 0) + (tp.counts.pepper || 0) * 0.5 + (tp.counts.cheese || 0);
      const herbScore = herbs === 0 ? 0.5 : U.band(herbs, 15, 110, 120);
      const sideScore = tp.sides === 0 ? 0.55 : U.band(tp.sides, 2, 6, 5) * (1 - U.clamp((tp.sidesOff || 0) * 0.12, 0, 0.5));
      const fell = 1 - U.clamp((tp.fell || 0) * 0.15, 0, 0.6);
      const clean = sc.total > 0 ? 1 - U.clamp((sc.onRim / sc.total) * 2, 0, 0.5) : 1;
      const cover = cut ? U.clamp((cut.avgL + cut.avgR) / 1.4, 0.3, 1) : 0.5;
      let note = sideScore > 0.8 ? '付け合わせで彩りよく' : tp.sides === 0 ? '付け合わせがあるともっと良い' : '付け合わせの置き方に工夫を';
      if (tp.fell) note += '／皿から落ちた付け合わせがある';
      if (herbs > 150) note += '／トッピングが多すぎ';
      add('arrange', '盛り付け', 10, (herbScore * 0.3 + sideScore * 0.3 + clean * 0.2 + cover * 0.2) * fell, note);
    }
    // 8. 独創性
    {
      const types = Object.keys(sc.byType).length;
      const tops = Object.keys(tp.counts).filter((k) => tp.counts[k] > 0).length;
      const v = U.clamp(types * 0.18 + (sc.colors || 0) * 0.08 + tops * 0.1 + (sc.customColor ? 0.15 : 0) + U.clamp(sc.strokes / 6, 0, 1) * 0.2 + (cut && cut.grade === 'through' ? 0.1 : 0), 0, 1);
      const note = v > 0.7 ? '自分らしいひと皿' : v > 0.35 ? '少し個性が出た' : '定番のスタイル';
      add('original', '独創性', 5, v, note);
    }
    let total = Math.round(items.reduce((s, i) => s + i.pts, 0));
    // 殻が入ったまま：食べたらジャリッ
    const shellsIn = (run.prep && run.prep.shells) || 0;
    if (shellsIn > 0) {
      total -= Math.min(25, 10 + shellsIn * 5);
      items.push({ key: 'shell', name: '殻入り', max: 0, pts: 0, note: `殻が ${shellsIn} かけら入ったまま焼いてしまった（−${Math.min(25, 10 + shellsIn * 5)}点）` });
    }
    // 火を通していない卵をそのまま流した
    if (run.raw) {
      total = Math.min(total, 18);
      items.push({ key: 'raw', name: '生のまま', max: 0, pts: 0, note: '卵に火が通っていない。オムライスになっていない' });
    }
    total = Math.max(0, total);
    // 机をよごした分だけ評価を下げる（汚いほど大きく下がる）：卵をこぼした・卵液がフライパンからあふれた・ソースが机に落ちた・付け合わせが机に落ちた
    {
      const spillFrac = (run.cook ? run.cook.spill : 0) / Math.max(0.01, pr.eggs * PK.Egg.EGG_V);
      const tableSauce = sc.total > 0 ? (sc.onRim || 0) / sc.total : 0;
      const mess = U.clamp(
        (pr.lost || 0) * 0.07 + U.clamp(spillFrac, 0, 1) * 0.5 + tableSauce * 0.4 + (tp.fell || 0) * 0.04, 0, 0.8);
      if (mess > 0.03) {
        const before = total;
        total = Math.round(total * (1 - mess));
        items.push({ key: 'mess', name: '机のよごれ', max: 0, pts: 0, note: `机にこぼしすぎ（−${before - total}点）。きれいに作るほど高評価` });
        run.mess = mess;
      }
    }
    // ライスを包めていない（上から見てライスが大きく見えている）なら、どれだけ他が良くても C 以下
    const rv = run.riceVisible || 0;
    if (rv > 0.3) {
      total = Math.min(total, Math.round(59 - (rv - 0.3) * 50));
      items.push({ key: 'cover', name: 'ライスの包み具合', max: 0, pts: 0, note: `ライスが ${Math.round(rv * 100)}% 見えている。卵で包めていないので C 以下` });
    }
    const rank = total >= 88 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 40 ? 'C' : total >= 25 ? 'D' : 'E';
    let title = { S: '伝説のぱっかーーん職人', A: '洋食屋の看板メニュー', B: '家族に自慢できる一皿', C: 'おいしい、けど伸びしろあり', D: 'まずはもう一回！', E: 'これはオムライス…なのか？' }[rank];
    if (run.raw) title = '卵かけケチャップライス';
    else if (shellsIn > 0) title = '殻入りオムライス';
    else if (run.fried && rank !== 'S' && rank !== 'A') title = '目玉焼きのせライス';
    else if (run.sheet && rank !== 'D' && rank !== 'E') title = '昔ながらの包むオムライス';
    const kcal = calories(run);
    return { items, total, rank, title, kcal, quips: quips(run, rank, kcal, items) };
  }

  /** 点数の下に出す、ひとことツッコミ（多すぎ・少なすぎ・ランクなど） */
  function quips(run, rank, kcal, items) {
    const tp = run.toppings || { counts: {} }, c = tp.counts || {}, sc = run.sauce || {}, cut = run.cut;
    const pt = (k) => { const it = (items || []).find((i) => i.key === k); return it ? it.pts / it.max : 0; };
    const praise = [], tease = [];
    // まずはオムライスそのものをほめる（このゲームの主役）
    if (cut && (cut.grade === 'great' || cut.grade === 'through')) praise.push(cut.grade === 'through' ? 'どぱっかーーん！断面がとろとろで最高👏' : 'ぱっかーんが完璧！とろける断面に拍手👏');
    else if (cut && cut.grade === 'good') praise.push('きれいにぱっかーん！いい開き方');
    if (pt('doneness') >= 0.8) praise.push('卵の焼き加減がプロ級！ふわっふわ');
    else if (pt('doneness') >= 0.6) praise.push('ちょうどいい半熟具合でおいしそう');
    if (pt('shape') >= 0.75) praise.push('つやつやでふっくらした、きれいな形');
    if (pt('plate') >= 0.8) praise.push('ライスの真ん中にぴったり着地');
    if (rank === 'S') praise.unshift('店出せるレベル。弟子にしてください');
    if (rank === 'A') praise.unshift('洋食屋さんで出てきそうな一皿！');
    if (run.sheet && (rank === 'S' || rank === 'A' || rank === 'B')) praise.unshift('薄焼き卵でしっかり包んだ、昔ながらのオムライス！');
    if (rank === 'B' && !praise.length) praise.push('ちゃんとおいしそう！次は A を狙える');
    // ツッコミは「お皿からあふれるくらい」の明らかにやりすぎな時だけ
    const add = (cond, t) => { if (cond) tease.push(t); };
    add((c.carrot || 0) >= 45, 'ニンジン農家かよ！ww');
    add((c.broccoli || 0) >= 30, 'ブロッコリー多すぎて森www');
    add((c.tomato || 0) >= 35, 'ミニトマト祭り開催中？w');
    add((c.potato || 0) >= 90, 'お皿がポテトで埋まってる…もはやポテトが主役ww');
    add((c.parsley || 0) >= 600, 'パセリの吹雪…前が見えない');
    add((c.pepper || 0) >= 900, 'こしょう、くしゃみ止まらんやつ');
    add((c.cheese || 0) >= 600, 'チーズの雪原ww');
    add((tp.fell || 0) >= 10, '付け合わせ、皿から大脱走中w');
    add(sc.total > 0.12, 'ソースの海で泳いでる？ww');
    add(sc.total > 0.02 && sc.onRim / sc.total > 0.6, '机にもケチャップ食べさせてる？w');
    add(kcal && kcal.total > 2500, 'カロリー爆弾💣');
    if (cut && cut.grade === 'fail') tease.push('ぱっかーん…しなかった（泣）');
    const low = rank === 'C' || rank === 'D' || rank === 'E';
    const rv = run.riceVisible || 0;
    if (rv > 0.5) tease.unshift('ケチャップライス・卵を添えて');
    if (sc.total > 0.015 && sc.onRim / sc.total > 0.3) tease.unshift('ソースもったいない！！！');
    if (run.fried && low) tease.unshift('目玉焼きライスって何？www');
    else if (!run.fried && low && run.omelette && run.omelette.lf < 0.06) tease.unshift('オムレツライスじゃんwww');
    if ((run.prep && run.prep.shells) > 0) tease.unshift('ジャリッ…殻入ってるぅ！歯が折れるww');
    if (run.raw) { tease.unshift('卵かけケチャップライス？ 火、つけ忘れてない？www'); }
    if (rank === 'E') tease.unshift('オムライスもろくに作れないの？w うぉw');
    else if (rank === 'D') tease.push('うーん…次はいける！たぶん！w');
    // 高いランクではほめ言葉を先に。ツッコミは1つまで
    const out = rank === 'S' || rank === 'A' || rank === 'B' ? praise.slice(0, 2).concat(tease.slice(0, 1)) : tease.slice(0, 2).concat(praise.slice(0, 1));
    return out.slice(0, 3);
  }

  PK.Scoring = { score, calories };
})();
