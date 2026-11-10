import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { ANALYTICS_URL, ASSIGNMENT_DETAIL_ID, FILES_BUCKET } from '../config';
import { WeldScanner } from '../native/WeldScanner';
import { CANCELLED, uploadFileRecord } from '../services/FileRecordsService';
import { registerScan } from '../services/ScanRegistrationService';
import { colors, radius, spacing } from '../theme';
import type { FileRecord, ScanResult, ScanZip } from '../types/ScanTypes';

interface Props {
  scan: ScanResult;
  serverUrl: string;
  /** Returns a valid "Bearer <token>" value, refreshing the session if needed. */
  getAuthorization: () => Promise<string>;
  onBack: () => void;
  onNewScan: () => void;
}

type Phase = 'zipping' | 'uploading' | 'registering' | 'completed' | 'failed' | 'cancelled';

const formatBytes = (n: number) =>
  n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new Error(CANCELLED));
    });
  });

/**
 * Screen 3 — pack the scan into a zip, upload it to BF Files (POST /file-records),
 * then register the returned file uuid with the assignment (POST /api/analytics/weld-iq/scans).
 */
export function UploadScreen({ scan, serverUrl, getAuthorization, onBack, onNewScan }: Props) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('zipping');
  const [zip, setZip] = useState<ScanZip | null>(null);
  const [fraction, setFraction] = useState(0);
  const [record, setRecord] = useState<FileRecord | null>(null);
  const [registered, setRegistered] = useState(false);
  // Kept in a ref so a retry after a failed registration skips the zip and upload.
  const uploaded = useRef<FileRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const isDemo = scan.mode === 'demo';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  const run = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setError(null);
    setFraction(0);
    try {
      let result = uploaded.current;
      if (!result) {
        setPhase('zipping');
        let packed: ScanZip;
        if (isDemo) {
          await wait(600, controller.signal);
          packed = { path: '', uri: '', name: `${scan.scanId}.zip`, sizeBytes: scan.imageCount * 900_000 };
        } else {
          packed = await WeldScanner.zipScan(scan.scanId);
        }
        if (!alive.current || controller.signal.aborted) {
          return;
        }
        setZip(packed);

        setPhase('uploading');
        if (isDemo) {
          for (let k = 1; k <= 20; k++) {
            await wait(80, controller.signal);
            setFraction(k / 20);
          }
          const now = new Date().toISOString();
          result = {
            kind: 'file',
            uuid: 'demo',
            owner: 'demo',
            bucket: FILES_BUCKET,
            name: packed.name,
            content_type: 'application/zip',
            size: packed.sizeBytes,
            created_at: now,
            updated_at: now,
          };
        } else {
          result = await uploadFileRecord(
            serverUrl,
            FILES_BUCKET,
            { uri: packed.uri, name: packed.name, contentType: 'application/zip' },
            await getAuthorization(),
            (loaded, total) => alive.current && setFraction(total > 0 ? loaded / total : 0),
            controller.signal,
          );
        }
        if (!alive.current) {
          return;
        }
        uploaded.current = result;
        setFraction(1);
        setRecord(result);
      }

      setPhase('registering');
      if (isDemo) {
        await wait(500, controller.signal);
      } else {
        await registerScan(ANALYTICS_URL, ASSIGNMENT_DETAIL_ID, result.uuid, await getAuthorization(), controller.signal);
      }
      if (!alive.current) {
        return;
      }
      setRegistered(true);
      setPhase('completed');
    } catch (e) {
      if (!alive.current) {
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setPhase(msg === CANCELLED ? 'cancelled' : 'failed');
      setError(msg === CANCELLED ? null : msg);
    }
  }, [isDemo, scan.scanId, scan.imageCount, serverUrl, getAuthorization]);

  useEffect(() => {
    run();
    // Start once on mount; retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === 'zipping' || phase === 'uploading' || phase === 'registering';
  const failedAt =
    phase === 'failed' || phase === 'cancelled' ? (record ? 'register' : zip ? 'upload' : 'zip') : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {isDemo ? <Text style={styles.demoBanner}>DEMO — simulated upload, no server</Text> : null}
        <Text style={styles.title}>Upload Scan</Text>
        <Text style={styles.subtitle}>
          {scan.imageCount} images → {isDemo ? 'demo (no upload)' : `${serverUrl} · bucket ${FILES_BUCKET}`}
        </Text>

        <Step title="Pack scan into zip" state={phase === 'zipping' ? 'active' : zip ? 'done' : failedAt === 'zip' ? 'failed' : 'pending'}>
          {zip ? (
            <Text style={styles.detail}>
              {zip.name} · {formatBytes(zip.sizeBytes)}
            </Text>
          ) : null}
        </Step>

        <Step
          title="Upload to BF Files"
          state={phase === 'uploading' ? 'active' : record ? 'done' : failedAt === 'upload' ? 'failed' : 'pending'}>
          {phase === 'uploading' || (zip && fraction > 0) ? (
            <>
              <Bar fraction={fraction} />
              <Text style={styles.detail}>
                {Math.round(fraction * 100)}%{zip ? ` · ${formatBytes(fraction * zip.sizeBytes)} of ${formatBytes(zip.sizeBytes)}` : ''}
              </Text>
            </>
          ) : null}
        </Step>

        <Step
          title="Register scan with assignment"
          state={phase === 'registering' ? 'active' : registered ? 'done' : failedAt === 'register' ? 'failed' : 'pending'}>
          <Text style={styles.detail}>
            {isDemo ? 'demo (no request)' : `${ANALYTICS_URL} · assignment ${ASSIGNMENT_DETAIL_ID}`}
          </Text>
        </Step>

        {record ? (
          <View style={styles.resultBox} testID="upload-result">
            <Text style={styles.resultTitle}>Uploaded</Text>
            <Row label="File ID" value={record.uuid} />
            <Row label="Name" value={record.name} />
            <Row label="Bucket" value={record.bucket} />
            <Row label="Size" value={formatBytes(record.size)} />
            <Row label="Created" value={new Date(record.created_at).toLocaleString()} />
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Failed</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.sm }]}>
        {busy ? (
          <Button title="Cancel upload" variant="secondary" onPress={() => abort.current?.abort()} style={styles.flex} />
        ) : phase === 'completed' ? (
          <Button title="New Scan" onPress={onNewScan} style={styles.flex} />
        ) : (
          <>
            <Button title="Back to Review" variant="secondary" onPress={onBack} style={styles.flex} />
            <Button title={record ? 'Retry Register' : 'Retry Upload'} onPress={run} style={styles.flex} />
          </>
        )}
      </View>
    </View>
  );
}

