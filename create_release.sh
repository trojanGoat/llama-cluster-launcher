#!/bin/bash
set -e

echo "=========================================="
echo "      Interactive Release Creator         "
echo "=========================================="
echo ""

# 1. Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ Error: GitHub CLI (gh) is not installed."
    echo "Install instructions: https://cli.github.com/manual/installation"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    echo "❌ Error: GitHub CLI is not authenticated. Please run 'gh auth login' first."
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found in the current directory."
    exit 1
fi

# 2. Find current version and ask to bump
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "🏷️  Current version in package.json: v$CURRENT_VERSION"

read -p "Enter the NEW version (e.g., 1.0.7) or press ENTER to keep current [v$CURRENT_VERSION]: " NEW_VERSION_INPUT

if [ -z "$NEW_VERSION_INPUT" ]; then
    VERSION="$CURRENT_VERSION"
else
    # Strip leading 'v' if user typed it
    VERSION="${NEW_VERSION_INPUT#v}"
    
    # Update package.json version
    npm version "$VERSION" --no-git-tag-version
    echo "✅ package.json updated to version $VERSION"
    
    # Update hardcoded version in HTML
    sed -i "s/<p class=\"version\">v.* beta<\/p>/<p class=\"version\">v$VERSION beta<\/p>/" src/index.html
    echo "✅ src/index.html updated to version $VERSION"
    
    # Commit the version bump
    git add package.json package-lock.json src/index.html 2>/dev/null || true
    git commit -m "chore: bump version to v$VERSION" || true
fi

TAG="v$VERSION"

# 3. Generate starting release notes
git fetch --tags --quiet
PREV_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

NOTES_FILE=$(mktemp)
echo "## $TAG" > "$NOTES_FILE"
echo "" >> "$NOTES_FILE"
echo "### Auto-generated changes since ${PREV_TAG:-the beginning}:" >> "$NOTES_FILE"

if [ -n "$PREV_TAG" ]; then
    git log ${PREV_TAG}..HEAD --oneline --pretty=format:"* %s (%h)" >> "$NOTES_FILE"
else
    git log --oneline --pretty=format:"* %s (%h)" >> "$NOTES_FILE"
fi

echo "" >> "$NOTES_FILE"
echo "" >> "$NOTES_FILE"
echo "<!-- Add any custom notes above this line. You can delete or edit anything in this file! -->" >> "$NOTES_FILE"

# 4. Open vim for the user to edit notes
echo "📝 Opening editor for release notes..."
${EDITOR:-vim} "$NOTES_FILE"

# 5. Push current branch to ensure GitHub Actions has the latest code
echo ""
echo "☁️ Pushing latest code to GitHub..."
git push origin HEAD

# 6. Create GitHub Release
echo ""
echo "🚀 Creating GitHub release $TAG..."
# This command automatically creates the tag on GitHub and attaches the notes
gh release create "$TAG" --title "Release $TAG" --notes-file "$NOTES_FILE"

# 7. Cleanup
rm "$NOTES_FILE"
echo "🎉 Release $TAG created with notes!"
echo "☁️ GitHub Actions is now building your AppImage and .deb in the cloud."
echo "You can monitor the build progress here:"
echo "https://github.com/$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"
