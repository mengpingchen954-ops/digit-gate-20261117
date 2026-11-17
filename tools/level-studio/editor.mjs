import fs from 'node:fs/promises';
import { editorCall } from '../editor-bridge-client.mjs';
export { editorCall };

export async function readSceneMap() {
    const code = await fs.readFile(new URL('./scene-map.js', import.meta.url), 'utf8');
    const data = await editorCall('execute_javascript', { context: 'scene', code });
    return JSON.parse(data.result);
}
