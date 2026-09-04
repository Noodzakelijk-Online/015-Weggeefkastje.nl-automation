import { describe, expect, it } from 'vitest';
import { caretakerUpdateSchema, residentCandidateSchema } from '../src/domain/residentLocation.js';

describe('resident location domain contracts', () => {
  it('accepts a candidate only when it contains an exact Dutch address', () => {
    const result = residentCandidateSchema.safeParse({
      sourceKey: 'facebook-graph-pages',
      title: 'Weggeefkastje bij de speeltuin',
      address: 'Voorbeeldstraat 10',
      postalCode: '1234 AB',
      city: 'Utrecht',
      observedAt: '2026-09-04T10:00:00.000Z',
      evidenceSummary: 'Door een toegestane bron gemeld.',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a candidate that lacks a postal code or house number', () => {
    const noPostalCode = residentCandidateSchema.safeParse({
      sourceKey: 'facebook-graph-pages',
      title: 'Weggeefkastje bij de speeltuin',
      address: 'Voorbeeldstraat 10',
      city: 'Utrecht',
      observedAt: '2026-09-04T10:00:00.000Z',
      evidenceSummary: 'Door een toegestane bron gemeld.',
    });
    const noHouseNumber = residentCandidateSchema.safeParse({
      sourceKey: 'facebook-graph-pages',
      title: 'Weggeefkastje bij de speeltuin',
      address: 'Voorbeeldstraat',
      postalCode: '1234 AB',
      city: 'Utrecht',
      observedAt: '2026-09-04T10:00:00.000Z',
      evidenceSummary: 'Door een toegestane bron gemeld.',
    });

    expect(noPostalCode.success).toBe(false);
    expect(noHouseNumber.success).toBe(false);
  });

  it('does not let an owner update a cabinet without a complete address', () => {
    const result = caretakerUpdateSchema.safeParse({
      address: 'Voorbeeldstraat 10',
      city: 'Utrecht',
      status: 'active',
    });

    expect(result.success).toBe(false);
  });
});
