// src/engine/reticle.js
import * as THREE7 from "three";
var R3 = {
  dot: { field: 16, color: "#ff2a1a" },
  holo: { field: 96, color: "#ff2a1a" },
  kobra: { field: 60, color: "#ff2a1a" },
  chevron: { field: 60, color: "#ff3a20" },
  lpvo: { field: 140, color: "#ff2a1a" },
  pso1: { field: 360, color: "#ff5a1a" },
  mil: { field: 360, color: "#ff2a1a" }
};
function draw(kind, g, s, col) {
  const c = s / 2;
  const u = s / (R3[kind]?.field || 16);
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineCap = "round";
  const glow = (fn, blur) => {
    g.save();
    g.shadowColor = col;
    g.shadowBlur = blur;
    fn();
    g.restore();
  };
  if (kind === "dot") {
    glow(() => {
      g.beginPath();
      g.arc(c, c, 2.2 * u, 0, 7);
      g.fill();
    }, 3 * u);
  } else if (kind === "holo") {
    glow(() => {
      g.lineWidth = 1.4 * u;
      g.beginPath();
      g.arc(c, c, 34 * u, 0, 7);
      g.stroke();
      for (const a of [0, 90, 180, 270]) {
        const r = a * Math.PI / 180;
        g.beginPath();
        g.moveTo(c + Math.cos(r) * 34 * u, c + Math.sin(r) * 34 * u);
        g.lineTo(c + Math.cos(r) * 29 * u, c + Math.sin(r) * 29 * u);
        g.stroke();
      }
      g.beginPath();
      g.arc(c, c, 1.3 * u, 0, 7);
      g.fill();
    }, 1.5 * u);
  } else if (kind === "kobra") {
    glow(() => {
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.moveTo(c - 12 * u, c + 8 * u);
      g.lineTo(c, c + 1 * u);
      g.lineTo(c + 12 * u, c + 8 * u);
      g.stroke();
      g.beginPath();
      g.arc(c, c - 3 * u, 1.3 * u, 0, 7);
      g.fill();
      g.beginPath();
      g.moveTo(c, c - 22 * u);
      g.lineTo(c, c - 12 * u);
      g.stroke();
    }, 1.2 * u);
  } else if (kind === "chevron") {
    glow(() => {
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.moveTo(c - 3.5 * u, c + 5 * u);
      g.lineTo(c, c);
      g.lineTo(c + 3.5 * u, c + 5 * u);
      g.stroke();
    }, 1.2 * u);
    g.strokeStyle = "rgba(10,10,10,.9)";
    g.lineWidth = 0.6 * u;
    g.beginPath();
    g.moveTo(c, c + 6 * u);
    g.lineTo(c, c + 26 * u);
    g.stroke();
    for (let i = 1; i <= 4; i++) {
      const w = (6 - i) * 1.6 * u;
      g.beginPath();
      g.moveTo(c - w, c + (6 + i * 4.5) * u);
      g.lineTo(c + w, c + (6 + i * 4.5) * u);
      g.stroke();
    }
  } else if (kind === "lpvo") {
    g.strokeStyle = "rgba(10,10,10,.9)";
    g.lineWidth = 0.9 * u;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      g.beginPath();
      g.moveTo(c + dx * 34 * u, c + dy * 34 * u);
      g.lineTo(c + dx * 70 * u, c + dy * 70 * u);
      g.stroke();
    }
    g.lineWidth = 0.4 * u;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]]) {
      g.beginPath();
      g.moveTo(c + dx * 10 * u, c + dy * 10 * u);
      g.lineTo(c + dx * 34 * u, c + dy * 34 * u);
      g.stroke();
    }
    glow(() => {
      g.lineWidth = 1.2 * u;
      g.beginPath();
      g.arc(c, c, 18 * u, 0, 7);
      g.stroke();
      g.beginPath();
      g.arc(c, c, 1.2 * u, 0, 7);
      g.fill();
    }, 1.5 * u);
  } else if (kind === "mil") {
    g.strokeStyle = "rgba(10,10,10,.92)";
    g.fillStyle = "rgba(10,10,10,.92)";
    g.lineWidth = 3.2 * u;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) {
      g.beginPath();
      g.moveTo(c + dx * 100 * u, c + dy * 100 * u);
      g.lineTo(c + dx * 180 * u, c + dy * 180 * u);
      g.stroke();
    }
    g.lineWidth = 0.7 * u;
    g.beginPath();
    g.moveTo(c - 100 * u, c);
    g.lineTo(c + 100 * u, c);
    g.moveTo(c, c - 100 * u);
    g.lineTo(c, c + 100 * u);
    g.stroke();
    for (let i = -4; i <= 4; i++) if (i) for (const [x, y] of [[i * 20, 0], [0, i * 20]]) {
      g.beginPath();
      g.arc(c + x * u, c + y * u, 1.8 * u, 0, 7);
      g.fill();
    }
  } else if (kind === "pso1") {
    g.strokeStyle = col;
    g.lineWidth = 3 * u * 0.6;
    const ch = (x, y, k = 1) => {
      g.beginPath();
      g.moveTo(c + x - 6 * u * k, c + y + 8 * u * k);
      g.lineTo(c + x, c + y);
      g.lineTo(c + x + 6 * u * k, c + y + 8 * u * k);
      g.stroke();
    };
    glow(() => {
      ch(0, 0, 1.4);
      ch(0, 30 * u, 1);
      ch(0, 50 * u, 1);
      ch(0, 70 * u, 1);
      g.beginPath();
      g.moveTo(c - 110 * u, c);
      g.lineTo(c - 20 * u, c);
      g.moveTo(c + 20 * u, c);
      g.lineTo(c + 110 * u, c);
      g.stroke();
    }, 1.2 * u);
    g.lineWidth = 1.5 * u;
    for (let i = -10; i <= 10; i++) if (i) {
      g.beginPath();
      g.moveTo(c + i * 10 * u, c);
      g.lineTo(c + i * 10 * u, c - (i % 5 ? 4 : 8) * u);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c - 140 * u, c + 100 * u);
    g.lineTo(c - 60 * u, c + 100 * u);
    g.stroke();
    g.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = c - 140 * u + i * 4 * u, y = c + 100 * u - 60 * u / (1 + i * 0.35);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}
