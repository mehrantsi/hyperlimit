#pragma once

#ifdef _WIN32
#include "win_compat.h"
#endif

#include <atomic>
#include <chrono>
#include <memory>
#include <string>
#include <array>
#include <functional>
#include <stdexcept>
#include <cmath>
#include <unordered_set>

// MurmurHash3_32 implementation
inline uint32_t rotl32(uint32_t x, int8_t r) noexcept {
    return (x << r) | (x >> (32 - r));
}

inline uint32_t fmix32(uint32_t h) noexcept {
    h ^= h >> 16;
    h *= 0x85ebca6b;
    h ^= h >> 13;
    h *= 0xc2b2ae35;
    h ^= h >> 16;
    return h;
}

// Forward declaration of DistributedStorage
class DistributedStorage {
public:
    virtual ~DistributedStorage() = default;
    virtual bool tryAcquire(const std::string& key, int64_t tokens) = 0;
    virtual void release(const std::string& key, int64_t tokens) = 0;
    virtual void reset(const std::string& key, int64_t maxTokens) = 0;
};

class RateLimiter {
private:
    std::atomic<size_t> BUCKET_COUNT;
    std::atomic<size_t> BUCKET_MASK;
    std::atomic<bool> isResizing{false};
    
    struct alignas(64) Entry {
        // Hot path members - 64-byte cache line #1
        std::atomic<int64_t> tokens;           // 8 bytes
        std::atomic<int64_t> lastRefill;       // 8 bytes
        std::atomic<int64_t> blockUntil;       // 8 bytes
        std::atomic<int64_t> dynamicMaxTokens; // 8 bytes
        std::atomic<int64_t> penaltyPoints;    // 8 bytes
        std::atomic<bool> valid;               // 1 byte + padding
        bool isSlidingWindow;                  // 1 byte
        // 14 bytes padding to align to cache line

        // Cold path members - 64-byte cache line #2
        const int64_t baseMaxTokens;           // 8 bytes
        const int64_t refillTimeMs;            // 8 bytes
        const int64_t blockDurationMs;         // 8 bytes
        const int64_t maxPenaltyPoints;        // 8 bytes
        std::string key;                       // 24 bytes (typical)
        std::string distributedKey;            // 24 bytes (typical)

        Entry() noexcept : 
            tokens(0),
            lastRefill(0),
            blockUntil(0),
            dynamicMaxTokens(0),
            penaltyPoints(0),
            valid(false),
            isSlidingWindow(false),
            baseMaxTokens(0),
            refillTimeMs(0),
            blockDurationMs(0),
            maxPenaltyPoints(0),
            key(),
            distributedKey() {}
        
        Entry(const std::string& k, int64_t max, int64_t refill, bool sliding = false,
              int64_t blockMs = 0, int64_t maxPenalty = 0, const std::string& distKey = "")
            : tokens(max),
              lastRefill(getCurrentTimeMs()),
              blockUntil(0),
              dynamicMaxTokens(max),
              penaltyPoints(0),
              valid(true),
              isSlidingWindow(sliding),
              baseMaxTokens(max),
              refillTimeMs(refill),
              blockDurationMs(blockMs),
              maxPenaltyPoints(maxPenalty),
              key(k),
              distributedKey(distKey) {}

        Entry(const Entry&) = delete;
        Entry& operator=(const Entry&) = delete;

        Entry(Entry&& other) noexcept
            : tokens(other.tokens.load(std::memory_order_relaxed)),
              lastRefill(other.lastRefill.load(std::memory_order_relaxed)),
              blockUntil(other.blockUntil.load(std::memory_order_relaxed)),
              dynamicMaxTokens(other.dynamicMaxTokens.load(std::memory_order_relaxed)),
              penaltyPoints(other.penaltyPoints.load(std::memory_order_relaxed)),
              valid(other.valid.load(std::memory_order_relaxed)),
              isSlidingWindow(other.isSlidingWindow),
              baseMaxTokens(other.baseMaxTokens),
              refillTimeMs(other.refillTimeMs),
              blockDurationMs(other.blockDurationMs),
              maxPenaltyPoints(other.maxPenaltyPoints),
              key(std::move(other.key)),
              distributedKey(std::move(other.distributedKey)) {
            other.valid.store(false, std::memory_order_relaxed);
        }

