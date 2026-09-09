import { buildBVH, refitBVH } from './bvh.js';
let previous = null, refits = 0, baselineQuality = 0;
self.onmessage = ({ data: { id, triangles, materials } }) => {
    try {
        let result;
        if (previous && previous.order.length === triangles.length / 32 && triangles.length && refits < 24) {
            result = refitBVH(previous, triangles, materials);
            if (result.quality > baselineQuality * 1.6)
                result = null;
        }
        if (!result) {
            result = buildBVH(triangles, materials);
            refits = 0;
            baselineQuality = result.quality;
        }
        else
            refits++;
        previous = { nodes: result.nodes.slice(0), order: result.order, maxDepth: result.maxDepth };
        result.refitCount = refits;
        self.postMessage({ id, result }, [result.triangles.buffer, result.nodes, result.lights]);
    }
    catch (e) {
        self.postMessage({ id, error: e.message });
    }
};
