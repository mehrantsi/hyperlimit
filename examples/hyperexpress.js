const HyperExpress = require('hyper-express');
const rateLimit = require('../src/middleware-hyperexpress');

// Create HyperExpress app
const app = new HyperExpress.Server();

// Optional Redis configuration - uncomment to enable distributed rate limiting
// const redisConfig = {
//     host: 'localhost',
//     port: 6379,
//     prefix: 'rl:'
// };

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

// Protected route with optional Redis-backed distributed rate limiting
app.get('/api/protected', rateLimit({
    key: 'protected',
    maxTokens: 5,
    window: '1m',
    sliding: true,
    block: '5m',
    maxPenalty: 3,
    // redis: redisConfig, // Uncomment to enable distributed rate limiting
    onRejected: (req, res, info) => {
        res.status(429);
        res.json({
            error: 'Rate limit exceeded',
            message: 'Please try again later',
            retryAfter: info.retryAfter
        });
    }
}), (req, res) => {
    // Simulate violation that adds penalty
    if (Math.random() < 0.3) {
        req.rateLimit.limiter.addPenalty(req.rateLimit.key, 1);
        res.status(400);
        return res.json({ error: 'Random violation occurred' });
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
    // Create a temporary limiter to get stats for each endpoint
    const publicLimiter = new (require('../').HyperLimit)();
    const protectedLimiter = new (require('../').HyperLimit)();
    const customLimiter = new (require('../').HyperLimit)();

    // Create the same limiters as in the routes
    publicLimiter.createLimiter('public', 100, 60000, true, 30000);
    protectedLimiter.createLimiter('protected', 5, 60000, true, 300000, 3);
    customLimiter.createLimiter('custom', 20, 30000, true, 60000);

    res.json({
        rateLimits: {
            public: publicLimiter.getRateLimitInfo('public'),
            protected: protectedLimiter.getRateLimitInfo('protected'),
            custom: customLimiter.getRateLimitInfo('custom')
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
    .catch(err => {
        console.error('Failed to start server:', err);
        process.exit(1);
    }); 