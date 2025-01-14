const express = require('express');
const request = require('supertest');
const assert = require('assert');
const rateLimit = require('../src/middleware-express');

describe('Express Middleware', () => {
    let app;
    let server;

    beforeEach((done) => {
        app = express();
        
        // Basic rate limited endpoint
        app.get('/basic', rateLimit({
            key: 'basic',
            maxTokens: 3,
            window: '1s',
            sliding: true
        }), (req, res) => {
            res.json({ message: 'success' });
        });

        // Protected endpoint with penalties
        app.get('/protected', rateLimit({
            key: 'protected',
            maxTokens: 5,
            window: '1s',
            sliding: true,
            block: '1s',
            maxPenalty: 3,
            onRejected: (req, res, info) => {
                res.status(429).json({
                    error: 'Rate limit exceeded',
                    retryAfter: info.retryAfter
                });
            }
        }), (req, res) => {
            if (Math.random() < 0.3) {
                req.rateLimit.limiter.addPenalty(req.rateLimit.key, 1);
                return res.status(400).json({ error: 'Random violation' });
            }
            res.json({ message: 'success' });
        });

        // Custom endpoint with bypass key
        app.get('/custom', rateLimit({
            key: 'custom',
            maxTokens: 2,
            window: '1s',
            sliding: true,
            keyGenerator: req => `${req.ip}-${req.query.userId}`,
            bypassHeader: 'X-Custom-Key',
            bypassKeys: ['special-key']
        }), (req, res) => {
            res.json({ message: 'success' });
        });

        server = app.listen(0, done);
    });

    afterEach((done) => {
        server.close(done);
    });

    describe('Basic Rate Limiting', () => {
        it('should limit requests according to rate', async () => {
            const agent = request.agent(app);

            // First 3 requests should succeed
            for (let i = 0; i < 3; i++) {
                const res = await agent.get('/basic');
                assert.equal(res.status, 200);
                assert.equal(res.body.message, 'success');
                assert(res.headers['x-ratelimit-remaining']);
            }

            // Fourth request should fail
            const res = await agent.get('/basic');
            assert.equal(res.status, 429);
            assert.equal(res.headers['x-ratelimit-remaining'], '0');

            // Wait for window to pass
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Should be able to make request again
            const final = await agent.get('/basic');
            assert.equal(final.status, 200);
        });
    });

    describe('Protected Endpoint with Penalties', () => {
        it('should handle penalties and blocking', async () => {
            const agent = request.agent(app);

            // Make requests until we get a penalty
            let gotPenalty = false;
            for (let i = 0; i < 10 && !gotPenalty; i++) {
                const res = await agent.get('/protected');
                if (res.status === 400) {
                    gotPenalty = true;
                    // Next request should have reduced limit
                    const limited = await agent.get('/protected');
                    assert(parseInt(limited.headers['x-ratelimit-limit']) < 5);
                }
            }
        });
    });

    describe('Custom Rate Limiting', () => {
        it('should handle custom keys and bypass headers', async () => {
            const agent = request.agent(app);

            // Test with custom key
            const userId = '123';
            for (let i = 0; i < 2; i++) {
                const res = await agent.get(`/custom?userId=${userId}`);
                assert.equal(res.status, 200);
            }

            // Should be blocked
            const blocked = await agent.get(`/custom?userId=${userId}`);
            assert.equal(blocked.status, 429);

            // Should bypass with special key
            const bypass = await agent.get(`/custom?userId=${userId}`)
                .set('X-Custom-Key', 'special-key');
            assert.equal(bypass.status, 200);
        });
    });

    describe('Rate Limit Headers', () => {
        it('should set correct rate limit headers', async () => {
            const res = await request(app).get('/basic');
            
            assert(res.headers['x-ratelimit-limit']);
            assert(res.headers['x-ratelimit-remaining']);
            assert(res.headers['x-ratelimit-reset']);
        });
    });
}); 