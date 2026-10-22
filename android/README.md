# Hydroloop BGA · App Android (.apk)

App nativa mínima (≈ 25 KB) que muestra Hydroloop BGA dentro de un WebView.
Al abrirla, pide la **dirección del servidor**, la recuerda y entra a la app.

| Qué | Dónde |
|---|---|
| Pantalla inicial (dirección del servidor) | `assets/index.html` |
| Código Java de referencia | `java/co/hydroloop/bga/` |
| Bytecode real del APK (genera `classes.dex`) | `build/build_dex.py` |
| Manifest, ícono y tema | `AndroidManifest.xml`, `res/` |
| Script de compilación | `build/build_apk.sh` |
| Llave de firma (no la compartas) | `build/firma/` |

## Qué hace la app
- Muestra la app web del servidor (registro, escaneo, dashboard).
- **Foto de la factura:** al tocar "Tomar / subir foto" ofrece **Cámara** (Android 10+) y **Galería/Archivos**.
- **Botón Atrás:** vuelve a la pantalla del servidor para cambiar la dirección.
- Requisitos: Android 7.0 o superior, internet (el lector OCR se descarga la primera vez).

## Instalar en el celular
1. Pasa `HydroloopBGA.apk` al celular (WhatsApp a ti mismo, Drive, cable USB…).
2. Ábrelo. Android pedirá permiso para **instalar apps de origen desconocido** → permitir.
3. Si Play Protect avisa "app no reconocida" → **Más detalles → Instalar de todos modos**.

## Conectar con el servidor
1. En el computador: `npm start` (deja la terminal abierta).
2. `ipconfig` → "Dirección IPv4", p. ej. `192.168.1.10`.
3. En la app escribe `http://192.168.1.10:3000` y pulsa **CONECTAR**.
4. El celular debe estar en la **misma red WiFi**. Si Windows pregunta por el firewall, permite el acceso
   en redes privadas (o en *Firewall de Windows → Permitir una aplicación* marca **Node.js**).

Si publicas el servidor en internet (p. ej. Render), usa esa dirección `https://…` y funciona desde cualquier red.

## Volver a compilar (opcional)
Necesitas Python 3, Node.js, `aapt2` (paquete npm `aaptjs3`) y `pip install repro-apk apksigtool`:
```bash
cd android/build
npm install
AAPT2=/ruta/a/aapt2 ./build_apk.sh      # resultado: build/out/HydroloopBGA.apk
```
Para publicar una actualización que se instale encima de la anterior, sube `versionCode` en
`AndroidManifest.xml` y firma con la **misma** llave de `build/firma/`.
