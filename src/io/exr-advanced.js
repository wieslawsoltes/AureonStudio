/** OpenEXR flat scanline codec: HALF/FLOAT/UINT, NONE/ZIPS/ZIP and multipart.
 * Uses the browser's standards-based zlib streams; no Node imports or CDN code.
 * https://openexr.com/en/latest/OpenEXRFileLayout.html
 * Deep/tiled/PIZ/DWA images are rejected, never silently flattened or relabeled.
 */
const utf8=new TextEncoder(),text=new TextDecoder();
const MAX_BYTES=512*1024*1024,MAX_PIXELS=64*1024*1024;
class Bytes {
    constructor(){this.parts=[];this.length=0;}
    put(b){this.parts.push(b);this.length+=b.length;if(this.length>MAX_BYTES)throw Error('EXR exceeds 512 MiB codec budget');return this;}
    n(v,kind='u32'){const size=kind==='u64'?8:kind==='u8'?1:4,b=new Uint8Array(size),d=new DataView(b.buffer);if(kind==='u8')b[0]=v;else if(kind==='u64')d.setBigUint64(0,BigInt(v),true);else if(kind==='f32')d.setFloat32(0,v,true);else if(kind==='i32')d.setInt32(0,v,true);else d.setUint32(0,v,true);return this.put(b);}
    str(s){return this.put(utf8.encode(s)).n(0,'u8');}
    finish(){const b=new Uint8Array(this.length);let o=0;for(const p of this.parts){b.set(p,o);o+=p.length;}return b;}
}
class Reader {
    constructor(input){this.b=input instanceof Uint8Array?input:new Uint8Array(input);this.v=new DataView(this.b.buffer,this.b.byteOffset,this.b.byteLength);this.p=0;if(this.b.length>MAX_BYTES)throw Error('EXR file exceeds codec budget');}
    need(n){if(!Number.isSafeInteger(n)||n<0||this.p+n>this.b.length)throw Error('Truncated EXR');}
    n(kind='u32'){const size=kind==='u64'?8:4;this.need(size);const v=kind==='u64'?Number(this.v.getBigUint64(this.p,true)):kind==='i32'?this.v.getInt32(this.p,true):this.v.getUint32(this.p,true);this.p+=size;if(!Number.isSafeInteger(v))throw Error('EXR offset exceeds integer range');return v;}
    str(){const start=this.p;while(this.p<this.b.length&&this.b[this.p]){if(this.p-start>255)throw Error('EXR name exceeds 255 bytes');this.p++;}this.need(1);return text.decode(this.b.subarray(start,this.p++));}
    take(n){this.need(n);const a=this.b.subarray(this.p,this.p+n);this.p+=n;return a;}
}
const floatBits=new DataView(new ArrayBuffer(4));
export function floatToHalf(x){
    floatBits.setFloat32(0,x,false);const bits=floatBits.getUint32(0,false),sign=(bits>>>16)&0x8000,e=(bits>>>23)&255,m=bits&0x7fffff;
    if(e===255)return sign|(m?0x7e00:0x7c00);
    if(e>142)return sign|0x7c00;if(e<102)return sign;
    const shift=e<113?126-e:13,significand=e<113?(m|0x800000):m;
    let value=significand>>>shift,rest=significand&((1<<shift)-1),mid=1<<(shift-1);
    if(rest>mid||(rest===mid&&(value&1)))value++;
    return sign|((e<113?0:(e-112)<<10)+value);
}
export function halfToFloat(h){const sign=h&0x8000?-1:1,e=(h>>>10)&31,m=h&1023;return sign*(e===0?m*2**-24:e===31?m?NaN:Infinity:(1+m/1024)*2**(e-15));}
export function zipPredict(raw){const shuffled=new Uint8Array(raw.length);let a=0,b=Math.ceil(raw.length/2);for(let i=0;i<raw.length;i++)shuffled[i&1?b++:a++]=raw[i];for(let i=shuffled.length-1;i>0;i--)shuffled[i]=(shuffled[i]-shuffled[i-1]+128)&255;return shuffled;}
export function zipUnpredict(input){const shuffled=input.slice();for(let i=1;i<shuffled.length;i++)shuffled[i]=(shuffled[i-1]+shuffled[i]-128)&255;const raw=new Uint8Array(shuffled.length);let a=0,b=Math.ceil(raw.length/2);for(let i=0;i<raw.length;i++)raw[i]=shuffled[i&1?b++:a++];return raw;}
async function zlib(bytes,decode,limit){
    const Constructor=decode?globalThis.DecompressionStream:globalThis.CompressionStream;
    if(!Constructor)throw Error('This environment does not provide zlib compression streams');
    const stream=new Blob([bytes]).stream().pipeThrough(new Constructor('deflate')),reader=stream.getReader(),chunks=[];let n=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.length;if(n>limit){await reader.cancel();throw Error('EXR inflated data exceeds declared dimensions');}chunks.push(value);}}finally{reader.releaseLock();}
    const out=new Uint8Array(n);let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return out;
}
function validName(n){return typeof n==='string'&&n.length>0&&utf8.encode(n).length<=255&&!n.includes('\0');}
function prepare(part,index,defaultCompression){
    const {width,height,channels,metadata={}}=part,xMin=part.xMin??0,yMin=part.yMin??0,name=part.name??`part${index}`;
    if(!validName(name)||![width,height,xMin,yMin].every(Number.isInteger)||width<1||height<1||width*height>MAX_PIXELS||Math.max(Math.abs(xMin),Math.abs(yMin),Math.abs(xMin+width),Math.abs(yMin+height))>0x7fffffff)throw Error('Invalid EXR dimensions/part name');
    const names=Object.keys(channels||{}).sort();if(!names.length||names.length>128||names.some(n=>!validName(n)))throw Error('Invalid EXR channels');
    const types={},sizes={};let rowBytes=0;
    for(const n of names){const a=channels[n],requested=part.types?.[n]??(a instanceof Uint32Array?'UINT':'FLOAT'),type={UINT:0,HALF:1,FLOAT:2}[requested];if(type===undefined||!ArrayBuffer.isView(a)||a.length!==width*height||a.some(v=>!Number.isFinite(v)))throw Error('Invalid EXR channel '+n);if(type===0&&a.some(v=>v<0||v>4294967295||!Number.isInteger(v)))throw Error('UINT channel contains noninteger values');if(type===1&&a.some(v=>Math.abs(v)>65504))throw Error('HALF channel exceeds representable finite range');types[n]=type;sizes[n]=type===1?2:4;rowBytes+=sizes[n]*width;}
    const compression=part.compression??defaultCompression,code={NONE:0,ZIPS:2,ZIP:3}[compression];if(code===undefined)throw Error('Unsupported EXR compression '+compression);
    if(rowBytes*height>MAX_BYTES)throw Error('EXR channels exceed decoded memory budget');
    return {...part,name,width,height,xMin,yMin,channels,metadata,names,types,sizes,rowBytes,code,lines:code===3?16:1,chunkCount:Math.ceil(height/(code===3?16:1))};
}
function header(p,multipart,display){
    const h=new Bytes(),attr=(n,t,b)=>h.str(n).str(t).n(b.length).put(b),channels=new Bytes();
    for(const n of p.names)channels.str(n).n(p.types[n],'i32').put(new Uint8Array(4)).n(1,'i32').n(1,'i32');channels.n(0,'u8');
    attr('channels','chlist',channels.finish());attr('compression','compression',Uint8Array.of(p.code));
    const box=a=>{const b=new Bytes();a.forEach(v=>b.n(v,'i32'));return b.finish();};
    attr('dataWindow','box2i',box([p.xMin,p.yMin,p.xMin+p.width-1,p.yMin+p.height-1]));attr('displayWindow','box2i',box(display));
    attr('lineOrder','lineOrder',Uint8Array.of(0));attr('pixelAspectRatio','float',new Bytes().n(1,'f32').finish());attr('screenWindowCenter','v2f',new Bytes().n(0,'f32').n(0,'f32').finish());attr('screenWindowWidth','float',new Bytes().n(1,'f32').finish());attr('software','string',utf8.encode('Aureon Ray 0.3'));
    if(multipart){attr('name','string',utf8.encode(p.name));attr('type','string',utf8.encode('scanlineimage'));attr('chunkCount','int',new Bytes().n(p.chunkCount,'i32').finish());}
    const reserved=new Set(['channels','compression','dataWindow','displayWindow','lineOrder','pixelAspectRatio','screenWindowCenter','screenWindowWidth','software','name','type','chunkCount']);
    for(const [n,v] of Object.entries(p.metadata)){if(!validName(n))throw Error('Invalid EXR attribute');if(!reserved.has(n))attr(n,'string',utf8.encode(String(v)));}
    return h.n(0,'u8').finish();
}
export async function encodeEXRAdvanced({parts,compression='ZIP',displayWindow,...single}){
    const multipart=Array.isArray(parts);parts=(parts||[single]).map((p,i)=>prepare(p,i,compression));
    if(!parts.length||parts.length>256||new Set(parts.map(p=>p.name)).size!==parts.length)throw Error('Duplicate/invalid EXR parts');
    if(parts.reduce((n,p)=>n+p.rowBytes*p.height,0)>MAX_BYTES)throw Error('EXR parts exceed total memory budget');
    const display=displayWindow||[Math.min(...parts.map(p=>p.xMin)),Math.min(...parts.map(p=>p.yMin)),Math.max(...parts.map(p=>p.xMin+p.width-1)),Math.max(...parts.map(p=>p.yMin+p.height-1))];
    if(display.length!==4||!display.every(Number.isInteger)||display[2]<display[0]||display[3]<display[1])throw Error('Invalid EXR display window');
    const chunks=[],headers=parts.map(p=>header(p,multipart,display)),longNames=parts.some(p=>[p.name,...p.names,...Object.keys(p.metadata)].some(n=>utf8.encode(n).length>31));
    for(let pi=0;pi<parts.length;pi++){const p=parts[pi];for(let y=0;y<p.height;y+=p.lines){const rows=Math.min(p.lines,p.height-y),raw=new Uint8Array(rows*p.rowBytes),dv=new DataView(raw.buffer);let at=0;for(let row=0;row<rows;row++)for(const n of p.names)for(let x=0;x<p.width;x++){const value=p.channels[n][(y+row)*p.width+x];if(p.types[n]===0)dv.setUint32(at,value,true);else if(p.types[n]===1)dv.setUint16(at,floatToHalf(value),true);else dv.setFloat32(at,value,true);at+=p.sizes[n];}
        let packed=raw;if(p.code){const z=await zlib(zipPredict(raw),false,raw.length+65536);if(z.length<raw.length)packed=z;}
        const c=new Bytes();if(multipart)c.n(pi);c.n(y+p.yMin,'i32').n(packed.length).put(packed);chunks.push(c.finish());
    }}
    const out=new Bytes().n(20000630).n(2|(multipart?4096:0)|(longNames?1024:0));headers.forEach(h=>out.put(h));if(multipart)out.n(0,'u8');let offset=out.length+chunks.length*8;chunks.forEach(c=>{out.n(offset,'u64');offset+=c.length;});chunks.forEach(c=>out.put(c));return out.finish();
}
function readHeader(r){const attrs=Object.create(null);for(;;){const name=r.str();if(!name)break;if(Object.hasOwn(attrs,name))throw Error('Duplicate EXR attribute');const type=r.str(),size=r.n();attrs[name]={type,data:r.take(size)};}return attrs;}
function parseHeader(attrs){
    const data=(n,type,size)=>{const a=attrs[n];if(!a||a.type!==type||(size!==undefined&&a.data.length!==size))throw Error('Missing/malformed EXR '+n);return new DataView(a.data.buffer,a.data.byteOffset,a.data.byteLength);};
    const box=data('dataWindow','box2i',16),xMin=box.getInt32(0,true),yMin=box.getInt32(4,true),width=box.getInt32(8,true)-xMin+1,height=box.getInt32(12,true)-yMin+1,code=data('compression','compression',1).getUint8(0);
    if(width<1||height<1||width*height>MAX_PIXELS||![0,2,3].includes(code))throw Error('Unsupported EXR compression or image size');
    if(attrs.type&&text.decode(attrs.type.data)!=='scanlineimage')throw Error('Only flat scanline EXR parts are supported');
    const list=attrs.channels;if(!list||list.type!=='chlist')throw Error('Missing EXR channel list');const c=new Reader(list.data),names=[],types=Object.create(null),sizes=Object.create(null);let rowBytes=0;
    for(;;){const n=c.str();if(!n)break;const type=c.n('i32');c.take(4);const xs=c.n('i32'),ys=c.n('i32');if(names.includes(n)||names.length>=128||![0,1,2].includes(type)||xs!==1||ys!==1)throw Error('Invalid or subsampled EXR channels');names.push(n);types[n]=type;sizes[n]=type===1?2:4;rowBytes+=sizes[n]*width;}
    if(!names.length||rowBytes*height>MAX_BYTES||c.p!==list.data.length)throw Error('Malformed/oversize EXR channels');
    const lines=code===3?16:1,chunkCount=Math.ceil(height/lines);if(attrs.chunkCount&&data('chunkCount','int',4).getInt32(0,true)!==chunkCount)throw Error('Invalid EXR chunk count');
    return {width,height,xMin,yMin,name:attrs.name?text.decode(attrs.name.data):'part0',names,types,sizes,rowBytes,lines,code,chunkCount,attributes:attrs};
}
export async function decodeEXRAdvanced(input){
    const r=new Reader(input);if(r.n()!==20000630)throw Error('Not an OpenEXR file');const version=r.n();if((version&255)!==2||(version&~(255|1024|4096)))throw Error('Unsupported EXR tiled/deep/version flags');const multipart=!!(version&4096),parts=[];
    do{r.need(1);if(multipart&&!r.b[r.p]){r.p++;break;}if(parts.length>=256)throw Error('Too many EXR parts');parts.push(parseHeader(readHeader(r)));}while(multipart);
    if(!parts.length||new Set(parts.map(p=>p.name)).size!==parts.length||parts.reduce((n,p)=>n+p.width*p.height*p.names.length*4,0)>MAX_BYTES)throw Error('EXR decoded memory/part budget exceeded');
    for(const p of parts){p.offsets=Array.from({length:p.chunkCount},()=>r.n('u64'));p.channels=Object.create(null);p.names.forEach(n=>p.channels[n]=p.types[n]===0?new Uint32Array(p.width*p.height):new Float32Array(p.width*p.height));}
    const dataStart=r.p,occupied=[];
    for(let pi=0;pi<parts.length;pi++){const p=parts[pi],seen=new Set();for(const offset of p.offsets){if(offset<dataStart)throw Error('EXR chunk points into headers');r.p=offset;if(multipart&&r.n()!==pi)throw Error('EXR chunk part mismatch');const y=r.n('i32')-p.yMin,size=r.n(),rows=Math.min(p.lines,p.height-y),expected=rows*p.rowBytes;if(y<0||y>=p.height||y%p.lines||seen.has(y)||size>expected)throw Error('Invalid EXR scanline block');seen.add(y);const packed=r.take(size);occupied.push([offset,r.p]);let raw=packed;if(size<expected){if(!p.code)throw Error('Truncated uncompressed EXR block');raw=zipUnpredict(await zlib(packed,true,expected));if(raw.length!==expected)throw Error('EXR block length mismatch');}
        const dv=new DataView(raw.buffer,raw.byteOffset,raw.byteLength);let at=0;for(let row=0;row<rows;row++)for(const n of p.names)for(let x=0;x<p.width;x++){const v=p.types[n]===0?dv.getUint32(at,true):p.types[n]===1?halfToFloat(dv.getUint16(at,true)):dv.getFloat32(at,true);p.channels[n][(y+row)*p.width+x]=v;at+=p.sizes[n];}
    }delete p.offsets;}
    occupied.sort((a,b)=>a[0]-b[0]);if(occupied.some((a,i)=>i&&a[0]<occupied[i-1][1]))throw Error('Overlapping EXR chunks');
    return multipart?{parts,multipart:true}:{...parts[0],parts,multipart:false};
}
