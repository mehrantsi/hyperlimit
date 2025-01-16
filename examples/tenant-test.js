const HyperExpress = require('hyper-express');
const rateLimiter = require('@hyperlimit/hyperexpress');

// Simulating a database of tenant configurations
const tenantConfigs = new Map();
const tenantLimiters = new Map();

// Example tenant configurations
tenantConfigs.set('tenant1-key', {
    name: 'Basic Tier',
    endpoints: {
        '/api/data': { maxTokens: 5, window: '10s' },
        '/api/users': { maxTokens: 2, window: '10s' },
        '*': { maxTokens: 10, window: '60s' } // Default for unspecified endpoints
    }
});

tenantConfigs.set('tenant2-key', {
    name: 'Premium Tier',
    endpoints: {
        '/api/data': { maxTokens: 20, window: '10s' },
        '/api/users': { maxTokens: 10, window: '10s' },
        '*': { maxTokens: 50, window: '60s' }
    }
});

// Helper to get or create rate limiter for tenant+endpoint
function getTenantLimiter(tenantKey, endpoint) {
    const cacheKey = `${tenantKey}:${endpoint}`;
    
    if (tenantLimiters.has(cacheKey)) {
        return tenantLimiters.get(cacheKey);
    }

    const tenantConfig = tenantConfigs.get(tenantKey);
    if (!tenantConfig) {
        return null;
    }

    // Get endpoint specific config or fallback to default
    const config = tenantConfig.endpoints[endpoint] || tenantConfig.endpoints['*'];
    if (!config) {
        return null;
    }

    const limiter = rateLimiter({
        maxTokens: config.maxTokens,
        window: config.window,
        keyGenerator: (req) => req.headers['x-api-key'] // Use API key as rate limit key
    });

    tenantLimiters.set(cacheKey, limiter);
    return limiter;
}

// Tenant authentication middleware
function authenticateTenant(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'API key required' });
    }

    const config = tenantConfigs.get(apiKey);
    if (!config) {
        return res.status(401).json({ error: 'Invalid API key' });
    }

    req.tenant = {
        apiKey,
        config
    };
    next();
}

// Dynamic rate limiting middleware
function dynamicRateLimit(req, res, next) {
    const limiter = getTenantLimiter(req.tenant.apiKey, req.path);
    if (!limiter) {
        return res.status(500).json({ error: 'Rate limiter configuration error' });
    }
    
    return limiter(req, res, next);
}

// Create server
const app = new HyperExpress.Server();

// Apply tenant authentication to all routes
app.use(authenticateTenant);

// API endpoints with dynamic rate limiting
app.get('/api/data', dynamicRateLimit, (req, res) => {
    res.json({
        message: 'Data endpoint',
        tenant: req.tenant.config.name,
        path: req.path
    });
});

app.get('/api/users', dynamicRateLimit, (req, res) => {
    res.json({
        message: 'Users endpoint',
        tenant: req.tenant.config.name,
        path: req.path
    });
});

// Generic endpoint to test default rate limits
app.get('/api/other', dynamicRateLimit, (req, res) => {
    res.json({
        message: 'Other endpoint (using default limit)',
        tenant: req.tenant.config.name,
        path: req.path
    });
});

// Status endpoint to check rate limit info
app.get('/api/status', authenticateTenant, (req, res) => {
    const limits = {};
    for (const [endpoint, config] of Object.entries(req.tenant.config.endpoints)) {
        const limiter = getTenantLimiter(req.tenant.apiKey, endpoint);
        if (limiter) {
            // Execute the middleware to initialize the rate limiter
            const mockReq = { headers: { 'x-api-key': req.tenant.apiKey }, path: endpoint };
            const mockRes = {};
            const info = limiter.getRateLimitInfo ? limiter.getRateLimitInfo(req.tenant.apiKey) : { limit: config.maxTokens, remaining: config.maxTokens, reset: 0, blocked: false };
            limits[endpoint] = {
                maxTokens: config.maxTokens,
                window: config.window,
                ...info
            };
        }
    }
    res.json({
        tenant: req.tenant.config.name,
        limits
    });
});

const port = 3003;
app.listen(port)
    .then(() => {
        console.log(`Tenant-based rate limiting test server running at http://localhost:${port}`);
        console.log('\nTest endpoints with different tenant keys:');
        console.log('\nBasic Tier (tenant1-key):');
        console.log('   curl -H "X-API-Key: tenant1-key" http://localhost:3003/api/data');
        console.log('   curl -H "X-API-Key: tenant1-key" http://localhost:3003/api/users');
        console.log('   curl -H "X-API-Key: tenant1-key" http://localhost:3003/api/other');
        console.log('   curl -H "X-API-Key: tenant1-key" http://localhost:3003/api/status');
        console.log('\nPremium Tier (tenant2-key):');
        console.log('   curl -H "X-API-Key: tenant2-key" http://localhost:3003/api/data');
        console.log('   curl -H "X-API-Key: tenant2-key" http://localhost:3003/api/users');
        console.log('   curl -H "X-API-Key: tenant2-key" http://localhost:3003/api/other');
        console.log('   curl -H "X-API-Key: tenant2-key" http://localhost:3003/api/status');
    })
    .catch((error) => {
        console.error('Failed to start server:', error);
        process.exit(1);
    }); 