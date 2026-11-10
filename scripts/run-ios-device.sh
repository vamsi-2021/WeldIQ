#!/usr/bin/env bash
# Builds, installs and launches WeldIQ on a connected iPhone.
# Used instead of `react-native run-ios`, which can't find devices or the
# Simulator with Xcode 27.
# Usage: npm run ios:device [-- <device-udid>]
set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLE_ID=org.reactjs.native.example.WeldIQ
UDID="${1:-}"
if [ -z "$UDID" ]; then
  # First connected physical iOS device.
  UDID=$(xcrun xctrace list devices 2>/dev/null \
    | sed -n '/== Devices ==/,/== Devices Offline ==/p' \
    | grep -E '\([0-9]+\.[0-9.]+\) \([0-9A-F-]{20,}\)$' \
    | head -1 | sed -E 's/.*\(([0-9A-F-]+)\)$/\1/')
fi
if [ -z "$UDID" ]; then
  echo "No connected iPhone found. Plug it in, unlock it and trust this Mac." >&2
  exit 1
fi
echo "Using device $UDID"

# Start Metro if it isn't already running.
if ! curl -s -m 2 localhost:8081/status | grep -q running; then
  echo "Starting Metro in the background (log: /tmp/weldiq-metro.log)"
  nohup npx react-native start > /tmp/weldiq-metro.log 2>&1 &
fi

xcodebuild -workspace ios/WeldIQ.xcworkspace -scheme WeldIQ -configuration Debug \
  -destination "id=$UDID" -derivedDataPath ios/build -allowProvisioningUpdates build \
  > /tmp/weldiq-build.log 2>&1 || {
  grep -E 'error:' /tmp/weldiq-build.log >&2
  echo "Build failed (full log: /tmp/weldiq-build.log)." >&2
  exit 1
}
echo "Build succeeded."

APP=ios/build/Build/Products/Debug-iphoneos/WeldIQ.app

xcrun devicectl device install app --device "$UDID" "$APP" > /dev/null
xcrun devicectl device process launch --terminate-existing --device "$UDID" "$BUNDLE_ID"
