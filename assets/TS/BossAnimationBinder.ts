import {
    _decorator,
    CCString,
    Component,
    SkeletalAnimation,
    Skeleton,
    SkinnedMeshRenderer,
} from 'cc';

const { ccclass, property } = _decorator;

@ccclass('角色动画绑定')
export class BossAnimationBinder extends Component {
    @property({ type: [CCString], displayName: '动作名称' })
    actionNames: string[] = [];

    @property({ displayName: '自动播放' })
    autoPlay = true;

    private boundAnimation: SkeletalAnimation | null = null;
    private static readonly skeletons = new WeakMap<Skeleton, Skeleton>();

    onLoad() {
        // 早于 SkeletalAnimation（执行顺序 99）初始化，兼容旧场景里的 FBX 实例。
        this.bind();
    }

    start() {
        const animation = this.bind();
        if (this.autoPlay && animation?.defaultClip) animation.play(animation.defaultClip.name);
    }

    // 玩法可以在实例化后立即绑定，随后切换行走、射击和死亡。
    bind(): SkeletalAnimation | null {
        if (this.boundAnimation) return this.boundAnimation;
        // FBX 模型的骨架名不固定：Boss 是 Main，士兵可能是 Root 或 DeformationSystem。
        const modelRoot = this.node.children.find(
            child => child.getComponentInChildren(SkinnedMeshRenderer) !== null,
        );
        // 动画组件直接保存在内层模型节点上，编辑器加载时就能找到骨骼。
        // 不再在外层放一份错误路径的动画，等 start 才搬到内层。
        // 旧调试场景直接引用 FBX，保留其外层组件的运行时兼容，不改用户场景。
        const source = modelRoot?.getComponent(SkeletalAnimation) ?? this.getComponent(SkeletalAnimation);
        const renderer = modelRoot?.getComponentInChildren(SkinnedMeshRenderer);
        const originalSkeleton = renderer?.skeleton;

        if (!source || !modelRoot || !renderer || !originalSkeleton || source.clips.length === 0) {
            console.error(`[${this.node.name}] 找不到模型、骨骼或动画。绑定脚本放在外层，SkeletalAnimation 放在内层模型节点。`);
            return null;
        }

        // 模型骨骼路径比动画多了一层模型节点，去掉这一层。
        const prefix = `${modelRoot.name}/`;
        const needsRootCorrection = originalSkeleton.joints.every(path => path.startsWith(prefix));
        // 能找到关节不代表动画根一致：旧 Boss 的蒙皮根在外层，仍须修正。
        // 工作台导入的角色保留 Creator 原生骨架与轴向，但同样初始化动作名称和状态。
        const renderers = modelRoot.getComponentsInChildren(SkinnedMeshRenderer);
        if (!needsRootCorrection && !renderers.every(r => r.skeleton && r.skinningRoot
            && r.skeleton.joints.every(p => !p || !!r.skinningRoot!.getChildByPath(p)))) {
            console.error(`[${this.node.name}] 骨骼路径与当前模型不符。`);
            return null;
        }
        // 组件可能已 onLoad，先清掉旧状态，再按动作名重建，避免残留 Unreal Take 状态。
        const clips = [...source.clips];
        source.clips = [];
        // UE 导入的每段动作都叫 Unreal Take；每个 FBX 是独立剪辑，运行时按槽位区分。
        // 原有 Boss 没有配置动作名时保留其已命名的 Attack/Dead/Move。
        clips.forEach((clip, index) => {
            if (!clip || !this.actionNames[index]) return;
            clip.name = this.actionNames[index];
        });

        if (needsRootCorrection) {
            // 同一种角色共享修正后的骨架，也让引擎复用同一份预烘焙关节纹理。
            let skeleton = BossAnimationBinder.skeletons.get(originalSkeleton);
            if (!skeleton) {
                skeleton = new Skeleton();
                skeleton.joints = originalSkeleton.joints.map(path => path.slice(prefix.length));
                skeleton.bindposes = originalSkeleton.bindposes;
                BossAnimationBinder.skeletons.set(originalSkeleton, skeleton);
            }

            // 只修正旧 FBX 内层的导入轴向，外层朝向属于场景/玩法。
            modelRoot.setRotationFromEuler(0, 0, 0);
            renderer.skeleton = skeleton;
            renderer.skinningRoot = modelRoot;
        }

        if (source.node !== modelRoot) source.enabled = false;
        const animation = source.node === modelRoot ? source : modelRoot.addComponent(SkeletalAnimation);
        // 预烘焙开关以预制体原生 SkeletalAnimation 设置为准，不在这里强制关闭。
        if (source !== animation) animation.useBakedAnimation = source.useBakedAnimation;
        animation.clips = clips;
        animation.defaultClip = animation.clips.find(clip => clip?.name === 'Attack')
            ?? animation.clips[0];
        animation.playOnLoad = false;
        this.boundAnimation = animation;
        return animation;
    }
}