function Step({
  title,
  state,
  children,
}: {
  title: string;
  state: 'pending' | 'active' | 'done' | 'failed';
  children?: React.ReactNode;
}) {
  const color =
    state === 'done' ? colors.success : state === 'active' ? colors.accent : state === 'failed' ? colors.danger : colors.border;
  return (
    <View style={[styles.step, { borderColor: color }]}>
      <Text style={[styles.stepTitle, state === 'pending' && styles.muted]}>
        {state === 'done' ? '✓ ' : state === 'failed' ? '✕ ' : ''}
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} selectable>
        {value}
      </Text>
    </View>
  );
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 700, width: '100%', alignSelf: 'center' },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: spacing.md },
  demoBanner: {
    color: colors.onAccent,
    backgroundColor: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  subtitle: { color: colors.muted, fontSize: 13 },
  step: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  stepTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  muted: { color: colors.muted },
  detail: { color: colors.muted, fontSize: 13 },
  barTrack: { height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.accent, borderRadius: 4 },
  resultBox: {
    backgroundColor: colors.panel,
    borderColor: colors.success,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  resultTitle: { color: colors.success, fontWeight: '700', fontSize: 16 },
  row: { flexDirection: 'row', gap: spacing.md },
  rowLabel: { color: colors.muted, fontSize: 13, width: 70 },
  rowValue: { color: colors.text, fontSize: 13, flex: 1 },
  errorBox: {
    backgroundColor: 'rgba(220,38,38,0.08)',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorTitle: { color: colors.danger, fontWeight: '700', marginBottom: 4 },
  errorText: { color: colors.text, fontSize: 14 },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  flex: { flex: 1 },
});
