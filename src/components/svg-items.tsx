// react-native-svg drawing of engine geometry (D20): everything in millimetres inside a scaled group, so the screen
// shows the same paths, texts and source maps the PDF writer uses. Never claims a size (L26): the screen is a view.
import { memo } from 'react';
import { ClipPath, Defs, G, Image as SvgImage, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { Affine } from '@/engine/geometry';
import type { Content, Rgb } from '@/engine/path';

export const rgb = (c: Rgb | null | undefined) => (c ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})` : 'none');
export const mat = (m: Affine): [number, number, number, number, number, number] => [m[0], m[1], m[2], m[3], m[4], m[5]];

/** Paths and texts of engine content (local mm). `minStrokeMm` keeps hairlines visible when zoomed out. */
export const ContentView = memo(function ContentView({ content, minStrokeMm = 0 }: { content: Content; minStrokeMm?: number }) {
  return (
    <>
      {content.paths.map((p, i) => (
        <Path
          key={`p${i}`}
          d={p.d}
          stroke={rgb(p.stroke)}
          fill={rgb(p.fill)}
          strokeWidth={p.stroke ? Math.max(p.widthMm, minStrokeMm) : 0}
          strokeLinecap={p.cap === 'round' ? 'round' : 'butt'}
        />
      ))}
      {content.texts.map((t, i) => (
        <SvgText key={`t${i}`} x={t.x} y={t.y} fontSize={t.sizeMm} fontFamily="Helvetica" fill={rgb(t.colour)}>
          {t.text}
        </SvgText>
      ))}
    </>
  );
});

/**
 * An imported file's preview inside the object's local box [0,w]×[0,h]: the preview bitmap stretched over the
 * source's natural extent (image px / PDF or SVG mm), mapped by the same source → local map the writer uses, clipped
 * to the box. No preview yet → a grey placeholder box.
 */
export function AssetBody({ id, href, natural, map, box }: { id: string; href: string | null; natural: { w: number; h: number }; map: Affine; box: { w: number; h: number } }) {
  if (!href) return <Rect x={0} y={0} width={box.w} height={box.h} fill="rgb(225,225,230)" />;
  return (
    <>
      <Defs>
        <ClipPath id={id}>
          <Rect x={0} y={0} width={box.w} height={box.h} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <G transform={mat(map)}>
          <SvgImage href={{ uri: href }} x={0} y={0} width={natural.w} height={natural.h} preserveAspectRatio="none" />
        </G>
      </G>
    </>
  );
}
