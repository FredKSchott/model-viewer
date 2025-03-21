/*
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {BackSide, BoxBufferGeometry, Camera, Color, DirectionalLight, Object3D, PerspectiveCamera, Scene, Shader, ShaderLib, ShaderMaterial, Vector3} from 'three';
import {Mesh} from 'three';

import ModelViewerElementBase from '../model-viewer-base.js';
import {resolveDpr} from '../utilities.js';

import Model from './Model.js';
import Renderer from './Renderer.js';
import {cubeUVChunk} from './shader-chunk/cube_uv_reflection_fragment.glsl.js';
import StaticShadow from './StaticShadow.js';

export interface ModelSceneConfig {
  element: ModelViewerElementBase;
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  renderer: Renderer;
}

export type IlluminationRole = 'primary'|'secondary'

export const IlluminationRole: {[index: string]: IlluminationRole} = {
  Primary: 'primary',
  Secondary: 'secondary'
};

const $paused = Symbol('paused');
const $modelAlignmentMask = Symbol('modelAlignmentMask');

/**
 * A THREE.Scene object that takes a Model and CanvasHTMLElement and
 * constructs a framed scene based off of the canvas dimensions.
 * Provides lights and cameras to be used in a renderer.
 */
export default class ModelScene extends Scene {
  private[$paused]: boolean = false;
  private[$modelAlignmentMask] = new Vector3(1, 1, 1);
  private target = new Vector3();
  private aspect: number;

  public canvas: HTMLCanvasElement;
  public renderer: Renderer;
  public shadowLight: DirectionalLight;
  public shadow: StaticShadow;
  public pivot: Object3D;
  public width: number;
  public height: number;
  public framedHeight: number = 1;
  public modelDepth: number = 1;
  public isVisible: boolean = false;
  public isDirty: boolean = false;
  public element: ModelViewerElementBase;
  public context: CanvasRenderingContext2D;
  public exposure: number;
  public model: Model;
  public camera: PerspectiveCamera;
  public skyboxMesh: Mesh;
  public activeCamera: Camera;

  constructor({canvas, element, width, height, renderer}: ModelSceneConfig) {
    super();

    this.name = 'ModelScene';

    this.element = element;
    this.canvas = canvas;
    this.context = canvas.getContext('2d')!;
    this.renderer = renderer;
    this.exposure = 1;

    this.model = new Model();
    this.shadow = new StaticShadow();

    this.shadowLight = new DirectionalLight(0xffffff, 1.0);
    this.shadowLight.position.set(0, 10, 0);
    this.shadowLight.name = 'ShadowLight';

    this.width = width;
    this.height = height;
    this.aspect = width / height;
    // These default camera values are never used, as they are reset once the
    // model is loaded and framing is computed.
    this.camera = new PerspectiveCamera(45, this.aspect, 0.1, 100);
    this.camera.name = 'MainCamera';

    this.activeCamera = this.camera;
    this.pivot = new Object3D();
    this.pivot.name = 'Pivot';

    this.skyboxMesh = this.createSkyboxMesh();

    this.add(this.pivot);
    this.pivot.add(this.model);

    this.setSize(width, height);
    this.background = new Color(0xffffff);

    this.model.addEventListener(
        'model-load', (event: any) => this.onModelLoad(event));
  }

  get paused() {
    return this[$paused];
  }

  pause() {
    this[$paused] = true;
  }

  resume() {
    this[$paused] = false;
  }

  /**
   * Sets the model via URL.
   */
  async setModelSource(
      source: string|null, progressCallback?: (progress: number) => void) {
    try {
      await this.model.setSource(source, progressCallback);
    } catch (e) {
      throw new Error(
          `Could not set model source to '${source}': ${e.message}`);
    }
  }