        Entry& operator=(Entry&& other) noexcept {
            if (this != &other) {
                tokens.store(other.tokens.load(std::memory_order_relaxed), std::memory_order_relaxed);
                lastRefill.store(other.lastRefill.load(std::memory_order_relaxed), std::memory_order_relaxed);
                valid.store(other.valid.load(std::memory_order_relaxed), std::memory_order_relaxed);
                blockUntil.store(other.blockUntil.load(std::memory_order_relaxed), std::memory_order_relaxed);
                dynamicMaxTokens.store(other.dynamicMaxTokens.load(std::memory_order_relaxed), std::memory_order_relaxed);
                penaltyPoints.store(other.penaltyPoints.load(std::memory_order_relaxed), std::memory_order_relaxed);
                const_cast<int64_t&>(baseMaxTokens) = other.baseMaxTokens;
                const_cast<int64_t&>(refillTimeMs) = other.refillTimeMs;
                const_cast<bool&>(isSlidingWindow) = other.isSlidingWindow;
                const_cast<int64_t&>(blockDurationMs) = other.blockDurationMs;
                const_cast<int64_t&>(maxPenaltyPoints) = other.maxPenaltyPoints;
                key = std::move(other.key);
                distributedKey = std::move(other.distributedKey);
                other.valid.store(false, std::memory_order_relaxed);
            }
            return *this;
        }

        // Calculate dynamic rate limit based on penalty points
        int64_t calculateDynamicLimit() const noexcept {
            if (maxPenaltyPoints <= 0) return baseMaxTokens;
            
            int64_t points = penaltyPoints.load(std::memory_order_acquire);
            if (points <= 0) return baseMaxTokens;
            
            // Ensure points don't exceed maxPenaltyPoints
            points = std::min(points, maxPenaltyPoints);
            
            // Using integer arithmetic for more precise control
            // Each penalty point reduces the limit by (baseMaxTokens / maxPenaltyPoints)
            int64_t reduction = (points * baseMaxTokens) / maxPenaltyPoints;
            
            // Cap reduction at 90%
            int64_t maxReduction = (baseMaxTokens * 9) / 10;
            reduction = std::min(reduction, maxReduction);
            
            // Calculate new limit
            int64_t newLimit = baseMaxTokens - reduction;
            
            // Calculate minimum limit (10% of base limit)
            int64_t minLimit = std::max(static_cast<int64_t>((baseMaxTokens + 9) / 10), static_cast<int64_t>(1));
            return std::max(newLimit, minLimit);
        }
    };

    std::unique_ptr<DistributedStorage> distributedStorage;
    Entry* entries;
    std::atomic<Entry*> entriesPtr;
    std::atomic<size_t> entryCount{0};

    static constexpr size_t nextPowerOf2(size_t v) noexcept {
        return v == 0 ? 1 : size_t(1) << (sizeof(size_t) * 8 - __builtin_clzll(v - 1));
    }

    static size_t murmur3_32(const std::string& key) noexcept {
        const uint32_t seed = 0x12345678;
        const uint32_t c1 = 0xcc9e2d51;
        const uint32_t c2 = 0x1b873593;
        const size_t len = key.length();

        // Optimize for small keys (most common case)
        if (len <= 4) {
            uint32_t h = seed;
            const uint8_t* data = reinterpret_cast<const uint8_t*>(key.data());
            
            // Process bytes directly for small keys
            for (size_t i = 0; i < len; ++i) {
                h ^= uint32_t(data[i]) << ((i & 3) * 8);
            }
            
            h ^= len;
            return static_cast<size_t>(fmix32(h));
        }

        const uint32_t* blocks = reinterpret_cast<const uint32_t*>(key.data());
        const size_t nblocks = len / 4;
        
        uint32_t h1 = seed;
        
        // Body
        for(size_t i = 0; i < nblocks; i++) {
            uint32_t k1 = blocks[i];
            
            k1 *= c1;
            k1 = rotl32(k1, 15);
            k1 *= c2;
            
            h1 ^= k1;
            h1 = rotl32(h1, 13);
            h1 = h1 * 5 + 0xe6546b64;
        }
        
        // Tail
        const uint8_t* tail = reinterpret_cast<const uint8_t*>(key.data() + nblocks * 4);
        uint32_t k1 = 0;
        
        switch(len & 3) {
            case 3: k1 ^= tail[2] << 16; [[fallthrough]];
            case 2: k1 ^= tail[1] << 8;  [[fallthrough]];
            case 1: k1 ^= tail[0];
                   k1 *= c1; k1 = rotl32(k1, 15); k1 *= c2; h1 ^= k1;
        };
        
        h1 ^= len;
        h1 = fmix32(h1);
        
        return static_cast<size_t>(h1);
    }

