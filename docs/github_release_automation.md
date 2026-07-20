# GitHub Release Automation Guide

This document outlines the procedure used to automate GitHub Releases across your applications using the GitHub CLI (`gh`). 

You can apply this exact pattern to your other apps to ensure every version bump creates a neat GitHub Release with attached compiled binaries (like an Android APK and App Bundle).

## Prerequisites

1. **GitHub CLI (`gh`)**: Ensure the GitHub CLI is installed on your machine.
   * On Ubuntu/Debian: `sudo apt install gh`
   * On Mac: `brew install gh`
2. **Authentication**: Make sure you are logged in by running:
   ```bash
   gh auth login
   ```
   *Make sure you select `HTTPS` or `SSH` depending on your git configuration, and authorize the CLI in your browser.*

## 1. Extracting the Version Number
In order to create a tag, your release script needs to know the version. If you are using a JavaScript project (with a `package.json`), you can bump and extract the version like this:

```bash
# Bump version (this also creates a git tag natively)
# $BUMP_TYPE can be 'patch', 'minor', or 'major'
npm version "$BUMP_TYPE"

# Read the newly created version
NEW_VERSION=$(node -p "require('./package.json').version")
```

## 2. Generating Artifacts
Compile whatever builds you want to attach to your GitHub release. In our case, it's an APK and an AAB for Android:

```bash
./gradlew assembleDebug bundleRelease
# Output paths: 
# APK: android/app/build/outputs/apk/debug-fermata-$NEW_VERSION/fermata-$NEW_VERSION.apk
# AAB: android/app/build/outputs/bundle/release-fermata-$NEW_VERSION/fermata-$NEW_VERSION.aab
```

## 3. Pushing Tags
Before the GitHub CLI can draft a release for a specific version tag (e.g. `v2.1.0`), that tag **must** exist on the remote GitHub server. Ensure your script pushes tags:

```bash
git push origin HEAD --tags
```

## 4. Drafting the GitHub Release
Add the following snippet to the very end of your build script. It drafts the release, assigns a title, and uploads the artifacts all in one sweep:

```bash
# Create GitHub Release
echo "🎉 Creating GitHub Release..."
gh release create "v$NEW_VERSION" \
  --title "Release v$NEW_VERSION" \
  --notes "Automated release for version $NEW_VERSION" \
  "/path/to/your/compiled_app.apk" \
  "/path/to/your/compiled_app.aab"
```

## Full Script Example
Putting it all together, a generalized script looks like this:

```bash
#!/bin/bash
set -e

BUMP_TYPE=$1

# 1. Update version
npm version "$BUMP_TYPE"
NEW_VERSION=$(node -p "require('./package.json').version")

# 2. Build your artifacts
# ... insert build commands here ...

# 3. Push to remote with tags
git add .
git commit -m "chore: bump version to $NEW_VERSION"
git push origin HEAD --tags

# 4. Create the Release
gh release create "v$NEW_VERSION" \
  --title "Release v$NEW_VERSION" \
  --notes "Automated release for version $NEW_VERSION" \
  "path/to/your/artifact1.ext" \
  "path/to/your/artifact2.ext"

echo "✅ Release $NEW_VERSION successfully completed!"
```
