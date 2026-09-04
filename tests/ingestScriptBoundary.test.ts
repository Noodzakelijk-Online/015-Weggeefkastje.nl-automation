import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('safe default ingestion command', () => {
  it('runs the governed worker without creating the legacy locations catalog', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'weggeefkastje-safe-ingest-'));
    temporaryDirectories.push(dataDirectory);
    const databasePath = join(dataDirectory, 'automation.sqlite');
    const isWindows = process.platform === 'win32';
    const command = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
    const commandArguments = isWindows ? ['/d', '/s', '/c', 'npm.cmd run ingest'] : ['run', 'ingest'];

    const result = spawnSync(command, commandArguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_DATA_DIR: dataDirectory,
        DATABASE_PATH: databasePath,
        FACEBOOK_GRAPH_ACCESS_TOKEN: '',
        FACEBOOK_GRAPH_API_VERSION: '',
        FACEBOOK_PAGE_CONTEXTS_JSON: '[]',
        NEXTDOOR_APPROVED_EXPORT_PATH: '',
        BUURTKASTJESKAART_EXPORT_PATH: '',
        OSM_OVERPASS_URL: '',
        OSM_PILOT_BBOX: '',
      },
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    const sqlite = new Database(databasePath, { readonly: true });
    try {
      const legacyTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'").get();
      expect(legacyTable).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  it('keeps the compatibility importer behind an explicitly named command', () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'weggeefkastje-legacy-ingest-'));
    temporaryDirectories.push(dataDirectory);
    const databasePath = join(dataDirectory, 'legacy.sqlite');
    const isWindows = process.platform === 'win32';
    const command = isWindows ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
    const commandArguments = isWindows ? ['/d', '/s', '/c', 'npm.cmd run ingest:legacy'] : ['run', 'ingest:legacy'];

    const result = spawnSync(command, commandArguments, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_PATH: databasePath,
        FACEBOOK_GRAPH_ACCESS_TOKEN: '',
        FACEBOOK_GRAPH_API_VERSION: '',
        FACEBOOK_PAGE_CONTEXTS_JSON: '[]',
        NEXTDOOR_APPROVED_EXPORT_PATH: '',
      },
      timeout: 20_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);

    const sqlite = new Database(databasePath, { readonly: true });
    try {
      const legacyTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'").get();
      expect(legacyTable).toEqual({ name: 'locations' });
    } finally {
      sqlite.close();
    }
  });
});
