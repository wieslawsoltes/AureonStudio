import { add, sub, mul, cross, normalize, matMul, lookAt, perspective, orthographic, inverse, transformPoint, rad } from '../core/math.js';
export function cameraFrame(camera, aspect = 1) {
    const { yaw, pitch, distance, target } = camera, eye = add(target, [Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance]), forward = normalize(sub(target, eye)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward), view = lookAt(eye, target), ortho = camera.projection !== 'perspective', size = distance * .4, projection = ortho ? orthographic(size, aspect) : perspective(camera.fov, aspect);
    return { eye, forward, right, up, viewProjection: matMul(projection, view), ortho, size };
}
export function cameraRay(camera, x, y, width, height) {
    const cf = cameraFrame(camera, width / height), nx = x / width * 2 - 1, ny = 1 - y / height * 2, t = Math.tan(rad(camera.fov) / 2);
    if (cf.ortho)
        return { origin: add(add(cf.eye, mul(cf.right, nx * cf.size * width / height)), mul(cf.up, ny * cf.size)), direction: cf.forward };
    return { origin: cf.eye, direction: normalize(add(add(cf.forward, mul(cf.right, nx * t * width / height)), mul(cf.up, ny * t))) };
}
export function project(camera, p, width, height) {
    const cf = cameraFrame(camera, width / height), ndc = transformPoint(cf.viewProjection, p);
    return [(ndc[0] * .5 + .5) * width, (.5 - ndc[1] * .5) * height, ndc[2]];
}
