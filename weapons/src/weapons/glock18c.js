// src/weapons/glock18c.js
// Glock 18C: автоматический пистолет со сцепленным затвором (схема Браунинга), компенсированный ствол,
// переводчик огня слева на кожухе-затворе. Единицы — мм, ось канала y = 0, x = 0 — казённый срез.
var GL = {
  S_REAR: -74,
  S_FRONT: 112,
  S_TOP: 17,
  S_BOT: -9,
  S_HW: 12.7,
  SIGHT_Y: 22.5,
  REAR_X: -66,
  FRONT_X: 104,
  F_TOP: -9,
  GRIP_A: 21
};
// сечение кожуха: плоские борта, скосы сверху (у Gen4 — плоская «крыша» с фасками)
function glSlideSec(port) {
  const { S_TOP: T0, S_BOT: B, S_HW: W } = GL;
  if (port) return [[-W, B, 1], [W, B, 1], [W, -1], [W - 4, -1], [W - 4, T0 - 3], [W - 7, T0], [-W + 3, T0, 1], [-W, T0 - 4, 1]];
  return [[-W, B, 1], [W, B, 1], [W, T0 - 4, 1], [W - 3, T0, 1], [-W + 3, T0, 1], [-W, T0 - 4, 1]];
}
function glSlide(ctx, o) {
  const { extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylX: cX, cylZ: cZ, node: nd, shape: sh, slot: sl } = ctx.G;
  const k = ctx.kit();
  const { S_REAR: R4, S_FRONT: F, S_TOP: T0, S_HW: W, SIGHT_Y: SY, REAR_X: RX, FRONT_X: FX } = GL;
  const M = "steelMatte";
  k.add(M, exX(glSlideSec(false), R4, -18, { bevel: 0.8 }));
  k.add(M, exX(glSlideSec(true), -18, 38, { bevel: 0.4 }));
  const front = o.mos ? glSlideSec(false) : glSlideSec(false);
  k.add(M, exX(front, 38, F, { bevel: 1.2 }));
  // окно выброса: тёмная внутренность за пеньком ствола
  k.add("lensBlack", T2(bx(54, 14, 1), { p: [10, 7.5, W - 4.2] }));
  // рифление сзади (и спереди у Gen5)
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) k.add(M, T2(bx(1.4, 17, 1, { bevel: 0.3 }), { p: [R4 + 6 + i * 3.4, 3, s * (W + 0.1)], r: [0, 0, -8] }));
  if (o.frontSerr) for (let i = 0; i < 7; i++) for (const s of [-1, 1]) k.add(M, T2(bx(1.4, 14, 1, { bevel: 0.3 }), { p: [F - 30 + i * 3.4, 2, s * (W + 0.1)], r: [0, 0, 8] }));
  // компенсаторные окна 18C на крыше кожуха
  if (o.comp) for (const x of [F - 30, F - 16]) k.add("lensBlack", T2(exZ(sh(sl(-5, 5, 0, 6)), 0.8, { bevel: 0.2 }), { r: [-90, 0, 0], p: [x, T0 + 0.05, 0] }));
  // фрезеровка MOS: заглушка-крышка или посадочное место под коллиматор
  if (o.mos) {
    k.add("lensBlack", T2(bx(50, 0.6, 21), { p: [-44, T0 + 0.05, 0] }));
  }
  // переводчик огня: ось на левом борту сзади, флажок
  const s = ctx.kit();
  s.add("steelWorn", cZ(3.6, -W - 1.4, -W + 0.2, { seg: 18 }));
  s.add("steelWorn", T2(exZ([[-2.4, 0, 1], [2.4, 0, 1], [1.8, -12, 1.5], [-1.8, -12, 1.5]], 1.4, { bevel: 0.4 }), { p: [0, 0, -W - 1.6] }));
  const sel = nd("selector", [s.build()], { p: [R4 + 14, 6, 0] });
  for (const [ang, m] of [[0, "paintWhite"], [-38, "paintRed"]]) {
    const r = (ang + 180) * Math.PI / 180;
    k.add(m, T2(bx(1.8, 1.8, 0.4, { bevel: 0.4 }), { p: [R4 + 14 - Math.sin(r) * 14.5, 6 + Math.cos(r) * 14.5, -W - 0.15] }));
  }
  // затыльная крышка и выход ударника
  k.add("poly", exX(rrect(0, 3, 15, 16, 2), R4 - 0.8, R4 + 0.6, { bevel: 0.3 }));
  // прицельные: целик с белой «П», мушка с точкой
  const tall = o.mos ? 4 : 0;
  k.add("poly", exZ([[RX - 7, T0], [RX + 5, T0], [RX + 3, SY + tall, 1], [RX - 7, SY + tall, 1]], 20, { bevel: 0.6 }));
  k.add("lensBlack", exZ([[RX - 7.5, SY - 3.4 + tall], [RX + 3.5, SY - 3.4 + tall], [RX + 3.5, SY + 0.2 + tall], [RX - 7.5, SY + 0.2 + tall]], 3.6, { bevel: 0 }));
  for (const z of [-2.8, 2.8]) k.add("paintWhite", T2(bx(0.4, 3, 1.2), { p: [RX - 7.6, SY - 1.6 + tall, z] }));
  k.add("poly", exZ([[FX - 3, T0], [FX + 3, T0], [FX + 2.6, SY + tall, 0.8], [FX - 2.6, SY + tall, 0.8]], 3.6, { bevel: 0.4 }));
  k.add(o.night ? "tritium" : "paintWhite", T2(cX(1.1, FX - 3.1, FX - 2.6, { seg: 14 }), { p: [0, SY - 2 + tall, 0] }));
  if (o.night) k.add("tritium", T2(cX(1, RX - 7.9, RX - 7.4, { seg: 12 }), { p: [0, SY - 2 + tall, 3.6] })), k.add("tritium", T2(cX(1, RX - 7.9, RX - 7.4, { seg: 12 }), { p: [0, SY - 2 + tall, -3.6] }));
  const root = nd("slide_" + o.id, [k.build(), sel]);
  if (o.mos) root.add(ctx.mount({ id: "mos", type: "mos", p: [-44, T0 - 1.6, 0] }));
  return {
    root,
    irons: { rear: [RX - 2, SY + tall - 0.6, 0], front: [FX, SY + tall - 0.6, 0], type: "notch" },
    selector: { node: sel, angles: { semi: 0, auto: -38 }, axis: "z" }
  };
}
function glFrame(ctx, k, nodes) {
  const { extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylZ: cZ, node: nd, shape: sh, picatinny: pic } = ctx.G;
  const P = "poly";
  const a = GL.GRIP_A * Math.PI / 180, tn = Math.tan(a);
  // рамка: пылезащитная часть под кожухом с рельсом, спусковая скоба квадратной формы
  k.add(P, exX([[-12.4, -9, 1], [12.4, -9, 1], [12, -22, 3], [-12, -22, 3]], -70, 96, { bevel: 1.2 }));
  for (const s of [-1, 1]) k.add(P, exX([[s * 11.6, -8.6], [s * 12.4, -8.6], [s * 12.4, -12], [s * 11.6, -12]], -70, 96, { bevel: 0.2 }));
  k.add(P, exZ(sh([[34, -22, 1], [-20, -22], [-26, -44, 4], [26, -48, 3], [36, -44, 3]], [[[26, -24.5], [-16, -24.5], [-20, -40, 3], [22, -43, 2], [28, -38, 2]]]), 12, { bevel: 1.4 }));
  // рукоять под углом 21°: текстура, выемки под пальцы, выступ «бобровый хвост»
  const gy = (y) => tn * (y + 22);
  const gf = [[-24, -22, 2], [-26 + gy(-50), -50, 6], [-24 + gy(-64), -64, 8], [-26 + gy(-78), -78, 6], [-24 + gy(-98), -98, 8], [-28 + gy(-112), -112, 3], [-74 + gy(-112), -112, 3], [-74 + gy(-60), -60, 10], [-78 + gy(-30), -30, 8], [-84, -20, 4], [-76, -12, 2], [-60, -10, 2]];
  k.add(P, exZ(gf.map(([x, y, r]) => [x, y, r || 0]), 30, { bevel: 5, curve: 8 }));
  for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) for (const s of [-1, 1]) k.add(P, T2(bx(2, 2, 0.8, { bevel: 0.3 }), { p: [-50 + gy(-40 - i * 5.6) + j * 5, -40 - i * 5.6, s * 14.9], r: [0, 0, GL.GRIP_A] }));
  // штифты, рычаг затворной задержки, рычаг разборки
  for (const [x, y] of [[-40, -16], [-10, -16], [-60, -18]]) for (const s of [-1, 1]) k.add("steelWorn", T2(cZ(1.6, 0, 0.6, { seg: 10 }), { p: [x, y, s > 0 ? 12.4 : -13] }));
  k.add("steelMatte", exZ([[-36, -12], [-18, -12], [-16, -14, 1], [-36, -15, 1]], 1.4, { bevel: 0.3, z: -13.2 }));
  for (const s of [-1, 1]) k.add("steelMatte", exZ([[0, -10.4], [10, -10.4], [10, -13, 0.6], [0, -13, 0.6]], 1, { bevel: 0.2, z: s * 12.9 }));
  // рельс рамки: один паз
  const r = pic(24, { base: 4 });
  k.add(P, r.geo, { r: [180, 0, 0], p: [58, -22, 0] });
  const rail = ctx.railMount("frameRail", [58 + r.first, -22, 0], "bottom", r.slots, { axis: "bottom" });
  // спусковой крючок с предохранительной клавишей
  const t = ctx.kit();
  t.add(P, exZ([[-2, 2], [3, 2], [3, -6, 2], [1, -16, 4], [-3, -19, 2], [-5, -17], [-2, -7, 3]], 6, { bevel: 0.9 }));
  t.add("poly", exZ([[-0.6, -4], [1.6, -4], [0.6, -15, 1], [-1.2, -15, 1]], 7.4, { bevel: 0.3 }));
  nodes.trigger = nd("trigger", [t.build()], { p: [6, -24, 0] });
  return [nodes.trigger, rail];
}
function glBase(ctx) {
  const { node: nd } = ctx.G;
  const k = ctx.kit();
  const nodes = {};
  const extra = glFrame(ctx, k, nodes);
  const body = k.build("frame");
  const { mount: mount2 } = ctx;
  // кожух-затвор — «рама»: движется при выстреле и остаётся на задержке
  nodes.carrier = nd("slide", [mount2({ id: "slide", type: "slide", p: [0, 0, 0] })]);
  const root = nd("glock18c", [body, ...extra, nodes.carrier]);
  root.add(mount2({ id: "barrel", type: "barrel", p: [0, 0, 0] }));
  const mw = mount2({ id: "magwell", type: "magwell", p: [-29, -16, 0] });
  mw.rotation.z = -GL.GRIP_A * Math.PI / 180;
  root.add(mw);
  root.add(mount2({ id: "backstrap", type: "backstrap", p: [-84, -40, 0] }));
  root.add(mount2({ id: "stock", type: "stock", p: [-86, -30, 0] }));
  return {
    root,
    nodes,
    anim: { carrierTravel: 56, triggerAngle: 0.28 },
    eject: { p: [10, 10, 14], dir: [0.1, 0.8, 1], speed: 3 },
    muzzle: [GL.S_FRONT, 0, 0],
    eyeX: -560,
    pivotX: -80,
    focus: { center: [10, -40, 0], size: 330 }
  };
}
/* --------------------------------------------------------------- стволы */
function glBarrel(ctx, o) {
  const { latheX: lX, extrudeX: exX, T: T2, box: bx, node: nd, ringGrooves: rg, rrect: rr } = ctx.G;
  const k = ctx.kit();
  const L = o.threaded ? 128 : 114;
  // пенёк с патронником виден в окне выброса
  k.add("steelBright", exX(rr(0, 7.5, 17, 13, 2), -2, 36, { bevel: 0.8 }));
  k.add("steelBright", lX([[36, 0], [36, 7.2], [L - (o.threaded ? 16 : 0), 7], [L - (o.threaded ? 16 : 0), 0]], { seg: 28 }));
  if (o.threaded) k.add("steelBright", rg(6.6, L - 16, L, 10, 0.35, { seg: 24 }));
  k.add("lensBlack", T2(lX([[0, 0], [0, 4.6], [1, 4.6], [1, 0]], { seg: 20 }), { p: [L - (o.threaded ? 0 : 0.4), 0, 0] }));
  // порты компенсатора на стволе (совпадают с окнами кожуха)
  if (o.comp) for (const x of [GL.S_FRONT - 30, GL.S_FRONT - 16]) k.add("lensBlack", T2(bx(8, 1, 4, { bevel: 0.4 }), { p: [x, 7, 0] }));
  const out = { root: nd("barrel", [k.build()]) };
  if (o.threaded) out.root.add(ctx.mount({ id: "muzzle", type: "thread", p: [L - 16, 0, 0] }));
  return out;
}
/* --------------------------------------------------------------- дульные */
function osprey(ctx) {
  const { extrudeX: exX, latheX: lX, T: T2, box: bx, node: nd, cylX: cX, rrect: rr } = ctx.G;
  const k = ctx.kit();
  const L = 170;
  // SilencerCo Osprey 9: эксцентричный корпус (ось ниже канала), видны штатные прицельные
  k.add("steelMatte", lX([[0, 0], [0, 8.4], [18, 8.4], [18, 0]], { seg: 28 }));
  k.add("alu", exX(rr(0, -7, 34, 38, 12), 12, L, { bevel: 2 }));
  for (const x of [40, 110]) k.add("alu", exX(rr(0, -7, 35, 39, 12.5), x, x + 3, { bevel: 0.6 }));
  k.add("lensBlack", cX(5, L - 0.3, L + 0.3, { seg: 18 }));
  return { root: nd("osprey", [k.build()]), muzzle: { x: L, kind: "supp", flash: 0.03 } };
}
function obsidian(ctx) {
  const { latheX: lX, node: nd, cylX: cX, ringGrooves: rg, tubeX: tb } = ctx.G;
  const k = ctx.kit();
  const L = 190, R4 = 17.5;
  k.add("steelMatte", lX([[0, 0], [0, 8.4], [30, 8.4], [30, 0]], { seg: 28 }));
  k.add("steelMatte", lX([[4, 0], [4, R4 - 3], [8, R4], [L - 5, R4], [L, R4 - 4], [L, 5.6], [L - 2, 5], [L - 2, 0]], { seg: 44, crease: 30 }));
  k.add("steelMatte", rg(R4 + 0.3, 8, 28, 7, 0.5, { seg: 44 }));
  k.add("steelMatte", tb(R4 + 0.6, R4 - 0.2, L - 40, L - 36, { seg: 44 }));
  k.add("lensBlack", cX(5.2, L - 2.3, L + 0.05, { seg: 18 }));
  return { root: nd("obsidian", [k.build()]), muzzle: { x: L, kind: "supp", flash: 0.03 } };
}
function glComp(ctx) {
  const { extrudeX: exX, T: T2, box: bx, node: nd, rrect: rr, cylY: cY } = ctx.G;
  const k = ctx.kit();
  // навинчиваемый компенсатор под ширину кожуха
  k.add("steelMatte", exX(rr(0, 2, 25, 28, 5), 0, 34, { bevel: 1.4 }));
  for (let i = 0; i < 3; i++) k.add("lensBlack", T2(cY(3, 14, 16.2, { seg: 14 }), { p: [8 + i * 9, 0, 0] }));
  for (const s of [-1, 1]) k.add("lensBlack", T2(bx(10, 8, 1, { bevel: 0.6 }), { p: [18, 4, s * 12.6] }));
  k.add("lensBlack", ctx.G.cylX(5, 33.8, 34.2, { seg: 16 }));
  return { root: nd("comp", [k.build()]), muzzle: { x: 34, kind: "comp", flash: 0.8 } };
}
function glCap(ctx) {
  const { latheX: lX, flutesX: fl, node: nd } = ctx.G;
  const k = ctx.kit();
  k.add("steelMatte", lX([[0, 0], [0, 8.6], [14, 8.6], [16, 7.4], [16, 0]], { seg: 28 }));
  k.add("steelMatte", fl(8.6, 2, 14, 14, 1.2, 0.5));
  return { root: nd("cap", [k.build()]), muzzle: { x: 16, kind: "bare", flash: 1 } };
}
/* --------------------------------------------------------------- магазины */
function glMag(ctx, o) {
  const { T: T2, box: bx, extrudeZ: exZ } = ctx.G;
  const m = boxMag(ctx, { R: 0, d0: 34, w: 22, lipH: 10, lipX0: 4, lipX1: 26, lipRise: 2.4, lipCurl: 2, cal: "9x19", mat: "poly", plate: "poly", plateH: 7, plateOver: 7, plateW: 5, catchX: -22, catchY: -30, ...o });
  // окна-указатели патронов на задней стенке
  const k = ctx.kit();
  for (let i = 0; i < Math.min(8, Math.floor(o.len / 22)); i++) k.add("paintWhite", T2(bx(0.4, 2.2, 3), { p: [-34.1, -14 - i * 12, 0] }));
  m.root.add(k.build());
  return m;
}
/* --------------------------------------------------------------- накладки и упор */
function backstrap(ctx, o) {
  const { extrudeZ: exZ, node: nd } = ctx.G;
  const k = ctx.kit();
  const a = GL.GRIP_A * Math.PI / 180, tn = Math.tan(a);
  const gy = (y) => tn * y;
  const t = o.t;
  k.add(o.mat || "poly", exZ([[0, 22, 3], [-t + gy(0), 0, 4], [-t + gy(-60), -60, 6], [-t + 2 + gy(-72), -72, 3], [2 + gy(-72), -72, 1], [2 + gy(0), 0, 1], [4, 22, 1]], 26, { bevel: Math.min(3, t * 0.45), curve: 6 }));
  return { root: nd("bs", [k.build()]) };
}
function g18Stock(ctx) {
  const { extrudeZ: exZ, T: T2, box: bx, wire: wr, node: nd, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  // плечевой упор Glock 18: пластиковая «лопатка» на стальной раме, крепится в паз рукояти
  k.add("steelMatte", exZ([[0, 8], [-18, 8], [-18, -30], [0, -30]], 20, { bevel: 1.4 }));
  for (const s of [-1, 1]) k.add("steelMatte", wr([[-14, 4, s * 8], [-120, 8, s * 10], [-270, -6, s * 12]], 3, { n: 40 }));
  k.add("steelMatte", wr([[-18, -26, 0], [-150, -40, 0], [-270, -80, 0]], 3, { n: 40 }));
  k.add("poly", exZ([[-262, 14, 6], [-284, 14, 6], [-284, -118, 8], [-262, -112, 6]], 38, { bevel: 3 }));
  k.add("rubber", exZ([[-284, 14, 6], [-290, 14, 6], [-290, -120, 8], [-284, -118, 6]], 40, { bevel: 2 }));
  return { root: nd("g18stock", [k.build()]) };
}
var glock18c_default = {
  id: "glock18c",
  family: "glock",
  title: "Glock 18C",
  short: "Glock 18C",
  caliber: "9×19 Парабеллум",
  cal: "9x19",
  thread: "m13.5x1L",
  boltHold: true,
  chargeLabel: "передёрнуть кожух",
  kick: 1.05,
  hipMoa: 45,
  flashSize: 0.62,
  specs: [["Ствол", "114 мм"], ["Длина", "186 мм"], ["Темп", "1200 выстр/мин"], ["Масса", "0,62 кг"]],
  base: { weight: 620, length: 186, ergo: 72, recoilV: 100, recoilH: 85, moa: 4.5, velocity: 360, range: 50, loud: 160, flash: 55, adsTime: 170, rpm: 1200, mag: 17 },
  audio: { cal: "9x19", mech: 0.85, shot: { blastF: 8200, blastT: 0.045, bodyF: 190, body: 0.4, harsh: 0.22, level: 0.9 } },
  modes: ["semi", "auto"],
  build: glBase,
  slots: [
    { id: "slide", label: "Кожух-затвор", group: "Верх", accepts: ["g18slide"], mount: "slide", required: true },
    { id: "barrel", label: "Ствол", group: "Верх", accepts: ["g18barrel"], mount: "barrel", required: true },
    { id: "muzzle", label: "Дульное устройство", group: "Верх", accepts: ["muzzle"], mount: "muzzle" },
    { id: "optic", label: "Коллиматор", group: "Верх", accepts: ["micro"], mount: "mos" },
    { id: "light", label: "Фонарь / ЛЦУ", group: "Рамка", accepts: ["plight"], rails: ["frameRail"], prefer: "front" },
    { id: "mag", label: "Магазин", group: "Рамка", accepts: ["mag"], mount: "magwell" },
    { id: "backstrap", label: "Накладка рукояти", group: "Рамка", accepts: ["g18bs"], mount: "backstrap" },
    { id: "stock", label: "Плечевой упор", group: "Рамка", accepts: ["g18stock"], mount: "stock" }
  ],
  parts: [
    { id: "sl_18c", cat: "g18slide", name: "Кожух 18C", desc: "Два компенсаторных окна над портами ствола", stats: { weight: 290 }, build: (c) => glSlide(c, { id: "18c", comp: true }) },
    { id: "sl_mos", cat: "g18slide", name: "Кожух 18C MOS", desc: "Фрезеровка под коллиматор, высокие прицельные", stats: { weight: 285 }, build: (c) => glSlide(c, { id: "mos", comp: true, mos: true }) },
    { id: "sl_night", cat: "g18slide", name: "Кожух 18, тритиевые прицельные", desc: "Без окон; Meprolight 3 точки, насечки спереди", stats: { weight: 300, flash: -10 }, build: (c) => glSlide(c, { id: "night", night: true, frontSerr: true }) },
    { id: "br_comp", cat: "g18barrel", name: "Ствол 18C с портами", desc: "Газ вверх через окна: меньше подброс", needs: (cfg) => cfg.slide?.id !== "sl_night", stats: { weight: 110, "recoilV%": -16, flash: 15, loud: 1 }, build: (c) => glBarrel(c, { comp: true }) },
    { id: "br_plain", cat: "g18barrel", name: "Ствол без портов", desc: "Штатный Glock 17: чуть выше скорость пули", stats: { weight: 115, velocity: 8 }, build: (c) => glBarrel(c, {}) },
    { id: "br_thread", cat: "g18barrel", name: "Ствол с резьбой M13,5×1 лев.", desc: "Выступает на 14 мм — под глушитель и компенсатор", stats: { weight: 130, length: 14, velocity: 10 }, build: (c) => glBarrel(c, { threaded: true }) },
    { id: "g_cap", cat: "muzzle", name: "Колпачок резьбы", desc: "Защищает резьбу", fit: { thread: ["m13.5x1L"] }, stats: { weight: 10, length: 2 }, build: glCap },
    { id: "g_comp", cat: "muzzle", name: "Навинчиваемый компенсатор", desc: "Три порта вверх: очередь заметно ровнее", fit: { thread: ["m13.5x1L"] }, stats: { weight: 55, length: 34, "recoilV%": -24, "recoilH%": -10, flash: 20, loud: 3 }, build: glComp },
    { id: "osprey9", cat: "muzzle", name: "SilencerCo Osprey 9", desc: "Эксцентричный: штатные прицельные не перекрыты", fit: { thread: ["m13.5x1L"] }, stats: { weight: 300, length: 170, loud: -26, flash: -50, "recoilV%": -10, ergo: -8, adsTime: 20 }, build: osprey },
    { id: "obsidian9", cat: "muzzle", name: "Rugged Obsidian 9", desc: "Разборный, с «толкателем» Ноилсона", fit: { thread: ["m13.5x1L"] }, stats: { weight: 320, length: 190, loud: -28, flash: -50, "recoilV%": -9, ergo: -9, adsTime: 22 }, build: obsidian },
    { id: "gm17", cat: "mag", name: "Магазин 17", desc: "Штатный, полимер со стальным вкладышем", stats: { weight: 80, mag: 17 }, build: (c) => glMag(c, { len: 104, cap: 17 }) },
    { id: "gm19", cat: "mag", name: "Магазин 19 (пятка +2)", desc: "Штатный 17 с удлинённой пяткой", stats: { weight: 90, mag: 19, ergo: 0 }, build: (c) => glMag(c, { len: 116, cap: 19 }) },
    { id: "gm33", cat: "mag", name: "Магазин 33", desc: "Длинный штатный Glock: для автоматического огня", stats: { weight: 150, mag: 33, ergo: -4, adsTime: 10 }, build: (c) => glMag(c, { len: 196, cap: 33 }) },
    { id: "gdrum50", cat: "mag", name: "Барабан KCI 50", desc: "Тяжёлый: пистолет тянет вниз", stats: { weight: 520, mag: 50, ergo: -14, adsTime: 34, "recoilV%": -10 }, build: (c) => drumMag(c, { R: 0, len: 104, neck: 58, d0: 34, w: 22, lipH: 10, lipX0: 4, lipX1: 26, cal: "9x19", mat: "poly", cap: 50, drum: [-18, -86, 46, 46] }) },
    { id: "bs_m", cat: "g18bs", name: "Накладка M", desc: "Спинка рукояти +2 мм", stats: { weight: 6, ergo: 2 }, build: (c) => backstrap(c, { t: 2.4 }) },
    { id: "bs_l", cat: "g18bs", name: "Накладка L с «хвостом»", desc: "+4 мм, для большой ладони", stats: { weight: 10, ergo: 1, "recoilH%": -3 }, build: (c) => backstrap(c, { t: 4.6 }) },
    { id: "st_g18", cat: "g18stock", name: "Упор Glock 18 (рамочный)", desc: "Три точки опоры — очередь можно удержать", stats: { weight: 380, ergo: -6, "recoilV%": -38, "recoilH%": -40, adsTime: 60, moa: -1 }, build: g18Stock }
  ],
  defaults: {
    slide: "sl_18c",
    barrel: "br_comp",
    muzzle: null,
    optic: null,
    light: null,
    mag: "gm17",
    backstrap: null,
    stock: null
  }
};

