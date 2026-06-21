import { Backend, Platform, NetworkProfile } from '../types';
import { LinuxBackend } from './linux';
import { DarwinBackend } from './darwin';
export declare class BackendManager {
    private backend;
    private platform;
    constructor();
    init(): Promise<Backend>;
    private createBackend;
    getBackend(): Backend | null;
    getPlatform(): Platform;
    apply(pid: number, profile: NetworkProfile): Promise<void>;
    cleanup(): Promise<void>;
    checkRoot(): Promise<boolean>;
    getPlatformDescription(): string;
}
export { LinuxBackend, DarwinBackend };
