package co.hydroloop.bga;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Parcelable;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** Abre el selector "Galería / Cámara" cuando la app pide la foto de la factura. */
public class Chooser extends WebChromeClient {
    public MainActivity a;

    public Chooser(MainActivity a) {
        super();
        this.a = a;
    }

    @Override
    public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        MainActivity a = this.a;
        if (a.cb != null) a.cb.onReceiveValue(null);   // cancela una petición anterior
        a.cb = cb;
        a.camUri = null;

        Intent chooser = Intent.createChooser(p.createIntent(), "Foto de la factura");   // galería / archivos
        if (Build.VERSION.SDK_INT >= 29) {      // Android 10+: la cámara guarda la foto sin pedir permisos
            try {
                Uri u = a.getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, new ContentValues());
                if (u != null) {
                    a.camUri = u;
                    Intent cam = new Intent("android.media.action.IMAGE_CAPTURE");
                    cam.putExtra("output", u);
                    cam.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { cam });
                }
            } catch (Exception e) {
                a.camUri = null;                // sin cámara: solo galería
            }
        }
        a.startActivityForResult(chooser, 1);
        return true;
    }
}
