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
- 🔄 Automatic token refill
- 🎭 Multiple independent rate limiters
- 📊 Token tracking and statistics
- 🛡️ Thread-safe operations
- 🌐 Redis-based distributed rate limiting
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

## Usage

### Express.js

```javascript
const express = require('express');
const rateLimiter = require('@hyperlimit/express');

const app = express();

// Create middleware with configuration
const limiter = rateLimiter({
  maxTokens: 100,           // Maximum requests allowed
  window: '1m',            // Time window (supports ms, s, m, h, d)
  sliding: true,           // Use sliding window algorithm
  block: '1h',            // Block duration after limit exceeded
  maxPenalty: 10,         // Maximum penalty points
  bypassHeader: 'X-API-Key', // Header to check for bypass keys
  bypassKeys: ['secret1'],   // Keys that bypass rate limiting
  keyGenerator: (req) => req.ip, // Custom key generator
  onRejected: (req, res, info) => {  // Custom rejection handler
    res.status(429).json(info);
  }
});

// Apply middleware to routes
app.get('/api', limiter, (req, res) => {
  res.json({ message: 'API response' });
});

// Access rate limiter in route handlers
app.get('/status', (req, res) => {
  const info = req.rateLimit.limiter.getRateLimitInfo(req.rateLimit.key);
  res.json(info);
});
```

### Fastify

```javascript
const fastify = require('fastify');
const rateLimiter = require('@hyperlimit/fastify');

const app = fastify();

// Create middleware with configuration
const limiter = rateLimiter({
  maxTokens: 100,
  window: '1m',
  sliding: true,
  block: '1h',
  maxPenalty: 10,
  bypassHeader: 'X-API-Key',
  bypassKeys: ['secret1'],
  keyGenerator: (req) => req.ip,
  onRejected: (req, reply, info) => {
    reply.code(429).send(info);
  }
});

// Apply middleware to routes
app.get('/api', { preHandler: limiter }, (req, reply) => {
  reply.send({ message: 'API response' });
});
```

### HyperExpress

```javascript
const HyperExpress = require('hyper-express');
const rateLimiter = require('@hyperlimit/hyperexpress');

const app = new HyperExpress.Server();

// Create middleware with configuration
const limiter = rateLimiter({
  maxTokens: 100,
  window: '1m',
  sliding: true,
  block: '1h',
  maxPenalty: 10,
  bypassHeader: 'X-API-Key',
  bypassKeys: ['secret1'],
  keyGenerator: (req) => req.ip,
  onRejected: (req, res, info) => {
    res.status(429).json(info);
  }
});

// Apply middleware to routes
app.get('/api', limiter, (req, res) => {
  res.json({ message: 'API response' });
});
```

### Distributed Rate Limiting with Redis

For distributed environments, HyperLimit supports Redis-based synchronization:

```javascript
const Redis = require('ioredis');
const rateLimiter = require('@hyperlimit/express'); // or fastify/hyperexpress

// Create Redis client
const redis = new Redis({
  host: 'localhost',
  port: 6379
});

// Create middleware with Redis support
const limiter = rateLimiter({
  maxTokens: 100,
  window: '1m',
  sliding: true,
  redis: redis  // Pass Redis client for distributed rate limiting
});

// The rate limits will now be synchronized across all instances
app.get('/api', limiter, (req, res) => {
  res.json({ message: 'Rate limited across all instances' });
});
```

When Redis is configured:
- Rate limits are synchronized across all application instances
- Tokens are stored and managed in Redis
- Automatic fallback to local rate limiting if Redis is unavailable
- Atomic operations ensure consistency
- Minimal latency overhead

## API Reference

### Middleware Options

```typescript
interface RateLimiterOptions {
  maxTokens?: number;      // Maximum requests allowed (default: 100)
  window?: string|number;  // Time window in ms or string (default: '1m')
  sliding?: boolean;       // Use sliding window (default: true)
  block?: string|number;   // Block duration after limit exceeded (default: '')
  maxPenalty?: number;     // Maximum penalty points (default: 0)
  key?: string;           // Rate limiter key (default: 'default')
  bypassHeader?: string;  // Header to check for bypass keys
  bypassKeys?: string[];  // Keys that bypass rate limiting
  keyGenerator?: (req) => string;  // Custom key generator
  onRejected?: (req, res, info) => void;  // Custom rejection handler
  redis?: Redis;          // Redis client for distributed mode
}

interface RejectionInfo {
  error: string;
  retryAfter: number;    // Seconds until retry is allowed
}
```

### Headers

The middleware sets the following response headers:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time in seconds until the limit resets

### Request Attachment

The middleware attaches rate limit information to the request object:
```typescript
req.rateLimit = {
  limiter: HyperLimit;  // Rate limiter instance
  key: string;         // Current rate limiter key
}
```

## Performance

HyperLimit is designed for high-performance scenarios:

- Lock-free atomic operations
- Native C++ implementation
- Minimal memory footprint
- No external dependencies
- Efficient token bucket algorithm

### Benchmark Results

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
