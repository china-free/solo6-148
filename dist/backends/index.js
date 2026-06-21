"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DarwinBackend = exports.LinuxBackend = exports.BackendManager = void 0;
const linux_1 = require("./linux");
Object.defineProperty(exports, "LinuxBackend", { enumerable: true, get: function () { return linux_1.LinuxBackend; } });
const darwin_1 = require("./darwin");
Object.defineProperty(exports, "DarwinBackend", { enumerable: true, get: function () { return darwin_1.DarwinBackend; } });
const utils_1 = require("../utils");
class BackendManager {
    constructor() {
        this.backend = null;
        this.platform = (0, utils_1.getPlatform)();
    }
    async init() {
        const backend = this.createBackend();
        if (!backend) {
            throw new Error(`Unsupported platform: ${this.platform}`);
        }
        const available = await backend.isAvailable();
        if (!available) {
            throw new Error(`Required tools not available for ${this.platform}. ` +
                `Please ensure the necessary network tools are installed.`);
        }
        this.backend = backend;
        return backend;
    }
    createBackend() {
        switch (this.platform) {
            case 'linux':
                return new linux_1.LinuxBackend();
            case 'darwin':
                return new darwin_1.DarwinBackend();
            case 'win32':
                return null;
            default:
                return null;
        }
    }
    getBackend() {
        return this.backend;
    }
    getPlatform() {
        return this.platform;
    }
    async apply(pid, profile) {
        if (!this.backend) {
            throw new Error('Backend not initialized. Call init() first.');
        }
        await this.backend.apply(pid, profile);
    }
    async cleanup() {
        if (this.backend) {
            await this.backend.cleanup();
        }
    }
    async checkRoot() {
        if (!this.backend) {
            return false;
        }
        return this.backend.checkRoot();
    }
    getPlatformDescription() {
        switch (this.platform) {
            case 'linux':
                return 'Linux (using tc + cgroup + iptables)';
            case 'darwin':
                return 'macOS (using pf + dnctl)';
            case 'win32':
                return 'Windows (not yet supported)';
            default:
                return 'Unknown platform';
        }
    }
}
exports.BackendManager = BackendManager;
//# sourceMappingURL=index.js.map