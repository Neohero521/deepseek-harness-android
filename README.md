# DeepSeek Harness Android

An Android-native port of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(`dsh`) — an "everything is a plugin" coding-agent runtime — that runs the agent
**on the phone itself**.

```
Model (your API key)  +  Harness (tools, approval, workspace)  =  Agent
```

The app embeds a real Node.js runtime (nodejs-mobile, libnode v18.20.4) inside a
Kotlin / Jetpack Compose shell. The agent loop, tool plugins and the local
bridge live in `node-host/`; the native UI talks to them over a local
HTTP/JSON bridge on `127.0.0.1:37777`.

> **Status: developer preview.** This is an independent community port, not an
> official DeepSeek product. It implements a focused subset of the harness
> (agent loop + plugin tools + approval flow); the full dsh feature set
> (Web UI, MCP, skill ecosystem, checkpoints, desktop) is on the roadmap.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Kotlin / Jetpack Compose UI                                │
│  chat · tool-approval cards · settings · runtime status      │
└───────────────▲───────────────────────────┬─────────────────┘
                │ HTTP/JSON bridge          │
                │ (127.0.0.1:37777)         │
┌───────────────┴───────────────────────────▼─────────────────┐
│  Node.js agent host (nodejs-mobile, libnode.so v18.20.4)    │
│  ┌───────────┐  ┌───────────┐  ┌──────────────────────────┐ │
│  │ agent.js  │  │ bridge.js │  │ tools/  (plugin registry) │ │
│  │ loop      │  │ RPC+events│  │  fs · shell · web         │ │
│  └───────────┘  └───────────┘  └──────────────────────────┘ │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
        DeepSeek / OpenAI-            workspace (app files dir)
        compatible API                + device shell (toybox)
```

Key decisions (borrowed from the AndroPI playbook of shipping Node.js on Android):

- **Node runtime**: [nodejs-mobile](https://nodejs-mobile.github.io/) prebuilt
  `libnode.so` is linked via CMake and packaged through `jniLibs`, so Android
  treats it as a native library. No root, no Termux dependency.
- **Bridge**: fixed port + long-polling `/events` + `POST /rpc`, JSON only.
  The Node host and the Kotlin UI are two processes sharing a contract —
  exactly how dsh separates host and client faces.
- **Approval**: every tool call is gated by a user approval card unless the
  setting is switched to `auto` (mirrors dsh's human-in-the-loop design).
- **Confinement**: all fs tools resolve paths inside the workspace and reject
  anything that escapes it (`../` etc).

---

## Repository layout

```
deepseek-harness-android/
├── app/                          # Android application module
│   ├── CMakeLists.txt            # links libnode.so, builds native-lib.cpp
│   ├── libnode/                  # nodejs-mobile artifacts (fetch script)
│   │   ├── include/node/         #   libnode headers
│   │   └── bin/<abi>/libnode.so  #   prebuilt runtime per ABI
│   └── src/main/
│       ├── assets/nodejs-project # the packaged Node host (build script)
│       ├── cpp/native-lib.cpp    # JNI: starts Node.js with argv
│       └── java/com/dsh/android/ # Kotlin shell + Compose UI
├── node-host/                    # the in-app Node.js agent host (source)
│   ├── src/                      # agent loop, bridge, tools (plugins)
│   └── test/                     # runnable on desktop Node
└── scripts/
    ├── fetch-nodejs-mobile.mjs   # download libnode.so + headers
    └── build-node-host.mjs       # package node-host -> app assets
```

## Building

Prerequisites:

- **JDK 17+**
- **Android Studio** (or Android SDK + NDK r24+ / CMake) — required to build
  the APK, because the app links the NDK toolchain and `libnode.so`
- **Node.js 18+** (only needed for the two setup scripts and tests)
- Network access to `github.com` and `api.deepseek.com`

Setup:

```sh
# 1. Fetch the prebuilt Node.js runtime for Android (~30 MB)
node scripts/fetch-nodejs-mobile.mjs

# 2. Package the Node host into app assets
node scripts/build-node-host.mjs