var cache = /* @__PURE__ */ new Map();
function reticleTexture(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const s = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = s;
  draw(kind, cv.getContext("2d"), s, R3[kind]?.color || "#ff2a1a");
  const t = new THREE7.CanvasTexture(cv);
  t.colorSpace = THREE7.SRGBColorSpace;
  cache.set(kind, t);
  return t;
}
function reticleMesh(kind, sight, ref, dist = 6e4) {
  const field = R3[kind]?.field || 16;
  const boost = kind === "dot" ? 3.4 : kind === "holo" || kind === "kobra" ? 1.25 : 1;
  const size = field * 0.2909 * (dist / 1e3) * boost;
  const m = new THREE7.Mesh(new THREE7.PlaneGeometry(size, size), new THREE7.MeshBasicMaterial({
    map: reticleTexture(kind),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    blending: kind === "chevron" || kind === "lpvo" || kind === "pso1" || kind === "mil" ? THREE7.NormalBlending : THREE7.AdditiveBlending,
    stencilWrite: true,
    stencilRef: ref,
    stencilFunc: THREE7.EqualStencilFunc,
    stencilFail: THREE7.KeepStencilOp,
    stencilZFail: THREE7.KeepStencilOp,
    stencilZPass: THREE7.KeepStencilOp
  }));
  m.rotation.y = -Math.PI / 2;
  m.position.set(dist, sight.y, sight.z || 0);
  m.renderOrder = 12;
  m.frustumCulled = false;
  m.userData.reticle = true;
  return m;
}
function reticleSVG(kind, zoom = 1) {
  const red = "#ff2d1c";
  const blk = "#0b0b0b";
  const glow = `<filter id="gl"><feGaussianBlur stdDeviation="1.2"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  if (kind === "chevron") {
    let bdc = "";
    for (let i = 1; i <= 5; i++) {
      const w = (6 - i) * 7;
      bdc += `<line x1="${-w}" y1="${22 + i * 20}" x2="${w}" y2="${22 + i * 20}" stroke="${blk}" stroke-width="1.6"/><text x="${w + 6}" y="${26 + i * 20}" font-size="9" fill="${blk}">${i + 3}</text>`;
    }
    return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs><line x1="0" y1="18" x2="0" y2="140" stroke="${blk}" stroke-width="1.6"/>${bdc}<path d="M-16 20 L0 0 L16 20" fill="none" stroke="${red}" stroke-width="4" filter="url(#gl)"/></svg>`;
  }
  if (kind === "lpvo") {
    return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs>
      <g stroke="${blk}"><line x1="-200" y1="0" x2="-60" y2="0" stroke-width="5"/><line x1="60" y1="0" x2="200" y2="0" stroke-width="5"/><line x1="0" y1="60" x2="0" y2="200" stroke-width="5"/><line x1="0" y1="-60" x2="0" y2="-200" stroke-width="5"/>
      <line x1="-60" y1="0" x2="-8" y2="0" stroke-width="1.2"/><line x1="60" y1="0" x2="8" y2="0" stroke-width="1.2"/><line x1="0" y1="8" x2="0" y2="60" stroke-width="1.2"/>
      ${[1, 2, 3, 4].map((i) => `<line x1="-5" y1="${i * 12}" x2="5" y2="${i * 12}" stroke-width="1"/>`).join("")}</g>
      <circle r="32" fill="none" stroke="${red}" stroke-width="1.8" filter="url(#gl)"/><circle r="2.2" fill="${red}" filter="url(#gl)"/></svg>`;
  }
  if (kind === "pso1") {
    let ticks = "";
    for (let i = -10; i <= 10; i++) if (i) ticks += `<line x1="${i * 12}" y1="0" x2="${i * 12}" y2="${i % 5 ? -5 : -10}" stroke="${blk}" stroke-width="1.4"/>`;
    let curve = "";
    for (let i = 0; i <= 20; i++) curve += `${i ? "L" : "M"}${-170 + i * 5} ${120 - 70 / (1 + i * 0.35)} `;
    return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs>
      <g stroke="${red}" stroke-width="3" fill="none" filter="url(#gl)"><path d="M-10 13 L0 0 L10 13"/><path d="M-7 45 L0 36 L7 45"/><path d="M-7 69 L0 60 L7 69"/><path d="M-7 93 L0 84 L7 93"/>
      <line x1="-140" y1="0" x2="-24" y2="0"/><line x1="24" y1="0" x2="140" y2="0"/></g>${ticks}
      <line x1="-170" y1="120" x2="-70" y2="120" stroke="${blk}" stroke-width="1.4"/><path d="${curve}" stroke="${blk}" stroke-width="1.4" fill="none"/>
      ${[2, 4, 6, 8, 10].map((n, i) => `<text x="${-168 + i * 22}" y="136" font-size="10" fill="${blk}">${n}</text>`).join("")}</svg>`;
  }
  if (kind === "mil") {
    let dots = "";
    for (let i = -4; i <= 4; i++) if (i) dots += `<circle cx="${i * 22}" r="2.6" fill="${blk}"/><circle cy="${i * 22}" r="2.6" fill="${blk}"/>`;
    return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs><g stroke="${blk}">
      <line x1="-200" y1="0" x2="-110" y2="0" stroke-width="6"/><line x1="110" y1="0" x2="200" y2="0" stroke-width="6"/>
      <line x1="0" y1="-200" x2="0" y2="-110" stroke-width="6"/><line x1="0" y1="110" x2="0" y2="200" stroke-width="6"/>
      <line x1="-110" y1="0" x2="110" y2="0" stroke-width="1"/><line x1="0" y1="-110" x2="0" y2="110" stroke-width="1"/></g>${dots}
      <circle r="1.6" fill="${red}" filter="url(#gl)"/></svg>`;
  }
  if (kind === "holo") return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs><circle r="${68 * zoom}" fill="none" stroke="${red}" stroke-width="2.6" filter="url(#gl)"/><circle r="${2.2 * zoom}" fill="${red}" filter="url(#gl)"/></svg>`;
  if (kind === "kobra") return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs><path d="M${-24 * zoom} ${16 * zoom} L0 ${2 * zoom} L${24 * zoom} ${16 * zoom}" stroke="${red}" stroke-width="2.6" fill="none" filter="url(#gl)"/><circle cy="${-6 * zoom}" r="${2.4 * zoom}" fill="${red}" filter="url(#gl)"/></svg>`;
  return `<svg viewBox="-200 -200 400 400"><defs>${glow}</defs><circle r="${Math.max(2.4, 3 * zoom)}" fill="${red}" filter="url(#gl)"/></svg>`;
}