    static int64_t getCurrentTimeMs() noexcept {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()
        ).count();
    }

    void refillTokens(Entry& entry) noexcept {
        int64_t now = getCurrentTimeMs();
        int64_t lastRefill;
        int64_t currentTokens;
        int64_t dynamicLimit;

        do {
            lastRefill = entry.lastRefill.load(std::memory_order_acquire);
            int64_t timePassed = now - lastRefill;

            if (timePassed < entry.refillTimeMs && !entry.isSlidingWindow) {
                return;
            }

            // Calculate dynamic limit first to ensure consistency
            dynamicLimit = entry.calculateDynamicLimit();
            currentTokens = entry.tokens.load(std::memory_order_acquire);

            // For sliding window, calculate exact token amount without floating point
            if (entry.isSlidingWindow) {
                // Use integer arithmetic to avoid floating point errors
                int64_t tokensToAdd = (dynamicLimit * timePassed) / entry.refillTimeMs;
                int64_t newTokens = std::min(currentTokens + tokensToAdd, dynamicLimit);
                
                if (entry.lastRefill.compare_exchange_strong(lastRefill, now,
                    std::memory_order_acq_rel, std::memory_order_acquire)) {
                    entry.dynamicMaxTokens.store(dynamicLimit, std::memory_order_release);
                    entry.tokens.store(newTokens, std::memory_order_release);
                    
                    // Sync sliding window refill with distributed storage
                    if (distributedStorage && !entry.distributedKey.empty() && tokensToAdd > 0) {
                        try {
                            // Release tokens back to distributed storage (effectively adding them)
                            distributedStorage->release(entry.distributedKey, tokensToAdd);
                        } catch (...) {
                            // Ignore errors - distributed storage might be temporarily unavailable
                        }
                    }
                    
                    return;
                }
            } else {
                // For fixed window, just reset to dynamic limit
                if (entry.lastRefill.compare_exchange_strong(lastRefill, now,
                    std::memory_order_acq_rel, std::memory_order_acquire)) {
                    entry.dynamicMaxTokens.store(dynamicLimit, std::memory_order_release);
                    entry.tokens.store(dynamicLimit, std::memory_order_release);
                    
                    // Reset distributed storage for fixed window
                    if (distributedStorage && !entry.distributedKey.empty()) {
                        try {
                            distributedStorage->reset(entry.distributedKey, dynamicLimit);
                        } catch (...) {
                            // Ignore errors - distributed storage might be temporarily unavailable
                        }
                    }
                    
                    return;
                }
            }
        } while (true); // Keep trying until we succeed
    }

    bool isBlocked(Entry& entry) noexcept {
        int64_t blockedUntil = entry.blockUntil.load(std::memory_order_acquire);
        if (blockedUntil == 0) return false;
        
        int64_t now = getCurrentTimeMs();
        if (now >= blockedUntil) {
            entry.blockUntil.store(0, std::memory_order_release);
            return false;
        }
        return true;
    }

    Entry* findEntry(const std::string& key) noexcept {
        if (key.empty()) return nullptr;
        
        const size_t h = murmur3_32(key);
        size_t idx = h & BUCKET_MASK.load(std::memory_order_relaxed);
        size_t probes = 0;
        
        // Use prefetch to reduce cache misses
        __builtin_prefetch(&entriesPtr.load(std::memory_order_relaxed)[idx], 0, 0);
        
        // Unroll the loop for better performance
        while (probes < BUCKET_COUNT.load(std::memory_order_relaxed)) {
            Entry& entry = entriesPtr.load(std::memory_order_relaxed)[idx];
            bool isValid = entry.valid.load(std::memory_order_relaxed);
            if (!isValid) return nullptr;
            if (entry.key == key) return &entry;
            
            idx = (idx + 1) & BUCKET_MASK.load(std::memory_order_relaxed);
            probes++;
            
            // Prefetch next entry
            __builtin_prefetch(&entriesPtr.load(std::memory_order_relaxed)[idx], 0, 0);
            
            // Early exit if we've probed too far
            if (probes > 8) {  // Most collisions are resolved within 8 probes
                size_t jumpSize = (h >> 16) | 1;  // Use high bits for jump size
                idx = (idx + jumpSize) & BUCKET_MASK.load(std::memory_order_relaxed);
            }
        }
        return nullptr;
    }

    void resize() noexcept {
        if (isResizing.exchange(true)) return;
        
        size_t oldSize = BUCKET_COUNT.load(std::memory_order_relaxed);
        size_t newSize = oldSize * 2;
        Entry* newEntries = new Entry[newSize];
        
        // Rehash existing entries
        Entry* oldEntries = entriesPtr.load(std::memory_order_relaxed);
        for (size_t i = 0; i < oldSize; i++) {
            Entry& entry = oldEntries[i];
            if (!entry.valid.load(std::memory_order_relaxed)) continue;
            
            const size_t h = murmur3_32(entry.key);
            size_t idx = h & (newSize - 1);
            
            while (newEntries[idx].valid.load(std::memory_order_relaxed)) {
                idx = (idx + 1) & (newSize - 1);
            }
            
            newEntries[idx] = std::move(entry);
        }
        
        BUCKET_COUNT.store(newSize, std::memory_order_release);
        BUCKET_MASK.store(newSize - 1, std::memory_order_release);
        Entry* old = entriesPtr.exchange(newEntries, std::memory_order_acq_rel);
        delete[] old;
        isResizing.store(false, std::memory_order_release);
    }

    struct RateLimitInfo {
        int64_t limit;
        int64_t remaining;
        int64_t reset;
        bool blocked;
        int64_t retryAfter;
    };

    struct Metrics {
        std::atomic<uint64_t> totalRequests{0};
        std::atomic<uint64_t> allowedRequests{0};
        std::atomic<uint64_t> blockedRequests{0};
        std::atomic<uint64_t> penalizedRequests{0};
    } metrics;

    // IP whitelist/blacklist using atomic shared pointers for lock-free updates
    std::shared_ptr<std::unordered_set<std::string>> ipWhitelist;
    std::shared_ptr<std::unordered_set<std::string>> ipBlacklist;

    // Time unit parser
    static int64_t parseTimeUnit(const std::string& duration) noexcept {
        if (duration.empty()) return 0;
        
        try {
            size_t idx;
            double value = std::stod(duration, &idx);
            std::string unit = duration.substr(idx);
            
            // Convert to lowercase for case-insensitive comparison
            std::transform(unit.begin(), unit.end(), unit.begin(), ::tolower);
            
            if (unit == "ms" || unit == "milliseconds" || unit == "millisecond") {
                return static_cast<int64_t>(value);
            } else if (unit == "s" || unit == "sec" || unit == "seconds" || unit == "second") {
                return static_cast<int64_t>(value * 1000);
            } else if (unit == "m" || unit == "min" || unit == "minutes" || unit == "minute") {
                return static_cast<int64_t>(value * 60 * 1000);
            } else if (unit == "h" || unit == "hr" || unit == "hours" || unit == "hour") {
                return static_cast<int64_t>(value * 60 * 60 * 1000);
            } else if (unit == "d" || unit == "day" || unit == "days") {
                return static_cast<int64_t>(value * 24 * 60 * 60 * 1000);
            }
            
            // If no unit specified, assume milliseconds
            return static_cast<int64_t>(value);
        } catch (...) {
            return 0;
        }
    }

    // Overloaded createLimiter with string duration support
    void createLimiter(const std::string& key, int64_t maxTokens, const std::string& refillTime,
                      bool useSlidingWindow = false, const std::string& blockDuration = "",
                      int64_t maxPenaltyPoints = 0, const std::string& distributedKey = "") {
        int64_t refillTimeMs = parseTimeUnit(refillTime);
        int64_t blockDurationMs = parseTimeUnit(blockDuration);
        
        if (refillTimeMs <= 0) {
            throw std::invalid_argument("Invalid refill time duration: " + refillTime);
        }
        
        createLimiter(key, maxTokens, refillTimeMs, useSlidingWindow, blockDurationMs,
                     maxPenaltyPoints, distributedKey);
    }

