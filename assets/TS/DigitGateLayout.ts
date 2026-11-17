import { DigitGateSettings, GateOperation, PathPoint } from './DigitGateRules';

// 门的局部 X 轴为门面宽度；局部 Z 对齐路线后，门面正好垂直横跨路线。
export function routeYaw(points: PathPoint[], z: number): number {
    if (z < points[0].z || z > points[points.length - 1].z) return 0;
    const i = Math.max(1, points.findIndex(p => p.z >= z));
    return Math.atan2(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z) * 180 / Math.PI;
}

export interface Footprint { x: number; z: number; width: number; depth: number; yaw: number; }
// XZ 平面有向矩形相交，按两者各自的边轴投影，不能只比较 Z 阈值。
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
    const axes = (v: Footprint) => { const r = v.yaw * Math.PI / 180; return [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]; };
    const aa = axes(a), ba = axes(b);
    for (const [x, z] of [...aa, ...ba]) {
        const radius = (v: Footprint, ax: number[][]) => Math.abs(x * ax[0][0] + z * ax[0][1]) * v.width / 2
            + Math.abs(x * ax[1][0] + z * ax[1][1]) * v.depth / 2;
        if (Math.abs((b.x - a.x) * x + (b.z - a.z) * z) >= radius(a, aa) + radius(b, ba)) return false;
    }
    return true;
}

// 游戏、Creator 预览和关卡工作台共用；路线节点按 Z 从远到近排列。
export function routeX(points: PathPoint[], z: number): number {
    if (z <= points[0].z) return points[0].x;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (z <= b.z) return a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
    }
    return points[points.length - 1].x;
}

// 横向槽位沿道路法线展开，弯道处仍保持原有道路和队列宽度。
export function routePosition(points: PathPoint[], z: number, offset = 0): PathPoint {
    const yaw = routeYaw(points, z) * Math.PI / 180;
    return { x: routeX(points, z) + Math.cos(yaw) * offset, z: z - Math.sin(yaw) * offset };
}

// 按真实路线长度计距，斜路和转弯也保持同一间距、同一速度。
export function routeDistance(points: PathPoint[], z: number): number {
    if (z <= points[0].z) return z - points[0].z;
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (z <= b.z) return distance + length * (z - a.z) / (b.z - a.z);
        distance += length;
    }
    return distance + z - points[points.length - 1].z;
}

export function routeZ(points: PathPoint[], distance: number): number {
    if (distance <= 0) return points[0].z + distance;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (distance <= length) return a.z + (b.z - a.z) * distance / length;
        distance -= length;
    }
    return points[points.length - 1].z + distance;
}

// 开场铺满首门到出生点，后续续接同一队列；编辑器、工作台共用。
export function gatePositions(cfg: DigitGateSettings, travelDistance = 0, path = cfg.paths.gates): number[] {
    const { firstZ, spawnZ, spacing } = cfg.gateLayout;
    const first = routeDistance(path, firstZ) + travelDistance;
    const start = routeDistance(path, Math.max(spawnZ, path[0].z)), end = routeDistance(path, cfg.playerZ + 2);
    const positions: number[] = [];
    const skip = Math.max(0, Math.ceil((first - end - 1e-8) / spacing));
    for (let i = skip; first - i * spacing >= start - 1e-8; i++) positions.push(routeZ(path, first - i * spacing));
    return positions;
}

// Google 参考包 GlobalConfig.getFormation 的前 9 个固定槽位。
// 不按当前人数旋转圆环：新增成员从中心人物走向下一个固定位置。
const referenceSlots = [[0, 0], [-2, 1], [2, 1], [-1, 2], [1, 2], [-2, -1], [2, -1], [-1, -2], [1, -2]];
export function formationPosition(index: number, spacing: number, depthRatio: number) {
    if (index < referenceSlots.length) {
        const [x, z] = referenceSlots[index];
        return { x: x * spacing, z: z * spacing * depthRatio };
    }
    // 用户自行提高上限时，再向外扩圈；默认 9 人完全按参考槽位。
    let ring = 2, local = index - 9;
    while (local >= ring * 8) { local -= ring * 8; ring++; }
    const angle = local / (ring * 8) * Math.PI * 2;
    return { x: Math.cos(angle) * ring * 2 * spacing, z: Math.sin(angle) * ring * 2 * spacing * depthRatio };
}

export function enemyPositions(area: DigitGateSettings['enemyArea']) {
    const rows = Math.ceil(area.count / area.columns);
    return Array.from({ length: area.count }, (_, i) => {
        const row = Math.floor(i / area.columns), column = i % area.columns;
        const inRow = Math.min(area.columns, area.count - row * area.columns);
        return { x: inRow === 1 ? (area.minX + area.maxX) / 2 : area.minX + column / (inRow - 1) * (area.maxX - area.minX),
            z: rows <= 1 ? (area.minZ + area.maxZ) / 2 : area.maxZ - row / (rows - 1) * (area.maxZ - area.minZ) };
    });
}

export function gateCount(count: number, operation: GateOperation, value: number, max: number) {
    const result = operation === 'multiply' ? count * value : operation === 'divide' ? Math.floor(count / value)
        : operation === 'subtract' ? count - value : count + value;
    return Math.max(0, Math.min(max, result));
}
export function gateRule(cfg: DigitGateSettings, side: number) {
    return side < 0 ? { operation: cfg.leftGateCycle?.operation ?? cfg.gateLayout.operation,
        value: cfg.leftGateCycle?.value ?? cfg.gateLayout.value } : cfg.gateLayout;
}
export function gateLabel(operation: GateOperation, value: number) {
    return ({ add: '+', subtract: '−', multiply: '×', divide: '÷' })[operation] + value;
}
