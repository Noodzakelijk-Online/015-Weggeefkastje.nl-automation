import { describe, expect, it } from 'vitest';
import { fetchOpenStreetMapPilotMentions } from '../src/adapters/openStreetMap.js';

describe('bounded OpenStreetMap pilot intake', () => {
  it('accepts only a named give-box with a complete tagged address inside the configured pilot query', async () => {
    let requestBody = '';
    const mentions = await fetchOpenStreetMapPilotMentions({
      overpassUrl: 'https://overpass.example.test/api/interpreter',
      boundingBox: '52.05,5.05,52.15,5.20',
      fetchImpl: async (_input, init) => {
        requestBody = String(init?.body ?? '');
        return new Response(JSON.stringify({
          elements: [
            {
              type: 'node', id: 12, lat: 52.0907, lon: 5.1214,
              tags: {
                amenity: 'give_box', name: 'Weggeefkastje speeltuin',
                'addr:street': 'Voorbeeldstraat', 'addr:housenumber': '10',
                'addr:postcode': '1234 AB', 'addr:city': 'Utrecht',
              },
            },
            {
              type: 'node', id: 13, lat: 52.0908, lon: 5.1215,
              tags: { amenity: 'give_box', name: 'Onvolledig kastje', 'addr:street': 'Zonder Nummer' },
            },
          ],
        }), { status: 200 });
      },
    });

    expect(mentions).toEqual([expect.objectContaining({
      sourceKind: 'open_data',
      sourceName: 'OpenStreetMap pilot',
      addressHint: 'Voorbeeldstraat 10',
      postalCode: '1234AB',
      city: 'Utrecht',
      latitude: 52.0907,
      longitude: 5.1214,
    })]);
    expect(requestBody).toContain('give_box');
    expect(requestBody).toContain('food_sharing');
    expect(requestBody).toContain('(52.05,5.05,52.15,5.2)');
  });

  it('rejects an invalid pilot boundary before making an Overpass request', async () => {
    let called = false;

    await expect(fetchOpenStreetMapPilotMentions({
      overpassUrl: 'https://overpass.example.test/api/interpreter',
      boundingBox: '54,5,52,5.2',
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    })).rejects.toThrow(/bounding box/i);

    expect(called).toBe(false);
  });
});
