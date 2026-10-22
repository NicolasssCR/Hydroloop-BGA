#!/usr/bin/env bash
# Compila Hydroloop BGA (.apk) sin Android Studio ni Gradle.
# Requisitos: Python 3, Node.js, aapt2 (npm: aaptjs3), pip: repro-apk apksigtool
# Uso: AAPT2=/ruta/a/aapt2 ./build_apk.sh
set -euo pipefail
cd "$(dirname "$0")"
A=..
AAPT2=${AAPT2:-aapt2}
OUT=out
mkdir -p $OUT/fw $OUT/res
rm -f $OUT/fw/*.flat $OUT/res/*.flat

echo "1) Tabla mínima del framework (IDs públicos reales de Android)"
$AAPT2 compile -o $OUT/fw/ fake-framework/res/values/attrs.xml
$AAPT2 link -o $OUT/android-min.apk --manifest fake-framework/AndroidManifest.xml \
  --stable-ids fake-framework/ids.txt --no-compile-sdk-metadata $OUT/fw/*.flat

echo "2) Recursos, manifest y pantalla inicial"
$AAPT2 compile --dir $A/res -o $OUT/res/
$AAPT2 link -o $OUT/base.apk -I $OUT/android-min.apk --manifest $A/AndroidManifest.xml \
  -A $A/assets --no-compile-sdk-metadata $OUT/res/*.flat

echo "3) Código (classes.dex)"
python3 build_dex.py $OUT/classes.dex

echo "4) Empaquetar + alinear"
python3 - <<'PY'
import zipfile, shutil
shutil.copy('out/base.apk', 'out/unsigned.apk')
with zipfile.ZipFile('out/unsigned.apk', 'a') as z:
    i = zipfile.ZipInfo('classes.dex', date_time=(1980, 1, 1, 0, 0, 0))
    i.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(i, open('out/classes.dex', 'rb').read())
PY
repro-apk zipalign --pad-like-apksigner --replace $OUT/unsigned.apk $OUT/aligned.apk

echo "5) Firmar (v2 + v3)"
node sign.mjs $OUT/aligned.apk $OUT/HydroloopBGA.apk

echo "6) Verificar"
apksigtool verify $OUT/HydroloopBGA.apk
repro-apk zipalignment $OUT/HydroloopBGA.apk | grep "zipaligned"
echo "Listo: build/$OUT/HydroloopBGA.apk"
