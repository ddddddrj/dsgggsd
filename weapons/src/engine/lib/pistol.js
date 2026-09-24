// src/engine/lib/pistol.js
// Пистолетные модули: коллиматоры на вырез кожуха (MOS) и подствольные фонари на рамку.
function microBase(k) {
  // переходная пластина MOS: ложится в фрезеровку кожуха
  k.add("steelMatte", extrudeX(rrect(0, -0.6, 25, 2.2, 0.8), -24, 24, { bevel: 0.4 }));
  for (const x of [-15, 15]) k.add("steel", T(cylY(2.2, 0.4, 1.4, { seg: 12 }), { p: [x, 0, 0] }));
}
function rmrPistol(ctx) {
  const k = ctx.kit();
  microBase(k);
  const m = ctx.kit();
  const A = rmrBody(ctx, m);
  const glass = lens(ctx, extrudeX(shape(rrect(0, A + 0.5, 18.6, 13.4, 5)), 6, 7, { bevel: 0.2 }), "glassAmber");
  const body = node("rmr", [m.build(), glass]);
  body.position.y = 0.6;
  return { root: node("rmr_p", [k.build(), body]), sight: { node: body, y: A + 0.5, z: 0, x0: -22, x1: 15, r: 8, mag: 1, reticle: "dot", lens: glass } };
}
function hs507(ctx) {
  const k = ctx.kit();
  microBase(k);
  const A = 16;
  k.add("alu", extrudeX(rrect(0, 5, 26, 10, 2.4), -22, 22, { bevel: 1.2 }));
  // капюшон: скруглённая арка с плоскими «плечами»
  const arch = (w, h, y0) => {
    const pts = [[w, y0], [w, h - w * 0.7]];
    for (let i = 1; i < 12; i++) {
      const a = i / 12 * Math.PI;
      pts.push([Math.cos(a) * w, h - w * 0.7 + Math.sin(a) * w * 0.7]);
    }
    pts.push([-w, h - w * 0.7], [-w, y0]);
    return pts;
  };
  k.add("alu", extrudeX(shape(arch(13, 27, 8), [arch(10.2, 24.4, 9.5)]), -6, 16, { bevel: 1 }));
  k.add("alu", extrudeZ([[-22, 9], [-7, 9], [-7, 13, 2], [-12, 14, 2], [-22, 12, 2]], 24, { bevel: 1.2 }));
  // батарейный лоток справа и кнопки слева
  k.add("alu", T(extrudeX(rrect(0, 0, 4, 11, 1.5), -18, 2, { bevel: 0.8 }), { p: [0, 8, 13.6] }));
  k.add("steel", T(cylZ(1.4, 15.4, 16.4, { seg: 10 }), { p: [-15, 8, 0] }));
  for (const x of [-16, -8]) k.add("rubber", T(cylZ(2.6, -14.8, -13, { c: 0.6, seg: 14 }), { p: [x, 9, 0] }));
  k.add("steel", T(cylY(2.4, 13.5, 15, { seg: 14 }), { p: [-15, 0, 0] }));
  const glass = lens(ctx, extrudeX(shape(arch(10, 24.2, 9.6)), 12, 13, { bevel: 0.2 }), "glassBlue");
  return { root: node("hs507", [k.build(), glass]), sight: { y: A + 0.6, z: 0, x0: -22, x1: 16, r: 9, mag: 1, reticle: "holo", lens: glass } };
}
function acroP2(ctx) {
  const k = ctx.kit();
  microBase(k);
  const A = 18;
  k.add("alu", extrudeX(shape(rrect(0, 15, 30, 29, 5), [rrect(0, A, 22, 17, 3)]), -24, 23, { bevel: 1.4 }));
  k.add("alu", extrudeX(rrect(0, 2.5, 30, 5, 1.5), -24, 23, { bevel: 1 }));
  for (const x of [-26, 25]) k.add("alu", T(extrudeX(shape(rrect(0, 15, 31, 30, 5.5), [rrect(0, A, 21, 16, 3)]), -1.2, 1.2, { bevel: 0.6 }), { p: [x, 0, 0] }));
  k.add("alu", T(cylZ(6, 15, 19, { c: 1, seg: 24 }), { p: [-10, 14, 0] }));
  for (const x of [4, 12]) k.add("rubber", T(cylZ(2.4, -16.8, -15, { c: 0.6, seg: 14 }), { p: [x, 21, 0] }));
  const glass = lens(ctx, extrudeX(rrect(0, A, 22, 17, 3), 18, 19, { bevel: 0.2 }), "glassRed");
  const rear = lens(ctx, extrudeX(rrect(0, A, 22, 17, 3), -22, -21, { bevel: 0.2 }), "glassBlue");
  return { root: node("acro", [k.build(), glass, rear]), sight: { y: A, z: 0, x0: -24, x1: 23, r: 8, mag: 1, reticle: "dot", lens: glass } };
}
// Фонарь на рамку: y растёт от планки (на нижней грани — вниз от рамки).
function pistolLight(ctx, o) {
  const k = ctx.kit();
  const { x0, x1, w, h, headR } = o;
  const cy = 6 + h / 2;
  // зацеп рельса + поперечина-упор, входящая в паз
  k.add(o.mat || "alu", extrudeX(shape([[-w / 2, 0.5, 1], [w / 2, 0.5, 1], [w / 2, 7], [-w / 2, 7]]), -14, 12, { bevel: 0.8 }));
  for (const s of [-1, 1]) k.add(o.mat || "alu", extrudeX([[s * 9.6, -1], [s * 12, -1], [s * 12, 1.5], [s * 9.6, 1.5]], -14, 12, { bevel: 0.3 }));
  k.add("steel", T(box(4, 3, 16), { p: [0, -0.6, 0] }));
  k.add(o.mat || "alu", extrudeX(rrect(0, cy, w, h, Math.min(w, h) * 0.3), x0, x1 - 14, { bevel: 1.6 }));
  k.add(o.mat || "alu", T(latheX([[x1 - 16, 0], [x1 - 16, h * 0.46], [x1 - 10, headR], [x1, headR], [x1, headR - 1.6], [x1 - 1.2, 0]], { seg: 36 }), { p: [0, cy, 0] }));
  k.add("steel", T(tubeX(headR + 0.2, headR - 2.2, x1 - 2.4, x1 + 0.4, { seg: 36 }), { p: [0, cy, 0] }));
  // амбидекстральные клавиши сзади
  for (const s of [-1, 1]) k.add("poly", T(extrudeZ([[0, 0], [9, 0], [12, 7, 2], [0, 9, 2]], 4, { bevel: 0.8 }), { p: [x0 - 8, cy - 3, s * (w / 2 - 1)] }));
  const root = node(o.name, [k.build()]);
  const le = lens(ctx, cylX(headR - 2.1, x1 - 1.2, x1 - 0.4, { seg: 32 }).translate(0, cy, 0), "lampLens");
  le.renderOrder = 0;
  le.material.transparent = false;
  root.add(le);
  const out = { root, light: { p: [x1 + 1, cy, 0], lens: le, lumens: o.lm } };
  if (o.laser) {
    const lk = ctx.kit();
    const lz = 0, ly = cy + h / 2 + 4;
    lk.add(o.mat || "alu", extrudeX(rrect(0, ly, 12, 9, 3), x1 - 30, x1 - 6, { bevel: 1 }));
    lk.add("steel", T(tubeX(3.2, 2, x1 - 8, x1 - 4, { seg: 16 }), { p: [0, ly, lz] }));
    root.add(lk.build());
    const ll = lens(ctx, cylX(2, x1 - 5, x1 - 4.4, { seg: 14 }).translate(0, ly, lz), "laserLens");
    ll.renderOrder = 0;
    ll.material.transparent = false;
    root.add(ll);
    out.laser = { p: [x1 - 3.5, ly, lz], lens: ll };
  }
  return out;
}
var PISTOL = [
  { id: "rmr_t2", cat: "micro", name: "Trijicon RMR Type 2", desc: "Точка 3,25 MOA, самый живучий корпус", stats: { weight: 34, ergo: -1, adsTime: 10 }, build: rmrPistol },
  { id: "hs507c", cat: "micro", name: "Holosun HS507C X2", desc: "Кольцо 32 MOA + точка 2 MOA", stats: { weight: 43, ergo: -1, adsTime: 12 }, build: hs507 },
  { id: "acro_p2", cat: "micro", name: "Aimpoint ACRO P-2", desc: "Закрытый излучатель: грязь и вода не мешают", stats: { weight: 60, ergo: -2, adsTime: 14 }, build: acroP2 },
  { id: "x300u", cat: "plight", name: "SureFire X300U-B", desc: "Фонарь 1000 лм, зацеп за паз рамки", foot: [-6, 6], body: [-20, 70], stats: { weight: 116, ergo: -3 }, build: (c) => pistolLight(c, { name: "x300", x0: -12, x1: 70, w: 30, h: 26, headR: 15.5, lm: 1e3 }) },
  { id: "tlr7a", cat: "plight", name: "Streamlight TLR-7A", desc: "Компактный фонарь 500 лм", foot: [-6, 6], body: [-18, 52], stats: { weight: 71, ergo: -1 }, build: (c) => pistolLight(c, { name: "tlr7", x0: -10, x1: 52, w: 27, h: 22, headR: 12, lm: 500, mat: "poly" }) },
  { id: "tlr8a", cat: "plight", name: "Streamlight TLR-8A", desc: "Фонарь 500 лм + красный ЛЦУ (C / Z)", foot: [-6, 6], body: [-18, 56], stats: { weight: 83, ergo: -2, "hipSpread%": -12 }, build: (c) => pistolLight(c, { name: "tlr8", x0: -10, x1: 56, w: 28, h: 23, headR: 12.5, lm: 500, laser: true, mat: "poly" }) }
];

