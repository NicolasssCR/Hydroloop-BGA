// Firma el APK (esquemas v2 + v3) con la llave de build/firma/.
// No se usa v1 (JAR): solo hace falta en Android < 7 y la app pide mínimo Android 7 (API 24).
// Así el APK queda alineado (los archivos META-INF de v1 rompían la alineación).
// Uso: node sign.mjs entrada.apk salida.apk
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApkSigner, SigningKey } from 'apk_sign_ts';

const aqui = dirname(fileURLToPath(import.meta.url));
const [entrada, salida] = process.argv.slice(2);
const key = readFileSync(join(aqui, 'firma/hydroloop.key.pk8.pem'), 'utf8');
const cert = readFileSync(join(aqui, 'firma/hydroloop.cert.pem'), 'utf8');
const signer = new ApkSigner({ signingKey: SigningKey.fromPEM(key, cert) });
signer.v1Signer = { sign: async apk => apk };   // omitir v1
const { signedApk } = await signer.sign(new Uint8Array(readFileSync(entrada)));
writeFileSync(salida, signedApk);
console.log('firmado:', salida, signedApk.length, 'bytes');
