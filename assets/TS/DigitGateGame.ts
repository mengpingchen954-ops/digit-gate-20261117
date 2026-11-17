import {
    _decorator, AudioClip, AudioSource, Camera, Color, Component, EventMouse, EventTouch,
    game, Game, input, Input, instantiate, JsonAsset, Material, Mesh, MeshRenderer,
    Node, Prefab, primitives, ResolutionPolicy, Sprite, Texture2D, utils, Vec2, Vec3, view,
} from 'cc';
import { DigitGateActor } from './DigitGateActor';
import { DigitGateBarrel } from './DigitGateBarrel';
import { DigitGateRock } from './DigitGateRock';
import { DigitGateRockFragments } from './DigitGateRockFragments';
import { DigitGatePassEffect } from './DigitGatePassEffect';
import { DigitGateHitEffect } from './DigitGateHitEffect';
import { DigitGateUpgradeEffect } from './DigitGateUpgradeEffect';
import { DigitGateHud, WorldBadge } from './DigitGateHud';
import { BossWave, DigitGateSettings, RewardKind, RewardWave } from './DigitGateRules';
import { enemyPositions, formationPosition, gateCount, gateLabel, gatePositions, gateRule, routeDistance, routeZ, routeX, routeYaw, routePosition, footprintsOverlap } from './DigitGateLayout';
import { jumpToStore } from './DigitGateStore';
import { BuiltDefense, DigitGateCoinBuild } from './DigitGateCoinBuild';

const { ccclass, property } = _decorator;
type Phase = 'guide' | 'playing' | 'won' | 'lost';
type GateSide = -1 | 1;
interface Gate { node: Node; badge: WorldBadge; z: number; side: GateSide; released: boolean; }
interface Reward { node: Node; badge: WorldBadge; barrel: DigitGateBarrel | null; rock: DigitGateRock | null; z: number; hp: number; maxHp: number; kind: RewardKind; power: number; hit: number; speed: number; width: number; depth: number; dropAge?: number; riseAge?: number; leftBarrier?: boolean; gatesMarked?: boolean; collected?: boolean; }
interface Bullet { node: Node; x: number; z: number; damage: number; life: number; color: string; }
interface Spark { node: Node; velocity: Vec3; life: number; }

