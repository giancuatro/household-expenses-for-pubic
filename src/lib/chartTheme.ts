"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export type ChartTheme = {
  income: string;
  expense: string;
  net: string;
  carry: string;
  asset: string;
  axis: string;
  grid: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  palette: string[];
};

// Match globals.css HSL tokens for light/dark.
const LIGHT: ChartTheme = {
  income: "hsl(152 60% 38%)",
  expense: "hsl(0 84% 60%)",
  net: "hsl(217 91% 60%)",
  carry: "hsl(262 83% 58%)",
  asset: "hsl(217 91% 60%)",
  axis: "hsl(220 10% 46%)",
  grid: "hsl(220 14% 90%)",
  tooltipBg: "hsl(0 0% 100%)",
  tooltipBorder: "hsl(220 14% 90%)",
  tooltipText: "hsl(222 47% 11%)",
  palette: [
    "hsl(217 91% 60%)",
    "hsl(152 60% 38%)",
    "hsl(38 92% 50%)",
    "hsl(0 84% 60%)",
    "hsl(262 83% 58%)",
    "hsl(191 91% 38%)",
    "hsl(326 75% 55%)",
    "hsl(24 90% 53%)",
    "hsl(200 18% 46%)",
    "hsl(280 65% 50%)",
  ],
};

const DARK: ChartTheme = {
  income: "hsl(152 55% 50%)",
  expense: "hsl(0 72% 60%)",
  net: "hsl(217 91% 65%)",
  carry: "hsl(262 75% 70%)",
  asset: "hsl(217 91% 65%)",
  axis: "hsl(220 10% 65%)",
  grid: "hsl(222 14% 22%)",
  tooltipBg: "hsl(222 18% 11%)",
  tooltipBorder: "hsl(222 14% 20%)",
  tooltipText: "hsl(220 15% 92%)",
  palette: [
    "hsl(217 91% 65%)",
    "hsl(152 55% 50%)",
    "hsl(38 92% 60%)",
    "hsl(0 72% 60%)",
    "hsl(262 75% 70%)",
    "hsl(191 80% 55%)",
    "hsl(326 70% 65%)",
    "hsl(24 85% 62%)",
    "hsl(200 18% 60%)",
    "hsl(280 60% 65%)",
  ],
};

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return LIGHT;
  return resolvedTheme === "dark" ? DARK : LIGHT;
}
