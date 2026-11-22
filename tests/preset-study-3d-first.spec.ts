import { spatial, walk } from "./preset-study";

// The first 60 of the 3D examples replace the whole study (see
// preset-study.ts); the rest are in preset-study-3d-second.spec.ts and
// preset-study-3d-third.spec.ts, so no one file outlasts a CI shard's
// margin.
walk(spatial, 0, 59);
