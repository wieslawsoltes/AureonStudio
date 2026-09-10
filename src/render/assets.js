import {validateFiber} from '../materials/fiber.js';
/** One packed asset buffer preserves WebGPU's baseline eight-storage-buffer limit.
 * Material graph instruction offsets stay unchanged. Metadata and sparse volume
 * leaf tables follow the graph code, with explicit descriptor offsets in Camera.
 */
import {compileGraphs} from '../materials/graph.js';
import {flattenTextures} from '../materials/udim.js';
import {validateVolume,volumeTransform} from '../volumes/grid.js';
import {inverse} from '../core/math.js';
export function compileSceneAssets(doc){
    const graphs=compileGraphs(doc.materials),{sources,descriptors}=flattenTextures(doc.textures||[]),parts=[graphs.data];let floats=graphs.data.length;
    const append=data=>{const start=floats;const aligned=new Float32Array(Math.ceil(data.length/16)*16);aligned.set(data);parts.push(aligned);floats+=aligned.length;if(floats*4>128*1024*1024)throw Error('Scene asset buffer exceeds 128 MiB');return start;};
    const textureOffset=floats/16,textureRecords=new Float32Array(Math.max(1,descriptors.length)*16);append(textureRecords);const actualTextureRecords=parts.at(-1);
    descriptors.forEach((d,i)=>{const record=i*16;actualTextureRecords[record]=d.kind;actualTextureRecords[record+1]=d.layer||0;actualTextureRecords[record+2]=d.tiles.length;actualTextureRecords.set(d.missing||[0,0,0,0],record+8);if(d.tiles.length){const count=Math.max(...d.tiles.map(t=>t.v*10+t.u))+1,table=new Float32Array(count);for(const t of d.tiles)table[t.v*10+t.u]=t.layer+1;actualTextureRecords[record+2]=count;actualTextureRecords[record+3]=append(table);}});
    const volumes=(doc.volumes||[]).filter(v=>v.enabled!==false);if(volumes.length>32)throw Error('A scene supports at most 32 simultaneous volume regions');volumes.forEach(validateVolume);
    const volumeOffset=floats/16;append(new Float32Array(Math.max(1,volumes.length)*48));const records=parts.at(-1);let boundsMin=[Infinity,Infinity,Infinity],boundsMax=[-Infinity,-Infinity,-Infinity];
    volumes.forEach((v,i)=>{const off=i*48,g=v.grid,dims=g?.dimensions||[1,1,1],matrix=volumeTransform(v),scale=v.density??1;let maximum=g?0:1,kind=g?.blocks?2:g?1:0,dataOffset=0,leafOffset=0;
        if(g?.data){for(const value of g.data)maximum=Math.max(maximum,value);dataOffset=append(g.data);}
        if(g?.blocks){const rootDims=dims.map(x=>Math.ceil(x/8)),size=rootDims.reduce((a,b)=>a*b,1);if(size>1048576)throw Error('Sparse volume root table exceeds one million cells');const table=new Float32Array(size);const leaves=new Float32Array(g.blocks.length*512);g.blocks.forEach((b,j)=>{table[(b.coord[2]*rootDims[1]+b.coord[1])*rootDims[0]+b.coord[0]]=j+1;leaves.set(b.values,j*512);for(const value of b.values)maximum=Math.max(maximum,value);});dataOffset=append(table);leafOffset=append(leaves);}
        records.set([...dims,kind],off);records.set([dataOffset,leafOffset,scale,maximum*scale*(1+2e-6)],off+4);records.set([...(v.color||[1,1,1]),v.anisotropy||0],off+8);records.set([...(v.emission||[0,0,0]),v.replace?1:0],off+12);records.set(inverse(matrix),off+16);records.set([v.priority||0,0,0,0],off+32);
        for(let z=0;z<2;z++)for(let y=0;y<2;y++)for(let x=0;x<2;x++){const p=[x?dims[0]-.5:-.5,y?dims[1]-.5:-.5,z?dims[2]-.5:-.5];for(let k=0;k<3;k++){const value=matrix[k]*p[0]+matrix[k+4]*p[1]+matrix[k+8]*p[2]+matrix[k+12];boundsMin[k]=Math.min(boundsMin[k],value);boundsMax[k]=Math.max(boundsMax[k],value);}}
    });
    const materialOffset=floats/16,materialRecords=new Float32Array(doc.materials.length*16);doc.materials.forEach((m,i)=>{const absorption=m.absorption||[0,0,0];if(absorption.length!==3||absorption.some(x=>!Number.isFinite(x)||x<0))throw Error('Invalid interior absorption coefficients');const f=m.fiber;if(f)validateFiber(f);materialRecords.set([...absorption,f?1:0,...(f?.absorption??[.5,1,2]),f?.ior??1.55,f?.roughness??.3,f?.azimuthalRoughness??.3,f?.tilt??2,0,0,0,0,0],i*16);});append(materialRecords);
    const data=new Float32Array(floats);let offset=0;parts.forEach(p=>{data.set(p,offset);offset+=p.length;});return {data,sources,textureOffset,textureCount:descriptors.length,volumeOffset,volumeCount:volumes.length,materialOffset,volumeBounds:volumes.length?{min:boundsMin,max:boundsMax}:null};
}
