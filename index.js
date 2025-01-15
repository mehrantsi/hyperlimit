const hyperlimit = require('node-gyp-build')(__dirname);

// Export the native module
module.exports = hyperlimit;

// Also export the DistributedStorage base class for extensions
class DistributedStorage {
    constructor() {}
    tryAcquire(key, tokens) { throw new Error('Not implemented'); }
    release(key, tokens) { throw new Error('Not implemented'); }
}

hyperlimit.DistributedStorage = DistributedStorage; 