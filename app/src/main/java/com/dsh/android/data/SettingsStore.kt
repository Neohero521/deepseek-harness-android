package com.dsh.android.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "dsh_settings")

/** App settings persisted in app-private storage. */
data class HarnessSettings(
    val apiKey: String = "",
    val baseUrl: String = "https://api.deepseek.com/v1",
    val model: String = "deepseek-chat",
    val approvalMode: String = "manual", // manual | auto
) {
    val isConfigured: Boolean get() = apiKey.isNotBlank()
}

class SettingsStore(private val context: Context) {

    private object Keys {
        val API_KEY = stringPreferencesKey("api_key")
        val BASE_URL = stringPreferencesKey("base_url")
        val MODEL = stringPreferencesKey("model")
        val APPROVAL_MODE = stringPreferencesKey("approval_mode")
    }

    val settings: Flow<HarnessSettings> = context.dataStore.data.map { prefs ->
        HarnessSettings(
            apiKey = prefs[Keys.API_KEY] ?: "",
            baseUrl = prefs[Keys.BASE_URL] ?: "https://api.deepseek.com/v1",
            model = prefs[Keys.MODEL] ?: "deepseek-chat",
            approvalMode = prefs[Keys.APPROVAL_MODE] ?: "manual",
        )
    }

    suspend fun save(new: HarnessSettings) {
        context.dataStore.edit { prefs ->
            prefs[Keys.API_KEY] = new.apiKey.trim()
            prefs[Keys.BASE_URL] = new.baseUrl.trim().ifEmpty { "https://api.deepseek.com/v1" }
            prefs[Keys.MODEL] = new.model.trim().ifEmpty { "deepseek-chat" }
            prefs[Keys.APPROVAL_MODE] = if (new.approvalMode == "auto") "auto" else "manual"
        }
    }
}
