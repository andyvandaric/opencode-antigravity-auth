import { describe, it, expect } from 'vitest';
import { generateFingerprint, collectCurrentFingerprint, updateFingerprintVersion } from './fingerprint';
import { getAntigravityVersion } from '../constants';

describe('Version propagation regression', () => {
  const currentVersion = getAntigravityVersion();

  it('generateFingerprint() produces userAgent containing current version', () => {
    const fingerprint = generateFingerprint();
    expect(fingerprint.userAgent).toContain(`Antigravity/${currentVersion}`);
    expect(fingerprint.userAgent).toContain('Mozilla/5.0');
  });

  it('collectCurrentFingerprint() also produces userAgent with current version', () => {
    const fingerprint = collectCurrentFingerprint();
    expect(fingerprint.userAgent).toContain(`Antigravity/${currentVersion}`);
  });

  it('updateFingerprintVersion() replaces an old version string with the current runtime version, returns true', () => {
    const fingerprint = generateFingerprint();
    const oldVersion = '1.0.0';
    fingerprint.userAgent = fingerprint.userAgent.replace(`Antigravity/${currentVersion}`, `Antigravity/${oldVersion}`);
    
    const changed = updateFingerprintVersion(fingerprint);
    
    expect(changed).toBe(true);
    expect(fingerprint.userAgent).toContain(`Antigravity/${currentVersion}`);
    expect(fingerprint.userAgent).not.toContain(`Antigravity/${oldVersion}`);
  });

  it('updateFingerprintVersion() on a fingerprint already at current version returns false', () => {
    const fingerprint = generateFingerprint();
    // It should already be at currentVersion
    
    const changed = updateFingerprintVersion(fingerprint);
    
    expect(changed).toBe(false);
    expect(fingerprint.userAgent).toContain(`Antigravity/${currentVersion}`);
  });
});
