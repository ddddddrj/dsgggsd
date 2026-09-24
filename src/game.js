/* ============================================================================
   ANGAR-07 · ALPHA vs DELTA — весь код карты в одном файле.
   Порядок разделов: ядро → текстуры → материалы → сборка геометрии → физика
   (Bullet/ammo.js) → эффекты и звук → разрушаемость → огонь → ангар → свет →
   здание → реквизит → расстановка баз → игрок → оружие → команды → запуск.
   Библиотека ammo.js (Bullet) и её wasm вшиты в конце файла.
============================================================================ */
import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// Ядро: утилиты, профиль качества, рендерер, сцена, камера, небо, окружение.
const $ = s => document.querySelector(s);
window.__angarBoot = true;
const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
const lerp = (a,b,t)=> a+(b-a)*t;
const smoothstep = (a,b,x)=>{ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
let SEED = 20260920;
const srnd = ()=>{ SEED = (SEED*1664525 + 1013904223) >>> 0; return SEED/4294967296; };
const sr = (a,b)=> a + srnd()*(b-a);
const si = (a,b)=> Math.floor(sr(a,b+1));
// Второй генератор — для добавленных эффектов и дверей: последовательность SEED,
// по которой расставлена карта, не сдвигается.
let _seed2 = 424242;
const rnd2 = ()=>{ _seed2 = (_seed2*1664525 + 1013904223) >>> 0; return _seed2/4294967296; };
/** Отложенные действия по игровому времени: на паузе они тоже стоят
    (setTimeout срабатывал бы, пока открыто меню). */
const TIMERS = [];
const later = (delay, fn)=>{ TIMERS.push({t: delay, fn}); };
function tickTimers(dt){
  for(let i=TIMERS.length-1;i>=0;i--){
    const tm = TIMERS[i]; tm.t -= dt;
    if(tm.t <= 0){ TIMERS[i] = TIMERS[TIMERS.length-1]; TIMERS.pop(); tm.fn(); }
  }
}

/* ============================================================================
   УРОВНИ КАЧЕСТВА
   Карта должна открываться и на слабой машине. Профиль выбирается сам по
   числу ядер, памяти и строке GPU, но его всегда можно задать через ?q=.
============================================================================ */
const QPRESETS = {
  low: {
    pixelRatio:1.0, shadow:1024, shadowFar:120, ao:false, bloom:false, smaa:false,
    tex:0.5, dust:900, lights:4, spots:2, shafts:0.35, props:0.55, debris:120,
    anisotropy:2, softShadow:false, cloth:0.45, target:45, minPR:0.6
  },
  med: {
    pixelRatio:1.25, shadow:2048, shadowFar:150, ao:false, bloom:true, smaa:true,
    tex:0.75, dust:2200, lights:5, spots:3, shafts:0.7, props:0.8, debris:260,
    anisotropy:4, softShadow:true, cloth:0.7, target:50, minPR:0.7
  },
  high: {
    pixelRatio:1.5, shadow:3072, shadowFar:170, ao:true, bloom:true, smaa:true,
    tex:1.0, dust:4200, lights:6, spots:4, shafts:1.0, props:1.0, debris:420,
    anisotropy:8, softShadow:true, cloth:1.0, target:55, minPR:0.8
  },
  ultra: {
    pixelRatio:1.75, shadow:4096, shadowFar:190, ao:true, bloom:true, smaa:true,
    tex:1.0, dust:6000, lights:8, spots:4, shafts:1.0, props:1.0, debris:600,
    anisotropy:16, softShadow:true, cloth:1.0, target:58, minPR:0.9
  }
};
/** Грубая оценка класса машины. Строку GPU достаём одноразовым контекстом:
    программный рендерер (SwiftShader/llvmpipe) обязан получить профиль low. */
function autoQuality(){
  let gpu = '';
  try{
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if(dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)||'');
    else if(gl) gpu = String(gl.getParameter(gl.RENDERER)||'');
  }catch(e){}
  const soft = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(gpu);
  if(soft) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if(mobile || cores <= 4 || mem <= 4) return 'low';
  if(cores <= 8 || mem <= 8) return 'med';
  const strong = /rtx|radeon rx (6|7|9)|apple m[1-9]|arc a7/i.test(gpu);
  return strong ? 'ultra' : 'high';
}
const QPARAM = new URLSearchParams(location.search).get('q');
const QNAME = QPRESETS[QPARAM] ? QPARAM : autoQuality();
const Q = QPRESETS[QNAME];
/** Разрешение процедурных текстур подстраивается под профиль: на low карты
    вдвое меньше, а рисунок остаётся тем же. */
const TS = n => Math.max(128, Math.round(n*Q.tex/64)*64);

/* ============================================================================
   РЕНДЕРЕР
============================================================================ */
/** Ошибка загрузки: вместо бесконечной «Загрузки…» — понятное сообщение. */
function fatal(title, detail){
  if(window.__angarFatal) window.__angarFatal(title, detail);
  const e = new Error(title); e.angarShown = true; return e;
}
function createRenderer(){
  let probe = null;
  try{ const c = document.createElement('canvas'); probe = c.getContext('webgl2'); }catch(e){}
  if(!probe) throw fatal('WebGL 2 недоступен',
    'Браузер не смог создать контекст WebGL 2. Включите аппаратное ускорение (chrome://settings/system), обновите драйвер видеокарты или откройте карту в свежем Chrome / Edge / Firefox.');
  probe.getExtension('WEBGL_lose_context')?.loseContext();
  try{ return new THREE.WebGLRenderer({antialias:false, powerPreference:'high-performance', stencil:false}); }
  catch(e){ throw fatal('Не удалось создать WebGL-контекст', String(e && e.message || e)); }
}
const renderer = createRenderer();
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = Q.softShadow ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
// Тень пересчитывается не каждый кадр, а только когда солнце заметно сдвинулось.
renderer.shadowMap.autoUpdate = false;
// AgX мягко сворачивает пересветы (кровля, проёмы) и не заливает тени в ноль,
// как ACES с последующим контрастом. Выбор меняется в настройках.
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
// счётчик вызовов отрисовки — за весь кадр (все проходы), а не за последний проход
renderer.info.autoReset = false;
renderer.domElement.addEventListener('webglcontextlost', e=>{
  e.preventDefault();
  fatal('Видеокарта сбросила WebGL-контекст', 'Обычно это перегрев или нехватка видеопамяти. Перезагрузите страницу; при повторении выберите ?q=low.');
});
document.body.appendChild(renderer.domElement);
/* ============================================================================
   ОБЪЁМ ЗАТЕНЕНИЯ И ОТСКОКА (запекается при загрузке, в кадре — 2 выборки)
   Рассеянный свет (небо, остекление, отражения) раньше был одинаковым везде:
   в комнате дома так же светло, как посреди ангара, углы не темнеют — отсюда
   «мучная», плоская картинка. Теперь две 3D-текстуры:
   L (1 м) — доля открытых направлений в радиусе 9 м и доля тех, что упёрлись
   в дерево (тёплый отскок от OSB); S (0.5 м) — контактное затенение в
   радиусе 1.5 м (стыки стен и пола, под столами, за укрытиями).
   Оба множителя действуют только на рассеянный свет и отражения окружения:
   солнце и лампы по-прежнему дают свои тени.
============================================================================ */
const AVOL_BOX = { x0:-40, y0:-0.5, z0:-30, sx:80, sy:8, sz:60 };
const AVOL_U = {
  uAVolL: { value: null }, uAVolS: { value: null },
  // простые объекты с x/y/z (не Vector3): общие для всех материалов, не клонируются
  uAVolMin: { value: { x:AVOL_BOX.x0, y:AVOL_BOX.y0, z:AVOL_BOX.z0 } },
  uAVolInv: { value: { x:1/AVOL_BOX.sx, y:1/AVOL_BOX.sy, z:1/AVOL_BOX.sz } },
  // x — сила объёма (0 — выключен), y — сила тёплого отскока, z — контакт, w — затенение отражений
  uAVolK:   { value: { x:1, y:1, z:1, w:1 } }
};
/** Высотный туман: плотнее у пола, у кровли реже; цвет с подсветкой со стороны солнца. */
const FOG_U = {
  uFogH:   { value: { x:0.0, y:5.5, z:0.35, w:0.92 } },     // x — отметка, y — масштаб высоты, z — доля ровной дымки, w — предел
  uFogSun: { value: { r:0, g:0, b:0 } },
  uFogSunDir: { value: { x:0, y:1, z:0 } }
};
function neutralVolume(){
  const t = new THREE.Data3DTexture(new Uint8Array([255, 255, 0, 0]), 1, 1, 1);
  t.format = THREE.RGFormat; t.needsUpdate = true; return t;
}
(function patchShaders(){
  const neutral = neutralVolume();
  AVOL_U.uAVolL.value = neutral; AVOL_U.uAVolS.value = neutral;
  const C = THREE.ShaderChunk;
  C.lights_pars_begin = C.lights_pars_begin + `
#ifdef USE_AVOL
  uniform sampler3D uAVolL, uAVolS;
  uniform vec3 uAVolMin, uAVolInv;
  uniform vec4 uAVolK;
#endif`;
  C.lights_fragment_end = `
#ifdef USE_AVOL
  {
    // мировые позиция и нормаль из видовых (обратное жёсткое преобразование)
    mat3 avR = mat3(viewMatrix);
    vec3 avW = (-vViewPosition - viewMatrix[3].xyz) * avR;
    vec3 avN = normal * avR;
    vec2 avL = texture(uAVolL, (avW + avN*0.55 - uAVolMin)*uAVolInv).rg;
    float avS = texture(uAVolS, (avW + avN*0.3 - uAVolMin)*uAVolInv).r;
    float avOpen = mix(1.0, avL.x, uAVolK.x);
    float avOcc = mix(1.0, avS, uAVolK.z);
    // закрытые направления не чёрные: они отражают тот же рассеянный свет (≈0.2)
    float avVis = (avOpen + (1.0 - avOpen)*0.2) * avOcc;
    vec3 avBounce = vec3(0.64, 0.46, 0.27) * dot(irradiance + iblIrradiance, vec3(0.2126, 0.7152, 0.0722))
                  * avL.y * 0.42 * uAVolK.y * avOcc;
    irradiance = irradiance*avVis + avBounce;
    iblIrradiance *= avVis;
    // отражения неба и остекления не должны светиться в глухих комнатах и в углах
    radiance *= mix(1.0, avVis*avVis, uAVolK.w);
  }
#endif
` + C.lights_fragment_end;
  // туман: высотный + ровная дымка, путь считается от камеры до точки
  C.fog_pars_vertex = `#ifdef USE_FOG\n  varying vec3 vFogWorld;\n#endif\n`;
  C.fog_vertex = `#ifdef USE_FOG\n  vFogWorld = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);\n#endif\n`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying vec3 vFogWorld;
  uniform vec4 uFogH; uniform vec3 uFogSun, uFogSunDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif\n`;
  C.fog_fragment = `#ifdef USE_FOG
  {
    vec3 fr = vFogWorld - cameraPosition; float fd = max(length(fr), 1e-3);
    #ifdef FOG_EXP2
      float fH = uFogH.y, fy = fr.y/fH;
      float fk = abs(fy) > 1e-3 ? (1.0 - exp(-fy))/fy : 1.0;
      float od = fogDensity*fd*(exp(-(cameraPosition.y - uFogH.x)/fH)*fk*(1.0 - uFogH.z) + uFogH.z);
      float fogFactor = min(1.0 - exp(-od), uFogH.w);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fd);
    #endif
    vec3 fCol = fogColor + uFogSun*pow(max(dot(fr/fd, uFogSunDir), 0.0), 6.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fCol, fogFactor);
  }
#endif\n`;
  for(const id of ['standard', 'physical']){
    const L = THREE.ShaderLib[id];
    Object.assign(L.uniforms, AVOL_U);
    L.fragmentShader = '#define USE_AVOL\n' + L.fragmentShader;
  }
  for(const id in THREE.ShaderLib){
    const L = THREE.ShaderLib[id];
    if(L.uniforms && L.uniforms.fogColor) Object.assign(L.uniforms, FOG_U);
  }
})();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.04, 400);
const skyUniforms = {
  uTop:     {value: new THREE.Color(0x7d9fc4)},
  uMid:     {value: new THREE.Color(0xc3d0de)},
  uBot:     {value: new THREE.Color(0x9a9186)},
  uSunDir:  {value: new THREE.Vector3(0,1,0)},
  uSunCol:  {value: new THREE.Color(0xfff2dc)},
  uSunSize: {value: 0.0016},
  uHaze:    {value: 0.35},
  uStars:   {value: 0.0},
  uMoonDir: {value: new THREE.Vector3(0,-1,0)},
  uMoon:    {value: 0.0}
};
function buildSky(){
  const mat = new THREE.ShaderMaterial({
    side:THREE.BackSide, fog:false, depthWrite:false, uniforms:skyUniforms,
    vertexShader:`
      varying vec3 vDir;
      void main(){ vDir = normalize(position);
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader:`
      uniform vec3 uTop,uMid,uBot,uSunCol,uSunDir,uMoonDir;
      uniform float uSunSize,uHaze,uStars,uMoon;
      varying vec3 vDir;
      // дешёвый хеш для звёздного поля: настоящая текстура тут не нужна
      float hash(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419));
        p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(uMid, uTop, pow(clamp(h,0.0,1.0), 0.62))
                           : mix(uMid, uBot, pow(clamp(-h,0.0,1.0), 0.45));
        // зарево вокруг солнца: усиливается у горизонта, откуда и берётся закат
        float sd = max(dot(d, uSunDir), 0.0);
        float horizonBoost = 1.0 - smoothstep(0.0, 0.42, abs(uSunDir.y));
        col += uSunCol * pow(sd, 6.0) * (0.22 + 0.85*horizonBoost) * uHaze;
        col += uSunCol * pow(sd, 220.0) * 0.55;
        // диск солнца
        float disk = smoothstep(1.0-uSunSize, 1.0-uSunSize*0.35, sd);
        col = mix(col, uSunCol*2.4, disk * smoothstep(-0.10, 0.02, uSunDir.y));
        if(uStars > 0.001){
          vec3 sp = floor(d*260.0);
          float r = hash(sp);
          float star = smoothstep(0.9975, 0.99995, r) * smoothstep(-0.05, 0.25, h);
          col += vec3(0.85,0.90,1.0) * star * uStars * (0.6 + 0.4*hash(sp+7.0));
        }
        if(uMoon > 0.001){
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.82,0.86,1.0) * pow(md, 900.0) * uMoon * 2.2;
          col += vec3(0.42,0.50,0.70) * pow(md, 9.0) * uMoon * 0.16;
        }
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), mat);
  dome.name='sky'; dome.frustumCulled = false;
  scene.add(dome);
}
function cv$1(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c, c.getContext('2d',{willReadFrequently:true})]; }
function buildEnvironment(){
  // ширина = 4 × размер грани будущей кубокарты: PMREM обоих окружений одного
  // размера, и подмена на снятое из ангара не перекомпилирует материалы
  const EW = (Q.tex >= 0.75 ? 256 : 128)*4, EH = EW/2;
  const [c,x] = cv$1(EW, EH); x.scale(EW/256, EH/128);
  // верх — свет из кровли, середина — стены ангара, низ — бетонный пол
  const g = x.createLinearGradient(0,0,0,128);
  g.addColorStop(0.00, '#cfd8e2');
  g.addColorStop(0.34, '#a8a49b');
  g.addColorStop(0.52, '#7d786f');
  g.addColorStop(0.72, '#6b665e');
  g.addColorStop(1.00, '#514c45');
  x.fillStyle=g; x.fillRect(0,0,256,128);
  // яркие пятна — имитация световых проёмов и ленточных окон
  for(let i=0;i<9;i++){
    const px=Math.random()*256, py=Math.random()*26;
    const rg=x.createRadialGradient(px,py,1,px,py,26);
    rg.addColorStop(0,'rgba(255,250,238,.85)'); rg.addColorStop(1,'rgba(255,250,238,0)');
    x.fillStyle=rg; x.fillRect(px-26,py-26,52,52);
  }
  for(let i=0;i<14;i++){
    const px=Math.random()*256, py=38+Math.random()*10;
    x.fillStyle='rgba(226,234,242,.55)';
    x.fillRect(px, py, 16, 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose(); tex.dispose();
  scene.environment = env; BASE_ENV.tex = env;
}


const DEBUG = new URLSearchParams(location.search);
/** ?fast — облегчённые текстуры для автотестов и слабого железа. */
const TEXK = DEBUG.has('fast') ? 0.12 : 1;
const rnd = (a,b)=> a + Math.random()*(b-a);

// Процедурные текстуры: albedo + карта высот → normal / roughness / AO.
/* ============================================================================
   ПРОЦЕДУРНЫЕ ТЕКСТУРЫ: albedo + карта высот → normal + roughness
============================================================================ */
function cv(w,h){ const c=document.createElement('canvas'); c.width=w; c.height=h; return [c, c.getContext('2d',{willReadFrequently:true})]; }

/** Рисует fn 9 раз со сдвигами — результат бесшовный по обеим осям. */
function wrapDraw(x, size, fn){
  for(let ox=-1; ox<=1; ox++) for(let oy=-1; oy<=1; oy++){
    x.save(); x.translate(ox*size, oy*size); fn(); x.restore();
  }
}
function grain(x, w, h, amt){
  const img = x.getImageData(0,0,w,h), d = img.data;
  for(let i=0;i<d.length;i+=4){
    const n = (Math.random()-0.5)*amt*255;
    d[i]=clamp(d[i]+n,0,255); d[i+1]=clamp(d[i+1]+n,0,255); d[i+2]=clamp(d[i+2]+n,0,255);
  }
  x.putImageData(img,0,0);
}
/** Карта высот → AO: усреднённая окклюзия по окрестности, углубления темнее. */
function heightToAO(hc, power=1.0){
  const sz = hc.width, hx = hc.getContext('2d');
  const src = hx.getImageData(0,0,sz,sz).data;
  const [ac, ax] = cv(sz,sz);
  const out = ax.createImageData(sz,sz), o = out.data;
  const H = (x,y)=> src[(((y+sz)%sz)*sz + ((x+sz)%sz))*4] / 255;
  const R = 4;
  for(let y=0;y<sz;y++) for(let x=0;x<sz;x++){
    const h = H(x,y);
    let higher = 0, n = 0;
    for(let dy=-R; dy<=R; dy+=2) for(let dx=-R; dx<=R; dx+=2){
      if(!dx && !dy) continue;
      higher += Math.max(0, H(x+dx,y+dy) - h); n++;
    }
    const occ = clamp(1 - (higher/n)*5.0*power, 0, 1);
    const v = Math.round(clamp(0.35 + occ*0.65, 0, 1)*255);
    const i = (y*sz+x)*4;
    o[i]=o[i+1]=o[i+2]=v; o[i+3]=255;
  }
  ax.putImageData(out,0,0);
  return ac;
}
/** Карта высот (градации серого canvas) → нормаль-карта. */
function heightToNormal(hc, strength=2.0){
  const s = hc.width, hx = hc.getContext('2d');
  const src = hx.getImageData(0,0,s,s).data;
  const [nc, nx] = cv(s,s);
  const out = nx.createImageData(s,s), o = out.data;
  const H = (x,y)=> src[(((y+s)%s)*s + ((x+s)%s))*4] / 255;
  for(let y=0;y<s;y++) for(let x=0;x<s;x++){
    const dx = (H(x+1,y) - H(x-1,y)) * strength;
    const dy = (H(x,y+1) - H(x,y-1)) * strength;
    let nxv = -dx, nyv = -dy, nzv = 1;
    const l = Math.hypot(nxv,nyv,nzv);
    const i = (y*s+x)*4;
    o[i]   = (nxv/l*0.5+0.5)*255;
    o[i+1] = (nyv/l*0.5+0.5)*255;
    o[i+2] = (nzv/l*0.5+0.5)*255;
    o[i+3] = 255;
  }
  nx.putImageData(out,0,0);
  return nc;
}
// Анизотропия ограничена профилем: на слабой видеокарте она заметно
// дороже, чем выигрыш в резкости косых поверхностей.
const MAXA = ()=> Math.min(renderer.capabilities.getMaxAnisotropy(), Q.anisotropy);
function T(canvas, rx=1, ry=1, srgb=true){
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx,ry);
  t.anisotropy = MAXA();
  if(srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- OSB: стружка, уложенная слоями ---------- */
function osbMaps(size=1024, tint=1){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Текстура покрывает ~1.22 м (ширина листа) → 1 px ≈ 1.2 мм.
  // Реальная щепа ОСП: длина 50-150 мм, ширина 10-25 мм → 40-125 px x 8-20 px.
  x.fillStyle = `rgb(${212*tint|0},${183*tint|0},${133*tint|0})`; x.fillRect(0,0,size,size);
  hx.fillStyle = '#6a6a6a'; hx.fillRect(0,0,size,size);
  rx.fillStyle = '#b8b8b8'; rx.fillRect(0,0,size,size);

  const layers = [
    {n:1400, a:()=>sr(0,6.283),                    w:[44,120], hgt:[9,19],  op:[.55,.85], hz:[0.30,0.48]},
    {n:1100, a:()=>sr(0,6.283),                    w:[50,132], hgt:[10,21], op:[.5,.82],  hz:[0.46,0.64]},
    // верхний слой ориентирован вдоль листа, но с широким разбросом ±35°
    {n:1500, a:()=>sr(-0.62,0.62) + (srnd()<0.18 ? 1.57 : 0), w:[56,148], hgt:[10,23], op:[.55,.88], hz:[0.62,0.84]}
  ];
  for(const L of layers){
    for(let i=0;i<L.n*TEXK;i++){
      const w = sr(L.w[0],L.w[1]), hh = sr(L.hgt[0],L.hgt[1]), a = L.a();
      const px = srnd()*size, py = srnd()*size;
      // Щепа берётся из разных частей ствола: светлая заболонь и тёмное ядро.
      const lum = sr(0.88, 1.08);
      const warm = sr(0.90, 1.04);
      const r = clamp(230*lum*tint, 0, 255)|0,
            g = clamp(198*lum*tint*warm, 0, 255)|0,
            b = clamp(144*lum*tint*warm*sr(0.95,1.04), 0, 255)|0;
      const op = sr(L.op[0], L.op[1]);
      const hv = Math.round(sr(L.hz[0], L.hz[1])*255);
      const rr = Math.min(hh*0.42, 5);
      const rv = si(140, 210);

      wrapDraw(x, size, ()=>{
        x.save(); x.translate(px,py); x.rotate(a);
        x.fillStyle = `rgba(${r},${g},${b},${op})`;
        x.beginPath(); x.roundRect(-w/2,-hh/2,w,hh, rr); x.fill();
        // продольные волокна древесины вдоль щепы
        x.strokeStyle = `rgba(${clamp(r*0.80,0,255)|0},${clamp(g*0.76,0,255)|0},${clamp(b*0.68,0,255)|0},.14)`;
        x.lineWidth = 0.7;
        const fib = 2 + Math.floor(hh/6);
        for(let k=1;k<fib;k++){
          const yy = -hh/2 + hh*k/fib;
          x.beginPath(); x.moveTo(-w/2+rr, yy); x.lineTo(w/2-rr, yy); x.stroke();
        }
        // тень по контуру: щепа лежит слоями, между ними видны зазоры
        x.strokeStyle = `rgba(${clamp(r*0.64,0,255)|0},${clamp(g*0.60,0,255)|0},${clamp(b*0.54,0,255)|0},.20)`;
        x.lineWidth = 0.8;
        x.beginPath(); x.roundRect(-w/2,-hh/2,w,hh, rr); x.stroke();
        x.restore();
      });
      wrapDraw(hx, size, ()=>{
        hx.save(); hx.translate(px,py); hx.rotate(a);
        hx.fillStyle = `rgba(${hv},${hv},${hv},${op})`;
        hx.beginPath(); hx.roundRect(-w/2,-hh/2,w,hh, rr); hx.fill();
        hx.strokeStyle = 'rgba(32,32,32,.55)'; hx.lineWidth = 1.3;
        hx.beginPath(); hx.roundRect(-w/2,-hh/2,w,hh, rr); hx.stroke();
        hx.restore();
      });
      wrapDraw(rx, size, ()=>{
        rx.save(); rx.translate(px,py); rx.rotate(a);
        rx.fillStyle = `rgba(${rv},${rv},${rv},${op*0.8})`;
        rx.beginPath(); rx.roundRect(-w/2,-hh/2,w,hh, rr); rx.fill();
        rx.strokeStyle = 'rgba(248,248,248,.55)'; rx.lineWidth = 1.4;
        rx.beginPath(); rx.roundRect(-w/2,-hh/2,w,hh, rr); rx.stroke();
        rx.restore();
      });
    }
  }
  // смоляные глянцевые пятна
  for(let i=0;i<110;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(20,120), al=sr(.05,.17);
    wrapDraw(x, size, ()=>{
      const g = x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(146,116,72,${al*0.8})`); g.addColorStop(1,'rgba(146,116,72,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g = rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(84,84,84,${al*2.8})`); g.addColorStop(1,'rgba(84,84,84,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // светлая древесная пыль в углублениях
  for(let i=0;i<150;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(10,58), v=si(186,214);
    wrapDraw(x, size, ()=>{
      const g = x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${v+22},${v+8},${v-18},${sr(.06,.15)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Бетонный пол ---------- */
function concreteMaps(size=768){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Промышленный бетон — нейтрально-серый с лёгкой тёплой примесью, не бежевый.
  x.fillStyle='#86837d'; x.fillRect(0,0,size,size);
  hx.fillStyle='#aaaaaa'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#e0e0e0'; rx.fillRect(0,0,size,size);
  // облачные пятна затирки
  for(let i=0;i<340;i++){
    const v = si(98,164);
    const px=srnd()*size, py=srnd()*size, r=sr(10,70), al=sr(.04,.16);
    wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-2},${v-7},${al})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
  }
  // мелкие каверны и щебень в высоте
  for(let i=0;i<2400;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(0.7,3.4);
    const dark = srnd()<0.5;
    const hv = dark ? si(120,150) : si(170,205);
    wrapDraw(hx, size, ()=>{ hx.fillStyle=`rgba(${hv},${hv},${hv},.6)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
    if(srnd()<0.35){
      const v = dark ? si(92,126) : si(146,176);
      wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-1},${v-4},.4)`;
        x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
    }
  }
  // масляные и грязевые разводы: тёмные и глянцевые
  for(let i=0;i<26;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(40,150), v=si(38,68), al=sr(.12,.30);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(${v},${v-1},${v+2},${al})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(74,74,74,${al*2.2})`); g.addColorStop(1,'rgba(74,74,74,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // затёртые до глянца проезды и пятна цементного молока
  for(let i=0;i<18;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(60,180);
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(168,168,168,${sr(.15,.4)})`); g.addColorStop(1,'rgba(168,168,168,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
    wrapDraw(x, size, ()=>{
      const v=si(150,178);
      const g=x.createRadialGradient(px,py,2,px,py,r);
      g.addColorStop(0,`rgba(${v},${v},${v-3},${sr(.04,.12)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  // трещины: ветвление с затуханием
  function crack(ctx, px,py,ang,len,w,col){
    ctx.strokeStyle=col; ctx.lineWidth=w; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(px,py);
    let cx=px, cy=py, a=ang;
    for(let j=0;j<len;j++){
      a += sr(-0.32,0.32); cx += Math.cos(a)*sr(5,13); cy += Math.sin(a)*sr(5,13);
      ctx.lineTo(cx,cy);
    }
    ctx.stroke();
    return [cx,cy,a];
  }
  for(let i=0;i<5;i++){
    const px=srnd()*size, py=srnd()*size, a=sr(0,6.28), w=sr(0.6,1.3);
    wrapDraw(x, size, ()=>{
      const [ex,ey,ea] = crack(x,px,py,a,9,w,'rgba(58,55,52,.34)');
      if(srnd()<0.6) crack(x,ex,ey,ea+sr(0.5,1.2),5,w*0.6,'rgba(58,55,52,.24)');
    });
    wrapDraw(hx, size, ()=>{
      const [ex,ey,ea] = crack(hx,px,py,a,9,w*1.3,'rgba(44,44,44,.7)');
      if(srnd()<0.6) crack(hx,ex,ey,ea+sr(0.5,1.2),5,w*0.8,'rgba(44,44,44,.5)');
    });
  }
  // Швы плит НЕ рисуем в текстуре: при тайлинге они дают регулярную решётку.
  // Вместо этого швы кладутся отдельной геометрией по границам плит пола.
  grain(x,size,size,0.035);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Пиломатериал каркаса ---------- */
function lumberMaps(size=512){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  // Сосновый брус: текстура кроется вдоль волокна, годовые слои идут полосами
  // разной плотности, между ними — тёмная поздняя древесина.
  x.fillStyle='#c9b48f'; x.fillRect(0,0,size,size);
  hx.fillStyle='#8c8c8c'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#cacaca'; rx.fillRect(0,0,size,size);

  // годовые слои: пары «ранняя светлая / поздняя тёмная» древесина
  let y = 0;
  while(y < size){
    const early = sr(16, 44);         // светлая широкая зона
    const late  = sr(1.4, 3.4);       // тёмная узкая зона
    const wob   = sr(6, 16);          // изгиб слоя по длине
    const phase = sr(0, 6.28);
    const lumE  = sr(0.94, 1.06);
    const lumL  = sr(0.76, 0.88);
    for(let px=0; px<size; px++){
      const off = Math.sin(px/size*Math.PI*2 + phase)*wob*0.35
                + Math.sin(px/size*Math.PI*6 + phase*2)*wob*0.12;
      // ранняя древесина
      const ye = y + off;
      x.fillStyle = `rgba(${clamp(214*lumE,0,255)|0},${clamp(189*lumE,0,255)|0},${clamp(146*lumE,0,255)|0},.85)`;
      x.fillRect(px, ye, 1, early);
      hx.fillStyle = `rgba(${clamp(176*lumE,0,255)|0},${clamp(176*lumE,0,255)|0},${clamp(176*lumE,0,255)|0},.8)`;
      hx.fillRect(px, ye, 1, early);
      rx.fillStyle = `rgba(${clamp(206*lumE,0,255)|0},${clamp(206*lumE,0,255)|0},${clamp(206*lumE,0,255)|0},.6)`;
      rx.fillRect(px, ye, 1, early);
      // поздняя древесина: темнее, плотнее, чуть ниже по высоте
      const yl = ye + early;
      x.fillStyle = `rgba(${clamp(168*lumL*1.15,0,255)|0},${clamp(134*lumL*1.15,0,255)|0},${clamp(92*lumL*1.15,0,255)|0},.8)`;
      x.fillRect(px, yl, 1, late);
      hx.fillStyle = `rgba(${clamp(96*lumL,0,255)|0},${clamp(96*lumL,0,255)|0},${clamp(96*lumL,0,255)|0},.85)`;
      hx.fillRect(px, yl, 1, late);
      rx.fillStyle = 'rgba(146,146,146,.55)';
      rx.fillRect(px, yl, 1, late);
    }
    y += early + late;
  }
  // тонкие волокна поверх слоёв — придают дереву «ворс»
  for(let i=0;i<size*1.1;i++){
    const yy = srnd()*size, len = sr(size*0.2, size), x0 = srnd()*size;
    const v = si(160, 215), a = sr(.03,.09);
    x.strokeStyle = `rgba(${v},${(v*0.86)|0},${(v*0.64)|0},${a})`;
    x.lineWidth = sr(0.5, 1.4);
    x.beginPath();
    x.moveTo(x0, yy);
    x.bezierCurveTo(x0+len*0.33, yy+sr(-2.5,2.5), x0+len*0.66, yy+sr(-2.5,2.5), x0+len, yy+sr(-3,3));
    x.stroke();
  }
  // сучки: тёмные овалы с расходящимися вокруг волокнами
  for(let i=0;i<5;i++){
    const px=srnd()*size, py=srnd()*size, rr=sr(6,15), ry=rr*sr(0.45,0.75);
    wrapDraw(x, size, ()=>{
      // волокна обтекают сучок
      x.strokeStyle='rgba(126,96,54,.28)'; x.lineWidth=1.1;
      for(let k=0;k<7;k++){
        const o = (k-3)*rr*0.5;
        x.beginPath();
        x.moveTo(px-rr*3.4, py+o);
        x.quadraticCurveTo(px, py+o*sr(1.5,2.4), px+rr*3.4, py+o);
        x.stroke();
      }
      const g=x.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(74,48,24,.95)'); g.addColorStop(.62,'rgba(104,70,36,.78)');
      g.addColorStop(1,'rgba(128,92,52,0)');
      x.fillStyle=g; x.beginPath(); x.ellipse(px,py,rr,ry,sr(0,3),0,7); x.fill();
    });
    wrapDraw(hx, size, ()=>{
      const g=hx.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(54,54,54,.9)'); g.addColorStop(1,'rgba(140,140,140,0)');
      hx.fillStyle=g; hx.beginPath(); hx.ellipse(px,py,rr,ry,0,0,7); hx.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,rr);
      g.addColorStop(0,'rgba(108,108,108,.8)'); g.addColorStop(1,'rgba(108,108,108,0)');
      rx.fillStyle=g; rx.beginPath(); rx.ellipse(px,py,rr,ry,0,0,7); rx.fill();
    });
  }
  // следы пилы и заводская маркировка-штамп
  for(let i=0;i<8;i++){
    const yy=srnd()*size;
    x.strokeStyle=`rgba(${si(160,196)},${si(140,172)},${si(110,140)},.07)`;
    x.lineWidth=sr(1.5,4);
    x.beginPath(); x.moveTo(0,yy); x.lineTo(size,yy+sr(-3,3)); x.stroke();
  }
  // серые потёртости и грязь от рук/опалубки
  for(let i=0;i<70;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(10,54), v=si(120,168);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${v},${v-6},${v-20},${sr(.05,.16)})`); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${si(150,210)},${si(150,210)},${si(150,210)},${sr(.08,.26)})`);
      g.addColorStop(1,'rgba(0,0,0,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Профлист (стены и кровля ангара) ---------- */
function corrugatedMaps(size=512, rust=0.5, base=[118,112,104], ribs=7){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  rx.fillStyle='#8a8a8a'; rx.fillRect(0,0,size,size);
  for(let i=0;i<size;i++){
    // Трапециевидный профиль: широкая полка, наклонная стенка, узкая канавка.
    const t = (i/size*ribs) % 1;
    let prof;                                   // 0 = дно канавки, 1 = верх полки
    if(t < 0.58)      prof = 1.0;                    // широкая верхняя полка
    else if(t < 0.70) prof = 1.0 - (t-0.58)/0.12;    // стенка вниз
    else if(t < 0.88) prof = 0.06;                   // узкое дно
    else              prof = (t-0.88)/0.12;          // стенка вверх
    // мягкий перепад: дно лишь притенено, а не чёрное
    const k = 0.80 + prof*0.30 + (prof>0.08&&prof<0.94 ? -0.06 : 0);
    x.fillStyle = `rgb(${clamp(base[0]*k,0,255)|0},${clamp(base[1]*k,0,255)|0},${clamp(base[2]*k,0,255)|0})`;
    x.fillRect(i,0,1,size);
    const hv = Math.round(60 + prof*175);
    hx.fillStyle = `rgb(${hv},${hv},${hv})`; hx.fillRect(i,0,1,size);
  }
  // поперечные стыки листов
  for(let k=0;k<2;k++){
    const y = size*(0.5*k + 0.25);
    x.fillStyle='rgba(72,66,60,.3)'; x.fillRect(0,y,size,2);
    hx.fillStyle='rgba(30,30,30,.8)'; hx.fillRect(0,y,size,3);
  }
  // саморезы
  for(let k=0;k<2;k++){
    const y = size*(0.5*k + 0.25) + 1;
    for(let i=0;i<ribs;i++){
      const px = (i+0.5)*size/ribs;
      x.fillStyle='rgba(86,78,70,.5)'; x.beginPath(); x.arc(px,y,2.2,0,7); x.fill();
      hx.fillStyle='rgba(230,230,230,.9)'; hx.beginPath(); hx.arc(px,y,2.4,0,7); hx.fill();
    }
  }
  for(let i=0;i<rust*240;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(3,30);
    const col = `rgba(${si(104,152)},${si(68,96)},${si(44,62)},${sr(.08,.34)})`;
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    // ржавчина матовая: в roughness почти белая
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(240,240,240,${sr(.2,.6)})`); g.addColorStop(1,'rgba(240,240,240,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
  }
  // вертикальные потёки
  for(let i=0;i<22;i++){
    const px=srnd()*size, w=sr(2,9), y0=srnd()*size;
    const g=x.createLinearGradient(px,y0,px,y0+size*0.5);
    g.addColorStop(0,`rgba(${si(88,126)},${si(58,80)},${si(38,52)},.2)`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=g; x.fillRect(px,y0,w,size*0.5);
  }
  grain(x,size,size,0.028);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Ржавый крашеный металл (колонны, фермы) ---------- */
function steelMaps(size=512, baseCol=[64,60,58]){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  rx.fillStyle='#6e6e6e'; rx.fillRect(0,0,size,size);
  x.fillStyle=`rgb(${baseCol[0]},${baseCol[1]},${baseCol[2]})`; x.fillRect(0,0,size,size);
  hx.fillStyle='#b4b4b4'; hx.fillRect(0,0,size,size);
  // облезшая краска
  for(let i=0;i<420;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(3,26);
    const col=`rgba(${si(96,156)},${si(58,90)},${si(36,56)},${sr(.14,.58)})`;
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,col); g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
    wrapDraw(rx, size, ()=>{
      const g=rx.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(235,235,235,${sr(.25,.7)})`); g.addColorStop(1,'rgba(235,235,235,0)');
      rx.fillStyle=g; rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill();
    });
    wrapDraw(hx, size, ()=>{
      const hv=si(130,190);
      hx.fillStyle=`rgba(${hv},${hv},${hv},.25)`;
      hx.beginPath(); hx.arc(px,py,r*0.6,0,7); hx.fill();
    });
  }
  // потёки ржавчины
  for(let i=0;i<26;i++){
    const px=srnd()*size, w=sr(1.5,7), y0=srnd()*size;
    const g=x.createLinearGradient(px,y0,px,y0+size*0.6);
    g.addColorStop(0,`rgba(${si(96,152)},${si(52,82)},${si(24,44)},.42)`);
    g.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=g; x.fillRect(px,y0,w,size*0.6);
  }
  grain(x,size,size,0.045);
  return {albedo:c, height:h, rough:rg};
}

/* ---------- Бетонная панель цоколя ---------- */
function panelMaps(size=768){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  x.fillStyle='#8a8884'; x.fillRect(0,0,size,size);
  hx.fillStyle='#b0b0b0'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#dcdcdc'; rx.fillRect(0,0,size,size);
  for(let i=0;i<420;i++){
    const v=si(112,162), px=srnd()*size, py=srnd()*size, r=sr(6,40);
    wrapDraw(x, size, ()=>{ x.fillStyle=`rgba(${v},${v-2},${v-8},${sr(.04,.16)})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
  }
  // поры и сколы
  for(let i=0;i<1500;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(0.6,2.6), hv=si(118,150);
    wrapDraw(hx, size, ()=>{ hx.fillStyle=`rgba(${hv},${hv},${hv},.5)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
  }
  // швы панелей
  const seam = (x0,y0,x1,y1)=>{
    x.strokeStyle='rgba(66,62,56,.55)'; x.lineWidth=4;
    x.beginPath(); x.moveTo(x0,y0); x.lineTo(x1,y1); x.stroke();
    hx.strokeStyle='rgba(48,48,48,.95)'; hx.lineWidth=6;
    hx.beginPath(); hx.moveTo(x0,y0); hx.lineTo(x1,y1); hx.stroke();
  };
  seam(0,0,size,0); seam(0,size-2,size,size-2);
  seam(0,size/2,size,size/2); seam(0,0,0,size); seam(size-2,0,size-2,size);
  // потёки от дождя сверху
  for(let i=0;i<26;i++){
    const px=srnd()*size, w=sr(4,26);
    const g=x.createLinearGradient(px,0,px,size);
    g.addColorStop(0,'rgba(58,52,44,.34)'); g.addColorStop(.6,'rgba(58,52,44,.08)'); g.addColorStop(1,'rgba(58,52,44,0)');
    x.fillStyle=g; x.fillRect(px,0,w,size);
  }
  // мох/грязь понизу
  const gm = x.createLinearGradient(0,size*0.72,0,size);
  gm.addColorStop(0,'rgba(48,50,40,0)'); gm.addColorStop(1,'rgba(48,50,40,.38)');
  x.fillStyle=gm; x.fillRect(0,size*0.72,size,size*0.28);
  // мокрые подтёки — глянцевее сухого бетона
  for(let i=0;i<20;i++){
    const px=srnd()*size, w=sr(6,30);
    const g=rx.createLinearGradient(px,0,px,size);
    g.addColorStop(0,`rgba(120,120,120,${sr(.2,.45)})`); g.addColorStop(1,'rgba(120,120,120,0)');
    rx.fillStyle=g; rx.fillRect(px,0,w,size);
  }
  grain(x,size,size,0.03);
  return {albedo:c, height:h, rough:rg};
}
/* ---------- Пятна на полу (лужи краски, грязь) ---------- */
/** Мутное армированное стекло: разводы, пыль, сетка. */
function dirtyGlassMaps(size=256){
  const [c,x] = cv(size,size);
  x.fillStyle='#d8e4ee'; x.fillRect(0,0,size,size);
  // потёки и налёт
  for(let i=0;i<70;i++){
    const px=srnd()*size, w=sr(3,26);
    const g=x.createLinearGradient(px,0,px,size);
    g.addColorStop(0,`rgba(${si(120,168)},${si(126,172)},${si(120,166)},${sr(.08,.3)})`);
    g.addColorStop(1,'rgba(150,155,150,0)');
    x.fillStyle=g; x.fillRect(px,0,w,size);
  }
  for(let i=0;i<120;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(4,30);
    wrapDraw(x, size, ()=>{
      const g=x.createRadialGradient(px,py,1,px,py,r);
      g.addColorStop(0,`rgba(${si(140,190)},${si(144,192)},${si(138,186)},${sr(.05,.22)})`);
      g.addColorStop(1,'rgba(0,0,0,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    });
  }
  // армирующая сетка
  x.strokeStyle='rgba(126,132,128,.30)'; x.lineWidth=1.1;
  for(let i=0;i<=size;i+=size/10){
    x.beginPath(); x.moveTo(i,0); x.lineTo(i,size); x.stroke();
    x.beginPath(); x.moveTo(0,i); x.lineTo(size,i); x.stroke();
  }
  grain(x,size,size,0.03);
  return c;
}

/* ---------- Пиратский флаг: «Весёлый Роджер» на потрёпанном полотнище ---------- */
function flagTex(w=512, h=320){
  const [c,x] = cv(w,h);
  // Полотнище выгоревшее: чистый чёрный на солнце становится серо-бурым.
  const g = x.createLinearGradient(0,0,w,h);
  g.addColorStop(0,'#25242a'); g.addColorStop(0.5,'#1b1a1f'); g.addColorStop(1,'#2b2930');
  x.fillStyle=g; x.fillRect(0,0,w,h);
  // переплетение ткани
  for(let i=0;i<h;i+=2){ x.fillStyle=`rgba(255,255,255,${sr(0.012,0.03)})`; x.fillRect(0,i,w,1); }
  for(let i=0;i<w;i+=2){ x.fillStyle=`rgba(0,0,0,${sr(0.01,0.028)})`; x.fillRect(i,0,1,h); }

  const cx = w*0.5, cy = h*0.44, S = h*0.0034;
  x.save(); x.translate(cx,cy); x.scale(S,S);
  x.fillStyle = '#d8d3c4';
  // кости крест-накрест
  const bone = (ang)=>{
    x.save(); x.rotate(ang);
    x.beginPath(); x.roundRect(-118, -9, 236, 18, 9); x.fill();
    for(const sx of [-1,1]) for(const sy of [-1,1]){
      x.beginPath(); x.arc(sx*124, sy*13, 15, 0, 7); x.fill();
    }
    x.restore();
  };
  bone(0.62); bone(-0.62);
  // череп
  x.beginPath(); x.ellipse(0,-14, 62, 56, 0, 0, 7); x.fill();
  x.beginPath(); x.roundRect(-34, 26, 68, 34, 12); x.fill();          // челюсть
  x.fillStyle = '#1b1a1f';
  x.beginPath(); x.ellipse(-24,-18, 19, 22, 0.12, 0, 7); x.fill();    // глазницы
  x.beginPath(); x.ellipse( 24,-18, 19, 22,-0.12, 0, 7); x.fill();
  x.beginPath(); x.moveTo(0,4); x.lineTo(-11,24); x.lineTo(11,24); x.closePath(); x.fill();  // нос
  for(let i=0;i<4;i++){ x.fillRect(-27+i*15, 28, 5, 30); }            // зубы
  x.restore();

  // выгорание и пятна
  for(let i=0;i<120;i++){
    const px=srnd()*w, py=srnd()*h, r=sr(8,60);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(${si(120,170)},${si(112,160)},${si(100,148)},${sr(.03,.12)})`);
    rg.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  // рваный свободный край (по правой стороне) и дыры
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<26;i++){
    const py=srnd()*h;
    x.beginPath(); x.moveTo(w, py);
    x.lineTo(w - sr(6,52), py + sr(-14,14));
    x.lineTo(w, py + sr(8,30));
    x.closePath(); x.fill();
  }
  for(let i=0;i<7;i++){
    x.beginPath(); x.ellipse(sr(w*0.25,w*0.97), srnd()*h, sr(2,11), sr(2,9), sr(0,3), 0, 7); x.fill();
  }
  x.globalCompositeOperation='source-over';
  grain(x,w,h,0.04);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Разметка вертолётной площадки ---------- */
function helipadTex(size=1024){
  const [c,x] = cv(size,size);
  const S = size/2;
  x.fillStyle='#4a4b4d'; x.fillRect(0,0,size,size);
  // асфальтовая крошка
  for(let i=0;i<9000;i++){
    const v=si(48,96);
    x.fillStyle=`rgba(${v},${v+2},${v+3},${sr(.15,.55)})`;
    x.fillRect(srnd()*size, srnd()*size, sr(1,3.4), sr(1,3.4));
  }
  // жёлтый круг TLOF и белая H
  x.strokeStyle='#c9b048'; x.lineWidth=size*0.026;
  x.beginPath(); x.arc(S,S,size*0.40,0,7); x.stroke();
  x.strokeStyle='#e4e2da'; x.lineWidth=size*0.018;
  x.beginPath(); x.arc(S,S,size*0.455,0,7); x.stroke();
  x.fillStyle='#e8e6de';
  const bw=size*0.052, bh=size*0.30, gap=size*0.115;
  x.fillRect(S-gap-bw/2, S-bh/2, bw, bh);
  x.fillRect(S+gap-bw/2, S-bh/2, bw, bh);
  x.fillRect(S-gap, S-bw/2, gap*2, bw);
  // номер площадки и предельная масса
  x.fillStyle='#d8d6cc'; x.textAlign='center'; x.textBaseline='middle';
  x.font=`700 ${Math.round(size*0.055)}px Arial,Helvetica,sans-serif`;
  x.fillText('07', S, S + size*0.245);
  x.font=`700 ${Math.round(size*0.038)}px Arial,Helvetica,sans-serif`;
  x.fillText('1.4 t', S, S - size*0.245);
  // износ: краска стирается пятнами, следы полозьев
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<260;i++){
    x.globalAlpha=sr(.10,.55);
    x.beginPath(); x.ellipse(srnd()*size, srnd()*size, sr(3,26), sr(3,20), sr(0,3), 0, 7); x.fill();
  }
  x.globalAlpha=1; x.globalCompositeOperation='source-over';
  for(const sx of [-1,1]){            // потёртости от полозьев
    const px = S + sx*size*0.135;
    const gr = x.createLinearGradient(px-size*0.02,0,px+size*0.02,0);
    gr.addColorStop(0,'rgba(30,30,32,0)'); gr.addColorStop(0.5,'rgba(30,30,32,.35)');
    gr.addColorStop(1,'rgba(30,30,32,0)');
    x.fillStyle=gr; x.fillRect(px-size*0.03, S-size*0.22, size*0.06, size*0.44);
  }
  for(let i=0;i<40;i++){              // масляные потёки от редуктора
    const px=S+sr(-size*0.12,size*0.12), py=S+sr(-size*0.1,size*0.1), r=sr(4,26);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(22,20,18,${sr(.1,.36)})`); rg.addColorStop(1,'rgba(22,20,18,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  grain(x,size,size,0.05);
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Разметка парковки: линии мест, стрелки, номера ---------- */
function parkingTex(size=1024){
  const [c,x] = cv(size,size);
  x.clearRect(0,0,size,size);
  // Полотно 16 x 16 м: четыре места по 2.6 м с проездом.
  const px = v => v/16*size;
  x.strokeStyle='rgba(226,220,196,.85)'; x.lineCap='butt';
  x.lineWidth = px(0.12);
  for(let i=0;i<=4;i++){
    x.beginPath(); x.moveTo(px(0.4+i*2.6), px(0.6)); x.lineTo(px(0.4+i*2.6), px(5.6)); x.stroke();
  }
  x.beginPath(); x.moveTo(px(0.4), px(5.6)); x.lineTo(px(10.8), px(5.6)); x.stroke();
  // номера мест
  x.fillStyle='rgba(226,220,196,.8)'; x.textAlign='center'; x.textBaseline='middle';
  x.font=`700 ${Math.round(px(0.7))}px Arial,sans-serif`;
  for(let i=0;i<4;i++) x.fillText('P'+(i+1), px(1.7+i*2.6), px(5.0));
  // стрелка направления движения
  x.fillStyle='rgba(226,220,196,.7)';
  x.save(); x.translate(px(12.6), px(8.0)); x.scale(px(1),px(1));
  x.beginPath(); x.moveTo(0,-2.2); x.lineTo(0.85,-0.6); x.lineTo(0.32,-0.6);
  x.lineTo(0.32,2.2); x.lineTo(-0.32,2.2); x.lineTo(-0.32,-0.6); x.lineTo(-0.85,-0.6);
  x.closePath(); x.fill(); x.restore();
  // жёлтая штриховка запретной зоны
  x.strokeStyle='rgba(198,168,74,.6)'; x.lineWidth=px(0.1);
  for(let i=0;i<12;i++){
    x.beginPath(); x.moveTo(px(0.4+i*0.5), px(14.6)); x.lineTo(px(0.9+i*0.5), px(13.4)); x.stroke();
  }
  // стёртость краски
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<420;i++){
    x.globalAlpha=sr(.15,.7);
    x.beginPath(); x.ellipse(srnd()*size, srnd()*size, sr(2,16), sr(2,13), sr(0,3), 0, 7); x.fill();
  }
  x.globalAlpha=1; x.globalCompositeOperation='source-over';
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA();
  return t;
}

/* ---------- Сигнальная лента: жёлто-чёрные косые полосы ---------- */
function hazardMaps(size=256){
  const [c,x] = cv(size,size);
  const [h,hx] = cv(size,size);
  const [rg,rx] = cv(size,size);
  x.fillStyle='#b2933f'; x.fillRect(0,0,size,size);
  hx.fillStyle='#808080'; hx.fillRect(0,0,size,size);
  rx.fillStyle='#7c7c7c'; rx.fillRect(0,0,size,size);
  x.strokeStyle='#26241f'; x.lineWidth=size*0.14;
  for(let i=-2;i<=6;i++){
    x.beginPath(); x.moveTo(i*size/3, 0); x.lineTo(i*size/3 + size, size); x.stroke();
  }
  // облезлая краска: ржавые проплешины
  for(let i=0;i<220;i++){
    const px=srnd()*size, py=srnd()*size, r=sr(2,13);
    wrapDraw(x,size,()=>{ x.fillStyle=`rgba(${si(96,140)},${si(64,92)},${si(44,62)},${sr(.25,.7)})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill(); });
    wrapDraw(hx,size,()=>{ const v=si(88,126); hx.fillStyle=`rgba(${v},${v},${v},.6)`;
      hx.beginPath(); hx.arc(px,py,r,0,7); hx.fill(); });
    wrapDraw(rx,size,()=>{ rx.fillStyle=`rgba(${si(150,200)},${si(150,200)},${si(150,200)},.5)`;
      rx.beginPath(); rx.arc(px,py,r,0,7); rx.fill(); });
  }
  grain(x,size,size,0.05);
  return {albedo:c, height:h, rough:rg};
}

/* ============================================================================
   НОВЫЕ ТЕКСТУРЫ: эмблемы команд, камуфляж, декали повреждений, огонь, дым,
   решётчатый настил, воронка.
============================================================================ */
const texOf = (c, srgb=true)=>{ const t=new THREE.CanvasTexture(c); if(srgb) t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=MAXA(); return t; };

/** Камуфляж пятнами: слои цветных клякс от крупных к мелким (multicam/woodland). */
function camoCanvas(w, h, pal, scale=1){
  const [c,x] = cv(w,h);
  x.fillStyle = pal[0]; x.fillRect(0,0,w,h);
  for(let L=1; L<pal.length; L++){
    const n = Math.round(90*scale/L), rMax = 70*scale/Math.sqrt(L);
    x.fillStyle = pal[L];
    for(let i=0;i<n;i++){
      const px=srnd()*w, py=srnd()*h;
      x.beginPath();
      const pts = 9, r0 = sr(rMax*0.3, rMax);
      for(let k=0;k<=pts;k++){
        const a = k/pts*Math.PI*2, r = r0*sr(0.55,1.15);
        const qx = px+Math.cos(a)*r*1.6, qy = py+Math.sin(a)*r*0.8;
        k ? x.lineTo(qx,qy) : x.moveTo(qx,qy);
      }
      x.closePath(); x.fill();
    }
  }
  return [c,x];
}
/** Эмблема ALPHA: стилизованная «A»-шеврон с вырезом, как на референсе. */
function drawAlpha(x, cx, cy, s, col){
  x.save(); x.translate(cx,cy); x.scale(s,s); x.fillStyle=col;
  x.beginPath();
  x.moveTo(0,-100); x.lineTo(88,80); x.lineTo(48,80); x.lineTo(0,-18); x.lineTo(-48,80); x.lineTo(-88,80);
  x.closePath(); x.fill();
  x.beginPath(); x.moveTo(-22,52); x.lineTo(22,52); x.lineTo(36,80); x.lineTo(-36,80); x.closePath(); x.fill();
  x.restore();
}
/** Эмблема DELTA: треугольник с горизонтальной прорезью. */
function drawDelta(x, cx, cy, s, col){
  x.save(); x.translate(cx,cy); x.scale(s,s); x.fillStyle=col;
  x.beginPath(); x.moveTo(0,-100); x.lineTo(92,78); x.lineTo(-92,78); x.closePath(); x.fill();
  x.globalCompositeOperation='destination-out';
  x.beginPath(); x.moveTo(-58,34); x.lineTo(58,34); x.lineTo(50,48); x.lineTo(-50,48); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(0,-54); x.lineTo(10,-34); x.lineTo(-10,-34); x.closePath(); x.fill();
  x.globalCompositeOperation='source-over';
  x.restore();
}
/** Полотнище командного флага 2:1 с эмблемой и надписью. */
function teamFlagTex(team, w=1024, h=640){
  let c, x;
  if(team==='ALPHA'){
    [c,x] = cv(w,h);
    const g = x.createLinearGradient(0,0,w,h);
    g.addColorStop(0,'#1d1f22'); g.addColorStop(1,'#121315');
    x.fillStyle=g; x.fillRect(0,0,w,h);
  } else {
    [c,x] = camoCanvas(w,h, ['#6b6a4b','#4d5536','#8a7d58','#3a3d2a','#a39873','#2c2d22'], 1.6);
  }
  // ткацкое переплетение
  for(let i=0;i<h;i+=2){ x.fillStyle=`rgba(255,255,255,${sr(0.01,0.03)})`; x.fillRect(0,i,w,1); }
  for(let i=0;i<w;i+=2){ x.fillStyle=`rgba(0,0,0,${sr(0.01,0.03)})`; x.fillRect(i,0,1,h); }
  // окантовка и поле эмблемы
  x.strokeStyle = team==='ALPHA' ? 'rgba(230,232,236,.85)' : 'rgba(30,32,24,.85)';
  x.lineWidth = h*0.03; x.strokeRect(h*0.05, h*0.05, w-h*0.1, h-h*0.1);
  const col = team==='ALPHA' ? '#e9eaec' : '#20241a';
  if(team==='ALPHA') drawAlpha(x, w*0.5, h*0.42, h*0.0026, col);
  else { x.fillStyle='rgba(20,22,16,.55)'; x.beginPath(); x.arc(w*0.5,h*0.42,h*0.3,0,7); x.fill();
         drawDelta(x, w*0.5, h*0.43, h*0.0024, '#9cc27a'); }
  x.fillStyle = team==='ALPHA' ? '#e9eaec' : '#d9dccb';
  x.font = `700 ${Math.round(h*0.105)}px "Segoe UI",Roboto,Arial,sans-serif`;
  x.textAlign='center'; x.textBaseline='middle';
  const word = team.split('').join(String.fromCharCode(8202));
  x.fillText(word, w*0.5, h*0.83);
  // выгорание, грязь и потёртости по свободному краю
  for(let i=0;i<140;i++){
    const px=srnd()*w, py=srnd()*h, r=sr(8,70);
    const rg=x.createRadialGradient(px,py,1,px,py,r);
    rg.addColorStop(0,`rgba(${si(110,160)},${si(100,150)},${si(80,120)},${sr(.02,.09)})`);
    rg.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=rg; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
  }
  x.globalCompositeOperation='destination-out';
  for(let i=0;i<30;i++){
    const py=srnd()*h;
    x.beginPath(); x.moveTo(w, py); x.lineTo(w - sr(4,34), py + sr(-10,10)); x.lineTo(w, py + sr(6,22));
    x.closePath(); x.fill();
  }
  x.globalCompositeOperation='source-over';
  grain(x,w,h,0.035);
  return texOf(c);
}
/** Иконка эмблемы для интерфейса (data URL). */
function emblemDataURL(team, size=128){
  const [c,x] = cv(size,size);
  if(team==='ALPHA') drawAlpha(x, size/2, size*0.52, size*0.0042, '#eceef0');
  else drawDelta(x, size/2, size*0.54, size*0.0042, '#a9cf86');
  return c.toDataURL();
}

/** Атлас декалей 4x2: 0-1 дерево (пулевые), 2 бетон/металл, 3 стекло (звезда),
    4 гарь, 5 обугленная дыра, 6 скол бетона, 7 брызги сажи. */
function decalAtlas(size=1024){
  const [c,x] = cv(size, size/2);
  const S = size/4;
  x.clearRect(0,0,size,size/2);
  const cell = (i, fn)=>{ x.save(); x.translate((i%4)*S + S/2, Math.floor(i/4)*S + S/2); fn(S/2); x.restore(); };
  const woodHole = (R)=>{
    // вырванная щепа вокруг входного отверстия, светлая свежая древесина
    for(let k=0;k<26;k++){
      const a=sr(0,6.283), l=sr(R*0.18,R*0.72), w=sr(1.5,5);
      x.save(); x.rotate(a);
      x.fillStyle=`rgba(${si(214,238)},${si(186,208)},${si(130,156)},${sr(.55,.95)})`;
      x.beginPath(); x.moveTo(R*0.08,-w); x.lineTo(l,0); x.lineTo(R*0.08,w); x.closePath(); x.fill();
      x.restore();
    }
    const g=x.createRadialGradient(0,0,0,0,0,R*0.42);
    g.addColorStop(0,'rgba(8,6,4,1)'); g.addColorStop(0.45,'rgba(24,17,10,.98)');
    g.addColorStop(0.75,'rgba(90,64,36,.6)'); g.addColorStop(1,'rgba(120,90,50,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.42,0,7); x.fill();
    x.fillStyle='rgba(4,3,2,1)'; x.beginPath();
    for(let k=0;k<=10;k++){ const a=k/10*6.283, r=R*sr(0.10,0.16); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
    x.fill();
  };
  cell(0, woodHole); cell(1, woodHole);
  cell(2, (R)=>{   // бетон: скол с пылью
    const g=x.createRadialGradient(0,0,0,0,0,R*0.8);
    g.addColorStop(0,'rgba(30,30,30,1)'); g.addColorStop(0.25,'rgba(70,68,64,.95)');
    g.addColorStop(0.5,'rgba(170,166,158,.6)'); g.addColorStop(1,'rgba(200,196,188,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.8,0,7); x.fill();
    x.strokeStyle='rgba(40,40,40,.6)'; x.lineWidth=1.2;
    for(let k=0;k<7;k++){ const a=sr(0,6.28); x.beginPath(); x.moveTo(0,0);
      x.lineTo(Math.cos(a)*R*sr(0.4,0.8), Math.sin(a)*R*sr(0.4,0.8)); x.stroke(); }
  });
  cell(3, (R)=>{   // стекло: звезда трещин
    x.strokeStyle='rgba(235,242,248,.9)'; x.lineWidth=1.4;
    for(let k=0;k<14;k++){
      const a=k/14*6.283+sr(-0.15,0.15); let px=0, py=0; x.beginPath(); x.moveTo(0,0);
      for(let s=0;s<5;s++){ px+=Math.cos(a+sr(-0.3,0.3))*R*0.19; py+=Math.sin(a+sr(-0.3,0.3))*R*0.19; x.lineTo(px,py); }
      x.stroke();
    }
    for(let ring=1; ring<4; ring++){
      x.beginPath();
      for(let k=0;k<=14;k++){ const a=k/14*6.283, r=R*ring*0.22*sr(0.85,1.1); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
      x.strokeStyle=`rgba(230,238,245,${0.7-ring*0.15})`; x.stroke();
    }
    x.fillStyle='rgba(20,24,28,.95)'; x.beginPath(); x.arc(0,0,R*0.06,0,7); x.fill();
  });
  cell(4, (R)=>{   // гарь от взрыва
    for(let k=0;k<40;k++){
      const a=sr(0,6.283), d=sr(0,R*0.6), r=sr(R*0.15,R*0.45);
      const g=x.createRadialGradient(Math.cos(a)*d,Math.sin(a)*d,0,Math.cos(a)*d,Math.sin(a)*d,r);
      g.addColorStop(0,`rgba(12,10,9,${sr(.25,.5)})`); g.addColorStop(1,'rgba(12,10,9,0)');
      x.fillStyle=g; x.beginPath(); x.arc(Math.cos(a)*d,Math.sin(a)*d,r,0,7); x.fill();
    }
    for(let k=0;k<30;k++){  // лучи выброса
      const a=sr(0,6.283); x.strokeStyle=`rgba(14,12,10,${sr(.15,.4)})`; x.lineWidth=sr(2,7);
      x.beginPath(); x.moveTo(Math.cos(a)*R*0.3,Math.sin(a)*R*0.3); x.lineTo(Math.cos(a)*R*sr(0.7,0.98),Math.sin(a)*R*sr(0.7,0.98)); x.stroke();
    }
  });
  cell(5, (R)=>{   // обугленная кромка дыры
    const g=x.createRadialGradient(0,0,R*0.2,0,0,R*0.95);
    g.addColorStop(0,'rgba(5,4,3,1)'); g.addColorStop(0.5,'rgba(22,15,9,.9)'); g.addColorStop(0.8,'rgba(60,38,20,.45)'); g.addColorStop(1,'rgba(60,38,20,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R*0.95,0,7); x.fill();
  });
  cell(6, (R)=>{   // скол бетона крупный
    x.fillStyle='rgba(60,58,54,.9)'; x.beginPath();
    for(let k=0;k<=12;k++){ const a=k/12*6.283, r=R*sr(0.3,0.6); k?x.lineTo(Math.cos(a)*r,Math.sin(a)*r):x.moveTo(Math.cos(a)*r,Math.sin(a)*r); }
    x.fill();
    const g=x.createRadialGradient(0,0,R*0.3,0,0,R); g.addColorStop(0,'rgba(190,186,176,.5)'); g.addColorStop(1,'rgba(190,186,176,0)');
    x.fillStyle=g; x.beginPath(); x.arc(0,0,R,0,7); x.fill();
  });
  cell(7, (R)=>{   // брызги сажи
    for(let k=0;k<60;k++){ const a=sr(0,6.283), d=sr(0,R*0.9);
      x.fillStyle=`rgba(16,14,12,${sr(.2,.6)})`; x.beginPath(); x.arc(Math.cos(a)*d,Math.sin(a)*d,sr(1,5),0,7); x.fill(); }
  });
  return texOf(c);
}

/** Воронка: albedo с альфой + карта высот (впадина, вал выброса по кромке). */
function craterMaps(size=512){
  const [c,x] = cv(size,size), [h,hx] = cv(size,size);
  const C = size/2;
  x.clearRect(0,0,size,size);
  hx.fillStyle='rgb(128,128,128)'; hx.fillRect(0,0,size,size);
  const img = hx.getImageData(0,0,size,size), d = img.data;
  const ph = [sr(0,6),sr(0,6),sr(0,6)];
  for(let py=0;py<size;py++) for(let px=0;px<size;px++){
    const dx=(px-C)/C, dy=(py-C)/C, r=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
    const wob = 1 + 0.08*Math.sin(a*5+ph[0]) + 0.05*Math.sin(a*11+ph[1]) + 0.03*Math.sin(a*23+ph[2]);
    const rr = r/wob;
    let hv = 0;
    if(rr < 0.55) hv = -Math.cos(rr/0.55*Math.PI/2)*0.9;          // чаша
    else if(rr < 0.8) hv = Math.sin((rr-0.55)/0.25*Math.PI)*0.35;  // вал
    hv += (Math.random()-0.5)*0.12;
    const v = clamp(128 + hv*110, 0, 255), i=(py*size+px)*4;
    d[i]=d[i+1]=d[i+2]=v; d[i+3]=255;
  }
  hx.putImageData(img,0,0);
  // albedo: тёмная чаша, выбитый бетон, копоть лучами
  for(let k=0;k<50;k++){
    const a=sr(0,6.283), dd=sr(0,C*0.5), r=sr(C*0.1,C*0.35);
    const g=x.createRadialGradient(C+Math.cos(a)*dd,C+Math.sin(a)*dd,0,C+Math.cos(a)*dd,C+Math.sin(a)*dd,r);
    g.addColorStop(0,`rgba(${si(40,70)},${si(38,64)},${si(34,58)},${sr(.5,.8)})`); g.addColorStop(1,'rgba(40,38,34,0)');
    x.fillStyle=g; x.beginPath(); x.arc(C+Math.cos(a)*dd,C+Math.sin(a)*dd,r,0,7); x.fill();
  }
  for(let k=0;k<80;k++){ // крошка по валу
    const a=sr(0,6.283), dd=C*sr(0.45,0.85);
    x.fillStyle=`rgba(${si(120,170)},${si(116,164)},${si(108,154)},${sr(.5,.9)})`;
    x.beginPath(); x.arc(C+Math.cos(a)*dd, C+Math.sin(a)*dd, sr(2,7), 0, 7); x.fill();
  }
  for(let k=0;k<36;k++){
    const a=sr(0,6.283); x.strokeStyle=`rgba(14,12,10,${sr(.12,.35)})`; x.lineWidth=sr(3,10);
    x.beginPath(); x.moveTo(C+Math.cos(a)*C*0.4,C+Math.sin(a)*C*0.4); x.lineTo(C+Math.cos(a)*C*sr(0.75,1.0),C+Math.sin(a)*C*sr(0.75,1.0)); x.stroke();
  }
  const g=x.createRadialGradient(C,C,0,C,C,C*0.3); g.addColorStop(0,'rgba(10,9,8,.85)'); g.addColorStop(1,'rgba(10,9,8,0)');
  x.fillStyle=g; x.beginPath(); x.arc(C,C,C*0.3,0,7); x.fill();
  // мягкая кромка
  const im=x.getImageData(0,0,size,size), q=im.data;
  for(let i=3;i<q.length;i+=4){ const p=(i-3)/4, px=p%size, py=Math.floor(p/size);
    const r=Math.hypot(px-C,py-C)/C; q[i]=q[i]*clamp((1.0-r)/0.18,0,1); }
  x.putImageData(im,0,0);
  const nrm = heightToNormal(h, 6.0);
  return { map: texOf(c), normal: texOf(nrm,false) };
}

/** Спрайт пламени: вертикальный язык с горячим ядром (для аддитивных частиц). */
function flameTex(size=128){
  const [c,x] = cv(size,size);
  const img = x.createImageData(size,size), d = img.data;
  for(let py=0;py<size;py++) for(let px=0;px<size;px++){
    const u=(px/size-0.5)*2, v=py/size;              // v: 0 верх, 1 низ
    const w = 0.25 + 0.75*Math.pow(v, 0.7);
    const r = Math.abs(u)/w;
    let a = clamp(1-r,0,1) * smoothstepJS(0.0,0.35,v) * smoothstepJS(1.0,0.72,v);
    a = Math.pow(a, 1.3);
    const i=(py*size+px)*4;
    d[i]=255; d[i+1]=Math.round(150+105*a); d[i+2]=Math.round(60+150*a*a); d[i+3]=Math.round(255*a);
  }
  x.putImageData(img,0,0);
  return texOf(c);
}
function smoothstepJS(a,b,x){ const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); }
/** Клуб дыма: мягкая неровная клякса. */
function smokeTex(size=128){
  const [c,x] = cv(size,size);
  const C=size/2;
  for(let k=0;k<22;k++){
    const a=sr(0,6.283), dd=sr(0,C*0.42), r=sr(C*0.25,C*0.55);
    const g=x.createRadialGradient(C+Math.cos(a)*dd,C+Math.sin(a)*dd,0,C+Math.cos(a)*dd,C+Math.sin(a)*dd,r);
    g.addColorStop(0,'rgba(255,255,255,.22)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(C+Math.cos(a)*dd,C+Math.sin(a)*dd,r,0,7); x.fill();
  }
  return texOf(c);
}
/** Мягкая точка для искр и вспышек. */
function glowTex(size=64){
  const [c,x] = cv(size,size);
  const g=x.createRadialGradient(size/2,size/2,0,size/2,size/2,size/2);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.25,'rgba(255,240,200,.8)'); g.addColorStop(1,'rgba(255,200,120,0)');
  x.fillStyle=g; x.fillRect(0,0,size,size);
  return texOf(c);
}
/** Просечно-вытяжной/решётчатый настил: albedo + альфа по прорезям. */
function gratingMaps(size=256){
  const [c,x] = cv(size,size), [h,hx] = cv(size,size);
  x.fillStyle='#000'; x.fillRect(0,0,size,size); hx.fillStyle='#000'; hx.fillRect(0,0,size,size);
  const n=8, s=size/n;
  for(let i=0;i<=n;i++){
    x.fillStyle='#5b5752'; x.fillRect(i*s-3,0,6,size);               // несущие полосы
    hx.fillStyle='#fff'; hx.fillRect(i*s-3,0,6,size);
  }
  for(let j=0;j<=n*2;j++){
    x.fillStyle='#4e4a45'; x.fillRect(0,j*s/2-1.5,size,3);            // связи
    hx.fillStyle='#ccc'; hx.fillRect(0,j*s/2-1.5,size,3);
  }
  // ржавчина на кромках
  for(let k=0;k<400;k++){ x.fillStyle=`rgba(${si(90,130)},${si(50,70)},${si(30,40)},${sr(.1,.4)})`;
    x.fillRect(srnd()*size, srnd()*size, sr(1,4), sr(1,4)); }
  const alpha = x.getImageData(0,0,size,size); const hd = hx.getImageData(0,0,size,size).data;
  for(let i=0;i<alpha.data.length;i+=4) alpha.data[i+3] = hd[i] > 20 ? 255 : 0;
  x.putImageData(alpha,0,0);
  return {albedo:c, height:h};
}

/* ---------------------------------------------------------------------------
   КЭШ ПРОЦЕДУРНЫХ ТЕКСТУР (IndexedDB)
   Первый запуск рисует текстуры как раньше и в простое сохраняет холсты
   в IndexedDB (PNG). Следующие запуски берут готовые картинки — генерация
   (≈2.5 с на low, в разы дольше на high) пропускается. Состояние генераторов
   случайных чисел сохраняется вместе с результатом, чтобы расстановка карты
   не зависела от того, была текстура в кэше или нет. ?nocache — без кэша.
--------------------------------------------------------------------------- */
const TEXCACHE = { ver:'tex-v3', db:null, shapes:new Map(), bmp:new Map(), save:[], hits:0, misses:0,
  on: !DEBUG.has('nocache') && typeof indexedDB !== 'undefined' && typeof createImageBitmap === 'function' };
const idbReq = r => new Promise((res, rej)=>{ r.onsuccess = ()=> res(r.result); r.onerror = ()=> rej(r.error); });
async function texCacheOpen(){
  if(!TEXCACHE.on) return;
  try{
    const open = indexedDB.open('angar07', 1);
    open.onupgradeneeded = ()=> open.result.createObjectStore('tex');
    TEXCACHE.db = await Promise.race([idbReq(open), new Promise((_, rej)=> setTimeout(()=> rej(new Error('idb timeout')), 3000))]);
    const prefix = TEXCACHE.ver + '|' + QNAME + '|' + TEXK + '|';
    const st = TEXCACHE.db.transaction('tex', 'readonly').objectStore('tex');
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff');
    const [keys, vals] = await Promise.all([idbReq(st.getAllKeys(range)), idbReq(st.getAll(range))]);
    await Promise.all(keys.map(async (k, i)=>{
      const key = k.slice(prefix.length), v = vals[i];
      if(key.startsWith('S:')) TEXCACHE.shapes.set(key.slice(2), v);
      else { try{ TEXCACHE.bmp.set(key, await createImageBitmap(v)); }catch(e){} }
    }));
  }catch(e){ TEXCACHE.db = null; TEXCACHE.on = false; }
}
const TEX_PROPS = ['colorSpace','wrapS','wrapT','anisotropy','flipY','mapping','generateMipmaps','minFilter','magFilter'];
function cacheCanvas(bmp){
  const [c, x] = cv(bmp.width, bmp.height); x.drawImage(bmp, 0, 0); return c;
}
/** Оборачивает генератор: результат (холсты, текстуры, объекты из них) — из кэша или посчитать и запомнить. */
function texCached(name, fn){
  return function(...args){
    if(!TEXCACHE.on) return fn.apply(this, args);
    const parts = [];
    for(const a of args){
      if(a && typeof a === 'object'){ if(!a.__ck) return fn.apply(this, args); parts.push(a.__ck); }
      else parts.push(String(a));
    }
    const key = name + '(' + parts.join(',') + ')';
    const shape = TEXCACHE.shapes.get(key);
    if(shape){
      const out = rebuildCached(key, shape.v);
      if(out !== undefined){
        TEXCACHE.hits++;
        SEED = shape.seed[0]; _fseed = shape.seed[1]; _seed2 = shape.seed[2];
        return out;
      }
    }
    TEXCACHE.misses++;
    const res = fn.apply(this, args);
    const canv = [];
    const v = describeCached(key, res, canv);
    if(v) TEXCACHE.save.push({ key, shape:{ v, seed:[SEED, _fseed, _seed2] }, canv });
    return res;
  };
}
function describeCached(key, o, canv){
  if(o instanceof HTMLCanvasElement){ const id = key + '#' + canv.length; o.__ck = id; canv.push([id, o]); return {k:'c', id}; }
  if(o && o.isTexture){
    if(!(o.image instanceof HTMLCanvasElement)) return null;
    const id = key + '#' + canv.length; o.image.__ck = id; canv.push([id, o.image]);
    const p = {}; for(const n of TEX_PROPS) p[n] = o[n];
    return {k:'t', id, p, r:[o.repeat.x, o.repeat.y], o:[o.offset.x, o.offset.y]};
  }
  if(o && typeof o === 'object'){
    const out = {}; for(const n in o){ const d = describeCached(key, o[n], canv); if(!d) return null; out[n] = d; }
    return {k:'o', v:out};
  }
  return (typeof o === 'number' || typeof o === 'string' || typeof o === 'boolean') ? {k:'v', v:o} : null;
}
function rebuildCached(key, d){
  if(d.k === 'v') return d.v;
  if(d.k === 'c' || d.k === 't'){
    const b = TEXCACHE.bmp.get(d.id); if(!b) return undefined;
    const c = cacheCanvas(b); c.__ck = d.id;
    if(d.k === 'c') return c;
    const t = new THREE.CanvasTexture(c);
    for(const n of TEX_PROPS) if(d.p[n] !== undefined) t[n] = d.p[n];
    t.repeat.set(d.r[0], d.r[1]); t.offset.set(d.o[0], d.o[1]);
    return t;
  }
  const out = {};
  for(const n in d.v){ const r = rebuildCached(key, d.v[n]); if(r === undefined) return undefined; out[n] = r; }
  return out;
}
/** Сохранение — после запуска, по одному холсту, чтобы не мешать первым кадрам. */
async function texCacheFlush(){
  if(!TEXCACHE.db || !TEXCACHE.save.length) return;
  const prefix = TEXCACHE.ver + '|' + QNAME + '|' + TEXK + '|';
  const list = TEXCACHE.save.splice(0);
  for(const e of list){
    try{
      const blobs = [];
      for(const [id, c] of e.canv){
        const b = await new Promise(res=> c.toBlob(res, 'image/png'));
        if(!b) throw new Error('toBlob');
        blobs.push([id, b]);
        await new Promise(r=> setTimeout(r, 0));
      }
      const tx = TEXCACHE.db.transaction('tex', 'readwrite'), st = tx.objectStore('tex');
      for(const [id, b] of blobs) st.put(b, prefix + id);
      st.put(e.shape, prefix + 'S:' + e.key);
      await new Promise((res, rej)=>{ tx.oncomplete = res; tx.onerror = ()=> rej(tx.error); });
    }catch(err){ return; }
  }
}
function installTexCache(){
  osbMaps = texCached('osb', osbMaps); concreteMaps = texCached('conc', concreteMaps); lumberMaps = texCached('lumber', lumberMaps);
  corrugatedMaps = texCached('corr', corrugatedMaps); steelMaps = texCached('steel', steelMaps); panelMaps = texCached('panel', panelMaps);
  dirtyGlassMaps = texCached('glass', dirtyGlassMaps); flagTex = texCached('flag', flagTex); helipadTex = texCached('heli', helipadTex);
  parkingTex = texCached('park', parkingTex); hazardMaps = texCached('hazard', hazardMaps); decalAtlas = texCached('decal', decalAtlas);
  craterMaps = texCached('crater', craterMaps); gratingMaps = texCached('grating', gratingMaps); floorDamageMaps = texCached('floordmg', floorDamageMaps);
  teamFlagTex = texCached('teamflag', teamFlagTex); flameAtlas = texCached('flameA', flameAtlas); smokeAtlas = texCached('smokeA', smokeAtlas);
  heightToNormal = texCached('h2n', heightToNormal); heightToAO = texCached('h2ao', heightToAO);
}

/* ---------------------------------------------------------------------------
   ТКАНЬ МЕШКОВ И ГАБИОНОВ: плетёный полипропилен / геотекстиль. Рельеф теперь
   в карте нормалей, а не в геометрии: мешки перестали быть «коробками» и
   стали втрое легче (было ≈170 тыс. треугольников на мешки и габионы).
--------------------------------------------------------------------------- */
function fabricMaps(size, base, weave, dirt){
  const [c, x] = cv(size, size), [h, hx] = cv(size, size);
  x.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`; x.fillRect(0, 0, size, size);
  hx.fillStyle = '#808080'; hx.fillRect(0, 0, size, size);
  // переплетение: чередующиеся нити основы и утка
  const n = weave, s = size/n;
  for(let i=0;i<n;i++) for(let j=0;j<n;j++){
    const over = (i + j) % 2 === 0;
    const g = hx.createLinearGradient(i*s, j*s, over ? (i+1)*s : i*s, over ? j*s : (j+1)*s);
    g.addColorStop(0, '#5a5a5a'); g.addColorStop(0.5, '#d8d8d8'); g.addColorStop(1, '#5a5a5a');
    hx.fillStyle = g; hx.fillRect(i*s + 0.5, j*s + 0.5, s - 1, s - 1);
    const k = 0.9 + rnd2()*0.2;
    x.fillStyle = `rgba(${base[0]*k|0},${base[1]*k|0},${base[2]*k|0},0.6)`; x.fillRect(i*s, j*s, s, s);
  }
  // выгоревшие и грязные пятна, песок в складках
  wrapDraw(x, size, ()=>{
    for(let i=0;i<dirt;i++){
      const px = rnd2()*size, py = rnd2()*size, r = size*(0.04 + rnd2()*0.16);
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      const d = rnd2() < 0.6;
      g.addColorStop(0, d ? 'rgba(52,44,30,.28)' : 'rgba(210,200,170,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r*2, r*2);
    }
  });
  grain(x, size, size, 0.05);
  return { albedo: c, height: h };
}
/** Рельеф габиона: мешок выпирает в каждую ячейку сетки 75 мм (сетка — отдельный
    альфа-материал поверх). */
function hescoBulgeMaps(size, cells){
  const [c, x] = cv(size, size), [h, hx] = cv(size, size);
  x.fillStyle = '#8f8466'; x.fillRect(0, 0, size, size);
  hx.fillStyle = '#000'; hx.fillRect(0, 0, size, size);
  const s = size/cells;
  for(let i=0;i<cells;i++) for(let j=0;j<cells;j++){
    const g = hx.createRadialGradient((i+0.5)*s, (j+0.5)*s, 0, (i+0.5)*s, (j+0.5)*s, s*0.62);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#222');
    hx.fillStyle = g; hx.fillRect(i*s, j*s, s, s);
    const k = 0.92 + rnd2()*0.16;
    x.fillStyle = `rgba(${143*k|0},${132*k|0},${102*k|0},.5)`; x.fillRect(i*s, j*s, s, s);
  }
  // потёки песка и грязь снизу
  for(let i=0;i<60;i++){ x.fillStyle = `rgba(70,58,40,${0.05 + rnd2()*0.1})`; x.fillRect(rnd2()*size, size*0.55 + rnd2()*size*0.45, 1 + rnd2()*3, 8 + rnd2()*40); }
  grain(x, size, size, 0.05);
  return { albedo: c, height: h };
}
function buildFabricMaterials(){
  const bag = fabricMaps(TS(256), [120, 112, 80], 24, 18);
  M.sandbag = new THREE.MeshStandardMaterial({ map: T(bag.albedo, 2, 1), normalMap: T(heightToNormal(bag.height, 1.6), 2, 1, false),
    normalScale: new THREE.Vector2(0.9, 0.9), roughness: .96, metalness: 0, envMapIntensity: .35 });
  const hb = hescoBulgeMaps(TS(256), 8);
  // габион: грань 1 м, сетка 75 мм → на текстуру (8 ячеек) ≈ 0.6 м
  M.hesco = new THREE.MeshStandardMaterial({ map: T(hb.albedo, 1.7, 2.2), normalMap: T(heightToNormal(hb.height, 3.2), 1.7, 2.2, false),
    normalScale: new THREE.Vector2(1.2, 1.2), roughness: .95, metalness: 0, envMapIntensity: .3 });
}

/* ---------------------------------------------------------------------------
   БЕТОН И ДЕРЕВО ВБЛИЗИ: мелкая деталь нормалей (растворяется к 12 м, чтобы
   не рябило вдали) и мировые пятна на полу — масло, влага под проёмами кровли,
   следы шин по проездам. Всё процедурно в шейдере, без новых текстур карты.
--------------------------------------------------------------------------- */
function detailNormalTex(size){
  const [h, hx] = cv(size, size), img = hx.createImageData(size, size), d = img.data;
  const n1 = makeNoise2(77), n2 = makeNoise2(91);
  for(let y=0;y<size;y++) for(let x=0;x<size;x++){
    // бесшовно: шум на торе (4D-обход не нужен — период кратен сетке)
    const u = x/size*8, v = y/size*8;
    const val = n1(u, v)*0.5 + n2(u*2, v*2)*0.3 + Math.random()*0.2;
    const i = (y*size + x)*4; d[i] = d[i+1] = d[i+2] = val*255; d[i+3] = 255;
  }
  hx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(heightToNormal(h, 3.5));
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAXA();
  return t;
}
const SURF_U = { uDetailN: { value: null }, uStains: { value: 1 } };
function addSurfaceDetail(mat, opts){
  const prev = mat.onBeforeCompile;
  const stains = !!opts.stains, k = opts.detail ?? 0.35;
  mat.onBeforeCompile = (sh, r)=>{
    if(prev) prev(sh, r);
    sh.uniforms.uDetailN = SURF_U.uDetailN;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetailN;
        float sdH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
        float sdN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
          return mix(mix(sdH(i), sdH(i + vec2(1,0)), f.x), mix(sdH(i + vec2(0,1)), sdH(i + vec2(1,1)), f.x), f.y); }
        float sdF(vec2 p){ return sdN(p)*0.55 + sdN(p*2.03 + 7.1)*0.3 + sdN(p*4.1 + 3.3)*0.15; }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        vec3 sdW = (-vViewPosition - viewMatrix[3].xyz) * mat3(viewMatrix);
        vec3 sdNw = normalize(vNormal * mat3(viewMatrix));
        ${stains ? `
        if(sdNw.y > 0.8 && sdW.y < 0.2){
          // масляные пятна: тёмные и глянцевые
          float oil = smoothstep(0.66, 0.8, sdF(sdW.xz*0.23 + 11.0)) * smoothstep(0.35, 0.6, sdN(sdW.xz*1.7));
          // влажные пятна под проёмами кровли и у ворот: темнее, почти зеркальные
          float wet = smoothstep(0.7, 0.86, sdF(sdW.xz*0.09 + 3.0));
          // следы шин вдоль проездов (по оси x у баз и по z в пролётах)
          float lane = smoothstep(0.55, 0.9, sdN(vec2(sdW.z*3.2, sdW.x*0.05))) * (1.0 - smoothstep(10.0, 13.0, abs(sdW.z))) * step(18.0, abs(sdW.x));
          diffuseColor.rgb *= 1.0 - oil*0.55 - wet*0.28 - lane*0.12;
          roughnessFactor = mix(roughnessFactor, 0.35, oil*0.8);
          roughnessFactor = mix(roughnessFactor, 0.12, wet);
        }` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // трипланарная мелкая деталь в мировых координатах
          vec3 an = abs(sdNw);
          vec2 duv = an.y > max(an.x, an.z) ? sdW.xz : (an.x > an.z ? sdW.zy : sdW.xy);
          vec2 dn = texture2D(uDetailN, duv*1.9).xy*2.0 - 1.0;
          float fade = (1.0 - smoothstep(4.0, 12.0, length(vViewPosition))) * ${k.toFixed(2)};
          vec3 tW = an.y > max(an.x, an.z) ? vec3(dn.x, 0.0, dn.y) : (an.x > an.z ? vec3(0.0, dn.y, dn.x) : vec3(dn.x, dn.y, 0.0));
          normal = normalize(normal + mat3(viewMatrix) * tW * fade);
        }`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = ()=> key + '|sd' + (stains ? 1 : 0) + k;
  return mat;
}

/* ---------------------------------------------------------------------------
   ПРОГРЕВ ШЕЙДЕРОВ: всё, что впервые появляется посреди боя (обломки,
   воронка, сорванная дверь, осколки стекла, снаряды), компилируется при
   загрузке — иначе первый взрыв или пожар даёт фриз на сотни миллисекунд.
--------------------------------------------------------------------------- */
async function prewarmShaders(){
  const G = new THREE.Group(), box = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const mats = new Set([M.conc, M.wood, M.woodDark, M.osb, M.osb2, M.plywood, M.steel, M.crater, M.glass, M.ember,
    DOOR.mat, cmat(0x3a1a12,{roughness:.8, metalness:.4, side:THREE.DoubleSide}), nadeAssets().fragMat, nadeAssets().bottleMat,
    nadeAssets().ragMat, M.chrome, M.rubber]);
  for(const p of DEST.props) for(const part of p.parts) if(!Array.isArray(part.mat)) mats.add(part.mat);
  for(const m of mats){
    if(!m) continue;
    const g = box.clone(); ensureColorGeo(g, m);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(0, -50, 0); mesh.castShadow = true; G.add(mesh);
  }
  scene.add(G);
  try{
    if(renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  }catch(e){}
  scene.remove(G);
  G.traverse(o=>{ if(o.isMesh) o.geometry.dispose(); });
}

/* ---------------------------------------------------------------------------
   ОТРАЖЕНИЯ: окружение снимается кубической камерой из самого ангара (а не
   нарисованный градиент) — металл, стекло и машины отражают настоящие фермы,
   стены и остекление. Переснимается, когда заметно сменилось время суток.
--------------------------------------------------------------------------- */
const ENVCAP = { rt:null, cam:null, pmrem:null, env:null, lastT:-1 };
function captureEnvironment(){
  const size = Q.tex >= 0.75 ? 256 : 128;
  if(!ENVCAP.rt){
    ENVCAP.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    ENVCAP.cam = new THREE.CubeCamera(0.3, 160, ENVCAP.rt);
    ENVCAP.pmrem = new THREE.PMREMGenerator(renderer);
  }
  ENVCAP.cam.position.set(0, 4.5, -19);
  // Частицы, лучи, оружие и копия для теней в кадр не попадают (у дочерних камер
  // куба включён только слой 0). Прежнее окружение не снимаем: иначе все
  // материалы перекомпилировались бы без него, а размер PMREM у них одинаковый.
  const prevEnv = scene.environment;
  ENVCAP.cam.update(renderer, scene);
  const next = ENVCAP.pmrem.fromCubemap(ENVCAP.rt.texture).texture;
  if(ENVCAP.env) ENVCAP.env.dispose();
  ENVCAP.env = next;
  scene.environment = next;
  if(prevEnv && prevEnv !== next && prevEnv !== BASE_ENV.tex) prevEnv.dispose();
  ENVCAP.lastT = DAY.t;
}
const BASE_ENV = { tex:null };

// Материалы: PBR-материалы из процедурных карт + шейдер обугливания дерева.
const MAPS = {}, M = {};
function buildMaterials(){
  const mk = (maps, rep, normScale, opts={}) => {
    const albedo = T(maps.albedo, rep[0], rep[1]);
    const normal = T(heightToNormal(maps.height, opts.hStrength ?? 2.4), rep[0], rep[1], false);
    // Карта шероховатости: без неё вся поверхность блестит одинаково и выглядит пластиком.
    const roughMap = maps.rough ? T(maps.rough, rep[0], rep[1], false) : null;
    // AO из карты высот: затемняет углубления (швы, стыки, каверны).
    const aoMap = T(heightToAO(maps.height, opts.aoPower ?? 1.0), rep[0], rep[1], false);
    const mat = new THREE.MeshStandardMaterial({
      map: albedo, normalMap: normal,
      normalScale: new THREE.Vector2(normScale, normScale),
      roughnessMap: roughMap,
      aoMap, aoMapIntensity: opts.ao ?? 0.85,
      roughness: opts.rough ?? 0.92, metalness: opts.metal ?? 0.0,
      side: opts.side ?? THREE.FrontSide,
      envMapIntensity: opts.env ?? 0.55
    });
    return mat;
  };
  MAPS.osb   = osbMaps(TS(1024), 1.0);
  MAPS.osb2  = osbMaps(TS(1024), 0.92);
  MAPS.conc  = concreteMaps(TS(768));
  MAPS.wood  = lumberMaps(TS(768));
  MAPS.corr  = corrugatedMaps(TS(512), 0.45, [124,118,110], 7);
  // кровля — выветренный оцинкованный профлист: меньше ржавых пятен и не такая яркая,
  // иначе потолок пестрит сильнее всего остального кадра
  MAPS.roof  = corrugatedMaps(TS(512), 0.3, [138,137,132], 6);
  MAPS.steel = steelMaps(TS(512), [112,106,98]);
  MAPS.panel = panelMaps(TS(768));
  MAPS.hazard = hazardMaps(256);

  // roughness берётся из карт; числовое значение работает множителем
  M.osb   = mk(MAPS.osb , [1,1], 1.05, {rough:1.0, hStrength:2.2, ao:.95, env:.28});
  M.osb2  = mk(MAPS.osb2, [1,1], 1.05, {rough:1.0, hStrength:2.2, ao:.95, env:.28});
  M.conc  = mk(MAPS.conc, [1,1], 0.80, {rough:1.0, ao:.95, env:.22, aoPower:1.15});
  M.wood  = mk(MAPS.wood, [1,1], 0.5, {rough:1.0, ao:.75, env:.28, hStrength:1.2});
  M.corr  = mk(MAPS.corr, [1,1], 1.20, {rough:1.0, metal:.25, side:THREE.DoubleSide, env:1.0, ao:.6});
  M.roof  = mk(MAPS.roof, [1,1], 1.15, {rough:1.0, metal:.15, side:THREE.DoubleSide, env:0.6, ao:.55});
  M.roof.color.setRGB(0.78, 0.78, 0.76);
  M.steel = mk(MAPS.steel,[1,1], 0.95, {rough:1.0, metal:.35, env:1.0, ao:.6});
  M.panel = mk(MAPS.panel,[1,1], 0.95, {rough:1.0, ao:.95, env:.25, aoPower:1.1});
  M.hazard = mk(MAPS.hazard,[1,1], 0.9, {rough:1.0, metal:.28, env:.8, ao:.7});

  // Крашеный металл: приглушённые, выгоревшие цвета вместо ярких «пластиковых».
  M.dark   = new THREE.MeshStandardMaterial({color:0x4a463f, roughness:.7, metalness:.3, envMapIntensity:1.1});
  M.darker = new THREE.MeshStandardMaterial({color:0x262320, roughness:.78, metalness:.45});
  M.rubber = new THREE.MeshStandardMaterial({color:0x1a1b1d, roughness:.94, metalness:.03});
  M.plastO = new THREE.MeshStandardMaterial({color:0x9c5734, roughness:.66, metalness:.05});
  M.plastB = new THREE.MeshStandardMaterial({color:0x3a5470, roughness:.66, metalness:.06});
  M.paintG = new THREE.MeshStandardMaterial({color:0x4e5a46, roughness:.68, metalness:.22});
  M.paintY = new THREE.MeshStandardMaterial({color:0xa88a4c, roughness:.66, metalness:.25});
  // Без transmission: он требует отдельного прохода рендера, стоит дорого и
  // на части драйверов роняет кадр в чёрный. Грязное стекло даёт тот же вид дешевле.
  M.glass  = new THREE.MeshStandardMaterial({
    color:0xc4cfd6, roughness:.46, metalness:0, side:THREE.DoubleSide,
    transparent:true, opacity:.78, emissive:0xd8dee4, emissiveIntensity:0.42,
    map: T(dirtyGlassMaps(TS(256)), 1, 1)
  });
  M.tarp   = new THREE.MeshStandardMaterial({color:0x545a52, roughness:.92, side:THREE.DoubleSide});
  M.foam   = new THREE.MeshStandardMaterial({color:0xbdb6a4, roughness:.97});
  M.cable  = new THREE.MeshStandardMaterial({color:0x222326, roughness:.82});
  M.dirt   = new THREE.MeshStandardMaterial({color:0x6a6154, roughness:.98});

  /* --- Материалы техники: машины, вертолёт, флаг --- */
  // Автоэмаль: гладкая, с ясным зеркальным откликом, но выгоревшая и в пыли.
  const carPaint = (col)=> new THREE.MeshStandardMaterial({
    color:col, roughness:.42, metalness:.42, envMapIntensity:1.15 });
  M.carRed   = carPaint(0x7d2c26);
  M.carBlue  = carPaint(0x2c4257);
  M.carWhite = carPaint(0x9a9a94);
  M.carSand  = carPaint(0x8a7a52);
  M.carGreen = carPaint(0x3f4a38);
  M.carBlack = carPaint(0x1e1f22);
  // Кузовное стекло: тонированное, почти непрозрачное снаружи.
  M.carGlass = new THREE.MeshStandardMaterial({
    color:0x2a3138, roughness:.16, metalness:.2, envMapIntensity:1.6,
    transparent:true, opacity:.82, side:THREE.DoubleSide });
  M.chrome   = new THREE.MeshStandardMaterial({color:0xb4b8bc, roughness:.24, metalness:.92, envMapIntensity:1.6});
  M.lightRed = new THREE.MeshStandardMaterial({color:0x8c211c, roughness:.22, metalness:.1,
    emissive:0x3a0806, emissiveIntensity:.5, transparent:true, opacity:.9});
  M.lightAmb = new THREE.MeshStandardMaterial({color:0xb2761e, roughness:.22, metalness:.1,
    emissive:0x452c06, emissiveIntensity:.5, transparent:true, opacity:.9});
  M.headlamp = new THREE.MeshStandardMaterial({color:0xcfd3d2, roughness:.12, metalness:.35,
    emissive:0x23262a, emissiveIntensity:.3, envMapIntensity:1.8});
  M.heliBody = new THREE.MeshStandardMaterial({color:0x37443a, roughness:.5, metalness:.38, envMapIntensity:1.1});
  M.heliTrim = new THREE.MeshStandardMaterial({color:0x9a3a22, roughness:.52, metalness:.3});
  M.heliGlass= new THREE.MeshStandardMaterial({
    color:0x86949c, roughness:.1, metalness:.05, envMapIntensity:1.5,
    transparent:true, opacity:.5, side:THREE.DoubleSide });
  M.flag = new THREE.MeshStandardMaterial({
    map: flagTex(TS(512),TS(320)), roughness:.95, metalness:0,
    side:THREE.DoubleSide, transparent:true, alphaTest:0.35 });
  // helipadTex/parkingTex уже возвращают Texture — оборачивать их в T() нельзя,
  // иначе CanvasTexture получает не canvas и поверхность выходит чёрной.
  M.helipad = new THREE.MeshStandardMaterial({
    map: helipadTex(TS(1024)), roughness:.93, metalness:.03, envMapIntensity:.3 });
  M.parkLine = new THREE.MeshStandardMaterial({
    map: parkingTex(TS(1024)), transparent:true, depthWrite:false, roughness:.92, metalness:0,
    polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3 });
}
/** Кэш простых цветных материалов. Отдельный материал на каждый объект
    ломает слияние: две одинаковые бочки попадали бы в разные вызовы. */
const _matCache = new Map();
function cmat(color, o={}){
  const key = color+'|'+JSON.stringify(o);
  let m = _matCache.get(key);
  if(!m){
    m = new THREE.MeshStandardMaterial(Object.assign({color}, o));
    _matCache.set(key, m);
  }
  return m;
}

/* ---------------------------------------------------------------------------
   ОБУГЛИВАНИЕ ДЕРЕВА
   Каждая вершина деревянной геометрии несёт aBurn = (обугленность, жар).
   Обугленность только растёт: древесина сначала темнеет до коричневого,
   затем чернеет и растрескивается «крокодиловой кожей». Жар — отдельный
   канал: пока он выше нуля, трещины тлеют оранжевым и мерцают, а когда
   огонь уходит, остывают — уголь остаётся чёрным.
--------------------------------------------------------------------------- */
const BURN_U = { uTime:{value:0} };
function makeBurnable(mat){
  mat.userData.burnable = true;
  mat.onBeforeCompile = (sh)=>{
    sh.uniforms.uTime = BURN_U.uTime;
    sh.uniforms.uGrime = { value: mat.userData.grime ? 1 : 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aBurn; varying vec2 vBurn; varying vec3 vBurnPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBurn = aBurn; vBurnPos = (modelMatrix*vec4(transformed,1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uGrime; varying vec2 vBurn; varying vec3 vBurnPos;
        float bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        float bnoise(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(bh(i),bh(i+vec3(1,0,0)),f.x), mix(bh(i+vec3(0,1,0)),bh(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(bh(i+vec3(0,0,1)),bh(i+vec3(1,0,1)),f.x), mix(bh(i+vec3(0,1,1)),bh(i+vec3(1,1,1)),f.x),f.y), f.z); }
        // «крокодиловая кожа» угля: расстояние до границы ячеек Вороного
        float cracks(vec3 p){ vec3 i=floor(p), f=fract(p); float d1=8.0, d2=8.0;
          for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++){
            vec3 g=vec3(x,y,z); vec3 o=vec3(bh(i+g),bh(i+g+7.1),bh(i+g+3.3));
            float d=length(g+o-f); if(d<d1){d2=d1;d1=d;} else if(d<d2) d2=d; }
          return d2-d1; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if(uGrime > 0.5){
          // обшивка: крупные пятна тона ломают повтор текстуры, у пола — грязь
          // и брызги, по листам — редкие вертикальные подтёки
          float gM = bnoise(vBurnPos*0.45)*0.6 + bnoise(vBurnPos*1.7)*0.4;
          diffuseColor.rgb *= 0.82 + 0.34*gM;
          float gY = vBurnPos.y < ${(F2 - 0.15).toFixed(3)} ? vBurnPos.y : vBurnPos.y - ${F2.toFixed(3)};
          float gN = bnoise(vec3(vBurnPos.x*3.1, vBurnPos.y*1.4, vBurnPos.z*3.1));
          float gGround = 1.0 - smoothstep(0.0, 0.35 + 0.45*gN, gY);
          float gStreak = smoothstep(0.6, 0.85, bnoise(vec3(vBurnPos.x*7.0, vBurnPos.y*0.22, vBurnPos.z*7.0)))
                        * smoothstep(0.4, 0.75, bnoise(vBurnPos*0.55 + 3.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.55,0.5,0.44), clamp(gGround*0.8 + gStreak*0.4, 0.0, 0.85));
        }
        float bN = bnoise(vBurnPos*5.0)*0.6 + bnoise(vBurnPos*17.0)*0.4;
        float bChar = clamp(vBurn.x*1.25 + (bN-0.5)*0.35, 0.0, 1.0);
        float bScorch = smoothstep(0.02, 0.35, bChar);
        float bBlack = smoothstep(0.35, 0.8, bChar);
        float bCr = cracks(vBurnPos*vec3(9.0,4.5,9.0));
        vec3 scorchCol = diffuseColor.rgb*vec3(0.52,0.36,0.22);
        vec3 charCol = mix(vec3(0.028,0.024,0.021), vec3(0.075,0.066,0.058), smoothstep(0.02,0.14,bCr));
        diffuseColor.rgb = mix(diffuseColor.rgb, scorchCol, bScorch);
        diffuseColor.rgb = mix(diffuseColor.rgb, charCol, bBlack);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.97, bScorch);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float bHeat = vBurn.y * bBlack;
        float bFl = 0.65 + 0.35*sin(uTime*7.0 + bN*20.0)*sin(uTime*3.1 + bN*9.0);
        // светятся только тонкие трещины угля, и то пятнами — сплошной «лавы» нет
        float bPatch = smoothstep(0.35, 0.75, bnoise(vBurnPos*3.0 + uTime*0.15));
        float bEmb = (1.0 - smoothstep(0.0, 0.045, bCr)) * bHeat * bFl * (0.25 + 0.75*bPatch);
        totalEmissiveRadiance += vec3(1.0,0.30,0.05) * (bEmb*3.2 + bHeat*bHeat*0.06*bFl);`);
  };
  mat.customProgramCacheKey = ()=> 'burn1';
  return mat;
}

/** Дополнительные материалы: командные флаги, решётка, декали, эффекты. */
const FX = {};
function buildExtraMaterials(){
  M.osb.color.setRGB(0.9, 0.86, 0.8); M.osb2.color.setRGB(0.84, 0.8, 0.74); M.wood.color.setRGB(0.82, 0.76, 0.68);
  for(const m of [M.osb, M.osb2, M.wood]){ m.envMapIntensity = 0.12; }
  M.osb.userData.grime = M.osb2.userData.grime = true;
  makeBurnable(M.osb); makeBurnable(M.osb2); makeBurnable(M.wood);
  // брус и фанера под покраску для укрытий: та же древесина, свой тон
  M.woodDark = makeBurnable(M.wood.clone()); M.woodDark.color = new THREE.Color(0x8a7a62);
  M.plywood  = makeBurnable(M.osb.clone());  M.plywood.color  = new THREE.Color(0xc9b793); M.plywood.userData.grime = true;

  M.flagAlpha = new THREE.MeshStandardMaterial({ map: teamFlagTex('ALPHA', TS(1024), TS(640)),
    roughness:.9, side:THREE.DoubleSide, alphaTest:0.4 });
  M.flagDelta = new THREE.MeshStandardMaterial({ map: teamFlagTex('DELTA', TS(1024), TS(640)),
    roughness:.92, side:THREE.DoubleSide, alphaTest:0.4 });

  const gr = gratingMaps(256);
  const grA = T(gr.albedo, 1, 1);
  M.grating = new THREE.MeshStandardMaterial({ map: grA, alphaTest:0.5, side:THREE.DoubleSide,
    normalMap: T(heightToNormal(gr.height, 3.0),1,1,false), roughness:.62, metalness:.55, envMapIntensity:.9 });

  // Сетка габиона (HESCO): проволочная решётка поверх мешка с песком.
  M.hesco = new THREE.MeshStandardMaterial({ color:0x8f8466, roughness:.96, metalness:0 });
  M.hescoMesh = new THREE.MeshStandardMaterial({ map: grA, alphaTest:0.5, color:0xb0aca4,
    roughness:.5, metalness:.7, side:THREE.DoubleSide });
  M.sand = new THREE.MeshStandardMaterial({ color:0x8c7c5c, roughness:1 });
  M.sandbag = new THREE.MeshStandardMaterial({ color:0x77704f, roughness:.97 });

  // Командные цвета: окраска укрытий, разметка и подсветка баз.
  M.teamA = new THREE.MeshStandardMaterial({ color:0x2a2c30, roughness:.6, metalness:.35 });
  M.teamD = new THREE.MeshStandardMaterial({ color:0x4f5a3a, roughness:.7, metalness:.2 });
  const [cc] = camoCanvas(512, 512, ['#6b6a4b','#4d5536','#8a7d58','#3a3d2a','#a39873'], 0.9);
  M.camo = new THREE.MeshStandardMaterial({ map: texOf(cc), roughness:.95 });
  M.stripeA = new THREE.MeshStandardMaterial({ color:0xd8dde2, roughness:.6, emissive:0x9ab4d8, emissiveIntensity:0.0 });
  M.stripeD = new THREE.MeshStandardMaterial({ color:0x9cc27a, roughness:.6, emissive:0x7ab04c, emissiveIntensity:0.0 });

  // Декали повреждений: общий атлас, один материал — один вызов на все дырки.
  FX.decalTex = decalAtlas(TS(1024));
  M.decal = new THREE.MeshStandardMaterial({ map: FX.decalTex, transparent:true, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4, roughness:.95, alphaTest:0.02 });
  const cr = craterMaps(TS(512));
  M.crater = new THREE.MeshStandardMaterial({ map: cr.map, normalMap: cr.normal, normalScale:new THREE.Vector2(2.2,2.2),
    transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, roughness:1 });
  M.concChunk = M.conc;
  M.ember = new THREE.MeshStandardMaterial({ color:0x1a1512, roughness:1, emissive:0xff5a14, emissiveIntensity:1.6 });

  FX.flame = flameTex(128);
  FX.smoke = smokeTex(128);
  FX.glow  = glowTex(64);
  FX.flameAtlas = flameAtlas(Q.tex >= 0.75 ? 128 : 64);
  FX.smokeAtlas = smokeAtlas(Q.tex >= 0.75 ? 128 : 96);
}
function buildAllMaterials(){ buildMaterials(); buildExtraMaterials(); }

// Сборка статической геометрии: вёдра по материалам, запекание по ячейкам,
// реестр коллайдеров (ориентированные боксы → статические тела Ammo).

const BUCKET = new Map();
/** Коллайдеры. Формат: {cx,cy,cz, hx,hy,hz, q:[x,y,z,w]|null, surf, x0..z1 (AABB)}.
    Старый формат {x0,y0,z0,x1,y1,z1} тоже принимается и переводится в бокс. */
const COLLIDERS = [];
const bucket = k => { if(!BUCKET.has(k)) BUCKET.set(k,[]); return BUCKET.get(k); };
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e$1 = new THREE.Euler(), _v = new THREE.Vector3();

/** Материал поверхности для попаданий и звука шагов. */
function surfOf(matKey){
  if(!matKey) return 'conc';
  if(/osb|wood|ply/i.test(matKey)) return 'wood';
  if(/steel|dark|corr|roof|grating|hazard|chrome|teamA|teamD/i.test(matKey)) return 'metal';
  if(/sand|bag|hesco|tarp|dirt/i.test(matKey)) return 'sand';
  if(/glass/i.test(matKey)) return 'glass';
  return 'conc';
}

/** UV по мировому размеру: текстура не растягивается на больших гранях. */
function uvBox(g, sx,sy,sz, d, alignGrain){
  const uv = g.attributes.uv;
  const s = [[sz,sy],[sz,sy],[sx,sz],[sx,sz],[sx,sy],[sx,sy]];
  for(let f=0; f<6; f++) for(let i=0;i<4;i++){
    const k = f*4+i;
    let u = uv.getX(k)*s[f][0]*d, v = uv.getY(k)*s[f][1]*d;
    if(alignGrain && s[f][1] > s[f][0]){ const t=u; u=v; v=t; }
    uv.setXY(k, u, v);
  }
  uv.needsUpdate = true;
}
function tintGeo(g, r, gg, b){
  const n = g.attributes.position.count;
  const col = new Float32Array(n*3);
  for(let i=0;i<n;i++){ col[i*3]=r; col[i*3+1]=gg; col[i*3+2]=b; }
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  return g;
}
/** Бокс в ведро материала. o.rotX/Y/Z — поворот, o.collide=false — без коллайдера,
    o.tint — вершинный цвет, o.d — плотность UV, o.surf — тип поверхности. */
function addBox(mat, cx,cy,cz, sx,sy,sz, o={}){
  const g = new THREE.BoxGeometry(sx,sy,sz);
  uvBox(g, sx,sy,sz, o.d ?? 0.5, o.grain);
  if(o.rotY || o.rotX || o.rotZ){ _e$1.set(o.rotX||0, o.rotY||0, o.rotZ||0, o.order||'XYZ'); _q.setFromEuler(_e$1); }
  else _q.identity();
  _m4.compose(_v.set(cx,cy,cz), _q, new THREE.Vector3(1,1,1));
  g.applyMatrix4(_m4);
  if(o.tint) tintGeo(g, o.tint[0], o.tint[1], o.tint[2]);
  bucket(mat).push(g);
  if(o.collide !== false){
    addOBB(cx,cy,cz, sx,sy,sz, (o.rotY||o.rotX||o.rotZ) ? _q.clone() : null, o.surf || surfOf(mat), o);
  }
  return g;
}
/** Ориентированный коллайдер. q — THREE.Quaternion или null. */
function addOBB(cx,cy,cz, sx,sy,sz, q=null, surf='conc', extra={}){
  const hx=sx/2, hy=sy/2, hz=sz/2;
  const c = {cx,cy,cz,hx,hy,hz, q: q ? [q.x,q.y,q.z,q.w] : null, surf};
  if(extra.noPlayer) c.noPlayer = true;
  if(extra.playerOnly) c.playerOnly = true;
  // AABB для быстрых запросов (опоры реквизита, миникарта)
  if(q){
    const m = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).elements;
    const ex = Math.abs(m[0])*hx + Math.abs(m[3])*hy + Math.abs(m[6])*hz;
    const ey = Math.abs(m[1])*hx + Math.abs(m[4])*hy + Math.abs(m[7])*hz;
    const ez = Math.abs(m[2])*hx + Math.abs(m[5])*hy + Math.abs(m[8])*hz;
    Object.assign(c, {x0:cx-ex,y0:cy-ey,z0:cz-ez,x1:cx+ex,y1:cy+ey,z1:cz+ez});
  } else Object.assign(c, {x0:cx-hx,y0:cy-hy,z0:cz-hz,x1:cx+hx,y1:cy+hy,z1:cz+hz});
  COLLIDERS.push(c);
  return c;
}
/** Коллайдер по центру, размерам и повороту вокруг Y (точный, без раздувания AABB). */
function addAABB(cx,cy,cz,sx,sy,sz,rotY=0,surf='conc'){
  return addOBB(cx,cy,cz,sx,sy,sz, rotY ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotY) : null, surf);
}
/** Нормализует коллайдер старого формата (только AABB). */
function normCollider(c){
  if(c.hx !== undefined) return c;
  c.cx=(c.x0+c.x1)/2; c.cy=(c.y0+c.y1)/2; c.cz=(c.z0+c.z1)/2;
  c.hx=(c.x1-c.x0)/2; c.hy=(c.y1-c.y0)/2; c.hz=(c.z1-c.z0)/2; c.q=null; c.surf=c.surf||'conc';
  return c;
}
/** Бокс между двумя точками (раскосы, поручни, косоуры). */
function beamBetween(mat, a, b, w, h, o={}){
  const dir = new THREE.Vector3().subVectors(b,a), len = dir.length();
  const g = new THREE.BoxGeometry(w, h, len);
  uvBox(g, w, h, len, o.d ?? 1.0, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), dir.normalize());
  if(o.roll){ q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), o.roll)); }
  const mid = new THREE.Vector3().addVectors(a,b).multiplyScalar(0.5);
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1,1,1)));
  if(o.tint) tintGeo(g, ...o.tint);
  bucket(mat).push(g);
  if(o.collide) addOBB(mid.x,mid.y,mid.z, w,h,len, q, o.surf || surfOf(mat));
  return g;
}

/* ---------------------------------------------------------------------------
   ЗАПЕКАНИЕ СТАТИКИ
   Геометрия сливается по «материал + ячейка 18 м (+ группа)». Геометрии с
   userData.onBaked узнают свой диапазон вершин в общем буфере: так
   разрушаемые куски остаются адресуемыми без отдельных мешей.
--------------------------------------------------------------------------- */
// Крупная ячейка: вызов отрисовки дороже лишних вершин за кадром, особенно
// на слабых машинах, где WebGL упирается в процессор, а не в видеокарту.
const BAKE_CELL = 60;
/* ---------------------------------------------------------------------------
   ПАЛИТРА: простые цветные материалы (без текстур, прозрачности и свечения)
   с одинаковыми шероховатостью/металличностью сливаются в один материал,
   а их цвет уходит в цвет вершин. Сотня cmat(...) превращается в десяток
   материалов, и реквизит разных цветов рисуется одним вызовом.
--------------------------------------------------------------------------- */
const PALETTE = new Map();
function isPlainMat(m){
  return m && m.type === 'MeshStandardMaterial' && !m.map && !m.normalMap && !m.roughnessMap && !m.metalnessMap &&
    !m.aoMap && !m.emissiveMap && !m.alphaMap && !m.transparent && !(m.alphaTest > 0) && m.emissive.getHex() === 0 &&
    !m.userData.burnable && !m.userData.noPalette;
}
function paletteMat(m){
  // грубые ступени: разница в 0.05 шероховатости на глаз не видна, а материалов втрое меньше
  const rq = Math.round(m.roughness*6)/6, mq = m.metalness < 0.15 ? 0.05 : (m.metalness < 0.6 ? 0.35 : 0.85);
  const key = [rq.toFixed(2), mq, m.side].join('|');
  let pm = PALETTE.get(key);
  if(!pm){
    pm = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:rq, metalness:mq,
      envMapIntensity: mq > 0.5 ? 1.2 : 0.9, side:m.side, vertexColors:true });
    pm.name = 'palette:' + key; PALETTE.set(key, pm);
  }
  return pm;
}
function toPalette(e){
  if(!isPlainMat(e.mat)) return;
  const g = e.geo, n = g.attributes.position.count, c = e.mat.color;
  const src = g.attributes.color, col = new Float32Array(n*3);
  for(let i=0;i<n;i++){
    const r = src ? src.getX(i) : 1, gg = src ? src.getY(i) : 1, b = src ? src.getZ(i) : 1;
    col[i*3] = r*c.r; col[i*3+1] = gg*c.g; col[i*3+2] = b*c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  e.mat = paletteMat(e.mat);
}
/** Тени статики: всё неразрушаемое, что отбрасывает тень, сливается в одну
    копию только из позиций (слой LAYER_SHADOW — её видит лишь камера тени).
    Мелочь меньше SMALL_CASTER тени не даёт вовсе. */
const SHADOW_SRC = { front:[], double:[] };
const SMALL_CASTER = 0.22;
const KEEP = new Set(['position','normal','uv','color','aBurn']);
function unifyIndexing(list){
  if(!list.some(g=>!g.index)) return list;
  return list.map(g=>{
    if(!g.index) return g;
    const out = g.toNonIndexed(); out.userData = g.userData; return out;
  });
}
function normalizeAttrs(list, withColor, withBurn){
  for(const g of list){
    for(const k of Object.keys(g.attributes)) if(!KEEP.has(k)) g.deleteAttribute(k);
    if(!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if(!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n*2), 2));
    if(withColor && !g.attributes.color) tintGeo(g,1,1,1);
    if(!withColor && g.attributes.color) g.deleteAttribute('color');
    if(withBurn && !g.attributes.aBurn) g.setAttribute('aBurn', new THREE.BufferAttribute(new Float32Array(n*2), 2));
    if(!withBurn && g.attributes.aBurn) g.deleteAttribute('aBurn');
  }
}
function bakeGroups(entries, tag){
  for(const e of entries){
    toPalette(e);
    if(e.cast){ e.geo.computeBoundingSphere(); if(e.geo.boundingSphere.radius < SMALL_CASTER && !(e.geo.userData && e.geo.userData.onBaked)) e.cast = false; }
  }
  const needColor = new Set();
  for(const e of entries) if(e.geo.attributes.color) needColor.add(e.mat.uuid);
  const cells = new Map();
  const _c = new THREE.Vector3();
  for(const e of entries){
    e.geo.computeBoundingSphere();
    _c.copy(e.geo.boundingSphere.center);
    const grp = (e.geo.userData && e.geo.userData.group) || '';
    // две половины ангара (запад/восток): меньше вызовов, но отсечение по взгляду остаётся
    const key = e.mat.uuid+'|'+Math.floor(_c.x/BAKE_CELL)+'|'+Math.floor((_c.z + 45)/90)
              +'|'+(e.cast?1:0)+(e.recv?1:0)+'|'+(e.order||0)+'|'+grp;
    let c = cells.get(key);
    if(!c){ c = {mat:e.mat, cast:e.cast, recv:e.recv, order:e.order||0, list:[]}; cells.set(key,c); }
    c.list.push(e.geo);
  }
  let made = 0;
  for(const c of cells.values()){
    const wc = needColor.has(c.mat.uuid);
    if(wc) c.mat.vertexColors = true;
    const wb = !!c.mat.userData.burnable;
    normalizeAttrs(c.list, wc, wb);
    c.list = unifyIndexing(c.list);
    let off = 0; const hooks = [];
    for(const g of c.list){
      const n = g.attributes.position.count;
      if(g.userData && g.userData.onBaked) hooks.push([g.userData.onBaked, off, n]);
      off += n;
    }
    const merged = c.list.length === 1 ? c.list[0] : BGU.mergeGeometries(c.list, false);
    if(!merged){ console.warn('merge failed', c.mat.name); continue; }
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const mesh = new THREE.Mesh(merged, c.mat);
    mesh.castShadow = c.cast; mesh.receiveShadow = c.recv;
    mesh.renderOrder = c.order; mesh.name = tag;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh); made++;
    // неразрушаемое (нет диапазонов для обрушения) и без альфа-среза — в общую тень
    if(c.cast && !hooks.length && !c.mat.alphaMap && !(c.mat.alphaTest > 0) && !c.mat.transparent){
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', merged.attributes.position);
      if(merged.index) pg.setIndex(merged.index);
      (c.mat.side === THREE.FrontSide ? SHADOW_SRC.front : SHADOW_SRC.double).push(pg);
      mesh.castShadow = false;
    }
    for(const [fn, start, count] of hooks) fn(mesh, start, count);
  }
  return made;
}
function buildShadowProxy(){
  let n = 0;
  for(const [list, side] of [[SHADOW_SRC.front, THREE.FrontSide], [SHADOW_SRC.double, THREE.DoubleSide]]){
    if(!list.length) continue;
    const idx = list.every(g=> g.index);
    const geo = BGU.mergeGeometries(idx ? list : list.map(g=> g.index ? g.toNonIndexed() : g), false);
    list.length = 0;
    if(!geo) continue;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side, colorWrite:false }));
    m.name = 'baked_shadow'; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    m.matrixAutoUpdate = false; m.userData.nomerge = true; m.layers.set(LAYER_SHADOW);
    scene.add(m); n++;
  }
  sun.shadow.camera.layers.enable(LAYER_SHADOW);
  return n;
}
function flushBuckets(){
  const entries = [];
  for(const [k, arr] of BUCKET){
    const mat = M[k];
    if(!mat){ console.warn('no material', k); arr.length = 0; continue; }
    for(const g of arr) entries.push({geo:g, mat, cast: !(g.userData&&g.userData.noShadow), recv:true, order:0});
    arr.length = 0;
  }
  for(const e of PROP_BAKE) entries.push(e);
  PROP_BAKE.length = 0;
  return bakeGroups(entries, 'baked_bucket');
}
/** Второй проход: сливает отдельные Mesh, добавленные в сцену напрямую.
    Всё, что двигается или разрушается, помечено userData.nomerge. */
function bakeScene(){
  const loose = [];
  scene.traverse(o=>{
    if(!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    let p = o, skip = false;
    while(p){ if(p.userData && p.userData.nomerge){ skip = true; break; } p = p.parent; }
    if(skip) return;
    if(o.name === 'sky' || o.name.startsWith('baked')) return;
    if(!o.geometry || !o.geometry.attributes.position) return;
    if(Array.isArray(o.material)) return;
    if(o.material.transparent && o.material.depthWrite === false) return;
    loose.push(o);
  });
  const entries = [];
  for(const o of loose){
    o.updateWorldMatrix(true, false);
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    entries.push({geo:g, mat:o.material, cast:o.castShadow, recv:o.receiveShadow, order:o.renderOrder});
  }
  for(const o of loose){
    o.removeFromParent();
  }
  const empties = [];
  scene.traverse(o=>{ if(o.isGroup && o.children.length===0 && !o.userData.nomerge) empties.push(o); });
  for(const o of empties){ o.removeFromParent(); }
  return bakeGroups(entries, 'baked_loose');
}

/* --- пространственная сетка по AABB коллайдеров (опоры, проверки) --- */
const GRID = new Map(), CELL = 4;
const gkey = (ix,iz)=> ix*10007 + iz;
function buildGrid(){
  GRID.clear();
  COLLIDERS.forEach((c,i)=>{
    normCollider(c);
    for(let ix=Math.floor(c.x0/CELL); ix<=Math.floor(c.x1/CELL); ix++)
      for(let iz=Math.floor(c.z0/CELL); iz<=Math.floor(c.z1/CELL); iz++){
        const k=gkey(ix,iz); if(!GRID.has(k)) GRID.set(k,[]); GRID.get(k).push(i);
      }
  });
}
function roundedBox(w,h,d,r=0.12,seg=3){
  r = Math.min(r, w/2-0.001, h/2-0.001, d/2-0.001);
  const g = new THREE.BoxGeometry(w,h,d, seg*2, seg*2, seg*2);
  const p = g.attributes.position;
  const hw=w/2-r, hh=h/2-r, hd=d/2-r;
  const v = new THREE.Vector3();
  for(let i=0;i<p.count;i++){
    v.fromBufferAttribute(p,i);
    // точка проецируется на поверхность скруглённого параллелепипеда
    const cx = clamp(v.x,-hw,hw), cy = clamp(v.y,-hh,hh), cz = clamp(v.z,-hd,hd);
    const dx=v.x-cx, dy=v.y-cy, dz=v.z-cz;
    const l = Math.hypot(dx,dy,dz);
    if(l > 1e-6) p.setXYZ(i, cx+dx/l*r, cy+dy/l*r, cz+dz/l*r);
  }
  g.computeVertexNormals();
  return g;
}
/** Колесо: покрышка с протектором + диск со спицами и ступицей. */
/** Меш без вершинного цвета на материале с vertexColors рисуется чёрным:
    добавляем белый цвет всем таким геометриям (реквизит, обломки, щепа). */
function ensureColor(o){
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if(!o.geometry || o.geometry.attributes.color) return;
  if(mats.some(m=>m && m.vertexColors)) tintGeo(o.geometry, 1, 1, 1);
}
function ensureColorGeo(g, mat){ if(mat && mat.vertexColors && !g.attributes.color) tintGeo(g, 1, 1, 1); }

// Ангар: пол, стены, остекление, фермы, кровля с проёмами, светильники.
/* ============================================================================
   АНГАР
   Кровля собирается из полос с реальными пропусками — сквозь них светит солнце.
============================================================================ */
const HW = 40, HD = 30;            // полуразмеры ангара (80 x 60 м)
const WALL_H = 5.6;                // верх бетонного цоколя + низ остекления
const EAVE = 9.2, RIDGE = 12.6;    // карниз и конёк
const roofY = z => EAVE + (RIDGE-EAVE)*(1 - Math.abs(z)/HD);
const LAMPS = [], SUNHOLES = [], WINDOWS = [];
const FLOOR_TILES = [];
/** Шаг колонн ангара. Из него же считаются фермы и ряды светильников. */
const COL_STEP = 7.5;
const COL_X = (()=>{
  const out = [], n = Math.floor((HW-4)/COL_STEP);
  for(let i=-n;i<=n;i++) out.push(i*COL_STEP);
  return out;
})();

function buildHangar(){
  /* --- пол: плиты 6x6 м с небольшим разбросом оттенка --- */
  for(let i=0;i<Math.ceil(HW*2/6);i++) for(let j=0;j<Math.ceil(HD*2/6);j++){
    const x0 = -HW + i*6, z0 = -HD + j*6;
    const x1 = Math.min(x0+6, HW), z1 = Math.min(z0+6, HD);
    // Случайный сдвиг И поворот UV на плиту: одинаковый тайл перестаёт читаться.
    const rot = Math.floor(srnd()*4)*Math.PI/2, cs=Math.cos(rot), sn=Math.sin(rot);
    const ou = srnd()*7, ov = srnd()*7;
    // геометрия плит строится в buildFloor(), когда известны выбоины и воронки
    FLOOR_TILES.push({x0, z0, x1, z1, cs, sn, ou, ov});
    // деформационный шов по краю плиты
    if(x1 < HW-0.01) addBox('darker', x1, 0.004, (z0+z1)/2, 0.035, 0.03, z1-z0, {collide:false, d:1});
    if(z1 < HD-0.01) addBox('darker', (x0+x1)/2, 0.004, z1, x1-x0, 0.03, 0.035, {collide:false, d:1});
  }
  COLLIDERS.push({x0:-HW-2,y0:-2,z0:-HD-2,x1:HW+2,y1:0,z1:HD+2});

  /* --- стены: бетонный цоколь, ленточное остекление, профлист фронтона --- */
  const GLASS_Y0 = WALL_H, GLASS_H = 2.3;
  const wallSeg = (cx,cz,sx,sz)=>{
    addBox('panel', cx, WALL_H/2, cz, sx, WALL_H, sz, {d:.30});
  };
  wallSeg(0, -HD, HW*2+0.4, .44);  wallSeg(0, HD, HW*2+0.4, .44);
  // торцевые стены с проёмом под приоткрытые ворота баз (z 0.4…2.0)
  for(const sx of [-1,1]){
    wallSeg(sx*HW, (-HD+0.4)/2, .44, HD+0.4);
    wallSeg(sx*HW, (2.0+HD)/2, .44, HD-2.0);
  }
  // Лента остекления — отдельные Plane без объёма: добавляем ей коллайдер,
  // иначе выше цоколя оболочка ангара дырявая.
  for(const s of [-1,1]){
    COLLIDERS.push({x0:-HW-0.3, y0:WALL_H, z0:s*HD-0.25, x1:HW+0.3, y1:EAVE, z1:s*HD+0.25});
    COLLIDERS.push({x0:s*HW-0.25, y0:WALL_H, z0:-HD-0.3, x1:s*HW+0.25, y1:EAVE, z1:HD+0.3});
  }

  // рама остекления + стёкла (длинные ленты под карнизом)
  function glazing(axis, sign){
    const along = axis==='x' ? HW : HD;
    const n = axis==='x' ? Math.round(HW*2/4.9) : Math.round(HD*2/4.9);
    for(let i=0;i<n;i++){
      const t = -along + (i+0.5)*(along*2/n);
      const wseg = (along*2/n) * 0.82;
      const px = axis==='x' ? t : sign*HW, pz = axis==='x' ? sign*HD : t;
      const yc = GLASS_Y0 + GLASS_H/2;
      const g = new THREE.PlaneGeometry(wseg, GLASS_H);
      const m = new THREE.Mesh(g, M.glass);
      m.position.set(px, yc, pz);
      m.rotation.y = axis==='x' ? (sign>0 ? Math.PI : 0) : (sign>0 ? -Math.PI/2 : Math.PI/2);
      m.userData.glass = {w:wseg, h:GLASS_H}; m.userData.nomerge = true;
      scene.add(m);
      WINDOWS.push({pos:new THREE.Vector3(px,yc,pz), axis, sign, w:wseg, h:GLASS_H});
      // переплёт
      const inw = axis==='x' ? 0 : -sign*0.06, ind = axis==='x' ? -sign*0.06 : 0;
      const cols = 5;
      for(let k=0;k<=cols;k++){
        const off = -wseg/2 + k*wseg/cols;
        const bx = axis==='x' ? px+off : px+inw, bz = axis==='x' ? pz+ind : pz+off;
        addBox('dark', bx, yc, bz, axis==='x'?0.05:0.1, GLASS_H, axis==='x'?0.1:0.05, {collide:false, d:1});
      }
      for(const yy of [GLASS_Y0+0.02, GLASS_Y0+GLASS_H-0.02]){
        const bx = axis==='x' ? px : px+inw, bz = axis==='x' ? pz+ind : pz;
        addBox('dark', bx, yy, bz, axis==='x'?wseg:0.1, 0.07, axis==='x'?0.1:wseg, {collide:false, d:1});
      }
    }
    // сплошной профлист между остеклением и карнизом
    const topY0 = GLASS_Y0 + GLASS_H, topH = EAVE - topY0;
    {
      if(axis==='x') addBox('corr', 0, topY0+topH/2, sign*HD, HW*2+0.4, topH, .3, {d:.45});
      else           addBox('corr', sign*HW, topY0+topH/2, 0, .3, topH, HD*2, {d:.45});
    }
  }
  glazing('x',-1); glazing('x',1); glazing('z',-1); glazing('z',1);

  // Фронтоны. Конёк идёт вдоль X, значит скат меняет высоту по Z —
  // треугольные щипцы закрывают торцы по X, а не по Z.
  for(const s of [-1,1]){
    const shape = new THREE.Shape();
    shape.moveTo(-HD, EAVE); shape.lineTo(HD, EAVE); shape.lineTo(0, RIDGE);
    const g = new THREE.ShapeGeometry(shape);
    const uv = g.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*0.42, uv.getY(i)*0.42);
    const m = new THREE.Mesh(g, M.corr);
    m.position.set(s*HW, 0, 0);
    m.rotation.y = s>0 ? Math.PI/2 : -Math.PI/2;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);    // стойки щипца
    for(const zz of [-HD*0.5, 0, HD*0.5]){
      const top = roofY(zz);
      if(top - EAVE < 0.15) continue;
      addBox('steel', s*HW, (EAVE+top)/2, zz, 0.2, top-EAVE, 0.14, {collide:false, d:1.2});
    }
  }
  // по торцам Z скат заканчивается на карнизе — там простой парапет
  for(const s of [-1,1]) addBox('corr', 0, EAVE+0.18, s*HD, HW*2+0.4, 0.36, 0.3, {collide:false, d:.6});

  /* --- каркас: колонны, фермы, прогоны --- */
  const colX = COL_X;
  for(const cx of colX){
    for(const cz of [-HD+0.6, HD-0.6]){
      // двутавр из трёх пластин
      addBox('steel', cx, EAVE/2, cz, 0.42, EAVE, 0.10, {d:1.1});
      addBox('steel', cx, EAVE/2, cz-0.14, 0.14, EAVE, 0.28, {collide:false, d:1.1});
      addBox('steel', cx, EAVE/2, cz+0.14, 0.14, EAVE, 0.28, {collide:false, d:1.1});
      addBox('dark', cx, 0.12, cz, 0.62, 0.24, 0.62, {d:1.2});       // база
      addBox('steel', cx, EAVE-0.5, cz + (cz<0?0.55:-0.55), 0.3, 0.9, 1.3, {collide:false, d:1});
    }
  }
  // стропильные фермы поперёк ангара
  for(const cx of colX){
    const segs = Math.round(HD*2/2.7);
    for(let i=0;i<segs;i++){
      const z0 = -HD + i*(HD*2/segs), z1 = -HD + (i+1)*(HD*2/segs);
      const y0 = roofY(z0), y1 = roofY(z1);
      // верхний пояс
      const len = Math.hypot(z1-z0, y1-y0);
      const g = new THREE.BoxGeometry(0.16, 0.20, len);
      uvBox(g, 0.16,0.2,len, 1.2);
      _e$1.set(Math.atan2(y1-y0, z1-z0)*-1, 0, 0); _q.setFromEuler(_e$1);
      _m4.compose(new THREE.Vector3(cx,(y0+y1)/2-0.12,(z0+z1)/2), _q, new THREE.Vector3(1,1,1));
      g.applyMatrix4(_m4); bucket('steel').push(g);
      // нижний пояс и раскосы
      const by = EAVE - 0.15;
      addBox('steel', cx, by, (z0+z1)/2, 0.14, 0.16, z1-z0, {collide:false, d:1.2});
      const dy = (y0+y1)/2 - 0.2 - by;
      if(dy > 0.25){
        addBox('steel', cx, by + dy/2, (z0+z1)/2, 0.09, dy, 0.09, {collide:false, d:1.2});
        const dl = Math.hypot(dy, (z1-z0));
        const gd = new THREE.BoxGeometry(0.07, 0.07, dl); uvBox(gd,0.07,0.07,dl,1.2);
        _e$1.set(Math.atan2(dy, z1-z0)*-1, 0, 0); _q.setFromEuler(_e$1);
        _m4.compose(new THREE.Vector3(cx, by+dy/2, (z0+z1)/2), _q, new THREE.Vector3(1,1,1));
        gd.applyMatrix4(_m4); bucket('steel').push(gd);
      }
    }
  }
  // продольные прогоны под кровлей
  const purlinN = Math.round(HD*2/2.1);
  for(let i=0;i<=purlinN;i++){
    const z = -HD + i*(HD*2/purlinN);
    addBox('steel', 0, roofY(z)-0.30, z, HW*2, 0.11, 0.13, {collide:false, d:1.4});
  }
  // горизонтальные связи по верху колонн
  for(const cz of [-HD+0.6, HD-0.6]) addBox('steel', 0, EAVE-0.15, cz, HW*2, 0.18, 0.14, {collide:false, d:1.4});
}

/* ============================================================================
   ПОЛ АНГАРА: плиты, выбоины, вмятины, трещины, воронки от взрывов.
   Выбоины и воронки — настоящая геометрия: в плите вырезано отверстие с
   рваной кромкой, под ним чаша, на дне крошка и торчащая арматура, у воронок
   вал выброса и копоть. Мелкие повреждения (сколы, вмятины, сетки трещин) —
   одна запечённая декальная сетка с картой нормалей. Всё вместе — 5 вызовов
   отрисовки на весь пол.
============================================================================ */
const PITS = [];
// своё зерно: общий генератор не трогаем, иначе съедет вся расстановка карты
let _fseed = 7331;
const frnd = ()=>{ _fseed = (_fseed*1664525 + 1013904223) >>> 0; return _fseed/4294967296; };
const fr = (a,b)=> a + frnd()*(b-a);
const PIT_SEG = 28;
function pitRadius(p, a){
  const h = p.h;
  return p.R*(1 + h[0]*Math.sin(a*3 + h[1]) + h[2]*Math.sin(a*5 + h[3]) + h[4]*Math.sin(a*11 + h[5]));
}
/** Профиль чаши: 0 на кромке (f=1) … 1 в центре. */
function pitProfile(f, kind){
  if(kind === 'crater') return Math.pow(Math.max(0, 1 - f*f), 0.85);
  return 1 - smoothstep(0.55, 1.0, f);            // выбоина: плоское дно, крутые рваные стенки
}
/** Глубина пола (≤ 0) в точке: декали и огонь ложатся на дно ямы. */
function floorDepthAt(x, z){
  for(const p of PITS){
    const dx = x - p.x, dz = z - p.z, d2 = dx*dx + dz*dz;
    if(d2 > p.Rmax*p.Rmax) continue;
    const f = Math.sqrt(d2)/pitRadius(p, Math.atan2(dz, dx));
    if(f < 1) return -p.depth*pitProfile(f, p.kind);
  }
  return 0;
}
/** Свободно ли место под яму: не под укрытием, не на разметке, не у стен. */
function pitSpotFree(x, z, r, rHole){
  if(Math.abs(x) > HW-2.5 || Math.abs(z) > HD-2.5) return false;
  if(Math.abs(x) < 16.4 && Math.abs(z) < 10.9) return false;                  // здание
  if(Math.abs(x) > 31.2 && Math.abs(z) < 5.6) return false;                   // навесы баз
  if(Math.abs(Math.abs(x) - 27) < 3.2 && Math.abs(z) < 11.5) return false;    // эмблемы и линии баз
  for(const [hx,hz] of [[-21,20.6],[21,-20.6]]) if(Math.hypot(x-hx, z-hz) < 7.6) return false;  // вертолётные площадки
  for(const d of DYN_PROPS) if(Math.hypot(x - d.mesh.position.x, z - d.mesh.position.z) < r + 1.0) return false;
  for(const p of PITS) if(Math.hypot(x-p.x, z-p.z) < r + p.Rmax + 1.2) return false;
  for(const c of COLLIDERS){
    if(c.y0 > 2.2 || c.y1 < 0.05 || c.x1 - c.x0 > 30 || c.z1 - c.z0 > 30) continue;
    const qx = clamp(x, c.x0, c.x1), qz = clamp(z, c.z0, c.z1);
    if(Math.hypot(x-qx, z-qz) < r + 0.7) return false;
  }
  // яма целиком в одной плите — через деформационный шов её не проводим
  const tx = ((x + HW) % 6 + 6) % 6, tz = ((z + HD) % 6 + 6) % 6;
  return tx > rHole + 0.3 && tx < 6 - rHole - 0.3 && tz > rHole + 0.3 && tz < 6 - rHole - 0.3;
}
function placePits(kind, pairs, R0, R1, d0, d1){
  for(let n=0, tries=0; n<pairs && tries<1500; tries++){
    const x = fr(-HW+3, HW-3), z = fr(-HD+3, HD-3), R = fr(R0, R1);
    const Rmax = R*(kind === 'crater' ? 1.55 : 1.3), rHole = R*1.25;
    if(!pitSpotFree(x, z, Rmax, rHole) || !pitSpotFree(-x, -z, Rmax, rHole)) continue;
    // пары центрально-симметричны, как и вся карта: у команд одинаковый пол
    for(const s of [1,-1]){
      PITS.push({kind, x:s*x, z:s*z, R, Rmax, depth: fr(d0, d1),
        h:[fr(0.05,0.12), fr(0,6.3), fr(0.03,0.08), fr(0,6.3), fr(0.015,0.04), fr(0,6.3)]});
    }
    n++;
  }
}
/** Атлас повреждений 2x2: скол-вмятина, сетка трещин, копоть взрыва, россыпь сколов. */
function floorDamageMaps(S){
  const C = S/2;
  const [c,x] = cv(S,S), [h,hx] = cv(S,S);
  x.clearRect(0,0,S,S); hx.fillStyle = 'rgb(128,128,128)'; hx.fillRect(0,0,S,S);
  const cell = (i, fn)=>{ const ox = (i%2)*C, oy = Math.floor(i/2)*C; x.save(); hx.save(); x.translate(ox,oy); hx.translate(ox,oy);
    x.beginPath(); x.rect(0,0,C,C); x.clip(); hx.beginPath(); hx.rect(0,0,C,C); hx.clip(); fn(C/2); x.restore(); hx.restore(); };
  const blob = (ctx, cx, cy, r, jag, fill)=>{ ctx.fillStyle = fill; ctx.beginPath();
    for(let k=0;k<=24;k++){ const a = k/24*6.283, rr = r*(1 + (frnd()-0.5)*jag); k ? ctx.lineTo(cx+Math.cos(a)*rr, cy+Math.sin(a)*rr) : ctx.moveTo(cx+Math.cos(a)*rr, cy+Math.sin(a)*rr); }
    ctx.closePath(); ctx.fill(); };
  const crackLine = (ctx, px, py, a, n, w, col)=>{ ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(px,py);
    for(let j=0;j<n;j++){ a += fr(-0.45,0.45); px += Math.cos(a)*fr(4,10)*S/512; py += Math.sin(a)*fr(4,10)*S/512; ctx.lineTo(px,py); } ctx.stroke(); return [px,py,a]; };
  // 0: скол-вмятина — неглубокая чаша с выкрошенной кромкой
  cell(0, m=>{
    for(let k=0;k<5;k++){ const g = hx.createRadialGradient(m,m,0,m,m,m*0.8);
      g.addColorStop(0,'rgba(70,70,70,.5)'); g.addColorStop(0.7,'rgba(100,100,100,.35)'); g.addColorStop(1,'rgba(128,128,128,0)');
      hx.fillStyle = g; hx.fillRect(0,0,m*2,m*2); }
    blob(x, m, m, m*0.62, 0.35, 'rgba(92,88,82,.55)');
    blob(x, m, m, m*0.42, 0.45, 'rgba(70,67,62,.55)');
    for(let k=0;k<70;k++){ const a = fr(0,6.28), r = m*fr(0.35,0.72);
      x.fillStyle = `rgba(${170+frnd()*30|0},${166+frnd()*30|0},${158+frnd()*30|0},${fr(.3,.7)})`;
      x.fillRect(m+Math.cos(a)*r, m+Math.sin(a)*r, fr(1,4)*S/512, fr(1,4)*S/512);
      hx.fillStyle = `rgba(60,60,60,${fr(.3,.7)})`; hx.fillRect(m+Math.cos(a)*r, m+Math.sin(a)*r, fr(2,5)*S/512, fr(2,5)*S/512); }
    for(let k=0;k<4;k++){ const a = fr(0,6.28); crackLine(x, m+Math.cos(a)*m*0.5, m+Math.sin(a)*m*0.5, a, 6, 0.8*S/512, 'rgba(44,42,38,.4)');
      crackLine(hx, m+Math.cos(a)*m*0.5, m+Math.sin(a)*m*0.5, a, 6, 2*S/512, 'rgba(40,40,40,.8)'); }
  });
  // 1: сетка трещин от удара
  cell(1, m=>{
    for(let k=0;k<9;k++){
      const a = k/9*6.283 + fr(-0.2,0.2);
      const [ex,ey,ea] = crackLine(x, m, m, a, 16, fr(0.7,1.3)*S/512, 'rgba(44,42,38,.5)');
      crackLine(hx, m, m, a, 16, fr(1.4,2.2)*S/512, 'rgba(40,40,40,.85)');
      if(frnd() < 0.7){ crackLine(x, ex, ey, ea + fr(0.6,1.2), 7, 0.6*S/512, 'rgba(44,42,38,.35)'); }
    }
    x.strokeStyle = 'rgba(44,42,38,.22)'; x.lineWidth = 0.7*S/512;
    for(const rr of [0.25, 0.45]){ x.beginPath(); for(let k=0;k<=18;k++){ const a = k/18*6.283, r = m*rr*(1+fr(-0.15,0.15)); k ? x.lineTo(m+Math.cos(a)*r, m+Math.sin(a)*r) : x.moveTo(m+Math.cos(a)*r, m+Math.sin(a)*r); } x.stroke(); }
    blob(x, m, m, m*0.1, 0.5, 'rgba(60,57,52,.6)');
  });
  // 2: копоть взрыва — тёмное ядро и лучи выброса
  cell(2, m=>{
    const g = x.createRadialGradient(m,m,0,m,m,m*0.95);
    g.addColorStop(0,'rgba(14,12,11,.92)'); g.addColorStop(0.35,'rgba(22,20,18,.75)'); g.addColorStop(0.7,'rgba(35,32,29,.3)'); g.addColorStop(1,'rgba(40,36,32,0)');
    x.fillStyle = g; x.fillRect(0,0,m*2,m*2);
    for(let k=0;k<70;k++){ const a = fr(0,6.283); x.strokeStyle = `rgba(16,14,12,${fr(.05,.18)})`; x.lineWidth = fr(3,14)*S/512;
      x.beginPath(); x.moveTo(m+Math.cos(a)*m*0.2, m+Math.sin(a)*m*0.2); x.lineTo(m+Math.cos(a)*m*fr(0.6,0.98), m+Math.sin(a)*m*fr(0.6,0.98)); x.stroke(); }
    for(let k=0;k<120;k++){ const a = fr(0,6.283), r = m*fr(0.3,0.9);
      x.fillStyle = `rgba(${120+frnd()*40|0},${115+frnd()*40|0},${105+frnd()*40|0},${fr(.2,.6)})`; x.fillRect(m+Math.cos(a)*r, m+Math.sin(a)*r, fr(1,3)*S/512, fr(1,3)*S/512); }
  });
  // 3: россыпь сколов и выщерблин
  cell(3, m=>{
    for(let k=0;k<26;k++){ const px = m + fr(-0.7,0.7)*m, py = m + fr(-0.7,0.7)*m, r = fr(3,14)*S/512;
      if(Math.hypot(px-m, py-m) > m*0.85) continue;
      const v = 84 + frnd()*24|0;
      blob(x, px, py, r, 0.6, `rgba(${v},${v-2},${v-6},.55)`);
      blob(hx, px, py, r, 0.6, 'rgba(70,70,70,.8)'); }
  });
  const nrm = heightToNormal(h, 5.0);
  const map = texOf(c), normal = texOf(nrm, false);
  map.anisotropy = normal.anisotropy = MAXA();
  return { map, normal };
}
function buildFloor(){
  // воронки первыми: им нужно больше места
  placePits('crater', 3, 1.0, 1.7, 0.2, 0.3);
  placePits('pothole', 6, 0.38, 0.72, 0.09, 0.15);

  /* --- плиты: у плит с ямами отверстие по кромке ямы --- */
  const tiles = [];
  for(const T_ of FLOOR_TILES){
    const {x0, z0, x1, z1, cs, sn, ou, ov} = T_;
    const inTile = PITS.filter(p=> p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);
    let g;
    if(!inTile.length){
      g = new THREE.PlaneGeometry(x1-x0, z1-z0); g.rotateX(-Math.PI/2); g.translate((x0+x1)/2, 0, (z0+z1)/2);
    } else {
      // ShapeGeometry лежит в XY; после поворота на −90° по X мировая z = −y
      const sh = new THREE.Shape();
      sh.moveTo(x0, -z1); sh.lineTo(x1, -z1); sh.lineTo(x1, -z0); sh.lineTo(x0, -z0); sh.closePath();
      for(const p of inTile){
        const hole = new THREE.Path();
        for(let i=0;i<PIT_SEG;i++){ const a = i/PIT_SEG*Math.PI*2, r = pitRadius(p, a);
          const px = p.x + Math.cos(a)*r, pz = p.z + Math.sin(a)*r;
          i ? hole.lineTo(px, -pz) : hole.moveTo(px, -pz); }
        hole.closePath(); sh.holes.push(hole);
      }
      g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI/2);
    }
    // UV в метрах от угла плиты (как у PlaneGeometry), со случайным сдвигом и поворотом
    const pa = g.attributes.position, uv = g.attributes.uv;
    for(let k=0;k<uv.count;k++){
      const u0 = (pa.getX(k) - x0)*0.42, v0 = (z1 - pa.getZ(k))*0.42;
      uv.setXY(k, u0*cs - v0*sn + ou, u0*sn + v0*cs + ov);
    }
    tiles.push(g);
  }
  const floor = new THREE.Mesh(BGU.mergeGeometries(tiles, false), M.conc);
  floor.receiveShadow = true; floor.name = 'floor';
  scene.add(floor);

  /* --- чаши ям, крошка, арматура --- */
  const pitPos = [], pitCol = [], pitUv = [], pitIdx = [];
  const rubble = [], rebar = [];
  const rock = (r, x, y, z)=>{ const g = new THREE.DodecahedronGeometry(r, 0);
    g.scale(fr(0.8,1.5), fr(0.45,0.85), fr(0.8,1.3)); g.rotateY(fr(0,6.28)); g.rotateX(fr(-0.4,0.4)); g.translate(x, y, z);
    rubble.push(g.index ? g.toNonIndexed() : g); };
  for(const p of PITS){
    const crater = p.kind === 'crater';
    const rings = crater ? [0, 0.2, 0.4, 0.58, 0.74, 0.86, 0.95, 1.0, 1.12, 1.26, 1.42]
                         : [0, 0.3, 0.5, 0.66, 0.78, 0.88, 0.95, 1.0];
    const base = pitPos.length/3, NS = PIT_SEG;
    for(let j=0;j<rings.length;j++){
      const f = rings[j];
      for(let i=0;i<NS;i++){
        const a = i/NS*Math.PI*2, r = pitRadius(p, a)*f;
        let y;
        if(f <= 1){
          y = f >= 1 ? 0 : -p.depth*pitProfile(f, p.kind)*(1 + (frnd()-0.5)*0.35);
          // рваная кромка: у самого края бетон выкрошен ступенькой
          if(f === 0.95) y = -p.depth*fr(0.25,0.55);
        } else {
          // вал выброса вокруг воронки — выше уровня пола
          const t = (f - 1)/0.42;
          y = (j === rings.length-1) ? 0.004 : 0.01 + 0.07*Math.sin(Math.PI*Math.min(1, t*1.15))*(0.6 + frnd()*0.7);
        }
        const jx = (f > 0 && f < 1) ? fr(-0.03,0.03) : 0, jz = (f > 0 && f < 1) ? fr(-0.03,0.03) : 0;
        const px = p.x + Math.cos(a)*r + jx, pz = p.z + Math.sin(a)*r + jz;
        pitPos.push(px, y, pz);
        // дно темнее (грязь, влага, тень), у воронки — копоть к центру
        let c = lerp(0.55, 1.0, Math.min(1, f));
        // воронка закопчена: чаша почти чёрная, вал — в серой пыли и саже
        if(crater) c = f <= 1 ? c*lerp(0.28, 0.62, f) : lerp(0.5, 0.86, (f - 1)/0.42)*(0.9 + 0.2*frnd());
        else if(f > 1) c *= 0.92;
        pitCol.push(c, c*0.98, c*0.95);
        pitUv.push(px*0.42, pz*0.42);
      }
    }
    for(let j=0;j<rings.length-1;j++) for(let i=0;i<NS;i++){
      const a = base + j*NS + i, b = base + j*NS + (i+1)%NS, c2 = base + (j+1)*NS + i, d = base + (j+1)*NS + (i+1)%NS;
      pitIdx.push(a, b, c2, b, d, c2);
    }
    // крошка на дне и по кромке, куски плиты у воронки
    const nIn = crater ? 22 : 9, nOut = crater ? 34 : 10;
    for(let k=0;k<nIn;k++){
      const a = fr(0,6.28), f = Math.sqrt(frnd())*0.85, r = pitRadius(p, a)*f, s = fr(0.025, crater ? 0.11 : 0.07);
      const x = p.x + Math.cos(a)*r, z = p.z + Math.sin(a)*r;
      rock(s, x, -p.depth*pitProfile(f, p.kind) + s*0.25, z);
    }
    for(let k=0;k<nOut;k++){
      const a = fr(0,6.28), f = fr(1.0, crater ? 1.9 : 1.5), r = pitRadius(p, a)*f, s = fr(0.02, crater ? 0.12 : 0.06)*(1.6 - f*0.4);
      rock(s, p.x + Math.cos(a)*r, s*0.25 + (crater && f < 1.42 ? 0.05 : 0), p.z + Math.sin(a)*r);
    }
    // арматурная сетка, обнажённая в выбоине и разорванная в воронке
    const bars = crater ? 4 : 2;
    for(let k=0;k<bars;k++){
      const a = fr(0, Math.PI), off = fr(-0.35,0.35)*p.R, L = p.R*fr(1.3, 1.9);
      const dx = Math.cos(a), dz = Math.sin(a);
      const cx = p.x - dz*off, cz = p.z + dx*off, y = -Math.min(0.06, p.depth*0.4);
      const g = new THREE.CylinderGeometry(0.007, 0.007, L, 5); g.rotateZ(Math.PI/2);
      if(crater){ const pa = g.attributes.position; for(let i=0;i<pa.count;i++){ const t = pa.getX(i)/L; pa.setY(i, pa.getY(i) + Math.abs(t)*0.3*fr(0.6,1.2)); } }
      g.rotateY(-a); g.translate(cx, y, cz);
      rebar.push(g.index ? g.toNonIndexed() : g);
    }
  }
  if(PITS.length){
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pitPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(pitCol, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(pitUv, 2));
    g.setIndex(pitIdx); g.computeVertexNormals();
    M.concPit = M.conc.clone(); M.concPit.vertexColors = true;
    const pm = new THREE.Mesh(g, M.concPit); pm.receiveShadow = true; pm.userData.nomerge = true; pm.name = 'floor_pits';
    scene.add(pm);
    for(const r of rubble) for(const k of Object.keys(r.attributes)) if(!['position','normal','uv'].includes(k)) r.deleteAttribute(k);
    const rm = new THREE.Mesh(BGU.mergeGeometries(rubble, false), M.conc);
    rm.castShadow = true; rm.receiveShadow = true; rm.userData.nomerge = true; scene.add(rm);
    for(const r of rebar) for(const k of Object.keys(r.attributes)) if(!['position','normal','uv'].includes(k)) r.deleteAttribute(k);
    const bm = new THREE.Mesh(BGU.mergeGeometries(rebar, false), cmat(0x4a3526, {roughness:.75, metalness:.55}));
    bm.castShadow = true; bm.userData.nomerge = true; scene.add(bm);
  }

  /* --- мелкие повреждения: одна декальная сетка на атласе --- */
  const D = floorDamageMaps(TS(1024));
  const dmat = new THREE.MeshStandardMaterial({ map:D.map, normalMap:D.normal, normalScale:new THREE.Vector2(1.4,1.4),
    roughness:1, metalness:0, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-3, polygonOffsetUnits:-3,
    envMapIntensity:0.2 });
  const quads = [];
  const decal = (x, z, size, cellI, rot)=>{
    if(Math.abs(x) > HW-0.6 || Math.abs(z) > HD-0.6) return;
    const g = new THREE.PlaneGeometry(size, size); g.rotateX(-Math.PI/2); g.rotateY(rot); g.translate(x, 0.0035 + quads.length*1e-5, z);
    const uv = g.attributes.uv, ox = (cellI%2)*0.5, oy = 0.5 - Math.floor(cellI/2)*0.5;
    for(let k=0;k<uv.count;k++) uv.setXY(k, ox + uv.getX(k)*0.5, oy + uv.getY(k)*0.5);
    quads.push(g);
  };
  const freeSpot = (r)=>{ for(let t=0;t<60;t++){ const x = fr(-HW+2, HW-2), z = fr(-HD+2, HD-2);
    if(Math.abs(x) < 15.6 && Math.abs(z) < 10.2) continue;
    if(PITS.some(p=> Math.hypot(x-p.x, z-p.z) < p.Rmax + r)) continue;
    return [x, z]; } return null; };
  for(let k=0;k<36;k++){ const s = freeSpot(0.8); if(s) decal(s[0], s[1], fr(0.5, 1.4), 0, fr(0,6.28)); }
  for(let k=0;k<26;k++){ const s = freeSpot(1.2); if(s) decal(s[0], s[1], fr(1.4, 3.2), 1, fr(0,6.28)); }
  for(let k=0;k<18;k++){ const s = freeSpot(0.6); if(s) decal(s[0], s[1], fr(0.6, 1.3), 3, fr(0,6.28)); }
  for(const p of PITS){
    if(p.kind === 'crater'){
      decal(p.x, p.z, p.R*4.2, 2, fr(0,6.28));
      decal(p.x, p.z, p.R*4.6, 1, fr(0,6.28));
    } else {
      decal(p.x, p.z, p.R*3.0, 3, fr(0,6.28));
      if(frnd() < 0.6) decal(p.x + fr(-0.3,0.3), p.z + fr(-0.3,0.3), p.R*fr(3,4.5), 1, fr(0,6.28));
    }
  }
  const dm = new THREE.Mesh(BGU.mergeGeometries(quads, false), dmat);
  dm.receiveShadow = true; dm.renderOrder = 1; dm.userData.nomerge = true; dm.name = 'floor_damage';
  scene.add(dm);
}

/* --- граффити «badVIno» на бетоне длинных стен ангара, между колоннами,
   выше техники и контейнеров: видно через весь пролёт с обеих баз --- */
function tagTex(text){
  const [c,x] = cv(1024, 320);
  x.clearRect(0,0,1024,320);
  x.font = '900 200px "Arial Black", Impact, "Segoe UI", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  // напыление вокруг букв
  x.save(); x.shadowColor = 'rgba(200,52,28,0.95)'; x.shadowBlur = 30;
  x.fillStyle = 'rgba(190,48,24,0.55)'; x.fillText(text, 512, 158); x.restore();
  x.lineJoin = 'round'; x.lineWidth = 20; x.strokeStyle = 'rgba(22,19,18,0.96)'; x.strokeText(text, 512, 158);
  const g = x.createLinearGradient(0, 70, 0, 250);
  g.addColorStop(0, '#f1ece0'); g.addColorStop(1, '#d4ccba');
  x.fillStyle = g; x.fillText(text, 512, 158);
  x.lineWidth = 4; x.strokeStyle = 'rgba(196,50,26,0.9)'; x.strokeText(text, 516, 162);
  // подтёки краски
  for(let k=0;k<22;k++){
    const px = fr(150, 880), py = fr(205, 240), L = fr(18, 70);
    x.strokeStyle = `rgba(222,215,200,${fr(.55,.9)})`; x.lineWidth = fr(2.5, 6); x.lineCap = 'round';
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + fr(-2,2), py + L); x.stroke();
  }
  // краска выгорела и облезла по бетону
  x.globalCompositeOperation = 'destination-out';
  for(let i=0;i<1800;i++){ x.fillStyle = `rgba(0,0,0,${frnd()*0.55})`; x.fillRect(frnd()*1024, frnd()*320, 1 + frnd()*9, 1 + frnd()*3); }
  x.globalCompositeOperation = 'source-over';
  const t = texOf(c); t.anisotropy = MAXA();
  return t;
}
function buildTag(){
  const mat = new THREE.MeshStandardMaterial({ map: tagTex('badVIno'), transparent:true, depthWrite:false,
    polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, roughness:.88, metalness:0, envMapIntensity:.2 });
  for(const s of [-1, 1]){
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 2.12), mat);
    m.position.set(s*COL_STEP/2, 4.38, s*(HD-0.225));
    m.rotation.y = s < 0 ? 0 : Math.PI;
    m.receiveShadow = true; m.userData.nomerge = true; m.name = 'tag_badVIno';
    scene.add(m);
  }
}

/* --- кровля: полосы профлиста с реальными пропусками под световые проёмы --- */
function buildRoof(){
  // сетка проёмов: часть закрыта поликарбонатом, часть — сквозные дыры (солнце бьёт столбом)
  const holes = [];
  const holeN = Math.round(HW*2/6);
  for(let i=0;i<holeN;i++){
    const x = -HW+4 + i*((HW*2-8)/(holeN-1)) + sr(-0.8,0.8);
    const z = (i%2 ? 1 : -1) * sr(4.5, HD-5);
    const w = sr(2.4,3.6), d = sr(1.8,2.8);
    holes.push({x, z, w, d, open: srnd() < 0.45});
  }
  // пара крупных провалов у конька — главный источник световых столбов
  holes.push({x:-6.5, z:2.0, w:4.6, d:3.4, open:true});
  holes.push({x:11.5, z:-3.5, w:4.0, d:3.0, open:true});
  holes.push({x:-24, z:-9, w:4.2, d:3.2, open:true});
  holes.push({x:25.0, z:11.0, w:4.4, d:3.2, open:true});

  const stripN = Math.round(HD*2/1.5);                // полосы вдоль X, режем по Z
  for(let i=0;i<stripN;i++){
    const z0 = -HD + i*(HD*2/stripN), z1 = -HD + (i+1)*(HD*2/stripN);
    const zc = (z0+z1)/2;
    // сегменты по X с вырезами под проёмы, пересекающие эту полосу
    let spans = [[-HW-0.3, HW+0.3]];
    for(const h of holes){
      if(zc < h.z-h.d/2 || zc > h.z+h.d/2) continue;
      const nx = [];
      for(const [a,b] of spans){
        const c0 = h.x-h.w/2, c1 = h.x+h.w/2;
        if(c1 <= a || c0 >= b){ nx.push([a,b]); continue; }
        if(a < c0) nx.push([a,c0]);
        if(c1 < b) nx.push([c1,b]);
      }
      spans = nx;
    }
    for(const [a,b] of spans){
      if(b-a < 0.12) continue;
      const y0 = roofY(z0), y1 = roofY(z1);
      const len = Math.hypot(z1-z0, y1-y0);
      const g = new THREE.PlaneGeometry(b-a, len);
      const uv = g.attributes.uv;
      for(let k=0;k<uv.count;k++) uv.setXY(k, uv.getX(k)*(b-a)*0.30, uv.getY(k)*len*0.30);
      const m = new THREE.Mesh(g, M.roof);
      m.position.set((a+b)/2, (y0+y1)/2, zc);
      m.rotation.x = -Math.PI/2 + Math.atan2(y1-y0, z1-z0);
      m.castShadow = true; m.receiveShadow = true;
      m.name = 'roofstrip';
      scene.add(m);    }
  }
  // конёк
  addBox('roof', 0, RIDGE+0.06, 0, HW*2+0.6, 0.12, 0.85, {collide:false, d:1.2});
  /* Кровля как преграда: полосы — плоскости без толщины, по ним AABB не
     построить. Вместо этого ставим ступенчатый «потолок» по скату, пропуская
     сквозные проёмы — через них по-прежнему можно вылететь наружу. */
  const CEIL_N = 20;
  for(let i=0;i<CEIL_N;i++){
    const za = -HD + i*(HD*2/CEIL_N), zb = -HD + (i+1)*(HD*2/CEIL_N);
    const zc = (za+zb)/2, y = roofY(zc);
    let spans = [[-HW-0.3, HW+0.3]];
    for(const h of holes){
      if(!h.open) continue;                       // застеклённые проёмы твёрдые
      if(zc < h.z-h.d/2 || zc > h.z+h.d/2) continue;
      const nx = [];
      for(const [a,b] of spans){
        const c0 = h.x-h.w/2, c1 = h.x+h.w/2;
        if(c1 <= a || c0 >= b){ nx.push([a,b]); continue; }
        if(a < c0) nx.push([a,c0]);
        if(c1 < b) nx.push([c1,b]);
      }
      spans = nx;
    }
    for(const [a,b] of spans){
      if(b-a < 0.2) continue;
      COLLIDERS.push({x0:a, y0:y-0.12, z0:za, x1:b, y1:y+0.9, z1:zb});
    }
  }
  // фронтоны и парапеты торцов: замыкают оболочку выше карниза
  for(const s of [-1,1]){
    COLLIDERS.push({x0:s*HW-0.35, y0:EAVE-0.2, z0:-HD, x1:s*HW+0.35, y1:RIDGE+0.4, z1:HD});
    COLLIDERS.push({x0:-HW, y0:EAVE-0.2, z0:s*HD-0.35, x1:HW, y1:roofY(s*HD)+0.6, z1:s*HD+0.35});
  }
  // остекление/поликарбонат в закрытых проёмах + регистрация открытых для лучей
  for(const h of holes){
    const y = roofY(h.z);
    if(!h.open){
      const g = new THREE.PlaneGeometry(h.w, h.d);
      const m = new THREE.Mesh(g, M.glass);
      m.position.set(h.x, y-0.02, h.z); m.rotation.x = -Math.PI/2;
      scene.add(m);
    }
    // обрамление проёма
    addBox('steel', h.x, y-0.08, h.z-h.d/2, h.w+0.2, 0.12, 0.12, {collide:false, d:1.2});
    addBox('steel', h.x, y-0.08, h.z+h.d/2, h.w+0.2, 0.12, 0.12, {collide:false, d:1.2});
    SUNHOLES.push({x:h.x, y, z:h.z, w:h.w, d:h.d, open:h.open});
  }
  // пара дыр в стене профлиста (пробоины, как в заброшке)
  for(let i=0;i<3;i++){
    const zz = sr(-HD+5, HD-5);
    addBox('darker', -HW+0.3, WALL_H+2.8, zz, 0.06, sr(0.6,1.4), sr(0.5,1.2), {collide:false, d:1});
  }
}

/* --- подвесные светильники --- */
/* Материалы ламп общие на всю карту: один объект материала — один вызов
   отрисовки на все сто трубок, и яркость всех ламп меняется разом. */
const LAMP_MAT = new THREE.MeshStandardMaterial({
  color:0x8e9298, emissive:0xfff4dc, emissiveIntensity:0.0, roughness:.42, metalness:.05 });
const LAMP_DEAD = new THREE.MeshStandardMaterial({color:0x6e7176, roughness:.62});
const FLICKER = [];
function setLampGlow(level){
  LAMP_MAT.emissiveIntensity = 1.4*level;
  LAMP_MAT.color.setRGB(lerp(0.44,0.92,level), lerp(0.46,0.94,level), lerp(0.49,0.96,level));
  for(const l of LAMPS) if(l.on && !l.flick) l.lit = level;
}
function buildLamps(){
  const rows = Math.round(HD*2/9), cols = Math.round(HW*2/5.5);
  for(let r=0;r<rows;r++){
    const z = -HD + 4 + r*((HD*2-8)/Math.max(1,rows-1));
    for(let i=0;i<cols;i++){
      const x = -HW + 4 + i*((HW*2-8)/Math.max(1,cols-1));
      const y = roofY(z) - 1.25;
      // корпус + отражатель
      addBox('dark', x, y+0.12, z, 1.85, 0.11, 0.30, {collide:false, d:1.4});
      const on = srnd() < 0.86 ? 1 : 0;
      // каждая двенадцатая рабочая лампа мигает — признак умирающей проводки
      const flick = on && srnd() < 0.085;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.048,0.048,1.72,8),
        flick ? LAMP_MAT.clone() : (on ? LAMP_MAT : LAMP_DEAD));
      tube.rotation.z = Math.PI/2; tube.position.set(x, y, z);
      if(flick) tube.userData.nomerge = true;    // своя яркость каждый кадр
      scene.add(tube);
      // подвесы
      for(const o of [-0.7, 0.7]){
        addBox('dark', x+o, y+0.62, z, 0.035, 0.9, 0.035, {collide:false, d:1});
      }
      const rec = {pos:new THREE.Vector3(x,y-0.2,z), mesh:tube, on, flick,
                   lit:0, ph:sr(0,99), rate:sr(5.5,13.0)};
      LAMPS.push(rec);
      if(flick) FLICKER.push(rec);
    }
  }
}
/* --- ночная иллюминация: прожекторы, натриевые светильники, указатели --- */
const NIGHT_EMIS = [];              // материалы, разгорающиеся к ночи
const FLOODS = [];                  // прожекторы с настоящим световым конусом
function nightMat(color, peak=2.4){
  const m = new THREE.MeshStandardMaterial({
    color:0x2a2a2c, emissive:color, emissiveIntensity:0, roughness:.4, metalness:.1 });
  NIGHT_EMIS.push({mat:m, peak, base:new THREE.Color(color)});
  return m;
}
const MAT_SODIUM = nightMat(0xffa63c, 3.1);   // натриевый фонарь: тёплый оранжевый
const MAT_FLOOD  = nightMat(0xfff0d0, 3.6);   // галогенный прожектор
const MAT_EXIT   = nightMat(0x36d96a, 1.6);   // указатель выхода: горит всегда

/** Мачтовый прожектор: голова на кронштейне + узкий Spot вниз-внутрь.
    Spot включается только к ночи, днём он бесполезен и стоит кадра. */
function floodMast(x, z, aimX, aimZ, h=9.0){
  addBox('steel', x, h/2, z, 0.22, h, 0.22, {d:1.1});
  addBox('dark',  x, 0.16, z, 0.8, 0.32, 0.8, {d:1.2});
  // раскосы основания
  for(const a of [0, Math.PI/2, Math.PI, -Math.PI/2]){
    const g = new THREE.BoxGeometry(0.08, 1.5, 0.08);
    g.rotateX(0.42); g.rotateY(a);
    g.translate(x + Math.cos(a)*0.34, 0.8, z + Math.sin(a)*0.34);
    bucket('steel').push(g);
  }
  const dirX = aimX - x, dirZ = aimZ - z;
  const dl = Math.hypot(dirX, dirZ) || 1;
  const yaw = Math.atan2(dirX/dl, dirZ/dl);
  for(const off of [-0.44, 0.44]){
    const hx = x + Math.cos(yaw)*off + Math.sin(yaw)*0.28;
    const hz = z - Math.sin(yaw)*off + Math.cos(yaw)*0.28;
    // корпус головы
    const head = new THREE.Mesh(roundedBox(0.52,0.40,0.26,0.05,2), M.dark);
    head.position.set(hx, h-0.3, hz); head.rotation.y = yaw; head.rotation.x = 0.55;
    head.castShadow = true; scene.add(head);
    // линза: разгорается вместе с остальной ночной иллюминацией
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.42,0.30), MAT_FLOOD);
    lens.position.set(hx + Math.sin(yaw)*0.10, h-0.42, hz + Math.cos(yaw)*0.10);
    lens.rotation.y = yaw; lens.rotation.x = 0.55 - Math.PI/2 + Math.PI/2;
    lens.rotation.x = 0.55; scene.add(lens);
  }
  const spot = new THREE.SpotLight(0xffeccd, 0, 52, 0.62, 0.55, 1.4);
  spot.position.set(x, h-0.35, z);
  spot.target.position.set(aimX, 0.4, aimZ);
  SPOT_SRC.push(spot);
  FLOODS.push({light:spot, peak: 55});
}
/** Настенный натриевый светильник-«кобра» под козырьком. */
function wallLamp(x, y, z, rotY){
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.44,7), M.dark);
  arm.rotation.z = Math.PI/2; arm.rotation.y = rotY;
  arm.position.set(x + Math.sin(rotY)*0.22, y, z + Math.cos(rotY)*0.22);
  scene.add(arm);
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 7, 0, Math.PI*2, 0, Math.PI*0.55), M.dark);
  hood.position.set(x + Math.sin(rotY)*0.46, y+0.03, z + Math.cos(rotY)*0.46);
  hood.castShadow = true; scene.add(hood);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 9, 7), MAT_SODIUM);
  bulb.position.set(x + Math.sin(rotY)*0.46, y-0.06, z + Math.cos(rotY)*0.46);
  scene.add(bulb);
  LAMPS.push({pos:new THREE.Vector3(x + Math.sin(rotY)*0.5, y-0.15, z + Math.cos(rotY)*0.5),
              mesh:bulb, on:1, lit:0, warm:true});
}
/** Табличка «выход» над проёмом: единственный свет, горящий круглые сутки. */
function exitSign(x, y, z, rotY){
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.05), M.darker);
  box.position.set(x, y, z); box.rotation.y = rotY; scene.add(box);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.12), MAT_EXIT);
  face.position.set(x + Math.sin(rotY)*0.032, y, z + Math.cos(rotY)*0.032);
  face.rotation.y = rotY; scene.add(face);
}
function buildNightLighting(){
  // Прожекторные мачты по углам ангара: ночью они лепят длинные тени
  // от здания на бетон, и карта остаётся читаемой.
  floodMast(-HW+3.0, -HD+3.0,  -6,  -4, 9.4);
  floodMast( HW-3.0, -HD+3.0,   6,  -4, 9.4);
  floodMast(-HW+3.0,  HD-3.0,  -6,   4, 9.4);
  floodMast( HW-3.0,  HD-3.0,   6,   4, 9.4);
  // настенные светильники по периметру ангара
  for(const z of [-20, -7, 7, 20]){
    wallLamp(-HW+0.6, 4.6, z,  Math.PI/2);
    wallLamp( HW-0.6, 4.6, z, -Math.PI/2);
  }
  for(const x of [-28, -10, 10, 28]){
    wallLamp(x, 4.6, -HD+0.6, 0);
    wallLamp(x, 4.6,  HD-0.6, Math.PI);
  }
}
/** Разгорание ночной иллюминации. Вынесено из applyDaylight, чтобы
    перебор материалов шёл одним проходом. */
function setNightGlow(level){
  for(const e of NIGHT_EMIS){
    // указатель выхода питается от аккумулятора и горит всегда
    const k = e.mat === MAT_EXIT ? Math.max(0.35, level) : level;
    e.mat.emissiveIntensity = e.peak * k;
  }
  for(const f of FLOODS){
    f.light.intensity = f.peak * level;
  }
}

/** Мигание умирающих ламп: короткие провалы яркости со случайным ритмом. */
function updateFlicker(t, LAMP_LEVEL=1){
  if(!FLICKER.length) return;
  for(const l of FLICKER){
    const n = Math.sin(t*l.rate + l.ph) * Math.sin(t*l.rate*0.37 + l.ph*1.7);
    const dip = n > 0.55 ? 0.08 : (n > 0.2 ? 0.55 : 1.0);
    l.lit = LAMP_LEVEL * dip;
    l.mesh.material.emissiveIntensity = 2.6 * l.lit;
  }
}

/* --- кабель-каналы, лотки и провисающие провода под фермами --- */
function buildServices(){
  for(const z of [-HD+3, -9, 9, HD-3]){
    addBox('dark', 0, EAVE-0.62, z, HW*2, 0.09, 0.26, {collide:false, d:1.4});
  }
  // провисающие кабели (кривые Безье)
  const cableMat = M.cable;
  for(let i=0;i<20;i++){
    const z = sr(-HD+2, HD-2), x0 = sr(-HW+2, 0), x1 = x0 + sr(6,18);
    const y = EAVE - sr(0.7,1.6), sag = sr(0.3,1.1);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, y, z),
      new THREE.Vector3((x0+x1)/2, y-sag, z+sr(-0.4,0.4)),
      new THREE.Vector3(x1, y, z)
    ]);
    const g = new THREE.TubeGeometry(curve, 14, sr(0.014,0.03), 5, false);
    const m = new THREE.Mesh(g, cableMat); m.castShadow = true;
    scene.add(m);
  }
  // вентиляционные короба на кровле
  for(const [x,z] of [[-18,6],[3,-10],[19,8],[-27,-14],[28,16]]){
    const y = roofY(z);
    addBox('dark', x, y+0.55, z, 1.5, 1.1, 1.5, {collide:false, d:.8});
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.85,0.85,0.12,14), M.dark);
    cap.position.set(x, y+1.16, z); scene.add(cap);
  }
}

// Свет: солнце/луна, заливки, световые столбы, пыль, суточный цикл, постобработка.
let sun, hemi, ambient, fillProbe;
const SHAFTS=[];
let sunTarget;

function buildLights(){
  hemi = new THREE.HemisphereLight(0xaebfd0, 0x8a7e6c, 0.68); scene.add(hemi);
  ambient = new THREE.AmbientLight(0xdfe3e6, 0.16); scene.add(ambient);

  sun = new THREE.DirectionalLight(0xfff2dc, 5.4);
  sun.position.set(-46, 54, 30);
  sunTarget = new THREE.Object3D(); sunTarget.position.set(2,0,-4); scene.add(sunTarget);
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  const c = sun.shadow.camera;
  c.left=-58; c.right=58; c.top=50; c.bottom=-50; c.near=1; c.far=Q.shadowFar;
  sun.shadow.bias = -8e-4; sun.shadow.normalBias = 0.034;
  scene.add(sun);

  // Заливка от остекления, кровли, отражённого от бетона света и луны —
  // одна сферическая гармоника вместо пяти направленных источников: каждый
  // источник стоит цикла в шейдере каждого пикселя, а гармоника — нет.
  // Бликов она не даёт, поэтому дневной свет ровный, без блеска.
  fillProbe = new THREE.LightProbe(); scene.add(fillProbe);
  initLightPool();
}

/* ---------------------------------------------------------------------------
   ПУЛЫ ИСТОЧНИКОВ СВЕТА
   Число источников в сцене не меняется никогда: любое изменение числа
   перекомпилирует шейдеры всех материалов (фриз), а каждый источник — это
   цикл в шейдере каждого пикселя. Лампы, огонь, вспышки, прожекторы подают
   заявки; каждый кадр источники пула получают самые заметные из них.
--------------------------------------------------------------------------- */
const PPOOL = [], PREQ = []; let PREQ_N = 0;
const SPOOL = [], SPOT_SRC = [];
function initLightPool(){
  for(let i=0;i<Q.lights;i++){
    const L = new THREE.PointLight(0xffffff, 0, 10, 2);
    L.position.set(0,-60,0); scene.add(L); PPOOL.push(L);
  }
  for(let i=0;i<Q.spots;i++){
    const S = new THREE.SpotLight(0xffffff, 0, 30, 0.5, 0.5, 1.2);
    S.position.set(0,-60,0); scene.add(S); scene.add(S.target); SPOOL.push(S);
  }
}
/** Заявка на точечный свет на этот кадр. prio: вспышки > огонь > лампы. */
function lightReq(p, color, intensity, dist, decay=2, prio=1){
  if(intensity < 0.02) return;
  let r = PREQ[PREQ_N];
  if(!r){ r = {p:new THREE.Vector3(), c:new THREE.Color(), I:0, d:0, k:2, s:0}; PREQ[PREQ_N] = r; }
  PREQ_N++;
  r.p.copy(p);
  if(typeof color === 'number') r.c.setHex(color); else r.c.copy(color);
  r.I = intensity; r.d = dist; r.k = decay;
  const dc = p.distanceTo(camera.position);
  r.s = prio * intensity * clamp(1 - dc/(dist + 16), 0.02, 1);
}
const _lreqSort = (a,b)=> b.s - a.s;
const _lreqAct = [];
function flushLightPool(){
  _lreqAct.length = 0;
  for(let i=0;i<PREQ_N;i++) _lreqAct.push(PREQ[i]);
  _lreqAct.sort(_lreqSort);
  for(let i=0;i<PPOOL.length;i++){
    const L = PPOOL[i], r = _lreqAct[i];
    if(!r){ L.intensity = 0; L.position.y = -60; continue; }
    L.position.copy(r.p); L.color.copy(r.c); L.intensity = r.I; L.distance = r.d; L.decay = r.k;
  }
  PREQ_N = 0;
  // прожекторы: источники-описания (SpotLight вне сцены) → пул
  const cam = camera.position;
  const score = s=> s.intensity/(1 + s.position.distanceTo(cam)*0.04);
  const act = SPOT_SRC.filter(s=> s.intensity > 0.02).sort((a,b)=> score(b) - score(a));
  for(let i=0;i<SPOOL.length;i++){
    const S = SPOOL[i], s = act[i];
    if(!s){ S.intensity = 0; S.position.y = -60; continue; }
    S.position.copy(s.position); S.target.position.copy(s.target.position); S.target.updateMatrixWorld();
    S.color.copy(s.color); S.intensity = s.intensity; S.distance = s.distance;
    S.angle = s.angle; S.penumbra = s.penumbra; S.decay = s.decay;
  }
}

/* --- заливка сферической гармоникой --- */
const _shb = [];
function shAddDir(sh, d, col, I){
  THREE.SphericalHarmonics3.getBasisAt(d, _shb);
  for(let i=0;i<9;i++){ const c = sh.coefficients[i], b = _shb[i]*I; c.x += col.r*b; c.y += col.g*b; c.z += col.b*b; }
}
const FILL_DIRS = [
  // направление на источник, цвет (sRGB), сила днём
  [new THREE.Vector3(30,14,-26).normalize(), 0xc6d4e6, 0.62],   // северное остекление
  [new THREE.Vector3(-30,13,26).normalize(), 0xbcc8d8, 0.46],   // южное остекление
  [new THREE.Vector3(-40,10,-4).normalize(), 0xd0d8e2, 0.30],   // торцы и щели ворот
  [new THREE.Vector3(6,24,2).normalize(),    0xe8e2d4, 0.44],   // световые проёмы кровли
  [new THREE.Vector3(0,-1,0),                0xd4cbba, 0.62]    // отражённый от бетона
];
const _fillCol = new THREE.Color(), _moonCol = new THREE.Color(0x9db4e0), _down = new THREE.Vector3(0,-1,0);
function updateFillProbe(k, nightK, moonI, elev){
  const sh = fillProbe.sh; sh.zero();
  const day = FILL_DAY*lerp(1.0, 0.025, nightK);
  for(const [d, col, I] of FILL_DIRS) shAddDir(sh, d, _fillCol.setHex(col), I*day);
  // солнечные пятна на полу подсвечивают снизу всё вокруг: тёплый отскок
  // растёт с высотой солнца — днём в ангаре светло, а не «пещера»
  const bounce = FILL_DAY * k.sunI * 0.085 * smoothstep(0.0, 0.5, elev);
  shAddDir(sh, _down, _fillCol.copy(k.sunCol).lerp(_kc.setHex(0xcfc4b0), 0.5), bounce);
  if(moonI > 0.004) shAddDir(sh, MOON_DIR, _moonCol, moonI);
  fillProbe.intensity = 1;
}

/* --- Объёмные световые столбы из проёмов кровли (аддитивные конусы) --- */
const shaftMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
  uniforms:{ uColor:{value:new THREE.Color(0xffe8c4)}, uOpacity:{value:0.055}, uTime:{value:0} },
  vertexShader:`
    varying vec3 vPos; varying vec2 vUv;
    void main(){ vUv=uv; vPos=position;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader:`
    uniform vec3 uColor; uniform float uOpacity, uTime;
    varying vec3 vPos; varying vec2 vUv;
    void main(){
      // затухание к низу столба и к его краям
      float h = clamp(vUv.y, 0.0, 1.0);
      float fade = pow(1.0 - h, 2.1);
      // мягкие края: иначе конус читается как непрозрачная белая стена
      // smoothstep с обратными границами в GLSL не определён (на части драйверов NaN)
      float edge = smoothstep(0.0, 0.46, vUv.x) * (1.0 - smoothstep(0.54, 1.0, vUv.x));
      edge = pow(edge, 1.6);
      float flick = 0.94 + 0.06*sin(uTime*0.6 + vPos.x*0.5);
      gl_FragColor = vec4(uColor, uOpacity*fade*edge*flick);
    }`
});
/** Столбы света из проёмов кровли. Геометрия строится единичной длины и
    разворачивается по солнцу каждый раз, когда оно сдвинулось: иначе
    к вечеру лучи продолжали бы падать отвесно, как в полдень. */
const SPOT_POOL = [];               // световые пятна на полу
const _shaftDown = new THREE.Vector3(0,-1,0);
function buildShafts(){
  // Столбы ставим у самых крупных проёмов: на слабом профиле их меньше,
  // но это именно те лучи, которые видно, а не случайная выборка.
  const keep = SUNHOLES.filter(h=>h.open)
    .sort((a,b)=> (b.w*b.d) - (a.w*a.d));
  const n = Math.max(1, Math.round(keep.length * Q.shafts));
  for(let i=0;i<Math.min(n, keep.length);i++){
    const h = keep[i];
    const r = Math.max(h.w, h.d);
    // конус единичной высоты: реальная длина задаётся масштабом по Y
    const g = new THREE.CylinderGeometry(r*0.55, r*0.86, 1, 12, 1, true);
    g.translate(0, -0.5, 0);        // вершина в начале координат — в проёме
    const m = new THREE.Mesh(g, shaftMat);
    m.position.set(h.x, h.y, h.z);
    m.renderOrder = 3;
    m.userData.baseOpacity = 0.055;
    m.userData.hole = h;
    m.userData.nomerge = true;
    scene.add(m); SHAFTS.push(m);
    // яркое пятно на полу под лучом
    const spot = new THREE.Mesh(new THREE.CircleGeometry(r*0.62, 16), SPOT_MAT);
    spot.rotation.x = -Math.PI/2; spot.position.set(h.x, 0.012, h.z);
    spot.renderOrder = 3; spot.userData.nomerge = true;
    scene.add(spot); SPOT_POOL.push({mesh:spot, hole:h, r});
  }
  updateShafts();
}
const SPOT_MAT = new THREE.MeshBasicMaterial({color:0xffeccd, transparent:true,
  opacity:0.055, blending:THREE.AdditiveBlending, depthWrite:false});

/* --- Лучи солнца сквозь ленточное остекление: наклонные столбы от окон до
   пола. Одна сетка на все окна; направление и длина считаются в вершинном
   шейдере по солнцу, лучи видны только у стены, обращённой к солнцу.
   Мягкие и тусклые: воздух в ангаре пыльный, а не сияющий. --- */
const winShaftMat = new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide,
  uniforms:{ uDir:{value:new THREE.Vector3(0,-1,0)}, uColor:{value:new THREE.Color(0xffe6c0)}, uOpacity:{value:0}, uTime:{value:0} },
  vertexShader:`
    attribute float aT; attribute vec3 aN; uniform vec3 uDir;
    varying float vT; varying float vFace; varying vec2 vUv; varying vec3 vW;
    void main(){
      vUv = uv; vT = aT;
      float down = max(0.1, -uDir.y);
      vec3 p = position + uDir*min(position.y/down, 36.0)*aT;
      vFace = clamp(dot(uDir, aN)*2.5, 0.0, 1.0) * step(0.02, -uDir.y);
      vW = p;
      gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0);
    }`,
  fragmentShader:`
    uniform vec3 uColor; uniform float uOpacity, uTime;
    varying float vT; varying float vFace; varying vec2 vUv; varying vec3 vW;
    void main(){
      // без pow от отрицательного и smoothstep с обратными границами: это NaN,
      // а NaN в HDR-буфере bloom размазывает в чёрные прямоугольники
      float edge = smoothstep(0.0, 0.32, vUv.x)*(1.0 - smoothstep(0.68, 1.0, vUv.x));
      float along = smoothstep(0.0, 0.05, vT) * pow(clamp(1.0 - vT, 0.0, 1.0), 1.4);
      float dust = 0.82 + 0.18*sin(vW.x*1.3 + vW.z*1.1 + uTime*0.35)*sin(vW.y*2.1 - uTime*0.2);
      gl_FragColor = vec4(uColor, clamp(uOpacity*vFace*edge*along*dust, 0.0, 1.0));
    }`
});
let winShafts = null;
function buildWindowShafts(){
  const pos = [], uv = [], at = [], an = [], idx = [];
  for(const w of WINDOWS){
    const tan = w.axis === 'x' ? V3(1,0,0) : V3(0,0,1);
    const nIn = w.axis === 'x' ? V3(0,0,-w.sign) : V3(-w.sign,0,0);
    const hw = w.w*0.46, hh = w.h*0.46, c = w.pos.clone().addScaledVector(nIn, 0.08);
    const C = [c.clone().addScaledVector(tan,-hw).add(V3(0,-hh,0)), c.clone().addScaledVector(tan,hw).add(V3(0,-hh,0)),
               c.clone().addScaledVector(tan,hw).add(V3(0,hh,0)),  c.clone().addScaledVector(tan,-hw).add(V3(0,hh,0))];
    for(const [A,B] of [[0,1],[3,2],[0,3],[1,2]]){
      const b = pos.length/3;
      for(const [P,u,t] of [[C[A],0,0],[C[B],1,0],[C[B],1,1],[C[A],0,1]]){
        pos.push(P.x,P.y,P.z); uv.push(u,t); at.push(t); an.push(nIn.x,nIn.y,nIn.z);
      }
      idx.push(b,b+1,b+2, b,b+2,b+3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at,1));
  g.setAttribute('aN', new THREE.Float32BufferAttribute(an,3));
  g.setIndex(idx);
  winShafts = new THREE.Mesh(g, winShaftMat);
  winShafts.frustumCulled = false; winShafts.renderOrder = 3; winShafts.userData.nomerge = true;
  scene.add(winShafts);
}
const V3 = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
const _shaftQ = new THREE.Quaternion(), _shaftDir = new THREE.Vector3();
function updateShafts(){
  // Направление распространения света: от солнца вниз.
  _shaftDir.copy(SUN_DIR).negate();
  const down = Math.max(0.12, -_shaftDir.y);
  _shaftQ.setFromUnitVectors(_shaftDown, _shaftDir);
  for(const m of SHAFTS){
    const h = m.userData.hole; if(!h) continue;
    const len = clamp(h.y/down, 1, 46);
    m.quaternion.copy(_shaftQ);
    m.scale.set(1, len, 1);
  }
  if(dust){
    const U = dust.material.uniforms; let n = 0;
    for(const m of SHAFTS){ const h = m.userData.hole; if(!h || n >= 24) continue;
      DUST_SHAFTS[n++].set(h.x, h.y, h.z, Math.max(h.w, h.d)); }
    U.uShaftN.value = n; U.uShaftDir.value.copy(_shaftDir);
  }
  for(const s of SPOT_POOL){
    const len = s.hole.y/down;
    // пятно уезжает по полу вслед за солнцем и растягивается к закату
    s.mesh.position.set(s.hole.x + _shaftDir.x*len, 0.012, s.hole.z + _shaftDir.z*len);
    const stretch = clamp(1/down, 1, 4.2);
    s.mesh.scale.set(1, stretch, 1);
    s.mesh.rotation.z = Math.atan2(_shaftDir.x, _shaftDir.z);
    const inside = Math.abs(s.mesh.position.x) < HW && Math.abs(s.mesh.position.z) < HD;
    s.mesh.visible = inside;
  }
}
/* --- Пыль в воздухе: точки, подсвеченные в лучах --- */
let dust;
const DUST_SHAFTS = Array.from({length:24}, ()=> new THREE.Vector4());
function buildDust(){
  const N = Q.dust;
  const pos = new Float32Array(N*3), rndv = new Float32Array(N);
  for(let i=0;i<N;i++){
    pos[i*3]   = sr(-HW+1, HW-1);
    pos[i*3+1] = sr(0.2, EAVE-0.5);
    pos[i*3+2] = sr(-HD+1, HD-1);
    rndv[i] = srnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rndv,1));
  const m = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    uniforms:{ uTime:{value:0}, uSize:{value:1.15}, uOpacity:{value:0.5},
               uPixelRatio:{value:renderer.getPixelRatio()},
               uShaft:{value: DUST_SHAFTS}, uShaftN:{value:0}, uShaftDir:{value:new THREE.Vector3(0,-1,0)} },
    vertexShader:`
      attribute float aRnd; uniform float uTime,uSize,uPixelRatio;
      uniform vec4 uShaft[24]; uniform int uShaftN; uniform vec3 uShaftDir;
      varying float vA;
      void main(){
        vec3 p = position;
        // медленный дрейф по воздуху
        p.x += sin(uTime*0.10 + aRnd*31.4)*0.55;
        p.y += sin(uTime*0.07 + aRnd*17.7)*0.35;
        p.z += cos(uTime*0.09 + aRnd*23.1)*0.55;
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(uSize*uPixelRatio*(9.0/max(-mv.z,1.0)), 0.6, 3.2);
        // пыль видна в столбах солнца, вне их — едва заметна (раньше светился весь объём)
        float lit = 0.0;
        for(int i=0;i<24;i++){
          if(i >= uShaftN) break;
          vec3 o = uShaft[i].xyz; vec3 dp = p - o;
          float t = max(dot(dp, uShaftDir), 0.0);
          float rr = uShaft[i].w*(0.55 + 0.31*clamp(t/max(o.y, 1.0), 0.0, 1.5));
          lit = max(lit, 1.0 - smoothstep(rr*0.6, rr*1.05, length(dp - uShaftDir*t)));
        }
        vA = (0.30 + 0.70*aRnd) * smoothstep(0.0,3.0,p.y) * mix(0.1, 1.0, lit);
      }`,
    fragmentShader:`
      uniform float uOpacity; varying float vA;
      void main(){
        vec2 d = gl_PointCoord - 0.5;
        float a = 1.0 - smoothstep(0.06, 0.5, length(d));
        gl_FragColor = vec4(vec3(1.0,0.95,0.86), a*vA*uOpacity);
      }`
  });
  dust = new THREE.Points(g, m);
  dust.frustumCulled = false;
  scene.add(dust);
}
function updateLightPool(pos){
  if(!LAMPS.length) return;
  LAMPS.forEach(l => l.d = (l.pos.x-pos.x)**2 + (l.pos.z-pos.z)**2);
  const near = LAMPS.filter(l=>l.on && l.lit > 0.02).sort((a,b)=>a.d-b.d).slice(0, PPOOL.length);
  const power = lerp(4, 40, LAMP_LEVEL);
  for(const l of near) lightReq(l.pos, 0xe6e4dc, power * l.lit * clamp(1 - Math.sqrt(l.d)/24, 0, 1), 24, 2, 1);
}

/* ---------------------------------------------------------------------------
   СУТОЧНЫЙ ЦИКЛ
   Время идёт само: сцена открывается ясным днём, затем вечер, закат, сумерки,
   ночь с фонарями, рассвет — и снова день. Всё освещение (солнце, луна,
   небо, туман, лампы, экспозиция) — функции одного параметра t ∈ [0,1).
--------------------------------------------------------------------------- */
/** Ключевые кадры цикла. t — доля суток, 0.25 — полдень, 0.75 — полночь. */
const DAY_KEYS = [
  // t,    sunI, sunColor, hemiSky,  hemiGnd,  amb,  skyTop,   skyMid,   skyBot,   fogCol,   fogD,    exposure, lamp
  [0.00, 0.55, 0xffb489, 0x7d92b4, 0x6d6354, 0.16, 0x37527e, 0xd8a074, 0x7a6a5e, 0x8e8074, 0.0090, 1.22, 0.55], // рассвет
  [0.10, 3.60, 0xffe0b4, 0x9fb6d2, 0x8a7e6c, 0.17, 0x5b84b8, 0xbcc9d4, 0x9a9186, 0x9aa0a6, 0.0058, 1.08, 0.12], // раннее утро
  [0.25, 5.60, 0xfff4e2, 0xaebfd0, 0x8a7e6c, 0.18, 0x6f96c4, 0xc8d4e0, 0xa39a8c, 0xa2a8ad, 0.0044, 1.00, 0.00], // полдень
  [0.42, 4.60, 0xffe7c2, 0xa8bcd0, 0x8a7a64, 0.18, 0x6a8fbe, 0xc9d0d8, 0x9e9486, 0x9ea2a4, 0.0050, 1.04, 0.05], // день
  [0.52, 2.60, 0xffc184, 0x9aa8c0, 0x8a7458, 0.17, 0x50719e, 0xd9ab7a, 0x8d7c68, 0x9a8c7c, 0.0068, 1.14, 0.35], // вечер
  [0.60, 1.05, 0xff8a4e, 0x87799a, 0x7a5c44, 0.15, 0x3c5286, 0xe07a44, 0x7c5a48, 0x8e6a52, 0.0092, 1.26, 0.72], // закат
  [0.66, 0.26, 0xd2663c, 0x5d5f86, 0x53463c, 0.12, 0x26355e, 0x9a5442, 0x51413c, 0x5c4a44, 0.0112, 1.34, 0.92], // гражданские сумерки
  [0.72, 0.03, 0x50607e, 0x2c3350, 0x241f22, 0.07, 0x0d1430, 0x22294a, 0x1d1c22, 0x1a1e2c, 0.0128, 1.42, 1.00], // сумерки
  [0.80, 0.00, 0x28344e, 0x18203a, 0x14121a, 0.05, 0x050a1c, 0x0d1430, 0x121118, 0x0a0d16, 0.0138, 1.46, 1.00], // ночь
  [0.90, 0.00, 0x28344e, 0x1a2340, 0x14121a, 0.05, 0x060b1e, 0x101838, 0x131219, 0x0c0f18, 0.0134, 1.44, 1.00], // глубокая ночь
  [0.96, 0.22, 0x8a6a72, 0x3d4464, 0x322a2c, 0.10, 0x18224a, 0x4a4468, 0x2e2a2e, 0x2e3042, 0.0118, 1.36, 0.95], // предрассветные
  [1.00, 0.55, 0xffb489, 0x7d92b4, 0x6d6354, 0.16, 0x37527e, 0xd8a074, 0x7a6a5e, 0x8e8074, 0.0090, 1.22, 0.55]
];
const PHASE_NAMES = [
  [0.045,'РАССВЕТ'], [0.17,'УТРО'], [0.34,'ПОЛДЕНЬ'], [0.47,'ДЕНЬ'],
  [0.56,'ВЕЧЕР'], [0.635,'ЗАКАТ'], [0.70,'СУМЕРКИ'], [0.755,'НОЧЬ'],
  [0.935,'ГЛУБОКАЯ НОЧЬ'], [0.985,'ПРЕДРАССВЕТНЫЕ СУМЕРКИ'], [1.01,'РАССВЕТ']
];
/** Карта открывается днём, дальше время идёт вперёд: вечер → закат → ночь. */
let DAY_T = 0.26;
let DAY_SPEED = 1/300;          // полные сутки за 5 минут реального времени
let DAY_PAUSED = false;
let LAMP_LEVEL = 0;             // 0 — фонари выключены, 1 — горят в полную
const _kc = new THREE.Color(), _kc2 = new THREE.Color();
const SUN_DIR = new THREE.Vector3(0,1,0);
const MOON_DIR = new THREE.Vector3(0,-1,0);
let SUN_ELEV = 1, SUN_UP = true;
/** Сила небесной заливки днём: ангар со сплошным остеклением и проёмами в
    кровле днём светлый, тени читаются, а не проваливаются в черноту. */
// Соотношение прямого солнца и рассеянного света ≈ 4:1, как в реальном ангаре:
// раньше рассеянный был почти равен солнцу — теней не было, картинка «в муке».
// Глухие места теперь затеняет объём AVOL, поэтому заливка может быть честной.
const HEMI_DAY = 0.95;
/** Сила заливки от остекления, проёмов кровли и отскока от бетона днём. */
const FILL_DAY = 1.2;

/** Линейная выборка из таблицы ключей с интерполяцией цветов в sRGB. */
function sampleDay(t){
  t = ((t % 1) + 1) % 1;
  let i = 0;
  while(i < DAY_KEYS.length-2 && DAY_KEYS[i+1][0] <= t) i++;
  const a = DAY_KEYS[i], b = DAY_KEYS[i+1];
  const k = clamp((t - a[0]) / Math.max(1e-6, b[0]-a[0]), 0, 1);
  // сглаживание перехода: линейный стык между ключами даёт заметный излом
  const s = k*k*(3-2*k);
  const mixCol = (ca, cb, out)=>{
    out.setHex(ca, THREE.SRGBColorSpace);
    _kc2.setHex(cb, THREE.SRGBColorSpace);
    return out.lerp(_kc2, s);
  };
  return {
    sunI: lerp(a[1], b[1], s),
    sunCol: mixCol(a[2], b[2], new THREE.Color()),
    hemiSky: mixCol(a[3], b[3], new THREE.Color()),
    hemiGnd: mixCol(a[4], b[4], new THREE.Color()),
    amb: lerp(a[5], b[5], s),
    skyTop: mixCol(a[6], b[6], new THREE.Color()),
    skyMid: mixCol(a[7], b[7], new THREE.Color()),
    skyBot: mixCol(a[8], b[8], new THREE.Color()),
    fogCol: mixCol(a[9], b[9], new THREE.Color()),
    fogD: lerp(a[10], b[10], s),
    exp: lerp(a[11], b[11], s),
    lamp: lerp(a[12], b[12], s)
  };
}
function phaseName(t){
  t = ((t % 1) + 1) % 1;
  for(const [lim, name] of PHASE_NAMES) if(t < lim) return name;
  return 'РАССВЕТ';
}
/** Часы и минуты условных суток: 0.25 — полдень, 0.75 — полночь. */
function dayClock(t){
  const hours = (((t % 1) + 1) % 1) * 24 + 6;   // t=0 соответствует 06:00
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}

let _lastShadowDir = new THREE.Vector3(9,9,9);
/** Пересчёт всей световой обстановки под текущее время суток. */
function applyDaylight(t){
  const k = sampleDay(t);
  // Солнце ходит по наклонной дуге: ось восход-закат развёрнута поперёк
  // конька, поэтому полосы света из проёмов кровли ползут по полу.
  // Светлое время занимает 0..DUSK, ночь — остаток суток, поэтому шкала
  // разбита на два участка: иначе солнце садилось бы уже в «вечер»,
  // когда по таблице ключей оно ещё должно светить.
  const DUSK = 0.66, NOON = 0.25;
  let elev, azim;
  if(t < DUSK){
    // u: 0 — восход, 0.5 — полдень, 1 — заход
    const u = t < NOON ? 0.5*(t/NOON) : 0.5 + 0.5*((t-NOON)/(DUSK-NOON));
    elev = Math.sin(Math.PI*u);
    azim = -Math.cos(Math.PI*u);
  } else {
    const v = (t - DUSK)/(1 - DUSK);
    elev = -0.92*Math.sin(Math.PI*v);
    azim = Math.cos(Math.PI*v);
  }
  SUN_ELEV = elev;
  SUN_DIR.set(azim*0.86, Math.max(elev, -1), -azim*0.34 - 0.22*elev).normalize();
  const R = 96;
  sun.position.copy(SUN_DIR).multiplyScalar(R).add(sunTarget.position);
  sun.color.copy(k.sunCol);
  sun.intensity = k.sunI * 1.25;
  // Солнце не выключаем и тень у него не снимаем: смена числа источников или
  // теней перекомпилирует шейдеры всех материалов — фриз на закате и рассвете.
  // Ночью у него просто нулевая яркость, а карта теней не перерисовывается.
  if(elev < -0.02) sun.intensity = 0;
  SUN_UP = sun.intensity > 0.004;

  // Луна противостоит солнцу и светит только когда солнце за горизонтом.
  MOON_DIR.copy(SUN_DIR).negate();
  const moonUp = clamp(MOON_DIR.y, 0, 1);
  const nightK = smoothstep(0.06, -0.14, elev);          // 0 днём, 1 ночью
  const moonI = 0.4 * nightK * smoothstep(0.0, 0.35, moonUp);

  hemi.color.copy(k.hemiSky); hemi.groundColor.copy(k.hemiGnd);
  hemi.intensity = lerp(HEMI_DAY, 0.24, nightK);
  ambient.intensity = k.amb * 0.5;
  updateFillProbe(k, nightK, moonI, elev);

  // небо
  skyUniforms.uTop.value.copy(k.skyTop);
  skyUniforms.uMid.value.copy(k.skyMid);
  skyUniforms.uBot.value.copy(k.skyBot);
  skyUniforms.uSunDir.value.copy(SUN_DIR);
  skyUniforms.uSunCol.value.copy(k.sunCol);
  skyUniforms.uHaze.value = lerp(0.30, 1.0, smoothstep(0.35, 0.0, Math.abs(elev)));
  skyUniforms.uStars.value = smoothstep(0.0, 0.9, nightK);
  skyUniforms.uMoonDir.value.copy(MOON_DIR);
  skyUniforms.uMoon.value = nightK * smoothstep(-0.05, 0.3, MOON_DIR.y);

  // дымка внутри ангара — это пыль в рассеянном свете: темнее и теплее неба
  scene.fog.color.copy(k.fogCol).multiplyScalar(0.72);
  scene.fog.density = k.fogD * 1.25;
  scene.background = k.fogCol;
  const inscat = k.sunI * 0.028 * smoothstep(-0.05, 0.25, elev);
  FOG_U.uFogSun.value.r = k.sunCol.r*inscat; FOG_U.uFogSun.value.g = k.sunCol.g*inscat; FOG_U.uFogSun.value.b = k.sunCol.b*inscat;
  FOG_U.uFogSunDir.value.x = SUN_DIR.x; FOG_U.uFogSunDir.value.y = SUN_DIR.y; FOG_U.uFogSunDir.value.z = SUN_DIR.z;
  // отражения окружения держим умеренными: днём свет ровный, без блеска
  scene.environmentIntensity = lerp(0.42, 0.06, nightK);
  EXPO.base = k.exp * 0.9 * 1.18;      // компенсация приглушённого рассеянного света
  renderer.toneMappingExposure = EXPO.base * SET.exp * EXPO.eye;

  // Стёкла темнеют к ночи, но подсвечиваются изнутри, когда горят фонари.
  M.glass.color.copy(k.skyMid).lerp(_kc.setHex(0xc4cfd6), 1-nightK*0.86);
  M.glass.emissiveIntensity = lerp(0.07, 0.02, nightK);

  // Столбы света и пылинки живут только при солнце.
  const shaftK = clamp(k.sunI/4.2, 0, 1) * smoothstep(-0.02, 0.22, elev);
  const shaftsOn = shaftK > 0.02;
  shaftMat.uniforms.uOpacity.value = 0.06 * shaftK;
  SPOT_MAT.opacity = 0.075 * shaftK;
  for(const s of SHAFTS) s.visible = shaftsOn;
  if(winShafts){
    winShafts.visible = shaftsOn;
    winShaftMat.uniforms.uDir.value.copy(SUN_DIR).negate();
    winShaftMat.uniforms.uOpacity.value = 0.17 * shaftK;
    winShaftMat.uniforms.uColor.value.copy(k.sunCol).lerp(_kc.setHex(0xfff0dc), 0.35);
  }
  if(shaftsOn) updateShafts();
  else for(const s of SPOT_POOL) s.mesh.visible = false;
  if(dust) dust.material.uniforms.uOpacity.value = lerp(0.9, 0.09, nightK);

  LAMP_LEVEL = k.lamp;
  setLampGlow(k.lamp);
  setNightGlow(k.lamp);

  // Ночью лампы должны «цвести», днём ореол только пачкает картинку.
  if(bloomPass){
    // ореол только у самих ламп и огня, стены и дерево не светятся
    bloomPass.strength  = lerp(0.06, 0.28, k.lamp);
    bloomPass.threshold = lerp(1.0, 0.92, k.lamp);
  }
  // Холодные тени днём, тёплые от натриевых ламп ночью.
  if(gradePass){
    gradePass.uniforms.uShadowTint.value.setRGB(
      lerp(0.78, 0.62, nightK), lerp(0.84, 0.70, nightK), lerp(0.98, 1.02, nightK));
    gradePass.uniforms.uHighTint.value.setRGB(
      lerp(1.06, 1.12, nightK), lerp(1.00, 0.96, nightK), lerp(0.90, 0.80, nightK));
    gradePass.uniforms.uVig.value = lerp(0.42, 0.55, nightK);
    gradePass.uniforms.uSat.value = lerp(1.06, 0.9, nightK);
  }

  // Карта теней перерисовывается, когда солнце заметно ушло: на слабой
  // машине ежекадровый проход теней стоит дороже всей остальной сцены.
  if(renderer.shadowMap.enabled && SUN_UP && SUN_DIR.distanceToSquared(_lastShadowDir) > 2e-5){
    renderer.shadowMap.needsUpdate = true;
    _lastShadowDir.copy(SUN_DIR);
  }
}

const GradeShader = {
  uniforms:{
    tDiffuse:{value:null}, uVig:{value:0.18}, uSat:{value:1.04},
    uShadowTint:{value:new THREE.Color(0.78,0.84,0.98)},   // холодные тени
    uHighTint:{value:new THREE.Color(1.06,1.00,0.90)},     // тёплые света
    uLift:{value:0.0}, uContrast:{value:0.55}, uTemp:{value:0.0}
  },
  vertexShader:`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
  fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float uVig,uSat,uLift,uContrast,uTemp;
    uniform vec3 uShadowTint, uHighTint;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = max(c.rgb, 0.0);

      col = col + uLift*(1.0 - col);

      // плёночная S-кривая: плотные тени и мягкие света без обрезки (линейный
      // контраст вокруг 0.5 и подъём чёрного давали серую «муку»)
      col = clamp(col, 0.0, 1.0);
      vec3 sCurve = col*col*(3.0 - 2.0*col);
      col = mix(col, sCurve, uContrast);

      // Раздельная тонировка с сохранением яркости: тени холоднее, света теплее,
      // но общая экспозиция не падает (иначе картинка уходит в мутную оливку).
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.06, 0.70, l));
      tint /= max(dot(tint, vec3(0.2126,0.7152,0.0722)), 1e-4);
      col *= mix(vec3(1.0), tint, 0.30);

      col = mix(vec3(dot(col, vec3(0.2126,0.7152,0.0722))), col, uSat);

      // мягкая широкая виньетка
      vec2 d = vUv - 0.5;
      col *= clamp(1.0 - uVig*dot(d,d)*1.9, 0.0, 1.0);

      gl_FragColor = vec4(col, c.a);
    }`
};
/** Слои: 0 — мир; LAYER_VM — оружие в руках и огонь на одежде (свой проход
    с очисткой глубины: ствол не лезет в стены и не попадает в AO); LAYER_FX —
    прозрачное без записи глубины (частицы, лучи, декали): его не видит проход
    нормалей AO; LAYER_SHADOW — упрощённые копии статики только для карты теней. */
const LAYER_VM = 1, LAYER_FX = 2, LAYER_SHADOW = 3;
camera.layers.enable(LAYER_FX);
class ViewmodelPass extends Pass {
  constructor(){ super(); this.needsSwap = false; }
  render(r, writeBuffer, readBuffer){
    const auto = r.autoClear, bg = scene.background, mask = camera.layers.mask;
    r.autoClear = false; scene.background = null; camera.layers.set(LAYER_VM);
    r.setRenderTarget(this.renderToScreen ? null : readBuffer);
    r.clearDepth();
    r.render(scene, camera);
    r.autoClear = auto; scene.background = bg; camera.layers.mask = mask;
  }
}
/** Всё прозрачное без записи глубины уходит в слой FX (один обход после сборки,
    дальше новые эффекты помечаются при создании). */
function fxLayer(o){
  // только то, что ещё в слое 0: частицы (LAYER_PFX) и оружие (LAYER_VM) уже на своих местах
  o.traverse(m=>{ if(m.isMesh && m.layers.mask === 1 && m.material && !Array.isArray(m.material) && m.material.transparent && m.material.depthWrite === false) m.layers.set(LAYER_FX); });
  return o;
}
/* ============================================================================
   ЧАСТИЦЫ ОТДЕЛЬНЫМ ПРОХОДОМ В ПОЛОВИННОМ РАЗРЕШЕНИИ
   Дым, пламя, пыль и искры рисуются в буфер вдвое меньшего размера (вчетверо
   меньше пикселей — большие клубы дыма больше не съедают кадр) и сравнивают
   глубину со сценой сами: там, где клуб входит в стену или потолок, он плавно
   тает, а не режется прямой линией («мягкие частицы»). Затем буфер ложится
   на кадр одним проходом, который заодно даёт мерцание горячего воздуха над
   огнём и искажение ударной волны взрыва.
============================================================================ */
const LAYER_PFX = 4;
const PFX_U = {
  tDepth: { value: null },
  uFxInv: { value: { x: 1, y: 1 } },                  // 1 / размер буфера частиц
  uCamNF: { value: { x: 0.04, y: 400 } }
};
/** Хвост фрагментного шейдера частиц: мягкое сравнение глубины и перевод в
    предумноженную альфу (обычные частицы и аддитивные смешиваются в одном буфере). */
const PFX_GLSL_PARS = `
  uniform sampler2D tDepth; uniform vec2 uFxInv, uCamNF;
  float pfxSceneDepth(){
    float d = texture2D(tDepth, gl_FragCoord.xy*uFxInv).r;
    return uCamNF.x*uCamNF.y / (uCamNF.y - d*(uCamNF.y - uCamNF.x));
  }`;
/** Частица считается шаром радиуса ≈ размера квада: гаснет только там, где
    поверхность врезается в неё глубже этого. Иначе пламя, сидящее на стене,
    и дым у потолка тускнели бы целиком. */
function pfxOut(soft, additive){
  return `
    float pfxR = vSize*${soft.toFixed(2)};
    float pfxK = clamp((pfxSceneDepth() - vDepth + pfxR)/max(pfxR*1.6, 0.03), 0.0, 1.0);
    if(pfxK <= 0.0) discard;
    gl_FragColor.a *= pfxK;
    gl_FragColor = vec4(gl_FragColor.rgb*gl_FragColor.a, ${additive ? '0.0' : 'gl_FragColor.a'});`;
}
function pfxMaterial(mat){
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  mat.depthTest = false; mat.depthWrite = false;
  Object.assign(mat.uniforms, PFX_U);
  return mat;
}
/** Проход сцены запоминает, в какой буфер рисовал: там лежит глубина для частиц. */
class SceneRenderPass extends RenderPass {
  render(r, writeBuffer, readBuffer, dt, mask){ this.target = readBuffer; super.render(r, writeBuffer, readBuffer, dt, mask); }
}
const WAVES = [];            // ударные волны на экране: {p, t, dur, k}
function shockwave(p, k){ WAVES.push({ p: p.clone(), t: 0, dur: 0.55, k }); if(WAVES.length > 2) WAVES.shift(); }
const _wv = new THREE.Vector3();
class OffscreenFXPass extends Pass {
  constructor(scenePass, scale){
    super();
    this.scenePass = scenePass; this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tFx: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 },
        uHeat: { value: 1 }, uWave: { value: [new THREE.Vector4(), new THREE.Vector4()] } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tScene, tFx; uniform float uTime, uAspect, uHeat; uniform vec4 uWave[2];
        varying vec2 vUv;
        void main(){
          vec4 fx = texture2D(tFx, vUv);
          vec2 off = vec2(0.0);
          // горячий воздух: яркие (аддитивные) области буфера частиц — это пламя
          float heat = clamp(dot(fx.rgb, vec3(0.3, 0.5, 0.2)) - 0.25, 0.0, 1.0)*uHeat;
          if(heat > 0.0){
            vec2 q = vUv*vec2(uAspect, 1.0)*38.0 + vec2(0.0, -uTime*2.6);
            off += vec2(sin(q.y + sin(q.x*0.7)*1.3), cos(q.x*1.1 + q.y*0.4))*0.0032*heat;
          }
          // ударная волна: тонкое кольцо, расходится и гаснет
          for(int i=0;i<2;i++){
            vec4 w = uWave[i]; if(w.w <= 0.0) continue;
            vec2 d = (vUv - w.xy)*vec2(uAspect, 1.0); float r = length(d);
            float ring = exp(-pow((r - w.z)/0.035, 2.0))*w.w;
            off -= normalize(d + 1e-5)/vec2(uAspect, 1.0)*ring*0.035;
          }
          vec3 sc = texture2D(tScene, vUv + off).rgb;
          gl_FragColor = vec4(sc*(1.0 - fx.a) + fx.rgb, 1.0);
        }`,
      depthTest: false, depthWrite: false
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h){
    const W = Math.max(1, Math.round(w*this.scale)), H = Math.max(1, Math.round(h*this.scale));
    this.rt.setSize(W, H);
    PFX_U.uFxInv.value.x = 1/W; PFX_U.uFxInv.value.y = 1/H;
    this.mat.uniforms.uAspect.value = w/Math.max(1, h);
  }
  render(r, writeBuffer, readBuffer){
    const src = this.scenePass.target;
    PFX_U.tDepth.value = src && src.depthTexture;
    PFX_U.uCamNF.value.x = camera.near; PFX_U.uCamNF.value.y = camera.far;
    const mask = camera.layers.mask, bg = scene.background, auto = r.autoClear;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(true, false, false);
    camera.layers.set(LAYER_PFX); scene.background = null; r.autoClear = false;
    r.render(scene, camera);
    camera.layers.mask = mask; scene.background = bg; r.autoClear = auto;
    const U = this.mat.uniforms;
    U.tScene.value = readBuffer.texture; U.tFx.value = this.rt.texture; U.uTime.value = GAME_T;
    for(let i=0;i<2;i++){
      const w = WAVES[i], v = U.uWave.value[i];
      if(!w){ v.set(0,0,0,0); continue; }
      _wv.copy(w.p).project(camera);
      const k = w.t/w.dur, behind = _wv.z > 1;
      const dist = Math.max(1, camera.position.distanceTo(w.p));
      v.set(_wv.x*0.5 + 0.5, _wv.y*0.5 + 0.5, k*Math.min(0.9, 7/dist), behind ? 0 : (1 - k)*(1 - k)*w.k*Math.min(1, 9/dist));
    }
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(r);
  }
}
function updateWaves(dt){ for(let i=WAVES.length-1;i>=0;i--){ WAVES[i].t += dt; if(WAVES[i].t >= WAVES[i].dur) WAVES.splice(i, 1); } }
let composer, bloomPass, gradePass, smaaPass, aoPass, vmPass, fxPass, scenePass;
function buildComposer(){
  composer = new EffectComposer(renderer);
  // глубина сцены — текстурой: её читают частицы в своём проходе
  for(const t of [composer.renderTarget1, composer.renderTarget2]){
    t.depthTexture = new THREE.DepthTexture(t.width, t.height); t.depthTexture.type = THREE.UnsignedIntType;
  }
  scenePass = new SceneRenderPass(scene, camera);
  composer.addPass(scenePass);
  // Ambient occlusion: без контактных теней стыки стен/пола выглядят плоско.
  // Проход дорогой, поэтому на слабых профилях его заменяет запечённый AO
  // из карт высот — он уже есть у всех основных материалов.
  if(Q.ao){
    aoPass = new GTAOPass(scene, camera, innerWidth, innerHeight);
    aoPass.output = GTAOPass.OUTPUT.Default;
    aoPass.updateGtaoMaterial({
      radius: 0.42, distanceExponent: 1.6, thickness: 0.6,
      scale: 1.1, samples: QNAME==='ultra' ? 16 : 10, screenSpaceRadius: false
    });
    aoPass.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.2, normalPhi: 3.6, radius: 4, samples: 8 });
    aoPass.blendIntensity = 1.0;
    // В проход глубины/нормалей AO не пускаем прозрачное без записи глубины:
    // столбы света, частицы, декали, пламя перед камерой. Раньше для этого
    // каждый кадр обходилась вся сцена; теперь достаточно выключить слой FX.
    aoPass.overrideVisibility = function(){ this._mask = camera.layers.mask; camera.layers.disable(LAYER_FX); };
    aoPass.restoreVisibility = function(){ camera.layers.mask = this._mask; };
    composer.addPass(aoPass);
  }
  fxPass = new OffscreenFXPass(scenePass, 0.5);
  composer.addPass(fxPass);
  vmPass = new ViewmodelPass();
  composer.addPass(vmPass);
  if(Q.bloom){
    // Ночью ореол вокруг ламп — главный носитель настроения, поэтому
    // порог ниже дневного и подстраивается в applyDaylight.
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight), 0.28, 0.85, 0.98);
    composer.addPass(bloomPass);
  }
  // Тонмаппинг и перевод в sRGB — до грейдинга: кривая контраста и тонировка
  // работают с экранными значениями 0..1. Раньше контраст применялся к
  // линейному HDR и обрезал всё тёмное в ноль (почти чёрные стены дома).
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  composer.addPass(gradePass);
  if(Q.smaa){
    smaaPass = new SMAAPass(innerWidth*renderer.getPixelRatio(), innerHeight*renderer.getPixelRatio());
    composer.addPass(smaaPass);
  }
}

const DAY = {
  get t(){ return DAY_T; }, set t(v){ DAY_T = ((v%1)+1)%1; },
  get speed(){ return DAY_SPEED; }, set speed(v){ DAY_SPEED = v; },
  get paused(){ return DAY_PAUSED; }, set paused(v){ DAY_PAUSED = v; },
  get lamp(){ return LAMP_LEVEL; }, get elev(){ return SUN_ELEV; }
};
function getComposer(){ return composer; }
function getPasses(){ return {bloomPass, gradePass, smaaPass, aoPass}; }
function getDust(){ return dust; }

// Физика на Ammo.js (Bullet): статический мир, обломки, персонаж, ткань флагов.

const GRP = { STATIC:1, DYN:2, DEBRIS:4, CHAR:8, PROJ:16 };
/** Коды поверхностей статики, хранятся в userIndex тела как отрицательные числа. */
const SURF_CODE = { conc:-2, metal:-3, wood:-4, sand:-5, glass:-6 };
const SURF_NAME = { '-2':'conc', '-3':'metal', '-4':'wood', '-5':'sand', '-6':'glass' };

const PH = {
  A:null, world:null, ready:false,
  dyn:[],               // {body, mesh, life, owner, sleepT}
  owners:[],            // userIndex ≥ 0 → владелец (разрушаемый элемент, обломок)
  soft:[],              // флаги
  onContact:null,       // (pos, impulse, a, b) — звуки ударов
  maxDyn: 220,
  t1:null, t2:null, v1:null, v2:null, q1:null
};
let A, world;

async function initPhysics(){
  // ammo.wasm.js подключён классическим <script>: он объявляет глобальную фабрику Ammo.
  // Бинарник Bullet (wasm) вшит в этот же HTML как base64 — внешних файлов нет
  const b64 = document.getElementById('ammo-wasm').textContent.trim();
  const bin = await decodeBase64(b64);
  A = PH.A = await window.Ammo({ wasmBinary: bin });
  const cc = new A.btSoftBodyRigidBodyCollisionConfiguration();
  const disp = new A.btCollisionDispatcher(cc);
  const bp = new A.btDbvtBroadphase();
  const solver = new A.btSequentialImpulseConstraintSolver();
  const softSolver = new A.btDefaultSoftBodySolver();
  world = PH.world = new A.btSoftRigidDynamicsWorld(disp, bp, solver, cc, softSolver);
  world.setGravity(new A.btVector3(0,-9.81,0));
  world.getWorldInfo().set_m_gravity(new A.btVector3(0,-9.81,0));
  world.getWorldInfo().set_air_density(1.2);
  world.getPairCache().setInternalGhostPairCallback(new A.btGhostPairCallback());
  PH.disp = disp;
  PH.t1 = new A.btTransform(); PH.t2 = new A.btTransform();
  PH.v1 = new A.btVector3(); PH.v2 = new A.btVector3(); PH.q1 = new A.btQuaternion(0,0,0,1);
  PH.ready = true;
}

/** base64 → байты без atob и посимвольного Uint8Array.from (0.75 МБ wasm
    так разбирались сотни миллисекунд и лишние мегабайты строк). */
async function decodeBase64(b64){
  if(typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
  try{ const r = await fetch('data:application/octet-stream;base64,' + b64); return new Uint8Array(await r.arrayBuffer()); }catch(e){}
  const T = new Uint8Array(128), ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for(let i=0;i<64;i++) T[ABC.charCodeAt(i)] = i;
  const n = b64.length, pad = b64.endsWith('==') ? 2 : (b64.endsWith('=') ? 1 : 0), out = new Uint8Array(n/4*3 - pad);
  for(let i=0, j=0; i<n; i+=4){
    const v = T[b64.charCodeAt(i)]<<18 | T[b64.charCodeAt(i+1)]<<12 | T[b64.charCodeAt(i+2)]<<6 | T[b64.charCodeAt(i+3)];
    out[j++] = v>>16; if(j < out.length) out[j++] = (v>>8) & 255; if(j < out.length) out[j++] = v & 255;
  }
  return out;
}
/* ---------- формы и тела ---------- */
function boxShape(hx,hy,hz){
  const s = new A.btBoxShape(new A.btVector3(hx,hy,hz));
  s.setMargin(Math.min(0.02, Math.min(hx,hy,hz)*0.5));
  return s;
}
function makeBody(shape, mass, pos, quat, opt={}){
  const tr = new A.btTransform(); tr.setIdentity();
  tr.setOrigin(new A.btVector3(pos.x, pos.y, pos.z));
  if(quat) tr.setRotation(new A.btQuaternion(quat.x, quat.y, quat.z, quat.w));
  const ms = new A.btDefaultMotionState(tr);
  const inertia = new A.btVector3(0,0,0);
  if(mass > 0) shape.calculateLocalInertia(mass, inertia);
  const info = new A.btRigidBodyConstructionInfo(mass, ms, shape, inertia);
  const body = new A.btRigidBody(info);
  A.destroy(info); A.destroy(inertia); A.destroy(tr);
  body.setFriction(opt.friction ?? 0.8);
  body.setRestitution(opt.restitution ?? 0.1);
  if(opt.rolling) body.setRollingFriction(opt.rolling);
  body._shape = shape; body._ms = ms;
  return body;
}
/** Статический бокс из записи коллайдера. */
function addStaticCollider(c, userIndex){
  normCollider(c);
  const shape = boxShape(Math.max(c.hx,0.005), Math.max(c.hy,0.005), Math.max(c.hz,0.005));
  const q = c.q ? {x:c.q[0], y:c.q[1], z:c.q[2], w:c.q[3]} : null;
  const body = makeBody(shape, 0, {x:c.cx, y:c.cy, z:c.cz}, q, {friction:0.9});
  body.setUserIndex(userIndex ?? (SURF_CODE[c.surf] ?? -2));
  const mask = c.playerOnly ? GRP.CHAR : (c.noPlayer ? (GRP.DYN|GRP.DEBRIS|GRP.PROJ) : -1);
  world.addRigidBody(body, GRP.STATIC, mask);
  c.body = body;
  return body;
}
function buildStaticWorld(){
  let n = 0;
  for(const c of COLLIDERS){ if(c.body || c.skipPhys) continue; addStaticCollider(c); n++; }
  return n;
}
/** Статическое составное тело (лист обшивки из оставшихся кусков). parts: [{cx,cy,cz,hx,hy,hz}] в мире. */
function addStaticCompound(parts, quat, userIndex, origin){
  const cs = new A.btCompoundShape(true);
  const lt = new A.btTransform();
  const qi = new THREE.Quaternion(quat.x,quat.y,quat.z,quat.w).invert();
  const shapes = [];
  const o = origin;
  for(const p of parts){
    const s = boxShape(p.hx, p.hy, p.hz); shapes.push(s);
    const lp = new THREE.Vector3(p.cx-o.x, p.cy-o.y, p.cz-o.z).applyQuaternion(qi);
    lt.setIdentity(); lt.setOrigin(new A.btVector3(lp.x, lp.y, lp.z));
    cs.addChildShape(lt, s);
  }
  A.destroy(lt);
  const body = makeBody(cs, 0, o, quat, {friction:0.9});
  body._children = shapes;
  body.setUserIndex(userIndex);
  world.addRigidBody(body, GRP.STATIC, -1);
  return body;
}
function removeBody(body){
  if(!body) return;
  world.removeRigidBody(body);
  if(body._children) for(const s of body._children) A.destroy(s);
  A.destroy(body._shape); A.destroy(body._ms); A.destroy(body);
}
function registerOwner(o){ PH.owners.push(o); return PH.owners.length-1; }

/** Динамическое тело, привязанное к мешу. shape — 'box' (по размерам) | 'sphere' | 'cyl' | Ammo-форма. */
function addDynamic(mesh, opt={}){
  let shape;
  const s = opt.size || [0.2,0.2,0.2];
  if(opt.shape === 'sphere') shape = new A.btSphereShape(opt.radius ?? 0.1);
  else if(opt.shape === 'cyl'){ shape = new A.btCylinderShape(new A.btVector3(s[0]/2, s[1]/2, s[0]/2)); shape.setMargin(0.01); }
  else if(opt.shape && typeof opt.shape === 'object') shape = opt.shape;
  else shape = boxShape(Math.max(s[0]/2,0.004), Math.max(s[1]/2,0.004), Math.max(s[2]/2,0.004));
  const mass = opt.mass ?? 1;
  const body = makeBody(shape, mass, mesh.position, mesh.quaternion,
    {friction:opt.friction ?? 0.7, restitution:opt.restitution ?? 0.15, rolling:opt.rolling});
  body.setDamping(opt.linDamp ?? 0.05, opt.angDamp ?? 0.25);
  if(opt.vel){ PH.v1.setValue(opt.vel.x, opt.vel.y, opt.vel.z); body.setLinearVelocity(PH.v1); }
  if(opt.spin){ PH.v1.setValue(opt.spin.x, opt.spin.y, opt.spin.z); body.setAngularVelocity(PH.v1); }
  if(opt.ccd){ body.setCcdMotionThreshold(opt.ccd); body.setCcdSweptSphereRadius(opt.ccd*0.8); }
  const grp = opt.group ?? GRP.DEBRIS;
  const mask = opt.mask ?? (grp === GRP.DEBRIS ? (GRP.STATIC|GRP.DYN|GRP.DEBRIS|GRP.PROJ)
                        : (GRP.STATIC|GRP.DYN|GRP.DEBRIS|GRP.CHAR|GRP.PROJ));
  world.addRigidBody(body, grp, mask);
  const rec = { body, mesh, life: opt.life ?? 30, age:0, owner: opt.owner || null, surf: opt.surf || 'wood',
                sleepT:0, fade:0, onStep: opt.onStep || null, keep: !!opt.keep };
  const idx = registerOwner({type:'dyn', rec});
  body.setUserIndex(idx); rec.idx = idx;
  mesh.userData.nomerge = true;
  mesh.traverse(ensureColor);
  PH.dyn.push(rec);
  // жёсткий потолок: самые старые обломки уходят первыми
  if(PH.dyn.length > PH.maxDyn){
    const old = PH.dyn.find(r=>!r.keep);
    if(old) old.life = Math.min(old.life, old.age + 0.5);
  }
  return rec;
}
function killDynamic(rec){
  const i = PH.dyn.indexOf(rec); if(i>=0) PH.dyn.splice(i,1);
  PH.owners[rec.idx] = null;
  removeBody(rec.body);
  if(rec.mesh){ rec.mesh.removeFromParent(); if(rec.mesh.userData.ownGeo) rec.mesh.geometry.dispose(); }
}
function impulse(body, ix,iy,iz, rx=0,ry=0,rz=0){
  body.activate(true);
  PH.v1.setValue(ix,iy,iz); PH.v2.setValue(rx,ry,rz);
  body.applyImpulse(PH.v1, PH.v2);
}
/** Импульс взрыва всем динамическим телам в радиусе. */
function blastImpulse(p, R, power){
  for(const r of PH.dyn){
    const tr = r.body.getWorldTransform().getOrigin();
    const dx = tr.x()-p.x, dy = tr.y()-p.y, dz = tr.z()-p.z;
    const d = Math.hypot(dx,dy,dz);
    if(d > R || d < 1e-3) continue;
    const k = power * Math.pow(1 - d/R, 1.6) / d;
    impulse(r.body, dx*k, dy*k + Math.abs(k)*0.35*d, dz*k,
            (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05, (Math.random()-0.5)*0.05);
  }
}

/* ---------- лучи ---------- */
/** Все пересечения отрезка, отсортированные по дальности. */
function rayAll(from, to, mask=-1){
  PH.v1.setValue(from.x,from.y,from.z); PH.v2.setValue(to.x,to.y,to.z);
  const cb = new A.AllHitsRayResultCallback(PH.v1, PH.v2);
  cb.set_m_collisionFilterGroup(-1); cb.set_m_collisionFilterMask(mask);
  world.rayTest(PH.v1, PH.v2, cb);
  const out = [];
  if(cb.hasHit()){
    const objs = cb.get_m_collisionObjects(), fr = cb.get_m_hitFractions(),
          pts = cb.get_m_hitPointWorld(), nrm = cb.get_m_hitNormalWorld();
    for(let i=0;i<objs.size();i++){
      const p = pts.at(i), n = nrm.at(i);
      out.push({ idx: objs.at(i).getUserIndex(), f: fr.at(i),
                 p: new THREE.Vector3(p.x(),p.y(),p.z()), n: new THREE.Vector3(n.x(),n.y(),n.z()) });
    }
  }
  A.destroy(cb);
  out.sort((a,b)=>a.f-b.f);
  return out;
}
/** Ближайшее пересечение (или null). */
function rayFirst(from, to, mask=GRP.STATIC){
  PH.v1.setValue(from.x,from.y,from.z); PH.v2.setValue(to.x,to.y,to.z);
  const cb = new A.ClosestRayResultCallback(PH.v1, PH.v2);
  cb.set_m_collisionFilterGroup(-1); cb.set_m_collisionFilterMask(mask);
  world.rayTest(PH.v1, PH.v2, cb);
  let out = null;
  if(cb.hasHit()){
    const p = cb.get_m_hitPointWorld(), n = cb.get_m_hitNormalWorld();
    out = { f: cb.get_m_closestHitFraction(), idx: cb.get_m_collisionObject().getUserIndex(),
            p: new THREE.Vector3(p.x(),p.y(),p.z()), n: new THREE.Vector3(n.x(),n.y(),n.z()) };
  }
  A.destroy(cb);
  return out;
}

/* ---------- персонаж ---------- */
function makeCharacter(pos, radius=0.32, height=1.1, stepH=0.42){
  const shape = new A.btCapsuleShape(radius, height);
  const ghost = new A.btPairCachingGhostObject();
  const tr = new A.btTransform(); tr.setIdentity();
  tr.setOrigin(new A.btVector3(pos.x, pos.y, pos.z));
  ghost.setWorldTransform(tr); A.destroy(tr);
  ghost.setCollisionShape(shape);
  ghost.setCollisionFlags(16);               // CF_CHARACTER_OBJECT
  ghost.setUserIndex(-10);
  const kcc = new A.btKinematicCharacterController(ghost, shape, stepH, 1);
  kcc.setGravity(19.0); kcc.setJumpSpeed(6.4); kcc.setFallSpeed(40);
  kcc.setMaxSlope(52*Math.PI/180);
  kcc.setUseGhostSweepTest(true);
  world.addCollisionObject(ghost, GRP.CHAR, GRP.STATIC|GRP.DYN);
  world.addAction(kcc);
  const walk = new A.btVector3(0,0,0), wv = new A.btVector3(0,0,0);
  return {
    kcc, ghost, radius, height, half: height/2 + radius,
    setWalk(x,z){ walk.setValue(x,0,z); kcc.setWalkDirection(walk); },
    warp(p){ wv.setValue(p.x,p.y,p.z); kcc.warp(wv); },
    pos(out){ const o = ghost.getWorldTransform().getOrigin(); return out.set(o.x(),o.y(),o.z()); },
    onGround(){ return kcc.onGround(); },
    jump(){ if(kcc.canJump()) kcc.jump(); },
    enable(on){
      if(on && !this._on){ world.addCollisionObject(ghost, GRP.CHAR, GRP.STATIC|GRP.DYN); world.addAction(kcc); }
      if(!on && this._on){ world.removeAction(kcc); world.removeCollisionObject(ghost); }
      this._on = on;
    },
    _on:true
  };
}

/* ---------- ткань (флаги) ---------- */
/** Полотнище на мачте: сетка узлов Bullet soft body, кромка у древка закреплена.
    hoistTop — верхний угол у древка, along — единичный вектор к свободному краю. */
function makeFlagCloth(mat, hoistTop, along, W, H, nx, ny){
  const wi = world.getWorldInfo();
  const sbh = new A.btSoftBodyHelpers();
  const P = (u,v)=> new A.btVector3(hoistTop.x + along.x*u, hoistTop.y - v, hoistTop.z + along.z*u);
  const soft = sbh.CreatePatch(wi, P(0,0), P(W,0), P(0,H), P(W,H), nx, ny, 0, true);
  const cfg = soft.get_m_cfg();
  cfg.set_viterations(6); cfg.set_piterations(8);
  cfg.set_kDP(0.004); cfg.set_kDG(0.0); cfg.set_kLF(0.0);
  cfg.set_collisions(0);
  const m0 = soft.get_m_materials().at(0);
  m0.set_m_kLST(0.95); m0.set_m_kAST(0.9);
  soft.generateBendingConstraints(2, m0);
  soft.setTotalMass(0.9, false);
  const N = nx*ny;
  for(let j=0;j<ny;j++) soft.setMass(j*nx, 0);        // шкаторина у древка
  world.addSoftBody(soft, 1, -1);
  A.destroy(sbh);
  // геометрия с тем же порядком узлов: индекс = i + j*nx
  const pos = new Float32Array(N*3), uv = new Float32Array(N*2);
  const nodes = soft.get_m_nodes();
  for(let k=0;k<N;k++){
    const x = nodes.at(k).get_m_x(); pos[k*3]=x.x(); pos[k*3+1]=x.y(); pos[k*3+2]=x.z();
    const i = k % nx, j = Math.floor(k/nx);
    uv[k*2] = i/(nx-1); uv[k*2+1] = 1 - j/(ny-1);
  }
  const idx = [];
  for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++){
    const a=i+j*nx, b=a+1, c=a+nx, d=c+1;
    idx.push(a,c,b, b,c,d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.setIndex(idx); g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.nomerge = true;
  const rec = { soft, mesh, nx, ny, N, tris: idx, area: W*H, gust: Math.random()*10 };
  PH.soft.push(rec);
  return rec;
}
const _fa = new THREE.Vector3(), _fb = new THREE.Vector3(); new THREE.Vector3(); const _fn = new THREE.Vector3(), _fv = new THREE.Vector3();
/** Ветер давит на каждый треугольник по его нормали: полотнище само ловит поток. */
function windOnCloth(rec, wind, extra){
  const nodes = rec.soft.get_m_nodes(), t = rec.tris;
  const F = new Float32Array(rec.N*3);
  const X = rec._x || (rec._x = new Float32Array(rec.N*3)), V = rec._vv || (rec._vv = new Float32Array(rec.N*3));
  for(let k=0;k<rec.N;k++){
    const nd = nodes.at(k), x = nd.get_m_x(), v = nd.get_m_v();
    X[k*3]=x.x(); X[k*3+1]=x.y(); X[k*3+2]=x.z(); V[k*3]=v.x(); V[k*3+1]=v.y(); V[k*3+2]=v.z();
  }
  for(let i=0;i<t.length;i+=3){
    const a=t[i], b=t[i+1], c=t[i+2];
    _fa.set(X[b*3]-X[a*3], X[b*3+1]-X[a*3+1], X[b*3+2]-X[a*3+2]);
    _fb.set(X[c*3]-X[a*3], X[c*3+1]-X[a*3+1], X[c*3+2]-X[a*3+2]);
    _fn.crossVectors(_fa,_fb); const area2 = _fn.length(); if(area2 < 1e-8) continue;
    _fn.multiplyScalar(1/area2);
    _fv.set(wind.x - (V[a*3]+V[b*3]+V[c*3])/3, wind.y - (V[a*3+1]+V[b*3+1]+V[c*3+1])/3, wind.z - (V[a*3+2]+V[b*3+2]+V[c*3+2])/3);
    const vn = _fn.dot(_fv);
    // 0.5·ρ·Cd·S·v²; вдоль полотна — слабое трение потока (рябь)
    const f = 0.5*1.2*1.1*(area2*0.5)*vn*Math.abs(vn);
    for(const k of [a,b,c]){ F[k*3]+=_fn.x*f/3; F[k*3+1]+=_fn.y*f/3; F[k*3+2]+=_fn.z*f/3; }
  }
  for(let k=0;k<rec.N;k++){
    let fx=F[k*3], fy=F[k*3+1], fz=F[k*3+2];
    if(extra){ fx+=extra.x; fy+=extra.y; fz+=extra.z; }
    PH.v1.setValue(fx,fy,fz); rec.soft.addForce(PH.v1, k);
  }
  return X;
}
/** Удар по ткани: взрыв или пуля. */
function pokeCloth(p, R, power){
  for(const rec of PH.soft){
    const nodes = rec.soft.get_m_nodes();
    for(let k=0;k<rec.N;k++){
      const x = nodes.at(k).get_m_x();
      const dx=x.x()-p.x, dy=x.y()-p.y, dz=x.z()-p.z, d=Math.hypot(dx,dy,dz);
      if(d > R || d < 1e-4) continue;
      const s = power*(1-d/R)/d;
      PH.v1.setValue(dx*s, dy*s, dz*s); rec.soft.addForce(PH.v1, k);
    }
  }
}

/* ---------- шаг ---------- */
const _contactP = new THREE.Vector3();
function stepPhysics(dt, wind){
  if(!PH.ready) return;
  for(const rec of PH.soft) rec._X = windOnCloth(rec, wind, rec.push);
  // кадр ограничен 0.05 с: 6 подшагов по 1/90 покрывают его целиком (4 давали 0.044 с —
  // при просадках FPS время физики терялось и всё замедлялось)
  world.stepSimulation(dt, 6, 1/90);
  // синхронизация мешей
  for(let i=PH.dyn.length-1;i>=0;i--){
    const r = PH.dyn[i];
    r.age += dt;
    if(r.age > r.life){
      // исчезают, проваливаясь в пол — не хлопком
      r.fade += dt;
      if(r.fade > 1.2){ killDynamic(r); continue; }
      r.mesh.scale.setScalar(Math.max(0.01, 1 - r.fade/1.2));
    }
    const ms = r.body.getMotionState();
    ms.getWorldTransform(PH.t1);
    const o = PH.t1.getOrigin(), q = PH.t1.getRotation();
    r.mesh.position.set(o.x(), o.y(), o.z());
    r.mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
    if(o.y() < -5) { killDynamic(r); continue; }
    if(r.onStep) r.onStep(r, dt);
  }
  for(const rec of PH.soft){
    const nodes = rec.soft.get_m_nodes();
    const pa = rec.mesh.geometry.attributes.position;
    for(let k=0;k<rec.N;k++){ const x = nodes.at(k).get_m_x(); pa.setXYZ(k, x.x(), x.y(), x.z()); }
    pa.needsUpdate = true; rec.mesh.geometry.computeVertexNormals();
  }
  // контакты: звук и пыль от сильных ударов
  if(PH.onContact){
    const n = PH.disp.getNumManifolds();
    let fired = 0;
    for(let i=0;i<n && fired<4;i++){
      const m = PH.disp.getManifoldByIndexInternal(i);
      const nc = m.getNumContacts(); if(!nc) continue;
      const b0 = m.getBody0(), b1 = m.getBody1();
      const i0 = b0.getUserIndex(), i1 = b1.getUserIndex();
      const o0 = i0 >= 0 ? PH.owners[i0] : null, o1 = i1 >= 0 ? PH.owners[i1] : null;
      const dyn = (o0 && o0.type==='dyn') ? o0.rec : (o1 && o1.type==='dyn') ? o1.rec : null;
      if(!dyn) continue;
      let best = 0, bp = null;
      for(let k=0;k<nc;k++){ const cp = m.getContactPoint(k); const imp = cp.getAppliedImpulse();
        if(imp > best){ best = imp; bp = cp.get_m_positionWorldOnA(); } }
      if(best > 0.25 && bp && (!dyn._lastHit || dyn.age - dyn._lastHit > 0.15)){
        dyn._lastHit = dyn.age;
        PH.onContact(_contactP.set(bp.x(),bp.y(),bp.z()), best, dyn);
        fired++;
      }
    }
  }
}

// Эффекты: частицы (пламя, дым, пыль, искры), щепа и крошка, декали, воронки,
// вспышки света и процедурный звук WebAudio с реверберацией ангара.

/* ============================================================================
   ЧАСТИЦЫ-БИЛБОРДЫ
   Инстансированные квады: одна отрисовка на систему. Симуляция на CPU,
   живые частицы упакованы в начало буфера, count = числу живых.
============================================================================ */
const QUAD = (()=>{
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5,-0.5,0, .5,-0.5,0, .5,.5,0, -0.5,.5,0]),3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0,0, 1,0, 1,1, 0,1]),2));
  g.setIndex([0,1,2, 0,2,3]);
  return g;
})();
const FXU = {
  uAmb:{value:new THREE.Color(1,1,1)},        // рассеянный свет для дыма (день/ночь)
  uSunDir:{value:new THREE.Vector3(0,1,0)}, uSunCol:{value:new THREE.Color(0,0,0)},
  uFireCol:{value:new THREE.Color(1.0*1.9, 0.42*1.9, 0.12*1.9)}
};
const _pFwd = new THREE.Vector3(), _WHITE = [1,1,1];
/** Частицы-билборды. kind: 'plain' — текстура × цвет; 'flame' — кадры атласа,
    цвет по возрасту (бело-жёлтое ядро → оранжевый → тёмно-красный), HDR для
    свечения; 'smoke' — освещённый дым: нормаль из атласа, солнце, небо и
    подсветка пламенем снизу, сортировка по глубине, растворение у камеры. */
class Particles {
  constructor({tex, max=500, additive=false, lit=false, stretch=false, kind='plain', sheet=1, sort=false, soft}){
    this.max = max; this.kind = kind; this.sheet = sheet; this.sort = sort;
    const g = QUAD.clone();
    const dyn = n => new THREE.InstancedBufferAttribute(new Float32Array(max*n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = dyn(3); this.aSR = dyn(4); this.aCol = dyn(4); this.aVel = dyn(3); this.aExt = dyn(2);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iSR', this.aSR); g.setAttribute('iCol', this.aCol);
    g.setAttribute('iVel', this.aVel); g.setAttribute('iExt', this.aExt);
    g.instanceCount = 0;
    const frag = {
      plain:`
        vec4 t = texture2D(map, frameUv());
        gl_FragColor = vec4(t.rgb*vCol.rgb*uAmb, t.a*vCol.a);
        if(gl_FragColor.a < 0.004) discard;`,
      flame:`
        vec4 t = texture2D(map, frameUv());
        float k = vExt.y;
        vec3 g = mix(vec3(1.0,0.84,0.52)*2.4, vec3(1.0,0.40,0.09)*1.5, smoothstep(0.0,0.5,k));
        g = mix(g, vec3(0.5,0.08,0.02)*0.6, smoothstep(0.5,1.0,k));
        float a = t.a*vCol.a*smoothstep(0.05, 0.6, vDepth);
        gl_FragColor = vec4(t.rgb*g*vCol.rgb, a);
        if(a < 0.004) discard;`,
      smoke:`
        vec4 t = texture2D(map, frameUv());
        float c = cos(vRot), s = sin(vRot);
        vec2 nn = t.rg*2.0 - 1.0; nn = vec2(c*nn.x - s*nn.y, s*nn.x + c*nn.y);
        vec2 q = vUv*2.0 - 1.0;   q = vec2(c*q.x - s*q.y, s*q.x + c*q.y);
        vec3 nV = normalize(vec3(nn*0.9 + q*0.15, 1.0));
        vec3 nW = normalize((vec4(nV, 0.0)*viewMatrix).xyz);
        float sunL = clamp(dot(nW, uSunDir)*0.6 + 0.4, 0.0, 1.0);
        float sky = clamp(nW.y*0.5 + 0.5, 0.0, 1.0);
        vec3 light = uAmb*(0.5 + 0.5*sky) + uSunCol*sunL;
        light += uFireCol*vExt.x*(0.3 + 0.7*clamp(0.5 - nW.y*0.5, 0.0, 1.0));
        vec3 col = vCol.rgb*light*(0.7 + 0.3*t.b);
        float a = t.a*vCol.a*smoothstep(0.2, 1.4, vDepth);
        gl_FragColor = vec4(col, a);
        if(a < 0.003) discard;`
    }[kind];
    const mat = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms:{ map:{value:tex}, uAmb: lit ? FXU.uAmb : {value:new THREE.Color(1,1,1)}, uStretch:{value: stretch?1:0},
        uSheet:{value:sheet}, uSunDir:FXU.uSunDir, uSunCol:FXU.uSunCol, uFireCol:FXU.uFireCol },
      vertexShader:`
        attribute vec3 iPos; attribute vec4 iSR; attribute vec4 iCol; attribute vec3 iVel; attribute vec2 iExt;
        uniform float uStretch;
        varying vec2 vUv; varying vec4 vCol; varying vec2 vExt; varying float vFrame, vRot, vDepth, vSize;
        void main(){
          vUv = uv; vCol = iCol; vExt = iExt; vFrame = iSR.w; vRot = iSR.z; vSize = max(iSR.x, iSR.y);
          vec4 mv = modelViewMatrix*vec4(iPos,1.0);
          vDepth = -mv.z;
          float c = cos(iSR.z), s = sin(iSR.z);
          vec2 p = position.xy*iSR.xy;
          if(uStretch > 0.5){
            // искры вытягиваются вдоль скорости в экранной плоскости
            vec3 vv = (modelViewMatrix*vec4(iVel,0.0)).xyz;
            vec2 d = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(0.0,1.0);
            float L = 1.0 + length(vv.xy)*0.035;
            p = vec2(p.x, p.y*L);
            mv.xy += vec2(d.y*p.x + d.x*p.y, -d.x*p.x + d.y*p.y);
          } else {
            mv.xy += vec2(c*p.x - s*p.y, s*p.x + c*p.y);
          }
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader:`
        uniform sampler2D map; uniform vec3 uAmb, uSunDir, uSunCol, uFireCol; uniform float uSheet;
        varying vec2 vUv; varying vec4 vCol; varying vec2 vExt; varying float vFrame, vRot, vDepth, vSize;
        vec2 frameUv(){
          if(uSheet < 1.5) return vUv;
          float f = floor(vFrame + 0.5), cx = mod(f, uSheet), cy = floor(f/uSheet);
          return (vec2(cx, uSheet - 1.0 - cy) + vUv)/uSheet;
        }
        ${PFX_GLSL_PARS}
        void main(){ ${frag} ${pfxOut(soft ?? (kind === 'smoke' ? 0.3 : kind === 'flame' ? 0.4 : 0.5), additive)} }`
    });
    pfxMaterial(mat);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.layers.set(LAYER_PFX);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 6 : 5;
    this.mesh.userData.nomerge = true;
    this.P = [];      // живые частицы
    this.free = [];   // пул: частицы не создаются заново при каждом выстреле
    scene.add(this.mesh);
  }
  /** o: {p, v, life, s0, s1, asp, rot, spin, col:[r,g,b], a0, a1, aPow, drag, g, turb, fadeIn,
         heat, frame, fps, ceil, wind} */
  spawn(o){
    let q;
    if(this.P.length >= this.max) q = this.P.shift();
    else q = this.free.pop() || { p:new THREE.Vector3(), v:new THREE.Vector3() };
    q.p.copy(o.p); if(o.v) q.v.copy(o.v); else q.v.set(0,0,0);
    q.t = 0; q.life = o.life || 1;
    q.s0 = o.s0 ?? 0.3; q.s1 = o.s1 ?? o.s0 ?? 0.3; q.asp = o.asp ?? 1;
    q.rot = o.rot ?? Math.random()*6.28; q.spin = o.spin ?? 0;
    q.col = o.col || _WHITE; q.a0 = o.a0 ?? 1; q.a1 = o.a1 ?? 0; q.aPow = o.aPow ?? 1;
    q.drag = o.drag ?? 0.5; q.g = o.g ?? 0; q.turb = o.turb ?? 0; q.fadeIn = o.fadeIn ?? 0.05;
    q.heat = o.heat ?? 0; q.fps = o.fps ?? 0; q.ceil = o.ceil ?? 1e9; q.wind = o.wind ?? 0;
    q.frame = o.frame ?? (this.sheet > 1 ? Math.floor(Math.random()*this.sheet*this.sheet) : 0);
    q.seed = Math.random()*100; q.floor = o.floor; q.seek = o.seek || null;
    this.P.push(q);
  }
  update(dt, time){
    const P = this.P, W = WIND.vec, N = this.sheet*this.sheet;
    for(let i=P.length-1;i>=0;i--){
      const q = P[i]; q.t += dt;
      if(q.t >= q.life){ P[i] = P[P.length-1]; P.pop(); this.free.push(q); continue; }
      q.v.y += q.g*dt;
      if(q.turb){ q.v.x += Math.sin(time*3.1+q.seed)*q.turb*dt; q.v.z += Math.cos(time*2.7+q.seed*1.3)*q.turb*dt; }
      if(q.wind){ q.v.x += W.x*q.wind*dt; q.v.z += W.z*q.wind*dt; }
      const dr = Math.max(0, 1 - q.drag*dt);
      q.v.multiplyScalar(dr);
      q.p.addScaledVector(q.v, dt);
      // дым под перекрытием тянется к проёму наружу и там уходит вверх
      if(q.seek && q.p.y > q.ceil - 0.4){
        const dx = q.seek.x - q.p.x, dz = q.seek.z - q.p.z, dd = Math.hypot(dx, dz);
        if(dd < 0.8){ q.ceil = 1e9; q.seek = null; q.v.x += dx/(dd + 0.1)*0.6; q.v.z += dz/(dd + 0.1)*0.6; }
        else { q.v.x += dx/dd*0.9*dt; q.v.z += dz/dd*0.9*dt; }
      }
      // дым упирается в потолок и растекается под ним слоем
      if(q.p.y > q.ceil){
        q.p.y = q.ceil;
        if(q.v.y > 0){ const a = q.seed*2.7, up = q.v.y*0.7; q.v.x += Math.cos(a)*up; q.v.z += Math.sin(a)*up; q.v.y = 0; }
      }
      if(q.floor !== undefined && q.p.y < q.floor){ q.p.y = q.floor; q.v.y *= -0.3; q.v.x*=0.5; q.v.z*=0.5; }
      q.rot += q.spin*dt;
    }
    // прозрачный дым рисуется от дальнего к ближнему, иначе клубы «просвечивают»
    if(this.sort && P.length > 1){
      camera.getWorldDirection(_pFwd); const c = camera.position;
      for(const q of P) q.dk = (q.p.x-c.x)*_pFwd.x + (q.p.y-c.y)*_pFwd.y + (q.p.z-c.z)*_pFwd.z;
      P.sort((a,b)=> b.dk - a.dk);
    }
    const n = Math.min(P.length, this.max);
    const pa = this.aPos.array, sr = this.aSR.array, ca = this.aCol.array, va = this.aVel.array, ea = this.aExt.array;
    const smoke = this.kind === 'smoke';
    for(let i=0;i<n;i++){
      const q = P[i], k = q.t/q.life;
      pa[i*3]=q.p.x; pa[i*3+1]=q.p.y; pa[i*3+2]=q.p.z;
      va[i*3]=q.v.x; va[i*3+1]=q.v.y; va[i*3+2]=q.v.z;
      // дым быстро раздувается в начале и медленно — потом
      const gk = smoke ? 1 - (1-k)*(1-k) : Math.sqrt(k);
      const sz = q.s0 + (q.s1 - q.s0)*gk;
      sr[i*4] = sz; sr[i*4+1] = sz*q.asp; sr[i*4+2] = q.rot;
      sr[i*4+3] = N > 1 ? (q.fps ? Math.floor(q.frame + q.t*q.fps) % N : q.frame) : 0;
      const fin = q.fadeIn > 0 ? clamp(q.t/q.fadeIn, 0, 1) : 1;
      const ak = q.aPow === 1 ? k : Math.pow(k, q.aPow);
      ca[i*4]=q.col[0]; ca[i*4+1]=q.col[1]; ca[i*4+2]=q.col[2]; ca[i*4+3]=(q.a0 + (q.a1 - q.a0)*ak)*fin;
      ea[i*2] = q.heat ? q.heat*Math.exp(-q.t*0.9) : 0; ea[i*2+1] = k;
    }
    this.mesh.geometry.instanceCount = n;
    for(const [a, m] of [[this.aPos,3],[this.aSR,4],[this.aCol,4],[this.aVel,3],[this.aExt,2]]){
      a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, n*m);
    }
  }
}

/* ---------- процедурный шум для атласов огня и дыма ---------- */
function makeNoise2(seed){
  let s = seed >>> 0;
  const r = ()=>{ s = (s*1664525 + 1013904223) >>> 0; return s/4294967296; };
  const perm = new Uint8Array(512), val = new Float32Array(256), base = [];
  for(let i=0;i<256;i++){ base.push(i); val[i] = r(); }
  for(let i=255;i>0;i--){ const j = Math.floor(r()*(i+1)); const t = base[i]; base[i] = base[j]; base[j] = t; }
  for(let i=0;i<512;i++) perm[i] = base[i & 255];
  return (x, y)=>{
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf*xf*(3-2*xf), v = yf*yf*(3-2*yf), X = xi & 255, Y = yi & 255;
    const a = val[perm[perm[X] + Y]], b = val[perm[perm[X+1] + Y]], c = val[perm[perm[X] + Y + 1]], d = val[perm[perm[X+1] + Y + 1]];
    return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
  };
}
/** Атлас языков пламени 4×4: турбулентный язык, анимация зациклена (16 кадров). */
function flameAtlas(S){
  const C = 4, N = 16, [c, x] = cv(S*C, S*C), img = x.createImageData(S*C, S*C), d = img.data;
  const n1 = makeNoise2(11), n2 = makeNoise2(23);
  const fbm = (n, a, b)=> n(a, b)*0.55 + n(a*2.03, b*2.03)*0.28 + n(a*4.1, b*4.1)*0.17;
  for(let f=0; f<N; f++){
    const ox = (f % C)*S, oy = Math.floor(f/C)*S, tt = f/N;
    for(let py=0; py<S; py++) for(let px=0; px<S; px++){
      const u = (px/S - 0.5)*2, v = py/S, h = 1 - v;              // h: 0 — основание, 1 — верх
      // бесшовный цикл: два отсчёта шума, сдвинутые на длину цикла, смешиваются по времени
      const y0 = h*2.6 - tt*2.6, y1 = h*2.6 - (tt - 1)*2.6;
      const sway = (fbm(n1, u*1.3 + 7, y0)*(1-tt) + fbm(n1, u*1.3 + 7, y1)*tt) - 0.5;
      const w = 0.6*Math.pow(1 - h, 0.6) + 0.05;
      const r = Math.abs(u + sway*0.9*h)/w;
      let a = clamp(1 - r, 0, 1)*smoothstepJS(1.0, 0.84, v);
      const brk = fbm(n2, u*2.6 + 3, y0*1.6)*(1-tt) + fbm(n2, u*2.6 + 3, y1*1.6)*tt;
      a *= smoothstepJS(h*0.9 - 0.12, h*0.9 + 0.2, brk + 0.3*(1 - h));
      a = Math.pow(a, 0.85);
      const core = Math.pow(clamp(1 - r*1.7, 0, 1), 2)*(1 - h*0.8);
      const i = ((oy + py)*S*C + ox + px)*4;
      d[i] = 255; d[i+1] = Math.round(150 + 105*core); d[i+2] = Math.round(70 + 185*core*core); d[i+3] = Math.round(255*a);
    }
  }
  x.putImageData(img, 0, 0);
  return texOf(c);
}
/** Атлас клубов дыма 2×2: плотность из сгустков + fbm; RG — нормаль (для
    освещения в шейдере), B — толщина, A — непрозрачность. */
function smokeAtlas(S){
  const C = 2, [c, x] = cv(S*C, S*C), img = x.createImageData(S*C, S*C), d = img.data;
  const n1 = makeNoise2(5);
  const fbm = (a, b)=> n1(a, b)*0.5 + n1(a*2.1, b*2.1)*0.3 + n1(a*4.3, b*4.3)*0.2;
  const D = new Float32Array(S*S);
  for(let f=0; f<C*C; f++){
    const ox = (f % C)*S, oy = Math.floor(f/C)*S;
    const blobs = [];
    for(let k=0;k<9;k++){ const a = rnd2()*6.283, rr = rnd2()*0.28; blobs.push([Math.cos(a)*rr, Math.sin(a)*rr, 0.16 + rnd2()*0.17]); }
    for(let py=0; py<S; py++) for(let px=0; px<S; px++){
      const u = px/S*2 - 1, v = py/S*2 - 1;
      let den = 0;
      for(const [bx, by, br] of blobs){ const q = ((u-bx)**2 + (v-by)**2)/(br*br); den += Math.exp(-q*1.6); }
      // клочья, а не диск: шум «выедает» края, плотность — пороговая, как у облака
      den *= 0.25 + 1.0*fbm(u*2.2 + f*3.1, v*2.2 + f*1.7);
      den = smoothstepJS(0.12, 0.95, den);
      den *= Math.pow(smoothstepJS(1.0, 0.15, Math.hypot(u, v)), 1.2);
      D[py*S + px] = clamp(den, 0, 1);
    }
    for(let py=0; py<S; py++) for(let px=0; px<S; px++){
      const at = (xx, yy)=> D[clamp(yy, 0, S-1)*S + clamp(xx, 0, S-1)];
      const gx = at(px+2, py) - at(px-2, py), gy = at(px, py+2) - at(px, py-2);
      const den = D[py*S + px];
      const i = ((oy + py)*S*C + ox + px)*4;
      d[i]   = Math.round(clamp(0.5 - gx*1.6, 0, 1)*255);
      d[i+1] = Math.round(clamp(0.5 + gy*1.6, 0, 1)*255);       // canvas y вниз, в шейдере — вверх
      d[i+2] = Math.round(clamp(den, 0, 1)*255);
      d[i+3] = Math.round(clamp(Math.pow(den, 1.3)*0.9, 0, 1)*255);
    }
  }
  x.putImageData(img, 0, 0);
  const t = texOf(c, false);
  return t;
}

/* ============================================================================
   ЩЕПА, КРОШКА, ОСКОЛКИ — мелочь без физики тел: баллистика + отскок от пола
============================================================================ */
class Chips {
  constructor(geo, mat, max=400){
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.mesh.userData.nomerge = true;
    this.max = max; this.P = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3();
    scene.add(this.mesh);
  }
  spawn(p, v, scale, floor=0, life=6){
    if(this.P.length >= this.max) this.P.shift();
    this.P.push({p:p.clone(), v:v.clone(), r:new THREE.Vector3(Math.random()*6,Math.random()*6,Math.random()*6),
      w:new THREE.Vector3(rnd(-18,18),rnd(-18,18),rnd(-18,18)), s:scale.clone ? scale.clone() : new THREE.Vector3(scale,scale,scale),
      floor, t:0, life, rest:false});
  }
  update(dt){
    const P = this.P;
    if(!P.length){ this.mesh.count = 0; return; }
    for(let i=P.length-1;i>=0;i--){
      const c = P[i]; c.t += dt;
      if(c.t > c.life){ P.splice(i,1); continue; }
      if(c.rest) continue;
      c.v.y -= 9.81*dt; c.p.addScaledVector(c.v, dt);
      c.r.addScaledVector(c.w, dt);
      if(c.p.y < c.floor + 0.004){
        c.p.y = c.floor + 0.004;
        if(Math.abs(c.v.y) > 0.8){ if(this.onBounce && !c.bounced){ c.bounced = true; this.onBounce(c.p); } c.v.y *= -0.32; c.v.x *= 0.55; c.v.z *= 0.55; c.w.multiplyScalar(0.5); }
        else { c.rest = true;
          if(this.lie){ c.r.x = Math.PI/2; c.r.z = 0; c.p.y = c.floor + c.s.x*0.5; }           // цилиндр ложится на бок
          else { c.r.x = Math.round(c.r.x/Math.PI)*Math.PI; c.r.z = Math.round(c.r.z/Math.PI)*Math.PI; } }
      }
    }
    const n = Math.min(P.length, this.max);
    for(let i=0;i<n;i++){
      const c = P[i];
      const sc = c.t > c.life-0.6 ? Math.max(0.01,(c.life-c.t)/0.6) : 1;
      this._e.set(c.r.x, c.r.y, c.r.z); this._q.setFromEuler(this._e);
      this._s.copy(c.s).multiplyScalar(sc);
      this._m.compose(c.p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================================
   ДЕКАЛИ: пулевые отверстия, гарь. Инстансы с офсетом ячейки атласа.
============================================================================ */
class Decals {
  constructor(max=3000){
    this.max = max;
    const g = new THREE.PlaneGeometry(1,1);
    this.uvo = new THREE.InstancedBufferAttribute(new Float32Array(max*2), 2);
    g.setAttribute('iUvOff', this.uvo);
    const mat = M.decal.clone();
    mat.onBeforeCompile = sh=>{
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 iUvOff;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vMapUv = vec2(iUvOff.x + uv.x*0.25, iUvOff.y + uv.y*0.5);');
    };
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2; this.mesh.userData.nomerge = true;
    this.keys = new Array(max); this.head = 0; this.used = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this._z = new THREE.Vector3(0,0,1); this._zero = new THREE.Matrix4().makeScale(0,0,0);
    scene.add(this.mesh);
  }
  /** cell: 0..7 в атласе, n — нормаль поверхности, key — владелец (для удаления). */
  add(p, n, size, cell, key=null, rot=Math.random()*6.28){
    const i = this.head; this.head = (this.head+1) % this.max;
    this.used = Math.min(this.used+1, this.max);
    this._q.setFromUnitVectors(this._z, n);
    this._q.multiply(new THREE.Quaternion().setFromAxisAngle(this._z, rot));
    this._s.set(size, size, 1);
    // декаль в пробоине/воронке пола ложится на её дно, а не висит над ней
    if(n.y > 0.9 && Math.abs(p.y) < 0.03){ p = p.clone(); p.y += floorDepthAt(p.x, p.z); }
    this._m.compose(p.clone().addScaledVector(n, 0.003), this._q, this._s);
    this.mesh.setMatrixAt(i, this._m);
    this.uvo.setXY(i, (cell%4)*0.25, 0.5 - Math.floor(cell/4)*0.5);
    // обновляется только этот инстанс, а не весь буфер на 4000 декалей
    this.uvo.addUpdateRange(i*2, 2); this.uvo.needsUpdate = true;
    this.keys[i] = key;
    this.mesh.count = this.used;
    this.mesh.instanceMatrix.addUpdateRange(i*16, 16); this.mesh.instanceMatrix.needsUpdate = true;
    return i;
  }
  removeKey(key){
    let any = false;
    for(let i=0;i<this.used;i++) if(this.keys[i] === key){ this.mesh.setMatrixAt(i, this._zero); this.keys[i] = null; any = true;
      this.mesh.instanceMatrix.addUpdateRange(i*16, 16); }
    if(any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================================
   ВСПЫШКИ: пул точечных источников с затуханием (выстрел, взрыв).
============================================================================ */
class Flashes {
  constructor(n=6){
    this.L = [];
    // вспышки — заявки в общий пул света, своих источников у них нет
    for(let i=0;i<n;i++) this.L.push({p:new THREE.Vector3(), c:new THREE.Color(), dist:10, t:1, dur:1, peak:0});
  }
  fire(p, color, peak, dist, dur){
    const f = this.L.reduce((a,b)=> (a.t/a.dur > b.t/b.dur ? a : b));
    f.p.copy(p); f.c.set(color); f.dist = dist; f.peak = peak; f.dur = dur; f.t = 0;
  }
  update(dt){
    for(const f of this.L){
      if(f.t >= f.dur) continue;
      f.t += dt; const k = clamp(1 - f.t/f.dur, 0, 1);
      lightReq(f.p, f.c, f.peak * k*k, f.dist, 2, 4);
    }
  }
}

/* ============================================================================
   ЗВУК: процедурный синтез + свёртка с синтетическим откликом ангара (2.8 с).
============================================================================ */
const SND = {
  ctx:null, master:null, wet:null, noise:null, ok:false,
  fireGain:null, windGain:null, _pos:new THREE.Vector3(), _fwd:new THREE.Vector3(), _up:new THREE.Vector3(),
  init(){
    if(this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext; if(!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    // фильтр контузии: после близкого взрыва мир глохнет
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(ctx.destination);
    // реверберация: экспоненциально затухающий шум — огромный пустой ангар
    const len = ctx.sampleRate*2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for(let ch=0; ch<2; ch++){ const d = ir.getChannelData(ch);
      for(let i=0;i<len;i++){ const t = i/ctx.sampleRate; d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 2.2)*Math.exp(-t*1.1)*(t<0.012?t/0.012:1); } }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.42;
    this.wet.connect(conv); conv.connect(this.master);
    const nb = ctx.createBuffer(1, ctx.sampleRate*2, ctx.sampleRate), nd = nb.getChannelData(0);
    let b0=0,b1=0,b2=0;
    for(let i=0;i<nd.length;i++){ const w = Math.random()*2-1; nd[i] = w; }
    this.noise = nb;
    // розовый шум для ветра и огня
    const pb = ctx.createBuffer(1, ctx.sampleRate*4, ctx.sampleRate), pd = pb.getChannelData(0);
    for(let i=0;i<pd.length;i++){ const w=Math.random()*2-1; b0=0.99765*b0+w*0.0990460; b1=0.96300*b1+w*0.2965164; b2=0.57000*b2+w*1.0526913; pd[i]=(b0+b1+b2+w*0.1848)*0.18; }
    this.pink = pb;
    this.ok = true;
    this._ambience();
  },
  resume(){ if(this.ctx && this.ctx.state !== 'running') this.ctx.resume(); if(this.master) this.master.gain.value = 0.8*SET.vol/100; },
  _src(buf, loop=false){ const s = this.ctx.createBufferSource(); s.buffer = buf || this.noise; s.loop = loop; return s; },
  /** Цепочка выхода: панорама в 3D + отправка в ревербератор. */
  _out(pos, wet=0.5, ref=3){
    const ctx = this.ctx, g = ctx.createGain();
    if(pos){
      const p = ctx.createPanner();
      p.panningModel = Q.lights >= 6 ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 200;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      // за стенами звук глохнет: низкочастотный фильтр и тише (прямой звук),
      // а реверберация ангара остаётся — она огибает препятствия
      const occ = this._occlusion(pos);
      let head = g;
      if(occ > 0){
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
        f.frequency.value = lerp(5000, 520, occ);
        const og = ctx.createGain(); og.gain.value = 1 - 0.55*occ;
        g.connect(f); f.connect(og); head = og;
      }
      head.connect(p); p.connect(this.master);
      const w = ctx.createGain(); w.gain.value = wet*(1 - 0.35*occ); head.connect(w); w.connect(this.wet);
    } else { g.connect(this.master); const w = ctx.createGain(); w.gain.value = wet*0.6; g.connect(w); w.connect(this.wet); }
    return g;
  },
  /** 0 — прямая видимость, до 1 — за несколькими стенами. */
  _occlusion(pos){
    if(!PH.ready) return 0;
    const cam = camera.position, d = cam.distanceTo(pos);
    if(d < 1.2) return 0;
    const hits = rayAll(cam, pos, GRP.STATIC);
    let n = 0, lastF = -1;
    for(const h of hits){
      if(h.idx === -10 || (1 - h.f)*d < 0.35) continue;      // сам игрок и поверхность, на которой звучит источник
      if(lastF >= 0 && (h.f - lastF)*d < 0.3) continue;      // обе обшивки одной стены — одна преграда
      n++; lastF = h.f;
      if(n >= 3) break;
    }
    return n ? Math.min(1, 0.5 + 0.25*(n-1)) : 0;
  },
  _delay(pos){ if(!pos) return 0; return camera.position.distanceTo(pos)/343; },
  listener(){
    if(!this.ok) return;
    const L = this.ctx.listener, p = camera.position;
    camera.getWorldDirection(this._fwd); this._up.set(0,1,0).applyQuaternion(camera.quaternion);
    if(L.positionX){ L.positionX.value=p.x; L.positionY.value=p.y; L.positionZ.value=p.z;
      L.forwardX.value=this._fwd.x; L.forwardY.value=this._fwd.y; L.forwardZ.value=this._fwd.z;
      L.upX.value=this._up.x; L.upY.value=this._up.y; L.upZ.value=this._up.z; }
    else { L.setPosition(p.x,p.y,p.z); L.setOrientation(this._fwd.x,this._fwd.y,this._fwd.z,this._up.x,this._up.y,this._up.z); }
  },
  _burst(out, t, dur, type, f0, f1, q, gain, attack=0.002){
    const ctx = this.ctx, s = this._src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = type; f.frequency.setValueAtTime(f0, t); if(f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t+dur);
    f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t+attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()*1.5); s.stop(t+dur+0.05);
  },
  _tone(out, t, dur, f0, f1, gain, type='sine'){
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(10,f1), t+dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t+0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t+dur+0.05);
  },
  shot(pos, own=false){
    if(!this.ok) return; const t = this.ctx.currentTime + (own?0:this._delay(pos));
    const out = this._out(own?null:pos, 0.75, 6);
    this._burst(out, t, 0.035, 'highpass', 2400, 1800, 0.7, own?0.9:0.7);
    this._burst(out, t, 0.22, 'lowpass', 2200, 300, 0.8, own?0.75:0.6);
    this._tone(out, t, 0.16, 140, 42, own?0.8:0.5);
    // механика затвора
    if(own){ this._burst(out, t+0.045, 0.02, 'bandpass', 3800, 3800, 6, 0.08); }
  },
  explosion(pos, big=1){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.9, 10*big);
    this._burst(out, t, 1.8*big, 'lowpass', 3200, 120, 0.7, 1.0, 0.004);
    this._burst(out, t, 0.08, 'highpass', 1500, 800, 0.5, 0.8);
    this._tone(out, t, 1.1*big, 70, 22, 1.0);
    this._tone(out, t+0.02, 0.5, 45, 20, 0.7, 'triangle');
    for(let i=0;i<10;i++) this._burst(out, t+0.25+Math.random()*1.3, 0.05, 'bandpass', rnd(900,3000), rnd(500,1500), 3, rnd(0.03,0.12));
  },
  glass(pos, n=12){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.55, 3);
    this._burst(out, t, 0.12, 'highpass', 3000, 2000, 0.5, 0.5);
    for(let i=0;i<n;i++){ const tt = t + Math.pow(Math.random(),1.6)*0.9;
      this._burst(out, tt, rnd(0.04,0.18), 'bandpass', rnd(3500,9000), rnd(3000,8000), rnd(8,20), rnd(0.05,0.25)); }
  },
  wood(pos, k=1){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.45, 2.5);
    const n = 2 + Math.round(k*4);
    for(let i=0;i<n;i++) this._burst(out, t+i*rnd(0.008,0.03), rnd(0.02,0.06), 'bandpass', rnd(700,2400), rnd(500,1500), 2.5, rnd(0.15,0.45)*Math.min(1,k));
    this._tone(out, t, 0.12, rnd(170,240), 90, 0.35*Math.min(1,k));
  },
  hit(pos, surf){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos);
    const out = this._out(pos, 0.4, 2);
    if(surf==='metal'){ for(const f of [rnd(900,1300), rnd(1800,2600), rnd(3200,4200)]) this._tone(out, t, rnd(0.2,0.45), f, f*0.98, 0.08);
      this._burst(out, t, 0.03, 'highpass', 3000, 2500, 1, 0.3); }
    else if(surf==='wood'){ this._burst(out, t, 0.05, 'bandpass', 1400, 700, 2, 0.4); this._tone(out, t, 0.08, 260, 120, 0.2); }
    else if(surf==='glass'){ this.glass(pos, 3); }
    else if(surf==='sand'){ this._burst(out, t, 0.08, 'lowpass', 900, 300, 0.5, 0.35); }
    else { this._burst(out, t, 0.05, 'bandpass', 2200, 1200, 1.2, 0.4); this._burst(out, t, 0.12, 'lowpass', 700, 200, 0.5, 0.2); }
  },
  thud(pos, k, surf){
    if(!this.ok) return; const t = this.ctx.currentTime;
    const out = this._out(pos, 0.3, 1.5), g = clamp(k*0.25, 0.02, 0.5);
    if(surf==='glass') { this._burst(out, t, 0.08, 'bandpass', rnd(4000,7000), 5000, 10, g*0.6); return; }
    if(surf==='metal') { this._tone(out, t, 0.25, rnd(500,900), 480, g*0.4); }
    this._burst(out, t, 0.07, 'lowpass', surf==='wood'?900:600, 150, 0.7, g);
  },
  /** Гильза о бетон: короткий звон двух близких частот. */
  tink(pos){
    if(!this.ok) return; const now = this.ctx.currentTime;
    if(now - (this._tinkT || 0) < 0.035) return; this._tinkT = now;
    const out = this._out(pos, 0.15, 1.2), f = rnd(3600, 5200);
    this._tone(out, now, rnd(0.06, 0.12), f, f*0.97, 0.05);
    this._tone(out, now + 0.004, 0.08, f*1.37, f*1.33, 0.03);
  },
  step(surf, k=1){
    if(!this.ok) return; const t = this.ctx.currentTime, out = this._out(null, 0.25);
    if(surf==='metal'){ this._tone(out, t, 0.12, rnd(700,1000), 600, 0.05*k); this._burst(out, t, 0.05, 'bandpass', 1800, 900, 2, 0.08*k); }
    else if(surf==='wood'){ this._burst(out, t, 0.07, 'lowpass', 700, 180, 1.2, 0.2*k); this._tone(out, t, 0.06, 150, 90, 0.06*k); }
    else { this._burst(out, t, 0.05, 'bandpass', 1200, 500, 0.9, 0.14*k); }
  },
  /** Перезарядка: отстёгнутый магазин, вставка, затвор (на пустом). */
  reload(tactical){
    if(!this.ok) return; const t = this.ctx.currentTime, out = this._out(null, 0.15);
    this._burst(out, t+0.25, 0.04, 'bandpass', 1600, 1300, 4, 0.22);                 // защёлка
    this._burst(out, t+0.35, 0.09, 'lowpass', 900, 300, 1, 0.12);                   // магазин выходит
    this._burst(out, t+1.25, 0.05, 'bandpass', 2100, 1500, 5, 0.3);                 // новый магазин
    this._tone(out, t+1.27, 0.05, 420, 300, 0.08);
    if(!tactical){ this._burst(out, t+2.15, 0.03, 'bandpass', 3000, 2400, 6, 0.3); this._burst(out, t+2.3, 0.04, 'bandpass', 2000, 1600, 5, 0.3); }
  },
  /** Отметка попадания: короткий сухой щелчок, на поражение — двойной. */
  hitmark(kill){
    if(!this.ok) return; const t = this.ctx.currentTime, out = this._out(null, 0);
    this._tone(out, t, 0.05, 1900, 1700, 0.07, 'triangle');
    if(kill) this._tone(out, t+0.07, 0.07, 1350, 1100, 0.08, 'triangle');
  },
  /** Ящик с боеприпасами: крышка, возня с магазинами. */
  supply(pos){
    if(!this.ok) return; const t = this.ctx.currentTime, out = this._out(pos, 0.3, 2);
    this._burst(out, t, 0.12, 'lowpass', 700, 250, 1, 0.35); this._tone(out, t, 0.1, 180, 120, 0.12);
    for(let i=0;i<5;i++) this._burst(out, t+0.35+i*0.22+Math.random()*0.08, 0.04, 'bandpass', rnd(1500,2600), 1400, 5, 0.18);
    this._burst(out, t+1.5, 0.1, 'lowpass', 800, 250, 1, 0.3);
  },
  /** Дверь: скрип петель при открывании, удар при закрывании и выбивании. */
  door(pos, kind){
    if(!this.ok) return; const t = this.ctx.currentTime + this._delay(pos), out = this._out(pos, 0.5, 2.5);
    if(kind === 'open'){ this._burst(out, t, rnd(0.35,0.6), 'bandpass', rnd(700,1100), rnd(500,800), 25, 0.05, 0.08); this._burst(out, t, 0.04, 'bandpass', 1800, 1500, 4, 0.15); }
    else if(kind === 'close'){ this._burst(out, t, 0.09, 'lowpass', 600, 150, 0.8, 0.5); this._tone(out, t, 0.12, 130, 70, 0.25); this._burst(out, t+0.02, 0.03, 'bandpass', 2400, 2000, 5, 0.2); }
    else { this._burst(out, t, 0.14, 'lowpass', 1200, 120, 0.7, 0.9); this._tone(out, t, 0.2, 110, 50, 0.5); this.wood(pos, 1.6); }
  },
  bounce(pos){ if(!this.ok) return; const t=this.ctx.currentTime, out=this._out(pos,0.3,1.5); this._tone(out,t,0.1,rnd(1100,1500),900,0.12); },
  click(){ if(!this.ok) return; const t=this.ctx.currentTime, out=this._out(null,0.1); this._burst(out,t,0.03,'bandpass',2500,2500,5,0.25); this._burst(out,t+0.12,0.03,'bandpass',1800,1800,5,0.25); },
  /** Огонь: непрерывный рокот + случайные щелчки, громкость по ближайшему пламени. */
  fire(level, pos){
    if(!this.ok) return;
    if(!this.fireGain){
      const s = this._src(this.pink, true), f = this.ctx.createBiquadFilter(); f.type='lowpass'; f.frequency.value = 900;
      this.fireGain = this.ctx.createGain(); this.fireGain.gain.value = 0;
      s.connect(f); f.connect(this.fireGain); this.fireGain.connect(this.master);
      const w = this.ctx.createGain(); w.gain.value = 0.3; this.fireGain.connect(w); w.connect(this.wet); s.start();
    }
    this.fireGain.gain.setTargetAtTime(clamp(level,0,1)*0.55, this.ctx.currentTime, 0.3);
    if(level > 0.03 && Math.random() < level*0.5){
      const out = this._out(pos, 0.2, 2);
      this._burst(out, this.ctx.currentTime, rnd(0.01,0.04), 'bandpass', rnd(1500,5000), rnd(1000,3000), 2, rnd(0.05,0.25)*level);
    }
  },
  _ambience(){
    // ветер гуляет по кровле: полосовой розовый шум с медленной модуляцией
    const ctx = this.ctx, s = this._src(this.pink, true), f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 380; f.Q.value = 0.8;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.18;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 160;
    lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    s.connect(f); f.connect(this.windGain); this.windGain.connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.5; this.windGain.connect(w); w.connect(this.wet);
    s.start();
    this._nextCreak = ctx.currentTime + 6;
  },
  ambienceTick(wind){
    if(!this.ok) return;
    const ctx = this.ctx;
    this.windGain.gain.setTargetAtTime(0.08 + clamp(wind/12,0,1)*0.22, ctx.currentTime, 0.8);
    if(ctx.currentTime > this._nextCreak){
      this._nextCreak = ctx.currentTime + rnd(7, 22);
      // скрип металла кровли: узкая полоса с медленным глиссандо
      const pos = new THREE.Vector3(rnd(-35,35), 10, rnd(-25,25));
      const out = this._out(pos, 0.9, 12), t = ctx.currentTime;
      this._burst(out, t, rnd(0.8,1.8), 'bandpass', rnd(260,420), rnd(140,220), 35, rnd(0.25,0.5), 0.3);
      if(Math.random() < 0.5) this._burst(out, t+0.1, 0.9, 'bandpass', rnd(900,1300), rnd(700,900), 40, 0.12, 0.2);
    }
  }
};

/* ============================================================================
   ЭКЗЕМПЛЯРЫ СИСТЕМ
============================================================================ */
const FXS = {};
function initFX(){
  const k = Q.dust >= 4000 ? 1 : (Q.dust >= 2000 ? 0.7 : 0.45);
  FXS.flame = new Particles({tex:FX.flameAtlas, max:Math.round(1100*k), additive:true, kind:'flame', sheet:4});
  FXS.smoke = new Particles({tex:FX.smokeAtlas, max:Math.round(2200*k), lit:true, kind:'smoke', sheet:2, sort:true});
  FXS.dust  = new Particles({tex:FX.smokeAtlas, max:Math.round(900*k), lit:true, kind:'smoke', sheet:2, sort:true});
  FXS.spark = new Particles({tex:FX.glow,  max:600, additive:true, stretch:true});
  FXS.ember = new Particles({tex:FX.glow,  max:500, additive:true});
  FXS.flash = new Particles({tex:FX.glow,  max:180, additive:true});
  FXS.fireball = new Particles({tex:FX.flameAtlas, max:160, additive:true, kind:'flame', sheet:4});
  const box = new THREE.BoxGeometry(1,1,1);
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5,-0.4,0, .5,-0.3,0, .05,.5,0]),3));
  tri.computeVertexNormals();
  FXS.splinters = new Chips(box, M.wood, 700);
  FXS.concChips = new Chips(new THREE.DodecahedronGeometry(0.5,0), M.conc, 500);
  FXS.glassChips = new Chips(tri, M.glass, 500);
  // гильзы 5,45: латунь, лежат на полу две минуты, звенят при падении
  const caseGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 7); 
  FXS.casings = new Chips(caseGeo, new THREE.MeshStandardMaterial({color:0xb08a3e, roughness:.32, metalness:.95, envMapIntensity:1.3}), Q.debris >= 400 ? 500 : 300);
  FXS.casings.mesh.castShadow = false; FXS.casings.onBounce = tinkCasing; FXS.casings.lie = true;
  FXS.decals = new Decals(Q.dust >= 4000 ? 4000 : 2500);
  FXS.flashes = new Flashes(4);
  return FXS;
}
function updateFX(dt, t){
  for(const k of ['flame','smoke','dust','spark','ember','flash','fireball']) FXS[k].update(dt, t);
  FXS.splinters.update(dt); FXS.concChips.update(dt); FXS.glassChips.update(dt); FXS.casings.update(dt);
  FXS.flashes.update(dt);
}

// Разрушаемость: листы обшивки из кусков, брус (стойки, лаги), стекло,
// ломкий реквизит. Пули, взрывы и огонь работают через одно API.

const DEST = { sheets:[], beams:[], glass:[], props:[], broken:0, dirty:new Set() };
/** Бюджет обломков-тел на кадр: взрыв рвёт сотни кусков, телами летят не все —
    остальное уходит в щепу и пыль, иначе физика съест кадр. */
let BUDGET = 60;
function resetDebrisBudget(){ BUDGET = Q.debris >= 400 ? 70 : (Q.debris >= 250 ? 45 : 28); }
/** Внешние обработчики (огонь, игрок) — чтобы не плодить циклические импорты. */
const HOOKS = { ignite:null, playerBlast:null, charBlast:null, onBreak:null };

const V$3 = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
const _a = V$3(), _b = V$3(), _c = V$3();

/* ---------------------------------------------------------------------------
   ПРОСТРАНСТВЕННЫЙ ИНДЕКС горючего/разрушаемого: ячейка 1 м
--------------------------------------------------------------------------- */
const HASH = new Map(), HC = 1.0;
const hk = (ix,iy,iz)=> (ix+512)*1048576 + (iy+64)*2048 + (iz+512);
function hashAdd(p, ref){
  const k = hk(Math.floor(p.x/HC), Math.floor(p.y/HC), Math.floor(p.z/HC));
  let a = HASH.get(k); if(!a){ a=[]; HASH.set(k,a); } a.push(ref);
}
/** Элементы в радиусе: [{ref, pos, d}] */
function query(p, r, filter){
  const out = [];
  const x0=Math.floor((p.x-r)/HC), x1=Math.floor((p.x+r)/HC), y0=Math.floor((p.y-r)/HC), y1=Math.floor((p.y+r)/HC),
        z0=Math.floor((p.z-r)/HC), z1=Math.floor((p.z+r)/HC);
  const seen = new Set();
  for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) for(let z=z0;z<=z1;z++){
    const a = HASH.get(hk(x,y,z)); if(!a) continue;
    for(const ref of a){
      if(!refAlive(ref)) continue;
      if(ref.t !== 'c'){ const key = ref.t==='b'?ref.b:ref.t==='p'?ref.p:ref.g; if(seen.has(key)) continue; seen.add(key); }
      const pos = refPos(ref, p), d = pos.distanceTo(p);
      if(d <= r && (!filter || filter(ref))) out.push({ref, pos, d});
    }
  }
  return out;
}
function refAlive(ref){
  if(ref.t==='c') return ref.s.alive[ref.k] === 1;
  if(ref.t==='b') return !ref.b.dead;
  if(ref.t==='p') return !ref.p.dead;
  if(ref.t==='g') return !ref.g.dead;
  return false;
}
const _rp = V$3();
/** Позиция элемента; для бруса — ближайшая к p точка на оси. */
function refPos(ref, p){
  if(ref.t==='c') return ref.s.chunkCenter[ref.k];
  if(ref.t==='b'){
    const b = ref.b; if(!p) return b.center;
    const t = clamp(_rp.subVectors(p, b.a).dot(b.axis), 0, b.L);
    return V$3().copy(b.a).addScaledVector(b.axis, t);
  }
  if(ref.t==='p') return ref.p.center;
  if(ref.t==='g') return ref.g.center;
}
function refFlammable(ref){ return ref.t==='c' || (ref.t==='b' && ref.b.wood) || (ref.t==='p' && ref.p.wood); }
function refNormal(ref, from){
  if(ref.t==='c'){ const s = ref.s; return (from && V$3().subVectors(from, s.c).dot(s.N) < 0) ? s.N.clone().negate() : s.N.clone(); }
  return V$3(0,1,0);
}

/* ============================================================================
   ЛИСТ ОБШИВКИ
   Лист режется на сетку кусков с дрожащими внутренними узлами: пробоина
   получается рваной, а не квадратной. Каждый кусок — 8 вершин (лицо и тыл) в общем
   запечённом буфере; выбить кусок = схлопнуть его вершины.
============================================================================ */
const quadIdx = (idx, a,b,c,d)=>{ idx.push(a,b,c, a,c,d); };
const CV = 8;          // вершин на кусок
function createSheet(o){
  const U = o.U.clone().normalize(), Vv = o.V.clone().normalize();
  const N = new THREE.Vector3().crossVectors(U, Vv).normalize();
  const nu = o.nu, nv = o.nv, w = o.w, h = o.h, t = o.t;
  const cw = w/nu, ch = h/nv;
  const G = [];
  const jit = o.jitter ?? 0.3;
  for(let j=0;j<=nv;j++) for(let i=0;i<=nu;i++){
    let u = -w/2 + i*cw, v = -h/2 + j*ch;
    if(i>0 && i<nu) u += sr(-jit,jit)*cw;
    if(j>0 && j<nv) v += sr(-jit,jit)*ch;
    G.push([u,v]);
  }
  const gp = (i,j)=> G[j*(nu+1)+i];
  const n = nu*nv, pos = new Float32Array(n*CV*3), nrm = new Float32Array(n*CV*3), uv = new Float32Array(n*CV*2);
  const idx = [];
  const W = (u,v,s)=> [o.c.x + U.x*u + Vv.x*v + N.x*s, o.c.y + U.y*u + Vv.y*v + N.y*s, o.c.z + U.z*u + Vv.z*v + N.z*s];
  const d = o.uvd ?? 0.82, ou = srnd()*3, ov = srnd()*3;
  const chunkCenter = [];
  let vi = 0;
  const put = (p, nn, uu, vv)=>{ pos.set(p, vi*3); nrm.set(nn, vi*3); uv[vi*2]=uu; uv[vi*2+1]=vv; vi++; };
  for(let j=0;j<nv;j++) for(let i=0;i<nu;i++){
    const q = [gp(i,j), gp(i+1,j), gp(i+1,j+1), gp(i,j+1)];
    const base = vi;
    for(const [u,v] of q) put(W(u,v, t/2), [N.x,N.y,N.z], (u+ou)*d, (v+ov)*d);
    quadIdx(idx, base, base+1, base+2, base+3);
    const b2 = vi;
    for(let k=3;k>=0;k--){ const [u,v]=q[k]; put(W(u,v,-t/2), [-N.x,-N.y,-N.z], (-u+ou)*d, (v+ov)*d); }
    quadIdx(idx, b2, b2+1, b2+2, b2+3);
    // торцы кусков не строятся: между целыми кусками их не видно, а у
    // пробоины их дорисовывает пул кромок (edgeAdd)
    let cu = 0, cv = 0; for(const [u,v] of q){ cu += u/4; cv += v/4; }
    chunkCenter.push(new THREE.Vector3(...W(cu, cv, t/2)));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm,3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv,2));
  g.setIndex(idx);
  fixWinding(g);
  const tint = o.tint || [1,1,1];
  tintGeo(g, tint[0], tint[1], tint[2]);
  const s = { id: DEST.sheets.length, c:o.c.clone(), U, V:Vv, N, w, h, t, nu, nv, cw, ch, G,
    alive: new Uint8Array(n).fill(1), hp: new Float32Array(n).fill(o.hp ?? 100), char: new Float32Array(n),
    chunkCenter, mat:o.mat, tint, colDepth:o.colDepth ?? 0.08, kind:o.kind || 'wall', body:null, mesh:null, base:0,
    deadN:0, surf:'wood' };
  g.userData.group = 'dest';
  g.userData.onBaked = (mesh, start)=>{ s.mesh = mesh; s.base = start; };
  bucket(o.mat).push(g);
  DEST.sheets.push(s);
  for(let k=0;k<n;k++) hashAdd(chunkCenter[k], {t:'c', s, k});
  return s;
}
function fixWinding(g){
  const p = g.attributes.position, nn = g.attributes.normal, ix = g.index.array;
  const vn = V$3();
  for(let i=0;i<ix.length;i+=3){
    _a.fromBufferAttribute(p, ix[i]); _b.fromBufferAttribute(p, ix[i+1]); _c.fromBufferAttribute(p, ix[i+2]);
    _b.sub(_a); _c.sub(_a); _a.crossVectors(_b,_c);
    vn.fromBufferAttribute(nn, ix[i]);
    if(_a.dot(vn) < 0){ const t = ix[i+1]; ix[i+1] = ix[i+2]; ix[i+2] = t; }
  }
}
/* ---------------------------------------------------------------------------
   ПУЛ КРОМОК: торцы кусков вокруг пробоин. Один меш на материал, слоты
   переиспользуются; кромка исчезает, когда выбит и её кусок.
--------------------------------------------------------------------------- */
const EDGE_POOLS = {};
const EDGE_OF = new Map();      // ключ куска → [{pool, slot}]
function edgePool(mat){
  if(EDGE_POOLS[mat]) return EDGE_POOLS[mat];
  const MAXQ = Q.debris >= 400 ? 9000 : 5000, NV = MAXQ*4;
  const g = new THREE.BufferGeometry();
  const mk = (n)=> new THREE.BufferAttribute(new Float32Array(NV*n), n).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', mk(3)); g.setAttribute('normal', mk(3)); g.setAttribute('uv', mk(2));
  g.setAttribute('color', mk(3)); g.setAttribute('aBurn', mk(2));
  const idx = new Uint32Array(MAXQ*6);
  for(let i=0;i<MAXQ;i++){ idx.set([i*4, i*4+1, i*4+2, i*4, i*4+2, i*4+3], i*6); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const m = new THREE.Mesh(g, M[mat]); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  m.userData.nomerge = true; scene.add(m);
  return EDGE_POOLS[mat] = { mesh:m, g, free:[], next:0, MAXQ };
}
function neighbor(s, k, e){
  const i = k % s.nu, j = (k/s.nu)|0;
  const [di,dj] = [[0,-1],[1,0],[0,1],[-1,0]][e];
  const ii = i+di, jj = j+dj;
  return (ii<0||jj<0||ii>=s.nu||jj>=s.nv) ? -1 : jj*s.nu+ii;
}
const _en = V$3(), _ea = V$3(), _eb = V$3();
function edgeAdd(s, k, e){
  const P = edgePool(s.mat);
  let slot = P.free.length ? P.free.pop() : (P.next < P.MAXQ ? P.next++ : -1);
  if(slot < 0) return;
  const q = chunkPoly(s, k), [u0,v0] = q[e], [u1,v1] = q[(e+1)%4];
  const W = (u,v,n)=> V$3(s.c.x + s.U.x*u + s.V.x*v + s.N.x*n, s.c.y + s.U.y*u + s.V.y*v + s.N.y*n, s.c.z + s.U.z*u + s.V.z*v + s.N.z*n);
  let pts = [W(u0,v0,s.t/2), W(u0,v0,-s.t/2), W(u1,v1,-s.t/2), W(u1,v1,s.t/2)];
  _ea.subVectors(pts[1], pts[0]); _eb.subVectors(pts[3], pts[0]);
  const ex = V$3().subVectors(W(u1,v1,0), W(u0,v0,0)).normalize();
  _en.crossVectors(ex, s.N).normalize();                          // наружу из куска k
  if(V$3().crossVectors(_ea, V$3().subVectors(pts[2], pts[0])).dot(_en) < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
  const g = P.g, b = slot*4, el = Math.hypot(u1-u0, v1-v0)*0.82;
  const ch = s.char[k];
  for(let i=0;i<4;i++){
    g.attributes.position.setXYZ(b+i, pts[i].x, pts[i].y, pts[i].z);
    g.attributes.normal.setXYZ(b+i, _en.x, _en.y, _en.z);
    g.attributes.color.setXYZ(b+i, s.tint[0]*0.92, s.tint[1]*0.88, s.tint[2]*0.8);
    g.attributes.aBurn.setXY(b+i, ch, 0);
  }
  g.attributes.uv.setXY(b, 0, 0); g.attributes.uv.setXY(b+1, 0, 0.01); g.attributes.uv.setXY(b+2, el, 0.01); g.attributes.uv.setXY(b+3, el, 0);
  for(const a of ['position','normal','color','aBurn','uv']){ const at = g.attributes[a]; at.addUpdateRange(b*at.itemSize, 4*at.itemSize); at.needsUpdate = true; }
  const key = s.id*4096 + k;
  let arr = EDGE_OF.get(key); if(!arr){ arr = []; EDGE_OF.set(key, arr); }
  arr.push({P, slot});
}
function edgeRemoveChunk(s, k){
  const key = s.id*4096 + k, arr = EDGE_OF.get(key); if(!arr) return;
  for(const {P, slot} of arr){
    const pa = P.g.attributes.position, b = slot*4;
    for(let i=0;i<4;i++) pa.setXYZ(b+i, 0, -50, 0);
    pa.addUpdateRange(b*3, 12); pa.needsUpdate = true;
    P.free.push(slot);
  }
  EDGE_OF.delete(key);
}
const _sm = new THREE.Matrix4();
function sheetQuat(s){ _sm.makeBasis(s.U, s.V, s.N); return new THREE.Quaternion().setFromRotationMatrix(_sm); }
/** Коллайдер листа: оставшиеся куски, сгруппированные в вертикальные полосы. */
function rebuildSheetBody(s){
  if(s.body){ removeBody(s.body); s.body = null; }
  const parts = [];
  const nOff = s.t/2 - s.colDepth/2;
  const add = (u0,u1,v0,v1)=>{
    const u=(u0+u1)/2, v=(v0+v1)/2;
    parts.push({cx:s.c.x + s.U.x*u + s.V.x*v + s.N.x*nOff, cy:s.c.y + s.U.y*u + s.V.y*v + s.N.y*nOff,
                cz:s.c.z + s.U.z*u + s.V.z*v + s.N.z*nOff, hx:(u1-u0)/2, hy:(v1-v0)/2, hz:s.colDepth/2});
  };
  if(s.deadN === 0) add(-s.w/2, s.w/2, -s.h/2, s.h/2);
  else for(let i=0;i<s.nu;i++){
    let j=0;
    while(j < s.nv){
      if(!s.alive[j*s.nu+i]){ j++; continue; }
      const j0 = j; while(j < s.nv && s.alive[j*s.nu+i]) j++;
      add(-s.w/2 + i*s.cw, -s.w/2 + (i+1)*s.cw, -s.h/2 + j0*s.ch, -s.h/2 + j*s.ch);
    }
  }
  if(!parts.length) return;
  s.body = addStaticCompound(parts, sheetQuat(s), s.owner, s.c);
}
function chunkAt(s, p){
  _a.subVectors(p, s.c);
  const u = _a.dot(s.U), v = _a.dot(s.V);
  const i = clamp(Math.floor((u + s.w/2)/s.cw), 0, s.nu-1), j = clamp(Math.floor((v + s.h/2)/s.ch), 0, s.nv-1);
  return j*s.nu + i;
}
function collapseRange(mesh, start, count, center){
  const pa = mesh.geometry.attributes.position;
  for(let i=start;i<start+count;i++) pa.setXYZ(i, center.x, center.y, center.z);
  pa.addUpdateRange(start*3, count*3); pa.needsUpdate = true;
}
/** Выбить кусок листа. mode: 'bullet'|'blast'|'fire'|'fall'. */
function breakChunk(s, k, dir, power, mode){
  if(!s.alive[k]) return;
  s.alive[k] = 0; s.deadN++; DEST.broken++;
  const cc = s.chunkCenter[k];
  if(s.mesh) collapseRange(s.mesh, s.base + k*CV, CV, cc);
  edgeRemoveChunk(s, k);
  for(let e=0;e<4;e++){ const nb = neighbor(s, k, e); if(nb >= 0 && s.alive[nb]) edgeAdd(s, nb, (e+2)%4); }
  FXS.decals.removeKey(s.id*4096 + k);
  DEST.dirty.add(s);
  spawnChunkDebris(s, k, dir, power, mode);
  if(HOOKS.onBreak) HOOKS.onBreak('chunk', cc, mode);
}
/** Куски, потерявшие связь с краем листа (гвозди по периметру), падают. */
function dropIslands(s, dir){
  const nu=s.nu, nv=s.nv, seen = new Uint8Array(nu*nv), stack=[];
  for(let j=0;j<nv;j++) for(let i=0;i<nu;i++){
    const k=j*nu+i;
    if((i===0||j===0||i===nu-1||j===nv-1) && s.alive[k]){ seen[k]=1; stack.push(k); }
  }
  while(stack.length){
    const k = stack.pop(), i = k%nu, j = (k/nu)|0;
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const ii=i+di, jj=j+dj; if(ii<0||jj<0||ii>=nu||jj>=nv) continue;
      const q = jj*nu+ii; if(!seen[q] && s.alive[q]){ seen[q]=1; stack.push(q); }
    }
  }
  for(let k=0;k<nu*nv;k++) if(s.alive[k] && !seen[k]) breakChunk(s, k, dir, 0.3, 'fall');
  // от листа осталась пара кусков — они уже ничего не держат
  if(s.deadN > nu*nv*0.8) for(let k=0;k<nu*nv;k++) if(s.alive[k]) breakChunk(s, k, dir, 0.2, 'fall');
}
function chunkPoly(s, k){
  const i = k % s.nu, j = (k/s.nu)|0, G = s.G, nu1 = s.nu+1;
  return [G[j*nu1+i], G[j*nu1+i+1], G[(j+1)*nu1+i+1], G[(j+1)*nu1+i]].map(p=>[p[0],p[1]]);
}
function splitPoly(poly){
  // случайный разрез через центр: кусок ломается на два неровных обломка
  let cx=0, cy=0; for(const p of poly){ cx+=p[0]/poly.length; cy+=p[1]/poly.length; }
  const a = Math.random()*Math.PI, nx = Math.cos(a), ny = Math.sin(a);
  const A=[], B=[];
  for(let i=0;i<poly.length;i++){
    const p = poly[i], q = poly[(i+1)%poly.length];
    const dp = (p[0]-cx)*nx + (p[1]-cy)*ny, dq = (q[0]-cx)*nx + (q[1]-cy)*ny;
    (dp >= 0 ? A : B).push(p);
    if((dp >= 0) !== (dq >= 0)){ const t = dp/(dp-dq); const m = [p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t]; A.push(m); B.push(m); }
  }
  return [A,B].filter(P=>P.length>=3);
}
function spawnChunkDebris(s, k, dir, power, mode){
  const poly = chunkPoly(s, k);
  const split = BUDGET > 20 && (mode==='blast' ? Math.random()<0.7 : mode==='bullet' ? Math.random()<0.5 : false);
  const pieces = BUDGET <= 0 ? [] : (split ? splitPoly(poly) : [poly]);
  BUDGET -= pieces.length;
  const charred = s.char[k];
  const q = sheetQuat(s);
  for(const P of pieces){
    let cu=0, cv=0; for(const p of P){ cu+=p[0]/P.length; cv+=p[1]/P.length; }
    const shape = new THREE.Shape(P.map(p=> new THREE.Vector2(p[0]-cu, p[1]-cv)));
    const g = new THREE.ExtrudeGeometry(shape, {depth:s.t, bevelEnabled:false});
    g.translate(0,0,-s.t/2);
    const uv = g.attributes.uv, pa = g.attributes.position;
    for(let i=0;i<uv.count;i++) uv.setXY(i, (pa.getX(i)+cu)*0.82, (pa.getY(i)+cv)*0.82);
    tintGeo(g, s.tint[0], s.tint[1], s.tint[2]);
    const nb = new Float32Array(pa.count*2);
    for(let i=0;i<pa.count;i++){ nb[i*2]=charred; nb[i*2+1]= mode==='fire'?1:0; }
    g.setAttribute('aBurn', new THREE.BufferAttribute(nb,2));
    const mesh = new THREE.Mesh(g, M[s.mat] || M.osb);
    mesh.userData.ownGeo = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.quaternion.copy(q);
    mesh.position.set(s.c.x + s.U.x*cu + s.V.x*cv, s.c.y + s.U.y*cu + s.V.y*cv, s.c.z + s.U.z*cu + s.V.z*cv);
    scene.add(mesh);
    let mu=1e9, Mu=-1e9, mv=1e9, Mv=-1e9;
    for(const p of P){ mu=Math.min(mu,p[0]); Mu=Math.max(Mu,p[0]); mv=Math.min(mv,p[1]); Mv=Math.max(Mv,p[1]); }
    const sp = power*(mode==='blast'? 9 : mode==='bullet'? 1.6 : 0.4);
    const vel = dir.clone().multiplyScalar(sp).add(V$3(rnd(-0.6,0.6), rnd(0,1)*(mode==='blast'?2:0.5), rnd(-0.6,0.6)));
    addDynamic(mesh, { size:[Math.max(0.02,Mu-mu), Math.max(0.02,Mv-mv), s.t*1.6],
      mass: Math.max(0.15,(Mu-mu)*(Mv-mv)*s.t*620), vel,
      spin: V$3(rnd(-8,8), rnd(-8,8), rnd(-8,8)).multiplyScalar(mode==='blast'?1:0.4), friction:0.8, restitution:0.12,
      life: sr(25,40), surf:'wood', group: GRP.DEBRIS });
  }
  const cc = s.chunkCenter[k];
  const nChips = (mode==='blast' ? 6 : mode==='bullet' ? 4 : 2) + (pieces.length ? 0 : 4);
  const fl = floorBelow(cc);
  for(let i=0;i<nChips;i++){
    const v = dir.clone().multiplyScalar(rnd(1,4)*(mode==='blast'?2:1)).add(V$3(rnd(-1.5,1.5), rnd(0,2.5), rnd(-1.5,1.5)));
    FXS.splinters.spawn(cc, v, V$3(rnd(0.08,0.22), rnd(0.006,0.012), rnd(0.012,0.03)), fl, rnd(6,12));
  }
  FXS.dust.spawn({p:cc, v:dir.clone().multiplyScalar(0.6).add(V$3(0,0.2,0)), life:rnd(1.5,3), s0:0.25, s1:1.1,
    col:mode==='fire'?[0.18,0.16,0.15]:[0.72,0.62,0.48], a0:0.35, a1:0, drag:1.5, g:0.05});
}
/** Высота пола под точкой (для щепы без физики): луч вниз по статике. */
function floorBelow(p){
  const h = rayFirst(_b.set(p.x, p.y+0.05, p.z), _c.set(p.x, p.y-30, p.z), GRP.STATIC);
  if(!h) return floorDepthAt(p.x, p.z);
  // пол ангара — коллайдер-плита; выбоины и воронки в нём только визуальные
  return Math.abs(h.p.y) < 0.02 ? h.p.y + floorDepthAt(p.x, p.z) : h.p.y;
}

/* ============================================================================
   БРУС: стойки каркаса, лаги перекрытия, стойки перил и укрытий.
   Ломается в точке удара на две половины с рваным торцом — дальше их
   ведёт физика: верх заваливается, низ остаётся торчать или падает.
============================================================================ */
function createBeam(o){
  const a = o.a.clone(), b = o.b.clone();
  const axis = V$3().subVectors(b,a); const L = axis.length(); axis.normalize();
  const up = Math.abs(axis.y) > 0.9 ? V$3(1,0,0) : V$3(0,1,0);
  const side = o.side ? o.side.clone().normalize() : V$3().crossVectors(up, axis).normalize();
  const other = V$3().crossVectors(axis, side).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, other, axis));
  const center = V$3().addVectors(a,b).multiplyScalar(0.5);
  const g = new THREE.BoxGeometry(o.sx, o.sy, L);
  const uv = g.attributes.uv; const dd = o.uvd ?? 0.9;
  const s = [[L,o.sy],[L,o.sy],[o.sx,L],[o.sx,L],[o.sx,o.sy],[o.sx,o.sy]];
  const ro = srnd()*2;
  for(let f=0;f<6;f++) for(let i=0;i<4;i++){ const k=f*4+i; let u=uv.getX(k)*s[f][0]*dd, v=uv.getY(k)*s[f][1]*dd;
    if(s[f][1] > s[f][0]){ const t=u; u=v; v=t; } uv.setXY(k, u+ro, v); }
  g.applyMatrix4(new THREE.Matrix4().compose(center, q, V$3(1,1,1)));
  if(o.tint) tintGeo(g, ...o.tint);
  const bm = { id: DEST.beams.length, a, b, L, axis, side, q, center, sx:o.sx, sy:o.sy, mat:o.mat||'wood',
    hp:o.hp ?? 260, wood: o.wood !== false, char:0, dead:false, mesh:null, base:0, count:24,
    collide: o.collide !== false, noPlayer: !!o.noPlayer, tint:o.tint || [1,1,1], surf: o.surf || (o.wood===false?'metal':'wood'),
    fragile: o.fragile ?? 1 };
  g.userData.group = 'dest';
  g.userData.onBaked = (mesh, start)=>{ bm.mesh = mesh; bm.base = start; };
  bucket(bm.mat).push(g);
  DEST.beams.push(bm);
  const nPts = Math.max(1, Math.round(L/0.8));
  for(let i=0;i<nPts;i++) hashAdd(V$3().lerpVectors(a,b,(i+0.5)/nPts), {t:'b', b:bm});
  return bm;
}
function beamBody(bm){
  const c = {cx:bm.center.x, cy:bm.center.y, cz:bm.center.z, hx:bm.sx/2, hy:bm.sy/2, hz:bm.L/2,
             q:[bm.q.x,bm.q.y,bm.q.z,bm.q.w], surf:bm.surf, noPlayer: bm.noPlayer};
  bm.body = addStaticCollider(c, bm.owner);
}
function breakBeam(bm, hitP, dir, power, mode){
  if(bm.dead) return;
  bm.dead = true; DEST.broken++;
  if(bm.mesh) collapseRange(bm.mesh, bm.base, bm.count, bm.center);
  if(bm.body){ removeBody(bm.body); bm.body = null; }
  FXS.decals.removeKey(100000 + bm.id);
  const t = hitP ? clamp(V$3().subVectors(hitP, bm.a).dot(bm.axis), 0.12, bm.L-0.12) : bm.L*sr(0.3,0.7);
  for(const [t0,t1] of [[0, t], [t, bm.L]]){
    const len = t1 - t0; if(len < 0.1) continue;
    const g = new THREE.BoxGeometry(bm.sx, bm.sy, len, 1, 1, 2);
    // рваный торец: вершины на стороне излома сдвигаются вдоль оси вразнобой
    const pa = g.attributes.position, brokenEnd = (t0 === 0) ? len/2 : -len/2;
    for(let i=0;i<pa.count;i++)
      if(Math.abs(pa.getZ(i) - brokenEnd) < 1e-4) pa.setZ(i, pa.getZ(i) + (brokenEnd>0?1:-1)*rnd(-0.07,0.05));
    g.computeVertexNormals();
    tintGeo(g, ...bm.tint);
    const nb = new Float32Array(pa.count*2); for(let i=0;i<pa.count;i++){ nb[i*2]=bm.char; nb[i*2+1]= mode==='fire'?0.8:0; }
    g.setAttribute('aBurn', new THREE.BufferAttribute(nb,2));
    const mesh = new THREE.Mesh(g, M[bm.mat] || M.wood);
    mesh.userData.ownGeo = true; mesh.castShadow = mesh.receiveShadow = true;
    mesh.quaternion.copy(bm.q);
    mesh.position.copy(bm.a).addScaledVector(bm.axis, (t0+t1)/2);
    scene.add(mesh);
    const k = mode==='blast' ? power*6 : 0.6*power;
    const vel = dir.clone().multiplyScalar(k).add(V$3(rnd(-0.3,0.3), mode==='blast'?rnd(0.5,2):0, rnd(-0.3,0.3)));
    addDynamic(mesh, {size:[bm.sx, bm.sy, len], mass: bm.sx*bm.sy*len*520, vel,
      spin: V$3(rnd(-2,2),rnd(-2,2),rnd(-2,2)).multiplyScalar(mode==='blast'?2:0.5),
      life: sr(40,70), group: GRP.DYN, friction:0.8, restitution:0.08, surf:bm.surf});
  }
  const hp = hitP || bm.center;
  const fl = floorBelow(hp);
  for(let i=0;i<8;i++) FXS.splinters.spawn(hp, dir.clone().multiplyScalar(rnd(1,3)).add(V$3(rnd(-1.5,1.5),rnd(0,2),rnd(-1.5,1.5))),
    V$3(rnd(0.08,0.3), rnd(0.008,0.02), rnd(0.012,0.03)), fl, rnd(8,14));
  if(bm.wood) SND.wood(hp, 1.2); else SND.hit(hp, 'metal');
  if(HOOKS.onBreak) HOOKS.onBreak('beam', hp, mode);
}

/* ============================================================================
   СТЕКЛО: первая пуля — звезда трещин, вторая (или взрыв) — осыпается.
   Осколки строятся радиально от точки удара и обрезаются рамой; часть
   остаётся торчать в раме, крупные падают телами, мелочь — крошкой.
============================================================================ */
function registerGlass(mesh, o={}){
  mesh.updateWorldMatrix(true,false);
  const gl = { id: DEST.glass.length, mesh, w: mesh.userData.glass.w, h: mesh.userData.glass.h, hp: o.hp ?? 2, dead:false,
    center: V$3().setFromMatrixPosition(mesh.matrixWorld), q: new THREE.Quaternion().setFromRotationMatrix(mesh.matrixWorld),
    playerCollide: !!o.playerCollide };
  gl.N = V$3(0,0,1).applyQuaternion(gl.q); gl.U = V$3(1,0,0).applyQuaternion(gl.q); gl.Vv = V$3(0,1,0).applyQuaternion(gl.q);
  DEST.glass.push(gl);
  hashAdd(gl.center, {t:'g', g:gl});
  return gl;
}
/** Целые стёкла рисуются одним InstancedMesh на материал (было по мешу на
    стекло — 68 вызовов). Разбитое стекло просто гасит свой экземпляр. */
function instanceGlass(){
  const groups = new Map();
  for(const gl of DEST.glass){
    const m = gl.mesh; if(!m || !m.parent || m.isInstancedMesh || Array.isArray(m.material)) continue;
    if(!groups.has(m.material)) groups.set(m.material, []);
    groups.get(m.material).push(gl);
  }
  const unit = new THREE.PlaneGeometry(1, 1), zero = new THREE.Matrix4().makeScale(0,0,0);
  const mw = new THREE.Matrix4(), sc = new THREE.Matrix4(), box = new THREE.Box3(), size = new THREE.Vector3(), ctr = new THREE.Vector3();
  for(const [mat, list] of groups){
    if(list.length < 2) continue;
    const im = new THREE.InstancedMesh(unit, mat, list.length);
    im.userData.nomerge = true; im.castShadow = false; im.receiveShadow = list[0].mesh.receiveShadow;
    im.renderOrder = list[0].mesh.renderOrder;
    list.forEach((gl, i)=>{
      const m = gl.mesh;
      m.updateWorldMatrix(true, false);
      m.geometry.computeBoundingBox(); box.copy(m.geometry.boundingBox); box.getSize(size); box.getCenter(ctr);
      mw.copy(m.matrixWorld).multiply(sc.makeTranslation(ctr.x, ctr.y, ctr.z)).multiply(sc.makeScale(size.x || 1, size.y || 1, 1));
      im.setMatrixAt(i, mw);
      m.removeFromParent();
      gl.mesh = { material: mat, set visible(v){ if(!v){ im.setMatrixAt(i, zero); im.instanceMatrix.needsUpdate = true; } } };
    });
    im.computeBoundingSphere();
    scene.add(im);
  }
}
function glassBody(gl){
  const c = {cx:gl.center.x, cy:gl.center.y, cz:gl.center.z, hx:gl.w/2, hy:gl.h/2, hz:0.012,
             q:[gl.q.x,gl.q.y,gl.q.z,gl.q.w], surf:'glass', noPlayer: !gl.playerCollide};
  gl.body = addStaticCollider(c, gl.owner);
}
function clipRect(poly, hw, hh){
  const clip = (P, f)=>{ const out=[]; for(let i=0;i<P.length;i++){ const a=P[i], b=P[(i+1)%P.length], fa=f(a), fb=f(b);
      if(fa>=0) out.push(a); if((fa>=0)!==(fb>=0)){ const t=fa/(fa-fb); out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]); } } return out; };
  let P = poly;
  for(const f of [p=>p[0]+hw, p=>hw-p[0], p=>p[1]+hh, p=>hh-p[1]]){ P = clip(P, f); if(P.length<3) return null; }
  return P;
}
function shatterGlass(gl, hitP, dir, power){
  if(gl.dead) return;
  gl.dead = true; DEST.broken++;
  if(gl.body){ removeBody(gl.body); gl.body = null; }
  gl.mesh.visible = false;
  FXS.decals.removeKey(200000 + gl.id);
  const hp = hitP || gl.center;
  _a.subVectors(hp, gl.center);
  const iu = clamp(_a.dot(gl.U), -gl.w/2, gl.w/2), iv = clamp(_a.dot(gl.Vv), -gl.h/2, gl.h/2);
  const spokes = 9 + Math.floor(Math.random()*5);
  const rings = [0.08, 0.22, 0.45, 0.8, 1.3].map(r=>r*Math.max(gl.w,gl.h));
  const ang = []; for(let i=0;i<spokes;i++) ang.push((i + rnd(-0.3,0.3))/spokes*Math.PI*2);
  const P = (a, r)=> [iu + Math.cos(a)*r, iv + Math.sin(a)*r];
  const stay = [], fall = [];
  for(let s=0;s<spokes;s++) for(let r=0;r<rings.length;r++){
    const a0 = ang[s], a1 = ang[(s+1)%spokes] + (s===spokes-1?Math.PI*2:0);
    const r0 = r===0 ? 0 : rings[r-1]*rnd(0.9,1.1), r1 = rings[r]*rnd(0.9,1.1);
    const poly = r===0 ? [[iu,iv], P(a0,r1), P(a1,r1)] : [P(a0,r0), P(a0,r1), P(a1,r1), P(a1,r0)];
    const cp = clipRect(poly, gl.w/2, gl.h/2); if(!cp) continue;
    const onEdge = cp.some(p=> Math.abs(Math.abs(p[0])-gl.w/2)<1e-3 || Math.abs(Math.abs(p[1])-gl.h/2)<1e-3);
    (onEdge && r >= 2 && Math.random() < 0.4 ? stay : fall).push(cp);
  }
  // осколки, оставшиеся в раме, — один статичный меш
  if(stay.length){
    const parts = stay.map(cp=> new THREE.ShapeGeometry(new THREE.Shape(cp.map(p=>new THREE.Vector2(p[0],p[1])))));
    const g = BGU.mergeGeometries(parts, false);
    if(g){ const m = new THREE.Mesh(g, gl.mesh.material); m.position.copy(gl.center); m.quaternion.copy(gl.q);
      m.userData.nomerge = true; scene.add(m); gl.remnant = m; }
  }
  let dynLeft = Q.debris >= 400 ? 14 : 7;
  const area = cp=>{ let s=0; for(let i=0;i<cp.length;i++){ const a=cp[i], b=cp[(i+1)%cp.length]; s+=a[0]*b[1]-b[0]*a[1]; } return Math.abs(s)/2; };
  for(const cp of fall){
    let cu=0, cv=0; for(const p of cp){ cu+=p[0]/cp.length; cv+=p[1]/cp.length; }
    const wp = V$3().copy(gl.center).addScaledVector(gl.U, cu).addScaledVector(gl.Vv, cv);
    const A = area(cp);
    const out = dir.clone().multiplyScalar(power*rnd(1,3)).add(V$3(rnd(-0.5,0.5), rnd(-0.2,0.6), rnd(-0.5,0.5)));
    if(A > 0.01 && dynLeft-- > 0){
      const shape = new THREE.Shape(cp.map(p=>new THREE.Vector2(p[0]-cu, p[1]-cv)));
      const g = new THREE.ExtrudeGeometry(shape, {depth:0.006, bevelEnabled:false});
      const m = new THREE.Mesh(g, gl.mesh.material); m.userData.ownGeo = true;
      m.position.copy(wp); m.quaternion.copy(gl.q); m.castShadow = true; scene.add(m);
      let mu=1e9,Mu=-1e9,mv=1e9,Mv=-1e9;
      for(const p of cp){ mu=Math.min(mu,p[0]);Mu=Math.max(Mu,p[0]);mv=Math.min(mv,p[1]);Mv=Math.max(Mv,p[1]); }
      addDynamic(m, {size:[Mu-mu, Mv-mv, 0.012], mass: A*0.006*2500, vel:out, spin:V$3(rnd(-6,6),rnd(-6,6),rnd(-6,6)),
        life: sr(12,20), friction:0.5, restitution:0.05, surf:'glass', group:GRP.DEBRIS});
    } else {
      const fl = floorBelow(wp);
      for(let i=0;i<2;i++) FXS.glassChips.spawn(wp, out.clone().add(V$3(rnd(-1,1),rnd(0,1),rnd(-1,1))),
        V$3(rnd(0.02,0.07),rnd(0.02,0.07),1), fl, rnd(8,15));
    }
  }
  SND.glass(hp, 14);
  if(HOOKS.onBreak) HOOKS.onBreak('glass', hp, 'blast');
}

/* ============================================================================
   РЕКВИЗИТ: ящики, поддоны, баррикады, взрывоопасные бочки.
   Пока цел — статичное укрытие; сломан — каждая деталь становится телом.
============================================================================ */
/** Реквизит запекается в общие меши (одна отрисовка на материал и ячейку),
    как листы и брус: при поломке его диапазон вершин схлопывается, а детали
    вылетают отдельными телами. Раньше каждый ящик/поддон был десятком мешей. */
const PROP_BAKE = [];
function registerProp(group, o={}){
  group.userData.nomerge = true;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(V$3()), size = box.getSize(V$3());
  const p = { group, hp:o.hp ?? 150, dead:false, wood:o.wood ?? true, surf:o.surf || 'wood', center,
    col: o.col || {cx:center.x, cy:center.y, cz:center.z, hx:size.x/2, hy:size.y/2, hz:size.z/2, q:null},
    onBreak:o.onBreak || null, explosive: !!o.explosive, target: !!o.target, mass:o.mass ?? 8, burnHp: o.burnHp ?? 1,
    parts:[], ranges:[] };
  group.traverse(m=>{
    if(!m.isMesh) return;
    p.parts.push({geo:m.geometry, mat:m.material, mw:m.matrixWorld.clone(), cast:m.castShadow});
    if(Array.isArray(m.material)) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
    g.userData = { group:'prop', onBaked:(mesh, start, count)=> p.ranges.push([mesh, start, count]) };
    PROP_BAKE.push({geo:g, mat:m.material, cast:m.castShadow, recv:m.receiveShadow, order:m.renderOrder});
  });
  group.removeFromParent();
  DEST.props.push(p);
  hashAdd(center, {t:'p', p});
  return p;
}
function propBody(p){ const c = Object.assign({surf:p.surf}, p.col); p.body = addStaticCollider(c, p.owner); }
function breakProp(p, hitP, dir, power, mode){
  if(p.dead) return;
  p.dead = true; DEST.broken++;
  if(p.body){ removeBody(p.body); p.body = null; }
  for(const [mesh, start, count] of p.ranges) collapseRange(mesh, start, count, p.center);
  const n = p.parts.length;
  const wq = new THREE.Quaternion(), ws = V$3(), wpos = V$3();
  for(const part of p.parts){
    const g = part.geo; g.computeBoundingBox();
    const sz = g.boundingBox.getSize(V$3()), ctr = g.boundingBox.getCenter(V$3());
    const wp = ctr.clone().applyMatrix4(part.mw);
    part.mw.decompose(wpos, wq, ws);
    const geo = g.clone(); geo.translate(-ctr.x,-ctr.y,-ctr.z);
    ensureColorGeo(geo, part.mat);
    const nm = new THREE.Mesh(geo, part.mat); nm.userData.ownGeo = true;
    nm.position.copy(wp); nm.quaternion.copy(wq); nm.scale.copy(ws); nm.castShadow = true; nm.receiveShadow = true;
    scene.add(nm);
    const away = V$3().subVectors(wp, hitP || p.center).normalize();
    const k = mode==='blast' ? power*7 : 1.2;
    addDynamic(nm, {size:[Math.max(0.02,sz.x*ws.x), Math.max(0.02,sz.y*ws.y), Math.max(0.02,sz.z*ws.z)],
      mass: Math.max(0.3, p.mass/n), vel: away.multiplyScalar(k).addScaledVector(dir, k*0.5).add(V$3(0, mode==='blast'?rnd(1,3):0.5, 0)),
      spin: V$3(rnd(-5,5),rnd(-5,5),rnd(-5,5)), life: sr(35,60), group: n > 12 ? GRP.DEBRIS : GRP.DYN, surf:p.surf});
  }
  if(p.explosive && HOOKS.barrel) HOOKS.barrel(p);
  if(p.wood) SND.wood(p.center, 1.5);
  if(p.onBreak) p.onBreak(p, hitP, dir, power, mode);
  if(HOOKS.onBreak) HOOKS.onBreak('prop', p.center, mode);
}

/* ============================================================================
   ФИЗИКА РАЗРУШАЕМЫХ: тела создаются после инициализации Ammo
============================================================================ */
function initDestructiblePhysics(){
  for(const s of DEST.sheets){ s.owner = registerOwner({type:'sheet', s}); rebuildSheetBody(s); }
  for(const b of DEST.beams){ b.owner = registerOwner({type:'beam', b}); if(b.collide) beamBody(b); }
  for(const g of DEST.glass){ g.owner = registerOwner({type:'glass', g}); glassBody(g); }
  for(const p of DEST.props){ p.owner = registerOwner({type:'prop', p}); propBody(p); }
}
/** Перестройка коллайдеров листов, изменившихся за кадр (один раз на лист). */
function flushDestruction(){
  let guard = 0;
  while(DEST.dirty.size && guard++ < 4){
    const list = [...DEST.dirty]; DEST.dirty.clear();
    for(const s of list) dropIslands(s, V$3(0,-1,0));
    for(const s of list) rebuildSheetBody(s);
  }
}

/* ============================================================================
   ПОПАДАНИЕ ПУЛИ. Возвращает {stop, cost, surf}: дерево пробивается с
   потерей энергии, бетон и металл останавливают пулю.
============================================================================ */
function bulletHit(hit, dir, power){
  const own = hit.idx >= 0 ? PH.owners[hit.idx] : null;
  const dmg = 34*power;
  // ткань флага (soft body без индекса): пуля дёргает полотнище и летит дальше
  if(hit.idx === -1){ pokeCloth(hit.p, 0.35, 30*power); return {stop:false, cost:0.02, surf:'cloth'}; }
  if(!own){
    const surf = SURF_NAME[hit.idx] || 'conc';
    impactFX(hit.p, hit.n, surf, dir);
    return {stop: surf !== 'wood' && surf !== 'glass', cost: surf==='wood'?0.5:1, surf};
  }
  if(own.type === 'sheet'){
    const s = own.s;
    let dn = dir.dot(s.N);
    if(Math.abs(dn) < 0.05) dn = dn < 0 ? -0.05 : 0.05;
    // точка на лицевой плоскости листа (коллайдер уходит вглубь стены)
    _a.subVectors(hit.p, s.c); const off = _a.dot(s.N);
    const pf = hit.p.clone().addScaledVector(dir, (s.t/2 - off)/dn);
    const k = chunkAt(s, pf);
    if(!s.alive[k]) return {stop:false, cost:0, surf:'wood'};
    const out = dn < 0 ? s.N : s.N.clone().negate();     // сторона, куда летит щепа на входе
    FXS.decals.add(pf, s.N, rnd(0.07,0.1), Math.random()<0.5?0:1, s.id*4096+k);
    const fl = floorBelow(pf);
    for(let i=0;i<3;i++) FXS.splinters.spawn(pf, dir.clone().multiplyScalar(rnd(0.5,2.5)).addScaledVector(out, rnd(0.2,1)).add(V$3(rnd(-0.6,.6),rnd(0,1),rnd(-0.6,.6))),
      V$3(rnd(0.03,0.09), rnd(0.003,0.007), rnd(0.006,0.014)), fl, rnd(5,10));
    FXS.dust.spawn({p:pf, v:out.clone().multiplyScalar(0.8), life:rnd(0.8,1.6), s0:0.08, s1:0.45, col:[0.75,0.64,0.5], a0:0.4, a1:0, drag:2});
    SND.hit(pf, 'wood');
    damageChunk(s, k, dmg, dir, power, 'bullet');
    // соседи получают долю: очередь «прорезает» щель
    const i = k % s.nu, j = (k/s.nu)|0;
    for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]){ const ii=i+di, jj=j+dj;
      if(ii>=0&&jj>=0&&ii<s.nu&&jj<s.nv) damageChunk(s, jj*s.nu+ii, dmg*0.18, dir, power*0.5, 'bullet'); }
    return {stop:false, cost:0.12, surf:'wood'};
  }
  if(own.type === 'beam'){
    const b = own.b;
    FXS.decals.add(hit.p, hit.n, rnd(0.06,0.08), b.wood?0:2, 100000+b.id);
    impactFX(hit.p, hit.n, b.surf, dir);
    if(b.wood){ b.hp -= dmg*b.fragile; if(b.hp <= 0) breakBeam(b, hit.p, dir, power, 'bullet'); }
    return {stop: !b.wood, cost: b.wood ? Math.min(0.9, (b.sx+b.sy)*2.2) : 1, surf: b.surf};
  }
  if(own.type === 'glass'){
    const g = own.g;
    g.hp -= 1;
    if(g.hp <= 0) shatterGlass(g, hit.p, dir, power);
    else { FXS.decals.add(hit.p, hit.n.dot(dir) < 0 ? hit.n : hit.n.clone().negate(), rnd(0.35,0.55), 3, 200000+g.id); SND.glass(hit.p, 3); }
    return {stop:false, cost:0.05, surf:'glass'};
  }
  if(own.type === 'prop'){
    const p = own.p;
    impactFX(hit.p, hit.n, p.surf, dir);
    p.hp -= dmg;
    if(p.explosive && p.hp < 60 && !p.leaking){ p.leaking = true; if(HOOKS.leak) HOOKS.leak(p, hit.p); }
    const killed = p.hp <= 0;
    if(killed) breakProp(p, hit.p, dir, power, 'bullet');
    return {stop: !p.wood, cost:0.5, surf:p.surf, feedback: p.target ? (killed ? 2 : 1) : 0};
  }
  if(own.type === 'door') return doorBulletHit(own.d, hit, dir, power);
  if(own.type === 'dyn'){
    const r = own.rec;
    impulse(r.body, dir.x*2.5*power, dir.y*2.5*power, dir.z*2.5*power, 0,0,0);
    impactFX(hit.p, hit.n, r.surf, dir);
    if(r.onHit) r.onHit(r, hit, dir, power);
    return {stop: r.surf !== 'wood', cost:0.35, surf:r.surf};
  }
  return {stop:true, cost:1, surf:'conc'};
}
function damageChunk(s, k, dmg, dir, power, mode){
  if(!s.alive[k]) return;
  s.hp[k] -= dmg;
  if(s.hp[k] <= 0) breakChunk(s, k, dir, power, mode);
}
/** Искры, пыль, крошка — по типу поверхности. */
function impactFX(p, n, surf, dir){
  if(surf === 'metal'){
    for(let i=0;i<7;i++){ const v = n.clone().multiplyScalar(rnd(2,6)).add(V$3(rnd(-2,2),rnd(-1,3),rnd(-2,2))).addScaledVector(dir,-1.5);
      FXS.spark.spawn({p, v, life:rnd(0.15,0.45), s0:0.035, s1:0.01, col:[1,0.75,0.4], a0:1, a1:0, g:-9.8, drag:0.8}); }
    FXS.decals.add(p, n, 0.05, 2, null);
    SND.hit(p, 'metal');
  } else if(surf === 'conc'){
    const fl = floorBelow(p);
    for(let i=0;i<4;i++) FXS.concChips.spawn(p, n.clone().multiplyScalar(rnd(1,3)).add(V$3(rnd(-1,1),rnd(0,2),rnd(-1,1))), rnd(0.012,0.03), fl, rnd(4,8));
    FXS.dust.spawn({p, v:n.clone().multiplyScalar(1.6), life:rnd(0.5,0.9), s0:0.05, s1:0.45, col:[0.72,0.7,0.66], a0:0.6, a1:0, drag:5});
    FXS.dust.spawn({p, v:n.clone().multiplyScalar(0.6).add(V$3(0,0.1,0)), life:rnd(2.2,3.6), s0:0.15, s1:1.1, col:[0.7,0.68,0.64], a0:0.28, a1:0, aPow:0.8, drag:2.2, g:-0.05});
    FXS.decals.add(p, n, rnd(0.06,0.09), 2, null);
    FXS.spark.spawn({p, v:n.clone().multiplyScalar(2), life:0.08, s0:0.05, s1:0.02, col:[1,0.8,0.6], a0:0.8, a1:0});
    SND.hit(p, 'conc');
  } else if(surf === 'sand'){
    FXS.dust.spawn({p, v:n.clone().multiplyScalar(1.2).add(V$3(0,0.6,0)), life:rnd(1,1.8), s0:0.12, s1:0.7, col:[0.62,0.55,0.42], a0:0.55, a1:0, drag:2, g:-0.5});
    SND.hit(p, 'sand');
  } else if(surf === 'wood'){
    const fl = floorBelow(p);
    for(let i=0;i<3;i++) FXS.splinters.spawn(p, n.clone().multiplyScalar(rnd(0.5,2)).add(V$3(rnd(-0.6,.6),rnd(0,1),rnd(-0.6,.6))),
      V$3(rnd(0.03,0.08), rnd(0.003,0.007), rnd(0.006,0.014)), fl, rnd(5,10));
    FXS.decals.add(p, n, rnd(0.06,0.08), 0, null);
    SND.hit(p, 'wood');
  } else if(surf === 'glass') SND.hit(p, 'glass');
}

/* ============================================================================
   ВЗРЫВ: ударная волна рвёт обшивку и брус, выбивает стёкла, раскидывает
   обломки, давит на флаги; огонь — по обстоятельствам.
============================================================================ */
function explode(p, o={}){
  const R = o.radius ?? 6.0, P = o.power ?? 1.0;
  // зона разрушения заметно меньше зоны поражения: граната рвёт обшивку
  // в радиусе пары метров, дальше — только трясёт и сечёт осколками
  const Rb = R*0.42;
  for(const {ref, pos, d} of query(p, Rb)){
    const k = Math.pow(1 - d/Rb, 1.2);
    const dir = V$3().subVectors(pos, p).normalize();
    const dmg = 760*P*k;
    if(ref.t === 'c'){ ref.s.char[ref.k] = Math.max(ref.s.char[ref.k], 0.25*k*P);
      damageChunk(ref.s, ref.k, dmg*(0.7+Math.random()*0.6), dir, P*k*1.4, 'blast'); }
    else if(ref.t === 'b'){ ref.b.hp -= dmg*0.8*ref.b.fragile; if(ref.b.hp <= 0) breakBeam(ref.b, pos.clone().lerp(p, 0.3), dir, P*k*1.4, 'blast'); }
    else if(ref.t === 'p'){ ref.p.hp -= dmg; if(ref.p.hp <= 0) breakProp(ref.p, p, dir, P*k*1.4, 'blast'); }
  }
  for(const {ref, pos, d} of query(p, R*1.6, r=>r.t==='g')){
    if(Math.random() < 1 - d/(R*1.6)*0.7) shatterGlass(ref.g, pos, V$3().subVectors(pos,p).normalize(), 1.5*(1-d/(R*1.6)));
  }
  flushDestruction();
  blastImpulse(p, R*1.3, 28*P);
  pokeCloth(p, R*2.5, 60*P);
  if(HOOKS.playerBlast) HOOKS.playerBlast(p, R, P);
  if(HOOKS.doorBlast) HOOKS.doorBlast(p, R*0.8, P);
  charSphere(p, R*0.45, 0.35*P, 0.15);
  if(HOOKS.ignite){
    if(o.fire) HOOKS.ignite(p, o.fire, R*0.5);
    else if(Math.random() < 0.45*P) HOOKS.ignite(p, 0.5, R*0.4);
  }
}
function burnDamage(ref, dmg, dir){
  if(ref.t==='c') damageChunk(ref.s, ref.k, dmg, dir||V$3(0,-1,0), 0.2, 'fire');
  else if(ref.t==='b'){ ref.b.hp -= dmg; if(ref.b.hp <= 0) breakBeam(ref.b, null, dir||V$3(0,-1,0), 0.2, 'fire'); }
  else if(ref.t==='p'){ ref.p.hp -= dmg*ref.p.burnHp; if(ref.p.hp <= 0) breakProp(ref.p, null, V$3(0,1,0), 0.3, 'fire'); }
}

/* ============================================================================
   ОБУГЛИВАНИЕ: вершины в радиусе темнеют, трещины тлеют, пока есть жар.
============================================================================ */
const HOT = new Map();
function burnRange(mesh, start, count, p, r, dChar, heat){
  const pa = mesh.geometry.attributes.position, ba = mesh.geometry.attributes.aBurn;
  if(!ba) return 0;
  let maxC = 0;
  for(let i=start;i<start+count;i++){
    _a.fromBufferAttribute(pa, i);
    const d = _a.distanceTo(p);
    if(d > r){ maxC = Math.max(maxC, ba.getX(i)); continue; }
    const k = 1 - d/r;
    const c = Math.min(1, ba.getX(i) + dChar*k);
    ba.setXY(i, c, Math.max(ba.getY(i), heat*k)); maxC = Math.max(maxC, c);
  }
  ba.addUpdateRange(start*2, count*2); ba.needsUpdate = true;
  if(heat > 0) HOT.set(mesh.uuid+':'+start, {mesh, start, count});
  return maxC;
}
function charSphere(p, r, dChar, heat){
  for(const {ref} of query(p, r+0.4)){
    if(ref.t === 'c'){ const s = ref.s; if(!s.mesh) continue;
      s.char[ref.k] = burnRange(s.mesh, s.base + ref.k*CV, CV, p, r, dChar, heat); }
    else if(ref.t === 'b' && ref.b.wood && ref.b.mesh){ const b = ref.b; b.char = burnRange(b.mesh, b.base, b.count, p, r, dChar, heat); }
  }
}
let _coolT = 0;
function coolDown(dt){
  _coolT += dt; if(_coolT < 0.3) return;
  const k = Math.exp(-_coolT*0.22); _coolT = 0;
  for(const [key, h] of HOT){
    const ba = h.mesh.geometry.attributes.aBurn; let any = false;
    for(let i=h.start;i<h.start+h.count;i++){ const y = ba.getY(i)*k; ba.setY(i, y < 0.02 ? 0 : y); if(y >= 0.02) any = true; }
    ba.addUpdateRange(h.start*2, h.count*2); ba.needsUpdate = true;
    if(!any) HOT.delete(key);
  }
}

// Шут-хаус из OSB на каркасе: планировка, стены с проёмами, перекрытие,
// внутренние деревянные и наружные стальные лестницы. Все проёмы, марши и
// площадки берутся из одних таблиц — лестница не может упереться в стену.

const BX0=-15, BX1=15, BZ0=-9.5, BZ1=9.5;
const H1 = 3.05;            // высота стен 1 этажа (верх обвязки)
const JOIST = 0.235, SUBF = 0.022;
const F2 = H1 + JOIST + SUBF; // отметка чистого пола 2 этажа = 3.307
const H2 = 2.9;             // стены 2 этажа
const TH = 0.14, SHEET = 0.0125, STUD = 0.045, STEP = 0.61;
const ATR = {x0:-4.5, z0:-3.5, x1:4.5, z1:3.5};
const CZ = 1.3;                    // полуширина коридоров крыльев
const PX = 9.75;                   // перегородка между комнатами крыла
/** Внутренние марши: x0..x1 — ширина, z — низ и направление (к фасаду). */
const STAIRS_IN = [
  // перед первой ступенью 1.3 м до стены коридора — место, чтобы развернуться
  {x0:-14.92, x1:-13.72, zBot:-2.6, dir:-1},    // СЗ комната, вверх на север
  {x0: 13.72, x1: 14.92, zBot: 2.6, dir: 1}     // ЮВ комната, вверх на юг
];
const RUN_IN = 4.8;
/** Наружные стальные лестницы к дверям 2 этажа (перпендикулярно фасаду). */
const STAIRS_OUT = [
  {x:-7.2, side:'n'}, {x: 7.2, side:'s'}
];
const RUN_OUT = 5.4, PLAT_D = 1.8, PLAT_W = 2.4;
const WALLS = [];           // для миникарты и декора
const DOORS = [];           // центры дверей (миникарта, свет)

const DOOR_W = 1.2, DOOR_H = 2.1;
const D  = (c,w=DOOR_W)=>({at:c, w, y0:0, y1:DOOR_H, door:true});
const Wn = (c,w=1.2, glass=false)=>({at:c, w, y0:0.95, y1:2.0, glass});
const Wl = (c,w=2.2)=>({at:c, w, y0:1.0, y1:2.05});           // широкий проём

/* ============================================================================
   СТЕНА: обвязка, стойки (разрушаемый брус), перемычки, обшивка листами из
   кусков с обеих сторон. Промежуточный ригель идёт только между стойками
   вне проёмов — поперёк двери ничего не висит.
============================================================================ */
function buildWall(x1,z1,x2,z2, y0,h, opt={}){
  const dx=x2-x1, dz=z2-z1, len=Math.hypot(dx,dz);
  if(len < 0.05) return;
  const ang = Math.atan2(dx,dz);
  const ux=dx/len, uz=dz/len, nx=uz, nz=-ux;
  // проёмы задаются центром вдоль стены (от точки 1)
  const ops = (opt.openings||[]).map(o=>({...o, t0:o.at-o.w/2, t1:o.at+o.w/2, y1:Math.min(o.y1, h-0.2)}))
                                 .sort((a,b)=>a.t0-b.t0);
  const P = (t,n,y)=> new THREE.Vector3(x1+ux*t+nx*n, y, z1+uz*t+nz*n);
  const wallQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), ang);
  const plate = (t0,t1,yc,sy)=>{
    const L=t1-t0; if(L<=0.02) return; const c=P(t0+L/2,0,yc);
    const g=new THREE.BoxGeometry(TH*0.98,sy,L); uvBox(g,TH,sy,L,0.9,true);
    g.applyMatrix4(_m4.compose(c, wallQ, new THREE.Vector3(1,1,1))); bucket('wood').push(g);
  };
  // нижняя обвязка прерывается в дверях — порога нет
  let cur = 0;
  for(const o of ops){ if(o.y0 < 0.05){ plate(cur, o.t0-0.001, y0+0.044, 0.088); cur = o.t1+0.001; } }
  plate(cur, len, y0+0.044, 0.088);
  plate(0, len, y0+h-0.044, 0.088);
  plate(0, len, y0+h-0.132, 0.088);
  const inOp = (t, pad=0.06)=> ops.some(o=> t > o.t0-pad && t < o.t1+pad);
  const studH0 = y0+0.088, studH1 = y0+h-0.176;
  const studs = [];
  const stud = (t, y0s=studH0, y1s=studH1, hp=220)=>{
    if(y1s - y0s < 0.1) return;
    createBeam({a:P(t,0,y0s), b:P(t,0,y1s), sx:STUD*1.9, sy:TH*0.98, side:new THREE.Vector3(ux,0,uz), hp, mat:'wood'});
  };
  for(let t=STUD; t<=len-STUD+0.001; t+=STEP){
    const tt = Math.min(t, len-STUD);
    if(inOp(tt)) continue;
    stud(tt); studs.push(tt);
  }
  if(!studs.length || len-studs[studs.length-1] > 0.2){ if(!inOp(len-STUD)) { stud(len-STUD); studs.push(len-STUD); } }
  for(const o of ops){
    // стойки у проёма: основная + подкосная под перемычкой
    stud(o.t0-STUD); stud(o.t1+STUD);
    stud(o.t0-STUD*3, studH0, y0+o.y1, 180); stud(o.t1+STUD*3, studH0, y0+o.y1, 180);
    studs.push(o.t0-STUD, o.t1+STUD);
    // перемычка над проёмом
    createBeam({a:P(o.t0-STUD*4,0,y0+o.y1+0.1), b:P(o.t1+STUD*4,0,y0+o.y1+0.1), sx:TH*0.98, sy:0.2,
                side:new THREE.Vector3(nx,0,nz), hp:320, mat:'wood'});
    // короткие стойки над перемычкой
    for(let t=o.t0+0.2; t<o.t1-0.1; t+=STEP) stud(t, y0+o.y1+0.2, studH1, 150);
    if(o.y0 > 0.05){
      createBeam({a:P(o.t0,0,y0+o.y0-0.04), b:P(o.t1,0,y0+o.y0-0.04), sx:TH*0.98, sy:0.08,
                  side:new THREE.Vector3(nx,0,nz), hp:160, mat:'wood'});
      for(let t=o.t0+0.2; t<o.t1-0.1; t+=STEP) stud(t, studH0, y0+o.y0-0.08, 120);
    }
    // наличник и обкладка проёма: откосы закрыты доской, не торчит каркас
    const jt = TH + SHEET*2 + 0.004;
    for(const tt of [o.t0-0.012, o.t1+0.012]){
      const c = P(tt, 0, y0+(o.y0+o.y1)/2);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?0.024:jt, o.y1-o.y0, Math.abs(ux)>0.5?jt:0.024,
             {collide:false, d:1.2, tint:[0.92,0.86,0.76]});
    }
    { const c = P((o.t0+o.t1)/2, 0, y0+o.y1+0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w+0.05:jt, 0.024, Math.abs(ux)>0.5?jt:o.w+0.05, {collide:false, d:1.2, tint:[0.92,0.86,0.76]}); }
    if(o.y0 > 0.05){
      const c = P((o.t0+o.t1)/2, 0, y0+o.y0-0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w+0.1:jt+0.06, 0.03, Math.abs(ux)>0.5?jt+0.06:o.w+0.1, {collide:false, d:1.2, tint:[0.9,0.84,0.74]});
      if(o.glass) windowGlass(P((o.t0+o.t1)/2, 0, y0+(o.y0+o.y1)/2), ang, o.w, o.y1-o.y0);
    }
    // порог двери 2 этажа закрывает щель между полами соседних пролётов
    if(o.door && y0 > 1){ const c = P((o.t0+o.t1)/2, 0, y0-0.012);
      addBox('wood', c.x, c.y, c.z, Math.abs(ux)>0.5?o.w:TH+0.12, 0.03, Math.abs(ux)>0.5?TH+0.12:o.w, {d:1.1, tint:[0.85,0.8,0.7]}); }
    if(o.door) DOORS.push({x:(P((o.t0+o.t1)/2,0,0)).x, z:(P((o.t0+o.t1)/2,0,0)).z, y:y0, ang, w:o.w});
  }
  // ригель между стойками — только вне проёмов
  if(h > 2.6){
    studs.sort((a,b)=>a-b);
    for(let i=0;i<studs.length-1;i++){
      const a = studs[i]+STUD, b = studs[i+1]-STUD;
      if(b-a < 0.05) continue;
      const mid = (a+b)/2, yb = y0+h*0.5;
      if(ops.some(o=> mid > o.t0-0.05 && mid < o.t1+0.05 && yb > y0+o.y0-0.1 && yb < y0+o.y1+0.25)) continue;
      plate(a, b, yb, 0.088);
    }
  }
  // обшивка: прямоугольники вокруг проёмов, резка на листы 1.22 x 2.44
  const rects=[]; cur=0;
  for(const o of ops){
    if(o.t0-cur>0.02) rects.push([cur,o.t0,0,h]);
    if(o.y0>0.02) rects.push([o.t0,o.t1,0,o.y0]);
    if(h-o.y1>0.02) rects.push([o.t0,o.t1,o.y1,h]);
    cur=o.t1;
  }
  if(len-cur>0.02) rects.push([cur,len,0,h]);
  const sides = opt.sheath==='none' ? [] : (opt.sheath==='one' ? [opt.side??1] : [1,-1]);
  const CH = Q.tex >= 0.75 ? 0.41 : 0.6;        // размер куска разрушения
  const trim = TH/2 + SHEET;
  for(const s of sides){
    const outer = opt.outSide === s;
    const T0 = outer ? -trim : (opt.trim0 === false ? 0 : trim);
    const T1 = outer ? len+trim : len - (opt.trim1 === false ? 0 : trim);
    const nOff = s*(TH/2+SHEET/2);
    const N = new THREE.Vector3(nx*s,0,nz*s);
    const Vv = new THREE.Vector3(0,1,0);
    const U = new THREE.Vector3().crossVectors(Vv, N);
    for(let [t0,t1,ry0,ry1] of rects){
      t0 = Math.max(t0, T0); t1 = Math.min(t1, T1);
      if(t0 <= 0.001 && T0 < 0 && rects[0][0] === 0) t0 = T0;
      if(t1 >= len-0.001 && T1 > len) t1 = T1;
      const L=t1-t0, Hh=ry1-ry0; if(L<0.05||Hh<0.05) continue;
      const SW=1.22, SH=2.44, GAP=0.004;
      const cols=Math.max(1,Math.ceil(L/SW-0.05)), rows=Math.max(1,Math.ceil(Hh/SH-0.05));
      const cw=L/cols, chh=Hh/rows;
      for(let ci=0;ci<cols;ci++) for(let ri=0;ri<rows;ri++){
        const lt0=t0+ci*cw+GAP/2, ltW=cw-GAP, ly0=ry0+ri*chh+GAP/2, lhH=chh-GAP;
        if(ltW<0.04||lhH<0.04) continue;
        const c = P(lt0+ltW/2, nOff, y0+ly0+lhH/2);
        const t0c = sr(0.84,1.05), warm = sr(0.95,1.03);
        createSheet({c, U, V:Vv, w:ltW, h:lhH, t:SHEET, nu:Math.max(1,Math.round(ltW/CH)), nv:Math.max(1,Math.round(lhH/CH)),
          mat: srnd()<0.5?'osb':'osb2', tint:[t0c*warm, t0c*sr(0.97,1.01), t0c*sr(0.9,1.0)],
          colDepth: TH/2+SHEET, hp: 100, kind:'wall'});
      }
    }
  }
  WALLS.push({x1,z1,x2,z2,y0,h, ops, len, ang, nx, nz, sheath:opt.sheath||'both'});
}
/** Остекление окна: рама + разрушаемое стекло. */
function windowGlass(c, ang, w, h){
  const g = new THREE.PlaneGeometry(w-0.04, h-0.04);
  const m = new THREE.Mesh(g, M.glass);
  m.position.copy(c); m.rotation.y = ang + Math.PI/2;
  m.userData.glass = {w:w-0.04, h:h-0.04}; m.userData.nomerge = true;
  scene.add(m);
  registerGlass(m, {hp:1, playerCollide:true});
}

/* ============================================================================
   ПЕРЕКРЫТИЕ: лаги (разрушаемый брус) + черновой пол из листов-кусков.
   Лаги опираются на стены по линиям z = ±9.5, ±1.3/±3.5.
============================================================================ */
function floorRect(x0,z0,x1,z1){
  // лаги вдоль z с шагом 0.61
  const yT = H1 + JOIST/2 + 0.001;
  for(let x = x0+0.1; x <= x1-0.05; x += STEP){
    createBeam({a:new THREE.Vector3(x, yT, z0+0.02), b:new THREE.Vector3(x, yT, z1-0.02), sx:0.045, sy:JOIST,
                side:new THREE.Vector3(1,0,0), hp:340, mat:'wood', tint:[0.95,0.92,0.86]});
  }
  // обвязочные балки по краям
  for(const x of [x0+0.025, x1-0.025])
    addBox('wood', x, yT, (z0+z1)/2, 0.045, JOIST, z1-z0, {collide:false, d:.9, grain:true});
  // черновой пол листами 1.22 (x) x 2.44 (z)
  const CH = Q.tex >= 0.75 ? 0.41 : 0.61;
  const U = new THREE.Vector3(1,0,0), Vv = new THREE.Vector3(0,0,-1);
  const cols = Math.max(1, Math.ceil((x1-x0)/1.22 - 0.05)), rows = Math.max(1, Math.ceil((z1-z0)/2.44 - 0.05));
  const cw = (x1-x0)/cols, rh = (z1-z0)/rows;
  for(let i=0;i<cols;i++) for(let j=0;j<rows;j++){
    const w = cw-0.003, h = rh-0.003;
    const c = new THREE.Vector3(x0 + (i+0.5)*cw, F2 - SUBF/2, z0 + (j+0.5)*rh);
    const tt = sr(0.8, 0.92);
    createSheet({c, U, V:Vv, w, h, t:SUBF, nu:Math.max(1,Math.round(w/CH)), nv:Math.max(1,Math.round(h/CH)),
      mat:'osb2', tint:[tt, tt*0.98, tt*0.93], colDepth:0.06, hp:140, kind:'floor', uvd:0.82});
  }
}
function floorWithHoles(x0,z0,x1,z1, holes){
  let rects=[[x0,z0,x1,z1]];
  for(const [hx0,hz0,hx1,hz1] of holes){
    const next=[];
    for(const [ax0,az0,ax1,az1] of rects){
      const ox0=Math.max(ax0,hx0), oz0=Math.max(az0,hz0), ox1=Math.min(ax1,hx1), oz1=Math.min(az1,hz1);
      if(ox0>=ox1||oz0>=oz1){ next.push([ax0,az0,ax1,az1]); continue; }
      if(az0<oz0) next.push([ax0,az0,ax1,oz0]);
      if(oz1<az1) next.push([ax0,oz1,ax1,az1]);
      if(ax0<ox0) next.push([ax0,oz0,ox0,oz1]);
      if(ox1<ax1) next.push([ox1,oz0,ax1,oz1]);
    }
    rects=next;
  }
  for(const [a,b,c,d] of rects) if(c-a > 0.2 && d-b > 0.2) floorRect(a,b,c,d);
}

/* ============================================================================
   ПЕРИЛА И ОГРАЖДЕНИЯ
============================================================================ */
/** Деревянное ограждение: стойки, поручень, средняя перекладина + коллайдер-стенка. */
function woodRail(x1,z1,x2,z2, y, h=1.05, opt={}){
  const len=Math.hypot(x2-x1,z2-z1); if(len<0.1) return;
  const ux=(x2-x1)/len, uz=(z2-z1)/len;
  const n=Math.max(1,Math.round(len/1.2));
  for(let i=0;i<=n;i++){
    const t=i*len/n;
    createBeam({a:new THREE.Vector3(x1+ux*t, y, z1+uz*t), b:new THREE.Vector3(x1+ux*t, y+h, z1+uz*t), sx:0.07, sy:0.07, hp:160, collide:false});
  }
  for(const [yy,sz] of [[y+h-0.03,0.07],[y+h*0.5,0.045]])
    createBeam({a:new THREE.Vector3(x1,yy,z1), b:new THREE.Vector3(x2,yy,z2), sx:sz, sy:0.035, hp:90, collide:false, noPlayer:true});
  // игрок упирается в перила, пули и обломки проходят
  addOBB((x1+x2)/2, y+h/2, (z1+z2)/2, Math.abs(ux)>0.5?len:0.1, h, Math.abs(ux)>0.5?0.1:len, null, 'wood', {playerOnly:true});
}
/** Стальное ограждение площадок и мостков. */
function steelRail(x1,z1,x2,z2, y, h=1.08){
  const len=Math.hypot(x2-x1,z2-z1); if(len<0.1) return;
  const ux=(x2-x1)/len, uz=(z2-z1)/len;
  const n=Math.max(1,Math.round(len/1.3));
  for(let i=0;i<=n;i++){ const t=i*len/n;
    addBox('steel', x1+ux*t, y+h/2, z1+uz*t, 0.045, h, 0.045, {collide:false, d:1}); }
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for(const yy of [y+h-0.02, y+h*0.52]){
    beamBetween('steel', A.set(x1,yy,z1), B.set(x2,yy,z2), 0.042, 0.042, {d:1});
  }
  beamBetween('steel', A.set(x1,y+0.06,z1), B.set(x2,y+0.06,z2), 0.012, 0.11, {d:1});
  addOBB((x1+x2)/2, y+h/2, (z1+z2)/2, Math.abs(ux)>0.5?len:0.08, h, Math.abs(ux)>0.5?0.08:len, null, 'metal', {playerOnly:true});
}

/* ============================================================================
   ВНУТРЕННЯЯ ДЕРЕВЯННАЯ ЛЕСТНИЦА
   Косоуры — выпиленные «гребёнкой» доски 2x12, проступи с выносом, подступенки
   из OSB, поручень на стойках с открытой стороны и на кронштейнах у стены.
   Коллайдер — наклонная плита по носкам ступеней: персонаж идёт плавно, а
   под высокой частью марша остаётся свободный проход.
============================================================================ */
function woodStairs(x0, x1, zBot, dir, y0, y1, run, wallSide){
  const rise = y1 - y0, n = Math.max(12, Math.round(rise/0.183)), r = rise/n, tr = run/n;
  const width = x1 - x0, xc = (x0+x1)/2;
  const Z = s => zBot + dir*s;
  // ступени
  for(let i=0;i<n;i++){
    const s0 = i*tr, yTop = y0 + r*(i+1);
    const zc = Z(s0 + tr/2) ;
    addBox('wood', xc, yTop-0.016, zc - dir*0.012, width-0.02, 0.032, tr+0.03, {collide:false, d:1.1, grain:true, tint:[0.7,0.6,0.48]});
    // подступенок
    addBox('osb2', xc, yTop - r/2 - 0.016, Z(s0) + dir*0.006, width-0.08, r-0.03, 0.012, {collide:false, d:.8});
  }
  // косоуры: пилёный профиль
  for(const x of [x0+0.022, x1-0.022]){
    const sh = new THREE.Shape();
    const depth = 0.29;
    sh.moveTo(0, 0);
    for(let i=0;i<n;i++){ sh.lineTo(i*tr, (i+1)*r - 0.032); sh.lineTo((i+1)*tr, (i+1)*r - 0.032); }
    const L = Math.hypot(run, rise), cs = run/L, sn = rise/L;
    sh.lineTo(run, rise - 0.032 - depth/cs*0.9);
    sh.lineTo(depth*sn*0.9, 0);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, {depth:0.038, bevelEnabled:false});
    // профиль рисуется в плоскости (s, y); переводим в мир: s → z по направлению марша
    g.translate(0,0,-0.019);
    const m = new THREE.Matrix4();
    m.makeBasis(new THREE.Vector3(0,0,dir), new THREE.Vector3(0,1,0), new THREE.Vector3(dir,0,0).negate());
    g.applyMatrix4(m);
    g.translate(x, y0, zBot);
    const uv = g.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*0.9, uv.getY(i)*0.9);
    tintGeo(g, 0.62, 0.53, 0.43);
    bucket('wood').push(g);
  }
  // коллайдер: наклонная плита по носкам
  const L = Math.hypot(run, rise), ang = Math.atan2(rise, run);
  const thick = 0.12;
  const mid = new THREE.Vector3(xc, y0 + rise/2 - thick/2*Math.cos(ang), zBot + dir*(run/2) + dir*thick/2*Math.sin(ang));
  mid.z -= dir*tr/2;                 // плита проходит через середины проступей
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(dir>0 ? -ang : ang, 0, 0));
  addOBB(mid.x, mid.y, mid.z, width, thick, L, q, 'wood');
  // короткая площадка схода внизу, чтобы носок первой ступени не цеплял капсулу
  // ограждение открытой стороны марша и поручень у стены
  const open = wallSide < 0 ? x1 : x0, wallX = wallSide < 0 ? x0+0.06 : x1-0.06;
  const posts = 3;
  for(let i=0;i<=posts;i++){
    const s = i*run/posts, yb = y0 + rise*(s/run) + (i===0?0:0);
    createBeam({a:new THREE.Vector3(open, yb, Z(s)), b:new THREE.Vector3(open, yb+1.0+(i===0?0.15:0), Z(s)), sx:0.07, sy:0.07, hp:150, collide:false});
  }
  const hr0 = new THREE.Vector3(open, y0+0.95, Z(0)), hr1 = new THREE.Vector3(open, y1+0.95, Z(run));
  beamBetween('wood', hr0, hr1, 0.06, 0.045, {d:1, tint:[0.55,0.45,0.35]});
  beamBetween('wood', hr0.clone().setY(y0+0.5), hr1.clone().setY(y1+0.5), 0.04, 0.03, {d:1});
  beamBetween('dark', new THREE.Vector3(wallX, y0+0.9, Z(0.2)), new THREE.Vector3(wallX, y1+0.9, Z(run-0.2)), 0.04, 0.04, {d:1});
  for(let i=0;i<4;i++){ const s = 0.4 + i*(run-0.8)/3;
    addBox('dark', wallX + (wallSide<0?-0.03:0.03), y0 + rise*(s/run) + 0.85, Z(s), 0.07, 0.03, 0.03, {collide:false}); }
  // стенка-ограждение марша для персонажа (по наклону)
  const q2 = q.clone();
  addOBB(open, mid.y + 0.55, mid.z, 0.08, 1.0, L, q2, 'wood', {playerOnly:true});
}

/* ============================================================================
   НАРУЖНАЯ СТАЛЬНАЯ ЛЕСТНИЦА: швеллерные косоуры, решётчатые ступени с
   уголком-носком, площадка на стойках с раскосами, перила с бортовой доской.
============================================================================ */
function steelStair(xc, zFace, out, y1){
  // out: +1 — фасад смотрит в +z (юг), -1 — в -z (север)
  const W = 1.2, n = Math.round(y1/0.19), r = y1/n, tr = RUN_OUT/n;
  const zP0 = zFace + out*0.09, zP1 = zFace + out*(0.09+PLAT_D);   // площадка
  const x0 = xc - PLAT_W/2, x1 = xc + PLAT_W/2;
  // площадка: решётчатый настил в обвязке
  const pzc = (zP0+zP1)/2;
  addBox('grating', xc, y1-0.02, pzc, PLAT_W, 0.04, PLAT_D, {collide:false, d:1.4});
  addOBB(xc, y1-0.06, pzc, PLAT_W, 0.12, PLAT_D, null, 'metal');
  for(const zz of [zP0+out*0.04, zP1-out*0.04]) addBox('steel', xc, y1-0.12, zz, PLAT_W, 0.18, 0.08, {collide:false, d:1});
  for(const xx of [x0+0.04, x1-0.04]) addBox('steel', xx, y1-0.12, pzc, 0.08, 0.18, PLAT_D, {collide:false, d:1});
  // стойки площадки (у фасада и снаружи) с раскосами
  for(const xx of [x0+0.06, x1-0.06]) for(const zz of [zP0+out*0.06, zP1-out*0.06]){
    addBox('steel', xx, (y1-0.2)/2, zz, 0.1, y1-0.2, 0.1, {d:1.1});
    addBox('dark', xx, 0.02, zz, 0.26, 0.04, 0.26, {collide:false});
  }
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for(const zz of [zP0+out*0.06, zP1-out*0.06]){
    beamBetween('steel', A.set(x0+0.06, 0.3, zz), B.set(x1-0.06, y1-0.35, zz), 0.05, 0.05, {d:1});
  }
  // марш: выход на площадку с её наружного края, спуск от фасада
  const zS0 = zP1, zS1 = zP1 + out*RUN_OUT;
  const sx0 = xc - W/2, sx1 = xc + W/2;
  for(let i=0;i<n-1;i++){
    const yTop = y1 - r*(i+1);
    const zc = zS0 + out*(tr*(i+0.5) + tr*0.5);
    addBox('grating', xc, yTop-0.018, zc, W-0.06, 0.036, tr+0.02, {collide:false, d:1.6});
    addBox('steel', xc, yTop-0.03, zc - out*(tr/2), W-0.06, 0.06, 0.035, {collide:false, d:1});      // уголок-носок
  }
  const L = Math.hypot(RUN_OUT, y1), ang = Math.atan2(y1, RUN_OUT);
  // косоуры-швеллеры
  for(const x of [sx0-0.03, sx1+0.03]){
    const a = new THREE.Vector3(x, y1-0.12, zS0), b = new THREE.Vector3(x, -0.05, zS1);
    beamBetween('steel', a, b, 0.05, 0.22, {d:1.2});
    beamBetween('dark', a.clone().setY(a.y+0.1).setX(x + (x<xc?-0.03:0.03)), b.clone().setY(b.y+0.1).setX(x + (x<xc?-0.03:0.03)), 0.06, 0.02, {d:1});
    beamBetween('dark', a.clone().setY(a.y-0.1).setX(x + (x<xc?-0.03:0.03)), b.clone().setY(b.y-0.1).setX(x + (x<xc?-0.03:0.03)), 0.06, 0.02, {d:1});
    addBox('dark', x, 0.03, zS1 - out*0.1, 0.2, 0.06, 0.3, {collide:false});
  }
  // коллайдер марша — наклонная плита
  const thick = 0.12;
  const mid = new THREE.Vector3(xc, y1/2 - thick/2*Math.cos(ang), (zS0+zS1)/2 - out*thick/2*Math.sin(ang));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(out>0 ? ang : -ang, 0, 0));
  addOBB(mid.x, mid.y, mid.z, W, thick, L, q, 'metal');
  // перила марша (стойки по наклону + поручень) и стенка-ограничитель
  for(const x of [sx0-0.02, sx1+0.02]){
    for(let i=0;i<=4;i++){ const s = i*RUN_OUT/4, yb = y1 - y1*(s/RUN_OUT);
      addBox('steel', x, yb+0.52, zS0 + out*s, 0.045, 1.04, 0.045, {collide:false, d:1}); }
    beamBetween('steel', A.set(x, y1+1.02, zS0), B.set(x, 1.02, zS1), 0.045, 0.045, {d:1});
    beamBetween('steel', A.set(x, y1+0.52, zS0), B.set(x, 0.52, zS1), 0.035, 0.035, {d:1});
    addOBB(x, mid.y+0.6, mid.z, 0.08, 1.1, L, q, 'metal', {playerOnly:true});
  }
  // ограждение площадки: боковые стороны и наружная часть мимо марша
  steelRail(x0, zP0, x0, zP1, y1); steelRail(x1, zP0, x1, zP1, y1);
  steelRail(x0, zP1, sx0-0.02, zP1, y1); steelRail(sx1+0.02, zP1, x1, zP1, y1);
  // промежуточная опора марша
  const zm = zS0 + out*RUN_OUT*0.55;
  addBox('steel', xc, (y1*0.45-0.2)/2, zm, 0.1, y1*0.45-0.2, 0.1, {d:1.1});
  addBox('steel', xc, y1*0.45-0.22, zm, W+0.1, 0.08, 0.08, {collide:false});
}

/* ============================================================================
   ПЛАНИРОВКА
============================================================================ */
function buildHouse(){
  const y2 = F2;
  // Фундаментная плита чуть выше пола ангара — читается граница здания
  addBox('conc', 0, 0.02, 0, BX1-BX0+0.5, 0.04, BZ1-BZ0+0.5, {collide:false, d:.4});

  /* ---------- 1 ЭТАЖ ---------- */
  // наружные стены (стены строятся от меньшей координаты к большей)
  const along = (x)=> x - BX0, alongZ = (z)=> z - BZ0;
  buildWall(BX0,BZ0, BX1,BZ0, 0,H1, {outSide:1, openings:[
    Wn(along(-14)), D(along(-12.1)), Wn(along(-9)), D(along(-5.6)), Wn(along(-2.2)),
    D(along(1.2)), Wn(along(5.6), 1.2, true), D(along(8.0)), Wn(along(11.4)), Wn(along(13.9))]});
  buildWall(BX0,BZ1, BX1,BZ1, 0,H1, {outSide:-1, openings:[
    Wn(along(-13.9)), Wn(along(-11.4)), D(along(-8)), Wn(along(-5.6), 1.2, true), D(along(-1.2)),
    Wn(along(2.2)), D(along(5.6)), Wn(along(9.0)), D(along(12.1)), Wn(along(14.0))]});
  buildWall(BX0,BZ0, BX0,BZ1, 0,H1, {outSide:1, openings:[Wn(alongZ(-8.4),1.0), Wn(alongZ(3.0)), D(alongZ(6.2))]});
  buildWall(BX1,BZ0, BX1,BZ1, 0,H1, {outSide:-1, openings:[D(alongZ(-6.2)), Wn(alongZ(-3)), Wn(alongZ(8.4),1.0)]});
  // коридоры крыльев
  buildWall(BX0,-CZ, ATR.x0,-CZ, 0,H1, {openings:[D(along(-11.3)), D(along(-7.1)), Wn(along(-5.6),0.9)]});
  buildWall(BX0, CZ, ATR.x0, CZ, 0,H1, {openings:[D(along(-12.4)), Wl(along(-9),1.6), D(along(-7.1))]});
  buildWall(ATR.x1,-CZ, BX1,-CZ, 0,H1, {openings:[D(along(7.1)-ATR.x1+BX0), Wl(along(9.0)-ATR.x1+BX0,1.6), D(along(12.4)-ATR.x1+BX0)]});
  buildWall(ATR.x1, CZ, BX1, CZ, 0,H1, {openings:[Wn(along(5.6)-ATR.x1+BX0,0.9), D(along(7.1)-ATR.x1+BX0), D(along(11.3)-ATR.x1+BX0)]});
  // перегородки между комнатами крыльев
  buildWall(-PX,BZ0, -PX,-CZ, 0,H1, {openings:[D(3.0), Wn(6.4)]});
  buildWall(-PX, CZ, -PX,BZ1, 0,H1, {openings:[Wn(1.8), D(5.2)]});
  buildWall( PX,BZ0,  PX,-CZ, 0,H1, {openings:[D(3.0), Wn(6.4)]});
  buildWall( PX, CZ,  PX,BZ1, 0,H1, {openings:[Wn(1.8), D(5.2)]});
  // коридоры перегорожены дверями «в разбежку»: двери соседних перегородок
  // смещены к противоположным стенам, и вдоль коридора не пролетает ни одна пуля
  const DC = 1.05;
  for(const y of [0, y2]){
    const h = y ? H2 : H1;
    buildWall(-PX,-CZ, -PX,CZ, y,h, {openings:[D(2.0, DC)]});           // дверь у южной стены
    buildWall( PX,-CZ,  PX,CZ, y,h, {openings:[D(0.6, DC)]});           // у северной
    buildWall(ATR.x0,-CZ, ATR.x0,CZ, y,h, {openings:[D(y ? 1.0 : 0.6, DC)]});  // на 2 этаже — к мостику
    buildWall(ATR.x1,-CZ, ATR.x1,CZ, y,h, {openings:[D(y ? 1.6 : 2.0, DC)]});
  }
  // стены атриума и центральных залов
  buildWall(ATR.x0,BZ0, ATR.x0,-CZ, 0,H1, {openings:[D(3.0), Wn(6.9, 1.0)]});
  buildWall(ATR.x0, CZ, ATR.x0,BZ1, 0,H1, {openings:[D(3.4), Wn(6.8, 1.0)]});
  buildWall(ATR.x1,BZ0, ATR.x1,-CZ, 0,H1, {openings:[Wn(1.4, 1.0), D(4.8)]});
  buildWall(ATR.x1, CZ, ATR.x1,BZ1, 0,H1, {openings:[Wn(1.3, 1.0), D(5.2)]});
  buildWall(ATR.x0,ATR.z0, ATR.x1,ATR.z0, 0,H1, {openings:[D(3.4), Wl(7.6, 1.6)]});
  buildWall(ATR.x0,ATR.z1, ATR.x1,ATR.z1, 0,H1, {openings:[Wl(1.4, 1.6), D(5.6)]});
  buildWall(0,BZ0, 0,ATR.z0, 0,H1, {openings:[D(1.5)]});
  buildWall(0,ATR.z1, 0,BZ1, 0,H1, {openings:[D(4.5)]});

  /* ---------- ПЕРЕКРЫТИЕ ---------- */
  const holes = [[ATR.x0, ATR.z0, ATR.x1, ATR.z1]];
  for(const s of STAIRS_IN){
    const zTop = s.zBot + s.dir*RUN_IN;
    holes.push([s.x0-0.1, Math.min(s.zBot, zTop)-0.05, s.x1+0.3, Math.max(s.zBot, zTop)+0.05]);
  }
  // лаги опираются на стены: делим перекрытие по линиям несущих стен
  const bands = [[BZ0,-CZ],[-CZ,CZ],[CZ,BZ1]];
  for(const [za,zb] of bands){
    floorWithHoles(BX0+0.07, za+0.07, ATR.x0, zb-0.07, holes);
    floorWithHoles(ATR.x1, za+0.07, BX1-0.07, zb-0.07, holes);
  }
  floorWithHoles(ATR.x0, BZ0+0.07, ATR.x1, ATR.z0, holes);
  floorWithHoles(ATR.x0, ATR.z1, ATR.x1, BZ1-0.07, holes);

  /* ---------- ЛЕСТНИЦЫ ---------- */
  for(const s of STAIRS_IN){
    woodStairs(s.x0, s.x1, s.zBot, s.dir, 0, y2, RUN_IN, s.x0 < 0 ? -1 : 1);
    // ограждение проёма на 2 этаже (открытая сторона вдоль марша и торец у низа)
    const zTop = s.zBot + s.dir*RUN_IN;
    const openX = s.x0 < 0 ? s.x1+0.3 : s.x0-0.3;
    woodRail(openX, s.zBot - s.dir*0.05, openX, zTop, y2);
    woodRail(s.x0 < 0 ? BX0+0.1 : openX, s.zBot - s.dir*0.05, s.x0 < 0 ? openX : BX1-0.1, s.zBot - s.dir*0.05, y2);
  }

  /* ---------- 2 ЭТАЖ ---------- */
  buildWall(BX0,BZ0, BX1,BZ0, y2,H2, {outSide:1, openings:[
    Wn(along(-13.2),1.2,true), Wn(along(-10.4)), D(along(-7.2)), Wn(along(-2.2),1.4,true),
    Wn(along(2.2)), Wn(along(7.2),1.2,true), Wn(along(10.4)), Wn(along(13.2))]});
  buildWall(BX0,BZ1, BX1,BZ1, y2,H2, {outSide:-1, openings:[
    Wn(along(-13.2)), Wn(along(-10.4)), Wn(along(-7.2),1.2,true), Wn(along(-2.2)),
    Wn(along(2.2),1.4,true), D(along(7.2)), Wn(along(10.4)), Wn(along(13.2),1.2,true)]});
  buildWall(BX0,BZ0, BX0,BZ1, y2,H2, {outSide:1, openings:[Wn(alongZ(-8.2),1.0,true), Wn(alongZ(3.2)), Wn(alongZ(6.4),1.2,true)]});
  buildWall(BX1,BZ0, BX1,BZ1, y2,H2, {outSide:-1, openings:[Wn(alongZ(-6.4),1.2,true), Wn(alongZ(-3.2)), Wn(alongZ(8.2),1.0,true)]});
  buildWall(BX0,-CZ, ATR.x0,-CZ, y2,H2, {openings:[D(along(-11)), D(along(-7.1))]});
  buildWall(BX0, CZ, ATR.x0, CZ, y2,H2, {openings:[D(along(-12.4)), Wn(along(-9.6)), D(along(-7.1))]});
  buildWall(ATR.x1,-CZ, BX1,-CZ, y2,H2, {openings:[D(along(7.1)-ATR.x1+BX0), Wn(along(9.6)-ATR.x1+BX0), D(along(12.4)-ATR.x1+BX0)]});
  buildWall(ATR.x1, CZ, BX1, CZ, y2,H2, {openings:[D(along(7.1)-ATR.x1+BX0), D(along(11.0)-ATR.x1+BX0)]});
  buildWall(-PX,BZ0, -PX,-CZ, y2,H2, {openings:[D(1.4), Wl(5.0,1.6)]});
  buildWall(-PX, CZ, -PX,BZ1, y2,H2, {openings:[D(2.6), Wn(6.2)]});
  buildWall( PX,BZ0,  PX,-CZ, y2,H2, {openings:[Wn(2.0), D(5.6)]});
  buildWall( PX, CZ,  PX,BZ1, y2,H2, {openings:[Wl(3.2,1.6), D(6.8)]});
  buildWall(ATR.x0,BZ0, ATR.x0,ATR.z0, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x0,ATR.z1, ATR.x0,BZ1, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x1,BZ0, ATR.x1,ATR.z0, y2,H2, {openings:[D(3.0)]});
  buildWall(ATR.x1,ATR.z1, ATR.x1,BZ1, y2,H2, {openings:[D(3.0)]});
  // залы над атриумом смотрят в него широкими проёмами
  buildWall(ATR.x0,ATR.z0, ATR.x1,ATR.z0, y2,H2, {openings:[Wl(1.6,1.8), D(4.5), Wl(7.4,1.8)]});
  buildWall(ATR.x0,ATR.z1, ATR.x1,ATR.z1, y2,H2, {openings:[Wl(3.1,1.2), D(4.5), Wl(5.9,1.2)]});
  buildWall(0,BZ0, 0,ATR.z0, y2,H2, {openings:[D(1.5)]});
  buildWall(0,ATR.z1, 0,BZ1, y2,H2, {openings:[D(4.5)]});
  // ограждение атриума вдоль торцов коридоров (балконы) и мостик через атриум
  woodRail(ATR.x0-0.02, ATR.z0+0.1, ATR.x0-0.02, -CZ-0.1, y2); woodRail(ATR.x0-0.02, CZ+0.1, ATR.x0-0.02, ATR.z1-0.1, y2);
  woodRail(ATR.x1+0.02, ATR.z0+0.1, ATR.x1+0.02, -CZ-0.1, y2); woodRail(ATR.x1+0.02, CZ+0.1, ATR.x1+0.02, ATR.z1-0.1, y2);
  catwalk(ATR.x0, ATR.x1, y2);
  // открытые ригели кровли над крыльями: полосы света и тени по комнатам
  for(let x = BX0+0.6; x < BX1-0.3; x += 1.22){
    if(x > ATR.x0-0.3 && x < ATR.x1+0.3) continue;
    addBox('wood', x, y2+H2+0.12, 0, 0.045, 0.24, BZ1-BZ0, {collide:false, d:.9, grain:true, tint:[0.9,0.86,0.78]});
  }

  /* ---------- НАРУЖНЫЕ ЛЕСТНИЦЫ ---------- */
  for(const s of STAIRS_OUT){
    const out = s.side==='n' ? -1 : 1;
    steelStair(s.x, s.side==='n' ? BZ0 : BZ1, out, y2);
    exitSign(s.x, y2+2.4, (s.side==='n'?BZ0:BZ1) + out*0.1, s.side==='n' ? Math.PI : 0);
  }
  for(const d of DOORS){
    if(d.y > 1) continue;
    if(Math.abs(Math.abs(d.z) - BZ1) < 0.01) exitSign(d.x, 2.35, d.z + Math.sign(d.z)*0.1, d.z < 0 ? Math.PI : 0);
    if(Math.abs(Math.abs(d.x) - BX1) < 0.01) exitSign(d.x + Math.sign(d.x)*0.1, 2.35, d.z, d.x < 0 ? -Math.PI/2 : Math.PI/2);
  }
  buildInteriorLamps();
}
/** Мостик через атриум: решётка на двутаврах, стальное ограждение. */
function catwalk(x0, x1, y){
  const w = 1.5;
  addBox('grating', 0, y-0.02, 0, x1-x0, 0.04, w, {collide:false, d:1.4});
  addOBB(0, y-0.06, 0, x1-x0, 0.12, w, null, 'metal');
  for(const z of [-w/2+0.05, w/2-0.05]) addBox('steel', 0, y-0.16, z, x1-x0, 0.26, 0.09, {collide:false, d:1});
  steelRail(x0, -w/2, x1, -w/2, y); steelRail(x0, w/2, x1, w/2, y);
  // подвесы к ригелям: мостик не висит в воздухе
  for(const x of [-2.2, 2.2]) for(const z of [-w/2, w/2]) addBox('steel', x, y+(H2)/2+0.1, z, 0.03, H2, 0.03, {collide:false});
  // двутавры над атриумом, на которых висит мостик, опираются на стены залов
  for(const x of [-2.2, 2.2]){
    addBox('steel', x, y+H2+0.12, 0, 0.12, 0.24, ATR.z1-ATR.z0+0.3, {collide:false, d:1});
    addBox('steel', x, y+H2+0.12, 0, 0.02, 0.2, ATR.z1-ATR.z0+0.3, {collide:false, d:1});
  }
}
/** Переносные лампы под потолком комнат: лампа на проводе + свет из общего пула. */
const INTERIOR = [];
let LAMP_INST = null;               // провод, абажур, лампочка: по одной инстанс-отрисовке на все лампы
function buildInteriorLamps(){
  const bulbMat = new THREE.MeshStandardMaterial({color:0xfff1d6, emissive:0xffd9a0, emissiveIntensity:1.3});
  const spots = [
    [-11.2,-6.2,0], [-7.1,-5.4,0], [-12.4,5.4,0], [-7.1,5.4,0], [-12.4,0,0], [12.4,0,0], [-7.1,0,0], [7.1,0,0],
    [11.2,6.2,0], [7.1,5.4,0], [12.4,-5.4,0], [7.1,-5.4,0], [-2.2,-6.5,0], [2.2,6.5,0], [2.2,-6.5,0], [-2.2,6.5,0],
    [-12,-5,1], [-7.1,-5.4,1], [-12.2,5.5,1], [-7.1,5.4,1], [12.0,5.0,1], [7.1,5.4,1], [12.2,-5.5,1], [7.1,-5.4,1],
    [-2.2,-6.4,1], [2.2,6.4,1], [2.4,-6.4,1], [-2.4,6.4,1], [-12.4,0,1], [12.4,0,1], [-7.1,0,1], [7.1,0,1], [0,2.4,1], [0,-2.4,1]
  ];
  const cordG = new THREE.CylinderGeometry(0.006,0.006, 1, 4);
  const shadeG = new THREE.ConeGeometry(0.16, 0.14, 14, 1, true);
  const bulbG = new THREE.SphereGeometry(0.045, 10, 8);
  const mk = (g, m)=>{ const im = new THREE.InstancedMesh(g, m, spots.length); im.userData.nomerge = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; scene.add(im); return im; };
  LAMP_INST = { cord: mk(cordG, M.cable), shade: mk(shadeG, cmat(0x3a3c3a,{roughness:.6, metalness:.5, side:THREE.DoubleSide})),
    bulb: mk(bulbG, bulbMat), o: new THREE.Object3D() };
  for(const [x,z,fl] of spots){
    const top = fl ? F2 + H2 + 0.05 : H1;
    const y = top - (fl ? 1.1 : 0.55);
    INTERIOR.push({pos:new THREE.Vector3(x, y-0.1, z), top, ax:0, az:0, vx:0, vz:0, len: top-y, x, z, alive:true, i:INTERIOR.length});
  }
  updateLamps(0, 0);
}

// Реквизит, техника, вертолётная площадка, модульные укрытия (статичная часть).
/** Реквизит ставится вручную с явной отметкой опоры. */
function snapSupport(x, z, y){ return y; }
let HELI_HOOK = ()=>{};
function setHeliHook(f){ HELI_HOOK = f; }
function meshAt(geo, mat, x,y,z, opt={}){
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x,y,z);
  if(opt.rotY) m.rotation.y = opt.rotY;
  if(opt.rotX) m.rotation.x = opt.rotX;
  if(opt.rotZ) m.rotation.z = opt.rotZ;
  m.castShadow = opt.cast !== false; m.receiveShadow = true;
  scene.add(m);  return m;
}
/* --- бочка 200 л с рёбрами --- */
const barrelGeoCache = {};
function barrel(x,y,z,col,tipped){
  y = snapSupport(x,z,y); if(y === null) return;
  const key = 'b'; 
  if(!barrelGeoCache[key]){
    const parts = [];
    const body = new THREE.CylinderGeometry(0.295,0.295,0.88,20,1);
    parts.push(body);
    for(const yy of [-0.22,0.0,0.22]){
      const r = new THREE.TorusGeometry(0.30,0.022,6,20); r.rotateX(Math.PI/2); r.translate(0,yy,0);
      parts.push(r);
    }
    const lid = new THREE.CylinderGeometry(0.30,0.30,0.035,20); lid.translate(0,0.45,0);
    parts.push(lid);
    barrelGeoCache[key] = BGU.mergeGeometries(parts,false);
  }
  const mat = col==='green' ? M.paintG : col==='blue' ? M.plastB : col==='orange' ? M.plastO : M.steel;
  const m = meshAt(barrelGeoCache[key], mat, x, y+(tipped?0.30:0.44), z, {rotY:sr(0,6.28)});
  if(tipped){ m.rotation.z = Math.PI/2; m.rotation.y = sr(0,6.28);
    COLLIDERS.push({x0:x-0.46,y0:y,z0:z-0.46,x1:x+0.46,y1:y+0.6,z1:z+0.46}); }
  else COLLIDERS.push({x0:x-0.31,y0:y,z0:z-0.31,x1:x+0.31,y1:y+0.9,z1:z+0.31});
  return m;
}
/* --- конус --- */
let coneGeo;
function cone(x,y,z){
  y = snapSupport(x,z,y); if(y === null) return;
  if(!coneGeo){
    const parts=[new THREE.ConeGeometry(0.175,0.55,14)];
    parts[0].translate(0,0.30,0);
    const b = new THREE.BoxGeometry(0.34,0.035,0.34); b.translate(0,0.018,0); parts.push(b);
    coneGeo = BGU.mergeGeometries(parts,false);
  }
  meshAt(coneGeo, M.plastO, x,y,z, {rotY:sr(0,6.28)});
  // светоотражающая полоса
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115,0.135,0.08,14),
    cmat(0xe8e4d8,{roughness:.5}));
  band.position.set(x,y+0.33,z); scene.add(band);
}
/* --- штабель бруса --- */
function lumberPile(x,y,z,rotY,len=3.4,rows=7){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<rows;i++)
    for(let j=0;j<3;j++)
      addBox('wood', x - Math.sin(rotY)*(-0.2+j*0.2), y+0.05+i*0.082, z - Math.cos(rotY)*(-0.2+j*0.2),
             len, 0.075, 0.17, {rotY, collide:false, d:1.2});
  addAABB(x, y+rows*0.082/2, z, len, rows*0.082+0.06, 0.66, rotY);
}
/* --- пачка листов OSB --- */
function osbStack(x,y,z,rotY,n=8){
  y = snapSupport(x,z,y); if(y === null) return;
  for(let i=0;i<n;i++)
    addBox(i%2?'osb':'osb2', x, y+0.02+i*0.0135, z, 2.5, 0.0125, 1.25, {rotY, collide:false, d:.85});
  addAABB(x, y+n*0.0135/2, z, 2.5, n*0.0135+0.05, 1.25, rotY);
}
/* --- строительные козлы --- */
function sawhorse(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('wood', x, y+0.74, z, 1.5, 0.09, 0.12, {rotY, d:1.1});
  for(const sx of [-0.6,0.6]) for(const sz of [-0.28,0.28]){
    const px = x + Math.cos(rotY)*sx - Math.sin(rotY)*sz;
    const pz = z - Math.sin(rotY)*sx - Math.cos(rotY)*sz;
    addBox('wood', px, y+0.37, pz, 0.07, 0.74, 0.07, {collide:false, d:1});
  }
}
/* --- бетонный блок / отбойник --- */
function jerseyBarrier(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('panel', x, y+0.18, z, 2.2, 0.36, 0.62, {rotY, d:.5});
  addBox('panel', x, y+0.62, z, 2.2, 0.55, 0.36, {rotY, d:.5});
}


/* ---------- Инструментальная тележка ---------- */
function toolCart(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const body = new THREE.Mesh(roundedBox(0.78,0.86,0.48,0.05,2), M.plastB);
  body.position.y = 0.62; G.add(body);
  // ящики: три выдвинутых на разную глубину
  for(let i=0;i<3;i++){
    const out = i===1 ? 0.14 : (i===2 ? 0.05 : 0);
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.21, 0.44+out*2), M.dark);
    dr.position.set(0, 0.34+i*0.26, out); G.add(dr);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.30,0.03,0.035), M.chrome);
    h.position.set(0, 0.34+i*0.26, 0.24+out); G.add(h);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.84,0.04,0.54), M.steel);
  top.position.y = 1.07; G.add(top);
  // инструмент на крышке
  const wr = new THREE.Mesh(new THREE.BoxGeometry(0.26,0.02,0.05), M.chrome);
  wr.position.set(0.14,1.10,-0.1); wr.rotation.y = 0.4; G.add(wr);
  const box2 = new THREE.Mesh(roundedBox(0.34,0.16,0.2,0.03,2), M.plastO);
  box2.position.set(-0.18,1.17,0.06); box2.rotation.y = -0.3; G.add(box2);
  for(const sx of [-0.3,0.3]) for(const sz of [-0.18,0.18]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.075,0.032,6,10), M.rubber);
    w.position.set(sx,0.08,sz); w.rotation.y = Math.PI/2; G.add(w);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G);  addAABB(x, y+0.55, z, 0.9, 1.1, 0.6, rotY);
}
/* ---------- Биотуалет на стройплощадке ---------- */
function siteToilet(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const shell = cmat(0x3f6b52,{roughness:.62, metalness:.04});
  addBox('panel', x, y+0.04, z, 1.24, 0.08, 1.24, {rotY, d:.5});
  const G = new THREE.Group();
  for(const [dx,dz,sx,sz] of [[0,-0.56,1.12,0.05],[0.58,0,0.05,1.12],
                              [-0.58,0,0.05,1.12]]){
    const w = new THREE.Mesh(new THREE.BoxGeometry(sx,2.24,sz), shell);
    w.position.set(dx,1.2,dz); G.add(w);
  }
  // дверь приоткрыта — внутрь видно
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.0,2.16,0.05), shell);
  door.position.set(0.28,1.16,0.52); door.rotation.y = -0.62; G.add(door);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.26,0.07,1.26),
    cmat(0x9aa19c,{roughness:.7}));
  roof.position.y = 2.36; G.add(roof);
  // вентиляционная труба
  const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.7,8), M.darker);
  vent.position.set(-0.44,2.7,-0.44); G.add(vent);
  G.position.set(x,y+0.08,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G);  addAABB(x, y+1.2, z, 1.24, 2.4, 1.24, rotY);
}
/* ---------- Барабан с кабелем на подставке ---------- */
function cableDrum(x,y,z){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  for(const s of [-1,1]){
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08,0.62,0.52), M.steel);
    leg.position.set(s*0.52,0.31,0); G.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.06,0.72), M.steel);
    foot.position.set(s*0.52,0.03,0); G.add(foot);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,1.16,8), M.chrome);
  axle.rotation.z = Math.PI/2; axle.position.y = 0.62; G.add(axle);
  for(const s of [-1,1]){
    const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.42,0.045,18), M.wood);
    cheek.rotation.z = Math.PI/2; cheek.position.set(s*0.22,0.62,0); G.add(cheek);
  }
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.33,0.33,0.38,16), M.cable);
  coil.rotation.z = Math.PI/2; coil.position.y = 0.62; G.add(coil);
  // свисающий конец кабеля
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0,0.95,0.0), new THREE.Vector3(0.5,0.42,0.3),
    new THREE.Vector3(1.1,0.04,0.55), new THREE.Vector3(1.9,0.03,0.3)]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve,14,0.024,5,false), M.cable);
  G.add(tail);
  G.position.set(x,y,z);
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G);  COLLIDERS.push({x0:x-0.6,y0:y,z0:z-0.45,x1:x+0.6,y1:y+1.05,z1:z+0.45});
}
/* ---------- Компрессор на колёсах ---------- */
function compressor(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.22,0.92,14),
    cmat(0x9c4a28,{roughness:.6, metalness:.3}));
  tank.rotation.z = Math.PI/2; tank.position.y = 0.3; G.add(tank);
  for(const s of [-1,1]){
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22,12,8), tank.material);
    cap.position.set(s*0.46,0.3,0); cap.scale.x = 0.55; G.add(cap);
  }
  const motor = new THREE.Mesh(roundedBox(0.4,0.3,0.3,0.05,2), M.dark);
  motor.position.set(-0.1,0.66,0); G.add(motor);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.12,0.24,10), M.steel);
  head.position.set(0.22,0.68,0); G.add(head);
  // ребристый радиатор и манометр
  for(let i=0;i<5;i++){
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.24,0.26), M.darker);
    fin.position.set(0.22-i*0.045,0.82,0); G.add(fin);
  }
  const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,0.02,10), M.chrome);
  gauge.rotation.x = Math.PI/2; gauge.position.set(0.34,0.56,0.08); G.add(gauge);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.6,7), M.steel);
  handle.rotation.z = 1.0; handle.position.set(-0.5,0.5,0); G.add(handle);
  for(const s of [-1,1]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.12,0.04,6,12), M.rubber);
    w.position.set(0.3,0.12,s*0.26); w.rotation.y = Math.PI/2; G.add(w);
  }
  // шланг кольцами на полу
  const hc = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.3,0.5,0.2), new THREE.Vector3(0.9,0.08,0.6),
    new THREE.Vector3(0.4,0.05,1.2), new THREE.Vector3(-0.3,0.05,0.8)], true);
  G.add(new THREE.Mesh(new THREE.TubeGeometry(hc,20,0.018,5,true), M.cable));
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G);  addAABB(x, y+0.45, z, 1.1, 0.9, 0.62, rotY);
}
/* ---------- Огнетушитель ---------- */
function extinguisher(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.083,0.083,0.42,12),
    cmat(0x8e3026,{roughness:.5,metalness:.25}));
  body.position.y = 0.24;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.083,10,6), body.material);
  top.position.y = 0.45; top.scale.y = 0.55;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.09,8), M.steel);
  valve.position.y = 0.53;
  g.add(body, top, valve);
  g.position.set(x,y,z); g.rotation.y = rotY;
  g.traverse(o=>o.castShadow=true); scene.add(g);}

/* ============================================================================
   ТЕХНИКА: машины и вертолёт
   Все машины — статичные укрытия, без интерактива. Геометрия собирается из
   скруглённых объёмов: кузов, остекление, колёсные арки, хром, оптика.
============================================================================ */
/** Скруглённая коробка: база любого кузовного объёма.
    Дешевле ExtrudeGeometry и даёт корректные нормали для бликов. */
function wheelGroup(R=0.36, W=0.24, spokes=5){
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R,R,W,22,1), M.rubber);
  tyre.rotation.z = Math.PI/2; g.add(tyre);
  // протектор: блоки по окружности
  const tread = [];
  for(let i=0;i<22;i++){
    const a = i/22*Math.PI*2;
    const b = new THREE.BoxGeometry(W*0.92, 0.035, R*0.17);
    b.translate(0, R-0.012, 0); b.rotateX(a);
    tread.push(b);
  }
  const tm = new THREE.Mesh(BGU.mergeGeometries(tread,false), M.rubber);
  tm.rotation.z = Math.PI/2; g.add(tm);
  // боковина: небольшой валик, иначе покрышка читается как труба
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.TorusGeometry(R*0.88, R*0.1, 6, 20), M.rubber);
    side.position.x = s*W*0.44; side.rotation.y = Math.PI/2; g.add(side);
  }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(R*0.66,R*0.66,W*0.5,18), M.chrome);
  disc.rotation.z = Math.PI/2; g.add(disc);
  for(let i=0;i<spokes;i++){
    const sp = new THREE.Mesh(new THREE.BoxGeometry(W*0.3, R*1.15, R*0.16), M.chrome);
    sp.rotation.x = i*Math.PI/spokes; g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(R*0.2,R*0.2,W*0.62,12), M.chrome);
  hub.rotation.z = Math.PI/2; g.add(hub);
  g.traverse(o=>{ o.castShadow=true; o.receiveShadow=true; });
  return g;
}
/** Фургон/микроавтобус: высокий кузов, сдвижная дверь, лестница сзади. */
function van(x,y,z,rotY, mat, opt={}){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L = opt.len ?? 5.2, W = opt.wid ?? 2.0, R = 0.37;
  const sill = 0.34, boxH = 1.72;

  const body = new THREE.Mesh(roundedBox(L*0.74, boxH, W, 0.16, 4), mat);
  body.position.set(-L*0.12, sill+boxH/2, 0); G.add(body);
  // капот-«морда»
  const nose = new THREE.Mesh(roundedBox(L*0.30, boxH*0.62, W*0.96, 0.22, 4), mat);
  nose.position.set(L*0.34, sill+boxH*0.34, 0); G.add(nose);
  // тёмная кабина за стеклом
  const cabIn = new THREE.Mesh(new THREE.BoxGeometry(L*0.2, boxH*0.42, W*0.86),
    cmat(0x17181b,{roughness:.95}));
  cabIn.position.set(L*0.16, sill+boxH*0.70, 0); G.add(cabIn);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(W*0.88, boxH*0.48), M.carGlass);
  wind.position.set(L*0.20, sill+boxH*0.72, 0);
  wind.rotation.set(0, Math.PI/2, 0); wind.rotateX(-0.24); G.add(wind);
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.PlaneGeometry(L*0.2, boxH*0.34), M.carGlass);
    side.position.set(L*0.10, sill+boxH*0.70, s*W*0.502);
    side.rotation.set(0, s>0 ? 0 : Math.PI, 0); G.add(side);
  }
  // гофры борта — жёсткость кузова
  for(const s of [-1,1]) for(let i=0;i<7;i++){
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.05, boxH*0.78, 0.03), mat);
    rib.position.set(-L*0.42 + i*L*0.10, sill+boxH*0.48, s*W*0.505); G.add(rib);
  }
  // задние створки со стеклом и ручками
  for(const s of [-1,1]){
    const dr = new THREE.Mesh(new THREE.BoxGeometry(0.05, boxH*0.92, W*0.46), mat);
    dr.position.set(-L*0.485, sill+boxH*0.5, s*W*0.245); G.add(dr);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(W*0.36, boxH*0.28), M.carGlass);
    gl.position.set(-L*0.512, sill+boxH*0.78, s*W*0.245);
    gl.rotation.y = -Math.PI/2; G.add(gl);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.05,0.3,0.04), M.chrome);
    hd.position.set(-L*0.515, sill+boxH*0.45, s*0.1); G.add(hd);
    const tl = new THREE.Mesh(roundedBox(0.06,0.34,0.16,0.04,2), M.lightRed);
    tl.position.set(-L*0.50, sill+0.30, s*W*0.42); G.add(tl);
    const hl = new THREE.Mesh(roundedBox(0.08,0.18,0.28,0.05,2), M.headlamp);
    hl.position.set(L*0.485, sill+0.46, s*W*0.34); G.add(hl);
  }
  const bump = new THREE.Mesh(roundedBox(0.16,0.26,W*0.99,0.07,3), M.darker);
  bump.position.set(L*0.49, sill+0.10, 0); G.add(bump);
  const bumpR = new THREE.Mesh(roundedBox(0.14,0.24,W*0.99,0.07,3), M.darker);
  bumpR.position.set(-L*0.50, sill+0.10, 0); G.add(bumpR);
  // лестница на крышу и багажник
  for(const s of [-1,1]){
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L*0.6,0.05,0.05), M.steel);
    rail.position.set(-L*0.12, sill+boxH+0.06, s*W*0.36); G.add(rail);
  }
  for(let i=0;i<6;i++){
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.04,0.04,0.4), M.steel);
    st.position.set(-L*0.52, sill+0.34+i*0.26, W*0.30); G.add(st);
  }
  for(const sx of [L*0.32, -L*0.28]) for(const sz of [-1,1]){
    const w = wheelGroup(R, 0.26, 6);
    w.position.set(sx, R, sz*(W/2-0.11)); G.add(w);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R*1.1, 0.06, 6, 14, Math.PI), M.darker);
    arch.position.set(sx, R, sz*(W/2-0.01)); arch.rotation.y = Math.PI/2; G.add(arch);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G);  addAABB(x, y+(sill+boxH)/2, z, L, sill+boxH, W, rotY);
  return G;
}
/** Пикап с кунгом-каркасом: длинная база, рама, кузовной борт. */
function pickup(x,y,z,rotY, mat){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L = 5.0, W = 1.94, R = 0.40, sill = 0.46, cabH = 1.12;

  const frame = new THREE.Mesh(new THREE.BoxGeometry(L*0.92, 0.16, W*0.72), M.darker);
  frame.position.y = sill-0.08; G.add(frame);
  const cab = new THREE.Mesh(roundedBox(L*0.36, cabH, W, 0.18, 4), mat);
  cab.position.set(L*0.10, sill+cabH/2, 0); G.add(cab);
  const nose = new THREE.Mesh(roundedBox(L*0.26, cabH*0.62, W*0.97, 0.16, 4), mat);
  nose.position.set(L*0.40, sill+cabH*0.30, 0); G.add(nose);
  // грузовой борт
  const bedH = 0.56;
  for(const s of [-1,1]){
    const sidew = new THREE.Mesh(roundedBox(L*0.44, bedH, 0.09, 0.04, 2), mat);
    sidew.position.set(-L*0.24, sill+bedH/2, s*(W/2-0.05)); G.add(sidew);
  }
  const tail = new THREE.Mesh(roundedBox(0.09, bedH, W*0.96, 0.04, 2), mat);
  tail.position.set(-L*0.455, sill+bedH/2, 0); G.add(tail);
  const bedFloor = new THREE.Mesh(new THREE.BoxGeometry(L*0.46, 0.06, W*0.9), M.darker);
  bedFloor.position.set(-L*0.24, sill+0.03, 0); G.add(bedFloor);
  // дуги кунга
  for(const px of [-L*0.08, -L*0.24, -L*0.40]){
    const arc = new THREE.Mesh(new THREE.TorusGeometry(W*0.42, 0.035, 6, 14, Math.PI), M.steel);
    arc.position.set(px, sill+bedH, 0); arc.rotation.y = Math.PI/2; G.add(arc);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(L*0.36,0.04,0.04), M.steel);
  rail.position.set(-L*0.24, sill+bedH+W*0.42, 0); G.add(rail);
  // остекление кабины
  const wY = sill+cabH*0.68;
  const cabIn = new THREE.Mesh(new THREE.BoxGeometry(L*0.34, cabH*0.5, W*0.86),
    cmat(0x17181b,{roughness:.95}));
  cabIn.position.set(L*0.10, wY-0.04, 0); G.add(cabIn);
  const wind = new THREE.Mesh(new THREE.PlaneGeometry(W*0.86, cabH*0.48), M.carGlass);
  wind.position.set(L*0.275, wY, 0);
  wind.rotation.set(0, Math.PI/2, 0); wind.rotateX(-0.28); G.add(wind);
  const rear = new THREE.Mesh(new THREE.PlaneGeometry(W*0.82, cabH*0.38), M.carGlass);
  rear.position.set(-L*0.072, wY, 0); rear.rotation.set(0, -Math.PI/2, 0); G.add(rear);
  for(const s of [-1,1]){
    const side = new THREE.Mesh(new THREE.PlaneGeometry(L*0.26, cabH*0.38), M.carGlass);
    side.position.set(L*0.10, wY, s*W*0.502); side.rotation.set(0, s>0?0:Math.PI, 0); G.add(side);
    const hl = new THREE.Mesh(roundedBox(0.08,0.16,0.3,0.05,2), M.headlamp);
    hl.position.set(L*0.52, sill+0.34, s*W*0.32); G.add(hl);
    const tl = new THREE.Mesh(roundedBox(0.06,0.2,0.16,0.04,2), M.lightRed);
    tl.position.set(-L*0.47, sill+0.22, s*W*0.42); G.add(tl);
  }
  // силовой бампер и шноркель
  const bull = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.5,W*0.9), M.steel);
  bull.position.set(L*0.53, sill+0.16, 0); G.add(bull);
  for(const s of [-1,1]){
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.7,8), M.steel);
    bar.position.set(L*0.53, sill+0.4, s*0.32); G.add(bar);
  }
  const snork = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.3,10), M.darker);
  snork.position.set(L*0.26, sill+cabH*0.6, W*0.48); G.add(snork);
  for(const sx of [L*0.34, -L*0.30]) for(const sz of [-1,1]){
    const w = wheelGroup(R, 0.30, 6);
    w.position.set(sx, R, sz*(W/2-0.10)); G.add(w);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R*1.14, 0.07, 6, 14, Math.PI), M.darker);
    arch.position.set(sx, R, sz*(W/2)); arch.rotation.y = Math.PI/2; G.add(arch);
  }
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G);  addAABB(x, y+(sill+cabH)/2, z, L, sill+cabH, W, rotY);
  return G;
}
/** Кузов на подпорках без колёс — «донор» в углу гаража. */
function carWreck(x,y,z,rotY){
  y = snapSupport(x,z,y); if(y === null) return;
  const G = new THREE.Group();
  const L=4.1, W=1.76, sill=0.42, bodyH=0.72, cabH=0.5;
  const shell = new THREE.Mesh(roundedBox(L,bodyH,W,0.24,4), M.carBlack);
  shell.position.y = sill+bodyH/2; G.add(shell);
  const cab = new THREE.Mesh(roundedBox(L*0.44,cabH,W*0.88,0.2,4), M.carBlack);
  cab.position.set(-L*0.04, sill+bodyH+cabH/2-0.06, 0); G.add(cab);
  // стёкол нет — проёмы обозначены тёмными вставками
  for(const s of [-1,1]){
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(L*0.34, cabH*0.6), M.darker);
    hole.position.set(-L*0.04, sill+bodyH+cabH*0.5, s*W*0.442);
    hole.rotation.y = s>0?0:Math.PI; G.add(hole);
  }
  // подпорки вместо колёс
  for(const sx of [L*0.3,-L*0.3]) for(const sz of [-1,1]){
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.22,sill,0.22), M.wood);
    st.position.set(sx, sill/2, sz*(W/2-0.16)); G.add(st);
  }
  G.position.set(x,y,z); G.rotation.y=rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow=true; o.receiveShadow=true; } });
  scene.add(G);  addAABB(x, y+(sill+bodyH+cabH)/2, z, L, sill+bodyH+cabH, W, rotY);
}

/** Лёгкий вертолёт: кабина-«пузырь», хвостовая балка, полозья, несущий винт. */
function helipad(cx, cz){
  const R = 7.2;
  // подиум площадки: бетонная плита чуть выше пола
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.26, 48), M.helipad);
  pad.position.set(cx, 0.13, cz);
  pad.receiveShadow = true; pad.castShadow = true;
  scene.add(pad);  COLLIDERS.push({x0:cx-R,y0:0,z0:cz-R,x1:cx+R,y1:0.26,z1:cz+R});
  // фаска-отбортовка
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 8, 48), M.dark);
  rim.rotation.x = Math.PI/2; rim.position.set(cx, 0.24, cz);
  rim.castShadow = true; scene.add(rim);

  /* --- периметр: сетчатое ограждение на стойках, с проходами --- */
  const fenceR = R + 1.9, posts = 28;
  const gates = [0.0, Math.PI/2, Math.PI, -Math.PI/2];   // четыре прохода
  // Угловое расстояние до ближайших ворот. Прежнее условие сравнивало его
  // с (PI - 0.30) и потому срабатывало почти всюду: проходов не оставалось,
  // и площадка была наглухо обнесена сеткой.
  const atGate = a => gates.some(g=>{
    const d = Math.abs(((a - g + Math.PI*3) % (Math.PI*2)) - Math.PI);
    return (Math.PI - d) < 0.42;
  });
  for(let i=0;i<posts;i++){
    const a = i/posts*Math.PI*2;
    if(atGate(a)) continue;
    const px = cx+Math.cos(a)*fenceR, pz = cz+Math.sin(a)*fenceR;
    addBox('steel', px, 0.62, pz, 0.09, 1.24, 0.09, {collide:false, d:1.1});
    // сегмент сетки между стойками
    const a2 = (i+1)/posts*Math.PI*2;
    if(atGate(a2)) continue;
    const qx = cx+Math.cos(a2)*fenceR, qz = cz+Math.sin(a2)*fenceR;
    const len = Math.hypot(qx-px, qz-pz);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.15),
      cmat(0x6d7377,{roughness:.86, metalness:.4, transparent:true,
        opacity:.34, side:THREE.DoubleSide}));
    mesh.position.set((px+qx)/2, 0.66, (pz+qz)/2);
    mesh.rotation.y = -Math.atan2(qz-pz, qx-px);
    scene.add(mesh);
    // верхняя и нижняя нитки
    for(const yy of [0.12, 1.20]){
      const g = new THREE.BoxGeometry(len, 0.045, 0.045);
      g.rotateY(-Math.atan2(qz-pz, qx-px));
      g.translate((px+qx)/2, yy, (pz+qz)/2);
      bucket('steel').push(g);
    }
    COLLIDERS.push({x0:Math.min(px,qx)-0.08, y0:0, z0:Math.min(pz,qz)-0.08,
                    x1:Math.max(px,qx)+0.08, y1:1.28, z1:Math.max(pz,qz)+0.08});
  }
  /* --- посадочные огни по кругу --- */
  for(let i=0;i<12;i++){
    const a = i/12*Math.PI*2;
    const px = cx+Math.cos(a)*(R-0.5), pz = cz+Math.sin(a)*(R-0.5);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.13,0.14,10), M.dark);
    base.position.set(px, 0.32, pz); base.castShadow = true; scene.add(base);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.075,10,8),
      i%3===0 ? M.lightRed : M.lightAmb);
    lens.position.set(px, 0.44, pz); scene.add(lens);
  }
  /* --- ветроуказатель --- */
  const wsX = cx - fenceR - 0.9, wsZ = cz + fenceR*0.55;
  addBox('steel', wsX, 2.4, wsZ, 0.12, 4.8, 0.12, {d:1.1});
  addBox('dark', wsX, 0.12, wsZ, 0.6, 0.24, 0.6, {d:1.2});
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34,0.03,6,16), M.steel);
  ring.position.set(wsX+0.36, 4.7, wsZ); ring.rotation.y = Math.PI/2;
  scene.add(ring);
  // конус: чередование полос, слегка отклонён
  for(let i=0;i<5;i++){
    const r0 = 0.33 - i*0.045, r1 = 0.33 - (i+1)*0.045;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 0.42, 12, 1, true),
      i%2 ? cmat(0xb4b0a4,{roughness:.92,side:THREE.DoubleSide})
          : cmat(0x9c4a28,{roughness:.92,side:THREE.DoubleSide}));
    seg.rotation.z = -Math.PI/2 + 0.16;
    seg.position.set(wsX+0.55+i*0.41, 4.70 - i*0.07, wsZ);
    seg.castShadow = true; scene.add(seg);
  }
  /* --- сам вертолёт, слегка развёрнут относительно оси H --- */
  HELI_HOOK(cx+0.4, 0.26, cz-0.3, -0.42);
  /* --- наземное обслуживание --- */
  // тележка-буксировщик
  const cart = new THREE.Group();
  const cbody = new THREE.Mesh(roundedBox(1.5,0.42,0.9,0.1,3), M.paintY);
  cbody.position.y = 0.42; cart.add(cbody);
  const chandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,1.1,8), M.steel);
  chandle.rotation.z = 0.9; chandle.position.set(1.05,0.6,0); cart.add(chandle);
  for(const sx of [-0.5,0.5]) for(const sz of [-1,1]){
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.17,0.055,7,12), M.rubber);
    w.position.set(sx,0.17,sz*0.42); w.rotation.y=Math.PI/2; cart.add(w);
  }
  cart.position.set(cx-4.6, 0.26, cz+3.6); cart.rotation.y = 0.5;
  cart.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(cart);  addAABB(cx-4.6, 0.26+0.35, cz+3.6, 1.8, 0.7, 1.1, 0.5);
  // топливные бочки под навесом и огнетушители
  barrel(cx-5.4, 0.26, cz-3.2, 'green'); barrel(cx-4.7, 0.26, cz-3.8, 'green');
  barrel(cx-5.6, 0.26, cz-4.2, null, true);
  extinguisher(cx+4.8, 0.26, cz+4.2, 0);
  extinguisher(cx+5.2, 0.26, cz+4.2, 0);
  cone(cx+3.6, 0.26, cz+5.0); cone(cx-3.2, 0.26, cz+5.2);
  // мачта прожекторов над площадкой
  const mx = cx + fenceR*0.72, mz = cz - fenceR*0.72;
  addBox('steel', mx, 3.3, mz, 0.16, 6.6, 0.16, {d:1.1});
  addBox('dark', mx, 0.14, mz, 0.7, 0.28, 0.7, {d:1.2});
  for(const a of [0.6, 1.2]){
    const head = new THREE.Mesh(roundedBox(0.44,0.3,0.2,0.05,2), M.dark);
    head.position.set(mx - Math.cos(a)*0.4, 6.5, mz + Math.sin(a)*0.4);
    head.rotation.y = a; head.castShadow = true; scene.add(head);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.36,0.24),
      new THREE.MeshBasicMaterial({color:0xdad6c4}));
    lens.position.set(mx - Math.cos(a)*0.52, 6.45, mz + Math.sin(a)*0.52);
    lens.rotation.y = a - Math.PI/2; lens.rotation.x = -0.3; scene.add(lens);
  }
  return {cx, cz, R, fenceR};
}

function concBlock(x,y,z,rotY, len=1.6, h=0.62){
  y = snapSupport(x,z,y); if(y === null) return;
  addBox('panel', x, y+h/2, z, len, h, 0.6, {rotY, d:.5});
  // монтажные петли
  for(const s of [-1,1]){
    const o = s*len*0.28;
    const lp = new THREE.Mesh(new THREE.TorusGeometry(0.075,0.017,5,10,Math.PI), M.steel);
    lp.position.set(x+Math.cos(rotY)*o, y+h+0.02, z-Math.sin(rotY)*o);
    lp.rotation.y = rotY; lp.castShadow = true; scene.add(lp);
  }
}
/** Стенка из блоков в два-три ряда: главное линейное укрытие. */
function blockWall(x,z,rotY, len=6.0, rows=2){
  const n = Math.max(1, Math.round(len/1.6));
  for(let r=0;r<rows;r++){
    const off = r%2 ? 0.8 : 0;                   // перевязка швов
    for(let i=0;i<n;i++){
      const t = -len/2 + 0.8 + i*1.6 + off;
      if(Math.abs(t) > len/2) continue;
      if(r>0 && srnd()<0.22) continue;           // выбитые блоки верхнего ряда
      const px = x + Math.cos(rotY)*t, pz = z - Math.sin(rotY)*t;
      concBlock(px, r*0.62, pz, rotY + sr(-0.03,0.03), 1.55, 0.62);
    }
  }
}
/** Бытовка / блок-контейнер: дверь, окно, крыша с уклоном. */
function cabin(x,y,z,rotY, w=2.4, d=5.6, h=2.5, col=0x7b8076){
  y = snapSupport(x,z,y); if(y === null) return;
  const mat = cmat(col,{roughness:.8,metalness:.32});
  const G = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(d,h,w), mat);
  body.position.y = h/2 + 0.16; G.add(body);
  // гофра борта
  for(let i=0;i<Math.round(d/0.4);i++) for(const s of [-1,1]){
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.06,h*0.9,0.04), mat);
    rib.position.set(-d/2+0.2+i*0.4, h/2+0.16, s*(w/2+0.02)); G.add(rib);
  }
  // крыша с небольшим свесом
  const roof = new THREE.Mesh(new THREE.BoxGeometry(d+0.2, 0.1, w+0.2), M.roof);
  roof.position.y = h+0.2; G.add(roof);
  // дверь и окно
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.0, 0.85), M.darker);
  door.position.set(d/2+0.01, 1.16, -w*0.2); G.add(door);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.2), M.chrome);
  hand.position.set(d/2+0.06, 1.1, -w*0.2+0.3); G.add(hand);
  for(const px of [-d*0.3, d*0.14]){
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.8), M.glass);
    win.position.set(px, 1.72, w/2+0.03); win.rotation.y = 0; G.add(win);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.9,0.05), M.darker);
    fr.position.set(px, 1.72, w/2+0.01); G.add(fr);
    // решётка на окне
    for(let i=0;i<4;i++){
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.82,0.03), M.steel);
      b.position.set(px-0.4+i*0.27, 1.72, w/2+0.06); G.add(b);
    }
  }
  // опорные брусья и ступень
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const blk = new THREE.Mesh(new THREE.BoxGeometry(0.5,0.16,0.5), M.panel);
    blk.position.set(sx*(d/2-0.5), 0.08, sz*(w/2-0.4)); G.add(blk);
  }
  const step = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.16,1.0), M.steel);
  step.position.set(d/2+0.32, 0.4, -w*0.2); G.add(step);
  G.position.set(x,y,z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){o.castShadow=true;o.receiveShadow=true;} });
  scene.add(G);  addAABB(x, y+(h+0.26)/2, z, d, h+0.26, w, rotY);
}
/** Бетонная труба: круглое укрытие, сквозь которое можно пролезть. */
function pipeStack(x,y,z,rotY,n=3){
  y = snapSupport(x,z,y); if(y === null) return;
  const R = 0.72, L = 2.4;
  const lay = [[0,0],[1,0],[2,0],[0.5,1],[1.5,1],[1,2]];
  for(let i=0;i<Math.min(n*2,lay.length);i++){
    const [c,r] = lay[i];
    const ox = (c-1)*R*2.05, oy = R + r*R*1.78;
    const px = x - Math.sin(rotY)*ox, pz = z - Math.cos(rotY)*ox;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(R,R,L,20,1,true), M.panel);
    tube.rotation.z = Math.PI/2; tube.rotation.y = rotY;
    tube.position.set(px, y+oy, pz); tube.castShadow = tube.receiveShadow = true;
    scene.add(tube);    const inner = new THREE.Mesh(new THREE.CylinderGeometry(R*0.82,R*0.82,L*0.99,20,1,true),
      cmat(0x6d6a63,{roughness:.96,side:THREE.BackSide}));
    inner.rotation.z = Math.PI/2; inner.rotation.y = rotY; inner.position.copy(tube.position);
    scene.add(inner);
    // раструбы по торцам
    for(const s of [-1,1]){
      const rim = new THREE.Mesh(new THREE.TorusGeometry(R*0.91, R*0.09, 6, 20), M.panel);
      rim.position.set(px + Math.cos(rotY)*s*L/2, y+oy, pz - Math.sin(rotY)*s*L/2);
      rim.rotation.y = rotY + Math.PI/2; scene.add(rim);
    }
    // стенки трубы твёрдые, а просвет — проходной
    for(const so of [-1,1])
      COLLIDERS.push({x0:px-(rotY?0.2:L/2)-0.2, y0:y+oy+so*R*0.86-0.16,
                      z0:pz-(rotY?L/2:0.2)-0.2, x1:px+(rotY?0.2:L/2)+0.2,
                      y1:y+oy+so*R*0.86+0.16, z1:pz+(rotY?L/2:0.2)+0.2});
  }
}

// Новый реквизит: реалистичный вертолёт, габионы HESCO, укрытия баз, ломкие
// ящики и баррикады, мишени, динамические бочки/конусы/покрышки.

const V$2 = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
const DYN_PROPS = [];      // тела создаются после инициализации физики
const shadowAll = g => g.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });

/* ============================================================================
   ВЕРТОЛЁТ (лёгкий многоцелевой, силуэт UH-1): фюзеляж — лофт из
   суперэллипсов, остекление вырезается из того же лофта, хвостовая балка,
   киль с рулевым винтом, двухлопастный несущий винт со стабилизирующей
   штангой, лыжное шасси с дугами, лопасти притянуты швартовкой к балке.
============================================================================ */
function loft(sections, M_=40, glassTest=null){
  const S = sections.length, pos = [], uv = [];
  for(let i=0;i<S;i++){
    const s = sections[i];
    for(let j=0;j<=M_;j++){
      const th = j/M_*Math.PI*2, c = Math.cos(th), sn = Math.sin(th), e = 2/(s.sq||2.4);
      const z = s.w*Math.sign(c)*Math.pow(Math.abs(c), e), y = s.yc + (sn>0 ? s.ht : s.hb)*Math.sign(sn)*Math.pow(Math.abs(sn), e);
      pos.push(s.x, y, z); uv.push(i/(S-1)*4, j/M_*2);
    }
  }
  const body = [], glass = [];
  for(let i=0;i<S-1;i++) for(let j=0;j<M_;j++){
    const a=i*(M_+1)+j, b=a+1, c=a+(M_+1), d=c+1;
    const th = (j+0.5)/M_*Math.PI*2;
    const L = glassTest && glassTest(i, th) ? glass : body;
    L.push(a,c,b, b,c,d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
  g.setIndex([...body, ...glass]);
  g.addGroup(0, body.length, 0); g.addGroup(body.length, glass.length, 1);
  g.computeVertexNormals();
  return g;
}
function helicopter(x, y, z, rotY){
  const G = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({color:0x5d6444, roughness:.66, metalness:.22, envMapIntensity:.9});
  const oliveDark = new THREE.MeshStandardMaterial({color:0x363a28, roughness:.75, metalness:.25});
  const glassM = new THREE.MeshStandardMaterial({color:0x7d949e, roughness:.05, metalness:.55, envMapIntensity:2.2,
    transparent:true, opacity:.5, side:THREE.DoubleSide, depthWrite:false});
  const metal = M.steel, black = M.darker;
  // сечения фюзеляжа: x (нос +), полуширина, верх/низ от оси, ось по высоте
  const secs = [
    {x: 3.55, w:0.05, ht:0.05, hb:0.05, yc:0.98, sq:2},
    {x: 3.45, w:0.30, ht:0.26, hb:0.30, yc:1.00, sq:2.1},
    {x: 3.15, w:0.62, ht:0.60, hb:0.45, yc:1.10, sq:2.3},
    {x: 2.65, w:0.92, ht:0.90, hb:0.58, yc:1.26, sq:2.7},
    {x: 1.90, w:1.10, ht:1.02, hb:0.66, yc:1.34, sq:3.2},
    {x: 1.10, w:1.16, ht:1.06, hb:0.68, yc:1.36, sq:3.6},
    {x:-0.6, w:1.16, ht:1.06, hb:0.68, yc:1.36, sq:3.6},
    {x:-1.55, w:1.10, ht:1.02, hb:0.60, yc:1.42, sq:3.4},
    {x:-2.3, w:0.86, ht:0.86, hb:0.36, yc:1.62, sq:2.8},
    {x:-3.1, w:0.52, ht:0.52, hb:0.30, yc:1.86, sq:2.4},
    {x:-4.6, w:0.34, ht:0.36, hb:0.28, yc:2.00, sq:2.2},
    {x:-6.6, w:0.24, ht:0.26, hb:0.22, yc:2.10, sq:2.0},
    {x:-8, w:0.18, ht:0.2,  hb:0.18, yc:2.16, sq:2.0},
    {x:-8.12, w:0.02, ht:0.02, hb:0.02, yc:2.16, sq:2.0}
  ];
  // остекление кабины: верхне-передний сектор между носом и центропланом
  // фонарь кабины — верхняя передняя часть лофта, плюс нижние «подбородочные» окна
  const hull = loft(secs, 48, (i, th)=> (i>=1 && i<=3 && th > 0.18 && th < Math.PI-0.18) || (i===4 && th > 0.75 && th < Math.PI-0.75)
                                    || (i>=1 && i<=2 && th > Math.PI*1.08 && th < Math.PI*1.32) || (i>=1 && i<=2 && th > Math.PI*1.68 && th < Math.PI*1.92));
  const fus = new THREE.Mesh(hull, [olive, glassM]); G.add(fus);
  // переплёт фонаря
  for(const zz of [-0.02, 0.02]){
    const f = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.05), black);
    f.position.set(2.62, 2.18, zz); f.rotation.z = -0.62; G.add(f);
  }
  for(const s of [-1,1]){
    // сдвижные двери десантной кабины с окнами
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.25, 0.03), olive);
    door.position.set(0.05, 1.42, s*1.165); G.add(door);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), glassM);
    win.position.set(0.2, 1.75, s*1.185); win.rotation.y = s>0 ? 0 : Math.PI; G.add(win);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.05), metal);
    rail.position.set(-0.3, 2.1, s*1.17); G.add(rail);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), M.chrome);
    handle.position.set(0.72, 1.35, s*1.2); G.add(handle);
    // дверь пилота с блистером
    const pd = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.62), glassM);
    pd.position.set(1.72, 1.78, s*1.16); pd.rotation.y = s>0 ? 0.05 : Math.PI-0.05; G.add(pd);
    const pf = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.04, 0.04), black); pf.position.set(1.72, 1.47, s*1.17); G.add(pf);
    // навигационные огни: красный слева, зелёный справа
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({color: s<0?0x8a1c16:0x1f7a36, emissive: s<0?0x8a1c16:0x1f7a36, emissiveIntensity:1.4}));
    nav.position.set(-4.9, 2.02, s*0.95); G.add(nav);
    // горизонтальный стабилизатор
    const st = new THREE.Mesh(roundedBox(0.62, 0.06, 1.1, 0.03, 2), olive);
    st.position.set(-4.9, 1.98, s*0.62); G.add(st);
    // полозья: труба с загнутым носком и ступенькой
    const pts = [V$2(-1.9,0.08,s*1.25), V$2(1.4,0.08,s*1.25), V$2(1.9,0.13,s*1.25), V$2(2.15,0.32,s*1.25)];
    const skid = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 8), metal); G.add(skid);
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.18), black); step.position.set(0.9, 0.42, s*1.22); G.add(step);
  }
  // дуги шасси
  for(const xx of [1.15, -1.05]){
    const arc = new THREE.CatmullRomCurve3([V$2(xx,0.08,-1.25), V$2(xx,0.62,-1.05), V$2(xx,0.72,0), V$2(xx,0.62,1.05), V$2(xx,0.08,1.25)]);
    G.add(new THREE.Mesh(new THREE.TubeGeometry(arc, 24, 0.05, 8), metal));
  }
  // капот двигателя, воздухозаборник, выхлоп
  const cowl = new THREE.Mesh(roundedBox(2.3, 0.62, 1.0, 0.22, 4), olive); cowl.position.set(-0.55, 2.62, 0); G.add(cowl);
  const intake = new THREE.Mesh(roundedBox(0.4, 0.42, 0.9, 0.14, 3), oliveDark); intake.position.set(0.72, 2.58, 0); G.add(intake);
  for(let i=0;i<6;i++){ const gr = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.3, 0.78), black); gr.position.set(0.93, 2.58, 0); gr.position.y = 2.45 + i*0.05; G.add(gr); }
  const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 14, 1, true), new THREE.MeshStandardMaterial({color:0x2b2622, roughness:.5, metalness:.8, side:THREE.DoubleSide}));
  exh.rotation.z = Math.PI/2 - 0.25; exh.position.set(-1.88, 2.72, 0); G.add(exh);
  // киль, рулевой винт
  const finShape = new THREE.Shape([new THREE.Vector2(0,0), new THREE.Vector2(0.9,0), new THREE.Vector2(0.5,1.35), new THREE.Vector2(-0.05,1.35)]);
  const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(finShape, {depth:0.1, bevelEnabled:true, bevelSize:0.02, bevelThickness:0.02, bevelSegments:1}), olive);
  fin.position.set(-8.3, 2.12, -0.05); G.add(fin);
  const trHub = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 10), metal);
  trHub.rotation.x = Math.PI/2; trHub.position.set(-7.75, 3.1, -0.2); G.add(trHub);
  for(let i=0;i<2;i++){ const b = new THREE.Mesh(roundedBox(0.14, 1.5, 0.02, 0.01, 1), black);
    b.position.set(-7.75, 3.1, -0.3); b.rotation.z = i*Math.PI/2 + 0.5; G.add(b); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8, 0, Math.PI*2, 0, Math.PI/2),
    new THREE.MeshStandardMaterial({color:0x9a1c14, emissive:0xb01c10, emissiveIntensity:0.8, transparent:true, opacity:0.9}));
  beacon.position.set(-2, 2.42, 0); G.add(beacon);
  // мачта, втулка, штанга стабилизатора, лопасти с провисом
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.7, 12), M.chrome); mast.position.set(0.1, 3.2, 0); G.add(mast);
  const hub = new THREE.Mesh(roundedBox(0.7, 0.18, 0.34, 0.06, 2), metal); hub.position.set(0.1, 3.58, 0); G.add(hub);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 6), metal); bar.rotation.x = Math.PI/2; bar.position.set(0.1, 3.72, 0); G.add(bar);
  for(const s of [-1,1]){ const w = new THREE.Mesh(new THREE.SphereGeometry(0.07,8,6), metal); w.position.set(0.1, 3.72, s*0.95); w.scale.set(1.6,0.7,1); G.add(w); }
  const ROT = 7.2, bladeAng = 0.42;
  for(let i=0;i<2;i++){
    const a = bladeAng + i*Math.PI;
    const blade = new THREE.Group();
    const seg = 6;
    for(let k=0;k<seg;k++){
      const L = ROT/seg, piece = new THREE.Mesh(roundedBox(L+0.02, 0.05, 0.53, 0.02, 1), black);
      const r0 = 0.35 + k*L, droop = -0.012*Math.pow((r0+L/2), 1.6);
      piece.position.set(r0 + L/2, droop, 0); piece.rotation.z = -0.018*Math.pow(r0+L/2, 0.6); blade.add(piece);
    }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.052, 0.54), cmat(0xc9c2a0,{roughness:.6}));
    tip.position.set(ROT+0.25, -0.012*Math.pow(ROT+0.25,1.6), 0); blade.add(tip);
    blade.position.set(0.1, 3.6, 0); blade.rotation.y = -a; G.add(blade);
  }
  // швартовка лопасти к хвостовой балке: трос и чехол
  const tipW = V$2(0.1 + Math.cos(Math.PI+bladeAng)*6.8, 3.0, -Math.sin(Math.PI+bladeAng)*6.8);
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([tipW, V$2(tipW.x+0.2, 2.6, tipW.z*0.6), V$2(-6, 2.15, 0.25)]), 16, 0.01, 4), cmat(0xb7a476,{roughness:.9}));
  G.add(rope);
  // бортовой номер и опознавательные полосы
  const numC = document.createElement('canvas'); numC.width = 256; numC.height = 96;
  const nx = numC.getContext('2d'); nx.fillStyle = 'rgba(0,0,0,0)'; nx.fillRect(0,0,256,96);
  nx.font = '700 72px "Segoe UI",Arial'; nx.fillStyle = '#d8d6c8'; nx.textAlign='center'; nx.textBaseline='middle'; nx.fillText('141', 128, 50);
  const numT = new THREE.CanvasTexture(numC); numT.colorSpace = THREE.SRGBColorSpace;
  const numM = new THREE.MeshStandardMaterial({map:numT, transparent:true, roughness:.8, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2});
  for(const s of [-1,1]){ const n = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), numM);
    n.position.set(-3.9, 2.02, s*0.41); n.rotation.y = s>0 ? 0 : Math.PI; n.rotation.x = 0; G.add(n); }
  // красные ленты «REMOVE BEFORE FLIGHT» на заглушках
  const tag = cmat(0xa8241a,{roughness:.9, side:THREE.DoubleSide});
  for(const [px,py,pz] of [[-1.95,2.6,0.25]]){ const t = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.35), tag);
    t.position.set(px, py-0.18, pz); t.rotation.z = 0.2; G.add(t); }
  G.position.set(x, y, z); G.rotation.y = rotY;
  shadowAll(G);
  scene.add(G);
  // коллайдеры: кабина, хвостовая балка, лыжи
  const q = new THREE.Quaternion().setFromAxisAngle(V$2(0,1,0), rotY);
  const W = (lx,ly,lz)=> V$2(lx,ly,lz).applyQuaternion(q).add(V$2(x,y,z));
  let c = W(0.6, 1.3, 0); addOBB(c.x,c.y,c.z, 5.4, 1.9, 2.3, q, 'metal');
  c = W(-0.5, 2.6, 0); addOBB(c.x,c.y,c.z, 2.4, 0.7, 1.0, q, 'metal');
  c = W(-5.2, 2.05, 0); addOBB(c.x,c.y,c.z, 6.0, 0.5, 0.5, q, 'metal');
  c = W(-8, 2.8, 0); addOBB(c.x,c.y,c.z, 0.9, 1.4, 0.2, q, 'metal');
  return G;
}

/* ============================================================================
   ГАБИОН HESCO: проволочная сетка + мешок с песком. Держит пули.
============================================================================ */
/** Мешок габиона: не коробка, а ткань, выпирающая между прутьями сетки
    (ячейка ~7.5 см) и просевшая к верху. На high — мельче рельеф. */
const _hescoGeo = new Map();
function hescoSandGeo(cell, h){
  const key = cell + '|' + h;
  if(_hescoGeo.has(key)) return _hescoGeo.get(key);
  const seg = Q.tex >= 1 ? 3 : 2;
  const g = roundedBox(cell-0.04, h-0.04, cell-0.04, 0.1, seg);
  const pa = g.attributes.position, v = new THREE.Vector3(), nrm = new THREE.Vector3();
  const half = (cell-0.04)/2;
  for(let i=0;i<pa.count;i++){
    v.fromBufferAttribute(pa, i);
    nrm.set(v.x/half, 0, v.z/half);
    const side = Math.max(Math.abs(nrm.x), Math.abs(nrm.z));
    // выпор между прутьями + общий «живот» к середине грани, верх просел
    // выпор ячеек сетки — в карте нормалей, геометрии остаётся общий «живот»
    const belly = (1 - Math.pow(Math.abs(v.y)/(h/2), 2))*0.035;
    const k = side > 0.98 ? belly : 0;
    const len = Math.hypot(nrm.x, nrm.z) || 1;
    pa.setXYZ(i, v.x + nrm.x/len*k, v.y - (v.y > h/2 - 0.12 ? 0.03 : 0), v.z + nrm.z/len*k);
  }
  g.computeVertexNormals();
  _hescoGeo.set(key, g);
  return g;
}
function hesco(x, z, rotY, n=3, h=1.35, y=0){
  const cell = 1.05;
  const L = n*cell;
  const G = new THREE.Group();
  const sandGeo = hescoSandGeo(cell, h);
  for(let i=0;i<n;i++){
    const off = (i-(n-1)/2)*cell;
    const sand = new THREE.Mesh(sandGeo, M.hesco);
    sand.position.set(off, h/2, 0); sand.scale.set(1, 1, 1); G.add(sand);
    // верх: насыпь горбом
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI*2, 0, Math.PI/2), M.sand);
    top.scale.set(1.0, 0.18, 1.0); top.position.set(off, h-0.03, 0); G.add(top);
    // сетка чуть больше мешка — просвечивает ткань
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(cell, h, cell), M.hescoMesh);
    const uv = mesh.geometry.attributes.uv; for(let k=0;k<uv.count;k++) uv.setXY(k, uv.getX(k)*2.2, uv.getY(k)*2.8);
    mesh.position.set(off, h/2, 0); G.add(mesh);
    for(const sx of [-1,1]) for(const sz of [-1,1]){
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, h, 0.03), M.steel);
      post.position.set(off + sx*cell/2, h/2, sz*cell/2); G.add(post);
    }
  }
  G.position.set(x, y, z); G.rotation.y = rotY; shadowAll(G);
  scene.add(G);
  addAABB(x, y+h/2, z, L, h, cell, rotY, 'sand');
  return G;
}
/** Три варианта мешка: подушка, прошитая по краям и просевшая под весом, со
    складками ткани (на high — плотнее сетка и мельче складки). */
let _bagGeos = null;
function sandbagGeos(){
  if(_bagGeos) return _bagGeos;
  _bagGeos = [];
  const seg = Q.tex >= 1 ? 3 : 2;
  for(let vi=0; vi<3; vi++){
    const bag = roundedBox(0.6, 0.16, 0.34, 0.065, seg);
    const pa = bag.attributes.position, ph = vi*1.7;
    for(let i=0;i<pa.count;i++){
      const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i);
      const k = 1 - Math.pow(Math.abs(x)/0.3, 4)*0.35;
      const wr = (Math.sin(x*38 + ph)*Math.sin(z*29 - ph) + Math.sin(x*71 + z*53 + ph*2)*0.5)*0.006*(y > 0 ? 1 : 0.4);
      pa.setXYZ(i, x*(1 + Math.sin(ph + z*9)*0.02), y*k + (y > 0 ? wr - Math.max(0, 0.02 - Math.abs(z)*0.1)*(1 - Math.abs(x)/0.3) : 0),
        z*(1 - Math.pow(Math.abs(x)/0.3, 6)*0.25) + wr*0.5);
    }
    bag.computeVertexNormals();
    _bagGeos.push(bag);
  }
  return _bagGeos;
}
/** Мешки с песком: уложенные вперевязку «кирпичи» с продавленной серединой. */
function sandbagWall(x, z, rotY, len=3.0, rows=4, y=0){
  const G = new THREE.Group();
  // мешок: скруглённая подушка, прошитая по краям, чуть просевшая под весом
  const bags = sandbagGeos();
  const per = Math.max(2, Math.round(len/0.58));
  for(let r=0;r<rows;r++){
    for(let i=0;i<per - (r%2); i++){
      const off = (i - (per-1-(r%2))/2)*0.58;
      for(const dz of [-0.17, 0.17]){
        const m = new THREE.Mesh(bags[(r*7 + i*3 + (dz > 0 ? 1 : 0)) % bags.length], M.sandbag);
        m.position.set(off + rnd(-0.02,0.02), 0.075 + r*0.145, dz + rnd(-0.02,0.02));
        m.rotation.y = rnd(-0.06,0.06); m.rotation.z = rnd(-0.04,0.04);
        G.add(m);
      }
    }
  }
  G.position.set(x, y, z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  addAABB(x, y + rows*0.145/2, z, per*0.58, rows*0.145, 0.7, rotY, 'sand');
  return G;
}

/* ============================================================================
   ЛОМКИЙ РЕКВИЗИТ
============================================================================ */
const plank = (G, mat, w,h,d, x,y,z, rx=0,ry=0,rz=0)=>{
  const g = new THREE.BoxGeometry(w,h,d); uvBox(g,w,h,d,1.1,true);
  const m = new THREE.Mesh(g, mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); G.add(m); return m;
};
/** Деревянный ящик из досок: при поломке разлетается на доски. */
function crate(x, y, z, rotY, s=0.9){
  const G = new THREE.Group();
  const mat = M.woodDark, n = 4, bw = s/n;
  for(const side of [-1,1]){
    for(let i=0;i<n;i++){
      plank(G, mat, s, bw-0.01, 0.022, 0, bw*(i+0.5), side*(s/2-0.011));
      plank(G, mat, 0.022, bw-0.01, s-0.044, side*(s/2-0.011), bw*(i+0.5), 0);
    }
  }
  for(let i=0;i<n;i++) plank(G, mat, s-0.044, 0.022, bw-0.01, 0, s-0.011, -s/2+bw*(i+0.5));
  for(const sx of [-1,1]) for(const sz of [-1,1]) plank(G, M.wood, 0.05, s, 0.05, sx*(s/2-0.035), s/2, sz*(s/2-0.035));
  for(const side of [-1,1]) plank(G, M.wood, s*1.3, 0.07, 0.024, 0, s/2, side*(s/2+0.012), 0, 0, Math.atan2(s*0.9, s)*0.9);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:130, mass:25, col:{cx:x, cy:y+s/2, cz:z, hx:s/2, hy:s/2, hz:s/2, q:qY(rotY)}});
}
const qY = r => { const q = new THREE.Quaternion().setFromAxisAngle(V$2(0,1,0), r); return [q.x,q.y,q.z,q.w]; };
/** Штабель поддонов. */
function palletStack(x, y, z, rotY, n=5){
  const G = new THREE.Group();
  for(let k=0;k<n;k++){
    const yy = k*0.144 + rnd(-5e-3,0.005), ry = rnd(-0.05,0.05);
    const P = new THREE.Group(); P.position.y = yy; P.rotation.y = ry;
    for(let i=0;i<7;i++) plank(P, M.wood, 0.1, 0.022, 0.8, -0.55+i*0.183, 0.133, 0);
    for(const o of [-0.34,0,0.34]) plank(P, M.woodDark, 1.2, 0.09, 0.1, 0, 0.078, o);
    for(let i=0;i<3;i++) plank(P, M.wood, 0.1, 0.022, 0.8, -0.5+i*0.5, 0.011, 0);
    G.add(P);
  }
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:160, mass:18*n, col:{cx:x, cy:y+n*0.072, cz:z, hx:0.6, hy:n*0.072, hz:0.42, q:qY(rotY)}});
}
/** Баррикада из щитов фанеры на козлах: укрытие, которое простреливается и горит. */
function barricade(x, y, z, rotY, w=2.4, h=1.15){
  const G = new THREE.Group();
  const panels = Math.max(1, Math.round(w/1.2));
  for(let i=0;i<panels;i++){
    const off = (i-(panels-1)/2)*(w/panels);
    plank(G, M.plywood, w/panels-0.02, h, 0.018, off, h/2+0.05, 0, 0, 0, rnd(-0.015,0.015));
  }
  for(const s of [-1,1]){
    plank(G, M.wood, 0.07, h+0.1, 0.07, s*(w/2-0.1), (h+0.1)/2, -0.05);
    plank(G, M.wood, 0.06, 0.06, 0.7, s*(w/2-0.1), 0.35, -0.3, 0.9, 0, 0);
  }
  plank(G, M.wood, w, 0.08, 0.04, 0, h*0.7, -0.05);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:180, mass:40, col:{cx:x, cy:y+h/2+0.05, cz:z, hx:w/2, hy:h/2+0.05, hz:0.12, q:qY(rotY)}});
}
/** Мишень IPSC на кольях: фанерный силуэт с зонами. */
let _tgtTex = null;
let _tgtMat = null, _fuelSignMat = null;
function targetTex(){
  if(_tgtTex) return _tgtTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 400; const x = c.getContext('2d');
  x.fillStyle = '#b89a6a'; x.fillRect(0,0,256,400);
  for(let i=0;i<600;i++){ x.fillStyle = `rgba(${90+Math.random()*60|0},${70+Math.random()*40|0},${40+Math.random()*30|0},${Math.random()*0.12})`; x.fillRect(Math.random()*256, Math.random()*400, 2+Math.random()*30, 1+Math.random()*3); }
  x.strokeStyle = 'rgba(60,40,20,.55)'; x.lineWidth = 3;
  x.beginPath(); x.ellipse(128, 60, 40, 48, 0, 0, 7); x.stroke();
  x.strokeRect(78, 150, 100, 150); x.strokeRect(98, 170, 60, 70);
  x.beginPath(); x.moveTo(20,400); x.lineTo(20,160); x.lineTo(60,120); x.lineTo(196,120); x.lineTo(236,160); x.lineTo(236,400); x.stroke();
  x.fillStyle='rgba(60,40,20,.7)'; x.font='700 22px Arial'; x.fillText('A', 120, 210);
  _tgtTex = new THREE.CanvasTexture(c); _tgtTex.colorSpace = THREE.SRGBColorSpace;
  return _tgtTex;
}
function target(x, y, z, rotY){
  const G = new THREE.Group();
  const sh = new THREE.Shape();
  sh.moveTo(-0.23,0); sh.lineTo(0.23,0); sh.lineTo(0.23,0.44); sh.lineTo(0.16,0.52); sh.lineTo(0.07,0.52); sh.lineTo(0.07,0.6);
  sh.quadraticCurveTo(0.1,0.74,0,0.76); sh.quadraticCurveTo(-0.1,0.74,-0.07,0.6); sh.lineTo(-0.07,0.52); sh.lineTo(-0.16,0.52); sh.lineTo(-0.23,0.44); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {depth:0.012, bevelEnabled:false});
  const uv = g.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, (uv.getX(i)+0.23)/0.46, uv.getY(i)/0.76);
  if(!_tgtMat) _tgtMat = new THREE.MeshStandardMaterial({map:targetTex(), roughness:.95});
  const face = new THREE.Mesh(g, _tgtMat);
  face.position.set(0, 0.95, 0); G.add(face);
  for(const s of [-1,1]) plank(G, M.wood, 0.035, 1.05, 0.02, s*0.14, 0.52, -0.02, 0, 0, s*0.03);
  plank(G, M.woodDark, 0.5, 0.05, 0.3, 0, 0.025, -0.02);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:90, mass:4, target:true, col:{cx:x, cy:y+1.1, cz:z, hx:0.24, hy:0.55, hz:0.05, q:qY(rotY)}});
}
/** Стол на козлах (можно перевернуть как укрытие — стоит на боку). */
function table(x, y, z, rotY, flipped=false){
  const G = new THREE.Group();
  if(!flipped){
    plank(G, M.plywood, 1.8, 0.03, 0.8, 0, 0.76, 0);
    for(const s of [-1,1]){ plank(G, M.wood, 0.06, 0.74, 0.06, s*0.8, 0.37, 0.32); plank(G, M.wood, 0.06, 0.74, 0.06, s*0.8, 0.37, -0.32); plank(G, M.wood, 0.05, 0.05, 0.7, s*0.8, 0.2, 0); }
  } else {
    plank(G, M.plywood, 1.8, 0.8, 0.03, 0, 0.4, 0);
    for(const s of [-1,1]){ plank(G, M.wood, 0.06, 0.06, 0.74, s*0.8, 0.72, -0.37); plank(G, M.wood, 0.06, 0.06, 0.74, s*0.8, 0.08, -0.37); }
  }
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:110, mass:22, col:{cx:x, cy:y+0.4, cz:z, hx:0.9, hy:0.4, hz: flipped?0.05:0.4, q:qY(rotY)}});
}
/** Бочка с топливом: простреленная — течёт и загорается, горящая — взрывается. */
function fuelBarrel(x, y, z, rotY=0, col=0x8d2a1c){
  const G = new THREE.Group();
  const mat = cmat(col, {roughness:.55, metalness:.4});
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 20), mat); body.position.y = 0.44; G.add(body);
  for(const yy of [0.22, 0.44, 0.66]){ const r = new THREE.Mesh(new THREE.TorusGeometry(0.295, 0.018, 6, 20), mat); r.rotation.x = Math.PI/2; r.position.y = yy; G.add(r); }
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 20), M.dark); lid.position.y = 0.885; G.add(lid);
  // знак огнеопасно (текстура и материал общие на все бочки)
  if(!_fuelSignMat){
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const xx = c.getContext('2d');
    xx.fillStyle='#d8b030'; xx.beginPath(); xx.moveTo(32,4); xx.lineTo(60,56); xx.lineTo(4,56); xx.closePath(); xx.fill();
    xx.fillStyle='#111'; xx.font='700 30px Arial'; xx.textAlign='center'; xx.fillText('!', 32, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    _fuelSignMat = new THREE.MeshStandardMaterial({map:t, transparent:true, roughness:.7});
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.2,0.2), _fuelSignMat);
  sign.position.set(0, 0.5, 0.295); G.add(sign);
  G.position.set(x,y,z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  return registerProp(G, {hp:120, mass:60, wood:false, surf:'metal', explosive:true, burnHp:1.6,
    col:{cx:x, cy:y+0.44, cz:z, hx:0.3, hy:0.44, hz:0.3, q:null}});
}

/* ============================================================================
   ДИНАМИЧЕСКИЙ РЕКВИЗИТ: катится, падает, разлетается от взрыва.
============================================================================ */
function dynBarrel(x, y, z, col=0x4e5a46, tipped=false){
  const mat = cmat(col, {roughness:.6, metalness:.35});
  const parts = [new THREE.CylinderGeometry(0.29,0.29,0.88,18)];
  for(const yy of [-0.22,0,0.22]){ const r = new THREE.TorusGeometry(0.295,0.018,5,18); r.rotateX(Math.PI/2); r.translate(0,yy,0); parts.push(r); }
  const g = mergeParts(parts);
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
  m.position.set(x, y + (tipped?0.3:0.44), z);
  if(tipped){ m.rotation.z = Math.PI/2; m.rotation.y = rnd(0,6.28); }
  m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'cyl', size:[0.58,0.88,0.58], mass:22, surf:'metal', friction:0.6, restitution:0.2});
}
function dynCone(x, y, z){
  const parts = [new THREE.ConeGeometry(0.17,0.55,14)]; parts[0].translate(0,0.3,0);
  const b = new THREE.BoxGeometry(0.34,0.035,0.34); b.translate(0,0.018,0); parts.push(b);
  const g = mergeParts(parts); g.translate(0,-0.28,0);
  const m = new THREE.Mesh(g, M.plastO); m.castShadow = true; m.position.set(x, y+0.28, z); m.userData.nomerge = true; scene.add(m);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105,0.125,0.08,14), cmat(0xe8e4d8,{roughness:.5})); band.position.y = 0.05; m.add(band);
  DYN_PROPS.push({mesh:m, shape:'box', size:[0.3,0.56,0.3], mass:2, surf:'sand', friction:0.8});
}
function dynTire(x, y, z){
  const g = new THREE.TorusGeometry(0.36,0.135,9,18);
  const m = new THREE.Mesh(g, M.rubber); m.castShadow = true; m.rotation.x = Math.PI/2; m.position.set(x, y+0.14, z);
  m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'box', size:[0.98,0.98,0.27], mass:9, surf:'sand', friction:0.9, restitution:0.35});
}
function dynBox(x, y, z, rotY, s=[0.5,0.35,0.4], mat){
  const g = new THREE.BoxGeometry(...s); uvBox(g, s[0], s[1], s[2], 1.2);
  const m = new THREE.Mesh(g, mat || M.foam); m.castShadow = m.receiveShadow = true;
  m.position.set(x, y + s[1]/2, z); m.rotation.y = rotY; m.userData.nomerge = true; scene.add(m);
  DYN_PROPS.push({mesh:m, shape:'box', size:s, mass: s[0]*s[1]*s[2]*300, surf:'wood'});
}
function mergeParts(parts){
  for(const p of parts){ for(const k of Object.keys(p.attributes)) if(!['position','normal','uv'].includes(k)) p.deleteAttribute(k); }
  const idx = parts.every(p=>p.index);
  return BGU.mergeGeometries(idx ? parts : parts.map(p=>p.index?p.toNonIndexed():p), false);
}

// Расстановка: базы ALPHA (запад) и DELTA (восток), укрытия в пролётах,
// техника, склад ГСМ, ворота ангара, мебель и мишени внутри здания.
// Всё ставится центрально-симметрично: (x, z) → (−x, −z), чтобы у обеих
// команд были одинаковые линии укрытий и одинаковые пути к зданию.
/** Ставит объект и его центрально-симметричную копию. */
const sym = (fn, x, z, rotY=0, ...rest)=>{ fn(x, z, rotY, ...rest); fn(-x, -z, rotY+Math.PI, ...rest); };

const TEAMS = {
  ALPHA: { name:'ALPHA', color:'#d7dde4', accent:0xbfd4ee, side:-1, flag:{x:-31.2, z:-2.3},
           spawns:[ {id:'A1', name:'Бункер', x:-35.4, z:0}, {id:'A2', name:'Север', x:-34.2, z:-14.5}, {id:'A3', name:'Юг', x:-34.2, z:14.5} ] },
  DELTA: { name:'DELTA', color:'#a9cf86', accent:0xb8e08c, side: 1, flag:{x: 31.2, z:2.3},
           spawns:[ {id:'D1', name:'Бункер', x: 35.4, z:0}, {id:'D2', name:'Север', x: 34.2, z:-14.5}, {id:'D3', name:'Юг', x: 34.2, z:14.5} ] }
};
const GATES = [], TEAM_SPOTS = [], BASE_LIGHTS = [];

/* ---------- морской контейнер 20 футов ---------- */
const _contMats = {};
function container(x, z, rotY, col=0x5b6f7a, y=0){
  let mat = _contMats[col];
  if(!mat){
    // свой материал на основе карт профлиста: цвет краски + рёбра нормалями
    mat = new THREE.MeshStandardMaterial({ map: M.corr.map, normalMap: M.corr.normalMap, normalScale: new THREE.Vector2(1.1,1.1),
      color: new THREE.Color(col).multiplyScalar(4.2), roughness: .78, metalness: .15, envMapIntensity: .7 });
    _contMats[col] = mat; }
  const L = 6.06, W = 2.44, H = 2.59;
  const G = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(L-0.1, H-0.12, W-0.08), mat);
  const uv = body.geometry.attributes.uv; for(let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*3, uv.getY(i)*1.3);
  body.position.y = H/2; G.add(body);
  const frame = cmat(0x4a4d4f, {roughness:.7, metalness:.4});
  for(const sx of [-1,1]) for(const sz of [-1,1]){
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, H, 0.16), frame); post.position.set(sx*(L/2-0.08), H/2, sz*(W/2-0.08)); G.add(post);
    const cast = new THREE.Mesh(new THREE.BoxGeometry(0.18,0.12,0.18), frame); cast.position.set(sx*(L/2-0.08), H-0.06, sz*(W/2-0.08)); G.add(cast);
  }
  for(const yy of [0.08, H-0.08]) for(const sz of [-1,1]){ const r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.12), frame); r.position.set(0, yy, sz*(W/2-0.06)); G.add(r); }
  // двери с запорными штангами
  for(const sz of [-1,1]){
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, H-0.3, W/2-0.1), mat); d.position.set(L/2-0.02, H/2, sz*W/4); G.add(d);
    for(const o of [-0.35,0.35]){ const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,H-0.2,6), M.steel); bar.position.set(L/2+0.03, H/2, sz*W/4+o*0.6); G.add(bar); }
  }
  G.position.set(x, y, z); G.rotation.y = rotY;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
  scene.add(G);
  addAABB(x, y+H/2, z, L, H, W, rotY, 'metal');
}

/* ---------- топливная ёмкость на ложементах ---------- */
function fuelTank(x, z, rotY){
  const G = new THREE.Group();
  const mat = cmat(0x6e6a56, {roughness:.55, metalness:.45});
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 4.6, 24), mat); tank.rotation.z = Math.PI/2; tank.position.y = 1.35; G.add(tank);
  for(const s of [-1,1]){ const cap = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 10), mat); cap.scale.set(0.3,1,1); cap.position.set(s*2.3, 1.35, 0); G.add(cap);
    const sad = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 1.8), M.panel); sad.position.set(s*1.4, 0.28, 0); G.add(sad); }
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.3,0.15,14), M.dark); hatch.position.set(0.6, 2.4, 0); G.add(hatch);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,1.3,8), M.steel); pipe.position.set(-1.4, 0.7, 0.9); G.add(pipe);
  G.position.set(x,0,z); G.rotation.y = rotY; G.traverse(o=>{ if(o.isMesh){ o.castShadow = o.receiveShadow = true; } }); scene.add(G);
  addAABB(x, 1.2, z, 5.2, 2.4, 2.0, rotY, 'metal');
}

/* ---------- база команды: навес с габионами, флагшток, разметка ---------- */
function floorMark(tex, x, z, w, h, rotY, opacity=0.8){
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({map:tex, transparent:true, opacity,
    depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2, roughness:.9}));
  m.rotation.x = -Math.PI/2; m.rotation.z = rotY; m.position.set(x, 0.012, z); m.receiveShadow = true; m.userData.nomerge = true;
  scene.add(m);
}
function emblemFloorTex(team){
  const [c,x] = cv(512,512);
  x.clearRect(0,0,512,512);
  const col = team==='ALPHA' ? 'rgba(220,226,232,0.85)' : 'rgba(160,200,120,0.85)';
  const img = new Image();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  img.onload = ()=>{ x.globalAlpha = 0.9; x.drawImage(img, 56, 20, 400, 400);
    x.globalAlpha = 1; x.fillStyle = col; x.font = '700 64px "Segoe UI",Arial'; x.textAlign='center'; x.fillText(team, 256, 490);
    // потёртость краски колёсами и подошвами
    x.globalCompositeOperation = 'destination-out';
    for(let i=0;i<500;i++){ x.fillStyle = `rgba(0,0,0,${Math.random()*0.5})`; x.fillRect(Math.random()*512, Math.random()*512, 2+Math.random()*40, 1+Math.random()*4); }
    x.globalCompositeOperation = 'source-over'; t.needsUpdate = true; };
  img.src = emblemDataURL(team, 256);
  return t;
}
function stripeTex(col){
  const [c,x] = cv(256,32);
  x.fillStyle = col; x.fillRect(0,0,256,32);
  x.globalCompositeOperation = 'destination-out';
  for(let i=0;i<120;i++){ x.fillStyle = `rgba(0,0,0,${Math.random()*0.6})`; x.fillRect(Math.random()*256, Math.random()*32, 2+Math.random()*14, 1+Math.random()*3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
function base(teamKey){
  const T = TEAMS[teamKey], s = T.side;         // s = -1 запад, +1 восток
  const bx = s*35.4;
  // бетонная площадка навеса
  addBox('conc', bx, 0.04, 0, 6.4, 0.08, 8.6, {d:.4, collide:false});
  addOBB(bx, 0.04, 0, 6.4, 0.08, 8.6, null, 'conc');
  // каркас навеса и кровля из профлиста
  for(const px of [bx-2.9, bx+2.9]) for(const pz of [-4, 4.0]){
    addBox('steel', px, 1.45, pz, 0.14, 2.9, 0.14, {d:1.1});
  }
  for(const pz of [-4, 4.0]) addBox('steel', bx, 2.95, pz, 6.1, 0.18, 0.12, {collide:false, d:1});
  for(const px of [bx-2.9, bx, bx+2.9]) addBox('steel', px, 3.0, 0, 0.12, 0.16, 8.3, {collide:false, d:1});
  addBox('roof', bx, 3.12, 0, 6.8, 0.05, 9.0, {collide:false, d:.5});
  addOBB(bx, 3.12, 0, 6.8, 0.1, 9.0, null, 'metal');
  // габионы по бокам и сзади — защита точки возрождения
  hesco(bx, -4.7, 0, 5, 1.6); hesco(bx, 4.7, 0, 5, 1.6);
  // фронт: мешки с песком посередине, по бокам два прохода
  sandbagWall(bx - s*3.6, 0, Math.PI/2, 2.4, 6);
  // лампа в цвете команды под навесом
  const lampMat = new THREE.MeshStandardMaterial({color:0x222222, emissive:T.accent, emissiveIntensity:1.1});
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.16), lampMat); lamp.position.set(bx, 2.88, 0); lamp.userData.nomerge = true; scene.add(lamp);
  BASE_LIGHTS.push({p:new THREE.Vector3(bx, 2.6, 0), color:T.accent});
  // флагшток перед навесом
  const fx = T.flag.x, fz = T.flag.z;
  addBox('conc', fx, 0.15, fz, 1.2, 0.3, 1.2, {d:.6});
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 8.0, 12), M.chrome);
  pole.position.set(fx, 4.3, fz); pole.castShadow = true; scene.add(pole);
  addOBB(fx, 4.3, fz, 0.14, 8.0, 0.14, null, 'metal');
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), cmat(0xb8a060,{metalness:.8, roughness:.3}));
  finial.position.set(fx, 8.36, fz); scene.add(finial);
  // фал вдоль мачты
  const hal = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,7.6,4), M.cable); hal.position.set(fx + 0.07*s*-1, 4.3, fz+0.05); scene.add(hal);
  // эмблема на полу и граница зоны
  floorMark(emblemFloorTex(teamKey), s*28.4, 0, 4.4, 4.4, s < 0 ? -Math.PI/2 : Math.PI/2, 0.75);
  const st = stripeTex(teamKey==='ALPHA' ? '#d9dee4' : '#9cc27a'); st.repeat.set(10,1);
  floorMark(st, s*25.9, 0, 0.22, 22, 0, 0.85);
  // прожектор в цвете команды над базой
  const sp = new THREE.SpotLight(T.accent, 0, 40, 0.7, 0.6, 1.2);
  sp.position.set(s*38.5, 8.5, 0); sp.target.position.set(s*30, 0, 0); SPOT_SRC.push(sp);
  TEAM_SPOTS.push(sp);
  // ящик пополнения боезапаса — в центре базы, за точкой возрождения (общий для обеих команд)
  ammoBox(bx + s*1.9, 0.08, 0, Math.PI/2);
  dynBox(bx + s*1.8, 0.08, -3.3, 0.1, [0.7,0.35,0.4], M.teamD);
  dynBox(bx + s*1.8, 0.08, 3.3, -0.1, [0.7,0.35,0.4], M.teamD);
}

/* ---------- ворота ангара: приоткрытая створка, за ней дневной свет ---------- */
function hangarGate(sx){
  const x = sx*(HW-0.3);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 6.6), new THREE.MeshBasicMaterial({color:0xffffff, map: outsideTex(), fog:false}));
  outside.position.set(sx*(HW+0.25), 3.3, 1.2); outside.rotation.y = sx>0 ? -Math.PI/2 : Math.PI/2; outside.userData.nomerge = true; scene.add(outside);
  for(const [z0,z1] of [[-6.2, 0.4], [2.0, 6.2]]){
    const zc = (z0+z1)/2, w = z1-z0;
    addBox('corr', x + sx*0.05, 3.4, zc, 0.12, 6.8, w, {d:.45, surf:'metal'});
    for(let i=0;i<4;i++) addBox('steel', x - sx*0.03, 0.8 + i*1.8, zc, 0.08, 0.12, w, {collide:false, d:1});
  }
  addBox('steel', x - sx*0.05, 7.0, 0, 0.3, 0.35, 13.0, {collide:false, d:1});   // направляющая
  for(const z of [-6.4, 6.4]) addBox('steel', x - sx*0.05, 3.5, z, 0.3, 7.0, 0.3, {d:1});
  // в щель ворот бьёт свет — длинная полоса на бетоне
  const beam = new THREE.SpotLight(0xfff0d8, 30, 30, 0.22, 0.7, 1.1);
  beam.position.set(sx*(HW+2), 4.5, 1.2); beam.target.position.set(sx*(HW-12), 0, 1.2);
  SPOT_SRC.push(beam);
  GATES.push({plane:outside, beam});
  addOBB(sx*(HW-0.1), 3.3, 1.2, 0.3, 6.6, 1.6, null, 'metal', {playerOnly:true});
  addOBB(sx*(HW+1.0), 3.0, 1.2, 0.3, 6.0, 2.4, null, 'metal', {noPlayer:true});
}

/* ============================================================================
   НАПОЛНЕНИЕ КАРТЫ: кран-балка, кабельные лотки, маркировка комнат, вид за
   воротами, гильзы на полу.
============================================================================ */
/** Мостовой кран под фермами: подкрановые пути вдоль ангара, мост с тельфером,
    цепь и крюк. Статика — запекается вместе с ангаром. */
function overheadCrane(){
  const yR = EAVE - 1.15, zR = HD - 1.1, xB = 13.5;
  for(const s of [-1, 1]){
    addBox('steel', 0, yR, s*zR, HW*2 - 1.2, 0.36, 0.2, {collide:false, d:1});                 // подкрановая балка
    addBox('steel', 0, yR + 0.2, s*zR, HW*2 - 1.2, 0.05, 0.08, {collide:false, d:1});          // рельс
    for(let x = -HW + 3.75; x < HW - 1; x += COL_STEP) addBox('steel', x, yR - 0.35, s*(zR + 0.25), 0.18, 0.5, 0.5, {collide:false, d:1});   // консоли
  }
  // мост: две балки коробчатого сечения + концевые тележки
  for(const dx of [-0.45, 0.45]) addBox('hazard', xB + dx, yR + 0.55, 0, 0.32, 0.62, zR*2, {collide:false, d:0.6});
  for(const s of [-1, 1]) addBox('steel', xB, yR + 0.42, s*zR, 1.6, 0.34, 0.5, {collide:false, d:1});
  // тельфер, цепь, крюк
  const hz = -4.2;
  addBox('steel', xB, yR + 0.1, hz, 0.8, 0.5, 0.7, {collide:false, d:1});
  addBox('darker', xB, yR - 0.25, hz, 0.4, 0.3, 0.4, {collide:false, d:1});
  const chainLen = 3.6, links = Math.round(chainLen/0.09);
  for(let i=0;i<links;i++) addBox('darker', xB, yR - 0.45 - i*0.09, hz, i%2 ? 0.012 : 0.04, 0.085, i%2 ? 0.04 : 0.012, {collide:false, d:4});
  const hy = yR - 0.45 - chainLen;
  addBox('hazard', xB, hy - 0.1, hz, 0.22, 0.24, 0.12, {collide:false, d:1.5});
  const hook = new THREE.TorusGeometry(0.09, 0.025, 6, 12, Math.PI*1.4); hook.rotateZ(-Math.PI*0.2); hook.translate(xB, hy - 0.32, hz);
  bucket('darker').push(hook);
}
/** Кабельные лотки и короба по продольным стенам ангара, спуски к щитам. */
function cableTrays(){
  const y = WALL_H - 0.55;
  for(const s of [-1, 1]){
    const z = s*(HD - 0.45);
    addBox('steel', 0, y, z, HW*2 - 2, 0.03, 0.34, {collide:false, d:1});                       // дно лотка
    for(const e of [-1, 1]) addBox('steel', 0, y + 0.05, z + e*0.17, HW*2 - 2, 0.1, 0.012, {collide:false, d:1});
    for(let i=0;i<3;i++) addBox('cable', 0, y + 0.03 + i*0.018, z - 0.06 + i*0.06, HW*2 - 2.2, 0.03, 0.03, {collide:false, d:1});
    for(let x = -HW + 2; x < HW - 1; x += 2.5) addBox('steel', x, y + 0.18, z + s*0.2, 0.04, 0.36, 0.04, {collide:false, d:1});   // подвесы
    // спуски к щитам у колонн
    for(const x of [-26.25, -3.75, 18.75]){
      addBox('steel', x, (y + 1.4)/2, z + s*0.12, 0.12, y - 1.4, 0.06, {collide:false, d:1});
      addBox('panel', x, 1.25, z + s*0.05, 0.6, 0.8, 0.22, {collide:false, d:1.2});
      addBox('hazard', x, 1.25, z - s*0.07, 0.12, 0.12, 0.012, {collide:false, d:3});
    }
  }
}
/** Номера комнат над дверями шут-хауса: трафарет краской, с потёками. */
function roomLabels(){
  const labels = [];
  let n1 = 0, n2 = 0;
  for(const d of DOORS){
    const fl = d.y > 1 ? 2 : 1, id = fl === 1 ? ++n1 : ++n2;
    labels.push({ d, text: `${fl}-${String(id).padStart(2, '0')}` });
  }
  if(!labels.length) return;
  const C = 8, W = 128, H = 64, R = Math.ceil(labels.length/C);
  const [c, x] = cv(C*W, R*H);
  x.clearRect(0, 0, C*W, R*H);
  labels.forEach((L, i)=>{
    const ox = (i % C)*W, oy = Math.floor(i/C)*H;
    x.save(); x.translate(ox + W/2, oy + H/2); x.rotate((rnd2() - 0.5)*0.05);
    x.font = '700 38px "Arial Narrow",Arial,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(28,26,24,.88)'; x.fillText(L.text, 0, 0);
    // потёки краски
    for(let k=0;k<4;k++){ x.fillRect(-40 + rnd2()*80, 10, 1.5, 6 + rnd2()*16); }
    x.restore();
  });
  // трафаретные перемычки: разрывы в буквах
  x.globalCompositeOperation = 'destination-out';
  for(let i=0;i<labels.length*6;i++){ x.fillStyle = 'rgba(0,0,0,.9)'; x.fillRect(rnd2()*C*W, rnd2()*R*H, 2, 6); }
  x.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = MAXA();
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: .9,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const parts = [];
  labels.forEach((L, i)=>{
    const u0 = (i % C)/C, v1 = 1 - Math.floor(i/C)/R, u1 = u0 + 1/C, v0 = v1 - 1/R;
    for(const side of [-1, 1]){
      const g = new THREE.PlaneGeometry(0.34, 0.17);
      const uv = g.attributes.uv; uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0);
      const nx = Math.cos(L.d.ang), nz = -Math.sin(L.d.ang);        // нормаль стены
      const off = (TH/2 + SHEET + 0.004)*side;
      g.rotateY(Math.atan2(nx*side, nz*side));
      g.translate(L.d.x + nx*off, L.d.y + DOOR_H + 0.3, L.d.z + nz*off);
      parts.push(g);
    }
  });
  const m = new THREE.Mesh(BGU.mergeGeometries(parts, false), mat);
  m.userData.nomerge = true; m.receiveShadow = true; m.renderOrder = 2;
  scene.add(m);
}
/** Вид за воротами: небо, дальняя лесополоса, забор и асфальт вместо белой плоскости. */
let _outsideTex = null;
function outsideTex(){
  if(_outsideTex) return _outsideTex;
  const W = 256, H = 1024, [c, x] = cv(W, H);
  const sky = x.createLinearGradient(0, 0, 0, H*0.62);
  sky.addColorStop(0, '#cfe0f2'); sky.addColorStop(1, '#f4f1ea');
  x.fillStyle = sky; x.fillRect(0, 0, W, H*0.62);
  // лесополоса на горизонте
  x.fillStyle = '#6f7c64';
  x.beginPath(); x.moveTo(0, H*0.62);
  for(let i=0;i<=32;i++) x.lineTo(i*W/32, H*0.56 - Math.abs(Math.sin(i*1.7))*H*0.03 - rnd2()*H*0.02);
  x.lineTo(W, H*0.62); x.fill();
  // асфальт и разметка
  const gr = x.createLinearGradient(0, H*0.62, 0, H);
  gr.addColorStop(0, '#a8a49c'); gr.addColorStop(1, '#6c6962');
  x.fillStyle = gr; x.fillRect(0, H*0.62, W, H*0.38);
  x.fillStyle = 'rgba(230,220,170,.7)'; x.fillRect(W*0.62, H*0.64, 6, H*0.36);
  // забор из сетки
  x.strokeStyle = 'rgba(70,74,70,.55)'; x.lineWidth = 1;
  for(let i=0;i<W;i+=6){ x.beginPath(); x.moveTo(i, H*0.5); x.lineTo(i + 12, H*0.62); x.stroke(); x.beginPath(); x.moveTo(i + 12, H*0.5); x.lineTo(i, H*0.62); x.stroke(); }
  x.fillStyle = '#4b4f4a'; for(let i=0;i<W;i+=64) x.fillRect(i, H*0.48, 3, H*0.14);
  grain(x, W, H, 0.03);
  _outsideTex = new THREE.CanvasTexture(c); _outsideTex.colorSpace = THREE.SRGBColorSpace;
  return _outsideTex;
}
/** Гильзы: остаются на полу (до 400), звенят при падении. */
function tinkCasing(p){ if(SND.ok && Math.random() < 0.8) SND.tink(p); }
function buildLayout(){
  setHeliHook((x,y,z,r)=> helicopter(x,y,z,r));
  base('ALPHA'); base('DELTA');
  hangarGate(-1); hangarGate(1);

  /* --- фланговые точки возрождения: контейнер + габионы --- */
  sym((x,z,r)=> container(x, z, r, 0x5b6f7a), -34, -18.2, 0);
  sym((x,z,r)=> hesco(x, z, r, 2, 1.45), -30.4, -14.5, Math.PI/2);
  sym((x,z,r)=> cabin(x, 0, z, r, 2.4, 5.2, 2.5, 0x717a6c), -34.2, 18.3, 0);
  sym((x,z,r)=> hesco(x, z, r, 2, 1.45), -30.4, 14.5, Math.PI/2);
  sym((x,z,r)=> crate(x, 0, z, r, 0.9), -36.6, -12.2, 0.2);
  sym((x,z,r)=> crate(x, 0, z, r, 0.8), -36.4, 12.4, -0.3);

  /* --- рубеж выхода с базы --- */
  sym((x,z,r)=> hesco(x, z, r, 3, 1.35), -27.4, -7, Math.PI/2);
  sym((x,z,r)=> hesco(x, z, r, 3, 1.35), -27.4, 7.0, Math.PI/2);
  sym((x,z,r)=> sandbagWall(x, z, r, 2.4, 5), -24.6, 0, Math.PI/2);
  sym((x,z,r)=> hesco(x, z, r, 2, 2.0), -27.2, 0, 0);
  sym((x,z,r)=> hesco(x, z, r, 1, 2.0), -18.3, 0.2, 0);
  sym((x,z,r)=> jerseyBarrier(x, 0, z, r), -22.5, -4.2, Math.PI/2+0.1);
  sym((x,z,r)=> jerseyBarrier(x, 0, z, r), -22.8, 4.0, Math.PI/2-0.1);

  /* --- СЗ угол: склад ГСМ (взрывоопасные бочки) --- */
  sym((x,z,r)=> fuelTank(x, z, r), -33.5, -26.2, 0);
  for(const [bx,bz] of [[-29,-27.4],[-28.4,-26.8],[-29.5,-26.6],[-27.6,-27.6],[-26.2,-27.5]]){
    fuelBarrel(bx, 0, bz, rnd(0,6)); fuelBarrel(-bx, 0, -bz, rnd(0,6));
  }
  sym((x,z,r)=> sandbagWall(x, z, r, 3.0, 4), -27.2, -24.6, 0);
  sym((x,z,r)=> palletStack(x, 0, z, r, 4), -24.2, -27.6, 0.2);

  /* --- северный пролёт (и центрально-симметричный южный) --- */
  sym((x,z,r)=> container(x, z, r, 0x7a5a42), -21.5, -16.4, 0.15);
  sym((x,z,r)=> container(x, z, r, 0x4f5f4a, 2.59), -21.3, -16.6, 0.18);
  sym((x,z,r)=> container(x, z, r, 0x6d7478), -21.8, -23.5, -0.1);
  sym((x,z,r)=> carWreck(x, 0, z, r), -14.8, -22.8, 0.5);
  sym((x,z,r)=> blockWall(x, z, r, 6.0, 2), -13.5, -14.6, 0.08);
  sym((x,z,r)=> hesco(x, z, r, 3, 2.0), -19.6, -11.6, Math.PI/2);
  sym((x,z,r)=> crate(x, 0, z, r, 1.0), -10.6, -12.9, 0.3);
  sym((x,z,r)=> crate(x, 0, z, r, 0.8), -10, -12, -0.2);
  sym((x,z,r)=> pipeStack(x, 0, z, r, 3), -2.5, -25.8, Math.PI/2);
  // S-образный заслон из контейнеров: каждая линия вдоль пролёта упирается
  // хотя бы в один контейнер, а пройти можно зигзагом между ними
  sym((x,z,r)=> container(x, z, r, 0x6b4a3a), 4.4, -12.64, Math.PI/2);
  sym((x,z,r)=> container(x, z, r, 0x55644e), 4.4, -18.7, Math.PI/2);
  sym((x,z,r)=> container(x, z, r, 0x4c5a66), 8.6, -26.55, Math.PI/2);
  sym((x,z,r)=> container(x, z, r, 0x7a6a48), 8.6, -20.45, Math.PI/2);
  sym((x,z,r)=> barricade(x, 0, z, r, 2.4), 10.2, -13, -0.12);
  sym((x,z,r)=> palletStack(x, 0, z, r, 5), 16.2, -12.8, 0.3);
  sym((x,z,r)=> pickup(x, 0, z, r, M.carSand), -8.5, -27, 0.08);
  sym((x,z,r)=> van(x, 0, z, r, M.carWhite), 1.0, -22.5, Math.PI/2-0.05);
  sym((x,z,r)=> hesco(x, z, r, 2, 1.35), 0.5, -13.3, 0);

  /* --- ЮЗ угол: вертолётная площадка (и её пара на СВ) --- */
  helipad(-21, 20.6); helipad(21.0, -20.6);

  /* --- западный/восточный фасады: укрытия у дверей --- */
  sym((x,z,r)=> barricade(x, 0, z, r, 2.4), -17.6, 3.0, 0.05);
  sym((x,z,r)=> crate(x, 0, z, r, 0.9), -16.4, -4.4, 0.1);
  sym((x,z,r)=> hesco(x, z, r, 2, 2.0), -17.2, -3.2, 0);
  sym((x,z,r)=> table(x, 0, z, r, true), -18.4, 8.4, 0);
  sym((x,z,r)=> hesco(x, z, r, 2, 2.0), -17, -14, 0);
  sym((x,z,r)=> hesco(x, z, r, 2, 2.0), -17, 14.0, 0);
  // поперечные контейнеры на рубеже баз: линии вдоль торцов ангара рвутся
  sym((x,z,r)=> container(x, z, r, 0x5b6f7a), -28, -11.5, 0);
  sym((x,z,r)=> container(x, z, r, 0x6d5b48), -25.5, 11.5, 0);
  sym((x,z,r)=> hesco(x, z, r, 1, 2.0), -39.2, -9.5, 0);
  sym((x,z,r)=> hesco(x, z, r, 1, 2.0), -39.2, 9.5, 0);
  // у задних стен
  sym((x,z,r)=> container(x, z, r, 0x49534c), -17.5, -28.3, 0);

  /* --- мелочь с физикой --- */
  const dyn = [
    ()=>dynBarrel(-24.4,0,-14.2), ()=>dynBarrel(-24.9,0,-14.8,0x3a5470), ()=>dynBarrel(-12.2,0,-18.5,0x8a8b86,true),
    ()=>dynCone(-16.4,0,-10.8), ()=>dynCone(-15.2,0,-10.6), ()=>dynCone(-6.2,0,-12.6),
    ()=>dynTire(-18.8,0,-19.2), ()=>dynTire(-19.4,0,-18.6), ()=>dynBox(-9.2,0,-17.4,0.3),
    ()=>dynBarrel(-2.8,0,-14.2,0x6e3630), ()=>dynCone(6.5,0,-11.6)
  ];
  for(const f of dyn) f();
  // зеркальные копии — через подмену координат
  const mir = [[24.4,0,14.2],[24.9,0,14.8],[12.2,0,18.5],[16.4,0,10.8],[15.2,0,10.6],[6.2,0,12.6],[18.8,0,19.2],[19.4,0,18.6],[9.2,0,17.4],[2.8,0,14.2],[-6.5,0,11.6]];
  dynBarrel(...mir[0]); dynBarrel(...mir[1],0x3a5470); dynBarrel(...mir[2],0x8a8b86,true);
  dynCone(...mir[3]); dynCone(...mir[4]); dynCone(...mir[5]); dynTire(...mir[6]); dynTire(...mir[7]);
  dynBox(...mir[8], 0.3); dynBarrel(...mir[9], 0x6e3630); dynCone(...mir[10]);

  /* --- строительный быт вдоль стен ангара --- */
  sym((x,z,r)=> lumberPile(x, 0, z, r, 3.4, 7), -12, -28.8, 0);
  sym((x,z,r)=> osbStack(x, 0, z, r, 12), -6.8, -28.7, 0);
  sym((x,z,r)=> sawhorse(x, 0, z, r), -9.3, -28.2, 0.2);
  sym((x,z,r)=> cableDrum(x, 0, z), 12.5, -28.4, 0);
  sym((x,z,r)=> compressor(x, 0, z, r), 15.5, -28.6, 0.4);
  sym((x,z,r)=> toolCart(x, 0, z, r), 18.2, -28.4, 0.1);
  sym((x,z,r)=> siteToilet(x, 0, z, r), 38.6, -27.5, -Math.PI/2);
  sym((x,z,r)=> extinguisher(x, 0, z, r), -39.5, -7.6, Math.PI/2);

  buildInterior();
  overheadCrane();
  cableTrays();
}

/* ---------- внутри здания: укрытия, мебель, мишени ---------- */
function buildInterior(){
  const y2 = F2;
  const S = (fn, x, y, z, r, ...a)=>{ fn(x, y, z, r, ...a); fn(-x, y, -z, r+Math.PI, ...a); };
  // 1 этаж
  S(target, -11, 0, -8.8, 0);
  S(table,  -11.8, 0, -4.4, Math.PI/2, true);
  S(barricade, -7.1, 0, -4.2, 0, 2.0);
  S(target, -5.3, 0, -8.9, 0);
  S(palletStack, -14.2, 0, 8.6, 0.1, 4);
  S(table, -12.4, 0, 5.6, 0, false);
  S(target, -10.5, 0, 8.9, Math.PI);
  S(barricade, -7.2, 0, 6.4, 0, 1.6);
  S(crate, -5.2, 0, 2.1, 0.2, 0.8);
  S(crate, -3.6, 0, -8.7, 0.1, 0.9);
  S(target, -1, 0, -8.9, 0);
  S(palletStack, -2.2, 0, 0.9, 0.35, 4);
  S(barricade, 2.6, 0, -2.2, 0.1, 1.6);
  // 2 этаж
  S(target, -10.4, y2, -2.1, Math.PI);
  S(crate, -10.3, y2, -8.9, 0.1, 0.8);
  S(barricade, -7.2, y2, -5.4, 0, 1.8);
  S(target, -5.2, y2, -8.9, 0);
  S(table, -12.4, y2, 5.2, 0, true);
  S(crate, -14.3, y2, 8.8, 0.3, 0.8);
  S(target, -7, y2, 8.9, Math.PI);
  S(palletStack, -3.5, y2, -8.7, 0.1, 3);
  S(target, -1.2, y2, -8.9, 0);

  /* --- дополнительные укрытия: в каждой комнате есть за чем спрятаться
     на подходе от каждой двери; проходы, лестницы и проёмы свободны --- */
  // 1 этаж
  S(barricade, -12.3, 0, -7.2, 0.05, 1.6);          // СЗ комната: заслон напротив наружной двери
  S(crate, -10.5, 0, -8.4, 0.15, 0.9);
  S(crate, -8.6, 0, -8.4, 0.2, 0.9);                // северные комнаты крыла
  S(palletStack, -5.7, 0, -2.6, 0.1, 3);
  S(table, -2.4, 0, -5.6, 0, true);                 // центральные залы
  S(crate, -3.4, 0, 7.6, 0.3, 0.9);
  S(barricade, -2.2, 0, 5.3, 0, 1.6);
  S(crate, -10.6, 0, 3.2, 0.2, 0.9);                // южные комнаты крыла
  S(barricade, -13.1, 0, 3.7, 0.1, 1.6);
  S(palletStack, -8.6, 0, 3.3, 0.2, 3);
  S(crate, -5.7, 0, 8.4, 0.1, 0.9);
  S(crate, -14.4, 0, -0.5, 0.1, 0.8);               // тупики коридоров
  S(crate, -6.1, 0, 0.7, 0.3, 0.7);
  S((x,y,z,r,...a)=> sandbagWall(x, z, r, ...a, y), -0.6, 0, 1.7, 0, 1.6, 3);   // мешки в атриуме держат пулю
  // 2 этаж
  S(barricade, -11.2, y2, -5.0, Math.PI/2, 1.6);
  S(crate, -8.8, y2, -3.0, 0.2, 0.9);
  S(crate, -5.4, y2, -2.6, 0.1, 0.8);
  S(table, -2.2, y2, -5.4, 0, true);
  S(crate, -3.2, y2, 5.0, 0.2, 0.9);
  S(barricade, -2.0, y2, 7.7, 0, 1.4);
  S(barricade, -11.2, y2, 7.4, 0.1, 1.6);
  S(crate, -14.2, y2, 3.2, 0.2, 0.8);
  S(palletStack, -6.2, y2, 4.4, 0.2, 3);
  S(crate, -8.8, y2, 7.6, 0.3, 0.9);
  S(crate, -14.4, y2, 0.4, 0.1, 0.8);
}

// Огонь: очаги на горючих элементах. Очаг разгорается, обугливает древесину
// вокруг, съедает прочность куска, перекидывается вверх и в стороны и гаснет,
// когда кончается топливо. Пламя, дым, искры, свет и звук — отсюда же.

const FIRES = [];
const MAXF = Q.lights >= 6 ? 46 : (Q.lights >= 5 ? 32 : 20);
const FIRE_LIGHTS = Math.max(2, Math.min(5, Q.lights-1));
const V$1 = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);

function initFire(){
  HOOKS.ignite = ignite;
}
/** Очаг рядом с элементом ref (или свободный — лужа топлива, ref=null). */
function addFire(p, ref, o={}){
  if(FIRES.length >= MAXF) return null;
  for(const f of FIRES) if(f.p.distanceToSquared(p) < 0.25) { f.fuel += 4; return f; }
  const n = ref ? refNormal(ref, o.from || camera.position) : V$1(0,1,0);
  const f = { p: p.clone().addScaledVector(n, 0.05), n, ref, I: o.I ?? 0.15, target: 1,
              fuel: o.fuel ?? rnd(28,45), t:0, spreadT: rnd(1.5,3), free: !ref, dmgT:0, lightK:0 };
  FIRES.push(f);
  return f;
}
/** Поджог в точке: ищет горючее в радиусе r и ставит несколько очагов. */
function ignite(p, strength=0.6, r=1.5, puddle=false){
  const cand = query(p, r, refFlammable).sort((a,b)=>a.d-b.d);
  let n = Math.round(1 + strength*4);
  for(const c of cand){
    if(n <= 0) break;
    if(Math.random() > strength + 0.3) continue;
    addFire(c.pos, c.ref, {I: 0.3 + strength*0.5, from: p}); n--;
  }
  // горящая жидкость на полу (коктейль, пробитая бочка)
  if(puddle || strength >= 0.9){
    const fy = floorBelow(p);
    for(let i=0;i<(puddle?4:3);i++){
      const q = V$1(p.x + rnd(-1.2,1.2), fy + 0.02, p.z + rnd(-1.2,1.2));
      addFire(q, null, {I:0.8, fuel: rnd(10,18)});
    }
  }
}

let tickT = 0;
function updateFire(dt, t){
  coolDown(dt);
  tickT += dt;
  const doTick = tickT >= 0.12;
  const TT = tickT; if(doTick) tickT = 0;
  let near = 0, nearP = null, nearD = 1e9;
  for(let i=FIRES.length-1;i>=0;i--){
    const f = FIRES[i];
    f.t += dt;
    // элемент под огнём уже сгорел — очаг опадает на пол и догорает там
    if(f.ref && !refAliveSafe(f.ref)){
      f.ref = null; f.free = true; f.fuel = Math.min(f.fuel, rnd(4,9));
      const fy = floorBelow(f.p); if(f.p.y - fy > 0.3){ spawnEmbers(f.p, 10); f.p.y = fy + 0.03; f.n.set(0,1,0); }
    }
    f.fuel -= dt;
    const want = f.fuel > 0 ? f.target : 0;
    f.I = clamp(f.I + (want > f.I ? 0.12 : -0.35)*dt, 0, 1);
    if(f.fuel <= 0 && f.I <= 0.01){ FIRES.splice(i,1); continue; }
    emit(f, dt, t);
    const d = f.p.distanceTo(camera.position);
    near += f.I * clamp(1 - d/14, 0, 1);
    if(d < nearD){ nearD = d; nearP = f.p; }
    if(!doTick) continue;
    let cl = 0; for(const g of FIRES) if(g !== f && g.I > 0.2 && g.p.distanceToSquared(f.p) < 4) cl++;
    f.cluster = cl;
    // обугливание и жар вокруг очага
    const r = 0.35 + f.I*0.9;
    charSphere(f.p.clone().addScaledVector(V$1(0,1,0), 0.25*f.I), r, 0.07*f.I*TT*6, 0.4 + 0.6*f.I);
    if(f.ref){
      burnDamage(f.ref, (7 + 16*f.I)*TT, V$1(0,-1,0));
    }
    // распространение: вверх быстрее, в стороны медленнее
    f.spreadT -= TT*(0.4 + f.I);
    if(f.spreadT <= 0 && f.I > 0.45){
      f.spreadT = rnd(2.0, 4.5);
      const dir = V$1(rnd(-1,1), rnd(-0.3,1.6), rnd(-1,1)).normalize();
      const q = f.p.clone().addScaledVector(dir, rnd(0.45,1.0));
      const cand = query(q, 0.55, refFlammable);
      if(cand.length){
        const c = cand[Math.floor(Math.random()*cand.length)];
        let busy = false; for(const g of FIRES) if(g.p.distanceToSquared(c.pos) < 0.3) { busy = true; break; }
        if(!busy) addFire(c.pos, c.ref, {I:0.12, from: f.p});
      }
    }
  }
  if(doTick) flushDestruction();
  updateLights(t);
  SND.fire(clamp(near*0.6, 0, 1), nearP);
  if(HOOKS.fireNear) HOOKS.fireNear();
}
function refAliveSafe(ref){
  if(ref.t==='c') return ref.s.alive[ref.k] === 1;
  if(ref.t==='b') return !ref.b.dead;
  if(ref.t==='p') return !ref.p.dead;
  return false;
}
const _ft1 = new THREE.Vector3(), _ft2 = new THREE.Vector3(), _fpe = new THREE.Vector3(), _fve = new THREE.Vector3();
/** Проёмы дома, выходящие в ангар (двери и окна, за которыми открыто). */
let OPENINGS = null;
function houseOpenings(){
  if(OPENINGS) return OPENINGS;
  OPENINGS = [];
  for(const w of WALLS){
    const ux = (w.x2 - w.x1)/w.len, uz = (w.z2 - w.z1)/w.len;
    for(const o of w.ops){
      const t = (o.t0 + o.t1)/2, p = new THREE.Vector3(w.x1 + ux*t, w.y0 + o.y1 - 0.12, w.z1 + uz*t);
      const a = avolOpen(_fpe.set(p.x + w.nx*1.2, p.y, p.z + w.nz*1.2)), b = avolOpen(_fpe.set(p.x - w.nx*1.2, p.y, p.z - w.nz*1.2));
      if(Math.max(a, b) > 0.55) OPENINGS.push({ p, floor: w.y0 });
    }
  }
  return OPENINGS;
}
function nearestOpening(p, ceil){
  let best = null, bd = 9;
  for(const o of houseOpenings()){
    if(o.p.y > ceil + 0.3 || o.p.y < ceil - 3.2) continue;
    const d = Math.hypot(o.p.x - p.x, o.p.z - p.z);
    if(d < bd){ bd = d; best = o.p; }
  }
  return best;
}
/** Высота, под которой копится дым этого очага (перекрытие, потолок, кровля). */
function fireCeil(p, n){
  const ox = n ? n.x*0.35 : 0, oz = n ? n.z*0.35 : 0;      // от стены отходим наружу: луч из толщи стены её не видит
  const h = PH.ready ? rayFirst(_fpe.set(p.x + ox, p.y + 0.4, p.z + oz), _fve.set(p.x + ox, p.y + 14, p.z + oz), GRP.STATIC) : null;
  return h ? h.p.y - 0.55 : roofY(p.z) - 0.7;
}
/** Пламя, свечение, дым и искры одного очага. f.cluster — число соседних
    очагов: горящая стена или комната даёт высокие языки и тяжёлый чёрный дым,
    одиночная головня — невысокое пламя и светлый дымок. */
function emit(f, dt, t){
  const I = f.I; if(I <= 0.01) return;
  const big = clamp((f.cluster || 0)/5, 0, 1);
  const qk = Q.dust >= 2000 ? 1 : 0.7;
  if(f.ceil === undefined){ f.ceil = fireCeil(f.p, f.free ? null : f.n); f.exit = f.ceil < 6 ? nearestOpening(f.p, f.ceil) : null; }
  const base = f.p;
  // касательные к горящей поверхности: пламя стелется по стене, а не шаром
  if(f.free){ _ft1.set(1,0,0); _ft2.set(0,0,1); }
  else { _ft1.crossVectors(f.n, Math.abs(f.n.y) < 0.9 ? _dY : _ft2.set(1,0,0)).normalize(); _ft2.crossVectors(f.n, _ft1); }
  // 1. языки пламени: анимированные кадры атласа, вытянуты вверх
  f._acc = (f._acc||0) + (8 + 26*I)*qk*dt;
  while(f._acc >= 1){
    f._acc -= 1;
    const spread = 0.1 + 0.3*I + 0.2*big;
    _fpe.copy(base).addScaledVector(_ft1, rnd(-spread, spread)).addScaledVector(_ft2, f.free ? rnd(-spread, spread) : rnd(-0.1, 0.2)*I);
    if(!f.free) _fpe.addScaledVector(f.n, rnd(0.03, 0.14));
    const sz = rnd(0.26, 0.48)*(0.55 + I)*(1 + 0.5*big);
    FXS.flame.spawn({p:_fpe, v:_fve.set(rnd(-0.15,0.15), rnd(0.8,1.6)*(0.6+I), rnd(-0.15,0.15)), life:rnd(0.45,0.9)*(1 + 0.3*big),
      s0:sz, s1:sz*0.35, asp:1.55, rot:rnd(-0.2,0.2), spin:rnd(-0.4,0.4), col:[0.75 + 0.35*I, 0.75 + 0.35*I, 0.75 + 0.35*I],
      a0:0.9, a1:0, drag:0.9, turb:1.0, fadeIn:0.06, fps:rnd(14,22)});
  }
  // 2. сильный огонь: высокие медленные языки над очагом
  if(I > 0.55){
    f._bacc = (f._bacc||0) + (1.2 + 4*big)*qk*dt;
    while(f._bacc >= 1){
      f._bacc -= 1;
      _fpe.copy(base).addScaledVector(_ft1, rnd(-0.25, 0.25)).add(_fve.set(0, 0.25 + 0.3*I, 0));
      if(!f.free) _fpe.addScaledVector(f.n, 0.12);
      const sz = rnd(0.65, 1.1)*(0.6 + 0.8*big);
      FXS.flame.spawn({p:_fpe, v:_fve.set(rnd(-0.1,0.1), rnd(1.1,1.9), rnd(-0.1,0.1)), life:rnd(0.8,1.3),
        s0:sz, s1:sz*0.5, asp:1.8, rot:rnd(-0.12,0.12), spin:rnd(-0.2,0.2), col:[0.9, 0.9, 0.9],
        a0:0.55, a1:0, drag:0.7, turb:0.8, fadeIn:0.12, fps:rnd(10,16)});
    }
  }
  // 3. горячее свечение у основания
  f._gacc = (f._gacc||0) + 3*dt;
  if(f._gacc >= 1){ f._gacc -= 1;
    FXS.flash.spawn({p: _fpe.copy(base).add(_fve.set(0, 0.3*I, 0)).addScaledVector(f.n, 0.15), life:0.45, s0:1.0+1.6*I+big, s1:1.2+1.8*I+big,
      col:[1,0.45,0.12], a0:0.22*I, a1:0, fadeIn:0.15}); }
  // 4. дым: сажа от горящего дерева почти чёрная, тлеющее — светлый буро-серый дымок.
  //    Клубы поднимаются, раздуваются, подсвечены пламенем снизу и растекаются под потолком.
  f._sacc = (f._sacc||0) + (1.8 + 4.4*I)*(1 + 1.3*big)*qk*dt;
  while(f._sacc >= 1){
    f._sacc -= 1;
    _fpe.copy(base).add(_fve.set(rnd(-0.25,0.25), 0.4 + 0.5*I + rnd(0, 0.3), rnd(-0.25,0.25)));
    if(!f.free) _fpe.addScaledVector(f.n, 0.25);
    const soot = clamp(I*0.9 + big*0.5 - 0.15, 0, 1);
    const g = lerp(0.3, 0.045, soot)*rnd(0.85, 1.15), w = rnd(0.9, 0.97);
    const indoor = f.ceil < 6;
    FXS.smoke.spawn({p:_fpe, v:_fve.set(rnd(-0.2,0.2), rnd(0.9,1.6)*(0.7 + 0.5*I), rnd(-0.2,0.2)), life:rnd(9,15),
      s0:0.7 + 0.6*I, s1:rnd(3.2,5.0)*(1 + 0.4*big)*(indoor ? 0.8 : 1), rot:rnd(0,6.28), spin:rnd(-0.12,0.12),
      col:[g*1.06, g*w, g*w*0.9], a0:lerp(0.3, 0.62, soot), a1:0, aPow:1.5, drag:0.35, g:0.35, turb:0.3, fadeIn:0.5,
      heat:0.6 + 0.6*I, ceil:f.ceil, wind: indoor ? 0.004 : 0.014, seek: f.exit});
  }
  if(Math.random() < (I*6 + big*8)*dt){
    FXS.ember.spawn({p: _fpe.copy(base).add(_fve.set(rnd(-0.3,0.3), rnd(0,0.5), rnd(-0.3,0.3))),
      v:_fve.set(rnd(-0.6,0.6), rnd(1.4,3.6), rnd(-0.6,0.6)), life:rnd(1.2,3.2), s0:rnd(0.02,0.045), s1:0.01,
      col:[1,0.55,0.18], a0:1, a1:0, drag:0.4, turb:2.4, g:-0.2});
  }
}
function spawnEmbers(p, n){
  for(let i=0;i<n;i++) FXS.ember.spawn({p: p.clone(), v:V$1(rnd(-1.5,1.5), rnd(0.5,3), rnd(-1.5,1.5)), life:rnd(0.8,2),
    s0:0.035, s1:0.01, col:[1,0.5,0.15], a0:1, a1:0, g:-6, drag:0.3});
}
/** Свет от пламени: заявки в пул на самые сильные очаги рядом с камерой. */
const _flp = new THREE.Vector3();
function updateLights(t){
  const cam = camera.position;
  // очаги кластеризуются: соседние огни делят один источник
  const ranked = FIRES.filter(f=>f.I>0.05).map(f=>({f, s: f.I/(1 + f.p.distanceTo(cam)*0.15)})).sort((a,b)=>b.s-a.s);
  const used = [];
  for(const r of ranked){
    if(used.length >= FIRE_LIGHTS) break;
    if(used.some(u=>u.p.distanceToSquared(r.f.p) < 2.5)) { continue; }
    used.push(r.f);
  }
  used.forEach((f,i)=>{
    _flp.copy(f.p).addScaledVector(f.n, 0.35); _flp.y += 0.35 + 0.3*f.I;
    const fl = 0.75 + 0.25*Math.sin(t*17 + i*3.1)*Math.sin(t*7.3 + i);
    lightReq(_flp, 0xff8a3a, (2.5 + 8*f.I) * fl, 5 + 6*f.I, 1.8, 2);
  });
}
function fireAt(p, r=0.8){ let s = 0; for(const f of FIRES){ const d = f.p.distanceTo(p); if(d < r) s += f.I*(1-d/r); } return s; }

// Игрок: персонаж Bullet (капсула + шаг по ступеням), полёт-наблюдатель,
// здоровье, контузия, тряска камеры, покачивание, шаги по типу поверхности.

const PL = {
  yaw: 0, pitch: 0, fly: false, hp: 100, alive: true, team: null, spawn: null,
  vel: new THREE.Vector3(), eye: new THREE.Vector3(0, 1.6, 0), crouch: 0, sprint: false,
  shake: 0, recoil: 0, flash: 0, deaf: 0, bob: 0, stepAcc: 0, speed: 0, onGround: true,
  ads: 0, deadT: 0, char: null, flyPos: new THREE.Vector3(), damageFx: 0, lastSurf:'conc'
  , burn: 0, burnT: 0
};
const keys = {};
const EYE = 1.62, EYE_C = 1.05, HALF = 0.87;       // рост глаз и полувысота капсулы
const SENS = 0.0018;
const INPUT = { locked:false, mouseDown:false, rmb:false, onFire:null, onKey:null, capture:null };

/* ---------- настройки и назначение клавиш (localStorage) ---------- */
const ACTIONS = [
  ['fwd','Вперёд','KeyW'], ['back','Назад','KeyS'], ['left','Влево','KeyA'], ['right','Вправо','KeyD'],
  ['jump','Прыжок','Space'], ['crouch','Присесть','KeyC'], ['sprint','Бег','ShiftLeft'], ['slow','Медленно (полёт)','AltLeft'],
  ['reload','Перезарядка','KeyR'], ['frag','Граната','KeyG'], ['molotov','Зажигательная','KeyT'],
  ['use','Дверь (с разбега — выбить)','KeyE'], ['supply','Ящик: пополнить','KeyF'], ['fly','Полёт / ходьба','KeyV'],
  ['menu','Меню / точка','KeyM'], ['phase','Время суток','KeyN'], ['daypause','Пауза суток','KeyP'], ['hints','Подсказки','KeyH']
];
const SET_DEF = { sens:1, ads:0.55, inv:false, fov:72, vol:80, exp:1, tone:'agx', keys:{} };
function loadSettings(){
  try{
    const s = JSON.parse(localStorage.getItem('angar07.settings') || '{}');
    return Object.assign({}, SET_DEF, s, {keys: Object.assign({}, s.keys || {})});
  }catch(e){ return Object.assign({}, SET_DEF, {keys:{}}); }
}
const SET = loadSettings();
function saveSettings(){ try{ localStorage.setItem('angar07.settings', JSON.stringify(SET)); }catch(e){} }
const KEYMAP = {};
function rebuildKeymap(){ for(const [a,,def] of ACTIONS) KEYMAP[a] = SET.keys[a] || def; }
rebuildKeymap();
/** Клавиатура захвачена (полный экран + navigator.keyboard.lock): только тогда
    Ctrl работает как присед — иначе Ctrl+W закрывает вкладку посреди боя. */
const KB = { locked:false };
const MOUSE_CODE = { 1:'Mouse3', 3:'Mouse4', 4:'Mouse5' };
const CTRL = c => c === 'ControlLeft' || c === 'ControlRight';
const down = a => !!keys[KEYMAP[a]] || (a === 'crouch' && KB.locked && !!(keys.ControlLeft || keys.ControlRight));
const isKey = (a, code) => KEYMAP[a] === code || (a === 'crouch' && KB.locked && CTRL(code));
function keyName(code){
  if(!code) return '—';
  const named = { Space:'Space', ShiftLeft:'Shift', ShiftRight:'R-Shift', ControlLeft:'Ctrl', ControlRight:'R-Ctrl', AltLeft:'Alt', AltRight:'R-Alt',
    Tab:'Tab', CapsLock:'Caps', Backquote:'`', Enter:'Enter', Backspace:'Bksp', ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    Mouse3:'СКМ', Mouse4:'Мышь 4', Mouse5:'Мышь 5' };
  if(named[code]) return named[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

function initPlayer(canvas){
  PL.char = makeCharacter(new THREE.Vector3(0, 5, -20), 0.32, 1.1, 0.42);
  addEventListener('keydown', e=>{
    if(INPUT.capture){ e.preventDefault(); INPUT.capture(e.code); return; }
    if(e.code === 'Tab') e.preventDefault();
    if(e.repeat){ if(INPUT.locked && (CTRL(e.code) || e.code === 'Space')) e.preventDefault(); return; }
    keys[e.code] = true;
    if(INPUT.onKey) INPUT.onKey(e.code, e);
    if(INPUT.locked && (e.code === 'Space' || e.code === 'AltLeft' || CTRL(e.code) || e.code === 'Escape')) e.preventDefault();
  });
  addEventListener('keyup', e=>{ keys[e.code] = false; });
  addEventListener('blur', ()=>{ for(const k in keys) keys[k] = false; INPUT.mouseDown = false; INPUT.rmb = false; });
  document.addEventListener('pointerlockchange', ()=>{ INPUT.locked = document.pointerLockElement === canvas; if(INPUT.onLock) INPUT.onLock(INPUT.locked); });
  // Chrome примерно секунду после Esc отказывает в повторном захвате курсора:
  // без этого обработчика меню закрывалось, а мышь оставалась свободной.
  document.addEventListener('pointerlockerror', ()=>{ INPUT.locked = false; if(INPUT.onLockError) INPUT.onLockError(); });
  document.addEventListener('mousemove', e=>{
    if(!INPUT.locked) return;
    const k = SENS * SET.sens * lerp(1, SET.ads, PL.ads) * (camera.fov / SET.fov);
    PL.yaw -= e.movementX * k; PL.pitch = clamp(PL.pitch - e.movementY * k * (SET.inv ? -1 : 1), -1.55, 1.55);
  });
  canvas.addEventListener('mousedown', e=>{ if(!INPUT.locked) return; if(e.button===0) INPUT.mouseDown = true; if(e.button===2) INPUT.rmb = true;
    const code = MOUSE_CODE[e.button]; if(code){ keys[code] = true; if(INPUT.onKey) INPUT.onKey(code, e); } });
  addEventListener('mouseup', e=>{ if(e.button===0) INPUT.mouseDown = false; if(e.button===2) INPUT.rmb = false;
    const code = MOUSE_CODE[e.button]; if(code) keys[code] = false; });
  canvas.addEventListener('contextmenu', e=> e.preventDefault());
}
/** Появление в точке: капсула ставится на пол, взгляд — в сторону поля. */
function spawnAt(sp, faceYaw){
  PL.hp = 100; PL.alive = true; PL.deadT = 0; PL.vel.set(0,0,0); PL.fly = false;
  PL.char.enable(true);
  PL.char.warp(new THREE.Vector3(sp.x, 0.1 + HALF + 0.05, sp.z));
  PL.yaw = faceYaw; PL.pitch = -0.04;
  PL.eye.set(sp.x, EYE, sp.z);
}
function setFly(on){
  if(on === PL.fly) return;
  PL.fly = on;
  if(on){ PL.flyPos.copy(camera.position); PL.char.enable(false); }
  else { PL.char.enable(true); PL.char.warp(new THREE.Vector3(camera.position.x, camera.position.y - EYE + HALF + 0.1, camera.position.z)); }
}
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3(), cpos = new THREE.Vector3();
const _e = new THREE.Euler(0,0,0,'YXZ'), _look = new THREE.Vector3(), _mv = new THREE.Vector3();
function updatePlayer(dt, t){
  PL.shake = Math.max(0, PL.shake - dt*1.6);
  PL.flash = Math.max(0, PL.flash - dt*0.5);
  PL.deaf = Math.max(0, PL.deaf - dt*0.25);
  PL.damageFx = Math.max(0, PL.damageFx - dt*1.5);
  PL.recoil *= Math.exp(-dt*9);
  PL.ads = lerp(PL.ads, INPUT.rmb && PL.alive && !PL.fly ? 1 : 0, 1 - Math.exp(-dt*14));
  fwd.set(-Math.sin(PL.yaw), 0, -Math.cos(PL.yaw));
  right.set(-fwd.z, 0, fwd.x);
  wish.set(0,0,0);
  if(PL.alive){
    if(down('fwd')) wish.add(fwd); if(down('back')) wish.sub(fwd);
    if(down('right')) wish.add(right); if(down('left')) wish.sub(right);
  }
  if(wish.lengthSq() > 0) wish.normalize();
  if(PL.fly){
    // свободный полёт: вперёд по взгляду, вверх/вниз клавишами
    const sp = (down('sprint') ? 22 : down('slow') ? 2.5 : 8);
    const look = _look.set(0,0,-1).applyEuler(_e.set(PL.pitch, PL.yaw, 0));
    const mv = _mv.set(0,0,0);
    if(down('fwd')) mv.add(look); if(down('back')) mv.sub(look);
    if(down('right')) mv.add(right); if(down('left')) mv.sub(right);
    if(down('jump')) mv.y += 1; if(down('crouch')) mv.y -= 1;
    if(mv.lengthSq()>0) mv.normalize().multiplyScalar(sp);
    PL.vel.lerp(mv, 1 - Math.exp(-dt*6));
    PL.flyPos.addScaledVector(PL.vel, dt);
    PL.speed = PL.vel.length();
    camera.position.copy(PL.flyPos);
  } else {
    const crouching = down('crouch') && PL.alive;
    PL.crouch = lerp(PL.crouch, crouching ? 1 : 0, 1 - Math.exp(-dt*10));
    PL.sprint = down('sprint') && !crouching && PL.ads < 0.3 && wish.dot(fwd) > 0.3;
    const maxS = crouching ? 2.1 : (PL.sprint ? 6.6 : 4.3) * (1 - PL.ads*0.4);
    const onG = PL.char.onGround();
    const accel = onG ? 12 : 2.5;
    PL.vel.x = lerp(PL.vel.x, wish.x*maxS, 1 - Math.exp(-dt*accel));
    PL.vel.z = lerp(PL.vel.z, wish.z*maxS, 1 - Math.exp(-dt*accel));
    PL.char.setWalk(PL.vel.x/90, PL.vel.z/90);
    if(down('jump') && onG && PL.alive && !PL._jumpHeld){ PL.char.jump(); PL._jumpHeld = true; }
    if(!down('jump')) PL._jumpHeld = false;
    PL.char.pos(cpos);
    const feet = cpos.y - HALF;
    PL.speed = Math.hypot(PL.vel.x, PL.vel.z);
    PL.onGround = onG;
    // покачивание и шаги
    if(onG && PL.speed > 0.6){
      PL.bob += dt * (PL.sprint ? 13 : 9.5) * (crouching ? 0.7 : 1);
      PL.stepAcc += PL.speed*dt;
      const stride = PL.sprint ? 1.9 : 1.45;
      if(PL.stepAcc > stride){ PL.stepAcc = 0; footstep(cpos, crouching ? 0.4 : (PL.sprint ? 1.2 : 0.8)); }
    } else PL.bob = lerp(PL.bob, Math.round(PL.bob/Math.PI)*Math.PI, 1 - Math.exp(-dt*6));
    if(!PL._wasGround && onG && PL._fallV < -6) footstep(cpos, 1.4);
    PL._fallV = onG ? 0 : Math.min(PL._fallV||0, -1) - dt*19;
    PL._wasGround = onG;
    const eyeH = lerp(EYE, EYE_C, PL.crouch) - (PL.alive ? 0 : 1.25);
    const bobY = Math.abs(Math.sin(PL.bob))*0.045*(PL.speed/4.3) * (1-PL.ads*0.8);
    // сглаживание высоты камеры: ступени не дёргают взгляд
    const ty = feet + eyeH - bobY;
    PL.eye.x = cpos.x; PL.eye.z = cpos.z;
    PL.eye.y = Math.abs(ty - PL.eye.y) > 0.6 ? ty : lerp(PL.eye.y, ty, 1 - Math.exp(-dt*18));
    camera.position.copy(PL.eye);
    camera.position.addScaledVector(right, Math.cos(PL.bob*0.5)*0.02*(PL.speed/4.3)*(1-PL.ads));
    if(cpos.y < -10) hurt(1000, 'fall');
  }
  // ориентация: взгляд + отдача + тряска
  const sh = PL.shake*PL.shake;
  const sx = (Math.sin(t*37.1)+Math.sin(t*23.7))*0.5*sh*0.05, sy = (Math.sin(t*31.3)+Math.cos(t*19.9))*0.5*sh*0.05;
  _e.set(PL.pitch + PL.recoil*0.9 + sx, PL.yaw + sy, (Math.sin(t*27.0))*sh*0.03 + (PL.alive?0:0.5), 'YXZ');
  camera.quaternion.setFromEuler(_e);
  const fovT = lerp(SET.fov, SET.fov*0.69, PL.ads) + (PL.sprint ? 4 : 0);
  if(Math.abs(camera.fov - fovT) > 0.05){ camera.fov = lerp(camera.fov, fovT, 1 - Math.exp(-dt*12)); camera.updateProjectionMatrix(); }
}
function footstep(c, k){
  const h = rayFirst(c, new THREE.Vector3(c.x, c.y - 1.3, c.z), GRP.STATIC);
  let surf = 'conc';
  if(h){ if(h.idx >= 0){ const o = PH.owners[h.idx]; surf = o && (o.type==='sheet'||o.type==='beam'||o.type==='prop') ? 'wood' : 'conc'; }
         else surf = SURF_NAME[h.idx] || 'conc'; }
  PL.lastSurf = surf;
  SND.step(surf === 'sand' ? 'conc' : surf, k);
  // пыль из-под подошвы на бетоне; на бегу и при приземлении — заметнее
  if((surf === 'conc' || surf === 'sand') && k >= 0.8 && h){
    for(let i=0;i<(k > 1 ? 3 : 1);i++) FXS.dust.spawn({p: _fpe.set(c.x + rnd(-0.15,0.15), h.p.y + 0.05, c.z + rnd(-0.15,0.15)),
      v: _fve.set(PL.vel.x*0.15 + rnd(-0.3,0.3), rnd(0.05,0.25), PL.vel.z*0.15 + rnd(-0.3,0.3)), life: rnd(1.2,2.2),
      s0: 0.12, s1: 0.55*k, col:[0.62,0.6,0.56], a0: 0.1*k, a1: 0, drag: 2.5, fadeIn: 0.05});
  }
}
/** Урон игроку. */
const DEATH_BY = { fire:'сгорел', blast:'погиб от взрыва', fall:'разбился' };
function hurt(dmg, kind, from){
  if(!PL.alive || PL.fly) return;
  PL.hp -= dmg; PL.damageFx = Math.min(1, PL.damageFx + dmg/40);
  if(from && dmg > 1) damageFrom(from);
  if(PL.hp <= 0){
    PL.hp = 0; PL.alive = false; PL.deadT = 0; PL.killedBy = kind;
    SUPPLY.busy = false; WPN.reloadT = 0;
    feed(`<b>${PL.team || 'Игрок'}</b> ${DEATH_BY[kind] || 'выбыл'}`);
  }
}

// Оружие: автомат (хитскан с пробитием дерева), осколочная граната (тело
// Bullet с запалом), зажигательная бутылка. Взрывы: огненный шар, ударная
// волна, воронка в бетоне, гарь на стенах, дым, пожар.

const V = (x=0,y=0,z=0)=> new THREE.Vector3(x,y,z);
// Боезапас конечный: 30 в магазине + 4 магазина, 2 осколочные, 1 зажигательная.
// Пополнение — только у ящика на базе (клавиша F).
const WPN = { mag:30, magMax:30, reserve:120, reserveMax:120, reloadT:0, reloadDur:2.4, cool:0, fired:0,
  frags:2, fragsMax:2, fire:1, fireMax:1, nadeCool:0, viewmodel:null, kick:0, stats:{shots:0, hits:0} };
const RELOAD_EMPTY = 2.9, RELOAD_TAC = 2.3;
function startReload(){
  if(WPN.reloadT > 0 || WPN.mag >= WPN.magMax || WPN.reserve <= 0) return false;
  WPN.reloadDur = WPN.mag > 0 ? RELOAD_TAC : RELOAD_EMPTY;
  WPN.reloadT = WPN.reloadDur; SND.reload && SND.reload(WPN.mag > 0);
  return true;
}
function finishReload(){
  const need = WPN.magMax - WPN.mag, take = Math.min(need, WPN.reserve);
  WPN.mag += take; WPN.reserve -= take;
}
const GRENADES = [];

/* ---------- модель автомата от первого лица ---------- */
function buildViewmodel(){
  // современный автомат в чёрном полимере с коллиматором: тёмные матовые
  // поверхности читаются реалистичнее, чем яркое дерево
  const G = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({color:0x17181a, roughness:.42, metalness:.7, envMapIntensity:1.0});
  const poly  = new THREE.MeshStandardMaterial({color:0x222321, roughness:.78, metalness:.05, envMapIntensity:.6});
  const tan   = new THREE.MeshStandardMaterial({color:0x5b5443, roughness:.8, metalness:.02});
  const add = (geo, mat, x,y,z, rx=0,ry=0,rz=0)=>{ const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z); m.rotation.set(rx,ry,rz); G.add(m); return m; };
  add(roundedBox(0.046, 0.07, 0.3, 0.008, 2), metal, 0, 0, 0);                        // ствольная коробка
  add(new THREE.BoxGeometry(0.03, 0.012, 0.36), metal, 0, 0.041, -0.05);              // планка
  for(let i=0;i<14;i++) add(new THREE.BoxGeometry(0.034, 0.006, 0.008), metal, 0, 0.049, 0.1 - i*0.024);
  add(roundedBox(0.056, 0.058, 0.24, 0.014, 2), poly, 0, 0.004, -0.27);                // цевьё
  add(new THREE.CylinderGeometry(0.0085, 0.0085, 0.2, 10), metal, 0, 0.01, -0.47, Math.PI/2);   // ствол
  add(new THREE.CylinderGeometry(0.016, 0.014, 0.07, 10), metal, 0, 0.01, -0.6, Math.PI/2);     // ДТК
  // коллиматор
  // коллиматор: полая рамка-тубус, сквозь которую видно цель, точка — на стекле
  add(new THREE.BoxGeometry(0.03, 0.012, 0.05), metal, 0, 0.052, -0.02);            // основание
  add(new THREE.BoxGeometry(0.036, 0.005, 0.06), metal, 0, 0.0965, -0.02);           // верх
  for(const sx of [-1,1]) add(new THREE.BoxGeometry(0.005, 0.04, 0.06), metal, sx*0.0155, 0.076, -0.02);
  add(new THREE.PlaneGeometry(0.027, 0.036), new THREE.MeshStandardMaterial({color:0x6a8fa0, roughness:.05, metalness:.5,
    transparent:true, opacity:.18, depthWrite:false}), 0, 0.076, -0.045);
  const dot = add(new THREE.CircleGeometry(0.0011, 10), new THREE.MeshBasicMaterial({color:0xff2a1a, depthTest:false}), 0, 0.075, -0.044);
  dot.userData.dot = true;
  // магазин — отдельная группа: при перезарядке его отстёгивают и меняют
  const mag = new THREE.Group(); mag.position.set(0, -0.04, -0.055); G.add(mag);
  { const parts = [];
    for(let i=0;i<3;i++){ const g = roundedBox(0.028, 0.07, 0.056, 0.006, 1); g.rotateX(-0.33 - i*0.1); g.translate(0, -0.028 - i*0.056, 0.005 + i*0.02); parts.push(g); }
    const m = new THREE.Mesh(mergeParts(parts), tan); mag.add(m); }
  G.userData.mag = mag; G.userData.magRest = mag.position.clone();
  // руки в перчатках: правая на рукояти, левая под цевьём
  const glove = new THREE.MeshStandardMaterial({color:0x2b2c2a, roughness:.92, metalness:0});
  const sleeve = new THREE.MeshStandardMaterial({color:0x3d4036, roughness:.95, metalness:0});
  // предплечье уходит от запястья вниз-назад, к краю кадра (ось цилиндра — Y)
  const hand = (fingersForward, armDir)=>{
    const H = new THREE.Group();
    const palm = new THREE.Mesh(roundedBox(0.05, 0.085, 0.095, 0.02, 2), glove); H.add(palm);
    const fing = new THREE.Mesh(roundedBox(0.056, 0.03, 0.075, 0.012, 1), glove); fing.position.set(0, fingersForward ? 0.045 : -0.04, -0.01); H.add(fing);
    const thumb = new THREE.Mesh(roundedBox(0.022, 0.022, 0.06, 0.009, 1), glove); thumb.position.set(-0.03, 0.03, -0.03); thumb.rotation.y = 0.4; H.add(thumb);
    const d = new THREE.Vector3(...armDir).normalize();
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 12), glove);
    cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d); cuff.position.copy(d).multiplyScalar(0.06); H.add(cuff);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.044, 0.36, 12), sleeve);
    arm.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d); arm.position.copy(d).multiplyScalar(0.26); H.add(arm);
    return H;
  };
  const rh = hand(false, [0.25, -0.8, 0.55]); rh.position.set(0.012, -0.075, 0.1); rh.rotation.set(0.3, 0, 0.12); G.add(rh);
  const lh = hand(true, [-0.45, -0.75, 0.5]); lh.position.set(-0.012, -0.04, -0.28); lh.rotation.set(-0.15, 0, -0.35); G.add(lh);
  G.userData.lh = lh; G.userData.lhRest = lh.position.clone(); G.userData.lhRot = lh.rotation.clone();
  add(roundedBox(0.034, 0.095, 0.042, 0.01, 2), poly, 0, -0.066, 0.1, 0.32);
  add(new THREE.BoxGeometry(0.008, 0.028, 0.045), metal, 0, -0.042, 0.045);
  add(roundedBox(0.04, 0.07, 0.17, 0.014, 2), poly, 0, -0.03, 0.22, 0.08);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({map:FXS.flash.mesh.material.uniforms.map.value,
    color:0xffc07a, transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0}));
  flash.position.set(0, 0.01, -0.68); G.add(flash);
  const flash2 = flash.clone(); flash2.rotation.y = Math.PI/2; flash2.material = flash.material; G.add(flash2);
  G.userData.flash = flash.material; G.userData.flashMesh = flash;
  G.traverse(o=>{ if(o.isMesh){ o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; o.renderOrder = 10; } });
  // детали одного материала сливаются: 27 вызовов отрисовки → 7
  const groups = new Map();
  for(const m of [...G.children]){
    if(!m.isMesh || m.userData.dot || m.material.transparent || !m.geometry.index) continue;   // группы (магазин, руки) не сливаются
    if(!groups.has(m.material)) groups.set(m.material, []);
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    for(const k of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(k)) g.deleteAttribute(k);
    groups.get(m.material).push(g); G.remove(m);
  }
  for(const [mat, list] of groups){
    const mm = new THREE.Mesh(BGU.mergeGeometries(list, false), mat);
    mm.castShadow = false; mm.receiveShadow = false; mm.frustumCulled = false; mm.renderOrder = 10; G.add(mm);
  }
  G.userData.nomerge = true;
  G.traverse(o=>{ if(o.isMesh) o.layers.set(LAYER_VM); });
  camera.add(G);
  return G;
}
/* ---------- горящий персонаж: языки пламени по низу обзора ----------
   Одна отрисовка: полосы-квады перед камерой, анимация в вершинном шейдере. */
const BURN_FX = {
  mesh:null, u:null, el:null, msg:null, k:0,
  build(){
    const N = 16, pos = [], uv = [], ph = [], idx = [];
    for(let i=0;i<N;i++){
      const a = i/(N-1)*2 - 1, side = Math.abs(a);
      // нижний край кадра на дистанции 0.42 — y ≈ −0.305 (вертикальный FOV 72°)
      const x = a*0.52 + rnd(-0.03,0.03), y0 = -0.32;
      const w = 0.1 + side*0.08 + rnd(0,0.05), h = 0.1 + side*0.15 + rnd(0,0.05);
      const b = i*4, p = rnd(0, 60);
      pos.push(x-w/2,y0,-0.42, x+w/2,y0,-0.42, x+w/2,y0+h,-0.42, x-w/2,y0+h,-0.42);
      uv.push(0,0, 1,0, 1,1, 0,1); ph.push(p,p,p,p);
      idx.push(b,b+1,b+2, b,b+2,b+3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    g.setAttribute('aPh', new THREE.Float32BufferAttribute(ph,1));
    g.setIndex(idx);
    this.u = { map:{value:FX.flame}, uT:{value:0}, uK:{value:0} };
    const mat = new THREE.ShaderMaterial({ uniforms:this.u, transparent:true, depthTest:false, depthWrite:false,
      blending:THREE.AdditiveBlending,
      vertexShader:`
        attribute float aPh; uniform float uT, uK; varying vec2 vUv; varying float vPh;
        void main(){
          vUv = uv; vPh = aPh; vec3 p = position;
          float fl = 0.65 + 0.35*sin(uT*9.0 + aPh)*sin(uT*5.3 + aPh*1.7);
          p.y += uv.y*(fl*uK - 1.0)*0.07;
          p.x += uv.y*sin(uT*4.0 + aPh*2.3)*0.03;
          gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0);
        }`,
      fragmentShader:`
        uniform sampler2D map; uniform float uT, uK; varying vec2 vUv; varying float vPh;
        void main(){
          vec2 q = vUv; q.x += sin(q.y*9.0 - uT*11.0 + vPh)*0.06*q.y;
          vec4 t = texture2D(map, q);
          gl_FragColor = vec4(t.rgb*vec3(1.0,0.78,0.55), t.a*uK*0.85);
        }`
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 12; this.mesh.visible = false;
    this.mesh.userData.nomerge = true; this.mesh.layers.set(LAYER_VM);
    camera.add(this.mesh);
    this.el = $('#burn'); this.msg = $('#burnmsg');
  },
  set(k, t){
    if(!this.mesh) return;
    this.k = k;
    this.mesh.visible = k > 0.02;
    this.u.uK.value = k; this.u.uT.value = t;
    if(this.el) this.el.style.opacity = k > 0.02 ? (k*(0.75 + 0.25*Math.sin(t*13)*Math.sin(t*5.1))).toFixed(3) : 0;
    if(this.msg) this.msg.style.opacity = k > 0.1 ? 1 : 0;
  }
};
function initWeapons(){
  WPN.viewmodel = buildViewmodel();
  BURN_FX.build();
  HOOKS.barrel = p => barrelExplode(p);
  HOOKS.leak = (p, at)=> later(0.4 + Math.random()*0.8, ()=>{ if(!p.dead) addFire(V(p.center.x, p.center.y+0.2, p.center.z), {t:'p', p}, {I:0.6, fuel:30}); });
}
const _dir = V(), _org = V(), _to = V(), _end = V(), _mz = V(), _tmp = V(), _su = V(), _sv = V(), _up = V(0,1,0);
const _seen = new Set();
/** Отклонение внутри конуса с углом a: точка равномерно в круге, а не в кубе
    (шум по каждой координате давал «квадратный» разброс). */
function coneJitter(dir, a){
  if(a <= 0) return dir;
  _su.crossVectors(Math.abs(dir.y) < 0.99 ? _up : _tmp.set(1,0,0), dir).normalize();
  _sv.crossVectors(dir, _su);
  const r = Math.tan(a) * Math.sqrt(Math.random()), phi = Math.random()*Math.PI*2;
  return dir.addScaledVector(_su, Math.cos(phi)*r).addScaledVector(_sv, Math.sin(phi)*r).normalize();
}
/* ---------- выстрел ---------- */
function shoot(){
  WPN.mag--; WPN.cool = 1/11; WPN.fired++; WPN.stats.shots++;
  camera.getWorldPosition(_org);
  camera.getWorldDirection(_dir);
  const moving = clamp(PL.speed/4.3, 0, 1.5);
  // полуугол конуса, рад: стоя ~0.15°, в движении и в прыжке — заметно шире
  const spread = (0.0025 + moving*0.012 + (PL.onGround?0:0.03)) * (1 - PL.ads*0.8) + Math.min(WPN.kick, 1)*0.01;
  coneJitter(_dir, spread);
  _to.copy(_org).addScaledVector(_dir, 160);
  const hits = rayAll(_org, _to, GRP.STATIC|GRP.DYN|GRP.DEBRIS);
  let power = 1.0, hitKind = 0;
  _end.copy(_to);
  _seen.clear();
  for(const h of hits){
    if(h.idx === -10) continue;                       // сам игрок
    const key = h.idx >= 0 ? h.idx : 'st'+h.p.x.toFixed(2)+h.p.z.toFixed(2);
    if(_seen.has(key) && h.idx >= 0) continue; _seen.add(key);
    const r = bulletHit(h, _dir, power);
    if(r.feedback) hitKind = Math.max(hitKind, r.feedback);
    power -= r.cost;
    if(r.stop || power < 0.15){ _end.copy(h.p); break; }
  }
  if(hitKind) hitFeedback(hitKind);
  // дерево, пробитое насквозь, оставляет выходные отверстия — это делает bulletHit
  // трассер: каждый третий патрон
  muzzleWorld(_mz);
  if(WPN.fired % 3 === 0){
    const L = _tmp.copy(_end).sub(_mz).length();
    _tmp.divideScalar(Math.max(L, 1e-3));
    FXS.spark.spawn({p: _su.copy(_mz).addScaledVector(_tmp, 0.3), v: _sv.copy(_tmp).multiplyScalar(260), life: Math.min(0.5, L/260), s0:0.05, s1:0.04, col:[1,0.8,0.5], a0:1, a1:0.6, drag:0});
  }
  // вспышка, отдача, звук
  WPN.viewmodel.userData.flash.opacity = 1; WPN.viewmodel.userData.flashMesh.rotation.z = Math.random()*3;
  FXS.flashes.fire(_mz, 0xffb060, 4, 7, 0.06);
  PL.recoil += 0.012 + rnd(0, 0.006)*(1-PL.ads*0.5);
  PL.yaw += rnd(-25e-4, 0.0025);
  WPN.kick = Math.min(WPN.kick + 0.35, 2);
  SND.shot(null, true);
  // пороховой дым: быстро рассеивается у ствола, но после очереди висит облачком
  FXS.smoke.spawn({p:_mz, v:_tmp.copy(_dir).multiplyScalar(0.8).add(_sv.set(0,0.25,0)), life:rnd(2.2,3.5), s0:0.06, s1:0.75, col:[0.62,0.61,0.6], a0:0.22, a1:0, aPow:0.7, drag:2.2, turb:0.25, g:0.05});
  // гильза
  _su.set(0.06, 0.02, -0.05).applyQuaternion(camera.quaternion).add(camera.position);
  _sv.set(0.9,1.2,0.2).applyQuaternion(camera.quaternion).add(_tmp.set(rnd(-0.3,.3),rnd(0,.4),rnd(-0.3,.3)));
  FXS.casings.spawn(_su, _sv, CASE_SIZE, floorBelow(_su), 120);
}
const CASE_SIZE = V(0.0092, 0.039, 0.0092);
function muzzleWorld(out = V()){ return out.set(0.0, 0.01, -0.66).applyMatrix4(WPN.viewmodel.matrixWorld); }

/* ---------- граната ---------- */
// Геометрия и материалы снарядов общие: раньше каждый бросок создавал новые
// и не освобождал их — память росла с каждой гранатой.
let NADE = null;
function nadeAssets(){
  if(NADE) return NADE;
  const body = new THREE.SphereGeometry(0.045, 12, 10); body.scale(1, 1.25, 1);
  NADE = {
    frag: body, fragMat: cmat(0x3d4430, {roughness:.7, metalness:.3}),
    lever: new THREE.BoxGeometry(0.012, 0.07, 0.02),
    bottle: new THREE.CylinderGeometry(0.04, 0.045, 0.22, 10),
    bottleMat: new THREE.MeshStandardMaterial({color:0x3f5a2a, roughness:.1, metalness:.1, transparent:true, opacity:.8}),
    rag: new THREE.CylinderGeometry(0.015, 0.02, 0.08, 6), ragMat: cmat(0xd9c9a0,{roughness:1})
  };
  return NADE;
}
function throwNade(kind){
  camera.getWorldDirection(_dir);
  const p = V(0.18, -0.1, -0.4).applyMatrix4(camera.matrixWorld);
  const A_ = nadeAssets();
  let mesh;
  if(kind === 'frag'){
    mesh = new THREE.Mesh(A_.frag, A_.fragMat);
    const lever = new THREE.Mesh(A_.lever, M.steel); lever.position.set(0.035, 0.03, 0); mesh.add(lever);
  } else {
    mesh = new THREE.Mesh(A_.bottle, A_.bottleMat);
    const rag = new THREE.Mesh(A_.rag, A_.ragMat); rag.position.y = 0.14; mesh.add(rag);
  }
  mesh.castShadow = true; mesh.position.copy(p); scene.add(mesh);
  const speed = kind === 'frag' ? 14 : 12;
  const vel = _dir.clone().multiplyScalar(speed).add(V(0, 2.2, 0)).add(PL.vel.clone().multiplyScalar(0.8));
  const rec = addDynamic(mesh, { shape: kind==='frag' ? 'sphere' : 'box', radius:0.05, size:[0.09,0.22,0.09],
    mass: kind==='frag' ? 0.4 : 0.7, vel, spin:V(rnd(-10,10),rnd(-10,10),rnd(-10,10)), restitution: kind==='frag'?0.38:0.1,
    friction:0.7, rolling:0.08, ccd:0.04, life:30, group:GRP.PROJ, surf:'metal', keep:true });
  rec.kind = kind; rec.fuse = kind==='frag' ? 3.2 : 9;
  rec.isNade = true;
  GRENADES.push(rec);
  SND.click();
}
/** Удар о препятствие: бутылка бьётся сразу, граната звякает. */
function onContact(p, imp, rec){
  if(rec.isNade){
    if(rec.kind === 'fire' && rec.age > 0.05 && !rec.done){ rec.done = true; molotov(rec); }
    else if(rec.kind === 'frag' && imp > 0.05) SND.bounce(p);
    return;
  }
  if(imp > 0.6) SND.thud(p, imp, rec.surf);
}
function molotov(rec, p){
  const at = rec.mesh.position.clone();
  killDynamic(rec); GRENADES.splice(GRENADES.indexOf(rec),1);
  SND.glass(at, 8);
  for(let i=0;i<14;i++) FXS.glassChips.spawn(at, V(rnd(-2,2),rnd(0.5,2.5),rnd(-2,2)), V(rnd(0.02,0.05),rnd(0.02,0.05),1), floorBelow(at), 8);
  for(let i=0;i<24;i++) FXS.fireball.spawn({p:at.clone().add(V(rnd(-0.3,.3),rnd(0,.3),rnd(-0.3,.3))), v:V(rnd(-2.5,2.5), rnd(0.5,3), rnd(-2.5,2.5)),
    life:rnd(0.4,0.9), s0:rnd(0.3,0.6), s1:rnd(0.6,1.1), col:[1,0.65,0.3], a0:0.9, a1:0, drag:2.5});
  FXS.flashes.fire(at, 0xff8a3a, 20, 10, 0.8);
  ignite(at, 1.0, 2.2, true);
  ignitePlayer(at, 2.4, 1);
}
/* ---------- взрыв ---------- */
const CRATERS = [];
let _craterPlane = null;
const CHUNK_S = [0.07, 0.1, 0.13, 0.16], _chunkGeo = [];
function blastFX(p, big=1){
  shockwave(p, big);
  FXS.flashes.fire(p.clone().add(V(0,0.4,0)), 0xffb070, 90*big, 22*big, 0.35);
  FXS.flash.spawn({p: p.clone().add(V(0,0.3,0)), life:0.12, s0:4*big, s1:6*big, col:[1,0.85,0.6], a0:1, a1:0});
  for(let i=0;i<Math.round(28*big);i++){
    const d = V(rnd(-1,1), rnd(-0.2,1), rnd(-1,1)).normalize();
    FXS.fireball.spawn({p: p.clone().addScaledVector(d, rnd(0,0.4)), v: d.multiplyScalar(rnd(3,9)*big), life:rnd(0.25,0.6),
      s0:rnd(0.6,1.2)*big, s1:rnd(1.2,2.2)*big, col:[1, rnd(0.55,0.75), 0.3], a0:1, a1:0, drag:6, rot:rnd(0,6), spin:rnd(-2,2)});
  }
  for(let i=0;i<Math.round(40*big);i++){
    const d = V(rnd(-1,1), rnd(0,1.2), rnd(-1,1)).normalize();
    FXS.spark.spawn({p: p.clone(), v: d.multiplyScalar(rnd(8,26)), life:rnd(0.3,0.9), s0:0.05, s1:0.015, col:[1,0.75,0.35], a0:1, a1:0, g:-9.8, drag:0.6});
  }
  // дым тротила — тёмно-серый с бурым, горячий снизу; уходит вверх и копится под перекрытием
  const ceil = fireCeil(p);
  for(let i=0;i<Math.round(18*big);i++){
    const d = V(rnd(-1,1), rnd(0.1,1), rnd(-1,1)).normalize(); const g = rnd(0.1,0.22);
    FXS.smoke.spawn({p: p.clone().addScaledVector(d, rnd(0.2,0.8)), v: d.multiplyScalar(rnd(1,4)).add(V(0,1,0)), life:rnd(7,12),
      s0:rnd(0.8,1.4)*big, s1:rnd(3.5,5.5)*big, col:[g*1.06,g,g*0.88], a0:0.75, a1:0, aPow:1.6, drag:1.2, g:0.18, turb:0.4, fadeIn:0.1,
      heat:1.3, ceil, wind:0.01});
  }
  const fy = floorBelow(p);
  if(p.y - fy < 1.2){
    // пыль кольцом по полу
    for(let i=0;i<18;i++){ const a = i/18*Math.PI*2;
      FXS.dust.spawn({p: V(p.x, fy+0.2, p.z), v: V(Math.cos(a)*rnd(4,7), rnd(0.2,0.8), Math.sin(a)*rnd(4,7)), life:rnd(2.5,4.5),
        s0:0.6, s1:2.4, col:[0.62,0.6,0.56], a0:0.5, a1:0, drag:2.2, fadeIn:0.05}); }
  }
  // с ферм и кровли от удара сыплется пыль
  for(let i=0;i<Math.round(14*big);i++){
    const q = V(p.x + rnd(-6,6), rnd(7.5,9.5), p.z + rnd(-6,6));
    FXS.dust.spawn({p:q, v:V(rnd(-0.1,0.1), rnd(-0.6,-0.2), rnd(-0.1,0.1)), life:rnd(4,7), s0:0.3, s1:1.6,
      col:[0.7,0.68,0.64], a0:0.22, a1:0, drag:0.3, g:-0.15, fadeIn:0.8});
  }
  SND.explosion(p, big);
}
function grenadeExplode(p, big=1){
  blastFX(p, big);
  const fy = floorBelow(p);
  const floorHit = rayFirst(V(p.x, p.y+0.1, p.z), V(p.x, p.y-2, p.z), GRP.STATIC);
  const onConcrete = floorHit && floorHit.idx < 0 && (SURF_NAME[floorHit.idx]==='conc') && p.y - fy < 0.6;
  if(onConcrete) crater(V(p.x, fy, p.z), big);
  scorch(p, big);
  explode(p, {radius: 6*big, power: big});
}
/** Воронка в бетоне: выбитая чаша (декаль с нормалями), вал крошки, куски плиты. */
function crater(p, big){
  const R = rnd(1.0, 1.35)*big;
  if(!_craterPlane) _craterPlane = new THREE.PlaneGeometry(1, 1);
  const dec = new THREE.Mesh(_craterPlane, M.crater);
  dec.scale.set(R*2, R*2, 1); dec.userData.sharedGeo = true;
  dec.rotation.x = -Math.PI/2; dec.rotation.z = rnd(0,6.28); dec.position.set(p.x, p.y+0.006, p.z);
  dec.receiveShadow = true; dec.renderOrder = 1; dec.userData.nomerge = true; scene.add(dec);
  // вал выброса: неровные куски бетона по кольцу, один меш
  const parts = [];
  const n = 22;
  for(let i=0;i<n;i++){
    const a = i/n*Math.PI*2 + rnd(-0.1,0.1), rr = R*rnd(0.5,0.78);
    const g = new THREE.DodecahedronGeometry(rnd(0.05,0.13)*big, 0);
    g.scale(rnd(0.8,1.6), rnd(0.4,0.8), rnd(0.8,1.4)); g.rotateY(rnd(0,6.28));
    g.translate(p.x + Math.cos(a)*rr, p.y + 0.02, p.z + Math.sin(a)*rr);
    for(const k of Object.keys(g.attributes)) if(!['position','normal','uv'].includes(k)) g.deleteAttribute(k);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const rim = new THREE.Mesh(BGU.mergeGeometries(parts, false), M.conc);
  rim.castShadow = true; rim.receiveShadow = true; rim.userData.nomerge = true; scene.add(rim);
  CRATERS.push(dec, rim);
  while(CRATERS.length > 32){ const o = CRATERS.shift(); o.removeFromParent(); if(!o.userData.sharedGeo) o.geometry.dispose(); }
  // куски плиты — телами, крошка — частицами
  for(let i=0;i<Math.round(5*big);i++){
    const gi = Math.floor(Math.random()*CHUNK_S.length), s = CHUNK_S[gi];
    if(!_chunkGeo[gi]) _chunkGeo[gi] = new THREE.DodecahedronGeometry(s, 0);
    const m = new THREE.Mesh(_chunkGeo[gi], M.conc);
    m.position.set(p.x + rnd(-0.3,0.3), p.y + 0.15, p.z + rnd(-0.3,0.3)); m.castShadow = true; scene.add(m);
    addDynamic(m, {shape:'sphere', radius:s*0.85, mass: s*s*s*2400*4, vel:V(rnd(-5,5), rnd(4,9), rnd(-5,5)), spin:V(rnd(-9,9),rnd(-9,9),rnd(-9,9)),
      life: sr(30,50), surf:'conc', group:GRP.DEBRIS, restitution:0.25});
  }
  for(let i=0;i<30;i++) FXS.concChips.spawn(V(p.x, p.y+0.1, p.z), V(rnd(-5,5), rnd(3,10), rnd(-5,5)), rnd(0.015,0.05), p.y, rnd(8,20));
}
/** Гарь на ближайших поверхностях. */
function scorch(p, big){
  for(const d of [V(0,-1,0), V(1,0,0), V(-1,0,0), V(0,0,1), V(0,0,-1), V(0,1,0)]){
    const h = rayFirst(p, p.clone().addScaledVector(d, 2.2*big), GRP.STATIC);
    if(!h) continue;
    const k = 1 - h.f;
    FXS.decals.add(h.p, h.n, (2.4 + rnd(0,0.8))*big*(0.5+k*0.5), 4, null);
  }
}
let _shellGeo = null;
function barrelExplode(p){
  const c = p.center.clone();
  later(0.06, ()=>{
    blastFX(c, 1.3);
    explode(c, {radius: 7, power: 1.25, fire: 1.0});
    const fy = floorBelow(c);
    for(let i=0;i<5;i++) addFire(V(c.x + rnd(-1.5,1.5), fy+0.02, c.z + rnd(-1.5,1.5)), null, {I:0.9, fuel:rnd(14,26)});
    ignitePlayer(c, 3.6, 1);
    scorch(c, 1.3);
    // бочку разрывает: обечайка улетает вверх
    if(!_shellGeo) _shellGeo = new THREE.CylinderGeometry(0.29, 0.26, 0.6, 14, 1, true);
    const m = new THREE.Mesh(_shellGeo, cmat(0x3a1a12,{roughness:.8, metalness:.4, side:THREE.DoubleSide}));
    m.position.copy(c).add(V(0,0.3,0)); m.castShadow = true; scene.add(m);
    addDynamic(m, {shape:'cyl', size:[0.56,0.6,0.56], mass:8, vel:V(rnd(-2,2), rnd(8,12), rnd(-2,2)), spin:V(rnd(-6,6),rnd(-6,6),rnd(-6,6)),
      life:60, surf:'metal', group:GRP.DYN});
    feed(`взрыв бочки с топливом`);
  });
}

/* ---------- кадр ---------- */
let swayT = 0;
function updateWeapons(dt, t){
  WPN.cool -= dt; WPN.nadeCool -= dt; WPN.kick = Math.max(0, WPN.kick - dt*2.5);
  const vm = WPN.viewmodel;
  if(vm.userData.flash.opacity > 0) vm.userData.flash.opacity = Math.max(0, vm.userData.flash.opacity - dt*28);
  // перезарядка
  if(WPN.reloadT > 0){ WPN.reloadT -= dt; if(WPN.reloadT <= 0){ WPN.reloadT = 0; finishReload(); } }
  const canFire = PL.alive && !PL.fly && INPUT.locked && WPN.reloadT <= 0 && !PL.sprint && !SUPPLY.busy;
  if(canFire && INPUT.mouseDown && WPN.cool <= 0){
    if(WPN.mag > 0) shoot(); else { WPN.cool = 0.3; SND.click(); if(!startReload()) INPUT.mouseDown = false; }
  }
  for(let i=GRENADES.length-1;i>=0;i--){
    const g = GRENADES[i]; g.fuse -= dt;
    if(g.kind === 'frag' && g.fuse <= 0){
      const p = g.mesh.position.clone();
      killDynamic(g); GRENADES.splice(i,1);
      grenadeExplode(p, 1);
    } else if(g.fuse <= 0 && !g.done){ g.done = true; molotov(g, g.mesh.position); }
  }
  // положение модели: прицеливание, бег, покачивание, отдача, перезарядка
  swayT += dt*(PL.speed > 0.5 ? (PL.sprint ? 11 : 8) : 1.5);
  const ads = PL.ads, run = PL.sprint ? 1 : 0;
  const rl = WPN.reloadT > 0 ? Math.sin(clamp(1 - WPN.reloadT/WPN.reloadDur, 0, 1)*Math.PI) : 0;
  const bobA = (PL.speed > 0.5 ? 0.012 : 0.003) * (1-ads*0.85);
  vm.position.set(lerp(0.12, 0.0, ads) + Math.cos(swayT)*bobA + run*0.05,
                  lerp(-0.14, -0.075, ads) - Math.abs(Math.sin(swayT))*bobA - rl*0.12 - run*0.03,
                  lerp(-0.42, -0.24, ads) + WPN.kick*0.012 + PL.recoil*0.4);
  vm.rotation.set(PL.recoil*1.4 - rl*0.6 + run*-0.3, lerp(0.035, 0, ads) + run*0.6 + rl*0.3, rl*0.5 + run*0.25);
  vm.visible = PL.alive && !PL.fly;
  animateReload(vm);
}
/** Перезарядка: левая рука отстёгивает магазин, он уходит вниз, новый
    поднимается и защёлкивается; на пустом — ещё и рывок затвора. */
const _rkA = new THREE.Vector3(), _rkB = new THREE.Vector3();
function animateReload(vm){
  const U = vm.userData, mag = U.mag, lh = U.lh; if(!mag || !lh) return;
  const r = WPN.reloadT > 0 ? clamp(1 - WPN.reloadT/WPN.reloadDur, 0, 1) : 1;
  const ss = smoothstep;
  const out = ss(0.14, 0.38, r), back = ss(0.42, 0.64, r);
  const drop = WPN.reloadT > 0 ? out*(1 - back) : 0;
  mag.position.copy(U.magRest); mag.position.y -= drop*0.34; mag.position.z += drop*0.06;
  mag.rotation.x = drop*0.7; mag.visible = !(r > 0.38 && r < 0.42);
  // левая рука: цевьё → горловина магазина → вниз с магазином → обратно → цевьё
  const well = _rkA.set(-0.01, -0.12, -0.05), rest = U.lhRest;
  let k;
  if(WPN.reloadT <= 0){ lh.position.copy(rest); lh.rotation.copy(U.lhRot); return; }
  if(r < 0.14){ k = ss(0, 0.14, r); lh.position.lerpVectors(rest, well, k); }
  else if(r < 0.64){ lh.position.copy(well); lh.position.y -= drop*0.34; lh.position.z += drop*0.06; }
  else if(WPN.reloadDur > RELOAD_TAC + 0.1 && r < 0.9){
    // пустой магазин: рука к рукоятке затвора и рывок назад
    const cp = _rkB.set(0.035, 0.03, 0.02);
    k = ss(0.64, 0.74, r); lh.position.lerpVectors(well, cp, k);
    lh.position.z += ss(0.76, 0.82, r)*(1 - ss(0.84, 0.9, r))*0.07;
  } else { const r0 = WPN.reloadDur > RELOAD_TAC + 0.1 ? 0.9 : 0.64; k = ss(r0, Math.min(1, r0 + 0.2), r); lh.position.lerpVectors(WPN.reloadDur > RELOAD_TAC + 0.1 ? _rkB.set(0.035, 0.03, 0.02) : well, rest, k); }
  lh.rotation.set(U.lhRot.x + drop*0.5, U.lhRot.y, U.lhRot.z*(1 - Math.min(1, drop*2)));
}
function weaponKey(code){
  if(!PL.alive || PL.fly || SUPPLY.busy) return;
  if(isKey('reload', code)) startReload();
  if(isKey('frag', code) && WPN.frags >= 1 && WPN.nadeCool <= 0){ WPN.frags -= 1; WPN.nadeCool = 0.9; throwNade('frag'); }
  if(isKey('molotov', code) && WPN.fire >= 1 && WPN.nadeCool <= 0){ WPN.fire -= 1; WPN.nadeCool = 0.9; throwNade('fire'); }
}
/** Урон игроку от ударной волны: с проверкой укрытия. */
function playerBlast(p, R, P){
  const eye = PL.eye, d = eye.distanceTo(p);
  if(d < R*2.5) PL.shake = Math.min(1.2, PL.shake + (1 - d/(R*2.5))*1.1*P);
  if(d > R) return;
  const block = rayFirst(p.clone().add(V(0,0.2,0)), eye, GRP.STATIC);
  const cover = block && block.f < 0.95 ? 0.3 : 1;
  const k = Math.pow(1 - d/R, 1.4);
  hurt(160*P*k*cover, 'blast', p);
  if(k*cover > 0.25) PL.deaf = Math.min(1, PL.deaf + k*cover);
  const push = V().subVectors(eye, p).setY(0).normalize().multiplyScalar(6*k*cover);
  PL.vel.add(push);
}

/* ============================================================================
   ДВЕРИ: открыть / закрыть (E), выбить с разбега, прострелить, сорвать взрывом.
   Все полотна — один InstancedMesh (ручки и пробоины — ещё по одному), тела —
   кинематические боксы Bullet: держат игрока, пули и обломки.
============================================================================ */
const DOOR_LEAVES = [];
const DOOR_T = 0.042, DOOR_OPEN = 1.62, DOOR_HP = 240;
const DOOR = { leaf:null, handle:null, holes:null, holeN:0, mat:null, moving:false, wasMoving:false, tr:null };
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dp = new THREE.Vector3(), _ds = new THREE.Vector3(),
      _dY = new THREE.Vector3(0,1,0), _dl = new THREE.Vector3(), _dq2 = new THREE.Quaternion(), _dzero = new THREE.Matrix4().makeScale(0,0,0);
const DOOR_HOLES_MAX = 400;
function buildDoors(){
  if(!DOORS.length) return;
  const leafGeo = new THREE.BoxGeometry(DOOR_T, 1, 1); leafGeo.translate(0, 0.5, 0.5);
  // полотно — крашеная филёнчатая дверь поверх фанеры: текстура дерева слабо читается сквозь краску
  DOOR.mat = new THREE.MeshStandardMaterial({ color:0x8c7c66, roughness:.7, metalness:0,
    map: M.plywood.map, normalMap: M.plywood.normalMap, normalScale: new THREE.Vector2(0.35, 0.35) });
  DOOR.leaf = new THREE.InstancedMesh(leafGeo, DOOR.mat, DOORS.length);
  const hp = [];
  for(const sx of [-1, 1]){
    const rose = new THREE.CylinderGeometry(0.028, 0.028, 0.012, 12); rose.rotateZ(Math.PI/2); rose.translate(sx*(DOOR_T/2 + 0.006), 0, 0); hp.push(rose);
    const lever = new THREE.BoxGeometry(0.018, 0.018, 0.13); lever.translate(sx*(DOOR_T/2 + 0.04), 0, -0.05); hp.push(lever);
    const neck = new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8); neck.rotateZ(Math.PI/2); neck.translate(sx*(DOOR_T/2 + 0.022), 0, 0); hp.push(neck);
  }
  DOOR.handle = new THREE.InstancedMesh(mergeParts(hp), M.chrome, DOORS.length);
  const holeMat = M.decal.clone();
  holeMat.map = M.decal.map.clone(); holeMat.map.needsUpdate = true;
  holeMat.map.repeat.set(0.25, 0.5); holeMat.map.offset.set(0, 0.5);      // ячейка 0 атласа — пробоина в дереве
  DOOR.holes = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), holeMat, DOOR_HOLES_MAX);
  DOOR.holes.count = 0; DOOR.holes.visible = false;
  for(const im of [DOOR.leaf, DOOR.handle, DOOR.holes]){
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.frustumCulled = false; im.userData.nomerge = true;
    im.receiveShadow = true; scene.add(im);
  }
  DOOR.leaf.castShadow = true;
  DOOR.holes.layers.set(LAYER_FX);
  let i = 0;
  for(const d of DOORS){
    const lw = (d.w || DOOR_W) - 0.03, lh = DOOR_H - 0.03;
    const ux = Math.sin(d.ang), uz = Math.cos(d.ang);
    const hinge = new THREE.Vector3(d.x - ux*lw/2, d.y + 0.012, d.z - uz*lw/2);
    // двери, выходящие наружу, закрыты; внутренние — кто как оставил
    const outer = Math.abs(Math.abs(d.x) - BX1) < 0.05 || Math.abs(Math.abs(d.z) - BZ1) < 0.05;
    const r = rnd2(), open = outer ? 0 : (r < 0.45 ? 0 : (r < 0.7 ? DOOR_OPEN*0.35 : DOOR_OPEN)) * (rnd2() < 0.5 ? -1 : 1);
    DOOR_LEAVES.push({ i: i++, d, lw, lh, hinge, ang: d.ang, open, target: open, speed: 2.6, hp: DOOR_HP, broken: false,
      body: null, idx: -1, holes: [], n: new THREE.Vector3(uz, 0, -ux), c: new THREE.Vector3(d.x, d.y + lh/2, d.z) });
  }
  for(const L of DOOR_LEAVES) doorPose(L);
  DOOR.leaf.instanceMatrix.needsUpdate = DOOR.handle.instanceMatrix.needsUpdate = true;
}
/** Кинематические тела дверей (после Ammo). */
function initDoorPhysics(){
  DOOR.tr = new A.btTransform();
  for(const L of DOOR_LEAVES){
    L.idx = registerOwner({type:'door', d:L});
    const shape = boxShape(DOOR_T/2, L.lh/2, L.lw/2);
    doorWorld(L);
    const body = makeBody(shape, 0, _dp, _dq, {friction:0.6});
    body.setCollisionFlags(body.getCollisionFlags() | 2);        // CF_KINEMATIC_OBJECT
    body.setActivationState(4);                                  // DISABLE_DEACTIVATION
    body.setUserIndex(L.idx);
    world.addRigidBody(body, GRP.STATIC, -1);
    L.body = body;
  }
}
/** Центр и поворот полотна в мире → _dp/_dq. */
function doorWorld(L){
  _dq.setFromAxisAngle(_dY, L.ang + L.open);
  _dp.set(0, L.lh/2, L.lw/2).applyQuaternion(_dq).add(L.hinge);
}
function doorPose(L){
  if(L.broken){ DOOR.leaf.setMatrixAt(L.i, _dzero); DOOR.handle.setMatrixAt(L.i, _dzero); return; }
  _dq.setFromAxisAngle(_dY, L.ang + L.open);
  _dm.compose(L.hinge, _dq, _ds.set(1, L.lh, L.lw));
  DOOR.leaf.setMatrixAt(L.i, _dm);
  _dp.set(0, 1.0, L.lw - 0.075).applyQuaternion(_dq).add(L.hinge);
  _dm.compose(_dp, _dq, _ds.set(1,1,1));
  DOOR.handle.setMatrixAt(L.i, _dm);
  for(const h of L.holes) holePose(L, h);
  if(L.body){
    doorWorld(L);
    const tr = DOOR.tr; tr.setIdentity();
    PH.v1.setValue(_dp.x, _dp.y, _dp.z); tr.setOrigin(PH.v1);
    PH.q1.setValue(_dq.x, _dq.y, _dq.z, _dq.w); tr.setRotation(PH.q1);
    L.body.getMotionState().setWorldTransform(tr); L.body.setWorldTransform(tr);
  }
}
function holePose(L, h){
  if(L.broken){ DOOR.holes.setMatrixAt(h.k, _dzero); return; }
  _dq.setFromAxisAngle(_dY, L.ang + L.open);
  _dp.set(h.side*(DOOR_T/2 + 0.002), h.y, h.z).applyQuaternion(_dq).add(L.hinge);
  _dq2.setFromAxisAngle(_dY, h.side > 0 ? Math.PI/2 : -Math.PI/2).premultiply(_dq);   // плоскость декали — по грани полотна
  _dm.compose(_dp, _dq2, _ds.set(h.s, h.s, 1));
  DOOR.holes.setMatrixAt(h.k, _dm);
}
function updateDoors(dt){
  let moving = false;
  for(const L of DOOR_LEAVES){
    if(L.broken || L.open === L.target) continue;
    const dA = L.target - L.open, stepA = L.speed*dt;
    L.open = Math.abs(dA) <= stepA ? L.target : L.open + Math.sign(dA)*stepA;
    if(L.open === L.target && L.speed > 6) SND.door(L.c, 'close');      // выбитая дверь бьётся о стену
    else if(L.open === L.target && L.target === 0) SND.door(L.c, 'close');
    doorPose(L); moving = true;
  }
  if(moving){ DOOR.leaf.instanceMatrix.needsUpdate = DOOR.handle.instanceMatrix.needsUpdate = true; if(DOOR.holes.count) DOOR.holes.instanceMatrix.needsUpdate = true; }
  // тень двери пересчитываем, когда она остановилась, а не каждый кадр
  if(DOOR.wasMoving && !moving && SUN_UP) renderer.shadowMap.needsUpdate = true;
  DOOR.wasMoving = moving;
}
/** Дверь, на которую смотрит игрок (луч взгляда), или ближайшая в проёме. */
function lookDoor(){
  if(!DOOR_LEAVES.length || !PH.ready) return null;
  camera.getWorldDirection(_dl);
  _dp.copy(PL.eye).addScaledVector(_dl, 2.1);
  const h = rayFirst(PL.eye, _dp, GRP.STATIC);
  if(h && h.idx >= 0){ const o = PH.owners[h.idx]; if(o && o.type === 'door') return o.d; }
  let best = null, bd = 1.8;
  for(const L of DOOR_LEAVES){
    if(Math.abs(PL.eye.y - (L.d.y + 1.6)) > 1.2) continue;
    const dx = L.d.x - PL.eye.x, dz = L.d.z - PL.eye.z, dist = Math.hypot(dx, dz);
    if(dist < bd && (dx*_dl.x + dz*_dl.z)/Math.max(dist, 1e-3) > 0.2){ bd = dist; best = L; }
  }
  if(best && h && h.f*2.1 < PL.eye.distanceTo(best.c) - 0.4) return null;   // между игроком и дверью стена
  return best;
}
function useDoor(){
  if(!PL.alive || PL.fly) return;
  const L = lookDoor(); if(!L || L.broken) return;
  const side = Math.sign((PL.eye.x - L.c.x)*L.n.x + (PL.eye.z - L.c.z)*L.n.z) || 1;
  const away = -side*DOOR_OPEN;
  if(PL.sprint && PL.speed > 4.2 && Math.abs(L.open) < 0.2){
    // выбить с разбега: замок вылетает, полотно распахивается и бьётся о стену
    L.target = away; L.speed = 12; L.hp -= 150;
    PL.shake = Math.min(1, PL.shake + 0.35); PL.vel.multiplyScalar(0.35);
    SND.door(L.c, 'kick');
    for(let i=0;i<6;i++) FXS.splinters.spawn(_dp.copy(L.c).addScaledVector(L.n, side*0.05), _dl.set(rnd(-1,1), rnd(0,1.5), rnd(-1,1)).addScaledVector(L.n, -side*2), _ds.set(rnd(0.03,0.08), 0.006, 0.012), L.d.y, 6);
    FXS.dust.spawn({p: L.c.clone(), v: L.n.clone().multiplyScalar(-side), life: 1.6, s0: 0.3, s1: 1.4, col:[0.7,0.66,0.6], a0: 0.35, a1: 0, drag: 2});
    if(L.hp <= 0) breakDoor(L, _dl.copy(L.n).multiplyScalar(-side), 1.2);
    else feed('дверь выбита');
    return;
  }
  L.speed = 2.6;
  if(Math.abs(L.target) > 0.1){ L.target = 0; }
  else { L.target = away; SND.door(L.c, 'open'); }
}
/** Пуля: пробоины с двух сторон, щепа; изрешечённая дверь слетает с петель. */
function doorBulletHit(L, hit, dir, power){
  _dq.setFromAxisAngle(_dY, L.ang + L.open).invert();
  _dl.copy(hit.p).sub(L.hinge).applyQuaternion(_dq);                 // точка в системе полотна
  const y = clamp(_dl.y, 0.05, L.lh - 0.05), z = clamp(_dl.z, 0.05, L.lw - 0.05);
  const s = rnd(0.07, 0.1);
  for(const side of [-1, 1]){
    const k = DOOR.holeN++ % DOOR_HOLES_MAX;
    const old = DOOR_LEAVES.find(o=> o.holes.some(h=> h.k === k));
    if(old) old.holes = old.holes.filter(h=> h.k !== k);
    const h = {k, side, y, z, s: side === Math.sign(_dl.x || 1) ? s : s*1.4};
    L.holes.push(h); holePose(L, h);
  }
  DOOR.holes.count = Math.min(DOOR.holeN, DOOR_HOLES_MAX); DOOR.holes.visible = true;
  DOOR.holes.instanceMatrix.needsUpdate = true;
  const fl = L.d.y;
  for(let i=0;i<3;i++) FXS.splinters.spawn(hit.p, _dp.copy(dir).multiplyScalar(rnd(0.5,2.5)).add(_ds.set(rnd(-0.6,.6),rnd(0,1),rnd(-0.6,.6))),
    _ds.set(rnd(0.03,0.08), rnd(0.003,0.007), rnd(0.006,0.014)), fl, rnd(5,10));
  SND.hit(hit.p, 'wood');
  L.hp -= 34*power*0.45;
  if(L.hp <= 0) breakDoor(L, dir, power*0.6);
  return {stop:false, cost:0.18, surf:'wood'};
}
/** Полотно срывается с петель и летит телом Bullet. */
function breakDoor(L, dir, power){
  if(L.broken) return;
  doorWorld(L);
  const pos = _dp.clone(), q = _dq.clone();
  L.broken = true;
  if(L.body){ removeBody(L.body); L.body = null; }
  PH.owners[L.idx] = null;
  doorPose(L); for(const h of L.holes) holePose(L, h);
  DOOR.leaf.instanceMatrix.needsUpdate = DOOR.handle.instanceMatrix.needsUpdate = DOOR.holes.instanceMatrix.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.BoxGeometry(DOOR_T, L.lh, L.lw), DOOR.mat);
  m.userData.ownGeo = true; m.position.copy(pos); m.quaternion.copy(q); m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  addDynamic(m, {size:[DOOR_T, L.lh, L.lw], mass:22, vel: dir.clone().multiplyScalar(3 + power*5).add(V(0, 0.8, 0)),
    spin: V(rnd(-2,2), rnd(-3,3), rnd(-2,2)), life: 1e9, keep: true, surf:'wood', group: GRP.DYN, friction: 0.8});
  SND.door(pos, 'kick');
  renderer.shadowMap.needsUpdate = SUN_UP;
  DEST.broken++;
  feed('дверь сорвана с петель');
}
/** Взрыв рядом: дверь распахивает ударной волной или срывает. */
function doorBlast(p, R, P){
  for(const L of DOOR_LEAVES){
    if(L.broken) continue;
    const d = L.c.distanceTo(p); if(d > R) continue;
    const k = 1 - d/R;
    L.hp -= 700*P*k*k;
    const dir = V().subVectors(L.c, p).setY(0).normalize();
    if(L.hp <= 0) breakDoor(L, dir, 1 + 2*k*P);
    else { const side = Math.sign(dir.dot(L.n)) || 1; L.target = side*DOOR_OPEN; L.speed = 14; }
  }
}

/* ============================================================================
   ЯЩИКИ С БОЕПРИПАСАМИ: по одному в центре каждой базы, общие для команд.
   F рядом с ящиком — пополнить магазины и гранаты (1.6 с, стрелять нельзя).
============================================================================ */
const AMMO_BOXES = [];
const SUPPLY = { busy:false, t:0, dur:1.6, box:null };
let _ammoTex = null;
function ammoStencil(){
  if(_ammoTex) return _ammoTex;
  const W = 512, H = 256, [c, x] = cv(W, H);
  x.fillStyle = '#4c5436'; x.fillRect(0,0,W,H);
  // потёки и выцветание краски
  const q = (a,b)=> a + rnd2()*(b-a);
  for(let i=0;i<260;i++){ x.fillStyle = `rgba(${q(20,90)|0},${q(30,90)|0},${q(15,50)|0},${q(0.04,0.12)})`; x.fillRect(q(0,W), q(0,H), q(4,60), q(2,14)); }
  x.strokeStyle = 'rgba(20,22,14,.55)'; x.lineWidth = 6; x.strokeRect(10, 10, W-20, H-20);
  x.fillStyle = 'rgba(226,220,196,.88)'; x.textAlign = 'center';
  x.font = '700 52px "Arial Narrow",Arial,sans-serif'; x.fillText('БОЕПРИПАСЫ', W/2, 96);
  x.font = '600 30px "Arial Narrow",Arial,sans-serif'; x.fillText('5,45×39 · 4 МАГ. · РГД-5 ×2', W/2, 146);
  x.font = '600 24px ui-monospace,Consolas,monospace'; x.fillText('ALPHA · DELTA · ПАРТ. 07-26', W/2, 196);
  x.globalCompositeOperation = 'destination-out';
  for(let i=0;i<700;i++){ x.fillStyle = `rgba(0,0,0,${Math.random()*0.35})`; x.fillRect(Math.random()*W, Math.random()*H, 1+Math.random()*6, 1+Math.random()*3); }
  x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#4c5436'; x.fillRect(0,0,W,H);
  _ammoTex = new THREE.CanvasTexture(c); _ammoTex.colorSpace = THREE.SRGBColorSpace; _ammoTex.anisotropy = MAXA();
  _ammoTex.userData.mat = new THREE.MeshStandardMaterial({ map: _ammoTex, roughness:.78, metalness:.05 });
  return _ammoTex;
}
function ammoBox(x, y, z, rotY){
  const G = new THREE.Group();
  const paint = ammoStencil().userData.mat;
  const L = 1.05, Wd = 0.56, Hb = 0.42;
  const body = new THREE.Mesh(roundedBox(L, Hb, Wd, 0.018, 1), paint); body.position.y = 0.1 + Hb/2; G.add(body);
  for(const sz of [-1, 1]){                                          // полозья
    const skid = new THREE.Mesh(new THREE.BoxGeometry(L + 0.04, 0.1, 0.09), M.woodDark); skid.position.set(0, 0.05, sz*(Wd/2 - 0.08)); G.add(skid);
  }
  for(const sx of [-1, 1]){                                          // ручки-скобы и защёлки
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 10, Math.PI), M.steel);
    handle.position.set(sx*(L/2 + 0.012), 0.1 + Hb*0.62, 0); handle.rotation.set(0, Math.PI/2, Math.PI); G.add(handle);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.02), M.steel); latch.position.set(sx*0.32, 0.1 + Hb - 0.03, Wd/2 + 0.01); G.add(latch);
  }
  // крышка — на петлях у задней кромки, открывается при пополнении
  const lidPivot = new THREE.Group(); lidPivot.position.set(0, 0.1 + Hb, -Wd/2);
  const lid = new THREE.Mesh(roundedBox(L + 0.01, 0.06, Wd + 0.01, 0.015, 1), paint); lid.position.set(0, 0.03, Wd/2);
  lidPivot.add(lid); lidPivot.userData.nomerge = true; G.add(lidPivot);
  G.position.set(x, y, z); G.rotation.y = rotY; shadowAll(G); scene.add(G);
  addAABB(x, y + 0.26, z, ...(Math.abs(Math.sin(rotY)) > 0.7 ? [Wd, 0.52, L] : [L, 0.52, Wd]), 0, 'wood');
  AMMO_BOXES.push({ p: new THREE.Vector3(x, y + 0.5, z), lid: lidPivot, open: 0 });
}
function nearestBox(){
  if(!PL.alive || PL.fly) return null;
  let best = null, bd = 1.9;
  for(const b of AMMO_BOXES){
    const d = Math.hypot(b.p.x - PL.eye.x, b.p.z - PL.eye.z);
    if(d < bd && Math.abs(PL.eye.y - b.p.y) < 1.8){ bd = d; best = b; }
  }
  return best;
}
const supplyFull = ()=> WPN.reserve >= WPN.reserveMax && WPN.frags >= WPN.fragsMax && WPN.fire >= WPN.fireMax && WPN.mag >= WPN.magMax;
function trySupply(){
  if(SUPPLY.busy) return;
  const b = nearestBox(); if(!b) return;
  if(supplyFull()){ feed('боезапас полон'); return; }
  SUPPLY.busy = true; SUPPLY.t = 0; SUPPLY.box = b; WPN.reloadT = 0; INPUT.mouseDown = false;
  SND.supply(b.p);
}
function updateSupply(dt){
  for(const b of AMMO_BOXES){
    const want = SUPPLY.busy && SUPPLY.box === b ? 1 : 0;
    if(b.open !== want){ b.open = clamp(b.open + (want ? 3 : -2)*dt, 0, 1); b.lid.rotation.x = -b.open*1.9; }
  }
  if(!SUPPLY.busy) return;
  const b = SUPPLY.box;
  if(!PL.alive || PL.fly || Math.hypot(b.p.x - PL.eye.x, b.p.z - PL.eye.z) > 2.4){ SUPPLY.busy = false; return; }
  SUPPLY.t += dt;
  if(SUPPLY.t >= SUPPLY.dur){
    SUPPLY.busy = false;
    WPN.mag = WPN.magMax; WPN.reserve = WPN.reserveMax; WPN.frags = WPN.fragsMax; WPN.fire = WPN.fireMax;
    SND.click();
    feed('боезапас пополнен: 5 магазинов, гранаты');
  }
}

/* ============================================================================
   АДАПТАЦИЯ ГЛАЗА: внутри дома днём экспозиция плавно растёт (глаз
   привыкает к полумраку), на выходе в светлый ангар — быстро падает.
   Замкнутость пространства — по короткой «звезде» лучей вокруг камеры.
============================================================================ */
const EXPO = { base: 1, eye: 1, target: 1, t: 0 };
const _eyeDirs = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0.7,0,0.7],[-0.7,0,-0.7],[0.7,0,-0.7],[-0.7,0,0.7]].map(a=> new THREE.Vector3(...a));
function updateEye(dt){
  EXPO.t -= dt;
  if(EXPO.t <= 0 && PH.ready){
    EXPO.t = 0.25;
    const p = camera.position; let enc = 0;
    if(rayFirst(p, _dp.set(p.x, p.y + 6, p.z), GRP.STATIC)) enc += 3;
    for(const d of _eyeDirs) if(rayFirst(p, _dp.copy(p).addScaledVector(d, 6), GRP.STATIC)) enc += 1;
    const e = enc/11;
    const day = clamp(SUN_ELEV*3 + 0.25, 0, 1);
    EXPO.target = 1 + e*e*0.95*day;
  }
  const rate = EXPO.target > EXPO.eye ? 0.8 : 2.4;
  EXPO.eye = lerp(EXPO.eye, EXPO.target, 1 - Math.exp(-dt*rate));
  renderer.toneMappingExposure = EXPO.base * SET.exp * EXPO.eye;
}

// Команды: флаги на мачтах (ткань Bullet), точки возрождения, миникарта
// для выбора точки, ветер в ангаре.

const FLAGS = [];
/** Тень от ткани флагов перерисовывается редко и только на сильных профилях. */
const FLAG_SHADOWS = Q.cloth >= 1;
/** Порывистый сквозняк: из щелей ворот за базами и проёмов кровли. */
const WIND = { dir: new THREE.Vector3(0.2,0,1).normalize(), base: 6.5, vec: new THREE.Vector3(), speed: 6.5 };
function updateWind(t){
  const gust = 0.62 + 0.42*Math.sin(t*0.23) + 0.22*Math.sin(t*0.91 + 1.7) + 0.14*Math.sin(t*2.7 + 0.4);
  WIND.speed = WIND.base * clamp(gust, 0.2, 1.85);
  const yaw = 0.5*Math.sin(t*0.11) + 0.2*Math.sin(t*0.47 + 2.1);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  WIND.vec.set(WIND.dir.x*c - WIND.dir.z*s, 0.08*Math.sin(t*0.31), WIND.dir.x*s + WIND.dir.z*c).normalize().multiplyScalar(WIND.speed);
}
function buildFlags(){
  for(const key of ['ALPHA','DELTA']){
    const T = TEAMS[key];
    const top = new THREE.Vector3(T.flag.x, 8.15, T.flag.z);
    const along = new THREE.Vector3(0,0,1);
    const nx = 26, ny = 16;
    const f = makeFlagCloth(key==='ALPHA' ? M.flagAlpha : M.flagDelta, top, along, 2.6, 1.62, nx, ny);
    f.mesh.castShadow = FLAG_SHADOWS;
    scene.add(f.mesh);
    f.team = key;
    FLAGS.push(f);
  }
}

/* ---------------------------------------------------------------------------
   МИНИКАРТА: вид сверху, рисуется из коллайдеров и стен здания.
--------------------------------------------------------------------------- */
function drawMinimap(cv, team, selected, player){
  const x = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const s = Math.min(W/(HW*2+4), H/(HD*2+4));
  const P = (wx, wz)=> [W/2 + wx*s, H/2 + wz*s];
  x.clearRect(0,0,W,H);
  x.fillStyle = 'rgba(18,20,22,0.92)'; x.fillRect(0,0,W,H);
  // пол ангара
  const [a0,b0] = P(-HW,-HD);
  x.fillStyle = '#2a2c2e'; x.fillRect(a0, b0, HW*2*s, HD*2*s);
  x.strokeStyle = '#55595c'; x.lineWidth = 2; x.strokeRect(a0, b0, HW*2*s, HD*2*s);
  // укрытия и техника — низкие коллайдеры
  x.fillStyle = 'rgba(120,124,118,0.55)';
  for(const c of COLLIDERS){
    if(c.playerOnly || c.y0 > 2.5 || c.y1 < 0.4) continue;
    if(c.x1 - c.x0 > 30 || c.z1 - c.z0 > 30) continue;
    if(Math.abs(c.cx) < 15.3 && Math.abs(c.cz) < 9.8) continue;
    const [px,pz] = P(c.x0, c.z0);
    x.fillRect(px, pz, Math.max(1,(c.x1-c.x0)*s), Math.max(1,(c.z1-c.z0)*s));
  }
  // здание: плита и стены 1 этажа
  const [h0,h1] = P(BX0, BZ0);
  x.fillStyle = 'rgba(160,130,90,0.22)'; x.fillRect(h0, h1, (BX1-BX0)*s, (BZ1-BZ0)*s);
  x.strokeStyle = '#c9a774'; x.lineWidth = 1.5;
  for(const w of WALLS){
    if(w.y0 > 1) continue;
    let t = 0;
    const seg = (t0,t1)=>{ if(t1-t0 < 0.05) return; const ux=(w.x2-w.x1)/w.len, uz=(w.z2-w.z1)/w.len;
      const [p0,q0] = P(w.x1+ux*t0, w.z1+uz*t0), [p1,q1] = P(w.x1+ux*t1, w.z1+uz*t1);
      x.beginPath(); x.moveTo(p0,q0); x.lineTo(p1,q1); x.stroke(); };
    for(const o of w.ops){ if(o.y0 < 0.05){ seg(t, o.t0); t = o.t1; } }
    seg(t, w.len);
  }
  for(const st of STAIRS_OUT){
    const z0 = st.side==='n' ? BZ0-1.9 : BZ1+1.9, z1 = st.side==='n' ? BZ0-7.3 : BZ1+7.3;
    const [p0,q0] = P(st.x-0.6, Math.min(z0,z1)); x.fillStyle = 'rgba(150,160,170,0.5)'; x.fillRect(p0, q0, 1.2*s, Math.abs(z1-z0)*s);
  }
  // ящики с боеприпасами
  for(const b of AMMO_BOXES){
    const [px, pz] = P(b.p.x, b.p.z);
    x.fillStyle = '#c9b25a'; x.fillRect(px-6, pz-4, 12, 8); x.strokeStyle = '#1a1a14'; x.lineWidth = 1.5; x.strokeRect(px-6, pz-4, 12, 8);
  }
  // флаги и точки
  for(const key of ['ALPHA','DELTA']){
    const T = TEAMS[key];
    const [fx, fz] = P(T.flag.x, T.flag.z);
    x.fillStyle = T.color; x.beginPath(); x.moveTo(fx, fz-10); x.lineTo(fx+9, fz-6); x.lineTo(fx, fz-2); x.fill();
    x.fillRect(fx-1, fz-10, 2, 12);
    for(const sp of T.spawns){
      const [px, pz] = P(sp.x, sp.z);
      const mine = key === team, sel = selected && sel_id(selected) === sp.id;
      x.globalAlpha = mine ? 1 : 0.35;
      x.beginPath(); x.arc(px, pz, sel ? 11 : 8, 0, 7);
      x.fillStyle = sel ? T.color : 'rgba(0,0,0,0.6)'; x.fill();
      x.lineWidth = 2; x.strokeStyle = T.color; x.stroke();
      x.fillStyle = sel ? '#101214' : T.color; x.font = '700 10px ui-monospace,monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(sp.id, px, pz+0.5);
      x.globalAlpha = 1;
      sp._px = px; sp._pz = pz;
    }
  }
  if(player){
    const [px, pz] = P(player.x, player.z);
    x.save(); x.translate(px, pz); x.rotate(-player.yaw);
    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0,-7); x.lineTo(5,5); x.lineTo(0,2); x.lineTo(-5,5); x.fill(); x.restore();
  }
  x.fillStyle = '#8b8f94'; x.font = '600 11px system-ui,sans-serif'; x.textAlign = 'left';
  x.fillText('С', W/2-4, 12);
}
const sel_id = s => typeof s === 'string' ? s : s.id;
function spawnFromClick(team, px, pz){
  let best = null, bd = 18*18;
  for(const sp of TEAMS[team].spawns){ const d = (sp._px-px)**2 + (sp._pz-pz)**2; if(d < bd){ bd = d; best = sp; } }
  return best;
}

// Точка входа: сборка карты, физика, интерфейс выбора команды, игровой цикл.

window.__BGU = BGU;
const frame = ()=> new Promise(r=> requestAnimationFrame(()=> setTimeout(r, 0)));
const BOOT = { t0: performance.now(), marks: [] };
const status = t => { const el = $('#g_status'); if(el) el.textContent = t; BOOT.marks.push([t, Math.round(performance.now() - BOOT.t0)]); };
const STATE = { team:'ALPHA', spawn:null, playing:false, started:false, menu:true, fps:0 };

async function build(){
  scene.fog = new THREE.FogExp2(0x9aa0a6, 0.0048);
  scene.background = new THREE.Color(0x14151a);
  scene.add(camera);
  status('Небо и окружение…'); await frame();
  buildSky(); buildEnvironment();
  status('Процедурные текстуры: OSB, бетон, металл…'); await frame();
  await texCacheOpen();
  installTexCache();
  buildAllMaterials();
  buildFabricMaterials();
  SURF_U.uDetailN.value = detailNormalTex(TS(256));
  buildLights();
  initFX();
  status('Ангар…'); await frame();
  buildHangar(); buildRoof(); buildLamps(); buildServices(); buildNightLighting();
  status('Шут-хаус: каркас, обшивка, лестницы…'); await frame();
  buildHouse();
  buildDoors();
  roomLabels();
  status('Базы ALPHA / DELTA, укрытия, техника…'); await frame();
  buildLayout();
  buildFloor();
  buildTag();
  addSurfaceDetail(M.conc, {stains:true, detail:0.45});
  if(M.concPit) addSurfaceDetail(M.concPit, {stains:true, detail:0.45});
  for(const m of [M.osb, M.osb2, M.wood, M.woodDark, M.plywood]) addSurfaceDetail(m, {detail:0.22});
  addSurfaceDetail(M.panel, {detail:0.3});
  status('Запекание геометрии…'); await frame();
  flushBuckets();
  buildShafts(); buildWindowShafts(); buildDust();
  const baked = bakeScene();
  buildShadowProxy();
  status('Рассеянный свет: затенение и отскок…'); await frame();
  await buildAmbientVolume();
  if(DEBUG.get('avol') === '0'){ const k = AVOL_U.uAVolK.value; k.x = k.y = k.z = k.w = 0; }   // сравнение «до/после»
  scene.traverse(o=>{ if(o.isMesh && o.userData.glass && !o.userData.glassReg){ o.userData.glassReg = true; } });
  for(const o of collectGlass()) registerGlass(o, {hp:1});
  instanceGlass();
  scene.traverse(o=>{ if(o.isMesh) ensureColor(o); });
  buildGrid();
  status('Физика Bullet (ammo.js)…'); await frame();
  await initPhysics();
  const nStatic = buildStaticWorld();
  initDestructiblePhysics();
  initDoorPhysics();
  HOOKS.doorBlast = doorBlast;
  for(const d of DYN_PROPS){
    const rec = addDynamic(d.mesh, {shape:d.shape, size:d.size, mass:d.mass, surf:d.surf, friction:d.friction, restitution:d.restitution,
      group:GRP.DYN, life:1e9, keep:true, linDamp:0.05, angDamp:0.3});
    rec.body.setActivationState(2);      // спит до первого удара
  }
  buildFlags();
  initPlayer(renderer.domElement);
  initFire();
  initWeapons();
  HOOKS.playerBlast = (p, R, P)=>{ playerBlast(p, R, P); pushLamps(p, R*2.5, P); };
  PH.onContact = onContact;
  buildComposer();
  scene.traverse(o=>{ if(o.isLight) o.layers.enable(LAYER_VM); });
  fxLayer(scene);
  applyDaylight(DAY.t);
  status('Шейдеры и отражения…'); await frame();
  renderer.shadowMap.needsUpdate = true;
  await prewarmShaders();
  captureEnvironment();
  renderer.shadowMap.needsUpdate = true;
  // стартовый вид: над картой, на здание
  camera.position.set(-24, 7.5, -22); camera.lookAt(0, 2, 0);
  PL.yaw = Math.atan2(24, 22) + Math.PI; PL.pitch = -0.2;
  PL.flyPos.copy(camera.position); PL.fly = true; PL.char.enable(false);
  window.ANGAR = api({baked, nStatic, boot: BOOT.marks, texCache: TEXCACHE});
  // текстуры, которых не было в кэше, сохраняются в фоне
  setTimeout(()=> texCacheFlush(), 4000);
  setupUI();
  status('');
  if(!DEBUG.has('norun')) loop();
}
/* ---------- запекание объёма затенения ---------- */
/** Сетка занятости 0.25 м: 0 — воздух, 1 — бетон/металл/песок, 2 — дерево.
    Оболочка ангара (стены, кровля) не пишется: рассеянный свет и так
    приходит сквозь неё (остекление, проёмы). Пол ангара — занят. */
function buildOccupancy(){
  const r = 0.25, B = AVOL_BOX;
  const nx = Math.round(B.sx/r), ny = Math.round(B.sy/r), nz = Math.round(B.sz/r);
  const occ = new Uint8Array(nx*ny*nz);
  const g0 = Math.round((0 - B.y0)/r);                     // слои ниже отметки 0 — пол
  for(let iy=0; iy<g0; iy++) occ.fill(1, iy*nz*nx, (iy+1)*nz*nx);
  const _p = new THREE.Vector3();
  /** Бокс с центром c, осями a0..a2 (единичные) и полуразмерами h0..h2. */
  const box = (c, a0, a1, a2, h0, h1, h2, type)=>{
    const pad = r*0.5;
    const ex = Math.abs(a0.x)*h0 + Math.abs(a1.x)*h1 + Math.abs(a2.x)*h2 + pad;
    const ey = Math.abs(a0.y)*h0 + Math.abs(a1.y)*h1 + Math.abs(a2.y)*h2 + pad;
    const ez = Math.abs(a0.z)*h0 + Math.abs(a1.z)*h1 + Math.abs(a2.z)*h2 + pad;
    const ix0 = Math.max(0, Math.floor((c.x-ex-B.x0)/r)), ix1 = Math.min(nx-1, Math.floor((c.x+ex-B.x0)/r));
    const iy0 = Math.max(0, Math.floor((c.y-ey-B.y0)/r)), iy1 = Math.min(ny-1, Math.floor((c.y+ey-B.y0)/r));
    const iz0 = Math.max(0, Math.floor((c.z-ez-B.z0)/r)), iz1 = Math.min(nz-1, Math.floor((c.z+ez-B.z0)/r));
    const H0 = h0 + pad, H1 = h1 + pad, H2 = h2 + pad;
    for(let iy=iy0; iy<=iy1; iy++){
      const py = B.y0 + (iy+0.5)*r - c.y;
      for(let iz=iz0; iz<=iz1; iz++){
        const pz = B.z0 + (iz+0.5)*r - c.z;
        let o = (iy*nz + iz)*nx;
        for(let ix=ix0; ix<=ix1; ix++){
          const px = B.x0 + (ix+0.5)*r - c.x;
          if(Math.abs(px*a0.x + py*a0.y + pz*a0.z) > H0) continue;
          if(Math.abs(px*a1.x + py*a1.y + pz*a1.z) > H1) continue;
          if(Math.abs(px*a2.x + py*a2.y + pz*a2.z) > H2) continue;
          if(occ[o+ix] !== 2) occ[o+ix] = type;
        }
      }
    }
  };
  const X = new THREE.Vector3(1,0,0), Y = new THREE.Vector3(0,1,0), Z = new THREE.Vector3(0,0,1);
  const ax = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], q = new THREE.Quaternion();
  const obb = (cx,cy,cz, hx,hy,hz, qa, type)=>{
    if(qa){ q.set(qa[0],qa[1],qa[2],qa[3]); ax[0].copy(X).applyQuaternion(q); ax[1].copy(Y).applyQuaternion(q); ax[2].copy(Z).applyQuaternion(q); }
    else { ax[0].copy(X); ax[1].copy(Y); ax[2].copy(Z); }
    box(_p.set(cx,cy,cz), ax[0], ax[1], ax[2], hx, hy, hz, type);
  };
  for(const c of COLLIDERS){
    normCollider(c);
    if(c.playerOnly || c.noPlayer) continue;
    if(c.y1 <= 0.06) continue;                                          // площадки на полу
    if(c.x1 > HW-0.02 || c.x0 < -HW+0.02 || c.z1 > HD-0.02 || c.z0 < -HD+0.02) continue;   // оболочка ангара
    if(c.y0 > EAVE-1.5) continue;                                        // кровля и фермы
    obb(c.cx, c.cy, c.cz, c.hx, c.hy, c.hz, c.q, c.surf === 'wood' ? 2 : 1);
  }
  for(const s of DEST.sheets) box(s.c, s.U, s.V, s.N, s.w/2, s.h/2, Math.max(s.t/2, 0.02), 2);
  for(const p of DEST.props){ const c = p.col; obb(c.cx, c.cy, c.cz, c.hx, c.hy, c.hz, c.q, p.wood ? 2 : 1); }
  return { occ, nx, ny, nz, r };
}
/** Равномерные направления на сфере (спираль Фибоначчи); нижние — с меньшим весом:
    свет снизу — это отскок от пола, он слабее неба и остекления. */
function sphereDirs(n, lowW){
  const out = [], ga = Math.PI*(3 - Math.sqrt(5));
  for(let i=0;i<n;i++){
    const y = 1 - (i + 0.5)/n*2, rr = Math.sqrt(1 - y*y), a = i*ga;
    out.push([Math.cos(a)*rr, y, Math.sin(a)*rr, y < 0 ? lowW : 1]);
  }
  return out;
}
/** Трассировка по сетке занятости. Возвращает [открыто, доля дерева] (0..1, взвешено). */
function traceVolume(O, res, maxD, dirs, withWood){
  const B = AVOL_BOX, r = O.r, nx = O.nx, ny = O.ny, nz = O.nz, occ = O.occ;
  const gx = Math.round(B.sx/res), gy = Math.round(B.sy/res), gz = Math.round(B.sz/res);
  const open = new Float32Array(gx*gy*gz), wood = withWood ? new Float32Array(gx*gy*gz) : null, inside = new Uint8Array(gx*gy*gz);
  const steps = Math.ceil(maxD/r), inv = 1/r;
  let wsum = 0; for(const d of dirs) wsum += d[3];
  const D = dirs.map(d=> [d[0]*r*inv, d[1]*r*inv, d[2]*r*inv, d[3]/wsum]);   // шаг в ячейках сетки занятости
  for(let iy=0; iy<gy; iy++) for(let iz=0; iz<gz; iz++) for(let ix=0; ix<gx; ix++){
    const k = (iy*gz + iz)*gx + ix;
    // центр ячейки объёма в координатах сетки занятости
    const cx = (ix + 0.5)*res*inv, cy = (iy + 0.5)*res*inv, cz = (iz + 0.5)*res*inv;
    const ci = ((cy|0)*nz + (cz|0))*nx + (cx|0);
    if(occ[ci]){ inside[k] = 1; continue; }
    let op = 0, wd = 0;
    for(const d of D){
      let x = cx, y = cy, z = cz, hit = 0;
      for(let s=0; s<steps; s++){
        x += d[0]; y += d[1]; z += d[2];
        if(y >= ny || x < 0 || z < 0 || x >= nx || z >= nz) break;
        if(y < 0){ hit = 1; break; }
        const v = occ[((y|0)*nz + (z|0))*nx + (x|0)];
        if(v){ hit = v; break; }
      }
      if(!hit) op += d[3]; else if(hit === 2) wd += d[3];
    }
    open[k] = op; if(wood) wood[k] = wd;
  }
  // ячейки внутри твёрдого берут среднее соседей: иначе трилинейная выборка
  // у самой стены подмешивает «чёрное» изнутри неё
  for(let pass=0; pass<2; pass++) for(let iy=0; iy<gy; iy++) for(let iz=0; iz<gz; iz++) for(let ix=0; ix<gx; ix++){
    const k = (iy*gz + iz)*gx + ix; if(inside[k] !== 1) continue;
    let so = 0, sw = 0, n = 0;
    for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
      const X = ix+dx, Y = iy+dy, Z = iz+dz;
      if(X<0||Y<0||Z<0||X>=gx||Y>=gy||Z>=gz) continue;
      const j = (Y*gz + Z)*gx + X; if(inside[j] === 1) continue;
      so += open[j]; if(wood) sw += wood[j]; n++;
    }
    if(n){ open[k] = so/n; if(wood) wood[k] = sw/n; inside[k] = 2; }
  }
  return { open, wood, gx, gy, gz };
}
/** Сколько открыто у точки над пустым полом на высоте h — эталон «ничем не затенено». */
function openReference(h, maxD, dirs){
  let wsum = 0, op = 0;
  for(const d of dirs){ wsum += d[3]; if(!(d[1] < 0 && h/(-d[1]) <= maxD)) op += d[3]; }
  return op/wsum;
}
const AVOL_VER = 'avol-v1';
async function buildAmbientVolume(){
  const key = AVOL_VER + '|' + COLLIDERS.length + '|' + DEST.sheets.length + '|' + DEST.props.length;
  let L = null, S = null, dims = null;
  if(TEXCACHE.db){
    try{
      const v = await idbReq(TEXCACHE.db.transaction('tex', 'readonly').objectStore('tex').get('AVOL|' + key));
      if(v){ L = v.L; S = v.S; dims = v.dims; }
    }catch(e){}
  }
  if(!L){
    const O = buildOccupancy();
    const dL = sphereDirs(Q.tex >= 0.75 ? 40 : 28, 0.45), dS = sphereDirs(Q.tex >= 0.75 ? 26 : 18, 0.6);
    const vL = traceVolume(O, 1.0, 9, dL, true), vS = traceVolume(O, 0.5, 1.5, dS, false);
    // нормировка: открытая площадка ангара — 1 (эталон — точка над полом на высоте выборки)
    const refL = openReference(1.05, 9, dL), refS = openReference(0.55, 1.5, dS);
    L = new Uint8Array(vL.open.length*2);
    for(let i=0;i<vL.open.length;i++){
      L[i*2]   = Math.round(clamp(vL.open[i]/refL, 0, 1)*255);
      L[i*2+1] = Math.round(clamp(vL.wood[i]*1.6, 0, 1)*255);
    }
    S = new Uint8Array(vS.open.length);
    for(let i=0;i<vS.open.length;i++) S[i] = Math.round(clamp(Math.pow(vS.open[i]/refS, 1.3), 0, 1)*255);
    dims = [vL.gx, vL.gy, vL.gz, vS.gx, vS.gy, vS.gz];
    if(TEXCACHE.db){
      try{ TEXCACHE.db.transaction('tex', 'readwrite').objectStore('tex').put({L, S, dims}, 'AVOL|' + key); }catch(e){}
    }
  }
  const tL = new THREE.Data3DTexture(L, dims[0], dims[1], dims[2]);
  tL.format = THREE.RGFormat;
  const tS = new THREE.Data3DTexture(S, dims[3], dims[4], dims[5]);
  tS.format = THREE.RedFormat;
  for(const t of [tL, tS]){
    t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping; t.unpackAlignment = 1; t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  // до первой компиляции материалов: каждый материал получает свою ссылку на эти текстуры
  AVOL_U.uAVolL.value = tL; AVOL_U.uAVolS.value = tS;
  AVOL.L = L; AVOL.S = S; AVOL.dims = dims;
  return AVOL;
}
const AVOL = { L:null, S:null, dims:null };
/** Открытость в точке (для частиц и звука): 0 — глухая комната, 1 — ангар. */
function avolOpen(p){
  if(!AVOL.L) return 1;
  const [gx, gy, gz] = AVOL.dims, B = AVOL_BOX;
  const ix = clamp(Math.floor(p.x - B.x0), 0, gx-1), iy = clamp(Math.floor(p.y - B.y0), 0, gy-1), iz = clamp(Math.floor(p.z - B.z0), 0, gz-1);
  return AVOL.L[((iy*gz + iz)*gx + ix)*2]/255;
}
function collectGlass(){
  const out = [];
  scene.traverse(o=>{ if(o.isMesh && o.userData.glass && !DEST.glass.some(g=>g.mesh===o)) out.push(o); });
  return out;
}

/* ---------- подвесные лампы: маятник + свет из пула ---------- */
const _lampNear = [], _lampOff = new THREE.Vector3(0,-0.08,0), _lampP = new THREE.Vector3();
function pushLamps(p, R, P){
  for(const l of INTERIOR){
    const d = l.pos.distanceTo(p); if(d > R) continue;
    const k = (1 - d/R)*P*2.2;
    l.vx += (l.x - p.x)/(d+0.5)*k; l.vz += (l.z - p.z)/(d+0.5)*k;
    l.flick = 1.2*(1-d/R);
  }
}
function updateLamps(dt, t){
  const LI = LAMP_INST, o = LI.o;
  for(const l of INTERIOR){
    l.vx += (-9.81/l.len*Math.sin(l.ax) + WIND.vec.x*0.004*Math.sin(t*0.7+l.x))*dt;
    l.vz += (-9.81/l.len*Math.sin(l.az) + WIND.vec.z*0.004*Math.cos(t*0.6+l.z))*dt;
    l.vx *= Math.exp(-dt*0.35); l.vz *= Math.exp(-dt*0.35);
    l.ax = clamp(l.ax + l.vx*dt, -0.9, 0.9); l.az = clamp(l.az + l.vz*dt, -0.9, 0.9);
    const ox = Math.sin(l.ax)*l.len, oz = Math.sin(l.az)*l.len, oy = l.len*(1 - Math.cos(l.ax)*Math.cos(l.az));
    o.position.set(l.x + ox, l.top - l.len + oy, l.z + oz); o.rotation.set(l.az, 0, -l.ax); o.scale.set(1,1,1);
    o.updateMatrix(); LI.shade.setMatrixAt(l.i, o.matrix);
    o.position.set(l.x + ox/2, l.top - l.len/2 + oy/2, l.z + oz/2); o.scale.set(1, l.len, 1);
    o.updateMatrix(); LI.cord.setMatrixAt(l.i, o.matrix);
    o.position.set(l.x + ox*1.05, l.top - l.len + oy - 0.06, l.z + oz*1.05); o.rotation.set(0,0,0); o.scale.set(1,1,1);
    o.updateMatrix(); LI.bulb.setMatrixAt(l.i, o.matrix);
    l.pos.copy(o.position);
    l.flick = Math.max(0, (l.flick||0) - dt);
  }
  LI.shade.instanceMatrix.needsUpdate = LI.cord.instanceMatrix.needsUpdate = LI.bulb.instanceMatrix.needsUpdate = true;
  const cam = camera.position;
  _lampNear.length = 0;
  for(const l of INTERIOR){ l.d = l.pos.distanceToSquared(cam); if(l.d < 400) _lampNear.push(l); }
  _lampNear.sort((a,b)=>a.d-b.d);
  const n = Math.min(_lampNear.length, Math.max(3, Math.min(6, Q.lights)));
  for(let i=0;i<n;i++){
    const l = _lampNear[i];
    const fl = l.flick > 0 ? (Math.random() < 0.5 ? 0.1 : 1) : 1;
    lightReq(_lampP.copy(l.pos).add(_lampOff), 0xffd9a0, 4.5 * fl * clamp(1 - Math.sqrt(l.d)/20, 0, 1), 8, 2, 1.2);
  }
}

/* ---------- цикл ---------- */
const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0, fpsT = 0, shadowTick = 0;
let _dayAcc = 1, _lastBroken = 0;
const _bf = new THREE.Vector3(), _bb = new THREE.Vector3(), _bl = new THREE.Vector3();

/* ---------- горение персонажа ---------- */
/** Поджечь игрока, если он ближе r к точке p (коктейль, бочка, лужа). */
function ignitePlayer(p, r, s=1){
  if(!PL.alive || PL.fly) return;
  const d = PL.eye.distanceTo(p); if(d > r) return;
  const k = s*(1 - 0.5*d/r);
  PL.burnT = Math.max(PL.burnT, 4 + 3*k); PL.burn = Math.max(PL.burn, 0.55*k + 0.25);
}
/** Огонь цепляется за одежду: игрок продолжает гореть и после того, как вышел
    из пламени. Присесть — «сбить пламя»: гаснет втрое быстрее. */
function updateBurning(dt, t){
  if(!PL.alive || PL.fly){ PL.burn = Math.max(0, PL.burn - dt*2); PL.burnT = 0; BURN_FX.set(PL.burn, t); return; }
  _bf.copy(PL.eye); _bf.y -= 1.2;
  _bb.copy(PL.eye); _bb.y -= 0.55;
  const f = Math.max(fireAt(_bf, 0.9), fireAt(_bb, 0.75)*0.8);
  if(f > 0.05){
    hurt(f*22*dt, 'fire');
    PL.burnT = Math.max(PL.burnT, 3.5 + 3*Math.min(1, f));
    PL.burn = Math.min(1, PL.burn + dt*(0.8 + 2.2*f));
  } else if(PL.burnT > 0) PL.burnT -= dt*(PL.crouch > 0.5 ? 3 : 1);
  if(PL.burnT <= 0) PL.burn = Math.max(0, PL.burn - dt*0.9);
  if(PL.burn > 0.02){
    hurt(PL.burn*6*dt, 'fire');
    // одежда горит: свет на стены вокруг и искры (дым не пускаем — он лез бы в камеру)
    const fl = 0.8 + 0.2*Math.sin(t*19)*Math.sin(t*7.7);
    _bl.copy(PL.eye); _bl.y -= 0.7;
    lightReq(_bl, 0xff7a2e, (2.2 + 4.5*PL.burn)*fl, 4.5 + 2*PL.burn, 1.8, 5);
    if(Math.random() < PL.burn*dt*10) FXS.ember.spawn({p: _bl.clone().add(V(rnd(-0.3,0.3), rnd(0,0.6), rnd(-0.3,0.3))),
      v:V(rnd(-0.5,0.5), rnd(1.2,2.6), rnd(-0.5,0.5)), life:rnd(0.8,1.8), s0:0.03, s1:0.01, col:[1,0.55,0.18], a0:1, a1:0, drag:0.4, turb:2.0, g:-0.3});
  }
  BURN_FX.set(PL.burn, t);
}

/* ---------- адаптивное разрешение ----------
   Графика не урезается заранее: если кадр не укладывается в бюджет профиля,
   сначала отключается экранный AO, затем плавно снижается разрешение
   рендера (до Q.minPR от номинала). Когда запас появляется — всё
   возвращается обратно. */
const DYNRES = { max: renderer.getPixelRatio(), pr: renderer.getPixelRatio(), ema: 16.7, t: -3, lock: DEBUG.has('fixedres'),
  slow: 0, fast: 0, li: 0, levels: [] };
DYNRES.min = Math.max(0.5, DYNRES.max*Q.minPR);
// Несколько фиксированных ступеней вместо шага 0.1: каждая смена разрешения
// пересоздаёт буферы всех эффектов (фриз), поэтому меняем редко и с запасом.
for(const k of [1, 0.85, 0.72, 0]){ const v = Math.max(DYNRES.min, DYNRES.max*k); if(!DYNRES.levels.some(l=> Math.abs(l - v) < 0.04)) DYNRES.levels.push(v); }
function setRenderScale(pr){
  DYNRES.pr = pr;
  renderer.setPixelRatio(pr);
  const c = getComposer(); if(c){ c.setPixelRatio(pr); c.setSize(innerWidth, innerHeight); }
  const dust = getDust(); if(dust) dust.material.uniforms.uPixelRatio.value = pr;
}
function adaptQuality(realDt){
  if(DYNRES.lock || document.hidden) return;
  DYNRES.ema = lerp(DYNRES.ema, Math.min(realDt, 0.1)*1000, 0.03);
  DYNRES.t += realDt;
  const budget = 1000/Q.target, P = getPasses();
  // гистерезис: вниз — кадр дороже бюджета на 20% три секунды подряд,
  // вверх — запас больше трети бюджета десять секунд подряд
  DYNRES.slow = DYNRES.ema > budget*1.2 ? DYNRES.slow + realDt : 0;
  DYNRES.fast = DYNRES.ema < budget*0.62 ? DYNRES.fast + realDt : 0;
  if(DYNRES.slow > 3 && DYNRES.t > 4){
    DYNRES.t = 0; DYNRES.slow = 0;
    if(P.aoPass && P.aoPass.enabled) P.aoPass.enabled = false;          // выключение AO буферы не трогает
    else if(DYNRES.li < DYNRES.levels.length - 1) setRenderScale(DYNRES.levels[++DYNRES.li]);
  } else if(DYNRES.fast > 10 && DYNRES.t > 10){
    DYNRES.t = 0; DYNRES.fast = 0;
    if(DYNRES.li > 0) setRenderScale(DYNRES.levels[--DYNRES.li]);
    else if(P.aoPass && !P.aoPass.enabled) P.aoPass.enabled = true;
  }
}
/** Игровое время: идёт только вне меню (на паузе огонь, дым и ветер стоят). */
let GAME_T = 0;
function step(dt){
  GAME_T += dt;
  const t = GAME_T;
  resetDebrisBudget();
  tickTimers(dt);
  updateWind(t);
  updateDoors(dt);
  updateWaves(dt);
  if(PH.ready) stepPhysics(dt, WIND.vec);
  updatePlayer(dt, t);
  updateSupply(dt);
  updateWeapons(dt);
  updateFire(dt, t);
  flushDestruction();
  updateFX(dt, t);
  updateLamps(dt, t);
  // урон от огня, горение и смерть
  updateBurning(dt, t);
  if(PL.alive && !PL.fly && PL.burn < 0.02 && PL.hp < 100 && PL.hp > 0) PL.hp = Math.min(100, PL.hp + dt*2.5);
  if(!PL.alive && STATE.playing){
    PL.deadT += dt;
    if(PL.deadT > 2.2 && !STATE.menu){ openMenu('dead'); document.exitPointerLock(); }
  }
  // сутки длятся минуты: пересчёт всего освещения 10 раз в секунду незаметен
  if(!DAY.paused){ DAY.t = DAY.t + dt*DAY.speed; _dayAcc += dt; if(_dayAcc >= 0.1){ _dayAcc = 0; applyDaylight(DAY.t); } }
  // освещение в отражениях догоняет время суток (≈ раз в 30 с при 5-минутных сутках)
  if(ENVCAP.lastT >= 0 && Math.abs(((DAY.t - ENVCAP.lastT + 1.5) % 1) - 0.5) > 0.1) captureEnvironment();
  shaftMat.uniforms.uTime.value = t;
  winShaftMat.uniforms.uTime.value = t;
  const dust = getDust(); if(dust) dust.material.uniforms.uTime.value = t;
  updateFlicker(t, DAY.lamp);
  updateLightPool(camera.position);
  for(const b of BASE_LIGHTS) lightReq(b.p, b.color, 2.5, 10, 2, 0.8);
  flushLightPool();
  BURN_U.uTime.value = t;
  // дневной свет в щели ворот и прожекторы баз следуют времени суток
  const sunK = clamp(DAY.elev*3 + 0.15, 0, 1);
  for(const g of GATES){ g.plane.material.color.setRGB(lerp(0.03,0.8,sunK), lerp(0.04,0.77,sunK), lerp(0.08,0.72,sunK)); g.beam.intensity = 7*sunK; }
  for(const sp of TEAM_SPOTS) sp.intensity = 10*DAY.lamp;
  // дым освещён тем же светом, что и сцена: рассеянный + солнце сквозь проёмы; ночью сам не светится
  const k = clamp(0.25 + (1 - DAY.lamp)*0.75, 0.22, 1)*0.85;
  FXU.uAmb.value.setRGB(k, k*0.98, k*0.95);
  FXU.uSunDir.value.copy(SUN_DIR);
  FXU.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity*0.07);
  // Тени: статика — по сдвигу солнца; разрушение — сразу; летящие обломки —
  // несколько раз в секунду; флаги (ткань) — редко. Огонь сам по себе тени
  // не меняет, поэтому пожар больше не перерисовывает карту теней каждый кадр.
  shadowTick++;
  if(DEST.broken !== _lastBroken){ _lastBroken = DEST.broken; renderer.shadowMap.needsUpdate = SUN_UP; }
  const active = PH.dyn.some(r=> !r.keep && r.body.isActive());
  if(!SUN_UP){}                     // ночью тень от солнца не видна — карту не трогаем
  else if(active && shadowTick % (Q.lights >= 6 ? 2 : 4) === 0) renderer.shadowMap.needsUpdate = true;
  else if(FLAG_SHADOWS && shadowTick % 15 === 0) renderer.shadowMap.needsUpdate = true;
  updateEye(dt);
  SND.listener(); SND.ambienceTick(WIND.speed);
  if(SND.ok && SND.lp){ SND.lp.frequency.setTargetAtTime(lerp(20000, 500, PL.deaf), SND.ctx.currentTime, 0.1); }
  updateHUD(dt);
}
function loop(){
  requestAnimationFrame(loop);
  const real = clock.getDelta();
  // Меню: симуляция стоит (не горим, гранаты не взрываются, HP не растёт),
  // эффекты не считаются — на экране последний кадр, размытый CSS-фильтром.
  if(STATE.menu){
    if(STATE.needFrame){ STATE.needFrame = false; renderer.info.reset(); getComposer().render(); }
    return;
  }
  const dt = Math.min(real, 0.05);
  step(dt);
  renderer.info.reset();
  getComposer().render();
  adaptQuality(real);
  fpsAcc += 1/Math.max(real,1e-4); fpsN++; fpsT += real;
  if(fpsT > 0.5){
    STATE.fps = fpsAcc/fpsN;
    const el = $('#fps');
    if(el.style.display !== 'none') el.textContent = `${STATE.fps.toFixed(0)} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles/1000).toFixed(0)}k tris · ${QNAME}`
      + ` · рендер ${Math.round(DYNRES.pr/DYNRES.max*100)}%${getPasses().aoPass && !getPasses().aoPass.enabled ? ' · AO выкл' : ''}`
      + ` · тел ${PH.dyn.length} · очагов ${FIRES.length} · разрушено ${DEST.broken} · ${dayClock(DAY.t)} ${phaseName(DAY.t)}`
      + ` · ${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}`;
    fpsAcc = 0; fpsN = 0; fpsT = 0;
  }
}
addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  const c = getComposer(); if(c) c.setSize(innerWidth, innerHeight);
  STATE.needFrame = true;
});

/* ============================================================================
   ИНТЕРФЕЙС: выбор команды и точки, пауза, HUD
============================================================================ */
function setupUI(){
  $('#g_load').style.display = 'none';
  $('#menu').style.display = 'flex';
  $('#q_name').textContent = QNAME;
  for(const t of ['ALPHA','DELTA']) $(`#team_${t} img`).src = emblemDataURL(t, 160);
  $('#hud_emblem').src = emblemDataURL(STATE.team, 64);
  const selTeam = t=>{
    STATE.team = t; STATE.spawn = TEAMS[t].spawns[0];
    for(const k of ['ALPHA','DELTA']) $(`#team_${k}`).classList.toggle('sel', k===t);
    document.body.dataset.team = t;
    renderMap();
  };
  const renderMap = ()=>{
    drawMinimap($('#minimap'), STATE.team, STATE.spawn, STATE.playing ? {x:camera.position.x, z:camera.position.z, yaw:PL.yaw} : null);
    const list = $('#spawns'); list.innerHTML = '';
    for(const sp of TEAMS[STATE.team].spawns){
      const b = document.createElement('button');
      b.className = 'sp' + (STATE.spawn && STATE.spawn.id === sp.id ? ' sel' : '');
      b.innerHTML = `<b>${sp.id}</b> ${sp.name}`;
      b.onclick = ()=>{ STATE.spawn = sp; renderMap(); };
      list.appendChild(b);
    }
  };
  STATE.renderMap = renderMap;
  $('#team_ALPHA').onclick = ()=> selTeam('ALPHA');
  $('#team_DELTA').onclick = ()=> selTeam('DELTA');
  $('#minimap').onclick = e=>{
    const r = e.target.getBoundingClientRect();
    // canvas вписан с object-fit: contain — учитываем поля по краям
    const k = Math.min(r.width/e.target.width, r.height/e.target.height);
    const ox = (r.width - e.target.width*k)/2, oy = (r.height - e.target.height*k)/2;
    const sp = spawnFromClick(STATE.team, (e.clientX-r.left-ox)/k, (e.clientY-r.top-oy)/k);
    if(sp){ STATE.spawn = sp; renderMap(); }
  };
  $('#go').onclick = ()=> deploy();
  $('#spectate').onclick = ()=> spectate();
  $('#resume').onclick = ()=> resume();
  $('#fullscreen').onclick = ()=> toggleFullscreen();
  $('#tab_map').onclick = ()=> menuTab('map');
  $('#tab_set').onclick = ()=> menuTab('set');
  document.addEventListener('fullscreenchange', onFullscreen);
  selTeam('ALPHA');
  INPUT.onLock = locked=>{
    if(locked){ menuMsg(''); closeMenu(); }
    else if(STATE.playing && !STATE.menu){ openMenu(PL.alive ? 'pause' : 'dead'); }
  };
  INPUT.onLockError = ()=>{
    // меню не закрываем, пока курсор не захвачен: иначе игрок застревает без мыши
    if(!STATE.menu) openMenu(PL.alive ? 'pause' : 'dead');
    menuMsg('Браузер ещё не вернул курсор после Esc — нажмите «Продолжить» через секунду.');
  };
  INPUT.onKey = (code, e)=>{
    if(code === 'F3'){ e.preventDefault(); const el = $('#fps'); el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
    if(!INPUT.locked) return;
    // при захваченной клавиатуре Esc приходит странице, а не браузеру
    if(code === 'Escape'){ document.exitPointerLock(); return; }
    weaponKey(code);
    if(isKey('fly', code)){ setFly(!PL.fly); }
    if(isKey('use', code)){ useDoor(); }
    if(isKey('supply', code)){ trySupply(); }
    if(isKey('menu', code)){ document.exitPointerLock(); openMenu('pause'); }
    if(isKey('phase', code)){ DAY.t = nextPhase(DAY.t); applyDaylight(DAY.t); renderer.shadowMap.needsUpdate = true; }
    if(isKey('daypause', code)){ DAY.paused = !DAY.paused; }
    if(code === 'BracketRight'){ DAY.speed *= 2; }
    if(code === 'BracketLeft'){ DAY.speed /= 2; }
    if(isKey('hints', code)){ $('#hints').classList.toggle('hide'); }
  };
  setupSettings();
  renderKeyHelp();
  buildCompass();
  STATE.needFrame = true;
}
function menuMsg(t){ $('#m_msg').textContent = t; }
function menuTab(which){
  $('#tab_map').classList.toggle('sel', which === 'map');
  $('#tab_set').classList.toggle('sel', which === 'set');
  $('#mappane').style.display = which === 'map' ? 'block' : 'none';
  $('#settings').style.display = which === 'set' ? 'block' : 'none';
}
/** Захват курсора. Меню закрывается только по факту захвата (pointerlockchange). */
function requestLock(){
  const el = renderer.domElement;
  menuMsg('');
  try{
    const r = el.requestPointerLock();
    if(r && typeof r.catch === 'function') r.catch(()=>{ if(!INPUT.locked && INPUT.onLockError) INPUT.onLockError(); });
  }catch(e){ if(INPUT.onLockError) INPUT.onLockError(); }
}
async function toggleFullscreen(){
  if(document.fullscreenElement){ try{ await document.exitFullscreen(); }catch(e){} return; }
  try{ await document.documentElement.requestFullscreen({navigationUI:'hide'}); }
  catch(e){ menuMsg('Полноэкранный режим недоступен в этом окне.'); }
}
async function onFullscreen(){
  KB.locked = false;
  const kb = navigator.keyboard;
  if(document.fullscreenElement && kb && kb.lock){
    try{ await kb.lock(); KB.locked = true; }catch(e){}
  } else if(kb && kb.unlock) kb.unlock();
  $('#fullscreen').textContent = document.fullscreenElement ? 'ОКОННЫЙ РЕЖИМ' : 'ПОЛНЫЙ ЭКРАН';
  menuMsg(KB.locked ? 'Клавиатура захвачена: Ctrl тоже приседает. Выход из полного экрана — удерживать Esc.'
    : (document.fullscreenElement ? 'Полный экран без захвата клавиатуры: присед — только ' + keyName(KEYMAP.crouch) + '.' : ''));
  renderKeyHelp();
  STATE.needFrame = true;
}
function nextPhase(t){
  const stops = [0.02, 0.25, 0.52, 0.61, 0.70, 0.82, 0.97];
  for(const s of stops) if(s > t + 0.01) return s;
  return stops[0] + 1;
}
function deploy(){
  SND.init(); SND.resume(); applySettings();
  const T = TEAMS[STATE.team], sp = STATE.spawn || T.spawns[0];
  PL.team = STATE.team; PL.spawn = sp;
  spawnAt(sp, T.side < 0 ? -Math.PI/2 : Math.PI/2);
  WPN.mag = WPN.magMax; WPN.reserve = WPN.reserveMax; WPN.frags = WPN.fragsMax; WPN.fire = WPN.fireMax;
  WPN.reloadT = 0; SUPPLY.busy = false;
  $('#hud_emblem').src = emblemDataURL(STATE.team, 64);
  $('#hud_team').textContent = `${STATE.team} · ${sp.id} ${sp.name}`;
  STATE.playing = true; STATE.started = true;
  miniBg(true);
  feed(`<b>${STATE.team}</b> в бою · точка ${sp.id}`);
  $('#resume').style.display = 'inline-block';
  requestLock();
}
function spectate(){
  SND.init(); SND.resume(); applySettings();
  STATE.playing = true; setFly(true);
  requestLock();
}
function resume(){ SND.resume(); requestLock(); }
function openMenu(mode){
  STATE.menu = true;
  $('#menu').style.display = 'flex'; $('#menu').dataset.mode = mode;
  $('#resume').style.display = (mode === 'pause' && STATE.started && PL.alive) ? 'inline-block' : 'none';
  $('#menu_title').textContent = mode === 'dead' ? 'ВЫ ВЫБЫЛИ' : (mode === 'pause' ? 'ПАУЗА' : 'ANGAR-07');
  $('#hud').style.display = 'none';
  INPUT.mouseDown = false; INPUT.rmb = false;
  for(const k in keys) keys[k] = false;
  // на паузе мир стоит: звук тоже (огонь, ветер, эхо)
  if(SND.ctx && SND.ctx.state === 'running') SND.ctx.suspend();
  if(STATE.renderMap) STATE.renderMap();
  STATE.needFrame = true;
}
function closeMenu(){
  STATE.menu = false; $('#menu').style.display = 'none'; $('#hud').style.display = 'block';
  SND.resume();
  clock.getDelta();          // время, проведённое в меню, в симуляцию не попадает
  HUD.dirty = true;
}

/* ---------- настройки ---------- */
const TONE = { agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping };
function applySettings(){
  renderer.toneMapping = TONE[SET.tone] ?? THREE.AgXToneMapping;
  if(SND.master) SND.master.gain.value = 0.8 * SET.vol/100;
  camera.fov = SET.fov; camera.updateProjectionMatrix();
}
function setupSettings(){
  const bindRange = (id, key, fmt)=>{
    const el = $('#s_' + id), out = $('#o_' + id);
    el.value = SET[key]; if(out) out.textContent = fmt(SET[key]);
    el.oninput = ()=>{ SET[key] = +el.value; if(out) out.textContent = fmt(SET[key]); applySettings(); saveSettings(); STATE.needFrame = true; };
  };
  bindRange('sens', 'sens', v=> v.toFixed(2));
  bindRange('ads', 'ads', v=> v.toFixed(2));
  bindRange('fov', 'fov', v=> v + '°');
  bindRange('vol', 'vol', v=> v + '%');
  bindRange('exp', 'exp', v=> v.toFixed(2));
  $('#s_inv').checked = SET.inv; $('#s_inv').onchange = ()=>{ SET.inv = $('#s_inv').checked; saveSettings(); };
  $('#s_tone').value = SET.tone;
  $('#s_tone').onchange = ()=>{ SET.tone = $('#s_tone').value; applySettings(); saveSettings(); STATE.needFrame = true; };
  $('#s_reset').onclick = ()=>{ Object.assign(SET, SET_DEF, {keys:{}}); saveSettings(); rebuildKeymap(); setupSettings(); renderKeyHelp(); applySettings(); STATE.needFrame = true; };
  renderBinds();
  applySettings();
}
function renderBinds(){
  const box = $('#binds'); box.innerHTML = '';
  for(const [a, label] of ACTIONS){
    const row = document.createElement('div'); row.className = 'bind';
    const b = document.createElement('button'); b.textContent = keyName(KEYMAP[a]);
    b.onclick = ()=>{
      b.classList.add('wait'); b.textContent = '…';
      const onMouse = e=>{ const c = MOUSE_CODE[e.button]; if(c){ e.preventDefault(); e.stopPropagation(); done(c); } };
      const done = code=>{
        INPUT.capture = null; removeEventListener('mousedown', onMouse, true);
        if(code && code !== 'Escape' && !CTRL(code)){
          // клавиша, уже занятая другим действием, переходит к нему от этого
          for(const [o] of ACTIONS) if(o !== a && KEYMAP[o] === code) SET.keys[o] = KEYMAP[a];
          SET.keys[a] = code;
        }
        rebuildKeymap(); saveSettings(); renderBinds(); renderKeyHelp();
      };
      setTimeout(()=> addEventListener('mousedown', onMouse, true), 0);
      INPUT.capture = done;
    };
    const s = document.createElement('span'); s.textContent = label;
    row.append(s, b); box.appendChild(row);
  }
}
function renderKeyHelp(){
  const K = a=> keyName(KEYMAP[a]);
  const mv = [K('fwd'), K('left'), K('back'), K('right')];
  const rows = [
    [mv.every(k=> k.length === 1) ? mv.join('') : mv.join('/'), 'движение'],
    [K('sprint'), 'бег'], [K('jump'), 'прыжок'],
    [K('crouch') + (KB.locked ? ' / Ctrl' : ''), 'присесть'], ['ЛКМ', 'огонь'], ['ПКМ', 'прицел'],
    [K('reload'), 'перезарядка'], [K('frag'), 'граната'], [K('molotov'), 'зажигательная'],
    [K('use'), 'дверь · с разбега выбить'], [K('supply'), 'ящик: боезапас'], [K('fly'), 'полёт/ходьба'],
    [K('menu'), 'меню / точка'], [`${K('phase')} / ${K('daypause')}`, 'время суток'], [K('hints'), 'подсказки'],
    ['F3', 'FPS'], ['Esc', 'пауза']
  ];
  $('#keys').innerHTML = rows.map(([k, t])=> `<div><b>${k}</b>${t}</div>`).join('');
  $('#burnkey').textContent = K('crouch');
  $('#hints').innerHTML = `<b>ЛКМ</b> огонь — дерево пробивается насквозь · <b>${K('frag')}</b> граната · <b>${K('molotov')}</b> зажигательная<br>`
    + `<b>${K('use')}</b> дверь (с разбега — выбить) · <b>${K('supply')}</b> у ящика на базе — боезапас · <b>${K('hints')}</b> скрыть`;
}

/* ---------- HUD: пишем в DOM только то, что изменилось ---------- */
const HUD = { dirty:true, last:{}, t:0, el:null, miniT:0 };
function hudSet(key, el, prop, val){
  if(HUD.last[key] === val) return;
  HUD.last[key] = val;
  if(prop === 'text') el.textContent = val; else if(prop === 'html') el.innerHTML = val; else el.style[prop] = val;
}
function hudEls(){
  if(HUD.el) return HUD.el;
  const ids = ['hp_bar','hp_num','ammo','nades','dmg','cross','clock','dead','concuss','prompt','hitm','mini','feed'];
  HUD.el = {}; for(const id of ids) HUD.el[id] = $('#' + id);
  HUD.el.strip = $('#compass .strip');
  HUD.el.arcs = [...document.querySelectorAll('#dmgdir i')].map(el=>({el, t:0, a:0}));
  return HUD.el;
}
function updateHUD(dt){
  const E = hudEls();
  // компас и дуги урона — каждый кадр (плавность), остальное — 20 раз в секунду
  const bearing = ((-PL.yaw*180/Math.PI) % 360 + 360) % 360;
  hudSet('cmp', E.strip, 'transform', `translateX(${(COMPASS.w/2 - (bearing + 360)*COMPASS.px).toFixed(1)}px)`);
  for(const a of E.arcs){
    if(a.t <= 0) continue;
    a.t = Math.max(0, a.t - dt*0.9);
    const rel = PL.yaw - a.a;
    a.el.style.transform = `rotate(${(rel*180/Math.PI).toFixed(1)}deg)`;
    a.el.style.opacity = Math.min(1, a.t*1.4).toFixed(2);
  }
  HUD.t += dt; if(HUD.t < 0.05 && !HUD.dirty) return;
  const step = Math.max(HUD.t, 0.05); HUD.t = 0; HUD.dirty = false;
  const hp = Math.ceil(PL.hp);
  hudSet('hpw', E.hp_bar, 'width', hp + '%');
  hudSet('hp', E.hp_num, 'text', String(hp));
  hudSet('ammo', E.ammo, 'text', PL.fly ? '' : (WPN.reloadT > 0 ? 'ПЕРЕЗАРЯДКА' : `${WPN.mag} / ${WPN.reserve}`));
  hudSet('nades', E.nades, 'text', PL.fly ? '' : `${keyName(KEYMAP.frag)} ×${WPN.frags}   ${keyName(KEYMAP.molotov)} ×${WPN.fire}`);
  hudSet('dmg', E.dmg, 'opacity', Math.min(1, PL.damageFx*0.9 + (PL.hp < 35 ? 0.25 : 0)).toFixed(2));
  hudSet('cro', E.cross, 'opacity', String(PL.fly || !PL.alive ? 0 : +(1 - PL.ads*0.85).toFixed(2)));
  const spread = Math.round(8 + Math.min(PL.speed, 6)*2.5 + WPN.kick*6);
  if(HUD.last.spread !== spread){ HUD.last.spread = spread; E.cross.style.setProperty('--g', spread + 'px'); }
  hudSet('clock', E.clock, 'text', `${dayClock(DAY.t)} · ${phaseName(DAY.t)}${PL.fly ? ' · НАБЛЮДАТЕЛЬ' : ''}`);
  hudSet('dead', E.dead, 'opacity', PL.alive ? '0' : '1');
  hudSet('conc', E.concuss, 'opacity', (PL.deaf*0.7).toFixed(2));
  // подсказка взаимодействия: ящик, дверь
  let pr = '', bar = -1;
  if(PL.alive && !PL.fly){
    if(SUPPLY.busy){ pr = 'ПОПОЛНЕНИЕ БОЕЗАПАСА…'; bar = SUPPLY.t/SUPPLY.dur; }
    else if(nearestBox()) pr = `<b>${keyName(KEYMAP.supply)}</b>` + (supplyFull() ? 'БОЕЗАПАС ПОЛОН' : 'ПОПОЛНИТЬ БОЕЗАПАС');
    else {
      const d = lookDoor();
      if(d) pr = d.broken ? 'ДВЕРЬ ВЫБИТА' : `<b>${keyName(KEYMAP.use)}</b>${d.target > 0.5 ? 'ЗАКРЫТЬ ДВЕРЬ' : 'ОТКРЫТЬ ДВЕРЬ'}${PL.sprint ? ' · ВЫБИТЬ' : ''}`;
    }
  }
  hudSet('pr', E.prompt, 'html', pr + (bar >= 0 ? `<div class="bar"><i style="width:${Math.round(bar*100)}%"></i></div>` : ''));
  hudSet('pro', E.prompt, 'opacity', pr ? '1' : '0');
  HUD.miniT += step;
  if(HUD.miniT >= 0.1){ HUD.miniT = 0; drawMini(E.mini); }
}
/* ---------- компас: полоса с румбами, сдвиг по курсу ---------- */
const COMPASS = { px: 2.4, w: 440 };
function buildCompass(){
  const strip = $('#compass .strip'); if(!strip) return;
  const names = {0:'С', 45:'СВ', 90:'В', 135:'ЮВ', 180:'Ю', 225:'ЮЗ', 270:'З', 315:'СЗ'};
  let html = '';
  for(let d = 0; d <= 720; d += 15){
    const n = names[d % 360];
    html += `<span class="${n ? '' : 'm'}" style="left:${(d*COMPASS.px).toFixed(1)}px">${n || (d % 360)}</span>`;
  }
  strip.innerHTML = html;
  const fit = ()=>{ const w = $('#compass').getBoundingClientRect().width; if(w) COMPASS.w = w; HUD.last.cmp = null; };
  fit(); addEventListener('resize', fit);
}
/* ---------- миникарта в бою: статичный фон + огонь + игрок, повёрнута по взгляду ---------- */
let _miniBg = null, _miniTeam = null;
function miniBg(force){
  if(_miniBg && !force && _miniTeam === STATE.team) return _miniBg;
  const c = document.createElement('canvas'); c.width = 840; c.height = 640;
  drawMinimap(c, STATE.team, null, null);
  _miniBg = c; _miniTeam = STATE.team;
  return c;
}
function drawMini(cv){
  if(!cv || !STATE.playing) return;
  const x = cv.getContext('2d'), W = cv.width, bg = miniBg();
  const s = Math.min(840/(HW*2+4), 640/(HD*2+4)), zoom = 1.3;
  const px = 420 + camera.position.x*s, pz = 320 + camera.position.z*s;
  x.setTransform(1,0,0,1,0,0);
  x.fillStyle = 'rgb(14,16,18)'; x.fillRect(0,0,W,W);
  x.save(); x.translate(W/2, W/2); x.scale(zoom, zoom); x.rotate(PL.yaw); x.translate(-px, -pz);
  x.drawImage(bg, 0, 0);
  x.fillStyle = 'rgba(255,120,40,.9)';
  for(const f of FIRES){ if(f.I < 0.2) continue; x.beginPath(); x.arc(420 + f.p.x*s, 320 + f.p.z*s, 1.5 + f.I*2.5, 0, 7); x.fill(); }
  x.restore();
  x.fillStyle = '#fff'; x.beginPath(); x.moveTo(W/2, W/2 - 13); x.lineTo(W/2 + 9, W/2 + 10); x.lineTo(W/2, W/2 + 5); x.lineTo(W/2 - 9, W/2 + 10); x.fill();
  // «С» по краю — там, где на экране север
  const r = W/2 - 18;
  x.fillStyle = '#e8eaec'; x.font = '700 24px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('С', W/2 + Math.sin(PL.yaw)*r, W/2 - Math.cos(PL.yaw)*r);
}
/* ---------- лента событий ---------- */
function feed(html){
  const box = $('#feed'); if(!box) return;
  const d = document.createElement('div'); d.innerHTML = html; box.prepend(d);
  while(box.children.length > 5) box.lastChild.remove();
  later(5.5, ()=> d.classList.add('fade'));
  later(6.2, ()=> d.remove());
}
/* ---------- отметка попадания и направление урона ---------- */
function hitFeedback(kind){
  const el = hudEls().hitm;
  el.classList.toggle('kill', kind >= 2);
  el.style.transition = 'none'; el.style.opacity = '1';
  void el.offsetWidth;
  el.style.transition = 'opacity .28s ease-out .06s'; el.style.opacity = '0';
  SND.hitmark(kind >= 2);
}
/** Дуга у прицела показывает, откуда прилетел урон. */
function damageFrom(p){
  if(!p) return;
  const a = Math.atan2(-(p.x - PL.eye.x), -(p.z - PL.eye.z));      // yaw, при котором взгляд направлен на источник
  const arcs = hudEls().arcs;
  const slot = arcs.find(s=> s.t > 0 && Math.abs(Math.atan2(Math.sin(s.a - a), Math.cos(s.a - a))) < 0.4) || arcs.reduce((m, s)=> s.t < m.t ? s : m);
  slot.a = a; slot.t = 1.6;
}

/* ---------- отладочный API (проверки из консоли и автотестов) ---------- */
function api(stats){
  return {
    THREE, scene, camera, renderer, PH, DEST, FIRES, PL, WPN, TEAMS, COLLIDERS, stats, keys, INPUT, DOORS, PITS, DYNRES, M,
    DOOR_LEAVES, AMMO_BOXES, SUPPLY, SET, EXPO, useDoor, trySupply, lookDoor, openMenu, closeMenu, STATE,
    AVOL, AVOL_U, FOG_U, avolOpen, FXS, PFX_U, getPasses,
    burn:(s=1)=> ignitePlayer(PL.eye, 1, s),
    step:(dt=1/60, n=1)=>{ for(let i=0;i<n;i++) step(dt); },
    render:()=> getComposer().render(),
    view:(x,y,z, lx,ly,lz)=>{ WPN.viewmodel.visible = false; PL.fly = true; PL.char.enable(false); PL.flyPos.set(x,y,z); camera.position.set(x,y,z);
      const d = new THREE.Vector3(lx-x, ly-y, lz-z).normalize(); PL.yaw = Math.atan2(-d.x, -d.z); PL.pitch = Math.asin(d.y);
      updatePlayer(0, 0); },
    walkTo:(x,z)=>{ setFly(false); PL.char.warp(new THREE.Vector3(x, 1.2, z)); },
    deploy:(team='ALPHA', id)=>{ STATE.team = team; STATE.spawn = TEAMS[team].spawns.find(s=>s.id===id) || TEAMS[team].spawns[0]; deploy(); },
    shoot:()=>{ INPUT.locked = true; WPN.cool = 0; INPUT.mouseDown = true; updateWeapons(0.001); INPUT.mouseDown = false; },
    grenade:(x,y,z)=> grenadeExplode(new THREE.Vector3(x,y,z), 1),
    throw:(code='KeyG')=> weaponKey(code),
    blowBarrel:(x=-28,z=-27)=>{ const p = DEST.props.filter(q=>q.explosive && !q.dead).sort((a,b)=>Math.hypot(a.center.x-x,a.center.z-z)-Math.hypot(b.center.x-x,b.center.z-z))[0];
      if(p) breakProp(p, p.center.clone(), new THREE.Vector3(1,0,0), 1, 'bullet'); return !!p; },
    fire:(x,y,z,s=1)=> ignite(new THREE.Vector3(x,y,z), s, 1.5, s>=0.9),
    time:(t)=>{ DAY.t = t; applyDaylight(t); renderer.shadowMap.needsUpdate = true; },
    pause:(v=true)=>{ DAY.paused = v; },
    ray:(a,b)=> rayFirst(a, b, GRP.STATIC),
    rayDown:(x,z)=> rayFirst(new THREE.Vector3(x, 20, z), new THREE.Vector3(x, -1, z), GRP.STATIC)
  };
}

build().catch(err=>{
  console.error(err);
  if(!(err && err.angarShown)) fatal('Ошибка при сборке карты', String(err && err.message || err));
});
