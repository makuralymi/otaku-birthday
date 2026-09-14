/* ============================================================
   config.js · 抓取 / 兜底线路配置
   默认「直连原站 CDN」，直连失败才启用镜像与第三方代理，全部可关闭。
   ============================================================ */

export const CONFIG = {
  /* 卡片缩略图 / 详情大图的目标宽度（代理线路会用来缩放） */
  thumbWidth: 240,
  largeWidth: 720,

  /* 同内容镜像主机：换域名不换内容，几乎不会失败的一层兜底 */
  hostMirrors: {
    't.vndb.org': ['s.vndb.org'],
    's.vndb.org': ['t.vndb.org'],
  },

  /* 第三方图片代理：把任意图源变成可跨域、可缩放的图片。
     仅在直连与镜像都失败时使用；置为空数组即可完全关闭。 */
  proxies: [
    { name: 'photon', build: (host, path, width) => `https://i0.wp.com/${host}${path}?w=${width}&quality=85` },
    { name: 'wsrv', build: (host, path, width) => `https://wsrv.nl/?url=${host}${path}&w=${width}&output=webp&we` },
  ],

  /* 本地图缓存清单（scripts/cache_images.py 生成；不存在时自动跳过这一层） */
  localManifest: 'data/local_images.json',
  preferLocal: true,

  /* 多数 CDN 反而更喜欢不带 referer 的图片请求 */
  referrerPolicy: 'no-referrer',

  /* 数据文件的多线路（按顺序降级） */
  dataRoutes: {
    meta: ['data/meta.json'],
    month: (m) => [`data/months/${String(m).padStart(2, '0')}.csv`],
    all: ['data/characters.csv'],
  },
};
