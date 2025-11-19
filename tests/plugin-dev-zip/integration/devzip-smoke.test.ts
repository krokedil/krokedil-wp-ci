import { describe, it, expect } from 'vitest';

/**
 * Tiny smoke test to verify that the test harness is wired correctly
 * and that we receive key environment variables from the workflow.
 */

describe('dev zip smoke test', () => {
  it('has DEV_ZIP_URL env set (when provided by the workflow)', () => {
    // In CI, you should pass DEV_ZIP_URL via env; locally this may be empty.
    // We just assert the variable exists, not that it has a particular value.
    expect(process.env).toHaveProperty('DEV_ZIP_URL');
  });
});
