import {
    _decorator, builtinResMgr, Button, Camera, Color, Component, Enum, Label, Layers, Material,
    Node, Quat, RenderRoot2D, Sprite, SpriteFrame, Texture2D, UITransform, Vec2, Vec3,
} from 'cc';
import { DigitGateHealthBar } from './DigitGateHealthBar';
import { EffectSettings, RewardIconTransform } from './DigitGateRules';
import { DigitGateFixedUi } from './DigitGateFixedUi';
import { EDITOR } from 'cc/env';

const { ccclass, property, executeInEditMode } = _decorator;
enum ResultPreview { 游戏中 = 0, 失败 = 1, 胜利 = 2 }

// 血条按参考包用 0.2 秒线性过渡；数字在命中时立即更新。
// 数字是否可见由预制体 Label 子节点控制。
export interface WorldBadge {
    node: Node;
    label: Label;
    bar: DigitGateHealthBar | null;
    rotation: Quat;
    currentRatio: number;
    targetRatio: number;
    ratioFrom: number;
    ratioTime: number;
    icon: Node | null;
}

interface Toast { node: Node; life: number; duration: number; }
interface RewardFlight { node: Node; from: Vec3; target: Node; scale: Vec3; time: number; onCollected: () => void; }

@ccclass('数字门游戏界面')
@executeInEditMode
export class DigitGateHud extends Component {
    @property({ type: Enum(ResultPreview), displayName: '编辑器结算预览', tooltip: '仅影响 Creator 编辑视图；运行时由真实胜负决定。失败可查看和编辑重试、Play Now，胜利仅显示居中的 Play Now。' })
    resultPreview = ResultPreview.失败;
    private lastResultPreview = -1;
    @property({ type: Button, displayName: '常驻下载按钮' }) private installButton: Button = null!;
    @property({ type: Node, displayName: '参考结算界面' }) private endRoot: Node = null!;
    @property({ type: Node, displayName: '失败叉号' }) private failureMark: Node = null!;
    @property({ type: Node, displayName: '胜利勾号' }) private successMark: Node = null!;
    @property({ type: Button, displayName: '结算重试按钮' }) private retryButton: Button = null!;
    @property({ type: Button, displayName: '结算下载按钮' }) private endInstallButton: Button = null!;
    @property({ type: Button, displayName: '结算全屏跳转' }) private endBackgroundButton: Button = null!;
    worldCamera: Camera | null = null;
    private toasts: Toast[] = [];
    private flights: RewardFlight[] = [];
    private frames = new Map<Texture2D, SpriteFrame>();
    private pendingResult: { win: boolean; delay: number } | null = null;
    private worldRoot: Node = null!;
    private worldSpriteMaterial: Material = null!;
    private static readonly WORLD_PIXEL = 0.008;
    private frameDt = 0;
    private effects: EffectSettings = null!;
    onInstall: () => void = () => {};
    onRetry: () => void = () => {};

    update() {
        if (!EDITOR || !this.endRoot || this.lastResultPreview === this.resultPreview) return;
        this.lastResultPreview = this.resultPreview;
        if (this.resultPreview === ResultPreview.游戏中) this.endRoot.active = false;
        else this.showResult(this.resultPreview === ResultPreview.胜利);
    }

    private showResult(win: boolean) {
        this.endRoot.active = true;
        this.failureMark.active = !win;
        this.successMark.active = win;
        this.retryButton.node.active = !win;
        this.endInstallButton.node.active = true;
        this.getComponentInChildren(DigitGateFixedUi)?.refreshResultLayout();
    }

    setup(camera: Camera, effects: EffectSettings) {
        this.effects = effects;
        this.worldCamera = camera;
        // 原生 UI 组件由 3D 主相机绘制，不再投影到屏幕 Canvas。
        this.worldRoot = new Node('3D飘字与奖励飞行');
        this.worldRoot.layer = Layers.Enum.DEFAULT;
        this.node.scene!.addChild(this.worldRoot);
        this.worldRoot.addComponent(RenderRoot2D);
        this.worldSpriteMaterial = this.worldMaterial('ui-sprite-material');
    }

    // Button 的 Click Events 在场景内绑定，用户可直接查看与更换按钮表现。
    clickInstall() { this.onInstall(); }
    clickRetry() { this.onRetry(); }
    isPointerOverButton(screenPoint: Vec2) {
        return [this.installButton, this.retryButton, this.endInstallButton, this.endBackgroundButton]
            .some(button => button.node.activeInHierarchy && button.enabled && button.interactable
                && button.node.getComponent(UITransform)!.hitTest(screenPoint));
    }

