// Runs automatically after Creator + SuperHTML. All resources remain in one HTML.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('../extensions/super-html/node_modules/jszip');
const sharp = require('sharp');
const encode = require('./mesh-codec/encode.cjs');
const decode = require('./mesh-codec/decode.js');
const createDecoder = require('./mesh-codec/draco_decoder_nodejs');
const lzma = require('./mesh-codec/lzma_worker.cjs').LZMA_WORKER;
const packResources = require('./resource-pack.cjs');
const root = path.resolve(__dirname, '..');
module.exports = async function finalize(html) {
    const match = /window\.__zip\s*=\s*"([A-Za-z0-9+/=]+)"/.exec(html);
    if (!match) throw Error('SuperHTML resource ZIP missing');
    const archive = await JSZip.loadAsync(match[1], { base64: true });
    const resources = {};
    for (const [name, entry] of Object.entries(archive.files)) {
        if (entry.dir) continue;
        const data = await entry.async('string');
        if (name === '__res') Object.assign(resources, JSON.parse(data));
        else resources[name] = data;
    }
    const index = Object.keys(resources).find(n => /^index[^/]*\.js$/.test(n));
    const offsetMatch = /window\.oasjidx=(\d+);/.exec(resources[index]);
    if (!offsetMatch) throw Error('SuperHTML obfuscation offset missing');
    const offset = Number(offsetMatch[1]);
    resources[index] = resources[index].replace(offsetMatch[0], 'window.oasjidx=0;');
    for (const name of Object.keys(resources)) {
        const data = resources[name];
        if (data.startsWith('data:')) resources[name] = data.slice(0, offset) + data.slice(offset + 1);
    }
    const report = { meshes: [], images: [], aliases: 0 };
    const settingsName = Object.keys(resources).find(n => /^src\/settings(?:\.[\w-]+)?\.json$/.test(n));
    const settings = JSON.parse(resources[settingsName]);
    // 部分 Creator 账号无法导出自定义插屏，由同一构建入口按项目配置补齐。
    if (!settings.splashScreen) throw Error('构建未启用插屏');
    const splashSource = fs.readFileSync(path.join(root, 'settings/logo.png'));
    const splashWebp = await sharp(splashSource).webp({ lossless: true, effort: 6 }).toBuffer();
    const splash = splashWebp.length < splashSource.length ? splashWebp : splashSource;
    settings.splashScreen.logo = { type: 'custom', base64: 'data:image/' + (splash === splashWebp ? 'webp' : 'png') + ';base64,' + splash.toString('base64') };
    settings.splashScreen.displayRatio = 2;
    settings.splashScreen.totalTime = 2000;
    settings.splashScreen.background = { type: 'default', color: { x: 0, y: 0, z: 0, w: 1 } };
    resources[settingsName] = JSON.stringify(settings);
    report.splash = { sourceBytes: splashSource.length, storedBytes: splash.length, lossless: true, totalTime: settings.splashScreen.totalTime };
    // 丧尸图集保持原始 PNG：禁止缩图、纹理有损压缩和打包二次转码。
    const zombiePath = path.join(root, 'assets/角色序列帧/快速丧尸/动作图集.png');
    const zombieUuid = JSON.parse(fs.readFileSync(zombiePath + '.meta', 'utf8')).uuid;
    const zombieEntries = Object.entries(resources).filter(([name]) => name.includes(zombieUuid) && /\.(png|webp|jpe?g)$/.test(name));
    if (zombieEntries.length !== 1) throw Error('丧尸原始图集缺失或被重复打包');
    const [zombieName, zombieValue] = zombieEntries[0];
    const zombieBytes = Buffer.from(zombieValue.slice(zombieValue.indexOf(',') + 1), 'base64');
    if (!zombieValue.startsWith('data:image/png;base64,') || !zombieBytes.equals(fs.readFileSync(zombiePath))) {
        throw Error('丧尸图集与源 PNG 不一致，禁止降低丧尸图集质量');
    }
    report.zombieAtlas = { name: zombieName, bytes: zombieBytes.length, width: zombieBytes.readUInt32BE(16), height: zombieBytes.readUInt32BE(20), sha256: crypto.createHash('sha256').update(zombieBytes).digest('hex'), preservedOriginal: true };
    const cache = path.join(root, 'temp/google-mesh-cache'); fs.mkdirSync(cache, { recursive: true });
    const decoder = await createDecoder({}), references = [], decoded = {}, meshOrder = [];
    const ordered = Object.entries(resources).sort(([a],[b]) => a.includes('70c572b2') ? -1 : b.includes('70c572b2') ? 1 : a.localeCompare(b));
    for (const [name, value] of ordered) {
        if (!/\/native\/.*\.bin$/.test(name) || !value.startsWith('data:')) continue;
        const uuid = path.basename(name, '.bin');
        const library = path.join(root, 'library', uuid.slice(0, 2), uuid + '.json');
        if (!fs.existsSync(library)) continue;
        const mesh = JSON.parse(fs.readFileSync(library, 'utf8'));
        if (mesh.__type__ !== 'cc.Mesh' || mesh._struct.morph) continue;
        const raw = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
        if (raw.length < 100000) continue;
        // Match the actual build to the import structure before encoding.
        if (!raw.equals(fs.readFileSync(library.replace(/\.json$/, '.bin')))) throw Error('Build/import mesh mismatch: ' + uuid);
        const reference = references.find(r => mesh._struct.vertexBundles.filter(v => r.struct.vertexBundles.some(w => w.view.count === v.view.count)).length > 3);
        const signature = crypto.createHash('sha256').update(raw).update(JSON.stringify(mesh._struct)).update(fs.readFileSync(path.join(__dirname, 'mesh-codec/encode.cjs'))).update(fs.readFileSync(path.join(__dirname, 'mesh-codec/decode.js'))).update(reference?.data || '').digest('hex');
        const saved = path.join(cache, signature + '.json');
        let result = fs.existsSync(saved) ? JSON.parse(fs.readFileSync(saved)) : await encode(mesh._struct, raw, false, reference);
        if (!result) continue;
        if (!fs.existsSync(saved)) fs.writeFileSync(saved, JSON.stringify(result));
        decoded[name] = Buffer.from(decode(decoder, result.description, decoded));
        references.push({ name, struct: mesh._struct, data: decoded[name] }); meshOrder.push(name);
        resources[name] = JSON.stringify(result.description);
        report.meshes.push({ name, originalBytes: raw.length, storedBytes: Buffer.byteLength(resources[name]), triangles: mesh._struct.primitives.reduce((n,p) => n + p.indexView.count / 3, 0), maxPositionError: result.maxPositionError, maxWeightError: result.maxWeightError });
        console.log('网格存储压缩：' + uuid + '，保留 ' + report.meshes.at(-1).triangles + ' 个三角形');
    }
    // Cube maps generated by Creator have no independent source image: transcode here.
    for (const [name, value] of Object.entries(resources)) {
        if (name === zombieName) continue;
        if (!value.startsWith('data:image/png;') && !value.startsWith('data:image/jpeg;')) continue;
        const raw = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
        const output = await sharp(raw).webp({ quality: 70, alphaQuality: 90, effort: 6 }).toBuffer();
        if (output.length >= raw.length) continue;
        resources[name] = 'data:image/webp;base64,' + output.toString('base64');
        report.images.push({ name, before: raw.length, after: output.length });
    }
    const aliases = {}, unique = new Map();
    for (const [name, value] of Object.entries(resources)) {
        if (!value.startsWith('data:')) continue;
        const hash = crypto.createHash('sha256').update(value).digest('hex');
        if (unique.has(hash)) { aliases[name] = unique.get(hash); delete resources[name]; report.aliases++; }
        else unique.set(hash, name);
    }
    resources['digitgate-decoder.js'] = fs.readFileSync(path.join(__dirname, 'mesh-codec/draco_decoder_nodejs.js'), 'utf8');
    resources['digitgate-decoder.wasm'] = fs.readFileSync(path.join(__dirname, 'mesh-codec/draco_decoder.wasm')).toString('base64');
    resources['digitgate-decode.js'] = fs.readFileSync(path.join(__dirname, 'mesh-codec/decode.js'), 'utf8');
    const payload = packResources(resources);
    const comparisonZip = new JSZip(); comparisonZip.file('__res', payload);
    const deflateBytes = (await comparisonZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })).length;
    console.log('整体 LZMA 无损压缩：' + payload.length + ' B 资源表');
    const lzmaBytes = await new Promise((resolve, reject) => lzma.compress(Array.from(payload), 9, (result, error) => error ? reject(Error('LZMA compress failed: ' + error)) : resolve(Buffer.from(result.map(value => value & 255)) )));
    report.compression = { codec: 'lzma', resourceFormat: 'binary-v1', resourceBytes: payload.length, compressedBytes: lzmaBytes.length, sameResourcesZipDeflateBytes: deflateBytes, savedBytes: deflateBytes - lzmaBytes.length };
    const tiny = new JSZip();
    tiny.file('__res', JSON.stringify({ 'digitgate-lzma.js': fs.readFileSync(path.join(__dirname, 'mesh-codec/lzma_worker-min.js'), 'utf8') }));
    const encoded = await tiny.generateAsync({ type: 'base64', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    html = html.slice(0, match.index) + match[0].replace(match[1], () => encoded) + `\nwindow.__digitGateLzma="${lzmaBytes.toString('base64')}";` + html.slice(match.index + match[0].length);
    const bootstrap = `
${fs.readFileSync(path.join(__dirname, 'resource-unpack.js'), 'utf8')}
const digitGateOriginalBoot=super_boot;
super_boot=async function(){
  try{
    const resources=window.__res;
    (0,eval)(resources['digitgate-lzma.js']);
    const compressedResources=Uint8Array.from(atob(window.__digitGateLzma),c=>c.charCodeAt(0));
    const resourceBytes=await new Promise((resolve,reject)=>LZMA.decompress(Array.from(compressedResources),(result,error)=>error?reject(Error('LZMA resource decode failed: '+error)):resolve(result)));
    Object.assign(resources,unpackDigitGateResources(resourceBytes));
    for(const [name,target] of Object.entries(${JSON.stringify(aliases)}))resources[name]=resources[target];
    delete resources['digitgate-lzma.js'];
    (0,eval)(resources['digitgate-decoder.js']);(0,eval)(resources['digitgate-decode.js']);
    const binary=Uint8Array.from(atob(resources['digitgate-decoder.wasm']),c=>c.charCodeAt(0));
    const decoder=await DracoDecoderModule({wasmBinary:binary});
    const decoded={};
    for(const name of ${JSON.stringify(meshOrder)}){
      const bytes=decodeDigitGateMesh(decoder,JSON.parse(resources[name]),decoded);decoded[name]=bytes;
      let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
      resources[name]='data:application/octet-stream;base64,'+btoa(text);
    }
    delete resources['digitgate-decoder.js'];delete resources['digitgate-decoder.wasm'];delete resources['digitgate-decode.js'];
    digitGateOriginalBoot();
  }catch(error){console.error('Game resource decode failed',error);throw error;}
};
super_load();`;
    const callAt = html.lastIndexOf('super_load();');
    if (callAt < 0) throw Error('SuperHTML boot entry missing');
    html = html.slice(0, callAt) + bootstrap + html.slice(callAt + 'super_load();'.length);
    return { html, report };
};
