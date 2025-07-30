#ifndef NATS_LOADER_HPP
#define NATS_LOADER_HPP

#include <string>
#include <stdexcept>

#ifdef _WIN32
    #include <windows.h>
    #define NATS_LIB_NAME "nats.dll"
    typedef HMODULE lib_handle_t;
#elif __APPLE__
    #include <dlfcn.h>
    #define NATS_LIB_NAME "libnats.dylib"
    typedef void* lib_handle_t;
#else
    #include <dlfcn.h>
    #define NATS_LIB_NAME "libnats.so"
    typedef void* lib_handle_t;
#endif

// Forward declarations of NATS types
typedef struct __natsConnection natsConnection;
typedef struct __natsOptions natsOptions;
typedef struct __jsCtx jsCtx;
typedef struct __kvStore kvStore;
typedef struct __kvEntry kvEntry;
typedef struct __kvWatcher kvWatcher;

// These structs need to be fully defined as they're used by value
typedef struct jsOptions {
    const char* prefix;
    const char* domain;
    int64_t wait;
    bool publishAsync;
} jsOptions;

typedef struct kvConfig {
    const char* bucket;
    const char* description;
    uint32_t maxValueSize;
    uint8_t history;
    int64_t ttl;
    uint32_t maxBytes;
    const char* storageType;
    uint32_t replicas;
    bool allowRollup;
    bool allowDirect;
    const char** placement_cluster;
    int placement_cluster_len;
    const char** placement_tags;
    int placement_tags_len;
} kvConfig;

typedef enum {
    NATS_OK = 0,
    NATS_ERR = 1,
    NATS_PROTOCOL_ERROR = 2,
    NATS_IO_ERROR = 3,
    NATS_LINE_TOO_LONG = 4,
    NATS_CONNECTION_CLOSED = 5,
    NATS_NO_SERVER = 6,
    NATS_STALE_CONNECTION = 7,
    NATS_SECURE_CONNECTION_WANTED = 8,
    NATS_SECURE_CONNECTION_REQUIRED = 9,
    NATS_CONNECTION_DISCONNECTED = 10,
    NATS_CONNECTION_AUTH_FAILED = 11,
    NATS_NOT_PERMITTED = 12,
    NATS_NOT_FOUND = 13,
    NATS_ADDRESS_MISSING = 14,
    NATS_INVALID_SUBJECT = 15,
    NATS_INVALID_ARG = 16,
    NATS_INVALID_SUBSCRIPTION = 17,
    NATS_INVALID_TIMEOUT = 18,
    NATS_ILLEGAL_STATE = 19,
    NATS_SLOW_CONSUMER = 20,
    NATS_MAX_PAYLOAD = 21,
    NATS_MAX_DELIVERED_MSGS = 22,
    NATS_INSUFFICIENT_BUFFER = 23,
    NATS_NO_MEMORY = 24,
    NATS_SYS_ERROR = 25,
    NATS_TIMEOUT = 26,
    NATS_FAILED_TO_INITIALIZE = 27,
    NATS_NOT_INITIALIZED = 28,
    NATS_SSL_ERROR = 29,
    NATS_NO_SERVER_SUPPORT = 30,
    NATS_NOT_YET_CONNECTED = 31,
    NATS_DRAINING = 32,
    NATS_INVALID_QUEUE_NAME = 33,
    NATS_NO_RESPONDERS = 34,
    NATS_MISMATCH = 35,
    NATS_MISSED_HEARTBEAT = 36,
    NATS_UPDATE_ERR_STACK = 1000
} natsStatus;

class NatsLoader {
private:
    lib_handle_t handle = nullptr;
    
    // Function pointers for NATS C API
    public:
    natsStatus (*natsConnection_Connect)(natsConnection**, natsOptions*) = nullptr;
    natsStatus (*natsConnection_ConnectTo)(natsConnection**, const char*) = nullptr;
    void (*natsConnection_Destroy)(natsConnection*) = nullptr;
    
    natsStatus (*natsOptions_Create)(natsOptions**) = nullptr;
    natsStatus (*natsOptions_SetServers)(natsOptions*, const char**, int) = nullptr;
    natsStatus (*natsOptions_SetUserCredentialsFromFiles)(natsOptions*, const char*, const char*) = nullptr;
    void (*natsOptions_Destroy)(natsOptions*) = nullptr;
    
    natsStatus (*jsOptions_Init)(jsOptions*) = nullptr;
    natsStatus (*natsConnection_JetStream)(jsCtx**, natsConnection*, jsOptions*) = nullptr;
    void (*jsCtx_Destroy)(jsCtx*) = nullptr;
    
    natsStatus (*kvConfig_Init)(kvConfig*) = nullptr;
    natsStatus (*js_CreateKeyValue)(kvStore**, jsCtx*, kvConfig*) = nullptr;
    natsStatus (*js_KeyValue)(kvStore**, jsCtx*, const char*) = nullptr;
    void (*kvStore_Destroy)(kvStore*) = nullptr;
    
