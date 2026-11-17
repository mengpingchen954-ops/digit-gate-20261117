"""保留原始骨骼、权重和 UV；身体使用压缩贴图，刀刃和刀柄分色，移除辅助网格。"""
import pathlib, sys, types, array, json
package=types.ModuleType('io_scene_fbx');package.__path__=[r'D:\blender\3.6\scripts\addons\io_scene_fbx'];sys.modules['io_scene_fbx']=package
from io_scene_fbx import parse_fbx, encode_bin, data_types
root, version=parse_fbx.parse(r'C:\Users\liuzujun\Desktop\boss\sangshi_tufu_2_skin.fbx')
def convert(n):
    out=encode_bin.FBXElem(n.id)
    methods={b'C':'add_bool',b'Y':'add_int16',b'I':'add_int32',b'L':'add_int64',b'F':'add_float32',b'D':'add_float64',b'R':'add_bytes',b'S':'add_string',b'i':'add_int32_array',b'l':'add_int64_array',b'f':'add_float32_array',b'd':'add_float64_array',b'b':'add_bool_array',b'c':'add_byte_array'}
    for t,value in zip(n.props_type,n.props):getattr(out,methods[bytes([t])])(value)
    out.elems=[convert(c) for c in n.elems]
    return out
objects=next(n for n in root.elems if n.id==b'Objects')
connections=next(n for n in root.elems if n.id==b'Connections')
byid={n.props[0]:n for n in objects.elems}
body=next(n for n in objects.elems if n.id==b'Model' and n.props[1].startswith(b'sangshi_tufu\x00'))
weapon=next(n for n in objects.elems if n.id==b'Model' and n.props[1].startswith(b'sangshi_tufu_wuqi\x00'))
geometries={n.props[2]:byid[n.props[1]] for n in connections.elems if n.props[0]==b'OO' and n.props[1] in byid and byid[n.props[1]].id==b'Geometry'}
# 配色接近参考：肉色、橄榄围裙、深绿裤子、粉色头顶、棕皮具、深灰刀刃、米色骨片。
palette=[('Body',(1.,1.,1.)),('Weapon',(1.,1.,1.))]
def classify(p, influences):
    x,y,z=p;ax=abs(x)
    if sum(w for name,w in influences.items() if 'Hand' in name or 'Finger' in name)>.4:return 4
    if sum(w for name,w in influences.items() if 'UpperArm' in name or 'Forearm' in name)>.4:return 0
    if z<15:return 4
    if z<43:return 2
    if z<50:return 4
    if z>117:return 3
    if z>109:
        if ax>14 and ax<25:return 0
        return 3 if y>-51 else 6
    if z>97 and ax<23:return 1
    if ax>76:return 4
    if ax>37:return 0
    # 肩部露肤，胸前和背部围裙保持整块颜色。
    if z>88 and ax>22:return 0
    return 1
material_ids=[9000000000+i for i in range(len(palette))]
removed={n.props[0] for n in objects.elems if n.id in [b'Material',b'Texture',b'Video'] or n.id==b'Model' and n.props[1].split(b'\x00')[0] in [b'Cylinder001',b'Plane001']}
for model_id in list(removed):
    if model_id in geometries:removed.add(geometries[model_id].props[0])
out=convert(root);out_objects=next(n for n in out.elems if n.id==b'Objects');out_connections=next(n for n in out.elems if n.id==b'Connections')
converted={original.props[0]:n for original,n in zip(objects.elems,out_objects.elems)}
out_objects.elems=[n for ident,n in converted.items() if ident not in removed]
out_connections.elems=[n for original,n in zip(connections.elems,out_connections.elems) if original.props[1] not in removed and original.props[2] not in removed]
def child(parent,name,values):
    n=encode_bin.FBXElem(name);parent.elems.append(n)
    for kind,value in values:getattr(n,'add_'+kind)(value)
    return n
for i,(name,color) in enumerate(palette):
    m=child(out_objects,b'Material',[('int64',material_ids[i]),('string',name.encode()+b'\x00\x01Material'),('string',b'')])
    child(m,b'Version',[('int32',102)]);child(m,b'ShadingModel',[('string',b'lambert')]);child(m,b'MultiLayer',[('int32',0)])
    properties=child(m,b'Properties70',[])
    child(properties,b'P',[('string',b'DiffuseColor'),('string',b'Color'),('string',b''),('string',b'A')]+[('float64',v) for v in color])
    for target in [body,weapon]:child(out_connections,b'C',[('string',b'OO'),('int64',material_ids[i]),('int64',target.props[0])])
stats={}
for model in [body,weapon]:
    geom=geometries[model.props[0]];lookup={n.id:n for n in geom.elems};raw=lookup[b'Vertices'].props[0]
    coords=[raw[i:i+3] for i in range(0,len(raw),3)];poly=[];indices=[]
    skin_ids={n.props[1] for n in connections.elems if n.props[2]==geom.props[0] and n.props[1] in byid and byid[n.props[1]].props[-1]==b'Skin'}
    cluster_ids={n.props[1] for n in connections.elems if n.props[2] in skin_ids}
    vertex_weights=[{} for _ in coords]
    for ident in cluster_ids:
        cluster=byid[ident];clook={n.id:n for n in cluster.elems}
        bones=[byid[n.props[1]] for n in connections.elems if n.props[2]==ident and n.props[1] in byid and byid[n.props[1]].id==b'Model']
        if not bones:continue
        name=bones[0].props[1].split(b'\x00')[0].decode()
        for vi,w in zip(clook[b'Indexes'].props[0],clook[b'Weights'].props[0]):vertex_weights[vi][name]=w
    for value in lookup[b'PolygonVertexIndex'].props[0]:
        poly.append(value if value>=0 else ~value)
        if value<0:
            center=[sum(coords[v][k] for v in poly)/len(poly) for k in range(3)]
            influences={}
            for vi in poly:
                for bone,w in vertex_weights[vi].items():influences[bone]=influences.get(bone,0)+w/len(poly)
            indices.append(0 if model is body else 1);poly=[]
    target=converted[geom.props[0]]
    target.elems=[n for n in target.elems if n.id!=b'LayerElementMaterial']
    layer=child(target,b'LayerElementMaterial',[('int32',0)])
    child(layer,b'Version',[('int32',101)]);child(layer,b'Name',[('string',b'')]);child(layer,b'MappingInformationType',[('string',b'ByPolygon')]);child(layer,b'ReferenceInformationType',[('string',b'IndexToDirect')]);child(layer,b'Materials',[('int32_array',array.array(data_types.ARRAY_INT32,indices))])
    stats[model.props[1].split(b'\x00')[0].decode()]={palette[i][0]:indices.count(i) for i in set(indices)}
dest=pathlib.Path('assets/模型/Boss/屠夫/屠夫_模型.fbx');encode_bin.write(str(dest),out,version)
print(json.dumps({'file':str(dest),'bytes':dest.stat().st_size,'materials':stats},ensure_ascii=False))

