import { describe, expect, it } from 'vitest';
import { fetchFacebookPageMentions, isWeggeefkastjeMention, parseApprovedSocialExportJsonl, parseFacebookGraphPosts } from '../src/adapters/socialEvidence.js';

describe('social evidence intake', () => {
  it('detects Dutch giveaway-cupboard terms without matching unrelated posts', () => {
    expect(isWeggeefkastjeMention('Nieuw weggeefkastje bij de speeltuin.')).toBe(true);
    expect(isWeggeefkastjeMention('De buurt organiseert een rommelmarkt.')).toBe(false);
  });

  it('routes location-less approved exports to review and redacts contact details', () => {
    const batch = parseApprovedSocialExportJsonl([
      JSON.stringify({
        text: 'Nieuw weggeefkastje aan Voorbeeldstraat 10. Bel 0612345678 of mail kastje@example.nl.',
        city: 'Utrecht',
        addressHint: 'Voorbeeldstraat 10',
        observedAt: '2026-07-28T10:00:00.000Z',
      }),
      JSON.stringify({
        text: 'Er staat een buurtkastje in onze wijk, maar ik weet niet precies waar.',
        city: 'Utrecht',
        observedAt: '2026-07-28T10:05:00.000Z',
      }),
    ].join('\n'), 'nextdoor');

    expect(batch.actionable).toHaveLength(1);
    expect(batch.actionable[0].text).toContain('[redacted phone]');
    expect(batch.actionable[0].text).toContain('[redacted email]');
    expect(batch.review).toHaveLength(1);
    expect(batch.review[0].reason).toBe('missing_reliable_location');
  });

  it('uses an approved Facebook Page context without inventing an address', () => {
    const batch = parseFacebookGraphPosts(JSON.stringify({
      data: [{ message: 'Nieuw buurtkastje in de wijk.', created_time: '2026-07-28T10:00:00.000Z' }],
    }), { id: 'page-1', name: 'Approved Utrecht Page', city: 'Utrecht' });

    expect(batch.actionable).toHaveLength(0);
    expect(batch.review).toHaveLength(1);
    expect(batch.review[0].sourceName).toBe('Approved Utrecht Page');
  });

  it('requests only configured Facebook Pages through the Graph API', async () => {
    let requestedUrl: URL | undefined;
    const batch = await fetchFacebookPageMentions({
      accessToken: 'test-token',
      apiVersion: 'v99.0',
      pages: [{ id: 'allowed-page' }],
      fetchImpl: async (url) => {
        requestedUrl = new URL(url.toString());
        return new Response(JSON.stringify({ data: [{
          message: 'Nieuw weggeefkastje aan Voorbeeldstraat 10.',
          created_time: '2026-07-28T10:00:00.000Z',
          place: { location: { street: 'Voorbeeldstraat 10', city: 'Utrecht' } },
        }] }));
      },
    });

    expect(requestedUrl?.pathname).toBe('/v99.0/allowed-page/posts');
    expect(requestedUrl?.searchParams.get('fields')).toContain('message');
    expect(batch.actionable).toHaveLength(1);
  });
});
