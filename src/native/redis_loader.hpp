#ifndef REDIS_LOADER_HPP
#define REDIS_LOADER_HPP

#include <string>
#include <stdexcept>

#ifdef _WIN32
    #include <windows.h>
    #define REDIS_LIB_NAME "hiredis.dll"
    typedef HMODULE lib_handle_t;
#elif __APPLE__
    #include <dlfcn.h>
    #define REDIS_LIB_NAME "libhiredis.dylib"
    typedef void* lib_handle_t;
#else
    #include <dlfcn.h>
    #define REDIS_LIB_NAME "libhiredis.so"
    typedef void* lib_handle_t;
#endif

// Forward declarations of Redis types
struct redisContext;
struct redisReply;

// Redis constants
#define REDIS_REPLY_STRING 1
#define REDIS_REPLY_ARRAY 2
#define REDIS_REPLY_INTEGER 3
#define REDIS_REPLY_NIL 4
#define REDIS_REPLY_STATUS 5
#define REDIS_REPLY_ERROR 6

// Replica of redisReply struct (must match hiredis definition)
typedef struct redisReply {
    int type;
    long long integer;
    size_t len;
    char *str;
    size_t elements;
    struct redisReply **element;
} redisReply;

// Replica of redisContext struct (simplified - only fields we check)
typedef struct redisContext {
    int err;
    char errstr[128];
    // ... other fields we don't need to access directly
} redisContext;

class RedisLoader {
private:
    lib_handle_t handle = nullptr;
    
public:
    // Function pointers for Redis C API
    redisContext* (*redisConnect)(const char*, int) = nullptr;
    redisContext* (*redisConnectWithTimeout)(const char*, int, const struct timeval) = nullptr;
    void (*redisFree)(redisContext*) = nullptr;
    void* (*redisCommand)(redisContext*, const char*, ...) = nullptr;
    void (*freeReplyObject)(void*) = nullptr;
    int (*redisAppendCommand)(redisContext*, const char*, ...) = nullptr;
    int (*redisGetReply)(redisContext*, void**) = nullptr;

private:
    bool loadLibrary() {
        #ifdef _WIN32
            handle = LoadLibraryA(REDIS_LIB_NAME);
            if (!handle) {
                // Try some common paths
                handle = LoadLibraryA("C:\\Program Files\\Redis\\bin\\hiredis.dll");
                if (!handle) {
                    handle = LoadLibraryA("C:\\Redis\\bin\\hiredis.dll");
                }
            }
        #else
            handle = dlopen(REDIS_LIB_NAME, RTLD_LAZY);
            if (!handle) {
                // Try some common paths
                #ifdef __APPLE__
                    handle = dlopen("/usr/local/lib/libhiredis.dylib", RTLD_LAZY);
                    if (!handle) {
                        handle = dlopen("/opt/homebrew/lib/libhiredis.dylib", RTLD_LAZY);
                    }
                #else
                    handle = dlopen("/usr/lib/libhiredis.so", RTLD_LAZY);
                    if (!handle) {
                        handle = dlopen("/usr/local/lib/libhiredis.so", RTLD_LAZY);
                        if (!handle) {
                            handle = dlopen("/usr/lib/x86_64-linux-gnu/libhiredis.so", RTLD_LAZY);
                        }
                    }
                #endif
            }
        #endif
        
        return handle != nullptr;
    }
    
    template<typename T>
    bool loadFunction(T& func, const char* name) {
        #ifdef _WIN32
            func = reinterpret_cast<T>(GetProcAddress(handle, name));
        #else
            func = reinterpret_cast<T>(dlsym(handle, name));
        #endif
        return func != nullptr;
    }

public:
    bool load() {
        if (!loadLibrary()) {
            return false;
        }
        
        // Load all required functions
        bool success = true;
        
        success &= loadFunction(redisConnect, "redisConnect");
        success &= loadFunction(redisConnectWithTimeout, "redisConnectWithTimeout");
        success &= loadFunction(redisFree, "redisFree");
        success &= loadFunction(redisCommand, "redisCommand");
        success &= loadFunction(freeReplyObject, "freeReplyObject");
        success &= loadFunction(redisAppendCommand, "redisAppendCommand");
        success &= loadFunction(redisGetReply, "redisGetReply");
        
        if (!success) {
            unload();
            return false;
        }
        
        return true;
    }
    
    void unload() {
        if (handle) {
            #ifdef _WIN32
                FreeLibrary(handle);
            #else
                dlclose(handle);
            #endif
            handle = nullptr;
        }
    }
    
    bool isLoaded() const {
        return handle != nullptr;
    }
    
    std::string getErrorMessage() const {
        #ifdef _WIN32
            return "Redis library not found. Please install hiredis library and ensure hiredis.dll is in your PATH.";
        #elif __APPLE__
            return "Redis library not found. Please install hiredis library: brew install hiredis";
        #else
            return "Redis library not found. Please install hiredis library: apt-get install libhiredis-dev";
        #endif
    }
    
    ~RedisLoader() {
        unload();
    }
};

// Global instance
static RedisLoader g_redisLoader;

#endif // REDIS_LOADER_HPP