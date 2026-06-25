import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { onMessage, postMessage } from "../lib/vscode";

export function HelloView() {
  const [reply, setReply] = useState("");

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type === "greeting") {
          setReply(msg.text);
        }
      }),
    []
  );

  return (
    <div className="p-4 flex flex-col gap-3 items-start">
      <h1 className="text-lg font-semibold">Skynet Webview</h1>
      <Button onClick={() => postMessage({ type: "hello", name: "Skynet" })}>
        Say hello to the extension
      </Button>
      {reply && <p>{reply}</p>}
    </div>
  );
}
