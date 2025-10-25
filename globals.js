// tunables

const params = new URLSearchParams(window.location.search);
const number = params.get("n");
const renderQuality = params.get("r");

export const TEX_SIDE = number || 1200; // agents = TEX_SIDE^2
export let POINT_SIZE = 1; // px
// export let DRAG = 8; // damping, not used.
export let STEP_LEN = .8; // pos += vel * STEP_LEN
export let JITTER = 2.0; // random acceleration strength
export let IMAGE_AREA = 400.0;
// still testing this with coords, they clearly need to be adjusted.
export let RENDER_QUALITY = renderQuality || 1;
