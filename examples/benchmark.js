const { HyperLimit } = require('../');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const createExpressRateLimit = require('express-rate-limit');

function createLimiters(maxTokens, windowMs) {
    const hyperLimit = new HyperLimit();
    hyperLimit.createLimiter('test', maxTokens, windowMs);

    const rateLimiterFlexible = new RateLimiterMemory({
        points: maxTokens,
        duration: windowMs / 1000
    });

    const expressRateLimit = createExpressRateLimit({
        windowMs,
        max: maxTokens,
        standardHeaders: true,
        legacyHeaders: false,
        skipFailedRequests: false,
        keyGenerator: (req) => req.key
    });

    return { hyperLimit, rateLimiterFlexible, expressRateLimit };
}

const TESTS = [
    {
        name: 'Small Hash Table (1K)',
        config: { bucketCount: 1024 },
        run: async () => {
            console.log('\nConfiguration: Small Hash Table (1K)');
            console.log('============================================================\n');

            // Single key performance
            console.log('Single Key Performance:');
            const { hyperLimit, rateLimiterFlexible, expressRateLimit } = createLimiters(1000000, 1000);
            
            console.time('  HyperLimit');
            for (let i = 0; i < 1000000; i++) {
                hyperLimit.tryRequest('test');
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (let i = 0; i < 1000000; i++) {
                await rateLimiterFlexible.consume('test');
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (let i = 0; i < 1000000; i++) {
                await new Promise(resolve => {
                    expressRateLimit({ key: 'test' }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Multi-key performance
            console.log('\nMulti-Key Performance:');
            const keys = Array.from({ length: 100000 }, (_, i) => `key${i}`);
            
            console.time('  HyperLimit');
            for (const key of keys) {
                hyperLimit.tryRequest(key);
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (const key of keys) {
                await rateLimiterFlexible.consume(key);
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (const key of keys) {
                await new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Concurrent performance
            console.log('\nConcurrent Performance:');
            const concurrentKeys = Array.from({ length: 100000 }, (_, i) => `concurrent${i}`);
            
            console.time('  HyperLimit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    resolve(hyperLimit.tryRequest(key));
                });
            }));
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            await Promise.all(concurrentKeys.map(key => rateLimiterFlexible.consume(key)));
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }));
            console.timeEnd('  Express Rate Limit');
        }
    },
    {
        name: 'Default Hash Table (16K)',
        config: { bucketCount: 16384 },
        run: async () => {
            console.log('\nConfiguration: Default Hash Table (16K)');
            console.log('============================================================\n');

            // Single key performance
            console.log('Single Key Performance:');
            const { hyperLimit, rateLimiterFlexible, expressRateLimit } = createLimiters(1000000, 1000);
            
            console.time('  HyperLimit');
            for (let i = 0; i < 1000000; i++) {
                hyperLimit.tryRequest('test');
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (let i = 0; i < 1000000; i++) {
                await rateLimiterFlexible.consume('test');
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (let i = 0; i < 1000000; i++) {
                await new Promise(resolve => {
                    expressRateLimit({ key: 'test' }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Multi-key performance
            console.log('\nMulti-Key Performance:');
            const keys = Array.from({ length: 100000 }, (_, i) => `key${i}`);
            
            console.time('  HyperLimit');
            for (const key of keys) {
                hyperLimit.tryRequest(key);
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (const key of keys) {
                await rateLimiterFlexible.consume(key);
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (const key of keys) {
                await new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Concurrent performance
            console.log('\nConcurrent Performance:');
            const concurrentKeys = Array.from({ length: 100000 }, (_, i) => `concurrent${i}`);
            
            console.time('  HyperLimit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    resolve(hyperLimit.tryRequest(key));
                });
            }));
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            await Promise.all(concurrentKeys.map(key => rateLimiterFlexible.consume(key)));
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }));
            console.timeEnd('  Express Rate Limit');
        }
    },
    {
        name: 'Large Hash Table (64K)',
        config: { bucketCount: 65536 },
        run: async () => {
            console.log('\nConfiguration: Large Hash Table (64K)');
            console.log('============================================================\n');

            // Single key performance
            console.log('Single Key Performance:');
            const { hyperLimit, rateLimiterFlexible, expressRateLimit } = createLimiters(1000000, 1000);
            
            console.time('  HyperLimit');
            for (let i = 0; i < 1000000; i++) {
                hyperLimit.tryRequest('test');
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (let i = 0; i < 1000000; i++) {
                await rateLimiterFlexible.consume('test');
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (let i = 0; i < 1000000; i++) {
                await new Promise(resolve => {
                    expressRateLimit({ key: 'test' }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Multi-key performance
            console.log('\nMulti-Key Performance:');
            const keys = Array.from({ length: 100000 }, (_, i) => `key${i}`);
            
            console.time('  HyperLimit');
            for (const key of keys) {
                hyperLimit.tryRequest(key);
            }
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            for (const key of keys) {
                await rateLimiterFlexible.consume(key);
            }
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            for (const key of keys) {
                await new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }
            console.timeEnd('  Express Rate Limit');

            // Concurrent performance
            console.log('\nConcurrent Performance:');
            const concurrentKeys = Array.from({ length: 100000 }, (_, i) => `concurrent${i}`);
            
            console.time('  HyperLimit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    resolve(hyperLimit.tryRequest(key));
                });
            }));
            console.timeEnd('  HyperLimit');

            console.time('  Rate Limiter Flexible');
            await Promise.all(concurrentKeys.map(key => rateLimiterFlexible.consume(key)));
            console.timeEnd('  Rate Limiter Flexible');

            console.time('  Express Rate Limit');
            await Promise.all(concurrentKeys.map(key => {
                return new Promise(resolve => {
                    expressRateLimit({ key }, { send: () => {} }, resolve);
                });
            }));
            console.timeEnd('  Express Rate Limit');
        }
    }
];

console.log('\nRate Limiter Performance Comparison\n');

(async () => {
    for (const test of TESTS) {
        await test.run();
    }
})(); 