// The sheet drawn in mm (SPEC §9.2): paper, safe area (dashed), learned non-printable area (hatched), tile
// boundaries of big sheets, the editor grid, objects with their repeat copies, snap guides and the selection handles.
import { memo, useMemo } from 'react';
import { Defs, G, Line, Path, Pattern, Polygon, Rect, Text as SvgText, Circle } from 'react-native-svg';

import type { Asset } from '@/db/assets';
import type { SheetObject } from '@/db/objects';
import { cornerPoints, rotateHandlePoint, ROTATE_HANDLE_PT } from '@/editor/gestures';
import { isVectorAsset, naturalOf, scaleOf } from '@/editor/info';
import { NO_CROP, objectMatrix, sourceToLocal } from '@/engine/geometry';
import { isVectorKind, objectContent, type GenContext } from '@/engine/generators';
import type { Margins } from '@/engine/paper';
import { repeatCopies } from '@/engine/repeat';
import type { SnapGuide } from '@/engine/snap';
import type { Tile } from '@/engine/tiles';

import { AssetBody, ContentView, mat } from './svg-items';

/** More copies than this are drawn as outlines only (the PDF has them all). */
export const MAX_DRAWN_COPIES = 300;
export const previewKey = (assetId: number, pageIndex: number) => `${assetId}:${pageIndex}`;

type ObjectProps = { o: SheetObject; asset: Asset | undefined; href: string | null; ctx: GenContext; hairMm: number; showBadge: boolean };

/** One object (copy 0,0) in its local frame; memoised so a drag re-renders only the moving object. */
const ObjectBody = memo(function ObjectBody({ o, asset, href, ctx, hairMm }: Omit<ObjectProps, 'showBadge'>) {
  const content = useMemo(() => (isVectorKind(o.kind) ? objectContent(o.kind, o.w, o.h, o.props, ctx) : null), [o.kind, o.w, o.h, o.props, ctx]);
  if (content) return <ContentView content={content} minStrokeMm={hairMm} />;
  const natural = naturalOf(o, asset);
  if (!natural) return <Rect x={0} y={0} width={o.w} height={o.h} fill="rgb(255,236,179)" stroke="rgb(230,81,0)" strokeWidth={hairMm} />;
  const map = sourceToLocal(natural, o.crop ?? NO_CROP, { w: o.w, h: o.h }, o.fit);
  return <AssetBody id={`clip${o.id}`} href={href} natural={natural} map={map} box={{ w: o.w, h: o.h }} />;
});

const ObjectItem = memo(function ObjectItem({ o, asset, href, ctx, hairMm, showBadge }: ObjectProps) {
  const copies = useMemo(() => repeatCopies(o, o.repeat), [o]);
  const notDesigned = useMemo(() => {
    if (!showBadge || !isVectorAsset(o)) return false;
    const n = naturalOf(o, asset);
    return n ? !scaleOf(o, n).designed : false;
  }, [o, asset, showBadge]);
  return (
    <>
      {copies.map((c, i) =>
        i < MAX_DRAWN_COPIES ? (
          <G key={i} transform={mat(objectMatrix({ ...o, x: c.x, y: c.y }))}>
            <ObjectBody o={o} asset={asset} href={href} ctx={ctx} hairMm={hairMm} />
          </G>
        ) : i < MAX_DRAWN_COPIES * 10 ? (
          <G key={i} transform={mat(objectMatrix({ ...o, x: c.x, y: c.y }))}>
            <Rect x={0} y={0} width={o.w} height={o.h} fill="none" stroke="rgb(150,150,150)" strokeWidth={hairMm} />
          </G>
        ) : null
      )}
      {notDesigned ? (
        <G transform={mat(objectMatrix(o))}>
          <Rect x={0} y={0} width={o.w} height={o.h} fill="none" stroke="rgb(230,81,0)" strokeWidth={hairMm * 2} strokeDasharray={[hairMm * 6, hairMm * 4]} />
        </G>
      ) : null}
    </>
  );
});

export type SheetGraphicProps = {
  sheet: { widthMm: number; heightMm: number };
  objects: readonly SheetObject[];
  assets: ReadonlyMap<number, Asset>;
  previews: Readonly<Record<string, string>>;
  ctx: GenContext;
  /** screen points per mm (hairlines and handles stay a constant size on screen) */
  scale: number;
  margins?: Margins | null;
  /** learned printer margins (non-printable, hatched) when the sheet prints 1:1 */
  hatch?: Margins | null;
  tiles?: readonly Tile[];
  gridMm?: number | null;
  guides?: readonly SnapGuide[];
  selectedId?: number | null;
  showBadges?: boolean;
};

