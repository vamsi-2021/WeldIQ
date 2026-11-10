import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { cameraColors, colors as lightColors, formatPercent } from '../theme';

interface Props {
  /** Fill per azimuth segment, 0..1. Empty array = coverage not measurable. */
  segments: number[];
  /** Segment the camera is currently in, or -1. */
  currentSegment?: number;
  /** Overall weighted coverage, or null when unmeasurable. */
  coverage: number | null;
  size: number;
  /** Shows the coverage figure in the middle of the ring. */
  showLabel?: boolean;
  /** Render children (e.g. the alignment guide) inside the ring. */
  children?: React.ReactNode;
  /** "camera" for the dark palette used over the live camera feed. */
  palette?: 'light' | 'camera';
}

const DEFAULT_SEGMENTS = 24;
const GAP_DEG = 3;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

function segmentColor(colors: typeof lightColors, fill: number) {
  if (fill >= 0.99) {
    return colors.accent;
  }
  if (fill > 0) {
    return colors.accentDim;
  }
  return colors.track;
}

/**
 * Face ID–style segmented ring. Each segment is one 15° sector around the weld,
 * starting at the bottom (where the scan began). Bright = seen from low and
 * mid height, dim = seen from one height only, grey = not yet seen.
 */
export function ScanProgress({
  segments,
  currentSegment = -1,
  coverage,
  size,
  showLabel,
  children,
  palette = 'light',
}: Props) {
  const colors = palette === 'camera' ? cameraColors : lightColors;
  const stroke = Math.max(6, size * 0.035);
  const r = size / 2 - stroke - 6;
  const c = size / 2;
  const n = segments.length || DEFAULT_SEGMENTS;
  const per = 360 / n;
  const measurable = segments.length > 0;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G>
          {Array.from({ length: n }).map((_, i) => {
            // Segment 0 is centred at the bottom of the ring (90° in SVG space).
            const mid = 90 + i * per;
            const d = arcPath(c, c, r, mid - per / 2 + GAP_DEG / 2, mid + per / 2 - GAP_DEG / 2);
            const fill = measurable ? segments[i] : 0;
            return (
              <Path
                key={i}
                d={d}
                stroke={measurable ? segmentColor(colors, fill) : colors.track}
                strokeWidth={stroke}
                strokeLinecap="round"
                fill="none"
              />
            );
          })}
          {measurable && currentSegment >= 0 && (
            <Circle
              cx={polar(c, c, r, 90 + currentSegment * per).x}
              cy={polar(c, c, r, 90 + currentSegment * per).y}
              r={stroke * 0.85}
              fill={colors.text}
              stroke={colors.accent}
              strokeWidth={2}
            />
          )}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
        {children}
        {showLabel && (
          <View style={styles.label}>
            <Text style={[styles.value, { color: colors.text }]}>{formatPercent(coverage)}</Text>
            <Text style={[styles.caption, { color: colors.muted }]}>{measurable ? 'angle coverage' : 'coverage n/a'}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  label: { alignItems: 'center' },
  value: { fontSize: 28, fontWeight: '700' },
  caption: { fontSize: 12, marginTop: 2 },
});
