import * as React from "react";
import { ChevronRightIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TreeItemStatus = "online" | "degraded" | "offline";

const STATUS_DOT: Record<TreeItemStatus, string> = {
  online: "bg-emerald-500",
  degraded: "bg-amber-500",
  offline: "bg-zinc-500",
};

function Tree({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="tree"
      data-slot="tree"
      className={cn("flex flex-col gap-1 text-sm select-none", className)}
      {...props}
    />
  );
}

function TreeGroup({
  label,
  count,
  defaultExpanded = true,
  children,
}: {
  label: string;
  count?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultExpanded} className="group/tree-group" data-slot="tree-group">
      <CollapsibleTrigger className="flex w-full items-center gap-1 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/tree-group:rotate-90" />
        <span className="flex-1 text-left">{label}</span>
        {count !== undefined && (
          <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[10px]">
            {count}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function TreeItem({
  icon,
  label,
  meta,
  status,
  selected,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  meta?: string;
  status?: TreeItemStatus;
  selected?: boolean;
  onClick?: () => void;
}) {
  const offline = status === "offline";
  return (
    <div
      role="treeitem"
      data-slot="tree-item"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.5 pl-4",
        "cursor-pointer hover:bg-accent/50",
        selected && "bg-accent",
        offline && "opacity-60",
      )}
    >
      {icon && <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate">{label}</span>
        {meta && (
          <span
            className={cn(
              "truncate text-xs",
              status === "degraded" ? "text-amber-500" : "text-muted-foreground",
            )}
          >
            {meta}
          </span>
        )}
      </div>
      {status && <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[status])} />}
    </div>
  );
}

export { Tree, TreeGroup, TreeItem };
