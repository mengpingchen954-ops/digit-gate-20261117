import { _decorator, Color, Component, Label, Material, Mesh, MeshRenderer, Node, Vec3, Vec4 } from 'cc';
import { RewardStoneSettings } from './DigitGateRules';
import { DigitGateRockFragments } from './DigitGateRockFragments';

const { ccclass, property } = _decorator;
interface Layer { node: Node; material: Material; feedback: Vec4; y: number; fromY: number; dropAge: number; hitAge: number; }
@ccclass('分层奖励石头')
export class DigitGateRock extends Component {
    @property({ type: Mesh, displayName: '桌面石头网格' }) stoneMesh: Mesh = null!;
    @property({ type: Material, displayName: '纯色与受击描边材质' }) stoneMaterial: Material = null!;
    @property({ type: Material, displayName: '飞机图标流光材质' }) planeIconMaterial: Material = null!;
    private layers: Layer[] = [];
    private cfg: RewardStoneSettings = null!;
    private body: Node = null!;
    private count = 0;
    private width = 1;
    private height = .3;
    private depth = 1;
    private color = new Color();
    private label: Node | null = null;
    private labelMaterial: Material | null = null;
    private icon: Node | null = null;
    private onBreak: (burst: DigitGateRockFragments) => void = () => {};
    private iconY = 0;
    private iconFromY = 0;
    private iconTargetY = 0;
    private iconAge = 1;
    private iconOffset = new Vec3();

    get remainingLayers() { return this.layers.length; }
    get collisionWidth() { return this.width; }
    get collisionDepth() { return this.depth; }
    get bodyPosition() { return this.body.worldPosition; }
    get buriedY() { return -Math.max(1.4, this.stackTop() + .1); }

    setup(cfg: RewardStoneSettings, layers: number, width: number, depth: number, label: Node, icon: Node | null,
        onBreak: (burst: DigitGateRockFragments) => void, iconOffset?: { x: number; y: number; z: number; }) {
        this.cfg = cfg; this.count = layers; this.label = label; this.icon = icon; this.onBreak = onBreak;
        this.iconOffset.set(iconOffset?.x ?? 0, iconOffset?.y ?? 0, iconOffset?.z ?? 0);
        const preview = this.node.getChildByName('石头编辑预览');
        if (preview) { preview.active = false; preview.destroy(); }
        this.width = cfg.size.x * width / 1.35; this.height = cfg.size.y; this.depth = cfg.size.z * depth / .9;
        this.color.fromHEX(cfg.color);
        this.body = new Node('可调石头堆'); this.node.addChild(this.body);
        this.body.setPosition(cfg.offset.x, cfg.offset.y, cfg.offset.z);
        for (let i = 0; i < this.count; i++) {
            const node = new Node(`石头第${i + 1}层`); this.body.addChild(node);
            // FBX 的原始网格是 X/Y 平面 0.02、Z 厚度 0.006，转正后底面贴地。
            const model = new Node('石头模型'); node.addChild(model); model.setRotationFromEuler(-90, 0, 0);
            model.setScale(this.width / .02, this.depth / .02, this.height / .006);
            const renderer = model.addComponent(MeshRenderer); renderer.mesh = this.stoneMesh;
            const material = new Material(); material.copy(this.stoneMaterial);
            const feedback = new Vec4(0, cfg.outlinePixels, 0, 0);
            material.setProperty('tint', this.color); material.setProperty('feedback', feedback);
            renderer.setSharedMaterial(material, 0);
            const y = this.height / 2 + i * (this.height + cfg.gap);
            node.setPosition(0, y, 0);
            this.layers.push({ node, material, feedback, y, fromY: y, dropAge: cfg.fallSeconds, hitAge: cfg.hitSeconds });
        }
        if (label) label.setPosition(cfg.offset.x, (cfg.offset.y + this.stackTop()) / 2, cfg.offset.z + this.depth * (1 + cfg.hitScale) / 2 + .06);
        const texts = label?.getComponentsInChildren(Label) ?? [];
        if (texts[0]?.customMaterial) {
            this.labelMaterial = new Material(); this.labelMaterial.copy(texts[0].customMaterial, {
                states: { depthStencilState: { depthTest: false, depthWrite: false } },
            });
            texts.forEach(text => text.customMaterial = this.labelMaterial);
        }
        this.iconY = this.iconTargetY = this.iconFromY = this.stackTop() + .65;
        if (icon) this.positionIcon();
    }

