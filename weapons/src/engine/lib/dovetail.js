// src/engine/lib/dovetail.js
// Боковой «ласточкин хвост» (АК/СВД): кронштейн под Пикатинни и прицелы на прямом креплении.
function sideMount(ctx) {
  const k = ctx.kit();
  k.add("alu", extrudeX(shape([[-3, -9, 1], [4, -9], [4, 9], [-3, 9, 1], [-10, 7, 2], [-10, -7, 2]]), -55, 55, { bevel: 0.8 }));
  k.add("steel", T(ctx.C.knob(7, 6, 18), { r: [0, 90, 0], p: [30, 0, -10] }));
  k.add("steel", extrudeZ([[20, -4, 1], [44, -3, 2], [44, 3, 2], [20, 4, 1]], 3, { bevel: 0.6, z: -16 }));
  const riser = shape([[-55, 8, 2], [55, 8, 2], [55, 20, 3], [40, 46, 4], [-40, 46, 4], [-55, 20, 3]], [slot(-30, 30, 26, 14)]);
  k.add("alu", T(extrudeZ(riser, 8, { bevel: 1.2 }), { p: [0, 0, -5] }));
  const top = 58, cz = 19;
  k.add("alu", extrudeX(shape([[-6, 42, 2], [cz + 11, 42, 2], [cz + 11, top - 9, 2], [-6, top - 9, 2]]), -52, 52, { bevel: 1 }));
  const r = picatinny(104, { base: 9.4 });
  k.add("alu", r.geo, { p: [-52, top, cz] });
  const m = ctx.railMount("sideRail", [-52 + r.first, top, cz], "top", r.slots, { axis: "top" });
  return { root: node("sidemount", [k.build(), m]) };
}
function dovetailClamp(k, x0, x1) {
  k.add("steel", extrudeX(shape([[-3, -9, 1], [4, -9], [4, 9], [-3, 9, 1], [-11, 7, 2], [-11, -7, 2]]), x0, x1, { bevel: 0.8 }));
}
function pso1(ctx) {
  const k = ctx.kit();
  dovetailClamp(k, -60, 40);
  k.add("steel", extrudeZ([[-40, 4, 2], [-10, 4, 2], [-8, 16, 3], [-42, 16, 3]], 10, { bevel: 1.4, z: -6 }));
  k.add("steel", T(cylZ(3.5, -16, -8, { seg: 16 }), { p: [-26, 10, 0] }));
  const Y = 60, Z = 13;
  const at = (g) => g.translate(0, Y, Z);
  k.add("steel", extrudeX(shape([[-12, 6, 2], [4, 6, 2], [Z + 6, Y - 22, 4], [Z - 8, Y - 14, 4], [-12, 18, 2]]), -58, 36, { bevel: 1.5 }));
  k.add("steel", at(latheX([[-150, 0], [-150, 17], [-146, 19], [-120, 19], [-114, 16], [-96, 16], [-92, 17.2], [100, 17.2], [104, 18.4], [134, 18.4], [136, 20], [176, 20], [177, 18.8], [177, 0]], { seg: 40 })));
  k.add("lensBlack", at(tubeX(18.9, 17.8, 136, 177.2, { seg: 32 })));
  k.add("rubber", at(latheX([[-212, 16], [-212, 22.5], [-206, 24], [-190, 23], [-170, 20.5], [-151, 19.5], [-151, 16]], { seg: 36 })));
  k.add("lensBlack", at(tubeX(16.2, 14.5, -212, -150, { seg: 32 })));
  k.add("steel", extrudeX(shape([[Z - 16, Y + 6, 3], [Z + 16, Y + 6, 3], [Z + 16, Y + 20, 4], [Z - 16, Y + 20, 4]]), -34, 24, { bevel: 1.5 }));
  k.add("steel", T(cylY(15, Y + 19, Y + 31, { c: 1.4, seg: 36 }), { p: [-5, 0, Z] }));
  k.add("steel", T(flutesX(14.4, 0, 6, 36, 1.2, 0.8), { r: [0, 0, 90], p: [-5, Y + 24, Z] }));
  for (let i = 0; i < 10; i++) k.add("paintWhite", T(box(0.8, 3, 0.6), { p: [-5, Y + 27, Z + 15.2], r: [0, i * 36, 0] }));
  k.add("steel", T(cylZ(13, Z - 30, Z - 17, { c: 1.4, seg: 32 }), { p: [-5, Y, 0] }));
  k.add("steel", T(flutesX(12.4, 0, 6, 32, 1.2, 0.8), { r: [0, 90, 0], p: [-5, Y, Z - 23] }));
  k.add("steel", T(cylX(7, 40, 86, { c: 1, seg: 20 }), { p: [0, Y + 12, Z - 12] }));
  k.add("steel", T(ctx.C.knob(7.4, 6, 18), { p: [86, Y + 12, Z - 12] }));
  const root = node("pso1", [k.build()]);
  const oc = lens(ctx, at(ctx.C.lensDisc(15, -148)), "glassBlue");
  const ob = lens(ctx, at(ctx.C.lensDisc(17.4, 134)), "glassAmber");
  root.add(oc, ob);
  return { root, sight: { y: Y, z: Z, x0: -150, x1: 177, r: 15, mag: 4, reticle: "pso1", eyeRelief: 68, lens: oc } };
}
function kobra(ctx) {
  const k = ctx.kit();
  dovetailClamp(k, -50, 40);
  k.add("steel", T(ctx.C.knob(7, 6, 18), { r: [0, 90, 0], p: [-30, 0, -11] }));
  const Y = 54, Z = 19;
  k.add("alu", extrudeX(shape([[-12, 4, 2], [4, 4, 2], [Z + 16, 26, 3], [Z + 16, 34, 3], [-12, 18, 2]]), -48, 38, { bevel: 1.4 }));
  k.add("alu", extrudeX(shape([[Z - 18, 28, 3], [Z + 18, 28, 3], [Z + 18, 38, 3], [Z - 18, 38, 3]]), -50, 40, { bevel: 1.4 }));
  const frame = shape([[Z - 19, 36, 2], [Z + 19, 36, 2], [Z + 19, Y + 20, 6], [Z - 19, Y + 20, 6]], [rrect(Z, Y + 1, 30, 30, 4)]);
  k.add("alu", T(extrudeX(frame, -6, 6, { bevel: 1.2 }), { p: [28, 0, 0] }));
  k.add("alu", T(extrudeX(frame, -3, 3, { bevel: 0.8 }), { p: [-40, 0, 0] }));
  k.add("alu", extrudeX(shape([[Z - 19, Y + 16, 3], [Z + 19, Y + 16, 3], [Z + 19, Y + 21, 4], [Z - 19, Y + 21, 4]]), -42, 34, { bevel: 1 }));
  k.add("alu", T(ctx.C.knob(10, 8, 20), { r: [0, -90, 0], p: [-18, 33, Z + 18] }));
  k.add("alu", T(cylX(7.5, -50, -36, { c: 1, seg: 20 }), { p: [0, 33, Z] }));
  const root = node("kobra", [k.build()]);
  const win = lens(ctx, T(extrudeX(rrect(Z, Y + 1, 30, 30, 4), -0.6, 0.6, { bevel: 0.2 }), { p: [28, 0, 0] }), "glassAmber");
  root.add(win);
  return { root, sight: { y: Y + 1, z: Z, x0: -42, x1: 28, r: 14, mag: 1, reticle: "kobra", lens: win } };
}
// ПОСП 4–12×42: переменная кратность, штатный кронштейн на «ласточкин хвост».
function posp(ctx) {
  const k = ctx.kit();
  dovetailClamp(k, -70, 50);
  k.add("steel", T(ctx.C.knob(7.4, 6, 18), { r: [0, 90, 0], p: [-40, 0, -11] }));
  k.add("steel", extrudeZ([[-50, 4, 2], [-18, 4, 2], [-16, 16, 3], [-52, 16, 3]], 10, { bevel: 1.4, z: -6 }));
  const Y = 62, Z = 13;
  const at = (g, t = {}) => T(g, { ...t, p: [t.p?.[0] || 0, Y + (t.p?.[1] || 0), Z + (t.p?.[2] || 0)] });
  k.add("steel", extrudeX(shape([[-12, 6, 2], [4, 6, 2], [Z + 6, Y - 24, 4], [Z - 8, Y - 16, 4], [-12, 18, 2]]), -66, 46, { bevel: 1.5 }));
  for (const x of [-48, 26]) k.add("steel", T(tubeX(19.5, 15.1, x - 9, x + 9, { seg: 44, c: 1 }), { p: [0, Y, Z] }));
  scopeBody(ctx, k, at, { tube: 15, obj: 21, turret: 13, x0: -186, x1: 116, saddle: -8, mat: "steel" });
  const root = node("posp", [k.build()]);
  const oc = lens(ctx, at(ctx.C.lensDisc(18.5, -184)), "glassBlue");
  const ob = lens(ctx, at(ctx.C.lensDisc(21, 114)), "glassAmber");
  root.add(oc, ob);
  return { root, sight: { y: Y, z: Z, x0: -186, x1: 116, r: 15, mag: 4, zoom: [4, 12], reticle: "pso1", eyeRelief: 80, lens: oc } };
}
var DOVETAIL = [
  { id: "side_mount", cat: "sidemount", name: "Кронштейн «ласточкин хвост» — Пикатинни", desc: "Боковое крепление с планкой над крышкой", only: ["svd", "ak74", "akm"], mountTypes: ["dovetail"], stats: { weight: 190 }, build: sideMount },
  { id: "pso1", cat: "optic", name: "ПСО-1 4×24", desc: "Снайперский прицел с дальномерной шкалой и подсветкой", only: ["svd", "ak74", "akm"], mountTypes: ["dovetail"], foot: [-60, 40], body: [-212, 177], needs: (cfg) => !cfg.sidemount, stats: { weight: 580, ergo: -8, adsTime: 45 }, build: pso1 },
  { id: "posp", cat: "optic", name: "ПОСП 4–12×42 В", desc: "Переменная кратность, сетка типа ПСО, колесо — кратность", only: ["svd", "ak74", "akm"], mountTypes: ["dovetail"], foot: [-70, 50], body: [-186, 116], needs: (cfg) => !cfg.sidemount, stats: { weight: 760, ergo: -10, adsTime: 55 }, build: posp },
  { id: "kobra", cat: "optic", name: "ЭКП-1С-03 «Кобра»", desc: "Коллиматор, четыре сетки, крепление на боковую планку", only: ["svd", "ak74", "akm"], mountTypes: ["dovetail"], foot: [-50, 40], body: [-50, 40], needs: (cfg) => !cfg.sidemount, stats: { weight: 380, ergo: -3, adsTime: 15 }, build: kobra }
];