@ccclass('数字门玩法')
export class DigitGateGame extends Component {
    @property({ type: JsonAsset, displayName: '关卡数值与波次' }) settingsAsset: JsonAsset = null!;
    @property({ type: [Prefab], displayName: '我方士兵 1、2、3级' }) soldierPrefabs: Prefab[] = [];
    @property({ type: [Prefab], displayName: 'Boss 类型 1、类型 2' }) bossPrefabs: Prefab[] = [];
    @property({ type: Prefab, displayName: '敌人小兵' }) enemyPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '变量门外观' }) gatePrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '奖励物外观', tooltip: '左右两侧共用；石头位置、尺寸和层数在关卡配置或工作台调整。' }) rewardBoxPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '过门增益特效' }) gateEffectPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '子弹命中 Shader 特效' }) hitEffectPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: 'Boss 攻击地面爆炸' }) bossAttackEffectPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '队伍升级 Shader 特效' }) upgradeEffectPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '无奖励障碍箱外观' }) obstacleBoxPrefab: Prefab = null!;
    @property({ type: Prefab, displayName: '子弹图片预制体' }) bulletPrefab: Prefab = null!;
    @property({ type: Camera, displayName: '主相机' }) camera: Camera = null!;
    @property({ type: [Texture2D], displayName: '奖励图标：手枪、步枪、士兵、飞机' }) textures: Texture2D[] = [];
    @property({ type: [Texture2D], displayName: '奖励可选图片', tooltip: '把新图片拖入此列表；工作台的每份奖励可以分别选择图片和显示大小。图片跟随奖励配置，调整顺序不会串图。' }) rewardIconTextures: Texture2D[] = [];
    @property({ type: [AudioClip], displayName: '音乐、射击、升级、胜利、失败、命中' }) sounds: AudioClip[] = [];
    @property({ type: AudioClip, displayName: '最后一个 Boss 死亡音效', tooltip: '最后一名存活 Boss 被击杀时播放一次。' }) finalBossDeathSound: AudioClip | null = null;
    @property({ displayName: '最后一个 Boss 死亡音效音量', tooltip: '0＝静音，1＝原始音量。', range: [0, 1, 0.05], slide: true }) finalBossDeathVolume = 0.8;
    @property({ type: MeshRenderer, displayName: '场景现有海面' }) seaRenderer: MeshRenderer | null = null;
    @property({ type: DigitGateCoinBuild, displayName: '金币收集与炮台建造' }) coinBuild: DigitGateCoinBuild | null = null;

    private cfg: DigitGateSettings = null!;
    private phase: Phase = 'guide';
    private elapsed = 0;
    private level = 1;
    private power = 1;
    private get fireInterval() { return this.cfg.levelFireIntervals[this.level - 1] / this.power; }
    private kills = 0;
    private reachedMax = false;
    private fullGateCount = 0;
    private squadCapacity = 4;
    // 重试上限读取工作台配置，restart 不重置已用次数。
    private retriesUsed = 0;
    private nextGateDistance = 0;
    private nextLeftGateDistance = 0;
    private leftGatesCollected = 0;
    private leftGatePhase: 'blocked' | 'collecting' | 'moving' = 'moving';
    private rewardIndex = 0;
    private obstacleIndex = 0;
    private dragging = false;
    private backgroundPaused = false;
    private targetX = 0;
    private controlX = 0;
    private dragStartX = 0;
    private dragStartControlX = 0;
    private squadX = 0;
    private cameraOrigin = new Vec3();
    private cameraShakeOffset = new Vec3();
    private shakeAge = 0;
    private shakeDuration = 0;
    private shakeStrength = 0;
    private squad: Node = null!;
    private world: Node = null!;
    private reserve: Node = null!;
    @property({ type: DigitGateHud, displayName: 'Canvas 游戏界面' }) private hud: DigitGateHud = null!;
    private music: AudioSource = null!;
    private effectsAudio: AudioSource = null!;
    private lastShotSound = -1;
    private lastHitSound = -1;
    private soldiers: DigitGateActor[] = [];
    private enemies: DigitGateActor[] = [];
    private soldierPositions: Vec3[] = [];
    private bulletTargets: DigitGateActor[] = [];
    private dying: DigitGateActor[] = [];
    private actorPool = new Map<string, DigitGateActor[]>();
    private hpBadges = new Map<DigitGateActor, WorldBadge>();
    private gates: Gate[] = [];
    private rewards: Reward[] = [];
    private bullets: Bullet[] = [];
    private bulletPool: Node[] = [];
    private sparks: Spark[] = [];
    private stoneBursts: DigitGateRockFragments[] = [];
    private sparkPool: Node[] = [];
    private gateEffects: DigitGatePassEffect[] = [];
    private hitEffects: DigitGateHitEffect[] = [];
    private bossAttackEffects: DigitGateHitEffect[] = [];
    private upgradeEffects: DigitGateUpgradeEffect[] = [];
    private boxMesh: Mesh = null!;
    private materials = new Map<string, Material>();
    private temp = new Vec3();
    private get liveSoldiers() { return this.soldiers.filter(a => !a.dead); }
    private get coinMode() { return !!this.cfg?.coinBuild?.enabled && !!this.coinBuild; }

    start() {
        this.cfg = this.settingsAsset?.json as DigitGateSettings;
        if (!this.cfg || this.soldierPrefabs.length !== 3 || !this.enemyPrefab || !this.camera) {
            console.error('[数字门] 缺少配置、角色预制体或主相机引用。');
            return;
        }
        this.boxMesh = utils.createMesh(primitives.box());
        this.world = new Node('玩法动态物体'); this.node.addChild(this.world);
        this.reserve = new Node('对象池'); this.node.addChild(this.reserve); this.reserve.active = false;
        this.squad = new Node('我方编队'); this.world.addChild(this.squad);
        this.music = this.node.addComponent(AudioSource);
        this.effectsAudio = this.world.addComponent(AudioSource);
        this.music.clip = this.sounds[0] ?? null;
        this.music.loop = true; this.music.volume = 0.32;
        this.cameraOrigin.set(this.camera.node.position);
        this.instanceRoadPieces();
        this.configureViewport();
        this.hud.setup(this.camera, this.cfg.effects);
        if (this.coinMode && this.coinBuild) this.coinBuild.setup({
            world: this.world, squad: this.squad, camera: this.camera, hud: this.hud,
            bulletPrefab: this.bulletPrefab, settings: this.cfg.coinBuild!,
            obstacleX: this.cfg.planePosition.x ?? routeX(this.cfg.paths.gates, this.cfg.planePosition.z), obstacleZ: this.cfg.planePosition.z,
            boxMesh: this.boxMesh, enemies: () => this.enemies,
            damage: (actor, damage) => this.damageEnemy(actor, damage),
            effect: (position, color, scale = 1, strength = 1, duration) => this.playHitEffect(this.hitEffects, this.hitEffectPrefab, position, color, scale, strength, duration),
            bulletMaterial: key => this.bulletMaterial(key), sound: (index, volume) => this.sound(index, volume),
            obstacleDestroyed: () => {
                this.squadCapacity += 2;
                this.reachedMax = false; this.fullGateCount = 0;
                this.hud.toast('MAX +2', new Color(255, 219, 91), this.squadTop(new Vec3()), 30);
                this.node.emit('digit-gate:capacity', { maxSoldiers: this.squadCapacity });
            },
        });
        this.hud.onInstall = () => this.openStore();
        this.hud.onRetry = () => this.retryLevel();
        this.listen(true);
        this.restart();
    }

    private instanceRoadPieces() {
        const roads = this.node.scene.getChildByName('地形')?.getChildByName('连续S弯道路');
        if (!roads) return;
        const materials = new Map<Material, Material>();
        for (const renderer of roads.getComponentsInChildren(MeshRenderer)) {
            renderer.sharedMaterials.forEach((source, index) => {
                if (!source) return;
                let material = materials.get(source);
                if (!material) {
                    material = new Material(); material.copy(source, { defines: { USE_INSTANCING: true } });
                    materials.set(source, material);
                    this.materials.set(`road-instance-${materials.size}`, material);
                }
                renderer.setSharedMaterial(material, index);
            });
        }
    }

    private listen(on: boolean) {
        const fn = on ? 'on' : 'off';
        input[fn](Input.EventType.TOUCH_START, this.touchStart, this);
        input[fn](Input.EventType.TOUCH_MOVE, this.touchMove, this);
        input[fn](Input.EventType.TOUCH_END, this.pointerUp, this);
        input[fn](Input.EventType.TOUCH_CANCEL, this.pointerUp, this);
        input[fn](Input.EventType.MOUSE_DOWN, this.mouseDown, this);
        input[fn](Input.EventType.MOUSE_MOVE, this.mouseMove, this);
        input[fn](Input.EventType.MOUSE_UP, this.pointerUp, this);
        game[fn](Game.EVENT_HIDE, this.onHide, this);
        game[fn](Game.EVENT_SHOW, this.onShow, this);
    }

    private touchStart(event: EventTouch) { this.pointerDown(event.getUILocation(), event.getLocation()); }
    private touchMove(event: EventTouch) { this.pointerMove(event.getUILocation()); }
    private mouseDown(event: EventMouse) { if (event.getButton() === EventMouse.BUTTON_LEFT) this.pointerDown(event.getUILocation(), event.getLocation()); }
    private mouseMove(event: EventMouse) { this.pointerMove(event.getUILocation()); }
    private pointerDown(point: Vec2, screenPoint: Vec2) {
        if (!this.cfg || this.phase === 'won' || this.phase === 'lost') return;
        // 以可编辑按钮的实际位置判断，不再用写死的顶部区域阻挡输入。
        if (this.hud.isPointerOverButton(screenPoint)) return;
        this.dragging = true;
        this.dragStartX = point.x;
        this.dragStartControlX = this.controlX;
        this.begin();
    }
    private pointerMove(point: Vec2) {
        if (!this.dragging || this.phase !== 'playing') return;
        // Google HorizonTouch：按下位置为锚点，设计像素 × .025；参考道路半宽为 10。
        // 参考还除以 UIRoot 的适配系数；它不同于 getUILocation 的像素转换。
        const visible = view.getVisibleSize();
        const uiScale = Math.min(visible.width / 750, visible.height / 1334);
        const x = this.dragStartControlX + (point.x - this.dragStartX) * .025 * this.cfg.moveLimit / 10 / uiScale;
        this.targetX = Math.max(-this.cfg.moveLimit, Math.min(this.cfg.moveLimit, x));
    }
    private pointerUp() { this.dragging = false; }
    private onHide() { this.backgroundPaused = true; this.dragging = false; this.music?.pause(); this.soldiers.forEach(a => a.pause()); this.enemies.forEach(a => a.pause()); this.dying.forEach(a => a.pause()); }
    private onShow() {
        this.backgroundPaused = false;
        this.dying.forEach(a => a.resume());
        if (this.phase === 'playing') {
            this.music?.play();
            this.soldiers.forEach(a => a.resume()); this.enemies.forEach(a => a.resume());
        } else if (this.phase === 'guide') {
            // 回到前台时恢复开场射击展示，敌人与关卡进度仍等待首次操作。
            this.soldiers.forEach(a => a.resume());
        }
    }

    begin() {
        if (this.phase !== 'guide') return;
        this.phase = 'playing';
        this.soldiers.forEach(a => { a.play('shoot'); a.resume(); }); this.enemies.forEach(a => { a.play('move'); a.resume(); });
        this.music.play();
        this.node.emit('digit-gate:started');
    }

    restart() {
        if (!this.cfg) return;
        for (const actor of new Set([...this.soldiers, ...this.enemies, ...this.dying])) this.recycleActor(actor);
        this.soldiers = []; this.enemies = []; this.dying = [];
        for (const badge of this.hpBadges.values()) badge.node.active = false;
        this.hpBadges.clear();
        this.gates.forEach(g => g.node.destroy()); this.gates = [];
        this.rewards.forEach(r => r.node.destroy()); this.rewards = [];
        this.bullets.forEach(b => this.recyclePrimitive(b.node, this.bulletPool)); this.bullets = [];
        this.sparks.forEach(s => this.recyclePrimitive(s.node, this.sparkPool)); this.sparks = [];
        this.stoneBursts.forEach(b => b.node.destroy()); this.stoneBursts = [];
        this.gateEffects.forEach(effect => { effect.node.active = false; });
        this.hitEffects.forEach(effect => effect.recycle());
        this.bossAttackEffects.forEach(effect => effect.recycle());
        this.upgradeEffects.forEach(effect => effect.recycle());
        this.elapsed = 0; this.level = 1; this.power = 1; this.kills = 0;
        this.reachedMax = false;
        this.fullGateCount = 0;
        this.squadCapacity = this.cfg.maxSoldiers;
        this.targetX = 0; this.controlX = 0; this.squadX = 0; this.squad.setPosition(0, 0, this.cfg.playerZ);
        this.clearCameraShake();
        this.camera.node.setPosition(this.cameraOrigin);
        this.rewardIndex = 0; this.obstacleIndex = 0;
        this.leftGatesCollected = 0; this.leftGatePhase = 'moving';
        this.lastShotSound = -1; this.lastHitSound = -1;
        this.phase = 'guide'; this.dragging = false;
        this.music.stop(); this.hud.reset();
        for (let i = 0; i < this.cfg.startSoldiers; i++) this.addSoldier(false);
        const layout = this.cfg.gateLayout;
        const positions = this.coinMode ? [] : gatePositions(this.cfg);
        positions.forEach(z => this.spawnGate(z));
        this.nextGateDistance = routeDistance(this.cfg.paths.gates, layout.firstZ) - positions.length * layout.spacing;
        if (this.cfg.leftGateCycle?.enabled || this.coinMode) {
            const leftPositions = gatePositions(this.cfg, 0, this.cfg.paths.rewards);
            leftPositions.forEach(z => this.spawnGate(z, -1));
            this.nextLeftGateDistance = routeDistance(this.cfg.paths.rewards, layout.firstZ) - leftPositions.length * layout.spacing;
            if (!this.coinMode) this.spawnLeftReward(false);
        }
        // 右侧障碍开场即落在配置位置；满员仅播放 MAX 提示。
        if (this.coinMode) this.coinBuild!.reset();
        else {
            const openingObstacle = this.spawnReward({ time: 0, kind: 'plane', hp: this.cfg.planeHp, layers: this.cfg.planeLayers }, true);
            this.markBarrierGates(openingObstacle, 1);
        }
        this.spawnEnemyArea();
        this.cfg.bosses.forEach(wave => this.spawnBoss(wave));
        // 引导阶段也循环射击动作，不能停在尚未采样的 FBX 默认姿态。
        // 重玩复用对象池中的角色时，也要恢复之前暂停的动画。
        this.soldiers.forEach(a => a.resume()); this.enemies.forEach(a => a.pause());
        this.node.emit('digit-gate:restarted');
    }

    update(rawDt: number) {
        if (!this.cfg || !this.hud || this.backgroundPaused) return;
        const dt = Math.min(rawDt, 0.05);
        this.hud.tick(dt);
        this.updateEffects(dt); this.updateDying(dt);
        this.coinBuild?.tick(dt, this.phase === 'playing');
        if (this.phase !== 'playing') return;
        this.elapsed += dt;
        this.updateSquad(dt);
        while (!this.coinMode && !this.cfg.leftGateCycle?.enabled && this.rewardIndex < this.cfg.rewards.length && this.elapsed >= this.cfg.rewards[this.rewardIndex].time) {
            this.spawnReward(this.cfg.rewards[this.rewardIndex++]);
        }
        while (!this.coinMode && this.obstacleIndex < this.cfg.obstacles.length && this.elapsed >= this.cfg.obstacles[this.obstacleIndex].time) {
            this.spawnReward({ ...this.cfg.obstacles[this.obstacleIndex++], kind: 'obstacle' });
        }
        this.updateGates(dt); this.updateRewards(dt); this.updateEnemies(dt);
        if (this.phase === 'playing') this.updateShooting(dt);
        if (this.phase === 'playing') this.updateBullets(dt);
        this.checkBattleEnd();
    }

    private configureViewport() {
        // Google 参考包：750×1334、FIXED_WIDTH；实际画布铺满窗口，不强制留边。
        view.setDesignResolutionSize(750, 1334, ResolutionPolicy.FIXED_WIDTH);
    }

    lateUpdate(dt = 0) {
        if (!this.cfg || !this.hud || this.backgroundPaused) return;
        // 原包 HorizonTouch 跟控制点，不跟人物的上一帧显示位置。
        const p = this.camera.node.position;
        // 先减掉上帧震屏再计算跟随，避免偏移积累或干扰拖拽控制点。
        const baseX = p.x - this.cameraShakeOffset.x;
        const baseY = p.y - this.cameraShakeOffset.y;
        const x = baseX + (this.cameraOrigin.x + this.controlX - baseX) * 1.15;
        this.shakeAge += dt;
        const fade = this.shakeDuration > 0 ? Math.max(0, 1 - this.shakeAge / this.shakeDuration) : 0;
        const strength = this.shakeStrength * fade * fade;
        this.cameraShakeOffset.set(Math.sin(this.shakeAge * 125) * strength, Math.sin(this.shakeAge * 155) * strength * .7, 0);
        if (fade === 0) this.shakeStrength = 0;
        this.camera.node.setPosition(x + this.cameraShakeOffset.x, baseY + this.cameraShakeOffset.y, p.z);
        // 先更新相机矩阵，再投影血条和门标牌，避免相机移动时标签滞后一帧。
        this.camera.camera.update();
        this.updateBadges();
    }

    private shakeCamera(strength: number, seconds: number) {
        if (strength <= 0 || seconds <= 0) return;
        // 同时发生时不叠加无限强度，也不让较轻的领奖覆盖落地冲击。
        const remaining = Math.max(0, this.shakeDuration - this.shakeAge);
        const current = this.shakeDuration > 0 ? this.shakeStrength * (remaining / this.shakeDuration) ** 2 : 0;
        this.shakeStrength = Math.max(current, strength);
        this.shakeDuration = Math.max(remaining, seconds);
        this.shakeAge = 0;
    }

    private clearCameraShake() {
        const p = this.camera.node.position;
        this.camera.node.setPosition(p.x - this.cameraShakeOffset.x, p.y - this.cameraShakeOffset.y, p.z);
        this.cameraShakeOffset.set(0, 0, 0);
        this.shakeAge = this.shakeDuration = this.shakeStrength = 0;
    }

    private updateSquad(dt: number) {
        const previous = this.squadX;
        if (dt > 0) {
            // 原包 C_Role 先 updateTransData 再 move：人物显示落后控制点一帧。
            this.squadX = this.controlX;
            const scale = this.cfg.moveLimit / 10;
            const distance = this.targetX - this.controlX;
            const speed = Math.max(7 * scale, Math.min(700 * scale, Math.abs(distance) * 70 / 3));
            this.controlX += Math.sign(distance) * Math.min(Math.abs(distance), speed * dt);
            let minSlot = 0, maxSlot = 0;
            for (let i = 0; i < this.soldiers.length; i++) {
                if (this.soldiers[i].dead) continue;
                this.formationSlot(i, this.temp);
                minSlot = Math.min(minSlot, this.temp.x); maxSlot = Math.max(maxSlot, this.temp.x);
            }
            // 与参考一样为整个队形留边，不让外围成员越出活动范围。
            const min = -this.cfg.moveLimit - Math.max(-this.cfg.moveLimit, minSlot);
            const max = this.cfg.moveLimit - Math.min(this.cfg.moveLimit, maxSlot);
            this.controlX = Math.max(min, Math.min(max, this.controlX));
        }
        this.squad.setPosition(this.squadX, 0, this.cfg.playerZ);
        const motion = this.squadX - previous;
        // 参考 C_Role.move：位移 = (目标 - 当前) × 5 × dt。
        const k = dt > 0 ? Math.min(1, dt * 5) : 1;
        for (let i = 0; i < this.soldiers.length; i++) {
            const actor = this.soldiers[i];
            if (actor.dead) continue; // 死亡成员占住原槽位，销毁之后才补位。
            this.formationSlot(i, this.temp);
            // 新兵从圆心出生后平滑滑到自己的槽位；队形扩张时老兵也同样跟随。
            const p = actor.node.position;
            actor.node.setPosition(p.x + (this.temp.x - p.x) * k, 0.025, p.z + (this.temp.z - p.z) * k);
            actor.play(Math.abs(motion) < 0.006 ? 'shoot' : motion < 0 ? 'left' : 'right');
        }
    }

    /** 与 Google 参考相同的中心 1 人＋外围 8 人固定槽位。 */
    private formationSlot(index: number, out: Vec3) {
        const p = formationPosition(index, this.cfg.soldierSpacing, this.cfg.formationDepthRatio);
        return out.set(p.x, 0.025, p.z);
    }

    /** 队伍顶部附近的随机世界坐标，用于 +1 等飘字。 */
    private squadTop(out: Vec3) {
        const ring = this.soldiers.length > 1 ? Math.ceil((this.soldiers.length - 1) / 6) : 0;
        const r = Math.max(0.25, ring * this.cfg.soldierSpacing * 0.8);
        return out.set(this.squadX + (Math.random() * 2 - 1) * r, 1.05 + Math.random() * 0.45,
            this.cfg.playerZ + (Math.random() * 2 - 1) * r * 0.5);
    }

    private addSoldier(fromCenter = true) {
        if (this.liveSoldiers.length >= this.squadCapacity) return;
        const actor = this.takeActor(`soldier${this.level}`);
        actor.node.parent = this.squad;
        // 士兵模型正面是 +Z，敌人在道路前方 -Z；三种等级统一面向敌人。
        actor.node.setRotationFromEuler(0, 180, 0);
        actor.level = this.level; actor.hp = 1; actor.boss = false;
        // 固定错开初始枪声，不每枪随机；第一名立即射击，后续成员分布在一个周期内。
        actor.shotDelay = (this.soldiers.length * 0.618033988749895) % 1;
        this.soldiers.push(actor); actor.play('shoot');
        // 增兵从圆心弹出再滑到槽位；开局直接按配置大小站在槽位，不播放缩放回弹。
        if (fromCenter) actor.node.setPosition(this.liveSoldiers.find(a => a !== actor)?.node.position ?? new Vec3(0, 0.025, 0));
        else actor.node.setPosition(this.formationSlot(this.soldiers.length - 1, this.temp));
        if (fromCenter) this.liveSoldiers.forEach(a => a.startSpawn());
        if (!fromCenter) this.updateSquad(0);
        if (this.liveSoldiers.length >= this.squadCapacity) this.showMax();
    }

    private showMax() {
        this.fullGateCount = 0;
        this.reachedMax = true;
        this.hud.toast('MAX · SQUAD FULL!', undefined, this.squadTop(new Vec3()));
    }

    private upgrade(target: number) {
        const next = Math.min(3, Math.max(this.level, target));
        if (next === this.level) return;
        this.level = next;
        this.soldiers = this.soldiers.map(old => {
            if (old.dead) return old;
            const p = old.node.position.clone();
            const shotDelay = old.shotDelay;
            this.recycleActor(old);
            const actor = this.takeActor(`soldier${this.level}`);
            actor.node.parent = this.squad; actor.node.setPosition(p);
            actor.node.setRotationFromEuler(0, 180, 0);
            actor.level = this.level; actor.hp = 1; actor.boss = false;
            actor.shotDelay = shotDelay; // 换模保留射击进度，不重新全队齐射。
            actor.play('shoot'); actor.startSpawn();
            return actor;
        });
        this.playUpgradeEffect();
        this.hud.toast('TROOP UPGRADE!', undefined, this.squadTop(new Vec3()));
        this.node.emit('digit-gate:upgrade', this.level);
    }

    private takeActor(key: string) {
        let pool = this.actorPool.get(key);
        if (!pool) { pool = []; this.actorPool.set(key, pool); }
        let actor = pool.pop();
        if (!actor) {
            const wrapper = new Node(key); this.world.addChild(wrapper);
            actor = wrapper.addComponent(DigitGateActor);
            actor.poolKey = key;
            let model: Node; let scale: number;
            if (key.startsWith('soldier')) {
                const level = Number(key.slice(-1));
                model = instantiate(this.soldierPrefabs[level - 1]);
                scale = this.cfg.levelScale[level - 1];
            } else {
                model = instantiate(key === 'enemy' ? this.enemyPrefab : this.bossPrefabs[key === 'boss1' ? 0 : 1]);
                scale = key === 'enemy' ? this.cfg.enemyScale : 1;
            }
            model.parent = wrapper;
            model.setPosition(0, 0, 0); model.active = true;
            actor.prepare(model, scale, this.material('hit-white', true));
        }
        actor.node.parent = this.world;
        actor.reset();
        actor.deathSettings = this.cfg.death[key];
        actor.hitFlashSeconds = this.cfg.effects.hitFlashSeconds;
        return actor;
    }

    private recycleActor(actor: DigitGateActor) {
        const badge = this.hpBadges.get(actor);
        if (badge) { badge.node.active = false; badge.node.setRotation(badge.rotation); }
        this.hpBadges.delete(actor);
        actor.pause(); actor.node.active = false; actor.node.parent = this.reserve;
        const pool = this.actorPool.get(actor.poolKey) ?? [];
        if (pool.indexOf(actor) < 0) pool.push(actor);
        this.actorPool.set(actor.poolKey, pool);
    }

    private enemyRoutes = new WeakMap<DigitGateActor, { distance: number; offset: number }>();

    private placeRoadEnemy(actor: DigitGateActor, z: number, offset: number, y: number) {
        const path = this.cfg.paths.obstacles, p = routePosition(path, z, offset);
        this.enemyRoutes.set(actor, { distance: routeDistance(path, z), offset });
        actor.node.setPosition(p.x, y, p.z);
        actor.node.setRotationFromEuler(0, routeYaw(path, z), 0);
    }

    private advanceRoadEnemy(actor: DigitGateActor, dt: number) {
        const path = this.cfg.paths.obstacles, state = this.enemyRoutes.get(actor);
        if (!state) return;
        state.distance += actor.speed * dt;
        const z = routeZ(path, state.distance), p = routePosition(path, z, state.offset);
        actor.node.setPosition(p.x, actor.node.position.y, p.z);
        actor.node.setRotationFromEuler(0, routeYaw(path, z), 0);
    }

    private spawnEnemyArea() {
        for (const p of enemyPositions(this.cfg.enemyArea)) {
            const actor = this.takeActor('enemy');
            this.placeRoadEnemy(actor, p.z, p.x, .025);
            actor.hp = actor.maxHp = this.cfg.enemyHp;
            actor.radius = this.cfg.enemyScale * .16; actor.speed = this.cfg.enemySpeed;
            actor.boss = false; actor.finalBoss = false;
            actor.play('move'); this.enemies.push(actor);
            // 普通丧尸出生时隐藏血条，受伤后才显示，仍不显示数字。
            const badge = this.hud.prefabBadge(actor.model!, '');
            badge.node.active = false;
            this.hpBadges.set(actor, badge);
        }
    }

    private spawnBoss(wave: BossWave) {
        const actor = this.takeActor(wave.style === 2 ? 'boss2' : 'boss1');
        actor.setModelScale(wave.scale);
        this.placeRoadEnemy(actor, wave.startZ, 0, .04);
        actor.hp = actor.maxHp = wave.hp;
        actor.radius = wave.scale * (wave.style === 2 ? .625 : .73);
        actor.speed = wave.speed; actor.boss = true; actor.finalBoss = !!wave.final;
        actor.play('move'); this.enemies.push(actor);
        const badge = this.hud.prefabBadge(actor.model!, String(wave.hp));
        badge.node.active = true;
        this.hpBadges.set(actor, badge);
    }

    private enemyDefenseTargets = new WeakMap<DigitGateActor, BuiltDefense>();

    private updateEnemies(dt: number) {
        if (this.phase !== 'playing') return;
        const soldiers = this.liveSoldiers;
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < soldiers.length; i++) {
            const p = this.soldierPositions[i] ?? (this.soldierPositions[i] = new Vec3());
            this.world.inverseTransformPoint(p, soldiers[i].node.worldPosition);
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        const defenses = this.coinMode ? this.coinBuild!.liveDefenses : [];
        for (const d of defenses) {
            const p = d.node.position;
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        }
        for (const actor of this.enemies) {
            if (actor.dead) continue;
            actor.attackTimer = Math.max(0, actor.attackTimer - dt);
            if (actor.attacking) continue; // 出手后锁定朝向，玩家可移出命中区域。
            const rule = actor.boss ? this.cfg.bossCombat : this.cfg.enemyCombat;
            const p = actor.node.position;
            // 明显在追踪区外的敌人只直行；不做无意义的逐个寻敌、开方和坐标变换。
            const chase = rule.chaseDistance;
            if (!actor.chasing && (p.x < minX - chase || p.x > maxX + chase || p.z < minZ - chase || p.z > maxZ + chase)) {
                actor.play('move'); this.advanceRoadEnemy(actor, dt);
                continue;
            }
            let distanceSquared = Infinity, dx = 0, dz = 1;
            for (let i = 0; i < soldiers.length; i++) {
                const target = this.soldierPositions[i];
                const x = target.x - p.x, z = target.z - p.z, d = x * x + z * z;
                if (d < distanceSquared) { distanceSquared = d; dx = x; dz = z; }
            }
            let defenseTarget: BuiltDefense | null = null;
            for (const defense of defenses) {
                const target = defense.node.position, x = target.x - p.x, z = target.z - p.z, d = x*x + z*z;
                if (d < distanceSquared) { distanceSquared = d; dx = x; dz = z; defenseTarget = defense; }
            }
            const distance = Math.sqrt(distanceSquared), attackDistance = rule.attackDistance + (defenseTarget ? .45 : 0);
            if (distance <= rule.chaseDistance) actor.chasing = true;
            if (actor.chasing && distance > 0.001) actor.node.setRotationFromEuler(0, Math.atan2(dx, dz) * 180 / Math.PI, 0);
            // 移动恰好停在攻击边界时，坐标运算可能留下极小正误差。
            // 容许 1 毫米误差，避免静止目标前反复尝试零距离移动却不出手。
            if (actor.chasing && distance <= attackDistance + .001) {
                if (defenseTarget) this.enemyDefenseTargets.set(actor, defenseTarget);
                else this.enemyDefenseTargets.delete(actor);
                actor.startAttack(rule.attackInterval, () => this.enemyAttackHit(actor));
                continue;
            }
            const step = actor.speed * dt;
            actor.play('move');
            if (actor.chasing && distance > 0.001) {
                const travel = Math.min(step, Math.max(0, distance - attackDistance));
                actor.node.setPosition(p.x + dx / distance * travel, p.y, p.z + dz / distance * travel);
            } else this.advanceRoadEnemy(actor, dt);
        }
    }

    /** 唯一的敌人伤害入口：由 Attack 动画的 attackHit 事件帧调用。 */
    private enemyAttackHit(actor: DigitGateActor) {
        if (this.phase !== 'playing' || this.backgroundPaused || actor.dead || this.enemies.indexOf(actor) < 0) return;
        const rule = actor.boss ? this.cfg.bossCombat : this.cfg.enemyCombat;
        const p = actor.node.position;
        const yaw = actor.node.eulerAngles.y * Math.PI / 180, fx = Math.sin(yaw), fz = Math.cos(yaw);
        const defense = this.enemyDefenseTargets.get(actor);
        if (defense) {
            this.enemyDefenseTargets.delete(actor);
            if (defense.alive && Vec3.distance(p, defense.node.position) <= rule.attackDistance + .95) {
                const point = defense.node.position.clone();
                this.coinBuild?.destroyDefense(defense);
                if (actor.boss) this.playHitEffect(this.bossAttackEffects, this.bossAttackEffectPrefab, point, new Color(255, 105, 22));
            }
            return;
        }
        if (actor.boss) {
            // Boss 的攻击动作完成即为全屏处决，不再受主角横向躲避影响。
            // 爆炸仍落在攻击方向的地面点，负责表现，不重复结算伤害。
            this.liveSoldiers.slice().forEach(soldier => this.killSoldier(soldier));
        } else for (const soldier of this.liveSoldiers) {
            this.world.inverseTransformPoint(this.temp, soldier.node.worldPosition);
            const dx = this.temp.x - p.x, dz = this.temp.z - p.z;
            if (dx * fx + dz * fz >= 0 && Math.hypot(dx - fx * rule.attackDistance, dz - fz * rule.attackDistance) <= rule.attackRadius + soldier.radius) this.killSoldier(soldier);
        }
        const impact = new Vec3(p.x + fx * rule.attackDistance, 0.045, p.z + fz * rule.attackDistance);
        if (actor.boss) this.playHitEffect(this.bossAttackEffects, this.bossAttackEffectPrefab, impact, new Color(255, 87, 12));
    }

    private loseSoldiers(count: number) {
        const victims = this.liveSoldiers.slice(-count);
        victims.forEach(actor => this.killSoldier(actor));
        if (victims.length) this.hud.toast(`-${victims.length}`, new Color(255, 101, 88), this.squadTop(new Vec3()), 40);
    }

    private killSoldier(actor: DigitGateActor) {
        if (actor.dead) return;
        this.fullGateCount = 0;
        const worldPosition = actor.node.worldPosition.clone();
        const worldRotation = actor.node.worldRotation.clone();
        actor.node.parent = this.world;
        actor.node.setWorldPosition(worldPosition); actor.node.setWorldRotation(worldRotation);
        actor.kill(); this.dying.push(actor);
        this.node.emit('digit-gate:soldier-dying', { id: actor.node.uuid, position: worldPosition });
        if (!this.liveSoldiers.length) this.finish(false);
    }

    private removeEnemy(index: number, killed: boolean) {
        const actor = this.enemies[index];
        if (!actor) return;
        this.enemies.splice(index, 1);
        // 普通丧尸即使被第一枪秒杀，也先显示扣空过程；Boss 沿用死亡即隐藏。
        if (actor.boss) {
            const badge = this.hpBadges.get(actor)!;
            badge.node.active = false; badge.node.setRotation(badge.rotation);
            this.hpBadges.delete(actor);
        }
        actor.kill(); this.dying.push(actor);
        if (killed) {
            this.kills++;
            if (actor.boss) this.burst(actor.node.worldPosition, 'gold', 20);
            if (actor.boss) {
                if (!this.enemies.some(enemy => enemy.boss && !enemy.dead) && this.finalBossDeathSound) {
                    this.effectsAudio.playOneShot(this.finalBossDeathSound, this.finalBossDeathVolume);
                } else this.sound(2, 0.7);
            }
        }
    }

    private updateDying(dt: number) {
        for (let i = this.dying.length - 1; i >= 0; i--) if (this.dying[i].tickDeath(dt)) {
            const actor = this.dying[i];
            if (actor.poolKey.startsWith('soldier')) {
                const slot = this.soldiers.indexOf(actor);
                if (slot >= 0) this.soldiers.splice(slot, 1);
                actor.node.destroy();
                this.node.emit('digit-gate:soldier-removed', { slot });
            } else this.recycleActor(actor);
            this.dying.splice(i, 1);
        }
    }

    private path(side: number) { return side > 0 ? this.cfg.paths.gates : side < 0 ? this.cfg.paths.rewards : this.cfg.paths.obstacles; }
    private laneX(z: number, side: number) { return routeX(this.path(side), z); }

    /** 让物体朝向自身行进方向：偏航对齐路径切线，再按横向速度向移动侧轻微倾斜。 */
    private faceTravel(node: Node, z: number, side: number) {
        if (side > 0 || node.getComponent(DigitGateBarrel) || node.getComponent(DigitGateRock)) {
            node.setRotationFromEuler(0, routeYaw(this.path(side), z), 0); return;
        }
        const dx = (this.laneX(z + 0.01, side) - this.laneX(z - 0.01, side)) / 0.02;
        const yaw = Math.atan2(dx, 1) * 180 / Math.PI;
        node.setRotationFromEuler(4, yaw, -dx * 14);
    }

    private spawnGate(z: number, side: GateSide = 1) {
        const rule = gateRule(this.cfg, side), label = gateLabel(rule.operation, rule.value);
        const node = instantiate(this.gatePrefab); node.name = `${side < 0 ? '左侧' : '右侧'}变量门 ${label}`; this.world.addChild(node);
        node.setPosition(this.laneX(z, side), 0.02, z);
        node.setRotationFromEuler(0, routeYaw(this.path(side), z), 0);
        const badge = this.hud.prefabBadge(node, label);
        this.gates.push({ node, badge, z, side, released: false });
    }

    private updateGates(dt: number) {
        if (!this.coinMode) this.updateGateLane(dt, 1);
        if (this.cfg.leftGateCycle?.enabled || this.coinMode) this.updateGateLane(dt, -1);
    }

    private updateGateLane(dt: number, side: GateSide) {
        if (this.coinMode && side > 0) return;
        const left = side < 0;
        const barrier = this.rewards.find(r => r.kind === 'plane' && r.node.position.y <= 0.05);
        if (!left && barrier && !barrier.gatesMarked) this.markBarrierGates(barrier, side);
        const blocked = () => left ? this.leftGatePhase !== 'moving' : !!barrier;
        const wasBlocked = blocked();
        const path = this.path(side), travel = (left ? this.cfg.leftGateCycle.gateSpeed : this.cfg.gateSpeed) * dt;
        for (let i = this.gates.length - 1; i >= 0; i--) {
            const g = this.gates[i];
            if (g.side !== side) continue;
            // 新阻挡仅冻结后方队列；已放行及正在通过占位区的门继续前进。
            if (blocked() && !g.released) continue;
            g.z = routeZ(path, routeDistance(path, g.z) + travel);
            g.node.setPosition(this.laneX(g.z, side), 0.02, g.z);
            g.node.setRotationFromEuler(0, routeYaw(path, g.z), 0);
            if (g.z >= this.cfg.playerZ - 0.35 && g.z <= this.cfg.playerZ + 1.5
                && Math.abs(this.squadX - this.laneX(g.z, side)) < 1.15) {
                const before = this.liveSoldiers.length;
                const rule = gateRule(this.cfg, side);
                const after = gateCount(before, rule.operation, rule.value, this.squadCapacity);
                if (after < before) this.loseSoldiers(before - after);
                else for (let n = before; n < after; n++) this.addSoldier();
                // 满员后左右共计每吸收两扇增兵门播放一次 MAX。
                if (before >= this.squadCapacity
                    && (rule.operation === 'add' || rule.operation === 'multiply' && rule.value > 1)) {
                    if (++this.fullGateCount >= 2) this.showMax();
                }
                this.sound(2, 0.35);
                if (after > before) this.hud.toast(`+${this.liveSoldiers.length - before}`, new Color(124, 250, 225), this.squadTop(new Vec3()), 40);
                this.playGateEffect();
                g.node.destroy(); this.gates.splice(i, 1);
                // 按实际通过的左侧门计数；满员时通过也算，漏掉的门不算。
                if (!this.coinMode && left && this.leftGatePhase === 'moving' && this.rewardIndex < this.cfg.rewards.length && this.phase === 'playing') {
                    this.leftGatesCollected++;
                    if (this.leftGatesCollected >= this.cfg.leftGateCycle.gatesPerReward) {
                        this.spawnLeftReward(true);
                    }
                }
            } else if (g.z > this.cfg.playerZ + 2 + 1e-8) { g.node.destroy(); this.gates.splice(i, 1); }
        }
        // 阻挡时连生成相位一起冻结，解除后不会堆门或留下接缝。
        if (!wasBlocked) {
            let next = (left ? this.nextLeftGateDistance : this.nextGateDistance) + travel;
            const start = routeDistance(path, Math.max(this.cfg.gateLayout.spawnZ, path[0].z));
            while (next >= start - 1e-8) {
                const z = routeZ(path, next);
                if (z <= this.cfg.playerZ + 2 + 1e-8) this.spawnGate(z, side);
                next -= this.cfg.gateLayout.spacing;
            }
            if (left) this.nextLeftGateDistance = next;
            else this.nextGateDistance = next;
        }
    }

    private spawnLeftReward(rise: boolean) {
        const wave = this.cfg.rewards[this.rewardIndex];
        if (!wave) return; // 最后一份领取后继续放行，不再生成奖励。
        this.rewardIndex++;
        this.leftGatesCollected = 0;
        this.leftGatePhase = 'blocked';
        const reward = this.spawnReward({ ...wave, startZ: this.cfg.leftGateCycle.rewardZ, speed: 0 });
        reward.leftBarrier = true;
        if (rise) {
            reward.riseAge = 0;
            reward.node.setPosition(reward.node.position.x, reward.rock?.buriedY ?? -1.4, reward.z);
            reward.badge.node.active = false;
            if (reward.badge.icon) reward.badge.icon.active = false;
        }
        this.markBarrierGates(reward, -1);
    }

    /** 保留所有门；阻挡出现时已在前方或跨进占位区的门获得通行标记。 */
    private markBarrierGates(reward: Reward, side: GateSide) {
        const center = this.rewardPosition(reward, new Vec3());
        for (const g of this.gates) {
            if (g.side !== side) continue;
            g.released = g.z >= center.z || footprintsOverlap(
                { x: g.node.position.x, z: g.z, width: 1.19, depth: .09, yaw: g.node.eulerAngles.y },
                { x: center.x, z: center.z, width: reward.width, depth: reward.depth, yaw: reward.node.eulerAngles.y });
        }
        reward.gatesMarked = true;
    }

    private spawnReward(wave: RewardWave, startGrounded = false) {
        const node = instantiate(wave.kind === 'obstacle' ? this.obstacleBoxPrefab : this.rewardBoxPrefab);
        node.name = wave.kind === 'obstacle' ? '可破坏障碍物' : wave.kind === 'plane' ? '飞机奖励物' : wave.kind === 'soldier' ? '兵种升级奖励物' : '火力强化奖励物';
        const barrel = node.getComponent(DigitGateBarrel);
        const rock = node.getComponent(DigitGateRock);
        this.world.addChild(node);
        const z = wave.kind === 'plane' ? this.cfg.planePosition?.z ?? 7.8 : wave.startZ ?? -13;
        const plane = wave.kind === 'plane';
        const side = wave.kind === 'obstacle' ? 0 : -1;
        const width = wave.width ?? 1.35, depth = wave.depth ?? 0.9;
        // 只拉伸箱体网格；数字和独立图标保留预制体尺寸，不随窄箱子压扁。
        node.children.forEach(child => {
            if (child.getComponentInChildren(MeshRenderer)) {
                child.setScale(child.scale.x * width / 1.35, child.scale.y * (barrel ? depth / 0.9 : 1), child.scale.z * depth / 0.9);
                if (barrel) child.setPosition(child.position.x, child.position.y * depth / 0.9, child.position.z);
            }
            child.setPosition(child.position.x * width / 1.35, child.position.y, child.position.z * depth / 0.9);
        });
        // 开场右侧障碍直接显示在地面；其他落下方式保留落地前保护。
        const dropping = plane && !startGrounded;
        node.setPosition(plane ? this.cfg.planePosition?.x ?? routeX(this.cfg.paths.gates, z) : this.laneX(z, side), dropping ? 7 : 0.02, z);
        if (!plane) this.faceTravel(node, z, side);
        const iconIndex = wave.kind === 'plane' ? 3 : wave.kind === 'soldier' ? 2 : this.power > 1.4 ? 1 : 0;
        const iconId = plane ? this.cfg.planeIcon : wave.icon;
        const iconTransform = plane ? this.cfg.planeIconTransform : wave.iconTransform;
        const customIcon = iconId && [...this.rewardIconTextures, ...this.textures].find(t => t?.uuid === iconId);
        const badge = this.hud.rewardBadge(node, wave.hp, wave.kind === 'obstacle' ? null : customIcon || this.textures[iconIndex], iconTransform);
        if (badge.icon) badge.icon.setScale(badge.icon.scale.clone().multiplyScalar((plane ? this.cfg.planeIconScale : wave.iconScale) ?? 1));
        if (plane) {
            const sprite = node.getComponentInChildren(Sprite)!;
            // 流光按图标自身 0~1 UV 扫过，不参与动态合图，避免亮带偏到其他图块。
            sprite.spriteFrame!.packable = false;
            sprite.customMaterial = rock?.planeIconMaterial ?? barrel!.planeIconMaterial;
        }
        if (dropping) { badge.node.active = false; badge.icon!.active = false; }
        if (rock) rock.setup(this.cfg.rewardStone, wave.layers ?? 3, width, depth, badge.node, badge.icon, burst => this.stoneBursts.push(burst), iconTransform?.offset);
        const reward: Reward = { node, badge, barrel, rock, z, hp: wave.hp, maxHp: wave.hp, kind: wave.kind,
            power: wave.power ?? 0, speed: wave.speed ?? this.cfg.rewardSpeed,
            width: rock?.collisionWidth ?? width, depth: rock?.collisionDepth ?? depth, hit: 0, dropAge: dropping ? 0 : undefined };
        this.rewards.push(reward);
        return reward;
    }

    private static readonly DROP_TIME = 0.55;

    private rewardPosition(reward: Reward, out: Vec3) {
        return reward.rock ? this.world.inverseTransformPoint(out, reward.rock.bodyPosition) : out.set(reward.node.position);
    }

    private updateRewards(dt: number) {
        for (let i = this.rewards.length - 1; i >= 0; i--) {
            const r = this.rewards[i];
            r.rock?.tick(dt);
            if (r.riseAge !== undefined) { this.tickRise(r, dt); continue; }
            if (r.kind !== 'plane') {
                const side = r.kind === 'obstacle' ? 0 : -1;
                const oldX = r.node.position.x, oldZ = r.z;
                r.z += dt * r.speed;
                r.node.setPosition(this.laneX(r.z, side), 0.02, r.z);
                this.faceTravel(r.node, r.z, side);
                if (!r.rock) r.barrel?.roll(Math.hypot(r.node.position.x - oldX, r.z - oldZ), r.depth / 2);
            } else if (r.dropAge !== undefined) this.tickDrop(r, dt);
            r.hit = Math.max(0, r.hit - dt);
            if (r.dropAge === undefined && !r.rock) { const scale = 1 + r.hit * 0.65; r.node.setScale(scale, scale, scale); }
            if (r.node.position.y <= 0.05 && this.phase === 'playing') {
                const yaw = r.node.eulerAngles.y * Math.PI / 180;
                for (const actor of this.liveSoldiers) {
                    const p = actor.node.worldPosition, center = r.rock?.bodyPosition ?? r.node.worldPosition;
                    const dx = p.x - center.x, dz = p.z - center.z;
                    const x = dx * Math.cos(yaw) - dz * Math.sin(yaw);
                    const z = dx * Math.sin(yaw) + dz * Math.cos(yaw);
                    if (Math.abs(x) <= r.width / 2 + actor.radius && Math.abs(z) <= r.depth / 2 + actor.radius) this.killSoldier(actor);
                }
            }
            if (r.z > this.cfg.playerZ + 3) {
                if (r.kind === 'soldier') this.hud.toast('UPGRADE MISSED!', new Color(255, 197, 112), this.squadTop(new Vec3()));
                r.node.destroy(); this.rewards.splice(i, 1);
            }
        }
    }

    /** 地面下平滑升起；完成后才显示数字、接受命中与碰撞。 */
    private tickRise(r: Reward, dt: number) {
        r.riseAge = r.riseAge! + dt;
        const t = Math.min(1, r.riseAge / this.cfg.leftGateCycle.riseSeconds);
        const eased = t * t * (3 - 2 * t);
        const startY = r.rock?.buriedY ?? -1.4;
        r.node.setPosition(r.node.position.x, startY + (0.02 - startY) * eased, r.z);
        if (t < 1) return;
        r.node.setPosition(r.node.position.x, 0.02, r.z);
        r.riseAge = undefined;
        r.badge.node.active = true;
        if (r.badge.icon) r.badge.icon.active = true;
        this.burst(new Vec3(r.node.position.x, 0.2, r.z), 'gold', 14);
        this.shakeCamera(this.cfg.effects.landingShakeStrength, this.cfg.effects.landingShakeSeconds);
    }

    /** 加速下落 → 落地压扁 → 回弹，落地瞬间扬尘。 */
    private tickDrop(r: Reward, dt: number) {
        const age = (r.dropAge = r.dropAge! + dt);
        const fall = DigitGateGame.DROP_TIME;
        const p = r.node.position;
        if (age < fall) {
            const t = age / fall;
            r.node.setPosition(p.x, 0.02 + 7 * (1 - t * t), r.z);
            r.node.setScale(0.9, 1.12, 0.9);
            return;
        }
        if (p.y > 0.02) {
            r.node.setPosition(p.x, 0.02, r.z);
            this.updateGates(0);
            r.badge.node.active = true;
            r.badge.icon!.active = true;
            this.burst(new Vec3(p.x, 0.2, r.z), 'gold', 14);
            this.sound(5, 0.6);
            this.shakeCamera(this.cfg.effects.landingShakeStrength, this.cfg.effects.landingShakeSeconds);
        }
        const t = Math.min(1, (age - fall) / 0.35);
        const squash = Math.sin(t * Math.PI * 2.5) * (1 - t) * 0.28;
        r.node.setScale(1 + squash, 1 - squash, 1 + squash);
        if (t >= 1) { r.node.setScale(1, 1, 1); r.dropAge = undefined; }
    }

    private hitReward(index: number, damage: number) {
        const r = this.rewards[index];
        if (!r || r.riseAge !== undefined) return;
        r.hp = Math.max(0, r.hp - damage); r.hit = 0.15;
        this.hud.setBadgeValue(r.badge, r.hp);
        r.rock?.hit(r.hp, r.maxHp);
        if (!r.rock) this.burst(r.node.worldPosition, 'gold', 2);
        if (this.elapsed - this.lastHitSound > 0.13) { this.sound(5, 0.3); this.lastHitSound = this.elapsed; }
        if (r.hp > 0) return;
        if (r.leftBarrier) this.leftGatePhase = 'collecting';
        if (!r.rock) this.burst(r.node.worldPosition, 'gold', 16);
        if (r.kind !== 'plane' && r.kind !== 'obstacle') {
            this.hud.flyReward(r.node, this.squad, () => {
                if (this.phase === 'playing' && this.liveSoldiers.length) this.collectReward(r);
            });
        }
        r.node.destroy(); this.rewards.splice(index, 1);
        if (r.kind === 'plane') this.collectReward(r);
    }

    /** 奖励图标抵达队伍后才生效；未打破的奖励物仍是致命障碍。 */
    private collectReward(r: Reward) {
        if (r.collected || r.kind === 'obstacle') return;
        r.collected = true;
        if (r.leftBarrier) { this.leftGatesCollected = 0; this.leftGatePhase = 'moving'; }
        this.sound(2, 0.7);
        this.shakeCamera(this.cfg.effects.rewardShakeStrength, this.cfg.effects.rewardShakeSeconds);
        this.squadCapacity += 3;
        this.reachedMax = false;
        this.fullGateCount = 0;
        if (r.kind === 'weapon') {
            this.power += r.power;
            this.playUpgradeEffect();
            this.hud.toast('FIRE RATE UP!', undefined, this.squadTop(new Vec3()));
        }
        else if (r.kind === 'soldier') this.upgrade(this.level + 1);
        else if (r.kind === 'plane') this.hud.toast('AIRCRAFT UNLOCKED!', undefined, this.squadTop(new Vec3()));
        this.node.emit('digit-gate:reward', { kind: r.kind, level: this.level, power: this.power, fireInterval: this.fireInterval, maxSoldiers: this.squadCapacity });
    }

    private updateShooting(dt: number) {
        const progress = dt / this.fireInterval;
        for (const actor of this.soldiers) {
            if (actor.dead) continue;
            actor.shotDelay -= progress;
            if (actor.shotDelay > 0) continue;
            // 保留帧内余量，避免越射越同步；卡顿时不在一帧补发一串子弹。
            actor.shotDelay += Math.floor(-actor.shotDelay) + 1;
            this.fire(actor);
        }
    }

    private fire(actor: DigitGateActor) {
        if (actor.dead || this.bullets.length >= 340) return;
        // 子弹颜色只随兵种等级变化，攻速奖励不改色。
        const color = this.level === 3 ? 'red' : this.level === 2 ? 'purple' : 'blue';
        const damage = this.cfg.baseDamage * this.cfg.levelDamage[this.level - 1];
        const p = actor.node.worldPosition;
        const node = this.bulletPool.pop() ?? instantiate(this.bulletPrefab);
        node.parent = this.world; node.active = true;
        node.getComponentInChildren(MeshRenderer)!.setSharedMaterial(this.bulletMaterial(color), 0);
        // 图片由当前俯角渲染，四边形面向镜头；不改变子弹轨迹和碰撞。
        node.setWorldRotation(this.camera.node.worldRotation);
        Vec3.multiplyScalar(this.temp, this.bulletPrefab.data.scale, this.cfg.effects.bulletScale);
        node.setScale(this.temp);
        node.setPosition(p.x, 0.52, p.z - 0.36);
        this.bullets.push({ node, x: p.x, z: p.z - 0.36, damage, life: this.cfg.bulletLifetime, color });
        if (this.elapsed - this.lastShotSound > 0.15) { this.sound(1, 0.16); this.lastShotSound = this.elapsed; }
    }

    private updateBullets(dt: number) {
        if (!this.bullets.length) return;
        // 同帧只排序一次，子弹用二分找到扫过的纵向区间，不再逐颗扫描全场。
        const targets = this.bulletTargets;
        targets.length = 0;
        let maxRadius = 0;
        for (const actor of this.enemies) { targets.push(actor); maxRadius = Math.max(maxRadius, actor.radius); }
        targets.sort((a, b) => b.node.position.z - a.node.position.z);
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i]; const oldZ = b.z;
            b.life -= dt;
            if (b.life <= 0) {
                this.bullets.splice(i, 1);
                this.recyclePrimitive(b.node, this.bulletPool);
                continue;
            }
            b.z -= this.cfg.bulletSpeed * dt;
            let closestZ = -Infinity; let enemy: DigitGateActor | null = null; let rewardIndex = -1; let coinObstacle = false;
            let low = 0, high = targets.length;
            while (low < high) {
                const mid = (low + high) >>> 1;
                if (targets[mid].node.position.z > oldZ + maxRadius) low = mid + 1; else high = mid;
            }
            for (let j = low; j < targets.length; j++) {
                const a = targets[j]; const p = a.node.position;
                if (p.z < b.z - maxRadius) break;
                if (a.dead) continue;
                if (Math.abs(b.x - p.x) <= a.radius && p.z + a.radius >= b.z && p.z - a.radius <= oldZ && p.z > closestZ) {
                    closestZ = p.z; enemy = a; rewardIndex = -1;
                }
            }
            for (let j = 0; j < this.rewards.length; j++) {
                const r = this.rewards[j]; const p = this.rewardPosition(r, this.temp);
                if (r.node.position.y > 0.05 || r.riseAge !== undefined) continue;
                if (Math.abs(b.x - p.x) <= r.width / 2 && p.z + r.depth / 2 >= b.z && p.z - r.depth / 2 <= oldZ && p.z > closestZ) {
                    closestZ = p.z; rewardIndex = j; enemy = null;
                }
            }
            const coinZ = this.coinMode ? this.coinBuild!.obstacleHitZ(b.x, oldZ, b.z) : null;
            if (coinZ !== null && coinZ > closestZ) { closestZ = coinZ; enemy = null; rewardIndex = -1; coinObstacle = true; }
            if (!enemy && rewardIndex < 0 && !coinObstacle) {
                b.node.setPosition(b.x, 0.52, b.z);
                continue;
            }
            // 确认命中即移出飞行列表并回池，再处理伤害和奖励事件。
            // 即便事件触发结算或重玩，这颗子弹也不会再伤害、移动或重复入池。
            this.bullets.splice(i, 1);
            this.recyclePrimitive(b.node, this.bulletPool);
            const surfaceZ = closestZ + (enemy ? enemy.radius : coinObstacle ? .44 : this.rewards[rewardIndex].depth / 2);
            // 各类目标均播放命中 Shader；丧尸的旧蓝色散粒仍保持移除。
            this.playHitEffect(this.hitEffects, this.hitEffectPrefab,
                new Vec3(b.x, 0.52, Math.max(b.z, Math.min(oldZ, surfaceZ))),
                this.material(b.color, true).getProperty('mainColor') as Color);
            if (enemy) this.damageEnemy(enemy, b.damage);
            else if (coinObstacle) this.coinBuild!.damageObstacle(b.damage);
            else this.hitReward(rewardIndex, b.damage);
            if (this.phase !== 'playing') break;
        }
    }

    private damageEnemy(enemy: DigitGateActor, damage: number) {
        if (enemy.dead || this.enemies.indexOf(enemy) < 0) return;
        enemy.hp -= damage;
        if (enemy.boss) enemy.flashBossHit(); else enemy.flashHit();
        const badge = this.hpBadges.get(enemy);
        if (badge) this.hud.setBadgeValue(badge, enemy.hp, enemy.hp / enemy.maxHp);
        if (enemy.hp <= 0) this.removeEnemy(this.enemies.indexOf(enemy), true);
    }

    private updateBadges() {
        for (const r of this.rewards) {
            if (r.node.position.y > 0.05) {
                r.badge.node.active = false;
                if (r.badge.icon) r.badge.icon.active = false;
                continue;
            }
            r.badge.node.active = true;
            if (r.badge.icon) r.badge.icon.active = true;
            this.hud.updateBadgeValue(r.badge);
        }
        for (const [actor, badge] of this.hpBadges) {
            if (actor.dead && badge.currentRatio === 0) {
                badge.node.active = false; badge.node.setRotation(badge.rotation); this.hpBadges.delete(actor);
                continue;
            }
            if (!actor.boss && actor.hp >= actor.maxHp) {
                badge.node.active = false;
                continue;
            }
            badge.node.active = true;
            // 只抵消角色转身，不覆盖预制体里的位置、大小和文字样式。
            badge.node.setWorldRotation(badge.rotation);
            this.hud.updateBadgeValue(badge);
        }
    }

    private checkBattleEnd() {
        if (this.phase !== 'playing') return;
        // 丧尸与 Boss 均已在开场生成；同一帧双方清空时，我方全灭优先判负。
        if (!this.liveSoldiers.length) this.finish(false);
        else if (!this.enemies.length) this.finish(true);
    }

    private finish(win: boolean, plane = false) {
        if (this.phase !== 'playing') return;
        this.phase = win ? 'won' : 'lost';
        this.clearCameraShake();
        this.hud.finish(win);
        this.dragging = false; this.music.stop(); this.sound(win ? 3 : 4, 0.8);
        this.liveSoldiers.forEach(a => a.pause()); this.enemies.forEach(a => a.pause());
        this.node.emit('digit-gate:finished', { win, plane, level: this.level, seconds: this.elapsed, kills: this.kills });
    }

    retryLevel() {
        if (this.phase !== 'lost' && this.phase !== 'won') return;
        if (this.phase === 'won' || this.retriesUsed >= (this.cfg.retryLimit ?? 2)) { this.openStore(); return; }
        this.retriesUsed++;
        this.restart();
    }

    openStore() {
        this.node.emit('digit-gate:download');
        jumpToStore(this.cfg);
    }

    private sound(index: number, volume: number) {
        if (this.sounds[index]) this.effectsAudio.playOneShot(this.sounds[index], volume);
    }

    private material(key: string, unlit = false) {
        const id = key + (unlit ? '-unlit' : '');
        let m = this.materials.get(id); if (m) return m;
        const colors: Record<string, number[]> = {
            blue: [18, 158, 221], cyan: [44, 225, 255], yellow: [255, 239, 85],
            green: [106, 250, 98], purple: [208, 114, 255], gold: [248, 181, 54],
            bronze: [163, 89, 36], cream: [255, 230, 155], red: [222, 71, 69],
        };
        const rgb = colors[key] ?? [255, 255, 255];
        m = new Material(); m.initialize({ effectName: unlit ? 'builtin-unlit' : 'builtin-standard' });
        m.setProperty('mainColor', new Color(rgb[0], rgb[1], rgb[2]));
        if (!unlit) { m.setProperty('roughness', 0.8); m.setProperty('metallic', key === 'gold' ? 0.25 : 0); }
        this.materials.set(id, m); return m;
    }

    private bulletMaterial(color: string) {
        const key = 'bullet-' + color;
        let material = this.materials.get(key);
        if (!material) {
            material = new Material();
            material.copy(this.bulletPrefab.data.getComponentInChildren(MeshRenderer)!.sharedMaterials[0]!);
            material.setProperty('mainColor', this.material(color, true).getProperty('mainColor') as Color);
            const brightness = this.cfg.effects.bulletBrightness;
            material.setProperty('colorScale', new Vec3(brightness, brightness, brightness));
            this.materials.set(key, material);
        }
        return material;
    }

    private box(parent: Node, name: string, x: number, y: number, z: number, color: string) {
        const node = new Node(name); parent.addChild(node); node.setScale(x, y, z);
        const renderer = node.addComponent(MeshRenderer); renderer.mesh = this.boxMesh;
        renderer.setSharedMaterial(this.material(color, ['yellow', 'green', 'purple', 'cyan'].indexOf(color) >= 0), 0);
        return node;
    }

    private burst(position: Vec3, color: string, count: number) {
        for (let i = 0; i < count && this.sparks.length < 120; i++) {
            const node = this.sparkPool.pop() ?? this.box(this.world, '命中特效', 0.05, 0.05, 0.05, color);
            node.parent = this.world; node.active = true; node.setPosition(position.x, Math.max(0.35, position.y), position.z);
            node.setScale(0.05, 0.05, 0.05);
            node.getComponent(MeshRenderer)!.setSharedMaterial(this.material(color, true), 0);
            const angle = i / count * Math.PI * 2;
            this.sparks.push({ node, velocity: new Vec3(Math.cos(angle) * 1.6, 1.5 + Math.random(), Math.sin(angle) * 1.6), life: 0.45 + Math.random() * 0.2 });
        }
    }

    private playHitEffect(pool: DigitGateHitEffect[], prefab: Prefab, position: Vec3, color: Color, scale = 1, strength = 1, duration?: number) {
        let effect = pool.find(item => !item.node.active);
        if (!effect) {
            const node = instantiate(prefab);
            this.world.addChild(node);
            effect = node.getComponent(DigitGateHitEffect)!;
            pool.push(effect);
        }
        effect.node.setPosition(position);
        effect.play(color, scale, strength, duration);
    }

    private playUpgradeEffect() {
        let effect = this.upgradeEffects.find(item => !item.node.active);
        if (!effect) {
            const node = instantiate(this.upgradeEffectPrefab);
            this.squad.addChild(node);
            effect = node.getComponent(DigitGateUpgradeEffect)!;
            this.upgradeEffects.push(effect);
        }
        effect.node.setPosition(0, 0.04, 0);
        const color = new Color().fromHEX(this.cfg.effects.upgradeColors[this.level - 1]);
        effect.play(color,
            Math.max(1, Math.sqrt(this.liveSoldiers.length) * 0.45));
    }

    private playGateEffect() {
        let effect = this.gateEffects.find(item => !item.node.active);
        if (!effect) {
            const node = instantiate(this.gateEffectPrefab);
            this.squad.addChild(node);
            effect = node.getComponent(DigitGatePassEffect)!;
            this.gateEffects.push(effect);
        }
        const size = Math.max(0.7, Math.sqrt(this.liveSoldiers.length) * 0.45);
        effect.node.setPosition(0, 0.04, 0);
        effect.node.setScale(size, 1, size);
        effect.play();
    }

    private updateEffects(dt: number) {
        for (let i = this.stoneBursts.length - 1; i >= 0; i--) {
            if (this.stoneBursts[i].tick(dt)) { this.stoneBursts[i].node.destroy(); this.stoneBursts.splice(i, 1); }
        }
        for (let i = this.sparks.length - 1; i >= 0; i--) {
            const s = this.sparks[i]; s.life -= dt; s.velocity.y -= 5 * dt;
            const p = s.node.position;
            s.node.setPosition(p.x + s.velocity.x * dt, p.y + s.velocity.y * dt, p.z + s.velocity.z * dt);
            if (s.life <= 0) { this.recyclePrimitive(s.node, this.sparkPool); this.sparks.splice(i, 1); }
        }
    }
    private recyclePrimitive(node: Node, pool: Node[]) { node.active = false; node.parent = this.reserve; pool.push(node); }

    // 供关卡调试与自动化验收读取，返回的都是快照，外部不持有内部数组。
    getSnapshot() {
        return { phase: this.phase, elapsed: this.elapsed, level: this.level, power: this.power, fireInterval: this.cfg ? this.fireInterval : 0,
            soldiers: this.liveSoldiers.length, maxSoldiers: this.squadCapacity, reachedMax: this.reachedMax, x: this.squadX,
            formation: this.soldiers.map(a => ({ id: a.node.uuid, dead: a.dead, x: a.node.worldPosition.x, z: a.node.worldPosition.z, remaining: a.recycleTimer })),
            enemies: this.enemies.length, bullets: this.bullets.length, kills: this.kills,
            coinBuild: this.coinMode ? this.coinBuild!.snapshot() : null,
            bosses: this.enemies.filter(a => a.boss).map(a => ({ hp: a.hp, final: a.finalBoss, z: a.node.position.z })),
            gates: this.gates.map(g => ({ side: g.side < 0 ? 'left' : 'right', x: g.node.position.x, z: g.z, released: g.released })),
            leftGateCycle: { phase: this.leftGatePhase, collected: this.leftGatesCollected, rewardsSpawned: this.rewardIndex,
                rewardsTotal: this.cfg?.rewards.length ?? 0 },
            rewards: this.rewards.map(r => ({ kind: r.kind, hp: r.hp, x: r.node.position.x, z: r.z, layers: r.rock?.remainingLayers })) };
    }

    onDestroy() {
        this.listen(false); this.music?.stop();
        this.materials.forEach(material => material.destroy());
        this.boxMesh?.destroy();
    }
}
