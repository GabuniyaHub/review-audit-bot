#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
BUILD_TOOLS="${BUILD_TOOLS:-36.0.0}"
TOOLS="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
for tool in "$TOOLS/aapt2" "$TOOLS/d8" "$TOOLS/zipalign" "$TOOLS/apksigner" "$JAVA_HOME/bin/javac"; do
  test -x "$tool" || { echo "Missing tool: $tool" >&2; exit 1; }
done
test -f "$ANDROID_JAR" || { echo 'Install Android SDK Platform 35.' >&2; exit 1; }
mkdir -p build/classes build/dex build/generated/ru/reputation/audit
# Generate the key holder without printing credentials or placing them in tracked files.
node scripts/generate-secrets.mjs
"$TOOLS/aapt2" compile --dir app/src/main/res -o build/resources.zip
"$TOOLS/aapt2" link -o build/base.apk -I "$ANDROID_JAR" --manifest app/src/main/AndroidManifest.xml --java build/generated -A app/src/main/assets --min-sdk-version 26 --target-sdk-version 35 --version-code 1 --version-name 1.0.0 build/resources.zip
find app/src/main/java build/generated -name '*.java' > build/java-sources.txt
"$JAVA_HOME/bin/javac" -encoding UTF-8 --release 11 -classpath "$ANDROID_JAR" -d build/classes @build/java-sources.txt
find build/classes -name '*.class' > build/class-files.txt
"$TOOLS/d8" --lib "$ANDROID_JAR" --min-api 26 --output build/dex @build/class-files.txt
cp build/base.apk build/unsigned.apk
(cd build/dex && zip -q -u ../unsigned.apk classes*.dex)
"$TOOLS/zipalign" -f 4 build/unsigned.apk build/aligned.apk
if [ ! -f demo.keystore ]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore demo.keystore -storepass android -keypass android -alias demo -keyalg RSA -keysize 2048 -validity 3650 -dname 'CN=Reputation Audit Demo' >/dev/null 2>&1
fi
"$TOOLS/apksigner" sign --ks demo.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias demo --out build/reputation-audit.apk build/aligned.apk
"$TOOLS/apksigner" verify build/reputation-audit.apk
echo 'Built: android/build/reputation-audit.apk'
