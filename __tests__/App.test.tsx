/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The ARKit scanner is native-only; stub it so the JS tree can render.
jest.mock('weld-scanner', () => {
  const { View } = require('react-native');
  return {
    WeldScannerCameraView: View,
    NativeWeldScanner: {
      getCapabilities: () => ({
        arkitSupported: true,
        lidarSupported: false,
        highResCaptureSupported: true,
        cameraAvailable: true,
        mode: 'arkit',
        cameraAuthorization: 'authorized',
      }),
      startScan: jest.fn(async () => ({ scanId: 'scan_001', scanDir: '/tmp/scan_001' })),
      pauseScan: jest.fn(),
      resumeScan: jest.fn(),
      captureManual: jest.fn(async () => {}),
      finishScan: jest.fn(),
      resetScan: jest.fn(),
      discardScan: jest.fn(async () => {}),
      zipScan: jest.fn(async () => ({ path: '/tmp/scan_001.zip', uri: 'file:///tmp/scan_001.zip', name: 'scan_001.zip', sizeBytes: 1 })),
      onScanUpdate: () => ({ remove: jest.fn() }),
    },
  };
});

// App reads the -WeldIQAutoDemo launch arg via Settings at import time.
jest.mock('react-native/Libraries/Settings/NativeSettingsManager', () => ({
  __esModule: true,
  default: { getConstants: () => ({ settings: {} }), setValues: jest.fn(), deleteValues: jest.fn() },
}));

jest.mock('../src/services/AuthService', () => ({
  ...jest.requireActual('../src/services/AuthService'),
  signIn: jest.fn(async (email: string) => ({ accessToken: 'token', expiresAt: Date.now() + 60_000, email })),
}));

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: View };
});

test('opens on the login screen and signs in to the scanner', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<App />);
  });
  const root = tree!.root;
  expect(root.findAllByProps({ testID: 'start-scan' })).toHaveLength(0);

  await ReactTestRenderer.act(() => {
    root.findByProps({ testID: 'login-email' }).props.onChangeText('marcus.t@weldiq.edu');
    root.findByProps({ testID: 'login-password' }).props.onChangeText('secret');
  });
  await ReactTestRenderer.act(async () => {
    await root.findByProps({ testID: 'login-submit' }).props.onPress();
  });
  expect(root.findByProps({ testID: 'start-scan' })).toBeTruthy();
});
