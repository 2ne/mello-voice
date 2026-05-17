import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import {
  formatHistoryTimestampLabel,
  formatHistoryTimestampTooltip,
  getHistoryTimestampRefreshMs,
} from "@/lib/historyTimestamp";

export type HistoryTimestampProps = {
  value: number;
  className?: string;
};

export function HistoryTimestamp({ value, className }: HistoryTimestampProps) {
  const date = useMemo(() => new Date(value), [value]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const ms = getHistoryTimestampRefreshMs(date, now);
    const timeout = window.setTimeout(() => {
      setNow(new Date());
    }, ms);
    return () => window.clearTimeout(timeout);
  }, [date, now]);

  const label = formatHistoryTimestampLabel(date, now);
  const tooltip = formatHistoryTimestampTooltip(date);

  return (
    <Tooltip content={tooltip} side="top" delayDuration={400}>
      <time dateTime={date.toISOString()} className={cn(className)}>
        {label}
      </time>
    </Tooltip>
  );
}