# 3. (only when the binary wrapper jar is missing — it is not stored in git)
node scripts/fetch-gradle-wrapper.mjs

# 4. Open the project in Android Studio, sync, and Run ▶
#    (or, from the CLI: ./gradlew :app:assembleDebug)
```

First launch: the app asks for your API key (DeepSeek or any OpenAI-compatible
endpoint), then you can chat with the agent and watch it use tools.

### Node host tests (run on your computer, no Android needed)

```sh
cd node-host
npm test        # mock LLM server + real agent loop + approval flows
```

## Mapping to upstream dsh

The upstream monorepo (`packages/*`) is desktop/server-oriented; this port maps
its concepts onto the phone:

| Upstream dsh concept | Upstream package | This port |
|----------------------|------------------|-----------|
| Agent loop (model + tools) | `packages/core`, `packages/workflow` | `node-host/src/agent.js` |
| Tool plugins ("everything is a plugin") | `packages/tool`, `packages/fs`, `packages/shell` | `node-host/src/tools/*` (registry + fs/shell/web) |
| Human-in-the-loop approval | `packages/interaction`, `packages/guard` | approval cards via bridge `tool.approve` |
| Host–client communication | `packages/host`, `packages/client`, `packages/web` | local HTTP bridge (`bridge.js` ↔ `HarnessClient.kt`) |
| Runtime / environment | `native/system`, sandboxes | nodejs-mobile `libnode.so` + Android app sandbox |
| Configuration | `packages/settings`, `packages/credentials` | `SettingsStore.kt` (DataStore) |

The full upstream surface (Web UI, MCP, skills, checkpoints, sessions) is
roadmap material — see [Current capabilities](#current-capabilities).

## Current capabilities

| Area        | Status |
|-------------|--------|
| Chat with streaming replies | ✅ |
| Tool calls: `fs.list_dir` / `fs.read_file` / `fs.write_file` / `fs.delete_file` | ✅ |
| Tool calls: `shell.run` (device shell, toybox) | ✅ |
| Tool calls: `web.fetch` | ✅ |
| **MCP plugin protocol** (stdio + streamable HTTP, tools become `mcp.<server>.<tool>`) | ✅ |
| Approval cards (manual) / auto-approve mode | ✅ |
| DeepSeek API + any OpenAI-compatible endpoint | ✅ |
| Workspace confinement (no path escape) | ✅ |
| Foreground service keeping the agent alive | ✅ |
| Web UI (dsh's browser client) | 🚧 roadmap |
| Skills / checkpoints (beyond MCP) | 🚧 roadmap |

## MCP (Model Context Protocol) support

The agent is an MCP **client**: configure one or more MCP servers in Settings and
their tools become callable by the model as `mcp.<server>.<tool>`.

- **stdio transport**: local process — `command` (e.g. `npx -y @some/mcp-server`) plus space-separated `args`
- **streamable HTTP transport**: remote endpoint — just `url`
- Each server is isolated: a failing server is reported in `mcp.status` and
  never blocks the others
- Zero-dependency JSON-RPC client (`node-host/src/mcp/index.js`), MCP
  protocol `2025-03-26`, compatible with servers built on the official
  `@modelcontextprotocol/sdk`

Test: `cd node-host && node test/mcp.test.js` (spins up a mock MCP server and
drives a full agent loop calling `mcp.mock.echo`).

## Security notes

- Tool calls are **approved by you** by default; `auto` mode exists for
  trusted, repetitive flows — use with care.
- The agent's filesystem access is confined to its workspace directory.
- `shell.run` runs in the app sandbox (limited toybox command set); Android
  does not give it system privileges.
- Your API key is stored in app-private storage (`DataStore`) and is only sent
  to the endpoint you configured.

## License

MIT — see [LICENSE](LICENSE). The embedded Node.js runtime is distributed
under its own license (see nodejs-mobile upstream). DeepSeek Harness is MIT,
copyright DeepSeek-AI; this port is not affiliated with or endorsed by DeepSeek.
