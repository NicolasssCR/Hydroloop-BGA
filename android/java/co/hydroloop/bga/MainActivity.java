package co.hydroloop.bga;

// Código de referencia de la app Android. El APK se genera desde build/build_dex.py,
// que contiene exactamente esta lógica escrita como bytecode Dalvik (no hace falta Android Studio).

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Pantalla única: un WebView que muestra la app Hydroloop BGA. */
public class MainActivity extends Activity {
    public WebView web;
    public ValueCallback<Uri[]> cb;   // respuesta pendiente al selector de fotos
    public Uri camUri;                // dónde guarda la cámara la foto (si se eligió cámara)

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        WebView w = new WebView(this);
        web = w;
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // localStorage (sesión del usuario)
        s.setAllowFileAccess(true);        // pantalla inicial en assets/index.html
        w.setWebViewClient(new WebViewClient());   // los enlaces se abren dentro de la app
        w.setWebChromeClient(new Chooser(this));   // permite <input type="file"> (foto de la factura)
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
    }

    /** Botón Atrás: navega hacia atrás en la app (hasta la pantalla del servidor) antes de salir. */
    @Override
    public void onBackPressed() {
        WebView w = web;
        if (w != null && w.canGoBack()) { w.goBack(); return; }
        super.onBackPressed();
    }

    /** Devuelve al WebView la foto elegida en la galería o tomada con la cámara. */
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        ValueCallback<Uri[]> c = cb;
        if (c == null) return;
        cb = null;
        Uri[] r = WebChromeClient.FileChooserParams.parseResult(res, data);
        Uri u = camUri;
        if (u != null) {
            if (r == null && res == RESULT_OK) {
                r = new Uri[] { u };                      // la foto la tomó la cámara
            } else {
                try { getContentResolver().delete(u, null, null); } catch (Exception e) { }  // no se usó
            }
            camUri = null;
        }
        c.onReceiveValue(r);
    }
}
