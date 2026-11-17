const {config,index,remaining,zoom}=PREVIEW_INPUT;
const cc=await System.import('cc'),g=cc.director.getScene().getComponentInChildren(cc.js.getClassByName('数字门玩法'));
cc.game.pause();g.music.stop();g.sound=()=>{};g.enabled=false;
const wave=index===null?{time:0,kind:'plane',hp:config.planeHp,layers:config.planeLayers}:structuredClone(config.rewards[index]);
g.cfg=structuredClone(config);g.cfg.enemyArea.count=0;g.cfg.bosses=[];g.cfg.rewards=[];g.cfg.obstacles=[];
g.cfg.leftGateCycle.enabled=false;g.cfg.gateLayout.spacing=20;g.cfg.planePosition={x:0,z:5};g.restart();
g.gates.forEach(v=>v.node.destroy());g.gates=[];g.rewards.forEach(v=>v.node.destroy());g.rewards=[];g.squad.active=false;
// 在独立游戏实例中使用真实预制体、材质、相机角度；不接触编辑场景和磁盘配置。
g.hud.node.active=false;
const r=g.spawnReward({...wave,startZ:5,speed:0},true);r.node.setPosition(0,.02,5);r.node.setRotationFromEuler(0,0,0);
const full=wave.layers??3,count=Math.min(full,remaining??full);
if(count<full){r.hp=wave.hp*count/full;r.rock.hit(r.hp,wave.hp);g.hud.setBadgeValue(r.badge,r.hp);r.rock.tick(1);}
g.stoneBursts.forEach(b=>b.node.destroy());g.stoneBursts=[];
if(!g.previewPictureRotation)g.previewPictureRotation=g.camera.node.rotation.clone();
g.camera.node.setRotation(g.previewPictureRotation);
const height=config.rewardStone.offset.y+full*config.rewardStone.size.y+Math.max(0,full-1)*config.rewardStone.gap;
const target=new cc.Vec3(0,Math.max(.8,height/2+.5),5),forward=cc.Vec3.transformQuat(new cc.Vec3(),new cc.Vec3(0,0,-1),g.camera.node.rotation);
const distance=Math.max(4,height*1.3+2.7)/zoom;
g.camera.node.setPosition(target.subtract(forward.multiplyScalar(distance)));
g.hud.updateBadgeValue(r.badge);cc.profiler.hideStats();cc.game.step();cc.game.pause();
return {layers:count,position:r.badge.icon.position,rotation:r.node.getComponentInChildren(cc.Sprite).node.eulerAngles,scale:r.node.getComponentInChildren(cc.Sprite).node.scale};
