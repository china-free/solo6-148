"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalHandler = void 0;
const HARD_TIMEOUT_MS = 3000;
const hardExit = (code) => {
    const proc = process;
    if (typeof proc._exit === 'function') {
        return proc._exit(code);
    }
    process.exit(code);
    throw new Error('unreachable');
};
class SignalHandler {
    constructor(controller) {
        this.isCleaningUp = false;
        this.registered = false;
        this.sigintCount = 0;
        this.sigtermCount = 0;
        this.controller = controller;
    }
    setup() {
        if (this.registered) {
            return;
        }
        this.registered = true;
        process.on('SIGINT', this.handleSigInt.bind(this));
        process.on('SIGTERM', this.handleSigTerm.bind(this));
        process.on('SIGQUIT', this.handleSigQuit.bind(this));
        process.on('SIGHUP', this.handleSigHup.bind(this));
        process.on('uncaughtException', this.handleUncaughtException.bind(this));
        process.on('unhandledRejection', this.handleUnhandledRejection.bind(this));
        process.on('exit', this.handleExit.bind(this));
    }
    printCleanupBanner(signal) {
        try {
            process.stdout.write(`\r\n[netslim] Received ${signal}, synchronously restoring network configuration...\n`);
        }
        catch {
            // Ignore
        }
    }
    printSuccessBanner() {
        try {
            process.stdout.write('[netslim] Network configuration restored successfully.\n');
        }
        catch {
            // Ignore
        }
    }
    printFailureBanner() {
        try {
            process.stderr.write('[netslim] WARNING: Some cleanup steps may have failed. ' +
                'Check your network configuration manually.\n');
        }
        catch {
            // Ignore
        }
    }
    startHardExitTimer(signal) {
        return setTimeout(() => {
            try {
                process.stderr.write(`\n[netslim] FATAL: Cleanup timed out after ${HARD_TIMEOUT_MS}ms. ` +
                    `Forcing exit. You MUST check system state manually!\n` +
                    `[netslim] Hint: Run: sudo tc qdisc show; sudo iptables -t mangle -S; sudo ip link show type ifb\n`);
            }
            catch {
                // Ignore
            }
            hardExit(128 + this.signalToNumber(signal));
        }, HARD_TIMEOUT_MS).unref();
    }
    signalToNumber(signal) {
        const map = {
            SIGINT: 2,
            SIGTERM: 15,
            SIGQUIT: 3,
            SIGHUP: 1,
        };
        return map[signal] || 15;
    }
    performSyncCleanup(signal) {
        if (this.isCleaningUp) {
            return;
        }
        this.isCleaningUp = true;
        this.printCleanupBanner(signal);
        const hardTimer = this.startHardExitTimer(signal);
        try {
            const success = this.controller.emergencyRestoreSync();
            if (success) {
                this.printSuccessBanner();
            }
            else {
                this.printFailureBanner();
            }
        }
        catch (e) {
            try {
                const msg = e instanceof Error ? e.message : String(e);
                process.stderr.write(`[netslim] Cleanup exception: ${msg}\n`);
            }
            catch {
                // Ignore
            }
            this.printFailureBanner();
        }
        finally {
            clearTimeout(hardTimer);
        }
    }
    handleSigInt() {
        this.sigintCount++;
        if (this.sigintCount >= 3) {
            try {
                process.stderr.write('\r[netslim] Third Ctrl+C received. FORCE EXITING WITHOUT CLEANUP!\n' +
                    '[netslim] Run these commands to fix your network:\n' +
                    '[netslim]   sudo tc qdisc del dev <IFACE> root\n' +
                    '[netslim]   sudo iptables -t mangle -F\n' +
                    '[netslim]   sudo ip link del netslim0 (if exists)\n');
            }
            catch {
                // Ignore
            }
            hardExit(130);
        }
        if (this.isCleaningUp && this.sigintCount >= 2) {
            try {
                process.stdout.write('\r[netslim] Cleanup in progress... press Ctrl+C one more time to FORCE EXIT (UNSAFE)\n');
            }
            catch {
                // Ignore
            }
            return;
        }
        this.performSyncCleanup('SIGINT');
        process.exit(130);
    }
    handleSigTerm() {
        this.sigtermCount++;
        if (this.isCleaningUp) {
            return;
        }
        this.performSyncCleanup('SIGTERM');
        process.exit(143);
    }
    handleSigQuit() {
        if (this.isCleaningUp) {
            return;
        }
        this.performSyncCleanup('SIGQUIT');
        process.exit(131);
    }
    handleSigHup() {
        if (this.isCleaningUp) {
            return;
        }
        this.performSyncCleanup('SIGHUP');
        process.exit(129);
    }
    handleUncaughtException(error) {
        try {
            process.stderr.write(`\n[netslim] UNCAUGHT EXCEPTION: ${error.message}\n`);
            if (error.stack) {
                process.stderr.write(`${error.stack}\n`);
            }
        }
        catch {
            // Ignore
        }
        try {
            this.performSyncCleanup('uncaughtException');
        }
        catch {
            // Swallow - already in crash handler
        }
        hardExit(70);
    }
    handleUnhandledRejection(reason) {
        try {
            const msg = reason instanceof Error ? reason.message : String(reason);
            process.stderr.write(`\n[netslim] UNHANDLED REJECTION: ${msg}\n`);
        }
        catch {
            // Ignore
        }
        try {
            this.performSyncCleanup('unhandledRejection');
        }
        catch {
            // Swallow
        }
        hardExit(70);
    }
    handleExit(code) {
        if (!this.isCleaningUp && this.registered) {
            try {
                process.stderr.write(`\n[netslim] Process exiting with code ${code} before cleanup was triggered. ` +
                    `Attempting emergency restore...\n`);
            }
            catch {
                // Ignore
            }
            try {
                this.controller.emergencyRestoreSync();
            }
            catch {
                // Do not throw in exit handler
            }
        }
        this.isCleaningUp = true;
    }
    remove() {
        if (!this.registered) {
            return;
        }
        process.removeAllListeners('SIGINT');
        process.removeAllListeners('SIGTERM');
        process.removeAllListeners('SIGQUIT');
        process.removeAllListeners('SIGHUP');
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
        process.removeAllListeners('exit');
        this.registered = false;
    }
}
exports.SignalHandler = SignalHandler;
//# sourceMappingURL=signals.js.map