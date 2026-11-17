import fs from 'node:fs/promises';
import { editorCall } from './editor-bridge-client.mjs';
const files=await fs.readdir('assets/模型/金币建造'),models={};
for(const file of files)if(/\.fbx\.meta$/i.test(file)){
    const meta=JSON.parse(await fs.readFile(`assets/模型/金币建造/${file}`,'utf8'));
    models[file.replace(/\.fbx\.meta$/i,'')]=Object.values(meta.subMetas).find(v=>v.importer==='gltf-scene').uuid;
}
await fs.mkdir('assets/材质/金币建造',{recursive:true});
await editorCall('execute_javascript',{context:'editor',code:`
for(const url of ['db://assets/材质/金币建造','db://assets/TS/DigitGateRules.ts','db://assets/TS/DigitGateHud.ts','db://assets/TS/DigitGateCoinBuild.ts','db://assets/TS/DigitGateGame.ts'])await Editor.Message.request('asset-db','refresh-asset',url);return true;`},60000);
const code=await fs.readFile('tools/install-coin-build.scene.js','utf8');
console.log(JSON.stringify(await editorCall('execute_javascript',{context:'scene',code:code.replace('COIN_MODELS',JSON.stringify(models))},60000)));
const configPath='assets/配置/数字门配置.json',cfg=JSON.parse(await fs.readFile(configPath,'utf8'));
cfg.coinBuild={enabled:true,obstacleHp:[20,135,350,675],coinRewards:[100,200,300,400],buildCosts:[100,200,400],respawnSeconds:.5,pickupRadius:1.65,depositRadius:1.8,depositRate:125,padZ:8.2,turretZ:6.9,maxDefenses:2,tankFireInterval:1.2,tankBlastRadius:2.1};
cfg.gateLayout.firstZ=3.8;cfg.leftGateCycle.gateSpeed=1.8;
cfg.maxSoldiers=6;
cfg.rewards=[];cfg.obstacles=[];cfg.gateSpeed=0;
await fs.writeFile(configPath,JSON.stringify(cfg,null,2)+'\n');
await editorCall('execute_javascript',{context:'editor',code:`await Editor.Message.request('asset-db','refresh-asset','db://assets/配置/数字门配置.json');return true;`});
console.log('金币建造模式已安装');
