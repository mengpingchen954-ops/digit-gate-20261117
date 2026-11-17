import {
    _decorator, Camera, Color, Component, gfx, instantiate, isValid, Label, Mat4, Material,
    Mesh, MeshRenderer, Node, Prefab, Quat, Vec3, utils,
} from 'cc';
import { DigitGateActor } from './DigitGateActor';
import { CoinBuildSettings } from './DigitGateRules';
import { DigitGateHud, WorldBadge } from './DigitGateHud';

const { ccclass, property } = _decorator;
export interface BuiltDefense { node: Node; type: number; slot: number; age: number; cooldown: number; alive: boolean; recoil: Node | null; }
interface Coin { node: Node; value: number; age: number; from: Vec3; landing: Vec3; duration: number; fly: number; collecting: boolean; }
interface Flight { node: Node; from: Vec3; age: number; value: number; }
interface Shot { node: Node; velocity: Vec3; life: number; damage: number; type: number; }
interface Debris { node: Node; velocity: Vec3; spin: Vec3; age: number; size: Vec3; }
interface Chunk { mesh: Mesh; material: Material; center: Vec3; }
interface BuildHost {
    world: Node; squad: Node; camera: Camera; hud: DigitGateHud; bulletPrefab: Prefab;
    settings: CoinBuildSettings; obstacleX: number; obstacleZ: number;
    enemies: () => DigitGateActor[];
    damage: (actor: DigitGateActor, damage: number) => void;
    effect: (position: Vec3, color: Color, scale?: number, strength?: number, duration?: number) => void;
    bulletMaterial: (key: string) => Material;
    boxMesh: Mesh;
    sound: (index: number, volume: number) => void;
    obstacleDestroyed: () => void;
}

