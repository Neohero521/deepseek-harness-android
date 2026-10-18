package com.dsh.android.agent

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.dsh.android.data.HarnessSettings
import com.dsh.android.data.SettingsStore
import com.dsh.android.model.ChatItem
import com.dsh.android.model.RuntimeStatus
import com.dsh.android.node.HarnessClient
import com.dsh.android.node.NodeRuntime
import com.dsh.android.node.NodeService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong

class AgentViewModel(application: Application) : AndroidViewModel(application) {

    private val settingsStore = SettingsStore(application)
    private val client = HarnessClient()

    private val idSeq = AtomicLong(0)

    private val _messages = MutableStateFlow<List<ChatItem>>(emptyList())
    val messages: StateFlow<List<ChatItem>> = _messages.asStateFlow()

    private val _runtimeStatus = MutableStateFlow(RuntimeStatus.STARTING)
    val runtimeStatus: StateFlow<RuntimeStatus> = _runtimeStatus.asStateFlow()

    private val _settings = MutableStateFlow(HarnessSettings())
    val settings: StateFlow<HarnessSettings> = _settings.asStateFlow()

    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()

    private val _runtimeError = MutableStateFlow<String?>(null)
    val runtimeError: StateFlow<String?> = _runtimeError.asStateFlow()

    private val _mcpStatus = MutableStateFlow<List<JSONObject>>(emptyList())
    val mcpStatus: StateFlow<List<JSONObject>> = _mcpStatus.asStateFlow()

    private var eventLoopJob: Job? = null
    private var healthJob: Job? = null
    private var runtimeStarted = false

    init {
        // Surface a crash report left by a previous native crash (if any)
        // before NodeRuntime.start() clears it.
        NodeRuntime.readCrashReport(application)?.let { report ->
            _messages.value = listOf(
                ChatItem.System(idSeq.incrementAndGet(), "上次启动发生原生崩溃，日志如下（可复制发我）：\n$report"),
            )
        }

        viewModelScope.launch {
            settingsStore.settings.collect { loaded ->
                _settings.value = loaded
                ensureRuntime(loaded)
                pushConfig(loaded)
            }
        }
        eventLoopJob = viewModelScope.launch(Dispatchers.IO) {
            client.runEventLoop(this) { ev -> onEvent(ev) }
        }
        healthJob = viewModelScope.launch {
            while (isActive) {
                val ok = client.ping()
                _runtimeError.value = NodeRuntime.lastError
                _runtimeStatus.value = if (ok) RuntimeStatus.RUNNING else RuntimeStatus.STARTING
                if (ok) break
                delay(1_500)
            }
        }
        NodeService.start(application)
    }

    /** Starts the Node runtime exactly once, with the stored API key. */
    private fun ensureRuntime(settings: HarnessSettings) {
        if (runtimeStarted) return
        runtimeStarted = true
        NodeRuntime.start(getApplication(), settings.apiKey.ifBlank { null })
    }

    /** Push the stored config into the running Node host (idempotent, non-blocking). */
    private fun pushConfig(settings: HarnessSettings) {
        viewModelScope.launch {
            delay(1_000) // let the Node host come up first
            repeat(10) {
                if (client.ping()) {
                    client.rpc(
                        "config.set",
                        JSONObject()
                            .put("apiKey", settings.apiKey)
                            .put("baseUrl", settings.baseUrl)
                            .put("model", settings.model)
                            .put("approvalMode", settings.approvalMode),
                    )
                    client.rpc(
                        "mcp.configure",
                        JSONObject().put("servers", settings.mcpServerParams()),
                    )
                    refreshMcpStatus()
                    return@launch
                }
                delay(1_500)
            }
        }
    }

    /** Query MCP server connection state for the settings screen. */
    private fun refreshMcpStatus() {
        viewModelScope.launch {
            val resp = client.rpc("mcp.status", JSONObject())
            if (!resp.optBoolean("ok", false)) return@launch
            val servers = resp.optJSONObject("result")?.optJSONArray("servers") ?: return@launch
            _mcpStatus.value = (0 until servers.length()).map { servers.getJSONObject(it) }
        }
    }

