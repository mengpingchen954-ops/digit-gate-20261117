import json, pathlib, sys, types
package=types.ModuleType('io_scene_fbx');package.__path__=[r'D:\blender\3.6\scripts\addons\io_scene_fbx'];sys.modules['io_scene_fbx']=package
from io_scene_fbx import parse_fbx
source = pathlib.Path(r'C:\Users\liuzujun\Desktop\boss\sangshi_tufu_2_skin.fbx')
root, version = parse_fbx.parse(str(source))
objects = next(n for n in root.elems if n.id == b'Objects')
result = []
for obj in objects.elems:
    if obj.id != b'Geometry' or obj.props[-1] != b'Mesh': continue
    lookup = {n.id:n for n in obj.elems}
    raw = lookup[b'Vertices'].props[0]
    coords = [raw[i:i+3] for i in range(0, len(raw), 3)]
    adjacent = {i: set() for i in range(len(coords))}
    polygons=[]; poly=[]
    for i in lookup[b'PolygonVertexIndex'].props[0]:
        poly.append(i if i>=0 else ~i)
        if i<0:
            polygons.append(poly); poly=[]
    for poly in polygons:
        for a,b in zip(poly,poly[1:]+poly[:1]): adjacent[a].add(b); adjacent[b].add(a)
    remaining=set(adjacent); islands=[]
    while remaining:
        pending=[min(remaining)];seen=set()
        while pending:
            i=pending.pop()
            if i in seen: continue
            seen.add(i);pending.extend(adjacent[i]-seen)
        remaining-=seen
        points=[coords[i] for i in seen]
        islands.append({'id':len(islands),'vertices':len(seen),'min':[round(min(p[k] for p in points),3) for k in range(3)],'max':[round(max(p[k] for p in points),3) for k in range(3)]})
    result.append({'name':str(obj.props[1]),'vertices':len(coords),'polygons':len(polygons),'islands':islands})
pathlib.Path('tools/backups/boss-import/geometry-inspect.json').write_text(json.dumps(result,indent=2),encoding='utf8')
print(json.dumps(result))
