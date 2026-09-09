/** Typed startup failures and source-mapped WGSL diagnostics. No GPU is mocked here. */
const failures = {
    security: ['Secure connection required', 'WebGPU requires HTTPS or localhost'],
    availability: ['WebGPU unavailable', 'This browser does not expose WebGPU'],
    adapter: ['No GPU adapter', 'No WebGPU adapter is available'],
    device: ['GPU device error', 'WebGPU device creation failed'],
    context: ['GPU canvas error', 'WebGPU canvas initialization failed'],
    asset: ['Shader loading error', 'Renderer shader files could not be loaded'],
    shader: ['Shader error', 'Renderer shader compilation failed'],
    pipeline: ['GPU pipeline error', 'Renderer pipeline creation failed'],
    resources: ['GPU resource error', 'Renderer resource initialization failed'],
    initialization: ['Renderer error', 'Renderer initialization failed']
};
export class RendererError extends Error {
    constructor(stage, message, {cause, diagnostics = []} = {}) {
        super(message, cause ? {cause} : undefined);
        this.name = 'RendererError';
        this.stage = stage;
        [this.label, this.title] = failures[stage] || failures.initialization;
        this.diagnostics = diagnostics;
    }
}
export function rendererError(error, stage) {
    return error instanceof RendererError ? error : new RendererError(stage, error?.message || String(error), {cause: error});
}
export async function readShader(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        return await response.text();
    } catch (cause) {
        throw new RendererError('asset', `Cannot load shader ${url}: ${cause.message}`, {cause});
    }
}
/** Pop each scope synchronously after creation, before awaiting any compilation.
 * Parallel shader loads must never pop one another's validation scopes.
 */
export async function compileShaderModule(device, label, source, prefix = '') {
    const prefixLines = (prefix.match(/\n/g) || []).length;
    let module;
    device.pushErrorScope('validation');
    try {
        module = device.createShaderModule({label, code: prefix + source});
    } catch (cause) {
        await device.popErrorScope();
        throw new RendererError('shader', `${label}: ${cause.message}`, {cause});
    }
    const validation = device.popErrorScope();
    const [info, error] = await Promise.all([module.getCompilationInfo(), validation]);
    const diagnostics = info.messages.filter(m => m.type === 'error').map(m => ({
        file: m.lineNum > 0 && m.lineNum <= prefixLines ? 'common.wgsl' : label,
        line: m.lineNum > prefixLines ? m.lineNum - prefixLines : m.lineNum,
        column: m.linePos,
        message: m.message
    }));
    if (diagnostics.length || error) {
        const detail = diagnostics.map(d => `${d.file}:${d.line}:${d.column} ${d.message}`).join('\n');
        throw new RendererError('shader', detail || `${label}: ${error.message}`, {cause: error, diagnostics});
    }
    return module;
}
/** Resource creation errors are asynchronous in WebGPU; capture rather than
 * reporting initialization success with invalid bind groups or buffers.
 */
export async function validateResources(device, action) {
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    let result, failure;
    try { result = action(); } catch (error) { failure = error; }
    const validation = device.popErrorScope(), memory = device.popErrorScope();
    const errors = await Promise.all([validation, memory]);
    failure ||= errors.find(Boolean);
    if (failure) throw rendererError(failure, 'resources');
    return result;
}
