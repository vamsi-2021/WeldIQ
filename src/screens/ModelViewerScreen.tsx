import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

import { Button } from '../components/Button';
import { colors, radius, spacing } from '../theme';
import type { ModelResponse } from '../types/ScanTypes';
import { buildViewerHtml } from '../viewer/viewerHtml';

interface Props {
  modelUrl: string;
  model: ModelResponse;
  serverUrl: string;
  onBackToScanner: () => void;
}

// react-native-webview's default generic (`undefined`) collapses its props to `never`
// under current TypeScript; instantiate it with an empty object instead.
const ViewerWebView = WebView as unknown as typeof WebView<object>;
type ViewerWebViewRef = InstanceType<typeof ViewerWebView>;

type ViewerMessage =
  | { type: 'progress'; loaded: number; total: number }
  | {
      type: 'loaded';
      stats: { vertices: number; triangles: number; points: number; size: [number, number, number] };
    }
  | { type: 'error'; message: string };

/** Screen 4 — interactive viewer for the reconstructed GLB (three.js in a WebView). */
export function ModelViewerScreen({ modelUrl, model, serverUrl, onBackToScanner }: Props) {
  const insets = useSafeAreaInsets();
  const web = useRef<ViewerWebViewRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Extract<ViewerMessage, { type: 'loaded' }>['stats'] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const html = useMemo(() => buildViewerHtml(modelUrl, model.model_type), [modelUrl, model.model_type]);

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: ViewerMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'progress') {
      setProgress(msg.total > 0 ? msg.loaded / msg.total : null);
    } else if (msg.type === 'loaded') {
      setLoaded(true);
      setStats(msg.stats);
    } else if (msg.type === 'error') {
      setError(msg.message);
    }
  };

  const call = (fn: 'resetView' | 'fitToScreen' | 'toggleWireframe') =>
    web.current?.injectJavaScript(`window.weldViewer && window.weldViewer.${fn}(); true;`);

  const reload = () => {
    setError(null);
    setLoaded(false);
    setProgress(null);
    setReloadKey(k => k + 1);
  };

  const sizeMb = (model.size_bytes / 1024 / 1024).toFixed(1);
  const isDemo = modelUrl === 'demo:';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>3D Weld Model</Text>
        <Text style={styles.subtitle}>
          {isDemo
            ? 'DEMO model — generated in the app, not reconstructed from images'
            : `${model.model_type === 'point_cloud' ? 'Dense point cloud (meshing failed)' : 'Textured mesh'} · ${sizeMb} MB`}
          {stats && !isDemo
            ? stats.points
              ? ` · ${stats.points.toLocaleString()} points`
              : ` · ${stats.triangles.toLocaleString()} triangles`
            : ''}
        </Text>
      </View>

      <View style={styles.viewer}>
        <ViewerWebView
          key={reloadKey}
          ref={web}
          originWhitelist={['*']}
          source={{ html, baseUrl: serverUrl }}
          onMessage={onMessage}
          javaScriptEnabled
          scrollEnabled={false}
          bounces={false}
          style={styles.web}
          onError={e => setError(`WebView error: ${e.nativeEvent.description}`)}
        />
        {!loaded && !error ? (
          <View style={styles.center} pointerEvents="none">
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={styles.loadingText}>
              Loading model{progress != null ? ` ${Math.round(progress * 100)}%` : '…'}
            </Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Button title="Try again" variant="secondary" onPress={reload} style={styles.retry} />
          </View>
        ) : null}
        {loaded ? (
          <Text style={styles.gestures} pointerEvents="none">
            1 finger: rotate · pinch: zoom · 2 fingers: pan
          </Text>
        ) : null}
      </View>

      <View style={[styles.toolbar, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.row}>
          <Button title="Reset" variant="secondary" onPress={() => call('resetView')} disabled={!loaded} style={styles.flex} />
          <Button title="Fit" variant="secondary" onPress={() => call('fitToScreen')} disabled={!loaded} style={styles.flex} />
          {model.model_type === 'textured_mesh' ? (
            <Button title="Wireframe" variant="secondary" onPress={() => call('toggleWireframe')} disabled={!loaded} style={styles.flex} />
          ) : null}
        </View>
        <Button title="Back to Scanner" onPress={onBackToScanner} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', marginTop: spacing.sm },
  subtitle: { color: colors.muted, fontSize: 13, marginTop: 2 },
  viewer: {
    flex: 1,
    marginHorizontal: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  web: { flex: 1, backgroundColor: colors.bg },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  loadingText: { color: colors.muted, marginTop: spacing.md },
  errorText: { color: colors.danger, textAlign: 'center', fontSize: 14 },
  retry: { marginTop: spacing.lg, alignSelf: 'stretch' },
  gestures: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    color: '#FFFFFF',
    fontSize: 12,
    backgroundColor: colors.overlay,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  toolbar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
