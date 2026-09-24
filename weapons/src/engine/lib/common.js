// src/engine/lib/common.js
var common_exports = {};
__export(common_exports, {
  CAL: () => CAL,
  bulletGeo: () => bulletGeo,
  cartridge: () => cartridge,
  caseGeo: () => caseGeo,
  clampBody: () => clampBody,
  crossBolt: () => crossBolt,
  feedLips: () => feedLips,
  flipCap: () => flipCap,
  hollowLathe: () => hollowLathe,
  knob: () => knob,
  lensDisc: () => lensDisc,
  qdLever: () => qdLever,
  shotHead: () => shotHead,
  shotHull: () => shotHull
});
function clampBody(x0, x1, y1, o = {}) {
  const w = (o.w ?? 26) / 2, jaw = o.jaw ?? -6.6;
  const sec = [[-w, jaw, 1], [-w + 1.6, jaw - 0.2], [w - 1.6, jaw - 0.2], [w, jaw, 1], [w, y1, o.r ?? 1.2], [-w, y1, o.r ?? 1.2]];
  return extrudeX(sec, x0, x1, { bevel: o.bevel ?? 0.8 });
}
function crossBolt(x, y = -2.5, w = 13, o = {}) {
  const nut = T(cylZ(o.nutR ?? 4.2, 0, o.nutH ?? 3.2, { seg: 6, c: 0.3 }), { p: [x, y, w] });
  const head = T(cylZ(o.headR ?? 3.4, 0, 1.6, { seg: 18, c: 0.4 }), { p: [x, y, -w - 1.6] });
  return [nut, head];
}
function qdLever(x0, x1, y, w = 13) {
  const len = x1 - x0;
  const pro = [[0, 0, 0.5], [len, 0, 2], [len, 7, 3], [len * 0.2, 6.5, 2], [0, 4, 1]];
  const g = extrudeZ(pro, 3.6, { bevel: 0.8 });
  const pivot = cylZ(3.6, -1.2, 1.2, { seg: 16 });
  return [T(g, { p: [x0, y - 3, -w - 1.6] }), T(pivot, { p: [x1 - 3, y, -w - 2.8] })];
}
function knob(r, h, grooves = 24, o = {}) {
  const gs = [cylX(r - 0.6, 0, h, { c: 0.6, seg: 32 })];
  if (grooves) gs.push(flutesX(r - 0.9, 0.6, h - (o.lipH ?? 0.8), grooves, 1.1, 0.9));
  return merge(gs);
}
function flipCap(r, t = 2.4) {
  const disc = cylX(r + 1.6, 0, t, { c: 0.6, seg: 28 });
  const hinge = T(box(6, 5, 10, { bevel: 1 }), { p: [t / 2, r + 3, 0] });
  const tab = T(box(3, 7, 8, { bevel: 1 }), { p: [t / 2, -r - 4, 0] });
  return merge([disc, hinge, tab]);
}
function lensDisc(r, x, t = 1.2) {
  return cylX(r, x - t / 2, x + t / 2, { c: 0.2, seg: 32 });
}
function hollowLathe(prof, rIn, o = {}) {
  const back = [];
  const x0 = prof[0][0], x1 = prof[prof.length - 1][0];
  const inner = typeof rIn === "number" ? [[x1, rIn], [x0, rIn]] : rIn.slice().reverse();
  return latheX([[x0, inner[inner.length - 1][1]], ...prof, ...inner, [x0, inner[inner.length - 1][1]]], o);
}
var CAL = {
  "556": { L: 44.7, rim: 9.6, sh: 9, neck: 6.4, shX: 36.5, oal: 57.4, steel: false },
  "545": { L: 39.8, rim: 10, sh: 9.2, neck: 6.3, shX: 31.5, oal: 57, steel: true },
  "762x39": { L: 38.6, rim: 11.35, sh: 10.1, neck: 8.6, shX: 30.5, oal: 56, steel: true },
  "762x51": { L: 51.2, rim: 11.9, sh: 11.5, neck: 8.7, shX: 39.6, oal: 71.1, steel: false },
  // 9×19 — почти цилиндрическая гильза без ската, пуля с оживальной головкой
  "9x19": { L: 19.15, rim: 9.96, sh: 9.93, neck: 9.65, shX: 18.4, oal: 29.7, steel: false },
  // 7,62×54R — с выступающей закраиной
  "762x54R": { L: 53.7, rim: 14.4, base: 12.37, sh: 11.61, neck: 8.53, shX: 42.8, oal: 77.2, steel: true, rimmed: true },
  // 12/70: латунное донце + пластиковая гильза со звёздочной закруткой
  "12ga": { L: 65, rim: 22.3, sh: 20.5, neck: 20.5, shX: 60, oal: 65, head: 12, shot: true }
};
function caseGeo(cal) {
  const c = CAL[cal] || CAL["556"];
  if (c.shot) return merge([shotHead(c), shotHull(c)]);
  const r = c.rim / 2, s = c.sh / 2, n = c.neck / 2;
  if (c.rimmed) {
    const b = c.base / 2;
    return latheX([[0, 0], [0, r - 0.3], [0.3, r], [1.5, r], [1.8, b], [c.shX, s], [c.shX + (s - n) * 1.5, n], [c.L, n], [c.L, n - 0.4]], { seg: 18 });
  }
  return latheX([
    [0, 0],
    [0, r - 0.3],
    [0.3, r],
    [1.3, r],
    [1.6, r - 0.8],
    [2.4, r - 0.8],
    [2.9, r - 0.15],
    [c.shX, s],
    [c.shX + (s - n) * 1.5, n],
    [c.L, n],
    [c.L, n - 0.4]
  ], { seg: 18 });
}
function shotHead(c) {
  const r = c.rim / 2, s = c.sh / 2;
  return latheX([[0, 0], [0, r - 0.3], [0.3, r], [1.4, r], [1.6, s + 0.12], [c.head, s + 0.12], [c.head + 0.4, s], [c.head + 0.4, 0]], { seg: 24 });
}
function shotHull(c, fired) {
  const s = c.sh / 2, L = fired ? c.L + 6 : c.L;
  const top = fired ? [[L, s - 0.3], [L, s - 1.2]] : [[L - 1.2, s - 0.1], [L, s - 1.6], [L - 1.2, 0]];
  return latheX([[c.head, 0], [c.head, s], [L - 2, s], ...top], { seg: 24 });
}
function bulletGeo(cal) {
  const c = CAL[cal] || CAL["556"];
  const n = c.neck / 2 - 0.35, len = c.oal - c.L + 5;
  const pts = [[c.L - 5, n]];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    pts.push([c.L - 5 + len * (0.35 + 0.65 * t), n * Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8))) + 0.2 * (1 - t)]);
  }
  pts.push([c.L - 5 + len, 0]);
  return latheX([[c.L - 5, 0], ...pts], { seg: 16, crease: 60 });
}
function cartridge(k, cal, t) {
  const c = CAL[cal] || CAL["556"];
  if (c.shot) {
    k.add("brass", shotHead(c), t && { ...t });
    k.add("hullRed", shotHull(c), t && { ...t });
    return;
  }
  k.add(c.steel ? "steelCase" : "brass", caseGeo(cal), t && { ...t });
  k.add("copper", bulletGeo(cal), t && { ...t });
}
function feedLips(k, mat, x0, x1, y, hw, o = {}) {
  const rise = o.rise ?? 4.5, t = o.t ?? 1.1, curl = o.curl ?? 2.8;
  const sec = [[hw, y - 2], [hw, y + rise - 1.2], [hw - curl * 0.55, y + rise, 0.6], [hw - curl, y + rise - 0.6, 0.4], [hw - curl + 0.3, y + rise - 1.6], [hw - t - 0.4, y + rise - 1.4], [hw - t, y - 2]];
  for (const s of [-1, 1]) {
    k.add(mat, extrudeX(sec.map(([z, yy, r]) => [s * z, yy, r || 0]), x0, x1, { bevel: 0.3 }));
  }
  k.add(mat, extrudeX([[-hw, y - 2], [hw, y - 2], [hw, y + 1.2], [-hw, y + 1.2]], x0, x0 + 1.6, { bevel: 0.3 }));
}


