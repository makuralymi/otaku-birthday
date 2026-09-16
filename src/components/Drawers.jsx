/* ============================================================
   Drawers.jsx · 角色详情抽屉 + 收藏夹
   布局用纯色块分区：头像区、色板区、信息区各是一块实色。
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react';
import { displayName, subName, primaryWork, SRC_LABEL } from '../lib/data.js';
import { cardVars, paletteForCard, quickPalette } from '../lib/palette.js';
import { routeChain, mountImage, loadedRouteOf, placeholderURI } from '../lib/images.js';
import { CLEAN_BUILD, LOCAL_IMAGES_ONLY } from '../lib/buildflags.js';
import { compact, linksOf } from '../lib/format.js';
import { PaletteBlocks } from './Hero.jsx';

export const DRAWER_EXIT_MS = 300;   // 必须与 CSS 里 drawer-out 的时长一致

/** 带「Q弹退场」的关闭流程：
 *  关闭不是立刻卸载，而是先加 .closing 播退场动画，动画结束再真正 onClose()。
 *  ESC / 遮罩 / 关闭按钮 / 「打开某条收藏」都走这里；开启减少动效时直接关。
 *  after：可选的「关闭后要做的事」（例如收藏夹里点某条 → 退场后再跳转）。 */
function useSpringClose(onClose) {
  const [closing, setClosing] = useState(false);
  const afterRef = useRef(null);
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  const requestClose = useCallback((after) => {
    if (reduce || closing) {
      if (!closing) (after || onClose)?.();
      return;
    }
    afterRef.current = after || null;
    setClosing(true);
  }, [reduce, closing, onClose]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = setTimeout(() => {
      const after = afterRef.current;
      afterRef.current = null;
      if (after) after();
      else onClose?.();
    }, DRAWER_EXIT_MS);
    return () => clearTimeout(timer);
  }, [closing, onClose]);

  // ESC 也走同一套（有抽屉打开时 App 不再抢 ESC）
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return { closing, requestClose };
}

/** 详情大图：多线路加载 + 加载后按真实图片再取一次色 */
function DetailImage({ char, onPalette }) {
  const imgRef = useRef(null);
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return undefined;
    mountImage(img, routeChain(char, { size: 'large' }), { char, priority: true });
    const onLoad = async () => {
      const loaded = loadedRouteOf(img);
      const fresh = await paletteForCard({ ...char, thumb: loaded.url || char.thumb }, img);
      onPalette?.(fresh);
    };
    img.addEventListener('load', onLoad);
    return () => img.removeEventListener('load', onLoad);
  }, [char, onPalette]);
  return <img ref={imgRef} alt={`${displayName(char)} 立绘`} decoding="async" />;
}

