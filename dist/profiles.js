"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NETWORK_PROFILES = void 0;
exports.getProfile = getProfile;
exports.listProfiles = listProfiles;
exports.formatBandwidth = formatBandwidth;
exports.NETWORK_PROFILES = {
    '2G': {
        name: '2G',
        description: 'EDGE/GPRS network - very slow, high latency',
        bandwidth: {
            download: 256 * 1024,
            upload: 128 * 1024,
        },
        latency: 300,
        jitter: 200,
        packetLoss: 2,
    },
    '3G': {
        name: '3G',
        description: 'UMTS/HSPA network - moderate speed',
        bandwidth: {
            download: 2 * 1024 * 1024,
            upload: 1 * 1024 * 1024,
        },
        latency: 150,
        jitter: 50,
        packetLoss: 1,
    },
    '3G-Slow': {
        name: '3G-Slow',
        description: 'Slow 3G network',
        bandwidth: {
            download: 780 * 1024,
            upload: 330 * 1024,
        },
        latency: 200,
        jitter: 100,
        packetLoss: 1,
    },
    '4G': {
        name: '4G',
        description: 'LTE network - fast mobile broadband',
        bandwidth: {
            download: 10 * 1024 * 1024,
            upload: 5 * 1024 * 1024,
        },
        latency: 50,
        jitter: 10,
        packetLoss: 0.5,
    },
    'DSL': {
        name: 'DSL',
        description: 'Home DSL connection',
        bandwidth: {
            download: 4 * 1024 * 1024,
            upload: 1 * 1024 * 1024,
        },
        latency: 40,
        jitter: 5,
        packetLoss: 0.2,
    },
    'Cable': {
        name: 'Cable',
        description: 'Cable modem connection',
        bandwidth: {
            download: 20 * 1024 * 1024,
            upload: 5 * 1024 * 1024,
        },
        latency: 20,
        jitter: 5,
        packetLoss: 0.1,
    },
    'FIOS': {
        name: 'FIOS',
        description: 'Fiber optic connection',
        bandwidth: {
            download: 100 * 1024 * 1024,
            upload: 100 * 1024 * 1024,
        },
        latency: 5,
        jitter: 1,
        packetLoss: 0,
    },
    'HighLatency': {
        name: 'HighLatency',
        description: 'High latency network (e.g., satellite)',
        bandwidth: {
            download: 5 * 1024 * 1024,
            upload: 2 * 1024 * 1024,
        },
        latency: 600,
        jitter: 100,
        packetLoss: 0.5,
    },
    'HighPacketLoss': {
        name: 'HighPacketLoss',
        description: 'Network with high packet loss (unreliable connection)',
        bandwidth: {
            download: 10 * 1024 * 1024,
            upload: 5 * 1024 * 1024,
        },
        latency: 50,
        jitter: 30,
        packetLoss: 10,
        packetCorruption: 1,
    },
    'VeryHighPacketLoss': {
        name: 'VeryHighPacketLoss',
        description: 'Extremely high packet loss (edge case testing)',
        bandwidth: {
            download: 5 * 1024 * 1024,
            upload: 2 * 1024 * 1024,
        },
        latency: 100,
        jitter: 50,
        packetLoss: 25,
        packetCorruption: 2,
        packetReordering: 5,
    },
    'Flaky': {
        name: 'Flaky',
        description: 'Intermittent connectivity with packet reordering',
        bandwidth: {
            download: 8 * 1024 * 1024,
            upload: 4 * 1024 * 1024,
        },
        latency: 80,
        jitter: 40,
        packetLoss: 5,
        packetReordering: 3,
    },
    'LowBandwidth': {
        name: 'LowBandwidth',
        description: 'Very restricted bandwidth',
        bandwidth: {
            download: 512 * 1024,
            upload: 256 * 1024,
        },
        latency: 100,
        jitter: 30,
        packetLoss: 1,
    },
    'Offline': {
        name: 'Offline',
        description: 'Simulate complete network disconnection',
        bandwidth: {
            download: 0,
            upload: 0,
        },
        latency: 0,
        jitter: 0,
        packetLoss: 100,
    },
    'Custom': {
        name: 'Custom',
        description: 'Custom network profile - use flags to configure',
        bandwidth: {
            download: 0,
            upload: 0,
        },
        latency: 0,
        jitter: 0,
        packetLoss: 0,
    },
};
function getProfile(name) {
    return exports.NETWORK_PROFILES[name];
}
function listProfiles() {
    return Object.values(exports.NETWORK_PROFILES);
}
function formatBandwidth(bps) {
    if (bps === 0)
        return '0';
    if (bps >= 1024 * 1024 * 1024) {
        return `${(bps / (1024 * 1024 * 1024)).toFixed(1)}Gbps`;
    }
    if (bps >= 1024 * 1024) {
        return `${(bps / (1024 * 1024)).toFixed(1)}Mbps`;
    }
    if (bps >= 1024) {
        return `${(bps / 1024).toFixed(1)}Kbps`;
    }
    return `${bps}bps`;
}
//# sourceMappingURL=profiles.js.map