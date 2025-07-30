#pragma once

#include <string>
#include <memory>
#include <sstream>
#include <algorithm>
#include "nats_loader.hpp"
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
        
        // First, ensure NATS library is loaded
        if (!g_natsLoader.isLoaded()) {
            if (!g_natsLoader.load()) {
                throw std::runtime_error(g_natsLoader.getErrorMessage());
            }
        }
        
        natsStatus s;
        
        // Create connection options
        natsOptions* opts = nullptr;
        s = g_natsLoader.natsOptions_Create(&opts);
        if (s != NATS_OK) {
            throw std::runtime_error("Failed to create NATS options: " + std::string(g_natsLoader.natsStatus_GetText(s)));
        }

        // Handle multiple servers if provided as comma-separated list
        std::vector<const char*> serverArray;
        std::vector<std::string> serverStrings;
        
        if (servers.find(',') != std::string::npos) {
            std::stringstream ss(servers);
            std::string server;
            while (std::getline(ss, server, ',')) {
                // Trim whitespace
                server.erase(0, server.find_first_not_of(" \t"));
                server.erase(server.find_last_not_of(" \t") + 1);
                serverStrings.push_back(server);
            }
            
            for (const auto& srv : serverStrings) {
                serverArray.push_back(srv.c_str());
            }
            
            int serverCount = static_cast<int>(serverArray.size());
            s = g_natsLoader.natsOptions_SetServers(opts, serverArray.data(), serverCount);
            if (s != NATS_OK) {
                g_natsLoader.natsOptions_Destroy(opts);
                throw std::runtime_error("Failed to set NATS servers: " + std::string(g_natsLoader.natsStatus_GetText(s)));
            }
        }

        // Set credentials if provided
        if (credentials && !credentials->empty()) {
            s = g_natsLoader.natsOptions_SetUserCredentialsFromFiles(opts, credentials->c_str(), credentials->c_str());
            if (s != NATS_OK) {
                g_natsLoader.natsOptions_Destroy(opts);
                throw std::runtime_error("Failed to set NATS credentials: " + std::string(g_natsLoader.natsStatus_GetText(s)));
            }
        }

        // Connect to NATS
        s = g_natsLoader.natsConnection_Connect(&nc, opts);
        g_natsLoader.natsOptions_Destroy(opts);
        
        if (s != NATS_OK) {
            throw std::runtime_error("Failed to connect to NATS: " + std::string(g_natsLoader.natsStatus_GetText(s)));
        }

        // Create JetStream context
        jsOptions jsOpts = {0};  // Zero-initialize
        if (g_natsLoader.jsOptions_Init) {
            g_natsLoader.jsOptions_Init(&jsOpts);
        }
        
        s = g_natsLoader.natsConnection_JetStream(&js, nc, &jsOpts);
        if (s != NATS_OK) {
            g_natsLoader.natsConnection_Destroy(nc);
            throw std::runtime_error("Failed to get JetStream context");
        }

        // Create or bind to key-value store
        kvConfig kvConf = {0};  // Zero-initialize
        if (g_natsLoader.kvConfig_Init) {
            g_natsLoader.kvConfig_Init(&kvConf);
        }
        kvConf.bucket = const_cast<char*>(bucket.c_str());
        kvConf.history = 1;
        kvConf.ttl = 3600000;  // 1 hour TTL
        
        s = g_natsLoader.js_CreateKeyValue(&kv, js, &kvConf);
        if (s != NATS_OK && s != NATS_UPDATE_ERR_STACK) {
            // Try to bind to existing bucket
            s = g_natsLoader.js_KeyValue(&kv, js, bucket.c_str());
            if (s != NATS_OK) {
                g_natsLoader.jsCtx_Destroy(js);
                g_natsLoader.natsConnection_Destroy(nc);
                throw std::runtime_error("Failed to create/bind to KV store");
            }
        }
    }

    ~NatsStorage() {
        if (kv) g_natsLoader.kvStore_Destroy(kv);
        if (js) g_natsLoader.jsCtx_Destroy(js);
        if (nc) g_natsLoader.natsConnection_Destroy(nc);
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
        s = g_natsLoader.kvStore_Get(&entry, kv, fullKey.c_str());
        
        if (s == NATS_NOT_FOUND) {
            // Key doesn't exist, initialize it with maxTokens, then decrement by 1
            std::string value = std::to_string(maxTokens);
            uint64_t rev;
            s = g_natsLoader.kvStore_CreateString(&rev, kv, fullKey.c_str(), value.c_str());
            
            if (s != NATS_OK) {
                return false;
            }
            
            // Now decrement by 1 (acquiring 1 token)
            if (maxTokens > 0) {
                std::string newValue = std::to_string(maxTokens - 1);
                uint64_t newRev;
                s = g_natsLoader.kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), rev);
                return s == NATS_OK;
            }
            
            return false;
        }
        
        if (s != NATS_OK) {
            if (entry) g_natsLoader.kvEntry_Destroy(entry);
            return false;
        }

        // Parse current token count
        const char* data = (const char*)g_natsLoader.kvEntry_Value(entry);
        if (!data) {
            g_natsLoader.kvEntry_Destroy(entry);
            return false;
        }
        
        int dataLen = g_natsLoader.kvEntry_ValueLen(entry);
        std::string valueStr(data, dataLen);
        uint64_t revision = g_natsLoader.kvEntry_Revision(entry);
        g_natsLoader.kvEntry_Destroy(entry);
        
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
        
        // Try to atomically decrement
        std::string newValue = std::to_string(currentTokens - 1);
        uint64_t newRev;
        s = g_natsLoader.kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), revision);
        
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
        s = g_natsLoader.kvStore_Get(&entry, kv, fullKey.c_str());
        if (s != NATS_OK) {
            if (entry) g_natsLoader.kvEntry_Destroy(entry);
            return;
        }
        
        // Parse current token count
        const char* data = (const char*)g_natsLoader.kvEntry_Value(entry);
        if (!data) {
            g_natsLoader.kvEntry_Destroy(entry);
            return;
        }
        
        int dataLen = g_natsLoader.kvEntry_ValueLen(entry);
        std::string valueStr(data, dataLen);
        uint64_t revision = g_natsLoader.kvEntry_Revision(entry);
        g_natsLoader.kvEntry_Destroy(entry);
        
        int64_t currentTokens;
        try {
            currentTokens = std::stoll(valueStr);
        } catch (...) {
            return;
        }
        
        // Add tokens back
        std::string newValue = std::to_string(currentTokens + tokens);
        uint64_t newRev;
        g_natsLoader.kvStore_UpdateString(&newRev, kv, fullKey.c_str(), newValue.c_str(), revision);
    }
};