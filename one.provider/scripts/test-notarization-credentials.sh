#!/bin/bash
#
# Test notarization credentials
#
set -e

echo "🔐 Testing Notarization Credentials"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if credentials are set
if [ -z "$NOTARIZATION_APPLE_ID" ]; then
    echo "❌ NOTARIZATION_APPLE_ID not set"
    echo ""
    echo "Set it with:"
    echo "  export NOTARIZATION_APPLE_ID='your@apple.id'"
    echo ""
    exit 1
fi

if [ -z "$NOTARIZATION_PASSWORD" ]; then
    echo "❌ NOTARIZATION_PASSWORD not set"
    echo ""
    echo "Set it with:"
    echo "  export NOTARIZATION_PASSWORD='xxxx-xxxx-xxxx-xxxx'"
    echo ""
    echo "Get app-specific password from:"
    echo "  https://appleid.apple.com/ → Security → App-Specific Passwords"
    echo ""
    exit 1
fi

TEAM_ID="${TEAM_ID:-26W8AC52QS}"

echo "Apple ID: $NOTARIZATION_APPLE_ID"
echo "Team ID:  $TEAM_ID"
echo "Password: ${NOTARIZATION_PASSWORD:0:4}****"
echo ""

# Create a dummy file to test with
echo "Creating test file..."
TEMP_DIR=$(mktemp -d)
TEST_FILE="$TEMP_DIR/test.txt"
echo "Test file for notarization credential check" > "$TEST_FILE"

# Zip it
TEST_ZIP="$TEMP_DIR/test.zip"
ditto -c -k --keepParent "$TEST_FILE" "$TEST_ZIP"

echo "Testing credentials with Apple..."
echo ""

# Try to submit (this will fail because it's not a valid app, but we can check the auth error)
xcrun notarytool submit "$TEST_ZIP" \
    --apple-id "$NOTARIZATION_APPLE_ID" \
    --password "$NOTARIZATION_PASSWORD" \
    --team-id "$TEAM_ID" \
    2>&1 | tee "$TEMP_DIR/output.txt"

EXIT_CODE=$?

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check the output
if grep -q "Invalid credentials" "$TEMP_DIR/output.txt"; then
    echo "❌ AUTHENTICATION FAILED"
    echo ""
    echo "Common issues:"
    echo "  1. Using regular password instead of app-specific password"
    echo "     → Get app-specific password from https://appleid.apple.com/"
    echo "  2. Wrong Apple ID (must be enrolled in Apple Developer Program)"
    echo "  3. Team ID doesn't match your Developer account"
    echo "  4. App-specific password expired or revoked"
    echo ""

elif grep -q "The provided entity is missing" "$TEMP_DIR/output.txt"; then
    echo "✅ CREDENTIALS ARE VALID!"
    echo ""
    echo "The error about 'entity missing' is expected (we submitted a text file)."
    echo "Your credentials work correctly."
    echo ""
    echo "To store credentials in keychain for future use:"
    echo ""
    echo "  xcrun notarytool store-credentials \"onefiler\" \\"
    echo "    --apple-id \"$NOTARIZATION_APPLE_ID\" \\"
    echo "    --team-id \"$TEAM_ID\" \\"
    echo "    --password \"$NOTARIZATION_PASSWORD\""
    echo ""

elif grep -q "Could not find the password for apple-id" "$TEMP_DIR/output.txt"; then
    echo "❌ PASSWORD NOT ACCEPTED"
    echo ""
    echo "The password format is incorrect. Make sure you're using:"
    echo "  • App-specific password (not regular password)"
    echo "  • Format: xxxx-xxxx-xxxx-xxxx (with dashes)"
    echo "  • No extra spaces or quotes"
    echo ""

elif grep -q "Successfully uploaded" "$TEMP_DIR/output.txt"; then
    echo "✅ CREDENTIALS WORK PERFECTLY!"
    echo ""
    echo "Successfully authenticated and uploaded to Apple."
    echo ""
else
    echo "⚠️  UNEXPECTED RESPONSE"
    echo ""
    echo "Check the output above for details."
    echo ""
fi

# Clean up
rm -rf "$TEMP_DIR"

exit $EXIT_CODE
