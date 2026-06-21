import { NetworkController } from './controller';
export declare class SignalHandler {
    private controller;
    private isCleaningUp;
    private cleanupTimeout;
    constructor(controller: NetworkController);
    setup(): void;
    private handleSignal;
    private handleUncaughtException;
    private handleUnhandledRejection;
    private handleExit;
    private forceCleanupAndExit;
    remove(): void;
}
