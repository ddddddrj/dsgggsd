// src/engine/materials.js
import * as THREE2 from "three";
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = s * 1664525 + 1013904223 >>> 0) / 4294967296;
}
function valueNoise(size, cells, seed) {
  const r = rng(seed);
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  for (let i = 0; i <= cells; i++) {
    grid[i * (cells + 1) + cells] = grid[i * (cells + 1)];
    grid[cells * (cells + 1) + i] = grid[i];
  }
  const out = new Float32Array(size * size);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = x / size * cells, gy = y / size * cells;
    const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = sm(gx - x0), fy = sm(gy - y0);
    const g = (i, j) => grid[j * (cells + 1) + i];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * fx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * fx;
    out[y * size + x] = a + (b - a) * fy;
  }
  return out;
}
function fbm(size, octaves, seed, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function toTex(size, fill, srgb) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = fill(i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE2.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE2.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE2.SRGBColorSpace;
  return t;
}
function normalFrom(h, size, strength) {
  return toTex(size, (i) => {
    const x = i % size, y = i / size | 0;
    const hx = h[y * size + (x + 1) % size] - h[y * size + (x - 1 + size) % size];
    const hy = h[(y + 1) % size * size + x] - h[(y - 1 + size) % size * size + x];
    let nx = -hx * strength, ny = -hy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    return [(nx / l * 0.5 + 0.5) * 255, (ny / l * 0.5 + 0.5) * 255, (nz / l * 0.5 + 0.5) * 255];
  });
}
function roughFrom(h, size, lo, hi) {
  return toTex(size, (i) => {
    const v = (lo + (hi - lo) * h[i]) * 255;
    return [v, v, v];
  });
}
function makeTextures() {
  const S = 256;
  const coarse = fbm(S, 5, 11, 4);
  const fine = fbm(S, 3, 77, 32);
  const stipple = fbm(S, 2, 123, 64);
  const brushed = new Float32Array(S * S);
  const br = fbm(S, 4, 5, 8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) brushed[y * S + x] = br[y * S + x * 7 % S] * 0.3 + br[y * 3 % S * S + x] * 0.7;
  const mix = new Float32Array(S * S);
  for (let i = 0; i < mix.length; i++) mix[i] = coarse[i] * 0.55 + fine[i] * 0.45;
  // Древесина: прямые продольные волокна (u — вдоль детали), лёгкая волнистость, годовые слои
  // широкими полосами, поры-штрихи и неравномерная пропитка лаком. Раньше были «кольца» от шума —
  // на прикладе СВД выглядело как огненный мрамор.
  const wood = (hue, o = {}) => {
    const warp = fbm(S, 3, o.seed ?? 301, 2), n2 = fbm(S, 4, (o.seed ?? 301) + 254, 8), blot = fbm(S, 3, (o.seed ?? 301) + 91, 3);
    const pr = rng((o.seed ?? 301) * 7 + 1);
    const pores = new Float32Array(S * S);
    for (let i = 0; i < S * 5; i++) {
      const x = pr() * S | 0, y = pr() * S | 0, L = 3 + pr() * 12 | 0;
      for (let j = 0; j < L; j++) pores[y * S + (x + j) % S] = 0.5 + pr() * 0.5;
    }
    return toTex(S, (i) => {
      const x = i % S, y = i / S | 0;
      const v = y / S + (warp[i] - 0.5) * (o.warp ?? 0.05);
      const fine = Math.sin(v * Math.PI * 2 * (o.lines ?? 46)) * 0.5 + 0.5;
      const late = Math.pow(Math.sin(v * Math.PI * 2 * (o.rings ?? 7)) * 0.5 + 0.5, 3);
      const k = 0.9 - late * 0.16 - fine * 0.06 + (n2[i] - 0.5) * 0.12 - pores[i] * 0.2 - (blot[i] - 0.5) * (o.blot ?? 0.22);
      return [hue[0] * k, hue[1] * k, hue[2] * k];
    }, true);
  };  const woodH = new Float32Array(S * S);
  {
    const n = fbm(S, 4, 301, 4);
    for (let i = 0; i < S * S; i++) {
      const y = (i / S | 0) / S;
      woodH[i] = 0.5 + 0.5 * Math.sin((y + (n[i] - 0.5) * 0.035) * Math.PI * 2 * 60) * 0.35 + (n[i] - 0.5) * 0.3;
    }
  }
  return {
    rough: roughFrom(mix, S, 0.72, 1),
    roughStrong: roughFrom(coarse, S, 0.55, 1),
    roughBrushed: roughFrom(brushed, S, 0.7, 1),
    nMetal: normalFrom(fine, S, 1.4),
    nCast: normalFrom(mix, S, 3.2),
    nPoly: normalFrom(stipple, S, 5.5),
    nWood: normalFrom(woodH, S, 1.6),
    // СВД: клеёная берёзовая фанера под красно-коричневым лаком
    woodBirch: wood([104, 42, 24], { lines: 60, rings: 5, warp: 0.035, blot: 0.3 }),
    woodWalnut: wood([104, 62, 38], { seed: 777, lines: 38, rings: 9, warp: 0.07 })
  };
}
function createMaterials(envMap) {
  const tex2 = makeTextures();
  const rep = (t, mm) => {
    const c = t.clone();
    c.needsUpdate = true;
    c.repeat.set(1 / mm, 1 / mm);
    return c;
  };
  const R4 = {};
  const std = (o) => new THREE2.MeshStandardMaterial(o);
  const phys = (o) => new THREE2.MeshPhysicalMaterial(o);
  const metal = (color, rough, metal2, o = {}) => std({
    color,
    roughness: rough,
    metalness: metal2,
    roughnessMap: rep(o.brushed ? tex2.roughBrushed : tex2.rough, o.tile ?? 40),
    normalMap: rep(o.cast ? tex2.nCast : tex2.nMetal, o.tile ?? 30),
    normalScale: new THREE2.Vector2((o.ns ?? 0.35) * 0.45, (o.ns ?? 0.35) * 0.45),
    envMapIntensity: o.env ?? 1
  });
  const poly = (color, rough, o = {}) => std({
    color,
    roughness: rough,
    metalness: 0,
    roughnessMap: rep(tex2.rough, 50),
    normalMap: rep(tex2.nPoly, o.tile ?? 14),
    normalScale: new THREE2.Vector2((o.ns ?? 0.45) * 0.55, (o.ns ?? 0.45) * 0.55),
    envMapIntensity: o.env ?? 0.8
  });
  R4.steel = metal(2829358, 0.42, 0.8);
  R4.steelPark = metal(3487030, 0.62, 0.55, { cast: true, ns: 0.5 });
  R4.steelWorn = metal(5592666, 0.36, 0.9, { brushed: true });
  R4.steelBright = metal(10987949, 0.26, 1, { brushed: true });
  R4.chrome = metal(13224910, 0.14, 1);
  R4.alu = metal(2039842, 0.46, 0.55, { ns: 0.25 });
  R4.aluGrey = metal(3882304, 0.44, 0.6, { ns: 0.25 });
  R4.aluFde = metal(9402968, 0.58, 0.25, { cast: true, ns: 0.35, env: 0.8 });
  R4.aluOd = metal(4999992, 0.6, 0.25, { cast: true });
  R4.cast = metal(2500393, 0.66, 0.55, { cast: true, ns: 0.7 });
  R4.brass = metal(13148240, 0.3, 1);
  R4.copper = metal(11889982, 0.32, 1);
  R4.steelCase = metal(6249532, 0.45, 0.6);
  R4.spring = metal(4868942, 0.35, 0.9);
  R4.poly = poly(1776412, 0.74);
  R4.polySoft = poly(2105377, 0.86, { ns: 0.7 });
  // текстура рукояти (Glock RTF / HK): мелкая «наждачка», заметнее обычного полимера
  R4.polyGrip = poly(1250067, 0.84, { ns: 1.15, tile: 5, env: 0.6 });
  R4.polyFde = poly(9995359, 0.78);
  R4.polyFdeDark = poly(7299144, 0.8);
  R4.polyPlum = poly(4991522, 0.58, { ns: 0.3 });
  R4.polyOd = poly(4868662, 0.78);
  R4.polyGrey = poly(3948097, 0.7);
  R4.polyTan = poly(11573876, 0.78);
  // пластиковая гильза 12 калибра и зелёная «Бреннеке»
  R4.hullRed = poly(0xa3201c, 0.5, { ns: 0.2, env: 1 });
  R4.hullGreen = poly(0x2f5a32, 0.5, { ns: 0.2, env: 1 });
  R4.lead = metal(0x6b6f74, 0.55, 0.4);
  // оксидированная сталь HK/Glock: чуть глубже и матовее «steel»
  R4.steelMatte = metal(0x232426, 0.55, 0.65, { ns: 0.45 });
  R4.rubber = poly(1315860, 0.92, { ns: 0.9, tile: 14 });
  R4.bakelite = std({ color: 8006672, roughness: 0.42, metalness: 0, normalMap: rep(tex2.nCast, 60), normalScale: new THREE2.Vector2(0.2, 0.2), roughnessMap: rep(tex2.rough, 60) });
  R4.wood = phys({
    color: 16777215,
    map: rep(tex2.woodBirch, 160),
    roughness: 0.46,
    metalness: 0,
    normalMap: rep(tex2.nWood, 160),
    normalScale: new THREE2.Vector2(0.25, 0.25),
    clearcoat: 0.35,
    clearcoatRoughness: 0.4
  });
  R4.woodDark = phys({
    color: 16777215,
    map: rep(tex2.woodWalnut, 160),
    roughness: 0.5,
    metalness: 0,
    normalMap: rep(tex2.nWood, 160),
    normalScale: new THREE2.Vector2(0.25, 0.25),
    clearcoat: 0.3,
    clearcoatRoughness: 0.45
  });
  const glass = (color, op) => phys({
    color,
    roughness: 0.04,
    metalness: 0.1,
    transparent: true,
    opacity: op,
    depthWrite: false,
    envMapIntensity: 2.2,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    side: THREE2.DoubleSide
  });
  R4.glass = glass(12113124, 0.08);
  R4.glassAmber = glass(14725232, 0.1);
  R4.glassRed = glass(15245456, 0.09);
  R4.glassBlue = glass(9087208, 0.1);
  R4.glassDark = glass(2241348, 0.55);
  R4.lensBlack = std({ color: 329223, roughness: 0.25, metalness: 0.2 });
  R4.emRed = std({ color: 2228224, emissive: 16722458, emissiveIntensity: 3, roughness: 0.4 });
  R4.emGreen = std({ color: 8704, emissive: 7208794, emissiveIntensity: 2.5, roughness: 0.4 });
  R4.tritium = std({ color: 1714704, emissive: 9240426, emissiveIntensity: 1.2, roughness: 0.4 });
  R4.lampLens = std({ color: 14542574, emissive: 16774108, emissiveIntensity: 0, roughness: 0.08, metalness: 0.2 });
  R4.laserLens = std({ color: 3346448, emissive: 16719888, emissiveIntensity: 0, roughness: 0.1 });
  R4.irLens = std({ color: 1381653, roughness: 0.05, metalness: 0.4 });
  R4.white = std({ color: 15263456, roughness: 0.5 });
  R4.paintRed = std({ color: 11805724, roughness: 0.5 });
  R4.paintWhite = std({ color: 14605266, roughness: 0.55 });
  R4.paper = std({ color: 15328211, roughness: 0.95 });
  R4.target = std({ color: 13617334, roughness: 0.6, metalness: 0.2 });
  const cache2 = /* @__PURE__ */ new Map();
  return {
    tex: tex2,
    all: R4,
    get(key) {
      if (typeof key !== "string") return key;
      if (R4[key]) return R4[key];
      if (cache2.has(key)) return cache2.get(key);
      const [base, col] = key.split("#");
      if (R4[base] && col) {
        const m = R4[base].clone();
        m.color = new THREE2.Color("#" + col);
        cache2.set(key, m);
        return m;
      }
      console.warn("нет материала", key);
      return R4.poly;
    }
  };
}


