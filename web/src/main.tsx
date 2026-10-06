import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// No <StrictMode>: in development it mounts, unmounts and remounts every component, and
// that races React Three Fiber's async renderer setup. The deferred teardown can dispose
// the live 3D root, leaving a blank canvas that ignores redraws (seen on slow GPUs and in
// headless checks). Production never double-mounts, so this only aligns dev with prod.
createRoot(document.getElementById("root")!).render(<App />);
