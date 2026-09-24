// src/engine/foley.js
// Механика, перезарядка, гильзы — синтезированные буферы.
// Металл здесь — плотный набор неоднородных, быстро гаснущих мод + контактный щелчок:
// такой спектр слышится как «лязг», а не как нота. Несколько чистых синусоид с долгим
// затуханием (как было в шаблоне) звучат как «колокольчики» — этого избегаем.
function biquad(d, sr, type, f, q = 0.707) {
  const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, cw = Math.cos(w), sw = Math.sin(w), a = sw / (2 * q);
  let b0, b1, b2;
  if (type === "lp") {
    b0 = (1 - cw) / 2;
    b1 = 1 - cw;
    b2 = b0;
  } else if (type === "hp") {
    b0 = (1 + cw) / 2;
    b1 = -(1 + cw);
    b2 = b0;
  } else {
    b0 = a;
    b1 = 0;
    b2 = -a;
  }
  const a0 = 1 + a, a1 = -2 * cw, a22 = 1 - a;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a22 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    d[i] = y;
  }
  return d;
}
var R = Math.random;
var jit = (v, k = 0.08) => v * (1 - k + R() * 2 * k);
var Track = class {
  constructor(sr, sec) {
    this.sr = sr;
    this.d = new Float32Array(Math.ceil(sr * sec));
  }
  // Металл: n мод со случайными частотами в полосе lo…hi (лог-равномерно), верхние гаснут быстрее.
  // dec — постоянная затухания нижних мод, с; grit — доля полосового шума (шероховатость контакта).
  metal(t, level, lo, hi, dec, o = {}) {
    const sr = this.sr, d = this.d, i0 = Math.floor(t * sr);
    const n = o.n ?? 30, grit = o.grit ?? 0.5;
    const norm = level * 2.2 / Math.sqrt(n);
    const att = Math.max(2, sr * 15e-5);
    for (let m = 0; m < n; m++) {
      const f = lo * Math.pow(hi / lo, R());
      const dk = dec * (0.45 + R() * 0.9) * Math.pow(lo / f, o.tilt ?? 0.45);
      const a = norm * (0.25 + R() * 0.75) * Math.pow(lo / f, 0.2);
      const w = 2 * Math.PI * f / sr, ph = R() * 6.28;
      const len = Math.min(d.length - i0, Math.ceil(dk * sr * 6));
      const k = Math.exp(-1 / (dk * sr));
      let env = a;
      for (let i = 0; i < len; i++) {
        d[i0 + i] += env * Math.min(1, i / att) * Math.sin(w * i + ph);
        env *= k;
      }
    }
    if (grit > 0) this.noise(t, level * grit, dec * 0.5, { bp: Math.sqrt(lo * hi), q: 0.9 });
    if (o.tick !== false) this.tick(t, level * (o.tick ?? 0.6));
    return this;
  }
  // Контактный щелчок: доли миллисекунды широкополосного шума.
  tick(t, level, hp = 1800) {
    return this.noise(t, level, 25e-5, { hp });
  }
  noise(t, level, dec, f = {}) {
    const sr = this.sr, d = this.d, i0 = Math.floor(t * sr);
    const n = Math.min(d.length - i0, Math.ceil(dec * sr * 7));
    if (n <= 0 || !level) return this;
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = (R() * 2 - 1) * Math.exp(-i / (dec * sr));
    if (f.lp) biquad(b, sr, "lp", f.lp, 0.8);
    if (f.hp) biquad(b, sr, "hp", f.hp, 0.7);
    if (f.bp) biquad(b, sr, "bp", f.bp, f.q || 1.5);
    for (let i = 0; i < n; i++) d[i0 + i] += b[i] * level;
    return this;
  }
  // Трение: длительность, полоса f0→f1, плотность зацепов в секунду.
  scrape(t, dur, level, f0, f1, o = {}) {
    const sr = this.sr, i0 = Math.floor(t * sr), n = Math.min(this.d.length - i0, Math.floor(dur * sr));
    if (n <= 0) return this;
    const b = new Float32Array(n);
    const rate = o.rate ?? 900, rough = o.rough ?? 0.6;
    let next = 0;
    for (let i = 0; i < n; i++) {
      let v = (R() * 2 - 1) * (1 - rough) * 0.35;
      if (i >= next) {
        v += (R() * 2 - 1) * rough * 2.2;
        next = i + Math.floor(sr / rate * (0.3 + R() * 1.4));
      }
      b[i] = v;
    }
    const seg = 256, out = new Float32Array(n);
    for (let s = 0; s < n; s += seg) {
      const f = f0 * Math.pow(f1 / f0, s / n);
      const from = Math.max(0, s - 64);
      const part = biquad(b.slice(from, Math.min(n, s + seg)), sr, "bp", f, o.q ?? 1.8);
      for (let i = s - from; i < part.length; i++) out[from + i] = part[i];
    }
    const shape2 = o.shape || ((k) => Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.7);
    for (let i = 0; i < n; i++) this.d[i0 + i] += out[i] * level * 3.2 * shape2(i / n);
    return this;
  }
  // Глухой удар (ладонь, пластик, дерево, земля): шум ниже lp + пара периодов низкой «массы».
  thud(t, level, lp, dec = 0.03, body = 0) {
    const sr = this.sr, d = this.d, i0 = Math.floor(t * sr);
    this.noise(t, level * 1.4, dec, { lp, hp: 50 });
    if (body) {
      const w = 2 * Math.PI * jit(body, 0.1) / sr, dk = dec * 0.6;
      const n = Math.min(d.length - i0, Math.ceil(dk * sr * 5));
      for (let i = 0; i < n; i++) d[i0 + i] += level * 0.9 * Math.exp(-i / (dk * sr)) * Math.sin(w * i);
    }
    return this;
  }
  // Сжатие пружины: мягкий шорох с «жужжанием» витков.
  spring(t, dur, level, f = 2600) {
    return this.scrape(t, dur, level, f * 0.8, f * 1.3, { rate: 3200, rough: 0.25, q: 3.5, shape: (k) => (1 - k) * Math.min(1, k * 8) });
  }
  buffer(ctx) {
    const d = this.d;
    let pk = 0;
    for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
    const g = pk > 0.98 ? 0.98 / pk : 1;
    const fade = Math.min(d.length, Math.floor(this.sr * 0.01));
    for (let i = 0; i < d.length; i++) d[i] *= g * (i > d.length - fade ? (d.length - i) / fade : 1);
    const b = ctx.createBuffer(1, d.length, this.sr);
    b.getChannelData(0).set(d);
    return b;
  }
};
// Полосы и затухания типовых деталей: [нижняя, верхняя частота (Гц), затухание (с)].
var PART = {
  pin: [3200, 9e3, 18e-4],
  small: [2200, 7500, 3e-3],
  bolt: [900, 5200, 45e-4],
  boltBig: [650, 4200, 6e-3],
  recv: [420, 3200, 7e-3],
  stamped: [700, 4800, 5e-3],
  frame: [500, 2600, 26e-4],
  magSteel: [900, 4800, 4e-3],
  magAlu: [700, 3800, 4e-3],
  magPoly: [420, 1900, 22e-4],
  tube: [1100, 5600, 5e-3]
};
var MT = (T2, t, lvl, part, o) => T2.metal(t, lvl, part[0], part[1], part[2], o);
var RECIPES = {
  release(T2) {
    MT(T2, 0, 0.32, PART.small, { n: 18 });
    MT(T2, 0.011, 0.14, PART.pin, { n: 12, tick: 0.2 });
  },
  // Магазин выходит из шахты.
  magOut(T2, o) {
    const poly = o.kind === "poly", fam = o.fam;
    if (fam === "ak" || fam === "svd") {
      MT(T2, 0, 0.3, PART.small, { n: 16 });
      T2.scrape(0.02, 0.11, 0.16, 1500, 1000, { rate: 700, rough: 0.7 });
      MT(T2, 0.12, 0.42, poly ? PART.magPoly : PART.stamped, { tick: 0.5 });
      T2.scrape(0.14, 0.09, 0.1, 1200, 800, { rate: 500 });
      T2.thud(0.2, 0.2, 700, 0.02, 160);
    } else if (fam === "glock") {
      MT(T2, 0, 0.26, PART.frame, { n: 14, tick: 0.7 });
      MT(T2, 4e-3, 0.18, PART.small, { n: 12, tick: 0 });
      T2.scrape(0.012, 0.075, 0.2, 1300, 900, { rate: 900, rough: 0.5 });
      MT(T2, 0.085, 0.16, PART.magPoly, { n: 14, tick: 0.3 });
    } else {
      RECIPES.release(T2, o);
      T2.scrape(0.018, 0.13, poly ? 0.18 : 0.22, poly ? 1400 : 2e3, poly ? 900 : 1300, { rate: poly ? 600 : 1100, rough: 0.55 });
      MT(T2, 0.14, 0.24, poly ? PART.magPoly : PART.magSteel, { n: 20, tick: 0.3 });
      T2.thud(0.19, 0.16, 700, 0.02);
    }
  },
  magInsert(T2, o) {
    const poly = o.kind === "poly";
    if (o.fam === "ak" || o.fam === "svd") {
      MT(T2, 0, 0.38, poly ? PART.magPoly : PART.stamped, { tick: 0.4 });
      T2.scrape(0.01, 0.07, 0.15, 1500, 2200, { rate: 800 });
    } else {
      T2.scrape(0, 0.1, poly ? 0.2 : 0.24, poly ? 900 : 1300, poly ? 1600 : 2500, { rate: poly ? 700 : 1300, rough: 0.5, shape: (k) => Math.min(1, k * 3) * (1 - k * 0.3) });
    }
  },
  // Посадка: удар в упор + щелчок защёлки (+ ладонь по дну).
  magIn(T2, o) {
    const poly = o.kind === "poly", fam = o.fam;
    if (fam === "ak" || fam === "svd") {
      T2.scrape(0, 0.05, 0.12, 1200, 1800, { rate: 600 });
      MT(T2, 0.05, 0.8, PART.recv, { tick: 0.4 });
      MT(T2, 0.057, 0.45, PART.small, { n: 18 });
      T2.thud(0.05, 0.3, 500, 0.025, 170);
    } else if (fam === "glock") {
      T2.thud(0, 0.7, 900, 0.028, 190);
      MT(T2, 2e-3, 0.45, PART.frame, { tick: 0.5 });
      MT(T2, 9e-3, 0.4, PART.small, { n: 16 });
    } else {
      T2.thud(0, 0.5, 900, 0.03, poly ? 210 : 250);
      MT(T2, 2e-3, 0.55, poly ? PART.magPoly : PART.stamped, { tick: 0.4 });
      MT(T2, 0.015, 0.45, PART.small, { n: 18 });
    }
  },
  // Затвор/рукоять назад.
  chargeBack(T2, o) {
    const fam = o.fam;
    if (fam === "mp5") {
      // рукоять в трубке: хват, отпирание роликов, трение по трубке, сжатие пружины
      T2.thud(0, 0.12, 1400, 0.01);
      MT(T2, 6e-3, 0.3, PART.small, { n: 14 });
      MT(T2, 0.02, 0.36, PART.bolt, { tick: 0.4 });
      T2.scrape(0.025, 0.15, 0.24, 2200, 3800, { rate: 1500, rough: 0.45, q: 2.6 });
      T2.spring(0.03, 0.15, 0.06, 3800);
      MT(T2, 0.18, 0.3, PART.tube, { n: 18 });
    } else if (fam === "glock") {
      T2.thud(0, 0.14, 1200, 0.012);
      MT(T2, 8e-3, 0.3, PART.small, { n: 14 });
      T2.scrape(0.012, 0.085, 0.22, 1800, 3200, { rate: 1600, rough: 0.5, q: 2.2 });
      MT(T2, 0.1, 0.34, PART.bolt, { tick: 0.4 });
    } else {
      T2.thud(0, 0.14, 1200, 0.012);
      MT(T2, 4e-3, 0.28, PART.bolt, { n: 18 });
      T2.scrape(0.01, 0.17, 0.24, 1300, 3200, { rate: fam === "ak" || fam === "svd" ? 700 : 1200, rough: 0.5, q: 2.4 });
      T2.spring(0.02, 0.16, 0.05, 5200);
      MT(T2, 0.19, 0.45, fam === "svd" ? PART.boltBig : PART.bolt);
    }
  },
  // Затвор вперёд: трение, мощный удар запирания, доворот.
  chargeRelease(T2, o) {
    const fam = o.fam;
    if (fam === "mp5") {
      // «HK slap»: удар ладонью, рукоять выходит из выреза, затвор с роликами бьёт в казённик
      T2.thud(0, 0.7, 1100, 0.022, 200);
      MT(T2, 3e-3, 0.4, PART.small, { n: 16 });
      T2.scrape(6e-3, 0.04, 0.2, 3800, 2e3, { rate: 1800, rough: 0.5 });
      MT(T2, 0.046, 1, PART.bolt, { tick: 0.6 });
      MT(T2, 0.047, 0.5, PART.stamped, { tick: 0 });
      MT(T2, 0.054, 0.3, PART.small, { n: 14 });
    } else if (fam === "glock") {
      T2.scrape(0, 0.03, 0.18, 3200, 1800, { rate: 1800 });
      MT(T2, 0.032, 0.9, PART.bolt, { tick: 0.6 });
      MT(T2, 0.033, 0.4, PART.frame, { tick: 0 });
      MT(T2, 0.04, 0.24, PART.small, { n: 12 });
    } else {
      T2.scrape(0, 0.05, 0.2, 3e3, 1600, { rate: 1600, rough: 0.5 });
      const big = fam === "ak" || fam === "svd" ? 1.12 : 1;
      MT(T2, 0.05, 0.95 * big, fam === "svd" ? PART.boltBig : PART.bolt, { tick: 0.6 });
      MT(T2, 0.051, 0.45, PART.recv, { tick: 0 });
      MT(T2, 0.059, 0.3, PART.small, { n: 14 });
    }
  },
  // HK: рукоять уходит вверх в вырез трубки и держит затвор открытым.
  hkLock(T2) {
    MT(T2, 0, 0.35, PART.tube, { n: 18 });
    MT(T2, 9e-3, 0.28, PART.small, { n: 12 });
  },
  // Затвор закрывается сам (СВД: магазин вынут при затворе на задержке).
  boltSlam(T2) {
    T2.scrape(0, 0.04, 0.16, 2800, 1600, { rate: 1500 });
    MT(T2, 0.042, 0.9, PART.boltBig, { tick: 0.6 });
    MT(T2, 0.043, 0.45, PART.recv, { tick: 0 });
  },
  // Затворная задержка: нажатие рычага, затем удар затвора/кожуха.
  boltCatch(T2, o) {
    const g = o.fam === "glock";
    MT(T2, 0, 0.28, g ? PART.frame : PART.small, { n: 14 });
    MT(T2, 0.03, 0.95, PART.bolt, { tick: 0.6 });
    MT(T2, 0.031, 0.4, g ? PART.frame : PART.recv, { tick: 0 });
    MT(T2, 0.038, 0.26, PART.small, { n: 12 });
  },
  // Помпа назад: хват цевья, отпирание, трение планок по трубке, выброс гильзы, упор.
  pumpBack(T2) {
    T2.thud(0, 0.3, 900, 0.018, 150);
    MT(T2, 0.01, 0.55, PART.bolt, { tick: 0.5 });
    T2.scrape(0.018, 0.1, 0.3, 900, 1700, { rate: 700, rough: 0.6, q: 1.6 });
    T2.scrape(0.02, 0.1, 0.12, 3200, 4600, { rate: 2200, rough: 0.35, q: 3 });
    MT(T2, 0.07, 0.25, PART.small, { n: 12 });
    MT(T2, 0.125, 0.7, PART.recv, { tick: 0.5 });
    MT(T2, 0.127, 0.3, PART.bolt, { tick: 0 });
  },
  // Помпа вперёд: подача патрона, подъём лотка, запирание — «чк-чак».
  pumpForward(T2) {
    T2.scrape(0, 0.09, 0.26, 1500, 900, { rate: 700, rough: 0.6, q: 1.6 });
    MT(T2, 0.03, 0.3, PART.small, { n: 14 });
    MT(T2, 0.09, 0.95, PART.bolt, { tick: 0.6 });
    MT(T2, 0.091, 0.45, PART.recv, { tick: 0 });
    MT(T2, 0.1, 0.35, PART.small, { n: 12 });
    T2.thud(0.09, 0.3, 600, 0.02, 130);
  },
  // Патрон в подствольный магазин: гильза мимо лотка, отсечка, упор большим пальцем.
  shellLoad(T2) {
    T2.thud(0, 0.2, 1400, 0.012);
    T2.scrape(4e-3, 0.08, 0.2, 1100, 2200, { rate: 900, rough: 0.55 });
    MT(T2, 0.03, 0.22, PART.small, { n: 12 });
    T2.scrape(0.05, 0.05, 0.12, 900, 700, { rate: 600 });
    MT(T2, 0.1, 0.38, PART.tube, { n: 16, tick: 0.5 });
    T2.thud(0.1, 0.28, 700, 0.02, 180);
  },
  magGround(T2, o) {
    const poly = o.kind === "poly";
    T2.thud(0, 0.7, 700, 0.03, 140);
    MT(T2, 4e-3, 0.35, poly ? PART.magPoly : PART.magSteel, { tick: 0.4 });
    T2.thud(0.11 + R() * 0.04, 0.25, 600, 0.02, 160);
    if (!poly) MT(T2, 0.12, 0.16, PART.magSteel, { n: 16 });
  },
  // Гильза о бетон: латунь звенит заметно дольше стали; пластиковая гильза дроби — глухо.
  casing(T2, o) {
    if (o.kind === "hull") {
      T2.thud(0, 0.4, 1600, 0.012, 320);
      T2.metal(2e-3, 0.22, 2400, 7e3, 5e-3, { n: 16, tick: 0.3 });
      T2.thud(0.07 + R() * 0.03, 0.15, 1400, 0.01, 300);
      return;
    }
    const steel = o.kind === "steel", k = o.cal === "762x54R" ? 0.75 : o.cal === "9x19" ? 1.25 : 1;
    const lo = (steel ? 2600 : 3600) * k, hi = steel ? 9e3 : 12e3, dec = steel ? 7e-3 : 0.016;
    const oo = { tick: 0.5, grit: 0.2, tilt: 0.3 };
    T2.metal(0, 0.5, lo, hi, dec, { n: 26, ...oo });
    T2.metal(0.06 + R() * 0.04, 0.24, lo, hi, dec, { n: 20, ...oo, tick: 0.3 });
    T2.metal(0.13 + R() * 0.06, 0.1, lo, hi, dec, { n: 14, ...oo, tick: 0.2 });
  },
  // Цикл автоматики при выстреле (тайминг — от темпа стрельбы).
  cycle(T2, o) {
    const cyc = 60 / (o.rpm || 700), fam = o.fam;
    if (fam === "m870") return;
    if (fam === "glock") {
      MT(T2, 0.25 * cyc, 0.5, PART.frame, { tick: 0.4 });
      MT(T2, 0.8 * cyc, 0.55, PART.bolt, { tick: 0.4 });
      return;
    }
    if (fam === "mp5") MT(T2, 3e-3, 0.3, PART.small, { n: 12 });
    MT(T2, 0.42 * cyc, fam === "svd" ? 0.55 : 0.45, fam === "mp5" ? PART.stamped : PART.recv, { tick: 0.3 });
    MT(T2, 0.86 * cyc, 0.7, fam === "svd" ? PART.boltBig : PART.bolt, { tick: 0.5 });
    MT(T2, 0.86 * cyc + 1e-3, 0.3, PART.recv, { tick: 0 });
  },
  dryFire(T2, o) {
    if (o.fam === "glock") {
      MT(T2, 0, 0.35, PART.small, { n: 14 });
      MT(T2, 2e-3, 0.2, PART.frame, { tick: 0 });
      return;
    }
    MT(T2, 0, 0.55, PART.bolt, { tick: 0.5 });
    MT(T2, 3e-3, 0.22, PART.small, { n: 12 });
  },
  // Переводчик / предохранитель: пружинный фиксатор.
  selector(T2, o) {
    const fam = o.fam;
    if (fam === "m870") {
      MT(T2, 0, 0.35, PART.small, { n: 14 });
      return;
    }
    if (fam === "glock") {
      MT(T2, 0, 0.3, PART.small, { n: 12 });
      MT(T2, 0.02, 0.2, PART.pin, { n: 10, tick: 0.2 });
      return;
    }
    const big = fam === "svd" || fam === "ak";
    T2.scrape(0, 0.035, 0.07, 2500, 3500, { rate: 1500 });
    MT(T2, 0.03, big ? 0.5 : 0.38, big ? PART.stamped : PART.small, { n: 18 });
  },
  click(T2) {
    MT(T2, 0, 0.26, PART.pin, { n: 12, tick: 0.4 });
  }
};
var LEN = { release: 0.05, magOut: 0.34, magInsert: 0.14, magIn: 0.16, chargeBack: 0.26, chargeRelease: 0.16, hkLock: 0.08, boltSlam: 0.14, boltCatch: 0.14, pumpBack: 0.2, pumpForward: 0.18, shellLoad: 0.18, magGround: 0.26, casing: 0.3, dryFire: 0.06, selector: 0.07, click: 0.04 };
var VARIANTS = 3;
var Foley = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = /* @__PURE__ */ new Map();
  }
  buffer(name, o = {}) {
    const key = [name, o.fam, o.kind, o.cal, o.rpm].join("|");
    let list = this.cache.get(key);
    if (!list) {
      list = [];
      const len = name === "cycle" ? 60 / (o.rpm || 700) + 0.06 : LEN[name] || 0.2;
      for (let v = 0; v < VARIANTS; v++) {
        const T2 = new Track(this.ctx.sampleRate, len);
        RECIPES[name](T2, o);
        list.push(T2.buffer(this.ctx));
      }
      this.cache.set(key, list);
    }
    return list[Math.random() * list.length | 0];
  }
};

