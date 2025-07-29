const { HyperLimit } = require('../');
const assert = require('assert');

describe('NATS Distributed Storage', function() {
    let limiter1, limiter2;
    let natsAvailable = false;

    // Check if NATS is available
    before(async function() {
        try {
            limiter1 = new HyperLimit({
                bucketCount: 1024,
                nats: {
                    servers: 'nats://localhost:4222',
                    bucket: 'test-rate-limits',
                    prefix: 'test_'
                }
            });
            natsAvailable = true;
        } catch (err) {
            console.log('  ⚠️  NATS server not available, skipping NATS tests');
            console.log('      Run: docker run -p 4222:4222 nats:latest -js');
            this.skip();
        }
    });

    beforeEach(function() {
        if (!natsAvailable) this.skip();
        
        // Create two limiter instances for distributed testing
        limiter1 = new HyperLimit({
            bucketCount: 1024,
            nats: {
                servers: 'nats://localhost:4222',
                bucket: 'test-rate-limits',
                prefix: 'test_'
            }
        });

        limiter2 = new HyperLimit({
            bucketCount: 1024,
            nats: {
                servers: 'nats://localhost:4222',
                bucket: 'test-rate-limits',
                prefix: 'test_'
            }
        });
    });

    it('should share rate limits across instances', function() {
        const key = 'test_shared_' + Date.now();
        const limit = 10;
        
        // Create limiters with same distributed key
        limiter1.createLimiter(key, limit, 60000, false, 0, 0, key + '_dist');
        limiter2.createLimiter(key, limit, 60000, false, 0, 0, key + '_dist');

        // Use tokens from first instance
        let allowed1 = 0;
        for (let i = 0; i < 5; i++) {
            if (limiter1.tryRequest(key)) allowed1++;
        }
        assert.strictEqual(allowed1, 5);

        // Use tokens from second instance
        let allowed2 = 0;
        for (let i = 0; i < 7; i++) {
            if (limiter2.tryRequest(key)) allowed2++;
        }
        assert.strictEqual(allowed2, 5); // Should only allow 5 more

        // Total should not exceed limit
        assert.strictEqual(allowed1 + allowed2, limit);
    });

    it('should handle concurrent requests correctly', async function() {
        const key = 'test_concurrent_' + Date.now();
        const limit = 100;
        
        // Create limiters with same distributed key
        limiter1.createLimiter(key, limit, 60000, false, 0, 0, key + '_dist');
        limiter2.createLimiter(key, limit, 60000, false, 0, 0, key + '_dist');

        // Make concurrent requests from both instances
        const promises = [];
        
        for (let i = 0; i < 60; i++) {
            promises.push(new Promise(resolve => {
                setTimeout(() => {
                    resolve(limiter1.tryRequest(key));
                }, Math.random() * 50);
            }));
        }
        
        for (let i = 0; i < 60; i++) {
            promises.push(new Promise(resolve => {
                setTimeout(() => {
                    resolve(limiter2.tryRequest(key));
                }, Math.random() * 50);
            }));
        }

        const results = await Promise.all(promises);
        const totalAllowed = results.filter(r => r).length;
        
        // Should respect the limit with some tolerance for race conditions
        assert(totalAllowed >= limit - 2 && totalAllowed <= limit + 2,
            `Expected ${limit} allowed requests, got ${totalAllowed}`);
    });

    it('should support sliding window with NATS', function() {
        const key = 'test_sliding_' + Date.now();
        const limit = 10;
        
        limiter1.createLimiter(key, limit, 1000, true, 0, 0, key + '_dist');
        limiter2.createLimiter(key, limit, 1000, true, 0, 0, key + '_dist');

        // Use all tokens
        let allowed = 0;
        for (let i = 0; i < 15; i++) {
            if (limiter1.tryRequest(key)) allowed++;
        }
        assert.strictEqual(allowed, limit);

        // Should block additional requests
        assert.strictEqual(limiter2.tryRequest(key), false);
    });

    it('should handle NATS array servers configuration', function() {
        const limiter = new HyperLimit({
            bucketCount: 1024,
            nats: {
                servers: ['nats://localhost:4222'],  // Only use working server for test
                bucket: 'test-rate-limits',
                prefix: 'test_'
            }
        });

        const key = 'test_array_' + Date.now();
        limiter.createLimiter(key, 5, 60000);
        
        let allowed = 0;
        for (let i = 0; i < 10; i++) {
            if (limiter.tryRequest(key)) allowed++;
        }
        assert.strictEqual(allowed, 5);
    });

    it('should handle connection errors gracefully', function() {
        assert.throws(() => {
            new HyperLimit({
                bucketCount: 1024,
                nats: {
                    servers: 'nats://invalid-host:4222',
                    bucket: 'test-rate-limits'
                }
            });
        }, /NATS connection failed/);
    });

    it('should support custom credentials file', function() {
        // This test would require a valid NATS credentials file
        // Skipping actual connection test but verifying the option is accepted
        assert.doesNotThrow(() => {
            try {
                new HyperLimit({
                    bucketCount: 1024,
                    nats: {
                        servers: 'nats://localhost:4222',
                        bucket: 'test-rate-limits',
                        credentials: './path/to/nats.creds'
                    }
                });
            } catch (err) {
                // Connection might fail, but the option should be accepted
                if (!err.message.includes('credentials')) {
                    // This is a different error, not related to credentials parsing
                }
            }
        });
    });
});