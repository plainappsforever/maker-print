// One planned output page drawn from the plan's ops (D46) — the layout the PDF writer will write: tiles with their
// registration marks, labels and trim lines, the assembly map, the check bar, objects clipped to the safe area.
// Drawn in the layout frame (a landscape tile is shown landscape; on paper it is turned onto portrait paper, D53).
import { memo } from 'react';
import Svg, { ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { checkBarContent, checkBarMatrix } from '@/engine/checkbar';
import type { Page, PrintPlan } from '@/engine/plan';

import { previewKey } from './sheet-graphic';
import { AssetBody, ContentView, mat, rgb } from './svg-items';

export const PageView = memo(function PageView({ page, plan, previews, caption, width, index }: { page: Page; plan: PrintPlan; previews: Readonly<Record<string, string>>; caption: string; width: number; index: number }) {
  const landscape = page.orientation === 'landscape';
  const W = landscape ? page.heightMm : page.widthMm;
  const H = landscape ? page.widthMm : page.heightMm;
  const k = width / W;
  const hair = 1 / k;
  return (
    <Svg width={width} height={H * k}>
      <G transform={[k, 0, 0, k, 0, 0]}>
        <Rect x={0} y={0} width={W} height={H} fill="white" stroke="rgb(150,150,150)" strokeWidth={hair} />
        <Rect x={page.safe.x} y={page.safe.y} width={page.safe.w} height={page.safe.h} fill="none" stroke="rgb(10,107,216)" strokeOpacity={0.35} strokeWidth={hair} strokeDasharray={[hair * 4, hair * 3]} />
        {page.ops.map((op, i) => {
          const id = `pg${index}c${i}`;
          if (op.op === 'path') {
            const body = <Path d={op.d} stroke={rgb(op.stroke)} fill={rgb(op.fill)} strokeWidth={op.stroke ? Math.max(op.widthMm, hair * 0.5) : 0} />;
            if (!op.clip) return <G key={i}>{body}</G>;
            return (
              <G key={i}>
                <Defs>
                  <ClipPath id={id}>
                    <Rect x={op.clip.x} y={op.clip.y} width={op.clip.w} height={op.clip.h} />
                  </ClipPath>
                </Defs>
                <G clipPath={`url(#${id})`}>{body}</G>
              </G>
            );
          }
          if (op.op === 'text') {
            return (
              <SvgText key={i} x={op.x} y={op.y} fontSize={op.sizeMm} fontFamily="Helvetica" fill={rgb(op.colour)}>
                {op.text}
              </SvgText>
            );
          }
          if (op.op === 'checkBar') {
            return (
              <G key={i} transform={mat(checkBarMatrix(op.x, op.y, op.vertical))}>
                <ContentView content={checkBarContent(caption)} minStrokeMm={hair * 0.5} />
              </G>
            );
          }
          const content = plan.content[op.objectId];
          return (
            <G key={i}>
              <Defs>
                <ClipPath id={id}>
                  <Rect x={op.clip.x} y={op.clip.y} width={op.clip.w} height={op.clip.h} />
                </ClipPath>
              </Defs>
              <G clipPath={`url(#${id})`}>
                <G transform={mat(op.transform)}>
                  {content ? (
                    <ContentView content={content} minStrokeMm={hair * 0.5} />
                  ) : op.source ? (
                    <AssetBody id={`${id}a`} href={previews[previewKey(op.source.assetId, op.source.pageIndex)] ?? null} natural={op.source.natural} map={op.source.map} box={op.box} />
                  ) : null}
                </G>
              </G>
            </G>
          );
        })}
      </G>
    </Svg>
  );
});
