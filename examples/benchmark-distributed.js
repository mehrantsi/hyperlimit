const { HyperLimit } = require('../');

async function runBenchmark(name, createLimiter, iterations = 100000) {
    console.log(`\n${name}:`);
    console.log('='.repeat(50));
    
    let limiter;
    try {
        limiter = await createLimiter();
    } catch (err) {
        console.log(`  ❌ Not available: ${err.message}`);
        return;
    }

    // Warmup
    for (let i = 0; i < 1000; i++) {
        limiter.tryRequest('warmup');
    }

    // Single key performance
    const key = 'benchmark:' + Date.now();
    console.time(`  ${iterations} requests (single key)`);
    let allowed = 0;
    for (let i = 0; i < iterations; i++) {
        if (limiter.tryRequest(key)) allowed++;
    }
    console.timeEnd(`  ${iterations} requests (single key)`);
    console.log(`  Allowed: ${allowed}, Blocked: ${iterations - allowed}`);

    // Multiple keys performance
    console.time(`  ${iterations} requests (multiple keys)`);
    allowed = 0;
    for (let i = 0; i < iterations; i++) {
        const multiKey = `benchmark:${i % 1000}`;
        if (limiter.tryRequest(multiKey)) allowed++;
    }
    console.timeEnd(`  ${iterations} requests (multiple keys)`);
    console.log(`  Allowed: ${allowed}, Blocked: ${iterations - allowed}`);

    // Concurrent operations simulation
    const concurrentOps = 10000;
    const promises = [];
    console.time(`  ${concurrentOps} concurrent operations`);
    
    for (let i = 0; i < concurrentOps; i++) {
        promises.push(new Promise(resolve => {
            setTimeout(() => {
                resolve(limiter.tryRequest(`concurrent:${i % 100}`));
            }, Math.random() * 10);
        }));
    }
    
    const results = await Promise.all(promises);
    const concurrentAllowed = results.filter(r => r).length;
    console.timeEnd(`  ${concurrentOps} concurrent operations`);
    console.log(`  Allowed: ${concurrentAllowed}, Blocked: ${concurrentOps - concurrentAllowed}`);
}

async function main() {
    console.log('Distributed Rate Limiter Benchmark');
    console.log('==================================');
    console.log('Comparing Redis vs NATS performance\n');

    const config = {
        maxTokens: 10000,
        windowMs: 60000
    };

    // Local (baseline)
    await runBenchmark('Local Storage (Baseline)', async () => {
        const limiter = new HyperLimit({ bucketCount: 16384 });
        limiter.createLimiter('test', config.maxTokens, config.windowMs);
        return limiter;
    });

    // Redis
    await runBenchmark('Redis Storage', async () => {
        const limiter = new HyperLimit({
            bucketCount: 16384,
            redis: {
                host: 'localhost',
                port: 6379,
                prefix: 'bench_'
            }
        });
        limiter.createLimiter('test', config.maxTokens, config.windowMs, true, 0, 0, 'test:dist');
        return limiter;
    });

    // NATS
    await runBenchmark('NATS Storage', async () => {
        const limiter = new HyperLimit({
            bucketCount: 16384,
            nats: {
                servers: 'nats://localhost:4222',
                bucket: 'benchmark-limits',
                prefix: 'bench_'
            }
        });
        limiter.createLimiter('test', config.maxTokens, config.windowMs, true, 0, 0, 'test:dist');
        return limiter;
    });

    // NATS with multiple servers (cluster simulation)
    await runBenchmark('NATS Storage (Cluster)', async () => {
        const limiter = new HyperLimit({
            bucketCount: 16384,
            nats: {
                servers: [
                    'nats://localhost:4222',
                    'nats://localhost:4223',
                    'nats://localhost:4224'
                ],
                bucket: 'benchmark-limits',
                prefix: 'bench_'
            }
        });
        limiter.createLimiter('test', config.maxTokens, config.windowMs, true, 0, 0, 'test:dist');
        return limiter;
    });

    console.log('\n✅ Benchmark complete!');
    console.log('\nNotes:');
    console.log('- Redis typically has lower latency for simple operations');
    console.log('- NATS excels in distributed scenarios with built-in clustering');
    console.log('- Local storage is fastest but doesn\'t support distributed limits');
    console.log('- Actual performance depends on network latency and server configuration');
    
    // Give time for connections to close
    await new Promise(resolve => setTimeout(resolve, 100));
    process.exit(0);
}

main().catch(err => {
    console.error('Benchmark error:', err);
    process.exit(1);
});