import { autoSeams, meshEdges, conformalUnwrap, packIslands, relaxUV, transformIsland, stitchUV } from '../geometry/uv.js';
import { cloneMesh, planarUV, sphericalUV, triangulate } from '../geometry/mesh.js';
import { sampleTransform } from '../scene/document.js';
import { icon } from './icons.js';
import { escapeHTML } from './inspector.js';
export function uvEditor(app) {
    const o = app.requireObject(); let draft = cloneMesh(app.geometry.get(o));
    const pins = new Set(); let seamList = autoSeams(draft);
    if (!draft.uvs.length)
        planarUV(draft);
    app.dialog('UV islands & conformal unwrap', `<p>Edit per-vertex UVs. Applying UV edits converts the evaluated object to an editable mesh.</p><canvas class="uv-surface" width="720" height="500"></canvas><div class="uv-tools"><button class="small-button" data-project="xz">Planar XZ</button><button class="small-button" data-project="xy">Planar XY</button><button class="small-button" data-project="sphere">Spherical</button></div><div class="production-actions"><button class="small-button" id="uv-auto">Auto seams</button><button class="small-button" id="uv-unwrap">Conformal unwrap</button><button class="small-button" id="uv-pack">Pack islands</button><button class="small-button" id="uv-relax">Relax interior</button><button class="small-button" id="uv-stitch">Stitch selected positions</button></div><div class="form-row"><label>Cut edges (vertex:vertex)</label><input id="uv-seams" value="${seamList.join(', ')}"></div><div class="form-row"><label>Vertex selection / pins</label><input id="uv-pins" placeholder="0, 4, 9"></div><div class="form-row"><label>Island index</label><input id="uv-island" type="number" min="0" step="1" value="0"><label>Rotation °</label><input id="uv-angle" type="number" value="90" step="15"><button class="small-button" id="uv-rotate">Rotate</button></div><div class="form-row"><label>Translate U, V</label><input id="uv-offset" value="0.1, 0"><label>Scale U, V</label><input id="uv-scale" value="1, 1"><button class="small-button" id="uv-transform">Transform island</button></div><p class="note" id="uv-status">Drag UV vertices. Shift-click toggles a pin. Conformal unwrap cuts the listed 3D mesh edges. Packing fits charts into 0–1; pins constrain unwrap/relax, not packing. Applying bakes geometry and clears its deformation stack.</p>`, () => app.mutate('Edit UV coordinates', () => {
        o.type = 'mesh';
        o.mesh = draft;
        o.params = {};
        o.modifiers = [];
        for(const key of ['rig','simulation','procedural','meshCache','morphTargets','morphWeights'])delete o[key];
    }), 'Apply UVs', 740);
    const canvas = document.querySelector('.uv-surface'), ctx = canvas.getContext('2d');
    const point = i => [80 + draft.uvs[i * 2] * 540, 450 - draft.uvs[i * 2 + 1] * 400];
    const el = id => document.querySelector('#'+id);
    const selection = () => {const text=el('uv-pins').value.trim(),ids=text?text.split(',').map(Number):[];if(ids.some(i=>!Number.isInteger(i)||i<0||i>=draft.positions.length/3))throw Error('Invalid UV vertex index');pins.clear();ids.forEach(i=>pins.add(i));return ids;};
    const applyOperation = fn => app.safe(()=>{draft=fn();draw();el('uv-status').textContent=`${draft.positions.length/3} UV vertices · ${draft.uvCharts?.length||1} charts`;});
    el('uv-pins').onchange=()=>app.safe(()=>{selection();draw();});
    el('uv-auto').onclick=()=>{seamList=autoSeams(draft);el('uv-seams').value=seamList.join(', ');el('uv-status').textContent=`${seamList.length} seam edges selected by dihedral angle and boundaries.`;};
    el('uv-unwrap').onclick=()=>applyOperation(()=>{const seams=el('uv-seams').value.split(',').map(s=>s.trim()).filter(Boolean),edges=meshEdges(draft);if(seams.some(s=>!edges.has(s)))throw Error('A seam must name an existing edge using its canonical min:max vertex indices');const chosen=selection(),pinMap=Object.fromEntries(chosen.map(i=>[i,draft.uvs.slice(i*2,i*2+2)]));const out=conformalUnwrap(draft,{seams,pins:pinMap,pack:chosen.length===0});pins.clear();el('uv-pins').value='';el('uv-seams').value=autoSeams(out).join(', ');return out;});
    el('uv-pack').onclick=()=>applyOperation(()=>packIslands(draft));
    el('uv-relax').onclick=()=>applyOperation(()=>relaxUV(draft,{pins:selection()}));
    el('uv-stitch').onclick=()=>applyOperation(()=>stitchUV(draft,selection()));
    el('uv-rotate').onclick=()=>applyOperation(()=>transformIsland(draft,Number(el('uv-island').value),{rotation:Number(el('uv-angle').value)}));
    el('uv-transform').onclick=()=>applyOperation(()=>{const translation=el('uv-offset').value.split(',').map(Number),scale=el('uv-scale').value.split(',').map(Number);if(translation.length!==2||scale.length!==2||![...translation,...scale].every(Number.isFinite))throw Error('Enter two finite UV coordinates');return transformIsland(draft,Number(el('uv-island').value),{translation,scale});});

    function draw() {
        ctx.clearRect(0, 0, 720, 500);
        for (let x = 0; x < 10; x++)
            for (let y = 0; y < 10; y++) {
                ctx.fillStyle = (x + y) % 2 ? '#252b35' : '#1f242c';
                ctx.fillRect(80 + x * 54, 50 + y * 40, 54, 40);
            }
        ctx.strokeStyle = '#6f849d';
        ctx.lineWidth = .7;
        for (const f of draft.faces) {
            ctx.beginPath();
            f.forEach((i, j) => {
                const p = point(i);
                j ? ctx.lineTo(...p) : ctx.moveTo(...p);
            });
            ctx.closePath();
            ctx.stroke();
        }
        ctx.fillStyle = '#eaaa73';
        for (let i = 0; i < draft.uvs.length / 2; i++) {
            const p = point(i);
            ctx.fillStyle = pins.has(i) ? '#6dc9ff' : '#eaaa73';
            ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
        }
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#adb8c9';
        ctx.fillText('0, 0', 48, 465);
        ctx.fillText('1, 1', 625, 47);
    }
    const local = e => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * 720 / r.width, (e.clientY - r.top) * 500 / r.height];
    };
    let selected = -1;
    canvas.onpointerdown = e => {
        const p = local(e);
        let distance = 14;
        selected = -1;
        for (let i = 0; i < draft.uvs.length / 2; i++) {
            const q = point(i), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (d < distance) {
                distance = d;
                selected = i;
            }
        }
        if(e.shiftKey && selected>=0){pins.has(selected)?pins.delete(selected):pins.add(selected);document.querySelector('#uv-pins').value=[...pins].join(', ');selected=-1;draw();}
        canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = e => {
        if (selected < 0)
            return;
        const p = local(e);
        draft.uvs[selected * 2] = (p[0] - 80) / 540;
        draft.uvs[selected * 2 + 1] = (450 - p[1]) / 400;
        draw();
    };
    canvas.onpointerup = () => selected = -1;
    document.querySelectorAll('[data-project]').forEach(b => b.onclick = () => {
        b.dataset.project === 'sphere' ? sphericalUV(draft) : planarUV(draft, b.dataset.project === 'xz' ? [0, 2] : [0, 1]);
        draw();
    });
    draw();
}
export function curveEditor(app) {
    const o = app.requireObject(), keys = structuredClone(o.keys);
    let channel = 'position', axis = 1;
    const animation = app.doc.animation;
    app.dialog('Animation curve editor', `<div class="form-row"><label>Channel</label><select id="curve-channel"><option value="position.0">Position X</option><option value="position.1" selected>Position Y</option><option value="position.2">Position Z</option><option value="rotation.0">Rotation X</option><option value="rotation.1">Rotation Y</option><option value="rotation.2">Rotation Z</option><option value="scale.0">Scale X</option><option value="scale.1">Scale Y</option><option value="scale.2">Scale Z</option></select></div><canvas class="curve-surface" width="720" height="400"></canvas><p class="note">Drag keys to change frame and value. ${escapeHTML(animation.interpolation)} interpolation. Euler rotation channels preserve their numeric values, allowing multiple revolutions. Add keys with Set key in the timeline.</p>`, () => app.mutate('Edit animation curves', () => {
        o.keys = keys;
        const t = sampleTransform(o, animation.frame, animation.interpolation);
        for (const k of ['position', 'rotation', 'scale'])
            o[k] = [...t[k]];
    }), 'Apply curves', 780);
    const canvas = document.querySelector('.curve-surface'), ctx = canvas.getContext('2d');
    let min = -1, max = 3;
    function ranges() {
        const vs = keys.map(k => k[channel][axis]);
        min = vs.length ? Math.min(...vs) - 1 : -1;
        max = vs.length ? Math.max(...vs) + 1 : 3;
    }
    const x = f => 45 + (f - animation.start) / (animation.end - animation.start) * 650, y = v => 355 - (v - min) / (max - min) * 320;
    function draw() {
        ctx.clearRect(0, 0, 720, 400);
        ctx.strokeStyle = '#323a46';
        ctx.lineWidth = 1;
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#8290a3';
        for (let i = 0; i <= 10; i++) {
            const px = 45 + i * 65;
            ctx.beginPath();
            ctx.moveTo(px, 25);
            ctx.lineTo(px, 355);
            ctx.stroke();
            ctx.fillText(Math.round(animation.start + i * (animation.end - animation.start) / 10), px - 6, 377);
        }
        for (let i = 0; i <= 5; i++) {
            const v = min + i * (max - min) / 5, py = y(v);
            ctx.beginPath();
            ctx.moveTo(45, py);
            ctx.lineTo(695, py);
            ctx.stroke();
            ctx.fillText(v.toFixed(1), 6, py + 4);
        }
        ctx.strokeStyle = '#eaaa73';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = 45; px <= 695; px++) {
            const frame = animation.start + (px - 45) / 650 * (animation.end - animation.start), value = sampleTransform({ ...o, keys }, frame, animation.interpolation)[channel][axis];
            px === 45 ? ctx.moveTo(px, y(value)) : ctx.lineTo(px, y(value));
        }
        ctx.stroke();
        ctx.fillStyle = '#f1b581';
        for (const k of keys) {
            ctx.save();
            ctx.translate(x(k.frame), y(k[channel][axis]));
            ctx.rotate(Math.PI / 4);
            ctx.fillRect(-4, -4, 8, 8);
            ctx.restore();
        }
        if (!keys.length) {
            ctx.fillStyle = '#adb7c8';
            ctx.font = '14px sans-serif';
            ctx.fillText('No keys on this object. Use Set key to begin.', 195, 185);
        }
    }
    const local = e => {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * 720 / r.width, (e.clientY - r.top) * 400 / r.height];
    };
    let selected = -1;
    canvas.onpointerdown = e => {
        const p = local(e);
        selected = keys.findIndex(k => Math.hypot(x(k.frame) - p[0], y(k[channel][axis]) - p[1]) < 13);
        canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = e => {
        if (selected < 0)
            return;
        const p = local(e), k = keys[selected], frame = Math.round(Math.max(animation.start, Math.min(animation.end, animation.start + (p[0] - 45) / 650 * (animation.end - animation.start))));
        if (!keys.some((q, i) => i !== selected && q.frame === frame))
            k.frame = frame;
        k[channel][axis] = min + (355 - p[1]) / 320 * (max - min);
        if (channel === 'scale' && Math.abs(k[channel][axis]) < .001)
            k[channel][axis] = .001;
        draw();
    };
    canvas.onpointerup = () => {
        selected = -1;
        keys.sort((a, b) => a.frame - b.frame);
    };
    document.querySelector('#curve-channel').onchange = e => {
        [channel, axis] = e.target.value.split('.');
        axis = Number(axis);
        ranges();
        draw();
    };
    ranges();
    draw();
}
