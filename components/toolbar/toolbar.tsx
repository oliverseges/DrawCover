"use client";

import {
  Brush,
  Circle,
  Download,
  Eraser,
  Minus,
  PaintBucket,
  Redo2,
  Square,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { canvasController } from "@/lib/canvas/controller";
import { useDrawingStore, type Tool } from "@/stores/drawing-store";

export const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "brush", label: "Brush", key: "B", icon: Brush },
  { id: "eraser", label: "Eraser", key: "E", icon: Eraser },
  { id: "line", label: "Line", key: "L", icon: Minus },
  { id: "rect", label: "Rectangle", key: "R", icon: Square },
  { id: "ellipse", label: "Ellipse", key: "O", icon: Circle },
  { id: "fill", label: "Bucket fill", key: "F", icon: PaintBucket },
];

const SWATCHES = [
  "#111827", "#6b7280", "#ffffff", "#ef4444",
  "#f97316", "#eab308", "#84cc16", "#22c55e",
  "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1",
  "#a855f7", "#ec4899", "#92400e", "#fde68a",
];

function Hint({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon: LucideIcon;
}) {
  return (
    <Hint label={label}>
      <Button
        variant="outline"
        size="icon"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
      >
        <Icon />
      </Button>
    </Hint>
  );
}

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">{display}</span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

export function Toolbar() {
  const s = useDrawingStore();
  const isShape = s.tool === "rect" || s.tool === "ellipse";

  return (
    <aside className="flex w-full flex-col gap-4 rounded-lg border bg-card p-3 lg:w-64" aria-label="Drawing toolbar">
      <div className="flex flex-col gap-2">
        <Label>Tools</Label>
        <ToggleGroup
          value={[s.tool]}
          onValueChange={(v) => v[0] && s.setTool(v[0] as Tool)}
          variant="outline"
          className="flex-wrap"
        >
          {TOOLS.map((t) => (
            <Hint key={t.id} label={`${t.label} (${t.key})`}>
              <ToggleGroupItem value={t.id} aria-label={t.label} data-testid={`tool-${t.id}`}>
                <t.icon />
              </ToggleGroupItem>
            </Hint>
          ))}
        </ToggleGroup>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <Label>Color</Label>
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" aria-label="Choose color" className="justify-start gap-2" />
            }
          >
            <span className="size-4 rounded border" style={{ background: s.color }} />
            <span className="font-mono text-xs uppercase">{s.color}</span>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="grid grid-cols-8 gap-1.5">
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  onClick={() => s.setColor(c)}
                  className="size-6 rounded border outline-offset-2 focus-visible:outline-2"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="custom-color">Custom</Label>
              <input
                id="custom-color"
                type="color"
                value={s.color}
                onChange={(e) => s.setColor(e.target.value)}
                className="h-8 w-full cursor-pointer rounded border bg-transparent"
              />
            </div>
            {s.recentColors.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Recent</Label>
                <div className="flex gap-1.5">
                  {s.recentColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Recent color ${c}`}
                      onClick={() => s.setColor(c)}
                      className="size-6 rounded border"
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <SliderRow label="Size" value={s.size} display={`${s.size}px`} min={1} max={100} onChange={s.setSize} />
      <SliderRow
        label="Opacity"
        value={Math.round(s.opacity * 100)}
        display={`${Math.round(s.opacity * 100)}%`}
        min={5}
        max={100}
        onChange={(v) => s.setOpacity(v / 100)}
      />
      {s.tool === "fill" && (
        <SliderRow
          label="Fill tolerance"
          value={s.fillTolerance}
          display={String(s.fillTolerance)}
          min={0}
          max={128}
          onChange={s.setFillTolerance}
        />
      )}
      {isShape && (
        <div className="flex items-center justify-between">
          <Label htmlFor="shape-filled">Filled</Label>
          <Switch id="shape-filled" checked={s.shapeFilled} onCheckedChange={s.setShapeFilled} />
        </div>
      )}

      <Separator />

      <div className="flex flex-wrap gap-2">
        <IconButton label="Undo (Ctrl+Z)" icon={Undo2} onClick={() => canvasController.undo()} disabled={!s.canUndo} />
        <IconButton label="Redo (Ctrl+Y)" icon={Redo2} onClick={() => canvasController.redo()} disabled={!s.canRedo} />
        <IconButton label="Clear" icon={Trash2} onClick={() => canvasController.clear()} disabled={s.isEmpty} />
        <IconButton label="Download PNG" icon={Download} onClick={() => canvasController.download()} disabled={s.isEmpty} />
      </div>
    </aside>
  );
}
