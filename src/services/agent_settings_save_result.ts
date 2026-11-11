import { SettingsCacheSyncError, SettingsSavedCacheSyncPendingError } from './settings_cache_events';

type Field = 'prompt' | 'api_key' | 'model';
type Outcome = 'not_attempted' | 'saved' | 'not_saved' | 'synchronization_pending' | 'unknown';
/** Reports sequential writes, not whole-form atomicity. Values never enter this tracker. */
export function createAgentSettingsSaveResult() {
    const fields: Record<Field, Outcome> = {prompt:'not_attempted', api_key:'not_attempted', model:'not_attempted'};
    return {
        async save(field: Field, write: () => Promise<unknown>) {
            try { await write(); fields[field]='saved'; }
            catch (error) {
                fields[field]=error instanceof SettingsCacheSyncError ? 'not_saved' :
                    error instanceof SettingsSavedCacheSyncPendingError ? 'synchronization_pending' : 'unknown';
                throw error;
            }
        },
        failure(error: unknown) {
            const pending=error instanceof SettingsSavedCacheSyncPendingError;
            const refused=error instanceof SettingsCacheSyncError;
            const saveState=pending ? 'synchronization_pending' : !refused ? 'unknown' :
                Object.values(fields).includes('saved') ? 'partially_saved' : 'not_saved';
            const code=pending ? error.code : refused ? error.code : 'AGENT_SETTINGS_SAVE_UNKNOWN';
            return {status:pending || refused ? 503 : 500, body:{
                error:'Agent settings save needs attention', code, save_state:saveState, fields:{...fields},
                action:saveState==='not_saved' ? 'Restore Redis connectivity for web and MCP, then retry saving.' :
                    'Check stored fields before repeating the save. Restore Redis connectivity and verify pending settings invalidation events. Do not retry blindly.'
            }};
        }
    };
}
