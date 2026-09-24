// src/engine/lib/tactical.js
function scout(ctx, o) {
  const k = ctx.kit();
  const r = o.r, L0 = o.tail, L1 = o.head, H = o.headR, cy = r + 4.5;
  const at = (g) => g.translate(0, cy, 0);
  k.add("alu", at(latheX([[L0 - 4, 0], [L0 - 4, 5.5], [L0 - 2.5, 6.2], [L0, 6.2], [L0, r - 0.8], [L0 + 1, r], [L0 + 16, r], [L0 + 17, r - 0.8], [L0 + 18, r - 0.4], [L1, r - 0.4], [L1 + 5, H], [L1 + 28, H], [L1 + 30, H - 1.4], [L1 + 30, H - 3.2]], { seg: 36 })));
  k.add("rubber", at(cylX(5.4, L0 - 5.5, L0 - 3.5, { seg: 20 })));
  k.add("alu", at(ringGrooves(r + 0.2, L0 + 3, L0 + 15, 6, 0.5, { seg: 36 })));
  k.add("alu", at(flutesX(H - 1.6, L1 + 8, L1 + 25, 6, 5, 1.8)));
  k.add("steel", at(tubeX(H + 0.1, H - 3.4, L1 + 28, L1 + 31, { seg: 36 })));
  k.add("alu", clampBody(-13, 13, 4.8, { w: 24 }));
  k.add("alu", extrudeX([[-7, 3], [7, 3], [7, cy - r + 3], [-7, cy - r + 3]], -12, 12, { bevel: 1 }));
  k.add("steel", T(ctx.C.knob(6.2, 5, 16), { r: [0, -90, 0], p: [0, -2.5, 12.5] }));
  k.add("steel", cylZ(2.4, -14, 12.5, { seg: 12 }), { p: [0, -2.5, 0] });
  if (o.tail2) k.add("rubber", at(cylX(6.4, L0 - 9, L0 - 4, { c: 1.2, seg: 24 })));
  const root = node(o.name, [k.build()]);
  const head = lampHead(ctx, H - 3.3, L1 + 29, L1 + 12, cy, o);
  root.add(head.group);
  return { root, light: { p: [L1 + 30, cy, 0], lens: head.glow, lumens: o.lm, cd: o.cd, kelvin: o.kelvin, hot: o.hot, spill: o.spill, batt: o.batt, lensR: H - 3.3 } };
}
// Голова фонаря: полированный отражатель (виден через стекло), светодиод на медной подложке,
// просветлённое стекло. glow — светящийся диск перед светодиодом: его яркость ведёт app (батарея).
function lampHead(ctx, r, xFront, xDeep, cy, o = {}) {
  const k = ctx.kit();
  const depth = xFront - xDeep, prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, x = xDeep + depth * t;
    prof.push([x, 2.2 + (r - 2.2) * Math.sqrt(t)]);
  }
  const refl = latheX([[xDeep - 0.2, 0], ...prof, [xFront, r], [xFront, r + 0.3], [xDeep - 0.6, 2.6], [xDeep - 0.6, 0]].reverse(), { seg: 40, crease: 70 });
  k.add(o.stipple ? "steelWorn" : "chrome", T(refl, { p: [0, cy, 0] }));
  k.add("copper", T(box(0.8, 6, 6, { bevel: 0.2 }), { p: [xDeep + 0.2, cy, 0] }));
  k.add("paintWhite", T(box(0.6, 3.2, 3.2, { bevel: 0.1 }), { p: [xDeep + 0.7, cy, 0] }));
  const group = node("lampHead", [k.build()]);
  const glass = lens(ctx, cylX(r + 0.2, xFront - 1.4, xFront - 0.6, { seg: 40 }).translate(0, cy, 0), "glass");
  const glow = new ctx.THREE.Mesh(cylX(r * 0.55, xDeep + 1, xDeep + 1.4, { seg: 24 }).translate(0, cy, 0), ctx.mats.get("lampLens").clone());
  glow.material.transparent = true;
  glow.material.opacity = 0.95;
  group.add(glass, glow);
  return { group, glow };
}
function boxLaser(ctx, o) {
  const k = ctx.kit();
  const { L0, L1, H, W } = o;
  k.add("alu", clampBody(-18, 18, 5));
  k.add("steel", crossBolt(-8));
  k.add("steel", crossBolt(8));
  k.add(o.mat, extrudeX([[-W / 2, 4, 2], [W / 2, 4, 2], [W / 2, H, 5], [-W / 2, H, 5]], L0, L1, { bevel: 2.4 }));
  k.add("lensBlack", extrudeX(rrect(0, (H + 4) / 2, W - 6, H - 10, 3), L1 - 0.8, L1 + 0.6, { bevel: 0.3 }));
  const vis = [L1 + 0.6, H * 0.72, -W * 0.25];
  k.add("steel", T(tubeX(4.6, 3, L1 - 1, L1 + 2.4, { seg: 20 }), { p: [0, vis[1], vis[2]] }));
  k.add("steel", T(tubeX(4.6, 3, L1 - 1, L1 + 2.4, { seg: 20 }), { p: [0, vis[1], W * 0.05] }));
  if (o.illum) {
    k.add(o.mat, T(tubeX(o.illum + 2.4, o.illum, L1 - 3, L1 + 8, { seg: 32 }), { p: [0, H * 0.42, W * 0.18] }));
    k.add("rubber", T(flutesX(o.illum + 2.2, L1, L1 + 7, 20, 1.2, 0.8), { p: [0, H * 0.42, W * 0.18] }));
    k.add("irLens", T(cylX(o.illum - 0.2, L1 + 5, L1 + 6, { seg: 28 }), { p: [0, H * 0.42, W * 0.18] }));
  }
  k.add("rubber", T(cylY(4.4, H - 1, H + 2.4, { c: 1, seg: 18 }), { p: [L0 + 16, 0, -W * 0.22] }));
  k.add("rubber", T(cylY(4.4, H - 1, H + 2.4, { c: 1, seg: 18 }), { p: [L0 + 16, 0, W * 0.22] }));
  k.add(o.mat, T(ctx.C.knob(8, 5, 18), { r: [0, 0, 90], p: [L0 + 36, H - 1, 0] }));
  k.add("paintWhite", T(box(3, 1, 1.2), { p: [L0 + 36, H + 4.3, 5] }));
  for (const z of [-W / 4, W / 4]) k.add("steel", T(cylY(2.6, H - 1, H + 1, { seg: 12 }), { p: [L1 - 16, 0, z] }));
  const root = node(o.name, [k.build()]);
  const ll = lens(ctx, cylX(2.9, vis[0] + 1.2, vis[0] + 1.8, { seg: 16 }).translate(0, vis[1], vis[2]), "laserLens");
  ll.renderOrder = 0;
  ll.material.transparent = false;
  root.add(ll);
  if (o.color) {
    ll.material = ll.material.clone();
    ll.material.emissive.setHex(o.color);
  }
  return { root, laser: { p: [vis[0] + 2, vis[1], vis[2]], lens: ll, color: o.color, batt: o.batt } };
}
function dbal(ctx) {
  const k = ctx.kit();
  const L0 = -40, L1 = 36, W = 34, H = 34;
  k.add("alu", clampBody(-16, 16, 5));
  k.add("steel", crossBolt(0));
  k.add("polyTan", extrudeX([[-W / 2, 4, 2], [W / 2, 4, 2], [W / 2, H, 6], [-W / 2, H, 6]], L0, L1 - 8, { bevel: 2.2 }));
  const ly = 15, lr = 11.5;
  k.add("polyTan", T(latheX([[L1 - 12, 0], [L1 - 12, lr + 2], [L1 + 4, lr + 3.4], [L1 + 6, lr + 2.6], [L1 + 6, 0]], { seg: 36 }), { p: [0, ly, 0] }));
  k.add("steel", T(tubeX(lr + 2.7, lr, L1 + 5, L1 + 7, { seg: 36 }), { p: [0, ly, 0] }));
  const vy = H - 6;
  k.add("polyTan", extrudeX(rrect(0, vy, 18, 10, 3), L1 - 10, L1 + 2, { bevel: 1 }));
  k.add("lensBlack", extrudeX(rrect(0, vy, 14, 6.5, 2), L1 + 1.6, L1 + 2.4, { bevel: 0.2 }));
  k.add("rubber", T(cylY(4.6, H - 1, H + 2.6, { c: 1, seg: 18 }), { p: [L0 + 14, 0, 0] }));
  k.add("polyTan", T(ctx.C.knob(7, 5, 16), { r: [0, 0, 90], p: [L0 + 30, H - 1, 0] }));
  for (const z of [-7, 7]) k.add("steel", T(cylY(2.4, H - 1, H + 0.8, { seg: 12 }), { p: [L1 - 18, 0, z] }));
  const root = node("dbal", [k.build()]);
  const le = lens(ctx, cylX(lr - 0.1, L1 + 5.2, L1 + 5.8, { seg: 32 }).translate(0, ly, 0), "lampLens");
  le.renderOrder = 0;
  le.material.transparent = false;
  const ll = lens(ctx, cylX(2.4, L1 + 2.3, L1 + 2.8, { seg: 16 }).translate(0, vy, 3), "laserLens");
  ll.renderOrder = 0;
  ll.material.transparent = false;
  root.add(le, ll);
  return { root, light: { p: [L1 + 7, ly, 0], lens: le, lumens: 300 }, laser: { p: [L1 + 3, vy, 3], lens: ll } };
}
function vgrip(ctx, o) {
  const k = ctx.kit();
  const L = o.len, d = o.d;
  k.add("poly", clampBody(-d / 2 - 2, d / 2 + 2, 5, { w: 26 }));
  const prof = [[0, 0], [0, d / 2 - 0.5]];
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const r = d / 2 - t * 2 + (o.ribs && i % 2 ? 0.8 : 0);
    prof.push([4 + t * (L - 10), r]);
  }
  prof.push([L - 3, d / 2 - 2.5], [L, d / 2 - 5], [L, 0]);
  const body = latheX(prof, { seg: 32, crease: 50 });
  k.add("poly", T(body, { r: [0, 0, 90], p: [o.tilt ?? 0, 3, 0], s: [1, 1, o.flat ?? 1] }));
  if (o.cap) k.add("polySoft", T(cylY(d / 2 - 3, L + 1, L + 4, { c: 1, seg: 28 }), { p: [0, 0, 0] }));
  k.add("steel", T(ctx.C.knob(5.5, 4, 14), { r: [0, -90, 0], p: [0, -2.5, 13] }));
  return { root: k.build(o.name) };
}
function afg(ctx) {
  const k = ctx.kit();
  const pro = shape([[-62, 0, 2], [34, 0, 2], [34, 6, 4], [14, 18, 20], [-40, 34, 12], [-66, 30, 8], [-66, 12, 6]]);
  k.add("poly", extrudeZ(pro, 30, { bevel: 6, curve: 8 }));
  k.add("polySoft", extrudeZ([[-50, 14, 4], [-10, 10, 6], [-30, 26, 8], [-58, 26, 6]], 1.2, { bevel: 0.4, z: 14.6 }));
  k.add("polySoft", extrudeZ([[-50, 14, 4], [-10, 10, 6], [-30, 26, 8], [-58, 26, 6]], 1.2, { bevel: 0.4, z: -14.6 }));
  k.add("steel", crossBolt(-20, -2.5, 15));
  k.add("steel", crossBolt(14, -2.5, 15));
  k.add("poly", clampBody(-64, 34, 3, { w: 28, jaw: -5.5 }));
  return { root: k.build("afg2") };
}
function handstop(ctx) {
  const k = ctx.kit();
  k.add("poly", clampBody(-14, 18, 3, { w: 26 }));
  k.add("poly", extrudeZ([[-14, 0, 1], [18, 0, 1], [18, 6, 3], [6, 21, 5], [-2, 21, 4], [-14, 6, 3]], 24, { bevel: 3 }));
  k.add("steel", crossBolt(0));
  return { root: k.build("handstop") };
}
function harris(ctx) {
  const k = ctx.kit();
  k.add("alu", clampBody(-18, 18, 6));
  k.add("steel", T(ctx.C.knob(7, 6, 18), { r: [0, -90, 0], p: [0, -2.5, 13] }));
  k.add("steel", extrudeZ([[-26, 5, 2], [26, 5, 2], [26, 18, 4], [-26, 18, 4]], 30, { bevel: 2 }));
  k.add("steel", cylY(8, 5, 12, { seg: 24 }));
  for (const s of [-1, 1]) {
    k.add("spring", T(spring(3, 0.8, -22, 8, 9), { p: [0, 20, s * 12] }));
    k.add("steel", cylZ(5.5, 0, 8, { seg: 18 }), { p: [16, 12, s > 0 ? 14 : -22] });
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const lk = ctx.kit();
    lk.add("steel", cylX(6.2, -4, 160, { c: 1, seg: 20 }));
    lk.add("steelWorn", cylX(4.8, 160, 214, { c: 0.6, seg: 18 }));
    lk.add("steel", cylX(7, 150, 162, { c: 1, seg: 20 }));
    lk.add("rubber", latheX([[212, 0], [212, 7], [222, 8], [228, 5], [230, 0]], { seg: 20 }));
    for (let i = 0; i < 5; i++) lk.add("steel", T(box(3, 2, 4), { p: [168 + i * 9, -4.8, 0] }));
    const leg = node("leg", [lk.build()]);
    leg.position.set(16, 12, s * 21);
    legs.push(leg);
  }
  return { root: node("harris", [k.build(), ...legs]), bipod: { legs, angle: 90 } };
}
var TACTICAL = [
  { id: "m600", cat: "light", name: "SureFire M600 Scout", desc: "Тактический фонарь 1000 лм", foot: [-13, 13], body: [-78, 72], stats: { weight: 175, ergo: -2 }, build: (c) => scout(c, { name: "m600", r: 12.7, headR: 15.9, tail: -76, head: 42, lm: 1e3 }) },
  { id: "m300", cat: "light", name: "SureFire M300 Mini Scout", desc: "Компактный фонарь 500 лм", foot: [-13, 13], body: [-60, 44], stats: { weight: 120, ergo: -1 }, build: (c) => scout(c, { name: "m300", r: 11, headR: 12.6, tail: -58, head: 14, lm: 500 }) },
  { id: "m640", cat: "light", name: "SureFire M640DF Scout Pro", desc: "1500 лм, 38 000 кд — двойное топливо, мощный луч с широкой засветкой", foot: [-13, 13], body: [-84, 78], stats: { weight: 190, ergo: -2 }, build: (c) => scout(c, { name: "m640", r: 12.7, headR: 17.2, tail: -82, head: 46, lm: 1500, cd: 38e3, hot: 0.15, spill: 0.1, kelvin: 6300, batt: 20, tail2: true }) },
  { id: "okw", cat: "light", name: "Modlite OKW-18650", desc: "Прожектор 1250 лм / 64 000 кд: узкое пятно бьёт на 500 м", foot: [-13, 13], body: [-92, 96], stats: { weight: 210, ergo: -3 }, build: (c) => scout(c, { name: "okw", r: 12.7, headR: 22.5, tail: -90, head: 50, lm: 1250, cd: 64e3, hot: 0.09, spill: 0.05, kelvin: 5200, batt: 28, tail2: true }) },
  { id: "hlx", cat: "light", name: "Streamlight ProTac HL-X", desc: "1000 лм, тёплый нейтральный свет, дешёвые CR123", foot: [-13, 13], body: [-78, 70], stats: { weight: 160, ergo: -2 }, build: (c) => scout(c, { name: "hlx", r: 12.4, headR: 16.4, tail: -76, head: 40, lm: 1e3, cd: 2e4, hot: 0.2, spill: 0.11, kelvin: 5600, batt: 24 }) },
  { id: "peq15", cat: "laser", name: "L3 AN/PEQ-15", desc: "ЛЦУ: видимый + ИК лазер, ИК-осветитель", foot: [-18, 18], body: [-48, 60], stats: { weight: 215, ergo: -3, "hipSpread%": -18 }, build: (c) => boxLaser(c, { name: "peq15", L0: -48, L1: 56, H: 38, W: 50, mat: "polyTan", illum: 8 }) },
  { id: "ls221g", cat: "laser", name: "Holosun LS221G (зелёный)", desc: "Зелёный лазер 520 нм: днём виден лучше красного", foot: [-18, 18], body: [-34, 46], stats: { weight: 135, ergo: -2, "hipSpread%": -16 }, build: (c) => boxLaser(c, { name: "ls221", L0: -34, L1: 44, H: 30, W: 34, mat: "poly", color: 3079936, batt: 24 }) },
  { id: "ls321", cat: "laser", name: "Holosun LS321", desc: "Компактный ЛЦУ с ИК-осветителем", foot: [-18, 18], body: [-34, 46], stats: { weight: 140, ergo: -2, "hipSpread%": -15 }, build: (c) => boxLaser(c, { name: "ls321", L0: -34, L1: 44, H: 32, W: 36, mat: "poly", illum: 6 }) },
  { id: "dbal", cat: "combo", name: "Steiner DBAL-PL", desc: "Комбо-блок: фонарь 300 лм + видимый лазер (C / Z)", foot: [-16, 16], body: [-42, 44], stats: { weight: 150, ergo: -2, "hipSpread%": -12 }, build: dbal },
  { id: "rvg", cat: "foregrip", name: "Magpul RVG", desc: "Вертикальная рукоятка, контроль отдачи", foot: [-17, 17], body: [-17, 17], stats: { weight: 70, "recoilV%": -6, "recoilH%": -10, ergo: 3, adsTime: 6 }, build: (c) => vgrip(c, { name: "rvg", len: 98, d: 32, ribs: true }) },
  { id: "bcm_vg", cat: "foregrip", name: "BCM Gunfighter Mod 3", desc: "Короткая рукоятка-упор", foot: [-16, 16], body: [-16, 16], stats: { weight: 45, "recoilV%": -4, "recoilH%": -6, ergo: 5 }, build: (c) => vgrip(c, { name: "bcm", len: 62, d: 31, flat: 0.85 }) },
  { id: "afg2", cat: "foregrip", name: "Magpul AFG-2", desc: "Наклонная рукоятка, быстрая вскидка", foot: [-64, 34], body: [-66, 34], stats: { weight: 55, "recoilV%": -3, "recoilH%": -5, ergo: 6, adsTime: -8 }, build: afg },
  { id: "handstop", cat: "foregrip", name: "Упор для ладони", desc: "Упор под хват «C-clamp»", foot: [-14, 18], body: [-14, 18], stats: { weight: 25, ergo: 4, "recoilH%": -3 }, build: handstop },
  { id: "harris", cat: "bipod", name: "Сошки Harris S-BRM", desc: "Раскладные сошки, клавиша B", foot: [-18, 18], body: [-28, 232], stats: { weight: 420, ergo: -8, adsTime: 25, "recoilV%": -4 }, build: harris }
];


