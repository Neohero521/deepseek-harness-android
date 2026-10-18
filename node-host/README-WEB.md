# Web UI：论文调研结论与实现说明

> 目标：把 deepseek-harness 的「对话/工具批准」界面也放进 App。
> 结论：**不硬塞官方 Web 前端**，改为 Node host 直接提供轻量 Web 对话页面，
> WebView/浏览器访问，计算全部留在原生壳 + Node host。依据见下文。

## 一、论文检索结论（2026-10 检索，scholar 收录）

### 1. 混合应用（WebView）性能研究 —— 一致结论：WebView 只该做呈现层

| 论文 | 结论要点 |
|---|---|
| Kaczmarczyk et al., *Performance Comparison of Native and Hybrid Android Mobile Applications* (MDPI Energies 15(13):4574, 2022) | BLE/Wi-Fi 传感器数据场景下，Ionic 混合应用与原生（Java 8）应用的数据处理效率存在可测差距；高频/计算密集路径应走原生 |
| Corral, Sillitti & Succi, *Mobile multiplatform development: an experiment for performance analysis* (MobiWIS, Procedia CS) | 用实验测出 PhoneGap Web 应用相对等价原生应用的执行时间开销；交互密集路径在 WebView 里有明确性能税 |
| Dela et al., *Approaches to Mobile Application Development: Comparative Performance Analysis* (Computing Conference 2017) | Android/iOS 双端对比：Web 方案非功能质量（性能）系统性弱于原生 |
| Temirova, *Comparative analysis of frameworks for mobile application development* (Herald of DSTU) | 原生性能最高；混合方案开发快但受 WebView 显示与设备能力访问限制 |
| Rösler, *Evaluation of Cross-Platform Development Practices*（学士论文，IBM） | Web 技术带来若干产品质量问题（启动、内存、交互延迟） |
| Kortstra, *Java(Script) Application Performance on Android* (Univ. of Twente) | 反方证据：JS 应用并不比 Java 应用差太多；WebView 作为**辅助视图**完全够用 |

**推论**：把 Web 界面限定为「呈现层」（聊天气泡、工具批准按钮、配置表单），
agent 执行、文件系统、HTTP、MCP 工具调用全部留在 Node host / 原生层 —— 与上述
全部论文的结论一致。我们正是这样分层：`webui.js` 页面只做 `fetch /rpc` + 轮询 `/events`。

### 2. 安卓上跑完整 Linux/Node 用户态 —— 有直接先例

- **FlyOS: Integrating Full Linux Environments into Android Devices** (TechRxiv, 2025)：
  在**未修改、未 root** 的安卓设备上用 chroot 容器跑完整 Linux，并通过**统一 Web 仪表盘**
  管理容器生命周期、桌面会话（noVNC）、终端等。验证了「Android 内嵌本地 Web 服务 +
  WebView/浏览器管理」这一整体形态的可行性，且测得近原生性能、开销极小。
- Gomes et al., *Enabling rootless Linux Containers: the udocker tool* (arXiv:1711.01758)：
  无特权用户态容器方案（与 proot 同类），说明 rootless 用户态运行环境是成熟工程手段。
- Priedhorsky et al., *Zero-consistency root emulation for unprivileged container image build*
  (arXiv:2405.06085)：seccomp 过滤实现无特权 root 模拟，包管理器类操作无需真 root。

**推论**：我们选择的路线（预编译 libnode.so 内嵌 + CMake 链接，而非 proot 整机 Linux）
是上述方向里**最轻、最稳**的变体 —— 不引入容器、不需要用户态模拟层。

### 3. 端侧 agent 是主流趋势

- Wang et al., *Adaptive AI Agent Placement and Migration in Edge Intelligence Systems*
  (arXiv:2508.03345)：LLM agent 部署在端侧/边缘显著降低延迟；agent 迁移只需转移
  memory/配置而非整份代码 —— 支持「本地真跑 agent」的产品形态。
- Wang, Li & Jia, *Cognitive Edge Computing: A Comprehensive Survey* (arXiv:2501.03265)：
  端侧推理 + agentic tool use + 弹性卸载是共识方向，隐私是端侧的主要收益。
- Laskaridis et al., *Mobile and Edge Evaluation of LLMs (MELT)* (ES-FoMo @ ICML 2024)：
  端侧 LLM 执行与基准测量基础设施成熟；Agent 的「编排层」跑在端侧完全可行。

## 二、为什么不用官方 Web UI

deepseek-harness 官方仓库的 Web 控制台依赖较新的 Node/npm 生态（Cordis、大量 ESM
依赖树），直接塞进 libnode 内嵌运行时既增大体积又带来运行时兼容风险；而论文证据表明
Web 层只做呈现时，自研轻量页面与官方前端在交互上无本质差距。因此：

1. 保留原生 Compose 主体（消息流、工具批准、MCP 配置）——性能敏感路径原生。
2. Node host 在 bridge 上新增 `GET /` 与 `GET /web`，返回单文件 `webui.js` 页面。
3. App 内聊天页顶栏「网页」按钮 → `WebViewActivity` 加载 `http://127.0.0.1:37777`；
   同一 URL 也支持设备浏览器访问。

## 三、协议与复用

Web 页面使用与 Kotlin UI **完全相同的桥协议**，零新增服务端逻辑：

- `POST /rpc` — `chat.send` / `tool.approve` / `config.set` / `config.get` / `ping`
- `GET /events` — 长轮询事件流（`message.delta` / `message.done` / `tool.call` / `tool.result` …）

页面渲染全部用 `textContent`（无 innerHTML），工具参数用 `<pre>` 展示，避免 XSS。

## 四、本地验证

```bash
node test/webui.test.js   # 页面可返回、关键 API 存在、桥回归通过
```

Android 侧 `WebViewActivity` 是薄壳，唯一网络访问是 `127.0.0.1`（network_security_config
仅对 loopback 放行明文流量）。
