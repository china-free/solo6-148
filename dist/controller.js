"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworkController = void 0;
const backends_1 = require("./backends");
const profiles_1 = require("./profiles");
const process_1 = require("./process");
const utils_1 = require("./utils");
class NetworkController {
    constructor() {
        this.activeProfile = null;
        this.activePid = null;
        this.signalHandler = null;
        this.backendManager = new backends_1.BackendManager();
    }
    async init() {
        await this.backendManager.init();
    }
    getPlatform() {
        return this.backendManager.getPlatformDescription();
    }
    async checkRoot() {
        return this.backendManager.checkRoot();
    }
    listAvailableProfiles() {
        return (0, profiles_1.listProfiles)().map((p) => ({
            name: p.name,
            description: p.description,
            download: (0, profiles_1.formatBandwidth)(p.bandwidth.download),
            upload: (0, profiles_1.formatBandwidth)(p.bandwidth.upload),
            latency: `${p.latency}ms`,
            loss: `${p.packetLoss}%`,
        }));
    }
    async getProfileInfo(name) {
        return (0, profiles_1.getProfile)(name);
    }
    buildCustomProfile(options) {
        const base = (0, profiles_1.getProfile)('Custom');
        return {
            ...base,
            bandwidth: {
                download: options.download ? options.download * 1024 * 1024 : base.bandwidth.download,
                upload: options.upload ? options.upload * 1024 * 1024 : base.bandwidth.upload,
            },
            latency: options.latency ?? base.latency,
            jitter: options.jitter ?? base.jitter,
            packetLoss: options.loss ?? base.packetLoss,
        };
    }
    async applyProfile(pid, profileName, options) {
        let profile;
        if (profileName === 'Custom' && options) {
            profile = this.buildCustomProfile(options);
        }
        else {
            profile = (0, profiles_1.getProfile)(profileName);
            if (!profile) {
                throw new Error(`Profile '${profileName}' not found. Use --list to see available profiles.`);
            }
            if (options) {
                profile = { ...profile };
                if (options.download !== undefined) {
                    profile.bandwidth.download = options.download * 1024 * 1024;
                }
                if (options.upload !== undefined) {
                    profile.bandwidth.upload = options.upload * 1024 * 1024;
                }
                if (options.latency !== undefined) {
                    profile.latency = options.latency;
                }
                if (options.jitter !== undefined) {
                    profile.jitter = options.jitter;
                }
                if (options.loss !== undefined) {
                    profile.packetLoss = options.loss;
                }
            }
        }
        const processInfo = await (0, process_1.getProcessInfo)(pid);
        if (!processInfo) {
            throw new Error(`Process ${pid} does not exist.`);
        }
        this.activePid = pid;
        this.activeProfile = profile;
        await this.backendManager.apply(pid, profile);
    }
    async getProcessStatus(pid) {
        const info = await (0, process_1.getProcessInfo)(pid);
        if (!info)
            return null;
        const ports = await (0, process_1.getProcessPorts)(pid);
        return {
            pid: info.pid,
            name: info.name,
            ports: info.ports,
            tcpPorts: ports.tcp,
            udpPorts: ports.udp,
            user: info.user,
            cmdline: info.cmdline,
        };
    }
    async runWithDuration(pid, profileName, duration, options) {
        await this.applyProfile(pid, profileName, options);
        await (0, utils_1.sleep)(duration * 1000);
        await this.cleanup();
    }
    setSignalHandler(handler) {
        this.signalHandler = handler;
    }
    async handleSignal() {
        if (this.signalHandler) {
            await this.signalHandler();
        }
        await this.cleanup();
    }
    async cleanup() {
        try {
            await this.backendManager.cleanup();
        }
        finally {
            this.activeProfile = null;
            this.activePid = null;
        }
    }
    getActiveConfig() {
        return {
            pid: this.activePid,
            profile: this.activeProfile,
        };
    }
    formatProfileSummary(profile) {
        return [
            `  Profile:      ${profile.name}`,
            `  Description:  ${profile.description}`,
            `  Bandwidth:    ↓ ${(0, profiles_1.formatBandwidth)(profile.bandwidth.download)} / ↑ ${(0, profiles_1.formatBandwidth)(profile.bandwidth.upload)}`,
            `  Latency:      ${profile.latency}ms (±${profile.jitter}ms)`,
            `  Packet Loss:  ${profile.packetLoss}%`,
            profile.packetCorruption ? `  Corruption:   ${profile.packetCorruption}%` : null,
            profile.packetReordering ? `  Reordering:   ${profile.packetReordering}%` : null,
        ]
            .filter(Boolean)
            .join('\n');
    }
}
exports.NetworkController = NetworkController;
//# sourceMappingURL=controller.js.map