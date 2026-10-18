package com.dsh.android.node

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Minimal HTTP/JSON client for the Node agent host bridge
 * (POST /rpc + long-polling GET /events on 127.0.0.1:37777).
 *
 * Uses HttpURLConnection + org.json on purpose: zero extra dependencies.
 */
class HarnessClient(
    private val baseUrl: String = "http://${NodeRuntime.BRIDGE_HOST}:${NodeRuntime.BRIDGE_PORT}",
) {

    /** Blocking RPC call. Returns the full response envelope. */
    suspend fun rpc(method: String, params: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = (URL("$baseUrl/rpc").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 5_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            try {
                val payload = JSONObject()
                    .put("id", System.currentTimeMillis())
                    .put("method", method)
                    .put("params", params)
                conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                val code = conn.responseCode
                val stream = if (code in 200..299) conn.inputStream else conn.errorStream
                val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                val json = if (body.isBlank()) JSONObject() else JSONObject(body)
                json.put("httpCode", code)
                json
            } finally {
                conn.disconnect()
            }
        }

    /** One long-polling GET /events call; returns the batch of events. */
    private suspend fun pollEvents(): List<JSONObject> = withContext(Dispatchers.IO) {
        val conn = (URL("$baseUrl/events").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5_000
            readTimeout = 30_000
        }
        try {
            if (conn.responseCode != 200) return@withContext emptyList()
            val body = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { it.readText() }
            if (body.isBlank()) return@withContext emptyList()
            val arr = JSONArray(body)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (_: Exception) {
            emptyList()
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Infinite event loop. Runs while the scope is active and dispatches each
     * event to [onEvent]. Automatically resumes when the Node host comes up.
     */
    suspend fun runEventLoop(scope: CoroutineScope, onEvent: (JSONObject) -> Unit) {
        var consecutiveFailures = 0
        while (scope.isActive) {
            val events = try {
                pollEvents()
            } catch (t: Throwable) {
                consecutiveFailures++
                if (consecutiveFailures > 2) delay(1_000)
                emptyList()
            }
            if (events.isNotEmpty()) {
                consecutiveFailures = 0
                events.forEach(onEvent)
            }
        }
    }

    /** Quick health check; returns true when the Node host responds. */
    suspend fun ping(): Boolean = withContext(Dispatchers.IO) {
        try {
            val conn = (URL("$baseUrl/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = 2_000
                readTimeout = 2_000
            }
            try {
                conn.responseCode == 200
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            false
        }
    }
}
