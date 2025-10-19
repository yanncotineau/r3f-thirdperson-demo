import * as THREE from 'three'

/**
 * Convert a root-motion Mixamo clip to in-place by removing X/Z translation on
 * the hips (or armature) position tracks. Keeps rotation and Y bobbing.
 * Returns a NEW AnimationClip; original is untouched.
 */
export function makeInPlace(
  clip: THREE.AnimationClip,
  opts?: { rootNames?: string[]; keepY?: boolean }
): THREE.AnimationClip {
  const rootNames = opts?.rootNames ?? ['Hips', 'mixamorig:Hips', 'Armature', 'Armature|Hips']
  const keepY = opts?.keepY ?? true

  const newTracks: THREE.KeyframeTrack[] = []
  for (const track of clip.tracks) {
    const isPosition = track.name.endsWith('.position')
    const targetName = track.name.split('.')[0]

    if (isPosition && rootNames.some(n => targetName.includes(n)) && track instanceof THREE.VectorKeyframeTrack) {
      // Copy times/values, zero X/Z (and optionally Y)
      const times = track.times.slice()
      const values = track.values.slice()
      for (let i = 0; i < values.length; i += 3) {
        values[i + 0] = 0 // X
        if (!keepY) values[i + 1] = 0 // Y (usually keep the bounce)
        values[i + 2] = 0 // Z
      }
      const t = new THREE.VectorKeyframeTrack(track.name, times, values)
      newTracks.push(t)
    } else {
      newTracks.push(track.clone())
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, newTracks)
}
