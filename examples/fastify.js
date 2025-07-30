const fastify = require('fastify')();
const rateLimit = require('../src/middleware-fastify');

// Optional distributed storage configuration - uncomment to enable distributed rate limiting
// const redisConfig = {
//     host: 'localhost',
//     port: 6379,
//     prefix: 'rl:'
// };
//
// const natsConfig = {
//     servers: 'nats://localhost:4222',
//     bucket: 'rate-limits',
//     prefix: 'rl_'
// };

// Example routes using direct configuration
fastify.get('/api/public', {
    preHandler: rateLimit({
        key: 'public',
        maxTokens: 100,
        window: '1m',
        sliding: true,
        block: '30s'
    }),
    handler: async (request, reply) => {
        return { message: 'Public API response' };
    }
});

// Protected route with optional Redis-backed distributed rate limiting
fastify.get('/api/protected', {
    preHandler: rateLimit({
        key: 'protected',
        maxTokens: 5,
        window: '1m',
        sliding: true,
        block: '5m',
        maxPenalty: 3,
        // redis: redisConfig, // Uncomment to enable Redis distributed rate limiting
        // nats: natsConfig,   // Or use NATS for distributed rate limiting
        onRejected: (request, reply, info) => {
            reply.code(429).send({
                error: 'Rate limit exceeded',
                message: 'Please try again later',
                retryAfter: info.retryAfter
            });
        }
    }),
    handler: async (request, reply) => {
        // Simulate violation that adds penalty
        if (Math.random() < 0.3) {
            request.rateLimit.limiter.addPenalty(request.rateLimit.key, 1);
            return reply.code(400).send({ error: 'Random violation occurred' });
        }
        return { message: 'Protected API response' };
    }
});

// Custom rate limit with bypass keys and custom key generator
fastify.get('/api/custom', {
    preHandler: rateLimit({
        key: 'custom',
        maxTokens: 20,
        window: '30s',
        sliding: true,
        block: '1m',
        keyGenerator: req => `${req.ip}-${req.query.userId}`,
        bypassHeader: 'X-Custom-Key',
        bypassKeys: ['special-key']
    }),
    handler: async (request, reply) => {
        return { message: 'Custom API response' };
    }
});

// Metrics endpoint
fastify.get('/metrics', async (request, reply) => {
    // Create a temporary limiter to get stats for each endpoint
    const publicLimiter = new (require('../').HyperLimit)();
    const protectedLimiter = new (require('../').HyperLimit)();
    const customLimiter = new (require('../').HyperLimit)();

    // Create the same limiters as in the routes
    publicLimiter.createLimiter('public', 100, 60000, true, 30000);
    protectedLimiter.createLimiter('protected', 5, 60000, true, 300000, 3);
    customLimiter.createLimiter('custom', 20, 30000, true, 60000);

    return {
        rateLimits: {
            public: publicLimiter.getRateLimitInfo('public'),
            protected: protectedLimiter.getRateLimitInfo('protected'),
            custom: customLimiter.getRateLimitInfo('custom')
        }
    };
});

// Start server
const start = async () => {
    try {
        await fastify.listen({ port: 3000 });
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
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start(); 