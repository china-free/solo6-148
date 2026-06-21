import { NetworkProfile, CLIOptions, SignalHandler } from './types';
export declare class NetworkController {
    private backendManager;
    private activeProfile;
    private activePid;
    private signalHandler;
    constructor();
    init(): Promise<void>;
    getPlatform(): string;
    checkRoot(): Promise<boolean>;
    listAvailableProfiles(): Array<{
        name: string;
        description: string;
        download: string;
        upload: string;
        latency: string;
        loss: string;
    }>;
    getProfileInfo(name: string): Promise<NetworkProfile | undefined>;
    buildCustomProfile(options: CLIOptions): NetworkProfile;
    applyProfile(pid: number, profileName: string, options?: CLIOptions): Promise<void>;
    getProcessStatus(pid: number): Promise<{
        pid: number;
        name: string;
        ports: number[];
        tcpPorts: number[];
        udpPorts: number[];
        user: string;
        cmdline: string;
    } | null>;
    runWithDuration(pid: number, profileName: string, duration: number, options?: CLIOptions): Promise<void>;
    setSignalHandler(handler: SignalHandler): void;
    handleSignal(): Promise<void>;
    cleanup(): Promise<void>;
    cleanupSync(): void;
    emergencyRestoreSync(): boolean;
    getActiveConfig(): {
        pid: number | null;
        profile: NetworkProfile | null;
    };
    formatProfileSummary(profile: NetworkProfile): string;
}
