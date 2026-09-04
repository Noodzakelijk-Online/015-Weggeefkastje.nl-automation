import { describe, expect, it } from 'vitest';
import { createPdokAddressVerifier } from '../src/integrations/pdokAddress.js';

const verifiedAddressResponse = {
  response: {
    docs: [{
      type: 'adres',
      straatnaam: 'Voorbeeldstraat',
      huisnummer: '10',
      postcode: '1234AB',
      woonplaatsnaam: 'Utrecht',
      gemeentenaam: 'Utrecht',
      provincienaam: 'Utrecht',
      centroide_ll: 'POINT(5.1214 52.0907)',
    }],
  },
};

describe('PDOK address verification', () => {
  it('returns a canonical address only for an exact BAG match', async () => {
    let requestedUrl: URL | undefined;
    const verifier = createPdokAddressVerifier({
      baseUrl: 'https://api.pdok.nl',
      timeoutMs: 1_000,
      fetchImpl: async (input) => {
        requestedUrl = new URL(input.toString());
        return new Response(JSON.stringify(verifiedAddressResponse), { status: 200 });
      },
    });

    const verified = await verifier.verify({
      address: 'Voorbeeldstraat 10',
      postalCode: '1234 AB',
      city: 'Utrecht',
    });

    expect(verified).toEqual({
      addressLine: 'Voorbeeldstraat 10',
      postalCode: '1234AB',
      city: 'Utrecht',
      municipality: 'Utrecht',
      province: 'Utrecht',
      latitude: 52.0907,
      longitude: 5.1214,
      provider: 'pdok',
      verifiedAt: expect.any(String),
    });
    expect(requestedUrl?.origin).toBe('https://api.pdok.nl');
    expect(requestedUrl?.pathname).toBe('/bzk/locatieserver/search/v3_1/free');
    expect(requestedUrl?.searchParams.get('fq')).toBe('type:adres');
    expect(requestedUrl?.searchParams.get('rows')).toBe('10');
  });

  it('rejects a fuzzy result that differs in house number', async () => {
    const verifier = createPdokAddressVerifier({
      baseUrl: 'https://api.pdok.nl',
      timeoutMs: 1_000,
      fetchImpl: async () => new Response(JSON.stringify({
        response: { docs: [{ ...verifiedAddressResponse.response.docs[0], huisnummer: '11' }] },
      }), { status: 200 }),
    });

    await expect(verifier.verify({
      address: 'Voorbeeldstraat 10',
      postalCode: '1234 AB',
      city: 'Utrecht',
    })).resolves.toBeUndefined();
  });
});
