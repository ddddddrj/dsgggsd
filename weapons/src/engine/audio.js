// src/engine/audio.js
// Выстрел: дульная волна (полосовой шум с падающим срезом), удар давления (низкий импульс),
// N-волна сверхзвуковой пули, механика цикла (буфер foley), эхо стрельбища.
var CAL2 = {
  "556": { blastF: 7200, blastT: 0.075, bodyF: 150, bodyT: 0.09, body: 0.55, crack: 0.9, level: 1 },
  "545": { blastF: 7600, blastT: 0.07, bodyF: 140, bodyT: 0.09, body: 0.55, crack: 0.95, level: 1 },
  "762x39": { blastF: 5200, blastT: 0.1, bodyF: 105, bodyT: 0.13, body: 0.85, crack: 0.75, level: 1.08 },
  "762x51": { blastF: 5600, blastT: 0.12, bodyF: 90, bodyT: 0.15, body: 1, crack: 1, level: 1.18 },
  // 9×19 из короткого ствола: сухой хлёсткий хлопок, трескотня почти нет (≈400 м/с)
  "9x19": { blastF: 6400, blastT: 0.055, bodyF: 165, bodyT: 0.06, body: 0.45, crack: 0.3, level: 0.84, subSupp: true },
  // 12 калибр: тяжёлый длинный «бум», много низа, дробь почти не трещит
  "12ga": { blastF: 4300, blastT: 0.15, bodyF: 68, bodyT: 0.2, body: 1.2, crack: 0.12, level: 1.26 },
  // 7,62×54R: самый громкий, резкий щелчок пули 830 м/с и длинный хвост
  "762x54R": { blastF: 5100, blastT: 0.125, bodyF: 84, bodyT: 0.16, body: 1.08, crack: 1.15, level: 1.24 }
};
var MUZ = {
  bare: { blast: 1.1, lp: 1.1, body: 1, crack: 1, wet: 1, attack: 6e-4, tail: 1, harsh: 0.15 },
  fh: { blast: 1, lp: 0.95, body: 1, crack: 1, wet: 1, attack: 7e-4, tail: 1, harsh: 0.1 },
  comp: { blast: 1.2, lp: 1.1, body: 1.05, crack: 1, wet: 1.15, attack: 5e-4, tail: 1.1, harsh: 0.35 },
  // линейный: волна уходит вперёд — глуше и мягче у стрелка
  linear: { blast: 0.72, lp: 0.7, body: 0.95, crack: 1, wet: 0.8, attack: 9e-4, tail: 0.85, harsh: 0 },
  brake: { blast: 1.45, lp: 1.3, body: 1.1, crack: 1, wet: 1.35, attack: 4e-4, tail: 1.2, harsh: 0.6 },
  // дульные насадки гладкоствольного ружья звучат как голый ствол
  choke: { blast: 1.08, lp: 1.05, body: 1, crack: 1, wet: 1, attack: 6e-4, tail: 1, harsh: 0.12 },
  supp: { blast: 0.075, lp: 0.2, body: 0.32, crack: 0.55, wet: 0.22, attack: 4e-3, tail: 0.6, harsh: 0 }
};
var GunAudio = class {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.profile = { cal: "556", mech: 0.8 };
    this.muzzle = "fh";
    this.lastShot = -10;
  }
  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 1e-3;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(c.destination);
    this.dry = c.createGain();
    this.dry.connect(this.master);
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(2.6);
    this.wet = c.createGain();
    this.wet.gain.value = 0.55;
    this.verb.connect(this.wet).connect(this.master);
    this.noise = this.noiseBuf(1.5, "white");
    this.pink = this.noiseBuf(1.5, "pink");
    this.crackBuf = this.nwave();
    this.foley = new Foley(c);
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    idle(() => this.warm());
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }
  noiseBuf(sec, kind) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "pink") {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else d[i] = w;
    }
    return b;
  }
  // N-волна сверхзвуковой пули: короткий двуполярный импульс.
  nwave() {
    const c = this.ctx, n = Math.floor(c.sampleRate * 6e-3);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    const L = Math.floor(c.sampleRate * 9e-4);
    for (let i = 0; i < n; i++) {
      if (i < L) d[i] = 1 - 2 * i / L;
      else d[i] = Math.exp(-(i - L) / (c.sampleRate * 6e-4)) * -0.3 * Math.sin(i * 0.9);
    }
    return b;
  }
  // Импульсная характеристика открытого стрельбища: плотный хвост + отражения от валов.
  impulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    const refl = [[0.045, 0.5], [0.11, 0.35], [0.19, 0.3], [0.31, 0.42], [0.52, 0.22], [0.78, 0.16]];
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const w = Math.random() * 2 - 1;
        lp += (w - lp) * (0.35 - Math.min(0.3, t * 0.14));
        d[i] = lp * Math.pow(1 - t / sec, 3.2) * 0.35;
      }
      for (const [t, a] of refl) {
        const s = Math.floor((t + (ch ? 7e-3 : 0)) * c.sampleRate);
        for (let j = 0; j < 900 && s + j < n; j++) d[s + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 180);
      }
    }
    return b;
  }
  env(g, t, a, peak, tau, end) {
    g.gain.setValueAtTime(1e-4, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(1e-4, t + a, tau);
    if (end) g.gain.setValueAtTime(0, t + end);
  }
  src(buf, t, dur, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.start(t, Math.random() * (buf.duration - dur - 0.01), dur);
    return s;
  }
  out(node2, wet = 0, pan = 0) {
    let n = node2;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      n.connect(p);
      n = p;
    }
    n.connect(this.dry);
    if (wet > 0) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      n.connect(w).connect(this.verb);
    }
  }
  // Щелчок металла: два полосовых шума с разнесёнными частотами, без синусоид.
  clank(t, f, level, dur = 0.05, q = 6, pan = 0.1, wet = 0.08) {
    const c = this.ctx;
    for (const [k, a] of [[1, 1], [1.61 + Math.random() * 0.3, 0.6]]) {
      const s = this.src(this.noise, t, dur + 0.02, 1);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * k;
      bp.Q.value = Math.min(q, 4);
      const g = c.createGain();
      this.env(g, t, 5e-4, level * a, dur * 0.22, dur + 0.02);
      s.connect(bp).connect(g);
      this.out(g, wet, pan);
    }
  }
  // Глухой удар (пластик, ладонь).
  thud(t, f, level, dur = 0.06, pan = 0) {
    const c = this.ctx;
    const s = this.src(this.pink, t, dur + 0.02);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = f;
    const g = c.createGain();
    this.env(g, t, 1e-3, level, dur * 0.35, dur + 0.02);
    s.connect(lp).connect(g);
    this.out(g, 0.05, pan);
  }
  // Шорох/скольжение.
  slide(t, f0, f1, level, dur, pan = 0.1) {
    const c = this.ctx;
    const s = this.src(this.noise, t, dur + 0.02);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(1e-4, t);
    g.gain.linearRampToValueAtTime(level, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(1e-4, t + dur);
    s.connect(bp).connect(g);
    this.out(g, 0.03, pan);
  }
  params() {
    return { ...CAL2[this.profile.cal] || CAL2["556"], ...this.profile.shot || {} };
  }
  /* --------------------------------------------------------------- выстрел */
  shot(o = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime + 5e-3;
    const fam = this.shotFamily();
    const supp = this.muzzle === "supp";
    // холодный глушитель: первый выстрел громче (кислород в камерах догорает)
    const cold = supp && t - this.lastShot > 3;
    this.lastShot = t;
    const buf = this.shotBuffer(fam, this.muzzle, cold);
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.975 + Math.random() * 0.05;
    const g = c.createGain();
    g.gain.value = (supp ? SUPP_LEVEL[fam] ?? 0.4 : SHOT_LEVEL[fam] ?? 0.9) * (o.gain ?? 1) * 1.15;
    s.connect(g).connect(this.dry);
    s.start(t);
  }
  shotFamily() {
    const f = this.profile.family;
    return SHOT[f] ? f : this.profile.cal === "12ga" ? "m870" : this.profile.cal === "9x19" ? "mp5" : this.profile.cal === "762x54R" ? "svd" : "ak";
  }
  // Буферы выстрела: 3 варианта на (оружие, дульное устройство); вариант 0 у глушителя — «холодный».
  shotBuffer(fam, muzzle, cold) {
    this.shots = this.shots || new Map();
    const key = fam + "|" + muzzle;
    let list = this.shots.get(key);
    if (!list) {
      list = [];
      const sr = this.ctx.sampleRate;
      for (let v = 0; v < 3; v++) {
        const [l, r] = renderGunshot(sr, fam, muzzle, this.profile.cal, v);
        const b = this.ctx.createBuffer(2, l.length, sr);
        b.getChannelData(0).set(l);
        b.getChannelData(1).set(r);
        list.push(b);
      }
      this.shots.set(key, list);
    }
    if (muzzle === "supp") return cold ? list[0] : list[1 + (Math.random() * 2 | 0)];
    return list[Math.random() * list.length | 0];
  }
  // Кнопка фонаря на торце: резиновый колпачок — глухой «тык» и щелчок микропереключателя.
  tailcap(on) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.thud(t, 1800, 0.12, 0.012, 0);
    this.clank(t + 4e-3, on ? 5200 : 4600, 0.1, 8e-3, 4, 0.1, 0.02);
  }
  // Замена батарей: отвернуть крышку, вытряхнуть CR123, вставить, завернуть.
  batteryChange() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) this.slide(t + i * 0.07, 2600, 3400, 0.05, 0.05, 0.05);
    this.clank(t + 0.42, 3200, 0.12, 0.02, 3, 0.2);
    this.clank(t + 0.47, 2900, 0.1, 0.02, 3, 0.25);
    this.thud(t + 0.8, 1500, 0.15, 0.02, 0);
    this.thud(t + 0.9, 1500, 0.15, 0.02, 0);
    for (let i = 0; i < 5; i++) this.slide(t + 1.05 + i * 0.07, 3400, 2600, 0.05, 0.05, 0.05);
    this.clank(t + 1.45, 4200, 0.12, 0.012, 4, 0);
  }
  play(name, o = {}) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx;
    const P = this.profile;
    const s = c.createBufferSource();
    s.buffer = this.foley.buffer(name, { fam: P.family, cal: P.cal, kind: o.kind });
    s.playbackRate.value = 0.96 + Math.random() * 0.08;
    const g = c.createGain();
    g.gain.value = (o.gain ?? 1) * 0.9;
    s.connect(g);
    this.out(g, o.wet ?? 0.07, o.pan ?? 0.12);
    s.start(c.currentTime + (o.delay || 0));
  }
  dryFire() {
    this.play("dryFire", { gain: 0.7 });
  }
  selector() {
    this.play("selector", { gain: 0.8 });
  }
  click() {
    this.play("click", { gain: 0.6, pan: 0 });
  }
  magOut(kind = "steel") {
    this.play("magOut", { kind, gain: 0.95 });
  }
  magInsert(kind = "steel") {
    this.play("magInsert", { kind, gain: 0.85 });
  }
  magIn(kind = "steel") {
    this.play("magIn", { kind, gain: 1.1 });
  }
  magDropGround(kind = "steel") {
    this.play("magGround", { kind, gain: 0.7, pan: 0.3, wet: 0.12 });
  }
  chargeBack() {
    this.play("chargeBack", { gain: 0.95 });
  }
  chargeRelease() {
    this.play("chargeRelease", { gain: 1.05 });
  }
  boltCatch() {
    this.play("boltCatch", { gain: 1.05 });
  }
  boltSlam() {
    this.play("boltSlam", { gain: 1 });
  }
  hkLock() {
    this.play("hkLock", { gain: 0.9 });
  }
  pumpBack() {
    this.play("pumpBack", { gain: 1 });
  }
  pumpForward() {
    this.play("pumpForward", { gain: 1.05 });
  }
  shellLoad() {
    this.play("shellLoad", { gain: 0.95, pan: 0 });
  }
  // Заранее синтезировать буферы этого оружия (вызывается при первом взаимодействии).
  warm() {
    if (!this.ctx) return;
    const P = this.profile, o = { fam: P.family, cal: P.cal };
    const names = P.family === "m870" ? ["pumpBack", "pumpForward", "shellLoad"] : ["magOut", "magInsert", "magIn", "magGround", "chargeBack", "chargeRelease", "boltCatch"];
    for (const n of names) for (const kind of ["steel", "poly"]) this.foley.buffer(n, { ...o, kind });
    for (const n of ["dryFire", "selector", "click", "hkLock", "boltSlam"]) this.foley.buffer(n, o);
    for (const kind of ["brass", "steel", "hull"]) this.foley.buffer("casing", { ...o, kind });
    this.foley.buffer("cycle", { fam: P.family, rpm: P.rpm });
    this.shotBuffer(this.shotFamily(), this.muzzle || "bare");
  }
  // Установка модуля: щелчки прижима или храповик резьбы.
  attach(kind) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    if (kind === "thread" || kind === "supp") {
      for (let i = 0; i < 7; i++) this.clank(t + i * 0.055, 3600 + Math.random() * 400, 0.08, 0.01, 4, 0);
      this.clank(t + 0.42, 2300, 0.18, 0.03, 3, 0);
    } else if (kind === "poly") {
      this.thud(t, 1400, 0.25, 0.04);
      this.clank(t + 0.03, 3e3, 0.1, 0.015, 4, 0);
    } else {
      this.clank(t, 2600, 0.2, 0.025, 3, 0);
      this.clank(t + 0.09, 3900, 0.14, 0.015, 4, 0);
      this.slide(t + 0.12, 3e3, 5e3, 0.05, 0.08, 0);
    }
  }
  fold() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.clank(t, 2400, 0.22, 0.025, 3, 0.1);
    this.clank(t + 0.22, 1900, 0.35, 0.035, 3, 0.1);
  }
  bipod() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.slide(t, 1500, 3e3, 0.08, 0.12);
    this.clank(t + 0.12, 2100, 0.3, 0.035, 3, 0);
    this.clank(t + 0.15, 2300, 0.25, 0.035, 3, 0);
  }
  // Гильза падает на бетон/землю.
  casing(delay = 0.5, kind = "brass", vol = 1) {
    this.play("casing", { kind, gain: 0.5 * vol, delay, pan: 0.35 + Math.random() * 0.3, wet: 0.1 });
  }
  // Попадание в стальную мишень: плита действительно звенит; приходит с задержкой по дальности.
  ding(dist, level = 1) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime + dist / 343;
    const a = Math.min(1, 12 / Math.max(6, dist)) * level;
    for (const [f, k] of [[820, 1], [2150, 0.6], [3710, 0.35], [5120, 0.2]]) {
      const o = c.createOscillator();
      o.frequency.value = f * (0.98 + Math.random() * 0.04);
      const g = c.createGain();
      this.env(g, t, 1e-3, 0.22 * a * k, 0.18 / (1 + k * 0.2), 1.4);
      o.connect(g);
      this.out(g, 0.5);
      o.start(t);
      o.stop(t + 1.45);
    }
  }
  thump(dist) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + dist / 343;
    const a = Math.min(1, 10 / Math.max(6, dist));
    const c = this.ctx, s = this.src(this.pink, t, 0.2);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    const g = c.createGain();
    this.env(g, t, 3e-3, 0.25 * a, 0.05, 0.2);
    s.connect(lp).connect(g);
    this.out(g, 0.3);
  }
};

