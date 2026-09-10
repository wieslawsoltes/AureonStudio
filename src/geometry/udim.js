/** Deterministic multi-tile UV packing with a shared texel scale and optional
 * quarter-turn rotation. UV seams must already be split into vertex sectors. */
import {cloneMesh} from './mesh.js';
import {uvIslands} from './uv.js';
import {udimCoordinates} from '../materials/udim.js';
export function packUDIM(input,{tiles=[1001],padding=.02,rotate=true}={}){
 if(!Array.isArray(tiles)||!tiles.length||tiles.length>256||new Set(tiles).size!==tiles.length||!Number.isFinite(padding)||padding<0||padding>=.25)throw Error('Invalid UDIM packing settings');const origins=tiles.map(udimCoordinates),m=cloneMesh(input),charts=uvIslands(input).map(x=>[...x]);m.uvCharts=charts;
 const used=new Map(),boxes=charts.map((faces,index)=>{const ids=[...new Set(faces.flatMap(f=>m.faces[f]))];for(const id of ids){if(used.has(id)&&used.get(id)!==index)throw Error('Split shared UV seams before packing');used.set(id,index);}const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(const id of ids)for(let k=0;k<2;k++){min[k]=Math.min(min[k],m.uvs[id*2+k]);max[k]=Math.max(max[k],m.uvs[id*2+k]);}return {index,ids,min,w:Math.max(1e-8,max[0]-min[0]),h:Math.max(1e-8,max[1]-min[1])};}).filter(b=>b.ids.length).sort((a,b)=>Math.max(b.w,b.h)-Math.max(a.w,a.h)||b.w*b.h-a.w*a.h||a.index-b.index);
 if(!boxes.length)return {mesh:m,scale:1,assignments:[]};
 // Guillotine rectangles avoid overlaps by construction; global binary search
 // preserves relative island sizes instead of stretching individual charts.
 function place(scale){const free=origins.map(()=>[{x:padding,y:padding,w:1-2*padding,h:1-2*padding}]),placed=[];
  for(const b of boxes){let best=null;for(let tile=0;tile<free.length;tile++)for(let r=0;r<free[tile].length;r++)for(let turn=0;turn<(rotate?2:1);turn++){const w=(turn?b.h:b.w)*scale,h=(turn?b.w:b.h)*scale,f=free[tile][r];if(w<=f.w+1e-12&&h<=f.h+1e-12){const score=Math.min(f.w-w,f.h-h);if(!best||score<best.score)best={tile,r,turn,w,h,score};}}if(!best)return null;
   const {tile,r,turn,w,h}=best,f=free[tile].splice(r,1)[0];placed.push({index:b.index,tile:tiles[tile],origin:[origins[tile][0]+f.x,origins[tile][1]+f.y],turn,w,h});const rw=f.w-w-padding,rh=f.h-h-padding;
   if(rw>0)free[tile].push({x:f.x+w+padding,y:f.y,w:rw,h:h});if(rh>0)free[tile].push({x:f.x,y:f.y+h+padding,w:f.w,h:rh});
  }return placed;
 }
 let low=0,high=(1-2*padding)/Math.max(...boxes.map(b=>Math.max(b.w,b.h)));for(let i=0;i<42;i++){const mid=(low+high)/2;place(mid)?low=mid:high=mid;}const assignments=place(low);if(!assignments||low<1e-12)throw Error('Not enough tile space at this padding');const byIndex=new Map(assignments.map(a=>[a.index,a]));
 for(const b of boxes){const a=byIndex.get(b.index);for(const id of b.ids){const x=m.uvs[id*2]-b.min[0],y=m.uvs[id*2+1]-b.min[1];m.uvs[id*2]=a.origin[0]+(a.turn?b.h-y:x)*low;m.uvs[id*2+1]=a.origin[1]+(a.turn?x:y)*low;}}
 return {mesh:m,scale:low,assignments};
}
