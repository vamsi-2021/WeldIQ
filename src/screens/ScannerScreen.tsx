import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { CameraOverlay } from '../components/CameraOverlay';
import { SCAN_OPTIONS } from '../config';
import { DemoScanSession } from '../demo/DemoScanSession';
import { DemoWeldView } from '../demo/DemoWeldView';
import type { ScannerController } from '../native/ScannerController';
import { useScanStatus, WeldScanner, WeldScannerCameraView } from '../native/WeldScanner';
import { cameraColors as colors, spacing } from '../theme';
import type { ScanResult, ScanStatus } from '../types/ScanTypes';

interface Props {
  onFinished: (scan: ScanResult) => void;
  /** Start the demo scan automatically and finish it when coverage is complete. */
  autoDemo?: boolean;
}

type Busy = null | 'starting' | 'finishing' | 'capturing';

/** Screen 1 — full-screen rear camera with guided 360° capture (or the simulated demo). */
export function ScannerScreen({ onFinished, autoDemo }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const nativeStatus = useScanStatus();
  const capabilities = useMemo(() => WeldScanner.getCapabilities(), []);
  const [busy, setBusy] = useState<Busy>(null);

  // Demo mode: only offered when this device has no camera (e.g. the iOS Simulator).
  const demoSession = useMemo(() => new DemoScanSession(), []);
  const [demo, setDemo] = useState(!!autoDemo);
  const [demoStatus, setDemoStatus] = useState<ScanStatus | null>(null);
  useEffect(() => {
    if (!demo) {
      return;
    }
    const sub = demoSession.addStatusListener(setDemoStatus);
    return () => sub.remove();
  }, [demo, demoSession]);

  // Throw away any unfinished scan left over from a previous visit.
  useEffect(() => {
    WeldScanner.resetScan();
  }, []);

  const status = demo ? demoStatus : nativeStatus;
  const scanner: ScannerController = demo ? demoSession : WeldScanner;
  const state = status?.state ?? 'idle';
  const count = status?.captureCount ?? 0;
  const manualMode = !demo && (status?.mode ?? capabilities.mode) === 'manual';
  const cameraReady = !!status?.cameraActive && !status?.error;
  const noCamera = !demo && (!capabilities.cameraAvailable || !!status?.error?.includes('No rear camera'));

  const run = async (kind: Busy, fn: () => Promise<unknown>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Scanner', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const start = () => run('starting', () => scanner.startScan(SCAN_OPTIONS));

  const capture = () => run('capturing', () => scanner.captureManual());

  const finish = () => {
    if (count === 0) {
      Alert.alert('No images yet', 'Move around the weld until some images are captured, then finish.');
      return;
    }
    run('finishing', async () => {
      const result = await scanner.finishScan();
      onFinished(result);
    });
  };

  const retake = () => {
    Alert.alert('Retake scan?', `This discards the ${count} image${count === 1 ? '' : 's'} captured so far.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Retake', style: 'destructive', onPress: () => scanner.resetScan() },
    ]);
  };

  // Autoplay: start after a short pause, finish once the simulated orbit is done.
  const autoStarted = useRef(false);
  const autoFinished = useRef(false);
  useEffect(() => {
    if (!autoDemo || !demo || !demoStatus) {
      return;
    }
    if (!autoStarted.current && demoStatus.state === 'idle' && demoStatus.tracking === 'normal') {
      autoStarted.current = true;
      setTimeout(start, 1500);
    }
    if (!autoFinished.current && demoStatus.state === 'scanning' && demoStatus.elapsedSec > 60) {
      autoFinished.current = true;
      finish();
    }
  });

  const permissionDenied = !demo && !!status?.error?.toLowerCase().includes('denied');
  const pose = demoSession.pose;
  const last = demoSession.lastCapture;

  return (
    <View style={styles.root}>
      {demo ? (
        <DemoWeldView
          style={StyleSheet.absoluteFill}
          width={width}
          height={height}
          azimuthDeg={pose.azimuthDeg}
          elevationDeg={pose.elevationDeg}
          shake={[0.004 * Math.sin(pose.wall * 2.1), 0.003 * Math.sin(pose.wall * 1.7), 0]}
          showTarget={state !== 'idle'}
        />
      ) : (
        <WeldScannerCameraView style={StyleSheet.absoluteFill} />
      )}

      <View style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom + spacing.sm }]}>
        {demo ? (
          <Text style={styles.demoBanner}>DEMO — simulated scan, no camera. Real scanning needs an iPhone or iPad.</Text>
        ) : null}
        <View style={styles.overlay}>
          <CameraOverlay
            status={status}
            width={width}
            thumbnail={
              demo && last ? <DemoWeldView width={56} height={74} azimuthDeg={last.az} elevationDeg={last.el} /> : undefined
            }
          />
        </View>

        {permissionDenied ? (
          <View style={styles.controls}>
            <Button title="Open Settings" onPress={() => Linking.openSettings()} style={styles.flex} />
          </View>
        ) : null}

        {!permissionDenied && (state === 'idle' || state === 'finished') ? (
          <View style={styles.controls}>
            {noCamera ? (
              <Button testID="demo-scan" title="Try Demo Scan" onPress={() => setDemo(true)} style={styles.flex} />
            ) : (
              <Button
                testID="start-scan"
                title="Start Scan"
                onPress={start}
                disabled={!cameraReady}
                loading={busy === 'starting'}
                style={styles.flex}
              />
            )}
          </View>
        ) : null}

        {state === 'scanning' ? (
          <View style={styles.controls}>
            <Button title="Pause" variant="secondary" onPress={() => scanner.pauseScan()} style={styles.flex} />
            <Button
              title={manualMode ? 'Capture' : 'Capture now'}
              variant={manualMode ? 'primary' : 'secondary'}
              onPress={capture}
              loading={busy === 'capturing'}
              style={styles.flex}
            />
            <Button title="Finish" onPress={finish} loading={busy === 'finishing'} style={styles.flex} />
          </View>
        ) : null}

        {state === 'paused' ? (
          <View style={styles.controls}>
            <Button title="Retake" variant="danger" onPress={retake} style={styles.flex} />
            <Button title="Resume" variant="secondary" onPress={() => scanner.resumeScan()} style={styles.flex} />
            <Button title="Finish" onPress={finish} loading={busy === 'finishing'} style={styles.flex} />
          </View>
        ) : null}

        {state === 'idle' && demo ? (
          <View style={styles.controls}>
            <Button title="Exit Demo" variant="ghost" onPress={() => setDemo(false)} style={styles.flex} />
          </View>
        ) : null}

        {state === 'idle' && !status?.error && !noCamera ? (
          <Text style={styles.hint}>
            {manualMode
              ? 'ARKit is unavailable on this device: you will capture each angle manually.'
              : 'Images are captured automatically at new viewing angles. Walk a full circle, then repeat higher up.'}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1 },
  controls: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  flex: { flex: 1 },
  hint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  demoBanner: {
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
  },
});
