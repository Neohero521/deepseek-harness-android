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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: AgentViewModel, onBack: () -> Unit) {
    val current by vm.settings.collectAsState()

    var apiKey by remember { mutableStateOf(current.apiKey) }
    var baseUrl by remember { mutableStateOf(current.baseUrl) }
    var model by remember { mutableStateOf(current.model) }
    var approvalMode by remember { mutableStateOf(current.approvalMode) }

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

            Spacer(Modifier.height(4.dp))
            Button(
                onClick = {
                    vm.saveSettings(
                        HarnessSettings(
                            apiKey = apiKey,
                            baseUrl = baseUrl,
                            model = model,
                            approvalMode = approvalMode,
                        ),
                    )
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("保存并应用")
            }

            Text(
                "运行时信息\n· Node.js 运行在应用沙箱内（libnode.so）\n· Agent 工作目录：应用私有目录/workspace\n· 工具：fs（受限工作区）、shell（toybox）、web.fetch\n· API Key 只存本机，仅发往你配置的端点",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