  /**
   * Configures the alignment of the model within the frame based on value
   * "masks". By default, the model will be aligned so that the center of its
   * bounding box volume is in the center of the frame on all axes. In order to
   * center the model this way, the model is translated by the delta between
   * the world center of the bounding volume and world center of the frame.
   *
   * The alignment mask allows this translation to be scaled or eliminated
   * completely for each of the three axes. So, setModelAlignment(1, 1, 1) will
   * center the model in the frame. setModelAlignment(0, 0, 0) will align the
   * model so that its root node origin is at [0, 0, 0] in the scene.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setModelAlignmentMask(...alignmentMaskValues: [number, number, number]) {
    this[$modelAlignmentMask].set(...alignmentMaskValues);
    this.alignModel();
    this.isDirty = true;
  }

  /**
   * Receives the size of the 2D canvas element to make according
   * adjustments in the scene.
   */
  setSize(width: number, height: number) {
    if (width !== this.width || height !== this.height) {
      this.width = Math.max(width, 1);
      this.height = Math.max(height, 1);
      // In practice, invocations of setSize are throttled at the element level,
      // so no need to throttle here:
      this.updateFraming();
    }
  }

  /**
   * To frame the scene, a box is fit around the model such that the X and Z
   * dimensions (modelDepth) are the same (for Y-rotation) and the X/Y ratio is
   * the aspect ratio of the canvas (framedHeight is the Y dimension). For
   * non-centered models, the box is fit symmetrically about the XZ origin to
   * keep them in frame as they are rotated. At the ideal distance, the camera's
   * fov exactly covers the front face of this box when looking down the Z-axis.
   */
  updateFraming() {
    const dpr = resolveDpr();
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.aspect = this.width / this.height;

    const {boundingBox, position, size} = this.model;
    if (size.x != 0 || size.y != 0 || size.z != 0) {
      const boxHalfX = Math.max(
          Math.abs(boundingBox.min.x + position.x),
          Math.abs(boundingBox.max.x + position.x));
      const boxHalfZ = Math.max(
          Math.abs(boundingBox.min.z + position.z),
          Math.abs(boundingBox.max.z + position.z));

      const modelMinY = Math.min(0, boundingBox.min.y + position.y);
      const modelMaxY = Math.max(0, boundingBox.max.y + position.y);
      this.target.y = this[$modelAlignmentMask].y * (modelMaxY + modelMinY) / 2;
      const boxHalfY =
          Math.max(modelMaxY - this.target.y, this.target.y - modelMinY);

      this.modelDepth = 2 * Math.max(boxHalfX, boxHalfZ);
      this.framedHeight = Math.max(2 * boxHalfY, this.modelDepth / this.aspect);
    }

    // Immediately queue a render to happen at microtask timing. This is
    // necessary because setting the width and height of the canvas has the
    // side-effect of clearing it, and also if we wait for the next rAF to
    // render again we might get hit with yet-another-resize, or worse we
    // may not actually be marked as dirty and so render will just not
    // happen. Queuing a render to happen here means we will render twice on
    // a resize frame, but it avoids most of the visual artifacts associated
    // with other potential mitigations for this problem. See discussion in
    // https://github.com/GoogleWebComponents/model-viewer/pull/619 for
    // additional considerations.
    Promise.resolve().then(() => {
      this.renderer.render(performance.now());
    });
  }

  /**
   * Returns the size of the corresponding canvas element.
   */
  getSize(): {width: number, height: number} {
    return {width: this.width, height: this.height};
  }

  /**
   * Moves the model to be centered at the XZ origin, with Y = 0 being the floor
   * under the model, taking into account setModelAlignmentMask(), described
   * above.
   */
  alignModel() {
    if (!this.model.hasModel() || this.model.size.length() === 0) {
      return;
    }

    this.resetModelPose();

    let centeredOrigin = this.model.boundingBox.getCenter(new Vector3());
    centeredOrigin.y -= this.model.size.y / 2;
    this.model.position.copy(centeredOrigin)
        .multiply(this[$modelAlignmentMask])
        .multiplyScalar(-1);

    this.updateFraming();
    this.updateStaticShadow();
  }

