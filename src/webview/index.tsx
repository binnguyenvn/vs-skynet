import { createRoot } from "react-dom/client";
import { HelloView } from "@/views/hello";
import { GalleryView } from "@/views/gallery";
import { WorkerView } from "@/views/worker";

declare global {
  interface Window {
    __INITIAL_STATE__: { viewId: string };
  }
}

function App({ viewId }: { viewId: string }) {
  switch (viewId) {
    case "hello":
      return <HelloView />;
    case "gallery":
      return <GalleryView />;
    case "worker":
      return <WorkerView />;
    default:
      return <div className="p-4">Unknown view: {viewId}</div>;
  }
}

const { viewId } = window.__INITIAL_STATE__;
createRoot(document.getElementById("root")!).render(<App viewId={viewId} />);
