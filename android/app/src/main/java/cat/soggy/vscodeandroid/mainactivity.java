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
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.ScrollView;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.net.HttpURLConnection;
import java.net.URL;
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
    private String download;
    private String pendingruntime;
    private volatile int attempt;
    private final int foreground = Color.rgb(204, 204, 204);

    @Override
    public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().setStatusBarColor(Color.rgb(24, 24, 24));
        getWindow().setNavigationBarColor(Color.rgb(24, 24, 24));
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        }
        showconnection();
        String previous = address.getText().toString();
        if (Uri.parse(previous).getFragment() != null && Uri.parse(previous).getFragment().matches("[a-zA-Z0-9_-]{43}")) connect();
    }

    private int pixels(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (browser == null) return;
        int generation = attempt;
        new Thread(() -> {
            if (healthy()) return;
            runOnUiThread(() -> {
                if (generation != attempt || browser == null || isDestroyed()) return;
                showconnection();
                connect();
            });
        }, "workspaceresume").start();
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

    private void showview(View content) {
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(24, 24, 24));
        frame.addView(content, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            }
            return insets;
        });
        setContentView(frame);
        frame.requestApplyInsets();
    }

    private void showconnection() {
        attempt++;
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
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(page);
        showview(scroll);
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
        pendingruntime = value;
        checkruntime(value, false);
    }

    private boolean healthy() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection)new URL("http://127.0.0.1:8765/health").openConnection();
            connection.setConnectTimeout(700);
            connection.setReadTimeout(700);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return false;
            try (java.io.InputStream input = connection.getInputStream()) {
                java.io.ByteArrayOutputStream data = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[256];
                int count;
                while ((count = input.read(buffer)) > 0 && data.size() < 1024) data.write(buffer, 0, count);
                return "vscode-android".equals(new org.json.JSONObject(data.toString("UTF-8")).optString("application"));
            }
        } catch (Exception error) {return false;}
        finally {if (connection != null) connection.disconnect();}
    }

    private void checkruntime(String value, boolean started) {
        int generation = ++attempt;
        status.setText(started ? "Starting runtime..." : "Connecting...");
        new Thread(() -> {
            for (int retry = 0; retry < (started ? 45 : 1); retry++) {
                if (generation != attempt || isDestroyed()) return;
                if (healthy()) {
                    runOnUiThread(() -> {if (generation == attempt && !isDestroyed()) showworkspace(value);});
                    return;
                }
                if (!started) {
                    runOnUiThread(() -> {if (generation == attempt && !isDestroyed()) startruntime(value);});
                    return;
                }
                try {Thread.sleep(700);} catch (InterruptedException error) {return;}
            }
            runOnUiThread(() -> {
                if (generation == attempt && !isDestroyed()) status.setText("Runtime did not start. Check Termux external-command permission or run ~/.local/bin/workspace in Termux.");
            });
        }, "workspacestart").start();
    }

    private void startruntime(String value) {
        if (checkSelfPermission("com.termux.permission.RUN_COMMAND") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            pendingruntime = value;
            status.setText("Allow Workspace to start the Termux runtime.");
            requestPermissions(new String[]{"com.termux.permission.RUN_COMMAND"}, 71);
            return;
        }
        try {
            Intent intent = new Intent("com.termux.RUN_COMMAND");
            intent.setClassName("com.termux", "com.termux.app.RunCommandService");
            intent.putExtra("com.termux.RUN_COMMAND_PATH", "/data/data/com.termux/files/home/.local/bin/workspace");
            intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", "/data/data/com.termux/files/home");
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            intent.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Workspace");
            startService(intent);
            checkruntime(value, true);
        } catch (Exception error) {
            android.util.Log.e("Workspace", "Runtime startup failed", error);
            status.setText("Could not start Termux: " + error.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != 71) return;
        if (grants.length > 0 && grants[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) startruntime(pendingruntime);
        else status.setText("Allow command access in Android app settings, or start the runtime in Termux.");
    }

    private void showworkspace(String value) {
        origin = "http://127.0.0.1:8765";
        browser = new WebView(this);
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
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
        browser.setDownloadListener((urlvalue, agent, disposition, type, length) -> {
            if (!urlvalue.startsWith(origin + "/api/download")) return;
            download = urlvalue;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, "workspace.handoff");
            startActivityForResult(intent, 13);
        });
        showview(browser);
        browser.loadUrl(Uri.parse(value).buildUpon().appendQueryParameter("editor", "1").build().toString());
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
        if (request == 13 && result == RESULT_OK && data != null && download != null) {
            Uri destination = data.getData();
            String source = download;
            String cookies = CookieManager.getInstance().getCookie(source);
            new Thread(() -> {
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection)new URL(source).openConnection();
                    connection.setConnectTimeout(10000);
                    connection.setReadTimeout(30000);
                    connection.setInstanceFollowRedirects(false);
                    if (cookies != null) connection.setRequestProperty("Cookie", cookies);
                    if (connection.getResponseCode() != 200) throw new Exception("Download failed");
                    try (java.io.InputStream input = connection.getInputStream(); java.io.OutputStream output = getContentResolver().openOutputStream(destination)) {
                        byte[] buffer = new byte[32768];
                        int count;
                        while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                    }
                    runOnUiThread(() -> android.widget.Toast.makeText(this, "Handoff saved", android.widget.Toast.LENGTH_SHORT).show());
                } catch (Exception error) {
                    runOnUiThread(() -> android.widget.Toast.makeText(this, "Could not save handoff", android.widget.Toast.LENGTH_LONG).show());
                } finally {if (connection != null) connection.disconnect();}
            }, "workspacedownload").start();
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
        attempt++;
        if (picker != null) picker.onReceiveValue(null);
        if (browser != null) browser.destroy();
        super.onDestroy();
    }
}
