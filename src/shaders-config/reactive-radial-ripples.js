/**
 * Shader customization config for reactive-radial-ripples.glsl
 * This file defines UI controls that will be automatically generated in dat.GUI
 */
export default {
  name: 'Reactive Radial Ripples',
  controls: [
    {
      type: 'select',
      name: 'Palette',
      uniform: 'PALETTE_INDEX',
      default: 0,
      options: [
        { value: 0, label: 'Blueish' },
        { value: 1, label: 'Orange → Blue' },
        { value: 2, label: 'Purple/Magenta' },
        { value: 3, label: 'Blue/Red' }
      ]
    }
  ]
}
