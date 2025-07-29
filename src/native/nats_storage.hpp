#pragma once

#include <string>
#include <memory>
#include <sstream>
#include <algorithm>
#include <nats/nats.h>
#include "ratelimiter.hpp"

class NatsStorage : public DistributedStorage {
private:
    natsConnection* nc;
    jsCtx* js;
    kvStore* kv;
    std::string bucket_name;
    std::string prefix;

public:
    NatsStorage(const std::string& servers = "nats://localhost:4222", 
                const std::string& bucket = "rate-limits",
                const std::string& keyPrefix = "rl_",
                const std::string* credentials = nullptr)
        : bucket_name(bucket), prefix(keyPrefix) {
        
        natsStatus s;
        
        // Create connection options
        natsOptions* opts = nullptr;
        s = natsOptions_Create(&opts);
        if (s != NATS_OK) {
            throw std::runtime_error("Failed to create NATS options: " + std::string(natsStatus_GetText(s)));
        }

        // Set servers
        const char* server_list[] = { servers.c_str() };
        s = natsOptions_SetServers(opts, server_list, 1);
        if (s != NATS_OK) {
            natsOptions_Destroy(opts);
            throw std::runtime_error("Failed to set NATS servers: " + std::string(natsStatus_GetText(s)));
        }

        // Set credentials if provided
        if (credentials && !credentials->empty()) {
            s = natsOptions_SetUserCredentialsFromFiles(opts, credentials->c_str(), nullptr);
            if (s != NATS_OK) {
                natsOptions_Destroy(opts);
                throw std::runtime_error("Failed to set NATS credentials: " + std::string(natsStatus_GetText(s)));
            }
        }

        // Connect to NATS
        s = natsConnection_Connect(&nc, opts);
        natsOptions_Destroy(opts);
        
        if (s != NATS_OK) {
            throw std::runtime_error("Failed to connect to NATS: " + std::string(natsStatus_GetText(s)));
        }

        // Create JetStream context
        jsOptions jsOpts;
        jsOptions_Init(&jsOpts);
        
        s = natsConnection_JetStream(&js, nc, &jsOpts);
        if (s != NATS_OK) {
            natsConnection_Destroy(nc);
            throw std::runtime_error("Failed to create JetStream context: " + std::string(natsStatus_GetText(s)));
        }

        // Create or bind to KV bucket
        kvConfig config;
        kvConfig_Init(&config);
        config.Bucket = bucket_name.c_str();
        config.TTL = 3600LL * 1000 * 1000 * 1000; // 1 hour TTL in nanoseconds
        
        s = js_CreateKeyValue(&kv, js, &config);
        // If the bucket already exists, try to bind to it instead
        if (s != NATS_OK) {
            s = js_KeyValue(&kv, js, bucket_name.c_str());
        }
        
        if (s != NATS_OK) {
            jsCtx_Destroy(js);
            natsConnection_Destroy(nc);
            throw std::runtime_error("Failed to create/bind to KV bucket: " + std::string(natsStatus_GetText(s)));
        }
    }

    ~NatsStorage() {
        if (kv) kvStore_Destroy(kv);
        if (js) jsCtx_Destroy(js);
        if (nc) natsConnection_Destroy(nc);
    }

    bool tryAcquire(const std::string& key, int64_t maxTokens) override {
        if (!kv) return false; // Safety check
        
        // NATS JetStream KV Store does not allow colons in key names
        std::string sanitizedKey = prefix + key;
        std::replace(sanitizedKey.begin(), sanitizedKey.end(), ':', '_');
        const std::string fullKey = sanitizedKey;
        kvEntry* entry = nullptr;
        natsStatus s;
        
        // Try to get current value
        s = kvStore_Get(&entry, kv, fullKey.c_str());
        
        if (s == NATS_NOT_FOUND) {
            // Key doesn't exist, initialize it with maxTokens, then decrement by 1
            std::string value = std::to_string(maxTokens);
            uint64_t rev;
            s = kvStore_CreateString(&rev, kv, fullKey.c_str(), value.c_str());
            
            if (s != NATS_OK) {
                return false;
            }
            
            // Now decrement by 1 (acquiring 1 token)
            if (maxTokens > 0) {
                std::string newValue = std::to_string(maxTokens - 1);
                uint64_t newRev;
                s = kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), rev);
                return s == NATS_OK;
            }
            
            return false;
        }
        
        if (s != NATS_OK) {
            if (entry) kvEntry_Destroy(entry);
            return false;
        }

        // Parse current token count
        const char* data = (const char*)kvEntry_Value(entry);
        if (!data) {
            kvEntry_Destroy(entry);
            return false;
        }
        
        int dataLen = kvEntry_ValueLen(entry);
        std::string valueStr(data, dataLen);
        uint64_t revision = kvEntry_Revision(entry);
        kvEntry_Destroy(entry);
        
        int64_t currentTokens;
        try {
            currentTokens = std::stoll(valueStr);
        } catch (...) {
            return false;
        }
        
        // Check if we have tokens available (try to acquire 1 token)
        if (currentTokens <= 0) {
            return false;
        }
        
        // Try to decrement by 1 token atomically
        std::string newValue = std::to_string(currentTokens - 1);
        uint64_t newRev;
        s = kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), revision);
        
        return s == NATS_OK;
    }

    void release(const std::string& key, int64_t tokens) override {
        if (!kv) return; // Safety check
        
        // NATS JetStream KV Store does not allow colons in key names
        std::string sanitizedKey = prefix + key;
        std::replace(sanitizedKey.begin(), sanitizedKey.end(), ':', '_');
        const std::string fullKey = sanitizedKey;
        kvEntry* entry = nullptr;
        natsStatus s;
        
        // Get current value
        s = kvStore_Get(&entry, kv, fullKey.c_str());
        if (s != NATS_OK) {
            if (entry) kvEntry_Destroy(entry);
            return;
        }
        
        // Parse current token count
        const char* data = (const char*)kvEntry_Value(entry);
        if (!data) {
            kvEntry_Destroy(entry);
            return;
        }
        
        int dataLen = kvEntry_ValueLen(entry);
        std::string valueStr(data, dataLen);
        uint64_t revision = kvEntry_Revision(entry);
        kvEntry_Destroy(entry);
        
        int64_t currentTokens;
        try {
            currentTokens = std::stoll(valueStr);
        } catch (...) {
            return;
        }
        
        // Increment tokens
        std::string newValue = std::to_string(currentTokens + tokens);
        uint64_t newRev;
        kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), revision);
    }
};