const { HyperLimit } = require('../build/Release/hyperlimit.node');

// Create a shared limiter instance
const limiter = new HyperLimit();

// Fastify-specific adapter
const fastifyAdapter = {
    getHeaders: req => req.headers,
    getClientIdentifier: req => req.ip,
    setResponseHeader: (res, name, value) => res.header(name, String(value)),
    sendError: (res, status, body) => res.code(status).send(body)
};

function rateLimit(options = {}) {
    const {
        maxTokens = 100,
        window = '1m',
        maxPenalty = 0,
        block = '',
        sliding = true,
        key = 'default',
        bypassHeader,
        bypassKeys = [],
        keyGenerator,
        onRejected
    } = options;

    // Convert time strings to milliseconds
    const windowMs = parseDuration(window);
    const blockMs = block ? parseDuration(block) : 0;

    // Create or get limiter
    try {
        limiter.createLimiter(key, maxTokens, windowMs, blockMs, maxPenalty);
    } catch (error) {
        if (!error.message.includes('already exists')) {
            throw error;
        }
    }

    return async function rateLimitMiddleware(request, reply) {
        try {
            // Check bypass keys if configured
            if (bypassHeader) {
                const bypassKey = request.headers[bypassHeader.toLowerCase()];
                if (bypassKeys.includes(bypassKey)) {
                    return;
                }
            }

            // Generate key if custom generator provided
            const clientKey = keyGenerator ? 
                keyGenerator(request) : 
                request.ip;

            // Get rate limit info before request
            const info = limiter.getRateLimitInfo(key);
            
            // Set rate limit headers
            reply.header('X-RateLimit-Limit', String(info.limit));
            reply.header('X-RateLimit-Remaining', String(Math.max(0, info.remaining)));
            reply.header('X-RateLimit-Reset', String(Math.ceil(info.reset / 1000))); // Convert to seconds

            const allowed = limiter.tryRequest(key, clientKey);
            if (allowed) {
                return;
            }

            // Return rejection info to be handled by custom handler
            if (onRejected) {
                return onRejected(request, reply, {
                    error: 'Too many requests',
                    retryAfter: info.retryAfter || Math.ceil((info.reset - Date.now()) / 1000)
                });
            }

            // Default handling if no onRejected provided
            reply.code(429).send({
                error: 'Too many requests',
                retryAfter: info.retryAfter || Math.ceil((info.reset - Date.now()) / 1000)
            });
        } catch (error) {
            request.log.error(error);
            throw error;
        }
    };
}

function parseDuration(duration) {
    if (typeof duration === 'number') {
        return duration;
    }
    
    const match = duration.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
        throw new Error('Invalid duration format. Use number or string (e.g., "500ms", "1s", "5m", "2h", "1d")');
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
        case 'ms': return value;
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: throw new Error('Invalid time unit');
    }
}

// Export the middleware factory and limiter instance
module.exports = Object.assign(rateLimit, { limiter }); 