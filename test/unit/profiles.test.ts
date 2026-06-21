import { getProfile, listProfiles, formatBandwidth, NETWORK_PROFILES } from '../../src/profiles';

describe('Network Profiles', () => {
  test('listProfiles returns all profiles', () => {
    const profiles = listProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles.find((p) => p.name === '2G')).toBeDefined();
    expect(profiles.find((p) => p.name === '3G')).toBeDefined();
    expect(profiles.find((p) => p.name === '4G')).toBeDefined();
    expect(profiles.find((p) => p.name === 'HighPacketLoss')).toBeDefined();
  });

  test('getProfile returns correct profile', () => {
    const profile2G = getProfile('2G');
    expect(profile2G).toBeDefined();
    expect(profile2G?.name).toBe('2G');
    expect(profile2G?.latency).toBe(300);

    const profile4G = getProfile('4G');
    expect(profile4G).toBeDefined();
    expect(profile4G?.name).toBe('4G');
    expect(profile4G?.latency).toBe(50);
  });

  test('getProfile returns undefined for unknown profile', () => {
    expect(getProfile('UnknownProfile')).toBeUndefined();
  });

  test('formatBandwidth formats correctly', () => {
    expect(formatBandwidth(0)).toBe('0');
    expect(formatBandwidth(512)).toBe('512bps');
    expect(formatBandwidth(1024)).toBe('1.0Kbps');
    expect(formatBandwidth(1024 * 1024)).toBe('1.0Mbps');
    expect(formatBandwidth(1024 * 1024 * 1024)).toBe('1.0Gbps');
  });

  test('all profiles have required fields', () => {
    for (const profile of Object.values(NETWORK_PROFILES)) {
      expect(profile.name).toBeDefined();
      expect(profile.description).toBeDefined();
      expect(profile.bandwidth.download).toBeGreaterThanOrEqual(0);
      expect(profile.bandwidth.upload).toBeGreaterThanOrEqual(0);
      expect(profile.latency).toBeGreaterThanOrEqual(0);
      expect(profile.jitter).toBeGreaterThanOrEqual(0);
      expect(profile.packetLoss).toBeGreaterThanOrEqual(0);
    }
  });
});
