package com.dsh.android.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.dsh.android.agent.AgentViewModel
import com.dsh.android.model.RuntimeStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(vm: AgentViewModel, onOpenSettings: () -> Unit) {
    val messages by vm.messages.collectAsState()
    val status by vm.runtimeStatus.collectAsState()
    val sending by vm.sending.collectAsState()
    val listState = rememberLazyListState()
    var input by remember { mutableStateOf("") }

    // Auto-scroll to the newest message.
    LaunchedEffect(messages.size, messages.lastOrNull()?.let { (it as? com.dsh.android.model.ChatItem.Assistant)?.text }) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.lastIndex)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("DeepSeek Harness", style = MaterialTheme.typography.titleMedium)
                        Text(
                            when (status) {
                                RuntimeStatus.RUNNING -> "运行时在线"
                                RuntimeStatus.ERROR -> "运行时错误"
                                RuntimeStatus.STARTING -> "正在启动运行时…"
                            },
                            style = MaterialTheme.typography.labelSmall,
                            color = when (status) {
                                RuntimeStatus.RUNNING -> MaterialTheme.colorScheme.primary
                                RuntimeStatus.ERROR -> MaterialTheme.colorScheme.error
                                RuntimeStatus.STARTING -> MaterialTheme.colorScheme.onSurfaceVariant
                            },
                        )
                    }
                },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Text("设置", style = MaterialTheme.typography.labelLarge)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .imePadding(),
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp),
            ) {
                if (messages.isEmpty()) {
                    item { EmptyHint() }
                } else {
                    items(messages, key = { it.id }) { item ->
                        ChatItemView(item, onApprove = vm::approveTool)
                    }
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { input = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("让 agent 干活…") },
                    maxLines = 4,
                    enabled = status == RuntimeStatus.RUNNING && !sending,
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        vm.sendMessage(input)
                        input = ""
                    },
                    enabled = input.isNotBlank() && status == RuntimeStatus.RUNNING && !sending,
                ) {
                    Text("发送", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

@Composable
private fun EmptyHint() {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = 120.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Agent = 模型 + Harness", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "在手机上运行 deepseek-harness：\n对话、写文件、跑命令、取网页，工具调用需要你批准。",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
