package com.dsh.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.dsh.android.agent.AgentViewModel
import com.dsh.android.data.HarnessSettings
import com.dsh.android.data.McpServerConfig

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: AgentViewModel, onBack: () -> Unit) {
    val current by vm.settings.collectAsState()
    val mcpStatus by vm.mcpStatus.collectAsState()

    var apiKey by remember { mutableStateOf(current.apiKey) }
    var baseUrl by remember { mutableStateOf(current.baseUrl) }
    var model by remember { mutableStateOf(current.model) }
    var approvalMode by remember { mutableStateOf(current.approvalMode) }
    var mcpServers by remember { mutableStateOf(current.mcpServers) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("设置") },
                navigationIcon = {
                    androidx.compose.material3.IconButton(onClick = onBack) { Text("←") }
                },
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text("模型", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text("API Key") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = baseUrl,
                onValueChange = { baseUrl = it },
                label = { Text("Base URL（OpenAI 兼容）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = model,
                onValueChange = { model = it },
                label = { Text("模型名（如 deepseek-chat）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )

            Text("工具审批", style = MaterialTheme.typography.titleSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = approvalMode == "manual",
                    onClick = { approvalMode = "manual" },
                    label = { Text("每次都批准") },
                )
                FilterChip(
                    selected = approvalMode == "auto",
                    onClick = { approvalMode = "auto" },
                    label = { Text("自动执行") },
                )
            }
            Text(
                if (approvalMode == "auto") "自动模式：agent 可直接执行工具（写文件、跑命令），请谨慎使用。"
                else "手动模式：每次工具调用都会弹出批准卡片。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Text("MCP 服务器（插件协议）", style = MaterialTheme.typography.titleSmall)
            Text(
                "MCP 工具会以 mcp.<服务器>.<工具> 的形式注入 agent。本地进程填 command（+args），远程端点填 url。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            mcpServers.forEachIndexed { index, server ->
                McpServerEditor(
                    server = server,
                    onChanged = { updated -> mcpServers = mcpServers.toMutableList().apply { this[index] = updated } },
                    onRemove = { mcpServers = mcpServers.toMutableList().apply { removeAt(index) } },
                )
            }
            OutlinedButton(
                onClick = { mcpServers = mcpServers + McpServerConfig() },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("+ 添加 MCP 服务器")
            }
            if (mcpStatus.isNotEmpty()) {
                Text(
                    mcpStatus.joinToString("\n") { s ->
                        val name = s.optString("name")
                        val connected = s.optBoolean("connected")
                        val tools = s.optInt("tools")
                        "· $name — ${if (connected) "已连接（$tools 个工具）" else "连接失败"}"
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {
                    vm.saveSettings(
                        HarnessSettings(
                            apiKey = apiKey,
                            baseUrl = baseUrl,
                            model = model,
                            approvalMode = approvalMode,
                            mcpServers = mcpServers.filter { it.name.isNotBlank() },
                        ),
                    )
                    vm.refreshMcpStatusNow()
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("保存并应用")
            }

            Text(
                "运行时信息\n· Node.js 运行在应用沙箱内（libnode.so）\n· Agent 工作目录：应用私有目录/workspace\n· 工具：fs（受限工作区）、shell（toybox）、web.fetch、MCP 插件\n· API Key 只存本机，仅发往你配置的端点",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun McpServerEditor(
    server: McpServerConfig,
    onChanged: (McpServerConfig) -> Unit,
    onRemove: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedTextField(
                value = server.name,
                onValueChange = { onChanged(server.copy(name = it)) },
                label = { Text("名称（agent 用 mcp.名称.工具 调用）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = server.command,
                onValueChange = { onChanged(server.copy(command = it)) },
                label = { Text("本地命令（如 npx -y @some/mcp-server）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = server.args,
                onValueChange = { onChanged(server.copy(args = it)) },
                label = { Text("参数（空格分隔，可选）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = server.url,
                onValueChange = { onChanged(server.copy(url = it)) },
                label = { Text("或远程端点 URL（可选，与命令二选一）") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedButton(onClick = onRemove) { Text("删除此服务器") }
        }
    }
}
