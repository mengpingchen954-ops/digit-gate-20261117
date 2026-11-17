const createEncoder = require('./draco_encoder_nodejs');
const createDecoder = require('./draco_decoder_nodejs');
const decode = require('./decode');
const ready = Promise.all([createEncoder({}), createDecoder({})]);
module.exports = async function encode(struct, data, sequential = false, reference = null) {
    const [module, decoder] = await ready;
    if (struct.encoded || struct.compressed || struct.quantized || struct.morph) return null;
    if (struct.primitives.length !== struct.vertexBundles.length) return null;
    const description = { digitGateDraco: 1, byteLength: data.length, parts: [] };
    for (let bi = 0; bi < struct.vertexBundles.length; bi++) {
        const vertex = struct.vertexBundles[bi];
        const primitives = struct.primitives.filter(p => p.vertexBundelIndices.length === 1 && p.vertexBundelIndices[0] === bi);
        if (primitives.length !== 1 || primitives[0].primitiveMode !== 7 || !primitives[0].indexView) return null;
        const index = primitives[0].indexView;
        const indices = Uint32Array.from({ length: index.count }, (_, i) => index.stride === 2 ? data.readUInt16LE(index.offset + i * 2) : data.readUInt32LE(index.offset + i * 4));
        const mesh = new module.Mesh(), builder = new module.MeshBuilder(), encoder = new module.Encoder();
        builder.AddFacesToMesh(mesh, indices.length / 3, indices);
        const part = { vertex: vertex.view, index, attributes: [], idAttribute: 0, data: '' };
        let offset = 0;
        for (const attr of vertex.attributes) {
            if (attr.name === 'a_color') { part.attributes.push({ omitted: true, name: attr.name, offset, components: 4, integer: false, defaultValue: 1 }); offset += 16; continue; }
            if (attr.name === 'a_tangent') { part.attributes.push({ omitted: true, name: attr.name, offset, components: 4, integer: false, defaultValues: [1, 0, 0, 1] }); offset += 16; continue; }
            const bytes = { 32: 12, 21: 8, 44: 16, 42: 8 }[attr.format];
            if (!bytes) throw Error('Unsupported vertex format: ' + attr.format);
            const integer = attr.format === 42, components = bytes / (integer ? 2 : 4);
            const values = integer ? new Uint16Array(vertex.view.count * components) : new Float32Array(vertex.view.count * components);
            for (let i = 0; i < vertex.view.count; i++) for (let k = 0; k < components; k++) {
                const at = vertex.view.offset + i * vertex.view.stride + offset + k * (integer ? 2 : 4);
                values[i * components + k] = integer ? data.readUInt16LE(at) : data.readFloatLE(at);
            }
            const referencePart = reference?.struct.vertexBundles.find(v => v.view.count === vertex.view.count && JSON.stringify(v.attributes) === JSON.stringify(vertex.attributes));
            const step = attr.name === 'a_position' ? 32768 : attr.name === 'a_texCoord' ? 4096 : attr.name === 'a_weights' ? 4096 : 1024;
            if (referencePart && attr.name !== 'a_position') {
                const residual = new Int32Array(values.length);
                for (let i = 0; i < vertex.view.count; i++) for (let k = 0; k < components; k++) {
                    const at = referencePart.view.offset + i * referencePart.view.stride + offset + k * (integer ? 2 : 4);
                    residual[i * components + k] = integer ? values[i * components + k] - reference.data.readUInt16LE(at)
                        : Math.round((values[i * components + k] - reference.data.readFloatLE(at)) * step);
                }
                const id = builder.AddInt32Attribute(mesh, attr.name === 'a_position' ? module.POSITION : module.GENERIC, vertex.view.count, components, residual);
                part.attributes.push({ id, offset, components, integer, name: attr.name, residual: { resource: reference.name, offset: referencePart.view.offset, stride: referencePart.view.stride, step: integer ? 1 : step } });
                offset += bytes;
                continue;
            }
            const type = attr.name === 'a_position' ? module.POSITION : attr.name === 'a_normal' ? module.NORMAL : attr.name === 'a_texCoord' ? module.TEX_COORD : module.GENERIC;
            const id = integer ? builder.AddUInt16Attribute(mesh, type, vertex.view.count, components, values)
                : builder.AddFloatAttributeToMesh(mesh, type, vertex.view.count, components, values);
            part.attributes.push({ id, offset, components, integer, name: attr.name });
            offset += bytes;
        }
        if (offset !== vertex.view.stride) throw Error('Unexpected vertex stride');
        part.idAttribute = builder.AddUInt32Attribute(mesh, module.GENERIC, vertex.view.count, 1, Uint32Array.from({ length: vertex.view.count }, (_, i) => i));
        encoder.SetEncodingMethod(sequential ? module.MESH_SEQUENTIAL_ENCODING : module.MESH_EDGEBREAKER_ENCODING);
        encoder.SetSpeedOptions(0, 0);
        for (const [type, bits] of [[module.POSITION, 8], [module.NORMAL, 6], [module.TEX_COORD, 8], [module.GENERIC, 10]]) encoder.SetAttributeQuantization(type, bits);
        const encoded = new module.DracoInt8Array();
        const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
        if (length <= 0) throw Error('Draco encode failed');
        part.data = Buffer.from(Int8Array.from({ length }, (_, i) => encoded.GetValue(i))).toString('base64');
        description.parts.push(part);
        for (const object of [encoded, encoder, builder, mesh]) module.destroy(object);
    }
    // Validate the exact shipping decoder, topology, joint indices and bounded attributes.
    let roundtrip;
    try { roundtrip = Buffer.from(decode(decoder, description, reference ? { [reference.name]: reference.data } : {})); }
    catch (error) {
        // Sequential encoding also retains degenerate faces and isolated vertices.
        if (!sequential) return encode(struct, data, true, reference);
        throw error;
    }
    let maxPositionError = 0, maxWeightError = 0;
    for (const part of description.parts) {
        for (const attr of part.attributes) for (let i = 0; i < part.vertex.count; i++) for (let k = 0; k < attr.components; k++) {
            const at = part.vertex.offset + i * part.vertex.stride + attr.offset + k * (attr.integer ? 2 : 4);
            if (attr.integer) { if (roundtrip.readUInt16LE(at) !== data.readUInt16LE(at)) throw Error('Joint index changed'); }
            else {
                const error = Math.abs(roundtrip.readFloatLE(at) - data.readFloatLE(at));
                if (attr.name === 'a_position') maxPositionError = Math.max(maxPositionError, error);
                if (attr.name === 'a_weights') maxWeightError = Math.max(maxWeightError, error);
            }
        }
        const triangles = input => {
            const rows = [];
            for (let i = 0; i < part.index.count; i += 3) {
                const ids = Array.from({ length: 3 }, (_, k) => part.index.stride === 2 ? input.readUInt16LE(part.index.offset + (i + k) * 2) : input.readUInt32LE(part.index.offset + (i + k) * 4));
                const pivot = ids.indexOf(Math.min(...ids)); rows.push([...ids.slice(pivot), ...ids.slice(0, pivot)].join(','));
            }
            return rows.sort().join(';');
        };
        if (triangles(data) !== triangles(roundtrip)) throw Error('Mesh faces changed');
    }
    if (maxWeightError > .001) throw Error('Skin weight error exceeds tolerance');
    if (maxPositionError > .05) throw Error('Position error exceeds tolerance');
    return { description, maxPositionError, maxWeightError };
};
