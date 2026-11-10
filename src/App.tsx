import React, { useCallback, useRef, useState } from 'react';
import { Platform, Settings, StatusBar, StyleSheet, View } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { defaultFilesUrl } from './config';
import { LoginScreen } from './screens/LoginScreen';
import { authHeader, isExpired, refresh, type AuthSession } from './services/AuthService';
import { ScannerScreen } from './screens/ScannerScreen';
import { ScanReviewScreen } from './screens/ScanReviewScreen';
import { UploadScreen } from './screens/UploadScreen';
import { colors } from './theme';
import type { ScanResult } from './types/ScanTypes';

/**
 * Hands-free demo for screen recordings: launch with `-WeldIQAutoDemo YES`
 * (e.g. `xcrun simctl launch booted <bundle id> -WeldIQAutoDemo YES`).
 */
const AUTO_DEMO = Platform.OS === 'ios' && !!Settings.get('WeldIQAutoDemo');

type Route =
  | { name: 'login' }
  | { name: 'scanner' }
  | { name: 'review'; scan: ScanResult }
  | { name: 'upload'; scan: ScanResult };

/**
 * Weld IQ scanning POC.
 * Flow: login → scanner → review → upload (scan zip → BF Files).
 */
export default function App() {
  const [route, setRoute] = useState<Route>(AUTO_DEMO ? { name: 'scanner' } : { name: 'login' });
  const [serverUrl, setServerUrl] = useState(defaultFilesUrl);
  // Held in memory only; a ref so uploads always see the latest (refreshed) token.
  const session = useRef<AuthSession | null>(null);

  const getAuthorization = useCallback(async () => {
    if (!session.current) {
      throw new Error('Not signed in. Sign in again to upload.');
    }
    if (isExpired(session.current)) {
      try {
        session.current = await refresh(session.current);
      } catch {
        throw new Error('Your session has expired. Sign in again to upload.');
      }
    }
    return authHeader(session.current);
  }, []);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar barStyle={route.name === 'scanner' ? 'light-content' : 'dark-content'} />
      <View style={styles.root}>
        {route.name === 'login' && (
          <LoginScreen
            onSignedIn={s => {
              session.current = s;
              setRoute({ name: 'scanner' });
            }}
          />
        )}
        {route.name === 'scanner' && (
          <ScannerScreen autoDemo={AUTO_DEMO} onFinished={scan => setRoute({ name: 'review', scan })} />
        )}
        {route.name === 'review' && (
          <ScanReviewScreen
            autoAdvance={AUTO_DEMO && route.scan.mode === 'demo'}
            scan={route.scan}
            serverUrl={serverUrl}
            onServerUrlChange={setServerUrl}
            onRetake={() => setRoute({ name: 'scanner' })}
            onUpload={() => setRoute({ name: 'upload', scan: route.scan })}
          />
        )}
        {route.name === 'upload' && (
          <UploadScreen
            scan={route.scan}
            serverUrl={serverUrl.trim()}
            getAuthorization={getAuthorization}
            onBack={() => setRoute({ name: 'review', scan: route.scan })}
            onNewScan={() => setRoute({ name: 'scanner' })}
          />
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
