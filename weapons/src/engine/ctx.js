// src/engine/ctx.js
import * as THREE5 from "three";

function makeCtx(mats) {
  return {
    THREE: THREE5,
    G: geo_exports,
    C: common_exports,
    mats,
    mount,
    railMount,
    kit: () => new Kit(mats),
    // Узел, скрываемый при установке модуля с part.hides = [key]
    hideable(obj, key) {
      obj.userData.hideKey = key;
      return obj;
    }
  };
}