public:
    explicit RateLimiter(size_t bucketCount = 16384, DistributedStorage* storage = nullptr)
        : BUCKET_COUNT(nextPowerOf2(std::max(size_t(1024), bucketCount))),
          BUCKET_MASK(BUCKET_COUNT.load(std::memory_order_relaxed) - 1),
          distributedStorage(storage) {
        entries = new Entry[BUCKET_COUNT.load(std::memory_order_relaxed)];
        entriesPtr.store(entries, std::memory_order_release);
    }

    ~RateLimiter() {
        delete[] entriesPtr.load(std::memory_order_acquire);
    }

    void createLimiter(const std::string& key, int64_t maxTokens, int64_t refillTimeMs,
                      bool useSlidingWindow = false, int64_t blockDurationMs = 0,
                      int64_t maxPenaltyPoints = 0, const std::string& distributedKey = "") {
        if (key.empty()) {
            throw std::invalid_argument("Key cannot be empty");
        }
        if (maxTokens < 0) {
            throw std::invalid_argument("maxTokens cannot be negative");
        }
        if (refillTimeMs <= 0) {
            throw std::invalid_argument("refillTimeMs must be positive");
        }
        if (blockDurationMs < 0) {
            throw std::invalid_argument("blockDurationMs cannot be negative");
        }

        const size_t h = murmur3_32(key);
        size_t idx = h & BUCKET_MASK.load(std::memory_order_relaxed);
        size_t probes = 0;
        size_t firstInvalidIdx = SIZE_MAX;

        while (true) {
            Entry& entry = entriesPtr.load(std::memory_order_relaxed)[idx];
            bool isValid = entry.valid.load(std::memory_order_relaxed);
            
            if (!isValid && firstInvalidIdx == SIZE_MAX) {
                firstInvalidIdx = idx;
            }
            
            if (isValid && entry.key == key) {
                entry = Entry(key, maxTokens, refillTimeMs, useSlidingWindow,
                            blockDurationMs, maxPenaltyPoints, distributedKey);
                return;
            }
            
            idx = (idx + 1) & BUCKET_MASK.load(std::memory_order_relaxed);
            probes++;
            
            if (probes >= BUCKET_COUNT.load(std::memory_order_relaxed)) {
                if (firstInvalidIdx != SIZE_MAX) {
                    entriesPtr.load(std::memory_order_relaxed)[firstInvalidIdx] = 
                        Entry(key, maxTokens, refillTimeMs, useSlidingWindow,
                              blockDurationMs, maxPenaltyPoints, distributedKey);
                    entryCount.fetch_add(1, std::memory_order_relaxed);
                    return;
                }
                resize();
                idx = h & BUCKET_MASK.load(std::memory_order_relaxed);
                probes = 0;
                firstInvalidIdx = SIZE_MAX;
            }
        }
    }

    bool tryRequest(const std::string& key, const std::string& ip = "") noexcept {
        metrics.totalRequests.fetch_add(1, std::memory_order_relaxed);

        // Check IP blacklist/whitelist
        if (!ip.empty()) {
            if (isBlacklisted(ip)) {
                metrics.blockedRequests.fetch_add(1, std::memory_order_relaxed);
                return false;
            }
            if (isWhitelisted(ip)) {
                metrics.allowedRequests.fetch_add(1, std::memory_order_relaxed);
                return true;
            }
        }

        Entry* entry = findEntry(key);
        if (!entry || !entry->valid.load(std::memory_order_acquire)) {
            metrics.blockedRequests.fetch_add(1, std::memory_order_relaxed);
            return false;
        }

        // Check if blocked
        int64_t now = getCurrentTimeMs();
        int64_t blockedUntil = entry->blockUntil.load(std::memory_order_acquire);
        if (blockedUntil > now) {
            metrics.blockedRequests.fetch_add(1, std::memory_order_relaxed);
            return false;
        }

        // Try to refill tokens
        refillTokens(*entry);

        // If we have distributed storage and a distributed key is set, check it first
        if (distributedStorage && !entry->distributedKey.empty()) {
            try {
                if (!distributedStorage->tryAcquire(entry->distributedKey, entry->dynamicMaxTokens.load(std::memory_order_acquire))) {
                    metrics.blockedRequests.fetch_add(1, std::memory_order_relaxed);
                    return false;
                }
            } catch (...) {
                // If Redis fails, we'll just use local rate limiting
                // This is a design choice - we could also choose to block in this case
            }
        }

        // Try to consume a local token
        int64_t currentTokens;
        do {
            currentTokens = entry->tokens.load(std::memory_order_acquire);
            if (currentTokens <= 0) {
                // If we acquired a distributed token but failed locally, release it
                if (distributedStorage && !entry->distributedKey.empty()) {
                    try {
                        distributedStorage->release(entry->distributedKey, 1);
                    } catch (...) {
                        // Ignore Redis errors here
                    }
                }
                // Set block duration if specified
                if (entry->blockDurationMs > 0) {
                    entry->blockUntil.store(now + entry->blockDurationMs, std::memory_order_release);
                }
                metrics.blockedRequests.fetch_add(1, std::memory_order_relaxed);
                return false;
            }
        } while (!entry->tokens.compare_exchange_weak(currentTokens, currentTokens - 1,
                std::memory_order_acq_rel, std::memory_order_acquire));

        metrics.allowedRequests.fetch_add(1, std::memory_order_relaxed);
        if (entry->penaltyPoints.load(std::memory_order_relaxed) > 0) {
            metrics.penalizedRequests.fetch_add(1, std::memory_order_relaxed);
        }
        return true;
    }

    int64_t getTokens(const std::string& key) noexcept {
        auto entry = findEntry(key);
        if (!entry || !entry->valid.load(std::memory_order_relaxed)) {
            return -1;
        }
        return entry->tokens.load(std::memory_order_relaxed);
    }

    void removeLimiter(const std::string& key) noexcept {
        if (auto entry = findEntry(key)) {
            if (entry->valid.exchange(false, std::memory_order_acq_rel)) {
                entryCount.fetch_sub(1, std::memory_order_relaxed);
            }
        }
    }

    // Add penalty points to reduce rate limit
    void addPenalty(const std::string& key, int64_t points) noexcept {
        if (auto entry = findEntry(key)) {
            if (entry->maxPenaltyPoints > 0) {
                entry->penaltyPoints.fetch_add(points, std::memory_order_relaxed);
                // Update dynamic limit immediately
                int64_t dynamicLimit = entry->calculateDynamicLimit();
                entry->dynamicMaxTokens.store(dynamicLimit, std::memory_order_release);
            }
        }
    }

    // Remove penalty points to restore rate limit
    void removePenalty(const std::string& key, int64_t points) noexcept {
        if (auto entry = findEntry(key)) {
            if (entry->maxPenaltyPoints > 0) {
                int64_t current = entry->penaltyPoints.load(std::memory_order_relaxed);
                while (current > 0) {
                    int64_t newValue = std::max(int64_t(0), current - points);
                    if (entry->penaltyPoints.compare_exchange_weak(
                        current, newValue,
                        std::memory_order_relaxed, std::memory_order_relaxed)) {
                        // Update dynamic limit immediately
                        int64_t dynamicLimit = entry->calculateDynamicLimit();
                        entry->dynamicMaxTokens.store(dynamicLimit, std::memory_order_release);
                        break;
                    }
                }
            }
        }
    }

    // Get current rate limit including dynamic adjustments
    int64_t getCurrentLimit(const std::string& key) noexcept {
        if (auto entry = findEntry(key)) {
            return entry->dynamicMaxTokens.load(std::memory_order_relaxed);
        }
        return -1;
    }

    // HTTP integration methods
    RateLimitInfo getRateLimitInfo(const std::string& key) noexcept {
        Entry* entry = findEntry(key);
        if (!entry || !entry->valid.load(std::memory_order_acquire)) {
            return RateLimitInfo{0, 0, 0, false, 0};
        }
        
        // Refill tokens first to get accurate count
        refillTokens(*entry);
        
        int64_t dynamicLimit = entry->calculateDynamicLimit();
        int64_t currentTokens = entry->tokens.load(std::memory_order_acquire);
        int64_t blockedUntil = entry->blockUntil.load(std::memory_order_acquire);
        int64_t now = getCurrentTimeMs();
        
        bool blocked = blockedUntil > now;
        int64_t retryAfter = blocked ? (blockedUntil - now) / 1000 : 0;
        
        // If we're blocked, remaining should be 0
        if (blocked) {
            currentTokens = 0;
        }
        
        // Calculate reset time
        int64_t lastRefill = entry->lastRefill.load(std::memory_order_acquire);
        int64_t reset = lastRefill + entry->refillTimeMs;
        
        return RateLimitInfo{
            dynamicLimit,
            std::max(int64_t(0), currentTokens),
            reset,
            blocked,
            retryAfter
        };
    }

    // IP whitelist/blacklist management
    void addToWhitelist(const std::string& ip) {
        auto current = ipWhitelist;
        if (!current) {
            current = std::make_shared<std::unordered_set<std::string>>();
        }
        auto updated = std::make_shared<std::unordered_set<std::string>>(*current);
        updated->insert(ip);
        ipWhitelist = updated;
    }

    void addToBlacklist(const std::string& ip) {
        auto current = ipBlacklist;
        if (!current) {
            current = std::make_shared<std::unordered_set<std::string>>();
        }
        auto updated = std::make_shared<std::unordered_set<std::string>>(*current);
        updated->insert(ip);
        ipBlacklist = updated;
    }

    void removeFromWhitelist(const std::string& ip) {
        auto current = ipWhitelist;
        if (!current) return;
        auto updated = std::make_shared<std::unordered_set<std::string>>(*current);
        updated->erase(ip);
        ipWhitelist = updated;
    }

    void removeFromBlacklist(const std::string& ip) {
        auto current = ipBlacklist;
        if (!current) return;
        auto updated = std::make_shared<std::unordered_set<std::string>>(*current);
        updated->erase(ip);
        ipBlacklist = updated;
    }

    bool isWhitelisted(const std::string& ip) const noexcept {
        auto list = ipWhitelist;
        return list && list->count(ip) > 0;
    }

    bool isBlacklisted(const std::string& ip) const noexcept {
        auto list = ipBlacklist;
        return list && list->count(ip) > 0;
    }

    // Monitoring methods
    struct MonitoringStats {
        uint64_t totalRequests;
        uint64_t allowedRequests;
        uint64_t blockedRequests;
        uint64_t penalizedRequests;
        double allowRate;
        double blockRate;
        double penaltyRate;
    };

    MonitoringStats getStats() const noexcept {
        uint64_t total = metrics.totalRequests.load(std::memory_order_relaxed);
        uint64_t allowed = metrics.allowedRequests.load(std::memory_order_relaxed);
        uint64_t blocked = metrics.blockedRequests.load(std::memory_order_relaxed);
        uint64_t penalized = metrics.penalizedRequests.load(std::memory_order_relaxed);
        
        return MonitoringStats{
            total,
            allowed,
            blocked,
            penalized,
            total > 0 ? static_cast<double>(allowed) / total : 0.0,
            total > 0 ? static_cast<double>(blocked) / total : 0.0,
            total > 0 ? static_cast<double>(penalized) / total : 0.0
        };
    }

    // Reset monitoring stats
    void resetStats() noexcept {
        metrics.totalRequests.store(0, std::memory_order_relaxed);
        metrics.allowedRequests.store(0, std::memory_order_relaxed);
        metrics.blockedRequests.store(0, std::memory_order_relaxed);
        metrics.penalizedRequests.store(0, std::memory_order_relaxed);
    }
}; 