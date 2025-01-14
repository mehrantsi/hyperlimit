const express = require('express');
const rateLimit = require('../src/middleware-express');

// Create Express app
const app = express();

// Example routes using direct configuration
app.get('/api/public', rateLimit({
    key: 'public',
    maxTokens: 100,
    window: '1m',
    sliding: true,
    block: '30s'
}), (req, res) => {
    res.json({ message: 'Public API response' });
});

app.get('/api/protected', rateLimit({
    key: 'protected',
    maxTokens: 5,
    window: '1m',
    sliding: true,
    block: '5m',
    maxPenalty: 3,
    onRejected: (req, res, info) => {
        res.status(429).json({
            error: 'Rate limit exceeded',
            message: 'Please try again later',
            retryAfter: info.retryAfter
        });
    }
}), (req, res) => {
    // Simulate violation that adds penalty
    if (Math.random() < 0.3) {
        req.rateLimit.limiter.addPenalty('protected', 1);
        return res.status(400).json({ error: 'Random violation occurred' });
    }
    res.json({ message: 'Protected API response' });
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
    res.json({ message: 'Custom API response' });
});

// Metrics endpoint
app.get('/metrics', (req, res) => {
    const stats = rateLimit.limiter.getStats();
    res.json({
        stats,
        rateLimits: {
            public: rateLimit.limiter.getRateLimitInfo('public'),
            protected: rateLimit.limiter.getRateLimitInfo('protected'),
            custom: rateLimit.limiter.getRateLimitInfo('custom')
        }
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('\nTest the API with:');
    console.log('1. Public API (100 req/min):');
    console.log('   curl http://localhost:3000/api/public');
    console.log('\n2. Protected API (5 req/min with penalties):');
    console.log('   curl http://localhost:3000/api/protected');
    console.log('\n3. Custom API (20 req/30s with user-specific limits):');
    console.log('   curl "http://localhost:3000/api/custom?userId=123"');
    console.log('   curl -H "X-Custom-Key: special-key" "http://localhost:3000/api/custom?userId=123"');
    console.log('\n4. Metrics:');
    console.log('   curl http://localhost:3000/metrics');
}); 