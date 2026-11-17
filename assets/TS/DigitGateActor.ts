import { _decorator, Animation, AnimationClip, AnimationState, Color, Component, Material, MeshRenderer, Node } from 'cc';
import { BossAnimationBinder } from './BossAnimationBinder';
import { DigitGateAttackEvent } from './DigitGateAttackEvent';
import { DigitGateFrameRenderer } from './DigitGateFrameRenderer';
import { DeathSettings } from './DigitGateRules';

const { ccclass } = _decorator;
type ActorAction = 'shoot' | 'left' | 'right' | 'move' | 'attack' | 'death';
const ACTION_NAMES: Record<ActorAction, string[]> = {
    shoot: ['原地射击', 'Attack'],
    left: ['左移射击', '向左挪', '加特林左移射击'],
    right: ['右移射击', '向右挪', '加特林右移射击'],
    move: ['Run', 'Move', 'Walk', '走路'], attack: ['Attack'], death: ['死亡', 'Dead', 'Death'],
};

@ccclass('数字门角色')
export class DigitGateActor extends Component {
    animation: Animation | null = null;
    private frames: DigitGateFrameRenderer | null = null;
    model: Node | null = null;
    dead = false;
    hp = 1;
    maxHp = 1;
    radius = 0.24;
    speed = 1.5;
    attackTimer = 0;
    chasing = false;
    attacking = false;
    private pendingHit: (() => void) | null = null;
    level = 1;
    // 距离下一枪还剩多少个射击周期；只在入队时设偏移，之后按固定攻速循环。
    shotDelay = 0;
    boss = false;
    finalBoss = false;
    recycleTimer = 0;
    poolKey = '';
    deathSettings: DeathSettings = null!;
    hitFlashSeconds = 0;
    private clipName = '';
    private action: ActorAction | null = null;
    private actionClips: Partial<Record<ActorAction, AnimationClip | null>> = {};
    private baseScale = 1;
    private hitMaterial: Material | null = null;
    private originalMaterials: { renderer: MeshRenderer; materials: (Material | null)[] }[] = [];
    private bossFlashMaterials: { renderer: MeshRenderer; index: number; material: Material;
        colors: { name: string; base: Color; target: Color; current: Color }[] }[] = [];
    private showingBossHit = false;
    private bossHitCooldown = 0;
    private showingHit = false;
    private hitTimer = 0;
    private fallBackDeath = false;
    private deathDuration = 0;
    private spawnAge = -1;
    private static readonly SPAWN_TIME = 0.45;

    get modelScale() { return this.baseScale; }

    setModelScale(scale: number) {
        this.baseScale = scale;
        this.model!.setScale(scale, scale, scale);
    }

    prepare(model: Node, scale: number, hitMaterial: Material | null = null) {
        this.model = model;
        this.setModelScale(scale);
        // 场景样板可能已有朝向；游戏单位统一交给外层 actor 控制，避免叠加旋转。
        model.setRotationFromEuler(0, 0, 0);
        this.hitMaterial = hitMaterial;
        this.originalMaterials = model.getComponentsInChildren(MeshRenderer).map(renderer => ({
            renderer, materials: [...renderer.sharedMaterials],
        }));
        const binder = model.getComponent(BossAnimationBinder);
        this.frames = model.getComponent(DigitGateFrameRenderer);
        if (this.frames || binder) {
            if (this.frames) this.animation = this.frames.bind();
            else { binder!.autoPlay = false; this.animation = binder!.bind(); }
            if (this.animation) {
                for (const action of Object.keys(ACTION_NAMES) as ActorAction[]) {
                    this.actionClips[action] = ACTION_NAMES[action].map(name => this.animation!.clips.find(c => c?.name === name)).find(Boolean)
                        ?? (action === 'death' || action === 'move' || action === 'attack' ? null : this.animation.clips[0]);
                }
            }
            if (!this.poolKey.startsWith('soldier') && this.animation) {
                const receiver = this.animation.node.getComponent(DigitGateAttackEvent) ?? this.animation.node.addComponent(DigitGateAttackEvent);
                receiver.onHit = () => {
                    if (this.dead || !this.attacking || !this.node.activeInHierarchy) return;
                    const hit = this.pendingHit;
                    this.pendingHit = null; // 同一次攻击即使重复设置事件帧，也只结算一次。
                    hit?.();
                };
                this.animation.on(Animation.EventType.FINISHED, this.attackFinished, this);
            }
        } else console.error(`[数字门] ${model.name} 缺少角色序列帧或角色动画绑定组件。`);
    }

