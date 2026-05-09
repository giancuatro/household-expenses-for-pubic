"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { addMonths, formatJaMonth } from "@/lib/format";

export default function MonthSelector({ currentMonth }: { currentMonth: string }) {
  const router = useRouter();
  const monthOptions = useMemo(() => {
    const opts: string[] = [];
    for (let i = 0; i <= 23; i++) opts.push(addMonths(currentMonth, -i));
    return opts;
  }, [currentMonth]);

  return (
    <select
      className="input text-sm py-1"
      value={currentMonth}
      onChange={(e) => router.push(`/report?m=${e.target.value}`)}
    >
      {monthOptions.map((m) => (
        <option key={m} value={m}>
          {formatJaMonth(m + "-01")}
        </option>
      ))}
    </select>
  );
}
