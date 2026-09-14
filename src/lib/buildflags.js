/* ============================================================
   buildflags.js · 构建期开关
   · CLEAN_BUILD        无外链、无分享（用于不允许外链的平台）
   · LOCAL_IMAGES_ONLY  连立绘也不请求站外图，只用本地缓存 + 纯色占位卡
   两个常量都在构建时被替换成字面量，关闭时相关代码会被打包器直接摇掉。
   ============================================================ */

export const CLEAN_BUILD = typeof __CLEAN_BUILD__ !== 'undefined' ? __CLEAN_BUILD__ : false;
export const LOCAL_IMAGES_ONLY = typeof __LOCAL_IMAGES_ONLY__ !== 'undefined' ? __LOCAL_IMAGES_ONLY__ : false;