export function SheetGraphic(p: SheetGraphicProps) {
  const W = p.sheet.widthMm;
  const H = p.sheet.heightMm;
  const hair = 1 / p.scale; // 1 screen point in mm
  const selected = p.selectedId != null ? p.objects.find((o) => o.id === p.selectedId) : undefined;
  const grid = useMemo(() => {
    if (!p.gridMm || p.gridMm * p.scale < 6) return null; // too dense to see
    const b: string[] = [];
    for (let x = p.gridMm; x < W; x += p.gridMm) b.push(`M${x} 0V${H}`);
    for (let y = p.gridMm; y < H; y += p.gridMm) b.push(`M0 ${y}H${W}`);
    return b.join('');
  }, [p.gridMm, p.scale, W, H]);
  return (
    <>
      <Defs>
        <Pattern id="hatch" patternUnits="userSpaceOnUse" width={hair * 8} height={hair * 8}>
          <Path d={`M0 ${hair * 8}L${hair * 8} 0`} stroke="rgb(198,40,40)" strokeOpacity={0.45} strokeWidth={hair} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={W} height={H} fill="white" stroke="rgb(120,120,120)" strokeWidth={hair} />
      {grid ? <Path d={grid} stroke="rgb(210,225,245)" strokeWidth={hair} /> : null}
      {p.objects.map((o) =>
        o.hidden ? null : (
          <ObjectItem
            key={o.id}
            o={o}
            asset={o.assetId != null ? p.assets.get(o.assetId) : undefined}
            href={o.assetId != null ? (p.previews[previewKey(o.assetId, o.pageIndex)] ?? null) : null}
            ctx={p.ctx}
            hairMm={hair}
            showBadge={p.showBadges ?? true}
          />
        )
      )}
      {p.hatch ? (
        <Path
          d={`M0 0H${W}V${H}H0Z M${p.hatch.l} ${p.hatch.t}V${H - p.hatch.b}H${W - p.hatch.r}V${p.hatch.t}Z`}
          fill="url(#hatch)"
          fillRule="evenodd"
        />
      ) : null}
      {p.margins ? (
        <Rect
          x={p.margins.l}
          y={p.margins.t}
          width={Math.max(0, W - p.margins.l - p.margins.r)}
          height={Math.max(0, H - p.margins.t - p.margins.b)}
          fill="none"
          stroke="rgb(10,107,216)"
          strokeOpacity={0.6}
          strokeWidth={hair}
          strokeDasharray={[hair * 6, hair * 4]}
        />
      ) : null}
      {p.tiles?.map((t) => (
        <G key={t.label}>
          <Rect x={t.visible.x} y={t.visible.y} width={t.visible.w} height={t.visible.h} fill="none" stroke="rgb(123,31,162)" strokeOpacity={0.7} strokeWidth={hair * 1.5} strokeDasharray={[hair * 10, hair * 5]} />
          <SvgText x={t.visible.x + hair * 6} y={t.visible.y + hair * 18} fontSize={hair * 14} fill="rgb(123,31,162)" fontWeight="bold">
            {t.label}
          </SvgText>
        </G>
      ))}
      {p.guides?.map((g, i) =>
        g.axis === 'x' ? (
          <Line key={i} x1={g.at} y1={-H} x2={g.at} y2={2 * H} stroke="rgb(233,30,99)" strokeWidth={hair} />
        ) : (
          <Line key={i} x1={-W} y1={g.at} x2={2 * W} y2={g.at} stroke="rgb(233,30,99)" strokeWidth={hair} />
        )
      )}
      {selected ? <Selection o={selected} hair={hair} /> : null}
    </>
  );
}

function Selection({ o, hair }: { o: SheetObject; hair: number }) {
  const cs = cornerPoints(o);
  const pts = [cs.tl, cs.tr, cs.br, cs.bl].map((q) => `${q.x},${q.y}`).join(' ');
  const top = { x: (cs.tl.x + cs.tr.x) / 2, y: (cs.tl.y + cs.tr.y) / 2 };
  const rot = rotateHandlePoint(o, ROTATE_HANDLE_PT * hair);
  const handle = 7 * hair;
  return (
    <G>
      <Polygon points={pts} fill="none" stroke="rgb(10,107,216)" strokeWidth={hair * 1.5} />
      {o.locked ? null : (
        <>
          <Line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} stroke="rgb(10,107,216)" strokeWidth={hair * 1.5} />
          <Circle cx={rot.x} cy={rot.y} r={handle} fill="white" stroke="rgb(10,107,216)" strokeWidth={hair * 2} />
          {[cs.tl, cs.tr, cs.br, cs.bl].map((q, i) => (
            <Circle key={i} cx={q.x} cy={q.y} r={handle} fill="white" stroke="rgb(10,107,216)" strokeWidth={hair * 2} />
          ))}
        </>
      )}
    </G>
  );
}
