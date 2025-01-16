# HyperLimit

[![npm version](https://badge.fury.io/js/%40hyperlimit%2Fcore.svg)](https://badge.fury.io/js/%40hyperlimit%2Fcore)
[![Build and Release](https://github.com/mehrantsi/hyperlimit/actions/workflows/build.yml/badge.svg)](https://github.com/mehrantsi/hyperlimit/actions/workflows/build.yml)
[![Test](https://github.com/mehrantsi/hyperlimit/actions/workflows/test.yml/badge.svg)](https://github.com/mehrantsi/hyperlimit/actions/workflows/test.yml)

High-performance native rate limiter for Node.js with lock-free design, optimized for high-throughput applications. Capable of processing over 9 million requests per second in synthetic benchmarks.

## Features

- 🚀 Native C++ implementation for maximum performance
- 🔒 Lock-free design for high concurrency
- 🎯 Per-key rate limiting with configurable windows
- 💾 Memory-efficient implementation
- 🛡️ Thread-safe operations
- 🔄 Sliding window support
- 🎭 Multiple independent rate limiters
- 📊 Real-time monitoring and statistics
- 🌐 Redis-based distributed rate limiting
- 🎛️ Dynamic rate limiting per tenant/API key
- ⚡ Bypass keys for trusted clients
- 🎯 Penalty system for abuse prevention
- 📈 Customizable key generation
- 🔌 Framework-specific middleware packages

## Installation

Choose the package that matches your framework:

```bash
# For Express.js
npm install @hyperlimit/express

# For Fastify
npm install @hyperlimit/fastify

# For HyperExpress
npm install @hyperlimit/hyperexpress

# Core package (if you want to build custom middleware)
npm install hyperlimit
```

## Basic Usage

### Express.js

```javascript
const express = require('express');
const rateLimiter = require('@hyperlimit/express');

const app = express();

app.use('/api', rateLimiter({
    maxTokens: 100,           // Maximum requests allowed
    window: '1m',            // Time window (supports ms, s, m, h, d)
    sliding: true,           // Use sliding window algorithm
    block: '30s',           // Block duration after limit exceeded
    maxPenalty: 5,          // Maximum penalty points
    bypassHeader: 'X-API-Key', // Header to check for bypass keys
    bypassKeys: ['secret1'],   // Keys that bypass rate limiting
    keyGenerator: (req) => req.ip // Custom key generator
}));
```

### Fastify

```javascript
const fastify = require('fastify');
const rateLimiter = require('@hyperlimit/fastify');

const app = fastify();

app.register(async (instance) => {
    instance.addHook('preHandler', rateLimiter({
        maxTokens: 100,
        window: '1m',
        sliding: true
    }));
});
```

### HyperExpress

```javascript
const HyperExpress = require('hyper-express');
const rateLimiter = require('@hyperlimit/hyperexpress');

const app = new HyperExpress.Server();

app.use(rateLimiter({
    maxTokens: 100,
    window: '1m',
    sliding: true
}));
```

### Core Package Usage

For custom middleware or direct usage:

```javascript
const { HyperLimit } = require('hyperlimit');

// Create a rate limiter instance
const limiter = new HyperLimit({
    bucketCount: 16384  // Optional: number of hash table buckets (default: 16384)
});

// Create a limiter for a specific endpoint/feature
limiter.createLimiter(
    'api:endpoint1',    // Unique identifier for this limiter
    100,               // maxTokens: Maximum requests allowed
    60000,             // window: Time window in milliseconds
    true,              // sliding: Use sliding window
    30000,             // block: Block duration in milliseconds
    5                  // maxPenalty: Maximum penalty points
);

// Example usage in custom middleware
function customRateLimiter(options = {}) {
    const limiter = new HyperLimit();
    const defaultKey = 'default';
    
    // Create the limiter with options
    limiter.createLimiter(
        defaultKey,
        options.maxTokens || 100,
        typeof options.window === 'string' 
            ? parseTimeString(options.window) 
            : (options.window || 60000),
        options.sliding !== false,
        typeof options.block === 'string'
            ? parseTimeString(options.block)
            : (options.block || 0),
        options.maxPenalty || 0
    );

    // Return middleware function
    return function(req, res, next) {
        const key = options.keyGenerator?.(req) || req.ip;
        const allowed = limiter.tryRequest(key);

        if (!allowed) {
            const info = limiter.getRateLimitInfo(key);
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil(info.reset / 1000)
            });
        }

        // Attach limiter to request for later use
        req.rateLimit = { limiter, key };
        next();
    };
}

// Helper to parse time strings (e.g., '1m', '30s')
function parseTimeString(timeStr) {
    const units = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const match = timeStr.match(/^(\d+)([a-z]+)$/i);
    if (!match) return parseInt(timeStr, 10);
    const [, num, unit] = match;
    return parseInt(num, 10) * (units[unit] || units.ms);
}
```

## Advanced Features

### 1. Tenant-Based Rate Limiting

Perfect for SaaS applications with different tiers of service:

```javascript
// To simulate a database of tenant configurations
const tenantConfigs = new Map([
    ['basic-tier-key', {
        name: 'Basic Tier',
        endpoints: {
            '/api/data': { maxTokens: 5, window: '10s' },
            '/api/users': { maxTokens: 2, window: '10s' },
            '*': { maxTokens: 10, window: '60s' }
        }
    }],
    ['premium-tier-key', {
        name: 'Premium Tier',
        endpoints: {
            '/api/data': { maxTokens: 20, window: '10s' },
            '/api/users': { maxTokens: 10, window: '10s' },
            '*': { maxTokens: 50, window: '60s' }
        }
    }]
]);

// Dynamic rate limiting middleware
function dynamicRateLimit(tenantKey, endpoint) {
    return rateLimiter({
        maxTokens: tenantConfigs.get(tenantKey).endpoints[endpoint].maxTokens,
        window: tenantConfigs.get(tenantKey).endpoints[endpoint].window,
        keyGenerator: (req) => req.headers['x-api-key']
    });
}

app.get('/api/data', authenticateTenant, dynamicRateLimit, (req, res) => {
    res.json({ message: 'Rate limited based on tenant tier' });
});
```

### 2. Distributed Rate Limiting

For applications running across multiple servers:

```javascript
const Redis = require('ioredis');

const limiter = rateLimiter({
    maxTokens: 100,
    window: '1m',
    redis: new Redis({
        host: 'localhost',
        port: 6379,
        prefix: 'rl:'
    })
});
```

### 3. Penalty System

Handle abuse and violations:

```javascript
app.post('/api/sensitive', limiter, (req, res) => {
    if (violationDetected) {
        // Add penalty points
        req.rateLimit.limiter.addPenalty(req.rateLimit.key, 2);
        return res.status(400).json({ error: 'Violation detected' });
    }
    
    // Later, can remove penalties
    req.rateLimit.limiter.removePenalty(req.rateLimit.key, 1);
});
```

### 4. Monitoring and Statistics

Track rate limiting status:

```javascript
app.get('/status', (req, res) => {
    const info = req.rateLimit.limiter.getRateLimitInfo(req.rateLimit.key);
    res.json({
        limit: info.limit,
        remaining: info.remaining,
        reset: info.reset,
        blocked: info.blocked
    });
});
```

### 5. Redis Integration Details

When Redis is configured:
- Rate limits are synchronized across all application instances
- Tokens are stored and managed in Redis
- Automatic fallback to local rate limiting if Redis is unavailable
- Atomic operations ensure consistency
- Minimal latency overhead

Redis configuration options:
```javascript
{
    host: 'localhost',      // Redis host
    port: 6379,            // Redis port
    password: 'optional',   // Redis password
    db: 0,                 // Redis database number
    prefix: 'rl:',         // Key prefix for rate limit data
    connectTimeout: 10000,  // Connection timeout in ms
    maxRetriesPerRequest: 3 // Max retries per request
}
```

## Configuration Options

```typescript
interface RateLimiterOptions {
    // Core Options
    maxTokens: number;      // Maximum requests allowed
    window: string|number;  // Time window (e.g., '1m', '30s', or milliseconds)
    sliding?: boolean;      // Use sliding window (default: true)
    block?: string|number;  // Block duration after limit exceeded
    
    // Advanced Options
    maxPenalty?: number;     // Maximum penalty points
    bypassHeader?: string;   // Header for bypass keys
    bypassKeys?: string[];   // List of bypass keys
    keyGenerator?: (req) => string;  // Custom key generation
    
    // Distributed Options
    redis?: Redis;           // Redis client for distributed mode
    
    // Response Handling
    onRejected?: (req, res, info) => void;  // Custom rejection handler
}
```

## Response Headers

The middleware automatically sets these headers:
- `X-RateLimit-Limit`: Maximum allowed requests
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Seconds until limit resets

## Performance Benchmarks

HyperLimit achieves exceptional performance through:
- Native C++ implementation
- Lock-free atomic operations
- No external dependencies
- Efficient token bucket algorithm
- Minimal memory footprint

| Test Type | Requests/sec | Latency (ms) |
|-----------|-------------|--------------|
| Single Key | ~9.1M | 0.11 |
| Multi-Key | ~7.5M | 0.13 |
| Concurrent | ~3.2M | 0.31 |

### Detailed Benchmark Results

Tests performed on a MacBook Pro with Apple M3 Max, 64GB RAM. Each test measures:
- Single Key: Processing 1,000,000 requests through a single key
- Multi-Key: Processing 100,000 requests with unique keys
- Concurrent: Processing 100,000 concurrent requests with unique keys

#### Small Hash Table (1K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit | Req/sec (HyperLimit) |
|-----------|------------|----------------------|-------------------|---------------------|
| Single Key | 109.887ms | 176.971ms | 8.359s | ~9.1M |
| Multi-Key | 14.747ms | 90.725ms | 906.47ms | ~6.8M |
| Concurrent | 30.99ms | 96.715ms | 995.496ms | ~3.2M |

#### Default Hash Table (16K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit | Req/sec (HyperLimit) |
|-----------|------------|----------------------|-------------------|---------------------|
| Single Key | 106.497ms | 174.073ms | 9.338s | ~9.4M |
| Multi-Key | 13.311ms | 84.9ms | 985.935ms | ~7.5M |
| Concurrent | 34.857ms | 101.525ms | 986.597ms | ~2.9M |

#### Large Hash Table (64K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit | Req/sec (HyperLimit) |
|-----------|------------|----------------------|-------------------|---------------------|
| Single Key | 109.467ms | 184.259ms | 9.374s | ~9.1M |
| Multi-Key | 12.12ms | 77.029ms | 935.926ms | ~8.3M |
| Concurrent | 34.236ms | 90.011ms | 1.079s | ~2.9M |

Key findings:
- Up to 85x faster than Express Rate Limit
- Up to 7x faster than Rate Limiter Flexible
- Consistent performance across different hash table sizes
- Exceptional multi-key and concurrent performance
- Sub-millisecond latency in most scenarios

Note: These are synthetic benchmarks measuring raw performance without network overhead or real-world conditions. Actual performance will vary based on your specific use case and environment.

## Examples

Check out the [examples](./examples) directory for:
- Basic rate limiting setups
- Tenant-based configurations
- Distributed rate limiting
- Penalty system implementation
- Monitoring and statistics
- Custom key generation
- Framework-specific implementations

## Best Practices

1. **Key Generation**:
   - Use meaningful keys (e.g., `${req.ip}-${req.path}`)
   - Consider user identity for authenticated routes
   - Combine multiple factors for granular control

2. **Window Selection**:
   - Use sliding windows for smooth rate limiting
   - Match window size to endpoint sensitivity
   - Consider user experience when setting limits

3. **Distributed Setup**:
   - Enable Redis for multi-server deployments
   - Set appropriate prefix to avoid key collisions
   - Monitor Redis connection health

4. **Penalty System**:
   - Start with small penalties
   - Implement gradual penalty removal
   - Log penalty events for analysis

5. **Monitoring**:
   - Regularly check rate limit status
   - Monitor bypass key usage
   - Track penalty patterns

## Building from Source

```bash
# Clone the repository
git clone https://github.com/mehrantsi/hyperlimit.git

# Install dependencies
cd hyperlimit
npm install

# Build
npm run build

# Run tests
npm test

# Run examples
npm run example:express
npm run example:fastify
npm run example:hyperexpress
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details
