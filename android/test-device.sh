#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
TOOLS="$ANDROID_SDK_ROOT/build-tools/${BUILD_TOOLS:-36.0.0}"
JAR="$ANDROID_SDK_ROOT/platforms/android-35/android.jar"
export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p build/test-classes build/test-dex
"$TOOLS/aapt2" link -o build/test-base.apk -I "$JAR" --manifest tests/AndroidManifest.xml --min-sdk-version 26 --target-sdk-version 35
"$JAVA_HOME/bin/javac" -encoding UTF-8 --release 11 -classpath "$JAR:build/classes" -d build/test-classes tests/AuditInstrumentation.java
find build/test-classes -name '*.class' > build/test-class-files.txt
"$TOOLS/d8" --lib "$JAR" --classpath build/classes --min-api 26 --output build/test-dex @build/test-class-files.txt
cp build/test-base.apk build/test-unsigned.apk
(cd build/test-dex && zip -q -u ../test-unsigned.apk classes*.dex)
"$TOOLS/zipalign" -f 4 build/test-unsigned.apk build/test-aligned.apk
"$TOOLS/apksigner" sign --ks demo.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias demo --out build/test.apk build/test-aligned.apk
ADB="$ANDROID_SDK_ROOT/platform-tools/adb"
"$ADB" -s "${ANDROID_SERIAL:-emulator-5554}" install --no-incremental -r build/reputation-audit.apk
"$ADB" -s "${ANDROID_SERIAL:-emulator-5554}" install --no-incremental -r build/test.apk
# This test resets only the app's database on the explicitly selected test device.
audit_test_result=$("$ADB" -s "${ANDROID_SERIAL:-emulator-5554}" shell am instrument -w -e live "${ANDROID_LIVE_LLM:-true}" ru.reputation.audit.test/ru.reputation.audit.AuditInstrumentation)
printf '%s\n' "$audit_test_result"
case "$audit_test_result" in
  *"result=PASS:"*) ;;
  *) exit 1 ;;
esac
