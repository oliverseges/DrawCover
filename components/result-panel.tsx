"use client";

import { Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SoundPanel } from "@/components/sound-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { canvasController } from "@/lib/canvas/controller";
import { useDrawingStore } from "@/stores/drawing-store";

export function ResultPanel() {
  const recognition = useDrawingStore((s) => s.recognition);
  const isEmpty = useDrawingStore((s) => s.isEmpty);
  const loading = recognition.status === "loading";

  return (
    <div className="flex w-full flex-col gap-3 lg:w-72">
      <Button
        size="lg"
        className="h-11 text-base"
        disabled={isEmpty || loading}
        onClick={() => canvasController.recognize()}
      >
        <Sparkles />
        {loading ? "Thinking…" : "What is it?"}
      </Button>

      <Card aria-live="polite">
        <CardHeader>
          <CardTitle>Result</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {recognition.status === "idle" && (
            <p className="text-sm text-muted-foreground">
              Draw something, then click “What is it?”.
            </p>
          )}
          {loading && (
            <div className="flex flex-col gap-2" data-testid="result-loading">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          )}
          {recognition.status === "error" && (
            <Alert variant="destructive" data-testid="result-error">
              <AlertTitle>Couldn’t identify the drawing</AlertTitle>
              <AlertDescription>{recognition.message}</AlertDescription>
            </Alert>
          )}
          {recognition.status === "success" && (
            <div className="flex flex-col gap-3" data-testid="result-success">
              <p className="text-2xl font-semibold capitalize" data-testid="result-label">
                {recognition.result.label}
              </p>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Confidence</span>
                  <span>{Math.round(recognition.result.confidence * 100)}%</span>
                </div>
                <Progress value={Math.round(recognition.result.confidence * 100)} />
              </div>
              <p className="text-sm">{recognition.result.description}</p>
              {recognition.result.alternatives.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Could also be:</span>
                  {recognition.result.alternatives.map((a) => (
                    <Badge key={a} variant="secondary">
                      {a}
                    </Badge>
                  ))}
                </div>
              )}
              <SoundPanel phrase={recognition.result.sound?.phrase} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
