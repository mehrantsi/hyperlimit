const { HyperLimit } = require('@hyperlimit/core');

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
        configResolver,
        onRejected,
        redis,
        nats
    } = options;

    // Create limiter instance with distributed storage if configured
    const limiterOptions = {};
    if (redis) limiterOptions.redis = redis;
    if (nats) limiterOptions.nats = nats;
    const limiter = new HyperLimit(Object.keys(limiterOptions).length > 0 ? limiterOptions : undefined);

    // If configResolver is provided, we'll create limiters dynamically
    // Otherwise, create a static limiter for backward compatibility
    if (!configResolver) {
        // Convert time strings to milliseconds for static config
        const windowMs = parseDuration(window);
        const blockMs = block ? parseDuration(block) : 0;
        limiter.createLimiter(key, maxTokens, windowMs, sliding, blockMs, maxPenalty);
    }
    
    // Cache for resolved configs to avoid excessive calls to configResolver
    const configCache = new Map();
    const CONFIG_CACHE_TTL = 60000; // 1 minute cache

    return function rateLimitMiddleware(req, res, next) {
        try {
            // Check bypass keys if configured
            if (bypassHeader) {
                const bypassKey = req.headers[bypassHeader.toLowerCase()];
                if (bypassKeys.includes(bypassKey)) {
                    return next();
                }
            }

            // Generate key if custom generator provided
            let clientKey;
            try {
                clientKey = keyGenerator ? 
                    keyGenerator(req) : 
                    req.ip;
            } catch (e) {
                // If keyGenerator fails, fall back to IP
                clientKey = req.ip;
            }

            // Determine the limiter key and config to use
            let limiterKey = key;
            let effectiveConfig = null;
            
            if (configResolver) {
                // When using configResolver, always use clientKey as limiterKey
                limiterKey = clientKey;
                
                // Check cache first
                const cached = configCache.get(clientKey);
                const now = Date.now();
                
                if (cached && (now - cached.timestamp < CONFIG_CACHE_TTL)) {
                    effectiveConfig = cached.config;
                } else {
                    // Resolve config
                    const resolvedConfig = configResolver(clientKey);
                    effectiveConfig = resolvedConfig;
                    
                    // Cache the result (even if null)
                    configCache.set(clientKey, { config: resolvedConfig, timestamp: now });
                    
                    // Clean up old cache entries periodically
                    if (configCache.size > 1000) {
                        for (const [k, v] of configCache) {
                            if (now - v.timestamp > CONFIG_CACHE_TTL) {
                                configCache.delete(k);
                            }
                        }
                    }
                    
                }
                
                // If config is null or explicitly denies access, reject immediately
                if (!effectiveConfig || effectiveConfig.deny || effectiveConfig.maxTokens === 0) {
                    res.setHeader('X-RateLimit-Limit', '0');
                    res.setHeader('X-RateLimit-Remaining', '0');
                    res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.now() / 1000)));
                    
                    if (onRejected) {
                        return onRejected(req, res, {
                            error: 'Access denied',
                            retryAfter: 3600
                        });
                    }
                    
                    return res.status(429).json({
                        error: 'Access denied',
                        retryAfter: 3600
                    });
                }
                
                // Always create/update the limiter with resolved config when not cached
                if (!cached || (now - cached.timestamp >= CONFIG_CACHE_TTL)) {
                    const resolvedWindowMs = parseDuration(effectiveConfig?.window || window);
                    const resolvedBlockMs = effectiveConfig?.block ? parseDuration(effectiveConfig.block) : (block ? parseDuration(block) : 0);
                    const resolvedMaxTokens = effectiveConfig?.maxTokens || maxTokens;
                    const resolvedSliding = effectiveConfig?.sliding !== undefined ? effectiveConfig.sliding : sliding;
                    const resolvedMaxPenalty = effectiveConfig?.maxPenalty !== undefined ? effectiveConfig.maxPenalty : maxPenalty;
                    
                    // Create/update the limiter (createLimiter updates if it exists)
                    limiter.createLimiter(
                        limiterKey, 
                        resolvedMaxTokens, 
                        resolvedWindowMs, 
                        resolvedSliding, 
                        resolvedBlockMs, 
                        resolvedMaxPenalty
                    );
                }
            }

            // Attach limiter to request for potential use in route handlers
            req.rateLimit = { limiter, key: limiterKey };

            const allowed = limiter.tryRequest(limiterKey, req.ip);
            
            // Get rate limit info after the request
            let info;
            try {
                info = limiter.getRateLimitInfo(limiterKey);
            } catch (e) {
                // If limiter doesn't exist, use default values
                const resolvedLimit = effectiveConfig?.maxTokens || maxTokens;
                const resolvedWindow = effectiveConfig?.window || window;
                info = {
                    limit: resolvedLimit,
                    remaining: 0,
                    reset: Date.now() + parseDuration(resolvedWindow),
                    blocked: false
                };
            }
            
            // Set rate limit headers
            res.setHeader('X-RateLimit-Limit', String(info.limit));
            res.setHeader('X-RateLimit-Remaining', String(Math.max(0, info.remaining)));
            res.setHeader('X-RateLimit-Reset', String(Math.ceil(info.reset / 1000))); // Convert to seconds
            
            if (allowed) {
                return next();
            }

            // Calculate retryAfter based on resolved config or default
            const configuredWindow = effectiveConfig ? parseDuration(effectiveConfig.window || window) : parseDuration(window);
            const retryAfterSeconds = info.retryAfter || Math.ceil(configuredWindow / 1000);
            
            // Return rejection info to be handled by custom handler
            if (onRejected) {
                return onRejected(req, res, {
                    error: 'Too many requests',
                    retryAfter: retryAfterSeconds
                });
            }

            // Default handling if no onRejected provided
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: retryAfterSeconds
            });
        } catch (error) {
            return next(error);
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

module.exports = rateLimit; 