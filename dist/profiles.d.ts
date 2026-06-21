import { NetworkProfile } from './types';
export declare const NETWORK_PROFILES: Record<string, NetworkProfile>;
export declare function getProfile(name: string): NetworkProfile | undefined;
export declare function listProfiles(): NetworkProfile[];
export declare function formatBandwidth(bps: number): string;
