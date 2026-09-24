// src/engine/fx.js
import * as THREE6 from "three";
function tex(size, draw2) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw2(c.getContext("2d"), size);
  const t = new THREE6.CanvasTexture(c);
  t.colorSpace = THREE6.SRGBColorSpace;
  return t;
}
var R2 = Math.random;
var TEX = {};
function textures() {
  if (TEX.glow) return TEX;
  TEX.glow = tex(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(0.2, "rgba(255,255,255,.8)");
    gr.addColorStop(0.5, "rgba(255,255,255,.2)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  const flash = (seed) => tex(256, (g, s) => {
    g.translate(s / 2, s / 2);
    const n = 7 + seed * 2;
    for (let i = 0; i < n; i++) {
      g.rotate(Math.PI * 2 / n + (R2() - 0.5) * 0.5);
      const L = s * (0.26 + R2() * 0.22), w = s * (0.025 + R2() * 0.03);
      const gr2 = g.createLinearGradient(0, 0, L, 0);
      gr2.addColorStop(0, "rgba(255,244,210,1)");
      gr2.addColorStop(0.45, "rgba(255,190,90,.75)");
      gr2.addColorStop(1, "rgba(255,120,30,0)");
      g.fillStyle = gr2;
      g.beginPath();
      g.moveTo(0, -w);
      g.quadraticCurveTo(L * 0.5, -w * 0.8, L, 0);
      g.quadraticCurveTo(L * 0.5, w * 0.8, 0, w);
      g.fill();
    }
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.2);
    gr.addColorStop(0, "rgba(255,255,240,1)");
    gr.addColorStop(0.5, "rgba(255,210,120,.8)");
    gr.addColorStop(1, "rgba(255,150,50,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, s * 0.2, 0, 7);
    g.fill();
  });
  TEX.flash = [flash(0), flash(1)];
  TEX.jet = tex(256, (g, s) => {
    for (let i = 0; i < 3; i++) {
      const gr = g.createRadialGradient(s * 0.12, s / 2, 0, s * 0.12, s / 2, s * (0.75 - i * 0.18));
      gr.addColorStop(0, "rgba(255,248,225,1)");
      gr.addColorStop(0.25, "rgba(255,196,90,.85)");
      gr.addColorStop(0.6, "rgba(255,120,30,.25)");
      gr.addColorStop(1, "rgba(255,90,10,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(s * 0.42, s / 2 + (R2() - 0.5) * s * 0.04, s * 0.42, s * (0.13 - i * 0.03), (R2() - 0.5) * 0.08, 0, 7);
      g.fill();
    }
  });
  TEX.smoke = tex(256, (g, s) => {
    const h = s / 2;
    for (let c = 0; c < 4; c++) {
      const ox = c % 2 * h, oy = (c / 2 | 0) * h;
      g.save();
      g.beginPath();
      g.rect(ox, oy, h, h);
      g.clip();
      for (let i = 0; i < 26; i++) {
        const a = R2() * 6.28, rr = R2() * h * 0.22;
        const x = ox + h / 2 + Math.cos(a) * rr, y = oy + h / 2 + Math.sin(a) * rr, r = h * (0.1 + R2() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        const k = 0.1 + R2() * 0.16;
        gr.addColorStop(0, `rgba(255,255,255,${k})`);
        gr.addColorStop(0.6, `rgba(245,245,245,${k * 0.5})`);
        gr.addColorStop(1, "rgba(240,240,240,0)");
        g.fillStyle = gr;
        g.fillRect(ox, oy, h, h);
      }
      g.globalCompositeOperation = "destination-in";
      const e = g.createRadialGradient(ox + h / 2, oy + h / 2, h * 0.12, ox + h / 2, oy + h / 2, h / 2);
      e.addColorStop(0, "rgba(0,0,0,1)");
      e.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = e;
      g.fillRect(ox, oy, h, h);
      g.restore();
    }
  });
  TEX.spark = tex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(255,250,230,1)");
    gr.addColorStop(0.25, "rgba(255,200,110,.9)");
    gr.addColorStop(1, "rgba(255,120,30,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  TEX.hole = tex(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, "rgba(20,18,16,1)");
    gr.addColorStop(0.35, "rgba(40,36,30,.9)");
    gr.addColorStop(0.6, "rgba(120,110,95,.4)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  return TEX;
}
var additive = (map, color, opacity = 1) => new THREE6.SpriteMaterial({ map, color, transparent: true, opacity, blending: THREE6.AdditiveBlending, depthWrite: false, toneMapped: false });
var VS = `
attribute vec3 iPos;
attribute vec4 iData;   // размер, поворот, альфа, кадр атласа
attribute vec4 iCol;    // цвет + растяжение (искры)
varying vec2 vUv;
varying float vA;
varying vec3 vC;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.y), s = sin(iData.y);
  vec2 q = position.xy;
  q.x *= 1.0 + iCol.w;
  mvPosition.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iData.x;
  gl_Position = projectionMatrix * mvPosition;
  float f = iData.w;
  vUv = ATLAS > 1.0 ? (uv + vec2(mod(f, 2.0), floor(f / 2.0))) * 0.5 : uv;
  vA = iData.z;
  vC = iCol.rgb;
  #include <fog_vertex>
}`;
var FS = `
uniform sampler2D map;
varying vec2 vUv;
varying float vA;
varying vec3 vC;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vC * t.rgb, t.a * vA);
  if (gl_FragColor.a < 0.003) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
var Particles = class {
  constructor(scene, map, max, o = {}) {
    this.max = max;
    const g = new THREE6.InstancedBufferGeometry();
    const quad = new THREE6.PlaneGeometry(1, 1);
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    g.setAttribute("uv", quad.getAttribute("uv"));
    this.aPos = new THREE6.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE6.DynamicDrawUsage);
    this.aData = new THREE6.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE6.DynamicDrawUsage);
    this.aCol = new THREE6.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE6.DynamicDrawUsage);
    g.setAttribute("iPos", this.aPos);
    g.setAttribute("iData", this.aData);
    g.setAttribute("iCol", this.aCol);
    g.instanceCount = 0;
    const uniforms = THREE6.UniformsUtils.merge([THREE6.UniformsLib.fog, { map: { value: null } }]);
    uniforms.map.value = map;
    const mat = new THREE6.ShaderMaterial({
      uniforms,
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: o.additive ? THREE6.AdditiveBlending : THREE6.NormalBlending,
      defines: { ATLAS: (o.atlas ? 2 : 1).toFixed(1) }
    });
    mat.toneMapped = !o.additive;
    this.mesh = new THREE6.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.additive ? 3 : 2;
    scene.add(this.mesh);
    this.list = [];
    this.pool = [];
    this.sort = !!o.sort;
  }
  // p: {pos, vel, life, size, grow, alpha, color, drag, buoy, gravity, turb, rot, spin, frame, stretch, fadeIn}
  add(p) {
    if (this.list.length >= this.max) this.pool.push(this.list.shift());
    const q = this.pool.pop() || {};
    Object.assign(q, { t: 0, drag: 2, buoy: 0, gravity: 0, rot: R2() * 6.28, spin: (R2() - 0.5) * 1.2, frame: R2() * 4 | 0, stretch: 0, fadeIn: 0.06, grow: 0, turb: 0 }, p);
    q.px = p.pos.x;
    q.py = p.pos.y;
    q.pz = p.pos.z;
    q.vx = p.vel.x;
    q.vy = p.vel.y;
    q.vz = p.vel.z;
    q.pos = q.vel = null;
    this.list.push(q);
  }
  update(dt, cam, wind) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.pool.push(p);
        L.splice(i, 1);
        continue;
      }
      const dr = Math.exp(-p.drag * dt);
      p.vx = p.vx * dr + wind.x * (1 - dr);
      p.vz = p.vz * dr + wind.z * (1 - dr);
      p.vy = p.vy * dr + (p.buoy - p.gravity) * dt;
      if (p.turb) {
        p.vx += (R2() - 0.5) * p.turb * dt;
        p.vy += (R2() - 0.5) * p.turb * dt;
        p.vz += (R2() - 0.5) * p.turb * dt;
      }
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.rot += p.spin * dt;
    }
    if (this.sort && L.length > 1 && cam) {
      const c = cam.position;
      for (const p of L) p.d = (p.px - c.x) ** 2 + (p.py - c.y) ** 2 + (p.pz - c.z) ** 2;
      L.sort((a, b) => b.d - a.d);
    }
    const P = this.aPos.array, D = this.aData.array, C = this.aCol.array;
    for (let i = 0; i < L.length; i++) {
      const p = L[i], k = p.t / p.life;
      P[i * 3] = p.px;
      P[i * 3 + 1] = p.py;
      P[i * 3 + 2] = p.pz;
      D[i * 4] = p.size + p.grow * Math.sqrt(k);
      D[i * 4 + 1] = p.rot;
      const fin = p.fadeIn > 0 ? Math.min(1, p.t / p.fadeIn) : 1;
      D[i * 4 + 2] = p.alpha * fin * (1 - k) * (1 - k * 0.5);
      D[i * 4 + 3] = p.frame;
      C[i * 4] = p.color[0];
      C[i * 4 + 1] = p.color[1];
      C[i * 4 + 2] = p.color[2];
      C[i * 4 + 3] = p.stretch * (1 - k);
    }
    this.mesh.geometry.instanceCount = L.length;
    if (L.length) {
      for (const a of [this.aPos, this.aData, this.aCol]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, L.length * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
};
var MAX_SHELLS = 60;
var X_AXIS = new THREE6.Vector3(1, 0, 0);
var FX = class {
  constructor(scene, mats) {
    this.scene = scene;
    const T2 = textures();
    this.T = T2;
    this.mats = mats;
    this.flash = new THREE6.Group();
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashCore = new THREE6.Sprite(additive(T2.flash[0], 16767392));
    this.flashFront = [0, 1, 2].map(() => new THREE6.Sprite(additive(T2.glow, 16757594, 0.9)));
    this.flashJet = new THREE6.Sprite(additive(T2.jet, 16763e3, 0.95));
    this.flashSide = [0, 1].map(() => new THREE6.Sprite(additive(T2.jet, 16760944, 0.95)));
    this.flash.add(this.flashCore, ...this.flashFront, this.flashJet, ...this.flashSide);
    this.flashLight = new THREE6.PointLight(16754768, 0, 6, 2);
    scene.add(this.flashLight);
    this.flashT = 0;
    this.smoke = new Particles(scene, T2.smoke, 420, { atlas: true, sort: true });
    this.fire = new Particles(scene, T2.spark, 260, { additive: true });
    this.wind = new THREE6.Vector3(0.18, 0, 0.1);
    this.noWind = new THREE6.Vector3();
    this.heat = 0;
    this.wispT = 0;
    this.shells = [];
    this.inst = /* @__PURE__ */ new Map();
    this.holes = [];
    this.holeGeo = new THREE6.CircleGeometry(0.012, 12);
    this.holeMat = new THREE6.MeshBasicMaterial({ map: T2.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.beam = new THREE6.Mesh(
      new THREE6.CylinderGeometry(6e-4, 14e-4, 1, 6, 1, true).translate(0, 0.5, 0).rotateZ(-Math.PI / 2),
      new THREE6.MeshBasicMaterial({ color: 16722458, transparent: true, opacity: 0.22, blending: THREE6.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.dot = new THREE6.Sprite(additive(T2.glow, 16724e3, 1));
    this.dot.visible = false;
    scene.add(this.beam, this.dot);
    this.spot = new THREE6.SpotLight(16773596, 0, 60, 0.28, 0.55, 1.4);
    scene.add(this.spot, this.spot.target);
    this.lampGlow = new THREE6.Sprite(additive(T2.glow, 16774886, 0));
    this.lampGlow.scale.setScalar(0.07);
    scene.add(this.lampGlow);
    this.ray = new THREE6.Raycaster();
    this._v = new THREE6.Vector3();
    this._q = new THREE6.Quaternion();
    this._m = new THREE6.Matrix4();
    this._s = new THREE6.Vector3(1, 1, 1);
  }
  // Что-то ещё движется — кадр нужно перерисовать.
  active() {
    return this.flashT > 0 || this.smoke.list.length > 0 || this.fire.list.length > 0 || this.heat > 0.3 || this.shells.some((s) => s.alive && !s.rest);
  }
  smokePuff(pos, vel, o = {}) {
    const g = o.grey ?? 0.58 + R2() * 0.1;
    this.smoke.add({
      pos,
      vel,
      life: o.life ?? 1.6 + R2(),
      size: o.size ?? 0.03,
      grow: o.grow ?? 0.3,
      alpha: o.alpha ?? 0.35,
      color: [g * 1.02, g, g * 0.95],
      drag: o.drag ?? 3.5,
      buoy: o.buoy ?? 0.12,
      turb: o.turb ?? 0.25,
      fadeIn: o.fadeIn ?? 0.03,
      gravity: o.gravity ?? 0
    });
  }
  muzzleFlash(pos, dir, kind, size = 1) {
    const supp = kind === "supp";
    const s = supp ? 0.12 : kind === "brake" ? 1.1 : kind === "fh" ? 0.55 : kind === "linear" ? 0.5 : 1;
    this.flash.position.copy(pos);
    this.flash.visible = true;
    this.flashT = 0.04 + R2() * 0.018;
    const k = s * size;
    this.flashCore.material.map = this.T.flash[R2() * 2 | 0];
    this.flashCore.scale.setScalar(0.075 * k * (0.75 + R2() * 0.5));
    this.flashCore.material.rotation = R2() * 6.28;
    this.flashCore.material.opacity = supp ? 0.35 : 1;
    this.flashFront.forEach((sp, i) => {
      sp.position.copy(dir).multiplyScalar((0.03 + i * 0.045) * k);
      sp.scale.setScalar((0.075 - i * 0.017) * k * (0.75 + R2() * 0.55));
      sp.visible = !supp;
    });
    this.flashJet.visible = !supp;
    this.flashJet.position.copy(dir).multiplyScalar(0.05 * k);
    this.flashJet.scale.set(0.14 * k * (0.8 + R2() * 0.4), 0.05 * k, 1);
    this.flashJet.material.opacity = kind === "fh" ? 0.45 : 0.9;
    const side = new THREE6.Vector3().crossVectors(dir, new THREE6.Vector3(0, 1, 0)).normalize();
    this.flashSide.forEach((sp, i) => {
      const sgn = i ? 1 : -1;
      sp.visible = kind === "brake";
      sp.position.copy(side).multiplyScalar(sgn * 0.04 * k).addScaledVector(dir, -0.01);
      sp.scale.set(0.09 * k, 0.04 * k, 1);
      sp.material.rotation = sgn > 0 ? 0 : Math.PI;
    });
    this.flashLight.position.copy(pos).addScaledVector(dir, 0.05);
    this.flashLight.intensity = supp ? 0.3 : 5 * k;
    this.heat = Math.min(3, this.heat + 0.22 * size);
    const nSp = supp ? 0 : Math.round((kind === "bare" ? 7 : kind === "brake" ? 6 : 3) * size);
    for (let i = 0; i < nSp; i++) {
      const v = dir.clone().multiplyScalar(4 + R2() * 7).add(new THREE6.Vector3((R2() - 0.5) * 1.6, (R2() - 0.5) * 1.6, (R2() - 0.5) * 1.6));
      this.fire.add({ pos: pos.clone().addScaledVector(dir, 0.02), vel: v, life: 0.05 + R2() * 0.08, size: 4e-3 + R2() * 4e-3, alpha: 1, color: [1, 0.72, 0.35], drag: 6, gravity: 2, stretch: 2.5, fadeIn: 0, spin: 0 });
    }
    if (!supp) for (let i = 0; i < 3; i++) {
      this.fire.add({ pos: pos.clone().addScaledVector(dir, 0.02 + i * 0.03 * k), vel: dir.clone().multiplyScalar(1.5), life: 0.035 + R2() * 0.02, size: 0.035 * k, grow: 0.03 * k, alpha: 0.55, color: [1, 0.62, 0.28], drag: 8, fadeIn: 0 });
    }
    const up = new THREE6.Vector3(0, 1, 0);
    const n = supp ? 3 : kind === "brake" ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(1.5 + R2() * 5).add(new THREE6.Vector3((R2() - 0.5) * 0.5, (R2() - 0.3) * 0.4, (R2() - 0.5) * 0.5));
      this.smokePuff(pos.clone().addScaledVector(dir, 0.03 + R2() * 0.06), v, { size: 0.025 + R2() * 0.02, grow: 0.28 + R2() * 0.3, alpha: (supp ? 0.16 : 0.3) * size, life: 1.2 + R2() * 1.4, drag: 4.5 });
    }
    if (kind === "brake" || kind === "comp") {
      for (let i = 0; i < 6; i++) {
        const sg = kind === "comp" ? 0 : i % 2 ? 1 : -1;
        const v = side.clone().multiplyScalar(sg * (2 + R2() * 2.5)).addScaledVector(up, kind === "comp" ? 1.5 + R2() * 2 : (R2() - 0.2) * 0.8).addScaledVector(dir, R2() * 0.8);
        this.smokePuff(pos.clone(), v, { size: 0.03, grow: 0.3 + R2() * 0.2, alpha: 0.26 * size, life: 1.1 + R2(), drag: 5 });
      }
    }
    for (let i = 0; i < (supp ? 2 : 3); i++) {
      this.smokePuff(pos.clone().addScaledVector(dir, 0.05 + R2() * 0.25), dir.clone().multiplyScalar(0.3 + R2() * 0.6).add(new THREE6.Vector3(0, 0.05, 0)), { size: 0.06, grow: 0.45 + R2() * 0.35, alpha: (supp ? 0.12 : 0.18) * size, life: 2.6 + R2() * 1.6, drag: 2.2, buoy: 0.08, turb: 0.35, fadeIn: 0.15, grey: 0.66 });
    }
  }
  // пороховые газы из окна выброса
  portSmoke(pos, dir) {
    for (let i = 0; i < 2; i++) {
      const v = dir.clone().multiplyScalar(0.35 + R2() * 0.3).add(new THREE6.Vector3((R2() - 0.5) * 0.1, 0.18 + R2() * 0.1, 0));
      this.smokePuff(pos.clone(), v, { size: 0.012, grow: 0.12 + R2() * 0.08, alpha: 0.22, life: 0.9 + R2() * 0.6, drag: 3, grey: 0.7 });
    }
  }
  shellMesh(key, cal, live) {
    let m = this.inst.get(key);
    if (m) return m;
    const c = CAL[cal] || CAL["556"];
    const brass = c.steel ? this.mats.get("steelCase") : this.mats.get("brass");
    let g = caseGeo(cal), mat = brass;
    if (c.shot || live) {
      // гильза дроби — два материала (латунь + пластик); живой патрон — гильза + пуля
      const parts = (c.shot ? [shotHead(c), shotHull(c, !live)] : [g, bulletGeo(cal)]).map((x) => x.index ? x.toNonIndexed() : x);
      g = new THREE6.BufferGeometry();
      for (const a of ["position", "normal"]) {
        const arr = new Float32Array(parts[0].getAttribute(a).array.length + parts[1].getAttribute(a).array.length);
        arr.set(parts[0].getAttribute(a).array, 0);
        arr.set(parts[1].getAttribute(a).array, parts[0].getAttribute(a).array.length);
        g.setAttribute(a, new THREE6.BufferAttribute(arr, 3));
      }
      const n0 = parts[0].getAttribute("position").count;
      g.addGroup(0, n0, 0);
      g.addGroup(n0, parts[1].getAttribute("position").count, 1);
      mat = c.shot ? [this.mats.get("brass"), this.mats.get("hullRed")] : [brass, this.mats.get("copper")];
    }
    g.scale(1e-3, 1e-3, 1e-3);
    g.translate(-c.L * 5e-4, 0, 0);
    m = new THREE6.InstancedMesh(g, mat, live ? 8 : MAX_SHELLS);
    m.castShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE6.DynamicDrawUsage);
    this.scene.add(m);
    this.inst.set(key, m);
    return m;
  }
  // Гильза: вылет из окна с кувырком, дымок из дульца, отскоки от бетона.
  shell(pos, vel, cal, quat, live = false) {
    const c = CAL[cal] || CAL["556"];
    const key = cal + (live ? ":live" : "");
    this.shellMesh(key, cal, live);
    const cap = live ? 8 : MAX_SHELLS;
    const same = this.shells.filter((x) => x.key === key);
    let s = same.find((x) => !x.alive);
    if (!s) {
      if (same.length >= cap) s = same.reduce((a, b) => a.t > b.t ? a : b);
      else {
        s = { key, pos: new THREE6.Vector3(), quat: new THREE6.Quaternion(), vel: new THREE6.Vector3(), w: new THREE6.Vector3() };
        this.shells.push(s);
      }
    }
    s.pos.copy(pos);
    s.quat.copy(quat);
    s.vel.copy(vel);
    const axis = X_AXIS.clone().applyQuaternion(quat);
    const tumble = new THREE6.Vector3().crossVectors(axis, vel).normalize();
    s.w.copy(tumble).multiplyScalar((live ? 12 : 24) + R2() * 22).addScaledVector(axis, (R2() - 0.5) * 12);
    s.alive = true;
    s.rest = false;
    s.t = 0;
    s.bounced = 0;
    s.steel = c.steel;
    s.kind = c.shot ? "hull" : c.steel ? "steel" : "brass";
    s.live = live;
    s.r = c.rim * 5e-4;
    s.trail = live ? 0 : c.shot ? 0.5 : 0.28;
    return s;
  }
  // Попадание: пыль и комья по земле/валу, искры и отметина на стали.
  impact(hit, surface) {
    const p = hit.point, n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE6.Vector3(0, 1, 0);
    if (surface === "steel") {
      for (let i = 0; i < 3; i++) this.smokePuff(p.clone().addScaledVector(n, 0.02), n.clone().multiplyScalar(0.4).add(new THREE6.Vector3((R2() - 0.5) * 0.6, R2() * 0.5, (R2() - 0.5) * 0.6)), { life: 0.7, size: 0.06, grow: 0.25, alpha: 0.4, drag: 3 });
      for (let i = 0; i < 10; i++) {
        const v = n.clone().multiplyScalar(1 + R2() * 2).add(new THREE6.Vector3((R2() - 0.5) * 4, R2() * 3, (R2() - 0.5) * 4));
        this.fire.add({ pos: p.clone().addScaledVector(n, 0.01), vel: v, life: 0.15 + R2() * 0.25, size: 0.012 + R2() * 0.01, alpha: 1, color: [1, 0.75, 0.4], drag: 1.5, gravity: 9.8, stretch: 2, fadeIn: 0, spin: 0 });
      }
      const hole = new THREE6.Mesh(this.holeGeo, this.holeMat);
      hit.object.worldToLocal(hole.position.copy(p).addScaledVector(n, 15e-4));
      const ln = n.clone().transformDirection(new THREE6.Matrix4().copy(hit.object.matrixWorld).invert());
      hole.lookAt(hole.position.clone().add(ln));
      hit.object.add(hole);
      this.holes.push(hole);
      if (this.holes.length > 80) {
        const h = this.holes.shift();
        h.parent?.remove(h);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        this.smoke.add({ pos: p.clone(), vel: n.clone().multiplyScalar(0.8 + R2() * 1.4).add(new THREE6.Vector3((R2() - 0.5) * 0.9, R2() * 1.2, (R2() - 0.5) * 0.9)), life: 1 + R2() * 0.8, size: 0.08, grow: 0.55, alpha: 0.55, color: [0.58, 0.5, 0.39], drag: 2.5, gravity: 0.4, turb: 0.3 });
      }
      for (let i = 0; i < 5; i++) {
        this.smoke.add({ pos: p.clone(), vel: n.clone().multiplyScalar(2 + R2() * 2).add(new THREE6.Vector3((R2() - 0.5) * 2, R2() * 2, (R2() - 0.5) * 2)), life: 0.5 + R2() * 0.3, size: 0.025, alpha: 0.9, color: [0.3, 0.26, 0.2], drag: 0.8, gravity: 9.8, fadeIn: 0 });
      }
    }
  }
  setLaser(on, pos, dir, hitables) {
    this.beam.visible = this.dot.visible = on;
    if (!on) return;
    this.ray.set(pos, dir);
    this.ray.far = 250;
    const h = this.ray.intersectObjects(hitables, false)[0];
    const d = h ? h.distance : 250;
    this.beam.position.copy(pos);
    this.beam.scale.set(d, 1, 1);
    this.beam.quaternion.setFromUnitVectors(X_AXIS, dir);
    this.dot.position.copy(pos).addScaledVector(dir, d - 0.01);
    this.dot.scale.setScalar(0.015 + d * 22e-4);
  }
  setLight(on, pos, dir, lumens = 1e3) {
    this.spot.intensity = on ? 30 * (lumens / 1e3) : 0;
    this.lampGlow.material.opacity = on ? 0.9 : 0;
    if (!on) return;
    this.spot.position.copy(pos);
    this.spot.target.position.copy(pos).addScaledVector(dir, 10);
    this.lampGlow.position.copy(pos).addScaledVector(dir, 4e-3);
  }
  // muzzle — текущий дульный срез: от нагретого ствола после очереди идёт струйка дыма
  update(dt, onShellBounce, cam, muzzle) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashLight.intensity = 0;
      } else this.flashLight.intensity *= 0.6;
    }
    if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * 0.35);
      this.wispT -= dt;
      if (this.wispT <= 0 && this.heat > 0.3 && muzzle) {
        this.wispT = 0.06 + R2() * 0.05;
        this.smokePuff(muzzle.clone(), new THREE6.Vector3((R2() - 0.5) * 0.02, 0.1 + R2() * 0.06, (R2() - 0.5) * 0.02), { size: 0.01, grow: 0.09, alpha: Math.min(0.16, this.heat * 0.07), life: 1.8 + R2(), drag: 1.2, buoy: 0.06, turb: 0.12, grey: 0.72, fadeIn: 0.3 });
      }
    }
    for (const s of this.shells) {
      if (!s.alive) continue;
      s.t += dt;
      if (s.t > 10) {
        s.alive = false;
        continue;
      }
      if (s.rest) continue;
      s.vel.y -= 9.81 * dt;
      s.vel.multiplyScalar(Math.exp(-0.25 * dt));
      s.pos.addScaledVector(s.vel, dt);
      const wl = s.w.length();
      if (wl > 1e-3) {
        this._q.setFromAxisAngle(this._v.copy(s.w).divideScalar(wl), wl * dt);
        s.quat.premultiply(this._q);
      }
      if (s.trail > 0) {
        s.trail -= dt;
        if (R2() < 0.45) this.smokePuff(s.pos.clone(), s.vel.clone().multiplyScalar(0.1), { size: 6e-3, grow: 0.05, alpha: 0.14, life: 0.5 + R2() * 0.4, drag: 4, grey: 0.74, fadeIn: 0.02 });
      }
      const floor = (Math.abs(s.pos.x + 0.8) < 3 && Math.abs(s.pos.z) < 2.5 ? 0.12 : 0) + s.r;
      if (s.pos.y < floor) {
        s.pos.y = floor;
        if (s.vel.y < -0.35) {
          s.vel.y *= -(0.28 + R2() * 0.12);
          s.vel.x *= 0.55;
          s.vel.z *= 0.55;
          s.w.multiplyScalar(0.5).add(this._v.set((R2() - 0.5) * 20, (R2() - 0.5) * 30, (R2() - 0.5) * 20));
          if (s.bounced++ < 2 && onShellBounce) onShellBounce(s, s.bounced);
        } else {
          s.rest = true;
          const ax = X_AXIS.clone().applyQuaternion(s.quat);
          ax.y = 0;
          if (ax.lengthSq() < 1e-6) ax.set(1, 0, 0);
          s.quat.setFromUnitVectors(X_AXIS, ax.normalize()).multiply(this._q.setFromAxisAngle(X_AXIS, R2() * 6.28));
        }
      }
    }
    const counts = /* @__PURE__ */ new Map();
    for (const s of this.shells) {
      if (!s.alive) continue;
      const m = this.inst.get(s.key), i = counts.get(s.key) || 0;
      m.setMatrixAt(i, this._m.compose(s.pos, s.quat, this._s));
      counts.set(s.key, i + 1);
    }
    for (const [k, m] of this.inst) {
      const n = counts.get(k) || 0;
      if (n || m.count) m.instanceMatrix.needsUpdate = true;
      m.count = n;
    }
    this.smoke.update(dt, cam, this.wind);
    this.fire.update(dt, cam, this.noWind);
  }
};


