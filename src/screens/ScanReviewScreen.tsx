import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { ScanProgress } from '../components/ScanProgress';
import { MIN_IMAGES_FOR_RECONSTRUCTION } from '../config';
import { DemoWeldView } from '../demo/DemoWeldView';
import { WeldScanner } from '../native/WeldScanner';
import { colors, formatDuration, formatPercent, radius, spacing } from '../theme';
import type { ScanResult } from '../types/ScanTypes';

interface Props {
  scan: ScanResult;
  serverUrl: string;
  onServerUrlChange: (url: string) => void;
  onRetake: () => void;
  onUpload: () => void;
  /** Demo autoplay: continue to processing after a few seconds. */
  autoAdvance?: boolean;
}

const COLUMNS = 4;

/** Screen 2 — review captured images, coverage and warnings before uploading. */
export function ScanReviewScreen({ scan, serverUrl, onServerUrlChange, onRetake, onUpload, autoAdvance }: Props) {
  useEffect(() => {
    if (!autoAdvance) {
      return;
    }
    const id = setTimeout(onUpload, 6000);
    return () => clearTimeout(id);
  }, [autoAdvance, onUpload]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [discarding, setDiscarding] = useState(false);
  const thumbSize = (Math.min(width, 700) - spacing.lg * 2 - spacing.sm * (COLUMNS - 1)) / COLUMNS;

  const warnings = [...scan.missingAngles];
  if (scan.imageCount < MIN_IMAGES_FOR_RECONSTRUCTION) {
    warnings.unshift(
      `Only ${scan.imageCount} images. At least ${MIN_IMAGES_FOR_RECONSTRUCTION} are required and 40+ are recommended.`,
    );
  } else if (scan.imageCount < 30) {
    warnings.unshift(`${scan.imageCount} images is on the low side; 40–100 overlapping images work best.`);
  }
  const isDemo = scan.mode === 'demo';
  const canUpload =
    scan.imageCount >= MIN_IMAGES_FOR_RECONSTRUCTION && (isDemo || /^https?:\/\/.+/.test(serverUrl.trim()));

  const retake = () => {
    Alert.alert('Retake scan?', 'The captured images will be deleted from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete & Retake',
        style: 'destructive',
        onPress: async () => {
          setDiscarding(true);
          try {
            if (!isDemo) {
              await WeldScanner.discardScan(scan.scanId);
            }
          } catch {
            // Files may already be gone; continue to the scanner either way.
          }
          setDiscarding(false);
          onRetake();
        },
      },
    ]);
  };

  const header = (
    <View>
      {isDemo ? <Text style={styles.demoBanner}>DEMO — simulated scan; thumbnails are rendered, not photos</Text> : null}
      <Text style={styles.title}>Scan Review</Text>
      <Text style={styles.subtitle}>
        {scan.scanId} · {scan.mode === 'arkit' ? 'ARKit tracked' : isDemo ? 'Simulated' : 'Manual capture'}
        {scan.lidar ? ' · LiDAR depth saved' : ''}
      </Text>

      <View style={styles.summary}>
        <ScanProgress size={132} segments={scan.segments} coverage={scan.coverage} showLabel />
        <View style={styles.cards}>
          <Card label="Images" value={String(scan.imageCount)} />
          <Card label="Duration" value={formatDuration(scan.durationSec)} />
          <Card label="Coverage" value={formatPercent(scan.coverage)} />
          {scan.bandCoverage.length === 3 ? (
            <Card
              label="Low / Mid / Top"
              value={scan.bandCoverage.map(v => `${Math.round(v * 100)}`).join(' / ')}
            />
          ) : null}
        </View>
      </View>

      {warnings.length > 0 ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnTitle}>Missing angles & warnings</Text>
          {warnings.map((w, i) => (
            <Text key={i} style={styles.warnItem}>
              • {w}
            </Text>
          ))}
        </View>
      ) : (
        <View style={[styles.warnBox, styles.okBox]}>
          <Text style={styles.okText}>Good angular coverage. Reconstruction quality still depends on surface texture and lighting.</Text>
        </View>
      )}

      <Text style={styles.section}>Captured images</Text>
    </View>
  );

  const footer = isDemo ? null : (
    <View style={styles.footer}>
      <Text style={styles.section}>File server</Text>
      <TextInput
        value={serverUrl}
        onChangeText={onServerUrlChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://138.47.142.63:3002"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
      <Text style={styles.inputHint}>BF Files server the scan zip is uploaded to. The device must be on the same network.</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={scan.images}
        keyExtractor={img => String(img.index)}
        numColumns={COLUMNS}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        renderItem={({ item }) => (
          <View>
            {isDemo ? (
              <DemoWeldView
                width={thumbSize}
                height={thumbSize * 1.33}
                azimuthDeg={item.relativeAzimuthDeg ?? 0}
                elevationDeg={item.elevationDeg ?? 15}
                style={styles.thumb}
              />
            ) : (
              <Image source={{ uri: item.thumbUri }} style={[styles.thumb, { width: thumbSize, height: thumbSize * 1.33 }]} />
            )}
            <Text style={styles.thumbLabel}>
              #{item.index}
              {item.manual ? ' · M' : ''}
            </Text>
          </View>
        )}
      />
      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.sm }]}>
        <Button title="Retake Scan" variant="danger" onPress={retake} loading={discarding} style={styles.flex} />
        <Button
          title={isDemo ? 'Upload Scan (demo)' : 'Upload Scan'}
          onPress={onUpload}
          disabled={!canUpload}
          style={styles.flex2}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, maxWidth: 700, width: '100%', alignSelf: 'center' },
  row: { gap: spacing.sm, marginBottom: spacing.sm },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: spacing.md },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.lg },
  cards: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  cardLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  cardValue: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  warnBox: {
    marginTop: spacing.lg,
    backgroundColor: 'rgba(245,165,36,0.08)',
    borderColor: 'rgba(245,165,36,0.4)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  warnTitle: { color: colors.warning, fontWeight: '700', marginBottom: 6 },
  warnItem: { color: colors.text, fontSize: 13, lineHeight: 19 },
  okBox: { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.4)' },
  okText: { color: colors.text, fontSize: 13 },
  section: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  thumb: { borderRadius: 6, backgroundColor: colors.panel, overflow: 'hidden' },
  demoBanner: {
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  thumbLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  footer: { marginTop: spacing.sm },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputHint: { color: colors.muted, fontSize: 12, marginTop: 6 },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  flex: { flex: 1 },
  flex2: { flex: 2 },
});
