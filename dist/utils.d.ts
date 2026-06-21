import { Platform } from './types';
export interface ExecResult {
    stdout: string;
    stderr: string;
}
export interface ExecSyncResult {
    stdout: string;
    stderr: string;
    success: boolean;
}
export declare function runCommand(command: string, args?: string[], sudo?: boolean): Promise<ExecResult>;
export declare function runSudoCommand(command: string, args?: string[]): Promise<ExecResult>;
export declare function runCommandSync(command: string, args?: string[], sudo?: boolean): ExecSyncResult;
export declare function runSudoCommandSync(command: string, args?: string[]): ExecSyncResult;
export declare function runBashCommandSync(script: string): ExecSyncResult;
export declare function runSudoBashCommandSync(script: string): ExecSyncResult;
export declare function getPlatform(): Platform;
export declare function checkRoot(): Promise<boolean>;
export declare function bpsToRate(bps: number): string;
export declare function msToTime(ms: number): string;
export declare function percentToString(value: number): string;
export declare function generateId(): string;
export declare function sleep(ms: number): Promise<void>;
export declare function commandExists(command: string): Promise<boolean>;
export declare function getDefaultInterface(): Promise<string>;
export declare function parseNumber(value: string | undefined, defaultValue: number): number;
export declare function parseFloatValue(value: string | undefined, defaultValue: number): number;
