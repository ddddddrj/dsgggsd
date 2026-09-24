// src/engine/gunshot.js
// Выстрел рендерится заранее в буфер (стерео, 3 варианта на конфигурацию) — так можно
// позволить себе нормальную физику вместо пары фильтров на шуме:
//   дульная волна — импульс Фридлендера (положительная фаза T+ растёт с зарядом и калибром),
//   турбулентный выхлоп газов — шум с падающим срезом, «масса» — низкий удар, который ощущается телом,
//   N-волна сверхзвуковой пули (у СВД — хлёсткий щелчок раньше хлопка), отражение от земли (≈7 мс),
//   механика цикла своего семейства (кожух Glock, роликовый затвор MP5, газовый поршень СВД),
//   эхо стрельбища: боковые валы, вал за мишенями, лесополоса; для крупных калибров — раскатистый хвост.
// Глушитель: волна почти срезана и сдвинута вниз, «пфф» из торца, выхлоп из окна, механика слышна;
// сверхзвуковая пуля СВД щёлкает и с глушителем.
var SHOT = {
  // T — положительная фаза волны (с); peak — уровень; thumpF/thumpT — низ; gas — длит. выхлопа (с), gasF — срез
  glock: { T: 32e-5, peak: 0.95, thumpF: 150, thumpT: 0.022, thump: 0.55, gas: 0.016, gasF: 9500, gasLo: 1700, crack: 0, tail: 0.95, echo: 0.8, drive: 2.4, room: 0.9, bright: 1.25 },
  mp5: { T: 42e-5, peak: 0.9, thumpF: 118, thumpT: 0.03, thump: 0.62, gas: 0.022, gasF: 8200, gasLo: 1400, crack: 0.12, tail: 1.15, echo: 0.9, drive: 2.2, room: 1, bright: 1.05 },
  svd: { T: 95e-5, peak: 1.15, thumpF: 74, thumpT: 0.06, thump: 1, gas: 0.05, gasF: 6200, gasLo: 800, crack: 1, tail: 2.4, echo: 1.35, drive: 2.8, room: 1.3, bright: 0.95 },
  m870: { T: 16e-4, peak: 1.25, thumpF: 52, thumpT: 0.1, thump: 1.35, gas: 0.075, gasF: 3600, gasLo: 420, crack: 0, tail: 2.7, echo: 1.45, drive: 3.2, room: 1.4, bright: 0.7 },
  ak: { T: 7e-4, peak: 1.05, thumpF: 95, thumpT: 0.045, thump: 0.85, gas: 0.04, gasF: 6800, gasLo: 900, crack: 0.8, tail: 1.9, echo: 1.2, drive: 2.6, room: 1.2, bright: 1 }
};
var MUZ2 = {
  bare: { blast: 1, gas: 1, lp: 1, thump: 1, echo: 1, harsh: 0 },
  fh: { blast: 0.95, gas: 0.8, lp: 0.92, thump: 1, echo: 1, harsh: 0 },
  choke: { blast: 1.02, gas: 1, lp: 1, thump: 1, echo: 1, harsh: 0 },
  comp: { blast: 1.2, gas: 1.25, lp: 1.15, thump: 1.05, echo: 1.15, harsh: 0.35 },
  brake: { blast: 1.4, gas: 1.5, lp: 1.2, thump: 1.1, echo: 1.3, harsh: 0.6 },
  linear: { blast: 0.7, gas: 0.6, lp: 0.7, thump: 0.95, echo: 0.85, harsh: 0 },
  supp: { blast: 0.09, gas: 0.12, lp: 0.16, thump: 0.3, echo: 0.22, harsh: 0 }
};
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = s * 1664525 + 1013904223 >>> 0) / 4294967296;
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
// одно-полюсный ФНЧ по месту
function lp1(d, sr, f, i0 = 0, i1 = d.length) {
  const a = 1 - Math.exp(-2 * Math.PI * f / sr);
  let y = 0;
  for (let i = i0; i < i1; i++) d[i] = y += (d[i] - y) * a;
  return d;
}
function renderGunshot(sr, fam, muzzle, cal, variant) {
  const P = SHOT[fam] || SHOT.ak, M = MUZ2[muzzle] || MUZ2.bare;
  const supp = muzzle === "supp";
  const len = supp ? Math.max(0.9, P.tail * 0.45) : P.tail + 0.35;
  const n = Math.ceil(sr * len);
  const L = new Float32Array(n), Rt = new Float32Array(n);
  const rnd = Math.random;
  const v = 0.93 + rnd() * 0.14;
  const t0 = Math.floor(sr * 3e-3);
  // --- ядро (моно): волна + выхлоп + низ -----------------------------------
  const coreN = Math.ceil(sr * 0.25);
  const core = new Float32Array(coreN);
  // импульс Фридлендера: p(t) = (1 - t/T)·e^(-b·t/T); у глушителя фаза длиннее и мягче
  const T = P.T * (supp ? 3.2 : 1) * (0.95 + rnd() * 0.1), b = 1.7;
  const blastA = P.peak * M.blast * v;
  for (let i = 0; i < coreN; i++) {
    const t = i / sr;
    if (t > T * 6) break;
    core[i] += blastA * (1 - t / T) * Math.exp(-b * t / T);
  }
  // турбулентный выхлоп: белый шум, срез падает от gasF к gasLo, огибающая ~ быстрый спад
  {
    const g = new Float32Array(coreN);
    const dur = P.gas * (supp ? 0.7 : 1);
    for (let i = 0; i < coreN; i++) {
      const t = i / sr;
      g[i] = (rnd() * 2 - 1) * Math.exp(-t / dur) * (1 - Math.exp(-t / 4e-4));
    }
    // ФНЧ с падающей частотой — кусками по 64 отсчёта
    let y1 = 0, y2 = 0;
    for (let i = 0; i < coreN; i++) {
      const t = i / sr;
      const f = P.gasLo * M.lp + (P.gasF * M.lp - P.gasLo * M.lp) * Math.exp(-t / (dur * 0.8));
      const a = 1 - Math.exp(-2 * Math.PI * Math.min(f, sr * 0.45) / sr);
      y1 += (g[i] - y1) * a;
      y2 += (y1 - y2) * a;
      core[i] += y2 * 0.9 * M.gas * v * (supp ? 1.6 : 1);
    }
  }
  // «масса»: полтора периода низкой частоты с быстрым спадом и уходом частоты вниз
  {
    const f0 = P.thumpF * (0.95 + rnd() * 0.1);
    let ph = 0;
    for (let i = 0; i < coreN; i++) {
      const t = i / sr;
      if (t > P.thumpT * 6) break;
      const f = f0 * (0.55 + 0.45 * Math.exp(-t / (P.thumpT * 0.7)));
      ph += 2 * Math.PI * f / sr;
      core[i] += Math.sin(ph) * P.thump * M.thump * v * Math.exp(-t / P.thumpT) * (1 - Math.exp(-t / 6e-4)) * 0.8;
    }
  }
  // резкость дульных тормозов/компенсаторов: полоса 2–3 кГц
  if (M.harsh > 0) {
    const h = new Float32Array(coreN);
    for (let i = 0; i < coreN; i++) h[i] = (rnd() * 2 - 1) * Math.exp(-i / sr / 0.03);
    biquad(h, sr, "bp", 2600, 1.1);
    for (let i = 0; i < coreN; i++) core[i] += h[i] * M.harsh * 1.4;
  }
  // глушитель: «пфф» из торца (узкая полоса ~900 Гц) + выхлоп из окна (3–6 кГц, чуть позже)
  if (supp) {
    const pf = new Float32Array(coreN), port = new Float32Array(coreN);
    const pd = fam === "m870" || fam === "svd" ? 0.035 : 0.02;
    for (let i = 0; i < coreN; i++) {
      const t = i / sr;
      pf[i] = (rnd() * 2 - 1) * Math.exp(-t / pd) * (1 - Math.exp(-t / 1.5e-3));
      const tp = t - (fam === "glock" ? 4e-3 : 7e-3);
      port[i] = tp > 0 ? (rnd() * 2 - 1) * Math.exp(-tp / 0.012) : 0;
    }
    biquad(pf, sr, "bp", fam === "m870" ? 520 : fam === "svd" ? 700 : 950, 1.3);
    biquad(port, sr, "bp", 4200, 1.2);
    const first = variant === 0 ? 1.8 : 1;
    for (let i = 0; i < coreN; i++) core[i] += pf[i] * 1.5 * v * first + port[i] * (fam === "svd" ? 0.35 : 0.22);
  }
  // яркость: подъём верхов у пистолета (короткий ствол «хлещет»), завал у ружья
  {
    const hp = core.slice();
    biquad(hp, sr, "hp", 2500, 0.7);
    for (let i = 0; i < coreN; i++) core[i] += hp[i] * (P.bright - 1) * 1.2;
  }
  // насыщение: без него выстрел звучит как «хлопушка» — любой реальный записанный выстрел перегружен
  {
    const dr = P.drive * (supp ? 0.55 : 1);
    const nrm = Math.tanh(dr);
    for (let i = 0; i < coreN; i++) core[i] = Math.tanh(core[i] * dr) / nrm;
  }
  // --- сборка: прямой звук + отражение от земли/площадки ---------------------
  const put = (src, at, g, gl = 1, gr = 1) => {
    const i0 = Math.floor(at * sr);
    for (let i = 0; i < src.length && i0 + i < n; i++) {
      L[i0 + i] += src[i] * g * gl;
      Rt[i0 + i] += src[i] * g * gr;
    }
  };
  put(core, t0 / sr, 1, 1, 0.94);
  {
    const gnd = core.slice();
    lp1(gnd, sr, 3200);
    put(gnd, t0 / sr + 72e-4, 0.42, 0.95, 1);
  }
  // N-волна пули: перед хлопком (пуля обгоняет звук), двуполярный импульс ~0,5 мс
  if (P.crack > 0) {
    const cn = Math.ceil(sr * 25e-4), cr = new Float32Array(cn);
    const w = Math.floor(sr * 5e-4);
    for (let i = 0; i < cn; i++) cr[i] = i < w ? 1 - 2 * i / w : i < w + 3 ? -1 + (i - w) / 3 : 0;
    const ringN = Math.ceil(sr * 0.02), ring = new Float32Array(ringN);
    for (let i = 0; i < ringN; i++) ring[i] = (rnd() * 2 - 1) * Math.exp(-i / sr / 3e-3);
    biquad(ring, sr, "hp", 3500, 0.7);
    const ca = P.crack * (supp ? 0.85 : 0.75) * v;
    put(cr, (t0 - Math.floor(sr * 6e-4)) / sr, ca, 1, 0.9);
    put(ring, t0 / sr, ca * 0.25, 0.8, 1);
  }
  // --- механика цикла: моды фиксированы для семейства (seeded), это «голос» оружия ---------
  if (fam !== "m870") {
    const Tm = new Track(sr, 0.2);
    const saveR = R;
    R = seeded(hashStr("mech|" + fam));
    const cyc = fam === "glock" ? 0.05 : fam === "mp5" ? 0.075 : fam === "svd" ? 0.12 : 0.085;
    if (fam === "glock") {
      Tm.metal(0.2 * cyc, 0.42, 1800, 7200, 3e-3, { n: 20, tick: 0.5 });
      Tm.thud(0.2 * cyc, 0.25, 1100, 0.01, 260);
      Tm.metal(0.78 * cyc, 0.5, 1300, 6200, 4e-3, { n: 22, tick: 0.6 });
    } else if (fam === "mp5") {
      Tm.metal(0.25 * cyc, 0.35, 900, 5200, 5e-3, { n: 22, tick: 0.4 });
      Tm.metal(0.82 * cyc, 0.6, 700, 4600, 6e-3, { n: 26, tick: 0.6 });
      Tm.spring(0.3 * cyc, 0.05, 0.06, 2400);
    } else {
      Tm.noise(0.08 * cyc, 0.25, 0.01, { bp: 2200, q: 1.2 });
      Tm.metal(0.35 * cyc, 0.45, 600, 4200, 7e-3, { n: 26, tick: 0.4 });
      Tm.metal(0.88 * cyc, 0.75, 480, 3600, 9e-3, { n: 30, tick: 0.6 });
      Tm.thud(0.88 * cyc, 0.3, 500, 0.02, 120);
    }
    R = saveR;
    const mg = (supp ? 0.55 : 0.28) * (fam === "svd" ? 1.2 : 1);
    put(Tm.d, t0 / sr + 2e-3, mg, 0.85, 1);
  }
  // --- окружение ------------------------------------------------------------
  // раннее: скамья/площадка стрелка (плотные короткие отражения 3–25 мс)
  const echoSrc = core.slice(0, Math.ceil(sr * 0.09));
  lp1(echoSrc, sr, 2400);
  for (let i = 0, m = echoSrc.length, f = Math.floor(sr * 0.05); i < f; i++) echoSrc[m - 1 - i] *= 0.5 - 0.5 * Math.cos(Math.PI * i / f);
  const E = M.echo * P.echo * (supp ? 1.4 : 1);
  for (let i = 0; i < 6; i++) put(echoSrc, t0 / sr + 0.003 + rnd() * 0.022, 0.035 * P.room * E, 0.5 + rnd() * 0.5, 0.5 + rnd() * 0.5);
  // дальние: боковые валы (42 м), вал за мишенями (~128 м), лесополоса (150–190 м)
  const refl = [[0.245, 0.2, 1500, 1, 0.55], [0.262, 0.16, 1400, 0.5, 1], [0.75, 0.22, 900, 0.8, 0.8], [0.9, 0.1, 700, 1, 0.6], [1.04, 0.09, 600, 0.6, 1], [1.21, 0.05, 500, 0.9, 0.8]];
  for (const [dt, g, f, gl, gr] of refl) {
    if (dt > len - 0.2) continue;
    const e = echoSrc.slice();
    lp1(e, sr, f);
    lp1(e, sr, f * 1.5);
    // размазывание: несколько копий с разбросом — отражение от неровного вала, а не от стены
    for (let k = 0; k < 4; k++) put(e, t0 / sr + dt + rnd() * 0.035, g * E * (0.14 + rnd() * 0.1), gl, gr);
  }
  // диффузный хвост: шум по трём полосам, верха гаснут быстрее (поглощение воздухом)
  {
    const tl = P.tail * (supp ? 0.35 : 1);
    const bands = [[260, tl * 0.5, 0.9], [1100, tl * 0.32, 0.55], [3800, tl * 0.14, 0.3]];
    for (const ch of [L, Rt]) {
      for (const [f, T60, a] of bands) {
        const tn = Math.min(n, Math.ceil(sr * T60 * 1.6));
        const d = new Float32Array(tn);
        for (let i = 0; i < tn; i++) {
          const t = i / sr;
          d[i] = (rnd() * 2 - 1) * Math.exp(-6.9 * t / T60) * Math.min(1, t / 0.035);
        }
        biquad(d, sr, "bp", f, 0.8);
        // раскаты у крупных калибров: медленная модуляция низкой полосы
        if (f < 400 && P.tail > 2) for (let i = 0; i < tn; i++) d[i] *= 0.6 + 0.4 * Math.sin(i / sr * 7.3 + 1.3) * Math.sin(i / sr * 2.1);
        const g = a * 0.22 * E * P.peak;
        const i0 = t0 + Math.floor(sr * 0.012);
        for (let i = 0; i < tn && i0 + i < n; i++) ch[i0 + i] += d[i] * g;
      }
    }
  }
  // нормировка по пику + мягкий срез конца
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(Rt[i]));
  const gN = 0.97 / Math.max(1e-6, pk);
  const fade = Math.floor(sr * 0.08);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    L[i] *= gN * f;
    Rt[i] *= gN * f;
  }
  return [L, Rt];
}
// Громкость на выходе (после нормировки буферов) — соотношение калибров как у стрелка.
var SHOT_LEVEL = { glock: 0.8, mp5: 0.84, svd: 1, m870: 1, ak: 0.95 };
var SUPP_LEVEL = { glock: 0.32, mp5: 0.3, svd: 0.62, m870: 0.42, ak: 0.45 };

