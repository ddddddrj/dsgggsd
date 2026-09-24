// src/engine/lib/muzzle.js
function socom(ctx, o) {
  const k = ctx.kit();
  const R4 = 19.05, L = o.len;
  k.add("steel", latheX([[0, 0], [0, 10.4], [1, 11], [14, 11], [15, 10], [15, 0]], { seg: 28 }));
  k.add("cast", latheX([[10, 0], [10, 14.6], [12, 16.4], [30, 16.4], [31, 18.2], [36, R4 - 0.2], [L - 6, R4], [L - 3, R4 - 1.2], [L, R4 - 3], [L, 5.4], [L - 2, 4.6], [L - 2, 0]], { seg: 48, crease: 30 }));
  k.add("cast", flutesX(16.2, 12, 30, 30, 1.8, 1));
  k.add("steel", ringGrooves(17.2, 31, 36, 3, 0.4, { seg: 40 }));
  k.add("cast", flutesX(R4 - 0.3, L - 22, L - 7, 12, 3.2, 0.7));
  k.add("lensBlack", cylX(5.2, L - 2.2, L + 0.05, { seg: 20 }));
  return { root: k.build("socom"), muzzle: { x: L, kind: "supp", flash: 0.04 } };
}
function a2(ctx) {
  const k = ctx.kit();
  k.add("steel", latheX([[0, 0], [0, 10.5], [1, 11], [9, 11], [9.5, 10.6], [43, 10.6], [44, 9.8], [44, 5.6], [10, 5.6], [10, 0]], { seg: 32 }));
  for (const a of [-72, -36, 0, 36, 72]) k.add("lensBlack", T(box(22, 2.4, 3.6, { bevel: 0.5 }), { p: [28, 9.6, 0], r: [a, 0, 0] }));
  k.add("steel", flutesX(10.6, 2, 8, 2, 5, 0.6, { a0: 90 }));
  return { root: k.build("a2"), muzzle: { x: 44, kind: "fh", flash: 0.4 } };
}
function warcomp(ctx, R4) {
  const k = ctx.kit();
  k.add("steel", latheX([[0, 0], [0, R4 - 0.5], [1, R4], [26, R4], [27, R4 - 1.5], [30, R4 - 1.5], [30, R4 * 0.5], [0, R4 * 0.5]], { seg: 32 }));
  for (let i = 0; i < 3; i++) {
    const a = 60 + i * 120;
    k.add("steel", T(extrudeZ([[0, 0], [28, 0], [30, -1, 1], [26, -3.5], [0, -3.5]], 7, { bevel: 0.8 }), { p: [29, R4 - 0.3, 0], r: [a, 0, 0] }));
  }
  for (const a of [-40, 0, 40]) k.add("lensBlack", T(box(3.2, 3, 6, { bevel: 0.6 }), { p: [18, R4 - 1.2, 0], r: [a, 0, 0] }));
  k.add("steel", flutesX(R4, 2, 10, 2, 6, 0.5, { a0: 90 }));
  return { root: k.build("warcomp"), muzzle: { x: 59, kind: "fh", flash: 0.3 } };
}
function linear(ctx, r) {
  const k = ctx.kit();
  const R4 = 14.3, L = 62;
  k.add("steel", latheX([[0, 0], [0, r + 1.5], [1, r + 3], [14, r + 3], [15, R4 - 0.6], [16, R4], [L - 1.5, R4], [L, R4 - 1.4], [L, 10.2], [L - 3, 9.6], [L - 3, 0]], { seg: 40 }));
  k.add("steel", flutesX(r + 3, 3, 12, 2, 8, 0.8, { a0: 90 }));
  k.add("steel", ringGrooves(R4, 18, 24, 2, 0.4, { seg: 40 }));
  k.add("lensBlack", cylX(9.7, L - 3.2, L + 0.05, { seg: 28 }));
  return { root: k.build("linear"), muzzle: { x: L, kind: "linear", flash: 0.15 } };
}
function brake(ctx, R4) {
  const k = ctx.kit();
  k.add("steel", latheX([[0, 0], [0, R4 - 0.4], [0.8, R4], [56, R4], [57, R4 - 1], [57, 4.5], [55, 4.5], [55, 0]], { seg: 32 }));
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.add("lensBlack", T(box(9 - i, 11, 4, { bevel: 1.2 }), { p: [18 + i * 13, 1, s * (R4 - 1.4)] }));
  for (let i = 0; i < 3; i++) k.add("lensBlack", T(cylY(1.6, 0, 3, { seg: 10 }), { p: [20 + i * 12, R4 - 2.4, 0] }));
  k.add("steel", flutesX(R4, 2, 10, 2, 6, 0.5, { a0: 90 }));
  return { root: k.build("brake"), muzzle: { x: 57, kind: "brake", flash: 0.7 } };
}
var MUZZLES = [
  { id: "sf_socom556", cat: "muzzle", name: "SureFire SOCOM556-RC2", desc: "Глушитель 5,56, быстросъёмный", fit: { thread: ["1/2x28"] }, stats: { weight: 620, length: 168, loud: -28, flash: -70, "recoilV%": -10, ergo: -8, adsTime: 25, velocity: 6 }, build: (c) => socom(c, { len: 168 }) },
  { id: "sf_socom762", cat: "muzzle", name: "SureFire SOCOM762-RC2", desc: "Глушитель 7,62, быстросъёмный", fit: { thread: ["5/8x24"] }, stats: { weight: 720, length: 188, loud: -27, flash: -70, "recoilV%": -12, ergo: -10, adsTime: 30, velocity: 6 }, build: (c) => socom(c, { len: 188 }) },
  { id: "a2_fh", cat: "muzzle", name: "Пламегаситель A2", desc: "Классическая «птичья клетка»", fit: { thread: ["1/2x28"] }, stats: { weight: 50, length: 34, flash: -35, "recoilV%": -3 }, build: a2 },
  { id: "warcomp556", cat: "muzzle", name: "SureFire WarComp 5,56", desc: "Пламегаситель-компенсатор", fit: { thread: ["1/2x28"] }, stats: { weight: 90, length: 49, flash: -45, "recoilV%": -8, "recoilH%": -6, loud: 1 }, build: (c) => warcomp(c, 11) },
  { id: "warcomp762", cat: "muzzle", name: "SureFire WarComp 7,62", desc: "Пламегаситель-компенсатор", fit: { thread: ["5/8x24"] }, stats: { weight: 110, length: 49, flash: -45, "recoilV%": -8, "recoilH%": -6, loud: 1 }, build: (c) => warcomp(c, 12) },
  { id: "pa_brake556", cat: "muzzle", name: "Precision Armament M4-72", desc: "Дульный тормоз: меньше отдача, громче", fit: { thread: ["1/2x28"] }, stats: { weight: 85, length: 47, flash: 25, "recoilV%": -22, "recoilH%": -18, loud: 5 }, build: (c) => brake(c, 11.2) },
  { id: "pa_brake762", cat: "muzzle", name: "Precision Armament M11", desc: "Дульный тормоз 7,62", fit: { thread: ["5/8x24"] }, stats: { weight: 120, length: 47, flash: 25, "recoilV%": -24, "recoilH%": -18, loud: 5 }, build: (c) => brake(c, 12.5) },
  { id: "linear556", cat: "muzzle", name: "Линейный компенсатор KAK", desc: "Уводит газы вперёд: тише для стрелка, чуть больше отдача", fit: { thread: ["1/2x28"] }, stats: { weight: 115, length: 62, flash: -30, loud: -3, "recoilV%": 3 }, build: (c) => linear(c, 6.4) },
  { id: "linear762", cat: "muzzle", name: "Линейный компенсатор KAK 7,62", desc: "Уводит газы вперёд: тише для стрелка, чуть больше отдача", fit: { thread: ["5/8x24"] }, stats: { weight: 130, length: 62, flash: -30, loud: -3, "recoilV%": 3 }, build: (c) => linear(c, 7.9) },
  { id: "linear_ak", cat: "muzzle", name: "Линейный компенсатор (АК)", desc: "Уводит газы вперёд: тише для стрелка, чуть больше отдача", fit: { thread: ["m14x1L", "m24x1.5"] }, stats: { weight: 125, length: 62, flash: -30, loud: -3, "recoilV%": 3 }, build: (c) => linear(c, 8.5) }
];


