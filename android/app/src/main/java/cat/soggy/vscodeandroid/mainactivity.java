package cat.soggy.vscodeandroid;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/*//////////////////////////////////////////////////////////////////////*/

public class mainactivity extends Activity {
    private WebView browser;
    private EditText address;
    private TextView status;
    private LinearLayout page;
    private ValueCallback<Uri[]> picker;
    private String origin = "http://127.0.0.1:8765";
    private final int foreground = Color.rgb(204, 204, 204);

    @Override
    public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(24, 24, 24));
        getWindow().setNavigationBarColor(Color.rgb(24, 24, 24));
        showconnection();
    }

    private int pixels(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private TextView label(String value, int size) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextColor(foreground);
        text.setTextSize(size);
        text.setPadding(0, pixels(12), 0, pixels(12));
        return text;
    }

    private Button button(String title, boolean primary) {
        Button button = new Button(this);
        button.setText(title);
        button.setAllCaps(false);
        button.setTextColor(primary ? Color.WHITE : foreground);
        button.setTextSize(14);
        GradientDrawable background = new GradientDrawable();
        background.setColor(primary ? Color.rgb(0, 120, 212) : Color.rgb(49, 49, 49));
        background.setCornerRadius(pixels(2));
        button.setBackground(background);
        button.setMinimumHeight(pixels(42));
        return button;
    }

    private void showconnection() {
        if (browser != null) {browser.destroy(); browser = null;}
        page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(pixels(24), pixels(12), pixels(24), pixels(20));
        page.setBackgroundColor(Color.rgb(31, 31, 31));
        page.addView(label("Workspace", 24));
        page.addView(label("Local runtime address", 13));
        address = new EditText(this);
        address.setTextColor(foreground);
        address.setSingleLine(true);
        address.setTextSize(13);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText("http://127.0.0.1:8765/#");
        try {
            String previous = getPreferences(MODE_PRIVATE).getString("connection", "");
            if (!previous.isEmpty()) address.setText(unseal(previous));
        } catch (Exception error) {}
        page.addView(address, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, pixels(48)));
        page.addView(label("Paste the local launcher link printed by the Android runtime.", 13));
        Button connect = button("Open workspace", true);
        connect.setOnClickListener(view -> connect());
        page.addView(connect, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, pixels(44)));
        status = label("Start the runtime in Termux before connecting.", 13);
        page.addView(status);
        setContentView(page);
    }

    private void connect() {
        String value = address.getText().toString().trim();
        Uri url = Uri.parse(value);
        if (!"http".equals(url.getScheme()) || !"127.0.0.1".equals(url.getHost()) || url.getPort() != 8765 || url.getUserInfo() != null) {
            status.setText("Use the runtime link at http://127.0.0.1:8765/#...");
            return;
        }
        try {getPreferences(MODE_PRIVATE).edit().putString("connection", seal(value)).apply();}
        catch (Exception error) {status.setText("Could not save the connection.");}
        origin = "http://127.0.0.1:8765";
        browser = new WebView(this);
        browser.setBackgroundColor(Color.rgb(31, 31, 31));
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        browser.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                boolean local = "http".equals(target.getScheme()) && "127.0.0.1".equals(target.getHost()) && target.getPort() == 8765;
                if (local) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(target.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) runOnUiThread(() -> {
                    showconnection();
                    status.setText("Runtime unavailable. Start it in Termux and reconnect.");
                });
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picker != null) picker.onReceiveValue(null);
                picker = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                startActivityForResult(intent, 12);
                return true;
            }
        });
        setContentView(browser);
        browser.loadUrl(value);
    }

    /*//////////////////////////////////////////////////////////////////////*/

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias("workspace")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("workspace", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry)store.getEntry("workspace", null)).getSecretKey();
    }

    private String seal(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] result = new byte[12 + encrypted.length];
        System.arraycopy(cipher.getIV(), 0, result, 0, 12);
        System.arraycopy(encrypted, 0, result, 12, encrypted.length);
        return Base64.encodeToString(result, Base64.NO_WRAP);
    }

    private String unseal(String value) throws Exception {
        byte[] bytes = Base64.decode(value, Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(bytes, 0, 12)));
        return new String(cipher.doFinal(Arrays.copyOfRange(bytes, 12, bytes.length)), StandardCharsets.UTF_8);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 12 && picker != null) {
            picker.onReceiveValue(result == RESULT_OK && data != null ? new Uri[]{data.getData()} : null);
            picker = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (browser != null && browser.canGoBack()) browser.goBack();
        else if (browser != null) showconnection();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (picker != null) picker.onReceiveValue(null);
        if (browser != null) browser.destroy();
        super.onDestroy();
    }
}
