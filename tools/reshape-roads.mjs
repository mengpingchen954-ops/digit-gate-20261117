import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';

const backup = `tools/backups/roads-${Date.now()}`;
await fs.mkdir(backup, { recursive: true });
await editorCall('execute_javascript', { context: 'editor', code: "await Editor.Message.request('scene','save-scene'); return true;" });
for (const file of ['assets/Map/scene-1.scene', 'assets/配置/数字门配置.json', 'assets/TS/DigitGateGame.ts', 'assets/TS/DigitGateLayout.ts'])
    await fs.copyFile(file, `${backup}/${file.split('/').pop()}.bak`);
const cfg = JSON.parse(await fs.readFile('assets/配置/数字门配置.json', 'utf8'));
// Preserve the original road cross section, including the shared divider.
const startZ = 3.309, endZ = -100, wavelength = 28, amplitude = 3.2;
function point(u, offset = 0) {
    const angle = u * Math.PI * 2 / wavelength;
    const x = amplitude * (Math.cos(angle) - 1), z = startZ - u;
    const slope = amplitude * Math.PI * 2 / wavelength * Math.sin(angle);
    const length = Math.hypot(1, slope);
    return { x: x + offset / length, z: z - offset * slope / length };
}
const samples = Math.ceil((startZ - endZ) / .35);
const curve = offset => Array.from({ length: samples + 1 }, (_, i) => point((startZ - endZ) * i / samples, offset));
const route = offset => curve(offset).reverse().map(p => ({ x: +p.x.toFixed(6), z: +p.z.toFixed(6) }));
cfg.paths.obstacles = [...route(0), { x: 0, z: 14 }];
cfg.paths.rewards = [...route(-2.94975), { x: -2.94975, z: 5.55 }];
cfg.paths.gates = [{ x: 2.94975, z: .309 }, { x: 2.94975, z: 5.65 }];
// The same queue can fill the long left road and the short right road.
cfg.gateLayout.spawnZ = -22;
await fs.writeFile('assets/配置/数字门配置.json', JSON.stringify(cfg, null, 2) + '\n');
const input = { curves: [curve(0), curve(-2.777)], widths: [3.79, 2.8],
    fences: [-4.075, -1.785, 1.785].map(curve), startZ, endZ };
const code = await fs.readFile('tools/reshape-roads.scene.js', 'utf8');
const result = await editorCall('execute_javascript', { context: 'scene', code: code.replace('ROAD_INPUT', JSON.stringify(input)) }, 60000);
await editorCall('execute_javascript', { context: 'editor', code: "await Editor.Message.request('asset-db','refresh-asset','db://assets/配置/数字门配置.json'); await Editor.Message.request('scene','save-scene'); return true;" }, 60000);
console.log(JSON.stringify({ backup, ...result.result }));
