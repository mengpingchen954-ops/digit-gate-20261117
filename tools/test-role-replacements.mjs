import fs from 'node:fs/promises';
import {editorCall} from './editor-bridge-client.mjs';
const id=await editorCall('execute_javascript',{context:'editor',code:`const address=await Editor.Message.request('preview','query-preview-url'),url=new URL(typeof address==='string'?address:address.url);url.hostname='127.0.0.1';const w=new(require('electron').BrowserWindow)({show:false,width:920,height:920,webPreferences:{offscreen:true,backgroundThrottling:false}});w.roleLogs=[];w.webContents.on('console-message',(_e,l,m)=>{if(l>=2)w.roleLogs.push(m);});await w.loadURL(url.href);return w.id;`},60000);
const evaluate=code=>editorCall('execute_javascript',{context:'editor',code:`return await require('electron').BrowserWindow.fromId(${id}).webContents.executeJavaScript(${JSON.stringify('(async()=>{'+code+'})()')});`},60000);
try{
 const ready=(await fs.readFile(new URL('./prepare-bake-preview.js',import.meta.url),'utf8')).replace('EXPECTED_SCENE',JSON.stringify('e26a1c6f-fd17-4e70-85c0-1a6dd541906c'));await evaluate(ready);
 const result=await evaluate(await fs.readFile(new URL('./test-role-replacements.browser.js',import.meta.url),'utf8'));
 const logs=await editorCall('execute_javascript',{context:'editor',code:`return require('electron').BrowserWindow.fromId(${id}).roleLogs;`});
 if(logs.length)throw Error(logs.join('\n'));console.log(JSON.stringify(result,null,2));
}finally{await editorCall('execute_javascript',{context:'editor',code:`require('electron').BrowserWindow.fromId(${id})?.destroy();return true;`});}
