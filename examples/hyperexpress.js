const HyperExpress = require('hyper-express');
const rateLimit = require('../src/middleware-hyperexpress');

// Create HyperExpress app
const app = new HyperExpress.Server({
    trust_proxy: true,
    fast_buffers: true,
    fast_abort: true,
    fast_headers: true
});

// Helper for HyperExpress JSON responses
function sendJson(res, status, data) {
    res.status(status || 200);
    res.header('Content-Type', 'application/json');
    res.send(Buffer.from(JSON.stringify(data)));
}

// Public API - 100 requests per minute
app.get('/api/public', rateLimit({
    key: 'public',
    maxTokens: 100,
    window: '1m',
    sliding: true,
    block: '30s'
}), (req, res) => {
    sendJson(res, 200, { message: 'Public API response' });
});

// Protected API - 5 requests per minute with penalties
app.get('/api/protected', rateLimit({
    key: 'protected',
    maxTokens: 5,
    window: '1m',
    sliding: true,
    block: '5m',
    maxPenalty: 3,
    onRejected: (req, res, info) => {
        sendJson(res, 429, {
            error: 'Rate limit exceeded',
            message: 'Please try again later',
            retryAfter: info.retryAfter
        });
    }
}), (req, res) => {
    // Simulate violation that adds penalty
    if (Math.random() < 0.3) {
        req.rateLimit.limiter.addPenalty('protected', 1);
        return sendJson(res, 400, { error: 'Random violation occurred' });
    }
    sendJson(res, 200, { message: 'Protected API response' });
});

// Custom rate limit with bypass keys and custom key generator
app.get('/api/custom', rateLimit({
    key: 'custom',
    maxTokens: 20,
    window: '30s',
    sliding: true,
    block: '1m',
    keyGenerator: req => `${req.ip}-${req.query.userId}`,
    bypassHeader: 'X-Custom-Key',
    bypassKeys: ['special-key']
}), (req, res) => {
    sendJson(res, 200, { message: 'Custom API response' });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
    const stats = rateLimit.limiter.getStats();
    sendJson(res, 200, {
        stats,
        rateLimits: {
            public: rateLimit.limiter.getRateLimitInfo('public'),
            protected: rateLimit.limiter.getRateLimitInfo('protected'),
            custom: rateLimit.limiter.getRateLimitInfo('custom')
        }
    });
});

// Start server
app.listen(3000)
    .then(() => {
        console.log('\nServer running on port 3000\n');
        console.log('Test the API with:');
        console.log('1. Public API (100 req/min):');
        console.log('   curl http://localhost:3000/api/public');
        console.log('\n2. Protected API (5 req/min with penalties):');
        console.log('   curl http://localhost:3000/api/protected');
        console.log('\n3. Custom API (20 req/30s with user-specific limits):');
        console.log('   curl "http://localhost:3000/api/custom?userId=123"');
        console.log('   curl -H "X-Custom-Key: special-key" "http://localhost:3000/api/custom?userId=123"');
        console.log('\n4. Metrics:');
        console.log('   curl http://localhost:3000/metrics');
    })
    .catch(console.error); 