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
                natsApp.get('/nats-test', {
                    preHandler: rateLimit({
                        key: 'nats-test',
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
}); 