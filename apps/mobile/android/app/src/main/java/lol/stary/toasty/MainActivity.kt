package lol.stary.toasty

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

/**
 * Native shell around the Toasty web vault. The web bundle is shipped in the
 * APK's assets and served through WebViewAssetLoader, so the app UI is exactly
 * the website. Assets are served over an https-style URL because WebView
 * blocks ES-module scripts on file:// URLs (CORS) — loading the bundle from
 * file:// renders a blank page. API calls go to the self-hosted server the
 * user enters on first launch.
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

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }
        webView.addJavascriptInterface(Bridge(), "ToastyBridge")
        webView.loadUrl("https://appassets.androidplatform.net/assets/public/index.html")
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
