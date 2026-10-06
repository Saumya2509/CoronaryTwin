// Soft studio reflections for the wet tissue sheen. Built from three's procedural RoomEnvironment
// (no HDR download), prefiltered once. Off in Lite mode.
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function StudioEnv({ enabled = true }: { enabled?: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!enabled) return;
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.6;
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
      room.dispose?.();
      pmrem.dispose();
      invalidate();
    };
  }, [enabled, gl, scene, invalidate]);
  return null;
}
