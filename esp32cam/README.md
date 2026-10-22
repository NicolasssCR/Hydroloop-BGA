# Hydroloop BGA · ESP32-CAM (Fase 1)

La cámara se pega al visor del medidor. Cada madrugada toma una foto con flash, la envía al servidor,
el servidor lee los dígitos (OCR) y la app muestra el consumo real del día.

## Lo que necesitas
- ESP32-CAM **AI Thinker** (con cámara OV2640).
- Programador USB para ESP32-CAM (placa **ESP32-CAM-MB**) o un adaptador USB-serial FTDI de 3,3 V/5 V.
- Fuente de 5 V (cargador de celular) para dejarla instalada.
- Una cajita o soporte que la deje **fija y derecha** frente a los números, a unos 6–10 cm.

## Programarla
1. Instala **Arduino IDE**.
2. *Archivo → Preferencias → URLs adicionales*:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. *Herramientas → Placa → Gestor de placas* → instala **esp32** (de Espressif).
4. Abre `HydroloopCam/HydroloopCam.ino` y llena la sección **CONFIGURA AQUÍ**:
   - `WIFI_SSID` y `WIFI_CLAVE`.
   - `SERVIDOR`: la dirección del servidor en Render (`https://...onrender.com`) o la del computador (`http://192.168.x.x:3000`).
   - `DEVICE_KEY`: el mismo valor de `DEVICE_KEY` del archivo `.env` / Render.
   - `DISPOSITIVO`: un serial, p. ej. `ESP32-001`.
5. *Herramientas → Placa*: **AI Thinker ESP32-CAM**. Elige el puerto y pulsa **Subir**.
   (Con adaptador FTDI: une GPIO0 con GND para programar y quítalo después.)
6. Abre el *Monitor serie* a 115200: debe decir `WiFi OK`, `Foto: ... bytes` y `HTTP 201` o `HTTP 422`.

## Vincularla con tu cuenta
En la app: **Dashboard → Medidor de agua → Serial de tu ESP32-CAM**, escribe el mismo `DISPOSITIVO` y pulsa **GUARDAR**.

## Ajustar la zona de los números (importante)
1. Conéctala a la corriente: toma una foto enseguida.
2. En la app (Dashboard → Medidor) aparece la última foto y si se pudo leer.
3. Si dice **No se pudo leer**, ajusta `RECORTE = "x,y,ancho,alto"`: son fracciones de la foto (0 a 1)
   del rectángulo donde están **solo** los dígitos. Ejemplo: `0.20,0.37,0.60,0.19` = empieza al 20 % del
   ancho y 37 % del alto, y mide 60 % × 19 %.
4. `ENTEROS` = cantidad de dígitos negros (m³) y `DECIMALES` = cantidad de dígitos rojos que se ven.

## Cómo funciona el cálculo
- Lectura de hoy − lectura de ayer = m³ gastados → × 1000 = **litros del día** (barras del gráfico).
- Si el OCR lee un número imposible (menor que el anterior o más de 3 m³ en un día), se descarta y la foto
  queda marcada como **dudosa** en la app.
- Si un día falla, se puede escribir la lectura a mano en la app; el consumo se reparte entre los días.

## Si prefieres enviar el número ya leído
Si tu dispositivo lee los dígitos por su cuenta, envía:
```
POST /api/lecturas/medidor
x-device-key: <DEVICE_KEY>
Content-Type: application/json

{ "dispositivo": "ESP32-001", "lectura": 1393.712 }
```
