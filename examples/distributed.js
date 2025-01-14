const { HyperLimit } = require('../');
const Redis = require('ioredis');

// Redis-based distributed storage implementation
class RedisStorage {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379
        });
    }

    async tryAcquire(key, tokens) {
        const script = `
            local current = redis.call('get', KEYS[1])
            if not current then
                redis.call('set', KEYS[1], ARGV[1])
                return 1
            end
            if tonumber(current) > 0 then
                redis.call('decrby', KEYS[1], 1)
                return 1
            end
            return 0
        `;
        
        const result = await this.redis.eval(
            script,
            1,
            `ratelimit:${key}`,
            tokens
        );
        
        return result === 1;
    }

    async init(key, tokens) {
        await this.redis.set(`ratelimit:${key}`, tokens);
    }
}

// Example usage
async function example() {
    const TOTAL_LIMIT = 100; // Total allowed requests across all servers
    const WINDOW_MS = 60000;  // 1 minute window
    
    // Create distributed rate limiter
    const storage = new RedisStorage();
    
    // Initialize Redis with total limit
    await storage.init('api:endpoint1', TOTAL_LIMIT);

    // Create two HyperLimit instances (simulating two servers)
    const limiter1 = new HyperLimit({ bucketCount: 16384 });
    const limiter2 = new HyperLimit({ bucketCount: 16384 });

    // Configure rate limiters with half the total limit each
    limiter1.createLimiter('api:endpoint1', TOTAL_LIMIT/2, WINDOW_MS, true);
    limiter2.createLimiter('api:endpoint1', TOTAL_LIMIT/2, WINDOW_MS, true);

    console.log('Simulating distributed rate limiting across servers...\n');
    console.log(`Total limit across all servers: ${TOTAL_LIMIT} requests\n`);
    console.log('Each server has a local limit of ${TOTAL_LIMIT/2} requests\n');

    // Server 1
    console.log('Server 1 requests:');
    let server1Allowed = 0;
    for (let i = 0; i < 80; i++) {
        // Check both local and distributed limits
        const localAllowed = limiter1.tryRequest('api:endpoint1');
        const distributedAllowed = await storage.tryAcquire('api:endpoint1', TOTAL_LIMIT);
        const allowed = localAllowed && distributedAllowed;
        
        if (allowed) server1Allowed++;
        if (i % 10 === 9) {
            console.log(`Requests ${i-9}-${i}: ${server1Allowed} allowed, ${10-server1Allowed} blocked`);
            server1Allowed = 0;
        }
    }

    // Server 2
    console.log('\nServer 2 requests:');
    let server2Allowed = 0;
    for (let i = 0; i < 80; i++) {
        // Check both local and distributed limits
        const localAllowed = limiter2.tryRequest('api:endpoint1');
        const distributedAllowed = await storage.tryAcquire('api:endpoint1', TOTAL_LIMIT);
        const allowed = localAllowed && distributedAllowed;
        
        if (allowed) server2Allowed++;
        if (i % 10 === 9) {
            console.log(`Requests ${i-9}-${i}: ${server2Allowed} allowed, ${10-server2Allowed} blocked`);
            server2Allowed = 0;
        }
    }

    // Get remaining tokens
    const redisRemaining = await storage.redis.get('ratelimit:api:endpoint1');
    const limiter1Remaining = limiter1.getTokens('api:endpoint1');
    const limiter2Remaining = limiter2.getTokens('api:endpoint1');
    
    console.log('\nRemaining tokens:');
    console.log('- Redis (global):', redisRemaining);
    console.log('- Server 1 (local):', limiter1Remaining);
    console.log('- Server 2 (local):', limiter2Remaining);

    // Clean up
    await storage.redis.quit();
}

// Run the example
example().catch(console.error); 