  resetModelPose() {
    this.model.position.set(0, 0, 0);
    this.model.rotation.set(0, 0, 0);
    this.model.scale.set(1, 1, 1);
  }

  /**
   * Returns the current camera.
   */
  getCamera(): Camera {
    return this.activeCamera;
  }

  /**
   * Sets the passed in camera to be used for rendering.
   * @param {THREE.Camera}
   */
  setCamera(camera: Camera) {
    this.activeCamera = camera;
  }

  /**
   * Called when the model's contents have loaded, or changed.
   */
  onModelLoad(event: {url: string}) {
    this.alignModel();
    this.dispatchEvent({type: 'model-load', url: event.url});
  }

  /**
   * Called to update the shadow rendering when the room or model changes.
   */
  updateStaticShadow() {
    if (!this.model.hasModel() || this.model.size.length() === 0) {
      this.pivot.remove(this.shadow);
      return;
    }

    // Remove and cache the current pivot rotation so that the shadow's
    // capture is unrotated so it can be freely rotated when applied
    // as a texture.
    const currentRotation = this.pivot.rotation.y;
    this.pivot.rotation.y = 0;

    const modelPosition = this.model.boundingBox.getCenter(new Vector3())
                              .add(this.model.position);
    this.shadow.scale.x = 2 * Math.abs(modelPosition.x) + this.model.size.x;
    this.shadow.scale.z = 2 * Math.abs(modelPosition.z) + this.model.size.z;

    this.shadow.render(this.renderer.renderer, this, this.shadowLight);

    // Lazily add the shadow so we're only displaying it once it has
    // a generated texture.
    this.pivot.add(this.shadow);
    this.pivot.rotation.y = currentRotation;

    // TODO(#453) When we add a configurable camera target we should put the
    // floor back at y=0 for a consistent coordinate system.
    if (this[$modelAlignmentMask].y == 0) {
      this.shadow.position.y = modelPosition.y - this.model.size.y / 2;
    }
  }

  createSkyboxMesh(): Mesh {
    const geometry = new BoxBufferGeometry(1, 1, 1);
    geometry.removeAttribute('normal');
    geometry.removeAttribute('uv');
    const material = new ShaderMaterial({
      uniforms: {envMap: {value: null}, opacity: {value: 1.0}},
      vertexShader: ShaderLib.cube.vertexShader,
      fragmentShader: ShaderLib.cube.fragmentShader,
      side: BackSide,
      // Turn off the depth buffer so that even a small box still ends up
      // enclosing a scene of any size.
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    material.extensions = {
      derivatives: true,
      fragDepth: false,
      drawBuffers: false,
      shaderTextureLOD: false
    };
    const samplerUV = `
#define ENVMAP_TYPE_CUBE_UV
#define PI 3.14159265359
${cubeUVChunk}
uniform sampler2D envMap;
    `;
    material.onBeforeCompile = (shader: Shader) => {
      shader.fragmentShader =
          shader.fragmentShader.replace('uniform samplerCube tCube;', samplerUV)
              .replace(
                  'vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );',
                  'gl_FragColor = textureCubeUV( envMap, vWorldDirection, 0.0 );')
              .replace('gl_FragColor = mapTexelToLinear( texColor );', '');
    };
    const skyboxMesh = new Mesh(geometry, material);
    skyboxMesh.frustumCulled = false;
    // This centers the box on the camera, ensuring the view is not affected by
    // the camera's motion, which makes it appear inifitely large, as it should.
    skyboxMesh.onBeforeRender = function(_renderer, _scene, camera) {
      this.matrixWorld.copyPosition(camera.matrixWorld);
    };
    return skyboxMesh;
  }

  skyboxMaterial(): ShaderMaterial {
    return this.skyboxMesh.material as ShaderMaterial;
  }
}
