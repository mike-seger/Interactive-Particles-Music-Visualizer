import { AudibleSpiralCore, MODES } from '../audible-spiral/AudibleSpiral'

export default class Audible3dSpiral extends AudibleSpiralCore {
  constructor() {
    super({ initialMode: MODES.FLOWER_3D, enableHotkeys: false })
    this.name = 'Audible3dSpiral'
  }
}
