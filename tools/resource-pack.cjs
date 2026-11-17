const assert = require('node:assert/strict');
const unpack = require('./resource-unpack.js');

// 二进制数据不先转 Base64 参与压缩；解包后仍还原为 SuperHTML 原资源表。
module.exports = function pack(resources) {
    const table = {}, chunks = [];
    const add = value => { chunks.push(Buffer.from(value, 'base64')); return chunks.length - 1; };
    for (const [name, value] of Object.entries(resources)) {
        if (value.startsWith('data:') && value.includes(';base64,')) {
            const comma = value.indexOf(',');
            table[name] = ['binary', value.slice(0, comma + 1), add(value.slice(comma + 1))];
        } else if (name === 'digitgate-decoder.wasm') table[name] = ['binary', '', add(value)];
        else if (value.startsWith('{"digitGateDraco":')) {
            const mesh = JSON.parse(value);
            for (const part of mesh.parts) part.data = add(part.data);
            table[name] = ['mesh', mesh];
        } else table[name] = value;
    }
    const header = Buffer.from(JSON.stringify([table, chunks.map(b => b.length)]));
    const prefix = Buffer.from([255, 68, 71, 49, 0, 0, 0, 0]);
    prefix.writeUInt32LE(header.length, 4);
    const packed = Buffer.concat([prefix, header, ...chunks]);
    assert.deepEqual(unpack(packed), resources, '二进制资源表往返不一致');
    return packed;
};
