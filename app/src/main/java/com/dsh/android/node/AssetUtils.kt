package com.dsh.android.node

import android.content.Context
import android.content.pm.PackageManager
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Assets helpers: copy the packaged Node host (assets/nodejs-project) into
 * app storage, because Node.js cannot run directly from inside the APK.
 */
object AssetUtils {
    private const val TAG = "DSH.Assets"

    /** True if the APK was updated since the last run. */
    fun wasApkUpdated(context: Context): Boolean {
        val prefs = context.getSharedPreferences("dsh_node_runtime", Context.MODE_PRIVATE)
        val previous = prefs.getLong("apk_last_update_time", 0L)
        val last = try {
            context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        } catch (e: PackageManager.NameNotFoundException) {
            1L
        }
        return last != previous
    }

    fun saveApkUpdateTime(context: Context) {
        val last = try {
            context.packageManager.getPackageInfo(context.packageName, 0).lastUpdateTime
        } catch (e: PackageManager.NameNotFoundException) {
            1L
        }
        context.getSharedPreferences("dsh_node_runtime", Context.MODE_PRIVATE)
            .edit()
            .putLong("apk_last_update_time", last)
            .apply()
    }

    /** Recursively copy assets/<fromAssetPath> into <toPath> on disk. */
    fun copyAssetFolder(assetManager: android.content.res.AssetManager, fromAssetPath: String, toPath: String) {
        val files = assetManager.list(fromAssetPath) ?: emptyArray()
        if (files.isEmpty()) {
            copyAsset(assetManager, fromAssetPath, toPath)
        } else {
            val dir = File(toPath)
            if (!dir.exists()) dir.mkdirs()
            for (file in files) {
                copyAssetFolder(assetManager, "$fromAssetPath/$file", "$toPath/$file")
            }
        }
    }

    private fun copyAsset(assetManager: android.content.res.AssetManager, fromAssetPath: String, toPath: String) {
        val input: InputStream = assetManager.open(fromAssetPath)
        val outFile = File(toPath)
        outFile.parentFile?.mkdirs()
        val output: OutputStream = FileOutputStream(outFile)
        input.copyTo(output)
        input.close()
        output.flush()
        output.close()
    }

    /** Prepare the Node host in filesDir, refreshing it whenever the APK changed. */
    fun ensureNodeHost(context: Context): File {
        val nodeDir = File(context.filesDir, "nodejs-project")
        if (wasApkUpdated(context)) {
            Log.i(TAG, "APK updated — refreshing node host")
            nodeDir.deleteRecursively()
            copyAssetFolder(context.assets, "nodejs-project", nodeDir.absolutePath)
            saveApkUpdateTime(context)
        }
        if (!File(nodeDir, "main.js").exists()) {
            Log.i(TAG, "node host missing — copying from assets")
            nodeDir.deleteRecursively()
            copyAssetFolder(context.assets, "nodejs-project", nodeDir.absolutePath)
            saveApkUpdateTime(context)
        }
        return nodeDir
    }
}
