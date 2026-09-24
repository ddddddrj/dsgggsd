// src/engine/lib/grips.js
function grip(ctx, o) {
  const k = ctx.kit();
  const a = (o.angle ?? 20) * Math.PI / 180;
  const H = o.h ?? 104;
  const sh = (y) => -Math.tan(a) * -y;
  const front = o.front.map(([f, y]) => [sh(y) + f, y]);
  const back = o.back.map(([f, y]) => [sh(y) + f, y]);
  const pts = [...front.map((p) => [...p, 3]), ...back.reverse().map((p) => [...p, 4])];
  pts[0][2] = 0;
  pts[pts.length - 1][2] = 0;
  k.add(o.mat || "poly", extrudeZ(pts, o.w ?? 30, { bevel: o.bevel ?? 6, curve: 6 }));
  if (o.texture !== false) {
    const tx = [];
    for (let i = 0; i < 8; i++) {
      const y = -22 - i * 9;
      for (const s of [-1, 1]) tx.push(T(box(26, 1.4, 1, { bevel: 0.3 }), { p: [sh(y) - 18, y, s * ((o.w ?? 30) / 2 - 0.3)], r: [0, 0, 20] }));
    }
    k.add(o.mat || "poly", tx);
  }
  if (o.cap) k.add("polySoft", T(box(34, 5, (o.w ?? 30) - 4, { bevel: 2 }), { p: [sh(-H) - 18, -H - 1, 0], r: [0, 0, -4] }));
  return { root: k.build(o.name) };
}
var GRIPS = [
  {
    id: "hk_v2",
    cat: "pgrip",
    name: "HK V2",
    desc: "Эргономичная рукоять HK с упором под палец",
    fit: { iface: ["ar"] },
    stats: { weight: 80, ergo: 0 },
    build: (c) => grip(c, { name: "hk_v2", angle: 18, front: [[2, 0], [0, -14], [5, -26], [0, -36], [-3, -70], [-2, -102]], back: [[-34, 6], [-44, 2], [-42, -20], [-36, -48], [-38, -80], [-36, -104]], cap: true })
  },
  {
    id: "moe_grip",
    cat: "pgrip",
    name: "Magpul MOE+",
    desc: "Прорезиненная, с отсеком в торце",
    fit: { iface: ["ar"] },
    stats: { weight: 75, ergo: 2 },
    build: (c) => grip(c, { name: "moe", angle: 22, mat: "polySoft", front: [[1, 0], [0, -20], [2, -40], [-1, -70], [0, -100]], back: [[-32, 5], [-40, 0], [-38, -30], [-35, -60], [-36, -102]], cap: true })
  },
  {
    id: "bcm_mod3",
    cat: "pgrip",
    name: "BCM Gunfighter Mod 3",
    desc: "Вертикальнее, удобна при коротком прикладе",
    fit: { iface: ["ar"] },
    stats: { weight: 70, ergo: 3 },
    build: (c) => grip(c, { name: "bcm", angle: 12, front: [[1, 0], [0, -30], [1, -60], [0, -96]], back: [[-30, 4], [-38, 0], [-35, -40], [-34, -96]], texture: true })
  }
];


