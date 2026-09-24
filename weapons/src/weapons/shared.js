// src/weapons/shared.js
// Общие детали для описаний оружия: магазины, антабки, «сухари» для прикладов.

// Коробчатый магазин с изгибом радиуса R (Infinity/0 — прямой). Начало координат — передний верх корпуса,
// корпус уходит назад (−x) на глубину d0 и вниз по дуге на длину len. Губки поднимаются на lipH над нулём.
function boxMag(ctx, o) {
  const { T: T2, extrudeZ: exZ, box: bx, wire: wr, node: nd } = ctx.G;
  const k = ctx.kit(), rk = ctx.kit();
  const R4 = o.R && isFinite(o.R) ? o.R : 1e5, L = o.len, D0 = o.d0, D1 = o.d1 ?? o.d0, W = o.w;
  const lipH = o.lipH ?? 10;
  const cx = -D0 / 2 + R4, n = 18, back = [], front = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n * L, a = Math.PI + s / R4, d = D0 + (D1 - D0) * (i / n);
    const px = cx + Math.cos(a) * R4, py = Math.sin(a) * R4, nx = Math.cos(a), ny = Math.sin(a);
    back.push([px + nx * d / 2, py + ny * d / 2]);
    front.push([px - nx * d / 2, py - ny * d / 2]);
  }
  const sx = -front[0][0];
  const P = [[front[0][0], lipH], [back[0][0], lipH], ...back.slice(1), ...front.slice().reverse()].map(([x, y]) => [x + sx, y, 0]);
  k.add(o.mat, exZ(P, W, { bevel: o.bevel ?? 1 }));
  const endA = Math.PI + L / R4;
  const ex = cx + Math.cos(endA) * R4 + sx, ey = Math.sin(endA) * R4;
  const tx = -Math.sin(endA), ty = Math.cos(endA);
  if (o.ribs) {
    for (let j = 1; j < 3; j++) {
      const pts = [];
      for (let i = 1; i < n; i++) {
        const s = i / n * L, a = Math.PI + s / R4, d = D0 + (D1 - D0) * (i / n), t = j / 3 - 0.5;
        pts.push([cx + Math.cos(a) * (R4 + t * d) + sx, Math.sin(a) * (R4 + t * d)]);
      }
      for (const s of [-1, 1]) k.add(o.ribMat || o.mat, wr(pts.map((p) => [p[0], p[1], s * (W / 2 + 0.1)]), o.ribR ?? 1, { n: 40, seg: 6 }));
    }
  }
  if (o.window) for (const s of [-1, 1]) k.add("lensBlack", T2(bx(5, L * 0.55, 1, { bevel: 0.4 }), { p: [-D0 * 0.72, -L * 0.45, s * (W / 2 + 0.05)] }));
  // затыльник-крышка
  const pl = o.plateH ?? 5;
  k.add(o.plate || o.mat, T2(bx(D1 + (o.plateOver ?? 5), pl, W + (o.plateW ?? 2.5), { bevel: Math.min(1.6, pl * 0.3) }), { p: [ex + tx * pl * 0.4, ey + ty * pl * 0.4, 0], r: [0, 0, endA * 57.3] }));
  if (o.catchX != null) k.add(o.mat, T2(bx(5, 3.2, W - 4), { p: [o.catchX, o.catchY ?? -6, 0] }));
  ctx.C.feedLips(k, o.lipMat || o.mat, -D0 + (o.lipX0 ?? 4), -D0 + (o.lipX1 ?? D0 * 0.62), lipH, W / 2, { rise: o.lipRise ?? 3, curl: o.lipCurl ?? 2.4 });
  const cr = ctx.C.CAL[o.cal];
  const dx = (cr?.rim ?? 10) * 0.42;
  ctx.C.cartridge(rk, o.cal, { p: [-D0 + 2.5, lipH + 1.5, -dx * 0.5], r: [0, 0, o.roundTilt ?? 2] });
  ctx.C.cartridge(rk, o.cal, { p: [-D0 + 2.5, lipH + 1.5 - dx * 1.05, dx * 0.5], r: [0, 0, o.roundTilt ?? 2] });
  const rounds = rk.build("rounds");
  return { root: nd("mag", [k.build(), rounds]), mag: { cap: o.cap, rounds } };
}
// Барабан под коробчатой горловиной (горловина — boxMag укороченной длины).
function drumMag(ctx, o) {
  const { T: T2, cylZ: cZ, box: bx, node: nd } = ctx.G;
  const k = ctx.kit();
  const neck = boxMag(ctx, { ...o, len: o.neck, ribs: false, window: false, plateH: 1 });
  const [cx, cy, r, w] = o.drum;
  for (const s of [-1, 1]) {
    k.add(o.mat, T2(cZ(r, s < 0 ? -w / 2 : w * 0.08, s < 0 ? -w * 0.08 : w / 2, { c: 4, seg: 48 }), { p: [cx, cy, 0] }));
    for (let i = 0; i < 10; i++) k.add(o.mat, T2(bx(2.2, r * 0.62, 1.4, { bevel: 0.5 }), { p: [cx, cy, s * (w / 2 + 0.3)], r: [0, 0, i * 36] }).translate(0, 0, 0));
  }
  k.add(o.ringMat || "steel", T2(cZ(r - 2, -w * 0.1, w * 0.1, { seg: 48 }), { p: [cx, cy, 0] }));
  k.add("steel", T2(ctx.C.knob(r * 0.24, 5, 16), { r: [0, -90, 0], p: [cx, cy, w / 2 + 4] }));
  return { root: nd("drum", [neck.root, k.build()]), mag: { cap: o.cap, rounds: neck.mag.rounds } };
}
// Антабка: скоба на двух ушках.
function slingLoop(ctx, k, mat, p, o = {}) {
  const { T: T2, box: bx, wire: wr } = ctx.G;
  const w = o.w ?? 22, h = o.h ?? 12, side = o.side ?? 1;
  k.add(mat, T2(bx(8, 4, 5, { bevel: 1 }), { p: [p[0], p[1], p[2]] }));
  k.add("steelWorn", wr([[p[0] - w / 2, p[1], p[2] + side * 2], [p[0] - w / 2, p[1] + side * 0, p[2] + side * h * 0.6], [p[0], p[1], p[2] + side * h], [p[0] + w / 2, p[1], p[2] + side * h * 0.6], [p[0] + w / 2, p[1], p[2] + side * 2]], 1.4, { n: 30 }));
}

