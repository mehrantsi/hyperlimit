const { HyperLimit } = require('../');
const assert = require('assert');

describe('HyperLimit Core Features', () => {
    let limiter;

    beforeEach(() => {
        limiter = new HyperLimit();
    });

    describe('Token Bucket Algorithm', () => {
        it('should limit requests according to rate', async () => {
            limiter.createLimiter('test', 3, 2000); // 3 tokens per 2 seconds
            
            assert(limiter.tryRequest('test'), 'First request should succeed');
            assert(limiter.tryRequest('test'), 'Second request should succeed');
            assert(limiter.tryRequest('test'), 'Third request should succeed');
            
            // Fourth request should be blocked
            assert(!limiter.tryRequest('test'), 'Fourth request should be blocked');
            
            // Wait for refill with some buffer
            await new Promise(resolve => setTimeout(resolve, 2200)); // Wait slightly more than 2 seconds
            
            // Should be allowed after refill
            assert(limiter.tryRequest('test'), 'Request after refill should succeed');
        });

        it('should handle multiple keys independently', () => {
            limiter.createLimiter('key1', 2, 1000);
            limiter.createLimiter('key2', 3, 1000);
            
            assert(limiter.tryRequest('key1'));
            assert(limiter.tryRequest('key1'));
            assert(!limiter.tryRequest('key1')); // key1 blocked
            
            assert(limiter.tryRequest('key2'));
            assert(limiter.tryRequest('key2'));
            assert(limiter.tryRequest('key2'));
            assert(!limiter.tryRequest('key2')); // key2 blocked
        });
    });

    describe('Sliding Window Algorithm', () => {
        it('should implement sliding window rate limiting', async () => {
            limiter.createLimiter('sliding', 10, 1000, true); // 10 tokens/sec with sliding window
            
            // Use all tokens
            for (let i = 0; i < 10; i++) {
                assert(limiter.tryRequest('sliding'));
            }
            assert(!limiter.tryRequest('sliding')); // Should be blocked
            
            // Wait 500ms - should get back ~5 tokens
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Should have ~5 tokens available
            assert(limiter.tryRequest('sliding'));
            assert(limiter.tryRequest('sliding'));
            assert(limiter.tryRequest('sliding'));
            assert(limiter.tryRequest('sliding'));
            assert(limiter.tryRequest('sliding'));
            assert(!limiter.tryRequest('sliding')); // Should be blocked
        });
    });

    describe('Block Duration', () => {
        it('should block requests for specified duration', async () => {
            limiter.createLimiter('block', 2, 1000, false, 500); // 2 tokens/sec, 0.5s block
            
            assert(limiter.tryRequest('block'));
            assert(limiter.tryRequest('block'));
            assert(!limiter.tryRequest('block')); // Exceeded limit, triggers block
            
            // Wait 250ms - still should be blocked
            await new Promise(resolve => setTimeout(resolve, 250));
            assert(!limiter.tryRequest('block'));
            
            // Wait another 300ms - block should be lifted
            await new Promise(resolve => setTimeout(resolve, 300));
            assert(limiter.tryRequest('block'));
        }).timeout(1000); // Set timeout to 1s
    });

    describe('Dynamic Rate Limits', () => {
        it('should adjust rate limits based on penalty points', () => {
            limiter.createLimiter('dynamic', 100, 1000, false, 0, 10); // max 10 penalty points
            
            // Initial state
            assert.equal(limiter.getCurrentLimit('dynamic'), 100);
            
            // Add penalty points
            limiter.addPenalty('dynamic', 5); // 50% reduction
            assert.equal(limiter.getCurrentLimit('dynamic'), 50);
            
            // Add more penalty points
            limiter.addPenalty('dynamic', 5); // 100% reduction (capped at 90%)
            assert.equal(limiter.getCurrentLimit('dynamic'), 10);
            
            // Remove penalty points
            limiter.removePenalty('dynamic', 7);
            assert.equal(limiter.getCurrentLimit('dynamic'), 70); // 3 points = 30% reduction
        });
    });

    describe('Rate Limit Info', () => {
        it('should provide rate limit information', async () => {
            // Use a larger window to avoid race conditions with token refills
            limiter.createLimiter('info', 5, 5000, false, 2000);
            
            const initial = limiter.getRateLimitInfo('info');
            assert.equal(initial.limit, 5);
            assert.equal(initial.remaining, 5);
            assert(!initial.blocked);
            
            // Make requests in quick succession
            for (let i = 0; i < 5; i++) {
                limiter.tryRequest('info');
            }
            
            // This should trigger block since we used all tokens
            limiter.tryRequest('info');
            
            const blocked = limiter.getRateLimitInfo('info');
            assert(blocked.blocked, 'Expected to be blocked after using all tokens');
            assert(blocked.retryAfter, 'Expected retryAfter to be set when blocked');
            assert(blocked.remaining === 0, 'Expected no remaining tokens');
        });
    });

    describe('Monitoring', () => {
        it('should track request statistics', () => {
            limiter.createLimiter('stats', 3, 1000);
            
            limiter.tryRequest('stats'); // allowed
            limiter.tryRequest('stats'); // allowed
            limiter.tryRequest('stats'); // allowed
            limiter.tryRequest('stats'); // blocked
            
            const stats = limiter.getStats();
            assert.equal(stats.totalRequests, 4);
            assert.equal(stats.allowedRequests, 3);
            assert.equal(stats.blockedRequests, 1);
            assert.equal(stats.allowRate, 0.75);
            assert.equal(stats.blockRate, 0.25);
            
            limiter.resetStats();
            const reset = limiter.getStats();
            assert.equal(reset.totalRequests, 0);
        });
    });

    describe('IP Whitelist/Blacklist', () => {
        it('should handle IP-based access control', () => {
            limiter.createLimiter('ip', 1, 1000);
            
            // Whitelist
            limiter.addToWhitelist('1.2.3.4');
            assert(limiter.isWhitelisted('1.2.3.4'));
            assert(limiter.tryRequest('ip', '1.2.3.4')); // Always allowed
            assert(limiter.tryRequest('ip', '1.2.3.4')); // Still allowed despite limit
            
            // Blacklist
            limiter.addToBlacklist('5.6.7.8');
            assert(limiter.isBlacklisted('5.6.7.8'));
            assert(!limiter.tryRequest('ip', '5.6.7.8')); // Always blocked
            
            // Remove from lists
            limiter.removeFromWhitelist('1.2.3.4');
            limiter.removeFromBlacklist('5.6.7.8');
            assert(!limiter.isWhitelisted('1.2.3.4'));
            assert(!limiter.isBlacklisted('5.6.7.8'));
        });
    });
}); 