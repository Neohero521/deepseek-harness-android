package com.dsh.android.model

/** One item in the chat transcript. */
sealed interface ChatItem {
    val id: Long

    data class User(override val id: Long, val text: String) : ChatItem

    data class Assistant(
        override val id: Long,
        val text: String,
        val streaming: Boolean = false,
    ) : ChatItem

    data class ToolCall(
        override val id: Long,
        val callId: String,
        val tool: String,
        val args: String,
        val status: Status,
        val output: String? = null,
    ) : ChatItem {
        enum class Status { PENDING, RUNNING, DONE, REJECTED, FAILED }
    }

    data class System(override val id: Long, val text: String) : ChatItem
}

/** Runtime health states surfaced in the top bar. */
enum class RuntimeStatus {
    STARTING,
    RUNNING,
    ERROR,
}
