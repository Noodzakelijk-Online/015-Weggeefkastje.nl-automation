import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

describe('configuration safety', () => {
  it('rejects database paths outside the application data directory', () => {
    expect(() => loadConfig({ APP_DATA_DIR: 'data', DATABASE_PATH: '../outside.sqlite' }, join('C:', 'workspace'))).toThrow(/inside/i);
  });

  it('rejects public network binding unless explicitly enabled', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' }, process.cwd())).toThrow(/Network binding is disabled/);
  });

  it('never returns the Facebook credential in public configuration', async () => {
    const { publicConfig } = await import('../src/config.js');
    const config = loadConfig({ FACEBOOK_GRAPH_ACCESS_TOKEN: 'secret', FACEBOOK_GRAPH_API_VERSION: 'v23.0' }, process.cwd());
    expect(JSON.stringify(publicConfig(config))).not.toContain('secret');
  });

  it('accepts blank optional provider values from the example env file', () => {
    const config = loadConfig({
      APP_BASE_URL: '', FACEBOOK_GRAPH_ACCESS_TOKEN: '', FACEBOOK_GRAPH_API_VERSION: '',
      NEXTDOOR_APPROVED_EXPORT_PATH: '', BUURTKASTJESKAART_EXPORT_PATH: '', OSM_OVERPASS_URL: '', OSM_PILOT_BBOX: '',
      HAI_FEED_TOKEN: '', HAI_WORKSPACE_ID: '',
    }, process.cwd());
    expect(config.provider.facebookConfigured).toBe(false);
    expect(config.hai.enabled).toBe(false);
  });

  it('uses the official PDOK address verifier by default and rejects an insecure override', () => {
    expect(loadConfig({}, process.cwd()).addressVerification.baseUrl).toBe('https://api.pdok.nl');
    expect(() => loadConfig({ PDOK_LOCATIESERVER_BASE_URL: 'http://example.test' }, process.cwd())).toThrow(/PDOK/i);
  });

  it('requires an HTTPS OpenStreetMap pilot endpoint and matching bounded-area setting', () => {
    expect(() => loadConfig({ OSM_OVERPASS_URL: 'https://overpass.example.test' }, process.cwd())).toThrow(/OSM/i);
    expect(() => loadConfig({ OSM_OVERPASS_URL: 'http://overpass.example.test', OSM_PILOT_BBOX: '51.9,4.2,52.1,4.5' }, process.cwd())).toThrow(/HTTPS/i);
    expect(loadConfig({ OSM_OVERPASS_URL: 'https://overpass.example.test', OSM_PILOT_BBOX: '51.9,4.2,52.1,4.5' }, process.cwd()).provider.openStreetMapConfigured).toBe(true);
  });
});
