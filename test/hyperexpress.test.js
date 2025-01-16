const HyperExpress = require('hyper-express');
const request = require('supertest');
const assert = require('assert');
const rateLimit = require('../packages/hyperexpress');

describe('HyperExpress Middleware', () => {
    let app;
    let server;
    let port;

    beforeEach(async () => {
        app = new HyperExpress.Server();
        
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
                res.status(429);
                res.json({
                    error: 'Rate limit exceeded',
                    retryAfter: info.retryAfter
                });
            }
        }), (req, res) => {
            if (Math.random() < 0.3) {
                req.rateLimit.limiter.addPenalty(req.rateLimit.key, 1);
                res.status(400);
                return res.json({ error: 'Random violation' });
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

        // Find a free port
        port = await new Promise((resolve) => {
            const srv = require('http').createServer();
            srv.listen(0, '127.0.0.1', () => {
                const port = srv.address().port;
                srv.close(() => resolve(port));
            });
        });

        // Start server and wait for it to be ready
        await new Promise((resolve, reject) => {
            try {
                app.listen(port, '127.0.0.1')
                    .then(() => {
                        server = app;
                        // Give it a moment to fully initialize
                        setTimeout(resolve, 100);
                    })
                    .catch(reject);
            } catch (err) {
                reject(err);
            }
        });
    });

    afterEach(async () => {
        if (server) {
            await new Promise(resolve => {
                server.close();
                // Always resolve after a timeout since HyperExpress close is sync
                setTimeout(resolve, 500);
            });
        }
    });

    describe('Basic Rate Limiting', () => {
        it('should limit requests according to rate', async () => {
            const baseUrl = `http://127.0.0.1:${port}`;

            // First 3 requests should succeed
            for (let i = 0; i < 3; i++) {
                const res = await fetch(`${baseUrl}/basic`);
                assert.equal(res.status, 200);
                const data = await res.json();
                assert.equal(data.message, 'success');
                assert(res.headers.get('x-ratelimit-remaining'));
            }

            // Fourth request should fail
            const res = await fetch(`${baseUrl}/basic`);
            assert.equal(res.status, 429);
            assert.equal(res.headers.get('x-ratelimit-remaining'), '0');

            // Wait for window to pass
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Should be able to make request again
            const final = await fetch(`${baseUrl}/basic`);
            assert.equal(final.status, 200);
        });
    });

    describe('Protected Endpoint with Penalties', () => {
        it('should handle penalties and blocking', async () => {
            const baseUrl = `http://127.0.0.1:${port}`;

            // Make requests until we get a penalty
            let gotPenalty = false;
            for (let i = 0; i < 10 && !gotPenalty; i++) {
                const res = await fetch(`${baseUrl}/protected`);
                if (res.status === 400) {
                    gotPenalty = true;
                    // Next request should have reduced limit
                    const limited = await fetch(`${baseUrl}/protected`);
                    assert(parseInt(limited.headers.get('x-ratelimit-limit')) < 5);
                }
            }
        });
    });

    describe('Custom Rate Limiting', () => {
        it('should handle custom keys and bypass headers', async () => {
            const baseUrl = `http://127.0.0.1:${port}`;

            // Test with custom key
            const userId = '123';
            for (let i = 0; i < 2; i++) {
                const res = await fetch(`${baseUrl}/custom?userId=${userId}`);
                assert.equal(res.status, 200);
            }

            // Should be blocked
            const blocked = await fetch(`${baseUrl}/custom?userId=${userId}`);
            assert.equal(blocked.status, 429);

            // Should bypass with special key
            const bypass = await fetch(`${baseUrl}/custom?userId=${userId}`, {
                headers: {
                    'X-Custom-Key': 'special-key'
                }
            });
            assert.equal(bypass.status, 200);
        });
    });

    describe('Rate Limit Headers', () => {
        it('should set correct rate limit headers', async () => {
            const baseUrl = `http://127.0.0.1:${port}`;
            const res = await fetch(`${baseUrl}/basic`);
            
            assert(res.headers.get('x-ratelimit-limit'));
            assert(res.headers.get('x-ratelimit-remaining'));
            assert(res.headers.get('x-ratelimit-reset'));
        });
    });
}); 