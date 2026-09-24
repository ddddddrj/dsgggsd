// src/weapons/m870.js
// Remington 870: помповое ружьё 12/76, фрезерованная стальная коробка, подствольный трубчатый магазин.
// Единицы — мм, ось канала ствола y = 0, x = 0 — зеркало затвора, +z — правый борт (окно выброса).
var R8 = {
  REAR: -168,
  FRONT: 32,
  TOP: 17,
  BOT: -41,
  HW: 13.6,
  TUBE_Y: -27,
  TUBE_R: 11.4,
  TUBE_X1: 342,
  SIGHT_Y: 21
};
function m870Receiver(ctx, k) {
  const { extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylZ: cZ, shape: sh } = ctx.G;
  const { REAR: R4, FRONT: F, TOP, BOT, HW: W } = R8;
  const M = "steelPark";
  // сечение: плоские борта, скруглённый верх, снизу — окно заряжания (закрыто лотком, см. ниже)
  const sec = (cut) => cut ? [[-W, BOT, 2], [W, BOT, 2], [W, -12], [W - 3, -12], [W - 3, 11], [W, 11], [W, TOP - 4, 5], [W - 5, TOP, 6], [-W + 5, TOP, 6], [-W, TOP - 4, 5]] : [[-W, BOT, 2], [W, BOT, 2], [W, TOP - 4, 5], [W - 5, TOP, 6], [-W + 5, TOP, 6], [-W, TOP - 4, 5]];
  k.add(M, exX(sec(false), R4, -78, { bevel: 1 }));
  k.add(M, exX(sec(true), -78, 16, { bevel: 0.4 }));
  k.add(M, exX(sec(false), 16, F, { bevel: 1 }));
  k.add("lensBlack", T2(bx(94, 23, 1), { p: [-31, -0.5, W - 3.3] }));
  // задний скос к прикладу и шейка
  k.add(M, exZ([[R4, TOP - 2, 3], [R4 - 10, TOP - 8, 4], [R4 - 10, BOT + 12, 4], [R4, BOT, 2]], W * 2 - 1, { bevel: 1.4 }));
  // окно заряжания снизу: тёмный проём, лоток подавателя и отсечка
  k.add("lensBlack", T2(bx(92, 1, 20), { p: [-8, BOT - 0.1, 0] }));
  k.add("steelWorn", T2(bx(80, 2, 16, { bevel: 0.6 }), { p: [-12, BOT + 3, 0] }));
  k.add("steelWorn", T2(bx(8, 3, 4, { bevel: 0.5 }), { p: [34, BOT + 2, -7] }));
  // гнёзда штифтов УСМ и надпись-гравировка (тонкие канавки)
  for (const x of [-126, -44]) for (const s of [-1, 1]) k.add("steelWorn", T2(cZ(3.4, 0, 0.8, { seg: 16 }), { p: [x, -32, s > 0 ? W : -W - 0.8] }));
  for (let i = 0; i < 3; i++) k.add("lensBlack", T2(bx(34 - i * 8, 0.8, 0.3), { p: [-120 + i * 4, -8 - i * 4, -W - 0.1] }));
}
function m870Base(ctx) {
  const { node: nd, T: T2, box: bx, cylX: cX, cylZ: cZ, latheX: lX, extrudeZ: exZ, ringGrooves: rg, shape: sh } = ctx.G;
  const k = ctx.kit();
  const nodes = {};
  m870Receiver(ctx, k);
  // трубка магазина до кольца ствола, затыльная гайка ствольной коробки
  k.add("steelPark", T2(cX(R8.TUBE_R, R8.FRONT - 4, 300, { c: 0.6, seg: 32 }), { p: [0, R8.TUBE_Y, 0] }));
  k.add("steelPark", T2(lX([[300, 0], [300, R8.TUBE_R + 0.6], [340, R8.TUBE_R + 0.6], [342, R8.TUBE_R - 1], [342, 0]], { seg: 32 }), { p: [0, R8.TUBE_Y, 0] }));
  k.add("steelPark", T2(rg(R8.TUBE_R + 1, 312, 338, 12, 0.6, { seg: 32 }), { p: [0, R8.TUBE_Y, 0] }));
  const body = k.build("receiver");
  // затвор в окне выброса
  const c = ctx.kit();
  c.add("steelBright", T2(bx(70, 18, 3, { bevel: 0.6 }), { p: [-36, 0, 9.6] }));
  c.add("steelWorn", T2(bx(10, 5, 2), { p: [-6, 7, 10.8] }));
  nodes.carrier = nd("bolt", [c.build()]);
  // УСМ: пластиковая коробка курка, спуск, поперечный предохранитель, рычаг затворной задержки
  const t = ctx.kit();
  t.add("aluGrey", exZ([[-28, R8.BOT, 2], [-162, R8.BOT, 2], [-164, R8.BOT - 8, 3], [-150, R8.BOT - 12, 4], [-30, R8.BOT - 12, 3]], 22, { bevel: 1.2 }));
  t.add("aluGrey", exZ(sh([[-60, R8.BOT - 8], [-128, R8.BOT - 8], [-124, R8.BOT - 42, 8], [-78, R8.BOT - 46, 10], [-60, R8.BOT - 30, 6]], [[[-66, R8.BOT - 12], [-120, R8.BOT - 12], [-118, R8.BOT - 36, 6], [-82, R8.BOT - 40, 8], [-68, R8.BOT - 28, 4]]]), 12, { bevel: 1.2 }));
  t.add("steelWorn", T2(cZ(3.4, -13, 13, { seg: 18 }), { p: [-126, R8.BOT - 16, 0] }));
  t.add("paintRed", T2(cZ(3.5, 11.4, 12.2, { seg: 18 }), { p: [-126, R8.BOT - 16, 0] }));
  t.add("steelWorn", T2(exZ([[0, 0], [12, 2], [14, -4, 1], [2, -6, 1]], 2, { bevel: 0.4 }), { p: [-60, R8.BOT - 6, -11.6] }));
  const body2 = t.build("tg");
  const tr = ctx.kit();
  tr.add("steelWorn", exZ([[-2, 4], [3, 4], [3, -6, 2], [1, -18, 4], [-4, -24, 2], [-6, -22], [-3, -8, 3]], 6, { bevel: 0.8 }));
  nodes.trigger = nd("trigger", [tr.build()], { p: [-94, R8.BOT - 10, 0] });
  // патрон для анимации заряжания трубки (прячется в окне)
  const ls = ctx.kit();
  ctx.C.cartridge(ls, "12ga", { p: [-32, 0, 0] });
  nodes.loadShell = nd("loadShell", [ls.build()]);
  nodes.loadShell.visible = false;
  const loadHolder = nd("loadHolder", [nodes.loadShell], { p: [-20, R8.TUBE_Y, 0] });
  const root = nd("m870", [body, body2, nodes.carrier, nodes.trigger, loadHolder]);
  const { mount: mount2 } = ctx;
  // цевьё ездит по трубке: всё, что на нём, — в узле forend
  nodes.forend = nd("forend", [mount2({ id: "forend", type: "forend", p: [0, 0, 0] })]);
  root.add(nodes.forend);
  root.add(mount2({ id: "barrel", type: "barrel", p: [R8.FRONT, 0, 0] }));
  root.add(mount2({ id: "tubeEnd", type: "tube", p: [342, R8.TUBE_Y, 0] }));
  root.add(mount2({ id: "rcvTop", type: "rcvTop", p: [-70, R8.TOP, 0] }));
  root.add(mount2({ id: "saddle", type: "saddle", p: [-60, -8, -R8.HW] }));
  root.add(mount2({ id: "stock", type: "stock", p: [R8.REAR - 10, 0, 0] }));
  root.add(mount2({ id: "ammo", type: "ammo", p: [0, 0, 0] }));
  return {
    root,
    nodes,
    anim: { pumpTravel: 92, carrierTravel: 92, triggerAngle: 0.22 },
    eject: { p: [-26, 2, 16], dir: [0.15, 0.55, 1], speed: 2.4 },
    muzzle: [500, 0, 0],
    irons: { rear: [R8.REAR + 20, R8.SIGHT_Y, 0], type: "notch" },
    eyeX: -390,
    focus: { center: [-20, -50, 0], size: 1150 }
  };
}
/* --------------------------------------------------------------- стволы */
function m870Barrel(ctx, o) {
  const { node: nd, T: T2, box: bx, latheX: lX, extrudeZ: exZ, cylX: cX, sphere: sp, cylY: cY } = ctx.G;
  const k = ctx.kit();
  const L = o.len;
  // хвостовик в коробке, конус патронника, тонкая дульная часть, резьба под чоки
  k.add("steelPark", lX([[-2, 0], [-2, 14.6], [22, 14.6], [30, 13], [120, 12.4], [L - 30, 11.6], [L - 1, 11.6], [L, 10.8], [L, 9.6], [L - 20, 9.6], [L - 20, 0]], { seg: 40 }));
  // кольцо-ушко под гайку магазина
  k.add("steelPark", exZ([[296, -8], [306, -8], [308, R8.TUBE_Y + 12.8, 3], [294, R8.TUBE_Y + 12.8, 3]], 14, { bevel: 1.4 }));
  k.add("steelPark", T2(cX(R8.TUBE_R + 2.2, 294, 308, { c: 1, seg: 32 }), { p: [0, R8.TUBE_Y, 0] }));
  if (o.rib) {
    // вентилируемая планка
    for (let x = 24; x < L - 16; x += 26) k.add("steelPark", T2(bx(5, 4, 5, { bevel: 0.6 }), { p: [x, 13.6, 0] }));
    k.add("steelPark", T2(bx(L - 30, 1.8, 8, { bevel: 0.6 }), { p: [(L - 30) / 2 + 10, 16.2, 0] }));
  }
  const out = { root: null, irons: {} };
  if (o.rifle) {
    // «полицейские» винтовочные: целик-щель на стволе и мушка-лопатка на основании
    k.add("steelPark", exZ([[34, 11], [70, 11], [68, 17, 2], [36, 17, 2]], 12, { bevel: 1 }));
    k.add("steelPark", exZ([[48, 16], [62, 16], [60, 27, 1], [50, 27, 1]], 14, { bevel: 0.6 }));
    k.add("lensBlack", exZ([[53.8, 22], [56.2, 22], [56.2, 27.2], [53.8, 27.2]], 14.4, { bevel: 0 }));
    k.add("steelPark", exZ([[L - 60, 10], [L - 22, 10], [L - 24, 16, 2], [L - 56, 16, 2]], 12, { bevel: 1 }));
    k.add("steelPark", exZ([[L - 44, 15], [L - 36, 15], [L - 37, 25.2, 0.6], [L - 43, 25.2, 0.6]], 2.4, { bevel: 0.3 }));
    k.add("tritium", T2(cX(0.8, L - 40, L - 38, { seg: 10 }), { p: [0, 23.8, 0] }));
    out.irons = { rear: [55, 25, 0], front: [L - 40, 25, 0], type: "notch" };
  } else {
    // латунная мушка-бусина
    k.add("brass", T2(sp(2.4, { seg: 14, seg2: 10 }), { p: [L - 14, 14.2 + (o.rib ? 4 : 0), 0] }));
    k.add("steelPark", T2(cY(1.4, 11, 13 + (o.rib ? 4 : 0), { seg: 10 }), { p: [L - 14, 0, 0] }));
    out.irons = { front: [L - 14, 14.4 + (o.rib ? 4 : 0), 0] };
  }
  const muzzle = ctx.mount({ id: "muzzle", type: "thread", p: [L, 0, 0] });
  out.root = nd("barrel_" + o.id, [k.build(), muzzle]);
  return out;
}
/* --------------------------------------------------------------- цевья */
function forendBars(ctx, k, x0) {
  const { extrudeX: exX } = ctx.G;
  // две штанги затвора вдоль трубки
  for (const s of [-1, 1]) k.add("steelWorn", exX([[s * 10.6, R8.TUBE_Y + 6], [s * 12.4, R8.TUBE_Y + 6], [s * 12.4, R8.TUBE_Y + 10], [s * 10.6, R8.TUBE_Y + 10]], R8.FRONT - 88, x0 + 6, { bevel: 0.2 }));
}
function forendClassic(ctx, o) {
  const { node: nd, T: T2, box: bx, loftX: lf, superEllipse: se } = ctx.G;
  const k = ctx.kit();
  const x0 = 62, x1 = 250, cy = R8.TUBE_Y - 2;
  forendBars(ctx, k, x0);
  const prof = o.beaver ? [[x0, cy, 18, 17], [x0 + 20, cy - 1, 21, 20], [x1 - 20, cy - 1, 21, 20], [x1, cy, 18, 17.5]] : [[x0, cy, 16, 15.5], [x0 + 14, cy - 1, 19, 18], [x1 - 14, cy - 1, 19, 18], [x1, cy, 16, 16]];
  k.add(o.mat, lf(prof.map(([x, c, hh, hw]) => ({ x, pts: se(hw, hh, 2.8, 32, c, 0) }))));
  // поперечные рёбра хвата
  const n = o.beaver ? 0 : 11;
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) k.add(o.mat, T2(bx(3, 26, 3, { bevel: 1.2 }), { p: [x0 + 24 + i * 13.5, cy - 2, s * 17.2] }));
  if (o.beaver) for (let i = 0; i < 2; i++) for (const s of [-1, 1]) k.add(o.mat, T2(bx(120, 1.4, 1, { bevel: 0.4 }), { p: [(x0 + x1) / 2, cy + 6 - i * 10, s * 20.2] }));
  return { root: nd("forend", [k.build()]) };
}
function forendMoe(ctx) {
  const { node: nd, T: T2, extrudeX: exX, extrudeZ: exZ, shape: sh, mlokHoles: ml, picatinny: pic } = ctx.G;
  const k = ctx.kit();
  const x0 = 62, x1 = 250, cy = R8.TUBE_Y;
  forendBars(ctx, k, x0);
  const sec = [[-19, cy + 16, 4], [-21, cy - 2, 6], [-15, cy - 22, 8], [15, cy - 22, 8], [21, cy - 2, 6], [19, cy + 16, 4], [15, cy + 16], [15, cy - 14], [-15, cy - 14], [-15, cy + 16]];
  k.add("poly", exX(sec, x0, x1, { bevel: 1.6 }));
  // упор под ладонь спереди
  k.add("poly", exX([[-21, cy + 10, 4], [21, cy + 10, 4], [18, cy - 28, 8], [-18, cy - 28, 8]], x1 - 14, x1, { bevel: 2 }));
  const holes = ml(x0 + 20, x1 - 20, cy, { h: 7, len: 32 });
  for (const h of holes) for (const s of [-1, 1]) k.add("lensBlack", exZ(sh(h), 1, { bevel: 0.2, z: s * 20.7 }));
  const r = pic(60, { base: 4 });
  k.add("alu", r.geo, { r: [90, 0, 0], p: [x1 - 90, cy, 25] });
  const m1 = ctx.railMount("feRight", [x1 - 90 + r.first, cy, 25], "right", r.slots, { axis: "right" });
  const r2 = pic(60, { base: 4 });
  k.add("alu", r2.geo, { r: [-90, 0, 0], p: [x1 - 90, cy, -25] });
  const m2 = ctx.railMount("feLeft", [x1 - 90 + r2.first, cy, -25], "left", r2.slots, { axis: "left" });
  const r3 = pic(70, { base: 4 });
  k.add("alu", r3.geo, { r: [180, 0, 0], p: [x0 + 40, cy - 26, 0] });
  const m3 = ctx.railMount("feBottom", [x0 + 40 + r3.first, cy - 26, 0], "bottom", r3.slots, { axis: "bottom" });
  return { root: nd("moe", [k.build(), m1, m2, m3]) };
}
function forendDSF(ctx) {
  const { node: nd, T: T2, box: bx, loftX: lf, superEllipse: se, latheX: lX, cylX: cX } = ctx.G;
  const k = ctx.kit();
  const x0 = 62, x1 = 262, cy = R8.TUBE_Y - 2;
  forendBars(ctx, k, x0);
  const prof = [[x0, cy, 18, 16], [x0 + 16, cy - 2, 22, 19], [x1 - 40, cy - 2, 22, 19], [x1 - 22, cy + 2, 18, 22], [x1, cy + 2, 17, 22]];
  k.add("poly", lf(prof.map(([x, c, hh, hw]) => ({ x, pts: se(hw, hh, 3, 32, c, 0) }))));
  for (const s of [-1, 1]) k.add("rubber", T2(bx(90, 14, 1.6, { bevel: 0.8 }), { p: [x0 + 80, cy - 4, s * 19.5] }));
  // две фары по бокам ствола
  const lensGeo = [];
  for (const s of [-1, 1]) {
    k.add("alu", T2(lX([[x1 - 24, 0], [x1 - 24, 9], [x1 - 2, 10.5], [x1 + 2, 10.5], [x1 + 2, 9.4], [x1 + 1, 0]], { seg: 28 }), { p: [0, cy + 8, s * 16] }));
    lensGeo.push(cX(8.6, x1 + 0.8, x1 + 1.6, { seg: 24 }).translate(0, cy + 8, s * 16));
  }
  const root = nd("dsf", [k.build()]);
  const le = new ctx.THREE.Mesh(ctx.G.merge(lensGeo), ctx.mats.get("lampLens").clone());
  root.add(le);
  return { root, light: { p: [x1 + 3, cy + 8, 16], lens: le, lumens: 800 } };
}
/* --------------------------------------------------------------- удлинители магазина */
function tubeExt(ctx, o) {
  const { node: nd, T: T2, latheX: lX, cylX: cX, ringGrooves: rg, extrudeZ: exZ } = ctx.G;
  const k = ctx.kit();
  const L = o.len;
  if (!L) {
    k.add("steelPark", lX([[0, 0], [0, R8.TUBE_R + 1.2], [16, R8.TUBE_R + 1.2], [18, R8.TUBE_R - 1], [18, 0]], { seg: 32 }));
    k.add("steelPark", rg(R8.TUBE_R + 1.6, 2, 15, 8, 0.6, { seg: 32 }));
    return { root: nd("cap", [k.build()]), mag: { cap: 4 } };
  }
  k.add("steelPark", cX(R8.TUBE_R, 0, L, { seg: 32 }));
  k.add("steelPark", lX([[L - 4, 0], [L - 4, R8.TUBE_R + 1.2], [L + 14, R8.TUBE_R + 1.2], [L + 16, R8.TUBE_R - 1], [L + 16, 0]], { seg: 32 }));
  k.add("steelPark", rg(R8.TUBE_R + 1.6, L - 2, L + 13, 8, 0.6, { seg: 32 }));
  // хомут на ствол
  const cx = L - 30;
  k.add("alu", exZ([[cx - 9, -R8.TUBE_Y - 13, 3], [cx + 9, -R8.TUBE_Y - 13, 3], [cx + 9, -R8.TUBE_Y + 13, 5], [cx - 9, -R8.TUBE_Y + 13, 5]], 30, { bevel: 2 }));
  k.add("steel", T2(ctx.G.cylZ(3, -16, 16, { seg: 12 }), { p: [cx, -R8.TUBE_Y * 0.5, 0] }));
  return { root: nd("ext" + o.cap, [k.build()]), mag: { cap: o.cap } };
}
/* --------------------------------------------------------------- планка / патронташ */
function rcvRail(ctx, o) {
  const { node: nd, extrudeX: exX, picatinny: pic, T: T2, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const L = o.len, x0 = -L / 2;
  // седло по форме верха коробки, стяжка на штифты УСМ
  k.add("alu", exX([[-R8.HW - 1.6, -10, 1], [R8.HW + 1.6, -10, 1], [R8.HW + 1.6, 3, 3], [8, 5], [-8, 5], [-R8.HW - 1.6, 3, 3]], x0, x0 + L, { bevel: 1 }));
  for (const x of [-56, 26]) for (const s of [-1, 1]) k.add("steel", T2(cZ(3.6, 0, 1.4, { seg: 16 }), { p: [x, -5, s > 0 ? R8.HW + 1.6 : -R8.HW - 3] }));
  const r = pic(L - 10, { base: 6 });
  k.add("alu", r.geo, { p: [x0 + 5, o.h, 0] });
  k.add("alu", exX([[-8, 4], [8, 4], [8, o.h - 6], [-8, o.h - 6]], x0 + 5, x0 + L - 5, { bevel: 0.8 }));
  return { root: nd("rcvRail", [k.build(), ctx.railMount("rcvRail", [x0 + 5 + r.first, o.h, 0], "top", r.slots, { axis: "top" })]) };
}
function sideSaddle(ctx, o) {
  const { node: nd, extrudeX: exX, extrudeZ: exZ, T: T2, box: bx } = ctx.G;
  const k = ctx.kit(), sk = ctx.kit();
  const n = o.n, pitch = 23, w = n * pitch + 8;
  // пластина на штифтах слева; патроны донцем вверх
  k.add(o.mat, T2(bx(w, 64, 3, { bevel: 1 }), { p: [0, -6, -1.5] }));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 8 + i * pitch;
    k.add(o.mat, T2(bx(20, 10, 12, { bevel: 2 }), { p: [x + 7, 8, -10] }));
    ctx.C.cartridge(sk, "12ga", { p: [x + 7, 26, -13], r: [0, 0, -90] });
  }
  return { root: nd("saddle", [k.build(), sk.build()]) };
}
/* --------------------------------------------------------------- приклады */
function stock870(ctx, o) {
  const { node: nd, T: T2, box: bx, extrudeZ: exZ, loftX: lf, superEllipse: se, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const prof = [[0, -12, 27, 13.6], [-30, -18, 30, 15], [-80, -32, 38, 17], [-160, -52, 50, 19.5], [-250, -72, 60, 21], [-344, -90, 68, 22]];
  k.add(o.mat, lf(prof.map(([x, cy, hh, hw]) => ({ x, pts: se(hw, hh, o.k ?? 2.6, 32, cy, 0) }))));
  // пистолетный выступ шейки
  if (o.pg) k.add(o.mat, exZ([[-14, -34, 4], [-60, -56, 8], [-56, -104, 12], [-34, -106, 10], [-22, -60, 10]], 30, { bevel: 7, curve: 8 }));
  k.add(o.pad || "rubber", T2(exZ([[-4, -20, 8], [14, -20, 10], [14, -160, 10], [-4, -160, 8]], 44, { bevel: 3 }), { p: [-358, 0, 0] }));
  for (let i = 0; i < 6; i++) k.add("rubber", T2(bx(1.6, 2.4, 38), { p: [-362, -34 - i * 20, 0] }));
  slingLoop(ctx, k, "steel", [-300, -148, 0], { side: -1, w: 18 });
  return { root: nd("stock", [k.build()]) };
}
function stockSGA(ctx) {
  const { node: nd, T: T2, box: bx, extrudeZ: exZ, loftX: lf, superEllipse: se } = ctx.G;
  const k = ctx.kit();
  // Magpul SGA: вертикальная рукоять за шейкой, прямой гребень, проставки длины
  const prof = [[0, -6, 28, 13.6], [-60, -12, 32, 17], [-160, -24, 46, 20], [-300, -36, 58, 21]];
  k.add("poly", lf(prof.map(([x, cy, hh, hw]) => ({ x, pts: se(hw, hh, 3.4, 32, cy, 0) }))));
  k.add("poly", exZ([[-14, -34, 4], [-44, -44, 8], [-40, -108, 12], [-16, -110, 10], [-10, -60, 10]], 30, { bevel: 7, curve: 8 }));
  k.add("poly", exZ([[-54, -40, 6], [-120, -52, 10], [-110, -72, 10], [-60, -60, 8]], 26, { bevel: 5 }));
  k.add("polySoft", T2(exZ([[-4, 26, 8], [16, 26, 10], [16, -98, 10], [-4, -98, 8]], 44, { bevel: 3 }), { p: [-318, 0, 0] }));
  for (let i = 0; i < 2; i++) k.add("poly", T2(bx(6, 118, 42, { bevel: 2 }), { p: [-304 + i * 7, -36, 0] }));
  k.add("poly", exZ([[-40, 12, 4], [-200, 12, 4], [-200, 2], [-40, 2]], 22, { bevel: 3 }));
  slingLoop(ctx, k, "steel", [-240, -84, 0], { side: -1, w: 18 });
  return { root: nd("sga", [k.build()]) };
}
function stockFold(ctx) {
  const { node: nd, T: T2, box: bx, extrudeZ: exZ, cylZ: cZ, cylY: cY } = ctx.G;
  const k = ctx.kit(), f = ctx.kit();
  // пистолетная рукоять + складной сверху металлический приклад
  k.add("poly", exZ([[0, 10, 3], [0, -34, 3], [-10, -40, 4], [-58, -104, 10], [-34, -110, 10], [-6, -60, 8], [-14, -34, 4], [-14, 10, 3]], 30, { bevel: 6, curve: 8 }));
  k.add("steel", exZ([[0, 20, 3], [-24, 20, 3], [-24, 8], [0, 8]], 28, { bevel: 1.4 }));
  k.add("steelWorn", T2(cZ(4.4, -16, 16, { seg: 16 }), { p: [-18, 14, 0] }));
  for (const s of [-1, 1]) f.add("steel", T2(exZ([[0, 3], [-300, -26, 3], [-300, -32, 3], [0, -3]], 3, { bevel: 0.6 }), { p: [0, 0, s * 12] }));
  f.add("steel", T2(exZ([[-292, -18, 4], [-306, -18, 4], [-306, -118, 6], [-292, -114, 4]], 30, { bevel: 2 }), {}));
  f.add("rubber", T2(exZ([[-306, -16, 4], [-312, -16, 4], [-312, -120, 6], [-306, -118, 4]], 36, { bevel: 2 }), {}));
  f.add("steelWorn", T2(cZ(4, -14, 14, { seg: 16 }), { p: [-290, -60, 0] }));
  const fold = nd("fold", [f.build()], { p: [-18, 14, 0] });
  fold.children[0].position.set(18, -14, 0);
  return { root: nd("fold870", [k.build(), fold]), fold: { node: fold, axis: "z", angle: -180 } };
}
/* --------------------------------------------------------------- дульные насадки (чоки) */
function choke(ctx, o) {
  const { node: nd, latheX: lX, ringGrooves: rg, T: T2, box: bx, cylY: cY } = ctx.G;
  const k = ctx.kit();
  const L = o.ext;
  k.add("steelBright", lX([[-2, 0], [-2, 12.4], [L - 2, 12.4], [L, 11.4], [L, 9.2], [-2, 9.2]].map(([x, r], i) => i === 0 ? [x, 0] : [x, r]), { seg: 36 }));
  k.add("steelBright", rg(12.6, 2, Math.min(L - 3, 14), 6, 0.5, { seg: 36 }));
  if (o.ports) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(5, 2, 3, { bevel: 0.6 }), { p: [L - 18 + i * 0, 11.2, 0], r: [s * 40 + i * 90, 0, 0] }));
  if (o.teeth) for (let i = 0; i < 6; i++) k.add("steelBright", T2(bx(8, 4, 5, { bevel: 0.8 }), { p: [L + 3, 10.8, 0], r: [i * 60, 0, 0] }));
  for (let i = 0; i < o.notches; i++) k.add("lensBlack", T2(bx(1.2, 1, 2.4), { p: [L - 1.4, 12.2, 0], r: [i * 26 - 20, 0, 0] }));
  return { root: nd("choke", [k.build()]), muzzle: { x: L + (o.teeth ? 7 : 0), kind: "choke", flash: 1, pattern: o.pattern } };
}
function salvo(ctx) {
  const { node: nd, latheX: lX, tubeX: tb, cylX: cX, extrudeX: exX, T: T2, box: bx } = ctx.G;
  const k = ctx.kit();
  const L = 250;
  // SilencerCo Salvo 12: секционный корпус со сплюснутым сечением
  k.add("steelMatte", lX([[-2, 0], [-2, 14], [18, 14], [22, 18], [22, 0]], { seg: 36 }));
  k.add("aluGrey", exX([[-20, -18, 8], [20, -18, 8], [20, 26, 8], [-20, 26, 8]], 22, L, { bevel: 2 }));
  for (let i = 0; i < 5; i++) k.add("steelMatte", T2(exX([[-21, -19, 8], [21, -19, 8], [21, 27, 8], [-21, 27, 8]], 0, 4, { bevel: 0.8 }), { p: [40 + i * 44, 0, 0] }));
  k.add("lensBlack", cX(12, L - 0.4, L + 0.4, { seg: 24 }));
  return { root: nd("salvo", [k.build()]), muzzle: { x: L, kind: "supp", flash: 0.03, pattern: 1 } };
}
var AMMO12 = (id, name, desc, ammo, stats) => ({ id, cat: "shell12", name, desc, stats, build: (c) => ({ root: c.G.node("ammo_" + id, []), ammo }) });
var m870_default = {
  id: "m870",
  family: "m870",
  title: "Remington 870 Police Magnum",
  short: "Remington 870",
  caliber: "12/76",
  cal: "12ga",
  thread: "remchoke",
  action: "pump",
  feed: "tube",
  chargeLabel: "цевьё (передёрнуть)",
  bareKind: "choke",
  hipMoa: 70,
  specs: [["Ствол", "470 мм"], ["Длина", "1003 мм"], ["Магазин", "4+1"], ["Масса", "3,6 кг"]],
  base: { weight: 3200, length: 1003, ergo: 44, recoilV: 100, recoilH: 70, moa: 4, velocity: 400, range: 50, loud: 162, flash: 75, adsTime: 360, rpm: 60, mag: 4 },
  audio: { cal: "12ga", mech: 0.9 },
  modes: ["safe", "pump"],
  build: m870Base,
  slots: [
    { id: "barrel", label: "Ствол", group: "Ствол и цевьё", accepts: ["b870"], mount: "barrel", required: true },
    { id: "muzzle", label: "Чок / насадка", group: "Ствол и цевьё", accepts: ["choke12"], mount: "muzzle" },
    { id: "forend", label: "Цевьё", group: "Ствол и цевьё", accepts: ["fe870"], mount: "forend", required: true },
    { id: "mag", label: "Магазин", group: "Ствол и цевьё", accepts: ["tube870"], mount: "tubeEnd", required: true },
    { id: "rail", label: "Планка на коробку", group: "Оптика", accepts: ["rail870"], mount: "rcvTop" },
    { id: "optic", label: "Прицел", group: "Оптика", accepts: ["optic"], rails: ["rcvRail"], prefer: { x: -60 } },
    { id: "saddle", label: "Патронташ", group: "Коробка", accepts: ["saddle870"], mount: "saddle" },
    { id: "tacRight", label: "Правая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["feRight"], prefer: "front" },
    { id: "tacLeft", label: "Левая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["feLeft"], prefer: "front" },
    { id: "under", label: "Под цевьём", group: "Тактика", accepts: ["foregrip"], rails: ["feBottom"], prefer: "front" },
    { id: "stock", label: "Приклад", group: "Коробка", accepts: ["stock870"], mount: "stock", required: true },
    { id: "ammo", label: "Патроны", group: "Боеприпас", accepts: ["shell12"], mount: "ammo", required: true }
  ],
  parts: [
    { id: "b18", cat: "b870", name: "Ствол 470 мм (18,5\"), мушка-бусина", desc: "Штатный Police Magnum, цилиндр", stats: { weight: 820 }, build: (c) => m870Barrel(c, { id: "b18", len: 470 }) },
    { id: "b20r", cat: "b870", name: "Ствол 508 мм (20\"), винтовочные прицелы", desc: "Целик-щель и мушка с тритием — для пули", stats: { weight: 900, length: 38, moa: -1.2, velocity: 12, adsTime: 10 }, build: (c) => m870Barrel(c, { id: "b20r", len: 508, rifle: true }) },
    { id: "b26v", cat: "b870", name: "Ствол 660 мм (26\"), вентилируемая планка", desc: "Охотничий: длинный прицельный радиус", stats: { weight: 1080, length: 190, moa: -0.6, velocity: 20, ergo: -8, adsTime: 40 }, build: (c) => m870Barrel(c, { id: "b26v", len: 660, rib: true }) },
    { id: "b14", cat: "b870", name: "Ствол 356 мм (14\"), штурмовой", desc: "Короткий для прорыва: быстрее вскидка, шире осыпь", stats: { weight: 640, length: -114, velocity: -18, ergo: 6, adsTime: -30, "recoilV%": 6 }, build: (c) => m870Barrel(c, { id: "b14", len: 356 }) },
    { id: "ch_cyl", cat: "choke12", name: "Чок «цилиндр»", desc: "Без сужения: самая широкая осыпь", fit: { thread: ["remchoke"] }, stats: { weight: 30, length: 16 }, build: (c) => choke(c, { ext: 16, notches: 0, pattern: 1 }) },
    { id: "ch_ic", cat: "choke12", name: "Чок «получок» (IC)", desc: "Лёгкое сужение 0,25 мм", fit: { thread: ["remchoke"] }, stats: { weight: 32, length: 18 }, build: (c) => choke(c, { ext: 18, notches: 1, pattern: 0.82 }) },
    { id: "ch_mod", cat: "choke12", name: "Чок «модифицированный»", desc: "Сужение 0,5 мм: осыпь уже на треть", fit: { thread: ["remchoke"] }, stats: { weight: 34, length: 20 }, build: (c) => choke(c, { ext: 20, notches: 2, pattern: 0.66 }) },
    { id: "ch_full", cat: "choke12", name: "Чок «полный» (Full)", desc: "Сужение 0,9 мм, для пули не годится", fit: { thread: ["remchoke"] }, stats: { weight: 36, length: 22 }, build: (c) => choke(c, { ext: 22, notches: 3, pattern: 0.52 }) },
    { id: "breacher", cat: "choke12", name: "Пробойный стенд-офф", desc: "Зубья упираются в дверь; газ отводится в стороны", fit: { thread: ["remchoke"] }, stats: { weight: 120, length: 46, loud: 2, flash: 20, "recoilV%": -6 }, build: (c) => choke(c, { ext: 38, notches: 0, ports: true, teeth: true, pattern: 1.15 }) },
    { id: "salvo12", cat: "choke12", name: "SilencerCo Salvo 12", desc: "Глушитель под чок-резьбу: минус ~25 дБ", fit: { thread: ["remchoke"] }, stats: { weight: 960, length: 250, loud: -24, flash: -70, "recoilV%": -14, ergo: -12, adsTime: 40 }, build: salvo },
    { id: "fe_corn", cat: "fe870", name: "Цевьё Express, полимер", desc: "Рифлёное, штатное", stats: { weight: 180 }, build: (c) => forendClassic(c, { mat: "poly" }) },
    { id: "fe_walnut", cat: "fe870", name: "Цевьё Wingmaster, орех", desc: "Классическое деревянное", stats: { weight: 230, ergo: 1 }, build: (c) => forendClassic(c, { mat: "woodDark" }) },
    { id: "fe_beaver", cat: "fe870", name: "Цевьё «бобровый хвост», дерево", desc: "Широкое полицейское", stats: { weight: 260, ergo: 3 }, build: (c) => forendClassic(c, { mat: "wood", beaver: true }) },
    { id: "fe_mlok", cat: "fe870", name: "Magpul MOE M-LOK", desc: "Упор под ладонь, короткие планки по бокам и снизу", stats: { weight: 220, ergo: 4 }, build: forendMoe },
    { id: "fe_dsf", cat: "fe870", name: "SureFire DSF-870", desc: "Цевьё-фонарь 800 лм, клавиши под пальцы (C)", stats: { weight: 380, ergo: 2 }, build: forendDSF },
    { id: "tube4", cat: "tube870", name: "Штатный магазин, 4", desc: "Трубка до кольца ствола", stats: { weight: 40, mag: 4 }, build: (c) => tubeExt(c, { len: 0 }) },
    { id: "tube6", cat: "tube870", name: "Удлинитель +2 (6)", desc: "С хомутом на ствол", needs: (cfg) => cfg.barrel?.id !== "b14", stats: { weight: 180, mag: 6, ergo: -3, adsTime: 10 }, build: (c) => tubeExt(c, { len: 128, cap: 6 }) },
    { id: "tube7", cat: "tube870", name: "Удлинитель +3 (7)", desc: "Нужен ствол от 20\"", needs: (cfg) => ["b20r", "b26v"].includes(cfg.barrel?.id), stats: { weight: 240, mag: 7, ergo: -5, adsTime: 14 }, build: (c) => tubeExt(c, { len: 190, cap: 7 }) },
    { id: "rail_mesa", cat: "rail870", name: "Планка Mesa Tactical", desc: "Седло на штифтах УСМ, Пикатинни 130 мм", stats: { weight: 110 }, build: (c) => rcvRail(c, { len: 150, h: 12 }) },
    { id: "saddle6", cat: "saddle870", name: "Mesa SureShell, 6 патронов", desc: "Алюминиевый патронташ слева", stats: { weight: 290, ergo: -2 }, build: (c) => sideSaddle(c, { n: 6, mat: "alu" }) },
    { id: "saddle4", cat: "saddle870", name: "Патронташ-карта, 4 патрона", desc: "Лёгкая полимерная пластина", stats: { weight: 90 }, build: (c) => sideSaddle(c, { n: 4, mat: "poly" }) },
    { id: "st_express", cat: "stock870", name: "Приклад Express, полимер", desc: "Штатный с резиновым затыльником", stats: { weight: 560 }, build: (c) => stock870(c, { mat: "poly" }) },
    { id: "st_walnut", cat: "stock870", name: "Приклад Wingmaster, орех", desc: "С пистолетным выступом шейки", stats: { weight: 680, ergo: 2 }, build: (c) => stock870(c, { mat: "woodDark", pg: true }) },
    { id: "st_sga", cat: "stock870", name: "Magpul SGA", desc: "Вертикальный хват, прямой гребень", stats: { weight: 620, ergo: 5, "recoilV%": -10, "recoilH%": -10 }, build: stockSGA },
    { id: "st_fold", cat: "stock870", name: "Складной сверху + рукоять", desc: "K — сложить: короче на 30 см", stats: { weight: 720, ergo: 1, "recoilV%": 6 }, build: stockFold },
    AMMO12("buck00", "Картечь 00 (9 × 8,4 мм)", "Классика для ближнего боя", { pellets: 9, pattern: 90, energy: 1 }, { velocity: 0 }),
    AMMO12("shot4", "Дробь №4 (27 × 6 мм)", "Много мелких дробин, быстро теряет энергию", { pellets: 27, pattern: 105, energy: 0.6, recoil: 0.85 }, { velocity: 20, "recoilV%": -12 }),
    AMMO12("slug", "Пуля Бреннеке 31,5 г", "Одна пуля: точно до 75 м", { pellets: 1, energy: 1.6, recoil: 1.1 }, { velocity: 30, moa: 0, "recoilV%": 10 })
  ],
  defaults: {
    barrel: "b18",
    muzzle: null,
    forend: "fe_corn",
    mag: "tube4",
    rail: null,
    optic: null,
    saddle: null,
    tacRight: null,
    tacLeft: null,
    under: null,
    stock: "st_express",
    ammo: "buck00"
  }
};

