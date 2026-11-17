window.cc=await System.import('cc');window.g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));
cc.game.pause();g.music?.stop();g.sound=()=>{};
const passed=[],check=(ok,label)=>{if(!ok)throw Error(label);passed.push(label);};
check(g.soldierPrefabs[0].uuid==='3b21a4c3-311e-4b1c-ae87-46ac78028526','主角引用初级士兵');
check(g.enemyPrefab.uuid==='c5404de2-5438-4504-901b-e86c0f8d86ba','小丧尸引用矿工八方向序列帧');
check(g.bossPrefabs[0].uuid==='6953f4f0-f8f3-48aa-9d27-48bae97c6722','大丧尸引用屠夫');
const soldier=g.soldiers[0],miner=g.enemies.find(a=>!a.boss),boss=g.enemies.find(a=>a.poolKey==='boss1');
for(const [actor,actions] of [[soldier,['shoot','left','right','death']],[miner,['move','attack','death']],[boss,['move','attack','death']]]){
 check(!!actor?.animation,'角色动画绑定 '+actor?.model?.name);
 for(const action of actions)check(!!actor.actionClips[action],'动作可用 '+actor.model.name+' '+action);
}
check(miner.model.getChildByName('血条与血量')?.getComponentInChildren(cc.Graphics),'矿工血条保留');
check(boss.model.getChildByName('血条与血量')?.getComponentInChildren(cc.Graphics),'屠夫血条保留');
const bossMeshes=boss.model.getComponentsInChildren(cc.SkinnedMeshRenderer);
check(bossMeshes.length===2&&bossMeshes.find(r=>/wuqi/.test(r.node.name)).sharedMaterials[0].getProperty('mainTexture'),'屠夫武器贴图完整');
check(!bossMeshes.find(r=>!/wuqi/.test(r.node.name)).sharedMaterials[0].getProperty('mainTexture'),'屠夫身体保留原素材灰色，未误用黄色占位图');
g.begin();g.updateEnemies=()=>{};
const player=cc.director.getSystem('animation');
let hits=0;for(const actor of [miner,boss]){
 actor.reset();actor.play('move');actor.startAttack(2,()=>hits++);actor.resume();
 for(let i=0;i<100;i++)player.update(1/30);
 check(hits===(actor===miner?1:2),'攻击只结算一次 '+actor.model.name);
 actor.kill();check(actor.dead&&actor.animation.getState(actor.actionClips.death.name).isPlaying,'死亡动画播放 '+actor.model.name);
}
soldier.play('left');check(soldier.animation.getState('左移射击').isPlaying,'主角左移动作播放');
soldier.play('right');check(soldier.animation.getState('右移射击').isPlaying,'主角右移动作播放');
soldier.play('shoot');soldier.resume();
g.restart();cc.profiler.hideStats();
window.rolePassed=passed;
return {passed,snapshot:{soldiers:g.soldiers.length,enemies:g.enemies.length,bosses:g.enemies.filter(a=>a.boss).map(a=>({name:a.model.name,hp:a.hp}))}};
