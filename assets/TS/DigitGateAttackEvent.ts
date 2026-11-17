import { _decorator, Component } from 'cc';

/** Cocos 动画事件只投递给动画所在节点；这里只转发，规则留在角色/玩法中。 */
@_decorator.ccclass('近战命中帧')
export class DigitGateAttackEvent extends Component {
    onHit: (() => void) | null = null;

    attackHit() { this.onHit?.(); }
}
