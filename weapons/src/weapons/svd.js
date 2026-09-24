// src/weapons/svd.js
// СВД: газоотводная автоматика с коротким ходом поршня, фрезерованная коробка, «ласточкин хвост» слева.
// Единицы — мм, ось канала ствола y = 0, x = 0 — передний срез коробки, +z — правый борт.
var SV = {
  FRONT: 26,
  REAR: -236,
  WALL: 12,
  BOTTOM: -26,
  GAS_Y: 25,
  GAS_R: 8,
  SIGHT_Y: 46,
  REAR_X: 64,
  FRONT_X: 596,
  MUZZLE: 612,
  MAG_X: 2
};
function svdReceiver(ctx, k) {
  const { extrudeX: exX, extrudeZ: exZ, extrudeY: exY, T: T2, box: bx, cylZ: cZ, latheX: lX, shape: sh, rrect: rr } = ctx.G;
  const { FRONT: F, REAR: R4, WALL: W, BOTTOM: B } = SV;
  const M = "steel";
  // фрезерованные борта: окно выброса справа и выборка под рукоять затворной рамы
  const right = [[F, B, 1], [F, W], [-8, W], [-8, 0, 1], [-96, 0, 1], [-96, 8], [-214, 8], [-214, W], [R4, W], [R4, -14, 2], [R4 + 10, B, 3]];
  const left = [[F, B, 1], [F, W], [R4, W], [R4, -14, 2], [R4 + 10, B, 3]];
  k.add(M, exZ(right, 2.2, { bevel: 0.5, z: 14.4 }));
  k.add(M, exZ(left, 2.2, { bevel: 0.5, z: -14.4 }));
  k.add(M, exY(sh(rr((F + R4) / 2, 0, F - R4, 30, 1), [rr(-40, 0, 80, 24, 2)]), B - 1.6, B, { bevel: 0.3 }));
  k.add(M, exX(rr(0, (B + W) / 2 - 2, 27, W - B - 4, 1), 6, F, { bevel: 0.6 }));
  k.add(M, exX(rr(0, (B + W) / 2 - 2, 27, W - B - 6, 1), R4, R4 + 16, { bevel: 0.6 }));
  k.add("lensBlack", exX(rr(0, -8, 26, 8, 0), -213, 4, { bevel: 0 }));
  // продольные рёбра фрезеровки и выборки облегчения
  for (const s of [-1, 1]) {
    k.add(M, T2(exZ([[-200, -10], [-110, -10], [-108, -6, 1], [-202, -6, 1]], 1, { bevel: 0.3 }), { p: [0, 0, s * 15.6] }));
    k.add(M, exX(rr(s * 14.8, W - 0.6, 3.4, 1.6, 0.4), R4, F, { bevel: 0.2 }));
  }
  // «ласточкин хвост» на левом борту
  k.add("steel", exX(sh([[-15.5, -12, 1], [-15.5, 6, 1], [-19, 8], [-24, 5, 1], [-24, -9, 1], [-19, -12]]), -176, -60, { bevel: 0.6 }));
  for (const x of [-150, -84]) k.add("steelWorn", T2(cZ(3, -25, -23.6, { seg: 14 }), { p: [x, -2, 0] }));
  // штифты и защёлка магазина
  for (const s of [-1, 1]) for (const [x, y] of [[-120, -8], [-150, -8], [-40, -18], [8, -18]]) k.add("steelWorn", T2(cZ(2.4, 0, 1, { seg: 12 }), { p: [x, y, s > 0 ? 16.4 : -17.4] }));
  k.add(M, exZ([[-36, B], [-44, B], [-48, -40, 2], [-43, -44, 2], [-38, -36]], 12, { bevel: 0.8 }));
  // спусковая скоба (штампованная) и рукоять перезаряжания рамы
  const tg = sh([[-80, B], [-156, B], [-156, -32, 3], [-144, -48, 6], [-96, -50, 6], [-82, -38, 3]], [[[-88, B - 2.5], [-150, B - 2.5], [-141, -43, 5], [-98, -45, 5], [-88, -35, 3]]]);
  k.add(M, exZ(tg, 10, { bevel: 0.8 }));
}
function svdCover(ctx, k) {
  const { extrudeX: exX, T: T2, box: bx, cylX: cX } = ctx.G;
  const arc = (w, y0, y1, r, n = 14) => {
    const pts = [[w, y0]];
    const cy = y1 - r;
    pts.push([w, cy]);
    for (let i = 1; i < n; i++) {
      const a = i / n * Math.PI;
      pts.push([Math.cos(a) * w, cy + Math.sin(a) * r]);
    }
    pts.push([-w, cy], [-w, y0]);
    return pts;
  };
  const outer = arc(16.6, 12.4, 29, 12.5), inner = arc(15.2, 12.4, 27.6, 11.2).reverse();
  k.add("steel", exX([...outer, ...inner.map((p) => [p[0], p[1]])], SV.REAR + 1, SV.FRONT - 2, { bevel: 0.3 }));
  for (const x of [-190, -150, -110]) k.add("steel", exX([...arc(17.1, 15, 29.5, 13), ...arc(16.5, 15, 28.9, 12.4).reverse()], x - 3, x + 3, { bevel: 0.6 }));
  // упор крышки и кнопка
  k.add("steelWorn", T2(cX(4.6, SV.REAR - 7, SV.REAR - 0.5, { c: 0.8, seg: 18 }), { p: [0, 18, 0] }));
  k.add("steel", exX(arc(16.6, 12.4, 29, 12.5), SV.REAR - 1, SV.REAR + 2, { bevel: 0.5 }));
}
function svdBarrel(ctx, k, o) {
  const { latheX: lX, extrudeX: exX, extrudeZ: exZ, T: T2, box: bx, cylX: cX, cylZ: cZ, wire: wr } = ctx.G;
  const { FRONT: F, MUZZLE: MZ, GAS_Y: GY, GAS_R: GR, SIGHT_Y: SY, REAR_X: RX, FRONT_X: FX } = SV;
  const M = "steel";
  k.add(M, lX([[F - 6, 0], [F - 6, 13.4], [106, 13.4], [110, 12], [250, 11], [400, 10], [446, 9.4], [580, 9], [596, 9], [598, 7.4], [MZ, 7.4], [MZ, 3.4], [MZ - 5, 3.4], [MZ - 5, 0]], { seg: 36 }));
  // колодка прицела (как у АК, но выше) и секторный целик
  k.add(M, exZ([[F - 2, 6], [104, 6], [104, 30, 2], [96, 38, 3], [40, 40, 3], [F - 2, 35, 2]], 26, { bevel: 1.4 }));
  const leaf = ctx.kit();
  leaf.add(M, exZ([[RX - 30, 39.4], [RX + 28, 37], [RX + 28, 39.4], [RX - 24, 42.4, 2], [RX - 30, 42.8]], 17, { bevel: 0.5 }));
  const notch = [[-8.5, 38.4, 1], [8.5, 38.4, 1], [8.5, SY, 0.8], [1.5, SY, 0.2], [1.2, SY - 2.4, 0.5], [-1.2, SY - 2.4, 0.5], [-1.5, SY, 0.2], [-8.5, SY, 0.8]];
  leaf.add(M, exX(notch, RX - 2, RX + 1.4, { bevel: 0.3 }));
  leaf.add("steelWorn", exZ([[RX + 2, 38.6], [RX + 14, 38], [RX + 14, 44.5, 1], [RX + 2, 45.2, 1]], 20, { bevel: 0.8 }));
  for (let i = 0; i < 10; i++) leaf.add("paintWhite", T2(bx(0.6, 0.2, 3), { p: [RX - 22 + i * 5, 42.1 - i * 0.28, 5] }));
  const leafNode = leaf.build("rearLeaf");
  // газовая трубка, газовая камора с регулятором, толкатель
  k.add(M, T2(cX(GR, 100, 420, { c: 0.8, seg: 24 }), { p: [0, GY, 0] }));
  k.add(M, exZ([[404, -10, 2], [438, -10, 2], [438, 12, 2], [432, 36, 4], [408, 36, 3], [404, 26]], 24, { bevel: 1.6 }));
  k.add(M, T2(cX(11.5, 398, 440, { c: 1.2, seg: 28 }), { p: [0, GY, 0] }));
  k.add("steelWorn", T2(cZ(4, 12, 15.5, { seg: 6 }), { p: [428, GY, 0] }));
  k.add("steelWorn", T2(exZ([[0, 0], [12, 0], [12, 3], [0, 3]], 2, { bevel: 0.3 }), { p: [424, GY + 2, 15.4] }));
  // основание мушки с намордником и упором штыка
  k.add(M, exZ([[FX - 34, -12, 2], [FX + 10, -12, 2], [FX + 10, 10, 2], [FX + 2, 18, 3], [FX - 26, 18, 3], [FX - 34, 10, 2]], 22, { bevel: 1.4 }));
  for (const s of [-1, 1]) k.add(M, exZ([[FX - 12, 14], [FX + 8, 14], [FX + 6, SY + 5, 3], [FX - 10, SY + 5, 3]], 2.4, { bevel: 0.4, z: s * 8.8 }));
  k.add(M, exZ([[FX - 1.2, 16], [FX + 1.2, 16], [FX + 1.2, SY - 2], [FX + 0.9, SY, 0.3], [FX - 0.9, SY, 0.3], [FX - 1.2, SY - 2]], 2.4, { bevel: 0.2 }));
  if (o.bayonet) k.add(M, exZ([[FX - 30, -11], [FX + 4, -11], [FX + 4, -22, 2], [FX - 24, -22, 2]], 11, { bevel: 1 }));
  k.add("steelWorn", T2(cX(3, 300, FX - 32, { c: 0.6, seg: 12 }), { p: [0, -15, 0] }));
  return leafNode;
}
function svdTrigger(ctx, nodes) {
  const { extrudeZ: exZ, node: nd, cylZ: cZ } = ctx.G;
  const t = ctx.kit();
  t.add("steel", exZ([[-2, 3], [3, 3], [3, -6, 2], [0, -17, 4], [-5, -23, 2], [-7, -21], [-3, -8, 3]], 6, { bevel: 0.9 }));
  nodes.trigger = nd("trigger", [t.build()], { p: [-118, -20, 0] });
  // флажок-предохранитель АК-типа на правом борту, ось у заднего торца
  const s = ctx.kit();
  s.add("steel", exZ([[-4, -4, 2], [150, 1, 2], [156, 4, 2], [156, 12, 2], [146, 13, 2], [4, 6, 3], [-4, 4, 2]], 1.8, { bevel: 0.4, z: 16.9 }));
  s.add("steel", exZ([[146, 4], [156, 4], [158, -4, 2], [148, -4, 2]], 3, { bevel: 0.8, z: 17.6 }));
  s.add("steel", cZ(5.5, 15.5, 18, { seg: 20 }));
  nodes.selector = nd("selector", [s.build()], { p: [-214, 2, 0] });
  return [nodes.trigger, nodes.selector];
}
function svdCarrier(ctx) {
  const { extrudeX: exX, extrudeY: exY, T: T2, box: bx, cylX: cX, cylZ: cZ, latheX: lX, shape: sh, node: nd, rrect: rr } = ctx.G;
  const k = ctx.kit();
  k.add("steelBright", exX(rr(0, 12, 22, 15, 3), -170, 6, { bevel: 1 }));
  k.add("steelWorn", cX(9, -40, 0, { c: 0.8, seg: 24 }));
  // рукоять рамы — массивная, справа
  const hx = -96;
  k.add("steelBright", exY(sh([[hx - 16, 10], [hx + 18, 10], [hx + 8, 22, 3], [hx - 12, 24, 3]]), 4, 11, { bevel: 0.8 }));
  k.add("steelBright", T2(cZ(4, 18, 28, { seg: 16 }), { p: [hx - 2, 7.5, 0] }));
  k.add("steelBright", T2(lX([[0, 0], [0, 6.2], [2.4, 7.6], [9, 7.6], [12, 5.2], [13, 0]], { seg: 22 }), { r: [0, -90, 0], p: [hx - 2, 7.5, 27] }));
  return nd("carrier", [k.build()]);
}
function svdBase(ctx) {
  const { node: nd } = ctx.G;
  const k = ctx.kit();
  const nodes = {};
  svdReceiver(ctx, k);
  svdCover(ctx, k);
  const leaf = svdBarrel(ctx, k, { bayonet: true });
  const trg = svdTrigger(ctx, nodes);
  const body = k.build("receiver");
  nodes.carrier = svdCarrier(ctx);
  const root = nd("svd", [body, leaf, nodes.carrier, ...trg]);
  const { mount: mount2 } = ctx;
  root.add(mount2({ id: "hg", type: "hg", p: [0, 0, 0] }));
  root.add(mount2({ id: "dovetail", type: "dovetail", p: [-118, -2, -19], slots: 1, axis: "side" }));
  root.add(mount2({ id: "muzzle", type: "thread", p: [SV.MUZZLE - 16, 0, 0] }));
  root.add(mount2({ id: "magwell", type: "magwell", p: [SV.MAG_X, SV.BOTTOM, 0], rock: [0, 0, 16] }));
  root.add(mount2({ id: "stock", type: "stock", p: [SV.REAR, 0, 0] }));
  return {
    root,
    nodes,
    anim: { carrierTravel: 128, selector: { safe: 0, semi: -16 } },
    eject: { p: [-52, 6, 17], dir: [0.3, 0.5, 1], speed: 3.6 },
    muzzle: [SV.MUZZLE, 0, 0],
    irons: { rear: [SV.REAR_X, SV.SIGHT_Y, 0], front: [SV.FRONT_X, SV.SIGHT_Y, 0], type: "notch" },
    eyeX: -300,
    focus: { center: [30, -50, 0], size: 1420 }
  };
}
/* --------------------------------------------------------------- цевьё */
// Накладки: две половины с продолговатыми отверстиями охлаждения, передняя пружинная обойма.
function svdHg(ctx, o) {
  const { extrudeX: exX, T: T2, box: bx, node: nd, shape: sh, slot: sl, extrudeZ: exZ, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const x0 = 110, x1 = 388, M = o.mat;
  const half = (s) => [[0, 36, 3], [s * 21, 30, 6], [s * 23, 6, 8], [s * 17, -18, 8], [0, -21, 3], [0, -17], [s * 13, -14], [s * 19, 6], [s * 17, 28], [0, 32]];
  for (const s of [-1, 1]) k.add(M, exX(half(s).map(([z, y, r]) => [z, y, r || 0]), x0, x1, { bevel: 1.4 }));
  // отверстия охлаждения по бортам
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) k.add("lensBlack", T2(exZ(sh(sl(-16, 16, 0, 8)), 1, { bevel: 0.2 }), { p: [x0 + 30 + i * 40, 12, s * 22.4] }));
  // обойма
  k.add("steel", exX([[-24, 34, 4], [24, 34, 4], [24, -22, 8], [-24, -22, 8]].map(([z, y, r]) => [z, y, r]), x1, x1 + 12, { bevel: 1 }));
  k.add("steel", exX([[-24, 34, 4], [24, 34, 4], [24, -22, 8], [-24, -22, 8]], x0 - 10, x0, { bevel: 1 }));
  k.add("steelWorn", T2(cZ(2.4, 23, 25.5, { seg: 12 }), { p: [x1 + 6, 6, 0] }));
  return { root: nd("hg", [k.build()]) };
}
function svdHgRail(ctx) {
  const { extrudeX: exX, T: T2, box: bx, node: nd, picatinny: pic, mlokHoles: ml, extrudeZ: exZ, shape: sh, circle: ci } = ctx.G;
  const k = ctx.kit();
  const x0 = 106, x1 = 392;
  const sec = [[-24, 14, 2], [-26, -4, 4], [-20, -24, 6], [20, -24, 6], [26, -4, 4], [24, 14, 2], [20, 14], [21, -2], [16, -19], [-16, -19], [-21, -2], [-20, 14]];
  k.add("alu", exX(sec, x0, x1, { bevel: 1.2 }));
  k.add("alu", exX(sh([[-15, 12, 2], [15, 12, 2], [15, SV.GAS_Y + 11, 3], [-15, SV.GAS_Y + 11, 3]], [ci(0, SV.GAS_Y, 8.6, 24)]), x0 + 4, x1 - 4, { bevel: 1.2 }));
  for (const h of ml(x0 + 20, x1 - 70, -8, { h: 7, len: 32 })) for (const s of [-1, 1]) k.add("lensBlack", exZ(sh(h), 1, { bevel: 0.2, z: s * 25.8 }));
  const mounts = [];
  const add = (id, face, rot, len, pos, base) => {
    const r = pic(len, { base });
    k.add("alu", r.geo, { r: rot, p: pos });
    mounts.push(ctx.railMount(id, [pos[0] + r.first, pos[1], pos[2]], face, r.slots, { axis: face }));
  };
  add("hgBottom", "bottom", [180, 0, 0], 200, [x1 - 206, -33, 0], 9);
  add("hgRight", "right", [90, 0, 0], 70, [x1 - 80, -4, 34], 8.5);
  add("hgLeft", "left", [-90, 0, 0], 70, [x1 - 80, -4, -34], 8.5);
  add("gasRail", "top", [0, 0, 0], 170, [x0 + 8, SV.GAS_Y + 20.4, 0], 9.4);
  return { root: nd("svd_rail", [k.build(), ...mounts]) };
}
/* --------------------------------------------------------------- дульные */
function svdFh(ctx) {
  const { latheX: lX, T: T2, box: bx, node: nd } = ctx.G;
  const k = ctx.kit();
  // штатный: длинный цилиндр с пятью продольными прорезями, срез со «щелью»
  k.add("steel", lX([[0, 0], [0, 11.6], [2, 12.4], [70, 12.4], [72, 11.2], [72, 7.6], [4, 7.6], [4, 0]], { seg: 36 }));
  for (let i = 0; i < 5; i++) k.add("lensBlack", T2(bx(38, 2.4, 3.6, { bevel: 0.6 }), { p: [48, 11.6, 0], r: [i * 72, 0, 0] }));
  return { root: nd("svdfh", [k.build()]), muzzle: { x: 72, kind: "fh", flash: 0.35 } };
}
function svdBrake(ctx) {
  const { latheX: lX, T: T2, box: bx, cylY: cY, node: nd, flutesX: fl } = ctx.G;
  const k = ctx.kit();
  k.add("steel", lX([[0, 0], [0, 13.4], [1.4, 15], [72, 15], [74, 13.6], [74, 5.4], [70, 5], [70, 0]], { seg: 36 }));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(11, 14, 4, { bevel: 2 }), { p: [28 + i * 16, 0, s * 13.8] }));
  for (let i = 0; i < 2; i++) k.add("lensBlack", T2(cY(2.4, 12, 16, { seg: 12 }), { p: [26 + i * 16, 0, 0] }));
  k.add("steel", fl(15, 3, 14, 6, 3, 0.6));
  return { root: nd("svdbrake", [k.build()]), muzzle: { x: 74, kind: "brake", flash: 0.6 } };
}
function svdCan(ctx) {
  const { latheX: lX, flutesX: fl, tubeX: tb, cylX: cX, node: nd, ringGrooves: rg } = ctx.G;
  const k = ctx.kit();
  const R4 = 22, L = 230;
  k.add("steel", lX([[0, 0], [0, 12.4], [20, 12.4], [20, 0]], { seg: 28 }));
  k.add("cast", lX([[8, 0], [8, R4 - 5], [14, R4], [L - 6, R4], [L, R4 - 5], [L, 6.4], [L - 3, 5.8], [L - 3, 0]], { seg: 48, crease: 30 }));
  k.add("cast", rg(R4 + 0.3, 16, 40, 8, 0.6, { seg: 48 }));
  for (const x of [80, 150]) k.add("cast", tb(R4 + 0.9, R4 - 0.2, x, x + 5, { seg: 48 }));
  k.add("lensBlack", cX(6.4, L - 3, L + 0.05, { seg: 20 }));
  return { root: nd("rotor43", [k.build()]), muzzle: { x: L, kind: "supp", flash: 0.03 } };
}
/* --------------------------------------------------------------- магазины */
function svdMag(ctx, o) {
  const { T: T2, box: bx } = ctx.G;
  const m = boxMag(ctx, { d0: 88, d1: 84, w: 25, lipH: 12, lipX0: 6, lipX1: 60, lipRise: 4.4, lipCurl: 3.2, cal: "762x54R", plateH: 6, plateOver: 6, roundTilt: 4, ...o });
  // «вафельные» выштамповки стального магазина
  if (o.waffle) {
    const k = ctx.kit();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) for (const s of [-1, 1]) k.add(o.mat, T2(bx(28, 18, 1.2, { bevel: 0.6 }), { p: [-22 - j * 36, -16 - i * 26, s * 12.9] }));
    m.root.add(k.build());
  }
  return m;
}
/* --------------------------------------------------------------- приклады */
// «Скелет» с пистолетным вырезом и съёмной щекой.
function svdStock(ctx, o) {
  const { extrudeZ: exZ, T: T2, box: bx, shape: sh, node: nd, cylZ: cZ } = ctx.G;
  const k = ctx.kit();
  const M = o.mat;
  const outline = [[16, 14, 2], [-6, 14, 3], [-60, 4, 16], [-210, -6, 20], [-360, -10, 8], [-372, -12, 4], [-372, -150, 6], [-352, -152, 10], [-240, -96, 30], [-120, -72, 16], [-70, -112, 14], [-40, -114, 10], [-26, -60, 10], [-2, -26, 4], [16, -26, 2]];
  const hole = [[-44, -30, 8], [-96, -44, 14], [-230, -58, 24], [-334, -60, 20], [-344, -40, 12], [-300, -22, 10], [-110, -18, 10], [-56, -12, 6]];
  k.add(M, exZ(sh(outline, [hole]), 34, { bevel: 6, curve: 8 }));
  // затыльник (сталь со «сдвоенным» упором)
  k.add("steel", T2(exZ([[-372, -8, 3], [-380, -8, 4], [-380, -154, 6], [-372, -152, 4]], 38, { bevel: 1.6 }), {}));
  if (o.cheek) {
    // съёмная щека на защёлке
    k.add(o.cheekMat || "polySoft", T2(exZ([[-70, 17, 8], [-250, 11, 10], [-250, -8, 4], [-70, 1, 4]], 38, { bevel: 5 }), {}));
    k.add("steelWorn", T2(cZ(3, -20, 20, { seg: 12 }), { p: [-110, 16, 0] }));
  }
  k.add("steel", exZ([[18, 16], [0, 16], [0, -24], [18, -24]], 30, { bevel: 1.2 }));
  slingLoop(ctx, k, "steel", [-338, -145, 0], { side: -1, w: 20 });
  return { root: nd("svdstock", [k.build()]), cheek: { x: -140, y: 18 } };
}
function svdsStock(ctx) {
  const { extrudeZ: exZ, T: T2, cylX: cX, cylZ: cZ, node: nd, box: bx, loftX: lf, superEllipse: se } = ctx.G;
  const k = ctx.kit(), f = ctx.kit();
  // СВДС: пистолетная рукоять + трубчатый приклад, складывается вправо
  const g = [[-18, -24], [-26, -60, 8], [-38, -112, 10], [-72, -114, 12], [-66, -60, 12], [-52, -24, 6]];
  k.add("poly", exZ(g.map(([x, y, r]) => [x, y, r || 0]), 30, { bevel: 7, curve: 8 }));
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) k.add("poly", T2(bx(1.4, 50, 1.2, { bevel: 0.3 }), { p: [-40 - i * 4 - 8, -78, s * 14.6], r: [0, 0, -18] }));
  k.add("steel", exZ([[16, 16], [-14, 16], [-14, -24], [16, -24]], 34, { bevel: 1.4 }));
  k.add("steelWorn", T2(ctx.G.cylY(5, -24, 16, { seg: 18 }), { p: [-10, 0, 20] }));
  f.add("steel", T2(cX(11, -330, -20, { c: 1, seg: 28 }), { p: [0, -6, 0] }));
  f.add("steel", T2(cX(9, -300, -20, { c: 1, seg: 24 }), { p: [0, -46, 0] }));
  f.add("steel", exZ([[-326, 6, 4], [-346, 6, 4], [-346, -140, 6], [-326, -136, 4]], 36, { bevel: 2 }));
  f.add("rubber", exZ([[-346, 6, 4], [-354, 6, 4], [-354, -142, 6], [-346, -140, 4]], 40, { bevel: 2 }));
  f.add("polySoft", T2(exZ([[-90, 22, 6], [-260, 20, 8], [-260, 4, 4], [-90, 6, 4]], 34, { bevel: 5 }), {}));
  const fold = nd("fold", [f.build()], { p: [-10, 0, 20] });
  fold.children[0].position.set(10, 0, -20);
  return { root: nd("svds", [k.build(), fold]), fold: { node: fold, axis: "y", angle: 172 }, cheek: { x: -140, y: 18 } };
}
function svdmStock(ctx) {
  const { extrudeZ: exZ, T: T2, cylX: cX, cylZ: cZ, node: nd, box: bx } = ctx.G;
  const k = ctx.kit(), sl = ctx.kit();
  // СВДМ: регулируемый телескопический приклад на трубе, регулируемая щека
  const g = [[-18, -24], [-26, -60, 8], [-38, -112, 10], [-72, -114, 12], [-66, -60, 12], [-52, -24, 6]];
  k.add("poly", exZ(g.map(([x, y, r]) => [x, y, r || 0]), 30, { bevel: 7, curve: 8 }));
  k.add("steel", exZ([[16, 16], [-30, 16], [-30, -24], [16, -24]], 34, { bevel: 1.4 }));
  k.add("alu", T2(cX(14.6, -250, -28, { c: 1, seg: 32 }), { p: [0, -2, 0] }));
  sl.add("poly", exZ([[-190, 20, 4], [-330, 20, 4], [-340, 10, 4], [-340, -140, 8], [-300, -140, 10], [-260, -60, 20], [-190, -22, 8]], 40, { bevel: 4 }));
  sl.add("rubber", exZ([[-340, 12, 4], [-352, 12, 4], [-352, -142, 8], [-340, -140, 4]], 42, { bevel: 2.5 }));
  sl.add("poly", T2(exZ([[-190, 40, 6], [-320, 40, 6], [-320, 22], [-190, 22]], 32, { bevel: 4 }), {}));
  for (const x of [-220, -290]) sl.add("alu", T2(cX(4, 0, 18, { seg: 14 }), { r: [0, 0, 90], p: [x, 22, 0] }));
  const slide = nd("slide", [sl.build()]);
  return { root: nd("svdm", [k.build(), slide]), fold: { node: slide, slide: 60 }, cheek: { x: -250, y: 40 } };
}
var svd_default = {
  id: "svd",
  family: "svd",
  title: "СВД — снайперская винтовка Драгунова",
  short: "СВД",
  caliber: "7,62×54R",
  cal: "762x54R",
  thread: "svd",
  boltHold: true,
  holdByFollower: true,
  chargeLabel: "затвор",
  specs: [["Ствол", "620 мм"], ["Длина", "1225 мм"], ["Магазин", "10"], ["Масса", "4,3 кг"]],
  base: { weight: 3700, length: 1225, ergo: 38, recoilV: 100, recoilH: 80, moa: 1.2, velocity: 830, range: 800, loud: 166, flash: 50, adsTime: 420, rpm: 600, mag: 10 },
  audio: { cal: "762x54R", mech: 1 },
  modes: ["safe", "semi"],
  build: svdBase,
  keepOut: [{ axis: "top", x0: 60, x1: 110, label: "колодка целика" }],
  slots: [
    { id: "handguard", label: "Цевьё", group: "Ствол и цевьё", accepts: ["svdhg"], mount: "hg", required: true },
    { id: "muzzle", label: "Дульное устройство", group: "Ствол и цевьё", accepts: ["muzzle"], mount: "muzzle" },
    { id: "sidemount", label: "Боковой кронштейн", group: "Оптика", accepts: ["sidemount"], rails: ["dovetail"] },
    { id: "optic", label: "Прицел", group: "Оптика", accepts: ["optic"], rails: ["sideRail", "dovetail", "gasRail"], prefer: { x: -110 } },
    { id: "under", label: "Под стволом", group: "Тактика", accepts: ["foregrip", "bipod"], rails: ["hgBottom"], prefer: "front" },
    { id: "tacRight", label: "Правая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["hgRight"], prefer: "front" },
    { id: "tacLeft", label: "Левая планка", group: "Тактика", accepts: ["light", "laser", "combo"], rails: ["hgLeft"], prefer: "front" },
    { id: "mag", label: "Магазин", group: "Коробка", accepts: ["mag"], mount: "magwell" },
    { id: "stock", label: "Приклад", group: "Коробка", accepts: ["stock"], mount: "stock", required: true }
  ],
  parts: [
    { id: "hg_wood", cat: "svdhg", name: "Накладки, клеёная берёза", desc: "Штатные, с отверстиями охлаждения", stats: { weight: 260 }, build: (c) => svdHg(c, { mat: "wood" }) },
    { id: "hg_poly", cat: "svdhg", name: "Накладки, полимер", desc: "Чёрный стеклонаполненный полиамид", stats: { weight: 210, ergo: 1 }, build: (c) => svdHg(c, { mat: "poly" }) },
    { id: "hg_rail", cat: "svdhg", name: "Цевьё с планками", desc: "Пикатинни снизу, по бортам и на газовой трубке", stats: { weight: 480, ergo: 3 }, build: svdHgRail },
    { id: "svd_fh", cat: "muzzle", name: "Пламегаситель СВД", desc: "Штатный, пять прорезей", fit: { thread: ["svd"] }, stats: { weight: 110, length: 72, flash: -35 }, build: svdFh },
    { id: "svd_dtk", cat: "muzzle", name: "ДТК для СВД", desc: "Трёхкамерный: заметно меньше отдача, громче", fit: { thread: ["svd"] }, stats: { weight: 190, length: 74, flash: 20, "recoilV%": -26, "recoilH%": -20, loud: 4 }, build: svdBrake },
    { id: "rotor43", cat: "muzzle", name: "Глушитель Rotor 43 (7,62×54R)", desc: "Снижает звук и вспышку, пуля остаётся сверхзвуковой", fit: { thread: ["svd"] }, stats: { weight: 680, length: 230, loud: -25, flash: -60, "recoilV%": -14, ergo: -9, adsTime: 30, velocity: 8 }, build: svdCan },
    { id: "mag10", cat: "mag", name: "Магазин 10, сталь", desc: "Штатный, «вафельные» выштамповки", stats: { weight: 240, mag: 10 }, build: (c) => svdMag(c, { R: 900, len: 106, mat: "steelPark", cap: 10, waffle: true }) },
    { id: "mag10p", cat: "mag", name: "Магазин 10, полимер", desc: "Легче стального", stats: { weight: 150, mag: 10, ergo: 1 }, build: (c) => svdMag(c, { R: 900, len: 106, mat: "poly", cap: 10, ribs: true }) },
    { id: "mag20", cat: "mag", name: "Магазин 20", desc: "Удлинённый, мешает стрельбе лёжа", stats: { weight: 380, mag: 20, ergo: -5, adsTime: 14 }, build: (c) => svdMag(c, { R: 700, len: 176, mat: "steelPark", cap: 20, waffle: true }) },
    { id: "st_wood", cat: "stock", name: "Приклад-«скелет», берёза", desc: "Штатный, со съёмной щекой", stats: { weight: 620 }, build: (c) => svdStock(c, { mat: "wood", cheek: true, cheekMat: "wood" }) },
    { id: "st_poly", cat: "stock", name: "Приклад-«скелет», полимер", desc: "Чёрный, 1990-х годов", stats: { weight: 540, ergo: 1 }, build: (c) => svdStock(c, { mat: "poly", cheek: true, cheekMat: "poly" }) },
    { id: "st_svds", cat: "stock", name: "СВДС, складной", desc: "Трубчатый, складывается вправо (K)", stats: { weight: 700, ergo: 2, "recoilV%": 4 }, build: svdsStock },
    { id: "st_svdm", cat: "stock", name: "СВДМ, телескопический", desc: "Регулируемые длина и щека (K)", stats: { weight: 820, ergo: 5, "recoilV%": -8, "recoilH%": -6 }, build: svdmStock }
  ],
  defaults: {
    handguard: "hg_wood",
    muzzle: "svd_fh",
    sidemount: null,
    optic: "pso1",
    under: null,
    tacRight: null,
    tacLeft: null,
    mag: "mag10",
    stock: "st_wood"
  }
};

