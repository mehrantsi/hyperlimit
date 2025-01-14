#pragma once

#include <string>
#include <memory>
#include <hiredis/hiredis.h>
#include "ratelimiter.hpp"

class RedisStorage : public DistributedStorage {
private:
    redisContext* redis;
    std::string prefix;

public:
    RedisStorage(const std::string& host = "localhost", int port = 6379, const std::string& keyPrefix = "rl:")
        : prefix(keyPrefix) {
        redis = redisConnect(host.c_str(), port);
        if (redis == nullptr || redis->err) {
            std::string error = redis ? redis->errstr : "Cannot allocate redis context";
            if (redis) redisFree(redis);
            throw std::runtime_error("Redis connection error: " + error);
        }
    }

    ~RedisStorage() {
        if (redis) redisFree(redis);
    }

    bool tryAcquire(const std::string& key, int64_t tokens) override {
        const std::string fullKey = prefix + key;
        const char* script = R"(
            local key = KEYS[1]
            local max_tokens = tonumber(ARGV[1])
            
            -- Get current tokens, initialize if not exists
            local current = redis.call('GET', key)
            if not current then
                redis.call('SET', key, max_tokens)
                current = max_tokens
            end
            current = tonumber(current)
            
            -- Try to acquire a token
            if current > 0 then
                redis.call('DECRBY', key, 1)
                return 1
            end
            return 0
        )";

        redisReply* reply = (redisReply*)redisCommand(redis,
            "EVAL %s 1 %s %lld",
            script, fullKey.c_str(), tokens);

        if (!reply) {
            throw std::runtime_error("Redis command failed");
        }

        bool result = (reply->type == REDIS_REPLY_INTEGER && reply->integer == 1);
        freeReplyObject(reply);
        return result;
    }

    void release(const std::string& key, int64_t tokens) override {
        const std::string fullKey = prefix + key;
        redisReply* reply = (redisReply*)redisCommand(redis,
            "INCRBY %s %lld",
            fullKey.c_str(), tokens);

        if (!reply) {
            throw std::runtime_error("Redis command failed");
        }

        freeReplyObject(reply);
    }
}; 