    reset() {
        this.animation?.stop();
        this.chasing = false;
        this.attacking = false;
        this.pendingHit = null;
        this.restoreMaterials();
        this.bossHitCooldown = 0;
        this.hitTimer = 0;
        this.fallBackDeath = false;
        this.deathDuration = 0;
        this.dead = false;
        this.attackTimer = 0;
        this.shotDelay = 0;
        this.recycleTimer = 0;
        this.spawnAge = -1;
        this.clipName = '';
        this.action = null;
        this.node.active = true;
        this.model?.setScale(this.baseScale, this.baseScale, this.baseScale);
        this.model?.setRotationFromEuler(0, 0, 0);
        this.model?.setPosition(0, 0, 0);
    }

    play(action: ActorAction): AnimationClip | null {
        if (this.dead && action !== 'death') return null;
        const animation = this.animation;
        if (!animation) return null;
        const clip = action === 'death' && this.deathSettings.clip
            ? animation.clips.find(c => c?.name === this.deathSettings.clip) ?? null
            : this.actionClips[action] ?? null;
        if (this.action === action && action !== 'attack' && action !== 'death') return clip;
        this.action = action;
        // 没有死亡片段时保留受击瞬间的骨骼姿势，再由模型外层做倒地。
        if (!clip) { if (action === 'death') animation.pause(); return null; }
        if (this.clipName === clip.name && action !== 'death' && action !== 'attack') return clip;
        this.clipName = clip.name;
        const state = animation.getState(clip.name);
        if (state) {
            state.wrapMode = action === 'death' || action === 'attack' ? AnimationClip.WrapMode.Normal : AnimationClip.WrapMode.Loop;
            state.playbackRange = { min: 0, max: clip.duration * (action === 'death' ? this.deathSettings.endPercent / 100 : 1) };
            // 保留旧短片段的预览速度；当前两个 Boss 使用 0.8 秒连续行走，按原速播放。
            state.speed = action === 'move' && this.boss ? Math.min(1, clip.duration / 0.8) : 1;
            // 每次死亡只抽样一次；播放一次后保持末帧，等待配置的停留时间。
            if (action === 'death') state.speed = this.deathSettings.speed + (Math.random() * 2 - 1) * this.deathSettings.randomSpeed;
        }
        animation.play(clip.name);
        // 同屏大量小怪共用一个跑步片段，随机起始帧和 ±12% 速度，避免整齐划一。
        if (state && action === 'move' && !this.boss) {
            state.speed = 0.88 + Math.random() * 0.24;
            state.setTime(Math.random() * clip.duration);
        }
        return clip;
    }

    startAttack(interval: number, hit: () => void) {
        if (this.dead || this.attacking || this.attackTimer > 0) return;
        this.attacking = true;
        this.pendingHit = hit;
        this.attackTimer = interval;
        if (!this.play('attack')) {
            this.attacking = false;
            this.pendingHit = null;
            console.error(`[数字门] ${this.model?.name} 缺少 Attack 动画。`);
        }
    }

    private attackFinished(_type: string, state: AnimationState) {
        if (state.name !== 'Attack') return;
        this.attacking = false;
        this.pendingHit = null;
    }

    flashHit() {
        if (this.frames) {
            this.frames.setFlash(1); this.showingHit = true; this.hitTimer = this.hitFlashSeconds; return;
        }
        if (!this.hitMaterial) return;
        if (!this.showingHit) {
            for (const entry of this.originalMaterials) {
                entry.materials.forEach((_, index) => entry.renderer.setSharedMaterial(this.hitMaterial, index));
            }
            this.showingHit = true;
        }
        this.hitTimer = this.hitFlashSeconds;
    }

    /** 同时染红卡通材质的亮部、暗部，并补少量红色自发光，保留原纹理和法线。 */
    flashBossHit() {
        // 连击正常扣血，但不能打断正在播放的脉冲或原色间隔。
        if (this.dead || this.showingBossHit || this.bossHitCooldown > 0) return;
        if (!this.bossFlashMaterials.length) {
            const palette = [
                { name: 'mainColor', base: Color.WHITE, target: new Color(255, 48, 38) },
                { name: 'shadeColor1', base: new Color(102, 102, 102), target: new Color(232, 30, 25) },
                { name: 'shadeColor2', base: new Color(51, 51, 51), target: new Color(180, 18, 24) },
                { name: 'emissive', base: Color.BLACK, target: new Color(170, 22, 18) },
            ];
            for (const entry of this.originalMaterials) entry.materials.forEach((source, index) => {
                if (!source) return;
                const material = new Material();
                material.copy(source);
                const colors = palette.filter(p => material.passes.some(pass => pass.getHandle(p.name) !== 0))
                    .map(p => {
                        const base = (source.getProperty(p.name) as Color | undefined)?.clone() ?? p.base.clone();
                        const target = p.target.clone(); target.a = base.a;
                        return { name: p.name, base, target, current: base.clone() };
                    });
                // 身体、武器的每个槽位分别复制，不能拿第一份纹理覆盖全部槽位。
                this.bossFlashMaterials.push({ renderer: entry.renderer, index, material, colors });
            });
        }
        if (!this.showingBossHit) for (const flash of this.bossFlashMaterials) {
            flash.renderer.setSharedMaterial(flash.material, flash.index);
        }
        this.showingHit = this.showingBossHit = true;
        this.hitTimer = Math.max(this.hitFlashSeconds, 0.32);
        this.updateBossFlash(0);
    }

