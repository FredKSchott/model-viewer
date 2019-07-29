// These shader functions convert between the UV coordinates of a single face of
// a cubemap, the 0-5 integer index of a cube face, and the direction vector for
// sampling a textureCube (not generally normalized).

export const getDirectionChunk = /* glsl */ `
vec3 getDirection(vec2 uv, int face) {
    uv = 2.0 * uv - 1.0;
    vec3 direction;
    if (face == 0) {
      direction = vec3(1.0, uv.y, -uv.x);
    } else if (face == 1) {
      direction = vec3(uv.x, 1.0, -uv.y);
    } else if (face == 2) {
      direction = vec3(uv, 1.0);
    } else if (face == 3) {
      direction = vec3(-1.0, uv.y, uv.x);
    } else if (face == 4) {
      direction = vec3(uv.x, -1.0, uv.y);
    } else {
      direction = vec3(-uv.x,uv.y, -1.0);
    }
    return direction;
}
`

export const getFaceChunk = /* glsl */ `
int getFace(vec3 direction) {
    vec3 absDirection = abs(direction);
    int face = -1;
    if (absDirection.x > absDirection.z) {
      if (absDirection.x > absDirection.y)
        face = direction.x > 0.0 ? 0 : 3;
      else
        face = direction.y > 0.0 ? 1 : 4;
    } else {
      if (absDirection.z > absDirection.y)
        face = direction.z > 0.0 ? 2 : 5;
      else
        face = direction.y > 0.0 ? 1 : 4;
    }
    return face;
}
`

export const getUVChunk = /* glsl */ `
vec2 getUV(vec3 direction, int face) {
    vec2 uv;
    if (face == 0) {
      uv = vec2(-direction.z, direction.y) / abs(direction.x);
    } else if (face == 1) {
      uv = vec2(direction.x, -direction.z) / abs(direction.y);
    } else if (face == 2) {
      uv = direction.xy / abs(direction.z);
    } else if (face == 3) {
      uv = vec2(direction.z, direction.y) / abs(direction.x);
    } else if (face == 4) {
      uv = direction.xz / abs(direction.y);
    } else {
      uv = vec2(-direction.x, direction.y) / abs(direction.z);
    }
    return 0.5 * (uv + 1.0);
}
`