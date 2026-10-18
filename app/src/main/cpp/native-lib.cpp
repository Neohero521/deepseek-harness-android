#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>

#include <android/log.h>

#include "node.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "DSH.Native", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DSH.Native", __VA_ARGS__)

/**
 * JNI shim that starts Node.js inside the app process.
 *
 * node's libuv requires all argv strings to live in contiguous memory,
 * so we copy them from the Java String[] into one buffer first.
 */
extern "C" JNIEXPORT jint JNICALL
Java_com_dsh_android_node_NodeRuntime_startNodeWithArguments(
    JNIEnv *env,
    jobject /* this */,
    jobjectArray arguments) {

    jsize argument_count = env->GetArrayLength(arguments);
    LOGI("startNodeWithArguments argc=%d", (int) argument_count);

    // Compute the total byte size needed for all arguments in contiguous memory.
    int c_arguments_size = 0;
    for (int i = 0; i < argument_count; i++) {
        const char *arg = env->GetStringUTFChars(
            (jstring) env->GetObjectArrayElement(arguments, i), 0);
        c_arguments_size += strlen(arg);
        c_arguments_size++;  // for '\0'
        env->ReleaseStringUTFChars((jstring) env->GetObjectArrayElement(arguments, i), arg);
    }

    // Allocate and populate the buffer.
    char *args_buffer = (char *) calloc(c_arguments_size, sizeof(char));
    if (args_buffer == nullptr) {
        LOGE("calloc failed (%d bytes)", c_arguments_size);
        return -1;
    }
    char *argv[argument_count];
    char *current_args_position = args_buffer;

    for (int i = 0; i < argument_count; i++) {
        const char *current_argument = env->GetStringUTFChars(
            (jstring) env->GetObjectArrayElement(arguments, i), 0);
        size_t len = strlen(current_argument);
        memcpy(current_args_position, current_argument, len + 1);
        argv[i] = current_args_position;
        current_args_position += len + 1;
        env->ReleaseStringUTFChars((jstring) env->GetObjectArrayElement(arguments, i), current_argument);
    }

    LOGI("calling node::Start(argv[0]=%s argv[1]=%s)", argv[0], argv[1]);
    int node_result = 1;
    try {
        // Node.js startup can throw (e.g. bad options); a C++ exception must
        // never cross the JNI boundary, or the process aborts (std::terminate).
        node_result = node::Start(argument_count, argv);
    } catch (...) {
        LOGE("node::Start threw a C++ exception");
        node_result = -1;
    }
    LOGI("node::Start returned %d", node_result);

    free(args_buffer);
    return (jint) node_result;
}
