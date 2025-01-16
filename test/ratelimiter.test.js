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

describe('Rapid Consecutive Calls', () => {
    it('should handle high-rate burst of requests correctly', async () => {
        const limiter = new HyperLimit();
        const key = 'burst-test';
        const limit = 100;  // 100 req/s
        
        limiter.createLimiter(key, limit, 1000, true); // 100 tokens per second, sliding window
        
        // Try to consume tokens with a burst of 300 requests
        const results = [];
        for (let i = 0; i < 300; i++) {
            results.push(limiter.tryRequest(key));
        }
        
        // First 100 should succeed, next 200 should fail
        assert.equal(results.filter(r => r).length, 100);
        assert.equal(results.filter(r => !r).length, 200);
        
        // Verify remaining tokens
        assert.equal(limiter.getTokens(key), 0);
        
        // Wait 500ms and try another burst
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try another burst of 100 requests
        const results2 = [];
        for (let i = 0; i < 100; i++) {
            results2.push(limiter.tryRequest(key));
        }
        
        // Should get about 50 successes (half window)
        const succeeded = results2.filter(r => r).length;
        assert.ok(succeeded >= 45 && succeeded <= 55, `Expected ~50 successes, got ${succeeded}`);
    });

    it('should maintain precision under rapid sliding window requests', async () => {
        const limiter = new HyperLimit();
        const key = 'sliding-precision';
        const limit = 200;  // 200 req/s
        const refillTime = 1000;
        
        limiter.createLimiter(key, limit, refillTime, true); // 200 tokens per second, sliding window
        
        // Consume all tokens rapidly
        for (let i = 0; i < limit; i++) {
            assert.equal(limiter.tryRequest(key), true);
        }
        assert.equal(limiter.tryRequest(key), false); // Should fail
        
        // Wait 300ms (should restore ~60 tokens)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Try to consume 80 tokens (should get ~60)
        const results = [];
        for (let i = 0; i < 80; i++) {
            results.push(limiter.tryRequest(key));
        }
        
        // Should have allowed around 60 requests (55-65 due to timing)
        const succeeded = results.filter(r => r).length;
        assert.ok(succeeded >= 55 && succeeded <= 65, `Expected ~60 successes, got ${succeeded}`);
    });

    it('should enforce fixed window reset correctly', async () => {
        const limiter = new HyperLimit();
        const key = 'fixed-window';
        const limit = 100;  // 100 req/s
        
        limiter.createLimiter(key, limit, 1000, false); // 100 tokens per second, fixed window
        
        // Consume all tokens with rapid requests
        for (let i = 0; i < limit; i++) {
            assert.equal(limiter.tryRequest(key), true);
        }
        
        // Next request should fail
        assert.equal(limiter.tryRequest(key), false);
        
        // Wait for window reset (add buffer for timing variations)
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        // Try rapid burst again
        let successCount = 0;
        for (let i = 0; i < 150; i++) {  // Try 50% more than limit
            if (limiter.tryRequest(key)) {
                successCount++;
            }
        }
        
        // Should be able to consume exactly limit tokens
        assert.equal(successCount, limit, `Expected ${limit} successful requests after reset, got ${successCount}`);
    });

    it('should handle concurrent bursts with penalty points', async () => {
        const limiter = new HyperLimit();
        const key = 'penalty-burst';
        const limit = 200;  // 200 req/s
        
        limiter.createLimiter(key, limit, 1000, true, 0, 5); // 200 tokens/sec, sliding window, 5 max penalty points
        
        // Rapid burst to trigger penalty (50% over limit)
        const results1 = [];
        for (let i = 0; i < 300; i++) {
            results1.push(limiter.tryRequest(key));
        }
        
        // Add penalty points for burst
        limiter.addPenalty(key, 3);  // 3/5 penalty points = ~60% reduction
        
        // Wait 200ms to allow some token refill
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Try another burst
        const results2 = [];
        for (let i = 0; i < 200; i++) {
            results2.push(limiter.tryRequest(key));
        }
        
        // First burst should allow exactly limit requests
        assert.equal(results1.filter(r => r).length, limit);
        
        // Second burst should allow fewer requests due to penalty
        // With 3/5 penalty points, reduction is (3 * 200) / 5 = 120
        // Capped at 90% = 180, so new limit is 200 - 120 = 80
        // After 200ms wait, we should get ~16 tokens (20% of 80)
        const succeeded = results2.filter(r => r).length;
        assert.ok(succeeded >= 14 && succeeded <= 18, `Expected ~16 successes (20% of reduced limit), got ${succeeded}`);
        
        // Verify current limit is reduced
        const currentLimit = limiter.getCurrentLimit(key);
        assert.ok(currentLimit >= 75 && currentLimit <= 85, `Expected limit around 80, got ${currentLimit}`);
    });
}); 