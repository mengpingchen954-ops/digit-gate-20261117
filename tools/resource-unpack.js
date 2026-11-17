(function (scope) {
    function unpack(input) {
        const bytes = Uint8Array.from(input);
        if (bytes[0] !== 255 || bytes[1] !== 68 || bytes[2] !== 71 || bytes[3] !== 49) throw Error('Invalid resource header');
        const length = new DataView(bytes.buffer).getUint32(4, true);
        const [table, sizes] = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
        let offset = 8 + length;
        const chunks = sizes.map(size => {
            const part = bytes.subarray(offset, offset + size); offset += size;
            if (part.length !== size) throw Error('Truncated resource');
            let text = '';
            for (let i = 0; i < part.length; i += 32768) text += String.fromCharCode.apply(null, part.subarray(i, i + 32768));
            return btoa(text);
        });
        if (offset !== bytes.length) throw Error('Resource length mismatch');
        for (const name of Object.keys(table)) {
            const value = table[name];
            if (!Array.isArray(value)) continue;
            if (value[0] === 'binary') table[name] = value[1] + chunks[value[2]];
            else if (value[0] === 'mesh') {
                for (const part of value[1].parts) part.data = chunks[part.data];
                table[name] = JSON.stringify(value[1]);
            } else throw Error('Invalid resource type');
        }
        return table;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = unpack;
    else scope.unpackDigitGateResources = unpack;
})(globalThis);