    private element(parent: Node, name: string, width: number, height: number) {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        node.addComponent(UITransform).setContentSize(width, height);
        return node;
    }

    private worldMaterial(resource: string) {
        const material = new Material();
        material.copy(builtinResMgr.get<Material>(resource), {
            defines: resource === 'ui-graphics-material' ? { USE_LOCAL: true } : { USE_TEXTURE: true },
            states: { depthStencilState: { depthTest: true, depthWrite: false } },
        });
        return material;
    }

    private text(parent: Node, value: string, fontSize: number, width: number, height: number) {
        const label = this.element(parent, value, width, height).addComponent(Label);
        label.string = value;
        label.fontSize = fontSize;
        label.lineHeight = fontSize + 9;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.color = Color.WHITE;
        label.isBold = true;
        label.overflow = Label.Overflow.SHRINK;
        label.enableWrapText = true;
        label.customMaterial = this.worldSpriteMaterial;
        return label;
    }

    private setPicture(sprite: Sprite, texture: Texture2D, width: number, height: number) {
        let frame = this.frames.get(texture);
        // 同一张图片可能同时用于左侧奖励和右侧流光；保留原图 UV，避免先合图后换材质导致图标错位。
        if (!frame) { frame = new SpriteFrame(); frame.packable = false; frame.texture = texture; this.frames.set(texture, frame); }
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        const ratio = texture.width / texture.height;
        sprite.node.getComponent(UITransform)!.setContentSize(Math.min(width, height * ratio), Math.min(height, width / ratio));
    }

    // 奖励物的数字、图标和位置直接来自预制体；运行时只填入本波血量/奖励类型。
    rewardBadge(owner: Node, value: number, icon: Texture2D | null, transform?: RewardIconTransform): WorldBadge {
        const sprite = owner.getComponentInChildren(Sprite)!;
        const iconArea = sprite.node.parent!;
        iconArea.active = !!icon;
        if (icon) {
            const size = iconArea.getComponent(UITransform)!;
            this.setPicture(sprite, icon, size.width, size.height);
        }
        // 朝向相机由外层维持；独立旋转和宽高缩放放在内层，转弯和领奖飞行不会覆盖它们。
        const rotation = transform?.rotation;
        if (rotation) {
            const q = Quat.fromEuler(new Quat(), rotation.x, rotation.y, rotation.z);
            sprite.node.setRotation(Quat.multiply(q, sprite.node.rotation, q));
        }
        const scale = transform?.scale;
        if (scale) sprite.node.setScale(sprite.node.scale.x * scale.x, sprite.node.scale.y * scale.y, sprite.node.scale.z);
        const badge = this.prefabBadge(owner, String(value));
        badge.icon = icon ? iconArea : null;
        iconArea.setWorldRotation(this.worldCamera!.node.worldRotation);
        return badge;
    }

    /**
     * 直接绑定标牌文字；命中时通过 setBadgeValue 更新数字与血条。
     * 直接绑定预制体的表现节点，不再运行时创建，也不改排版。
     */
    prefabBadge(owner: Node, text: string): WorldBadge {
        const label = owner.getComponentInChildren(Label)!;
        const node = label.node.parent!;
        const bar = owner.getComponent(DigitGateHealthBar);
        label.string = text;
        bar?.setRatio(1);
        return { node, label, bar, rotation: node.rotation.clone(),
            currentRatio: 1, targetRatio: 1, ratioFrom: 1, ratioTime: 0.2, icon: null };
    }

    worldText(parent: Node, name: string, value: string, position: Vec3, scale = .006, fontSize = 52): Label {
        const root = new Node(name); root.parent = parent; root.layer = parent.layer;
        root.addComponent(RenderRoot2D); root.setPosition(position);
        root.setWorldRotation(this.worldCamera!.node.worldRotation); root.setScale(scale, scale, scale);
        const label = this.text(root, value, fontSize, 220, 90);
        label.enableOutline = true; label.outlineWidth = 3; label.outlineColor = new Color(45, 37, 25);
        return label;
    }

    buildBadge(owner: Node, value: number, position: Vec3): WorldBadge {
        const label = this.worldText(owner, '金币障碍血量', String(value), position, .007, 55);
        return { node: label.node.parent!, label, bar: null, rotation: label.node.parent!.rotation.clone(),
            currentRatio: 1, targetRatio: 1, ratioFrom: 1, ratioTime: .2, icon: null };
    }

