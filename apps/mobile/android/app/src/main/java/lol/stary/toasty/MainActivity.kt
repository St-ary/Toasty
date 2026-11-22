package lol.stary.toasty

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Native shell around the Toasty web vault. The web bundle is shipped in the
 * APK's assets and loaded locally, so the app UI is exactly the website; API
 * calls go to the self-hosted server the user enters on first launch.
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = WebViewClient()
        webView.addJavascriptInterface(Bridge(), "ToastyBridge")
        webView.loadUrl("file:///android_asset/public/index.html")
    }

    override fun onBackPressed() {
        if (this::webView.isInitialized && webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun save(items: String) {
            VaultCache.save(applicationContext, items)
        }

        @JavascriptInterface
        fun clear() {
            VaultCache.clear(applicationContext)
        }
    }
}
