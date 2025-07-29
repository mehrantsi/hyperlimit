import { join } from 'path';

// Define interfaces for the native module
interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
    blocked: boolean;
    retryAfter?: string;
}

interface MonitoringStats {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    penalizedRequests: number;
    allowRate: number;
    blockRate: number;
    penaltyRate: number;
}

interface RedisOptions {
    host?: string;
    port?: number;
    prefix?: string;
}

interface NatsOptions {
    servers?: string | string[];
    bucket?: string;
    prefix?: string;
    credentials?: string;
}

interface HyperLimitOptions {
    bucketCount?: number;
    redis?: RedisOptions;
    nats?: NatsOptions;
}

interface HyperLimitNative {
    HyperLimit: {
        new(options?: HyperLimitOptions): {
            createLimiter(key: string, maxTokens: number, refillTimeMs: number, useSlidingWindow?: boolean, blockDurationMs?: number, maxPenaltyPoints?: number, distributedKey?: string): void;
            tryRequest(key: string, ip?: string): boolean;
            removeLimiter(key: string): void;
            getTokens(key: string): number;
            getCurrentLimit(key: string): number;
            getRateLimitInfo(key: string): RateLimitInfo;
            addPenalty(key: string, points: number): void;
            removePenalty(key: string, points: number): void;
            addToWhitelist(ip: string): void;
            addToBlacklist(ip: string): void;
            removeFromWhitelist(ip: string): void;
            removeFromBlacklist(ip: string): void;
            isWhitelisted(ip: string): boolean;
            isBlacklisted(ip: string): boolean;
            getStats(): MonitoringStats;
            resetStats(): void;
        };
    };
}

// Define the distributed storage interface
export abstract class DistributedStorage {
    abstract tryAcquire(key: string, tokens: number): Promise<boolean>;
    abstract release(key: string, tokens: number): Promise<void>;
}

// Load the native module
let nativeModule: HyperLimitNative;
try {
    nativeModule = require(join(__dirname, '..', 'build', 'Release', 'hyperlimit.node'));
} catch (err) {
    throw new Error(`Failed to load native module: ${err}`);
}

// Export the native module and DistributedStorage
export const HyperLimit = nativeModule.HyperLimit;
export type { RateLimitInfo, MonitoringStats, HyperLimitOptions, RedisOptions, NatsOptions }; 