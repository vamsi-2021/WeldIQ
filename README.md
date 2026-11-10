# Weld IQ — 360° Weld Scanning POC (mobile app)

Proof of concept. You scan a welded part with the **rear camera of an iPhone or iPad**, and the app captures overlapping images automatically as you walk around it (guided like Face ID enrollment). It packs the images and camera poses into a zip and uploads it to the BF Files server.

This repository contains only the mobile app. Uploads use the [BF Files API](#upload-api-bf-files) below.

The app opens on a Keycloak sign-in screen, then goes to the scanner.

> **What this is not:** It does not detect weld defects and does not give certified measurements.

---

## Contents

```text
WeldIQ/
  App.tsx                         → re-exports src/App.tsx
  src/
    App.tsx                       login → scanner → review → upload (state-based, no router)
    config.ts                     scan options, Keycloak and BF Files settings
    theme.ts
    screens/
      ScannerScreen.tsx           Screen 1 — camera, guide, progress ring, controls
      LoginScreen.tsx             Keycloak sign-in
      ScanReviewScreen.tsx        Screen 2 — thumbnails, coverage, warnings, server URL
      UploadScreen.tsx            Screen 3 — zip the scan, upload to BF Files, retry
      ModelViewerScreen.tsx       three.js viewer in a WebView (not in the current flow)
    components/
      ScanProgress.tsx            24-segment SVG coverage ring
      CameraOverlay.tsx           alignment guide, tracking pill, counters, guidance
      Button.tsx
    native/WeldScanner.ts         typed JS wrapper + useScanStatus() hook
    services/
      AuthService.ts              Keycloak password grant + token refresh
      FileRecordsService.ts       POST /file-records upload with progress
    types/ScanTypes.ts
    viewer/viewerHtml.ts          three.js page (OrbitControls + GLTFLoader)
  modules/weld-scanner/           local native module (autolinked, New Architecture)
    package.json                  codegenConfig (TurboModule + Fabric component)
    WeldScanner.podspec
    src/NativeWeldScanner.ts      TurboModule spec
    src/WeldScannerCameraViewNativeComponent.ts   Fabric camera view spec
    ios/
      WeldScannerModule.swift     WeldScannerCore — owns the single camera session
      ARScanSession.swift         ARKit tracking, target lock, auto-capture, storage
      CameraCoverageTracker.swift viewing-angle bins, coverage, missing angles, guidance
      ScanCameraSession.swift     shared protocol, options, JPEG encoding
      ScanStorage.swift           scan_NNN/ folder layout
      FallbackCameraSession.swift AVCapture manual mode for devices without ARKit
      RCTWeldScanner.mm           TurboModule bridge (events: onScanUpdate)
      WeldScannerCameraViewComponentView.mm   Fabric view hosting the preview
  ios/  android/                  React Native host projects
```

---

## Versions

| Part | Version |
|---|---|
| React Native | 0.84.1 (New Architecture only, Hermes) |
| React | 19.2.3 |
| TypeScript | 5.8 |
| react-native-svg | 15.15.5 |
| react-native-webview | 14.0.1 |
| axios | 1.20.0 |
| react-native-safe-area-context | 5.x |
| three.js (viewer, CDN) | 0.169.0 |
| iOS minimum | 15.1 (high-res still capture needs iOS 16+) |

---

## 1. Setup

Prerequisites: macOS with Xcode (tested with Xcode 27.1), Node ≥ 22.11, Ruby + Bundler, CocoaPods via the Gemfile.

```sh
npm install                 # also links modules/weld-scanner into node_modules
bundle install              # CocoaPods version from Gemfile.lock
cd ios && bundle exec pod install && cd ..
```

`pod install` runs React Native codegen for `WeldScannerSpec` and registers:

- the TurboModule `WeldScanner` → `RCTWeldScanner`
- the Fabric component `WeldScannerCameraView` → `WeldScannerCameraViewComponentView`

If you add or rename files under `modules/weld-scanner/ios/`, run `pod install` again.

### iOS configuration already in place

`ios/WeldIQ/Info.plist`:

| Key | Why |
|---|---|
| `NSCameraUsageDescription` | rear camera for scanning |
| `NSLocalNetworkUsageDescription` | upload to a server on the LAN |
| `NSAppTransportSecurity › NSAllowsLocalNetworking = true` | plain-HTTP to a LAN server |
| `UIRequiredDeviceCapabilities = arm64` | ARKit is **not** required, so the manual fallback can install |

`ios/Podfile` `post_install` raises every pod to the app's minimum iOS version, because Xcode 27 rejects RNSVG's 12.4 target.

`ios/.xcode.env.local` points Xcode at your Node binary (`NODE_BINARY`). Update it if you switch Node versions.

---

## 2. Build and run on a physical iPhone or iPad

ARKit and the camera need a real device. The simulator shows the scanner UI but reports that no rear camera is available.

1. Connect the device by USB (or pair it over Wi-Fi), unlock it, and enable **Settings › Privacy & Security › Developer Mode**.
2. Open `ios/WeldIQ.xcworkspace` in Xcode.
3. Select the **WeldIQ** target › **Signing & Capabilities**. Choose your **Team**. If the bundle ID is taken, change `org.reactjs.native.example.WeldIQ` to something unique.
4. Start Metro on the Mac: `npm start`
5. Pick your device as the run destination and press **Run (⌘R)**.
   CLI alternative: `npx react-native run-ios --device "<device name>"`.
6. On first launch, allow camera access. When asked, allow local-network access too.

The device and Mac must be on the same Wi-Fi network for Metro.

**Server address.** Scans upload to `FILES_URL` in `src/config.ts` (`http://138.47.142.63:3002`). You can edit the address on the Review screen.

**Release build (no Metro):** in Xcode choose *Product › Scheme › Edit Scheme › Run › Build Configuration: Release*, or use *Product › Archive*.

### Known tooling issue

`npx react-native run-ios` (simulator mode) can't open `Simulator.app` with Xcode 27, because Xcode moved it. Build from Xcode instead, or use `xcrun simctl install/launch`. Device builds from Xcode are unaffected.

### Demo mode (iOS Simulator)

The Simulator has no camera or ARKit. On a device without a camera, the scanner shows **Try Demo Scan**. It plays a simulated orbit around a rendered T-joint weld using the same capture, coverage and guidance rules as the real scanner, then continues through Review and a simulated upload. Every demo screen is labelled DEMO, and no images or server calls are involved.

Hands-free autoplay, for recordings:

```sh
xcrun simctl launch booted org.reactjs.native.example.WeldIQ -WeldIQAutoDemo YES
```

---

## 3. Using the app

1. **Scanner** opens directly. Point the rear camera at the weld and put it inside the center guide.
2. Tap **Start Scan**. The app locks a 3D target point: a raycast against detected surfaces, else feature points, else a fixed 40 cm. A small blue ring marks it in AR.
3. Walk slowly around the weld. Images are captured **automatically** when your viewpoint is new enough. Follow the guidance text ("Move left around the weld", "Raise the device…").
4. The ring fills as **viewing angles** are covered: bright means seen from low and mid height, dim means one height only. Do a lap at about weld height and another lap about 45° above. Add a few top-down shots.
5. Use **Pause / Resume** as needed. **Capture now** forces a frame. **Retake** discards the scan.
6. Tap **Finish** to open **Review**, which shows thumbnails, coverage, duration and missing-angle warnings.
7. Tap **Upload Scan** to open **Upload**. The app zips the scan and uploads it to BF Files, showing progress and the stored file record. You can cancel or retry.

---

## 4. How capture works (native)

- **One camera session.** `WeldScannerCore` owns one `ARSession`. Preview (`ARSCNView`), pose tracking and stills all come from it; no second AVCapture or VisionCamera session is ever opened. Unmounting the preview pauses the session and releases the camera.
- **Auto-capture rule** (`ARScanSession.evaluateAutoCapture`). A frame is captured only when all of these hold:
  - tracking is *normal*
  - the target is within 28° of the optical axis
  - linear speed is under 0.30 m/s and angular speed under 40°/s (reduces motion blur)
  - the direction from the target differs from every earlier image by at least 8°, or the distance to the weld differs by 35% or more
  - at least 0.4 s has passed since the last capture
- **Stills.** On iOS 16+, ARKit's high-resolution still capture is used (up to 4K, downscaled to a 2560 px long side). Older iOS saves the 1920×1440 video frame.
- **Coverage** (`CameraCoverageTracker`). Captured directions are binned on a viewing sphere: low band (−30° to 30°, 24 bins), mid band (30° to 60°, 24 bins) and top band (60° to 90°, 8 bins). Coverage is the weighted share of filled bins (45/40/15). It is **not** image count and **not** a prediction that reconstruction will succeed.
- **LiDAR** is optional. On LiDAR devices, `sceneDepth` maps and confidence maps are saved and uploaded alongside the images.
- **Fallback.** Without ARKit world tracking, an AVCapture photo session provides manual capture. Coverage is shown as "—" because it can't be measured without poses; the app doesn't estimate it.

### On-device storage

```text
Documents/WeldScans/scan_001/
  images/image_001.jpg …        full-res, sensor orientation (landscape), matches intrinsics
  thumbs/image_001.jpg …        upright thumbnails for Review (not uploaded)
  depth/depth_001.bin …         LiDAR only: Float32 metres, row-major (+ confidence_*.bin)
  metadata.json
```

`metadata.json` (abridged):

```json
{
  "schemaVersion": 1,
  "scanId": "scan_001",
  "captureMode": "arkit",
  "durationSec": 94.2,
  "device": { "model": "iPhone", "systemVersion": "26.1", "lidar": true },
  "coordinateSystem": { "world": "ARKit world space: right-handed, metres, +Y up (gravity aligned)",
                        "transform": "4x4 camera-to-world, column-major (16 floats)" },
  "target": { "point": [0.02, -0.31, -0.42], "source": "raycast" },
  "coverage": { "overall": 0.81, "bands": { "low": 0.92, "mid": 0.79, "top": 0.5 },
                "missingAngles": ["No views between 195° and 240° around the weld (measured from your starting position)."] },
  "images": [
    { "index": 1, "file": "images/image_001.jpg", "width": 2560, "height": 1920,
      "timestamp": 18231.44, "capturedAt": "2026-10-23T19:02:11.120Z", "manual": false,
      "intrinsics": { "fx": 2093.1, "fy": 2093.1, "cx": 1279.6, "cy": 958.9 },
      "transform": [/* 16 floats */], "position": [0.05, -0.12, 0.01],
      "directionFromTarget": [0.1, 0.43, 0.9], "azimuthDeg": 6.3, "elevationDeg": 25.4,
      "distanceToTargetM": 0.47, "trackingState": "normal", "exposureDurationS": 0.008,
      "depth": { "file": "depth/depth_001.bin", "width": 256, "height": 192,
                 "format": "float32_le_meters_row_major" } }
  ]
}
```

---

## Upload API (BF Files)

The scan zip is sent as the raw request body (not multipart), with the signed-in user's Keycloak token:

```sh
curl -X POST "http://138.47.142.63:3002/file-records?bucket=weld-iq&name=scan_004.zip" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/zip" \
  --data-binary @scan_004.zip
```

The server responds with a `FileRecord` (`uuid`, `owner`, `bucket`, `name`, `content_type`, `size`, `created_at`, `updated_at`; see `src/types/ScanTypes.ts`).

---

## 5. Limitations

**Reflective and metallic surfaces.** Photogrammetry matches the same surface texture across images. Bright, polished or mill-finish steel and aluminium cause problems:

- specular highlights move with the camera, producing false matches or none
- uniform grey areas have no features, which leaves holes or missing geometry
- welding discoloration and spatter help, while ground-smooth beads hurt

Mitigations, in order of effectiveness:

1. Use diffuse, even lighting: overcast daylight or a softbox. Avoid point lights and direct sun.
2. Apply a temporary matte coating: scanning spray, developer spray or dry shampoo (only where permitted).
3. Add texture near the weld: masking tape with marks, or a printed pattern placed around the part.
4. Move slowly with plenty of overlap (the 8° step does this). Include some background context in the frame.

**Other limitations:**

- ARKit tracking needs visual texture. A plain bench and a plain part can make tracking "limited", and capture pauses until it recovers.
- Coverage is measured around one target point. For long welds, scan sections separately.
- The viewer loads three.js from jsDelivr, so the device needs internet access the first time the viewer opens.
- In manual mode (no ARKit) there are no poses, so there's no coverage or guidance.
- Android: the native scanner is iOS-only. The JS app will not run on Android without a matching native module.

---

## 6. What has been verified

| Area | Status |
|---|---|
| iOS build (Debug, simulator, Xcode 27.1) including Swift/ObjC++ module, codegen, Fabric view | ✅ builds with no warnings in module sources |
| TypeScript (`tsc --noEmit`), ESLint, Jest smoke test | ✅ pass |
| Simulator: scanner UI, manual-fallback path, "no rear camera" error | ✅ checked by screenshot |
| Viewer: three.js loads a GLB from a server in the iOS WebView | ✅ checked with a generated test mesh |
| ARKit tracking, auto-capture, LiDAR depth, high-res stills | ⚠️ **needs a physical iPhone/iPad**; can't run in the simulator |
| Upload to BF Files from a device | ⚠️ needs a device on a network that can reach the server |

Commands:

```sh
npx tsc --noEmit && npx eslint . && npx jest
```
