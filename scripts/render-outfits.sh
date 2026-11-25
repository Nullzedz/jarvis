#!/bin/bash
# render-outfits.sh — compile and run the Mochi outfit planche renderer
# NOT in CI. Run manually: bash scripts/render-outfits.sh
# Output: /tmp/jarvis-outfits.png

set -e
cd "$(dirname "$0")/.."

SDK=$(xcrun --sdk macosx --show-sdk-path)

echo "Compiling renderer..."
swiftc \
  -parse-as-library \
  -sdk "$SDK" \
  -target arm64-apple-macosx15.0 \
  NotchBuddy/Sources/JarvisKit/IslandScreenGeometry.swift \
  NotchBuddy/Sources/JarvisKit/IslandTypes.swift \
  NotchBuddy/Sources/JarvisKit/MochiWardrobe.swift \
  NotchBuddy/Sources/JarvisKit/BotEngine.swift \
  NotchBuddy/Sources/JarvisKit/MochiOutfitDrawing.swift \
  scripts/RenderOutfits.swift \
  -framework AppKit \
  -framework SwiftUI \
  -o /tmp/jarvis-render-outfits \
  2>&1

echo "Running renderer..."
/tmp/jarvis-render-outfits
echo "Opening..."
open /tmp/jarvis-outfits.png
