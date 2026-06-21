import { Backend, NetworkProfile, Platform } from '../types';
export declare class DarwinBackend implements Backend {
    readonly platform: Platform;
    private config;
    private static PIPE_START;
    private static usedPipes;
    isAvailable(): Promise<boolean>;
    checkRoot(): Promise<boolean>;
    private getNextPipeNumber;
    private releasePipeNumber;
    private isPfEnabled;
    private getPfRules;
    private profileToDnctlArgs;
    apply(pid: number, profile: NetworkProfile): Promise<void>;
    private getAllPorts;
    private createDnctlPipe;
    private createPfRules;
    private applyPfRules;
    cleanup(): Promise<void>;
    cleanupSync(): void;
}
