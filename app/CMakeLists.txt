# DeepSeek Harness Android — native build.
# Links the prebuilt libnode.so from nodejs-mobile and compiles the tiny JNI
# shim that starts Node.js with the app's argv.

cmake_minimum_required(VERSION 3.22.1)
project(dsh_android LANGUAGES CXX)

# Imported prebuilt Node.js runtime.
add_library(libnode SHARED IMPORTED)
set_target_properties(
    libnode
    PROPERTIES
    IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so
)

# libnode's headers.
include_directories(libnode/include/node/)

add_library(native-lib SHARED src/main/cpp/native-lib.cpp)
target_link_libraries(
    native-lib
    libnode
    android
    log
)
