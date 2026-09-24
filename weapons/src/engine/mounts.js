// src/engine/mounts.js
import * as THREE4 from "three";
function mount(o) {
  const n = new THREE4.Group();
  n.name = "mount:" + o.id;
  if (o.p) n.position.set(...o.p);
  const face = o.face || "top";
  if (face === "left") n.rotation.x = -Math.PI / 2;
  else if (face === "right") n.rotation.x = Math.PI / 2;
  else if (face === "bottom") n.rotation.x = Math.PI;
  n.userData.mount = { pitch: PICA.PITCH, ...o, face };
  return n;
}
function railMount(id, p, face, slots, extra = {}) {
  return mount({ id, type: "pica", p, face, slots, ...extra });
}
var _m2 = new THREE4.Matrix4();
var _v2 = new THREE4.Vector3();
function toRoot(obj, root) {
  const m = new THREE4.Matrix4();
  const chain = [];
  let o = obj;
  while (o && o !== root) {
    chain.push(o);
    o = o.parent;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix();
    m.multiply(chain[i].matrix);
  }
  return m;
}
var Assembler = class _Assembler {
  // def — описание оружия, lib — общая библиотека модулей, ctx — {THREE, G, mats, Kit}
  constructor(def, lib, ctx) {
    this.def = def;
    this.ctx = ctx;
    this.parts = /* @__PURE__ */ new Map();
    for (const p of [...lib, ...def.parts || []]) this.parts.set(p.id, p);
    this.base = def.build(ctx);
    this.root = new THREE4.Group();
    this.root.name = def.id;
    this.root.add(this.base.root);
    this.cache = /* @__PURE__ */ new Map();
    this.installed = /* @__PURE__ */ new Map();
    this.mounts = /* @__PURE__ */ new Map();
    this.config = {};
  }
  partList() {
    return [...this.parts.values()];
  }
  part(id) {
    return this.parts.get(id);
  }
  // Статическая совместимость: может ли модуль в принципе встать на это оружие.
  static fits(part, slot2, def) {
    if (!slot2.accepts.includes(part.cat)) return false;
    if (part.only && !part.only.includes(def.id)) return false;
    if (part.fit?.thread && !part.fit.thread.includes(slot2.thread || def.thread)) return false;
    if (part.fit?.iface && slot2.iface && !part.fit.iface.includes(slot2.iface)) return false;
    return true;
  }
  slotOptions(slot2) {
    return this.partList().filter((p) => _Assembler.fits(p, slot2, this.def));
  }
  collectMounts() {
    this.mounts.clear();
    const walk = (o) => {
      if (o.userData.mount) this.mounts.set(o.userData.mount.id, o);
      for (const c of o.children) walk(c);
    };
    walk(this.root);
  }
  // Все допустимые позиции модуля на наборе планок, отсортированные вдоль оси.
  railPositions(slot2, part, ignoreSlot) {
    const out = [];
    const foot = part.foot || [-5, 5];
    for (const rid of slot2.rails || []) {
      const m = this.mounts.get(rid);
      if (!m) continue;
      const md = m.userData.mount;
      const accepts = part.mountTypes || ["pica"];
      if (!accepts.includes(md.type)) continue;
      const mat = toRoot(m, this.root);
      const n = md.slots || 1;
      for (let i = 0; i < n; i++) {
        const lx = i * (md.pitch || PICA.PITCH);
        if (md.type === "pica") {
          const lo = -PICA.PITCH / 2 - 1.5, hi = (n - 1) * PICA.PITCH + PICA.PITCH / 2 + 1.5;
          if (lx + foot[0] < lo - 0.01 || lx + foot[1] > hi + 0.01) continue;
        }
        const wx = _v2.set(lx, 0, 0).applyMatrix4(mat).x;
        out.push({ rail: rid, i, x: wx, face: md.face, axis: md.axis || md.face });
      }
    }
    out.sort((a, b) => a.x - b.x);
    const body = part.body || part.foot || [-5, 5];
    let limit = Infinity;
    if (slot2.behind) {
      const o = this.installed.get(slot2.behind);
      if (o?.railPos) limit = o.railPos.x + (o.part.body || o.part.foot)[0];
    }
    return out.map((p) => ({ ...p, clash: p.x + body[1] > limit + 0.5 ? "перед прицелом" : this.clash(p, part, ignoreSlot, slot2) }));
  }
  // Модулю «позади прицела» не хватает места: ищем ближайшую позицию прицела
  // дальше вперёд, при которой он встаёт. Возвращает эту позицию или null.
  roomBehind(slot2, part) {
    const tgt = slot2.behind && this.installed.get(slot2.behind);
    if (!tgt?.railPos) return null;
    const save = tgt.railPos;
    const cands = this.railPositions(tgt.slot, tgt.part, tgt.slot.id).filter((p) => !p.clash && p.x > save.x);
    let found = null;
    for (const c of cands) {
      tgt.railPos = c;
      if (this.railPositions(slot2, part, slot2.id).some((p) => !p.clash)) {
        found = c;
        break;
      }
    }
    tgt.railPos = save;
    return found;
  }
  clash(p, part, ignoreSlot, slot2) {
    const ext = (q) => q.body || q.foot || [-5, 5];
    const body = ext(part);
    const x0 = p.x + body[0], x1 = p.x + body[1];
    for (const [sid, it] of this.installed) {
      if (sid === ignoreSlot || !it.railPos) continue;
      if (it.railPos.axis !== p.axis) continue;
      const side = part.side || it.part.side;
      const a = side ? part.foot || body : body, b = side ? it.part.foot || ext(it.part) : ext(it.part);
      const u0 = p.x + a[0], u1 = p.x + a[1];
      const y0 = it.railPos.x + b[0], y1 = it.railPos.x + b[1];
      if (u0 < y1 - 0.5 && y0 < u1 - 0.5) return this.def.slots.find((s) => s.id === sid)?.label || sid;
    }
    for (const z of this.def.keepOut || []) {
      if (z.axis !== p.axis) continue;
      if (z.slots && !z.slots.includes(slot2.id)) continue;
      if (x0 < z.x1 && z.x0 < x1) return z.label;
    }
    return null;
  }
  built(slotId, part) {
    const key = slotId + "|" + part.id;
    if (!this.cache.has(key)) {
      const res = part.build(this.ctx, { weapon: this.def, slot: slotId });
      const obj = res.root || res;
      obj.name = "part:" + part.id;
      obj.userData.partId = part.id;
      obj.userData.slotId = slotId;
      obj.traverse((o) => {
        if (o.isMesh) {
          o.userData.partId = part.id;
          o.userData.slotId = slotId;
        }
      });
      this.cache.set(key, { obj, info: res.root ? res : { root: obj } });
    }
    return this.cache.get(key);
  }
  // Применяет конфигурацию {slotId: {id, pos}}; возвращает исправленную версию.
  apply(config) {
    for (const it of this.installed.values()) it.obj.parent?.remove(it.obj);
    this.installed.clear();
    const out = {};
    const hidden = /* @__PURE__ */ new Set();
    this.collectMounts();
    for (const slot2 of this.def.slots) {
      const want = config[slot2.id];
      const pid = want && typeof want === "object" ? want.id : want;
      if (!pid) {
        out[slot2.id] = null;
        continue;
      }
      const part = this.parts.get(pid);
      if (!part || !_Assembler.fits(part, slot2, this.def)) {
        out[slot2.id] = null;
        continue;
      }
      if (part.needs && !part.needs(out, this)) {
        out[slot2.id] = null;
        continue;
      }
      let host = null, railPos = null;
      if (slot2.rails) {
        const ps = this.railPositions(slot2, part, slot2.id).filter((p) => !p.clash);
        if (!ps.length) {
          out[slot2.id] = null;
          continue;
        }
        const wantPos = want && typeof want === "object" && want.pos != null ? want.pos : null;
        let pick = null;
        if (wantPos) pick = ps.find((p) => p.rail === wantPos.rail && p.i === wantPos.i);
        if (!pick) {
          const pref = slot2.prefer;
          if (pref && typeof pref === "object") pick = ps.reduce((a, b) => Math.abs(b.x - pref.x) < Math.abs(a.x - pref.x) ? b : a);
          else if (pref === "front") pick = ps[ps.length - 1];
          else if (pref === "rear") pick = ps[0];
          else pick = ps[Math.floor(ps.length / 2)];
        }
        railPos = pick;
        host = this.mounts.get(pick.rail);
      } else {
        host = this.mounts.get(slot2.mount);
      }
      if (!host) {
        out[slot2.id] = null;
        continue;
      }
      const { obj, info } = this.built(slot2.id, part);
      obj.position.set(railPos ? railPos.i * (host.userData.mount.pitch || PICA.PITCH) : 0, 0, 0);
      obj.rotation.set(0, 0, 0);
      host.add(obj);
      this.installed.set(slot2.id, { part, obj, info, host, railPos, slot: slot2 });
      for (const h of part.hides || []) hidden.add(h);
      out[slot2.id] = { id: pid, pos: railPos ? { rail: railPos.rail, i: railPos.i } : null };
      obj.traverse((o) => {
        if (o.userData.mount) this.mounts.set(o.userData.mount.id, o);
      });
    }
    this.base.root.traverse((o) => {
      if (o.userData.hideKey) o.visible = !hidden.has(o.userData.hideKey);
    });
    this.config = out;
    return out;
  }
  info(slotId) {
    return this.installed.get(slotId)?.info || null;
  }
  // Все установленные модули с заданным свойством info (sight, light, laser ...).
  withInfo(key) {
    const out = [];
    for (const [sid, it] of this.installed) if (it.info && it.info[key]) out.push({ slotId: sid, ...it, data: it.info[key] });
    if (this.base[key]) out.unshift({ slotId: "_base", obj: this.base.root, data: this.base[key], info: this.base });
    return out;
  }
  stats() {
    const s = { ...this.def.base };
    const mods = [];
    for (const it of this.installed.values()) if (it.part.stats) mods.push(it.part.stats);
    for (const m of mods) {
      for (const [k, v] of Object.entries(m)) {
        if (k === "mag") continue;
        if (k.endsWith("%")) {
          const kk = k.slice(0, -1);
          s[kk] = (s[kk] ?? 0) * (1 + v / 100);
        } else if (k === "loud" || k === "flash" || k === "velocity" || k === "rangeAdd") s[k] = (s[k] ?? 0) + v;
        else s[k] = (s[k] ?? 0) + v;
      }
    }
    for (const it of this.installed.values()) if (it.part.stats?.mag) s.mag = it.part.stats.mag;
    return s;
  }
};


