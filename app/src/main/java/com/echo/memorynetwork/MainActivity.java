package com.echo.memorynetwork;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "echo_android_prefs";
    private static final String KEY_SERVER_URL = "server_url";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private PermissionRequest pendingWebPermission;
    private String pendingGeoOrigin;
    private GeolocationPermissions.Callback pendingGeoCallback;

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

        webView = new WebView(this);
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setGeolocationEnabled(true);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.addJavascriptInterface(new EchoBridge(), "EchoAndroid");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                String scheme = target.getScheme();
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
                if (request.isForMainFrame()) {
                    view.loadUrl("file:///android_asset/offline.html");
                }
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
            webView.loadUrl(getConfiguredServerUrl());
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

    private String getConfiguredServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String saved = prefs.getString(KEY_SERVER_URL, null);
        if (saved == null || saved.trim().isEmpty()) {
            return getString(R.string.default_server_url);
        }
        return saved.trim();
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
                    String entered = input.getText().toString().trim();
                    if (!entered.isEmpty()) {
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                                .edit()
                                .putString(KEY_SERVER_URL, entered)
                                .apply();
                        webView.loadUrl(entered);
                    }
                })
                .setNeutralButton("Reset Default", (dialog, which) -> {
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                            .edit()
                            .remove(KEY_SERVER_URL)
                            .apply();
                    webView.loadUrl(getString(R.string.default_server_url));
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
            runOnUiThread(() -> webView.loadUrl(getConfiguredServerUrl()));
        }

        @JavascriptInterface
        public void configureServer() {
            runOnUiThread(MainActivity.this::showServerUrlDialog);
        }
    }
}
