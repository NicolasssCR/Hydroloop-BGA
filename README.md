# Hydroloop BGA · App + API con MongoDB

Aplicación para monitorear el consumo de agua en Bucaramanga.

| Módulo | Qué hace | Dónde está |
|---|---|---|
| 1 · Onboarding & Setup | Registro, inicio de sesión (contraseñas cifradas con bcrypt, sesión con JWT) y perfil (estrato, dirección, municipio, serial del sensor) | `src/routes/auth.js`, `src/models/Usuario.js` |
| 2 · Escaneo inteligente | OCR de facturas amb (Tesseract.js) y **historial** de facturas en MongoDB | `public/index.html` (sección 5), `src/routes/facturas.js` |
| 3 · Predicción & Control | Velocímetro con factura estimada, barras de 7 días, **alerta al superar 15 %** del consumo habitual, datos del sensor ESP32 | `src/routes/dashboard.js`, `src/routes/lecturas.js` |

## Estructura

```
hydroloop/
├─ public/index.html        ← la app (pantallas, OCR, dashboard)
├─ src/
│  ├─ server.js             ← arranque: conecta a MongoDB
│  ├─ app.js                ← rutas del API
│  ├─ models/               ← Usuario, Factura, Lectura (Mongoose)
│  ├─ routes/               ← auth, facturas, lecturas, dashboard
│  └─ middleware/auth.js    ← verifica la sesión
├─ .env.example
└─ package.json
```

## 1. Crear la base de datos en MongoDB Atlas (gratis)

1. Entra a <https://www.mongodb.com/cloud/atlas> y crea una cuenta.
2. Crea un clúster gratuito (**M0 / Free**).
3. En **Database Access**, crea un usuario con contraseña.
4. En **Network Access**, agrega tu IP (o `0.0.0.0/0` mientras pruebas).
5. En **Database → Connect → Drivers**, copia la cadena de conexión
   (`mongodb+srv://...`) y agrégale `/hydroloop` antes del `?`.

> También sirve MongoDB instalado en tu computador: `mongodb://127.0.0.1:27017/hydroloop`

## 2. Ejecutar

Necesitas **Node.js 18 o superior**.

```bash
cd hydroloop
npm install
cp .env.example .env      # en Windows: copy .env.example .env
# abre .env y pega tu MONGODB_URI, inventa un JWT_SECRET y un DEVICE_KEY
npm start
```

Abre <http://localhost:3000>. Para probar desde el celular en la misma red WiFi,
usa la IP del computador, por ejemplo `http://192.168.1.10:3000`.

Para ver los datos guardados: en Atlas, **Browse Collections** (o instala MongoDB Compass).
Colecciones: `usuarios`, `facturas`, `lecturas`.

## 3. API

Todas las rutas (menos registro, login y sensor) necesitan la cabecera
`Authorization: Bearer <token>`.

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/auth/registro` | `{nombre, correo, clave, estrato, dir, municipio, dispositivo?}` |
| POST | `/api/auth/login` | `{correo, clave}` → `{token, usuario}` |
| GET / PUT | `/api/auth/yo` | Ver o editar el perfil (p. ej. vincular `dispositivo`) |
| POST | `/api/facturas` | Guardar una factura escaneada |
| GET | `/api/facturas` | Historial de facturas |
| DELETE | `/api/facturas/:id` | Borrar una factura |
| GET | `/api/dashboard` | Proyección, semana, historial y alerta (todo calculado en el servidor) |
| POST | `/api/lecturas/foto` | La ESP32-CAM envía la foto del medidor; el servidor lee los dígitos (OCR) |
| POST | `/api/lecturas/medidor` | Un dispositivo envía la lectura ya leída `{dispositivo, lectura}` |
| POST | `/api/lecturas/medidor/manual` | El usuario escribe la lectura del medidor `{lectura}` |
| GET | `/api/lecturas/medidor` · `/medidor/foto` | Últimas lecturas y última foto del medidor |
| POST | `/api/lecturas/sensor` | Litros directos (caudalímetro) |
| POST | `/api/lecturas/simular` | `{factor}` 1 = normal, 1.5 = fuga (para demostraciones) |

**Cómo se calcula:**
- *Consumo habitual* = promedio de m³ de las facturas guardadas (con una sola factura, su "promedio histórico").
- *Proyección* = litros/día medidos × 30 ÷ 1000 (m³/mes).
- *Factura estimada* = cargo fijo + m³ proyectados × valor del m³ + otros cobros.
- *Alerta* si la proyección supera el habitual en más de **15 %** (`UMBRAL_ALERTA` en `dashboard.js`).

## 4. Fase 1: ESP32-CAM en el medidor

Ver `esp32cam/README.md` (código Arduino en `esp32cam/HydroloopCam/`).
Cada madrugada la cámara envía una foto; el servidor lee los dígitos, resta la lectura anterior y
reparte los litros por día (hora de Colombia). Las lecturas imposibles (menores que la anterior o más de
3 m³ en un día) se rechazan. La lectura también se puede escribir a mano en la app (Dashboard → Medidor).

## Publicar en internet
Ver `PUBLICAR.md` (Render, gratis).

## 5. App para el celular (.apk)

La carpeta `android/` contiene la app Android (ver `android/README.md`).
El instalador ya compilado es `HydroloopBGA.apk`: se instala en el celular, se escribe la
dirección del servidor (p. ej. `http://192.168.1.10:3000`) y listo.