export function DetailDrawer({ char, index, total, palette, isFav, onClose, onPrev, onNext, onToggleFav, onCopy, onNotify }) {
  const [livePalette, setLivePalette] = useState(null);
  const pal = livePalette || palette || quickPalette(char);
  const [copied, setCopied] = useState('');
  const { closing, requestClose } = useSpringClose(onClose);

  useEffect(() => { setLivePalette(null); setCopied(''); }, [char?.id]);

  if (!char) return null;
  const links = linksOf(char);
  const metaRows = [
    ['生日', `${char.month} 月 ${char.day} 日${char.year ? ` · ${char.year} 年` : ''}`],
    char.gender && ['性别', char.gender],
    char.blood && ['血型', `${char.blood} 型`],
    char.age && ['年龄', char.age],
    ['作品类型', char.types.join(' · ')],
    ['人气', char.heat ? compact(char.heat) : '—'],
    char.altNames && ['别名', char.altNames.split(' / ').slice(0, 4).join(' / ')],
  ].filter(Boolean);

  return (
    <aside className={`drawer open${closing ? ' closing' : ''}`} id="drawer" role="dialog" aria-modal="true" aria-label="角色详情">
      <div className="drawer-scrim" onClick={() => requestClose()} />
      {/* key 让换角色时面板重新挂载 → 进场弹簧再弹一次，并且滚动位置回到顶部 */}
      <div className="drawer-panel" id="drawer-panel" key={char.id} data-native-scroll="1" style={cardVars(pal)}>
        <div className="drawer-head">
          <span className="drawer-index">{index + 1} / {total}</span>
          <button className="drawer-close" id="drawer-close" type="button" onClick={() => requestClose()} aria-label="关闭">×</button>
        </div>
        <div className="drawer-body" id="drawer-body" data-native-scroll="1">
          <div className="d-hero">
            <DetailImage char={char} onPalette={(p) => { setLivePalette(p); onCopy?.(p); }} />
            <div className="d-hero-caption">
              <h3>{displayName(char)}</h3>
              <p>{[subName(char), primaryWork(char)].filter(Boolean).join(' · ')}</p>
            </div>
          </div>

          <PaletteBlocks palette={pal} height={12} />

          <div className="d-actions">
            <button className={`btn small${isFav ? ' on' : ''}`} id="drawer-fav" type="button" onClick={() => onToggleFav(char)}>
              {isFav ? '★ 已收藏' : '☆ 收藏'}
            </button>
            {CLEAN_BUILD ? null : (
              <button
                className="btn small"
                type="button"
                onClick={async () => {
                  let msg = '分享链接已复制';
                  try { await navigator.clipboard.writeText(location.href); }
                  catch { msg = location.href; }
                  setCopied(msg);
                  onNotify?.(msg);
                  setTimeout(() => setCopied(''), 1800);
                }}
              >
                {copied || '复制分享链接'}
              </button>
            )}
          </div>

          <div className="d-section">
            <h4>莫奈取色（点击复制）</h4>
            <div className="swatches">
              {(pal.raw.length ? pal.raw : pal.blocks).slice(0, 6).map((hex) => (
                <button
                  key={hex}
                  className="swatch"
                  type="button"
                  style={{ background: hex }}
                  title={`复制 ${hex}`}
                  onClick={async () => {
                    let msg = `已复制色值 ${hex}`;
                    try { await navigator.clipboard.writeText(hex); }
                    catch { msg = hex; }
                    setCopied(msg);
                    onNotify?.(msg);
                    setTimeout(() => setCopied(''), 1800);
                  }}
                >
                  <span>{hex.replace('#', '')}</span>
                </button>
              ))}
            </div>
          </div>

          <table className="meta-table">
            <tbody>
              {metaRows.map(([k, v]) => (
                <tr key={k}><th>{k}</th><td>{v}</td></tr>
              ))}
            </tbody>
          </table>

          {char.summary ? (
            <div className="d-section">
              <h4>简介</h4>
              <p className="d-summary">{char.summary}</p>
            </div>
          ) : null}

          <div className="d-section">
            <h4>登场作品（{char.works.length}）</h4>
            <ul className="work-list">
              {char.works.slice(0, 8).map((w, i) => (
                <li key={`${w.t}-${i}`}>
                  <span className="wt">
                    {w.cn || w.t || '未知作品'}
                    {w.cn && w.t && w.cn !== w.t ? <em>{w.t}</em> : null}
                  </span>
                  <span className="wtype">{[w.ty, w.y].filter(Boolean).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </div>

          {char.tags.length ? (
            <div className="d-section">
              <h4>标签</h4>
              <div className="tag-cloud">
                {char.tags.slice(0, 12).map((t) => <span key={t}>{t}</span>)}
              </div>
            </div>
          ) : null}

          <div className="d-section">
            <h4>{CLEAN_BUILD ? '数据来源' : '查看来源'}</h4>
            {links.length ? (
              <div className="link-row">
                {links.map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                ))}
              </div>
            ) : null}
            <p className="fine">
              数据源：{SRC_LABEL[char.src]?.name || char.src}
              {char.bgmId ? ' + Bangumi' : ''}
              {pal.raw.length ? '' : '（色板来自构建期预计算或稳定哈希）'}
            </p>
          </div>
        </div>

        <div className="drawer-foot">
          <button className="btn small" id="drawer-prev" type="button" onClick={onPrev} disabled={index <= 0}>← 上一位</button>
          <button className="btn small" id="drawer-next" type="button" onClick={onNext} disabled={index >= total - 1}>下一位 →</button>
        </div>
      </div>
    </aside>
  );
}

export function FavoritesDrawer({ favs, onClose, onOpen, onRemove, onExport, onClear }) {
  const { closing, requestClose } = useSpringClose(onClose);
  return (
    <aside className={`drawer wide open${closing ? ' closing' : ''}`} id="fav-drawer" role="dialog" aria-label="我的收藏">
      <div className="drawer-scrim" onClick={() => requestClose()} />
      <div className="drawer-panel" data-native-scroll="1">
        <div className="drawer-head">
          <span className="drawer-index">收藏 {favs.length}</span>
          <button className="drawer-close" id="fav-close" type="button" onClick={() => requestClose()} aria-label="关闭">×</button>
        </div>
        <div className="drawer-body" data-native-scroll="1">
          <h2 className="section-title">我的收藏</h2>
          <p className="section-sub">保存在本机浏览器里，不会上传。</p>
          <div className="d-actions">
            <button className="btn small" type="button" onClick={onExport}>导出收藏 CSV</button>
            <button className="btn small danger" type="button" onClick={onClear}>清空</button>
          </div>
          {favs.length ? (
            <div className="fav-list" id="fav-list">
              {favs.slice().reverse().map((c) => (
                <div className="fav-item" key={c.id}>
                  <span className="fav-thumb" style={{ background: quickPalette(c).surface }}>
                    {c.thumb || LOCAL_IMAGES_ONLY ? (
                      <img
                        src={LOCAL_IMAGES_ONLY ? placeholderURI({ id: c.id, palette: c.palette, nameCn: c.nameCn, nameNative: c.nameNative }) : c.thumb}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    ) : null}
                  </span>
                  <button className="fav-body" type="button" onClick={() => requestClose(() => onOpen(c))}>
                    <b>{displayName(c)}</b>
                    <small>{c.month} 月 {c.day} 日 · {primaryWork(c)}</small>
                  </button>
                  <button className="fav-remove" type="button" onClick={() => onRemove(c)} title="移除" aria-label="移除收藏">✕</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">还没有收藏。点角色卡片右下角的 ☆ 即可收藏。</p>
          )}
        </div>
      </div>
    </aside>
  );
}
