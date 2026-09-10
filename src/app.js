import { installAdvancedTools } from './ui/advanced.js';
import { installProductionTools } from './ui/production.js';
import { History } from './core/history.js';
import { add, sub, mul, dot, cross, normalize, length, clamp, transformPoint, transformVector, inverse, compose } from './core/math.js';
import { demoDocument, emptyDocument, newObject, material, uid, validateDocument, GeometryCache, worldMatrix, sampleTransform, setKey } from './scene/document.js';
import { cloneMesh, triangulate, extrudeFace, deleteFace, weld, bounds, vertex } from './geometry/mesh.js';
import { PRIMITIVES } from './geometry/primitives.js';
import { MODIFIERS } from './geometry/modifiers.js';
import { Renderer } from './render/renderer.js';
import { compileTriangles } from './render/compile.js';
import { cameraFrame, cameraRay, project } from './render/camera.js';
import { intersectBVH } from './render/bvh.js';
import { parseOBJ, parseSTL, exportOBJ, exportSTL, exportGLTF, encodePFM, download } from './io/formats.js';
import { saveRecovery, loadRecovery } from './io/storage.js';
import { icon } from './ui/icons.js';
import { renderInspector, escapeHTML as esc } from './ui/inspector.js';
import { uvEditor, curveEditor } from './ui/editors.js';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
class Studio {
    constructor() {
        this.doc = demoDocument();
        this.geometry = new GeometryCache();
        this.selected = new Set([this.doc.objects[3].id]);
        this.selectedFace = -1;
        this.selectedVertex = -1;
        this.inspectorTab = 'object';
        this.tool = 'move';
        this.selectionMode = 'object';
        this.coordinateSpace = 'world';
        this.grid = true;
        this.wireframe = false;
        this.snap = false;
        this.snapSize = .25;
        this.autoKey = false;
        this.playing = false;
        this.dirty = true;
        this.needsBuild = false;
        this.building = false;
        this.revision = 0;
        this.builtRevision = -1;
        this.materialIndex = 2;
        this.history = new History(() => this.doc, d => {
            this.doc = validateDocument(d);
            this.geometry.clear();
            this.selected = new Set([...this.selected].filter(id => d.objects.some(o => o.id === id)));
            this.selectedFace = -1;
            this.selectedVertex = -1;
            this.changed();
        });
        this.commands = this.createCommands();
        installProductionTools(this);
        installAdvancedTools(this);
        this.worker = new Worker(new URL('./render/bvh-worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = e => this.finishBuild(e.data);
        this.worker.onerror = e => {
            this.building = false;
            this.toast(`Acceleration worker: ${e.message}`, true);
        };
        this.renderer = new Renderer($('#gpu-canvas'), (m, type) => this.toast(m, type === 'error'));
        this.initUI();
    }
    get activeObject() {
        return this.doc.objects.find(o => o.id === [...this.selected].at(-1));
    }
    requireObject() {
        const o = this.activeObject;
        if (!o)
            throw Error('Select an object first.');
        if (o.locked)
            throw Error('Unlock this object in Scene properties before editing.');
        return o;
    }
    toast(message, error = false) {
        $('#status-message').textContent = message;
        const t = $('#toast');
        t.textContent = message;
        t.classList.toggle('error', error);
        t.classList.add('show');
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => t.classList.remove('show'), error ? 8000 : 3200);
        if (error)
            console.error(message);
    }
    safe(fn) {
        try {
            const result = fn();
            if (result?.catch)
                result.catch(e => this.toast(e.message, true));
            return result;
        }
        catch (e) {
            this.toast(e.message, true);
        }
    }
    mutate(label, fn, { rebuild = true } = {}) {
        const result = this.history.run(label, fn);
        if (result) {
            this.changed(rebuild);
            $('#history-label').textContent = label;
        }
        return result;
    }
    changed(rebuild = true) {
        const restored = this.resumeInteractive();
        this.geometry.setContext(this.doc);
        this.dirty = true;
        this.renderer.reset();
        if (rebuild && !restored)
            this.requestBuild();
        this.refresh();
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.autosave(), 800);
    }
    async autosave() {
        try {
            await saveRecovery(this.doc);
            $('#save-state').textContent = 'Recovery saved';
        }
        catch (e) {
            $('#save-state').textContent = 'Recovery unavailable';
            this.toast('Recovery storage is unavailable. Save a scene file to keep your work.', true);
        }
    }
    requestBuild() {
        this.revision++;
        this.needsBuild = true;
        clearTimeout(this.buildTimer);
        this.buildTimer = setTimeout(() => this.build(), 20);
    }
    build() {
        if (this.building || !this.needsBuild)
            return;
        this.needsBuild = false;
        this.building = true;
        $('#build-indicator').hidden = false;
        try {
            const compiled = compileTriangles(this.doc, this.geometry), id = this.revision;
            this.pendingBuild = { id, objects: compiled.objects, materials: compiled.materials };
            this.worker.postMessage({ id, triangles: compiled.triangles, materials: compiled.materials }, [compiled.triangles.buffer]);
        }
        catch (e) {
            this.building = false;
            $('#build-indicator').hidden = true;
            this.toast(e.message, true);
        }
    }
    async finishBuild({ id, result, error }) {
        try {
            if (error)
                throw Error(error);
            if (id === this.revision) {
                this.compiled = { ...result, objects: this.pendingBuild.objects };
                this.builtRevision = id;
                if (this.gpuReady) {
                    await this.renderer.device.queue.onSubmittedWorkDone();
                    await this.renderer.setAssets(this.doc);
                    this.renderer.setScene(result, this.pendingBuild.materials);
                }
                this.dirty = true;
                this.drawGizmo();
            }
        }
        catch (e) {
            this.toast(e.message, true);
        }
        finally {
            this.building = false;
            $('#build-indicator').hidden = true;
            if (this.needsBuild)
                this.build();
        }
    }
    async start() {
        try {
            await this.renderer.init();
            this.gpuReady = true;
            const info = this.renderer.info;
            $('#gpu-label').textContent = info?.description || info?.vendor || 'WebGPU connected';
            $('#render-backend').textContent = 'WebGPU · raster + compute';
            this.requestBuild();
        }
        catch (e) {
            this.gpuReady = false;
            $('#gpu-label').textContent = e.label || 'Renderer error';
            $('#render-backend').textContent = e.label || 'Renderer unavailable';
            $('.gpu-dot').style.background = 'var(--red)';
            $('#gpu-error').hidden = false;
            $('#gpu-error').innerHTML = `${icon('info')}<h2>${esc(e.title || 'Renderer initialization failed')}</h2><p>${esc(e.message)}</p><p>The scene editor and file tools remain available. Rendering is not replaced with a simulated preview.</p>`;
            this.toast(e.message, true);
        }
        this.ready = true;
        this.lastFrame = performance.now();
        requestAnimationFrame(t => this.loop(t));
    }
    async loop(now) {
        if (this.playing && !this.building) {
            const a = this.doc.animation, frame = a.start + Math.floor((now - this.playStart) / 1000 * a.fps) % (a.end - a.start + 1);
            if (frame !== a.frame)
                this.setFrame(frame, false);
        }
        if (!this.renderLocked && this.gpuReady && (this.dirty || this.renderer.mode === 'trace' && !this.renderer.paused && this.renderer.samples < this.doc.settings.samples)) {
            const selected = this.compiled?.objects.indexOf(this.activeObject?.id) + 1 || 0;
            this.dirty = false;
            try {
                await this.renderer.render(this.doc, selected, { grid: this.grid, wireframe: this.wireframe });
                this.updateStats();
            }
            catch (e) {
                console.error(e.stack);
                this.toast(e.message, true);
                this.renderer.paused = true;
            }
        }
        this.lastFrame = now;
        requestAnimationFrame(t => this.loop(t));
    }
    updateStats() {
        const r = this.renderer, s = this.compiled;
        $('#viewport-stats').textContent = `${(s?.triangles.length / 32 || 0).toLocaleString()} triangles · ${this.doc.objects.length} objects\n${r.canvas.width} × ${r.canvas.height} · ${r.mode === 'trace' ? r.samples + ' samples' : r.lastDuration.toFixed(1) + ' ms GPU submission + completion'}`;
        $('#samples-label').textContent = `${r.samples} / ${this.doc.settings.samples} spp`;
        $('#sample-progress').style.width = `${Math.min(100, r.samples / this.doc.settings.samples * 100)}%`;
        $('#render-time').textContent = r.samples >= this.doc.settings.samples ? 'Target reached' : r.paused ? 'Paused' : `${((r.elapsed || 0) / 1000).toFixed(1)}s elapsed · ${(r.lastDuration || 0).toFixed(0)}ms / sample`;
    }
    initUI() {
        $('#brand-icon').innerHTML = icon('logo');
        $('#render-button').innerHTML = icon('render') + 'Render scene';
        $('#render-button').onclick = () => this.run('toggleRender');
        $('#create-button').innerHTML = icon('plus') + 'Create';
        $('#create-button').onclick = e => this.showMenu('Create', e.currentTarget);
        $('#help-button').innerHTML = icon('info') + 'Guide';
        $('#help-button').onclick = () => this.run('help');
        $('#add-object').innerHTML = icon('plus');
        $('#add-object').onclick = e => this.showMenu('Create', e.currentTarget);
        $('#scene-search-icon').innerHTML = icon('search');
        $('#snap-button').innerHTML = icon('magnet');
        $('#snap-button').onclick = () => this.run('snap');
        $('#wireframe-button').innerHTML = icon('mesh');
        $('#grid-button').innerHTML = icon('grid');
        $('#fit-button').innerHTML = icon('fit');
        $('#wireframe-button').onclick = () => this.run('wireframe');
        $('#grid-button').onclick = () => this.run('grid');
        $('#fit-button').onclick = () => this.run('frameSelection');
        $('#import-button').innerHTML = icon('folder') + 'Import OBJ / STL';
        $('#import-button').onclick = () => this.run('import');
        $('#pause-render').innerHTML = icon('pause');
        $('#pause-render').onclick = () => {
            this.renderer.paused = !this.renderer.paused;
            $('#pause-render').innerHTML = icon(this.renderer.paused ? 'play' : 'pause');
            this.dirty = true;
        };
        $('#palette-button').onclick = () => this.run('palette');
        $('#project-name').onchange = e => this.mutate('Rename scene', () => this.doc.name = e.target.value || 'Untitled scene', { rebuild: false });
        $('#scene-search').oninput = () => this.renderTree();
        $('#selection-mode').onchange = e => {
            this.selectionMode = e.target.value;
            this.selectedFace = -1;
            this.selectedVertex = -1;
            this.drawGizmo();
            this.toast(`${this.selectionMode} selection mode`);
        };
        $('#coordinate-space').onchange = e => {
            this.coordinateSpace = e.target.value;
            this.drawGizmo();
        };
        $('#snap-size').onchange = e => {
            this.snapSize = Math.max(.01, Number(e.target.value) || .25);
        };
        $('#projection').onchange = e => this.setView(e.target.value);
        $('#shading').onchange = e => {
            this.doc.settings.view = e.target.value;
            this.renderer.reset();
            this.dirty = true;
        };
        $$('[data-view]').forEach(b => b.onclick = () => this.setView(b.dataset.view));
        $$('[data-tab]').forEach((b, i) => {
            b.innerHTML = icon(['settings', 'stack', 'sphere', 'render'][i]);
            b.onclick = () => {
                this.inspectorTab = b.dataset.tab;
                renderInspector(this);
            };
        });
        $$('[data-workspace]').forEach(b => b.onclick = () => this.setWorkspace(b.dataset.workspace));
        $('#transform-tools').innerHTML = ['select', 'move', 'rotate', 'scale'].map((tool, i) => `<button data-tool="${tool}" class="tool ${this.tool === tool ? 'active' : ''}" title="${tool[0].toUpperCase() + tool.slice(1)} (${'QWER'[i]})">${icon(tool === 'select' ? 'cursor' : tool)}</button>`).join('');
        $$('[data-tool]').forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
        $('#edit-tools').innerHTML = [['undo', 'Undo (Ctrl+Z)'], ['redo', 'Redo (Ctrl+Shift+Z)'], ['duplicate', 'Duplicate (Ctrl+D)']].map(([id, title]) => `<button class="tool" data-command="${id}" title="${title}">${icon(id)}</button>`).join('');
        $('#main-menu').innerHTML = ['File', 'Edit', 'Create', 'Model', 'Animation', 'Render'].map(name => `<button data-menu="${name}">${name}</button>`).join('');
        $$('[data-menu]').forEach(b => b.onclick = e => {
            e.stopPropagation();
            this.showMenu(b.dataset.menu, b);
        });
        $('#primitive-grid').innerHTML = PRIMITIVES.map(type => `<button class="primitive" data-primitive="${type}" title="Create ${type}">${icon(type === 'box' ? 'cube' : type)}${type[0].toUpperCase() + type.slice(1)}</button>`).join('');
        $$('[data-primitive]').forEach(b => b.onclick = () => this.safe(() => this.addPrimitive(b.dataset.primitive)));
        $('#dock-tools').innerHTML = `<button class="icon-button" data-command="newMaterial" title="New material">${icon('plus')}</button><button class="icon-button" data-command="materialInspector" title="Material properties">${icon('settings')}</button>`;
        $$('[data-dock]').forEach(b => b.onclick = () => this.setDock(b.dataset.dock));
        $('#playback').innerHTML = [['firstFrame', 'start'], ['previousKey', 'chevron'], ['play', 'play'], ['nextKey', 'chevron'], ['lastFrame', 'end']].map(([id, ic], i) => `<button data-command="${id}" title="${id.replace(/([A-Z])/g, ' $1')}" ${i === 1 ? 'style="transform:rotate(180deg)"' : ''}>${icon(ic)}</button>`).join('');
        $('#set-key').innerHTML = icon('key') + 'Set key';
        $('#set-key').onclick = () => this.run('setKey');
        $('#auto-key').onclick = () => {
            this.autoKey = !this.autoKey;
            $('#auto-key').classList.toggle('active', this.autoKey);
        };
        $('#curve-button').innerHTML = icon('curve');
        $('#curve-button').onclick = () => this.run('curveEditor');
        $('#frame-number').onchange = e => this.setFrame(Number(e.target.value));
        $('#frame-slider').oninput = e => this.setFrame(Number(e.target.value));
        $('#end-frame').onchange = e => this.mutate('Change animation range', () => {
            this.doc.animation.end = Math.max(1, Math.round(Number(e.target.value)));
            this.doc.animation.frame = Math.min(this.doc.animation.frame, this.doc.animation.end);
        }, { rebuild: false });
        $('#fps').onchange = e => this.mutate('Change frame rate', () => this.doc.animation.fps = clamp(Number(e.target.value), 1, 120), { rebuild: false });
        $('#inspector').addEventListener('change', e => this.safe(() => this.inspectorChange(e)));
        $('#inspector').addEventListener('input', e => {
            if (e.target.type === 'range') {
                const out = e.target.nextElementSibling;
                if (out)
                    out.textContent = Number(e.target.value).toFixed(2);
            }
        });
        $('#inspector').addEventListener('click', e => this.safe(() => this.modifierClick(e)));
        document.addEventListener('click', e => {
            const b = e.target.closest('[data-command]');
            if (b) {
                this.run(b.dataset.command);
                $('#menu-popup').hidden = true;
            }
            if (!e.target.closest('#menu-popup,[data-menu],#create-button,#add-object'))
                $('#menu-popup').hidden = true;
        });
        $('#file-input').onchange = e => this.safe(() => this.readFile(e.target.files[0]));
        document.addEventListener('keydown', e => this.keyboard(e));
        this.bindViewport();
        new ResizeObserver(() => {
            this.dirty = true;
            this.drawGizmo();
        }).observe($('#viewport'));
        this.refresh();
        window.addEventListener('beforeunload', e => {
            if (this.history.undoStack.length && $('#save-state').textContent !== 'Scene saved') {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }
    refresh() {
        document.title = `Aureon Studio — ${this.doc.name}`;
        $('#project-name').value = this.doc.name;
        this.renderTree();
        this.renderMaterials();
        renderInspector(this);
        this.renderTimeline();
        this.renderKeys();
        this.drawGizmo();
    }
    renderTree() {
        const q = $('#scene-search').value.toLowerCase(), active = this.activeObject;
        const level = o => {
            let depth = 0, p = o.parent;
            while (p && depth < 20) {
                depth++;
                p = this.doc.objects.find(x => x.id === p)?.parent;
            }
            return depth;
        };
        $('#scene-tree').innerHTML = this.doc.objects.filter(o => o.name.toLowerCase().includes(q)).map(o => `<div class="scene-row ${this.selected.has(o.id) ? 'selected' : ''} ${!o.visible ? 'invisible' : ''}" data-object="${o.id}" role="treeitem" aria-selected="${this.selected.has(o.id)}" style="padding-left:${13 + level(o) * 10}px"><span class="object-icon">${icon(o.material === 7 ? 'sun' : o.type === 'box' ? 'cube' : o.type)}</span><span class="object-label">${esc(o.name)}</span>${o.locked ? `<span title="Locked">${icon('lock')}</span>` : ''}<button class="icon-button" data-visible="${o.id}" title="${o.visible ? 'Hide' : 'Show'} object">${icon(o.visible ? 'eye' : 'hidden')}</button></div>`).join('');
        $$('[data-object]').forEach(el => {
            el.onclick = e => {
                if (e.target.closest('[data-visible]'))
                    return;
                this.select(el.dataset.object, e.ctrlKey || e.metaKey || e.shiftKey);
            };
            el.ondblclick = () => this.run('frameSelection');
        });
        $$('[data-visible]').forEach(b => b.onclick = e => {
            e.stopPropagation();
            this.mutate('Toggle object visibility', () => {
                const o = this.doc.objects.find(o => o.id === b.dataset.visible);
                o.visible = !o.visible;
            });
        });
        $('#object-count').textContent = `${this.doc.objects.length} objects`;
        $('#selected-count').textContent = this.selected.size ? `${this.selected.size} selected` : 'No selection';
        $('#selection-label').textContent = active ? active.name + (this.selectedFace >= 0 ? ` · Polygon ${this.selectedFace}` : '') : this.doc.name;
    }
    renderMaterials() {
        const active = this.activeObject?.material ?? this.materialIndex;
        $('#material-library').innerHTML = this.doc.materials.map((m, i) => `<button class="material-card ${i === active ? 'active' : ''}" data-material="${i}" title="${esc(m.name)} — click to apply to selected objects"><i class="material-type"></i><div class="material-preview"><div class="material-ball" style="--ball-color:${m.color};${m.metallic > .5 ? 'filter:contrast(1.35) brightness(1.1)' : ''}"></div></div><span>${esc(m.name)}</span></button>`).join('');
        $$('[data-material]').forEach(b => b.onclick = () => this.safe(() => {
            this.materialIndex = Number(b.dataset.material);
            if (this.selected.size)
                this.mutate('Assign material', () => this.doc.objects.filter(o => this.selected.has(o.id) && !o.locked).forEach(o => o.material = this.materialIndex));
            this.inspectorTab = 'material';
            renderInspector(this);
            $('.right-panel').classList.add('open');
        }));
    }
    renderTimeline() {
        const a = this.doc.animation;
        $('#frame-number').value = a.frame;
        $('#end-frame').value = a.end;
        $('#fps').value = a.fps;
        $('#frame-slider').min = a.start;
        $('#frame-slider').max = a.end;
        $('#frame-slider').value = a.frame;
        $('#ruler').innerHTML = Array.from({ length: 13 }, (_, i) => `<span class="tick">${Math.round(a.start + (a.end - a.start) * i / 12)}</span>`).join('');
        $('#playhead').style.left = `${(a.frame - a.start) / (a.end - a.start) * 100}%`;
        $('#key-markers').innerHTML = (this.activeObject?.keys || []).map(k => `<span class="key-marker" style="left:${(k.frame - a.start) / (a.end - a.start) * 100}%"></span>`).join('');
        const pb = $('[data-command="play"]');
        pb.innerHTML = icon(this.playing ? 'pause' : 'play');
        pb.classList.toggle('active', this.playing);
    }
    renderKeys() {
        const keys = this.activeObject?.keys || [];
        $('#keys-dock').innerHTML = keys.length ? keys.map(k => `<div class="key-card"><button data-goto-key="${k.frame}"><b>◆ ${k.frame}</b></button><span>${k.position.map(x => x.toFixed(1)).join(' / ')}</span><button data-delete-key="${k.frame}" title="Delete key">×</button></div>`).join('') : '<p class="note">Select an object, change its transform, then use Set key to create animation.</p>';
        $$('[data-goto-key]').forEach(b => b.onclick = () => this.setFrame(Number(b.dataset.gotoKey)));
        $$('[data-delete-key]').forEach(b => b.onclick = () => this.mutate('Delete key', () => {
            const o = this.requireObject();
            o.keys = o.keys.filter(k => k.frame !== Number(b.dataset.deleteKey));
        }));
    }
    select(id, multi = false) {
        const o = this.doc.objects.find(o => o.id === id);
        if (!multi)
            this.selected.clear();
        if (o) {
            if (multi && this.selected.has(id))
                this.selected.delete(id);
            else
                this.selected.add(id);
            this.materialIndex = o.material;
        }
        this.selectedFace = -1;
        this.selectedVertex = -1;
        this.dirty = true;
        this.renderTree();
        renderInspector(this);
        this.renderMaterials();
        this.renderTimeline();
        this.renderKeys();
        this.drawGizmo();
    }
    setTool(tool) {
        this.tool = tool;
        $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        this.drawGizmo();
    }
    setDock(dock) {
        $$('[data-dock]').forEach(b => b.classList.toggle('active', b.dataset.dock === dock));
        $('#material-library').hidden = dock !== 'materials';
        $('#material-library').style.display = dock === 'materials' ? 'flex' : 'none';
        $('#keys-dock').hidden = dock !== 'keys';
    }
    setWorkspace(space) {
        $$('[data-workspace]').forEach(b => b.classList.toggle('active', b.dataset.workspace === space));
        if (space === 'render') {
            this.inspectorTab = 'render';
        }
        else if (space === 'material') {
            this.inspectorTab = 'material';
            this.setDock('materials');
        }
        else if (space === 'animate') {
            this.setDock('keys');
            this.inspectorTab = 'object';
        }
        else {
            this.inspectorTab = 'object';
            this.setDock('materials');
            if (this.renderer.mode === 'trace')
                this.toggleRender(false);
        }
        renderInspector(this);
        if (innerWidth <= 850)
            $('.right-panel').classList.add('open');
    }
    setView(view) {
        const c = this.doc.camera;
        c.projection = view;
        if (view === 'top') {
            c.yaw = 0;
            c.pitch = Math.PI / 2 - .0001;
        }
        else if (view === 'front') {
            c.yaw = 0;
            c.pitch = 0;
        }
        else if (view === 'right') {
            c.yaw = Math.PI / 2;
            c.pitch = 0;
        }
        else {
            c.yaw = .56;
            c.pitch = .32;
        }
        $('#projection').value = view;
        this.cameraChanged();
    }
    resumeInteractive() {
        if (!this.renderer?.fixedSize || this.renderLocked) return false;
        this.renderer.fixedSize = null;
        this.renderer.tile = null;
        this.renderer.sampleStart = 0;
        this.renderer.paused = false;
        // A production frame leaves a shutter-time scene on the GPU. Rebuild
        // from the editable document before resuming the modeling viewport.
        this.requestBuild();
        this.dirty = true;
        return true;
    }
    cameraChanged() {
        this.resumeInteractive();
        this.renderer.reset();
        this.dirty = true;
        this.drawGizmo();
    }
    frameSelection() {
        const selected = this.doc.objects.filter(o => this.selected.size ? this.selected.has(o.id) : o.visible && !o.hiddenInViewport && o.type !== 'plane');
        if (!selected.length)
            return;
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const o of selected) {
            const m = this.geometry.get(o), b = bounds(m), matrix = worldMatrix(this.doc, o);
            for (let i = 0; i < 8; i++) {
                const p = transformPoint(matrix, [0, 1, 2].map(k => i & (1 << k) ? b.max[k] : b.min[k]));
                p.forEach((v, k) => {
                    min[k] = Math.min(min[k], v);
                    max[k] = Math.max(max[k], v);
                });
            }
        }
        this.doc.camera.target = mul(add(min, max), .5);
        this.doc.camera.distance = Math.max(1, length(sub(max, min)) * 1.4);
        this.doc.camera.focus = this.doc.camera.distance;
        this.cameraChanged();
    }
    addPrimitive(type) {
        this.mutate(`Create ${type}`, () => {
            const n = this.doc.objects.filter(o => o.type === type).length, o = newObject(type, {}, `${type[0].toUpperCase() + type.slice(1)} ${String(n + 1).padStart(2, '0')}`);
            o.material = 0;
            this.doc.objects.push(o);
            this.selected = new Set([o.id]);
            this.selectedFace = -1;
            this.selectedVertex = -1;
            this.materialIndex = 0;
        });
        this.inspectorTab = 'object';
        renderInspector(this);
    }
    convert(o = this.requireObject()) {
        if (o.type === 'mesh' && !o.modifiers.length)
            return;
        o.mesh = cloneMesh(this.geometry.get(o));
        o.type = 'mesh';
        o.params = {};
        o.modifiers = [];
    }
    setFrame(frame, stop = true) {
        this.resumeInteractive();
        if (stop)
            this.playing = false;
        const a = this.doc.animation;
        a.frame = Math.round(clamp(frame, a.start, a.end));
        this.geometry.setContext(this.doc);
        for (const o of this.doc.objects) {
            if (o.keys.length) {
                const tr = sampleTransform(o, a.frame, a.interpolation);
                for (const k of ['position', 'rotation', 'scale'])
                    o[k] = [...tr[k]];
            }
        }
        this.renderer.reset();
        this.requestBuild();
        this.renderTimeline();
        if (!this.playing)
            renderInspector(this);
        this.dirty = true;
    }
    toggleRender(force) {
        if (!this.gpuReady) {
            this.toast(this.renderer.initializationError?.message || 'The renderer is not initialized.', true);
            return;
        }
        if (this.renderLocked) {
            this.toast('Cancel the active production render before changing render mode.', true);
            return;
        }
        this.resumeInteractive();
        const trace = force ?? (this.renderer.mode !== 'trace');
        this.playing = false;
        this.renderer.mode = trace ? 'trace' : 'raster';
        this.renderer.paused = false;
        this.renderer.reset();
        $('#render-button').innerHTML = icon(trace ? 'stop' : 'render') + (trace ? 'Back to modeling' : 'Render scene');
        $('#render-button').classList.toggle('active', trace);
        $('#render-progress').hidden = !trace;
        $('#gizmo').style.display = trace ? 'none' : '';
        $('#mode-badge').textContent = trace ? 'AUREON RAY · PATH TRACING' : 'STUDIO VIEWPORT';
        $('#pause-render').innerHTML = icon('pause');
        if (trace) {
            this.inspectorTab = 'render';
            this.setWorkspace('render');
        }
        this.dirty = true;
        renderInspector(this);
        this.renderTimeline();
    }
    inspectorChange(e) {
        const el = e.target;
        if (el.id === 'modifier-select') {
            if (el.value) {
                const spec = MODIFIERS[el.value];
                this.mutate(`Add ${spec.label}`, () => this.requireObject().modifiers.push({ type: el.value, value: spec.value, enabled: true }));
            }
            return;
        }
        if (el.dataset.modEnabled !== undefined) {
            this.mutate('Toggle modifier', () => this.requireObject().modifiers[Number(el.dataset.modEnabled)].enabled = el.checked);
            return;
        }
        if (!el.dataset.field)
            return;
        const parts = el.dataset.field.split('.');
        let value = el.type === 'checkbox' ? el.checked : el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value;
        if (typeof value === 'number') {
            if (!Number.isFinite(value))
                throw Error('Enter a finite number.');
            if (el.min !== '')
                value = Math.max(Number(el.min), value);
            if (el.max !== '')
                value = Math.min(Number(el.max), value);
        }
        this.mutate(`Change ${parts.slice(1).join(' ')}`, () => {
            let target;
            if (parts[0] === 'object')
                target = parts[1] === 'locked' ? this.activeObject : this.requireObject();
            else if (parts[0] === 'params')
                target = this.requireObject().params;
            else if (parts[0] === 'material')
                target = this.doc.materials[this.materialIndex ?? this.activeObject?.material ?? 0];
            else if (parts[0] === 'modifier') {
                this.requireObject().modifiers[Number(parts[1])].value = value;
                return;
            }
            else
                target = this.doc[parts[0]];
            if (parts[1] === 'scale' && Math.abs(value) < .001)
                throw Error('Scale cannot be zero.');
            if (parts[0] === 'object' && parts[1] === 'material') {
                value = Number(value);
                this.materialIndex = value;
            }
            if (parts[0] === 'settings' && parts[1] === 'resolution')
                value = Number(value);
            if (parts[0] === 'object' && parts[1] === 'parent') {
                value = value || null;
                let p = value;
                while (p) {
                    if (p === target.id)
                        throw Error('An object cannot be parented to its descendant.');
                    p = this.doc.objects.find(o => o.id === p)?.parent;
                }
            }
            if (parts.length === 3)
                target[parts[1]][Number(parts[2])] = value;
            else
                target[parts[1]] = value;
            if (parts[0] === 'object' && ['position', 'rotation', 'scale'].includes(parts[1])) {
                const o = this.requireObject();
                if (this.autoKey || o.keys.some(k => k.frame === this.doc.animation.frame))
                    setKey(o, this.doc.animation.frame);
            }
        }, { rebuild: !['settings', 'camera'].includes(parts[0]) });
    }
    modifierClick(e) {
        for (const [attribute, action] of [['modDelete', 'delete'], ['modUp', 'up'], ['modDown', 'down']]) {
            const b = e.target.closest(`[data-${attribute.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}]`);
            if (!b)
                continue;
            const i = Number(b.dataset[attribute]);
            this.mutate(`${action} modifier`, () => {
                const mods = this.requireObject().modifiers;
                if (action === 'delete')
                    mods.splice(i, 1);
                else {
                    const j = action === 'up' ? i - 1 : i + 1;
                    if (j >= 0 && j < mods.length)
                        [mods[i], mods[j]] = [mods[j], mods[i]];
                }
            });
        }
    }
    dialog(title, content, onApply = null, applyText = 'Apply', width = 480) {
        const d = $('#dialog');
        if (d.open)
            d.close();
        d.style.width = width + 'px';
        d.innerHTML = `<div class="dialog-heading"><h2>${esc(title)}</h2><button class="icon-button" id="dialog-close" aria-label="Close">${icon('close')}</button></div><div class="dialog-content">${content}</div><div class="dialog-footer"><button class="small-button" id="dialog-cancel">${onApply ? 'Cancel' : 'Close'}</button>${onApply ? `<button class="primary" id="dialog-apply">${esc(applyText)}</button>` : ''}</div>`;
        $('#dialog-close').onclick = $('#dialog-cancel').onclick = () => d.close();
        if (onApply)
            $('#dialog-apply').onclick = () => this.safe(() => {
                const result=onApply();
                if(result?.then)return result.then(()=>d.close());
                d.close();
            });
        d.showModal();
    }
    showMenu(name, anchor) {
        const definitions = { File: ['newScene', 'demo', 'open', 'save', 'restore', '-', 'import', 'exportOBJ', 'exportSTL', 'exportGLTF', '-', 'exportPNG', 'exportHDR'], Edit: ['undo', 'redo', 'duplicate', 'delete', 'selectAll', 'deselect', 'palette'], Create: PRIMITIVES.map(x => 'create:' + x).concat(['areaLight', 'newMaterial']), Model: ['convertMesh', 'extrude', 'inset', 'deleteFace', 'weld', 'smoothNormals', 'uvEditor', 'collapseStack'], Animation: ['play', 'setKey', 'deleteKey', 'previousKey', 'nextKey', 'curveEditor', 'interpolation'], Render: ['toggleRender', 'restartRender', 'exportPNG', 'exportHDR', 'renderInspector', 'diagnostics'] };
        for(const [menu,ids] of Object.entries(this.extraMenus||{}))definitions[menu]=[...(definitions[menu]||[]),'-',...ids];
        const popup = $('#menu-popup');
        popup.innerHTML = (definitions[name] || []).map(id => id === '-' ? '<hr>' : `<button data-command="${id}">${icon(this.commands[id]?.icon || id.split(':')[1] || 'plus')}<span>${esc(this.commands[id]?.label || 'Create ' + id.split(':')[1])}</span>${this.commands[id]?.key ? `<kbd>${this.commands[id].key}</kbd>` : ''}</button>`).join('');
        popup.hidden = false;
        const r = anchor.getBoundingClientRect();
        popup.style.left = Math.min(r.left, innerWidth - 230) + 'px';
        popup.style.top = Math.min(r.bottom + 4, innerHeight - popup.offsetHeight - 10) + 'px';
    }
    createCommands() {
        const c = (label, ic, fn, key = '') => ({ label, icon: ic, fn, key });
        return {
            newScene: c('New empty scene', 'plus', () => this.dialog('New scene', '<p>Replace the current scene? Save a scene file first to keep the existing document. The recovery slot will be updated with the new scene.</p>', () => {
                this.doc = emptyDocument();
                this.selected.clear();
                this.history.clear();
                this.geometry.clear();
                this.changed();
            }, 'Create scene')),
            demo: c('Open Orbit study', 'sphere', () => this.dialog('Open example scene', '<p>Replace the current document with the Orbit study example?</p>', () => {
                this.doc = demoDocument();
                this.selected = new Set([this.doc.objects[3].id]);
                this.history.clear();
                this.geometry.clear();
                this.changed();
            }, 'Open example')),
            open: c('Open scene…', 'folder', () => this.chooseFile('.aureon,.json'), 'Ctrl+O'), save: c('Save scene…', 'save', () => {
                download(JSON.stringify(this.doc, null, 2), this.filename() + '.aureon', 'application/json');
                $('#save-state').textContent = 'Scene saved';
                this.toast('Scene file exported.');
            }, 'Ctrl+S'), restore: c('Restore recovery copy', 'undo', async () => {
                const r = await loadRecovery();
                if (!r)
                    throw Error('No recovery copy is stored.');
                this.dialog('Restore recovery', `<p>Restore “${esc(r.document.name)}”, saved ${esc(new Date(r.saved).toLocaleString())}?</p>`, () => {
                    this.doc = validateDocument(r.document);
                    this.selected.clear();
                    this.history.clear();
                    this.geometry.clear();
                    this.changed();
                }, 'Restore');
            }),
            import: c('Import OBJ / STL…', 'folder', () => this.chooseFile('.obj,.stl')), exportOBJ: c('Export scene as OBJ', 'download', () => download(exportOBJ(this.doc, this.geometry), this.filename() + '.obj', 'text/plain')), exportSTL: c('Export scene as STL', 'download', () => download(exportSTL(this.doc, this.geometry), this.filename() + '.stl')), exportGLTF: c('Export static glTF…', 'download', () => this.dialog('Export static glTF', '<p>This export bakes evaluated geometry and transforms. Standard base color, metalness, and roughness are exported. Procedural textures, glass transmission, animation, lights, and high-intensity emission are not preserved by this exporter. Use an Aureon scene file for a lossless round trip.</p>', () => download(JSON.stringify(exportGLTF(this.doc, this.geometry)), this.filename() + '.gltf', 'model/gltf+json'), 'Export snapshot')),
            undo: c('Undo', 'undo', () => {
                const label = this.history.undo();
                this.toast(label ? `Undid ${label}` : 'Nothing to undo.');
            }, 'Ctrl+Z'), redo: c('Redo', 'redo', () => {
                const label = this.history.redo();
                this.toast(label ? `Redid ${label}` : 'Nothing to redo.');
            }, 'Ctrl+Shift+Z'), duplicate: c('Duplicate selection', 'duplicate', () => this.mutate('Duplicate objects', () => {
                const originals = this.doc.objects.filter(o => this.selected.has(o.id) && !o.locked);
                if (!originals.length)
                    throw Error('Select an unlocked object first.');
                const idMap = new Map(originals.map(o => [o.id, uid()]));
                const copies = originals.map(o => {
                    const copy = structuredClone(o);
                    copy.id = idMap.get(o.id);
                    copy.name += ' copy';
                    copy.parent = idMap.get(o.parent) || o.parent;
                    copy.position[0] += .5;
                    return copy;
                });
                this.doc.objects.push(...copies);
                this.selected = new Set(copies.map(o => o.id));
            }), 'Ctrl+D'),
            delete: c('Delete selection', 'trash', () => this.mutate('Delete objects', () => {
                const remove = new Set([...this.selected].filter(id => !this.doc.objects.find(o => o.id === id)?.locked));
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const o of this.doc.objects)
                        if (remove.has(o.parent) && !remove.has(o.id)) {
                            remove.add(o.id);
                            changed = true;
                        }
                }
                this.doc.objects = this.doc.objects.filter(o => !remove.has(o.id));
                this.selected.clear();
                this.selectedFace = -1;
                this.selectedVertex = -1;
            }), 'Delete'), selectAll: c('Select all', 'cursor', () => {
                this.selected = new Set(this.doc.objects.filter(o => !o.locked && o.visible && !o.hiddenInViewport).map(o => o.id));
                this.refresh();
                this.dirty = true;
            }, 'Ctrl+A'), deselect: c('Clear selection', 'cursor', () => this.select(null), 'Esc'),
            resetTransform: c('Reset transform', 'rotate', () => this.mutate('Reset transform', () => {
                const o = this.requireObject();
                o.position = [0, 0, 0];
                o.rotation = [0, 0, 0];
                o.scale = [1, 1, 1];
                if (this.autoKey || o.keys.some(k => k.frame === this.doc.animation.frame))
                    setKey(o, this.doc.animation.frame);
            })), frameSelection: c('Frame selection', 'fit', () => this.frameSelection(), 'F'), snap: c('Toggle grid snap', 'magnet', () => {
                this.snap = !this.snap;
                $('#snap-button').classList.toggle('active', this.snap);
                this.toast(`Grid snap ${this.snap ? 'enabled' : 'disabled'} · ${this.snapSize} m`);
            }, 'S'), grid: c('Toggle viewport grid', 'grid', () => {
                this.grid = !this.grid;
                $('#grid-button').classList.toggle('active', this.grid);
                this.dirty = true;
            }, 'G'), wireframe: c('Toggle wireframe', 'mesh', () => {
                this.wireframe = !this.wireframe;
                $('#wireframe-button').classList.toggle('active', this.wireframe);
                this.dirty = true;
            }, 'F4'),
            create: c('Create geometry', 'plus', () => this.showMenu('Create', $('#create-button'))), convertMesh: c('Convert to editable mesh', 'mesh', () => this.mutate('Convert to mesh', () => this.convert())), collapseStack: c('Collapse modifier stack', 'stack', () => this.mutate('Collapse modifier stack', () => this.convert())),
            extrude: c('Extrude selected polygon…', 'mesh', () => this.polygonOperation(false)), inset: c('Inset selected polygon…', 'mesh', () => this.polygonOperation(true)), deleteFace: c('Delete selected polygon', 'trash', () => {
                if (this.selectedFace < 0)
                    throw Error('Switch to Polygon mode and select a face first.');
                this.mutate('Delete polygon', () => {
                    const o = this.requireObject();
                    this.convert(o);
                    o.mesh = deleteFace(o.mesh, this.selectedFace);
                    this.selectedFace = -1;
                });
            }), weld: c('Weld coincident vertices', 'mesh', () => this.mutate('Weld vertices', () => {
                const o = this.requireObject();
                this.convert(o);
                o.mesh = weld(o.mesh);
            })), smoothNormals: c('Toggle smooth normals', 'sphere', () => this.mutate('Toggle smooth normals', () => {
                const o = this.requireObject();
                this.convert(o);
                o.mesh.smooth = !o.mesh.smooth;
            })), uvEditor: c('UV editor…', 'uv', () => uvEditor(this)),
            areaLight: c('Create area light', 'sun', () => this.mutate('Create area light', () => {
                let mi = this.doc.materials.findIndex(m => m.emission > 0);
                if (mi < 0) {
                    mi = this.doc.materials.length;
                    this.doc.materials.push(material('Area light', '#ffffff', { emission: 12 }));
                }
                const o = newObject('plane', { width: 3, depth: 3 }, 'Area light');
                o.material = mi;
                o.position = [0, 5, 0];
                o.rotation = [180, 0, 0];
                this.doc.objects.push(o);
                this.selected = new Set([o.id]);
            })),
            newMaterial: c('New material', 'plus', () => {
                this.mutate('Create material', () => {
                    this.doc.materials.push(material('Material ' + (this.doc.materials.length + 1), '#b8b1a6'));
                    this.materialIndex = this.doc.materials.length - 1;
                });
                this.inspectorTab = 'material';
                renderInspector(this);
            }), duplicateMaterial: c('Duplicate material', 'duplicate', () => this.mutate('Duplicate material', () => {
                const m = structuredClone(this.doc.materials[this.materialIndex]);
                m.id = uid();
                m.name += ' copy';
                this.doc.materials.push(m);
                this.materialIndex = this.doc.materials.length - 1;
            })), applyMaterial: c('Apply material to selection', 'check', () => this.mutate('Apply material', () => {
                this.requireObject();
                this.doc.objects.filter(o => this.selected.has(o.id) && !o.locked).forEach(o => o.material = this.materialIndex);
            })), materialInspector: c('Material properties', 'settings', () => {
                this.inspectorTab = 'material';
                renderInspector(this);
                $('.right-panel').classList.toggle('open');
            }),
            play: c('Play / pause animation', 'play', () => {
                const playing = !this.playing;
                if (playing && this.renderer.mode === 'trace')
                    this.toggleRender(false);
                this.playing = playing;
                this.playStart = performance.now() - (this.doc.animation.frame - this.doc.animation.start) / this.doc.animation.fps * 1000;
                this.renderTimeline();
            }, 'Space'), firstFrame: c('Go to first frame', 'start', () => this.setFrame(this.doc.animation.start)), lastFrame: c('Go to last frame', 'end', () => this.setFrame(this.doc.animation.end)), previousKey: c('Previous key', 'chevron', () => {
                const keys = this.activeObject?.keys || [];
                this.setFrame([...keys].reverse().find(k => k.frame < this.doc.animation.frame)?.frame ?? this.doc.animation.start);
            }), nextKey: c('Next key', 'chevron', () => {
                this.setFrame(this.activeObject?.keys.find(k => k.frame > this.doc.animation.frame)?.frame ?? this.doc.animation.end);
            }), setKey: c('Set transform key', 'key', () => this.mutate('Set keyframe', () => {
                this.requireObject();
                for (const o of this.doc.objects.filter(o => this.selected.has(o.id) && !o.locked))
                    setKey(o, this.doc.animation.frame);
            }), 'K'), deleteKey: c('Delete current key', 'trash', () => this.mutate('Delete keyframe', () => {
                const o = this.requireObject();
                o.keys = o.keys.filter(k => k.frame !== this.doc.animation.frame);
            })), curveEditor: c('Animation curve editor…', 'curve', () => curveEditor(this)), interpolation: c('Animation interpolation…', 'curve', () => this.dialog('Animation interpolation', `<div class="form-row"><label>Curve type</label><select id="interpolation">${['step', 'linear', 'smooth'].map(x => `<option ${this.doc.animation.interpolation === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><p>Smooth uses cubic smoothstep between transform keys. Rotation channels interpolate in Euler degrees, including full turns.</p>`, () => this.mutate('Change interpolation', () => this.doc.animation.interpolation = $('#interpolation').value))),
            toggleRender: c('Start / stop path tracing', 'render', () => this.toggleRender(), 'F9'), restartRender: c('Restart accumulation', 'rotate', () => {
                this.renderer.reset();
                this.renderer.paused = false;
                this.dirty = true;
            }), renderInspector: c('Render settings', 'settings', () => {
                this.inspectorTab = 'render';
                renderInspector(this);
                $('.right-panel').classList.add('open');
            }), focusDistance: c('Focus at orbit target', 'camera', () => this.mutate('Set focus distance', () => this.doc.camera.focus = this.doc.camera.distance, { rebuild: false })),
            exportPNG: c('Save displayed PNG', 'camera', async () => {
                if (!this.gpuReady)
                    throw Error('A rendered viewport is required.');
                this.dirty = true;
                await this.renderer.render(this.doc, 0, { grid: this.grid, wireframe: this.wireframe });
                const blob = await this.renderer.capturePNG();
                download(blob, this.filename() + '.png');
                this.toast('Displayed image exported as PNG.');
            }), exportHDR: c('Export linear HDR (.pfm)', 'download', async () => {
                const hdr = await this.renderer.readHDR();
                download(encodePFM(hdr), this.filename() + '.pfm');
                this.toast('Linear, unclamped HDR data exported as PFM.');
            }),
            palette: c('Command palette', 'search', () => this.palette(), 'Ctrl+K'), help: c('Keyboard & workflow guide', 'info', () => this.help()), diagnostics: c('Renderer diagnostics', 'info', () => this.diagnostics())
        };
    }
    run(id) {
        if (id.startsWith('create:'))
            return this.safe(() => this.addPrimitive(id.slice(7)));
        const c = this.commands[id];
        if (c)
            return this.safe(c.fn);
        this.toast(`Unknown command: ${id}`, true);
    }
    filename() {
        return (this.doc.name || 'scene').replace(/[^\w\-]+/g, '-').toLowerCase();
    }
    chooseFile(accept) {
        $('#file-input').accept = accept;
        $('#file-input').value = '';
        $('#file-input').click();
    }
    async readFile(file) {
        if(file && await this.readProductionFile?.(file))return;
        if (!file)
            return;
        if (file.size > 100000000)
            throw Error('File exceeds the 100 MB import limit.');
        const ext = file.name.split('.').at(-1).toLowerCase();
        if (['json', 'aureon'].includes(ext)) {
            const doc = validateDocument(JSON.parse(await file.text()));
            this.mutate('Open document', () => {
                this.doc = doc;
                this.selected.clear();
                this.materialIndex = 0;
                this.geometry.clear();
            });
            this.toast(`Opened ${file.name}`);
        }
        else {
            const mesh = ext === 'obj' ? parseOBJ(await file.text()) : ext === 'stl' ? parseSTL(await file.arrayBuffer()) : null;
            if (!mesh)
                throw Error(`Unsupported file extension .${ext}`);
            this.mutate(`Import ${ext.toUpperCase()}`, () => {
                const o = newObject('mesh', {}, file.name.replace(/\.[^.]+$/, ''));
                o.mesh = mesh;
                o.position = [0, 0, 0];
                this.doc.objects.push(o);
                this.selected = new Set([o.id]);
                this.selectedFace = -1;
                this.selectedVertex = -1;
            });
            this.frameSelection();
            this.toast(`Imported ${file.name}`);
        }
    }
    polygonOperation(inset) {
        const o = this.requireObject();
        if (this.selectedFace < 0)
            throw Error('Switch to Polygon mode and select a face in the viewport first.');
        const face = this.selectedFace;
        this.dialog(inset ? 'Inset polygon' : 'Extrude polygon', `<div class="form-row"><label>${inset ? 'Inset fraction' : 'Distance (m)'}</label><input id="polygon-value" type="number" step="${inset ? .05 : .1}" value="${inset ? .15 : .3}" ${inset ? 'min="0" max="0.95"' : ''}></div><p>${inset ? 'Creates a smaller face connected by a ring of polygons.' : 'Moves the selected face along its geometric normal and creates connected side walls.'}</p>`, () => this.mutate(inset ? 'Inset polygon' : 'Extrude polygon', () => {
            const v = Number($('#polygon-value').value);
            if (!Number.isFinite(v) || inset && (v < 0 || v >= 1))
                throw Error('Enter a valid operation amount.');
            this.convert(o);
            o.mesh = extrudeFace(o.mesh, face, inset ? 0 : v, inset ? v : 0);
        }), inset ? 'Inset' : 'Extrude');
    }
    palette() {
        this.dialog('Command palette', `<input class="palette-search" placeholder="Search commands, tools, and primitives…" aria-label="Search commands"><div class="palette-results"></div>`);
        const all = [...Object.entries(this.commands), ...PRIMITIVES.map(p => ['create:' + p, { label: 'Create ' + p, icon: p }])];
        const show = q => {
            const found = all.filter(([id, c]) => c.label.toLowerCase().includes(q.toLowerCase()));
            $('.palette-results').innerHTML = found.map(([id, c]) => `<button data-palette-command="${id}">${icon(c.icon)}${esc(c.label)}</button>`).join('');
            $$('[data-palette-command]').forEach(b => b.onclick = () => {
                $('#dialog').close();
                this.run(b.dataset.paletteCommand);
            });
        };
        $('.palette-search').oninput = e => show(e.target.value);
        $('.palette-search').onkeydown = e => {
            if (e.key === 'Enter')
                $('.palette-results button')?.click();
        };
        show('');
        $('.palette-search').focus();
    }
    help() {
        this.dialog('Aureon Studio · Getting started', `<p>Create a primitive, select it, and drag a colored transform handle. The property panel edits precise dimensions, transforms, materials, and modifiers.</p><div class="help-grid"><span>Select / move / rotate / scale</span><kbd>Q / W / E / R</kbd><span>Orbit camera</span><kbd>Alt + left drag / right drag</kbd><span>Pan camera</span><kbd>Middle drag / Shift + right drag</kbd><span>Dolly / frame selection</span><kbd>Scroll / F</kbd><span>Snap / grid / wireframe</span><kbd>S / G / F4</kbd><span>Save / open / duplicate</span><kbd>Ctrl+S / Ctrl+O / Ctrl+D</kbd><span>Undo / redo</span><kbd>Ctrl+Z / Ctrl+Shift+Z</kbd><span>Play / set key / render</span><kbd>Space / K / F9</kbd><span>Command palette</span><kbd>Ctrl+K</kbd><span>Toggle inspector on narrow screens</span><kbd>I</kbd></div><h3>Polygon and UV editing</h3><p>Choose Polygon selection in the toolbar, click a face, then use Model → Extrude or Inset. Mesh edits bake the evaluated modifier stack. The UV editor supports seam cuts, conformal unwrap, pins, relaxation, packing, island transforms and planar/spherical projection.</p><h3>Path tracing</h3><p>Render scene switches to the compute renderer. Emissive meshes illuminate other objects. Sampling resets after scene changes. The material-library swatches are illustrative CSS previews, not measured renders.</p><h3>Deformation and production workspaces</h3><p>Model contains solid Boolean and convex bevel commands. Animation contains skeleton, skin, IK, cloth, rigid proxies and cache baking. Render contains bitmap textures, material graphs, media, fixed-frame motion blur, AOV/EXR output and the optional distributed coordinator. See the bundled guide for algorithm limits and GPU qualification.</p><h3>Feature status</h3><p>This is an original v0.2 implementation, not a complete replacement for a mature DCC package or a file/shader-compatible implementation of another renderer. The included documentation lists implemented systems and missing production features explicitly.</p>`, null, 'Close', 660);
    }
    diagnostics() {
        const d = this.renderer.device, s = this.compiled, r = this.renderer;
        const report = { version: '0.2.1', initializationError: r.initializationError ? { stage: r.initializationError.stage, message: r.initializationError.message, diagnostics: r.initializationError.diagnostics } : null, webgpu: !!this.gpuReady, adapter: r.info ? { vendor: r.info.vendor, architecture: r.info.architecture, device: r.info.device, description: r.info.description } : null, mode: r.mode, triangles: (s?.triangles.length || 0) / 32, bvhNodes: s?.nodeCount, bvhDepth: s?.maxDepth, bvhBuildMs: s?.buildMs, emissiveTriangles: s?.lightCount, samples: r.samples, viewport: [r.canvas.width, r.canvas.height], submissionCompletionMs: r.lastDuration, maxStorageBufferMiB: d?.limits.maxStorageBufferBindingSize / 1048576, validationErrors: r.errors, buildRevision: this.builtRevision, sceneRevision: this.revision };
        this.dialog('Renderer diagnostics', `<pre class="diagnostic-list">${esc(JSON.stringify(report, null, 2))}</pre><p class="note">Submission/completion time is measured with a queue fence. It is not a timestamp-query GPU-only measurement. No performance ranking is implied.</p>`, null, 'Close', 620);
    }
    keyboard(e) {
        if (e.target.matches('input,select,textarea,[contenteditable]') || $('#dialog').open)
            return;
        const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
        let command;
        if (ctrl) {
            command = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: 'save', o: 'open', d: 'duplicate', a: 'selectAll', k: 'palette' }[k];
        }
        else if (['q', 'w', 'e', 'r'].includes(k)) {
            e.preventDefault();
            this.setTool({ q: 'select', w: 'move', e: 'rotate', r: 'scale' }[k]);
            return;
        }
        else
            command = { delete: 'delete', backspace: 'delete', escape: 'deselect', f: 'frameSelection', g: 'grid', s: 'snap', f4: 'wireframe', f9: 'toggleRender', ' ': 'play', k: 'setKey' }[k];
        if (command) {
            e.preventDefault();
            this.run(command);
        }
        else if (k === 'i')
            $('.right-panel').classList.toggle('open');
        else if (k === '/') {
            e.preventDefault();
            $('#scene-search').focus();
        }
    }
    bindViewport() {
        const canvas = $('#gpu-canvas'), viewport = $('#viewport');
        const coords = e => {
            const r = canvas.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top, r.width, r.height];
        };
        let drag = null;
        const pointers = new Map();
        viewport.addEventListener('contextmenu', e => e.preventDefault());
        viewport.addEventListener('pointerdown', e => {
            if (e.target.closest('button,.render-progress'))
                return;
            const p = coords(e);
            pointers.set(e.pointerId, p);
            if (pointers.size === 2) {
                const ps = [...pointers.values()];
                drag = { kind: 'pinch', distance: Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]), camera: this.doc.camera.distance };
                return;
            }
            const handle = e.target.closest('[data-axis]');
            if (handle && this.activeObject) {
                this.safe(() => {
                    const o = this.requireObject();
                    this.playing = false;
                    this.history.begin('Transform selection');
                    if (this.selectionMode === 'vertex' && this.selectedVertex >= 0)
                        this.convert(o);
                    drag = { kind: 'transform', axis: handle.dataset.axis, start: p, objects: this.doc.objects.filter(o => this.selected.has(o.id)).map(o => ({ id: o.id, position: [...o.position], rotation: [...o.rotation], scale: [...o.scale] })), vertex: this.selectedVertex >= 0 ? vertex(this.geometry.get(o), this.selectedVertex) : null, origin: this.gizmoOrigin(), directions: this.axisDirections() };
                });
            }
            else if (e.button === 1 || e.button === 2 && e.shiftKey || e.altKey && e.shiftKey) {
                drag = { kind: 'pan', start: p, target: [...this.doc.camera.target] };
            }
            else if (e.button === 2 || e.altKey) {
                drag = { kind: 'orbit', start: p, yaw: this.doc.camera.yaw, pitch: this.doc.camera.pitch };
            }
            else {
                drag = { kind: 'select', start: p, multi: e.ctrlKey || e.metaKey || e.shiftKey };
            }
            viewport.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        viewport.addEventListener('pointermove', e => {
            const p = coords(e);
            if (pointers.has(e.pointerId))
                pointers.set(e.pointerId, p);
            if (!drag)
                return;
            if (drag.kind === 'pinch') {
                const ps = [...pointers.values()];
                if (ps.length === 2) {
                    const dist = Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]);
                    this.doc.camera.distance = clamp(drag.camera * drag.distance / Math.max(1, dist), .15, 500);
                    this.cameraChanged();
                }
                return;
            }
            const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
            if (drag.kind === 'orbit') {
                this.doc.camera.yaw = drag.yaw - dx * .007;
                this.doc.camera.pitch = clamp(drag.pitch + dy * .007, -1.55, 1.55);
                this.doc.camera.projection = 'perspective';
                $('#projection').value = 'perspective';
                this.cameraChanged();
            }
            else if (drag.kind === 'pan') {
                const cf = cameraFrame(this.doc.camera, p[2] / p[3]), speed = this.doc.camera.distance * .0017;
                this.doc.camera.target = add(drag.target, add(mul(cf.right, -dx * speed), mul(cf.up, dy * speed)));
                this.cameraChanged();
            }
            else if (drag.kind === 'transform')
                this.safe(() => this.dragTransform(drag, p, dx, dy));
        });
        const finish = e => {
            pointers.delete(e.pointerId);
            if (!drag)
                return;
            const current = drag;
            drag = null;
            if (current.kind === 'transform') {
                for (const o of this.doc.objects.filter(o => this.selected.has(o.id)))
                    if (this.autoKey || o.keys.some(k => k.frame === this.doc.animation.frame))
                        setKey(o, this.doc.animation.frame);
                const changed = this.history.commit();
                if (changed)
                    this.changed();
            }
            else if (current.kind === 'select') {
                const p = coords(e);
                if (Math.hypot(p[0] - current.start[0], p[1] - current.start[1]) < 6)
                    this.safe(() => this.pick(p, current.multi));
            }
            else
                this.autosave();
        };
        viewport.addEventListener('pointerup', finish);
        viewport.addEventListener('pointercancel', e => {
            pointers.delete(e.pointerId);
            if (drag?.kind === 'transform') {
                this.history.cancel();
                this.changed();
            }
            drag = null;
        });
        viewport.addEventListener('wheel', e => {
            e.preventDefault();
            this.doc.camera.distance = clamp(this.doc.camera.distance * Math.exp(e.deltaY * .001), .15, 500);
            this.cameraChanged();
        }, { passive: false });
        viewport.addEventListener('dblclick', () => this.frameSelection());
        viewport.addEventListener('dragover', e => e.preventDefault());
        viewport.addEventListener('drop', e => {
            e.preventDefault();
            this.safe(() => this.readFile(e.dataTransfer.files[0]));
        });
    }
    pick(p, multi) {
        const ray = cameraRay(this.doc.camera, ...p), hit = intersectBVH(this.compiled, ray.origin, ray.direction);
        if (!hit) {
            this.select(null, multi);
            return;
        }
        const id = this.compiled.objects[hit.objectIndex - 1], o = this.doc.objects.find(o => o.id === id);
        if (o?.locked)
            return;
        if (this.selectionMode === 'object') {
            this.select(id, multi);
            return;
        }
        if (!this.selected.has(id))
            this.select(id, false);
        if (this.selectionMode === 'face') {
            this.selectedFace = hit.face;
            this.selectedVertex = -1;
            this.inspectorTab = 'modify';
        }
        else {
            const m = this.geometry.get(o), world = worldMatrix(this.doc, o);
            let closest = -1, best = 15;
            for (let i = 0; i < m.positions.length / 3; i++) {
                const s = project(this.doc.camera, transformPoint(world, vertex(m, i)), p[2], p[3]), distance = Math.hypot(s[0] - p[0], s[1] - p[1]);
                if (distance < best && s[2] > 0 && s[2] < 1) {
                    best = distance;
                    closest = i;
                }
            }
            this.selectedVertex = closest;
            this.selectedFace = -1;
            if (closest < 0)
                this.toast('Click near a visible vertex to select it.');
        }
        this.renderTree();
        renderInspector(this);
        this.drawGizmo();
        this.dirty = true;
    }
    gizmoOrigin() {
        const o = this.activeObject;
        if (!o)
            return [0, 0, 0];
        const world = worldMatrix(this.doc, o);
        if (this.selectionMode === 'vertex' && this.selectedVertex >= 0)
            return transformPoint(world, vertex(this.geometry.get(o), this.selectedVertex));
        return transformPoint(world, [0, 0, 0]);
    }
    axisDirections() {
        const o = this.activeObject;
        const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        if (this.coordinateSpace === 'local' && o) {
            const world = worldMatrix(this.doc, o);
            return axes.map(a => normalize(transformVector(world, a)));
        }
        return axes;
    }
    drawGizmo() {
        const svg = $('#gizmo'), o = this.activeObject;
        if (!o) {
            svg.innerHTML = '';
            return;
        }
        const r = $('#viewport').getBoundingClientRect(), w = r.width, h = r.height;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const origin = this.gizmoOrigin(), screen = project(this.doc.camera, origin, w, h);
        if (screen[2] < 0 || screen[2] > 1) {
            svg.innerHTML = '';
            return;
        }
        let html = '';
        const mesh = this.geometry.get(o), world = worldMatrix(this.doc, o);
        if (this.selectedFace >= 0 && mesh.faces[this.selectedFace]) {
            const points = mesh.faces[this.selectedFace].map(i => project(this.doc.camera, transformPoint(world, vertex(mesh, i)), w, h).slice(0, 2).join(','));
            html += `<polygon points="${points.join(' ')}" fill="#eaaa7338" stroke="#f2bb8d" stroke-width="2"/>`;
        }
        if (this.selectionMode === 'vertex') {
            const step = Math.max(1, Math.ceil(mesh.positions.length / 3 / 2500));
            for (let i = 0; i < mesh.positions.length / 3; i += step) {
                const p = project(this.doc.camera, transformPoint(world, vertex(mesh, i)), w, h);
                if (p[2] > 0 && p[2] < 1)
                    html += `<circle cx="${p[0]}" cy="${p[1]}" r="${i === this.selectedVertex ? 4 : 1.8}" fill="${i === this.selectedVertex ? '#fff2c9' : '#eaaa73'}"/>`;
            }
        }
        if (this.tool !== 'select' && (this.selectionMode !== 'vertex' || this.selectedVertex >= 0)) {
            const size = this.doc.camera.distance * .12, directions = this.axisDirections(), colors = ['#ee8278', '#a7d590', '#83b3ed'];
            directions.forEach((axis, i) => {
                const end = project(this.doc.camera, add(origin, mul(axis, size)), w, h), name = 'xyz'[i];
                html += `<line x1="${screen[0]}" y1="${screen[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#161a2090" stroke-width="5"/><line x1="${screen[0]}" y1="${screen[1]}" x2="${end[0]}" y2="${end[1]}" stroke="${colors[i]}" stroke-width="2"/><circle cx="${end[0]}" cy="${end[1]}" r="4" fill="${colors[i]}"/><text x="${end[0] + 7}" y="${end[1] - 5}" fill="${colors[i]}" font-size="11" font-family="Arial">${name.toUpperCase()}</text><line data-axis="${name}" class="axis-hit" x1="${screen[0]}" y1="${screen[1]}" x2="${end[0]}" y2="${end[1]}"/>`;
            });
            html += `<rect class="center-hit" data-axis="free" x="${screen[0] - 5}" y="${screen[1] - 5}" width="10" height="10" rx="2" fill="#eaaa73" stroke="#24262b"/>`;
        }
        svg.innerHTML = html;
    }
    dragTransform(drag, p, dx, dy) {
        const axisIndex = 'xyz'.indexOf(drag.axis), cf = cameraFrame(this.doc.camera, p[2] / p[3]), unit = this.doc.camera.distance * .12, origin = project(this.doc.camera, drag.origin, p[2], p[3]);
        let delta = add(mul(cf.right, dx * this.doc.camera.distance * .0016), mul(cf.up, -dy * this.doc.camera.distance * .0016)), amount = (dx - dy) * .01;
        if (axisIndex >= 0) {
            const axis = drag.directions[axisIndex], end = project(this.doc.camera, add(drag.origin, mul(axis, unit)), p[2], p[3]), sx = end[0] - origin[0], sy = end[1] - origin[1], den = sx * sx + sy * sy;
            amount = den > 4 ? (dx * sx + dy * sy) / den * unit : dy * .01;
            delta = mul(axis, amount);
        }
        if (this.snap && this.tool === 'move')
            delta = delta.map(v => Math.round(v / this.snapSize) * this.snapSize);
        if (this.selectionMode === 'vertex' && this.selectedVertex >= 0 && drag.vertex) {
            if (this.tool !== 'move')
                throw Error('Vertex handles support translation. Use object mode for rotation or scale.');
            const o = this.requireObject(), local = transformVector(inverse(worldMatrix(this.doc, o)), delta);
            for (let k = 0; k < 3; k++)
                o.mesh.positions[this.selectedVertex * 3 + k] = drag.vertex[k] + local[k];
            this.geometry.cache.delete(o.id);
        }
        else
            for (const original of drag.objects) {
                const o = this.doc.objects.find(o => o.id === original.id);
                if (!o || o.locked)
                    continue;
                if (this.tool === 'move') {
                    let localDelta = delta;
                    if (o.parent)
                        localDelta = transformVector(inverse(worldMatrix(this.doc, this.doc.objects.find(x => x.id === o.parent))), delta);
                    o.position = add(original.position, localDelta);
                }
                else if (this.tool === 'rotate') {
                    o.rotation = [...original.rotation];
                    o.rotation[axisIndex < 0 ? 1 : axisIndex] += (dx - dy) * .5;
                    if (this.snap)
                        o.rotation = o.rotation.map(v => Math.round(v / 5) * 5);
                }
                else if (this.tool === 'scale') {
                    const factor = Math.max(.01, 1 + (dx - dy) * .008);
                    o.scale = original.scale.map((s, i) => axisIndex < 0 || i === axisIndex ? s * factor : s);
                }
                if (o.keys.length) {
                    const key = o.keys.find(k => k.frame === this.doc.animation.frame);
                    if (key || this.autoKey)
                        setKey(o, this.doc.animation.frame);
                }
            }
        this.requestBuild();
        this.renderer.reset();
        this.dirty = true;
        this.drawGizmo();
    }
}
const app = new Studio();
window.aureon = app;
window.aureonReady = app.start();
