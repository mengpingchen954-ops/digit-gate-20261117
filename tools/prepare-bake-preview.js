return await (async()=>{
    const expectedScene=EXPECTED_SCENE;
    let cc;
    for(let i=0;i<200;i++){
        if(typeof System!=='undefined'){
            cc=await System.import('cc');
            // 隐藏的离屏窗口不保证触发浏览器 RAF；用原生单步驱动启动场景。
            if(cc.game._inited){cc.game.resume();cc.game.step();}
            // 编辑器停留在预制体模式时，也允许加载明确指定的游戏场景。
            if(expectedScene && cc.director.getScene() && cc.director.getScene().uuid!==expectedScene){
                const asset=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:expectedScene},(e,a)=>e?j(e):r(a)));
                cc.director.runSceneImmediate(asset.scene);cc.game.step();
            }
            if(cc.director.getScene()?.getComponentInChildren(cc.js.getClassByName('数字门玩法'))?.cfg){
                if(expectedScene&&cc.director.getScene().uuid!==expectedScene){
                    const asset=await new Promise((r,j)=>cc.assetManager.loadAny({uuid:expectedScene},(e,a)=>e?j(e):r(a)));
                    cc.director.runSceneImmediate(asset.scene);cc.game.step();
                    if(!cc.director.getScene()?.getComponentInChildren(cc.js.getClassByName('数字门玩法'))?.cfg)throw Error('当前关卡未能初始化');
                }
                return true;
            }
        }
        await new Promise(r=>setTimeout(r,100));
    }
    throw Error('游戏预览未就绪 '+JSON.stringify({scene:cc?.director.getScene()?.name,paused:cc?.game.isPaused(),initialized:cc?.game._inited}));
})();
