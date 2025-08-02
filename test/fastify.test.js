const fastify = require('fastify');
const request = require('supertest');
const assert = require('assert');
const rateLimit = require('../packages/fastify');

describe('Fastify Plugin', () => {
    let app;

    beforeEach(async () => {
        app = fastify();
        
        // Basic rate limited endpoint
        app.get('/basic', {
            preHandler: rateLimit({
                key: 'basic',
                maxTokens: 3,
                window: '1s',
                sliding: true
            }),
            handler: async (request, reply) => {
                return { message: 'success' };
            }
        });

        // Protected endpoint with penalties
        app.get('/protected', {
            preHandler: rateLimit({
                key: 'protected',
                maxTokens: 5,
                window: '1s',
                sliding: true,
                block: '1s',
                maxPenalty: 3,
                onRejected: (request, reply, info) => {
                    reply.code(429).send({
                        error: 'Rate limit exceeded',
                        retryAfter: info.retryAfter
                    });
                }
            }),
            handler: async (request, reply) => {
                if (Math.random() < 0.3) {
                    request.rateLimit.limiter.addPenalty(request.rateLimit.key, 1);
                    return reply.code(400).send({ error: 'Random violation' });
                }
                return { message: 'success' };
            }
        });

        // Custom endpoint with bypass key
        app.get('/custom', {
            preHandler: rateLimit({
                key: 'custom',
                maxTokens: 2,
                window: '1s',
                sliding: true,
                keyGenerator: req => `${req.ip}-${req.query.userId}`,
                bypassHeader: 'X-Custom-Key',
                bypassKeys: ['special-key']
            }),
            handler: async (request, reply) => {
                return { message: 'success' };
            }
        });

        await app.listen({ port: 0 });
    });

    afterEach(async () => {
        await app.close();
    });

    describe('Basic Rate Limiting', () => {
        it('should limit requests according to rate', async () => {
            // First 3 requests should succeed
            for (let i = 0; i < 3; i++) {
                const res = await app.inject({
                    method: 'GET',
                    url: '/basic'
                });
                assert.equal(res.statusCode, 200);
                assert.equal(res.json().message, 'success');
                assert(res.headers['x-ratelimit-remaining']);
            }

            // Fourth request should fail
            const res = await app.inject({
                method: 'GET',
                url: '/basic'
            });
            assert.equal(res.statusCode, 429);
            assert.equal(res.headers['x-ratelimit-remaining'], '0');

            // Wait for window to pass
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Should be able to make request again
            const final = await app.inject({
                method: 'GET',
                url: '/basic'
            });
            assert.equal(final.statusCode, 200);
        });
    });

    describe('Protected Endpoint with Penalties', () => {
        it('should handle penalties and blocking', async () => {
            // Make requests until we get a penalty
            let gotPenalty = false;
            for (let i = 0; i < 10 && !gotPenalty; i++) {
                const res = await app.inject({
                    method: 'GET',
                    url: '/protected'
                });
                if (res.statusCode === 400) {
                    gotPenalty = true;
                    // Next request should have reduced limit
                    const limited = await app.inject({
                        method: 'GET',
                        url: '/protected'
                    });
                    assert(parseInt(limited.headers['x-ratelimit-limit']) < 5);
                }
            }
        });
    });

    describe('Custom Rate Limiting', () => {
        it('should handle custom keys and bypass headers', async () => {
            // Test with custom key
            const userId = '123';
            for (let i = 0; i < 2; i++) {
                const res = await app.inject({
                    method: 'GET',
                    url: `/custom?userId=${userId}`
                });
                assert.equal(res.statusCode, 200);
            }

            // Should be blocked
            const blocked = await app.inject({
                method: 'GET',
                url: `/custom?userId=${userId}`
            });
            assert.equal(blocked.statusCode, 429);

            // Should bypass with special key
            const bypass = await app.inject({
                method: 'GET',
                url: `/custom?userId=${userId}`,
                headers: {
                    'X-Custom-Key': 'special-key'
                }
            });
            assert.equal(bypass.statusCode, 200);
        });
    });

    describe('Rate Limit Headers', () => {
        it('should set correct rate limit headers', async () => {
            const res = await app.inject({
                method: 'GET',
                url: '/basic'
            });
            
            assert(res.headers['x-ratelimit-limit']);
            assert(res.headers['x-ratelimit-remaining']);
            assert(res.headers['x-ratelimit-reset']);
        });

        it('should work with NATS distributed storage', async function() {
            // Create a new Fastify instance for this test to avoid route conflicts
            let natsApp;
            try {
                natsApp = fastify();
                const uniqueKey = 'nats-test-' + Date.now();
                natsApp.get('/nats-test', {
                    preHandler: rateLimit({
                        key: uniqueKey,
                        maxTokens: 2,
                        window: '10s',
                        nats: {
                            servers: 'nats://localhost:4222',
                            bucket: 'test-fastify',
                            prefix: 'fast_'
                        }
                    }),
                    handler: async (request, reply) => {
                        return { message: 'nats success' };
                    }
                });
            } catch (err) {
                if (err.message.includes('NATS connection failed')) {
                    console.log('    ⚠️  NATS server not available, skipping NATS middleware test');
                    this.skip();
                    return;
                }
                throw err;
            }

            // Test that NATS rate limiting works
            const res1 = await natsApp.inject({
                method: 'GET',
                url: '/nats-test'
            });
            assert.strictEqual(res1.statusCode, 200);
            assert.strictEqual(res1.json().message, 'nats success');

            const res2 = await natsApp.inject({
                method: 'GET',
                url: '/nats-test'
            });
            assert.strictEqual(res2.statusCode, 200);

            // Third request should be rate limited
            const res3 = await natsApp.inject({
                method: 'GET',
                url: '/nats-test'
            });
            assert.strictEqual(res3.statusCode, 429);
        });
    });

    describe('configResolver', () => {
        it('should support dynamic rate limit configuration', async () => {
            const app = fastify();
            
            // Track which configs were used
            const usedConfigs = new Set();
            
            await app.register(rateLimit, {
                keyGenerator: (req) => req.headers['x-api-key'] || 'anonymous',
                configResolver: (apiKey) => {
                    usedConfigs.add(apiKey);
                    
                    if (apiKey === 'premium') {
                        return {
                            maxTokens: 10,
                            window: '1s'
                        };
                    } else if (apiKey === 'basic') {
                        return {
                            maxTokens: 2,
                            window: '1s'
                        };
                    }
                    return {
                        maxTokens: 0,
                        window: '1s'
                    };
                }
            });
            
            app.get('/dynamic', async (request, reply) => {
                return { message: 'success' };
            });
            
            await app.ready();
            
            // Test premium user (10 requests allowed)
            for (let i = 0; i < 10; i++) {
                const res = await app.inject({
                    method: 'GET',
                    url: '/dynamic',
                    headers: { 'x-api-key': 'premium' }
                });
                assert.strictEqual(res.statusCode, 200);
            }
            
            // 11th request should be rate limited
            const res11 = await app.inject({
                method: 'GET',
                url: '/dynamic',
                headers: { 'x-api-key': 'premium' }
            });
            assert.strictEqual(res11.statusCode, 429);
            
            // Test basic user (2 requests allowed)
            const basicRes1 = await app.inject({
                method: 'GET',
                url: '/dynamic',
                headers: { 'x-api-key': 'basic' }
            });
            assert.strictEqual(basicRes1.statusCode, 200);
            
            const basicRes2 = await app.inject({
                method: 'GET',
                url: '/dynamic',
                headers: { 'x-api-key': 'basic' }
            });
            assert.strictEqual(basicRes2.statusCode, 200);
            
            // 3rd request should be rate limited
            const basicRes3 = await app.inject({
                method: 'GET',
                url: '/dynamic',
                headers: { 'x-api-key': 'basic' }
            });
            assert.strictEqual(basicRes3.statusCode, 429);
            
            // Test unknown user (no requests allowed)
            const unknownRes = await app.inject({
                method: 'GET',
                url: '/dynamic',
                headers: { 'x-api-key': 'unknown' }
            });
            assert.strictEqual(unknownRes.statusCode, 429);
            
            // Verify configs were called
            assert(usedConfigs.has('premium'));
            assert(usedConfigs.has('basic'));
            assert(usedConfigs.has('unknown'));
        });
        
        it('should cache config results efficiently', async () => {
            const app = fastify();
            let configResolverCalls = 0;
            
            await app.register(rateLimit, {
                keyGenerator: (req) => req.headers['x-api-key'] || 'anonymous',
                configResolver: (apiKey) => {
                    configResolverCalls++;
                    return {
                        maxTokens: 5,
                        window: '1s'
                    };
                }
            });
            
            app.get('/cached', async (request, reply) => {
                return { message: 'success' };
            });
            
            await app.ready();
            
            // Make multiple requests with same API key
            for (let i = 0; i < 3; i++) {
                const res = await app.inject({
                    method: 'GET',
                    url: '/cached',
                    headers: { 'x-api-key': 'test-key' }
                });
                assert.strictEqual(res.statusCode, 200);
            }
            
            // Config resolver should be called only once due to caching
            assert.strictEqual(configResolverCalls, 1);
        });
    });

    describe('Distributed Rate Limiting', () => {
        it('should share rate limits across multiple Fastify instances with NATS', async function() {
            // Skip if NATS server not available
            let app1, app2;
            
            try {
                // Create two Fastify apps with same NATS configuration
                app1 = fastify();
                app2 = fastify();
                
                const natsConfig = {
                    servers: 'nats://localhost:4222',
                    bucket: 'test-fastify-distributed',
                    prefix: 'fas_dist_'
                };
                
                // Use same key and configuration for both apps
                const uniqueKey = 'distributed-test-' + Date.now();
                const rateLimitConfig = {
                    key: uniqueKey,
                    maxTokens: 10,
                    window: '10s',
                    nats: natsConfig
                };
                
                app1.get('/distributed', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success from app1' };
                });
                
                app2.get('/distributed', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success from app2' };
                });
                
                await app1.ready();
                await app2.ready();
                
            } catch (err) {
                if (err.message.includes('NATS connection failed')) {
                    console.log('    ⚠️  NATS server not available, skipping distributed middleware test');
                    this.skip();
                    return;
                }
                throw err;
            }
            
            // Make 6 requests to app1
            let app1Allowed = 0;
            for (let i = 0; i < 6; i++) {
                const res = await app1.inject({
                    method: 'GET',
                    url: '/distributed'
                });
                if (res.statusCode === 200) app1Allowed++;
            }
            assert.strictEqual(app1Allowed, 6);
            
            // Make 6 requests to app2 - should only allow 4 more
            let app2Allowed = 0;
            for (let i = 0; i < 6; i++) {
                const res = await app2.inject({
                    method: 'GET',
                    url: '/distributed'
                });
                if (res.statusCode === 200) app2Allowed++;
            }
            assert.strictEqual(app2Allowed, 4);
            
            // Total should not exceed the limit
            assert.strictEqual(app1Allowed + app2Allowed, 10);
            
            // Clean up
            await app1.close();
            await app2.close();
        });

        it('should handle concurrent distributed requests correctly', async function() {
            // Skip if NATS server not available
            let app1, app2;
            
            try {
                // Create two Fastify apps
                app1 = fastify();
                app2 = fastify();
                
                const natsConfig = {
                    servers: 'nats://localhost:4222',
                    bucket: 'test-fastify-concurrent',
                    prefix: 'fas_conc_'
                };
                
                const uniqueKey = 'concurrent-test-' + Date.now();
                const rateLimitConfig = {
                    key: uniqueKey,
                    maxTokens: 50,
                    window: '10s',
                    nats: natsConfig
                };
                
                app1.get('/concurrent', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success' };
                });
                
                app2.get('/concurrent', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success' };
                });
                
                await app1.ready();
                await app2.ready();
                
            } catch (err) {
                if (err.message.includes('NATS connection failed')) {
                    console.log('    ⚠️  NATS server not available, skipping concurrent distributed test');
                    this.skip();
                    return;
                }
                throw err;
            }
            
            // Make concurrent requests from both servers
            const promises = [];
            
            // 40 requests to app1
            for (let i = 0; i < 40; i++) {
                promises.push(
                    app1.inject({
                        method: 'GET',
                        url: '/concurrent'
                    }).then(res => res.statusCode === 200)
                );
            }
            
            // 40 requests to app2
            for (let i = 0; i < 40; i++) {
                promises.push(
                    app2.inject({
                        method: 'GET',
                        url: '/concurrent'
                    }).then(res => res.statusCode === 200)
                );
            }
            
            const results = await Promise.all(promises);
            const totalAllowed = results.filter(r => r).length;
            
            // Should respect the limit with some tolerance for race conditions
            assert(totalAllowed >= 48 && totalAllowed <= 52,
                `Expected ~50 allowed requests, got ${totalAllowed}`);
            
            // Clean up
            await app1.close();
            await app2.close();
        });

        it('should use distributed storage with configResolver', async function() {
            // Skip if NATS server not available
            let app1, app2;
            
            try {
                app1 = fastify();
                app2 = fastify();
                
                const natsConfig = {
                    servers: 'nats://localhost:4222',
                    bucket: 'test-fastify-resolver',
                    prefix: 'fas_res_'
                };
                
                const rateLimitConfig = {
                    keyGenerator: (req) => req.headers['x-api-key'] || 'anonymous',
                    configResolver: (apiKey) => {
                        if (apiKey && apiKey.startsWith('test-key-')) {
                            return {
                                maxTokens: 5,
                                window: '10s'
                            };
                        }
                        return null;
                    },
                    nats: natsConfig
                };
                
                app1.get('/resolver', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success from app1' };
                });
                
                app2.get('/resolver', {
                    preHandler: rateLimit(rateLimitConfig)
                }, async (request, reply) => {
                    return { message: 'success from app2' };
                });
                
                await app1.ready();
                await app2.ready();
                
            } catch (err) {
                if (err.message.includes('NATS connection failed')) {
                    console.log('    ⚠️  NATS server not available, skipping resolver distributed test');
                    this.skip();
                    return;
                }
                throw err;
            }
            
            // Use unique test key to avoid conflicts
            const testApiKey = 'test-key-' + Date.now();
            
            // Make 3 requests to app1 with test-key
            for (let i = 0; i < 3; i++) {
                const res = await app1.inject({
                    method: 'GET',
                    url: '/resolver',
                    headers: { 'x-api-key': testApiKey }
                });
                assert.strictEqual(res.statusCode, 200);
            }
            
            // Make 3 more requests to app2 - should only allow 2
            let app2Allowed = 0;
            for (let i = 0; i < 3; i++) {
                const res = await app2.inject({
                    method: 'GET',
                    url: '/resolver',
                    headers: { 'x-api-key': testApiKey }
                });
                if (res.statusCode === 200) app2Allowed++;
            }
            assert.strictEqual(app2Allowed, 2);
            
            // Clean up
            await app1.close();
            await app2.close();
        });
    });
}); 