    private updateBossFlash(dt: number) {
        if (!this.showingHit) return;
        this.hitTimer -= dt;
        const progress = 1 - Math.max(0, Math.min(1, this.hitTimer / Math.max(this.hitFlashSeconds, 0.32)));
        // 前 1/4 平滑染红，后 3/4 平滑恢复，整个周期都不被后续命中重置。
        const blend = progress < .25 ? progress / .25 : (1 - progress) / .75;
        const pulse = blend * blend * (3 - 2 * blend);
        for (const flash of this.bossFlashMaterials) {
            // 实时蒙皮会另建 MaterialInstance；必须更新真正绘制的实例。
            const material = flash.renderer.getRenderMaterial(flash.index)!;
            for (const color of flash.colors) {
                Color.lerp(color.current, color.base, color.target, pulse);
                material.setProperty(color.name, color.current);
            }
        }
        if (this.hitTimer <= 0) {
            this.restoreMaterials();
            this.bossHitCooldown = .08; // 密集火力下也留出可见的正常材质时间。
        }
    }

    private restoreMaterials() {
        this.showingBossHit = false;
        if (!this.showingHit) return;
        if (this.frames) { this.frames.setFlash(0); this.showingHit = false; return; }
        for (const entry of this.originalMaterials) {
            entry.materials.forEach((material, index) => entry.renderer.setSharedMaterial(material, index));
        }
        this.showingHit = false;
    }

    /** 参考游戏：正常尺寸 .97 → 1.17 → 1，保持人物可见地从中心向外移动。 */
    startSpawn() {
        this.spawnAge = 0;
        this.model?.setScale(this.baseScale * 0.97, this.baseScale * 0.97, this.baseScale * 0.97);
    }

    get spawning() { return this.spawnAge >= 0; }

    private tickSpawn(dt: number) {
        if (this.spawnAge < 0 || !this.model) return;
        this.spawnAge += dt;
        const t = Math.min(1, Math.max(0, (this.spawnAge - 0.2) / 0.25));
        const grow = this.spawnAge < 0.2 ? 0.97 + 0.2 * (1 - Math.pow(1 - this.spawnAge / 0.2, 3))
            : 1.17 - 0.17 * t * t * t;
        const s = this.baseScale * grow;
        this.model.setScale(s, s, s);
        if (this.spawnAge >= DigitGateActor.SPAWN_TIME) {
            this.spawnAge = -1;
            this.model.setScale(this.baseScale, this.baseScale, this.baseScale);
        }
    }

    update(dt: number) {
        this.bossHitCooldown = Math.max(0, this.bossHitCooldown - dt);
        if (!this.dead) this.tickSpawn(dt);
        // 普通受击短暂闪白；死亡白色是否保持由工作台配置。
        if (this.showingBossHit) {
            this.updateBossFlash(dt);
            return;
        }
        if (this.dead || this.hitTimer <= 0) return;
        this.hitTimer -= dt;
        if (this.hitTimer <= 0) this.restoreMaterials();
    }

    kill() {
        if (this.dead) return;
        this.dead = true;
        this.attacking = false;
        this.pendingHit = null;
        this.spawnAge = -1;
        this.model?.setScale(this.baseScale, this.baseScale, this.baseScale);
        this.restoreMaterials();
        if (this.deathSettings.whiteFlash) this.flashHit();
        const clip = this.play('death');
        // 优先播放角色的死亡动作；没有死亡片段的其他角色才使用倒地过渡。
        this.fallBackDeath = !clip;
        const state = clip ? this.animation!.getState(clip.name) : null;
        this.deathDuration = state ? state.playbackRange.max / state.speed : 0.65;
        this.recycleTimer = this.deathDuration + this.deathSettings.holdSeconds;
    }

    tickDeath(dt: number) {
        this.recycleTimer -= dt;
        if (this.fallBackDeath && this.model) {
            const elapsed = this.deathDuration + this.deathSettings.holdSeconds - this.recycleTimer;
            const t = Math.max(0, Math.min(1, (elapsed - 0.08) / 0.5));
            const eased = t * t * (3 - 2 * t);
            this.model.setRotationFromEuler(-85 * eased, 0, -8 * eased);
            this.model.setPosition(0, Math.sin(t * Math.PI) * 0.08, -0.18 * eased);
        }
        // 停留期间不重新播放站立/射击，最后由玩法销毁友军或回收敌人。
        return this.recycleTimer <= 0;
    }

    pause() { this.animation?.pause(); }
    resume() { this.animation?.resume(); }

    onDestroy() { this.bossFlashMaterials.forEach(flash => flash.material.destroy()); }
}
