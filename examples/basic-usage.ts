import { NetworkController } from '../src';

async function example() {
  const controller = new NetworkController();

  try {
    await controller.init();
    console.log('Platform:', controller.getPlatform());

    const profiles = controller.listAvailableProfiles();
    console.log('\nAvailable profiles:');
    profiles.forEach((p) => console.log(`  - ${p.name}: ${p.description}`));

    const profile = await controller.getProfileInfo('3G');
    if (profile) {
      console.log('\n3G Profile Details:');
      console.log(controller.formatProfileSummary(profile));
    }

    const pid = 12345;
    const status = await controller.getProcessStatus(pid);
    if (status) {
      console.log(`\nProcess ${pid} status:`, status);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

example().catch(console.error);
