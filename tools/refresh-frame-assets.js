return await (async()=>{
    await Editor.Message.request('scene','editor-preview-set-play',false);
    for(const url of ['db://assets/角色序列帧','db://assets/TS/DigitGateFrameRenderer.ts','db://assets/TS/DigitGateActor.ts']) await Editor.Message.request('asset-db','refresh-asset',url);
    return true;
})();
