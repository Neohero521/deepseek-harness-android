package com.dsh.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.dsh.android.model.ChatItem

/** Bubble for a user message. */
@Composable
fun UserBubble(text: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        Box(
            modifier = Modifier
                .widthIn(max = 300.dp)
                .background(
                    MaterialTheme.colorScheme.primary.copy(alpha = 0.22f),
                    RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(text, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

/** Bubble for an assistant (streaming or final) message. */
@Composable
fun AssistantBubble(text: String, streaming: Boolean) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Start) {
        Box(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(
                    MaterialTheme.colorScheme.surfaceVariant,
                    RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyLarge,
                )
                if (streaming) {
                    Spacer(Modifier.width(6.dp))
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        strokeWidth = 2.dp,
                    )
                }
            }
        }
    }
}

/** Card showing a tool call with approve / reject actions. */
@Composable
fun ToolCallCard(call: ChatItem.ToolCall, onApprove: (String, Boolean) -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "🛠 ${call.tool}",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.weight(1f),
                )
                StatusTag(call.status)
            }
            Text(
                call.args,
                style = MaterialTheme.typography.bodySmall,
                fontFamily = FontFamily.Monospace,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 8,
            )
            call.output?.takeIf { it.isNotBlank() }?.let { output ->
                Text(
                    output,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = FontFamily.Monospace,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 6,
                )
            }
            if (call.status == ChatItem.ToolCall.Status.PENDING) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                ) {
                    OutlinedButton(onClick = { onApprove(call.callId, false) }) {
                        Text("拒绝")
                    }
                    Button(onClick = { onApprove(call.callId, true) }) {
                        Text("批准执行")
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusTag(status: ChatItem.ToolCall.Status) {
    val (label, color) = when (status) {
        ChatItem.ToolCall.Status.PENDING -> "待批准" to MaterialTheme.colorScheme.tertiary
        ChatItem.ToolCall.Status.RUNNING -> "执行中" to MaterialTheme.colorScheme.secondary
        ChatItem.ToolCall.Status.DONE -> "已完成" to MaterialTheme.colorScheme.primary
        ChatItem.ToolCall.Status.REJECTED -> "已拒绝" to MaterialTheme.colorScheme.error
        ChatItem.ToolCall.Status.FAILED -> "失败" to MaterialTheme.colorScheme.error
    }
    Text(label, style = MaterialTheme.typography.labelSmall, color = color)
}

/** Small centered system-status line. */
@Composable
fun SystemLine(text: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Text(
            text,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(vertical = 4.dp),
        )
    }
}

/** Single chat item dispatcher. */
@Composable
fun ChatItemView(item: ChatItem, onApprove: (String, Boolean) -> Unit) {
    Column(Modifier.padding(vertical = 4.dp)) {
        when (item) {
            is ChatItem.User -> UserBubble(item.text)
            is ChatItem.Assistant -> AssistantBubble(item.text, item.streaming)
            is ChatItem.ToolCall -> ToolCallCard(item, onApprove)
            is ChatItem.System -> SystemLine(item.text)
        }
    }
}
