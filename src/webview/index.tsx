import { createRoot } from "react-dom/client";
import { HelloView } from "./views/hello";

declare global {
  interface Window {
    __INITIAL_STATE__: { viewId: string };
  }
}

function App({ viewId }: { viewId: string }) {
  switch (viewId) {
    case "hello":
      return <HelloView />;
    default:
      return <div className="p-4">Unknown view: {viewId}</div>;
  }
}

const { viewId } = window.__INITIAL_STATE__;
createRoot(document.getElementById("root")!).render(<App viewId={viewId} />);
