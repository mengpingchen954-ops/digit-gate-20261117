import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { editorCall } from './editor-bridge-client.mjs';
const require=createRequire(import.meta.url),JSZip=require('../extensions/super-html/node_modules/jszip');
const channel=process.argv[2]??'google';
if(!['google','applovin'].includes(channel))throw Error('未知渠道');
const config=JSON.parse(await fs.readFile('package-build.config.json','utf8'));
const expectedStoreUrls=JSON.parse(await fs.readFile('assets/配置/数字门配置.json','utf8')).storeUrls;
const output=path.resolve(config.outputs[channel]),htmlFile=path.join(output,config.name+'.html'),zipFile=path.join(output,config.name+'.zip');
const [html,htmlStat,zipStat]=await Promise.all([fs.readFile(htmlFile,'utf8'),fs.stat(htmlFile),fs.stat(zipFile)]);
if(htmlStat.size>5000000||zipStat.size>5000000)throw Error('成品超过5,000,000字节限制');
const archive=await JSZip.loadAsync(await fs.readFile(zipFile)),entries=Object.values(archive.files).filter(e=>!e.dir);
if(entries.length!==1||await entries[0].async('string')!==html)throw Error('ZIP与HTML内容不一致');
const passed=['HTML 和 ZIP 均小于5,000,000字节','ZIP包含本轮相同的完整HTML'];
const preload=path.resolve('temp',channel+'-build','channel-qa-preload.cjs');
if(channel==='applovin'){
    await fs.mkdir(path.dirname(preload),{recursive:true});
    await fs.writeFile(preload,`window.qaMraidListeners={};window.qaMraidState='loading';window.qaMraidVisible=false;window.qaStoreUrls=[];
window.mraid={getVersion:()=> '3.0',getState:()=>qaMraidState,isViewable:()=>qaMraidVisible,
addEventListener:(n,f)=>{(qaMraidListeners[n]??=[]).push(f);},removeEventListener:(n,f)=>{qaMraidListeners[n]=(qaMraidListeners[n]||[]).filter(v=>v!==f);},open:u=>qaStoreUrls.push(u)};`);
    if(!html.includes('mraid.open')||html.includes('ExitApi.exit'))throw Error('AppLovin渠道出口不匹配');
}else if(!html.includes('ExitApi.exit'))throw Error('Google渠道出口缺失');
const id=await editorCall('execute_javascript',{context:'editor',code:`
const w=new(require('electron').BrowserWindow)({show:false,width:750,height:1334,webPreferences:{offscreen:true,backgroundThrottling:false,contextIsolation:false,partition:${JSON.stringify(channel+'-sea-qa-')}+Date.now(),preload:${channel==='applovin'?JSON.stringify(preload):'undefined'}}});
w.qaErrors=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=3)w.qaErrors.push(m);});
try{await w.loadFile(${JSON.stringify(htmlFile)});return w.id;}catch(e){w.destroy();throw e;}`},60000);
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
const w=require('electron').BrowserWindow.fromId(${id});
try{return await w.webContents.executeJavaScript(${JSON.stringify('(async()=>{'+code+'})()')});}catch(e){throw Error(e.message+' '+w.qaErrors.join(' | '));}`},60000);
try{
    if(channel==='applovin'){
        await evaluate(`for(let i=0;i<400;i++){
if(window.qaMraidListeners?.ready?.length){
if(window.b_start_ads)throw Error('MRAID尚未就绪即启动');
qaMraidState='default';qaMraidListeners.ready.forEach(f=>f());
if(window.b_start_ads)throw Error('尚不可见即启动');
qaMraidVisible=true;qaMraidListeners.viewableChange.forEach(f=>f(true));
if(!window.b_start_ads)throw Error('可见后未启动');return true;}
await new Promise(r=>setTimeout(r,100));}throw Error('MRAID就绪事件未注册');`);
        passed.push('AppLovin等MRAID就绪且广告可见后启动');
    }
    await evaluate((await fs.readFile('tools/prepare-bake-preview.js','utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c')));
    const result=await evaluate(`
window.cc=await System.import('cc');window.g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));
cc.game.pause();g.music.stop();g.sound=()=>{};
const passed=[],check=(v,s)=>{if(!v)throw Error(s);passed.push(s);},sea=g.seaRenderer;
check(!!sea&&sea.enabled&&sea.node.activeInHierarchy&&!!sea.mesh,'原有海面节点和网格在成品中启用');
check(sea.getSharedMaterial(0)?.name==='深蓝动态海面'&&!!sea.getSharedMaterial(0).getProperty('waveMap')&&sea.getSharedMaterial(0).getProperty('flowSpeed')>0,'成品使用原有深蓝动态海面材质和波纹贴图');
check((g.camera.visibility&sea.node.layer)!==0,'海面图层对主摄像机可见');
check(g.enemies.filter(a=>a.boss).length===2,'成品只有两个Boss');
check(g.coinBuild&&g.cfg.maxSoldiers===6,'金币建造玩法正常初始化');
const expectedStoreUrls=${JSON.stringify(expectedStoreUrls)};
check(g.cfg.storeUrls.android===expectedStoreUrls.android&&g.cfg.storeUrls.ios===expectedStoreUrls.ios,'成品安卓和iOS商店链接均与当前配置一致');
g.begin();g.update(.05);check(g.phase==='playing','成品能进入游戏并更新');
if(window.mraid){
const descriptor=Object.getOwnPropertyDescriptor(navigator,'userAgent');
try{
for(const [platform,ua]of [['android','Mozilla/5.0 (Linux; Android 14)'],['ios','Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)']]){
Object.defineProperty(navigator,'userAgent',{configurable:true,value:ua});g.openStore();
check(qaStoreUrls.at(-1)===expectedStoreUrls[platform],'AppLovin '+platform+' 安装按钮使用mraid.open跳转到新商店链接');
}
}finally{if(descriptor)Object.defineProperty(navigator,'userAgent',descriptor);else delete navigator.userAgent;}
}
cc.profiler.hideStats();g.enabled=false;cc.game.step();cc.game.pause();
return {passed,sea:{node:sea.node.name,material:sea.getSharedMaterial(0).name}};`);
    passed.push(...result.passed);
    const png=await editorCall('execute_javascript',{context:'editor',code:`
const w=require('electron').BrowserWindow.fromId(${id});await new Promise(r=>setTimeout(r,200));return(await w.webContents.capturePage()).toPNG().toString('base64');`});
    await fs.writeFile(path.join(output,'海面检查.png'),Buffer.from(png,'base64'));
    const errors=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).qaErrors;`});
    if(errors.length)throw Error(errors.join('\n'));
    const validation={channel,htmlBytes:htmlStat.size,zipBytes:zipStat.size,limit:5000000,passed,errors,sea:result.sea,validatedAt:new Date().toISOString()};
    await fs.writeFile(path.join(output,'渠道检查.json'),JSON.stringify(validation,null,2));
    const reportFile=path.join(output,'构建记录.json'),report=JSON.parse(await fs.readFile(reportFile,'utf8'));
    Object.assign(report,{validation:'passed',validationChecks:'渠道检查.json',validatedAt:validation.validatedAt});
    await fs.writeFile(reportFile,JSON.stringify(report,null,2));
    console.log(JSON.stringify(validation,null,2));
}finally{
    await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
}