    setBadgeValue(badge: WorldBadge, value: number, ratio = 1) {
        badge.label.string = String(Math.ceil(Math.max(0, value)));
        const target = Math.max(0, Math.min(1, ratio));
        if (badge.targetRatio !== target) {
            badge.ratioFrom = badge.currentRatio;
            badge.ratioTime = 0;
            badge.targetRatio = target;
        }
    }

    updateBadgeValue(badge: WorldBadge) {
        // 抵消箱子转弯/摇摆，图标始终与主相机平行，数字仍贴在箱面。
        badge.icon?.setWorldRotation(this.worldCamera!.node.worldRotation);
        if (badge.bar && badge.currentRatio !== badge.targetRatio) {
            badge.ratioTime = Math.min(0.2, badge.ratioTime + this.frameDt);
            badge.currentRatio = badge.ratioTime >= 0.2 ? badge.targetRatio
                : badge.ratioFrom + (badge.targetRatio - badge.ratioFrom) * badge.ratioTime / 0.2;
            badge.bar.setRatio(badge.currentRatio);
        }
    }

    reset() {
        this.pendingResult = null;
        this.endRoot.active = false;
        for (const toast of this.toasts) toast.node.destroy();
        this.toasts.length = 0;
        this.flights.forEach(f => f.node.destroy()); this.flights = [];
    }

    finish(win: boolean) {
        // 结束后延迟 0.5 秒显示结算；胜利只显示居中的 Play Now。
        this.pendingResult = { win, delay: .5 };
    }

    toast(text: string, color = new Color(255, 219, 91), position: Vec3, fontSize = 32) {
        const root = this.element(this.worldRoot, '世界飘字', 700, fontSize + 24);
        const label = this.text(root, text, fontSize, 700, fontSize + 24);
        label.color = color;
        label.enableOutline = true;
        label.outlineWidth = 3;
        label.outlineColor = new Color(20, 35, 60);
        root.setWorldPosition(position);
        root.setWorldRotation(this.worldCamera!.node.worldRotation);
        root.setScale(DigitGateHud.WORLD_PIXEL, DigitGateHud.WORLD_PIXEL, DigitGateHud.WORLD_PIXEL);
        this.toasts.push({ node: root, life: 1.3, duration: 1.3 });
    }

    tick(dt: number) {
        this.frameDt = dt;
        if (this.pendingResult) {
            this.pendingResult.delay -= dt;
            if (this.pendingResult.delay <= 0) {
                const win = this.pendingResult.win; this.pendingResult = null;
                this.showResult(win);
            }
        }
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i]; f.time += dt;
            const t = Math.min(1, f.time / this.effects.rewardFlightSeconds);
            const to = f.target.worldPosition.clone(); to.y += 0.9;
            const p = new Vec3(); Vec3.lerp(p, f.from, to, t * t);
            p.y += Math.sin(t * Math.PI) * this.effects.rewardFlightHeight;
            f.node.setWorldPosition(p); f.node.setScale(Vec3.multiplyScalar(new Vec3(), f.scale, 1 - t * 0.45));
            f.node.setWorldRotation(this.worldCamera!.node.worldRotation);
            if (t >= 1) {
                f.node.destroy(); this.flights.splice(i, 1);
                f.onCollected();
            }
        }
        for (let i = this.toasts.length - 1; i >= 0; i--) {
            const toast = this.toasts[i]; toast.life -= dt;
            const p = toast.node.position;
            toast.node.setPosition(p.x, p.y + dt * .38, p.z);
            // 前 0.25 秒弹出：0.3 → 1.2 → 1，之后保持。
            const age = toast.duration - toast.life;
            const s = age < 0.15 ? 0.3 + age / 0.15 * 0.9 : age < 0.25 ? 1.2 - (age - 0.15) / 0.1 * 0.2 : 1;
            const scale = s * DigitGateHud.WORLD_PIXEL;
            toast.node.setScale(scale, scale, scale);
            if (toast.life <= 0) { toast.node.destroy(); this.toasts.splice(i, 1); }
        }
    }

    flyReward(owner: Node, target: Node, onCollected: () => void) {
        // 将预制体已有图标移出即将销毁的箱体，完整保留美术排版、材质与大小。
        const node = owner.getComponentInChildren(Sprite)!.node.parent!;
        const from = node.worldPosition.clone();
        node.setParent(this.worldRoot, true);
        node.active = true;
        this.flights.push({ node, from, target, scale: node.scale.clone(), time: 0, onCollected });
    }

    onDestroy() {
        this.worldRoot?.destroy();
        this.frames.forEach(frame => frame.destroy());
        this.worldSpriteMaterial?.destroy();
    }
}
