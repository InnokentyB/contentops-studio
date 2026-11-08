import prisma from '../db';
import { createSettingsCacheRuntime } from './settings_cache_runtime';
import { createSettingsRedis, settingsRedisUrl } from './settings_cache_redis';
/** One per process; shared Redis revisions and durable DB events coordinate web and MCP. */
export const projectSettingsReader = createSettingsCacheRuntime(prisma,createSettingsRedis(settingsRedisUrl()),
    {cacheEnabled:process.env.SETTINGS_CACHE_ENABLED === 'true'});
