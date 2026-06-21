#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const controller_1 = require("./controller");
const signals_1 = require("./signals");
async function main() {
    const program = new commander_1.Command();
    const controller = new controller_1.NetworkController();
    program
        .name('netslim')
        .description('PID-based process-level network simulation CLI')
        .version('1.0.0');
    program
        .option('--pid <number>', 'Process ID to throttle')
        .option('-p, --profile <name>', 'Network profile to apply (e.g., 2G, 3G, HighPacketLoss)')
        .option('-i, --interface <name>', 'Network interface to use (auto-detected by default)')
        .option('-d, --duration <seconds>', 'Duration in seconds (0 for indefinite)', '0')
        .option('--download <mbps>', 'Download speed in Mbps (overrides profile)')
        .option('--upload <mbps>', 'Upload speed in Mbps (overrides profile)')
        .option('--latency <ms>', 'Latency in milliseconds (overrides profile)')
        .option('--jitter <ms>', 'Jitter in milliseconds (overrides profile)')
        .option('--loss <percent>', 'Packet loss percentage (overrides profile)')
        .option('-l, --list', 'List all available network profiles')
        .option('--show-profile <name>', 'Show details of a specific profile')
        .option('--check-pid <number>', 'Check process information and network ports');
    program.parse(process.argv);
    const options = program.opts();
    if (options.list) {
        await listProfiles(controller);
        return;
    }
    if (options.showProfile) {
        await showProfile(controller, options.showProfile);
        return;
    }
    if (options.checkPid) {
        await checkPid(controller, options.checkPid);
        return;
    }
    if (!options.pid || !options.profile) {
        console.error('❌ Error: --pid and --profile are required');
        console.log('');
        console.log('💡 Usage examples:');
        console.log('  netslim --pid 12345 --profile 3G');
        console.log('  netslim --pid 12345 --profile HighPacketLoss --duration 60');
        console.log('  netslim --pid 12345 --profile Custom --download 5 --latency 200');
        console.log('  netslim --list');
        process.exit(1);
    }
    await runThrottling(controller, options);
}
async function listProfiles(controller) {
    console.log('📋 Available Network Profiles:\n');
    const profiles = controller.listAvailableProfiles();
    console.log('┌─────────────────────┬────────────┬────────────┬──────────┬───────┐');
    console.log('│ Profile             │ Download   │ Upload     │ Latency  │ Loss  │');
    console.log('├─────────────────────┼────────────┼────────────┼──────────┼───────┤');
    for (const p of profiles) {
        const namePad = p.name.padEnd(19);
        const downPad = p.download.padStart(10);
        const upPad = p.upload.padStart(10);
        const latPad = p.latency.padStart(8);
        const lossPad = p.loss.padStart(5);
        console.log(`│ ${namePad} │ ${downPad} │ ${upPad} │ ${latPad} │ ${lossPad} │`);
    }
    console.log('└─────────────────────┴────────────┴────────────┴──────────┴───────┘');
    console.log('');
    for (const p of profiles) {
        console.log(`  ${p.name}: ${p.description}`);
    }
    console.log('');
}
async function showProfile(controller, name) {
    const profile = await controller.getProfileInfo(name);
    if (!profile) {
        console.error(`❌ Profile '${name}' not found`);
        process.exit(1);
    }
    console.log(`📊 Profile: ${profile.name}`);
    console.log(`   ${profile.description}`);
    console.log('');
    console.log(controller.formatProfileSummary(profile));
    console.log('');
}
async function checkPid(controller, pid) {
    console.log(`🔍 Checking process ${pid}...\n`);
    const status = await controller.getProcessStatus(pid);
    if (!status) {
        console.error(`❌ Process ${pid} does not exist`);
        process.exit(1);
    }
    console.log(`  PID:          ${status.pid}`);
    console.log(`  Name:         ${status.name}`);
    console.log(`  User:         ${status.user}`);
    console.log(`  Command:      ${status.cmdline.substring(0, 100)}${status.cmdline.length > 100 ? '...' : ''}`);
    console.log(`  TCP Ports:    ${status.tcpPorts.length > 0 ? status.tcpPorts.join(', ') : '(none)'}`);
    console.log(`  UDP Ports:    ${status.udpPorts.length > 0 ? status.udpPorts.join(', ') : '(none)'}`);
    console.log('');
    if (status.tcpPorts.length === 0 && status.udpPorts.length === 0) {
        console.log('⚠️  Warning: No active network ports found.');
        console.log('   The process may not have any network connections yet.');
        console.log('   Try starting some network activity in the process first.');
    }
}
async function runThrottling(controller, options) {
    try {
        await controller.init();
    }
    catch (error) {
        console.error('❌ Failed to initialize:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
    const isRoot = await controller.checkRoot();
    if (!isRoot) {
        console.error('❌ Root privileges required. Please run with sudo.');
        process.exit(1);
    }
    console.log('🚀 NetSlim - Process-Level Network Simulation');
    console.log(`   Platform: ${controller.getPlatform()}`);
    console.log('');
    const signalHandler = new signals_1.SignalHandler(controller);
    signalHandler.setup();
    const status = await controller.getProcessStatus(options.pid);
    if (!status) {
        console.error(`❌ Process ${options.pid} does not exist`);
        process.exit(1);
    }
    console.log(`🎯 Target Process:`);
    console.log(`   PID:     ${status.pid}`);
    console.log(`   Name:    ${status.name}`);
    console.log(`   Ports:   ${status.tcpPorts.length > 0 ? status.tcpPorts.join(', ') : '(none)'}`);
    console.log('');
    const profileName = options.profile;
    const profile = await controller.getProfileInfo(profileName);
    if (!profile && profileName !== 'Custom') {
        console.error(`❌ Profile '${profileName}' not found. Use --list to see available profiles.`);
        process.exit(1);
    }
    console.log('📡 Applying Network Profile:');
    if (profile) {
        console.log(controller.formatProfileSummary(profile));
    }
    console.log('');
    const duration = options.duration ? parseInt(options.duration.toString(), 10) : 0;
    try {
        if (duration > 0) {
            console.log(`⏱️  Running for ${duration} seconds...`);
            await controller.runWithDuration(options.pid, profileName, duration, options);
            console.log(`✅ Completed after ${duration} seconds`);
        }
        else {
            await controller.applyProfile(options.pid, profileName, options);
            console.log('✅ Network simulation active');
            console.log('');
            console.log('📝 Press Ctrl+C to stop and restore network');
            console.log('');
            const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
            let i = 0;
            process.stdout.write('  Running ');
            const interval = setInterval(() => {
                process.stdout.write(`\b${spinner[i % spinner.length]}`);
                i++;
            }, 100);
            await new Promise(() => { });
            clearInterval(interval);
        }
    }
    catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        await controller.cleanup();
        process.exit(1);
    }
    finally {
        signalHandler.remove();
    }
}
main().catch((error) => {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
//# sourceMappingURL=cli.js.map