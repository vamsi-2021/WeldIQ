import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import type { ScanStatus } from '../types/ScanTypes';
import { cameraColors as colors, formatDuration, formatPercent, radius } from '../theme';
import { ScanProgress } from './ScanProgress';

interface Props {
  status: ScanStatus | null;
  width: number;
  /** Replaces the last-capture image (used by demo mode, which has no image files). */
  thumbnail?: React.ReactNode;
}

const trackingColor = (s: ScanStatus | null) => {
  if (!s || s.mode === 'manual') {
    return colors.warning;
  }
  return s.tracking === 'normal' ? colors.success : s.tracking === 'limited' ? colors.warning : colors.danger;
};

const trackingLabel = (s: ScanStatus | null) => {
  if (!s) {
    return 'Starting camera';
  }
  if (s.mode === 'manual') {
    return 'Manual mode';
  }
  if (s.mode === 'demo' && s.tracking === 'normal') {
    return 'Tracking (simulated)';
  }
  return s.tracking === 'normal' ? 'Tracking' : s.tracking === 'limited' ? 'Tracking limited' : 'No tracking';
};

/** Alignment guide, coverage ring, tracking pill and live counters drawn over the camera. */
export function CameraOverlay({ status, width, thumbnail }: Props) {
  const ringSize = Math.min(width * 0.86, 420);
  const guide = ringSize * 0.56;
  const locked = !!status?.targetLocked;
  const guideColor = locked ? colors.accent : colors.text;
  const scanning = status?.state === 'scanning';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.topRow}>
        <View style={styles.pill}>
          <View style={[styles.dot, { backgroundColor: trackingColor(status) }]} />
          <Text style={styles.pillText}>{trackingLabel(status)}</Text>
        </View>
        <View style={styles.badges}>
          {status?.lidar ? <Text style={styles.badge}>LiDAR</Text> : null}
          <Text style={[styles.badge, status?.mode === 'demo' && styles.demoBadge]}>
            {status?.mode === 'manual' ? 'MANUAL' : status?.mode === 'demo' ? 'DEMO' : 'ARKIT'}
          </Text>
          <Text style={styles.badge}>{formatDuration(status?.elapsedSec ?? 0)}</Text>
        </View>
      </View>

      <View style={styles.center}>
        <ScanProgress
          palette="camera"
          size={ringSize}
          segments={status?.segments ?? []}
          currentSegment={status?.currentSegment ?? -1}
          coverage={status?.coverage ?? null}>
          <View style={{ width: guide, height: guide }}>
            <View style={[styles.corner, styles.tl, { borderColor: guideColor }]} />
            <View style={[styles.corner, styles.tr, { borderColor: guideColor }]} />
            <View style={[styles.corner, styles.bl, { borderColor: guideColor }]} />
            <View style={[styles.corner, styles.br, { borderColor: guideColor }]} />
            <View style={styles.crossWrap}>
              <View style={[styles.crossH, { backgroundColor: guideColor }]} />
              <View style={[styles.crossV, { backgroundColor: guideColor }]} />
              {status?.capturing ? <View style={styles.flash} /> : null}
            </View>
          </View>
        </ScanProgress>
      </View>

      <View style={styles.stats}>
        <Stat label="Images" value={`${status?.captureCount ?? 0}`} sub={`target ${status?.targetCount ?? '—'}`} />
        <Stat
          label="Coverage"
          value={formatPercent(status?.coverage)}
          sub={status?.coverage == null ? 'needs ARKit' : 'viewing angles'}
        />
        {thumbnail ? (
          <View style={styles.thumb}>{thumbnail}</View>
        ) : status?.lastThumbUri ? (
          <Image source={{ uri: status.lastThumbUri }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
      </View>

      <View style={styles.guidanceBox}>
        <Text style={styles.guidance}>{status?.error ?? status?.guidance ?? 'Starting camera…'}</Text>
        {status?.trackingMessage && scanning ? (
          <Text style={styles.trackingMsg}>{status.trackingMessage}</Text>
        ) : null}
        {status?.trackingMessage && !scanning && status.state === 'idle' && status.mode === 'arkit' ? (
          <Text style={styles.trackingMsg}>{status.trackingMessage}</Text>
        ) : null}
      </View>
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

const CORNER = 34;
const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.overlay,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  pillText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  badges: { flexDirection: 'row', gap: 6 },
  badge: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: colors.overlay,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  demoBadge: { color: colors.warning },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.text },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  crossWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  crossH: { position: 'absolute', width: 22, height: 2, opacity: 0.9 },
  crossV: { position: 'absolute', width: 2, height: 22, opacity: 0.9 },
  flash: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 10,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.overlay,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  statLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statSub: { color: colors.muted, fontSize: 11 },
  thumb: { width: 56, height: 74, borderRadius: 8, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  thumbEmpty: { backgroundColor: colors.overlay },
  guidanceBox: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: colors.overlay,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  guidance: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  trackingMsg: { color: colors.warning, fontSize: 13, textAlign: 'center', marginTop: 4 },
});
