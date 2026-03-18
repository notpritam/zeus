#!/bin/bash
# Patch the Electron.app bundle for dev mode to show "Zeus" name and icon
set -e

ELECTRON_APP="node_modules/electron/dist/Electron.app"
PLIST="$ELECTRON_APP/Contents/Info.plist"
ICON_SRC="resources/icon.icns"
ICON_DEST="$ELECTRON_APP/Contents/Resources/zeus.icns"

if [ ! -f "$PLIST" ]; then
  echo "[patch-electron] Info.plist not found, skipping"
  exit 0
fi

echo "[patch-electron] Patching Electron.app for Zeus branding..."

# Patch app name
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Zeus" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Zeus" "$PLIST"

# Copy icon and update plist to use it
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DEST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile zeus.icns" "$PLIST"
  echo "[patch-electron] Icon copied"
fi

# Touch the app bundle so macOS refreshes the cached icon
touch "$ELECTRON_APP"

echo "[patch-electron] Done — Electron.app now branded as Zeus"
