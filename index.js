const hyperlimit = require('./build/Release/hyperlimit.node');

// Export the native module
module.exports = hyperlimit;

// Also export the DistributedStorage base class for extensions
class DistributedStorage {
    constructor() {}
    tryAcquire(key, tokens) { throw new Error('Not implemented'); }
    release(key, tokens) { throw new Error('Not implemented'); }
}

hyperlimit.DistributedStorage = DistributedStorage; 