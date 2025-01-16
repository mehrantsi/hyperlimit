const assert = require('assert');
const { HyperLimit } = require('../');

describe('RateLimiter Edge Cases', () => {
    let limiter;

    beforeEach(() => {
        limiter = new HyperLimit();
    });

    it('should handle token refill correctly', async () => {
        limiter.createLimiter('test-refill', 5, 1000); // 5 tokens per second
        
        // Use all tokens
        for (let i = 0; i < 5; i++) {
            assert(limiter.tryRequest('test-refill'), `Request ${i + 1} should succeed`);
        }
        
        // Next request should fail
        assert(!limiter.tryRequest('test-refill'), 'Request should fail after using all tokens');
        
        // Wait for refill
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        // Should have tokens again
        assert(limiter.tryRequest('test-refill'), 'Request should succeed after refill');
    });

    it('should handle penalty points correctly', () => {
        limiter.createLimiter('test-penalty', 10, 1000, false, 0, 5); // 10 tokens/sec, max 5 penalty points
        
        // Add more penalty points than maxPenalty
        limiter.addPenalty('test-penalty', 10);
        
        // Check rate limit info
        const info = limiter.getRateLimitInfo('test-penalty');
        
        // Penalty should be capped at maxPenalty (5)
        // With 5 penalty points (max), we reduce by 90% (capped), so limit should be 1 (10% of 10)
        assert.equal(info.limit, 1); // 10 * (1 - 5/5 * 0.9) = 1 (minimum 10%)
    });

    it('should handle sliding window precision', async () => {
        limiter.createLimiter('test-sliding', 10, 1000, true); // 10 tokens/sec with sliding window
        
        // Use half the tokens
        for (let i = 0; i < 5; i++) {
            assert(limiter.tryRequest('test-sliding'));
        }
        
        // Wait for half window
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Check tokens - should have refilled about half
        const info = limiter.getRateLimitInfo('test-sliding');
        assert(info.remaining >= 7); // At least 7 tokens (5 used, ~2-3 refilled)
    });

    it('should handle memory ordering in updates', () => {
        limiter.createLimiter('test-ordering', 5, 1000); // 5 tokens/sec
        
        // Parallel requests
        const results = [];
        for (let i = 0; i < 5; i++) {
            results.push(limiter.tryRequest('test-ordering'));
        }
        
        // All should have consistent results
        const successes = results.filter(r => r).length;
        assert.equal(successes, 5);
        
        // Next request should fail
        assert(!limiter.tryRequest('test-ordering'));
    });
}); 