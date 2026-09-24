// src/engine/ui.js
var STATS = [
  { k: "weight", l: "Масса", u: "кг", f: (v) => (v / 1e3).toFixed(2), better: -1 },
  { k: "length", l: "Длина", u: "мм", f: (v) => Math.round(v), better: -1 },
  { k: "ergo", l: "Эргономика", f: (v) => Math.round(v), better: 1, bar: 100 },
  { k: "recoilV", l: "Отдача вертикальная", f: (v) => Math.round(v), better: -1, bar: 160 },
  { k: "recoilH", l: "Отдача горизонтальная", f: (v) => Math.round(v), better: -1, bar: 160 },
  { k: "moa", l: "Кучность", u: "MOA", f: (v) => v.toFixed(1), better: -1 },
  { k: "velocity", l: "Начальная скорость", u: "м/с", f: (v) => Math.round(v), better: 1 },
  { k: "loud", l: "Громкость выстрела", u: "дБ", f: (v) => Math.round(v), better: -1 },
  { k: "flash", l: "Заметность вспышки", f: (v) => Math.max(0, Math.round(v)), better: -1, bar: 100 },
  { k: "adsTime", l: "Вскидка", u: "мс", f: (v) => Math.round(v), better: -1 },
  { k: "mag", l: "Магазин", u: "патр.", f: (v) => Math.round(v), better: 1 }
];
var CHIP = { "recoilV%": "отдача", "recoilH%": "увод", ergo: "эрг.", loud: "дБ", weight: "г", adsTime: "мс", flash: "вспышка", moa: "MOA", velocity: "м/с", mag: "патр.", length: "мм" };
var CHIP_BETTER = { "recoilV%": -1, "recoilH%": -1, ergo: 1, loud: -1, weight: -1, adsTime: -1, flash: -1, moa: -1, velocity: 1, mag: 1, length: -1 };
var MODE = { safe: "ПРЕДОХР.", semi: "ОДИНОЧНЫЙ", auto: "АВТО", burst: "ОЧЕРЕДЬ", pump: "ПОМПА" };
var el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
var esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
var UI = class {
  constructor(app) {
    this.app = app;
    this.open = null;
    const d = app.def;
    const root = this.root = el("div", "ui");
    document.body.appendChild(root);
    const left = el("div", "col-left");
    this.card = el("div", "panel card", `<div class="c-name">${esc(d.short || d.title)}</div><div class="c-sub">${esc(d.title)} · ${esc(d.caliber)}</div>
      <div class="c-spec">${(d.specs || []).map(([a, b]) => `<span>${esc(a)}</span><b>${esc(b)}</b>`).join("")}</div>`);
    this.stats = el("div", "panel stats");
    left.append(this.card, this.stats);
    this.mods = el("div", "panel mods");
    this.modsHead = el("div", "m-head", `<span>Модификация</span>`);
    const reset = el("button", "btn ghost sm", "Сброс");
    reset.onclick = () => {
      this.open = null;
      app.resetCfg();
    };
    this.modsHead.appendChild(reset);
    this.modsBody = el("div", "m-body");
    this.mods.append(this.modsHead, this.modsBody);
    const modsToggle = this.modsToggle = el("button", "btn mods-toggle", "Модификация");
    modsToggle.onclick = () => root.classList.toggle("show-mods");
    this.ammo = el("div", "panel ammo");
    this.bar = el("div", "panel bar");
    this.help = el("div", "panel help", `<div class="h-t">Управление</div>
      <div><kbd>Пробел</kbd>огонь (в прицеле — ЛКМ)</div><div><kbd>ПКМ</kbd><kbd>F</kbd>прицелиться</div>
      <div><kbd>R</kbd>перезарядка</div><div><kbd>X</kbd>режим огня</div><div><kbd>V</kbd>сменить прицел</div>
      <div><kbd>N</kbd>откинуть увеличитель</div><div><kbd>Колесо</kbd>кратность / зум</div>
      <div><kbd>C</kbd>фонарь</div><div><kbd>Z</kbd>ЛЦУ</div><div><kbd>U</kbd>заменить батареи</div><div><kbd>L</kbd>день / сумерки / ночь</div><div><kbd>B</kbd>сошки</div><div><kbd>K</kbd>приклад</div>
      <div><kbd>T</kbd>${esc(d.chargeLabel || "затвор")}</div>${d.feed === "tube" ? "" : "<div><kbd>M</kbd>магазин</div>"}<div><kbd>H</kbd>эта подсказка</div>
      <div class="h-n">Клик по детали — открыть её слот. Перетаскивание — вращение, колесо — масштаб.</div>`);
    this.helpBtn = el("button", "btn help-btn", "?");
    this.helpBtn.title = "Управление (H)";
    this.helpBtn.onclick = () => this.toggleHelp();
    this.toastEl = el("div", "toast");
    this.tipEl = el("div", "tip");
    this.scopeEl = el("div", "scope", '<div class="s-ret"></div>');
    this.nvEl = el("div", "nv-ov");
    this.adsHint = el("div", "ads-hint");
    const bottom = el("div", "bottom");
    bottom.append(this.ammo, this.bar, modsToggle, this.helpBtn);
    root.append(left, this.mods, bottom, this.help, this.toastEl, this.tipEl, this.nvEl, this.scopeEl, this.adsHint);
    this.buildBar();
    if (innerWidth > 900) root.classList.add("show-mods");
  }
  /* --------------------------------------------------------------- панель */
  buildBar() {
    const a = this.app;
    const b = (id, label, fn, cls = "") => {
      const e = el("button", "btn " + cls, label);
      e.dataset.id = id;
      e.addEventListener("click", (ev) => {
        ev.preventDefault();
        a.audio.init();
        fn();
      });
      this.bar.appendChild(e);
      return e;
    };
    this.fireBtn = b("fire", "Огонь", () => {
    }, "fire");
    this.fireBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      a.triggerDown();
    });
    this.fireBtn.addEventListener("pointerup", () => a.triggerUp());
    this.fireBtn.addEventListener("pointerleave", () => a.triggerUp());
    this.btn = {
      reload: b("reload", a.def.feed === "tube" ? "Зарядить" : "Перезарядка", a.reload),
      mode: b("mode", "Режим", a.cycleMode),
      ads: b("ads", "Прицел", () => a.setADS(!a.st.ads)),
      sight: b("sight", "Сменить прицел", a.cycleSight),
      mag3: b("mag3", "Увеличитель", () => a.toggleMagnifier()),
      light: b("light", "Фонарь", a.toggleLight),
      laser: b("laser", "ЛЦУ", a.toggleLaser),
      bipod: b("bipod", "Сошки", a.toggleBipod),
      fold: b("fold", "Приклад", a.toggleFold),
      batt: b("batt", "Батареи", a.replaceBatteries),
      time: b("time", "День", a.cycleTime),
      sound: b("sound", "Звук", a.toggleSound, "icon")
    };
  }
  refresh() {
    this.renderMods();
    this.renderStats();
    this.hud();
  }
  slotAvailable(slot2) {
    const asm = this.app.asm;
    if (slot2.rails) return slot2.rails.some((r) => asm.mounts.has(r));
    return asm.mounts.has(slot2.mount);
  }
  // Можно ли поставить модуль сейчас; иначе — причина.
  canPut(slot2, part) {
    const asm = this.app.asm, cfg = this.app.cfg;
    if (part.needs && !part.needs(cfg, asm)) {
      if (part.cat === "magnifier") return "нужен коллиматор 1× с осью 39 мм";
      return "несовместимо с текущей сборкой";
    }
    if (slot2.rails) {
      const ps = asm.railPositions(slot2, part, slot2.id);
      if (!ps.length) return part.mountTypes?.includes("dovetail") ? "нужен «ласточкин хвост»" : "нет подходящей планки";
      if (!ps.some((p) => !p.clash) && !asm.roomBehind(slot2, part)) return "мешает: " + ps[0].clash;
    }
    return null;
  }
  renderMods() {
    const { def, asm, cfg } = this.app;
    const body = this.modsBody;
    const scroll = body.scrollTop;
    body.innerHTML = "";
    const groups = /* @__PURE__ */ new Map();
    const hiddenSlots = [];
    for (const slot2 of def.slots) {
      const opts = asm.slotOptions(slot2);
      if (!opts.length) continue;
      if (!this.slotAvailable(slot2)) {
        hiddenSlots.push(slot2.label);
        continue;
      }
      if (!groups.has(slot2.group)) groups.set(slot2.group, []);
      groups.get(slot2.group).push({ slot: slot2, opts });
    }
    for (const [g, list] of groups) {
      const ge = el("div", "m-group");
      ge.appendChild(el("div", "m-gt", esc(g)));
      for (const { slot: slot2, opts } of list) {
        const cur = cfg[slot2.id]?.id;
        const part = cur && asm.part(cur);
        const row = el("button", "m-row" + (this.open === slot2.id ? " open" : "") + (part ? "" : " empty"));
        row.innerHTML = `<span class="m-l">${esc(slot2.label)}</span><span class="m-v">${esc(part ? part.name : "нет")}</span><span class="m-c">${this.open === slot2.id ? "–" : "+"}</span>`;
        row.onclick = () => {
          this.open = this.open === slot2.id ? null : slot2.id;
          if (this.open) this.app.focusSlot(slot2.id);
          else this.app.unfocus();
          this.renderMods();
        };
        ge.appendChild(row);
        if (this.open === slot2.id) ge.appendChild(this.renderOptions(slot2, opts, cur));
      }
      body.appendChild(ge);
    }
    if (hiddenSlots.length) body.appendChild(el("div", "m-note", `Ещё слоты (${esc(hiddenSlots.join(", "))}) появятся после установки модулей с планками.`));
    body.scrollTop = scroll;
  }
  renderOptions(slot2, opts, cur) {
    const a = this.app;
    const box2 = el("div", "m-opts");
    const ri = cur && a.railInfo(slot2.id);
    if (ri && ri.n > 1) {
      const pos = el("div", "m-pos");
      const l = el("button", "btn sm", "◀"), r = el("button", "btn sm", "▶");
      const isStock = slot2.id === "stock";
      l.onclick = () => {
        a.railMove(slot2.id, isStock ? 1 : -1);
      };
      r.onclick = () => {
        a.railMove(slot2.id, isStock ? -1 : 1);
      };
      const label = isStock ? "Длина приклада" : "Положение на планке";
      const idx = isStock ? ri.n - ri.i : ri.i + 1;
      pos.append(el("span", "m-pl", label), l, el("b", "", `${idx} / ${ri.n}`), r);
      box2.appendChild(pos);
    }
    const item = (part) => {
      const on = (part ? part.id : null) === (cur || null);
      const why = part && !on ? this.canPut(slot2, part) : null;
      const e = el("button", "m-opt" + (on ? " on" : "") + (why ? " off" : ""));
      if (!part) {
        e.innerHTML = `<div class="o-n">Не устанавливать</div>`;
      } else {
        const chips = Object.entries(part.stats || {}).filter(([k, v]) => CHIP[k] && v && k !== "weight").slice(0, 4).map(([k, v]) => {
          const good = Math.sign(v) === CHIP_BETTER[k] || k === "mag";
          const txt = k.endsWith("%") ? `${v > 0 ? "+" : ""}${v}% ${CHIP[k]}` : `${v > 0 && k !== "mag" ? "+" : ""}${v} ${CHIP[k]}`;
          return `<i class="${k === "mag" ? "n" : good ? "g" : "b"}">${esc(txt)}</i>`;
        }).join("");
        const w = part.stats?.weight ? `<i class="n">${part.stats.weight} г</i>` : "";
        e.innerHTML = `<div class="o-n">${esc(part.name)}</div><div class="o-d">${esc(why ? "⚠ " + why : part.desc || "")}</div><div class="o-c">${chips}${w}</div>`;
      }
      e.disabled = !!why;
      e.onclick = () => {
        if (!on) a.setPart(slot2.id, part ? part.id : null);
      };
      box2.appendChild(e);
    };
    if (!slot2.required) item(null);
    for (const p of opts) item(p);
    return box2;
  }
  renderStats() {
    const s = this.app.st.stats, b = this.app.defaultStats || s;
    this.stats.innerHTML = '<div class="s-t">Характеристики</div>' + STATS.filter((d) => s[d.k] != null && !Number.isNaN(s[d.k])).map((d) => {
      const v = s[d.k], v0 = b[d.k] ?? v, diff = v - v0;
      const cls = Math.abs(diff) < 1e-6 ? "" : Math.sign(diff) === d.better ? "g" : "b";
      const bar = d.bar ? `<div class="s-bar"><i style="width:${Math.max(2, Math.min(100, v / d.bar * 100))}%"></i></div>` : "";
      const dd = Math.abs(diff) < 1e-6 ? "" : `<em>${diff > 0 ? "+" : "−"}${d.f(Math.abs(diff))}</em>`;
      return `<div class="s-r ${cls}"><span>${d.l}</span><b>${d.f(v)}${d.u ? `<small> ${d.u}</small>` : ""}${dd}</b>${bar}</div>`;
    }).join("");
  }
  hud() {
    const a = this.app, st = a.st;
    const key = [
      st.mag,
      st.magIn,
      st.chambered,
      st.cap,
      st.mode,
      st.busy,
      st.holdOpen,
      st.spent,
      st.handleLocked,
      st.ads,
      st.sightIdx,
      st.zoom.toFixed(2),
      st.magAside,
      st.light,
      st.laser,
      a.time,
      a.battInfo().map((b) => b.pct + (b.on ? "*" : "")).join(","),
      st.bipod,
      st.folded,
      a.audio.muted,
      a.sights.length,
      a.sights[st.sightIdx]?.label,
      a.asm.installed.size
    ].join("|");
    if (key === this.hudKey && this.lastStats === st.stats && this.hudCfg === a.cfg) return;
    this.hudKey = key;
    this.hudCfg = a.cfg;
    this.vo = null;
    const n = st.magIn ? st.mag : 0;
    const low = n + (st.chambered ? 1 : 0) <= Math.ceil(st.cap * 0.2);
    this.ammo.className = "panel ammo" + (low ? " low" : "");
    this.ammo.innerHTML = `<div class="a-n">${st.magIn ? n : "—"}${st.chambered ? "<sup>+1</sup>" : ""}<small>/${st.cap}</small></div>
      <div class="a-m"><b>${MODE[st.mode]}</b><span>${st.busy ? a.def.feed === "tube" ? "заряжание…" : "перезарядка…" : !st.magIn ? "нет магазина" : st.spent ? "передёрнуть цевьё" : !st.chambered ? "патронник пуст" : st.holdOpen ? a.def.id === "glock18c" ? "кожух на задержке" : "затвор на задержке" : st.handleLocked ? "рукоять в вырезе" : "готов"}</span></div>`;
    const bi = a.battInfo();
    if (bi.length) this.ammo.innerHTML += `<div class="a-batt">${bi.map((b) => `<div class="bt${b.on ? " on" : ""}${b.pct <= 15 ? " low" : ""}" title="${b.min} мин на полной мощности"><span>${b.label}</span><i><em style="width:${b.pct}%"></em></i><b>${b.pct}%</b></div>`).join("")}</div>`;
    const B = this.btn;
    B.mode.textContent = MODE[st.mode];
    B.time.textContent = a.timeLabel();
    B.batt.hidden = !bi.length || bi.every((b) => b.pct >= 100);
    B.ads.classList.toggle("on", st.ads);
    const multi = a.sights.length > 1;
    B.sight.hidden = !multi;
    const mgPart = a.asm.installed.get("magnifier");
    B.mag3.hidden = !mgPart;
    if (mgPart) B.mag3.textContent = mgPart.info?.sight?.nv ? "ПНВ" : "Увеличитель";
    B.mag3.classList.toggle("on", !st.magAside);
    B.light.hidden = !a.asm.withInfo("light").length;
    B.light.classList.toggle("on", st.light);
    B.laser.hidden = !a.asm.withInfo("laser").length;
    B.laser.classList.toggle("on", st.laser);
    B.bipod.hidden = !a.asm.withInfo("bipod").length;
    B.bipod.classList.toggle("on", st.bipod);
    B.fold.hidden = !a.asm.withInfo("fold").length;
    const slideStock = a.asm.withInfo("fold")[0]?.data.slide;
    B.fold.textContent = slideStock ? st.folded ? "Выдвинуть приклад" : "Задвинуть приклад" : st.folded ? "Разложить приклад" : "Сложить приклад";
    B.sound.textContent = a.audio.muted ? "Звук выкл" : "Звук вкл";
    B.sound.classList.toggle("off", a.audio.muted);
    B.reload.disabled = st.busy;
    const s = a.sights[st.sightIdx];
    this.adsHint.innerHTML = st.ads && s ? `<b>${esc(s.label)}</b>${s.zoom ? ` · ${st.zoom.toFixed(1)}×` : s.mag > 1 ? ` · ${s.mag}×` : ""}<span>ЛКМ — огонь · ПКМ — выйти${multi ? " · V — другой прицел" : ""}${s.zoom ? " · колесо — кратность" : ""}</span>` : "";
    this.adsHint.classList.toggle("on", !!(st.ads && s));
    this.root.classList.toggle("ads", st.ads);
    if (this.lastStats !== st.stats) {
      this.lastStats = st.stats;
      this.renderStats();
    }
  }
  // Ночной монокуляр: зелёный люминофор, круглое поле зрения.
  nv(on) {
    if (on === this.nvOn) return;
    this.nvOn = on;
    document.body.classList.toggle("nv", on);
  }
  scope(mag, ads) {
    const on = !!mag;
    if (on !== this.scopeOn || mag && mag.s.reticle !== this.scopeKind) {
      this.scopeOn = on;
      this.scopeEl.classList.toggle("on", on);
      if (on) {
        const kind = mag.s.withMag ? this.app.sights[0]?.reticle || "dot" : mag.s.reticle || "dot";
        this.scopeKind = mag.s.reticle;
        this.scopeEl.firstChild.innerHTML = reticleSVG(kind, mag.s.withMag ? mag.mag : 1);
      }
    }
  }
  openSlot(id) {
    this.root.classList.add("show-mods");
    this.open = id;
    this.app.focusSlot(id);
    this.renderMods();
    const r = this.modsBody.querySelector(".m-row.open");
    if (r) r.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  // Сдвиг центра кадра (px): середина между левой колонкой и меню.
  viewOffset() {
    const now = performance.now();
    if (this.vo && now - this.vo.t < 250 && this.vo.w === innerWidth) return this.vo.v;
    this.vo = { t: now, w: innerWidth, v: this.viewOffsetNow() };
    return this.vo.v;
  }
  viewOffsetNow() {
    if (innerWidth <= 900 || document.body.classList.contains("noui")) return 0;
    const cr = this.card.getBoundingClientRect(), mr = this.mods.getBoundingClientRect();
    const l = cr.width ? cr.right : 0;
    const r = mr.width ? innerWidth - mr.left : 0;
    return (l - r) / 2;
  }
  toggleHelp() {
    this.help.classList.toggle("on");
  }
  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("on");
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => this.toastEl.classList.remove("on"), 2200);
  }
  tip(text, x, y) {
    if (!text) {
      this.tipEl.classList.remove("on");
      return;
    }
    this.tipEl.textContent = text;
    this.tipEl.style.left = x + 14 + "px";
    this.tipEl.style.top = y + 14 + "px";
    this.tipEl.classList.add("on");
  }
};


