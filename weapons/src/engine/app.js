// src/engine/app.js
import * as THREE8 from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
var D2R2 = Math.PI / 180;
var Y_UP = new THREE8.Vector3(0, 1, 0);
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
var lerp = (a, b, t) => a + (b - a) * t;
var ease = (t) => t * t * (3 - 2 * t);
var KICK = { "556": 0.75, "545": 0.7, "762x39": 1.15, "762x51": 1.6, "9x19": 0.42, "762x54R": 1.9, "12ga": 2.6 };
// размер вспышки и энергия удара по гонгу — по патрону
var FLASH = { "762x51": 1.3, "762x39": 1.15, "762x54R": 1.45, "12ga": 1.5, "9x19": 0.7 };
var HIT = { "556": 2.5, "545": 2.5, "762x39": 3.2, "762x51": 4.5, "762x54R": 5, "9x19": 1.6, "12ga": 5.5 };
var Tweens = class {
  constructor() {
    this.list = [];
  }
  add(obj, key, to, dur, ease2 = (t) => t, done) {
    this.list = this.list.filter((t) => !(t.obj === obj && t.key === key));
    this.list.push({ obj, key, from: obj[key], to, dur: Math.max(dur, 1e-4), t: 0, ease: ease2, done });
  }
  wait(dur, done) {
    this.list.push({ obj: null, dur, t: 0, done });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      if (w.obj) w.obj[w.key] = w.from + (w.to - w.from) * w.ease(k);
      if (k >= 1) {
        this.list.splice(i, 1);
        w.done && w.done();
      }
    }
  }
};
async function boot(def, lib) {
  const host = document.getElementById("app");
  const S = createScene(host);
  const mats = createMaterials(S.env);
  const ctx = makeCtx(mats);
  const asm = new Assembler(def, lib, ctx);
  const base = asm.base;
  const audio = new GunAudio();
  audio.profile = { ...def.audio, rpm: def.base.rpm, family: def.family || (def.id.startsWith("ak") ? "ak" : def.id) };
  const fx = new FX(S.scene, mats);
  const tw = new Tweens();
  const aim = new THREE8.Group();
  aim.position.set(0, GUN_Y, 0);
  S.scene.add(aim);
  const rig = new THREE8.Group();
  aim.add(rig);
  const gun = asm.root;
  gun.scale.setScalar(1e-3);
  rig.add(gun);
  const pivotX = (base.pivotX ?? base.eyeX ?? -240) / 1e3;
  const st = {
    mode: def.modes.includes("auto") ? "auto" : def.modes[1] || "semi",
    mag: 0,
    cap: 30,
    chambered: true,
    magIn: true,
    busy: false,
    trigger: false,
    lastShot: 0,
    burst: 0,
    held: false,
    ads: false,
    adsT: 0,
    sightIdx: 0,
    zoom: 1,
    light: false,
    laser: false,
    batt: {},
    folded: false,
    bipod: false,
    magAside: false,
    holdOpen: false,
    spent: false,
    handleLocked: false,
    burstLeft: 0,
    yaw: 0,
    pitch: 0,
    climb: 0,
    rec: { p: 0, y: 0, z: 0, vp: 0, vy: 0, vz: 0 },
    stats: {},
    baseStats: {}
  };
  let cfg = {};
  let ui = null;
  let sights = [];
  let lights = [], lasers = [];
  let stencilRef = 1;
  let lastOptic = null;
  function magKind() {
    const it = asm.installed.get("mag");
    const m = it?.obj;
    let steel = false;
    m?.traverse((o) => {
      if (o.isMesh && /steel|alu/.test(o.userData.mat || "")) steel = true;
    });
    return steel ? "steel" : "poly";
  }
  function applyConfig(next, opts = {}) {
    cfg = asm.apply(next);
    const magInfo = asm.info("mag")?.mag;
    const prevCap = st.cap;
    st.cap = magInfo?.cap || def.base.mag || 30;
    if (opts.init || st.mag > st.cap || prevCap !== st.cap) st.mag = st.cap;
    if (!magInfo) st.magIn = false;
    else if (opts.init || def.feed === "tube") st.magIn = true;
    const ms = fireModes();
    if (!ms.includes(st.mode)) st.mode = ms.includes("auto") ? "auto" : ms.find((m) => m !== "safe") || ms[0];
    poseSelector(true);
    const mz = asm.info("muzzle")?.muzzle;
    audio.muzzle = mz ? mz.kind : "bare";
    if (audio.ctx) (window.requestIdleCallback || setTimeout)(() => audio.shotBuffer(audio.shotFamily(), audio.muzzle));
    st.stats = asm.stats();
    for (const it of asm.installed.values()) for (const s of [it.info?.sight, ...it.info?.alt || []]) {
      if (!s || !s.lens || s.lens.userData.stencilSet) continue;
      const ref = stencilRef++;
      const m = s.lens.material;
      m.stencilWrite = true;
      m.stencilRef = ref;
      m.stencilFunc = THREE8.AlwaysStencilFunc;
      m.stencilZPass = THREE8.ReplaceStencilOp;
      s.lens.userData.stencilSet = true;
      if (s.reticle) (s.node || it.obj).add(reticleMesh(s.reticle, s, ref));
    }
    const hasOptic = !!asm.info("optic")?.sight;
    for (const it of asm.installed.values()) {
      const f2 = it.info?.flip;
      if (f2) tw.add(f2.node.rotation, "z", hasOptic ? f2.angle * D2R2 : 0, opts.init ? 1e-3 : 0.35, ease);
      const fa = it.info?.flipAside;
      if (fa) fa.node.rotation.x = st.magAside ? fa.angle * D2R2 : 0;
      const fo = it.info?.fold;
      if (fo && fo.slide) fo.node.position.x = st.folded ? fo.slide : 0;
      else if (fo) fo.node.rotation[fo.axis || "y"] = st.folded ? fo.angle * D2R2 : 0;
      const bp = it.info?.bipod;
      if (bp) for (const l of bp.legs) l.rotation.z = st.bipod ? bp.angle * D2R2 : 0;
    }
    if (!asm.withInfo("bipod").length) st.bipod = false;
    if (!asm.withInfo("fold").length) st.folded = false;
    lights = asm.withInfo("light");
    lasers = asm.withInfo("laser");
    if (!lights.length) st.light = false;
    if (!lasers.length) st.laser = false;
    for (const it of [...lights, ...lasers]) if (st.batt[battKey(it)] == null) st.batt[battKey(it)] = 1;
    lensGlow();
    const mi = asm.info("mag")?.mag;
    if (mi?.rounds) mi.rounds.visible = st.mag > 0;
    const magObj = asm.installed.get("mag")?.obj;
    if (magObj) {
      magObj.visible = st.magIn;
      magObj.position.y = 0;
      magObj.rotation.z = 0;
    }
    buildSights();
    if (ui) ui.refresh();
    app?.invalidate?.();
  }
  function buildSights() {
    const prev = sights[st.sightIdx]?.id;
    sights = [];
    const m = new THREE8.Matrix4();
    const push = (id, label, obj, s) => {
      m.copy(toRoot(s.node || obj, gun));
      const eye = new THREE8.Vector3(s.x0 ?? 0, s.y, s.z || 0).applyMatrix4(m);
      const dir = new THREE8.Vector3(1, 0, 0).transformDirection(m);
      const up = new THREE8.Vector3(0, 1, 0).transformDirection(m);
      sights.push({ id, label, eye, dir, up, mag: s.mag || 1, zoom: s.zoom, reticle: s.reticle, eyeRelief: s.eyeRelief, magnifier: s.magnifier, x0: eye.x });
    };
    // дополнительные прицельные оси модуля (коллиматор поверх призмы/оптики): V переключает на них
    const pushAlt = (it) => (it.info?.alt || []).forEach((a, i) => push(it.slot.id + ":alt" + i, it.part.name + " — " + (a.label || "коллиматор"), it.obj, a));
    const opt = asm.installed.get("optic");
    if (opt?.info?.sight) push("optic", opt.part.name, opt.obj, opt.info.sight);
    if (opt) pushAlt(opt);
    for (const it of asm.installed.values()) if (it !== opt) pushAlt(it);
    for (const it of asm.installed.values()) if (it.slot.id !== "optic" && it.info?.sight && !it.info.sight.magnifier) push(it.slot.id, it.part.name, it.obj, it.info.sight);
    const mg = asm.installed.get("magnifier");
    if (mg?.info?.sight && sights[0]) {
      m.copy(toRoot(mg.obj, gun));
      const eye = new THREE8.Vector3(mg.info.sight.x0, mg.info.sight.y, 0).applyMatrix4(m);
      sights.splice(1, 0, { ...sights[0], id: "magnifier", label: sights[0].label + (mg.info.sight.suffix || ""), eye, mag: mg.info.sight.mag, eyeRelief: mg.info.sight.eyeRelief, nv: !!mg.info.sight.nv, hide: mg.info.sight.hide, withMag: mg.info.sight.mag > 1 });
    }
    let rear = null, front = null;
    const pts = (it, key) => {
      const v = it.info?.irons?.[key];
      if (!v) return null;
      return new THREE8.Vector3(...v).applyMatrix4(toRoot(it.obj, gun));
    };
    let rearIt = null;
    for (const it of asm.installed.values()) {
      if (!rear && (rear = pts(it, "rear"))) rearIt = it;
      front = front || pts(it, "front");
    }
    if (base.irons?.rear && !rear) rear = new THREE8.Vector3(...base.irons.rear);
    if (base.irons?.front && !front) front = new THREE8.Vector3(...base.irons.front);
    const opticFolds = !!opt && [...asm.installed.values()].some((it) => it.info?.flip);
    if (rear && front && !opticFolds) {
      const dir = front.clone().sub(rear).normalize();
      const type = rearIt ? rearIt.info.irons.type || "aperture" : base.irons?.type || "notch";
      const eyeDist = rearIt ? rearIt.info.irons.eye : base.irons?.eye;
      const apertureR = rearIt ? rearIt.info.irons.hole : base.irons?.hole;
      sights.push({ id: "irons", label: "Механический прицел", eye: rear, dir, mag: 1, irons: true, type, eyeDist, apertureR, rearObj: rearIt?.obj || base.nodes?.rearSight || null, x0: rear.x });
    }
    const optNow = sights.find((s) => s.id === "optic")?.label || null;
    const i = sights.findIndex((s) => s.id === prev);
    st.sightIdx = i >= 0 && optNow === lastOptic ? i : 0;
    lastOptic = optNow;
    if (sights[st.sightIdx]?.id === "magnifier" && st.magAside) st.sightIdx = 0;
  }
  const f = base.focus || { center: [0, 0, 0], size: 900 };
  const controls = new OrbitControls(S.camera, S.renderer.domElement);
  controls.target.set(f.center[0] / 1e3, GUN_Y + f.center[1] / 1e3, f.center[2] / 1e3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.maxDistance = 3.5;
  controls.mouseButtons = { LEFT: THREE8.MOUSE.ROTATE, MIDDLE: THREE8.MOUSE.DOLLY, RIGHT: null };
  const orbitHome = () => {
    S.camera.position.set(controls.target.x - 0.2, controls.target.y + 0.17, controls.target.z + f.size / 1e3 * 1.75);
    controls.update();
  };
  orbitHome();
  const focusTarget = new THREE8.Vector3().copy(controls.target);
  const homeTarget = controls.target.clone();
  let focusDist = null;
  const orbitPose = { pos: new THREE8.Vector3(), quat: new THREE8.Quaternion(), fov: 38 };
  const baseFov = 38;
  function sightPose(out) {
    const s = sights[st.sightIdx];
    if (!s) return null;
    let ex = base.eyeX ?? -240;
    if (s.eyeRelief) ex = s.eye.x - s.eyeRelief;
    else if (s.irons) ex = s.type === "aperture" ? s.eye.x - (s.eyeDist ?? 75) : Math.min(ex, s.eye.x - 220);
    else if (!s.irons) ex = Math.min(ex, s.eye.x - 60);
    const t = (ex - s.eye.x) / (s.dir.x || 1);
    const eyeGun = s.eye.clone().addScaledVector(s.dir, t);
    const m = new THREE8.Matrix4().makeScale(1e-3, 1e-3, 1e-3);
    out.pos.copy(eyeGun).applyMatrix4(m);
    const right = new THREE8.Vector3().crossVectors(s.dir, s.up || Y_UP).normalize();
    const up = new THREE8.Vector3().crossVectors(right, s.dir);
    const back = s.dir.clone().negate();
    out.quat.setFromRotationMatrix(new THREE8.Matrix4().makeBasis(right, up, back));
    const mag = s.zoom ? st.zoom : s.mag;
    out.fov = s.irons ? baseFov * 0.78 : baseFov / Math.max(1, mag) * (mag > 1 ? 1 : 0.88);
    out.mag = mag;
    out.s = s;
    return out;
  }
  const tmp = new THREE8.Vector3(), tmp2 = new THREE8.Vector3(), tq = new THREE8.Quaternion(), mzTmp = new THREE8.Vector3();
  function muzzleWorld(out, dir) {
    const mz = asm.mounts.get("muzzle");
    const len = asm.info("muzzle")?.muzzle?.x || 0;
    if (mz) mz.localToWorld(out.set(len, 0, 0));
    else gun.localToWorld(out.set(...base.muzzle || [400, 0, 0]));
    if (dir) dir.set(1, 0, 0).transformDirection(gun.matrixWorld).normalize();
    return out;
  }
  function canFire() {
    return st.mode !== "safe" && !st.busy;
  }
  const PUMP = def.action === "pump";
  const TUBE = def.feed === "tube";
  function roundsVisible() {
    const mi = asm.info("mag")?.mag;
    if (mi?.rounds) mi.rounds.visible = st.mag > 0;
  }
  function fireOnce() {
    const now = performance.now() / 1e3;
    if (!st.chambered) {
      audio.dryFire();
      st.held = false;
      if (ui) ui.toast(PUMP ? st.mag > 0 ? "Передёрните цевьё (T)" : "Магазин пуст — зарядить (R)" : st.magIn ? "Патронник пуст — перезарядка (R)" : "Нет магазина");
      return false;
    }
    st.lastShot = now;
    audio.shot();
    const mzInfo = asm.info("muzzle")?.muzzle;
    const kind = mzInfo ? mzInfo.kind : def.bareKind || "bare";
    const pos = muzzleWorld(new THREE8.Vector3(), tmp2);
    fx.muzzleFlash(pos, tmp2.clone(), kind, def.flashSize ?? FLASH[def.cal] ?? 1);
    const ammo = asm.info("ammo")?.ammo || def.ammo || {};
    const pellets = ammo.pellets || 1;
    const spreadMoa = (st.stats.moa || 1.5) + Math.min(st.burst, 10) * 0.7 * (st.stats.recoilV || 100) / 100 + (st.ads ? 0 : def.hipMoa ?? 60);
    // дробь: диаметр осыпи задаёт чок (сужение дульца) и сам патрон
    const pattern = pellets > 1 ? (ammo.pattern || 90) * (mzInfo?.pattern ?? 1) : 0;
    let hitSteel = 0, hitDist = 0, thumped = false;
    for (let i = 0; i < pellets; i++) {
      const sp = spreadMoa / 60 * D2R2 * 0.5;
      const dir = tmp2.clone();
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * pattern / 60 * D2R2 * 0.5;
      dir.y += (Math.random() - 0.5) * 2 * sp + Math.sin(a) * rr;
      dir.z += (Math.random() - 0.5) * 2 * sp + Math.cos(a) * rr;
      dir.normalize();
      const rc = new THREE8.Raycaster(pos, dir, 0.05, 400);
      const hit = rc.intersectObjects(S.range.hitables, false)[0];
      if (!hit) continue;
      const surf = hit.object.userData.surface || "dirt";
      setTimeout(() => fx.impact(hit, surf), hit.distance / (st.stats.velocity || 850) * 1e3);
      if (surf === "steel") {
        S.range.hit(hit.object.userData.target, (HIT[def.cal] ?? 2.5) * (ammo.energy ?? 1) / Math.sqrt(pellets));
        hitSteel++;
        hitDist = hit.distance;
      } else if (!thumped) {
        audio.thump(hit.distance);
        thumped = true;
      }
    }
    if (hitSteel) audio.ding(hitDist, Math.min(1.3, 0.6 + hitSteel * 0.12));
    cycleAction();
    const K = def.kick ?? KICK[def.cal] ?? 0.8;
    const kick = K * (ammo.recoil ?? 1) * (st.stats.recoilV || 100) / 100 * (st.bipod ? 0.45 : 1);
    const side = K * 0.5 * (st.stats.recoilH || 100) / 100 * (st.bipod ? 0.4 : 1);
    st.rec.vp += kick * 60 * (0.85 + Math.random() * 0.3);
    st.rec.vy += (Math.random() - 0.45) * side * 55;
    st.rec.vz += kick * 1.6;
    st.climb += kick * 0.55 * D2R2;
    st.burst++;
    if (PUMP) {
      // помповое ружьё: стреляная гильза остаётся в патроннике до передёргивания цевья
      st.chambered = false;
      st.spent = true;
      if (def.autoPump !== false) {
        st.busy = true;
        setTimeout(() => pump(() => {
          st.busy = false;
          ui?.hud();
        }), 170);
      }
    } else if (st.magIn && st.mag > 0) {
      st.mag--;
      st.chambered = true;
    } else {
      st.chambered = false;
      if (base.anim?.holdOpen !== false && def.boltHold !== false && st.magIn) st.holdOpen = true;
    }
    roundsVisible();
    if (ui) ui.hud();
    return true;
  }
  function ejectShell(live = false) {
    const ej = base.eject;
    if (!ej) return;
    const p = gun.localToWorld(new THREE8.Vector3(...ej.p));
    const d = new THREE8.Vector3(...ej.dir).normalize().transformDirection(gun.matrixWorld);
    const v = live ? d.multiplyScalar(1.5) : d.multiplyScalar((ej.speed ?? 3.2) + Math.random() * 1.2).add(new THREE8.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.6, 0));
    gun.getWorldQuaternion(tq);
    fx.shell(p, v, def.cal, tq, live);
    if (!live) fx.portSmoke(p, d);
  }
  function cycleAction() {
    const tr = base.nodes?.trigger;
    const cyc = 60 / (def.base.rpm || 700);
    if (tr) {
      tr.rotation.z = -(base.anim?.triggerAngle ?? 0.16);
      tw.add(tr.rotation, "z", 0, PUMP ? 0.25 : cyc * 0.9);
    }
    const ham = base.nodes?.hammer;
    if (ham) {
      ham.rotation.z = 0;
    }
    if (PUMP) return;
    const car = base.nodes?.carrier;
    const travel = base.anim?.carrierTravel || 80;
    if (car) {
      tw.add(car.position, "x", -travel, cyc * 0.32, (t) => 1 - (1 - t) * (1 - t), () => {
        if (!st.chambered && st.holdOpen) return;
        tw.add(car.position, "x", 0, cyc * 0.45, (t) => t * t);
      });
    }
    const pc = base.anim?.portCover;
    if (pc && pc.rotation.x < 1) tw.add(pc.rotation, "x", 1.9, 0.08, (t) => 1 - (1 - t) * (1 - t));
    if (base.eject) setTimeout(() => ejectShell(false), cyc * 300);
  }
  // Цикл помпы: цевьё с затвором назад (выброс гильзы/патрона), вперёд (подача из трубки).
  function pump(done) {
    const fe = base.nodes?.forend, car = base.nodes?.carrier;
    const travel = base.anim?.pumpTravel || 95;
    audio.pumpBack();
    if (fe) tw.add(fe.position, "x", -travel, 0.14, ease);
    if (car) tw.add(car.position, "x", -travel, 0.14, ease);
    setTimeout(() => {
      if (st.spent || st.chambered) ejectShell(!st.spent);
      st.spent = false;
      st.chambered = false;
      ui?.hud();
    }, 110);
    setTimeout(() => {
      audio.pumpForward();
      if (fe) tw.add(fe.position, "x", 0, 0.12, ease);
      if (car) tw.add(car.position, "x", 0, 0.12, ease);
      setTimeout(() => {
        if (st.mag > 0) {
          st.mag--;
          st.chambered = true;
        }
        ui?.hud();
        setTimeout(() => done && done(), 90);
      }, 90);
    }, 210);
  }
  function magNode() {
    return asm.installed.get("mag")?.obj || null;
  }
  function magMount() {
    return asm.mounts.get("magwell")?.userData.mount || {};
  }
  function dropMag(done) {
    const m = magNode();
    if (!m || !st.magIn) {
      done && done();
      return;
    }
    const kind = magKind();
    audio.magOut(kind);
    const rock = magMount().rock;
    const fall = () => {
      tw.add(m.position, "y", -420, 0.42, (t) => t * t, () => {
        m.visible = false;
        m.position.y = 0;
        m.rotation.z = 0;
        audio.magDropGround(kind);
      });
      st.magIn = false;
      // СВД: затвор на задержке держит подаватель магазина — без магазина он уходит вперёд
      if (st.holdOpen && def.holdByFollower) {
        setTimeout(() => {
          audio.boltSlam();
          const car = base.nodes?.carrier;
          if (car) tw.add(car.position, "x", 0, 0.06, (t) => t * t);
          st.holdOpen = false;
          ui?.hud();
        }, 120);
      }
      if (ui) ui.hud();
      setTimeout(() => done && done(), 380);
    };
    if (rock) tw.add(m.rotation, "z", rock[2] * D2R2, 0.16, ease, fall);
    else fall();
  }
  function insertMag(done) {
    const m = magNode();
    if (!m) {
      done && done();
      return;
    }
    m.visible = true;
    m.position.y = -300;
    const rock = magMount().rock;
    m.rotation.z = rock ? rock[2] * D2R2 : 0;
    const kind = magKind();
    st.mag = st.cap;
    roundsVisible();
    setTimeout(() => audio.magInsert(kind), 190);
    tw.add(m.position, "y", 0, 0.35, (t) => 1 - Math.pow(1 - t, 3), () => {
      const fin = () => {
        if (!rock) audio.magIn(kind);
        st.magIn = true;
        if (ui) ui.hud();
        setTimeout(() => done && done(), 150);
      };
      if (rock) {
        setTimeout(() => audio.magIn(kind), 90);
        tw.add(m.rotation, "z", 0, 0.14, ease, fin);
      } else fin();
    });
  }
  function release() {
    if (st.magIn && st.mag > 0 && !st.chambered) {
      st.mag--;
      st.chambered = true;
    }
    st.holdOpen = false;
    roundsVisible();
    if (ui) ui.hud();
  }
  // Рукоять/затвор назад; lock — оставить открытым (HK: рукоять в вырезе трубки).
  function chargeBack(lock, done) {
    const car = base.nodes?.carrier, hd = base.nodes?.handle;
    const ch = asm.installed.get("charger");
    const travel = base.anim?.carrierTravel || 80;
    audio.chargeBack();
    const chObj = ch?.obj;
    const chTravel = ch?.info?.charger?.travel || 0;
    if (car) tw.add(car.position, "x", -travel, 0.2, ease);
    if (chObj) tw.add(chObj.position, "x", -chTravel, 0.2, ease);
    if (hd) tw.add(hd.position, "x", -(base.anim?.handleTravel ?? travel), 0.2, ease);
    const wasChambered = st.chambered;
    setTimeout(() => {
      if (wasChambered) {
        ejectShell(true);
        st.chambered = false;
      }
      if (lock) {
        audio.hkLock();
        const r = base.anim?.handleLock;
        if (hd && r) tw.add(hd.rotation, "x", r * D2R2, 0.08, ease);
        st.handleLocked = true;
        ui?.hud();
      }
      done && done();
    }, lock ? 240 : 330);
  }
  function chargeForward(done) {
    const car = base.nodes?.carrier, hd = base.nodes?.handle;
    const ch = asm.installed.get("charger");
    audio.chargeRelease();
    if (hd && base.anim?.handleLock) hd.rotation.x = 0;
    if (car) tw.add(car.position, "x", 0, 0.07, (t) => t * t);
    if (hd) tw.add(hd.position, "x", 0, 0.07, (t) => t * t);
    if (ch?.obj) tw.add(ch.obj.position, "x", 0, 0.12, ease);
    st.handleLocked = false;
    release();
    setTimeout(() => done && done(), 200);
  }
  function charge(done) {
    if (PUMP) return pump(done);
    if (st.holdOpen && def.boltCatch !== false) {
      audio.boltCatch();
      release();
      const car = base.nodes?.carrier;
      if (car) tw.add(car.position, "x", 0, 0.06, (t) => t * t);
      setTimeout(() => done && done(), 250);
      return;
    }
    if (st.handleLocked) return chargeForward(done);
    chargeBack(false, () => chargeForward(done));
  }
  // Патроны по одному в подствольный магазин через окно снизу.
  function loadTube(done) {
    const sh = base.nodes?.loadShell;
    const step = () => {
      if (st.mag >= st.cap || st.trigger) {
        if (sh) sh.visible = false;
        return done && done();
      }
      audio.shellLoad();
      if (sh) {
        sh.visible = true;
        sh.position.set(-60, -70, 0);
        tw.add(sh.position, "y", 0, 0.12, ease);
        tw.add(sh.position, "x", 90, 0.3, (t) => t * t, () => sh.visible = false);
      }
      setTimeout(() => {
        st.mag++;
        ui?.hud();
        setTimeout(step, 170);
      }, 300);
    };
    step();
  }
  function reload() {
    if (st.busy || !asm.info("mag")) return;
    if ((TUBE || st.magIn) && st.mag >= st.cap && st.chambered) {
      ui?.toast(TUBE ? "Магазин полный" : "Магазин полный");
      return;
    }
    st.busy = true;
    st.trigger = false;
    if (ui) ui.hud();
    const fin = () => {
      st.busy = false;
      ui?.hud();
    };
    const after = () => {
      if (!st.chambered) charge(fin);
      else fin();
    };
    if (TUBE) {
      loadTube(() => !st.chambered && st.mag > 0 ? pump(fin) : fin());
      return;
    }
    if (def.reload === "hk" && !st.chambered && !st.handleLocked) {
      // HK: рукоять назад и в вырез → смена магазина → удар ладонью по рукояти
      chargeBack(true, () => setTimeout(() => dropMag(() => setTimeout(() => insertMag(() => setTimeout(() => chargeForward(fin), 120)), 250)), 150));
      return;
    }
    dropMag(() => setTimeout(() => insertMag(after), 250));
  }
  function toggleMag() {
    if (TUBE) {
      ui?.toast("Подствольный магазин не отстёгивается — R: зарядить");
      return;
    }
    if (st.busy || !asm.info("mag")) return;
    st.busy = true;
    if (st.magIn) dropMag(() => {
      st.busy = false;
      ui?.hud();
    });
    else insertMag(() => {
      st.busy = false;
      ui?.hud();
    });
  }
  function fireModes() {
    for (const it of asm.installed.values()) if (it.info?.modes) return it.info.modes;
    return def.modes;
  }
  function selectorAnim() {
    for (const it of asm.installed.values()) if (it.info?.selector) return it.info.selector;
    return { node: base.nodes?.selector, angles: base.anim?.selector, axis: base.anim?.selectorAxis };
  }
  function poseSelector(instant) {
    const sa = selectorAnim(), a = sa.angles?.[st.mode];
    if (!sa.node || a == null) return;
    const ax = sa.axis || "z";
    if (instant) sa.node.rotation[ax] = a * D2R2;
    else tw.add(sa.node.rotation, ax, a * D2R2, 0.12, ease);
  }
  function setMode(m) {
    st.mode = m;
    audio.selector();
    poseSelector(false);
    ui?.hud();
  }
  function cycleMode() {
    const ms = fireModes();
    setMode(ms[(ms.indexOf(st.mode) + 1) % ms.length]);
  }
  function setADS(on) {
    if (on && !sights.length) {
      ui?.toast("Нет прицельного приспособления");
      return;
    }
    if (on === st.ads) return;
    st.ads = on;
    if (on) {
      orbitPose.pos.copy(S.camera.position);
      orbitPose.quat.copy(S.camera.quaternion);
      controls.enabled = false;
      st.yaw = 0;
      st.pitch = 0;
      const s = sights[st.sightIdx];
      if (s?.zoom) st.zoom = clamp(st.zoom, s.zoom[0], s.zoom[1]);
    }
    audio.click();
    ui?.hud();
  }
  function cycleSight() {
    if (sights.length < 2) {
      ui?.toast(sights.length ? "Другого прицела нет" : "Нет прицела");
      return;
    }
    st.sightIdx = (st.sightIdx + 1) % sights.length;
    if (sights[st.sightIdx].id === "magnifier" && st.magAside) toggleMagnifier(false);
    ui?.toast("Прицел: " + sights[st.sightIdx].label);
    ui?.hud();
  }
  function toggleMagnifier(aside) {
    const mg = asm.installed.get("magnifier");
    if (!mg?.info?.flipAside) return;
    st.magAside = aside ?? !st.magAside;
    const fa = mg.info.flipAside;
    tw.add(fa.node.rotation, "x", st.magAside ? fa.angle * D2R2 : 0, 0.22, ease);
    audio.click();
    const mi = sights.findIndex((s) => s.id === "magnifier");
    if (st.magAside && sights[st.sightIdx]?.id === "magnifier") st.sightIdx = 0;
    else if (!st.magAside && mi >= 0) st.sightIdx = mi;
    ui?.hud();
  }
  /* ---------------------------------------------------------- батареи */
  // Каждый модуль с фонарём/ЛЦУ — своя батарея (у комбо-блоков общая на оба излучателя).
  // Время работы на полной мощности — 20…30 мин; стабилизированный драйвер держит яркость
  // до ≈15 % заряда, дальше свет садится, под конец мерцает и гаснет.
  const BATT_LS = "gunsmith:batt:" + def.id;
  try {
    Object.assign(st.batt, JSON.parse(localStorage.getItem(BATT_LS) || "{}"));
  } catch (e) {
  }
  function battKey(it) {
    return it.slotId + ":" + (it.part?.id || "base");
  }
  function lightSpec(it) {
    const d = it.data, lm = d.lumens || 500;
    const cd = d.cd ?? lm * 22;
    return {
      key: it.slotId + ":" + (it.part?.id || ""),
      lm,
      cd,
      hot: d.hot ?? (cd / lm > 28 ? 0.15 : 0.21),
      spill: d.spill ?? 0.085,
      angle: d.angle ?? 0.62,
      kelvin: d.kelvin ?? 6200,
      throw: Math.min(130, 2 * Math.sqrt(cd) * 0.45),
      lensR: (d.lensR ?? 11) / 1e3,
      batt: d.batt ?? (lm >= 1000 ? 21 : lm >= 600 ? 24 : 28)
    };
  }
  function laserBatt(it) {
    return it.data.batt ?? (it.info?.light ? 26 : 30);
  }
  function battLevel(c) {
    if (c <= 0) return 0;
    let v = c > 0.15 ? 1 : 0.2 + 0.8 * Math.pow(c / 0.15, 1.6);
    if (c < 0.04) v *= Math.random() < 0.12 ? 0.15 : 0.75 + Math.random() * 0.25;
    return v;
  }
  function lensGlow() {
    for (const l of lights) l.data.lens.material.emissiveIntensity = st.light ? 6 * battLevel(st.batt[battKey(l)] ?? 1) : 0;
    for (const l of lasers) l.data.lens.material.emissiveIntensity = st.laser ? 5 * battLevel(st.batt[battKey(l)] ?? 1) : 0;
  }
  let battSaveT = 0, battHudT = 0;
  function drainBatteries(dt) {
    if (!st.light && !st.laser) return;
    const used = new Map();
    if (st.light) for (const l of lights) used.set(battKey(l), (used.get(battKey(l)) || 0) + 1 / (lightSpec(l).batt * 60));
    if (st.laser) for (const l of lasers) used.set(battKey(l), (used.get(battKey(l)) || 0) + 1 / (laserBatt(l) * 60));
    let dead = false;
    for (const [k, rate] of used) {
      const before = st.batt[k] ?? 1;
      st.batt[k] = Math.max(0, before - rate * dt);
      if (before > 0 && st.batt[k] === 0) dead = true;
    }
    if (dead) {
      if (st.light && lights.every((l) => !(st.batt[battKey(l)] > 0))) {
        st.light = false;
        ui?.toast("Батарея фонаря села — U: заменить");
      }
      if (st.laser && lasers.every((l) => !(st.batt[battKey(l)] > 0))) {
        st.laser = false;
        ui?.toast("Батарея ЛЦУ села — U: заменить");
      }
      audio.click();
    }
    lensGlow();
    battSaveT += dt;
    battHudT += dt;
    if (battSaveT > 5) {
      battSaveT = 0;
      try {
        localStorage.setItem(BATT_LS, JSON.stringify(st.batt));
      } catch (e) {
      }
    }
    if (battHudT > 1 || dead) {
      battHudT = 0;
      ui?.hud();
    }
  }
  function battInfo() {
    const out = [];
    const seen = new Set();
    for (const [kind, list] of [["light", lights], ["laser", lasers]]) for (const l of list) {
      const k = battKey(l);
      const combo = seen.has(k);
      seen.add(k);
      if (combo) continue;
      const c = st.batt[k] ?? 1;
      const both = lights.some((x) => battKey(x) === k) && lasers.some((x) => battKey(x) === k);
      const min = kind === "light" ? lightSpec(l).batt : laserBatt(l);
      out.push({ label: both ? "Фонарь+ЛЦУ" : kind === "light" ? "Фонарь" : "ЛЦУ", pct: Math.round(c * 100), min: Math.round(c * min), on: kind === "light" ? st.light || (both && st.laser) : st.laser || (both && st.light) });
    }
    return out;
  }
  function replaceBatteries() {
    const all = [...lights, ...lasers];
    if (!all.length) {
      ui?.toast("Нет модулей с батареями");
      return;
    }
    for (const l of all) st.batt[battKey(l)] = 1;
    audio.batteryChange?.() ?? audio.click();
    try {
      localStorage.setItem(BATT_LS, JSON.stringify(st.batt));
    } catch (e) {
    }
    lensGlow();
    ui?.toast("Батареи заменены: CR123A, 100 %");
    ui?.hud();
  }
  function toggleLight() {
    if (!lights.length) {
      ui?.toast("Фонарь не установлен");
      return;
    }
    if (!st.light && lights.every((l) => !(st.batt[battKey(l)] > 0))) {
      audio.click();
      ui?.toast("Батарея фонаря разряжена — U: заменить");
      return;
    }
    st.light = !st.light;
    audio.tailcap?.(st.light) ?? audio.click();
    lensGlow();
    ui?.hud();
  }
  function toggleLaser() {
    if (!lasers.length) {
      ui?.toast("ЛЦУ не установлен");
      return;
    }
    if (!st.laser && lasers.every((l) => !(st.batt[battKey(l)] > 0))) {
      audio.click();
      ui?.toast("Батарея ЛЦУ разряжена — U: заменить");
      return;
    }
    st.laser = !st.laser;
    audio.click();
    lensGlow();
    ui?.hud();
  }
  /* ---------------------------------------------------------- время суток */
  const TIME_ORDER = ["day", "dusk", "night"], TIME_LABEL = { day: "День", dusk: "Сумерки", night: "Ночь" };
  function setTime(m) {
    S.setTime(m);
    fx.timeOfDay = m;
    try {
      localStorage.setItem("gunsmith:time", m);
    } catch (e) {
    }
    app?.invalidate?.();
    ui?.hud();
  }
  function cycleTime() {
    const m = TIME_ORDER[(TIME_ORDER.indexOf(S.time) + 1) % TIME_ORDER.length];
    setTime(m);
    audio.click();
    ui?.toast("Время суток: " + TIME_LABEL[m] + (m === "night" && !lights.length ? " — поставьте фонарь" : ""));
  }
  function toggleBipod() {
    const b = asm.withInfo("bipod")[0];
    if (!b) {
      ui?.toast("Сошки не установлены");
      return;
    }
    st.bipod = !st.bipod;
    for (const l of b.data.legs) tw.add(l.rotation, "z", st.bipod ? b.data.angle * D2R2 : 0, 0.3, ease);
    audio.bipod();
    ui?.hud();
  }
  function toggleFold() {
    const f2 = asm.withInfo("fold")[0];
    if (!f2) {
      ui?.toast("Приклад не складывается");
      return;
    }
    st.folded = !st.folded;
    const ax = f2.data.axis || "y";
    // телескопический приклад: сдвиг вдоль оси вместо поворота
    if (f2.data.slide) tw.add(f2.data.node.position, "x", st.folded ? f2.data.slide : 0, 0.3, ease);
    else tw.add(f2.data.node.rotation, ax, st.folded ? f2.data.angle * D2R2 : 0, 0.4, ease);
    audio.fold();
    ui?.hud();
  }
  function setPart(slotId, partId, pos) {
    const next = { ...cfg, [slotId]: partId ? { id: partId, pos: pos ?? (cfg[slotId]?.id === partId ? cfg[slotId].pos : null) } : null };
    const slotDef = def.slots.find((s) => s.id === slotId);
    const newPart = partId && asm.part(partId);
    if (newPart && slotDef?.behind && !asm.railPositions(slotDef, newPart, slotId).some((p) => !p.clash)) {
      const room = asm.roomBehind(slotDef, newPart);
      if (room) next[slotDef.behind] = { id: cfg[slotDef.behind].id, pos: { rail: room.rail, i: room.i } };
    }
    const before = JSON.stringify(cfg);
    applyConfig(next);
    const part = partId && asm.part(partId);
    if (part) {
      const slot2 = def.slots.find((s) => s.id === slotId);
      audio.attach(slot2?.mount === "muzzle" ? "thread" : /poly/.test(part.cat) ? "poly" : "rail");
    } else audio.click();
    const lost = def.slots.filter((s) => next[s.id]?.id && !cfg[s.id]).map((s) => asm.part(next[s.id].id)?.name).filter(Boolean);
    if (partId && !cfg[slotId]) ui?.toast("Не помещается: " + (asm.part(partId)?.name || ""));
    else if (lost.length && before !== JSON.stringify(cfg)) ui?.toast("Снято: " + lost.join(", "));
    saveCfg();
  }
  function railMove(slotId, dir) {
    const it = asm.installed.get(slotId);
    if (!it?.railPos) return;
    const slot2 = def.slots.find((s) => s.id === slotId);
    const ps = asm.railPositions(slot2, it.part, slotId).filter((p) => !p.clash);
    const i = ps.findIndex((p) => p.rail === it.railPos.rail && p.i === it.railPos.i);
    const n = ps[clamp(i + dir, 0, ps.length - 1)];
    if (!n || n === ps[i]) return;
    applyConfig({ ...cfg, [slotId]: { id: it.part.id, pos: { rail: n.rail, i: n.i } } });
    audio.click();
    saveCfg();
  }
  function railInfo(slotId) {
    const it = asm.installed.get(slotId);
    if (!it?.railPos) return null;
    const slot2 = def.slots.find((s) => s.id === slotId);
    const ps = asm.railPositions(slot2, it.part, slotId).filter((p) => !p.clash);
    const i = ps.findIndex((p) => p.rail === it.railPos.rail && p.i === it.railPos.i);
    return { i, n: ps.length };
  }
  const LS = "gunsmith:" + def.id;
  function saveCfg() {
    try {
      localStorage.setItem(LS, JSON.stringify(cfg));
    } catch (e) {
    }
  }
  function resetCfg() {
    applyConfig(def.defaults, { init: true });
    saveCfg();
    audio.click();
  }
  function focusSlot(slotId) {
    if (st.ads) return;
    const it = asm.installed.get(slotId);
    const slot2 = def.slots.find((s) => s.id === slotId);
    let obj = it?.obj;
    if (!obj) {
      const mid = slot2?.mount || slot2?.rails?.find((r) => asm.mounts.get(r));
      obj = mid && asm.mounts.get(mid);
    }
    if (!obj) {
      focusTarget.copy(homeTarget);
      focusDist = null;
      return;
    }
    const box2 = boundsOf(obj);
    if (box2.isEmpty()) obj.getWorldPosition(focusTarget);
    else box2.getCenter(focusTarget);
    focusDist = 0.55;
  }
  // Габарит модуля без сеток коллиматоров: плоскость сетки вынесена на 60 м вперёд
  // (так она не зависит от параллакса), и в Box3.setFromObject камера улетала за стрельбище.
  function boundsOf(obj) {
    const box2 = new THREE8.Box3(), b = new THREE8.Box3();
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.reticle || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box2.union(b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
    });
    return box2;
  }
  function unfocus() {
    focusTarget.copy(homeTarget);
    focusDist = null;
  }
  const pointer = { x: 0.5, y: 0.5 };
  const cvs = S.renderer.domElement;
  cvs.addEventListener("contextmenu", (e) => e.preventDefault());
  cvs.addEventListener("pointerdown", (e) => {
    audio.init();
    if (e.button === 2) {
      setADS(!st.ads);
      e.preventDefault();
      return;
    }
    if (e.button === 0 && st.ads) {
      triggerDown();
      e.preventDefault();
    }
  });
  addEventListener("pointerup", (e) => {
    if (e.button === 0) triggerUp();
  });
  cvs.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX / innerWidth;
    pointer.y = e.clientY / innerHeight;
    hover(e);
  });
  cvs.addEventListener("wheel", (e) => {
    if (!st.ads) return;
    const s = sights[st.sightIdx];
    if (s?.zoom) {
      st.zoom = clamp(st.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18), s.zoom[0], s.zoom[1]);
      ui?.hud();
    }
    e.preventDefault();
  }, { passive: false });
  cvs.addEventListener("click", (e) => {
    if (!st.ads && !dragged) pick(e);
  });
  let downAt = null, dragged = false;
  cvs.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
    dragged = false;
  });
  cvs.addEventListener("pointermove", (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) dragged = true;
  });
  function triggerDown() {
    audio.init();
    if (st.trigger) return;
    st.trigger = true;
    st.held = true;
    st.burst = 0;
    if (st.mode === "safe") {
      audio.click();
      ui?.toast("Предохранитель (X — режим огня)");
      return;
    }
    if (!canFire()) return;
    if (fireOnce()) {
      st.nextShot = performance.now() / 1e3 + 60 / (st.stats.rpm || def.base.rpm);
      if (st.mode === "burst") st.burstLeft = (def.burstN || 3) - 1;
    }
  }
  function triggerUp() {
    st.trigger = false;
    st.burst = 0;
  }
  const keys = {
    KeyR: reload,
    KeyX: cycleMode,
    KeyF: () => setADS(!st.ads),
    KeyV: cycleSight,
    KeyN: () => toggleMagnifier(),
    KeyC: toggleLight,
    KeyZ: toggleLaser,
    KeyL: cycleTime,
    KeyU: replaceBatteries,
    KeyB: toggleBipod,
    KeyK: toggleFold,
    KeyT: () => {
      if (!st.busy) {
        st.busy = true;
        charge(() => {
          st.busy = false;
          ui?.hud();
        });
      }
    },
    KeyM: toggleMag,
    Escape: () => setADS(false),
    KeyH: () => ui?.toggleHelp()
  };
  addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    audio.init();
    if (e.code === "Space") {
      if (!e.repeat) triggerDown();
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    const fn = keys[e.code];
    if (fn) {
      fn();
      e.preventDefault();
    }
  });
  addEventListener("keyup", (e) => {
    if (e.code === "Space") triggerUp();
  });
  const ray = new THREE8.Raycaster();
  let hoverT = 0;
  function partUnder(e) {
    const p = new THREE8.Vector2(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(p, S.camera);
    const hs = ray.intersectObject(gun, true);
    for (const h of hs) {
      if (!h.object.visible || h.object.userData.reticle) continue;
      let o = h.object;
      while (o && !o.userData.slotId && o !== gun) o = o.parent;
      if (o && o.userData.slotId) return o.userData;
      return { base: true };
    }
    return null;
  }
  function hover(e) {
    if (st.ads || e.buttons) {
      ui?.tip(null);
      return;
    }
    const now = performance.now();
    if (now - hoverT < 60) return;
    hoverT = now;
    const u = partUnder(e);
    if (u && u.partId) ui?.tip(asm.part(u.partId)?.name, e.clientX, e.clientY);
    else if (u && u.base) ui?.tip(def.title, e.clientX, e.clientY);
    else ui?.tip(null);
  }
  function pick(e) {
    const u = partUnder(e);
    if (u?.slotId) ui?.openSlot(u.slotId);
  }
  const adsPose = { pos: new THREE8.Vector3(), quat: new THREE8.Quaternion(), fov: baseFov };
  const clock = new THREE8.Clock();
  const camKick = new THREE8.Quaternion();
  const eulerTmp = new THREE8.Euler();
  function applyViewOffset() {
    const o = Math.round(st.viewOff || 0);
    if (o === lastViewOff) return;
    lastViewOff = o;
    camDirty = true;
    if (Math.abs(o) < 1) {
      if (S.camera.view) S.camera.clearViewOffset();
      return;
    }
    S.camera.setViewOffset(innerWidth, innerHeight, -o, 0, innerWidth, innerHeight);
  }
  let lastViewOff = null;
  addEventListener("resize", () => {
    lastViewOff = null;
  });
  let defocused = null;
  function restoreFocus() {
    defocused?.traverse((m) => {
      if (m.userData.sharpMat) {
        m.material.dispose();
        m.material = m.userData.sharpMat;
        delete m.userData.sharpMat;
      }
    });
    defocused = null;
  }
  function defocus(obj, k) {
    if (defocused && defocused !== obj) restoreFocus();
    if (!obj || k < 0.01) {
      if (defocused) restoreFocus();
      return;
    }
    defocused = obj;
    obj.traverse((m) => {
      if (!m.isMesh || m.userData.reticle) return;
      if (!m.userData.sharpMat) {
        m.userData.sharpMat = m.material;
        m.material = m.material.clone();
        m.material.transparent = true;
        m.material.depthWrite = false;
      }
      // глаз сфокусирован на мушке: близкий диоптр размыт и «просвечивает»
      m.material.opacity = 1 - 0.62 * k;
    });
  }
  // Диоптр вблизи глаза: глаз держит в фокусе мушку, барабан вокруг отверстия размыт.
  // Размытие — backdrop-filter по маске-кольцу, радиус отверстия считается из геометрии.
  const ghost = document.createElement("div");
  ghost.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:none";
  document.body.appendChild(ghost);
  let ghostKey = "";
  function ghostRing(p, k) {
    if (!p || k < 0.02) {
      if (ghostKey) ghost.style.opacity = "0", ghostKey = "";
      return;
    }
    const rh = p.s.apertureR ?? 1.8, d = (p.s.eyeDist ?? 75) + 0.5;
    const px = Math.atan(rh / d) / Math.tan(S.camera.fov * D2R2 / 2) * innerHeight / 2;
    const key = Math.round(px) + "|" + k.toFixed(2);
    if (key === ghostKey) return;
    ghostKey = key;
    const r0 = px * 0.92, r1 = px * 1.35;
    const m = `radial-gradient(circle at 50% 50%, transparent ${r0}px, #000 ${r1}px)`;
    ghost.style.backdropFilter = ghost.style.webkitBackdropFilter = `blur(${(9 * k).toFixed(1)}px) brightness(${(1 - 0.25 * k).toFixed(2)})`;
    ghost.style.maskImage = ghost.style.webkitMaskImage = m;
    ghost.style.opacity = String(Math.min(1, k * 1.2));
  }
  function update(dt) {
    tw.update(dt);
    const now = performance.now() / 1e3;
    if (st.burstLeft > 0 && st.mode === "burst" && now >= (st.nextShot || 0)) {
      if (st.chambered && canFire()) {
        fireOnce();
        st.nextShot = Math.max(now, st.nextShot || now) + 60 / (st.stats.rpm || def.base.rpm);
        st.burstLeft--;
      } else st.burstLeft = 0;
    }
    if (st.trigger && st.held && st.mode === "auto" && canFire() && st.chambered && now >= (st.nextShot || 0)) {
      fireOnce();
      st.nextShot = Math.max(now, st.nextShot || now) + 60 / (st.stats.rpm || def.base.rpm);
    }
    if (st.trigger && st.mode === "auto" && !st.chambered && st.held && now >= (st.nextShot || 0)) {
      audio.dryFire();
      st.held = false;
    }
    const r = st.rec;
    const k = 180, d = 20;
    r.vp += (-k * r.p - d * r.vp) * dt;
    r.p += r.vp * dt;
    r.vy += (-k * r.y - d * r.vy) * dt;
    r.y += r.vy * dt;
    r.vz += (-260 * r.z - 26 * r.vz) * dt;
    r.z += r.vz * dt;
    st.climb *= Math.pow(0.12, dt);
    if (st.ads) {
      const ty = -(pointer.x - 0.5) * 0.55, tp = -(pointer.y - 0.5) * 0.35;
      st.yaw = lerp(st.yaw, ty, 1 - Math.pow(1e-3, dt));
      st.pitch = lerp(st.pitch, tp, 1 - Math.pow(1e-3, dt));
    } else {
      st.yaw = lerp(st.yaw, 0, 1 - Math.pow(0.01, dt));
      st.pitch = lerp(st.pitch, 0, 1 - Math.pow(0.01, dt));
    }
    const cs = sights[st.sightIdx];
    const cant = st.adsT > 0 && cs?.up ? -Math.atan2(cs.up.z, cs.up.y) * ease(st.adsT) : 0;
    aim.rotation.set(cant, st.yaw, st.pitch + st.climb, "YZX");
    rig.position.set(-r.z * 1e-3 * 12 + pivotX * 0, 0, 0);
    rig.rotation.set(0, r.y * D2R2 * 0.6, r.p * D2R2 * 0.5);
    rig.position.x -= pivotX * (Math.cos(r.p * D2R2 * 0.5) - 1);
    rig.position.y = -pivotX * Math.sin(r.p * D2R2 * 0.5);
    st.adsT = clamp(st.adsT + (st.ads ? 1 : -1) * dt / ((st.stats.adsTime || 280) / 1e3 + 0.05), 0, 1);
    if (st.adsT > 0) {
      const p = sightPose(adsPose);
      if (p) {
        aim.updateMatrixWorld();
        const wpos = p.pos.clone().applyMatrix4(aim.matrixWorld);
        eulerTmp.set(0, r.y * D2R2 * 0.15, r.p * D2R2 * 0.22, "YZX");
        camKick.setFromEuler(eulerTmp);
        const wq = aim.getWorldQuaternion(new THREE8.Quaternion()).multiply(camKick).multiply(p.quat);
        const e = ease(st.adsT);
        S.camera.position.lerpVectors(orbitPose.pos, wpos, e);
        S.camera.quaternion.slerpQuaternions(orbitPose.quat, wq, e);
        S.camera.fov = lerp(baseFov, p.fov, e);
        st.viewOff = lerp(st.viewOff || 0, 0, e);
        applyViewOffset();
        S.camera.updateProjectionMatrix();
        const magnified = p.mag > 1.5 && st.adsT > 0.92;
        gun.visible = !magnified;
        ui?.scope(magnified ? p : null, st.adsT > 0.92 ? p : null);
        const nv = !!p.s.nv && !st.magAside && st.adsT > 0.85;
        ui?.nv(nv);
        for (const q of sights) if (q.hide) q.hide.visible = !(nv && q === p.s);
        ghostRing(p.s.irons && p.s.type === "aperture" ? p : null, e);
      }
      if (!st.ads && st.adsT === 0) {
        controls.enabled = true;
      }
    } else {
      if (S.camera.fov !== baseFov) {
        S.camera.fov = baseFov;
        S.camera.updateProjectionMatrix();
      }
      const off = ui ? ui.viewOffset() : 0;
      st.viewOff = lerp(st.viewOff || 0, off, 1 - Math.pow(0.01, dt));
      gun.visible = true;
      ui?.scope(null, null);
      ui?.nv(false);
      for (const q of sights) if (q.hide) q.hide.visible = true;
      if (defocused) restoreFocus();
      ghostRing(null, 0);
      controls.enabled = true;
      controls.target.lerp(focusTarget, 1 - Math.pow(0.02, dt));
      if (focusDist) {
        const off2 = S.camera.position.clone().sub(controls.target);
        const l = off2.length();
        if (Math.abs(l - focusDist) > 0.01) S.camera.position.copy(controls.target).addScaledVector(off2.normalize(), lerp(l, focusDist, 1 - Math.pow(0.05, dt)));
      }
      applyViewOffset();
      controls.update();
    }
    gun.updateMatrixWorld(true);
    drainBatteries(dt);
    if (lights.length && st.light) {
      const L = lights.find((l) => st.batt[battKey(l)] > 0) || lights[0];
      const p = L.obj.localToWorld(new THREE8.Vector3(...L.data.p));
      const dv = new THREE8.Vector3(1, 0, 0).transformDirection(L.obj.matrixWorld);
      fx.setLight(true, p, dv, lightSpec(L), battLevel(st.batt[battKey(L)] ?? 1), S.beamK ?? 0.06, S.camera);
    } else fx.setLight(false);
    if (lasers.length && st.laser) {
      const L = lasers.find((l) => st.batt[battKey(l)] > 0) || lasers[0];
      const p = L.obj.localToWorld(new THREE8.Vector3(...L.data.p));
      const dv = new THREE8.Vector3(1, 0, 0).transformDirection(L.obj.matrixWorld);
      fx.setLaserLevel(battLevel(st.batt[battKey(L)] ?? 1), S.beamK ?? 0.06);
      fx.setLaser(true, p, dv, S.range.hitables, L.data.color ?? 16722458);
    } else fx.setLaser(false);
    fx.update(dt, (s, n) => audio.casing(0, s.kind, n > 1 ? 0.35 : 0.8), S.camera, fx.heat > 0.3 ? muzzleWorld(mzTmp) : null);
    S.range.update(dt);
  }
  const app = {
    def,
    asm,
    st,
    S,
    gun,
    rig,
    aim,
    fx,
    audio,
    mats,
    get cfg() {
      return cfg;
    },
    get sights() {
      return sights;
    },
    setPart,
    railMove,
    railInfo,
    resetCfg,
    focusSlot,
    unfocus,
    triggerDown,
    triggerUp,
    reload,
    cycleMode,
    setADS,
    cycleSight,
    toggleMagnifier,
    toggleLight,
    toggleLaser,
    replaceBatteries,
    battInfo,
    cycleTime,
    setTime,
    get time() {
      return S.time;
    },
    timeLabel: () => TIME_LABEL[S.time],
    toggleBipod,
    toggleFold,
    toggleMag,
    charge: () => keys.KeyT(),
    toggleSound: () => {
      audio.init();
      audio.setMuted(!audio.muted);
      ui?.hud();
    },
    defaultStats: null
  };
  let start = def.defaults;
  try {
    const sv = JSON.parse(localStorage.getItem(LS) || "null");
    if (sv) start = { ...def.defaults, ...sv };
  } catch (e) {
  }
  const qs = new URLSearchParams(location.search);
  if (qs.get("cfg")) {
    try {
      start = { ...def.defaults, ...JSON.parse(qs.get("cfg")) };
    } catch (e) {
      console.error("cfg", e);
    }
  }
  {
    let tm = qs.get("time");
    try {
      tm = tm || localStorage.getItem("gunsmith:time");
    } catch (e) {
    }
    S.setTime(TIME_ORDER.includes(tm) ? tm : "day");
  }
  applyConfig(def.defaults, { init: true });
  app.defaultStats = { ...st.stats };
  applyConfig(start, { init: true });
  poseSelector(true);
  ui = new UI(app);
  ui.refresh();
  const setView = (v, zoom = 1) => {
    const t = controls.target, dd = f.size / 1e3 * 1.25 / zoom;
    const V = { right: [0, 0.05, 1], left: [0, 0.05, -1], top: [0, 1, 1e-3], front: [1, 0.1, 0.02], back: [-1, 0.1, 0.02], iso: [-0.5, 0.35, 0.8], isoL: [-0.5, 0.35, -0.8], under: [0, -1, 1e-3] }[v] || [-0.15, 0.13, 1];
    const l = Math.hypot(...V);
    S.camera.position.set(t.x + V[0] / l * dd, t.y + V[1] / l * dd, t.z + V[2] / l * dd);
    controls.update();
  };
  if (qs.get("at")) {
    const a = qs.get("at").split(",").map(Number);
    controls.target.set(a[0] / 1e3, GUN_Y + a[1] / 1e3, (a[2] || 0) / 1e3);
    focusTarget.copy(controls.target);
    homeTarget.copy(controls.target);
  }
  if (qs.get("view") || qs.get("zoom") || qs.get("at")) setView(qs.get("view"), +(qs.get("zoom") || 1));
  if (qs.get("ads")) {
    setADS(true);
    st.adsT = 1;
  }
  if (qs.get("ui") === "0") document.body.classList.add("noui");
  app.setView = setView;
  const bootEl = document.getElementById("boot");
  if (bootEl) bootEl.classList.add("off");
  window.__app = app;
  const R4 = S.renderer;
  R4.shadowMap.autoUpdate = false;
  R4.shadowMap.needsUpdate = true;
  let camDirty = true, sceneDirty = true, idleT = 0;
  controls.addEventListener("change", () => {
    camDirty = true;
  });
  addEventListener("resize", () => {
    camDirty = true;
    sceneDirty = true;
  });
  app.invalidate = () => {
    sceneDirty = true;
  };
  const maxDpr = Math.min(devicePixelRatio || 1, 2);
  const minDpr = Math.max(0.6, maxDpr * 0.55);
  let activeDpr = maxDpr, curDpr = maxDpr, fts = [], ftT = 0, slowStreak = 0;
  const bootT = performance.now();
  const gunPrev = new THREE8.Matrix4();
  const setDpr = (v) => {
    if (Math.abs(v - curDpr) < 0.01) return;
    curDpr = v;
    R4.setPixelRatio(v);
    R4.setSize(innerWidth, innerHeight);
  };
  function simBusy() {
    const r = st.rec;
    if (st.ads || st.adsT > 0 || st.trigger || st.busy || st.burstLeft || st.light || st.laser || tw.list.length || fx.active()) return true;
    if (Math.abs(r.p) + Math.abs(r.y) + Math.abs(r.z) + Math.abs(r.vp) + Math.abs(r.vy) + Math.abs(r.vz) > 1e-3 || st.climb > 1e-4) return true;
    for (const t of S.range.targets) if (Math.abs(t.userData.vel) + Math.abs(t.userData.swing) > 1e-4) return true;
    return false;
  }
  function adapt(raw) {
    if (performance.now() - bootT < 3e3) return;
    if (raw < 0.25) fts.push(raw);
    ftT += raw;
    if (ftT < 1.5 || fts.length < 10) return;
    fts.sort((a, b) => a - b);
    const med = fts[fts.length >> 1];
    fts = [];
    ftT = 0;
    let next = activeDpr;
    if (med > 1 / 40) {
      slowStreak++;
      next = Math.max(minDpr, activeDpr * (med > 1 / 25 ? 0.8 : 0.9));
    } else {
      slowStreak = 0;
      if (med < 1 / 55) next = Math.min(maxDpr, activeDpr * 1.1);
    }
    if (slowStreak >= 3 && activeDpr <= minDpr + 1e-3 && S.sun.shadow.mapSize.x > 1024) {
      S.sun.shadow.mapSize.set(1024, 1024);
      S.sun.shadow.map?.dispose();
      S.sun.shadow.map = null;
      R4.shadowMap.needsUpdate = true;
    }
    activeDpr = next;
  }
  app.quality = () => ({ activeDpr, curDpr, maxDpr, shadow: S.sun.shadow.mapSize.x });
  const loop = () => {
    requestAnimationFrame(loop);
    if (window.__pause) return;
    const raw = clock.getDelta();
    const dt = Math.min(raw, 0.05);
    update(dt);
    const busy = simBusy();
    const active = busy || camDirty;
    idleT = active ? 0 : idleT + raw;
    const still = !active && idleT > 0.35 && curDpr !== maxDpr;
    if (!active && !sceneDirty && !still) return;
    if (active) {
      setDpr(activeDpr);
      adapt(raw);
    } else {
      setDpr(maxDpr);
      fts = [];
      ftT = 0;
    }
    gun.updateMatrixWorld();
    if (busy || sceneDirty || !gunPrev.equals(gun.matrixWorld)) R4.shadowMap.needsUpdate = true;
    gunPrev.copy(gun.matrixWorld);
    camDirty = false;
    sceneDirty = false;
    R4.render(S.scene, S.camera);
  };
  loop();
  return app;
}


