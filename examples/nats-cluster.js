const { HyperLimit } = require('../');

async function example() {
    const TOTAL_LIMIT = 1000; // Total allowed requests across all servers
    const WINDOW_MS = 60000;  // 1 minute window
    
    // Create multiple HyperLimit instances with NATS cluster support
    // Each instance connects to different NATS servers in the cluster
    const limiters = [];
    
    // Simulating 3 application servers
    for (let i = 0; i < 3; i++) {
        const limiter = new HyperLimit({
            bucketCount: 16384,
            nats: {
                servers: [
                    'nats://localhost:4222',
                    'nats://localhost:4223',
                    'nats://localhost:4224'
                ],
                bucket: 'rate-limits',
                prefix: 'rl_'
            }
        });
        
        // Configure rate limiter with distributed key
        limiter.createLimiter('api:v1:users', TOTAL_LIMIT, WINDOW_MS, true, 0, 0, 'api:v1:users:global');
        limiters.push(limiter);
    }

    console.log('Simulating distributed rate limiting with NATS cluster...\n');
    console.log(`Total limit across all servers: ${TOTAL_LIMIT} requests`);
    console.log(`Number of application servers: ${limiters.length}\n`);

    // Simulate concurrent requests from all servers
    const results = await Promise.all(
        limiters.map(async (limiter, serverIndex) => {
            let allowed = 0;
            let blocked = 0;
            
            // Each server makes 400 requests
            for (let i = 0; i < 400; i++) {
                if (limiter.tryRequest('api:v1:users')) {
                    allowed++;
                } else {
                    blocked++;
                }
                
                // Add some random delay to simulate real-world timing
                if (i % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
                }
            }
            
            return { serverIndex, allowed, blocked };
        })
    );

    // Display results
    console.log('Results by server:');
    let totalAllowed = 0;
    let totalBlocked = 0;
    
    results.forEach(({ serverIndex, allowed, blocked }) => {
        console.log(`- Server ${serverIndex + 1}: ${allowed} allowed, ${blocked} blocked`);
        totalAllowed += allowed;
        totalBlocked += blocked;
    });
    
    console.log(`\nTotal across all servers: ${totalAllowed} allowed, ${totalBlocked} blocked`);
    console.log(`Expected total allowed: ${TOTAL_LIMIT} (actual: ${totalAllowed})`);

    // Verify rate limiting consistency
    if (Math.abs(totalAllowed - TOTAL_LIMIT) <= 3) { // Allow small margin for race conditions
        console.log('\n✅ Rate limiting is working correctly across the cluster!');
    } else {
        console.log('\n❌ Rate limiting inconsistency detected!');
    }

    // Wait a bit to let NATS connections close gracefully
    await new Promise(resolve => setTimeout(resolve, 100));
}

// Run the example
example().catch(err => {
    console.error('Error:', err.message);
    console.error('\nMake sure NATS cluster is running. For testing, you can use:');
    console.error('  docker run -p 4222:4222 nats:latest -js');
    console.error('\nFor a real cluster setup, see: https://docs.nats.io/running-a-nats-service/configuration/clustering');
    process.exit(1);
});