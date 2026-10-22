/*
  Hydroloop BGA · Fase 1 · ESP32-CAM en el medidor de agua
  ---------------------------------------------------------
  - Se despierta una vez al día (HORA_FOTO, en la madrugada).
  - Enciende el flash LED, toma una foto de los dígitos del medidor y la envía al servidor.
  - El servidor lee los números (OCR), calcula los litros del día y los muestra en la app.
  - Luego se duerme (deep sleep) hasta el día siguiente.
  - Al conectarla a la corriente toma una foto de inmediato (sirve para probar).

  Placa: "AI Thinker ESP32-CAM"  (Arduino IDE → Herramientas → Placa → esp32 → AI Thinker ESP32-CAM)
  Requiere: paquete de placas "esp32" de Espressif (Gestor de placas). No necesita librerías extra.
*/
#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>
#include "driver/rtc_io.h"

// ======================= CONFIGURA AQUÍ =======================
const char* WIFI_SSID   = "TU_WIFI";
const char* WIFI_CLAVE  = "TU_CLAVE_WIFI";
// Servidor: el de Render (https://...) o el de tu computador (http://192.168.1.10:3000)
const char* SERVIDOR    = "https://hydroloop-bga.onrender.com";
const char* DEVICE_KEY  = "sensor-hydroloop-123";   // el mismo DEVICE_KEY del servidor
const char* DISPOSITIVO = "ESP32-001";              // el mismo serial que escribes en la app
// Medidor: dígitos negros (m³) y rojos (fracción) que se leen
const int   ENTEROS     = 5;
const int   DECIMALES   = 3;
// Zona de la foto donde están los números: x, y, ancho, alto (fracciones de 0 a 1).
// Ajústala con las primeras fotos (se ven en la app → Dashboard → Medidor).
const char* RECORTE     = "0.20,0.37,0.60,0.19";
const int   HORA_FOTO   = 3;     // 3:00 a. m. (hora de Colombia)
// ===============================================================

// Pines de la cámara (AI Thinker)
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22
#define FLASH_LED 4

bool iniciarCamara() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = psramFound() ? FRAMESIZE_SVGA : FRAMESIZE_VGA;   // 800x600 (o 640x480 sin PSRAM)
  c.jpeg_quality = 10;                                           // 0-63: menor = mejor calidad
  c.fb_count = 1;
  c.fb_location = psramFound() ? CAMERA_FB_IN_PSRAM : CAMERA_FB_IN_DRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&c) != ESP_OK) return false;
  sensor_t* s = esp_camera_sensor_get();
  s->set_brightness(s, 0);
  s->set_contrast(s, 1);
  return true;
}

bool conectarWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_CLAVE);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  return WiFi.status() == WL_CONNECTED;
}

camera_fb_t* tomarFoto() {
  rtc_gpio_hold_dis((gpio_num_t)FLASH_LED);
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, HIGH);                 // flash encendido
  delay(300);
  for (int i = 0; i < 3; i++) {                  // descarta fotos mientras se ajusta la exposición
    camera_fb_t* f = esp_camera_fb_get();
    if (f) esp_camera_fb_return(f);
    delay(150);
  }
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED, LOW);
  return fb;
}

int enviarFoto(camera_fb_t* fb) {
  String url = String(SERVIDOR) + "/api/lecturas/foto?dispositivo=" + DISPOSITIVO +
               "&enteros=" + ENTEROS + "&decimales=" + DECIMALES + "&recorte=" + RECORTE;
  for (int intento = 1; intento <= 3; intento++) {
    HTTPClient http;
    WiFiClientSecure seguro;
    WiFiClient normal;
    bool https = url.startsWith("https");
    if (https) { seguro.setInsecure(); http.begin(seguro, url); }  // sin verificar certificado
    else http.begin(normal, url);
    http.setConnectTimeout(30000);
    http.setTimeout(60000);                      // máx. 65 s (Render gratis tarda ~1 min en despertar)
    http.addHeader("Content-Type", "image/jpeg");
    http.addHeader("x-device-key", DEVICE_KEY);
    int codigo = http.POST(fb->buf, fb->len);
    Serial.printf("Intento %d → HTTP %d\n", intento, codigo);
    if (codigo > 0) Serial.println(http.getString());
    http.end();
    if (codigo > 0 && codigo < 500) return codigo;   // 201 = leída; 422 = no se pudo leer (la foto queda en la app)
    delay(10000);
  }
  return -1;
}

uint64_t segundosHastaLaProximaFoto() {
  configTime(-5 * 3600, 0, "pool.ntp.org", "time.google.com");   // hora de Colombia (UTC-5)
  struct tm t;
  if (!getLocalTime(&t, 15000)) return 24ULL * 3600;             // sin hora: vuelve en 24 h
  long ahora = t.tm_hour * 3600L + t.tm_min * 60L + t.tm_sec;
  long objetivo = HORA_FOTO * 3600L;
  long espera = objetivo - ahora;
  if (espera <= 60) espera += 24L * 3600;
  Serial.printf("Son las %02d:%02d. Próxima foto en %ld s\n", t.tm_hour, t.tm_min, espera);
  return (uint64_t)espera;
}

void dormir(uint64_t segundos) {
  digitalWrite(FLASH_LED, LOW);
  rtc_gpio_hold_en((gpio_num_t)FLASH_LED);       // evita que el flash brille dormido
  esp_sleep_enable_timer_wakeup(segundos * 1000000ULL);
  Serial.println("Durmiendo...");
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nHydroloop BGA · ESP32-CAM");

  if (!iniciarCamara()) { Serial.println("Error: cámara"); dormir(3600); }
  if (!conectarWifi())  { Serial.println("Error: WiFi");   dormir(1800); }   // reintenta en 30 min
  Serial.print("WiFi OK, IP: "); Serial.println(WiFi.localIP());

  camera_fb_t* fb = tomarFoto();
  if (!fb) { Serial.println("Error: foto"); dormir(1800); }
  Serial.printf("Foto: %u bytes\n", fb->len);
  enviarFoto(fb);
  esp_camera_fb_return(fb);

  dormir(segundosHastaLaProximaFoto());
}

void loop() {}   // no se usa: todo ocurre en setup() y luego duerme
