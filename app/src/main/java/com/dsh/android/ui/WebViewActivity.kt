package com.dsh.android.ui

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import com.dsh.android.node.NodeRuntime

/**
 * In-app Web UI (the light page served by the Node host at `/`).
 *
 * Papers surveyed (see node-host/README-WEB.md) agree that a WebView should
 * only be the presentation layer; all agent logic stays in the native shell +
 * Node host, so this activity is deliberately thin.
 */
class WebViewActivity : ComponentActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.setBackgroundColor(Color.parseColor("#0e1116"))
        web.webViewClient = WebViewClient()
        setContentView(web)
        web.loadUrl("http://127.0.0.1:${NodeRuntime.BRIDGE_PORT}")
    }

    override fun onDestroy() {
        super.onDestroy()
        (findViewById<WebView?>(android.R.id.content) as? WebView)?.destroy()
    }
}