    fun refreshMcpStatusNow() = refreshMcpStatus()

    fun sendMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || _sending.value) return
        viewModelScope.launch {
            _messages.update { it + ChatItem.User(idSeq.incrementAndGet(), trimmed) }
            _sending.value = true
            try {
                val resp = client.rpc("chat.send", JSONObject().put("text", trimmed))
                if (!resp.optBoolean("ok", false)) {
                    val err = resp.optString("error", "unknown error")
                    _messages.update { it + ChatItem.System(idSeq.incrementAndGet(), "发送失败：$err") }
                }
            } catch (t: Throwable) {
                _messages.update { it + ChatItem.System(idSeq.incrementAndGet(), "无法连接本地运行时：${t.message}") }
            } finally {
                _sending.value = false
            }
        }
    }

    fun approveTool(callId: String, approved: Boolean) {
        viewModelScope.launch {
            client.rpc("tool.approve", JSONObject().put("callId", callId).put("approved", approved))
            if (!approved) {
                _messages.update { list ->
                    list.map {
                        if (it is ChatItem.ToolCall && it.callId == callId) {
                            it.copy(status = ChatItem.ToolCall.Status.REJECTED)
                        } else it
                    }
                }
            }
        }
    }

    fun resetSession() {
        viewModelScope.launch {
            client.rpc("session.reset")
            _messages.value = emptyList()
        }
    }

    private fun onEvent(ev: JSONObject) {
        val type = ev.optString("type")
        when (type) {
            "agent.started" -> {
                _messages.update { it + ChatItem.System(idSeq.incrementAndGet(), "Agent 开始执行任务") }
            }
            "message.delta" -> {
                val chunk = ev.optString("text")
                _messages.update { list ->
                    val last = list.lastOrNull()
                    if (last is ChatItem.Assistant && last.streaming) {
                        list.dropLast(1) + last.copy(text = last.text + chunk)
                    } else {
                        list + ChatItem.Assistant(idSeq.incrementAndGet(), chunk, streaming = true)
                    }
                }
            }
            "message.done" -> {
                val full = ev.optString("text")
                _messages.update { list ->
                    val last = list.lastOrNull()
                    if (last is ChatItem.Assistant && last.streaming) {
                        list.dropLast(1) + last.copy(text = full, streaming = false)
                    } else if (full.isNotBlank()) {
                        list + ChatItem.Assistant(idSeq.incrementAndGet(), full, streaming = false)
                    } else {
                        list
                    }
                }
            }
            "tool.call" -> {
                val call = ChatItem.ToolCall(
                    id = idSeq.incrementAndGet(),
                    callId = ev.optString("callId"),
                    tool = ev.optString("tool"),
                    args = ev.optJSONObject("args")?.toString(2) ?: ev.optString("args"),
                    status = ChatItem.ToolCall.Status.PENDING,
                )
                _messages.update { it + call }
            }
            "tool.result" -> {
                val callId = ev.optString("callId")
                val ok = ev.optBoolean("ok")
                val output = ev.optString("output")
                _messages.update { list ->
                    list.map {
                        if (it is ChatItem.ToolCall && it.callId == callId) {
                            it.copy(
                                status = if (ok) ChatItem.ToolCall.Status.DONE else ChatItem.ToolCall.Status.FAILED,
                                output = output,
                            )
                        } else it
                    }
                }
            }
            "agent.finished" -> {
                _messages.update { it + ChatItem.System(idSeq.incrementAndGet(), "任务完成") }
            }
            "error" -> {
                _messages.update { it + ChatItem.System(idSeq.incrementAndGet(), "运行时错误：${ev.optString("message")}") }
            }
        }
    }

    /** Called from the settings screen when the user saves new config. */
    fun saveSettings(new: HarnessSettings) {
        viewModelScope.launch {
            settingsStore.save(new)
            _settings.value = new
            pushConfig(new)
        }
    }
}
