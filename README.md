# HyperLimit

[![npm version](https://badge.fury.io/js/hyperlimit.svg)](https://badge.fury.io/js/hyperlimit)
[![Build Status](https://github.com/mehrantsi/hyperlimit/workflows/Build/badge.svg)](https://github.com/mehrantsi/hyperlimit/actions)
[![Test Status](https://github.com/mehrantsi/hyperlimit/workflows/Test/badge.svg)](https://github.com/mehrantsi/hyperlimit/actions)

High-performance native rate limiter for Node.js with lock-free design. Capable of handling 9M+ requests per second.

## Features

- 🚀 Native C++ implementation for maximum performance
- 🔒 Lock-free design for high concurrency
- 🎯 Per-key rate limiting with configurable windows
- 💾 Memory-efficient implementation
- 🔄 Automatic token refill
- 🎭 Multiple independent rate limiters
- 📊 Token tracking and statistics
- 🛡️ Thread-safe operations
- 🌐 Distributed rate limiting support
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
  public: { limit: 100, window: 60000 },  // 100 requests per minute
  protected: { limit: 5, window: 60000 },  // 5 requests per minute
  custom: { limit: 20, window: 60000 }     // 20 requests per minute
});

// Apply middleware to routes
app.get('/api/public', limiter('public'), (req, res) => {
  res.json({ message: 'Public API response' });
});

app.get('/api/protected', limiter('protected'), (req, res) => {
  res.json({ message: 'Protected API response' });
});

// Get metrics
app.get('/metrics', (req, res) => {
  res.json(limiter.getMetrics());
});
```

### Fastify

```javascript
const fastify = require('fastify');
const rateLimiter = require('@hyperlimit/fastify');

const app = fastify();

// Create middleware with configuration
const limiter = rateLimiter({
  public: { limit: 100, window: 60000 },
  protected: { limit: 5, window: 60000 },
  custom: { limit: 20, window: 60000 }
});

// Apply middleware to routes
app.get('/api/public', { preHandler: limiter('public') }, (req, reply) => {
  reply.send({ message: 'Public API response' });
});

app.get('/api/protected', { preHandler: limiter('protected') }, (req, reply) => {
  reply.send({ message: 'Protected API response' });
});

// Get metrics
app.get('/metrics', (req, reply) => {
  reply.send(limiter.getMetrics());
});
```

### HyperExpress

```javascript
const HyperExpress = require('hyper-express');
const rateLimiter = require('@hyperlimit/hyperexpress');

const app = new HyperExpress.Server();

// Create middleware with configuration
const limiter = rateLimiter({
  public: { limit: 100, window: 60000 },
  protected: { limit: 5, window: 60000 },
  custom: { limit: 20, window: 60000 }
});

// Apply middleware to routes
app.get('/api/public', limiter('public'), (req, res) => {
  res.json({ message: 'Public API response' });
});

app.get('/api/protected', limiter('protected'), (req, res) => {
  res.json({ message: 'Protected API response' });
});

// Get metrics
app.get('/metrics', (req, res) => {
  res.json(limiter.getMetrics());
});
```

### Distributed Mode

For distributed environments, HyperLimit supports Redis-based synchronization:

```javascript
const rateLimiter = require('@hyperlimit/express'); // or fastify/hyperexpress
const Redis = require('ioredis');

const redis = new Redis({
  host: 'localhost',
  port: 6379
});

const limiter = rateLimiter({
  public: { limit: 100, window: 60000 },
  protected: { limit: 5, window: 60000 }
}, {
  distributed: true,
  store: redis
});
```

## API Reference

### Framework-specific Packages

#### `@hyperlimit/express`
#### `@hyperlimit/fastify`
#### `@hyperlimit/hyperexpress`

Each package exports a function that creates a middleware instance:

```typescript
function createMiddleware(config: RateLimiterConfig, options?: Options): Middleware;

interface RateLimiterConfig {
  [key: string]: {
    limit: number;    // Maximum requests
    window: number;   // Time window in milliseconds
  };
}

interface Options {
  distributed?: boolean;      // Enable distributed mode
  store?: Redis;             // Redis client for distributed mode
  prefix?: string;           // Key prefix for Redis (default: 'rl:')
}
```

### Middleware Instance Methods

#### `middleware(key: string)`

Creates a middleware function for a specific rate limiter.

- `key`: The rate limiter key to use
- Returns: Framework-specific middleware function

#### `getMetrics()`

Gets the current metrics for all rate limiters.

Returns:
```typescript
{
  stats: {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    penalizedRequests: number;
    allowRate: number;
    blockRate: number;
    penaltyRate: number;
  };
  rateLimits: {
    [key: string]: {
      limit: number;
      remaining: number;
      reset: number;
      blocked: boolean;
    };
  };
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

Tests performed on a MacBook Pro with Apple M3 Max, 64GB RAM:

#### Small Hash Table (1K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit |
|-----------|------------|----------------------|-------------------|
| Single Key | 109.887ms | 176.971ms | 8.359s |
| Multi-Key | 14.747ms | 90.725ms | 906.47ms |
| Concurrent | 30.99ms | 96.715ms | 995.496ms |

#### Default Hash Table (16K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit |
|-----------|------------|----------------------|-------------------|
| Single Key | 106.497ms | 174.073ms | 9.338s |
| Multi-Key | 13.311ms | 84.9ms | 985.935ms |
| Concurrent | 34.857ms | 101.525ms | 986.597ms |

#### Large Hash Table (64K)

| Test Type | HyperLimit | Rate Limiter Flexible | Express Rate Limit |
|-----------|------------|----------------------|-------------------|
| Single Key | 109.467ms | 184.259ms | 9.374s |
| Multi-Key | 12.12ms | 77.029ms | 935.926ms |
| Concurrent | 34.236ms | 90.011ms | 1.079s |

Key findings:
- Up to 85x faster than Express Rate Limit
- Up to 7x faster than Rate Limiter Flexible
- Consistent performance across different hash table sizes
- Exceptional multi-key and concurrent performance
- Sub-millisecond latency in most scenarios

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
