package com.echo.memorynetwork;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "EchoWebView";
    private static final String PREFS_NAME = "echo_android_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String OFFLINE_ASSET_URL = "file:///android_asset/offline.html";
    private static final String LOCAL_APP_HOST = "echo.local";
    private static final String LOCAL_APP_URL = "https://" + LOCAL_APP_HOST + "/index.html";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingWebPermission;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

    private volatile String lastErrorTitle = "Unable to reach ECHO";
    private volatile String lastErrorDetail = "Check your internet connection or update the ECHO server URL.";
    private volatile String lastErrorUrl = "";
    private volatile int lastErrorStatus = 0;
    private volatile boolean standaloneActive = false;

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (pendingFileCallback == null) {
                    return;
                }
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(
                        result.getResultCode(),
                        result.getData()
                );
                pendingFileCallback.onReceiveValue(results);
                pendingFileCallback = null;
            });

    private final ActivityResultLauncher<String> audioPermissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
                if (pendingWebPermission != null) {
                    if (granted) {
                        pendingWebPermission.grant(pendingWebPermission.getResources());
                    } else {
                        pendingWebPermission.deny();
                    }
                    pendingWebPermission = null;
                }
            });

    private final ActivityResultLauncher<String> locationPermissionLauncher =
            registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
                if (pendingGeoCallback != null && pendingGeoOrigin != null) {
                    pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
                }
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(ContextCompat.getColor(this, R.color.echo_canvas));

        webView = new WebView(this);
        rootContainer.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(rootContainer);

        ViewCompat.setOnApplyWindowInsetsListener(rootContainer, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new EchoBridge(), "EchoAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (request != null && request.getUrl() != null
                        && LOCAL_APP_HOST.equalsIgnoreCase(request.getUrl().getHost())) {
                    return serveBundledWebAsset(request.getUrl());
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                String scheme = target.getScheme();
                if ("file".equalsIgnoreCase(scheme)) {
                    return false;
                }
                if (LOCAL_APP_HOST.equalsIgnoreCase(target.getHost())) {
                    return false;
                }
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                    openExternal(target);
                    return true;
                }
                Uri configured = Uri.parse(getConfiguredServerUrl());
                if (configured.getHost() != null && !configured.getHost().equalsIgnoreCase(target.getHost())) {
                    openExternal(target);
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
            ) {
                if (request == null || !request.isForMainFrame()) {
                    return;
                }
                Uri reqUrl = request.getUrl();
                if (reqUrl != null && ("file".equalsIgnoreCase(reqUrl.getScheme())
                        || LOCAL_APP_HOST.equalsIgnoreCase(reqUrl.getHost()))) {
                    return;
                }
                String safeUrl = sanitizeUrlForDisplay(reqUrl);
                int errorCode = error != null ? error.getErrorCode() : -1;
                CharSequence descSeq = error != null ? error.getDescription() : null;
                String desc = (descSeq != null && descSeq.length() > 0)
                        ? descSeq.toString()
                        : "Network connection failed";
                Log.e(TAG, "Main-frame load error (" + errorCode + ": " + desc + ") at " + safeUrl);
                if (!hasCustomServerUrl() && hasBundledWebApp()) {
                    view.stopLoading();
                    loadLocalStandaloneApp();
                    return;
                }
                showErrorFallback(
                        view,
                        "Unable to reach ECHO server",
                        "Network error (" + desc + "). Check your connection, update the Server URL, or continue in On-Device Mode.",
                        safeUrl,
                        0
                );
            }

            @Override
            public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse errorResponse
            ) {
                if (request == null || !request.isForMainFrame() || errorResponse == null) {
                    return;
                }
                Uri reqUrl = request.getUrl();
                if (reqUrl != null && ("file".equalsIgnoreCase(reqUrl.getScheme())
                        || LOCAL_APP_HOST.equalsIgnoreCase(reqUrl.getHost()))) {
                    return;
                }
                int statusCode = errorResponse.getStatusCode();
                if (statusCode < 400) {
                    return;
                }
                String safeUrl = sanitizeUrlForDisplay(reqUrl);
                String reason = errorResponse.getReasonPhrase();
                if (reason == null || reason.trim().isEmpty()) {
                    reason = statusCode == 404 ? "Page not found" : "HTTP error";
                }
                Log.e(TAG, "Main-frame HTTP " + statusCode + " (" + reason + ") at " + safeUrl);
                if (!hasCustomServerUrl() && hasBundledWebApp()) {
                    view.stopLoading();
                    loadLocalStandaloneApp();
                    return;
                }
                String detail = statusCode == 404
                        ? "The server returned HTTP 404 (Page not found) for this address. "
                          + "Deploy/publish the ECHO server at this URL, tap Server URL, or switch to On-Device Mode."
                        : "The server returned HTTP " + statusCode + " (" + reason + ").";
                showErrorFallback(
                        view,
                        "Server Error (HTTP " + statusCode + ")",
                        detail,
                        safeUrl,
                        statusCode
                );
            }

            @Override
            public void onReceivedSslError(
                    WebView view,
                    SslErrorHandler handler,
                    SslError error
            ) {
                handler.cancel();
                String rawUrl = error != null ? error.getUrl() : getConfiguredServerUrl();
                Uri parsedRaw = rawUrl != null ? Uri.parse(rawUrl) : null;
                if (parsedRaw != null && LOCAL_APP_HOST.equalsIgnoreCase(parsedRaw.getHost())) {
                    return;
                }
                String safeUrl = sanitizeUrlForDisplay(parsedRaw);
                int primaryError = error != null ? error.getPrimaryError() : -1;
                Log.e(TAG, "SSL verification error (" + primaryError + ") at " + safeUrl);
                if (!hasCustomServerUrl() && hasBundledWebApp()) {
                    view.stopLoading();
                    loadLocalStandaloneApp();
                    return;
                }
                showErrorFallback(
                        view,
                        "Secure Connection Failed",
                        "SSL certificate verification failed (code " + primaryError + "). Verify HTTPS on your ECHO server or switch to On-Device Mode.",
                        safeUrl,
                        0
                );
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    for (String res : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                            if (ContextCompat.checkSelfPermission(
                                    MainActivity.this,
                                    Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(request.getResources());
                            } else {
                                pendingWebPermission = request;
                                audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO);
                            }
                            return;
                        }
                    }
                    request.deny();
                });
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(
                    String origin,
                    GeolocationPermissions.Callback callback
            ) {
                if (ContextCompat.checkSelfPermission(
                        MainActivity.this,
                        Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    pendingGeoOrigin = origin;
                    pendingGeoCallback = callback;
                    locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION);
                }
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallback,
                    FileChooserParams fileChooserParams
            ) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = filePathCallback;
                try {
                    fileChooserLauncher.launch(fileChooserParams.createIntent());
                } catch (Exception ex) {
                    pendingFileCallback = null;
                    return false;
                }
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadConfiguredServer(false);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }

    private void showErrorFallback(
            WebView view,
            String title,
            String detail,
            String url,
            int statusCode
    ) {
        lastErrorTitle = title;
        lastErrorDetail = detail;
        lastErrorUrl = url != null ? url : "";
        lastErrorStatus = statusCode;
        view.stopLoading();
        view.loadUrl(OFFLINE_ASSET_URL);
    }

    private void loadConfiguredServer(boolean clearCache) {
        standaloneActive = false;
        if (clearCache) {
            webView.clearCache(false);
        }
        String url = getConfiguredServerUrl();
        Log.i(TAG, "Loading configured ECHO server: " + sanitizeUrlForDisplay(Uri.parse(url)));
        webView.loadUrl(url);
    }

    private void loadLocalStandaloneApp() {
        standaloneActive = true;
        runOnUiThread(() -> {
            Log.i(TAG, "Loading bundled on-device ECHO app at " + LOCAL_APP_URL);
            webView.loadUrl(LOCAL_APP_URL);
        });
    }

    private boolean hasBundledWebApp() {
        try (InputStream is = getAssets().open("www/index.html")) {
            return is != null;
        } catch (IOException ex) {
            return false;
        }
    }

    private boolean hasCustomServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER_URL, null);
        return saved != null && !saved.trim().isEmpty();
    }

    private WebResourceResponse serveBundledWebAsset(Uri url) {
        String rawPath = url.getPath();
        if (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath)) {
            rawPath = "index.html";
        } else if (rawPath.startsWith("/")) {
            rawPath = rawPath.substring(1);
        }
        if (rawPath.contains("..")) {
            return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    400,
                    "Bad Request",
                    null,
                    new ByteArrayInputStream("Invalid path".getBytes(StandardCharsets.UTF_8))
            );
        }
        if (rawPath.startsWith("api/")) {
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(
                    "application/json",
                    "UTF-8",
                    404,
                    "Not Found",
                    headers,
                    new ByteArrayInputStream("{\"error\":\"On-device standalone mode\"}".getBytes(StandardCharsets.UTF_8))
            );
        }

        String assetPath = "www/" + rawPath;
        InputStream stream = null;
        try {
            stream = getAssets().open(assetPath);
        } catch (IOException firstErr) {
            if (!rawPath.contains(".")) {
                try {
                    rawPath = "index.html";
                    stream = getAssets().open("www/index.html");
                } catch (IOException ignored) {
                    stream = null;
                }
            }
        }

        if (stream == null) {
            return new WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    404,
                    "Not Found",
                    null,
                    new ByteArrayInputStream("Not found".getBytes(StandardCharsets.UTF_8))
            );
        }

        String mimeType = guessMimeType(rawPath);
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-cache");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse(mimeType, "UTF-8", 200, "OK", headers, stream);
    }

    private String guessMimeType(String path) {
        String lower = path.toLowerCase(Locale.US);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private String getConfiguredServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER_URL, null);
        if (saved == null || saved.trim().isEmpty()) {
            return normalizeServerUrl(getString(R.string.default_server_url));
        }
        String normalized = normalizeServerUrl(saved);
        return normalized != null ? normalized : getString(R.string.default_server_url);
    }

    private String normalizeServerUrl(String raw) {
        if (raw == null) {
            return null;
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            trimmed = "https://" + trimmed;
        }
        while (trimmed.endsWith("/") && trimmed.length() > "https://".length()) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        Uri parsed = Uri.parse(trimmed);
        if (parsed.getHost() == null || parsed.getHost().trim().isEmpty()) {
            return null;
        }
        return trimmed;
    }

    private String sanitizeUrlForDisplay(Uri uri) {
        if (uri == null) {
            return "";
        }
        String scheme = uri.getScheme();
        String authority = uri.getAuthority();
        String path = uri.getPath();
        if (scheme == null || authority == null) {
            return uri.toString();
        }
        return scheme + "://" + authority + (path != null ? path : "");
    }

    private void showServerUrlDialog() {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(getConfiguredServerUrl());
        input.setSelection(input.getText().length());

        new AlertDialog.Builder(this)
                .setTitle("ECHO Server URL")
                .setMessage("Enter the HTTPS or local URL where your ECHO server is running.")
                .setView(input)
                .setPositiveButton("Connect", (dialog, which) -> {
                    String normalized = normalizeServerUrl(input.getText().toString());
                    if (normalized == null) {
                        Toast.makeText(this, "Enter a valid http:// or https:// server URL.", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .putString(KEY_SERVER_URL, normalized)
                            .apply();
                    loadConfiguredServer(true);
                })
                .setNeutralButton("Reset Default", (dialog, which) -> {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .remove(KEY_SERVER_URL)
                            .apply();
                    loadConfiguredServer(true);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            // Ignore if no browser handler is available
        }
    }

    public class EchoBridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> loadConfiguredServer(true));
        }

        @JavascriptInterface
        public void configureServer() {
            runOnUiThread(MainActivity.this::showServerUrlDialog);
        }

        @JavascriptInterface
        public void useOfflineMode() {
            runOnUiThread(() -> {
                if (hasBundledWebApp()) {
                    loadLocalStandaloneApp();
                } else {
                    Toast.makeText(MainActivity.this, "On-device bundle is not included in this build.", Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public boolean hasBundledApp() {
            return hasBundledWebApp();
        }

        @JavascriptInterface
        public boolean isStandaloneMode() {
            return standaloneActive;
        }

        @JavascriptInterface
        public String getServerUrl() {
            return sanitizeUrlForDisplay(Uri.parse(getConfiguredServerUrl()));
        }

        @JavascriptInterface
        public String getLastErrorJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("title", lastErrorTitle);
                obj.put("detail", lastErrorDetail);
                obj.put("url", lastErrorUrl);
                obj.put("statusCode", lastErrorStatus);
            } catch (JSONException ignored) {
                // Keep empty JSON object fallback
            }
            return obj.toString();
        }
    }
}