    private stackTop() { return this.cfg.offset.y + this.layers.length * this.height + Math.max(0, this.layers.length - 1) * this.cfg.gap; }

    private positionIcon() {
        this.icon!.setPosition(this.cfg.offset.x + this.iconOffset.x, this.iconY + this.iconOffset.y, this.cfg.offset.z + this.iconOffset.z);
    }

    hit(hp: number, maxHp: number) {
        if (!this.layers.length) return;
        // 3 层时：剩余 2/3、1/3、0 血依次破碎，跨阈值伤害不会漏层。
        const remaining = Math.max(0, Math.min(this.count, Math.ceil(hp / maxHp * this.count - 1e-8)));
        while (this.layers.length > remaining) this.breakBottom();
        if (this.layers.length) this.layers[0].hitAge = 0;
    }

    private breakBottom() {
        const layer = this.layers.shift()!;
        const burstNode = new Node('底层石头破碎'); this.node.parent!.addChild(burstNode);
        burstNode.setWorldPosition(layer.node.worldPosition); burstNode.setWorldRotation(this.node.worldRotation);
        const burst = burstNode.addComponent(DigitGateRockFragments);
        burst.setup(this.stoneMesh, this.stoneMaterial, this.color, this.width, this.height, this.depth, .02 - layer.node.worldPosition.y);
        this.onBreak(burst);
        layer.node.destroy(); layer.material.destroy();
        this.layers.forEach((item, i) => {
            item.fromY = item.node.position.y; item.y = this.height / 2 + i * (this.height + this.cfg.gap);
            item.dropAge = 0; item.hitAge = this.cfg.hitSeconds;
        });
        this.iconFromY = this.iconY; this.iconTargetY = this.stackTop() + .65; this.iconAge = 0;
    }

    tick(dt: number) {
        for (const layer of this.layers) {
            layer.dropAge += dt; layer.hitAge += dt;
            const t = Math.min(1, layer.dropAge / this.cfg.fallSeconds);
            // 二次加速落下，落地时轻微回弹。
            const bounce = t >= 1 ? Math.sin(Math.min(1, (layer.dropAge - this.cfg.fallSeconds) / .12) * Math.PI) * this.height * .06 : 0;
            const y = layer.fromY + (layer.y - layer.fromY) * t * t + bounce;
            const progress = Math.min(1, layer.hitAge / this.cfg.hitSeconds);
            const pulse = progress >= 1 ? 0 : Math.sin(progress * Math.PI);
            const scale = 1 + this.cfg.hitScale * pulse;
            layer.node.setScale(scale, scale, scale);
            layer.node.setPosition(0, y + (scale - 1) * this.height / 2, 0);
            layer.feedback.set(pulse, this.cfg.outlinePixels, 0, 0);
            layer.material.setProperty('feedback', layer.feedback);
        }
        if (this.label && this.layers.length) {
            const first = this.layers[0].node.position.y, last = this.layers[this.layers.length - 1].node.position.y;
            this.label.setPosition(this.cfg.offset.x, this.cfg.offset.y + (first + last) / 2, this.label.position.z);
        }
        if (this.icon && this.icon.parent === this.node) {
            this.iconAge += dt;
            const t = Math.min(1, this.iconAge / this.cfg.fallSeconds);
            this.iconY = this.iconFromY + (this.iconTargetY - this.iconFromY) * t * t;
            this.positionIcon();
        }
    }

    onDestroy() { this.layers.forEach(item => item.material.destroy()); this.labelMaterial?.destroy(); }
}
