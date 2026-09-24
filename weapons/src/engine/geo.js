// src/engine/geo.js
var geo_exports = {};
__export(geo_exports, {
  D2R: () => D2R,
  Kit: () => Kit,
  PICA: () => PICA,
  T: () => T,
  THREE: () => THREE3,
  box: () => box,
  circle: () => circle,
  cylX: () => cylX,
  cylY: () => cylY,
  cylZ: () => cylZ,
  extrudeX: () => extrudeX,
  extrudeY: () => extrudeY,
  extrudeZ: () => extrudeZ,
  flutesX: () => flutesX,
  latheX: () => latheX,
  loftX: () => loftX,
  loftPath: () => loftPath,
  merge: () => merge,
  mirrorZ: () => mirrorZ,
  mlokHoles: () => mlokHoles,
  node: () => node,
  path: () => path,
  picatinny: () => picatinny,
  pin: () => pin,
  place: () => place,
  reverse: () => reverse,
  ringGrooves: () => ringGrooves,
  rrect: () => rrect,
  screwHead: () => screwHead,
  shape: () => shape,
  slot: () => slot,
  sphere: () => sphere,
  spring: () => spring,
  superEllipse: () => superEllipse,
  tubeX: () => tubeX,
  wire: () => wire
});
import * as THREE3 from "three";
import { mergeGeometries as mergeGeometries2, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
var D2R = Math.PI / 180;
function path(pts, target) {
  const s = target || new THREE3.Shape();
  const n = pts.length;
  const P = pts.map((p) => new THREE3.Vector2(p[0], p[1]));
  const R4 = pts.map((p) => p[2] || 0);
  const corner = (i) => {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const r = R4[i];
    const la = b.distanceTo(a), lc = b.distanceTo(c);
    const d = Math.min(r, la * 0.5, lc * 0.5);
    const pa = b.clone().add(a.clone().sub(b).setLength(d));
    const pc = b.clone().add(c.clone().sub(b).setLength(d));
    return [pa, pc, b];
  };
  for (let i = 0; i < n; i++) {
    if (R4[i] > 0) {
      const [pa, pc, b] = corner(i);
      if (i === 0) s.moveTo(pa.x, pa.y);
      else s.lineTo(pa.x, pa.y);
      s.quadraticCurveTo(b.x, b.y, pc.x, pc.y);
    } else if (i === 0) s.moveTo(P[i].x, P[i].y);
    else s.lineTo(P[i].x, P[i].y);
  }
  s.closePath();
  return s;
}
function shape(pts, holes = []) {
  const s = path(pts);
  for (const h of holes) s.holes.push(path(h, new THREE3.Path()));
  return s;
}
function rrect(cx, cy, w, h, r = 0) {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]];
}
function circle(cx, cy, r, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
function slot(x0, x1, cy, h, n = 8) {
  const r = h / 2, out = [];
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + i / n * Math.PI;
    out.push([x1 - r + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  for (let i = 0; i <= n; i++) {
    const a = Math.PI / 2 + i / n * Math.PI;
    out.push([x0 + r + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}
function reverse(pts) {
  return pts.slice().reverse();
}
function fixUV(g, k = 1) {
  const uv = g.attributes.uv;
  if (uv && k !== 1) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  return g;
}
function finish(g, crease = 32) {
  let out = g.index ? g.toNonIndexed() : g;
  out = toCreasedNormals(out, crease * D2R);
  if (!out.attributes.uv) out.setAttribute("uv", new THREE3.BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}
function extrudeZ(shp, width, o = {}) {
  const b = Math.min(o.bevel ?? 0.6, width * 0.45);
  const depth = Math.max(0.01, width - 2 * b);
  const g = new THREE3.ExtrudeGeometry(Array.isArray(shp) ? shape(shp) : shp, {
    depth,
    steps: 1,
    curveSegments: o.curve ?? 6,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.bevelSeg ?? 2
  });
  g.translate(0, 0, -depth / 2 + (o.z || 0));
  return finish(g, o.crease);
}
function extrudeX(shp, x0, x1, o = {}) {
  const len = x1 - x0;
  const b = Math.min(o.bevel ?? 0.5, len * 0.45);
  const depth = Math.max(0.01, len - 2 * b);
  const g = new THREE3.ExtrudeGeometry(Array.isArray(shp) ? shape(shp) : shp, {
    depth,
    steps: 1,
    curveSegments: o.curve ?? 6,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.bevelSeg ?? 2
  });
  g.rotateY(-Math.PI / 2);
  g.translate(x1 - b, 0, 0);
  return finish(g, o.crease);
}
function extrudeY(shp, y0, y1, o = {}) {
  const len = y1 - y0;
  const b = Math.min(o.bevel ?? 0.5, len * 0.45);
  const depth = Math.max(0.01, len - 2 * b);
  const g = new THREE3.ExtrudeGeometry(Array.isArray(shp) ? shape(shp) : shp, {
    depth,
    steps: 1,
    curveSegments: o.curve ?? 6,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: o.bevelSeg ?? 2
  });
  g.rotateX(-Math.PI / 2);
  g.scale(1, 1, -1);
  const idx = g.index;
  flipWinding(g);
  g.translate(0, y0 + b, 0);
  return finish(g, o.crease);
}
function flipWinding(g) {
  const pos = g.attributes.position;
  const attrs = Object.values(g.attributes);
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of attrs) {
      for (let c = 0; c < a.itemSize; c++) {
        const t = a.array[(i + 1) * a.itemSize + c];
        a.array[(i + 1) * a.itemSize + c] = a.array[(i + 2) * a.itemSize + c];
        a.array[(i + 2) * a.itemSize + c] = t;
      }
    }
  }
}
function latheX(prof, o = {}) {
  const seg = o.seg ?? 32;
  const a0 = (o.a0 ?? 0) * D2R, arc = (o.arc ?? 360) * D2R;
  const crease = Math.cos((o.crease ?? 40) * D2R);
  const pts = prof.filter((p, i) => i === 0 || p[0] !== prof[i - 1][0] || p[1] !== prof[i - 1][1]);
  const segN = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0], dr = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dr) || 1;
    segN.push([-dr / l, dx / l]);
  }
  const pos = [], nor = [], uv = [], idx = [];
  let vlen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const nA = segN[i].slice(), nB = segN[i].slice();
    if (i > 0) {
      const p = segN[i - 1];
      if (p[0] * nA[0] + p[1] * nA[1] > crease) {
        nA[0] += p[0];
        nA[1] += p[1];
      }
    }
    if (i < segN.length - 1) {
      const q = segN[i + 1];
      if (q[0] * nB[0] + q[1] * nB[1] > crease) {
        nB[0] += q[0];
        nB[1] += q[1];
      }
    }
    for (const n of [nA, nB]) {
      const l = Math.hypot(n[0], n[1]) || 1;
      n[0] /= l;
      n[1] /= l;
    }
    const [x0, r0] = pts[i], [x1, r1] = pts[i + 1];
    const sl = Math.hypot(x1 - x0, r1 - r0);
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) {
      const a = a0 + j / seg * arc;
      const c = Math.cos(a), s = Math.sin(a);
      pos.push(x0, r0 * c, r0 * s, x1, r1 * c, r1 * s);
      nor.push(nA[0], nA[1] * c, nA[1] * s, nB[0], nB[1] * c, nB[1] * s);
      const u = j / seg * arc * Math.max(r0, r1, 1);
      uv.push(u, vlen, u, vlen + sl);
    }
    vlen += sl;
    for (let j = 0; j < seg; j++) {
      const a = base + j * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE3.BufferGeometry();
  g.setAttribute("position", new THREE3.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE3.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE3.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g.toNonIndexed();
}
function cylX(r, x0, x1, o = {}) {
  const c = Math.min(o.c ?? 0.4, r * 0.4, (x1 - x0) * 0.3);
  const ri = o.ri || 0;
  if (ri > 0) {
    return latheX([[x0, ri + c], [x0, r - c], [x0 + c, r], [x1 - c, r], [x1, r - c], [x1, ri + c], [x1 - c, ri], [x0 + c, ri], [x0, ri + c]], o);
  }
  return latheX([[x0, 0], [x0, r - c], [x0 + c, r], [x1 - c, r], [x1, r - c], [x1, 0]], o);
}
function tubeX(rOut, rIn, x0, x1, o = {}) {
  return cylX(rOut, x0, x1, { ...o, ri: rIn });
}
function cylY(r, y0, y1, o = {}) {
  return T(cylX(r, y0, y1, o), { r: [0, 0, 90] });
}
function cylZ(r, z0, z1, o = {}) {
  return T(cylX(r, z0, z1, o), { r: [0, -90, 0] });
}
function sphere(r, o = {}) {
  const g = new THREE3.SphereGeometry(r, o.seg ?? 20, o.seg2 ?? 14);
  return fixUV(g.toNonIndexed(), r * 3);
}
function box(w, h, d, o = {}) {
  const b = Math.min(o.bevel ?? 0.5, w * 0.45, h * 0.45, d * 0.45);
  return extrudeZ(rrect(0, 0, w, h, o.r ?? b), d, { bevel: b, curve: 3 });
}
var _m = new THREE3.Matrix4();
var _q = new THREE3.Quaternion();
var _e = new THREE3.Euler();
var _v = new THREE3.Vector3();
var _s = new THREE3.Vector3();
function T(g, t = {}) {
  const r = t.r || [0, 0, 0];
  _e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, t.order || "XYZ");
  _q.setFromEuler(_e);
  const s = t.s == null ? [1, 1, 1] : Array.isArray(t.s) ? t.s : [t.s, t.s, t.s];
  _s.set(s[0], s[1], s[2]);
  const p = t.p || [0, 0, 0];
  _v.set(p[0], p[1], p[2]);
  _m.compose(_v, _q, _s);
  g.applyMatrix4(_m);
  if (s[0] * s[1] * s[2] < 0) flipWinding(g);
  return g;
}
function mirrorZ(g) {
  return T(g.clone(), { s: [1, 1, -1] });
}
function merge(list) {
  const gs = list.filter(Boolean).map((g) => {
    let o = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(o.attributes)) if (!["position", "normal", "uv"].includes(k)) o.deleteAttribute(k);
    if (!o.attributes.uv) o.setAttribute("uv", new THREE3.BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
    if (!o.attributes.normal) o.computeVertexNormals();
    return o;
  });
  if (!gs.length) return null;
  return mergeGeometries2(gs, false);
}
var Kit = class {
  constructor(mats) {
    this.mats = mats;
    this.buckets = /* @__PURE__ */ new Map();
  }
  add(mat, geo, t) {
    if (!geo) return this;
    if (Array.isArray(geo)) {
      for (const g of geo) this.add(mat, g, t);
      return this;
    }
    if (t) T(geo, t);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(geo);
    return this;
  }
  // Добавить с зеркальной копией на левый борт.
  pair(mat, geo, t) {
    if (t) T(geo, t);
    this.add(mat, geo);
    this.add(mat, mirrorZ(geo));
    return this;
  }
  build(name) {
    const grp = new THREE3.Group();
    grp.name = name || "";
    for (const [mk, list] of this.buckets) {
      const g = merge(list);
      if (!g) continue;
      const m = new THREE3.Mesh(g, this.mats.get(mk));
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData.mat = mk;
      grp.add(m);
    }
    this.buckets.clear();
    return grp;
  }
};
function node(name, children = [], t) {
  const g = new THREE3.Group();
  g.name = name;
  for (const c of children) if (c) g.add(c);
  if (t) place(g, t);
  return g;
}
function place(obj, t = {}) {
  if (t.p) obj.position.set(t.p[0], t.p[1], t.p[2]);
  if (t.r) obj.rotation.set(t.r[0] * D2R, t.r[1] * D2R, t.r[2] * D2R, t.order || "XYZ");
  if (t.s != null) Array.isArray(t.s) ? obj.scale.set(...t.s) : obj.scale.setScalar(t.s);
  return obj;
}
var PICA = { PITCH: 10.01, SLOT: 5.23, TOP: 15.6, WIDE: 21.2, H: 9.4 };
function picaSection(top, base) {
  const t = PICA.TOP / 2, w = PICA.WIDE / 2;
  if (top <= -2.8) {
    return [[-w, -3], [w, -3], [w, -3.3], [t, -6], [t, -base], [-t, -base], [-t, -6], [-w, -3.3]];
  }
  return [[-t, 0], [t, 0], [w, -2.8], [w, -3.3], [t, -6], [t, -base], [-t, -base], [-t, -6], [-w, -3.3], [-w, -2.8]];
}
function picatinny(len, o = {}) {
  const base = o.base ?? PICA.H;
  const nSlots = Math.max(1, Math.floor((len - 3) / PICA.PITCH));
  const first = o.first ?? (len - (nSlots - 1) * PICA.PITCH) / 2;
  const gs = [];
  gs.push(extrudeX(picaSection(-3, base), 0, len, { bevel: 0.3 }));
  let x = 0;
  for (let i = 0; i <= nSlots; i++) {
    const sx = first + i * PICA.PITCH - PICA.SLOT / 2;
    const x1 = Math.min(len, i < nSlots ? sx : len);
    if (x1 - x > 0.8) gs.push(extrudeX(picaSection(0, 6.2), x, x1, { bevel: 0.35 }));
    x = sx + PICA.SLOT;
  }
  return { geo: merge(gs), slots: nSlots, first };
}
function mlokHoles(x0, x1, cy, o = {}) {
  const pitch = o.pitch ?? 40, L = o.len ?? 32, H = o.h ?? 7;
  const n = Math.floor((x1 - x0 + (pitch - L)) / pitch);
  const start = x0 + (x1 - x0 - (n * pitch - (pitch - L))) / 2;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rrect(start + i * pitch + L / 2, cy, L, H, H / 2 - 0.2));
  return out;
}
function screwHead(r = 2.4, h = 1.2, o = {}) {
  const g = latheX([[0, 0], [0, r * 0.95], [h * 0.3, r], [h, r * 0.8], [h, 0]], { seg: o.seg ?? 16 });
  return T(g, { r: [0, -90, 0] });
}
function pin(r = 2, len = 2) {
  return cylZ(r, -len / 2, len / 2, { c: 0.25, seg: 14 });
}
function ringGrooves(r, x0, x1, n, depth = 0.5, o = {}) {
  const prof = [[x0, 0], [x0, r]];
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step;
    prof.push([a + step * 0.2, r], [a + step * 0.35, r - depth], [a + step * 0.65, r - depth], [a + step * 0.8, r]);
  }
  prof.push([x1, r], [x1, 0]);
  return latheX(prof, { seg: o.seg ?? 28 });
}
function flutesX(r, x0, x1, n, w, h, o = {}) {
  const gs = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * 360 + (o.a0 || 0);
    gs.push(T(box(x1 - x0, h, w, { bevel: Math.min(0.3, w * 0.3) }), { p: [(x0 + x1) / 2, r + h / 2 - 0.2, 0] }));
    T(gs[gs.length - 1], { r: [a, 0, 0] });
  }
  return merge(gs);
}
function spring(R4, wire2, x0, x1, turns, o = {}) {
  const pts = [];
  const n = Math.max(24, Math.round(turns * 14));
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * turns * Math.PI * 2;
    pts.push(new THREE3.Vector3(x0 + (x1 - x0) * t, Math.cos(a) * R4, Math.sin(a) * R4));
  }
  const curve = new THREE3.CatmullRomCurve3(pts);
  return new THREE3.TubeGeometry(curve, n * 2, wire2, o.seg ?? 6, false).toNonIndexed();
}
function wire(points, r, o = {}) {
  const curve = new THREE3.CatmullRomCurve3(points.map((p) => new THREE3.Vector3(...p)), !!o.closed, "catmullrom", o.tension ?? 0.5);
  return new THREE3.TubeGeometry(curve, o.n ?? points.length * 10, r, o.seg ?? 8, !!o.closed).toNonIndexed();
}
function loftX(rings, o = {}) {
  const pos = [], idx = [];
  const m = rings[0].pts.length;
  rings.forEach((r) => r.pts.forEach(([z, y]) => pos.push(r.x, y, z)));
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) {
      const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
      idx.push(a, b, c, b, d, c);
    }
  }
  const cap = (ri, flip) => {
    const base = pos.length / 3;
    const r = rings[ri];
    let cz = 0, cy = 0;
    r.pts.forEach(([z, y]) => {
      cz += z / m;
      cy += y / m;
    });
    pos.push(r.x, cy, cz);
    for (let j = 0; j < m; j++) {
      const a = ri * m + j, b = ri * m + (j + 1) % m;
      flip ? idx.push(base, b, a) : idx.push(base, a, b);
    }
  };
  if (o.caps !== false) {
    cap(0, false);
    cap(rings.length - 1, true);
  }
  const g = new THREE3.BufferGeometry();
  g.setAttribute("position", new THREE3.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (o.flip) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
  }
  const ng = g.toNonIndexed();
  const uv = new Float32Array(ng.attributes.position.count * 2);
  const p = ng.attributes.position;
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i);
    uv[i * 2 + 1] = p.getY(i) + p.getZ(i);
  }
  ng.setAttribute("uv", new THREE3.BufferAttribute(uv, 2));
  return toCreasedNormals(ng, (o.crease ?? 40) * D2R);
}
// Лофт по кривой оси в плоскости XY (рукояти, шейки прикладов). secs: [{c:[x,y], a, b, k?, f?, r?}]
// a — полутолщина вдоль нормали к оси (спереди/сзади), b — полуширина по Z, f — смещение центра
// сечения вдоль нормали (выемки под пальцы, горб), r — радиус-скругление передней грани (0…1: доля a).
function loftPath(secs, o = {}) {
  const n = o.seg ?? 36, m = secs.length;
  const pos = [], idx = [];
  const tan = (i) => {
    const a = secs[Math.max(0, i - 1)].c, b = secs[Math.min(m - 1, i + 1)].c;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  for (let i = 0; i < m; i++) {
    const S2 = secs[i], [tx, ty] = tan(i), nx = -ty, ny = tx, k = S2.k ?? o.k ?? 3, kb = S2.kb ?? k;
    for (let j = 0; j < n; j++) {
      const t = j / n * Math.PI * 2, c = Math.cos(t), s2 = Math.sin(t);
      // передняя (c>0) и задняя половины могут иметь разную толщину: a — вперёд, a2 — назад
      const aa = c >= 0 ? S2.a : S2.a2 ?? S2.a;
      const u = aa * Math.sign(c) * Math.pow(Math.abs(c), 2 / (c >= 0 ? k : kb)) + (S2.f || 0);
      const w = S2.b * Math.sign(s2) * Math.pow(Math.abs(s2), 2 / k);
      pos.push(S2.c[0] + nx * u, S2.c[1] + ny * u, w);
    }
  }
  for (let i = 0; i < m - 1; i++) for (let j = 0; j < n; j++) {
    const a = i * n + j, b = i * n + (j + 1) % n, c = (i + 1) * n + j, d = (i + 1) * n + (j + 1) % n;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ri, flip) => {
    const base = pos.length / 3;
    let cx = 0, cy = 0;
    for (let j = 0; j < n; j++) cx += pos[(ri * n + j) * 3] / n, cy += pos[(ri * n + j) * 3 + 1] / n;
    pos.push(cx, cy, 0);
    for (let j = 0; j < n; j++) {
      const a = ri * n + j, b = ri * n + (j + 1) % n;
      flip ? idx.push(base, a, b) : idx.push(base, b, a);
    }
  };
  if (o.caps !== false) {
    cap(0, false);
    cap(m - 1, true);
  }
  const g = new THREE3.BufferGeometry();
  g.setAttribute("position", new THREE3.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (o.flip) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
  }
  const ng = g.toNonIndexed();
  const p = ng.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) + p.getZ(i) * 0.3;
    uv[i * 2 + 1] = p.getY(i) + p.getZ(i);
  }
  ng.setAttribute("uv", new THREE3.BufferAttribute(uv, 2));
  return toCreasedNormals(ng, (o.crease ?? 60) * D2R);
}
function superEllipse(a, b, k = 3, n = 32, cy = 0, cz = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push([cz + a * Math.sign(c) * Math.pow(Math.abs(c), 2 / k), cy + b * Math.sign(s) * Math.pow(Math.abs(s), 2 / k)]);
  }
  return out;
}


