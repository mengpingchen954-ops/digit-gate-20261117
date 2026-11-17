import fs from 'node:fs/promises';
import { editorCall } from '../editor-bridge-client.mjs';

let windowId=null, sceneUuid=null, tail=Promise.resolve(), idleTimer;
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`
    const w=require('electron').BrowserWindow.fromId(${windowId});
    if(!w||w.isDestroyed())throw Error('图片预览窗口已关闭，请重试');
    return await w.webContents.executeJavaScript(${JSON.stringify(`(async()=>{${code}})()`)});`},45000);

async function close(){
    clearTimeout(idleTimer);
    const id=windowId;windowId=null;sceneUuid=null;
    if(id!==null)await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});
    return {closed:true};
}
async function render(input){
    if(input.close)return close();
    const {config,index,remaining,zoom=1}=input;
    if(windowId!==null&&sceneUuid!==input.sceneUuid)await close();
    if(windowId!==null){
        const alive=await editorCall('execute_javascript',{context:'editor',code:`return !!require('electron').BrowserWindow.fromId(${windowId});`});
        if(!alive)windowId=null;
    }
    if(windowId===null){
        windowId=await editorCall('execute_javascript',{context:'editor',code:`
            const {BrowserWindow}=require('electron');
            for(const old of BrowserWindow.getAllWindows())if(old.rewardPicturePreview)old.destroy();
            const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';
            const w=new BrowserWindow({show:false,width:600,height:760,webPreferences:{offscreen:true,backgroundThrottling:false}});w.rewardPicturePreview=true;
            try{await w.loadURL(url.href);return w.id;}catch(e){w.destroy();throw e;}`},45000);
        sceneUuid=input.sceneUuid;
        const ready=(await fs.readFile(new URL('../prepare-bake-preview.js',import.meta.url),'utf8')).replace('EXPECTED_SCENE',JSON.stringify(sceneUuid));
        await evaluate(ready);
    }
    const details=await evaluate((await fs.readFile(new URL('./reward-picture-render.js',import.meta.url),'utf8')).replace('PREVIEW_INPUT',JSON.stringify({config,index,remaining,zoom})));
    const png=await editorCall('execute_javascript',{context:'editor',code:`
        const w=require('electron').BrowserWindow.fromId(${windowId});
        return(await w.webContents.capturePage({x:0,y:50,width:600,height:710})).toPNG().toString('base64');`});
    clearTimeout(idleTimer);idleTimer=setTimeout(()=>rewardPicturePreview({close:true}).catch(()=>{}),300000);idleTimer.unref();
    return {image:'data:image/png;base64,'+png,...details};
}
export function rewardPicturePreview(input){
    const next=tail.then(()=>render(input));tail=next.catch(()=>{});return next;
}
