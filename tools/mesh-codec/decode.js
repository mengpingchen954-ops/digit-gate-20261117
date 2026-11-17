/* Decodes build-only Draco storage into the original Cocos vertex/index layout. */
(function (scope) {
    function decode(module, description, references = {}) {
        const output = new Uint8Array(description.byteLength);
        const view = new DataView(output.buffer);
        for (const part of description.parts) {
            const bytes = typeof Buffer !== 'undefined' ? Uint8Array.from(Buffer.from(part.data, 'base64'))
                : Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
            const decoder = new module.Decoder(), buffer = new module.DecoderBuffer(), mesh = new module.Mesh();
            buffer.Init(bytes, bytes.length);
            const status = decoder.DecodeBufferToMesh(buffer, mesh);
            if (!status.ok() || mesh.num_faces() * 3 !== part.index.count) throw Error('Draco geometry count mismatch: '+mesh.num_points()+'/'+part.vertex.count+' points, '+mesh.num_faces()*3+'/'+part.index.count+' indices');
            const ids = new module.DracoUInt32Array();
            decoder.GetAttributeUInt32ForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, part.idAttribute), ids);
            const seen = new Set();
            for (let i = 0; i < mesh.num_points(); i++) {
                const id = ids.GetValue(i);
                if (id >= part.vertex.count) throw Error('Invalid Draco vertex remap');
                seen.add(id);
            }
            if (seen.size !== part.vertex.count) throw Error('Draco omitted original vertices');
            for (const attribute of part.attributes) {
                if (attribute.omitted) {
                    for (let i = 0; i < part.vertex.count; i++) for (let k = 0; k < attribute.components; k++) view.setFloat32(part.vertex.offset + i * part.vertex.stride + attribute.offset + k * 4, attribute.defaultValues ? attribute.defaultValues[k] : attribute.defaultValue, true);
                    continue;
                }
                const written = new Set();
                const values = attribute.residual ? new module.DracoInt32Array() : attribute.integer ? new module.DracoUInt16Array() : new module.DracoFloat32Array();
                const attr = decoder.GetAttributeByUniqueId(mesh, attribute.id);
                if (attribute.residual) decoder.GetAttributeInt32ForAllPoints(mesh, attr, values);
                else if (attribute.integer) decoder.GetAttributeUInt16ForAllPoints(mesh, attr, values);
                else decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
                const base = attribute.residual && references[attribute.residual.resource];
                const baseView = base && new DataView(base.buffer, base.byteOffset, base.byteLength);
                for (let i = 0; i < mesh.num_points(); i++) {
                    const offset = part.vertex.offset + ids.GetValue(i) * part.vertex.stride + attribute.offset;
                    for (let k = 0; k < attribute.components; k++) {
                        let value = values.GetValue(i * attribute.components + k);
                        if (baseView) {
                            const at = attribute.residual.offset + ids.GetValue(i) * attribute.residual.stride + attribute.offset + k * (attribute.integer ? 2 : 4);
                            value = attribute.integer ? value + baseView.getUint16(at, true) : Math.fround(value / attribute.residual.step + baseView.getFloat32(at, true));
                        } else if (attribute.residual) throw Error('Missing mesh reference');
                        if (!Number.isFinite(value)) throw Error('Invalid Draco attribute');
                        if (written.has(ids.GetValue(i))) {
                            const old = attribute.integer ? view.getUint16(offset + k * 2, true) : view.getFloat32(offset + k * 4, true);
                            if (value !== old) throw Error('Conflicting split vertex attributes');
                        }
                        if (attribute.integer) view.setUint16(offset + k * 2, value, true);
                        else view.setFloat32(offset + k * 4, value, true);
                    }
                    written.add(ids.GetValue(i));
                }
                module.destroy(values);
            }
            const face = new module.DracoInt32Array();
            for (let i = 0; i < mesh.num_faces(); i++) {
                decoder.GetFaceFromMesh(mesh, i, face);
                for (let k = 0; k < 3; k++) {
                    const offset = part.index.offset + (i * 3 + k) * part.index.stride;
                    const value = ids.GetValue(face.GetValue(k));
                    if (part.index.stride === 2) view.setUint16(offset, value, true);
                    else view.setUint32(offset, value, true);
                }
            }
            for (const object of [face, ids, mesh, buffer, decoder]) module.destroy(object);
        }
        return output;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = decode;
    else scope.decodeDigitGateMesh = decode;
})(globalThis);