    natsStatus (*kvStore_Get)(kvEntry**, kvStore*, const char*) = nullptr;
    natsStatus (*kvStore_Put)(uint64_t*, kvStore*, const char*, const void*, int) = nullptr;
    natsStatus (*kvStore_Create)(kvEntry**, kvStore*, const char*, const void*, int) = nullptr;
    natsStatus (*kvStore_Update)(uint64_t*, kvStore*, const char*, const void*, int, uint64_t) = nullptr;
    natsStatus (*kvStore_CreateString)(uint64_t*, kvStore*, const char*, const char*) = nullptr;
    natsStatus (*kvStore_UpdateString)(uint64_t*, kvStore*, const char*, const char*, uint64_t) = nullptr;
    
    const void* (*kvEntry_Value)(kvEntry*) = nullptr;
    int (*kvEntry_ValueLen)(kvEntry*) = nullptr;
    uint64_t (*kvEntry_Revision)(kvEntry*) = nullptr;
    void (*kvEntry_Destroy)(kvEntry*) = nullptr;
    
    const char* (*natsStatus_GetText)(natsStatus) = nullptr;

private:
    bool loadLibrary() {
        #ifdef _WIN32
            handle = LoadLibraryA(NATS_LIB_NAME);
            if (!handle) {
                // Try some common paths
                handle = LoadLibraryA("C:\\Program Files\\nats\\bin\\nats.dll");
                if (!handle) {
                    handle = LoadLibraryA("C:\\nats\\bin\\nats.dll");
                }
            }
        #else
            handle = dlopen(NATS_LIB_NAME, RTLD_LAZY);
            if (!handle) {
                // Try some common paths
                #ifdef __APPLE__
                    handle = dlopen("/usr/local/lib/libnats.dylib", RTLD_LAZY);
                    if (!handle) {
                        handle = dlopen("/opt/homebrew/lib/libnats.dylib", RTLD_LAZY);
                    }
                #else
                    handle = dlopen("/usr/lib/libnats.so", RTLD_LAZY);
                    if (!handle) {
                        handle = dlopen("/usr/local/lib/libnats.so", RTLD_LAZY);
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
        
        success &= loadFunction(natsConnection_Connect, "natsConnection_Connect");
        success &= loadFunction(natsConnection_ConnectTo, "natsConnection_ConnectTo");
        success &= loadFunction(natsConnection_Destroy, "natsConnection_Destroy");
        
        success &= loadFunction(natsOptions_Create, "natsOptions_Create");
        success &= loadFunction(natsOptions_SetServers, "natsOptions_SetServers");
        success &= loadFunction(natsOptions_SetUserCredentialsFromFiles, "natsOptions_SetUserCredentialsFromFiles");
        success &= loadFunction(natsOptions_Destroy, "natsOptions_Destroy");
        
        success &= loadFunction(jsOptions_Init, "jsOptions_Init");
        success &= loadFunction(natsConnection_JetStream, "natsConnection_JetStream");
        success &= loadFunction(jsCtx_Destroy, "jsCtx_Destroy");
        
        success &= loadFunction(kvConfig_Init, "kvConfig_Init");
        success &= loadFunction(js_CreateKeyValue, "js_CreateKeyValue");
        success &= loadFunction(js_KeyValue, "js_KeyValue");
        success &= loadFunction(kvStore_Destroy, "kvStore_Destroy");
        
        success &= loadFunction(kvStore_Get, "kvStore_Get");
        success &= loadFunction(kvStore_Put, "kvStore_Put");
        success &= loadFunction(kvStore_Create, "kvStore_Create");
        success &= loadFunction(kvStore_Update, "kvStore_Update");
        success &= loadFunction(kvStore_CreateString, "kvStore_CreateString");
        success &= loadFunction(kvStore_UpdateString, "kvStore_UpdateString");
        
        success &= loadFunction(kvEntry_Value, "kvEntry_Value");
        success &= loadFunction(kvEntry_ValueLen, "kvEntry_ValueLen");
        success &= loadFunction(kvEntry_Revision, "kvEntry_Revision");
        success &= loadFunction(kvEntry_Destroy, "kvEntry_Destroy");
        
        success &= loadFunction(natsStatus_GetText, "natsStatus_GetText");
        
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
            return "NATS library not found. Please install NATS C client library and ensure nats.dll is in your PATH.";
        #elif __APPLE__
            return "NATS library not found. Please install NATS C client library: brew install cnats";
        #else
            return "NATS library not found. Please install NATS C client library: apt-get install libnats-dev";
        #endif
    }
    
    ~NatsLoader() {
        unload();
    }
};

// Global instance
static NatsLoader g_natsLoader;

#endif // NATS_LOADER_HPP