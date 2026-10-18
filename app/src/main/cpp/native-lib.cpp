#include <jni.h>
#include <string>
#include <cstdlib>
#include <cstring>
#include <csignal>
#include <cstdio>
#include <unistd.h>
#include <fcntl.h>
#include <dlfcn.h>
#include <unwind.h>

#include <android/log.h>

#include "node.h"

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "DSH.Native", __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, "DSH.Native", __VA_ARGS__)

// Crash diagnostics: when the process dies in native code (SIGSEGV/SIGABRT/
// SIGBUS), record a backtrace to a file the app can show on next launch.
// The path comes from argv (--crash-file <path>), set by NodeRuntime.kt.
//
// bionic has no glibc-style backtrace(); use the unwinder + dladdr instead.
static char g_crash_file[512] = {0};

struct TraceCtx {
    void **frames;
    int count;
    int max;
};

static _Unwind_Reason_Code trace_cb(struct _Unwind_Context *ctx, void *arg) {
    TraceCtx *t = (TraceCtx *) arg;
    if (t->count >= t->max) return _URC_END_OF_STACK;
    t->frames[t->count++] = (void *) _Unwind_GetIP(ctx);
    return _URC_NO_REASON;
}

static void crash_handler(int sig) {
    int fd = open(g_crash_file, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (fd >= 0) {
        char header[96];
        int n = snprintf(header, sizeof(header),
                         "\n== native crash: signal %d (%s) ==\n",
                         sig, sig == SIGSEGV ? "SIGSEGV" : (sig == SIGABRT ? "SIGABRT" : "SIGBUS"));
        if (n > 0) (void)!write(fd, header, (size_t)n);

        void *frames[32];
        TraceCtx tc = { frames, 0, 32 };
        _Unwind_Backtrace(trace_cb, &tc);
        for (int i = 0; i < tc.count; i++) {
            char line[320];
            Dl_info info;
            if (dladdr(frames[i], &info) != 0 && info.dli_fname != nullptr) {
                uintptr_t base = (uintptr_t) info.dli_fbase;
                uintptr_t off = (uintptr_t) frames[i] - base;
                const char *sym = info.dli_sname ? info.dli_sname : "?";
                n = snprintf(line, sizeof(line),
                             "  #%02d  %s  %s+0x%lx  (pc 0x%lx)\n",
                             i, info.dli_fname, sym, (unsigned long) off,
                             (unsigned long) (uintptr_t) frames[i]);
                if (n > 0) (void)!write(fd, line, (size_t)n);
            } else {
                n = snprintf(line, sizeof(line), "  #%02d  pc 0x%lx\n",
                             i, (unsigned long) (uintptr_t) frames[i]);
                if (n > 0) (void)!write(fd, line, (size_t)n);
            }
        }
        close(fd);
    }
    _exit(1);
}

static void install_crash_handlers() {
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = crash_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_RESETHAND;  // one-shot: avoid recursive handling
    sigaction(SIGSEGV, &sa, nullptr);
    sigaction(SIGABRT, &sa, nullptr);
    sigaction(SIGBUS, &sa, nullptr);
}

/** Extract --crash-file <path> from argv and remember it. */
static void extract_crash_file_path(int argc, char **argv) {
    for (int i = 0; i + 1 < argc; i++) {
        if (strcmp(argv[i], "--crash-file") == 0 && argv[i + 1]) {
            strncpy(g_crash_file, argv[i + 1], sizeof(g_crash_file) - 1);
            return;
        }
    }
}

static void append_to_crash_file(const char *line) {
    int fd = open(g_crash_file, O_WRONLY | O_CREAT | O_APPEND, 0600);
    if (fd >= 0) {
        (void)!write(fd, line, strlen(line));
        close(fd);
    }
}

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

    extract_crash_file_path((int) argument_count, argv);
    install_crash_handlers();
    append_to_crash_file("== dsh-native: about to call node::Start ==\n");

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

    char done[96];
    int n = snprintf(done, sizeof(done), "== dsh-native: node::Start returned %d ==\n", node_result);
    if (n > 0) append_to_crash_file(done);

    free(args_buffer);
    return (jint) node_result;
}
