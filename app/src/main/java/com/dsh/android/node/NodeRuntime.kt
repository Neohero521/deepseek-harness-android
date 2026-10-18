package com.dsh.android.node

import android.content.Context
import android.util.Log
import java.io.File

/**
 * Owns the embedded Node.js runtime (libnode.so).
 *
 * Node.js is started exactly once per process with argv-based config
 * (Android cannot inject environment variables into the app process):
 *
 *   node <filesDir>/nodejs-project/main.js
 *        --workdir <filesDir>/workspace
 *        --port 37777
 *        --api-key <key>
 */
object NodeRuntime {
    private const val TAG = "DSH.Node"

    const val BRIDGE_PORT = 37777
    const val BRIDGE_HOST = "127.0.0.1"

    // Starts the Node.js runtime and blocks until it exits.
    private external fun startNodeWithArguments(arguments: Array<String>): Int

    init {
        System.loadLibrary("native-lib")
        System.loadLibrary("node")
    }

    @Volatile
    private var started = false

    @Volatile
    var lastError: String? = null
        private set

    fun isRunning(): Boolean = started

    /** Start Node.js on a background thread (idempotent). */
    fun start(context: Context, apiKey: String?) {
        if (started) return
        synchronized(this) {
            if (started) return
            started = true
        }

        Thread({
            try {
                val nodeDir = AssetUtils.ensureNodeHost(context)
                val workspace = File(context.filesDir, "workspace")
                workspace.mkdirs()

                val args = buildList {
                    add("node")
                    add(File(nodeDir, "main.js").absolutePath)
                    add("--workdir")
                    add(workspace.absolutePath)
                    add("--port")
                    add(BRIDGE_PORT.toString())
                    if (!apiKey.isNullOrBlank()) {
                        add("--api-key")
                        add(apiKey)
                    }
                }

                Log.i(TAG, "starting node: ${args.joinToString(" ")}")
                val result = startNodeWithArguments(args.toTypedArray())
                Log.i(TAG, "node exited with code $result")
                if (result != 0) {
                    lastError = "Node.js exited with code $result"
                }
            } catch (t: Throwable) {
                lastError = t.message
                Log.e(TAG, "failed to start node", t)
            }
        }, "dsh-node-thread").apply { isDaemon = false }.start()
    }
}
