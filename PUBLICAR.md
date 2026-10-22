# Publicar Hydroloop BGA en internet (Render, gratis)

Así el servidor funciona **sin tu computador encendido** y desde cualquier red: la app del celular
y la ESP32-CAM se conectan a una dirección como `https://hydroloop-bga.onrender.com`.

Tiempo: unos 20 minutos. Necesitas una cuenta de **GitHub** y una de **Render** (gratis).

---

## 1. Preparar MongoDB Atlas
1. Atlas → **Network Access** → debe estar `0.0.0.0/0` (Render no tiene IP fija).
2. Ten a mano tu `MONGODB_URI` (la misma del archivo `.env`).
   🔒 Si la contraseña salió en capturas, cámbiala primero: **Database Access → Edit → Edit Password**,
   y actualiza la cadena.

## 2. Subir el proyecto a GitHub
1. Entra a <https://github.com> → **New repository** → nombre `hydroloop-bga` → **Private** → **Create**.
2. En la página del repositorio vacío: **uploading an existing file**.
3. Arrastra **el contenido** de la carpeta `hydroloop` (no la carpeta en sí), **excepto**:
   - `node_modules` (es enorme y Render la crea solo)
   - `.env` (tiene tus contraseñas)
   - `android/build/firma` (llave privada de la app; guárdala en tu computador)
4. **Commit changes**.

> Si usas Git en la terminal: `git init`, `git add .`, `git commit -m "Hydroloop BGA"` y sigue las
> instrucciones de GitHub. El archivo `.gitignore` ya excluye esas carpetas.

## 3. Crear el servidor en Render
1. Entra a <https://render.com> → **Sign up with GitHub**.
2. **New → Web Service** → conecta tu repositorio `hydroloop-bga`.
3. Configura:
   | Campo | Valor |
   |---|---|
   | Name | `hydroloop-bga` |
   | Language / Runtime | **Node** |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
4. En **Environment Variables** agrega:
   | Key | Value |
   |---|---|
   | `MONGODB_URI` | tu cadena de Atlas |
   | `JWT_SECRET` | un texto largo inventado |
   | `DEVICE_KEY` | p. ej. `sensor-hydroloop-123` (el mismo de la ESP32-CAM) |
5. **Create Web Service**. Espera a que diga **Live** (2–5 min). En **Logs** debe aparecer
   `Hydroloop BGA listo`.
6. Copia la dirección de arriba, p. ej. `https://hydroloop-bga.onrender.com`.

*(Alternativa: **New → Blueprint** con el archivo `render.yaml` del proyecto; solo pide `MONGODB_URI` y `DEVICE_KEY`.)*

## 4. Probar
- En el navegador abre `https://TU-DIRECCION.onrender.com/api/salud` → debe responder `{"ok":true,"db":true}`.
- Abre `https://TU-DIRECCION.onrender.com` → la app.
- **App del celular:** Atrás hasta la pantalla del servidor → escribe la dirección `https://...onrender.com` → CONECTAR.
- **ESP32-CAM:** pon esa dirección en `SERVIDOR` y vuelve a subir el código.

## Bueno saber (plan gratis)
- Si nadie lo usa en **15 minutos, el servidor se duerme**; la siguiente visita tarda **~1 minuto** en
  responder. Antes de presentar, ábrelo una vez para "despertarlo".
- Tiene 750 horas gratis al mes (suficiente para un servidor encendido todo el mes).
- Los datos no se pierden: están en MongoDB Atlas, no en Render.
- Cada vez que subas cambios a GitHub, Render vuelve a publicar solo.
