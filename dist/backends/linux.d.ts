import { Backend, NetworkProfile, Platform } from '../types';
export declare class LinuxBackend implements Backend {
    readonly platform: Platform;
    private config;
    private net_clsPath;
    isAvailable(): Promise<boolean>;
    checkRoot(): Promise<boolean>;
    private checkCgroupAvailable;
    private ensureNetClsMounted;
    private generateClassid;
    private generateFwmark;
    private profileToTcArgs;
    apply(pid: number, profile: NetworkProfile): Promise<void>;
    private setupTrafficControl;
    private setupIptables;
    cleanup(): Promise<void>;
}
