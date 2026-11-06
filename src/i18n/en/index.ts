import type { Dictionary } from '../i18n';
import { auth } from './auth';
import { common } from './common';
import { home } from './home';
import { install } from './install';
import { jam } from './jam';
import { library } from './library';
import { misc } from './misc';
import { nowPlaying } from './nowPlaying';
import { search } from './search';
import { server } from './server';
import { settings } from './settings';
import { shell } from './shell';

/**
 * The English dictionary, split by area only so several people can work on it at once. Loaded lazily (i18n.ts), so
 * it is its own chunk. The same Indonesian text may appear in two areas; it must then have the same English (tested).
 */
export const en: Dictionary = { ...common, ...home, ...library, ...search, ...nowPlaying, ...shell, ...jam, ...settings, ...auth, ...install, ...misc, ...server };

export const areas: Record<string, Dictionary> = { common, home, library, search, nowPlaying, shell, jam, settings, auth, install, misc, server };
