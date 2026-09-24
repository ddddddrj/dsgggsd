// src/weapons/mp5.js
// HK MP5A3: свободный затвор с роликовым замедлением, штампованная коробка, трубка взведения над стволом.
// Единицы — мм, ось канала ствола y = 0, x = 0 — казённый срез, +z — правый борт (окно выброса).
var H5 = {
  REAR: -222,
  FRONT: 64,
  TOP: 30,
  BOT: -12,
  HW: 17,
  TUBE_Y: 21,
  TUBE_R: 9.6,
  TUBE_X1: 197,
  MUZZLE: 225,
  SIGHT_Y: 41,
  REAR_X: -197,
  FRONT_X: 191,
  MAG_X: 40
};
function mp5Section(port) {
  const { HW: W, TOP, BOT } = H5;
  // окно выброса — выемка правого борта, через неё виден затвор
  if (port) return [[-W, BOT, 1], [W, BOT, 1], [W, -4], [W - 3.6, -4], [W - 3.6, 13], [W, 13], [W, TOP, 11], [-W, TOP, 11]];
  return [[-W, BOT, 1], [W, BOT, 1], [W, TOP, 11], [-W, TOP, 11]];
}
function mp5Receiver(ctx, k) {
  const { extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylZ: cZ, cylX: cX, latheX: lX, shape: sh } = ctx.G;
  const { REAR: R4, FRONT: F, TOP, BOT, HW: W } = H5;
  const M = "steelMatte";
  k.add(M, exX(mp5Section(false), R4, -48, { bevel: 0.8 }));
  k.add(M, exX(mp5Section(true), -48, 6, { bevel: 0.4 }));
  k.add(M, exX(mp5Section(false), 6, F, { bevel: 0.8 }));
  k.add("lensBlack", T2(bx(52, 16, 1), { p: [-21, 4.5, W - 3.9] }));
  // рёбра жёсткости по бортам и выштамповки
  for (const s of [-1, 1]) {
    k.add(M, exX([[s * W, 18], [s * (W + 0.8), 18.6], [s * (W + 0.8), 21], [s * W, 21.6]], R4 + 6, F - 4, { bevel: 0.2 }));
    k.add(M, T2(exZ([[-176, -9], [-120, -9], [-118, -7, 1], [-178, -7, 1]], 1, { bevel: 0.3 }), { p: [0, 0, s * (W + 0.2)] }));
  }
  // гнёзда «когтей» кронштейна сверху
  for (const x of [-150, -40]) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(12, 2, 4.5, { bevel: 0.6 }), { p: [x, TOP - 3.2, s * 12.2], r: [s * 35, 0, 0] }));
  // задний торец под затыльник и штифты
  k.add(M, exX(sh(mp5Section(false).map(([z, y, r]) => [z * 1.04, y, r])), R4 - 4, R4, { bevel: 0.6 }));
  for (const [x, y] of [[-205, -4], [-44, -6]]) {
    k.add("steelWorn", T2(cZ(3, -W - 1.2, W + 1.2, { seg: 16 }), { p: [x, y, 0] }));
    for (const s of [-1, 1]) k.add("steelWorn", T2(cZ(4.4, 0, 1, { seg: 18 }), { p: [x, y, s > 0 ? W + 0.2 : -W - 1.2] }));
  }
  // казённая часть: кольцо цапфы и переход в трубку
  k.add(M, exX([[-15, -10, 3], [15, -10, 3], [15, 30, 9], [-15, 30, 9]], F, F + 18, { bevel: 1.4 }));
  // приёмник магазина: штамповка с рёбрами, кнопка справа, лапка сзади
  const mw = [[H5.MAG_X + 7, BOT + 1], [H5.MAG_X - 42, BOT + 1], [H5.MAG_X - 42, -40, 2], [H5.MAG_X - 30, -44, 3], [H5.MAG_X + 5, -44, 3], [H5.MAG_X + 9, -38, 2]];
  k.add(M, exZ(mw, 29, { bevel: 0.8 }));
  k.add("lensBlack", T2(exZ([[H5.MAG_X - 1, -44.2], [H5.MAG_X - 38, -44.2], [H5.MAG_X - 38, -43], [H5.MAG_X - 1, -43]], 25, { bevel: 0.2 }), {}));
  for (const s of [-1, 1]) k.add(M, T2(bx(34, 1.2, 1, { bevel: 0.3 }), { p: [H5.MAG_X - 18, -26, s * 14.7] }));
  k.add("steelWorn", T2(cZ(4.2, 14.4, 16.2, { seg: 20 }), { p: [H5.MAG_X - 34, -33, 0] }));
  k.add(M, T2(exZ([[0, 0], [5, 0], [6, -16, 2], [2, -20, 2], [-1, -14]], 12, { bevel: 1 }), { p: [H5.MAG_X - 46, -34, 0] }));
}
function mp5Barrel(ctx, k) {
  const { latheX: lX, extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylX: cX, ringGrooves: rg, shape: sh, circle: ci } = ctx.G;
  const { FRONT: F, MUZZLE: MZ, TUBE_Y: TY, TUBE_R: TR, TUBE_X1: TX, SIGHT_Y: SY, FRONT_X: FX } = H5;
  k.add("steelMatte", lX([[F + 16, 0], [F + 16, 10.5], [F + 26, 10.5], [F + 28, 8.8], [182, 8.4], [182, 10.4], [200, 10.4], [201, 8.2], [212, 8.2], [212.5, 7.2], [MZ, 7.2], [MZ, 3], [MZ - 5, 3], [MZ - 5, 0]], { seg: 32 }));
  // три зацепа под глушитель/пламегаситель
  for (let i = 0; i < 3; i++) k.add("steelMatte", T2(bx(10, 3.4, 7, { bevel: 0.7 }), { p: [206, 9.4, 0], r: [90 + i * 120, 0, 0] }));
  k.add("steelWorn", rg(7.3, 213, MZ - 0.5, 9, 0.35, { seg: 28 }));
  // трубка взведения с продольным пазом слева
  k.add("steelMatte", T2(cX(TR, F + 6, TX, { c: 1, seg: 32 }), { p: [0, TY, 0] }));
  k.add("lensBlack", T2(bx(96, 3.4, 2, { bevel: 0.3 }), { p: [F + 50, TY, -TR + 0.6] }));
  k.add("lensBlack", T2(bx(3.4, 8, 2, { bevel: 0.3 }), { p: [F + 3.4, TY + 4, -TR + 1] }));
  k.add("steelMatte", T2(lX([[TX - 2, 0], [TX - 2, TR + 0.8], [TX + 2, TR + 0.8], [TX + 3, TR - 1], [TX + 3, 0]], { seg: 32 }), { p: [0, TY, 0] }));
  // кольцо мушки на стойке
  k.add("steelMatte", exZ([[181, 4], [199, 4], [199, SY - 6, 2], [193, SY - 3], [183, SY - 3], [181, SY - 7, 2]], 14, { bevel: 1 }));
  k.add("steelMatte", exX(sh(ci(0, SY, 12.5, 32), [ci(0, SY, 10, 28).reverse()]), FX - 4, FX + 4, { bevel: 0.6 }));
  k.add("steelWorn", exZ([[FX - 1.2, SY - 10], [FX + 1.2, SY - 10], [FX + 1, SY], [FX - 1, SY]], 2, { bevel: 0.2 }));
  // стойка между трубкой и стволом
  k.add("steelMatte", exZ([[168, 6], [181, 6], [181, TY - 4], [168, TY - 4]], 10, { bevel: 0.6 }));
}
function mp5RearSight(ctx, k) {
  const { extrudeZ: exZ, extrudeX: exX, cylY: cY, latheX: lX, flutesX: fl, T: T2, box: bx, shape: sh, circle: ci, rrect: rr } = ctx.G;
  const { TOP, SIGHT_Y: SY, REAR_X: RX } = H5;
  const M = "steelMatte";
  // основание и поворотный барабан (ось вертикальная). Барабан полый: диоптр — настоящее
  // сквозное отверстие, через него видно кольцо мушки (раньше это был чёрный кружок).
  k.add(M, exZ([[RX - 16, TOP - 1], [RX + 22, TOP - 1], [RX + 18, TOP + 4, 2], [RX - 14, TOP + 5, 2]], 24, { bevel: 1 }));
  for (const s of [-1, 1]) k.add(M, exZ([[RX - 10, TOP + 3], [RX + 8, TOP + 3], [RX + 6, SY + 7, 2], [RX - 8, SY + 7, 2]], 2.4, { bevel: 0.4, z: s * 12.4 }));
  const R = 10.2, Ri = 8.6, hb = 4.2, gap = Math.asin(hb / R) * 180 / Math.PI;
  const drumY = (y0, y1, o = {}) => T2(lX([[y0, o.capLo ? 0 : Ri], [y0, R - 0.6], [y0 + 0.6, R], [y1 - 0.6, R], [y1, R - 0.6], [y1, o.capHi ? 0 : Ri], ...(o.capHi || o.capLo ? [] : [[y0, Ri]])], { seg: 40, a0: o.a0, arc: o.arc }), { r: [0, 0, 90], p: [RX, 0, 0] });
  k.add(M, drumY(TOP + 3, SY - hb, { capLo: true }));
  k.add(M, drumY(SY + hb, SY + 6, { capHi: true }));
  for (const a of [gap, 180 + gap]) k.add(M, drumY(SY - hb, SY + hb, { a0: a, arc: 180 - 2 * gap }));
  // рифление по окружности барабана — только вне окон диоптров
  const fls = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * 360;
    if (Math.abs(((a + 90) % 180) - 90) < gap + 8) continue;
    fls.push(T2(T2(bx(SY + 6 - TOP - 7, 0.7, 1.2, { bevel: 0.25 }), { p: [(SY + 6 + TOP + 3) / 2, R + 0.15, 0] }), { r: [a, 0, 0] }));
  }
  k.add(M, T2(ctx.G.merge(fls), { r: [0, 0, 90], p: [RX, 0, 0] }));
  // рабочий диоптр со стороны глаза (Ø3,6) и широкое окно спереди — не ограничивает поле
  const plate = (x0, x1, rh) => exX(sh(rr(0, SY, 2 * hb + 0.6, 2 * hb + 0.6, 0.8), [ci(0, SY, rh, 28).reverse()]), x0, x1, { bevel: 0.25 });
  k.add(M, plate(RX - R + 0.2, RX - Ri + 0.4, 1.8));
  k.add(M, plate(RX + Ri - 0.4, RX + R - 0.2, 3.4));
  k.add("steelWorn", T2(lX([[0, 1.8], [0, 2.5], [0.5, 2.5], [0.5, 1.8]], { seg: 28 }), { p: [RX - R, SY, 0] }));
  k.add("lensBlack", T2(cY(Ri - 0.3, SY - hb - 0.05, SY - hb + 0.1, { seg: 32 }), { p: [RX, 0, 0] }));
  k.add("paintWhite", T2(bx(0.6, 3, 0.6), { p: [RX, SY + hb + 1.4, R + 0.1] }));
}
function mp5Base(ctx) {
  const { node: nd, T: T2, box: bx, cylZ: cZ, cylY: cY, latheX: lX, extrudeZ: exZ } = ctx.G;
  const k = ctx.kit();
  const nodes = {};
  mp5Receiver(ctx, k);
  mp5Barrel(ctx, k);
  const rs = ctx.kit();
  mp5RearSight(ctx, rs);
  nodes.rearSight = nd("rearSight", [rs.build()]);
  const body = k.build("receiver");
  // затвор в окне выброса
  const c = ctx.kit();
  c.add("steelBright", T2(bx(60, 14, 3, { bevel: 0.6 }), { p: [-22, 4.5, 12.4] }));
  c.add("steelWorn", T2(cZ(3.4, 12.6, 14.4, { seg: 16 }), { p: [-2, 4.5, 0] }));
  c.add("steelWorn", T2(bx(6, 3, 1.2), { p: [-40, 9, 13.8] }));
  nodes.carrier = nd("carrier", [c.build()]);
  // рукоять взведения: поворачивается вверх в вырез трубки
  const h = ctx.kit();
  h.add("steelWorn", T2(exZ([[-4, -3], [4, -3], [3, 3], [-3, 3]], 20, { bevel: 0.8 }), { p: [0, 0, -H5.TUBE_R - 8] }));
  h.add("steelWorn", T2(lX([[0, 0], [0, 4.6], [1.5, 5.4], [8, 5.4], [9, 4.2], [9, 0]], { seg: 18 }), { r: [0, 90, 0], p: [0, 0, -H5.TUBE_R - 16] }));
  h.add("polySoft", T2(cY(5.8, -3.4, 3.4, { c: 1, seg: 18 }), { p: [-2, 0, -H5.TUBE_R - 22] }));
  nodes.handle = nd("handle", [h.build()], { p: [150, H5.TUBE_Y, 0] });
  const root = nd("mp5a3", [body, nodes.rearSight, nodes.carrier, nodes.handle]);
  const { mount: mount2 } = ctx;
  root.add(mount2({ id: "hg", type: "hg", p: [0, 0, 0] }));
  root.add(mount2({ id: "claw", type: "claw", p: [-96, H5.TOP, 0] }));
  root.add(mount2({ id: "muzzle", type: "thread", p: [H5.MUZZLE - 25, 0, 0] }));
  root.add(mount2({ id: "magwell", type: "magwell", p: [H5.MAG_X, H5.BOT - 2, 0] }));
  root.add(mount2({ id: "trigger", type: "trigger", p: [-44, H5.BOT, 0] }));
  root.add(mount2({ id: "stock", type: "stock", p: [H5.REAR - 4, 0, 0] }));
  return {
    root,
    nodes,
    anim: { carrierTravel: 62, handleTravel: 92, handleLock: 32, triggerAngle: 0.2 },
    eject: { p: [-20, 6, 18], dir: [0.45, 0.35, 1], speed: 4.2 },
    muzzle: [H5.MUZZLE, 0, 0],
    irons: { rear: [H5.REAR_X - 10, H5.SIGHT_Y, 0], front: [H5.FRONT_X, H5.SIGHT_Y, 0], type: "aperture", eye: 34, hole: 1.8 },
    eyeX: -300,
    focus: { center: [-90, -30, 0], size: 760 }
  };
}
/* --------------------------------------------------------------- цевья */
function hgSlim(ctx, o) {
  const { extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, node: nd, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const x0 = H5.FRONT + 20, x1 = 176;
  const hw = o.wide ? 22 : 17.5, top = H5.TUBE_Y + (o.wide ? 3 : -1);
  const sec = [[-hw, top, 3], [-hw - 1, 2, 6], [-hw + 3, -16, 8], [hw - 3, -16, 8], [hw + 1, 2, 6], [hw, top, 3], [hw - 3, top], [hw - 3, 2], [hw - 6, -12], [-hw + 6, -12], [-hw + 3, 2], [-hw + 3, top]];
  k.add("poly", exX(sec, x0, x1, { bevel: 1.4 }));
  const rib = o.wide ? 7 : 9;
  for (let i = 0; i < rib; i++) for (const s of [-1, 1]) k.add("poly", T2(bx(3.2, 16, 1.6, { bevel: 0.6 }), { p: [x0 + 10 + i * ((x1 - x0 - 20) / (rib - 1)), -4, s * (hw + 0.9)] }));
  if (o.wide) {
    // тропическое: подъём под палец и отверстия охлаждения
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(10, 5, 1, { bevel: 0.6 }), { p: [x0 + 24 + i * 22, 12, s * (hw + 0.2)] }));
    k.add("poly", exX([[-hw - 1, -14, 4], [hw + 1, -14, 4], [hw - 2, -22, 6], [-hw + 2, -22, 6]], x1 - 18, x1, { bevel: 1.6 }));
  }
  k.add("steelWorn", T2(cZ(2.4, -hw - 1.2, hw + 1.2, { seg: 14 }), { p: [x0 + 8, 10, 0] }));
  return { root: nd("hg", [k.build()]) };
}
function hgRail(ctx) {
  const { extrudeX: exX, T: T2, box: bx, node: nd, picatinny: pic } = ctx.G;
  const k = ctx.kit();
  const x0 = H5.FRONT + 20, x1 = 178;
  const sec = [[-21, 32, 2], [-24, 8, 4], [-20, -22, 5], [20, -22, 5], [24, 8, 4], [21, 32, 2], [17, 32], [18, 8], [15, -17], [-15, -17], [-18, 8], [-17, 32]];
  k.add("alu", exX(sec, x0, x1, { bevel: 1 }));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(22, 6, 1, { bevel: 0.5 }), { p: [x0 + 22 + i * 30, 20, s * 22.6] }));
  const mounts = [];
  const add = (id, face, rot, len, pos, base) => {
    const r = pic(len, { base });
    k.add("alu", r.geo, { r: rot, p: pos });
    mounts.push(ctx.railMount(id, [pos[0] + r.first, pos[1], pos[2]], face, r.slots, { axis: face }));
  };
  add("hgBottom", "bottom", [180, 0, 0], 86, [x1 - 90, -31, 0], 10);
  add("hgRight", "right", [90, 0, 0], 60, [x1 - 64, 4, 32], 9);
  add("hgLeft", "left", [-90, 0, 0], 60, [x1 - 64, 4, -32], 9);
  return { root: nd("bt_rail", [k.build(), ...mounts]) };
}
// Цевьё-фонарь SureFire 628: встроенный фонарь, кнопки под пальцы.
function hgLight(ctx) {
  const { extrudeX: exX, latheX: lX, T: T2, box: bx, node: nd, cylX: cX } = ctx.G;
  const k = ctx.kit();
  const x0 = H5.FRONT + 20, x1 = 178;
  const sec = [[-19, H5.TUBE_Y - 1, 3], [-21, 0, 8], [-17, -30, 10], [17, -30, 10], [21, 0, 8], [19, H5.TUBE_Y - 1, 3], [16, H5.TUBE_Y - 1], [17, 2], [14, -12], [-14, -12], [-17, 2], [-16, H5.TUBE_Y - 1]];
  k.add("poly", exX(sec, x0, x1 - 6, { bevel: 1.6 }));
  k.add("alu", T2(lX([[x1 - 12, 0], [x1 - 12, 13], [x1 - 6, 15.5], [x1 + 4, 15.5], [x1 + 4, 13.5], [x1 + 3, 0]], { seg: 32 }), { p: [0, -17, 0] }));
  for (const s of [-1, 1]) k.add("rubber", T2(bx(60, 12, 1.6, { bevel: 0.8 }), { p: [x0 + 50, -6, s * 20.6] }));
  const root = nd("sf628", [k.build()]);
  const le = new ctx.THREE.Mesh(cX(13, x1 + 2.8, x1 + 3.6, { seg: 32 }).translate(0, -17, 0), ctx.mats.get("lampLens").clone());
  le.userData.lens = true;
  root.add(le);
  return { root, light: { p: [x1 + 5, -17, 0], lens: le, lumens: 500 } };
}
/* --------------------------------------------------------------- кронштейн */
function clawMount(ctx, o) {
  const { extrudeX: exX, T: T2, box: bx, node: nd, picatinny: pic, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const L = o.len, x0 = -L / 2, h = o.h;
  // основание с четырьмя «когтями» по гнёздам коробки и двумя стяжными гайками
  k.add("alu", exX([[-19, 2, 2], [19, 2, 2], [19, h - 9.4, 2], [-19, h - 9.4, 2]], x0, x0 + L, { bevel: 1.2 }));
  for (const x of [-54, 56]) {
    if (Math.abs(x) > L / 2 + 4) continue;
    for (const s of [-1, 1]) k.add("steel", T2(bx(12, 10, 3, { bevel: 0.8 }), { p: [x, -2, s * 17.5], r: [s * 12, 0, 0] }));
  }
  for (const x of [-30, 30]) {
    k.add("steel", T2(cZ(4.2, 19, 23, { seg: 6 }), { p: [x, 5, 0] }));
    k.add("steel", T2(cZ(3.4, -23, -19, { seg: 18 }), { p: [x, 5, 0] }));
  }
  const r = pic(L - 4, { base: 9.4 });
  k.add("alu", r.geo, { p: [x0 + 2, h, 0] });
  const m = ctx.railMount("clawRail", [x0 + 2 + r.first, h, 0], "top", r.slots, { axis: "top" });
  return { root: nd("claw", [k.build(), m]) };
}
/* --------------------------------------------------------------- спусковая коробка */
// Полимерная рамка с рукоятью. Флажок переводчика — узел, его углы берёт движок (info.selector).
function mp5Trigger(ctx, o) {
  const { extrudeZ: exZ, T: T2, box: bx, cylZ: cZ, node: nd, shape: sh } = ctx.G;
  const k = ctx.kit();
  const M = o.mat || "poly";
  // корпус под коробкой: от штифта (x=0) назад
  k.add(M, exZ([[4, 0], [-176, 0], [-176, -10, 3], [-160, -14, 4], [4, -14, 3]], 32, { bevel: 1.4 }));
  // рукоять под углом, со спинкой и выемками под пальцы
  // рукоять SEF: наклон ≈12°, три выемки под пальцы спереди, «горб» под ладонь сзади, расширение у пятки
  const gy = [-8, -22, -34, -44, -52, -60, -68, -76, -84, -93, -101, -106, -109];
  const ga = [22, 21.5, 19, 21.5, 19.2, 21.8, 19.2, 21.5, 19.6, 21, 21.5, 20, 16];
  const g2 = [23, 23, 23.5, 24.5, 25, 25, 24.6, 24, 23.4, 23, 23.4, 22.5, 18];
  const gb = [15, 15, 14.8, 15, 15.2, 15.4, 15.4, 15.2, 15, 15, 15.4, 15, 12];
  const secs = gy.map((y, i) => ({ c: [-140 + (y + 8) * 0.21, y], a: ga[i], a2: g2[i], b: gb[i], k: 2.6, kb: 3.2 }));
  k.add(o.gripMat || "polyGrip", ctx.G.loftPath(secs, { seg: 40 }));
  // пятка рукояти — крышка с антабкой-проушиной
  k.add(M, T2(exZ([[-8, 0, 2], [44, 0, 2], [42, -4, 2], [-6, -4, 2]], 26, { bevel: 1.4 }), { p: [-181, -107, 0], r: [0, 0, -12] }));
  // спусковая скоба
  k.add(M, exZ(sh([[-44, -12], [-114, -12], [-110, -46, 8], [-60, -50, 10], [-44, -34, 6]], [[[-52, -16], [-106, -16], [-104, -40, 6], [-64, -44, 8], [-54, -32, 4]]]), 14, { bevel: 1.2 }));
  k.add("steelWorn", T2(cZ(3, -17, 17, { seg: 14 }), { p: [-8, -6, 0] }));
  const t = ctx.kit();
  t.add("steelMatte", exZ([[-2, 4], [3, 4], [3, -6, 2], [1, -18, 4], [-4, -24, 2], [-6, -22], [-3, -8, 3]], 6, { bevel: 0.8 }));
  const trigger = nd("trigger", [t.build()], { p: [-82, -14, 0] });
  // флажок переводчика слева (и справа у амбидекстральной)
  const s = ctx.kit();
  for (const sd of o.ambi ? [-1, 1] : [-1]) {
    s.add("steelMatte", T2(cZ(6.4, 0, 2.4, { seg: 24 }), { p: [0, 0, sd > 0 ? 16.4 : -18.8] }));
    s.add("steelMatte", T2(exZ([[-3.4, 0, 1.5], [3.4, 0, 1.5], [2.2, 20, 2], [-2.2, 20, 2]], 2, { bevel: 0.5 }), { p: [0, 0, sd * 18.4] }));
  }
  const sel = nd("selector", [s.build()], { p: [-150, -7, 0] });
  // пиктограммы режимов по дуге вокруг оси флажка: белая — предохранитель, красные — огонь
  for (const [m, a] of Object.entries(o.angles)) {
    const r = a * Math.PI / 180;
    k.add(m === "safe" ? "paintWhite" : "paintRed", T2(bx(3, 3, 0.5, { bevel: 0.6 }), { p: [-150 - Math.sin(r) * 25, -7 + Math.cos(r) * 25, -17.6] }));
  }
  const body = k.build("tg");
  k.add("steelWorn", T2(cZ(3, -17, 17, { seg: 14 }), { p: [-8, -6, 0] }));
  return { root: nd("trigger_" + o.id, [body, trigger, sel]), modes: o.modes, selector: { node: sel, angles: o.angles, axis: "z" } };
}
/* --------------------------------------------------------------- приклады */
function stockA3(ctx) {
  const { extrudeZ: exZ, extrudeX: exX, T: T2, box: bx, cylX: cX, node: nd, cylZ: cZ } = ctx.G;
  const k = ctx.kit(), sl = ctx.kit();
  // направляющие в пазах коробки — видны по бортам
  // длина по реальному A3: 700 мм выдвинут / 550 мм сложен (ход 150)
  for (const s of [-1, 1]) sl.add("steel", T2(exX([[-3.2, -3], [3.2, -3], [3.2, 3], [-3.2, 3]].map(([z, y]) => [z, y, 1]), -246, 60, { bevel: 0.6 }), { p: [0, 2, s * (H5.HW + 3.2)] }));
  // затыльник с резиновой накладкой
  sl.add("steel", T2(exZ([[-2, 24, 3], [8, 24, 3], [8, -86, 6], [-2, -88, 6]], 44, { bevel: 2 }), { p: [-250, 0, 0] }));
  sl.add("rubber", T2(exZ([[-3, 26, 6], [3, 26, 6], [3, -92, 8], [-3, -92, 8]], 48, { bevel: 2.5 }), { p: [-256, 0, 0] }));
  for (let i = 0; i < 7; i++) sl.add("rubber", T2(bx(1.4, 2, 42), { p: [-259.4, 16 - i * 15, 0] }));
  for (const s of [-1, 1]) sl.add("steel", exZ([[-244, 4], [-244, -4], [-250, -28, 2], [-250, -20]], 3, { bevel: 0.6, z: s * 20 }));
  sl.add("steelWorn", T2(cZ(4, -22, 22, { seg: 16 }), { p: [-244, -60, 0] }));
  const slide = nd("a3slide", [sl.build()]);
  // защёлка на торце коробки
  k.add("steel", exZ([[0, 20], [-12, 20], [-12, -16, 3], [0, -16]], 40, { bevel: 1.2 }));
  k.add("steelWorn", T2(cZ(4.4, -24, 24, { seg: 18 }), { p: [-8, -8, 0] }));
  k.add("steel", T2(bx(10, 6, 12, { bevel: 1 }), { p: [-16, 22, 0] }));
  return { root: nd("a3", [k.build(), slide]), fold: { node: slide, slide: 150 } };
}
function stockA2(ctx) {
  const { extrudeZ: exZ, T: T2, box: bx, cylZ: cZ, node: nd, loftX: lf, superEllipse: se } = ctx.G;
  const k = ctx.kit();
  const prof = [[0, 4, 26, 18], [-40, -2, 30, 18.5], [-110, -18, 42, 19.5], [-180, -32, 54, 20.5], [-228, -38, 60, 21]];
  k.add("poly", lf(prof.map(([x, cy, hh, hw]) => ({ x, pts: se(hw, hh, 3.6, 28, cy, 0) }))));
  k.add("rubber", T2(exZ([[-3, 22, 6], [5, 22, 6], [5, -98, 8], [-3, -98, 8]], 44, { bevel: 2.5 }), { p: [-232, 0, 0] }));
  for (let i = 0; i < 8; i++) k.add("rubber", T2(bx(1.6, 2.2, 36), { p: [-236, 12 - i * 13, 0] }));
  k.add("steel", exZ([[0, 22], [-10, 22], [-10, -16, 3], [0, -16]], 38, { bevel: 1.2 }));
  k.add("steelWorn", T2(cZ(4.4, -22, 22, { seg: 18 }), { p: [-6, -8, 0] }));
  slingLoop(ctx, k, "steel", [-196, 20, 0], { side: 1, w: 18, h: 10 });
  return { root: nd("a2", [k.build()]) };
}
function endCap(ctx) {
  const { extrudeZ: exZ, T: T2, cylZ: cZ, node: nd, box: bx } = ctx.G;
  const k = ctx.kit();
  k.add("steel", exZ([[0, 26, 4], [-14, 26, 6], [-18, 0, 8], [-14, -16, 4], [0, -16]], 36, { bevel: 2 }));
  k.add("steelWorn", T2(cZ(4.4, -20, 20, { seg: 18 }), { p: [-6, -8, 0] }));
  k.add("steelWorn", T2(bx(6, 14, 30, { bevel: 2 }), { p: [-16, 6, 0] }));
  return { root: nd("cap", [k.build()]) };
}
/* --------------------------------------------------------------- дульные */
function hk3Cap(ctx) {
  const { latheX: lX, flutesX: fl, node: nd } = ctx.G;
  const k = ctx.kit();
  k.add("steelMatte", lX([[12, 0], [12, 9], [26, 9], [27, 8], [27, 0]], { seg: 28 }));
  k.add("steelMatte", fl(9, 14, 25, 16, 1.2, 0.5));
  return { root: nd("cap", [k.build()]), muzzle: { x: 27, kind: "bare", flash: 1 } };
}
function hk3Fh(ctx) {
  const { latheX: lX, T: T2, box: bx, node: nd } = ctx.G;
  const k = ctx.kit();
  k.add("steelMatte", lX([[-6, 0], [-6, 12.6], [-4, 13.2], [8, 13.2], [10, 11], [48, 11], [49, 9.8], [49, 5.6], [10, 5.6], [10, 0]], { seg: 36 }));
  for (let i = 0; i < 4; i++) k.add("lensBlack", T2(bx(26, 2.4, 3.4, { bevel: 0.5 }), { p: [33, 10.3, 0], r: [45 + i * 90, 0, 0] }));
  return { root: nd("fh3", [k.build()]), muzzle: { x: 49, kind: "fh", flash: 0.4 } };
}
function hk3Comp(ctx) {
  const { latheX: lX, T: T2, box: bx, cylY: cY, node: nd } = ctx.G;
  const k = ctx.kit();
  k.add("steelMatte", lX([[-6, 0], [-6, 13.4], [42, 13.4], [43, 12], [43, 5], [40, 5], [40, 0]], { seg: 36 }));
  for (let i = 0; i < 3; i++) k.add("lensBlack", T2(cY(2.4, 0, 3, { seg: 12 }), { p: [16 + i * 9, 11.4, 0] }));
  for (const s of [-1, 1]) k.add("lensBlack", T2(bx(8, 6, 3, { bevel: 1 }), { p: [30, 3, s * 11.8] }));
  return { root: nd("comp3", [k.build()]), muzzle: { x: 43, kind: "comp", flash: 0.8 } };
}
function hk3Can(ctx, o) {
  const { latheX: lX, flutesX: fl, ringGrooves: rg, tubeX: tb, cylX: cX, node: nd } = ctx.G;
  const k = ctx.kit();
  const R4 = o.r, L = o.len;
  // замок на три зацепа: рычаг-защёлка и рифлёная муфта
  k.add("steelMatte", lX([[-8, 0], [-8, R4 - 5], [-6, R4 - 3], [22, R4 - 3], [24, R4], [L - 6, R4], [L - 2, R4 - 2.6], [L, R4 - 5], [L, 5.4], [L - 2.5, 4.8], [L - 2.5, 0]], { seg: 48, crease: 30 }));
  k.add("steelMatte", rg(R4 - 2.6, -6, 20, 8, 0.6, { seg: 44 }));
  if (o.fins) k.add("steelMatte", fl(R4 - 0.3, 34, L - 16, o.fins, 3, 0.9));
  if (o.rings) for (const x of o.rings) k.add("steelMatte", tb(R4 + 0.8, R4 - 0.2, x, x + 3, { seg: 48 }));
  k.add("lensBlack", cX(5.3, L - 2.7, L + 0.05, { seg: 18 }));
  return { root: nd(o.name, [k.build()]), muzzle: { x: L, kind: "supp", flash: 0.03 } };
}
/* --------------------------------------------------------------- магазины */
function mp5Mag(ctx, o) {
  return boxMag(ctx, { d0: 35.5, d1: 34, w: 22, lipH: 9, lipX0: 4, lipX1: 26, lipRise: 2.6, lipCurl: 2.2, cal: "9x19", plateOver: 5, catchX: -34, catchY: -2, ...o });
}
var mp5a3_default = {
  id: "mp5a3",
  family: "mp5",
  title: "HK MP5A3",
  short: "MP5A3",
  caliber: "9×19 Парабеллум",
  cal: "9x19",
  thread: "hk3lug",
  boltHold: false,
  reload: "hk",
  chargeLabel: "рукоять взведения",
  burstN: 3,
  specs: [["Ствол", "225 мм"], ["Длина", "700 / 550 мм"], ["Темп", "800 выстр/мин"], ["Масса", "2,88 кг"]],
  base: { weight: 2540, length: 700, ergo: 62, recoilV: 70, recoilH: 55, moa: 3.2, velocity: 400, range: 200, loud: 157, flash: 35, adsTime: 230, rpm: 800, mag: 30 },
  audio: { cal: "9x19", mech: 1.05 },
  modes: ["safe", "semi", "auto"],
  build: mp5Base,
  slots: [
    { id: "handguard", label: "Цевьё", group: "Ствол и цевьё", accepts: ["mp5hg"], mount: "hg", required: true },
    { id: "muzzle", label: "Дульное устройство", group: "Ствол и цевьё", accepts: ["muzzle"], mount: "muzzle" },
    { id: "claw", label: "Кронштейн", group: "Оптика", accepts: ["claw"], mount: "claw" },
    { id: "optic", label: "Прицел", group: "Оптика", accepts: ["optic"], rails: ["clawRail"], prefer: { x: -110 } },
    { id: "magnifier", label: "Увеличитель", group: "Оптика", accepts: ["magnifier"], rails: ["clawRail"], prefer: "rear", behind: "optic" },
    { id: "under", label: "Под стволом", group: "Тактика", accepts: ["foregrip"], rails: ["hgBottom"], prefer: "front" },
    { id: "tacRight", label: "Правая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["hgRight"], prefer: "front" },
    { id: "tacLeft", label: "Левая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["hgLeft"], prefer: "front" },
    { id: "mag", label: "Магазин", group: "Коробка", accepts: ["mag"], mount: "magwell" },
    { id: "trigger", label: "Спусковая коробка", group: "Коробка", accepts: ["mp5tg"], mount: "trigger", required: true },
    { id: "stock", label: "Приклад", group: "Коробка", accepts: ["stock"], mount: "stock", required: true }
  ],
  parts: [
    { id: "hg_slim", cat: "mp5hg", name: "Узкое цевьё A3", desc: "Штатное полимерное, с рёбрами", stats: { weight: 110 }, build: (c) => hgSlim(c, {}) },
    { id: "hg_tropical", cat: "mp5hg", name: "Тропическое цевьё", desc: "Широкое, упор под ладонь, не греется", stats: { weight: 150, ergo: 3, "recoilV%": -2 }, build: (c) => hgSlim(c, { wide: true }) },
    { id: "hg_bt", cat: "mp5hg", name: "B&T цевьё с планками", desc: "Три планки Пикатинни: снизу и по бортам", stats: { weight: 230, ergo: 1 }, build: hgRail },
    { id: "hg_sf628", cat: "mp5hg", name: "SureFire 628 (цевьё-фонарь)", desc: "Встроенный фонарь 500 лм, кнопки под пальцы (C)", stats: { weight: 340, ergo: 2 }, build: hgLight },
    { id: "hk_cap", cat: "muzzle", name: "Колпачок резьбы", desc: "Защищает трёхзацепный выступ", fit: { thread: ["hk3lug"] }, stats: { weight: 12 }, build: hk3Cap },
    { id: "hk_fh", cat: "muzzle", name: "Пламегаситель HK (3 зацепа)", desc: "Щелевой, быстросъёмный", fit: { thread: ["hk3lug"] }, stats: { weight: 70, length: 55, flash: -30, "recoilV%": -2 }, build: hk3Fh },
    { id: "bt_comp", cat: "muzzle", name: "Компенсатор B&T", desc: "Газы вверх и в стороны: меньше подброс, громче", fit: { thread: ["hk3lug"] }, stats: { weight: 85, length: 49, flash: 12, "recoilV%": -14, "recoilH%": -8, loud: 2 }, build: hk3Comp },
    { id: "bt_supp", cat: "muzzle", name: "Глушитель B&T MP5 (3 зацепа)", desc: "Быстросъёмный: с дозвуковым 9 мм слышны почти только затвор и ролики", fit: { thread: ["hk3lug"] }, stats: { weight: 420, length: 190, loud: -30, flash: -34, "recoilV%": -12, ergo: -7, adsTime: 22, velocity: 5 }, build: (c) => hk3Can(c, { name: "bt", r: 20, len: 190, rings: [60, 120] }) },
    { id: "gem_raptor", cat: "muzzle", name: "Gemtech Raptor-II", desc: "Короткий лёгкий глушитель на три зацепа", fit: { thread: ["hk3lug"] }, stats: { weight: 290, length: 150, loud: -26, flash: -34, "recoilV%": -9, ergo: -5, adsTime: 16, velocity: 3 }, build: (c) => hk3Can(c, { name: "raptor", r: 19, len: 150, fins: 10 }) },
    { id: "claw_hk", cat: "claw", name: "Кронштейн HK STANAG", desc: "На «когтях» по гнёздам коробки, планка 120 мм", stats: { weight: 190 }, build: (c) => clawMount(c, { len: 128, h: 22 }) },
    { id: "claw_bt", cat: "claw", name: "B&T низкий кронштейн", desc: "Ниже на 7 мм: коллиматор ближе к оси", stats: { weight: 120, ergo: 1 }, build: (c) => clawMount(c, { len: 104, h: 15 }) },
    { id: "mag30", cat: "mag", name: "Магазин HK 30", desc: "Сталь, изогнутый, 30 патронов", stats: { weight: 150, mag: 30 }, build: (c) => mp5Mag(c, { R: 520, len: 190, mat: "steelMatte", cap: 30, ribs: true, ribMat: "steelMatte" }) },
    { id: "mag15", cat: "mag", name: "Магазин HK 15", desc: "Короткий прямой: ниже профиль", stats: { weight: 100, mag: 15, ergo: 2, adsTime: -6 }, build: (c) => mp5Mag(c, { R: 0, len: 108, mat: "steelMatte", cap: 15, ribs: true, ribMat: "steelMatte" }) },
    { id: "mag40", cat: "mag", name: "Магазин 40 (удлинённый)", desc: "Стальной, 40 патронов", stats: { weight: 210, mag: 40, ergo: -3, adsTime: 8 }, build: (c) => mp5Mag(c, { R: 520, len: 246, mat: "steelMatte", cap: 40, ribs: true, ribMat: "steelMatte" }) },
    { id: "drum50", cat: "mag", name: "Барабан KCI 50", desc: "Полимерный барабан на 50 патронов", stats: { weight: 620, mag: 50, ergo: -10, adsTime: 26 }, build: (c) => drumMag(c, { R: 520, len: 190, neck: 50, mat: "poly", cap: 50, drum: [-26, -84, 52, 50] }) },
    { id: "tg_sef", cat: "mp5tg", name: "SEF (0–1–F)", desc: "Штатная: предохранитель, одиночный, автомат", stats: { weight: 380 }, build: (c) => mp5Trigger(c, { id: "sef", modes: ["safe", "semi", "auto"], angles: { safe: 0, semi: -48, auto: -96 }}) },
    { id: "tg_navy", cat: "mp5tg", name: "Navy, 4 позиции (0–1–3–F)", desc: "Амбидекстральный флажок + очередь по 3", stats: { weight: 410, ergo: 2 }, build: (c) => mp5Trigger(c, { id: "navy", ambi: true, modes: ["safe", "semi", "burst", "auto"], angles: { safe: 0, semi: -45, burst: -90, auto: -135 }}) },
    { id: "tg_se", cat: "mp5tg", name: "Полуавтомат (0–1)", desc: "Только одиночный огонь — спортивная версия", stats: { weight: 360, moa: -0.3 }, build: (c) => mp5Trigger(c, { id: "se", mat: "polyGrey", modes: ["safe", "semi"], angles: { safe: 0, semi: -60 }}) },
    { id: "stock_a3", cat: "stock", name: "A3 выдвижной", desc: "Стальные направляющие, K — задвинуть/выдвинуть", stats: { weight: 500 }, build: stockA3 },
    { id: "stock_a2", cat: "stock", name: "A2 постоянный", desc: "Полимерный, лучшая опора щеки", stats: { weight: 420, ergo: 3, "recoilV%": -8, "recoilH%": -6 }, build: stockA2 },
    { id: "endcap", cat: "stock", name: "Затыльник без приклада", desc: "Короче и легче, стрелять сложнее", stats: { weight: 90, length: -150, ergo: 6, "recoilV%": 35, "recoilH%": 40, adsTime: -40 }, build: endCap }
  ],
  defaults: {
    handguard: "hg_slim",
    muzzle: "hk_cap",
    claw: null,
    optic: null,
    magnifier: null,
    under: null,
    tacRight: null,
    tacLeft: null,
    mag: "mag30",
    trigger: "tg_sef",
    stock: "stock_a3"
  }
};

