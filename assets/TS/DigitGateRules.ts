// 数值在“配置/数字门配置.json”中调整；这里仅声明配置形状。
export type RewardKind = 'weapon' | 'soldier' | 'plane' | 'obstacle';
export interface PathPoint { x: number; z: number; }
export type GateOperation = 'add' | 'subtract' | 'multiply' | 'divide';
export interface RewardIconTransform {
    offset?: { x: number; y: number; z: number; };
    rotation?: { x: number; y: number; z: number; };
    scale?: { x: number; y: number; };
}
export interface RewardWave { time: number; kind: RewardKind; hp: number; layers?: number; icon?: string; iconScale?: number; iconTransform?: RewardIconTransform; power?: number; startZ?: number; speed?: number; width?: number; depth?: number; }
export interface BossWave { startZ: number; hp: number; speed: number; style: number; scale: number; final?: boolean; }
export interface MeleeSettings { chaseDistance: number; attackDistance: number; attackRadius: number; attackInterval: number; }
export interface DeathSettings { clip: string; speed: number; randomSpeed: number; holdSeconds: number; endPercent: number; whiteFlash: boolean; }
export interface RewardStoneSettings {
    offset: { x: number; y: number; z: number; };
    size: { x: number; y: number; z: number; };
    gap: number; color: string;
    hitScale: number; hitSeconds: number; outlinePixels: number; fallSeconds: number;
}
export interface EffectSettings {
    hitFlashSeconds: number; bulletScale: number; bulletBrightness: number;
    /** 三级兵种升级 Shader 颜色，默认与同等级子弹颜色一致。 */
    upgradeColors: [string, string, string];
    rewardFlightSeconds: number; rewardFlightHeight: number;
    landingShakeStrength: number; landingShakeSeconds: number;
    rewardShakeStrength: number; rewardShakeSeconds: number;
}
export interface CoinBuildSettings {
    enabled: boolean; obstacleHp: number[]; coinRewards: number[]; buildCosts: number[];
    respawnSeconds: number; pickupRadius: number; depositRadius: number; depositRate: number;
    padZ: number; turretZ: number; maxDefenses: number;
    tankFireInterval?: number; tankBlastRadius?: number;
}
export interface DigitGateSettings {
    death: Record<string, DeathSettings>;
    effects: EffectSettings;
    maxSoldiers: number;
    startSoldiers: number;
    soldierSpacing: number;
    formationDepthRatio: number;
    playerZ: number;
    moveLimit: number;
    levelFireIntervals: number[];
    bulletSpeed: number;
    bulletLifetime: number;
    baseDamage: number;
    levelDamage: number[];
    levelScale: number[];
    gateSpeed: number;
    leftGateCycle: { enabled: boolean; gatesPerReward: number; gateSpeed: number; rewardZ: number; riseSeconds: number; operation: GateOperation; value: number; };
    rewardSpeed: number;
    planeHp: number;
    planeLayers: number;
    planeIcon?: string;
    planeIconScale?: number;
    planeIconTransform?: RewardIconTransform;
    planePosition: { z: number; x?: number; };
    rewardStone: RewardStoneSettings;
    enemyArea: { count: number; columns: number; minX: number; maxX: number; minZ: number; maxZ: number; };
    paths: { gates: PathPoint[]; rewards: PathPoint[]; obstacles: PathPoint[]; };
    gateLayout: { firstZ: number; spacing: number; spawnZ: number; operation: GateOperation; value: number; };
    enemyHp: number;
    enemyScale: number;
    enemySpeed: number;
    enemyCombat: MeleeSettings;
    bossCombat: MeleeSettings;
    rewards: RewardWave[];
    obstacles: RewardWave[];
    bosses: BossWave[];
    retryLimit: number;
    storeUrls: { android: string; ios: string };
    coinBuild?: CoinBuildSettings;
}