/** 金币均来自 Coin.FBX，炮台保留三个原始部件，坦克保留源模型及贴图。 */
@ccclass('金币收集与炮台建造')
export class DigitGateCoinBuild extends Component {
    @property({ type: Prefab, displayName: '金币模型' }) coinPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '炮台一（三部件）' }) cannonPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '黄坦克' }) tankPrefab: Prefab = null!;
    private host: BuildHost = null!;
    private root: Node = null!;
    private obstacle: Node | null = null;
    private obstacleBadge: WorldBadge | null = null;
    private obstacleAge = 0;
    private obstacleIndex = 0;
    private obstacleHp = 0;
    private obstacleMaxHp = 0;
    private respawn = 0;
    private coins: Coin[] = [];
    private flights: Flight[] = [];
    private shots: Shot[] = [];
    private debris: Debris[] = [];
    private defenses: BuiltDefense[] = [];
    private wallet = 0;
    private paid = 0;
    private reserved = 0;
    private buildIndex = 0;
    private depositClock = 0;
    private pad: Node = null!;
    private padLabel: Label = null!;
    private padBars: Node[] = [];
    private walletRoot: Node = null!;
    private walletLabel: Label = null!;
    private walletCoins: Node[] = [];
    private materialCache = new Map<string, Material>();
    private chunkCache = new Map<number, Chunk[]>();
    private readonly blue = new Color(60, 205, 255);
    private readonly yellow = new Color(255, 180, 28);
    private stats = { earned: 0, spent: 0, built: 0, destroyed: 0, shots: 0, hits: 0 };

    setup(host: BuildHost) { this.host = host; }

    reset() {
        this.root?.destroy();
        this.root = new Node('金币障碍、收集与炮台'); this.root.parent = this.host.world;
        this.coins = []; this.flights = []; this.shots = []; this.debris = []; this.defenses = [];
        this.wallet = this.paid = this.reserved = this.buildIndex = this.obstacleIndex = this.depositClock = 0;
        this.stats = { earned: 0, spent: 0, built: 0, destroyed: 0, shots: 0, hits: 0 };
        this.obstacle = null; this.obstacleBadge = null; this.respawn = 0;
        this.makePad(); this.makeWallet(); this.spawnObstacle(false); this.refreshLabels();
    }

    private material(key: string, color: Color, unlit = false) {
        let m = this.materialCache.get(key);
        if (!m) {
            m = new Material(); m.initialize({ effectName: unlit ? 'builtin-unlit' : 'builtin-standard', defines: { USE_INSTANCING: true } });
            m.setProperty('mainColor', color);
            if (!unlit) { m.setProperty('metallic', .55); m.setProperty('roughness', .3); }
            this.materialCache.set(key, m);
        }
        return m;
    }

    private box(parent: Node, name: string, position: Vec3, size: Vec3, material: Material) {
        const n = new Node(name); n.parent = parent; n.setPosition(position); n.setScale(size);
        const r = n.addComponent(MeshRenderer); r.mesh = this.host.boxMesh; r.setSharedMaterial(material, 0);
        return n;
    }

    private coin(parent: Node, position: Vec3, scale = 1) {
        const n = instantiate(this.coinPrefab); n.parent = parent; n.setPosition(position); n.setScale(scale, scale, scale);
        return n;
    }

    private makePad() {
        this.pad = new Node('中路投币建造区'); this.pad.parent = this.root;
        this.pad.setPosition(0, .028, this.host.settings.padZ);
        const white = this.material('pad-white', Color.WHITE, true);
        const shadow = this.material('pad-floor', new Color(98, 116, 126), true);
        this.box(this.pad, '投币底色', new Vec3(), new Vec3(1.12, .012, 1.02), shadow);
        this.padBars = [];
        for (let side = 0; side < 4; side++) for (let i = 0; i < 4; i++) {
            const t = -.48 + i * .32;
            const p = side < 2 ? new Vec3(t, .013, side ? .51 : -.51) : new Vec3(side === 2 ? -.56 : .56, .013, t * .9);
            const size = side < 2 ? new Vec3(.18, .025, .05) : new Vec3(.05, .025, .16);
            this.padBars.push(this.box(this.pad, '白色虚线', p, size, white));
        }
        this.padLabel = this.host.hud.worldText(this.pad, '投币剩余', '100', new Vec3(0, .15, -.12), .0062, 60);
        const icon = this.coin(this.pad, new Vec3(0, .07, .29), .78); icon.name = '投币金币图标';
    }

    private makeWallet() {
        this.walletRoot = new Node('玩家携带金币'); this.walletRoot.parent = this.root;
        this.walletCoins = [];
        for (let i = 0; i < 12; i++) this.walletCoins.push(this.coin(this.walletRoot, new Vec3(.27, .42 + i * .045, .12), .78));
        this.walletLabel = this.host.hud.worldText(this.walletRoot, '持有金币数', '0', new Vec3(.27, 1.12, .12), .0047, 44);
    }

    private get cost() {
        const costs = this.host.settings.buildCosts;
        return costs[Math.min(this.buildIndex, costs.length - 1)];
    }

    private refreshLabels() {
        const full = this.liveDefenses.length >= this.host.settings.maxDefenses;
        this.padLabel.string = String(Math.max(0, this.cost - this.paid));
        this.padLabel.color = full ? new Color(170, 190, 200) : Color.WHITE;
        const count = Math.min(12, Math.ceil(this.wallet / 10));
        this.walletCoins.forEach((n, i) => n.active = i < count);
        this.walletLabel.node.active = this.wallet > 0;
        this.walletLabel.string = String(this.wallet);
    }

    private spawnObstacle(rise: boolean) {
        const h = this.host, cfg = h.settings;
        const n = new Node(`金币雕塑-${this.obstacleIndex + 1}`); n.parent = this.root;
        n.setPosition(h.obstacleX, rise ? -3 : .02, h.obstacleZ);
        const gold = this.material('gold-block', new Color(255, 205, 12));
        gold.setProperty('metallic', .12);
        gold.setProperty('emissive', new Color(255, 175, 0));
        gold.setProperty('emissiveScale', new Vec3(.35,.35,.35));
        for (let i = 0; i < 3; i++) this.box(n, '金色长方体底座', new Vec3(0, .1 + i * .19, 0), new Vec3(1.8 - i * .12, .18, .84 - i * .05), gold);
        const outlines = [
            [[-.54,.62],[-.8,1.45],[0,2.45],[.8,1.45],[.54,.62],[0,1.22],[-.54,.62]],
            [[-.62,.65],[.62,1.45],[-.62,1.85],[.62,2.48],[-.62,2.48],[.62,1.85],[-.62,1.45],[.62,.65]],
            [[-.58,.65],[.58,.65],[.25,1.55],[.58,2.45],[-.58,2.45],[-.25,1.55],[-.58,.65]],
        ];
        const outline = outlines[this.obstacleIndex % outlines.length];
        for (let i = 1; i < outline.length; i++) {
            const a = outline[i-1], b = outline[i], length = Math.hypot(b[0]-a[0],b[1]-a[1]), steps = Math.ceil(length/.062);
            for (let j=0;j<steps;j++) { const t=j/steps; this.coin(n,new Vec3(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,0),.85); }
        }
        this.obstacleHp = this.obstacleMaxHp = cfg.obstacleHp[Math.min(this.obstacleIndex,cfg.obstacleHp.length-1)];
        this.obstacleBadge = h.hud.buildBadge(n,this.obstacleHp,new Vec3(0,.32,.46));
        this.obstacle = n; this.obstacleAge = rise ? 0 : 1;
        this.node.emit('coin-build:obstacle', { index: this.obstacleIndex, hp: this.obstacleHp });
    }

    /** 扫过的子弹仅能击中地面上的完整障碍。 */
    obstacleHitZ(x: number, fromZ: number, toZ: number): number | null {
        if (!this.obstacle || this.obstacleAge < .7 || this.obstacleHp <= 0) return null;
        const p = this.obstacle.position;
        return Math.abs(x-p.x)<=.9 && fromZ>=p.z-.44 && toZ<=p.z+.44 ? p.z : null;
    }

    damageObstacle(damage: number) {
        if (!this.obstacle || this.obstacleAge < .7 || damage <= 0) return;
        this.obstacleHp = Math.max(0,this.obstacleHp-damage);
        this.host.hud.setBadgeValue(this.obstacleBadge!,this.obstacleHp);
        this.obstacle.setScale(1.025,.985,1.025);
        if (this.obstacleHp > 0) return;
        const center = this.obstacle.position.clone(); center.y = 1.15;
        const { coinRewards: rewards, buildCosts } = this.host.settings;
        // 前两次掉落直接取对应建造费用，费用调整后也能一次收齐一座炮台。
        const value = this.obstacleIndex < 2 ? buildCosts[Math.min(this.obstacleIndex,buildCosts.length-1)]
            : rewards[Math.min(this.obstacleIndex,rewards.length-1)];
        this.scatterCoins(center,value);
        this.host.effect(new Vec3(center.x,.5,center.z),this.yellow,1.3);
        this.host.sound(2,.65);
        this.obstacle.destroy(); this.obstacle=null; this.obstacleBadge=null;
        this.obstacleIndex++; this.respawn=this.host.settings.respawnSeconds;
        this.host.obstacleDestroyed();
        this.node.emit('coin-build:obstacle-destroyed',{value,index:this.obstacleIndex-1});
    }

    private scatterCoins(center: Vec3, value: number) {
        const count = Math.min(36,Math.max(18,Math.ceil(value/5)));
        for(let i=0;i<count;i++) {
            const worth=Math.floor(value/count)+(i<value%count?1:0);
            // 已落地的金币保留全部价值；只合并可见实例，避免长时间不拾取时无限增加绘制数量。
            if(this.coins.length>=160){const c=this.coins.find(c=>!c.collecting&&c.age>=c.duration);if(c){c.value+=worth;continue;}}
            const angle=i*2.399963, radius=.3+Math.sqrt((i+.5)/count)*1.25;
            const landing=new Vec3(Math.max(-3.55,Math.min(3.55,center.x+Math.cos(angle)*radius)),.07,
                this.host.squad.position.z-.7+Math.sin(angle)*1.25);
            const node=this.coin(this.root,center.clone());node.name='可拾取金币';
            this.coins.push({node,value:worth,age:0,from:center.clone(),landing,duration:.6+(i%5)*.06,fly:0,collecting:false});
        }
    }

    private tickCoins(dt: number, playing: boolean) {
        const target=this.host.squad.position;
        // 玩家沿 X 轴移动；站到右路中央时，整片散落金币进入吸收范围。
        const inRightLane = Math.abs(target.x-this.host.obstacleX)<=.7;
        this.walletRoot.setPosition(target);
        for(let i=this.coins.length-1;i>=0;i--){
            const c=this.coins[i];c.age+=dt;
            if(c.collecting){
                c.fly+=dt;const t=Math.min(1,c.fly/.24),to=new Vec3(target.x+.27,.55,target.z+.12);
                const p=Vec3.lerp(new Vec3(),c.from,to,t*t);p.y+=Math.sin(t*Math.PI)*.5;c.node.setPosition(p);
                if(t>=1){this.wallet+=c.value;this.stats.earned+=c.value;c.node.destroy();this.coins.splice(i,1);this.refreshLabels();this.host.sound(5,.09);}
                continue;
            }
            if(c.age<c.duration){const t=c.age/c.duration,p=Vec3.lerp(new Vec3(),c.from,c.landing,t);p.y+=Math.sin(t*Math.PI)*1.2;c.node.setPosition(p);c.node.setRotationFromEuler(t*360,(i%5)*36,t*160);}
            else { c.node.setPosition(c.landing);c.node.setRotationFromEuler(0,(i%7)*29,0);
                if(playing&&(inRightLane||Math.hypot(c.landing.x-target.x,c.landing.z-target.z)<this.host.settings.pickupRadius)){c.collecting=true;c.fly=0;c.from=c.node.position.clone();}
            }
        }
    }

    private tickDeposit(dt: number, playing: boolean) {
        const cfg=this.host.settings,p=this.host.squad.position;
        const near=Math.hypot(p.x,p.z-cfg.padZ)<=cfg.depositRadius;
        const full=this.liveDefenses.length>=cfg.maxDefenses;
        const lit=near&&!full;
        const border=this.material(lit?'pad-near':'pad-white',lit?new Color(111,255,201):Color.WHITE,true);
        for(const bar of this.padBars)bar.getComponent(MeshRenderer)!.setSharedMaterial(border,0);
        if(playing&&near&&!full&&this.wallet>0&&this.paid+this.reserved<this.cost){
            this.depositClock+=dt;
            const interval=5/cfg.depositRate;
            while(this.depositClock>=interval&&this.wallet>0&&this.paid+this.reserved<this.cost){
                this.depositClock-=interval;const amount=Math.min(5,this.wallet,this.cost-this.paid-this.reserved);
                this.wallet-=amount;this.reserved+=amount;
                const from=new Vec3(p.x+.27,.95,p.z+.12),node=this.coin(this.root,from,.85);
                this.flights.push({node,from,age:0,value:amount});
                this.refreshLabels();
            }
        }else this.depositClock=0;
        for(let i=this.flights.length-1;i>=0;i--){
            const f=this.flights[i];f.age+=dt;const t=Math.min(1,f.age/.24),to=new Vec3(0,.12,cfg.padZ);
            const q=Vec3.lerp(new Vec3(),f.from,to,t);q.y+=Math.sin(t*Math.PI)*.6;f.node.setPosition(q);
            if(t>=1){f.node.destroy();this.flights.splice(i,1);this.reserved-=f.value;this.paid+=f.value;this.stats.spent+=f.value;
                if(this.paid>=this.cost){this.paid-=this.cost;this.buildDefense();}
                this.refreshLabels();
            }
        }
    }

    private buildDefense() {
        const cfg=this.host.settings;
        if(this.liveDefenses.length>=cfg.maxDefenses)return;
        const type=this.buildIndex%2,slot=Array.from({length:cfg.maxDefenses},(_,i)=>i).find(i=>!this.liveDefenses.some(d=>d.slot===i))!;
        const node=instantiate(type===0?this.cannonPrefab:this.tankPrefab);node.parent=this.root;
        node.name=type===0?'炮台一-蓝色双管炮':'炮台二-黄坦克';
        node.setPosition(this.pad.position.x,0,cfg.turretZ);
        const defense:BuiltDefense={node,type,slot,age:0,cooldown:.15,alive:true,recoil:null};
        defense.recoil=node.getChildByName('炮_炮杆2')??node.getChildByName('炮塔转向');
        this.defenses.push(defense);this.buildIndex++;this.stats.built++;
        this.arrangeDefenses();
        this.host.effect(new Vec3(node.position.x,.1,node.position.z),type===0?this.blue:this.yellow,1.4);
        this.host.sound(2,.65);this.host.hud.toast(type===0?'CANNON READY!':'TANK READY!',type===0?this.blue:this.yellow,new Vec3(node.position.x,1.3,node.position.z),28);
        this.node.emit('coin-build:built',{type,slot});
    }

    get liveDefenses() { return this.defenses.filter(d=>d.alive&&isValid(d.node)); }

    private arrangeDefenses() {
        // 单座居中；两座同时存活时，在投币区前方同一排居中并列。
        const defenses=this.liveDefenses.sort((a,b)=>a.slot-b.slot);
        defenses.forEach((d,i)=>d.node.setPosition(this.pad.position.x+(i-(defenses.length-1)/2)*1.5,0,this.host.settings.turretZ));
    }

    private tickDefenses(dt: number, playing: boolean) {
        for(const d of this.liveDefenses){
            d.age+=dt;const t=Math.min(1,d.age/.45),pop=t<.7?t/.7*1.1:1.1-(t-.7)/.3*.1;d.node.setScale(pop,pop,pop);
            if(!playing||d.age<.45)continue;
            d.cooldown-=dt;
            let target:DigitGateActor|null=null,nearest=13*13;
            for(const a of this.host.enemies()){
                if(a.dead||a.node.position.z>d.node.position.z+.65)continue;
                const p=a.node.position,dist=(p.x-d.node.position.x)**2+(p.z-d.node.position.z)**2;
                if(dist<nearest){nearest=dist;target=a;}
            }
            if(!target)continue;
            const p=target.node.position,from=d.node.position;
            const yaw=Math.atan2(p.x-from.x,p.z-from.z)*180/Math.PI;
            // 两个源模型炮口均为 +Z，预制体已旋转 180°，这里只补目标偏航。
            d.node.setRotationFromEuler(0,yaw-180,0);
            if(d.cooldown<=0){d.cooldown=d.type===0?.3:(this.host.settings.tankFireInterval??1.2);this.fire(d,target);}
        }
    }

    private fire(d:BuiltDefense,target:DigitGateActor){
        const origin=d.node.position.clone();origin.y=d.type===0?.74:.81;
        const to=target.node.position.clone();to.y=.55;
        const direction=Vec3.subtract(new Vec3(),to,origin).normalize();
        const right=new Vec3(-direction.z,0,direction.x).normalize();
        const offsets=d.type===0?[-.13,.13]:[0];
        for(const offset of offsets){
            const node=new Node();node.parent=this.root;
            node.name=d.type===0?'炮台蓝色子弹':'坦克橙黄色炮弹';
            const start=Vec3.scaleAndAdd(new Vec3(),origin,direction,d.type===0?.58:.68);
            Vec3.scaleAndAdd(start,start,right,offset);node.setPosition(start);
            // 沿用现有子弹图片，明亮弹头加两段逐渐缩小的尾迹。
            for(let i=0;i<3;i++){
                const glow=instantiate(this.host.bulletPrefab);glow.parent=node;
                glow.name=i===0?'明亮弹头':'渐缩弹道尾光';
                glow.getComponentInChildren(MeshRenderer)!.setSharedMaterial(this.host.bulletMaterial(d.type===0?'cyan':'yellow'),0);
                glow.setWorldRotation(this.host.camera.node.worldRotation);
                glow.setPosition(direction.clone().multiplyScalar(-i*(d.type===0?.23:.31)));
                const taper=[1,.6,.3][i];glow.setScale((d.type===0?1.3:1.9)*taper,(d.type===0?1.8:2.6)*taper,1);
            }
            this.shots.push({node,velocity:direction.clone().multiplyScalar(d.type===0?22:17),life:1.2,damage:d.type===0?5:22,type:d.type});
            this.host.effect(start,d.type===0?this.blue:this.yellow,d.type===0?.85:1.3,1.7,d.type===0?.24:.32);
        }
        this.stats.shots+=offsets.length;
    }

    private tickShots(dt:number){
        for(let i=this.shots.length-1;i>=0;i--){
            const b=this.shots[i],from=b.node.position.clone(),to=Vec3.scaleAndAdd(new Vec3(),from,b.velocity,dt);
            b.life-=dt;let hit:DigitGateActor|null=null,best=Infinity;
            const vx=to.x-from.x,vz=to.z-from.z,den=vx*vx+vz*vz;
            for(const a of this.host.enemies()){
                if(a.dead)continue;const p=a.node.position,t=Math.max(0,Math.min(1,((p.x-from.x)*vx+(p.z-from.z)*vz)/(den||1)));
                if(Math.hypot(p.x-from.x-vx*t,p.z-from.z-vz*t)<a.radius+.12&&t<best){best=t;hit=a;}
            }
            if(hit){
                const p=hit.node.position.clone();p.y=.65;
                const blastRadius=this.host.settings.tankBlastRadius??2.1;
                this.host.effect(p,b.type===0?this.blue:this.yellow,b.type===0?1.35:blastRadius/.6,b.type===0?1.7:2,b.type===0?.36:.5);
                // 以命中瞬间的位置为爆心，先保存坐标，避免击杀回收影响后续范围判定。
                if(b.type===1){const center=hit.node.position.clone();for(const a of [...this.host.enemies()])if(!a.dead&&Math.hypot(a.node.position.x-center.x,a.node.position.z-center.z)<=blastRadius+a.radius)this.host.damage(a,b.damage);}
                else this.host.damage(hit,b.damage);
                this.stats.hits++;
            }
            if(hit||b.life<=0){b.node.destroy();this.shots.splice(i,1);}else b.node.setPosition(to);
        }
    }

    /** 按原模型三角形的空间位置分块，碎片沿用原始颜色和 UV。 */
    private chunks(defense:BuiltDefense):Chunk[]{
        let cached=this.chunkCache.get(defense.type);if(cached)return cached;
        const sources=defense.node.getComponentsInChildren(MeshRenderer),groups=new Map<string,{positions:number[];uvs:number[];material:Material}>();
        const inverse=Mat4.invert(new Mat4(),defense.node.worldMatrix),matrix=new Mat4();
        for(const r of sources){
            if(!r.mesh)continue;Mat4.multiply(matrix,inverse,r.node.worldMatrix);
            for(let s=0;s<r.mesh.struct.primitives.length;s++){
                const positions=r.mesh.readAttribute(s,gfx.AttributeName.ATTR_POSITION),uvs=r.mesh.readAttribute(s,gfx.AttributeName.ATTR_TEX_COORD),indices=r.mesh.readIndices(s);
                const material=r.sharedMaterials[s]??r.sharedMaterials[0];if(!positions||!material)continue;
                const count=indices?.length??positions.length/3;
                for(let i=0;i+2<count;i+=3){
                    const tri=[0,1,2].map(k=>{const v=indices?indices[i+k]:i+k;return {p:Vec3.transformMat4(new Vec3(),new Vec3(positions[v*3],positions[v*3+1],positions[v*3+2]),matrix),u:uvs?[uvs[v*2],uvs[v*2+1]]:[0,0]};});
                    const center=tri.reduce((v,a)=>v.add(a.p),new Vec3()).multiplyScalar(1/3);
                    const cell=`${center.x<-.15?0:center.x>.15?2:1}/${center.y>.4?1:0}/${center.z>0?1:0}`;
                    const key=material.uuid+'/'+cell;let group=groups.get(key);
                    if(!group){group={positions:[],uvs:[],material};groups.set(key,group);}
                    for(const a of tri){group.positions.push(a.p.x,a.p.y,a.p.z);group.uvs.push(...a.u);}
                }
            }
        }
        cached=[];
        for(const group of groups.values()){
            const p=group.positions,center=new Vec3();for(let i=0;i<p.length;i+=3)center.add(new Vec3(p[i],p[i+1],p[i+2]));center.multiplyScalar(3/p.length);
            const normals:number[]=[],indices:number[]=[];
            for(let i=0;i<p.length;i+=9){const a=new Vec3(p[i],p[i+1],p[i+2]),b=new Vec3(p[i+3],p[i+4],p[i+5]),c=new Vec3(p[i+6],p[i+7],p[i+8]);const normal=Vec3.cross(new Vec3(),b.subtract(a),c.subtract(a)).normalize();for(let j=0;j<3;j++)normals.push(normal.x,normal.y,normal.z);}
            for(let i=0;i<p.length;i+=3){p[i]-=center.x;p[i+1]-=center.y;p[i+2]-=center.z;indices.push(i/3);}
            cached.push({mesh:utils.createMesh({positions:p,normals,uvs:group.uvs,indices}),material:group.material,center});
        }
        this.chunkCache.set(defense.type,cached);return cached;
    }

    destroyDefense(d:BuiltDefense){
        if(!d.alive||!isValid(d.node))return;
        // 完整建造尺寸用于分块，避免出生弹出动画影响下次复用的碎片比例。
        d.node.setScale(1,1,1);
        const rotation=d.node.rotation.clone(),origin=d.node.position.clone();
        for(const chunk of this.chunks(d)){
            const n=new Node(d.type===0?'蓝色炮台原模型碎片':'黄坦克原模型碎片');n.parent=this.root;
            const center=Vec3.transformQuat(new Vec3(),chunk.center,rotation);n.setPosition(origin.clone().add(center));n.setRotation(rotation);
            const renderer=n.addComponent(MeshRenderer);renderer.mesh=chunk.mesh;renderer.setSharedMaterial(chunk.material,0);
            this.debris.push({node:n,velocity:new Vec3(center.x*3+(Math.random()-.5)*1.8,2+Math.random()*2,center.z*2+(Math.random()-.5)*1.8),spin:new Vec3(180+Math.random()*250,Math.random()*400,Math.random()*250),age:0,size:new Vec3(1,1,1)});
        }
        d.alive=false;d.node.destroy();this.stats.destroyed++;
        this.arrangeDefenses();
        this.host.effect(new Vec3(origin.x,.4,origin.z),d.type===0?this.blue:this.yellow,1.7);
        this.refreshLabels();this.node.emit('coin-build:defense-destroyed',{type:d.type,slot:d.slot});
    }

    private tickDebris(dt:number){
        for(let i=this.debris.length-1;i>=0;i--){
            const d=this.debris[i];d.age+=dt;d.velocity.y-=8.5*dt;
            const p=Vec3.scaleAndAdd(new Vec3(),d.node.position,d.velocity,dt);
            if(p.y<.09){p.y=.09;d.velocity.y=Math.max(0,-d.velocity.y*.2);d.velocity.x*=.8;d.velocity.z*=.8;}
            d.node.setPosition(p);const e=d.node.eulerAngles;d.node.setRotationFromEuler(e.x+d.spin.x*dt,e.y+d.spin.y*dt,e.z+d.spin.z*dt);
            const scale=Math.max(0,1-Math.max(0,d.age-.65)/.5);d.node.setScale(scale,scale,scale);
            if(d.age>=1.15){d.node.destroy();this.debris.splice(i,1);}
        }
    }

    tick(dt:number,playing:boolean){
        if(!this.root||!playing)return;
        if(this.obstacle){
            if(playing)this.obstacleAge+=dt;
            const t=Math.min(1,this.obstacleAge/.7),p=this.obstacle.position;
            this.obstacle.setPosition(p.x,-3+(3.02)*(1-(1-t)**3),p.z);
            this.obstacle.setScale(Vec3.lerp(new Vec3(),this.obstacle.scale,Vec3.ONE,Math.min(1,dt*18)));
            this.obstacleBadge!.node.active=t>=1;
            if(t>=1)this.host.hud.updateBadgeValue(this.obstacleBadge!);
        }else if(playing){this.respawn-=dt;if(this.respawn<=0)this.spawnObstacle(true);}
        this.tickCoins(dt,playing);this.tickDeposit(dt,playing);this.tickDefenses(dt,playing);
        if(playing)this.tickShots(dt);this.tickDebris(dt);
    }

    snapshot(){return {wallet:this.wallet,paid:this.paid,inFlight:this.reserved,cost:this.cost,coins:this.coins.length,groundValue:this.coins.reduce((n,c)=>n+c.value,0),obstacleIndex:this.obstacleIndex,obstacleHp:this.obstacleHp,obstacleReady:!!this.obstacle&&this.obstacleAge>=.7,
        defenses:this.liveDefenses.map(d=>({type:d.type,slot:d.slot,x:d.node.position.x,z:d.node.position.z})),shots:this.shots.length,debris:this.debris.length,stats:{...this.stats}};}

    onDestroy(){this.root?.destroy();for(const m of this.materialCache.values())m.destroy();for(const chunks of this.chunkCache.values())for(const c of chunks)c.mesh.destroy();}
}
