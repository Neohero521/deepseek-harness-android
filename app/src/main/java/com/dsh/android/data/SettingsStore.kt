package com.dsh.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore(name = "dsh_settings")

/** One MCP server entry. Either a local process (command/args) or a remote endpoint (url). */
data class McpServerConfig(
    val name: String = "",
    val command: String = "",
    val args: String = "",
    val url: String = "",
) {
    fun toJson(): JSONObject = JSONObject()
        .put("name", name)
        .put("command", command)
        .put("args", args)
        .put("url", url)

    companion object {
        fun fromJson(obj: JSONObject): McpServerConfig = McpServerConfig(
            name = obj.optString("name"),
            command = obj.optString("command"),
            args = obj.optString("args"),
            url = obj.optString("url"),
        )
    }
}

/** App settings persisted in app-private storage. */
data class HarnessSettings(
    val apiKey: String = "",
    val baseUrl: String = "https://api.deepseek.com/v1",
    val model: String = "deepseek-chat",
    val approvalMode: String = "manual", // manual | auto
    val mcpServers: List<McpServerConfig> = emptyList(),
) {
    val isConfigured: Boolean get() = apiKey.isNotBlank()

    /** Convert to the bridge's `mcp.configure` params shape. */
    fun mcpServerParams(): JSONArray = JSONArray().apply {
        mcpServers.forEach { server ->
            put(
                JSONObject()
                    .put("name", server.name)
                    .put("command", server.command)
                    .put("args", server.args.split(Regex("\\s+")).filter { it.isNotBlank() })
                    .put("url", server.url),
            )
        }
    }
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val API_KEY = stringPreferencesKey("api_key")
        val BASE_URL = stringPreferencesKey("base_url")
        val MODEL = stringPreferencesKey("model")
        val APPROVAL_MODE = stringPreferencesKey("approval_mode")
        val MCP_SERVERS = stringPreferencesKey("mcp_servers")
    }

    val settings: Flow<HarnessSettings> = context.dataStore.data.map { prefs ->
        HarnessSettings(
            apiKey = prefs[Keys.API_KEY] ?: "",
            baseUrl = prefs[Keys.BASE_URL] ?: "https://api.deepseek.com/v1",
            model = prefs[Keys.MODEL] ?: "deepseek-chat",
            approvalMode = prefs[Keys.APPROVAL_MODE] ?: "manual",
            mcpServers = parseMcpServers(prefs[Keys.MCP_SERVERS]),
        )
    }

    private fun parseMcpServers(raw: String?): List<McpServerConfig> {
        if (raw.isNullOrBlank()) return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { McpServerConfig.fromJson(arr.getJSONObject(it)) }
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun save(new: HarnessSettings) {
        context.dataStore.edit { prefs ->
            prefs[Keys.API_KEY] = new.apiKey.trim()
            prefs[Keys.BASE_URL] = new.baseUrl.trim().ifEmpty { "https://api.deepseek.com/v1" }
            prefs[Keys.MODEL] = new.model.trim().ifEmpty { "deepseek-chat" }
            prefs[Keys.APPROVAL_MODE] = if (new.approvalMode == "auto") "auto" else "manual"
            prefs[Keys.MCP_SERVERS] = JSONArray().apply {
                new.mcpServers.forEach { put(it.toJson()) }
            }.toString()
        }
    }
}
