#!/bin/bash

set -e  # Exit on any error

echo "🧪 Testing Token Nerd as fresh install..."

# Clean up any previous test
rm -rf /tmp/test-fresh-install 2>/dev/null || true

# Build and pack
echo "📦 Building and packing..."
npm run build
npm pack

# Get the tarball name
TARBALL=$(ls token-nerd-*.tgz | head -1)
echo "📋 Using tarball: $TARBALL"

# Create fresh test environment
mkdir -p /tmp/test-fresh-install
cd /tmp/test-fresh-install

echo "🗑️  Running preuninstall to clean up existing installation..."
# Run preuninstall from the current project to clean up
node /home/brutus-home/projects/token-nerd/preuninstall.js || echo "⚠️  Preuninstall had issues (may be expected)"

echo "📥 Installing fresh package..."
npm install "/home/brutus-home/projects/token-nerd/$TARBALL"

echo "✅ Fresh install test completed successfully!"
echo "🔍 Package installed at: /tmp/test-fresh-install/node_modules/token-nerd"

# Show what's in the installed package
echo "📂 Contents of installed package:"
ls -la /tmp/test-fresh-install/node_modules/token-nerd/

echo ""
echo "🧹 Cleanup: rm -rf /tmp/test-fresh-install"