const { HyperLimit } = require('../');

async function example() {
    const TOTAL_LIMIT = 100; // Total allowed requests across all servers
    const WINDOW_MS = 60000;  // 1 minute window
    
    // Create two HyperLimit instances with Redis support (simulating two servers)
    const limiter1 = new HyperLimit({
        bucketCount: 16384,
        redis: {
            host: 'localhost',
            port: 6379,
            prefix: 'rl:'
        }
    });

    const limiter2 = new HyperLimit({
        bucketCount: 16384,
        redis: {
            host: 'localhost',
            port: 6379,
            prefix: 'rl:'
        }
    });

    // Configure rate limiters with the total limit each locally,
    // but share the same distributed key for global coordination
    limiter1.createLimiter('api:endpoint1', TOTAL_LIMIT, WINDOW_MS, true, 0, 0, 'api:endpoint1:global');
    limiter2.createLimiter('api:endpoint1', TOTAL_LIMIT, WINDOW_MS, true, 0, 0, 'api:endpoint1:global');

    console.log('Simulating distributed rate limiting across servers...\n');
    console.log(`Total limit across all servers: ${TOTAL_LIMIT} requests\n`);

    // Server 1 makes 80 requests first
    console.log('Server 1 requests:');
    let server1Allowed = 0;
    for (let i = 0; i < 80; i++) {
        const allowed = limiter1.tryRequest('api:endpoint1');
        if (allowed) server1Allowed++;
        if (i % 10 === 9) {
            console.log(`Requests ${i-9}-${i}: ${server1Allowed} allowed, ${10-server1Allowed} blocked`);
            server1Allowed = 0;
        }
    }

    // Server 2 tries to make requests after Server 1
    console.log('\nServer 2 requests:');
    let server2Allowed = 0;
    for (let i = 0; i < 80; i++) {
        const allowed = limiter2.tryRequest('api:endpoint1');
        if (allowed) server2Allowed++;
        if (i % 10 === 9) {
            console.log(`Requests ${i-9}-${i}: ${server2Allowed} allowed, ${10-server2Allowed} blocked`);
            server2Allowed = 0;
        }
    }

    // Get remaining tokens
    const limiter1Info = limiter1.getRateLimitInfo('api:endpoint1');
    const limiter2Info = limiter2.getRateLimitInfo('api:endpoint1');
    
    console.log('\nRemaining tokens:');
    console.log('- Server 1 (local):', limiter1Info.remaining);
    console.log('- Server 2 (local):', limiter2Info.remaining);

    // Wait a bit to let Redis connections close gracefully
    await new Promise(resolve => setTimeout(resolve, 100));
}

// Run the example
example().catch(console.error); 