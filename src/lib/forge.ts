// One-shot intent flag: the Build page sets it, the Machine page
// consumes it. Only a just-built machine shows the forging screen —
// catalogue visitors always get straight in.

let intent = false;
export const setForgeIntent = () => { intent = true; };
export const consumeForgeIntent = () => { const v = intent; intent = false; return v; };
